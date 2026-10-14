const $=id=>document.getElementById(id);
const navigation=[...document.querySelectorAll('aside a.nav')];
let scrollPending=false;
function activeNavigation(id){for(const link of navigation){const active=link.hash===`#${id}`;link.classList.toggle('active',active);if(active)link.setAttribute('aria-current','location');else link.removeAttribute('aria-current')}}
function scrollNavigation(){
 scrollPending=false;
 const marker=48;
 let id='overview';
 const targets=navigation.map(link=>document.getElementById(link.hash.slice(1))).filter(Boolean).sort((a,b)=>a.getBoundingClientRect().top-b.getBoundingClientRect().top);
 for(const target of targets)if(target.getBoundingClientRect().top<=marker)id=target.id;
 if(window.scrollY>0&&window.scrollY+window.innerHeight>=document.documentElement.scrollHeight-4)id=targets.at(-1)?.id||id;
 activeNavigation(id);
}
for(const link of navigation)link.addEventListener('click',()=>activeNavigation(link.hash.slice(1)));
window.addEventListener('hashchange',()=>{const id=location.hash.slice(1);if(navigation.some(link=>link.hash===location.hash))activeNavigation(id)});
window.addEventListener('scroll',()=>{if(!scrollPending){scrollPending=true;requestAnimationFrame(scrollNavigation)}},{passive:true});
window.addEventListener('resize',scrollNavigation);
if(navigation.some(link=>link.hash===location.hash))activeNavigation(location.hash.slice(1));
const remotePage=location.origin==='https://masion.xyz';
const storageKey='masion-local-device-v1';
let paired=null;try{paired=JSON.parse(localStorage.getItem(storageKey)||'null')}catch{}
let lastPairError='',pairBusy=false,connectionView=false;
let session, latest, working=false, formFilled=false, dirty=false, accountView=false;
const states={stopped:'已停止',starting:'正在初始化 / 连接',running:'运行中',stopping:'正在停止',error:'异常退出',reconnecting:'矿池重连中',unavailable:'监控暂不可用'};
function notice(text){$('notice').textContent=text;$('notice').hidden=!text}
function hash(v){return Number.isFinite(v)?v.toLocaleString('zh-CN',{maximumFractionDigits:1}):'—'}
function render(s){
 latest=s;session=s.csrf;
 if(!connectionView){$('web-pair').open=false;connectionView=true;}
 const a=s.account||{};
 if(!accountView){$('account-setup').open=!a.configured;accountView=true;}
 $('account-state').dataset.tone=a.connected?'good':a.configured?'warning':'idle';
 const amount=v=>typeof v==='string'?v:'—';
 $('mined').textContent=amount(a.minedUnpaid);$('balance').textContent=amount(a.balance);
 const stamp=a.updatedAt?new Date(a.updatedAt).toLocaleTimeString('zh-CN',{hour12:false}):null;
 $('mined-detail').textContent=a.connected?`LTC · 未提现挖矿所得 · ${stamp}`:a.updatedAt?`LTC · 上次同步 ${stamp} · 已过期`:'未提现挖矿所得 · 待连接账户';
 $('account-state').textContent=a.connected?'已同步':a.configured?'同步失败':'待连接';
 $('account-info').textContent=a.connected?`近 24 小时奖励 ${amount(a.past24h)} LTC · 累计已支付 ${amount(a.paid)} LTC。每 60 秒同步，为整个账户金额；提现设置请在官方后台查看。`:a.reason||'连接只读 API 后读取真实金额';
 $('api-key').disabled=working;$('api-secret').disabled=working;
 $('account-disconnect').disabled=working||!a.configured;$('account-save').disabled=working;

 $('connection').textContent='当前电脑已连接';$('connection').dataset.tone='good';$('assistant-state').dataset.tone='good';
 $('assistant-state').textContent='已连接';$('assistant-message').textContent=`当前设备：${s.device.name} · ${s.device.platform} / ${s.device.arch}。所有启动和停止都作用于这台电脑。`;
 $('device-name').textContent=s.device.name;$('device-icon').textContent=s.device.platform==='darwin'?'Mac':'PC';
 $('threads').max=Math.min(10,s.device.cores);$('thread-limit').textContent=`最多 ${$('threads').max} 线程`;

 $('state').textContent=states[s.state]||s.state;$('state').dataset.state=s.state;$('mining-threads').textContent=`${s.config.threads} 线程`;
 $('pool').textContent=s.config.pool;
 $('pool-meta').textContent=s.config.tls?'TLS 加密连接':'未启用 TLS 加密';
 $('device').textContent=`${s.device.cores} 核 CPU · ${Math.round(s.device.memory/2**30)} GB 内存 · RandomX`;
 ['hash10','hash60','hash15'].forEach((id,i)=>$(id).textContent=hash(s.hashrate[i]));
 $('accepted').textContent=s.accepted??'—';$('rejected').textContent=s.rejected??'—';
 const cpu=s.resources.cpu;const fraction=cpu===null?null:cpu/s.device.cores;
 $('cpu').textContent=fraction===null?'—':`${fraction.toFixed(1)}%`;
 $('cpu-detail').textContent=cpu===null?'等待进程统计':`系统进程口径 ${cpu.toFixed(1)}%（单核 100%）`;
 $('cpu-bar').style.width=`${Math.min(100,fraction||0)}%`;
 const mem=s.resources.rss;$('memory').textContent=mem===null?'—':`${(mem/2**30).toFixed(2)} GB`;
 $('mem-bar').style.width=`${Math.min(100,(mem||0)/s.device.memory*100)}%`;
 $('uptime').textContent=[Math.floor(s.uptime/3600),Math.floor(s.uptime/60)%60,s.uptime%60].map(n=>String(n).padStart(2,'0')).join(':');
 $('pid').textContent=s.pid?`进程 ${s.pid}`:'矿工尚未启动';
 const running=!!s.pid||['running','starting','stopping','reconnecting','unavailable'].includes(s.state);
 $('start').disabled=working||running;$('stop').disabled=working||!running;$('restart').disabled=working||!running;
 ['threads','pool-input','user','password','tls','save'].forEach(id=>$(id).disabled=working||running);
 if(!formFilled&&!dirty){$('threads').value=s.config.threads;$('thread-value').value=s.config.threads;$('pool-input').value=s.config.pool;$('user').value=s.config.user;$('tls').checked=s.config.tls;formFilled=true}
 const old=$('log').textContent,newLog=s.logs.map(l=>`${new Date(l.time).toLocaleTimeString('zh-CN',{hour12:false})}  ${l.text}`).join('\n')||'等待矿工启动…';
 if(old!==newLog){$('log').textContent=newLog;if($('autoscroll').checked)$('log').scrollTop=$('log').scrollHeight}
 const h=s.history.filter(p=>p.time>Date.now()-240000);$('chart-empty').hidden=h.length>1;
 if(h.length>1){const max=Math.max(...h.map(x=>x.value),1)*1.15;const now=Date.now();const pts=h.map(p=>[Math.max(0,(p.time-(now-240000))/240000*700),135-p.value/max*125]);const d=pts.map((p,i)=>`${i?'L':'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');$('line').setAttribute('d',d);$('area').setAttribute('d',`${d} L${pts.at(-1)[0]},140 L${pts[0][0]},140 Z`)}else{$('line').setAttribute('d','');$('area').setAttribute('d','')}
}
function freeze(message){
 session=null;latest=null;formFilled=false;connectionView=false;$('web-pair').open=true;
 $('connection').textContent='当前电脑未连接';$('connection').dataset.tone='idle';$('assistant-state').dataset.tone='idle';$('account-state').dataset.tone='idle';$('state').dataset.state='stopped';$('mining-threads').textContent='—';$('assistant-state').textContent='未连接';$('assistant-message').textContent=message;
 $('device-name').textContent='当前电脑未连接';$('device').textContent='先运行本地助手并配对';$('state').textContent='未连接';$('pid').textContent='没有连接设备';
 ['hash10','hash60','hash15','accepted','rejected','cpu','memory','mined','balance'].forEach(id=>$(id).textContent='—');
 $('mined-detail').textContent='未连接当前电脑';$('account-state').textContent='未连接';$('account-info').textContent='连接当前电脑后读取本地保存的账户设置。';
 $('uptime').textContent='00:00:00';$('log').textContent='未连接当前电脑，不读取其他设备的日志。';
 for(const e of document.querySelectorAll('#form input,#form button,#account-form input,#account-form button,.actions button'))e.disabled=true;
 $('line').setAttribute('d','');$('area').setAttribute('d','');$('chart-empty').hidden=false;
}
async function agentFetch(route,options={}){
 const url=remotePage?`http://127.0.0.1:4780/api/${route}`:new URL(`api/${route}`,document.baseURI).href;
 const headers={...options.headers};if(remotePage&&paired?.token)headers['X-Device-Token']=paired.token;
 return fetch(url,{...options,headers,credentials:'omit',signal:AbortSignal.timeout(15000)});
}
async function refresh(){
 if(pairBusy)return;
 if(remotePage&&!paired?.token){freeze(lastPairError||'运行本机助手，然后输入配对码。未配对时不会读取或控制任何矿工。');return}
 try{
  const r=await agentFetch('status');if(r.status===401){paired=null;localStorage.removeItem(storageKey);dirty=false;for(const id of ['api-key','api-secret','password','user','pool-input'])$(id).value='';lastPairError='配对已失效，请查看本机的新配对码并重新连接。';throw Error(lastPairError)}if(!r.ok)throw Error('助手暂不可用');
  const s=await r.json();
  if(remotePage&&paired?.deviceId&&paired.deviceId!==s.device.id)throw Error('设备身份不匹配，请重新配对当前电脑。');
  if(remotePage&&!paired.deviceId){paired.deviceId=s.device.id;localStorage.setItem(storageKey,JSON.stringify(paired))}
  render(s);
 }catch(e){freeze(e.message==='Failed to fetch'?'无法连接本机助手。请启动助手，并允许浏览器访问本地网络。':e.message)}
}
async function action(name,body){
 if(working)return;working=true;if(latest)render(latest);notice('');
 try{if(!session)throw Error('请先连接当前电脑');const r=await agentFetch(name,{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':session},body:JSON.stringify(body||{})});const d=await r.json();if(!r.ok)throw Error(d.error);if(name==='account'){$('api-key').value='';$('api-secret').value='';notice('已连接，LTC 收益每 60 秒自动同步。')}if(name==='config'){$('password').value='';dirty=false;formFilled=false;notice('配置已保存。下次启动使用新配置。')}}catch(e){notice(e.message)}finally{working=false;await refresh()}
}

['start','stop','restart'].forEach(id=>$(id).onclick=()=>action(id));
$('threads').oninput=()=>{$('thread-value').value=$('threads').value;dirty=true};
$('form').oninput=()=>dirty=true;
for(const link of document.querySelectorAll('a[href="#account-connect"]'))link.addEventListener('click',()=>{$('account-setup').open=true});
$('form').onsubmit=e=>{e.preventDefault();action('config',{threads:Number($('threads').value),pool:$('pool-input').value.trim(),user:$('user').value.trim(),password:$('password').value,tls:$('tls').checked})};
await refresh();setInterval(refresh,2000);

$('account-form').onsubmit=e=>{e.preventDefault();action('account',{key:$('api-key').value,secret:$('api-secret').value})};
$('account-disconnect').onclick=()=>action('account/disconnect');

$('pair-form').onsubmit=async e=>{
 e.preventDefault();pairBusy=true;lastPairError='';$('pair-submit').disabled=true;$('assistant-message').textContent='正在连接本机助手；如果浏览器询问访问本地网络或本机应用，请选择允许。';
 try{
  const r=await agentFetch('pair',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code:$('pair-code').value.trim()})});
  const d=await r.json();if(!r.ok)throw Error(d.error);
  paired={token:d.token};localStorage.setItem(storageKey,JSON.stringify(paired));$('pair-code').value='';pairBusy=false;await refresh();
 }catch(e){console.error('本机助手配对失败：',e.message);lastPairError=e.message==='Failed to fetch'?'网页被阻止连接本机助手：请在地址栏左侧的站点设置中允许“本地网络”或“本机应用”访问，再点击配对。也可点击“检查助手连接”。':e.name==='TimeoutError'?'等待连接超时：请允许浏览器的本地网络访问后重试。':e.message;freeze(lastPairError)}finally{pairBusy=false;$('pair-submit').disabled=false}
};
$('forget-device').onclick=()=>{paired=null;localStorage.removeItem(storageKey);freeze('浏览器配对已取消。已运行的矿工不会停止，请在本机助手停止。')};

$('check-helper').onclick=async()=>{
 if(pairBusy)return;pairBusy=true;$('check-helper').disabled=true;lastPairError='';
 $('assistant-message').textContent='正在检查本机助手，请留意浏览器权限提示…';
 try{const r=await agentFetch('health');const d=await r.json();if(!(r.ok&&d.product==='MasionMiningHelper')&&!(r.status===401&&d.error==='请先与当前电脑的助手配对'))throw Error('当前端口不是挖矿助手');lastPairError='本机助手可以连接。请使用本机页面最新的配对码，点击“配对当前电脑”。'}
 catch(e){console.error('本机助手连接检查失败：',e.message);lastPairError='无法从网页访问助手。先确认本机页面能打开，再在地址栏左侧的站点设置中允许“本地网络”或“本机应用”访问。'}
 finally{pairBusy=false;$('check-helper').disabled=false;if(!paired?.token)freeze(lastPairError);else await refresh()}
};
