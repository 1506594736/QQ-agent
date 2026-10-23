import {request,onShellEvent,onLeave} from '/panels/panel-client.js';
import {$,dateTime} from '../ui.js';
import {createLogStream} from './log-stream.js';

const status=$('#status'),level=$('#log-level');
let disposed=false,changingLevel=false;
const formatLog=log=>typeof log==='string'?log:`[${dateTime(log.at??log.ts)}] ${log.level||log.stream||''} ${log.text??log.message??log.msg??''}`;
const view=createLogStream($('#app-log'),{format:formatLog,onSnapshot:data=>{
  if(data.level)level.value=data.level;
  status.textContent='显示最近 200 条应用日志，连接后实时更新。';
}});
function refresh(){if(!disposed)return view.refresh(()=>request('GET','/api/logs',undefined,{limit:200}));}
$('#reload').addEventListener('click',()=>{void refresh();});
level.addEventListener('change',async()=>{
  if(disposed||changingLevel)return;
  changingLevel=true;level.disabled=true;
  try{
    const result=await request('POST','/api/logs/level',{level:level.value});
    if(disposed)return;
    if(result.level)level.value=result.level;
    await refresh();
  }catch(error){if(!disposed)status.textContent=`日志级别更新失败：${error.message}`;}
  finally{changingLevel=false;if(!disposed)level.disabled=false;}
});
const offEvents=onShellEvent((name,payload)=>{
  if(disposed)return;
  if(name==='log')view.append(payload);
  else if(name==='hello')void refresh();
});
function dispose(){if(disposed)return;disposed=true;offEvents();view.dispose();}
onLeave(dispose);window.addEventListener('pagehide',dispose);void refresh();
