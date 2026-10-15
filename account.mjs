import {createHash,createHmac} from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {collectRewards,dateRange} from './rewards.mjs';
export function sign(endpoint,timestamp,secret,query=''){
 return createHmac('sha256',secret).update(['GET',endpoint,query,timestamp,createHash('sha256').update('').digest('hex')].join('\n')).digest('hex');
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
 const rewardCache=new Map();let rewardRequest=null;
 async function request(c,endpoint='/v1/assets/LTC/stats',query='',signal){
  const timestamp=String(Date.now());
  const timeout=AbortSignal.timeout(8000);
  const r=await fetch('https://api.unmineable.dev'+endpoint+(query?'?'+query:''),{method:'GET',redirect:'error',headers:{'x-user-api-key':c.key,'x-user-api-timestamp':timestamp,'x-user-api-signature':sign(endpoint,timestamp,c.secret,query)},signal:signal?AbortSignal.any([signal,timeout]):timeout});
  if(!r.ok)throw Error(r.status===401?'API 凭证无效或已过期':r.status===403?'API 权限或 IP 白名单不允许读取':`矿池暂不可用（HTTP ${r.status}）`);
  const payload=await r.json();
  return endpoint==='/v1/assets/LTC/stats'?parseStats(payload):payload;
 }
 async function refresh(){
  if(!credentials||busy)return;busy=true;const active=generation;
  try{const stats=await request(credentials);if(active===generation)account={connected:true,configured:true,...stats,updatedAt:Date.now(),reason:null}}catch(e){if(active===generation)account={...account,connected:false,configured:true,reason:e.message}}finally{busy=false}
 }
 return {
  get:()=>({...account,revision:generation}),
  init:async()=>{try{credentials=JSON.parse(await fs.readFile(file,'utf8'));account.configured=true;await refresh()}catch(e){if(e.code!=='ENOENT')account.reason='账户配置不可读取，请重新连接'}},
  refresh,
  rewards:async selection=>{
   dateRange(selection);
   if(!credentials)throw Error('请先连接只读矿池账户，再查询收益');
   const key=JSON.stringify([selection.from,selection.to,selection.timeZone]);
   const cached=rewardCache.get(key);
   if(cached&&Date.now()-cached.syncedAt<60000)return cached;
   if(rewardRequest){if(rewardRequest.key===key)return rewardRequest.promise;throw Error('收益查询正在进行，请稍后重试')}
   const active=generation,c=credentials,signal=AbortSignal.timeout(45000);
   const pending={key,promise:null};
   pending.promise=(async()=>{
    try{
     const result=await collectRewards(async page=>{
      if(active!==generation)throw Error('账户已变更，请重新查询');
      return request(c,'/v1/dashboard/events',new URLSearchParams({page:String(page),type:'reward',dir:'desc'}).toString(),signal);
     },selection);
     if(active!==generation)throw Error('账户已变更，请重新查询');
     if(rewardCache.size>=10)rewardCache.delete(rewardCache.keys().next().value);
     rewardCache.set(key,result);return result;
    }catch(e){if(e.name==='TimeoutError'||e.name==='AbortError')throw Error('矿池查询超时，请稍后重试或缩小日期范围');throw e}
    finally{if(rewardRequest===pending)rewardRequest=null}
   })();
   rewardRequest=pending;return pending.promise;
  },
  connect:async c=>{
   if(busy)throw Error('账户正在同步，请稍后重试');
   if(typeof c?.key!=='string'||typeof c?.secret!=='string'||!c.key.trim()||!c.secret.trim()||c.key.length>512||c.secret.length>512||/[\r\n]/.test(c.key+c.secret))throw Error('请填写有效的 API Key 和 Secret');
   busy=true;
   try{
    const next={key:c.key.trim(),secret:c.secret.trim()},stats=await request(next);
    await fs.writeFile(file+'.tmp',JSON.stringify(next),{mode:0o600});await fs.chmod(file+'.tmp',0o600);await fs.rename(file+'.tmp',file);
    generation++;rewardCache.clear();rewardRequest=null;
    credentials=next;account={connected:true,configured:true,...stats,updatedAt:Date.now(),reason:null};
   }finally{busy=false}
  },
  disconnect:async()=>{generation++;rewardCache.clear();rewardRequest=null;credentials=null;await fs.rm(file,{force:true});await fs.rm(file+'.tmp',{force:true});account={connected:false,configured:false,reason:'连接只读 API 后显示真实 LTC 金额'}}
 };
}
