import os from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const exec=promisify(execFile);
export async function otherMiners(){
 if(process.platform==='win32'){
  const {stdout}=await exec('tasklist.exe',['/FI','IMAGENAME eq xmrig.exe','/FO','CSV','/NH']);
  return [...stdout.matchAll(/"xmrig\.exe","(\d+)"/gi)].map(m=>Number(m[1]));
 }
 try{return (await exec(process.platform==='darwin'?'/usr/bin/pgrep':'pgrep',['-x','xmrig'])).stdout.trim().split(/\s+/).filter(Boolean).map(Number)}catch(e){if(e.code===1)return [];throw e}
}
let previous=null;
export async function minerResources(pid){
 if(process.platform==='win32'){
  if(!Number.isInteger(pid)||pid<1)throw Error('Invalid PID');
  const code=`$p=Get-CimInstance Win32_Process -Filter 'ProcessId=${pid}';if($null -eq $p){exit 1};@{ticks=([double]$p.KernelModeTime+[double]$p.UserModeTime);rss=[double]$p.WorkingSetSize}|ConvertTo-Json -Compress`;
  const {stdout}=await exec('powershell.exe',['-NoProfile','-NonInteractive','-Command',code],{timeout:5000,windowsHide:true});
  const r=JSON.parse(stdout),now=Date.now(),cpu=previous?.pid===pid?(r.ticks-previous.ticks)/10000/(now-previous.time)*100:null;
  previous={pid,ticks:r.ticks,time:now};return {cpu:cpu===null?null:Math.max(0,cpu),rss:r.rss};
 }
 const a=(await exec(process.platform==='darwin'?'/bin/ps':'ps',['-p',String(pid),'-o','%cpu=,rss='])).stdout.trim().split(/\s+/).map(Number);
 return {cpu:Number.isFinite(a[0])?a[0]:null,rss:a[1]?a[1]*1024:null};
}
export function deviceInfo(id){
 const cpu=os.cpus()[0]?.model||'CPU';
 return {id,name:os.hostname(),model:process.platform==='darwin'?`Mac · ${cpu}`:`Windows · ${cpu}`,platform:process.platform,arch:process.arch,cores:os.cpus().length,memory:os.totalmem()};
}
