// An IPC guardian stops the miner even when the web server is killed abruptly.
import {spawn} from 'node:child_process';
import fs from 'node:fs/promises';
let miner, stopping=false;
const send = x => { if(process.connected) process.send(x); };
function stop(){
  if(stopping) return;
  stopping=true;
  if(!miner) return process.exit(0);
  miner.kill('SIGINT');
  const timer=setTimeout(()=>miner.kill('SIGKILL'),5000);
  timer.unref();
}
process.on('message', m=>{
  if(m.type==='start' && !miner){
    miner=spawn(m.binary,['--config',m.config],{stdio:['ignore','pipe','pipe'],shell:false,windowsHide:true});
    miner.on('spawn',()=>send({type:'pid',pid:miner.pid}));
    for(const stream of [miner.stdout,miner.stderr]) stream.on('data',b=>send({type:'log',text:b.toString()}));
    miner.on('error',()=>send({type:'log',text:'矿工无法启动：请检查文件权限与路径。\n'}));
    miner.on('close',async(code,signal)=>{await fs.rm(m.config,{force:true}).catch(()=>{});send({type:'exit',code,signal});process.exit(0)});
  } else if(m.type==='stop') stop();
});
process.on('disconnect',stop);
process.on('SIGTERM',stop);
process.on('SIGINT',stop);
