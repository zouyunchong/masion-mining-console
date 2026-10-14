import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validate} from './server.mjs';
const c={threads:4,pool:'rx.unmineable.com:443',user:'Masion-LTC.MacMiniM4',password:'x',tls:true};
test('accept supported configuration',()=>assert.deepEqual(validate(c),c));
test('reject malformed or injected arguments',()=>{
 for(const change of [{threads:0},{threads:11},{threads:4.2},{pool:'host:0'},{pool:'host:65536'},{pool:'host:443;touch /tmp/no'},{pool:'--config:x'},{user:'abc\n--stress'},{password:'x\n--stress'},{tls:'true'}]) assert.throws(()=>validate({...c,...change}));
});
test('discard unrecognized configuration fields',()=>assert.deepEqual(validate({...c,command:'danger',binary:'/bin/sh'}),c));
import {parseStats,sign} from './account.mjs';
import {createHmac,createHash} from 'node:crypto';
test('map official mining balance separately from referral rewards',()=>{
 const result=parseStats({success:true,data:{coin:'LTC',balance:'0.01500000',balance_mining:'0.01000000',balance_referral:'0.00500000',paid:'0.05000000',rewarded:{past_24h:'0.00010000'}}});
 assert.equal(result.minedUnpaid,'0.01000000');assert.equal(result.balance,'0.01500000');assert.equal(result.paid,'0.05000000');
 assert.throws(()=>parseStats({success:true,data:{coin:'LTC',balance:'0'}}));
 assert.throws(()=>parseStats({success:true,data:{coin:'BTC',balance:'1',balance_mining:'1'}}));
});
test('HMAC follows documented GET path and empty body payload',()=>{
 const expected=createHmac('sha256','test-secret').update('GET\n/v1/assets/LTC/stats\n\n1743460800000\n'+createHash('sha256').update('').digest('hex')).digest('hex');
 assert.equal(sign('/v1/assets/LTC/stats','1743460800000','test-secret'),expected);
});
import {createAccount} from './account.mjs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
test('account connection keeps secrets local and marks stale amounts',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'m4-account-test-'));const original=globalThis.fetch;
 try{
  let offline=false;
  globalThis.fetch=async(url,options)=>{
   assert.equal(url,'https://api.unmineable.dev/v1/assets/LTC/stats');assert.equal(options.method,'GET');
   if(offline)return new Response('{}',{status:503});
   return new Response(JSON.stringify({success:true,data:{coin:'LTC',balance:'0.00001',balance_mining:'0.000009',paid:'0'}}));
  };
  const account=createAccount(dir);await account.init();assert.equal(account.get().configured,false);
  await account.connect({key:'test-key',secret:'test-secret'});
  assert.equal(account.get().minedUnpaid,'0.000009');assert.equal((await fs.stat(path.join(dir,'unmineable.json'))).mode&0o777,0o600);
  assert.ok(!JSON.stringify(account.get()).includes('test-secret'));
  offline=true;await account.refresh();assert.equal(account.get().connected,false);assert.equal(account.get().minedUnpaid,'0.000009');assert.ok(account.get().reason);
  await account.disconnect();assert.equal(account.get().configured,false);assert.equal(account.get().minedUnpaid,undefined);
 }finally{globalThis.fetch=original;await fs.rm(dir,{recursive:true,force:true})}
});
import {createDeviceAuth,sameSecret} from './device-auth.mjs';
test('pairing codes expire after use and tokens are device-specific',async()=>{
 const a=await fs.mkdtemp(path.join(os.tmpdir(),'masion-a-')),b=await fs.mkdtemp(path.join(os.tmpdir(),'masion-b-'));
 try{
  const first=await createDeviceAuth(a),second=await createDeviceAuth(b);
  const {code}=await first.localCode();const {token}=await first.pair(code);
  assert.ok(first.authorized(token));assert.equal(second.authorized(token),false);
  await assert.rejects(first.pair(code));await first.newCode();assert.ok(first.authorized(token));assert.equal(sameSecret('a','aa'),false);
  await first.revoke();assert.equal(first.authorized(token),false);
 }finally{await fs.rm(a,{recursive:true,force:true});await fs.rm(b,{recursive:true,force:true})}
});
test('pairing limits repeated guesses',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'masion-rate-'));
 try{const auth=await createDeviceAuth(dir);for(let i=0;i<5;i++)await assert.rejects(auth.pair('wrong'));await assert.rejects(auth.pair((await auth.localCode()).code),/频繁/)}finally{await fs.rm(dir,{recursive:true,force:true})}
});
import {publicIPv4,resolvePool,createPoolNetwork} from './pool-network.mjs';
import net from 'node:net';
test('encrypted pool DNS excludes private addresses',async()=>{
 for(const ip of ['127.0.0.1','10.0.0.1','172.16.0.1','192.168.1.1','169.254.1.1','999.1.1.1','100.64.0.1'])assert.equal(publicIPv4(ip),false);
 assert.equal(publicIPv4('209.38.61.60'),true);
 const original=globalThis.fetch;
 try{globalThis.fetch=async url=>{assert.ok(url.startsWith('https://dns.google/resolve?'));return new Response(JSON.stringify({Status:0,Answer:[{type:1,data:'127.0.0.1'},{type:1,data:'209.38.61.60'}]}))};assert.deepEqual(await resolvePool('rx.unmineable.com'),['209.38.61.60'])}finally{globalThis.fetch=original}
});
test('pool SOCKS endpoint rejects destinations outside configured pool',async()=>{
 let resolutionCalled=false;const proxy=await createPoolNetwork('rx.unmineable.com',443,()=>{},async()=>{resolutionCalled=true;return []});
 try{
  const port=Number(proxy.address.split(':')[1]);
  const result=await new Promise((resolve,reject)=>{
   const s=net.connect(port,'127.0.0.1');let greeting=false;
   s.setTimeout(2000,()=>s.destroy(new Error('timeout')));s.on('error',reject);
   s.on('connect',()=>s.write(Buffer.from([5,1,0])));
   s.on('data',b=>{
    if(!greeting){assert.equal(b[1],0);greeting=true;const host=Buffer.from('example.com');const request=Buffer.concat([Buffer.from([5,1,0,3,host.length]),host,Buffer.from([1,187])]);s.write(request)}else{resolve(b[1]);s.destroy()}
   });
  });assert.equal(result,2);assert.equal(resolutionCalled,false);
 }finally{await proxy.close()}
});

