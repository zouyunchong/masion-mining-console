const $=id=>document.getElementById(id);
const navigation=[...document.querySelectorAll('aside a.nav')];
const sections=navigation.map(link=>$(link.hash.slice(1)));
let navigationFrame=0;
function prepareAnchor(id){
 if(id==='account-connect')$('account-setup').open=true;
 if(id==='assistant-connect')$('web-pair').open=true;
 if(id==='settings')$('mining-setup').open=true;
 if(id==='journal')$('journal').open=true;
}
function jumpToAnchor(){
 const id=location.hash.slice(1),target=$(id);
 if(!target)return;
 prepareAnchor(id);
 target.focus({preventScroll:true});
 target.scrollIntoView({block:'start'});
 queueNavigation();
}
function updateNavigation(){
 navigationFrame=0;
 const offset=Math.max(120,parseFloat(getComputedStyle(sections[0]).scrollMarginTop)+24);
 let active=sections[0];
 for(const section of sections){if(section.getBoundingClientRect().top<=offset)active=section}
 if(window.scrollY>0&&window.innerHeight+window.scrollY>=document.documentElement.scrollHeight-2)active=sections.at(-1);
 for(const link of navigation){
  const selected=link.hash===`#${active.id}`;
  link.classList.toggle('active',selected);
  if(selected)link.setAttribute('aria-current','location');else link.removeAttribute('aria-current');
 }
 maybeLoadRewards();
}
function queueNavigation(){if(!navigationFrame)navigationFrame=requestAnimationFrame(updateNavigation)}
window.addEventListener('scroll',queueNavigation,{passive:true});
window.addEventListener('resize',queueNavigation);
window.addEventListener('hashchange',jumpToAnchor);
document.addEventListener('toggle',queueNavigation,true);
document.addEventListener('click',event=>{
 const link=event.target.closest('a[href^="#"]');
 if(!link||event.defaultPrevented||event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;
 prepareAnchor(link.hash.slice(1));
 if(link.hash===location.hash){event.preventDefault();jumpToAnchor()}
});
const remotePage=location.origin==='https://masion.xyz';
const storageKey='masion-local-device-v1';
let paired=null;try{paired=JSON.parse(localStorage.getItem(storageKey)||'null')}catch{}
let lastPairError='',pairBusy=false,connectionView=false;
let session, latest, working=false, formFilled=false, dirty=false, accountView=false;
let pairEditing=false,accountEditing=false,accountIdentity=null;
const states={stopped:'已停止',starting:'正在初始化 / 连接',running:'运行中',stopping:'正在停止',error:'异常退出',reconnecting:'矿池重连中',unavailable:'监控暂不可用'};
function notice(text){$('notice').textContent=text;$('notice').hidden=!text}
function hash(v){return Number.isFinite(v)?v.toLocaleString('zh-CN',{maximumFractionDigits:1}):'—'}
function setupFeedback(kind,text=''){$(`${kind}-feedback`).textContent=text;$(`${kind}-feedback`).hidden=!text}
function renderConnections(s){
 const online=!!s,saved=!!paired?.token,hasPair=online||saved;
 $('pair-status').hidden=!hasPair;
 $('pair-status').dataset.tone=online?'good':'warning';
 $('pair-status-icon').textContent=online?'✓':'!';
 $('pair-status-title').textContent=online?(saved||remotePage?'当前浏览器已配对':'本机助手已连接'):'已保存配对，助手未连接';
 $('pair-status-detail').textContent=online?`${s.device.name} · 无需再次填写配对码。下次打开网页会自动连接。`:'此浏览器仍保留配对信息。请先启动本机助手，连接恢复后会自动验证，无需急着重新配对。';
 $('assistant-state').textContent=online?(saved||remotePage?'已配对 · 在线':'已连接'):saved?'已保存配对 · 离线':'未配对';
 $('assistant-state').dataset.tone=online?'good':saved?'warning':'idle';
 $('pair-form').hidden=hasPair&&!pairEditing;
 $('pair-instructions').hidden=hasPair&&!pairEditing;
 $('pair-instructions').textContent=hasPair?'需要重新配对时，填写本机助手的最新配对码。':'在本机助手复制配对码，填入下方。每个浏览器只需配对一次。';
 $('pair-edit').hidden=!hasPair||pairEditing;
 $('pair-edit').setAttribute('aria-expanded',String(pairEditing));
 $('pair-cancel').hidden=!hasPair||!pairEditing;
 $('forget-device').hidden=!saved;
 for(const id of ['pair-code','pair-submit','pair-edit','pair-cancel','forget-device','check-helper'])$(id).disabled=pairBusy;
 const a=s?.account,configured=!!a?.configured;
 const tone=a?.connected?'good':configured?'warning':'idle';
 $('account-connection-state').dataset.tone=tone;
 $('account-connection-state').textContent=a?.connected?'已连接':configured?'凭证已保存':online?'未连接':'等待设备';
 $('account-connection').hidden=online&&!configured;
 $('account-connection').dataset.tone=tone;
 $('account-connection-icon').textContent=a?.connected?'✓':configured?'!':'…';
 $('account-connection-title').textContent=a?.connected?'收益账户已连接':configured?'凭证已保存，暂未同步成功':'连接设备后确认账户状态';
 $('account-connection-detail').textContent=a?.connected?'只读 API 凭证已保存在当前电脑，无需重复填写。出于安全考虑，密钥不会回显。':configured?`无需重复填写凭证，助手会自动重试。${a.reason||'暂时无法获取矿池数据。'}`:'当前无法读取本机账户设置。请先恢复助手连接，已保存的凭证不会因此被删除。';
 $('account-manage').hidden=!configured||accountEditing;
 $('account-form').hidden=!online||(configured&&!accountEditing);
 $('account-edit').setAttribute('aria-expanded',String(accountEditing));
 $('account-cancel').hidden=!configured;
 $('account-save').textContent=configured?'更新并同步':'连接并同步';
 $('account-message').textContent=configured?'填写新的只读 Key 和 Secret，验证成功后才会替换原凭证。取消修改会继续使用原账户。':'请在 unMineable 创建 read（只读）凭证。凭证仅保存在当前电脑，不会回显。';
 for(const id of ['api-key','api-secret','account-save','account-edit','account-cancel','account-disconnect'])$(id).disabled=working||!online;
 $('account-disconnect').disabled=working||!configured;
}
function render(s){
 if(latest&&(latest.device.id!==s.device.id||latest.account?.revision!==s.account?.revision||latest.account?.configured!==s.account?.configured))resetRewards();
 latest=s;session=s.csrf;
 $('connection-prompt').hidden=true;
 if(!connectionView){$('web-pair').open=location.hash==='#assistant-connect';connectionView=true;}
 const a=s.account||{};
 const identity=JSON.stringify([s.device.id,a.revision,a.configured]);
 if(accountIdentity!==null&&identity!==accountIdentity){accountEditing=false;$('api-key').value='';$('api-secret').value='';setupFeedback('account')}
 accountIdentity=identity;
 if(!accountView){$('account-setup').open=!a.configured||location.hash==='#account-connect';accountView=true;}
 $('account-state').dataset.tone=a.connected?'good':a.configured?'warning':'idle';
 const amount=v=>typeof v==='string'?v:'—';
 $('mined').textContent=amount(a.minedUnpaid);$('balance').textContent=amount(a.balance);
 const stamp=a.updatedAt?new Date(a.updatedAt).toLocaleTimeString('zh-CN',{hour12:false}):null;
 $('mined-detail').textContent=a.connected?`LTC · 未提现挖矿所得 · ${stamp}`:a.updatedAt?`LTC · 上次同步 ${stamp} · 已过期`:'未提现挖矿所得 · 待连接账户';
 $('account-state').textContent=a.connected?'已同步':a.configured?'同步失败':'待连接';
 $('account-info').textContent=a.connected?`近 24 小时奖励 ${amount(a.past24h)} LTC · 累计已支付 ${amount(a.paid)} LTC。每 60 秒同步，为整个账户金额；提现设置请在官方后台查看。`:a.reason||'连接只读 API 后读取真实金额';
 $('connection').textContent='当前电脑已连接';$('connection').dataset.tone='good';$('assistant-state').dataset.tone='good';
 $('assistant-message').textContent=`当前设备：${s.device.name} · ${s.device.platform} / ${s.device.arch}。所有启动和停止都作用于这台电脑。`;
 renderConnections(s);
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
 if(latest||rewardLoading||rewardHasResult)resetRewards();
 $('connection-prompt').hidden=false;
 $('cpu-bar').style.width='0%';$('mem-bar').style.width='0%';$('cpu-detail').textContent='等待连接当前电脑';
 session=null;latest=null;formFilled=false;connectionView=false;$('web-pair').open=true;
 $('connection').textContent='当前电脑未连接';$('connection').dataset.tone='idle';$('assistant-state').dataset.tone='idle';$('account-state').dataset.tone='idle';$('state').dataset.state='stopped';$('mining-threads').textContent='—';$('assistant-state').textContent='未连接';$('assistant-message').textContent=message;
 $('device-name').textContent='当前电脑未连接';$('device').textContent='先运行本地助手并配对';$('state').textContent='未连接';$('pid').textContent='没有连接设备';
 ['hash10','hash60','hash15','accepted','rejected','cpu','memory','mined','balance'].forEach(id=>$(id).textContent='—');
 $('mined-detail').textContent='未连接当前电脑';$('account-state').textContent='未连接';$('account-info').textContent='连接当前电脑后读取本地保存的账户设置。';
 $('uptime').textContent='00:00:00';$('log').textContent='未连接当前电脑，不读取其他设备的日志。';
 for(const e of document.querySelectorAll('#form input,#form button,#account-form input,#account-form button,.actions button'))e.disabled=true;
 renderConnections(null);
 $('line').setAttribute('d','');$('area').setAttribute('d','');$('chart-empty').hidden=false;
}
async function agentFetch(route,options={}){
 const {timeout=15000,...requestOptions}=options;
 const url=remotePage?`http://127.0.0.1:4780/api/${route}`:new URL(`api/${route}`,document.baseURI).href;
 const headers={...options.headers};if(remotePage&&paired?.token)headers['X-Device-Token']=paired.token;
 return fetch(url,{...requestOptions,headers,credentials:'omit',signal:AbortSignal.timeout(timeout)});
}
async function refresh(){
 if(pairBusy)return;
 if(remotePage&&!paired?.token){freeze(lastPairError||'运行本机助手，然后输入配对码。未配对时不会读取或控制任何矿工。');return}
 const requestedPair=paired;
 try{
  const r=await agentFetch('status');if(pairBusy||(remotePage&&paired!==requestedPair))return;
  if(r.status===401){paired=null;localStorage.removeItem(storageKey);dirty=false;pairEditing=false;accountEditing=false;for(const id of ['api-key','api-secret','password','user','pool-input'])$(id).value='';lastPairError='配对已失效，请查看本机的新配对码并重新连接。';throw Error(lastPairError)}if(!r.ok)throw Error('助手暂不可用');
  const s=await r.json();
  if(remotePage&&paired?.deviceId&&paired.deviceId!==s.device.id)throw Error('设备身份不匹配，请重新配对当前电脑。');
  if(remotePage&&!paired.deviceId){paired.deviceId=s.device.id;localStorage.setItem(storageKey,JSON.stringify(paired))}
  render(s);maybeLoadRewards();
 }catch(e){freeze(e.message==='Failed to fetch'?'无法连接本机助手。请启动助手，并允许浏览器访问本地网络。':e.message)}
}
async function action(name,body){
 if(working)return;working=true;if(name==='account'||name==='account/disconnect')resetRewards();if(latest)render(latest);notice('');
 if(name.startsWith('account'))setupFeedback('account');
 try{if(!session)throw Error('请先连接当前电脑');const r=await agentFetch(name,{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':session},body:JSON.stringify(body||{})});const d=await r.json();if(!r.ok)throw Error(d.error);if(name==='account'||name==='account/disconnect'){accountEditing=false;$('api-key').value='';$('api-secret').value='';notice(name==='account'?'已连接，LTC 收益每 60 秒自动同步。':'收益账户已断开。')}if(name==='config'){$('password').value='';dirty=false;formFilled=false;notice('配置已保存。下次启动使用新配置。')}}catch(e){notice(e.message);if(name==='account')setupFeedback('account',e.message)}finally{working=false;await refresh()}
}

['start','stop','restart'].forEach(id=>$(id).onclick=()=>action(id));
$('threads').oninput=()=>{$('thread-value').value=$('threads').value;dirty=true};
$('form').oninput=()=>dirty=true;
for(const link of document.querySelectorAll('a[href="#account-connect"]'))link.addEventListener('click',()=>{$('account-setup').open=true});
$('form').onsubmit=e=>{e.preventDefault();action('config',{threads:Number($('threads').value),pool:$('pool-input').value.trim(),user:$('user').value.trim(),password:$('password').value,tls:$('tls').checked})};


$('account-form').onsubmit=e=>{e.preventDefault();action('account',{key:$('api-key').value,secret:$('api-secret').value})};
$('account-disconnect').onclick=()=>action('account/disconnect');
$('account-edit').onclick=()=>{accountEditing=true;setupFeedback('account');renderConnections(latest);$('api-key').focus()};
$('account-cancel').onclick=()=>{accountEditing=false;$('api-key').value='';$('api-secret').value='';setupFeedback('account');notice('');renderConnections(latest);$('account-edit').focus()};
$('pair-edit').onclick=()=>{pairEditing=true;setupFeedback('pair');renderConnections(latest);$('pair-code').focus()};
$('pair-cancel').onclick=()=>{pairEditing=false;$('pair-code').value='';setupFeedback('pair');renderConnections(latest);$('pair-edit').focus()};

$('pair-form').onsubmit=async e=>{
 e.preventDefault();pairBusy=true;lastPairError='';setupFeedback('pair');renderConnections(latest);$('assistant-message').textContent='正在连接本机助手；如果浏览器询问访问本地网络或本机应用，请选择允许。';
 try{
  const r=await agentFetch('pair',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code:$('pair-code').value.trim()})});
  const d=await r.json();if(!r.ok)throw Error(d.error);
  paired={token:d.token};localStorage.setItem(storageKey,JSON.stringify(paired));$('pair-code').value='';pairEditing=false;pairBusy=false;await refresh();
 }catch(e){console.error('本机助手配对失败：',e.message);lastPairError=e.message==='Failed to fetch'?'网页被阻止连接本机助手：请在地址栏左侧的站点设置中允许“本地网络”或“本机应用”访问，再点击配对。也可点击“检查助手连接”。':e.name==='TimeoutError'?'等待连接超时：请允许浏览器的本地网络访问后重试。':e.message;setupFeedback('pair',lastPairError);if(!latest)freeze(lastPairError)}finally{pairBusy=false;if(latest)render(latest);else renderConnections(null)}
};
$('forget-device').onclick=()=>{paired=null;localStorage.removeItem(storageKey);pairEditing=false;accountEditing=false;for(const id of ['pair-code','api-key','api-secret'])$(id).value='';setupFeedback('pair');setupFeedback('account');lastPairError='浏览器配对已取消。已运行的矿工不会停止，请在本机助手停止。';freeze(lastPairError)};

$('check-helper').onclick=async()=>{
 if(pairBusy)return;pairBusy=true;$('check-helper').disabled=true;lastPairError='';
 $('assistant-message').textContent='正在检查本机助手，请留意浏览器权限提示…';
 try{const r=await agentFetch('health');const d=await r.json();if(!(r.ok&&d.product==='MasionMiningHelper')&&!(r.status===401&&d.error==='请先与当前电脑的助手配对'))throw Error('当前端口不是挖矿助手');lastPairError='本机助手可以连接。请使用本机页面最新的配对码，点击“配对当前电脑”。'}
 catch(e){console.error('本机助手连接检查失败：',e.message);lastPairError='无法从网页访问助手。先确认本机页面能打开，再在地址栏左侧的站点设置中允许“本地网络”或“本机应用”访问。'}
 finally{pairBusy=false;$('check-helper').disabled=false;if(!paired?.token)freeze(lastPairError);else await refresh()}
};

// Reward reports are requested independently of the two-second device poll.
const reportTimeZone=Intl.DateTimeFormat().resolvedOptions().timeZone;
let rewardEpoch=0,rewardLoading=false,rewardHasResult=false,rewardLastAttempt=0,reportRequested=true;
function dateText(date){return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`}
function presetRange(preset){
 const end=new Date(),start=new Date();
 if(preset==='yesterday'){start.setDate(start.getDate()-1);end.setDate(end.getDate()-1)}
 else if(preset==='month')start.setDate(1);
 else if(preset!=='today')start.setDate(start.getDate()-(Number(preset)-1));
 return {from:dateText(start),to:dateText(end)};
}
function rangeDays(){return Math.round((Date.parse($('date-to').value)-Date.parse($('date-from').value))/86400000)+1}
function validateRange(){
 const from=$('date-from').value,to=$('date-to').value,days=rangeDays();
 if(!from||!to)return '请选择开始和结束日期';
 if(from>to)return '开始日期不能晚于结束日期';
 if(to>dateText(new Date()))return '结束日期不能晚于今天';
 if(!Number.isFinite(days)||days>366)return '一次最多查询 366 天，请缩小日期范围';
 return '';
}
function reportMessage(title,detail,tone='idle',setup=false){
 $('rewards-message').hidden=!title;$('rewards-message').dataset.tone=tone;
 $('rewards-message-title').textContent=title;$('rewards-message-detail').textContent=detail;$('rewards-setup-link').hidden=!setup;
}
function clearReport(){
 rewardHasResult=false;
 $('reward-total').textContent='—';$('reward-average').textContent='—';$('reward-count').textContent='等待奖励记录';
 $('daily-chart').replaceChildren();$('daily-rows').replaceChildren();$('daily-details').hidden=true;$('daily-empty').hidden=false;
 $('daily-empty').textContent='查询后在这里显示每日收益';$('daily-total').textContent='—';$('daily-records').textContent='—';
 $('daily-chart').setAttribute('aria-label','查询后显示每日 LTC 收益分布');
}
function resetRewards(){
 rewardEpoch++;rewardLoading=false;rewardLastAttempt=0;reportRequested=true;
 $('reward-summary').setAttribute('aria-busy','false');$('rewards-submit').disabled=false;
 clearReport();$('rewards-status').textContent='等待查询';
 reportMessage('连接账户后查看收益','先连接当前电脑，再在收益区上方连接只读矿池账户。','idle',true);
}
function updateRangeLabel(){
 const error=validateRange();$('range-error').textContent=error;$('range-error').hidden=!error;
 $('reward-days').textContent=error?'—':rangeDays();
 $('result-range').textContent=error?'日期待调整':`${$('date-from').value} 至 ${$('date-to').value}`;
 return !error;
}
function chooseRange(preset,query=true){
 const range=presetRange(preset);$('date-from').value=range.from;$('date-to').value=range.to;
 $('date-from').max=dateText(new Date());$('date-to').max=dateText(new Date());
 for(const button of document.querySelectorAll('[data-range]')){const active=button.dataset.range===preset;button.classList.toggle('selected',active);button.setAttribute('aria-pressed',String(active))}
 updateRangeLabel();
 if(query)loadRewards();
}
function renderReport(report){
 rewardHasResult=true;
 $('reward-total').textContent=report.total;$('reward-average').textContent=report.average;
 $('reward-days').textContent=report.days;$('reward-count').textContent=`${report.count.toLocaleString('zh-CN')} 笔已记账奖励`;
 $('result-range').textContent=`${report.from} 至 ${report.to}`;
 $('rewards-status').textContent=`更新于 ${new Date(report.syncedAt).toLocaleTimeString('zh-CN',{hour12:false})}`;
 const bars=document.createDocumentFragment(),rows=document.createDocumentFragment();
 const maximum=Math.max(...report.daily.map(day=>Number(day.amount)),0);
 for(const day of report.daily){
  const label=`${day.date}：${day.amount} LTC，${day.count} 笔奖励`;
  const bar=document.createElement('div');bar.className='daily-bar';bar.style.height=`${maximum?Number(day.amount)/maximum*100:0}%`;bar.title=label;bar.setAttribute('aria-label',label);
  if(report.days<=31)bar.tabIndex=0;
  bars.append(bar);
  const row=document.createElement('tr');
  for(const value of [day.date,day.amount,day.count.toLocaleString('zh-CN')]){const cell=document.createElement('td');cell.textContent=value;row.append(cell)}
  rows.append(row);
 }
 $('daily-chart').replaceChildren(bars);$('daily-chart').setAttribute('aria-label',`${report.from} 至 ${report.to} 每日 LTC 收益，总计 ${report.total} LTC；详细金额见下方每日明细`);
 $('chart-date-from').textContent=report.from;$('chart-date-to').textContent=report.to;
 $('daily-rows').replaceChildren(rows);$('daily-details').hidden=false;$('daily-count').textContent=`${report.days} 天`;
 $('daily-total').textContent=report.total;$('daily-records').textContent=report.count.toLocaleString('zh-CN');$('daily-empty').hidden=true;
 if(!report.count)reportMessage('这段时间没有查询到已记账奖励','可以调整日期范围。矿池尚未记账的收益不会提前计入，历史记录以矿池返回为准。');
 else reportMessage('','');
}
async function loadRewards(){
 if(!updateRangeLabel())return;
 const selection={from:$('date-from').value,to:$('date-to').value,timeZone:reportTimeZone};
 const epoch=++rewardEpoch;rewardLoading=false;reportRequested=true;rewardLastAttempt=Date.now();
 clearReport();$('rewards-submit').disabled=false;$('reward-summary').setAttribute('aria-busy','false');
 if(!latest||!latest.account?.configured){
  $('rewards-status').textContent='等待连接';
  reportMessage(latest?'先连接收益账户':'先连接当前电脑',latest?'在上方的账户余额中连接只读矿池账户，即可查询实际收益。':'运行本机助手并配对，再连接只读矿池账户。','idle',true);return;
 }
 rewardLoading=true;$('rewards-submit').disabled=true;$('reward-summary').setAttribute('aria-busy','true');
 $('rewards-status').textContent='正在查询…';
 reportMessage('正在读取奖励记录','正在汇总所选日期内的 LTC 奖励，历史记录较多时可能需要一些时间。');
 try{
  const response=await agentFetch(`rewards?${new URLSearchParams(selection)}`,{timeout:55000});
  if(response.status===404)throw Error('当前助手版本暂不支持日期统计，请更新本机助手后重试。');
  const report=await response.json();if(!response.ok)throw Error(report.error||'收益查询失败，请稍后重试');
  if(epoch!==rewardEpoch)return;
  if(!Array.isArray(report.daily)||typeof report.total!=='string'||report.from!==selection.from||report.to!==selection.to||report.timeZone!==reportTimeZone)throw Error('收益数据格式异常，请更新助手后重试');
  renderReport(report);
 }catch(error){
  if(epoch!==rewardEpoch)return;
  $('rewards-status').textContent='查询未完成';
  reportMessage('暂时无法取得区间收益',error.name==='TimeoutError'?'查询超时，请稍后重试或缩小日期范围。':error.message==='Failed to fetch'?'无法连接本机助手，请检查连接后重试。':error.message,'error');
 }finally{if(epoch===rewardEpoch){rewardLoading=false;$('rewards-submit').disabled=false;$('reward-summary').setAttribute('aria-busy','false')}}
}
function maybeLoadRewards(){
 const bounds=$('earnings').getBoundingClientRect();
 if(bounds.bottom<=0||bounds.top>=window.innerHeight||!reportRequested||rewardLoading||working)return;
 if(latest?.account?.configured&&(!rewardLastAttempt||Date.now()-rewardLastAttempt>=60000))loadRewards();
}
$('range-timezone').textContent=`统计时区：${reportTimeZone}`;
chooseRange('7',false);
for(const button of document.querySelectorAll('[data-range]'))button.addEventListener('click',()=>chooseRange(button.dataset.range));
for(const id of ['date-from','date-to'])$(id).addEventListener('input',()=>{
 rewardEpoch++;rewardLoading=false;reportRequested=false;$('rewards-submit').disabled=false;$('reward-summary').setAttribute('aria-busy','false');
 for(const button of document.querySelectorAll('[data-range]')){button.classList.remove('selected');button.setAttribute('aria-pressed','false')}
 clearReport();updateRangeLabel();$('rewards-status').textContent='日期已调整';reportMessage('点击「查询收益」更新统计','统计将按上方选择的日期范围计算。');
});
$('rewards-filter').addEventListener('submit',event=>{event.preventDefault();loadRewards()});
jumpToAnchor();queueNavigation();refresh();setInterval(refresh,2000);
