import {createHash,createHmac} from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
export function sign(endpoint,timestamp,secret){
 return createHmac('sha256',secret).update(['GET',endpoint,'',timestamp,createHash('sha256').update('').digest('hex')].join('\n')).digest('hex');
}
export function parseStats(payload){
 const d=payload?.data;
 const amount=v=>typeof v==='string'&&/^\d+(\.\d+)?$/.test(v)?v:null;
 if(payload?.success!==true||d?.coin!=='LTC'||amount(d.balance_mining)===null||amount(d.balance)===null)throw Error('矿池返回的数据格式不符合官方接口，未显示金额');
 return {minedUnpaid:amount(d.balance_mining),balance:amount(d.balance),paid:amount(d.paid),past24h:amount(d.rewarded?.past_24h)};
}
export function createAccount(dir){
 let generation=0,credentials=null,busy=false,account={connected:false,configured:false,reason:'连接只读 API 后显示真实 LTC 金额'};
 const file=path.join(dir,'unmineable.json');
 async function request(c){
  const endpoint='/v1/assets/LTC/stats',timestamp=String(Date.now());
  const r=await fetch('https://api.unmineable.dev'+endpoint,{method:'GET',redirect:'error',headers:{'x-user-api-key':c.key,'x-user-api-timestamp':timestamp,'x-user-api-signature':sign(endpoint,timestamp,c.secret)},signal:AbortSignal.timeout(8000)});
  if(!r.ok)throw Error(r.status===401?'API 凭证无效或已过期':r.status===403?'API 权限或 IP 白名单不允许读取':`矿池暂不可用（HTTP ${r.status}）`);
  return parseStats(await r.json());
 }
 async function refresh(){
  if(!credentials||busy)return;busy=true;const active=generation;
  try{const stats=await request(credentials);if(active===generation)account={connected:true,configured:true,...stats,updatedAt:Date.now(),reason:null}}catch(e){if(active===generation)account={...account,connected:false,configured:true,reason:e.message}}finally{busy=false}
 }
 return {
  get:()=>({...account}),
  init:async()=>{try{credentials=JSON.parse(await fs.readFile(file,'utf8'));account.configured=true;await refresh()}catch(e){if(e.code!=='ENOENT')account.reason='账户配置不可读取，请重新连接'}},
  refresh,
  connect:async c=>{
   if(busy)throw Error('账户正在同步，请稍后重试');
   if(typeof c?.key!=='string'||typeof c?.secret!=='string'||!c.key.trim()||!c.secret.trim()||c.key.length>512||c.secret.length>512||/[\r\n]/.test(c.key+c.secret))throw Error('请填写有效的 API Key 和 Secret');
   busy=true;
   try{
    const next={key:c.key.trim(),secret:c.secret.trim()},stats=await request(next);
    await fs.writeFile(file+'.tmp',JSON.stringify(next),{mode:0o600});await fs.chmod(file+'.tmp',0o600);await fs.rename(file+'.tmp',file);
    credentials=next;account={connected:true,configured:true,...stats,updatedAt:Date.now(),reason:null};
   }finally{busy=false}
  },
  disconnect:async()=>{generation++;credentials=null;await fs.rm(file,{force:true});await fs.rm(file+'.tmp',{force:true});account={connected:false,configured:false,reason:'连接只读 API 后显示真实 LTC 金额'}}
 };
}
