import {createPoolNetwork} from './pool-network.mjs';
import {createDeviceAuth,SITE_ORIGIN} from './device-auth.mjs';
import {otherMiners,minerResources,deviceInfo} from './platform.mjs';
import {createAccount} from './account.mjs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import fs from 'node:fs/promises';
import {execFile,fork} from 'node:child_process';
import {promisify} from 'node:util';
import {randomBytes,timingSafeEqual} from 'node:crypto';
const exec=promisify(execFile), root=path.dirname(fileURLToPath(import.meta.url));
const data=process.env.ASSISTANT_DATA_DIR||path.join(root,'.local');
let binary=process.env.XMRIG_PATH || path.join(root,'bin',process.platform==='win32'?'xmrig.exe':'xmrig');
const port=Number(process.env.PORT || 4780), origin=`http://127.0.0.1:${port}`;
const defaults={threads:Math.min(4,os.cpus().length),pool:'rx.unmineable.com:443',user:'Masion-LTC.'+os.hostname().replace(/[^a-zA-Z0-9_-]/g,'').slice(0,40),password:'x',tls:true};
export function validate(c){
  if(!c || !Number.isInteger(c.threads) || c.threads<1 || c.threads>Math.min(os.cpus().length,10)) throw Error('线程数必须为 1–10 的整数');
  if(typeof c.pool!=='string' || !/^(?=.{1,253}:)[a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?:[0-9]{1,5}$/.test(c.pool)) throw Error('矿池格式应为 hostname:port');
  const p=Number(c.pool.split(':').at(-1)); if(p<1||p>65535) throw Error('矿池端口无效');
  if(typeof c.user!=='string'||!c.user.length||c.user.length>200||/[\s\x00-\x1f]/.test(c.user)) throw Error('矿池用户名格式无效');
  if(typeof c.password!=='string'||c.password.length>200||/[\x00-\x1f]/.test(c.password)) throw Error('矿池密码格式无效');
  if(typeof c.tls!=='boolean') throw Error('TLS 配置无效');
  return {threads:c.threads,pool:c.pool,user:c.user,password:c.password,tls:c.tls};
}
async function main(){
 await fs.mkdir(data,{recursive:true,mode:0o700});
 const lock=path.join(data,'server.lock');
 try{await fs.writeFile(lock,String(process.pid),{flag:'wx',mode:0o600})}catch(e){
  if(e.code!=='EEXIST')throw e;
  const previous=Number(await fs.readFile(lock,'utf8'));
  let alive=false;try{process.kill(previous,0);alive=true}catch(err){if(err.code!=='ESRCH')alive=true}
  if(alive)throw Error('已有控制台服务运行，请使用现有页面。');
  await fs.rm(lock);await fs.writeFile(lock,String(process.pid),{flag:'wx',mode:0o600});
 }

 let auth=await createDeviceAuth(data);
 let deviceId;
 try{deviceId=await fs.readFile(path.join(data,'device-id'),'utf8')}catch(e){if(e.code!=='ENOENT')throw e;deviceId=randomBytes(12).toString('hex');await fs.writeFile(path.join(data,'device-id'),deviceId,{mode:0o600})}
 let config=defaults;
 try{config=validate(JSON.parse(await fs.readFile(path.join(data,'settings.json'),'utf8')))}catch(e){if(e.code!=='ENOENT') throw e}
 let poolNetwork=null;
 let guardian=null,pid=null,state='stopped',started=null,lastExit=null,apiPort=null,apiToken='',busy=false,shutting=false;
 let logs=[],partial='',snapshot=null,sampleAt=null,resources={cpu:null,rss:null},history=[];
 let csrf=randomBytes(32).toString('hex');
 const account=createAccount(data);await account.init();const accountTimer=setInterval(()=>account.refresh(),60000);
 const mask=s=>{for(const v of [config.password,config.user,apiToken]) if(v && v!=='x') s=s.split(v).join('[已隐藏]');return s.replace(/\x1b\[[0-9;]*m/g,'')};
 const log=line=>{logs.push({time:Date.now(),text:mask(line)});if(logs.length>400)logs.shift()};
 const external=otherMiners;
 async function stop(){
  if(!guardian)return;
  state='stopping';log('正在停止矿工…');
  const g=guardian;
  await new Promise(resolve=>{g.once('exit',resolve);if(g.connected)g.send({type:'stop'});else g.kill('SIGTERM')});
 }
 async function start(){
  if(guardian)throw Error('矿工已运行或正在启动');
  if((await external()).length)throw Error('检测到其他 XMRig 进程。请先在原终端停止它，再使用控制台。');
  await fs.access(binary,fs.constants.X_OK);
  apiPort=await new Promise((resolve,reject)=>{const s=net.createServer();s.once('error',reject);s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p))})});
  apiToken=randomBytes(32).toString('hex');
  const [poolHost,poolPort]=config.pool.split(':');
  if(poolHost==='rx.unmineable.com'){poolNetwork=await createPoolNetwork(poolHost,Number(poolPort),log);log('矿池使用加密 DNS 解析，修复本地 DNS 异常。')}
  const minerConfig={autosave:false,background:false,colors:false,'print-time':60,'donate-level':1,randomx:{init:config.threads},cpu:{enabled:true,yield:true,priority:1,rx:Array(config.threads).fill(-1)},opencl:false,cuda:false,http:{enabled:true,host:'127.0.0.1',port:apiPort,'access-token':apiToken,restricted:true},pools:[{url:config.pool,user:config.user,pass:config.password,tls:config.tls,socks5:poolNetwork?.address||null,algo:'rx/0',keepalive:true}]};
  const cf=path.join(data,'runtime.json');
  await fs.writeFile(cf,JSON.stringify(minerConfig),{mode:0o600});await fs.chmod(cf,0o600);
  state='starting';started=Date.now();snapshot=null;sampleAt=null;history=[];lastExit=null;partial='';resources={cpu:null,rss:null};
  guardian=fork(path.join(root,'guardian.mjs'),[],{stdio:['ignore','ignore','ignore','ipc']});
  const g=guardian;
  g.on('message',m=>{
   if(m.type==='pid')pid=m.pid;
   if(m.type==='log'){partial+=m.text;const lines=partial.split(/\r?\n/);partial=lines.pop().slice(-8000);lines.forEach(log)}
   if(m.type==='exit'){lastExit={code:m.code,signal:m.signal};log(`矿工已退出（${m.signal || m.code}）`)}
  });
  g.on('exit',()=>{const network=poolNetwork;poolNetwork=null;network?.close().catch(()=>{});if(partial)log(partial);guardian=null;pid=null;state=lastExit?.code && lastExit.code!==0?'error':'stopped';snapshot=null;sampleAt=null;resources={cpu:null,rss:null};fs.rm(cf,{force:true}).catch(()=>{})});
  g.send({type:'start',binary,config:cf});log(`启动矿工 · ${config.threads} 线程 · RandomX · TLS ${config.tls?'开启':'关闭'}`);
 }
 let polling=false;
 const interval=setInterval(async()=>{
  if(polling||!guardian||!pid)return;polling=true;const currentGuardian=guardian;
  try{
   const [api,ps]=await Promise.allSettled([
    fetch(`http://127.0.0.1:${apiPort}/2/summary`,{headers:{Authorization:`Bearer ${apiToken}`},signal:AbortSignal.timeout(1500)}).then(r=>{if(!r.ok)throw Error('api');return r.json()}),
    minerResources(pid)
   ]);
   if(guardian!==currentGuardian||state==='stopping')return;
   if(api.status==='fulfilled'){
    snapshot=api.value;sampleAt=Date.now();
    state=snapshot.connection?.uptime_ms>0?(snapshot.hashrate?.total?.[0]>0?'running':'starting'):'reconnecting';
    const h=snapshot.hashrate?.total?.[0];if(Number.isFinite(h)){history.push({time:sampleAt,value:h});if(history.length>120)history.shift()}
   }else{sampleAt=null;snapshot=null;state='unavailable'}
   if(ps.status==='fulfilled'){resources=ps.value}else resources={cpu:null,rss:null};
  } finally{polling=false}
 },2000);
 const headers={'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"};
 const server=http.createServer(async(req,res)=>{
  const reply=(code,obj)=>{res.writeHead(code,headers);res.end(JSON.stringify(obj))};
  try{
   if(req.headers.host!==`127.0.0.1:${port}`)return reply(403,{error:'请通过 127.0.0.1 本机地址访问'});
   const url=new URL(req.url,origin);
   const fromSite=req.headers.origin===SITE_ORIGIN;
   if(req.headers.origin&&req.headers.origin!==origin&&!fromSite)return reply(403,{error:'来源不允许'});
   const cors=fromSite?{'Access-Control-Allow-Origin':SITE_ORIGIN,'Vary':'Origin','Access-Control-Allow-Methods':'GET, POST, OPTIONS','Access-Control-Allow-Headers':'Content-Type, X-CSRF-Token, X-Device-Token','Access-Control-Allow-Private-Network':'true'}:{};
   if(fromSite){for(const [k,v] of Object.entries(cors))res.setHeader(k,v)}
   if(req.method==='OPTIONS') {res.writeHead(204,{...headers,...cors});return res.end()}
   if(req.headers['sec-fetch-site']==='cross-site'&&!fromSite)return reply(403,{error:'来源不允许'});
   if(url.pathname==='/api/pair-code'&&req.method==='GET'){
    if(fromSite)return reply(403,{error:'配对码只能在本机助手查看'});
    return reply(200,await auth.localCode());
   }
   if(req.method==='POST'&&['/api/pair-code/refresh','/api/device/revoke'].includes(url.pathname)){
    if(fromSite)return reply(403,{error:'配对维护只能在本机助手操作'});
    if(req.headers['x-csrf-token']!==csrf)return reply(403,{error:'会话验证失败，请刷新页面'});
    if(url.pathname==='/api/device/revoke')await auth.revoke();else await auth.newCode();
    return reply(200,{ok:true});
   }
   if(url.pathname==='/api/device/reset'&&req.method==='POST'){
    if(fromSite)return reply(403,{error:'请在本机助手确认清除，网页不能直接删除本机配置'});
    if(req.headers['x-csrf-token']!==csrf)return reply(403,{error:'会话验证失败，请刷新页面'});
    if(shutting||busy)return reply(409,{error:'操作处理中，请稍后重试'});
    if(!req.headers['content-type']?.startsWith('application/json'))return reply(415,{error:'需要 JSON 请求'});
    let body='';for await(const b of req){body+=b;if(body.length>1024)throw Error('请求过大')}
    if(JSON.parse(body).confirmation!=='DELETE_LOCAL_MINING_DATA')return reply(400,{error:'请先确认清除范围'});
    busy=true;
    try{
     await stop();await account.disconnect();
     // Only this helper's private data directory is cleared. Keep the live service lock.
     for(const entry of await fs.readdir(data))if(entry!=='server.lock')await fs.rm(path.join(data,entry),{recursive:true,force:true});
     config={...defaults};logs=[];history=[];partial='';snapshot=null;sampleAt=null;started=null;lastExit=null;apiToken='';apiPort=null;resources={cpu:null,rss:null};state='stopped';
     auth=await createDeviceAuth(data);deviceId=randomBytes(12).toString('hex');csrf=randomBytes(32).toString('hex');
     await fs.writeFile(path.join(data,'device-id'),deviceId,{mode:0o600});
     return reply(200,{ok:true});
    }finally{busy=false}
   }
   if(url.pathname==='/api/pair'&&req.method==='POST'){
    if(!fromSite)return reply(403,{error:'请在 masion.xyz/LTC 发起配对'});
    if(!req.headers['content-type']?.startsWith('application/json'))return reply(415,{error:'需要 JSON 请求'});
    let body='';for await(const b of req){body+=b;if(body.length>1024)throw Error('请求过大')}
    return reply(200,await auth.pair(JSON.parse(body).code));
   }
   if(url.pathname==='/api/health'&&req.method==='GET')return reply(200,{product:'MasionMiningHelper',version:'1.1',pairingRequired:fromSite});
   if(fromSite&&!auth.authorized(req.headers['x-device-token']))return reply(401,{error:'请先与当前电脑的助手配对'});
   if(req.method==='GET'&&url.pathname==='/api/status')return reply(200,{csrf,state,pid,uptime:guardian&&started?Math.floor((Date.now()-started)/1000):0,hashrate:snapshot?.hashrate?.total||[null,null,null],accepted:snapshot?.results?.shares_good??null,rejected:snapshot?.results?Math.max(0,snapshot.results.shares_total-snapshot.results.shares_good):null,sampleAt,resources,history,logs,lastExit,config:{...config,password:undefined,passwordSet:!!config.password},device:deviceInfo(deviceId),account:account.get()});
   if(req.method==='POST'&&['/api/start','/api/stop','/api/restart','/api/config','/api/account','/api/account/disconnect'].includes(url.pathname)){
    if(req.headers['x-csrf-token']!==csrf)return reply(403,{error:'会话验证失败，请刷新页面'});
    if(shutting||busy)return reply(409,{error:'操作处理中，请稍后重试'});
    busy=true;
    try{
     if(url.pathname==='/api/account'){
      if(!req.headers['content-type']?.startsWith('application/json'))return reply(415,{error:'需要 JSON 请求'});
      let body='';for await(const b of req){body+=b;if(body.length>4096)throw Error('配置过大')}
      await account.connect(JSON.parse(body));
     }else if(url.pathname==='/api/account/disconnect'){await account.disconnect()}
     else if(url.pathname==='/api/config'){
      if(guardian)return reply(409,{error:'请先停止矿工再修改配置'});
      if(!req.headers['content-type']?.startsWith('application/json'))return reply(415,{error:'需要 JSON 请求'});
      let body='';for await(const b of req){body+=b;if(body.length>4096)throw Error('配置过大')}
      const c=JSON.parse(body);const next=validate({...c,password:c.password===''?config.password:c.password});
      await fs.writeFile(path.join(data,'settings.tmp'),JSON.stringify(next),{mode:0o600});await fs.chmod(path.join(data,'settings.tmp'),0o600);await fs.rename(path.join(data,'settings.tmp'),path.join(data,'settings.json'));config=next;log('配置已保存，下次启动生效');
     } else if(url.pathname==='/api/start')await start();
     else if(url.pathname==='/api/stop')await stop();
     else{await stop();await start()}
     return reply(200,{ok:true});
    }finally{busy=false}
   }
   if(req.method==='GET'&&url.pathname==='/uninstall'){
    if(fromSite)return reply(403,{error:'请从本机助手下载卸载文件'});
    const file=process.platform==='win32'?'Masion-Uninstall-Windows.zip':'Masion-Uninstall-Mac.zip';
    res.writeHead(200,{...headers,'Content-Type':'application/octet-stream','Content-Disposition':`attachment; filename="${file}"`});
    return res.end(await fs.readFile(path.join(root,file)));
   }
   if(req.method==='GET'){
    const files={'/':'helper.html','/helper.js':'helper.js','/helper.css':'helper.css'};const file=files[url.pathname];
    if(file){let content=await fs.readFile(path.join(root,'public',file));res.writeHead(200,{...headers,'Content-Type':file.endsWith('.html')?'text/html; charset=utf-8':file.endsWith('.js')?'text/javascript; charset=utf-8':'text/css; charset=utf-8'});return res.end(content)}
   }
   reply(404,{error:'未找到'});
  }catch(e){reply(400,{error:e.code==='ENOENT'?'未找到 XMRig，请检查 XMRIG_PATH':mask(e.message)})}
 });
 async function shutdown(){if(shutting)return;shutting=true;clearInterval(interval);clearInterval(accountTimer);await stop();await fs.rm(lock,{force:true});server.close(()=>process.exit(0));setTimeout(()=>process.exit(0),2000).unref()}
 process.on('SIGINT',shutdown);process.on('SIGTERM',shutdown);
 server.on('error',async e=>{console.error(e.code==='EADDRINUSE'?'控制台端口已使用，请打开现有控制台或设置 PORT。':e.message);clearInterval(interval);await fs.rm(lock,{force:true});process.exit(1)});
 server.listen(port,'127.0.0.1',()=>{
  console.log(`控制台已启动：${origin}\n矿工默认停止；点击网页启动。`);
  console.log('打开本机助手页面查看配对码，再在 https://masion.xyz/LTC 配对当前电脑。');
 });
}
if(process.argv[1]&&await fs.realpath(process.argv[1]).catch(()=>null)===fileURLToPath(import.meta.url))main().catch(e=>{console.error(e.message);process.exit(1)});
