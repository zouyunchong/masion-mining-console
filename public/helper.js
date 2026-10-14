const $=id=>document.getElementById(id);
let csrf=null,busy=false,currentCode='',expires=0,connected=false,codeVisible=false;
const stateNames={running:'正在挖矿',starting:'正在连接矿池',reconnecting:'矿池重连中',unavailable:'监控暂不可用',stopping:'正在停止',stopped:'矿工已停止',error:'矿工异常退出'};
function message(text){$('helper-feedback').textContent=text;$('helper-feedback').hidden=!text}
function expiry(){const seconds=Math.max(0,Math.ceil((expires-Date.now())/1000));$('helper-expiry').textContent=seconds?`${Math.floor(seconds/60)} 分 ${String(seconds%60).padStart(2,'0')} 秒有效`:'正在更新配对码';$('copy-code').disabled=!connected||!seconds;$('show-code').disabled=!connected||!seconds}
async function code(){const r=await fetch('/api/pair-code',{signal:AbortSignal.timeout(4000)});if(!r.ok)throw Error('无法读取配对码');const d=await r.json();currentCode=d.code;expires=d.expires;$('helper-code').textContent=codeVisible?currentCode:'•••• •••• ••••';expiry()}
async function refresh(){
 try{
  const r=await fetch('/api/status',{signal:AbortSignal.timeout(4000)});if(!r.ok)throw Error('助手连接中断');const s=await r.json();csrf=s.csrf;if(!connected)message('');connected=true;
  $('helper-online').textContent='助手在线';$('helper-online').dataset.tone='good';$('helper-name').textContent=s.device.name;$('helper-icon').textContent=s.device.platform==='darwin'?'Mac':'PC';
  $('helper-device').textContent=`${s.device.cores} 核 · ${Math.round(s.device.memory/2**30)} GB · ${s.device.platform==='darwin'?'macOS':'Windows'}`;
  $('helper-state').textContent=stateNames[s.state]||s.state;$('helper-state').dataset.state=s.state;
  $('helper-stop').disabled=busy||!s.pid;$('renew-code').disabled=busy;$('revoke-pair').disabled=busy;$('clear-data').disabled=busy;
  if(!currentCode||Date.now()>=expires)await code();
 }catch(e){connected=false;csrf=null;$('helper-online').textContent='助手未连接';$('helper-online').dataset.tone='idle';$('helper-state').dataset.state='error';codeVisible=false;$('helper-code').textContent='•••• •••• ••••';$('show-code').setAttribute('aria-pressed','false');$('show-code').setAttribute('aria-label','显示配对码');$('helper-state').textContent='连接中断';for(const id of ['helper-stop','copy-code','show-code','renew-code','revoke-pair','clear-data'])$(id).disabled=true;message('助手连接中断。请重新打开或运行本地助手。')}
}
async function action(route,body={}){
 if(busy||!csrf)return {ok:false,error:'助手尚未连接，请稍后重试。'};busy=true;for(const id of ['helper-stop','renew-code','revoke-pair','clear-data'])$(id).disabled=true;
 try{const r=await fetch(`/api/${route}`,{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':csrf},body:JSON.stringify(body),signal:AbortSignal.timeout(20000)});const d=await r.json();if(!r.ok)throw Error(d.error);if(route==='device/reset'){currentCode='';await code().catch(()=>{});message('本机挖矿数据已清除，矿工已停止。旧网页配对已失效，需要重新配对和配置。')}else if(route==='stop')message('本机矿工已停止。');else{await code();message(route==='device/revoke'?'已撤销全部浏览器配对。已运行的矿工保持当前状态。':'配对码已更新，已配对的浏览器仍可使用。')}return {ok:true}}catch(e){const error=e.name==='TimeoutError'?'等待结果超时，暂时无法确认是否已完成。请检查助手状态后重试。':e.message==='Failed to fetch'?'无法连接本机助手，暂时无法确认是否已完成。请恢复连接后检查状态。':e.message;message(error);return {ok:false,error}}finally{busy=false;await refresh()}
}
$('show-code').onclick=()=>{codeVisible=!codeVisible;$('helper-code').textContent=codeVisible?currentCode:'•••• •••• ••••';$('show-code').setAttribute('aria-pressed',String(codeVisible));$('show-code').setAttribute('aria-label',codeVisible?'隐藏配对码':'显示配对码')};
$('copy-code').onclick=async()=>{try{await navigator.clipboard.writeText(currentCode);message('配对码已复制。打开网页，粘贴并点击“配对当前电脑”。')}catch{message('自动复制不可用，请选中配对码手动复制。')}};
$('helper-stop').onclick=()=>action('stop');$('renew-code').onclick=()=>action('pair-code/refresh');$('revoke-pair').onclick=()=>action('device/revoke');
$('clear-data').onclick=()=>{
 $('clear-title').textContent='清除这台电脑的挖矿数据';$('clear-scope').hidden=false;$('clear-entry').hidden=false;
 $('clear-result').hidden=true;$('clear-result').className='';$('clear-confirm').disabled=false;$('clear-confirm').value='';
 $('confirm-clear').hidden=false;$('confirm-clear').textContent='确认清除';$('confirm-clear').disabled=true;
 $('cancel-clear').textContent='取消';$('cancel-clear').disabled=false;$('clear-dialog').showModal();$('clear-confirm').focus();
};
$('clear-confirm').oninput=()=>{$('confirm-clear').disabled=$('clear-confirm').value.trim()!=='清除'};
$('cancel-clear').onclick=()=>{if(!busy)$('clear-dialog').close()};
$('clear-dialog').oncancel=e=>{if(busy)e.preventDefault()};
$('clear-form').onsubmit=async e=>{
 e.preventDefault();if($('clear-confirm').value.trim()!=='清除'||busy||$('confirm-clear').hidden)return;
 $('clear-confirm').disabled=true;$('confirm-clear').disabled=true;$('cancel-clear').disabled=true;$('confirm-clear').textContent='正在清除…';
 $('clear-title').textContent='正在清除本机挖矿数据';$('clear-result').hidden=false;$('clear-result').className='processing';
 $('clear-result').textContent='正在停止矿工并删除本机配置，请稍候。';$('clear-form').setAttribute('aria-busy','true');
 const result=await action('device/reset',{confirmation:'DELETE_LOCAL_MINING_DATA'});
 $('clear-form').removeAttribute('aria-busy');$('cancel-clear').disabled=false;
 if(result.ok){
  $('clear-title').textContent='本机挖矿数据已清除';$('clear-scope').hidden=true;$('clear-entry').hidden=true;$('confirm-clear').hidden=true;
  $('clear-result').className='success';$('clear-result').textContent='矿工已停止。保存的挖矿设置、API 凭证、旧配对、设备标识、运行日志和算力记录已删除。矿池账户里的 LTC 保留。再次挖矿需要重新配对和配置。';
  $('cancel-clear').textContent='完成';$('cancel-clear').focus();
 }else{
  $('clear-title').textContent='未能确认清除完成';$('clear-result').className='failure';$('clear-result').textContent=result.error;
  $('clear-confirm').disabled=false;$('confirm-clear').textContent='重试清除';$('confirm-clear').disabled=$('clear-confirm').value.trim()!=='清除';
 }
};
if(location.hash==='#cleanup')$('cleanup').scrollIntoView();
await refresh();setInterval(refresh,3000);setInterval(()=>{if(connected)code().catch(()=>{})},10000);setInterval(expiry,1000);
