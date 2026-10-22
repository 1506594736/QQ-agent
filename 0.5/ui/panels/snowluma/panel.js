import {request,onShellEvent,onLeave} from '/panels/panel-client.js';
import {$,dateTime} from '../ui.js';
import {createLogStream} from './log-stream.js';
const status=$('#status');let loadVersion=0,actionVersion=0,refreshTimer=null;
let disposed=false,statusWork=null,statusAgain=false;
const formatLog=log=>typeof log==='string'?log:`[${dateTime(log.at??log.ts)}] ${log.level||log.stream||''} ${log.text??log.message??log.msg??''}`;
const streams={
  'snowluma-log':{path:'/api/snowluma/logs',view:createLogStream($('#sl-log'),{format:formatLog})},
  log:{path:'/api/logs',view:createLogStream($('#app-log'),{format:formatLog,onSnapshot:data=>{if(data.level)$('#log-level').value=data.level;}})},
};
function loadLogs(){return Promise.allSettled(Object.values(streams).map(stream=>stream.view.refresh(()=>request('GET',stream.path,undefined,{limit:200}))));}
function loadStatus(){
  if(disposed)return Promise.resolve();
  if(statusWork){statusAgain=true;++loadVersion;return statusWork;}
  const pending=readStatus();statusWork=pending;
  pending.finally(()=>{if(statusWork===pending)statusWork=null;if(statusAgain&&!disposed){statusAgain=false;void loadStatus();}}).catch(()=>{});
  return pending;
}
function load(){if(disposed)return Promise.resolve();return Promise.allSettled([loadStatus(),loadLogs()]);}
async function readStatus(){const version=++loadVersion;const [state]=await Promise.allSettled([request('GET','/api/status')]);if(disposed||version!==loadVersion)return;if(state.status==='fulfilled'){
  const s=state.value;let snow=s.snowluma;
  if(snow&&Object.hasOwn(snow,'processState')){
    try{snow=await request('GET','/api/snowluma/status');}
    catch(error){snow={...snow,running:null,processState:'unknown',diagnosis:error.message};}
    if(disposed||version!==loadVersion)return;
  }
  const uncertain=!snow||snow.processState==='unknown',reason=snow?.error||snow?.diagnosis||'尚未确认 SnowLuma 的实际进程状态，请重试查询或手工检查。';
  const snowState=uncertain?'状态待确认':snow.configured===false?'未配置':snow.error||snow.diagnosis?'需要检查':snow.running?'运行中':'未运行';
  const ready=s.onebot?.connected&&(typeof s.onebot.transportReady==='boolean'?s.onebot.transportReady:true);
  const connection=s.onebot?.connection;
  const endpointInfo=connection?` · ${connection.accountId?`账号 ${connection.accountId} · `:''}${[connection.wsUrl,connection.httpUrl].filter(Boolean).join(' / ')}`:'';
  const nativeInfo=snow?.nativeDiagnosis&&snow.nativeDiagnosis!==reason?` · ${snow.nativeDiagnosis}`:'';
  status.textContent=`SnowLuma：${snowState}${uncertain||snow?.error||snow?.diagnosis?` · ${reason}`:''}${nativeInfo} · QQ 账号：${ready?'已验证':s.onebot?.connected?'验证中':'等待协议连接'} · OneBot：${ready?'已连接':s.onebot?.connected?'验证中':'未连接'}${s.onebot?.selfNickname?`（${s.onebot.selfNickname}）`:''}${endpointInfo}${s.onebot?.diagnosis?` · ${s.onebot.diagnosis}`:''}`;
  $('#sl-start').disabled=uncertain||snow?.running===true;$('#sl-start').title=uncertain?reason:'';
}else{const reason=`状态读取失败：${state.reason.message}`;$('#sl-start').disabled=true;$('#sl-start').title=reason;status.textContent=reason;}}
async function act(path){const version=++actionVersion;try{await request('POST',path);if(!disposed&&version===actionVersion)await load();}catch(e){if(!disposed&&version===actionVersion)status.textContent=e.message;}}
for(const [id,path] of [['sl-start','/api/snowluma/launch'],['sl-stop','/api/snowluma/stop'],['sl-folder','/api/snowluma/open-folder'],['sl-webui','/api/snowluma/open-webui']])$(`#${id}`).addEventListener('click',()=>act(path));
$('#log-level').addEventListener('change',async()=>{try{await request('POST','/api/logs/level',{level:$('#log-level').value});await streams.log.view.refresh(()=>request('GET','/api/logs',undefined,{limit:200}));}catch(e){if(!disposed)status.textContent=e.message;}});
const offEvents=onShellEvent((name,payload)=>{
  if(disposed)return;
  if(streams[name]){streams[name].view.append(payload);return;}
  if(name==='hello'){void load();return;}
  if(['status','snowluma-status','onebot-status'].includes(name)&&!refreshTimer)refreshTimer=setTimeout(()=>{refreshTimer=null;void loadStatus();},200);
});
function dispose(){if(disposed)return;disposed=true;++actionVersion;++loadVersion;clearTimeout(refreshTimer);offEvents();for(const stream of Object.values(streams))stream.view.dispose();}
onLeave(dispose);window.addEventListener('pagehide',dispose);void load();
