import{request,onShellEvent,onLeave}from'/panels/panel-client.js';import{$,clear,text,error}from'../ui.js';
import{renderExtensions,bindZipInstaller,renderCleanup,renderCapabilityProviders,summarizeExtensions}from'../extension-manager.js';
import{bindMarketBrowser}from'../market-browser.js';
import{bindAuthoringGuide}from'../extension-authoring.js';
bindAuthoringGuide({parent:document.querySelector('#installed-actions'),kind:'plugin'});
const list=$('#list');let items=[],loadVersion=0,disposed=false,eventTimer=null;
const notice=document.createElement('p');notice.className='error catalogue-feedback';notice.hidden=true;list.before(notice);
function render(){renderExtensions(items,'plugin',load);}
async function load(rescan=false){
  if(disposed)return false;const version=++loadVersion;
  try{
    if(rescan)await request('POST','/api/skills/reload');
    const [data]=await Promise.all([request('GET','/api/skills')]);if(disposed||version!==loadVersion)return true;
    items=data.skills||[];notice.hidden=true;renderCleanup(data.uninstalled,load);const summary=summarizeExtensions(items.filter(x=>x.kind==='plugin'));text($('#meta'),`${summary.total} 个插件 · 已加载 ${summary.loaded} · 错误 ${summary.errors}`);render();
    await renderCapabilityProviders(items,{isCurrent:()=>!disposed&&version===loadVersion}).catch(e=>{if(!disposed&&version===loadVersion){text(notice,e.message);notice.hidden=false;}});return true;
  }catch(e){if(!disposed&&version===loadVersion){text(notice,`读取失败：${e.message}；已保留当前内容，可以重试。`);notice.hidden=false;}return false;}
}
$('#reload').addEventListener('click',()=>void load(true));bindZipInstaller('plugin',load);$('#search').addEventListener('input',render);
onShellEvent(name=>{if(['plugin-loaded','plugin-unloaded','plugin-error','status'].includes(name)&&!eventTimer)eventTimer=setTimeout(()=>{eventTimer=null;void load();},80);});
onLeave(()=>{disposed=true;++loadVersion;clearTimeout(eventTimer);});void load();
if(document.querySelector('#market-view'))bindMarketBrowser({kind:'plugin',onInstalled:load});
