import {randomBytes,timingSafeEqual} from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
export const SITE_ORIGIN='https://masion.xyz';
export const sameSecret=(a,b)=>{const x=Buffer.from(String(a||'')),y=Buffer.from(String(b||''));return !!y.length&&x.length===y.length&&timingSafeEqual(x,y)};
export async function createDeviceAuth(dir){
 const file=path.join(dir,'device-token');
 let token;
 try{token=await fs.readFile(file,'utf8');if(!/^[a-f0-9]{64}$/.test(token))throw Error('配对令牌格式无效')}catch(e){if(e.code!=='ENOENT')throw e;token=randomBytes(32).toString('hex');await fs.writeFile(file,token,{mode:0o600})}
 let code,expires,failures=0,blockedUntil=0;
 async function rotate(){code=randomBytes(6).toString('hex').toUpperCase();expires=Date.now()+10*60000;await fs.writeFile(path.join(dir,'pair-code.json'),JSON.stringify({code,expires}),{mode:0o600})}
 await rotate();
 return {
  authorized:v=>sameSecret(v,token),
  localCode:async()=>{if(Date.now()>expires)await rotate();return {code,expires}},
  newCode:async()=>{await rotate();return {code,expires}},
  pair:async value=>{
   if(Date.now()<blockedUntil)throw Error('尝试过于频繁，请稍后重试');
   if(Date.now()>expires||!sameSecret(String(value||'').toUpperCase(),code)){
    failures++;if(failures>=5){blockedUntil=Date.now()+60000;failures=0}throw Error('配对码无效或已过期，请在本机助手查看新配对码');
   }
   failures=0;await rotate();return {token};
  },
  revoke:async()=>{token=randomBytes(32).toString('hex');await fs.writeFile(file,token,{mode:0o600});await rotate()}
 };
}