test('disconnect discards an account response already in flight',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'masion-account-race-'));const original=globalThis.fetch;let release;
 try{
  const payload={success:true,data:{coin:'LTC',balance:'0.01',balance_mining:'0.01',paid:'0'}};
  globalThis.fetch=async()=>new Response(JSON.stringify(payload));const account=createAccount(dir);await account.connect({key:'fixture',secret:'fixture'});
  globalThis.fetch=()=>new Promise(resolve=>{release=()=>resolve(new Response(JSON.stringify(payload)))});
  const pending=account.refresh();await account.disconnect();release();await pending;
  assert.equal(account.get().configured,false);assert.equal(account.get().balance,undefined);
  await assert.rejects(fs.access(path.join(dir,'unmineable.json')));
 }finally{globalThis.fetch=original;await fs.rm(dir,{recursive:true,force:true})}
});

import {spawn} from 'node:child_process';
import {once} from 'node:events';
test('local reset stops the owned miner, clears saved data, and revokes old access',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'masion-reset-'));let child;
 try{
  const fixture=path.join(dir,'app'),data=path.join(dir,'data');await fs.mkdir(fixture);await fs.mkdir(data);
  for(const name of ['server.mjs','guardian.mjs','account.mjs','device-auth.mjs','pool-network.mjs'])await fs.copyFile(new URL(name,import.meta.url),path.join(fixture,name));
  // Avoid touching or detecting the user's real miner; this fixture owns only a dummy process.
  await fs.writeFile(path.join(fixture,'platform.mjs'),"export async function otherMiners(){return []}export async function minerResources(){return {cpu:0,rss:0}}export function deviceInfo(id){return {id,name:'fixture',cores:4,memory:1,platform:'test'}}");
  const fake=path.join(dir,'fake-miner');await fs.writeFile(fake,`#!${process.execPath}\nsetInterval(()=>{},1000);\n`);await fs.chmod(fake,0o700);
  await fs.writeFile(path.join(data,'settings.json'),JSON.stringify({...c,pool:'example.com:3333',user:'fixture-worker',password:'fixture-password'}));
  const probe=net.createServer();probe.listen(0,'127.0.0.1');await once(probe,'listening');const port=probe.address().port;await new Promise(r=>probe.close(r));
  child=spawn(process.execPath,[path.join(fixture,'server.mjs')],{env:{...process.env,PORT:String(port),ASSISTANT_DATA_DIR:data,XMRIG_PATH:fake},stdio:'ignore'});
  const url=`http://127.0.0.1:${port}`;let s;
  for(let i=0;i<80;i++){try{s=await fetch(url+'/api/status').then(r=>r.json());break}catch{await new Promise(r=>setTimeout(r,50))}}assert.ok(s);
  const post=(route,body={},headers={})=>fetch(url+route,{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':s.csrf,...headers},body:JSON.stringify(body)});
  const code=await fetch(url+'/api/pair-code').then(r=>r.json());const token=(await post('/api/pair',{code:code.code},{Origin:'https://masion.xyz'}).then(r=>r.json())).token;assert.ok(token);
  assert.equal((await post('/api/start')).status,200);
  for(let i=0;i<80;i++){s=await fetch(url+'/api/status').then(r=>r.json());if(s.pid)break;await new Promise(r=>setTimeout(r,50))}assert.ok(s.pid);const minerPid=s.pid,previousDevice=s.device.id,previousCsrf=s.csrf;
  await fs.writeFile(path.join(data,'unmineable.json'),'fixture-private-key');await fs.writeFile(path.join(data,'settings.tmp'),'fixture-password');
  const confirm={confirmation:'DELETE_LOCAL_MINING_DATA'};
  assert.equal((await post('/api/device/reset',confirm,{Origin:'https://masion.xyz','X-Device-Token':token})).status,403);
  assert.equal((await post('/api/device/reset',confirm,{'X-CSRF-Token':'wrong'})).status,403);
  assert.equal((await post('/api/device/reset')).status,400);assert.ok((await fetch(url+'/api/status').then(r=>r.json())).pid);
  assert.equal((await post('/api/device/reset',confirm)).status,200);
  const after=await fetch(url+'/api/status').then(r=>r.json());assert.equal(after.pid,null);assert.equal(after.state,'stopped');assert.equal(after.logs.length,0);assert.equal(after.history.length,0);assert.equal(after.account.configured,false);assert.notEqual(after.device.id,previousDevice);assert.notEqual(after.csrf,previousCsrf);assert.notEqual(after.config.user,'fixture-worker');assert.throws(()=>process.kill(minerPid,0));
  for(const name of ['settings.json','settings.tmp','unmineable.json','runtime.json'])await assert.rejects(fs.access(path.join(data,name)));
  assert.equal((await fetch(url+'/api/status',{headers:{Origin:'https://masion.xyz','X-Device-Token':token}})).status,401);
  assert.equal((await post('/api/start',{}, {'X-CSRF-Token':previousCsrf})).status,403);
  const newCode=await fetch(url+'/api/pair-code').then(r=>r.json());assert.ok(newCode.code);s=after;
  assert.equal((await post('/api/pair',{code:newCode.code},{Origin:'https://masion.xyz'})).status,200);
 }finally{
  if(child&&child.exitCode===null){const exited=once(child,'exit');child.kill('SIGTERM');await exited}
  await fs.rm(dir,{recursive:true,force:true});
 }
});
