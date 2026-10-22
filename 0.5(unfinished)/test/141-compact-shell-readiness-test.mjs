import {settingsSection,settingsReload,settingsEditor} from './settings-navigation.mjs';
// Real kernel + Chromium: stable compact rail geometry and truthful readiness navigation.
// The coordinator runs Chromium; layout uses reduced motion and DOM/network gates.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createKernel } from '../src/kernel/kernel.js';
import { isolateConsoleFixture } from './console-fixture-isolation.mjs';

const dataDir=fs.mkdtempSync(path.join(os.tmpdir(),'qqa-compact141-')),token='compact141-console';
const isolation=isolateConsoleFixture(dataDir,'141');
const qq={ready:false,running:false},snow={configured:false,running:false},onebot={connected:true,selfId:'99'};
let bindings,browser,kernelStarted=false,qqDiscovered=null,qqDiscoveryError=null,qqDiscoveryCalls=0;
const kernel=createKernel({appRoot:isolation.appRoot,env:isolation.env,headless:true,
  transport:{id:'fixture',selfId:'99',bind(hooks){bindings=hooks;},start(){bindings.onStatus({...onebot});},stop(){},status:()=>({...onebot}),actions:{},
    processes:{qqPortable:{statusSync:()=>({...qq}),status:()=>{qqDiscoveryCalls++;if(qqDiscoveryError)throw new Error(qqDiscoveryError);return {...(qqDiscovered||qq)};}},snowluma:{statusSync:()=>({...snow}),status:()=>({...snow})}}},
  priceUpdates: { refresh: async () => ({ok:true}), updateCheck: async () => ({ok:true,current:'0.5.0',latest:'0.5.0',hasUpdate:false}) },communityMarket:{syncGlobalBlocklist:async()=>({ok:true,ids:[]})}});
kernel.config.update({server:{port:0,token},telemetry:{enabled:false},ui:{refreshMs:15000},api:{baseUrl:'http://127.0.0.1:1/v1',model:'local-fixture'}});
kernel.loader.startWatchers=()=>{};

