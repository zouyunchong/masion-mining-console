import assert from 'node:assert/strict';
if(process.env.TEST_REAL_MINER!=='1')throw Error('请设置 TEST_REAL_MINER=1');
const base=process.env.CONSOLE_URL||'http://127.0.0.1:4780';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const status=async()=>{const r=await fetch(base+'/api/status');assert.equal(r.status,200);return r.json()};
const initial=await status();assert.equal(initial.pid,null,'请先停止矿工');
const post=(route,body={},headers={})=>fetch(base+'/api/'+route,{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':initial.csrf,...headers},body:JSON.stringify(body)});
try{
 assert.equal((await post('start',{}, {'X-CSRF-Token':''})).status,403);
 assert.equal((await post('start',{}, {Origin:'https://example.com'})).status,403);
 assert.equal((await post('config',{...initial.config,threads:99,password:''})).status,400);
 assert.equal((await post('config',{...initial.config,password:''})).status,200);
 const attempts=await Promise.all([post('start'),post('start')]);assert.equal(attempts.filter(r=>r.status===200).length,1);
 let first;for(let i=0;i<45;i++){first=await status();if(first.pid&&first.hashrate[0]>0)break;await sleep(1000)}
 assert.ok(first.pid);assert.ok(first.hashrate[0]>0,'矿工应产生实际算力');assert.equal(first.config.threads,4);assert.ok(!('password' in first.config));
 assert.equal((await post('config',{...initial.config,password:''})).status,409);
 assert.equal((await post('restart')).status,200);
 let next;for(let i=0;i<20;i++){next=await status();if(next.pid)break;await sleep(500)}
 assert.ok(next.pid);assert.notEqual(next.pid,first.pid);
 console.log('通过：真实算力、并发启动拦截、重启、配置保护、密码隐藏、跨站请求保护。');
}finally{assert.equal((await post('stop')).status,200);const final=await status();assert.equal(final.pid,null);assert.equal(final.state,'stopped');console.log('通过：矿工已正常停止。')}
