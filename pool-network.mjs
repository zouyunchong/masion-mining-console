import net from 'node:net';
export function publicIPv4(ip){
 if(!/^\d+\.\d+\.\d+\.\d+$/.test(ip))return false;
 const [a,b,...rest]=ip.split('.').map(Number);if([a,b,...rest].some(x=>x>255))return false;
 return a!==0&&a!==10&&a!==127&&a<224&&!(a===169&&b===254)&&!(a===172&&b>=16&&b<=31)&&!(a===192&&b===168)&&!(a===100&&b>=64&&b<=127)&&!(a===198&&(b===18||b===19));
}
export async function resolvePool(host){
 const r=await fetch(`https://dns.google/resolve?name=${encodeURIComponent(host)}&type=A`,{signal:AbortSignal.timeout(6000),redirect:'error'});
 if(!r.ok)throw Error('加密 DNS 服务不可用');
 const j=await r.json();const ips=[...new Set((j.Answer||[]).filter(x=>x.type===1&&publicIPv4(x.data)).map(x=>x.data))];
 if(j.Status!==0||!ips.length)throw Error('矿池地址解析失败');return ips;
}
// A scoped loopback SOCKS endpoint only resolves the configured mining host.
// It forwards raw TCP: TLS stays inside XMRig, unchanged end to end.
export async function createPoolNetwork(host,port,log=()=>{},resolver=resolvePool){
 let sockets=new Set(),closing=false;
 const server=net.createServer(client=>{
  sockets.add(client);client.on('close',()=>sockets.delete(client));client.on('error',()=>{});client.setTimeout(15000,()=>client.destroy());
  let buf=Buffer.alloc(0),phase='hello';
  const reject=()=>{client.end(Buffer.from([5,2,0,1,0,0,0,0,0,0]))};
  const onData=async data=>{
   buf=Buffer.concat([buf,data]);if(buf.length>4096)return client.destroy();
   if(phase==='hello'){
    if(buf.length<2)return;const len=2+buf[1];if(buf.length<len)return;
    if(buf[0]!==5||!buf.subarray(2,len).includes(0))return client.end(Buffer.from([5,255]));
    buf=buf.subarray(len);phase='request';client.write(Buffer.from([5,0]));
   }
   if(phase==='request'){
    if(buf.length<5)return;if(buf[0]!==5||buf[1]!==1||buf[3]!==3)return reject();
    const len=7+buf[4];if(buf.length<len)return;
    const requested=buf.subarray(5,5+buf[4]).toString();const wantedPort=buf.readUInt16BE(len-2);
    if(requested!==host||wantedPort!==port)return reject();
    const remaining=buf.subarray(len);buf=Buffer.alloc(0);phase='connecting';client.pause();client.removeListener('data',onData);
    try{
     const ips=await resolver(host);if(closing||client.destroyed)return;
     let upstream;
     for(const ip of ips){
      try{upstream=await new Promise((resolve,reject)=>{
       const s=net.createConnection({host:ip,port});sockets.add(s);s.once('close',()=>sockets.delete(s));s.on('error',()=>{});
       const timeout=setTimeout(()=>s.destroy(new Error('连接超时')),6000);
       s.once('error',e=>{clearTimeout(timeout);reject(e)});s.once('connect',()=>{clearTimeout(timeout);resolve(s)});
      });log(`矿池加密 DNS 解析：${host} → ${ip}，TLS 保持开启`);break}catch{}
     }
     if(!upstream)throw Error('矿池网络连接失败');
     if(closing||client.destroyed){upstream.destroy();return}
     client.setTimeout(0);client.once('close',()=>upstream.destroy());upstream.once('close',()=>client.destroy());upstream.on('error',()=>client.destroy());
     client.write(Buffer.from([5,0,0,1,127,0,0,1,0,0]));if(remaining.length)upstream.write(remaining);
     client.pipe(upstream);upstream.pipe(client);client.resume();
    }catch(e){log(`矿池连接失败：${e.message}`);reject()}
   }
  };
  client.on('data',data=>{onData(data).catch(()=>client.destroy())});
 });
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve)});
 return {address:`127.0.0.1:${server.address().port}`,close:()=>{closing=true;for(const s of sockets)s.destroy();return new Promise(r=>server.close(r))}};
}