try{
  const port=await kernel.start();kernelStarted=true;const base=`http://127.0.0.1:${port}`;
  isolation.allowOrigin(base);isolation.assertEmpty(kernel);
  const playwright=createRequire(import.meta.url)('playwright-core');
  const cache=path.join(process.env.LOCALAPPDATA??path.join(os.homedir(),'AppData/Local'),'ms-playwright');
  const versions=fs.existsSync(cache)?fs.readdirSync(cache).filter(name=>/^chromium-\d+$/.test(name)).sort((a,b)=>Number(b.slice(9))-Number(a.slice(9))):[];
  const executablePath=process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH??versions.map(version=>path.join(cache,version,'chrome-win64/chrome.exe')).find(file=>fs.existsSync(file));
  browser=await playwright.chromium.launch({executablePath,headless:true});
  const page=await browser.newPage({viewport:{width:1360,height:900},reducedMotion:'reduce'}),errors=[];
  await isolation.bindPage(page,base);
  page.setDefaultTimeout(10000);page.on('pageerror',error=>errors.push(error.message));
  await page.clock.install();
  // A clock jump runs the timer callback before its real HTTP promises settle.
  // Observe the existing poll's finally boundary without changing its timing.
  await page.addInitScript(()=>{
    if(window!==top)return;
    const nativeSet=window.setTimeout.bind(window),nativeClear=window.clearTimeout.bind(window);let pollTimer=null;
    window.qa141PollTimerArmed=false;
    window.setTimeout=function(callback,milliseconds,...args){
      if(typeof callback!=='function'||callback.name!=='pollStatus')return nativeSet(callback,milliseconds,...args);
      const timer=nativeSet(()=>{if(pollTimer===timer){pollTimer=null;window.qa141PollTimerArmed=false;}return callback(...args);},milliseconds);
      pollTimer=timer;window.qa141PollTimerArmed=true;return timer;
    };
    window.clearTimeout=function(timer){if(timer===pollTimer){pollTimer=null;window.qa141PollTimerArmed=false;}return nativeClear(timer);};
  });
  await page.goto(`${base}/?token=${token}`);
  await page.locator('#nav button').first().waitFor();
  await page.frameLocator('#panel-host iframe').locator('h2').first().waitFor();
  await page.waitForFunction(()=>document.querySelector('#pause-btn')?.disabled===false&&document.querySelector('#ready-model small')?.textContent==='已配置');
  await page.evaluate(()=>document.fonts.ready);

  const collapse=page.locator('#brand-emblem');
  const readyNames={qq:'QQ 内核',snow:'SnowLuma',onebot:'OneBot',model:'模型配置'};
  const checkReadiness=async(id,state,label)=>{
    const button=page.locator('#ready-'+id);
    assert.equal(await button.getAttribute('data-state'),state);
    assert.equal(await button.locator('small').textContent(),label);
    assert.equal(await button.getAttribute('aria-label'),readyNames[id]+'：'+label);
    assert.equal(await button.getAttribute('aria-describedby'),'ready-'+id+'-detail');
    assert.equal(await button.getAttribute('aria-haspopup'),null,'A direct navigation action does not advertise a dialog');
    assert.equal(await button.getAttribute('aria-controls'),null);
    assert.equal(await button.getAttribute('data-icon-active'),'true');
    assert.equal(await button.locator('.readiness-icon svg').count(),1);
    assert.equal(await button.locator('.readiness-icon svg').getAttribute('data-icon-motion'),'status-'+id+'-'+(state==='good'?'ready':'pending'));
    const reason=(await page.locator('#ready-'+id+'-detail').textContent()).trim();
    assert.ok(reason,'Every accessible status retains its complete reason');
    assert.ok((await button.getAttribute('title'))?.includes(reason),'The status tooltip retains the full reason');
  };

  console.log('· Footer status buttons preserve truthful labels, full reasons and direct keyboard/mouse navigation');
  assert.equal(await page.locator('.rail-footer section#runtime-readiness button.readiness-item').count(),4);
  assert.equal(await page.locator('dl.readiness-details[hidden] dd').count(),4);
  assert.equal(await page.locator('#panel-count').count(),0);
  assert.doesNotMatch(await page.locator('.rail').textContent(),/工作面板/,'The rail has no redundant work-panel counter/title');
  await checkReadiness('qq','bad','缺少内核');await checkReadiness('snow','bad','未配置');
  await checkReadiness('onebot','good','已连接');await checkReadiness('model','good','已配置');
  assert.equal(await page.locator('#readiness-dialog').count(),0,'Readiness navigation has no intermediate status dialog');
  assert.match(await page.locator('#ready-model-detail').textContent(),/尚未验证.*连通/,'A configured local endpoint is never presented as verified connectivity');
  const checkDestination=async id=>{
    const panel=id==='model'?'settings':'snowluma';
    await page.locator(`#panel-host iframe[src*="/panels/${panel}/index.html"]`).waitFor();
    const frame=page.frameLocator('#panel-host iframe');
    if(id==='model'){
      await frame.locator('#section-models').waitFor({state:'visible'});
      assert.match(await page.locator('#panel-host iframe').getAttribute('src'),/#models$/,'A fresh settings frame opens directly at MODEL');
    }else await frame.locator('#sl-start').waitFor();
    assert.equal(await page.locator('#readiness-dialog').count(),0);
  };
  for(const id of Object.keys(readyNames))for(const action of ['keyboard','mouse']){
    await page.locator('#nav button[data-panel=sessions]').click();
    await page.locator('#panel-host iframe[src*="/panels/sessions/index.html"]').waitFor();
    const button=page.locator('#ready-'+id);
    if(action==='keyboard'){await button.focus();await button.press('Enter');}else await button.click();
    await checkDestination(id);
  }
  console.log('· MODEL navigation reuses an open settings frame and preserves its unsaved draft');
  const settingsPanel=page.frameLocator('#panel-host iframe');
  const modelDraftSaved=page.waitForResponse(response=>{
    const pathname=new URL(response.url()).pathname;
    if(!['/api/config','/api/config/lifecycle'].includes(pathname)||response.request().method()!=='POST'||response.status()!==200)return false;
    const body=response.request().postDataJSON(),patch=pathname==='/api/config/lifecycle'?body?.patch:body;
    return patch?.api?.videoMode==='native';
  });modelDraftSaved.catch(()=>{});
  await settingsEditor(settingsPanel,'model-config');await settingsPanel.getByRole('switch',{name:'视频输入',exact:true}).click();await settingsPanel.locator('#field-api-videoMode').selectOption('native');
  await settingsSection(settingsPanel,'uikit');
  await settingsPanel.locator('#section-uikit').waitFor({state:'visible'});
  assert.equal(await settingsPanel.locator('#section-models').isVisible(),false);
  await page.evaluate(()=>{window.qaSettingsFrame=document.querySelector('#panel-host iframe');});
  await page.locator('#ready-model').click();
  await settingsPanel.locator('#section-models').waitFor({state:'visible'});
  assert.equal(await page.evaluate(()=>document.querySelector('#panel-host iframe')===window.qaSettingsFrame),true,'Repeated MODEL navigation preserves the current iframe');
  assert.equal(await settingsPanel.locator('#field-api-videoMode').inputValue(),'native','Selecting MODEL does not reload away an unsaved settings draft');

  console.log('· Partial process updates refresh accessible reasons and only good uses the ready glyph');
  await page.evaluate(()=>window.qaPendingQQ=document.querySelector('#ready-qq .readiness-icon svg'));
  const isolationReason='QQ 独立数据目录尚未通过真实运行验证，已暂停便携启动，避免使用系统 QQ 数据。';
  Object.assign(qq,{installedReady:true,proofValid:true,installationVerified:true,version:'9.9.33.51802',ready:false,launchAllowed:false,launchIsolation:{status:'unverified',verified:false,reason:isolationReason},diagnosis:isolationReason});
  kernel.bus.emit('qq-portable.status',{...qq});
  await page.waitForFunction(()=>document.querySelector('#ready-qq small')?.textContent==='隔离未验证');
  await checkReadiness('qq','warn','隔离未验证');
  assert.match(await page.locator('#ready-qq-detail').textContent(),/9\.9\.33\.51802.*已安装.*启动暂停/);
  assert.ok((await page.locator('#ready-qq-detail').textContent()).includes(isolationReason));
  assert.doesNotMatch(await page.locator('#ready-qq-detail').textContent(),/缺少内核|未找到便携/,'An installed runtime is not mislabeled as missing');
  qq.proofValid=false;qq.installationVerified=false;kernel.bus.emit('qq-portable.status',{proofValid:false,installationVerified:false});
  await page.waitForFunction(()=>document.querySelector('#ready-qq-detail')?.textContent.includes('尚未验证安装证明'));
  await checkReadiness('qq','warn','隔离未验证');
  assert.match(await page.locator('#ready-qq-detail').textContent(),/已发现.*尚未验证安装证明/,'A manual runtime without a proof is not presented as archive-verified');
  // A simulated attested adapter keeps the existing positive UI transitions.
  // This is not evidence that the real QQ runtime is isolated.
  Object.assign(qq,{proofValid:true,installationVerified:true,ready:true,launchAllowed:true,launchIsolation:{status:'verified',verified:true,reason:null},diagnosis:null});kernel.bus.emit('qq-portable.status',{...qq});
  await page.waitForFunction(()=>document.querySelector('#ready-qq')?.dataset.state==='warn');
  await checkReadiness('qq','warn','未运行');
  assert.equal(await page.evaluate(()=>document.querySelector('#ready-qq .readiness-icon svg')===window.qaPendingQQ),true,'Unchanged pending variants retain their glyph node');
  assert.match(await page.locator('#ready-qq-detail').textContent(),/已准备.*尚未启动/);
  qq.running=true;kernel.bus.emit('qq-portable.status',{running:true});
  await page.waitForFunction(()=>document.querySelector('#ready-qq')?.dataset.state==='good');
  await checkReadiness('qq','good','运行中');
  assert.equal(await page.locator('#ready-qq-detail').textContent(),'便携 QQ 正在运行。');
  console.log('· QQ discovery and unconfirmed exits preserve uncertainty and recover from a complete producer snapshot');
  const qqStopDiagnosis='QQ 停止请求已发出，但未确认进程退出；请重试或手工关闭。';
  Object.assign(qq,{running:true,processState:'unknown',processDiagnosis:qqStopDiagnosis,error:null});kernel.bus.emit('qq-portable.status',{...qq});
  await page.waitForFunction(()=>document.querySelector('#ready-qq small')?.textContent==='状态待确认',null,{timeout:3000});
  await checkReadiness('qq','warn','状态待确认');
  assert.ok((await page.locator('#ready-qq-detail').textContent()).includes(qqStopDiagnosis));
  qq.running=false;kernel.bus.emit('qq-portable.status',{running:false});
  await checkReadiness('qq','warn','状态待确认');
  Object.assign(qq,{running:true,processState:'running',processDiagnosis:null,error:null});kernel.bus.emit('qq-portable.status',{...qq});
  await page.waitForFunction(()=>document.querySelector('#ready-qq')?.dataset.state==='good');
  assert.doesNotMatch(await page.locator('#ready-qq-detail').textContent(),/未确认进程退出/);
  console.log('· The existing shell poll discovers a cached unknown QQ state without opening its panel');
  Object.assign(qq,{running:null,processState:'unknown',processDiagnosis:'QQ 进程尚未查询'});kernel.bus.emit('qq-portable.status',{...qq});
  await page.waitForFunction(()=>document.querySelector('#ready-qq small')?.textContent==='状态待确认');
  const unknownDto=await (await fetch(`${base}/api/qq-portable/status`,{headers:{'x-console-token':token}})).json();
  assert.equal(unknownDto.running,null,'The discovery endpoint must preserve unknown rather than coerce it into a confirmed false');
  assert.equal(unknownDto.processState,'unknown');
  qqDiscovered={...qq,running:false,processState:'stopped',processDiagnosis:null,error:null};
  // Settle the earlier 700ms draft autosave independently: advancing it together
  // with the 15s poll creates a newer SSE revision while discovery is in flight.
  await page.clock.runFor(800);assert.equal((await modelDraftSaved).status(),200);
  await settingsPanel.locator('#status').filter({hasText:'已保存'}).waitFor();
  const beforeDiscovery=qqDiscoveryCalls;
  await page.waitForFunction(()=>window.qa141PollTimerArmed===true);
  await page.clock.runFor(16000);
  await page.waitForFunction(()=>document.querySelector('#ready-qq small')?.textContent==='未运行',null,{timeout:3000});
  assert.ok(qqDiscoveryCalls>beforeDiscovery,'The shell must use the bounded discovery endpoint rather than treating the cached unknown as stopped');
  qqDiscoveryError='QQ 进程查询暂时失败';
  await page.waitForFunction(()=>window.qa141PollTimerArmed===true);
  await page.clock.runFor(16000);
  await page.waitForFunction(()=>document.querySelector('#ready-qq-detail')?.textContent.includes('QQ 进程查询暂时失败'),null,{timeout:3000});
  await checkReadiness('qq','warn','状态待确认');
  // Timer-sensitive autosave/discovery checks are complete; subsequent layout
  // and resize work follows the browser's real rendering cadence.
  await page.clock.resume();
  qqDiscoveryError=null;qqDiscovered=null;
  Object.assign(qq,{running:true,processState:'running',processDiagnosis:null,error:null});kernel.bus.emit('qq-portable.status',{...qq});
  await page.waitForFunction(()=>document.querySelector('#ready-qq')?.dataset.state==='good');
  console.log('· A running process with a failed version lock is not presented as a successful runtime');
  qq.ready=false;qq.installedReady=false;qq.proofValid=false;qq.installationVerified=false;qq.diagnosis='QQ 版本校验未通过';
  kernel.bus.emit('qq-portable.status',{ready:false,installedReady:false,proofValid:false,installationVerified:false,running:true,diagnosis:qq.diagnosis});
  await page.waitForFunction(()=>document.querySelector('#ready-qq')?.dataset.state==='bad',null,{timeout:3000});
  await checkReadiness('qq','bad','需要检查');
  assert.match(await page.locator('#ready-qq-detail').textContent(),/版本校验未通过/);
  qq.ready=true;qq.installedReady=true;qq.proofValid=true;qq.installationVerified=true;qq.diagnosis=null;kernel.bus.emit('qq-portable.status',{ready:true,installedReady:true,proofValid:true,installationVerified:true,running:true,diagnosis:null});
  await page.waitForFunction(()=>document.querySelector('#ready-qq')?.dataset.state==='good');
  snow.configured=true;snow.running=true;kernel.bus.emit('snowluma.status',{...snow});
  await page.waitForFunction(()=>document.querySelector('#ready-snow')?.dataset.state==='good');
  await checkReadiness('snow','good','运行中');
  console.log('· SnowLuma uncertain exits and installation failures retain truthful status until recovery');
  const stopDiagnosis='SnowLuma 停止请求已发出，但未确认进程退出；请重试或手工关闭。';
  Object.assign(snow,{running:true,configured:true,processState:'unknown',diagnosis:stopDiagnosis});kernel.bus.emit('snowluma.status',{...snow});
  await page.waitForFunction(()=>document.querySelector('#ready-snow small')?.textContent==='状态待确认',null,{timeout:3000});
  await checkReadiness('snow','warn','状态待确认');
  assert.ok((await page.locator('#ready-snow-detail').textContent()).includes(stopDiagnosis));
  snow.running=false;kernel.bus.emit('snowluma.status',{running:false});
  await page.waitForFunction(()=>document.querySelector('#ready-snow-detail')?.textContent.includes('未确认进程退出'));
  await checkReadiness('snow','warn','状态待确认');
  Object.assign(onebot,{connected:false,error:null});bindings.onStatus({...onebot});
  await page.waitForFunction(()=>document.querySelector('#ready-onebot')?.dataset.state==='warn');
  assert.ok((await page.locator('#ready-onebot-detail').textContent()).includes(stopDiagnosis),'Disconnected OneBot must preserve the unknown SnowLuma exit diagnosis');
  assert.doesNotMatch(await page.locator('#ready-onebot-detail').textContent(),/SnowLuma 尚未运行/,'Unknown exit does not prove SnowLuma stopped');
  Object.assign(snow,{running:false,processState:'stopped',diagnosis:null});kernel.bus.emit('snowluma.status',{...snow});
  await page.waitForFunction(()=>document.querySelector('#ready-snow small')?.textContent==='未运行');
  await checkReadiness('snow','warn','未运行');
  assert.doesNotMatch(await page.locator('#ready-snow-detail').textContent(),/未确认进程退出/,'Confirmed recovery removes the previous failure reason');
  assert.match(await page.locator('#ready-onebot-detail').textContent(),/SnowLuma 尚未运行/,'Confirmed stopped status may explain a disconnected OneBot');
  Object.assign(snow,{running:true,processState:'running',diagnosis:'SnowLuma 握手版本不符合锁定版本'});kernel.bus.emit('snowluma.status',{...snow});
  await page.waitForFunction(()=>document.querySelector('#ready-snow small')?.textContent==='需要检查');
  await checkReadiness('snow','bad','需要检查');
  assert.match(await page.locator('#ready-snow-detail').textContent(),/握手版本不符合锁定版本/);
  snow.diagnosis=null;kernel.bus.emit('snowluma.status',{diagnosis:null});
  await page.waitForFunction(()=>document.querySelector('#ready-snow')?.dataset.state==='good');
  await checkReadiness('snow','good','运行中');
  Object.assign(snow,{running:false,processState:'unknown',diagnosis:stopDiagnosis});kernel.bus.emit('snowluma.status',{...snow});
  await page.locator('#nav button').filter({hasText:'SnowLuma'}).click();
  const snowPanel=page.frameLocator('#panel-host iframe');
  await snowPanel.locator('#status').filter({hasText:'SnowLuma：状态待确认'}).waitFor();
  assert.ok((await snowPanel.locator('#status').textContent()).includes(stopDiagnosis));
  assert.equal(await snowPanel.locator('#sl-start').isDisabled(),true,'Unknown actual process state cannot offer a duplicate start');
  assert.equal(await snowPanel.locator('#quick-start,#qq-start,#qq-stop,#reload,#qq-status,#qq-log').count(),0);
  Object.assign(snow,{running:false,processState:'stopped',diagnosis:null});kernel.bus.emit('snowluma.status',{...snow});
  await page.clock.runFor(250);
  await snowPanel.locator('#status').filter({hasText:'SnowLuma：未运行'}).waitFor();
  assert.equal(await snowPanel.locator('#sl-start').isEnabled(),true,'A confirmed stopped process can be started again');
  assert.doesNotMatch(await snowPanel.locator('#status').textContent(),/未确认进程退出/);
  Object.assign(snow,{running:true,processState:'running',diagnosis:null});kernel.bus.emit('snowluma.status',{...snow});
  await page.clock.runFor(250);await snowPanel.locator('#status').filter({hasText:'SnowLuma：运行中'}).waitFor();
  assert.equal(await snowPanel.locator('#sl-start').isDisabled(),true);
  Object.assign(qq,{running:false,processState:'unknown',processDiagnosis:qqStopDiagnosis,error:null});kernel.bus.emit('qq-portable.status',{...qq});
  await page.waitForFunction(()=>document.querySelector('#ready-qq small')?.textContent==='状态待确认');
  assert.ok((await page.locator('#ready-qq-detail').textContent()).includes(qqStopDiagnosis),'the independent shell retains QQ observations');
  assert.doesNotMatch(await snowPanel.locator('#status').textContent(),/QQ 停止请求|便携 QQ/,'portable status does not reappear in the SnowLuma panel');
  Object.assign(qq,{running:false,processState:'stopped',processDiagnosis:null,error:null});kernel.bus.emit('qq-portable.status',{...qq});
  await page.waitForFunction(()=>document.querySelector('#ready-qq small')?.textContent==='未运行');
  assert.equal(await snowPanel.locator('#qq-status,#qq-start,#qq-stop,#qq-log').count(),0);
  onebot.connected=false;onebot.error='401 token mismatch';bindings.onStatus({...onebot});
  await page.waitForFunction(()=>document.querySelector('#ready-onebot')?.dataset.state==='warn');
  await checkReadiness('onebot','warn','未连接');assert.match(await page.locator('#ready-onebot-detail').textContent(),/令牌不匹配/);

  console.log('· Collapsing changes width while logo origin and every navigation row stay fixed');
  const layout=()=>page.evaluate(()=>{
    const rail=document.querySelector('.rail').getBoundingClientRect(),brand=document.querySelector('.brand').getBoundingClientRect();
    const emblem=document.querySelector('#brand-emblem svg').getBoundingClientRect();
    const context=document.querySelector('.workspace-context'),contextStyle=getComputedStyle(context);
    return {railWidth:rail.width,topPadding:parseFloat(getComputedStyle(document.querySelector('.rail')).paddingTop),brandHeight:brand.height,slotWidth:document.querySelector('#brand-emblem').getBoundingClientRect().width,
      logo:{x:emblem.x-rail.x,y:emblem.y-rail.y,width:emblem.width,height:emblem.height},standaloneControls:document.querySelectorAll('.rail-controls,#navigation-collapse').length,
      rows:[...document.querySelectorAll('#nav button')].map(node=>{const box=node.getBoundingClientRect();return{id:node.dataset.panel,y:box.y-rail.y,height:box.height};}),
      toolbar:document.querySelector('.topbar').getBoundingClientRect().height,panelTop:document.querySelector('#panel-host').getBoundingClientRect().top,
      context:{width:context.getBoundingClientRect().width,height:context.getBoundingClientRect().height,clip:contextStyle.clipPath,position:contextStyle.position},workspaceRows:getComputedStyle(document.querySelector('.workspace')).gridTemplateRows.split(/\s+/).length};
  });
  assert.equal(await page.locator('body').getAttribute('data-rail-collapsed'),'false');
  const expanded=await layout();await collapse.click();
  await page.waitForFunction(()=>document.body.dataset.railCollapsed==='true');const compact=await layout();
  assert.ok(compact.railWidth<expanded.railWidth);assert.equal(compact.railWidth,62);
  for(const measured of [expanded,compact]){
    assert.equal(measured.topPadding,16);assert.equal(measured.brandHeight,48);assert.equal(measured.slotWidth,45);
    assert.equal(measured.standaloneControls,0);
    assert.equal(measured.toolbar,44);assert.equal(measured.panelTop,44);assert.equal(measured.workspaceRows,2);
    assert.equal(measured.context.width,1);assert.equal(measured.context.height,1);assert.equal(measured.context.position,'absolute');assert.equal(measured.context.clip,'inset(50%)');
    assert.ok(measured.rows.length>=8);assert.equal(measured.rows[0].y,64);
    for(const [index,row] of measured.rows.entries()){assert.equal(row.height,46);if(index)assert.equal(row.y-measured.rows[index-1].y,50);}
  }
  assert.deepEqual(compact.logo,expanded.logo,'The emblem keeps its rail-relative x/y and size');
  assert.deepEqual(compact.rows,expanded.rows,'Every nav row retains its y/height/order while labels collapse');
  assert.equal(await collapse.getAttribute('aria-expanded'),'false');
  assert.equal(await page.locator('#workspace-title').count(),1);assert.equal(await page.locator('#workspace-index').count(),1);assert.equal(await page.locator('#workspace-description').count(),1);
  await collapse.click();await page.waitForFunction(()=>document.body.dataset.railCollapsed==='false');
  assert.deepEqual((await layout()).rows,expanded.rows);

  console.log('· A short rail scrolls its navigation while all four status actions remain reachable');
  const resizeAndWaitForLayout=async viewport=>{
    await page.setViewportSize(viewport);
    // setViewportSize and fonts.ready do not themselves acknowledge that the
    // document's viewport units and flex layout committed the requested size.
    await page.waitForFunction(({width,height})=>{
      const shell=document.querySelector('.app-shell')?.getBoundingClientRect(),rail=document.querySelector('.rail')?.getBoundingClientRect();
      return innerWidth===width&&innerHeight===height&&shell?.width===width&&shell.height===height&&rail?.height===height;
    },viewport);
    await page.evaluate(()=>document.fonts.ready);
  };
  await resizeAndWaitForLayout({width:1360,height:480});
  const scroll=await page.locator('#nav').evaluate(node=>({height:node.clientHeight,content:node.scrollHeight}));
  assert.ok(scroll.height>0&&scroll.content>scroll.height,'Navigation has a usable scroll area rather than covering the footer');
  await page.locator('#nav button').last().focus();
  assert.equal(await page.locator('#nav button').last().evaluate(node=>{const box=node.getBoundingClientRect(),nav=node.closest('nav').getBoundingClientRect();return box.top>=nav.top-1&&box.bottom<=nav.bottom+1;}),true,'Keyboard focus scrolls the final panel into view');
  for(const id of Object.keys(readyNames))assert.equal(await page.locator('#ready-'+id).isVisible(),true);
  await page.locator('#ready-onebot').click();await checkDestination('onebot');
  await collapse.click();await page.waitForFunction(()=>document.body.dataset.railCollapsed==='true');
  const shortLogo=(await layout()).logo;
  await page.locator('#nav button').last().focus();
  assert.equal(await page.locator('#nav button').last().evaluate(node=>{const glyph=node.querySelector('.nav-icon svg').getBoundingClientRect(),nav=node.closest('nav').getBoundingClientRect();return glyph.left>=nav.left&&glyph.right<=nav.right&&glyph.top>=nav.top-1&&glyph.bottom<=nav.bottom+1;}),true,'A scrollbar must not clip the compact navigation glyph');
  await page.locator('#ready-model').focus();await page.keyboard.press('Enter');await checkDestination('model');
  assert.deepEqual((await layout()).logo,shortLogo,'Focusing footer status cannot scroll the rail or move its emblem');
  assert.equal(await page.locator('.rail').evaluate(node=>node.scrollTop),0);
  await collapse.click();await page.waitForFunction(()=>document.body.dataset.railCollapsed==='false');

  console.log('· Narrow and hidden navigation keep direct status actions accessible');
  await resizeAndWaitForLayout({width:520,height:900});
  const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth||[...document.querySelectorAll('.rail,.runtime-controls,.readiness-item')].some(node=>{const box=node.getBoundingClientRect();return box.left<0||box.right>innerWidth+1;}));
  assert.equal(overflow,false);
  await page.evaluate(()=>document.body.dataset.sidebar='hidden');await page.locator('#navigation-toggle').waitFor();
  assert.equal(await page.locator('.rail').isVisible(),false);
  await page.locator('#navigation-toggle').click();await page.waitForFunction(()=>document.body.classList.contains('navigation-peek'));
  assert.equal(await page.locator('#navigation-toggle').getAttribute('aria-expanded'),'true');
  for(const id of Object.keys(readyNames))assert.equal(await page.locator('#ready-'+id).isVisible(),true);
  await page.locator('#ready-model').scrollIntoViewIfNeeded();
  await page.evaluate(async()=>{await document.fonts.ready;await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));});
  await page.locator('#ready-model').click();await checkDestination('model');
  assert.match(await page.locator('#ready-model-detail').textContent(),/尚未验证.*连通/);
  if(!await page.evaluate(()=>document.body.classList.contains('navigation-peek'))){
    await page.locator('#navigation-toggle').click();await page.waitForFunction(()=>document.body.classList.contains('navigation-peek'));
  }
  await page.keyboard.press('Escape');await page.waitForFunction(()=>!document.body.classList.contains('navigation-peek'));
  assert.equal(await page.locator('#navigation-toggle').getAttribute('aria-expanded'),'false');
  assert.equal(await page.evaluate(()=>document.activeElement?.id),'navigation-toggle');
  assert.deepEqual(errors,[]);
  console.log('✓ 141 compact shell geometry, truthful readiness, direct status navigation and constrained viewport access passed');
}catch(error){
  const page=browser?.contexts()[0]?.pages()[0];
  if(page)console.error('141 failure state',await page.evaluate(()=>({active:document.activeElement?.id,panelSrc:document.querySelector('#panel-host iframe')?.getAttribute('src'),peek:document.body.classList.contains('navigation-peek'),sidebar:document.body.dataset.sidebar,modelButton:document.querySelector('#ready-model')?.getBoundingClientRect().toJSON(),rail:document.querySelector('.rail')?.getBoundingClientRect().toJSON()})));
  throw error;
}finally{
  await browser?.close();if(kernelStarted)await kernel.stop();isolation.assertEmpty(kernel);isolation.restore();
  const tempRoot=path.resolve(os.tmpdir()),cleanupTarget=path.resolve(dataDir),relative=path.relative(tempRoot,cleanupTarget);
  assert.ok(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative)&&path.basename(cleanupTarget).startsWith('qqa-compact141-'));
  fs.rmSync(cleanupTarget,{recursive:true,force:true});
}
