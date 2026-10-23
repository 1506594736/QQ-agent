import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {modelUiFixture} from './model-ui-fixture.mjs';
import {openSettingsFold,settingsPickModel} from './settings-navigation.mjs';

const config={allow:{groups:['10001'],private:[]},persona:{roleText:'结构测试角色'},memory:{useChatModel:true,consolidateEnabled:false,consolidateMinIntervalMs:3600000},webSearch:{enabled:false,bocha:{apiKey:'synthetic-preconfigured-source'}},proactive:{enabled:false,probability:0.25,idleThresholdMs:1800000,checkIntervalMinMs:1800000,checkIntervalMaxMs:5400000}};
const expected=['models','search','memory','persona','access','chat','desktop','onebot','tools'];
const paths=frame=>frame.locator('[data-config-path]').evaluateAll(els=>els.map(el=>el.dataset.configPath).sort());
const settle=frame=>frame.locator('body').evaluate(async()=>{
  await document.fonts.ready;let idle=0;
  // A reversed CSS animation can replace its finished promise, and releasing
  // auto height can start a final reconciliation animation. Observe real idle.
  for(let i=0;i<180;i++){await new Promise(requestAnimationFrame);if(!document.querySelector('[data-conditional-phase]')&&!document.getAnimations().some(a=>a.effect?.getTiming().iterations!==Infinity&&(a.playState==='running'||a.pending))){if(++idle===2)return;}else idle=0;}
  throw Error('Settings animations did not settle');
});
const pick=async(frame,id)=>{await frame.locator(`#settings-sidebar a[data-target="${id}"]`).click();await frame.locator(`#settings-sidebar a[data-target="${id}"].is-active`).waitFor();await settle(frame);};
const open=async(frame,id)=>{await frame.locator(`[data-settings-open="${id}"]`).click();const dialog=frame.locator(`dialog[data-settings-editor="${id}"]`);await dialog.waitFor({state:'visible'});await settle(frame);return dialog;};
const save=async qa=>{await qa.frame.locator('#save').click();await qa.frame.locator('#status').filter({hasText:'已保存'}).waitFor();await settle(qa.frame);};
const businessWrites=qa=>qa.writes.filter(row=>!['/api/console/bootstrap','/api/config/lifecycle/open'].includes(row.path));
// Captured from an actual temporary application serving the prior default
// panel; the source hash and original run live in the migration evidence.
const baselinePaths=JSON.parse(fs.readFileSync(new URL('./settings-structure-fields.json',import.meta.url),'utf8')).paths;
const qa=await modelUiFixture({config});
const searchEvidence=process.env.QA249_EVIDENCE;
async function searchShot(name){if(searchEvidence){fs.mkdirSync(searchEvidence,{recursive:true});await settle(qa.frame);await qa.page.screenshot({path:path.join(searchEvidence,name+'.png'),fullPage:true});}}
try{
  const {frame,page}=qa;
  assert.deepEqual(await frame.locator('#settings-sidebar a').evaluateAll(els=>els.map(el=>el.dataset.target)),expected);
  assert.deepEqual(await paths(frame),baselinePaths,'all previous selected config fields still exist exactly once');
  const initial=businessWrites(qa).length;
  for(const id of expected){await pick(frame,id);assert.equal(await frame.locator('#fields > .settings-section:visible').count(),1);}
  assert.equal(businessWrites(qa).length,initial,'navigation and collection do not write configuration');
  console.log('✓ nine legacy sections; complete field inventory retained; navigation writes nothing');

  await pick(frame,'models');assert.equal(await frame.locator('#base-url').isVisible(),false);
  assert.equal(await frame.locator('#provider-list').isVisible(),false);
  const model=await open(frame,'model-config');await settingsPickModel(frame,'main','a','alpha/existing');
  await model.locator('[data-settings-save]').click();await model.locator('.settings-dialog-status').filter({hasText:'已保存'}).waitFor();assert.equal(qa.disk().api.model,'alpha/existing');
  await model.locator('.settings-dialog-head button').click();
  await frame.locator('#save').click();
  assert.equal(qa.disk().api.model,'alpha/existing');assert.equal(qa.disk().providers[0].models[0].vision,true);
  await open(frame,'model-config');assert.equal(await frame.locator('#model').inputValue(),'alpha/existing');
  await frame.getByRole('button',{name:'从目录选择主模型',exact:true}).click();
  await frame.locator('dialog.model-selector').waitFor({state:'visible'});assert.equal(await frame.locator('dialog[open]').count(),2);
  await page.keyboard.press('Escape');await frame.locator('dialog.model-selector').waitFor({state:'detached'});
  assert.equal(await model.isVisible(),true);await page.keyboard.press('Escape');await model.waitFor({state:'detached'});
  const manager=await open(frame,'model-manager');assert.equal(await frame.locator('#provider-list > article').count(),2);
  const iframeBox=await page.locator('#panel-host iframe').boundingBox();await page.mouse.click(iframeBox.x+3,iframeBox.y+3);await manager.waitFor({state:'detached'});
  assert.equal(await frame.locator('#provider-list').count(),1);assert.equal(await frame.locator('#provider-list').isVisible(),false);
  console.log('✓ model configuration/catalog are dialogs; ordinary save, nested picker, Escape and backdrop preserve one real form');

  await pick(frame,'persona');assert.equal(await frame.locator('#field-persona-roleText').isVisible(),false);
  const personaToggle=frame.getByRole('switch',{name:'所有会话使用统一人设',exact:true});assert.equal(await personaToggle.getAttribute('aria-checked'),'true');assert.equal(await frame.locator('#field-personaUnified').isVisible(),false);assert.equal(await frame.locator('.persona-binding-row:visible').count(),1);assert.equal(await frame.locator('.persona-binding-row').first().getAttribute('data-persona-binding'),'global');
  await frame.getByRole('button',{name:'人设管理',exact:true}).click();const personaManager=frame.locator('dialog.persona-manager');await personaManager.locator('[data-persona-add]').waitFor();assert.equal(await personaManager.locator('[data-persona-add]').evaluate(el=>getComputedStyle(el).borderTopStyle),'dashed');await personaManager.locator('.settings-dialog-head button').click();
  await personaToggle.click();await save(qa);assert.equal(qa.disk().personaUnified,false);await frame.locator('[data-persona-binding="group:10001"]').waitFor();assert.equal(await frame.locator('#persona-by-chat-manager').isVisible(),false);assert.equal(await frame.locator('#field-persona-roleText').isVisible(),false);await searchShot('persona-per-chat');
  await personaToggle.press('Space');await save(qa);assert.equal(qa.disk().personaUnified,true);assert.equal(await frame.locator('.persona-binding-row:visible').count(),1);await personaToggle.press('Enter');await save(qa);assert.equal(qa.disk().personaUnified,false);
  await page.setViewportSize({width:560,height:900});await searchShot('persona-toggle-narrow');assert.ok(await frame.locator('body').evaluate(el=>el.ownerDocument.documentElement.scrollWidth<=el.ownerDocument.documentElement.clientWidth+1));await page.setViewportSize({width:1360,height:900});
  await frame.locator('#reload').click();await frame.locator('#status').filter({hasText:'配置已读取'}).waitFor();await pick(frame,'persona');assert.equal(await personaToggle.getAttribute('aria-checked'),'false');assert.equal(await frame.locator('#field-persona-roleText').inputValue(),'结构测试角色');await personaToggle.click();await save(qa);assert.equal(qa.disk().personaUnified,true);
  console.log('✓ persona library replaces the visible old editors; unified switch, global-first list, manager, original fields, reread and narrow layout work');

  await pick(frame,'chat');
  assert.equal(await frame.locator('#section-chat > .settings-fields > details[open]').count(),1);
  assert.equal(await frame.locator('#field-deny-groups').isVisible(),false);assert.equal(await frame.locator('#field-deny-private').isVisible(),false);
  assert.equal(await frame.locator('[data-settings-group="layout-blocklist"]').count(),0);assert.equal(await frame.locator('[data-blocklist-raw]').isVisible(),false);
  assert.equal(await frame.getByRole('button',{name:'保存原始名单',exact:true}).count(),0);assert.equal(await frame.getByRole('button',{name:'按群选择屏蔽成员',exact:true}).isVisible(),true);
  const memberEntry=frame.getByRole('button',{name:'按群选择屏蔽成员',exact:true});assert.equal(await memberEntry.evaluate(el=>el.parentElement.classList.contains('settings-fields')&&!el.closest('details')),true);
  await memberEntry.click();await frame.locator('dialog[data-blocklist-members]').waitFor({state:'visible'});await page.keyboard.press('Escape');await frame.locator('dialog[data-blocklist-members]').waitFor({state:'detached'});
  assert.equal(await frame.locator('#field-api-temperature').isVisible(),false);
  const params=await open(frame,'tier-params');await frame.locator('#field-store-historyCount').fill('0');await frame.locator('#field-store-keywords').fill('hello world\na,b');
  await params.locator('.settings-dialog-head button').click();await save(qa);
  assert.equal(qa.disk().store.historyCount,0);assert.deepEqual(qa.disk().store.keywords,['hello world','a,b']);
  const invalidEditor=await open(frame,'tier-params');await frame.locator('#field-store-historyCount').fill('-1');
  assert.equal(await frame.locator('#field-store-historyCount').getAttribute('aria-invalid'),'true');
  await qa.request('POST','/api/config',{persona:{botName:'external settings update'}});
  await invalidEditor.locator('.settings-dialog-head button').click();await open(frame,'tier-params');
  assert.equal(await frame.locator('#field-store-historyCount').inputValue(),'-1','deferred background reads preserve invalid local input');
  await frame.locator('dialog[data-settings-editor=tier-params] [data-settings-reload]').click();
  await frame.locator('dialog.confirm-panel').getByRole('button',{name:'取消',exact:true}).click();
  assert.equal(await frame.locator('#field-store-historyCount').inputValue(),'-1','cancelled explicit reread preserves invalid draft');
  await frame.locator('#field-store-historyCount').fill('0');
  await frame.locator('dialog[data-settings-editor=tier-params] [data-settings-save]').click();
  await frame.locator('dialog[data-settings-editor=tier-params] .settings-dialog-status').filter({hasText:'已保存'}).waitFor();
  await page.keyboard.press('Escape');
  assert.equal(qa.disk().persona.botName,'external settings update');assert.equal(qa.disk().store.historyCount,0);
  await frame.locator('[data-settings-group="layout-send"] > summary').click();await settle(frame);
  await frame.locator('#field-api-temperature').fill('0.4');await save(qa);assert.equal(qa.disk().api.temperature,0.4);
  await frame.locator('#reload').click();await frame.locator('#status').filter({hasText:'配置已读取'}).waitFor();
  assert.equal(await frame.locator('[data-settings-group="layout-send"]').getAttribute('open'),'');
  console.log('✓ activity is expanded; send/mute/proactive/sticker/security are collected; tier dialog saves exact values; reload keeps folds');

  await openSettingsFold(frame,'layout-proactive');await settle(frame);
  const proactiveFold=frame.locator('[data-settings-group="layout-proactive"]'),proactiveToggle=proactiveFold.getByRole('switch',{name:'启用主动开话题',exact:true}),proactiveOptions=frame.locator('#proactive-options');
  const proactivePaths=['probability','idleThresholdMs','checkIntervalMinMs','checkIntervalMaxMs'],proactiveInputs=proactivePaths.map(key=>frame.locator('#field-proactive-'+key));
  const proactiveShot=async name=>{await settle(frame);if(searchEvidence){fs.mkdirSync(searchEvidence,{recursive:true});await proactiveFold.screenshot({path:path.join(searchEvidence,name+'.png')});}};
  assert.equal(await proactiveToggle.getAttribute('aria-checked'),'false');assert.equal(await proactiveToggle.locator('input,.switch-state').count(),0);assert.equal(await frame.locator('#field-proactive-enabled').isVisible(),false);assert.equal(await proactiveOptions.locator('[data-config-path]').count(),4);for(const input of proactiveInputs)assert.equal(await input.isVisible(),false);assert.equal(await frame.locator('[data-settings-group="layout-sticker"] > summary').isVisible(),true);
  const proactiveColor=()=>proactiveToggle.evaluate(el=>{const style=getComputedStyle(el);return{border:style.borderTopColor,glow:style.boxShadow,state:style.getPropertyValue('--proactive-state').trim(),expected:style.getPropertyValue(el.getAttribute('aria-checked')==='true'?'--good':'--bad').trim()};});const proactiveOff=await proactiveColor();assert.equal(proactiveOff.state,proactiveOff.expected);assert.match(proactiveOff.glow,/inset/);await proactiveShot('proactive-disabled');
  await proactiveToggle.evaluate(el=>{window.proactiveReveal=new Promise(resolve=>el.addEventListener('click',()=>{const area=document.querySelector('#proactive-options'),samples=[];const sample=()=>{const animation=area.getAnimations().find(a=>a.animationName==='proactive-options-appear'),style=getComputedStyle(area),matrix=new DOMMatrixReadOnly(style.transform);samples.push({clip:style.clipPath,x:matrix.e,y:matrix.f,progress:animation?.effect.getComputedTiming().progress});if(animation?.playState==='running')requestAnimationFrame(sample);else resolve(samples);};requestAnimationFrame(sample);},{once:true}));});
  await proactiveToggle.click();const proactiveReveal=await proactiveToggle.evaluate(()=>window.proactiveReveal);assert.ok(proactiveReveal.length>3);assert.ok(proactiveReveal[0].y<=-13);assert.equal(proactiveReveal.at(-1).y,0);assert.equal(proactiveReveal.at(-1).progress,1);assert.ok(proactiveReveal.every((sample,i)=>sample.x===0&&(!i||sample.y>=proactiveReveal[i-1].y-.001)));assert.match(proactiveReveal[0].clip,/inset/);assert.notEqual(proactiveReveal[0].clip,proactiveReveal.at(-1).clip);if(searchEvidence)fs.writeFileSync(path.join(searchEvidence,'proactive-reveal-frames.json'),JSON.stringify(proactiveReveal,null,2));
  await save(qa);assert.equal(qa.disk().proactive.enabled,true);for(const input of proactiveInputs)assert.equal(await input.isVisible(),true);await settle(frame);const proactiveOn=await proactiveColor();assert.equal(proactiveOn.state,proactiveOn.expected);assert.notEqual(proactiveOn.border,proactiveOff.border);assert.match(proactiveOn.glow,/inset/);await proactiveShot('proactive-enabled');
  await proactiveInputs[0].fill('0.4');await save(qa);const savedProactive=qa.disk().proactive;await proactiveToggle.press('Space');await save(qa);assert.equal(qa.disk().proactive.enabled,false);assert.deepEqual({...qa.disk().proactive,enabled:true},savedProactive);for(const input of proactiveInputs)assert.equal(await input.isVisible(),false);
  await proactiveToggle.press('Enter');await save(qa);assert.equal(qa.disk().proactive.enabled,true);assert.deepEqual(await Promise.all(proactiveInputs.map(input=>input.inputValue())),['0.4','1800','1800','5400']);
  await page.emulateMedia({reducedMotion:'reduce'});await proactiveToggle.click();await proactiveToggle.click();assert.equal(await proactiveOptions.evaluate(el=>getComputedStyle(el).animationName),'none');await page.emulateMedia({reducedMotion:'no-preference'});
  await page.setViewportSize({width:560,height:900});await proactiveShot('proactive-narrow');assert.ok(await proactiveFold.evaluate(el=>el.scrollWidth<=el.clientWidth+1));assert.ok(await frame.locator('body').evaluate(el=>el.ownerDocument.documentElement.scrollWidth<=el.ownerDocument.documentElement.clientWidth+1));await page.setViewportSize({width:1360,height:900});
  await proactiveToggle.click();await save(qa);await frame.locator('#reload').click();await frame.locator('#status').filter({hasText:'配置已读取'}).waitFor();await pick(frame,'chat');assert.equal(await proactiveToggle.getAttribute('aria-checked'),'false');assert.equal(await proactiveOptions.isVisible(),false);assert.equal(await proactiveInputs[0].inputValue(),'0.4');assert.deepEqual(await paths(frame),baselinePaths);
  console.log('✓ proactive card switch hides all four options, preserves values across mouse/keyboard saves and reread; top-to-bottom reveal, reduced motion and narrow layout work');

  await pick(frame,'search');const searchToggle=frame.getByRole('switch',{name:'启用联网搜索',exact:true}),searchChoice=frame.locator('.search-source-choice');
  assert.equal(await searchToggle.getAttribute('aria-checked'),'false');assert.equal(await frame.locator('#field-webSearch-enabled').isVisible(),false);assert.equal(await frame.locator('#field-webSearch-provider').isVisible(),false);assert.equal(await frame.locator('#field-webSearch-maxResults').isVisible(),false);assert.equal(await searchChoice.isVisible(),false);
  await searchShot('search-disabled');await searchToggle.click();await save(qa);assert.equal(qa.disk().webSearch.enabled,true);assert.equal(await frame.locator('#field-webSearch-maxResults').isVisible(),true);
  await searchChoice.click();const sourcePicker=frame.locator('dialog[data-settings-editor=search-picker]');await sourcePicker.locator('[data-search-source=bocha]').click();await sourcePicker.waitFor({state:'detached'});assert.equal(await searchChoice.textContent(),'博查');await frame.locator('#field-webSearch-maxResults').fill('9');
  await frame.locator('[data-settings-open=search-manager]').click();const source=frame.locator('dialog[data-settings-editor=search-manager]');await source.locator('nav [data-search-source=bocha]').click();const sourceKey=source.locator('input[name=apiKey]');assert.equal(await source.locator('.search-source-editor input').count(),3);assert.equal(await sourceKey.inputValue(),'');
  await sourceKey.fill('synthetic-structure-secret');await source.getByRole('button',{name:'保存搜索源',exact:true}).click();await source.getByRole('status').filter({hasText:'已保存'}).waitFor();assert.equal(qa.disk().webSearch.bocha.apiKey,'synthetic-structure-secret');assert.equal(await sourceKey.inputValue(),'');assert.match(await sourceKey.getAttribute('placeholder'),/已配置/);
  for(let click=0;click<3;click++)await source.getByRole('button',{name:'清除密钥',exact:true}).click();await source.getByRole('status').filter({hasText:'密钥已清除'}).waitFor();assert.equal(qa.disk().webSearch.bocha.apiKey,'');assert.equal(await source.isVisible(),true);await page.keyboard.press('Escape');
  assert.equal(qa.disk().webSearch.provider,'bocha');assert.equal(qa.disk().webSearch.maxResults,9);await searchShot('search-enabled');const beforeSearch=qa.disk().webSearch;
  await searchToggle.press('Space');await save(qa);assert.equal(qa.disk().webSearch.enabled,false);assert.deepEqual({...qa.disk().webSearch,enabled:true},{...beforeSearch,enabled:true});assert.equal(await frame.locator('#field-webSearch-maxResults').isVisible(),false);assert.equal(await searchChoice.isVisible(),false);
  await searchToggle.press('Enter');await save(qa);assert.equal(qa.disk().webSearch.enabled,true);assert.equal(await searchChoice.textContent(),'博查');assert.equal(await frame.locator('#field-webSearch-maxResults').inputValue(),'9');
  await searchToggle.click();await save(qa);await frame.locator('#reload').click();await frame.locator('#status').filter({hasText:'配置已读取'}).waitFor();await pick(frame,'search');assert.equal(await searchToggle.getAttribute('aria-checked'),'false');assert.equal(await searchChoice.textContent(),'博查');assert.equal(await searchChoice.isVisible(),false);assert.equal(await frame.locator('#field-webSearch-provider').isVisible(),false);
  await page.setViewportSize({width:560,height:900});await searchShot('search-narrow-disabled');assert.ok(await frame.locator('body').evaluate(el=>el.ownerDocument.documentElement.scrollWidth-el.ownerDocument.documentElement.clientWidth)<=1);await page.setViewportSize({width:1360,height:900});
  console.log('✓ search card switch supports mouse/keyboard and reread; source cards and result limit persist while original fields remain bound');
  console.log('✓ unified search manager writes and clears a synthetic source key while retaining the three-field editor');
  await pick(frame,'memory');const memoryToggle=frame.getByRole('switch',{name:'自动定期记忆整理',exact:true}),cooldown=frame.locator('#memory-consolidate-cooldown'),cooldownInput=frame.locator('#field-memory-consolidateMinIntervalMs');
  assert.equal(await memoryToggle.textContent(),'自动定期记忆整理');assert.equal(await memoryToggle.getAttribute('aria-checked'),'false');assert.equal(await frame.locator('#field-memory-consolidateEnabled').isVisible(),false);assert.equal(await memoryToggle.locator('input,.switch-state').count(),0);assert.equal(await cooldown.isVisible(),false);
  const memoryColor=()=>memoryToggle.evaluate(n=>{const style=getComputedStyle(n);return{border:style.borderTopColor,glow:style.boxShadow};});const offColor=await memoryColor();assert.match(offColor.glow,/inset/);await searchShot('memory-auto-disabled');
  await memoryToggle.evaluate(n=>{window.memoryCooldownReveal=new Promise(resolve=>n.addEventListener('click',()=>{const slide=n.nextElementSibling,samples=[];const sample=()=>{const animation=slide.getAnimations().find(a=>a.animationName==='memory-cooldown-appear'),style=getComputedStyle(slide),matrix=new DOMMatrixReadOnly(style.transform);samples.push({clip:style.clipPath,x:matrix.e,y:matrix.f,progress:animation?.effect.getComputedTiming().progress});if(animation?.playState==='running')requestAnimationFrame(sample);else resolve(samples);};requestAnimationFrame(sample);},{once:true}));});
  await memoryToggle.click();const reveal=await memoryToggle.evaluate(()=>window.memoryCooldownReveal);assert.ok(reveal.length>3);assert.ok(reveal[0].x<=-17);assert.equal(reveal.at(-1).x,0);assert.equal(reveal.at(-1).progress,1);assert.ok(reveal.every((sample,i)=>sample.y===0&&(!i||sample.x>=reveal[i-1].x-0.001)));assert.notEqual(reveal[0].clip,reveal.at(-1).clip);assert.match(reveal[0].clip,/inset/);if(searchEvidence)fs.writeFileSync(path.join(searchEvidence,'memory-reveal-frames.json'),JSON.stringify(reveal,null,2));
  await save(qa);assert.equal(qa.disk().memory.consolidateEnabled,true);assert.equal(await cooldown.isVisible(),true);assert.equal(await cooldownInput.inputValue(),'60');assert.equal(await cooldownInput.getAttribute('min'),'30');assert.equal(await frame.getByRole('spinbutton',{name:'整理冷却（分钟）',exact:true}).count(),1);assert.equal(qa.disk().memory.consolidateMinIntervalMs,3600000);const onColor=await memoryColor();assert.notEqual(onColor.border,offColor.border);assert.match(onColor.glow,/inset/);const [autoBox,cooldownBox]=await Promise.all([memoryToggle.boundingBox(),cooldown.boundingBox()]);assert.ok(Math.abs(cooldownBox.x-autoBox.x-autoBox.width-12)<1);assert.ok(cooldownBox.width<=160);await searchShot('memory-auto-enabled');
  await cooldownInput.fill('29');assert.equal(await cooldownInput.getAttribute('aria-invalid'),'true');await new Promise(resolve=>setTimeout(resolve,800));assert.equal(qa.disk().memory.consolidateMinIntervalMs,3600000);await cooldownInput.fill('30');await save(qa);assert.equal(qa.disk().memory.consolidateMinIntervalMs,1800000);await cooldownInput.fill('120.5');await save(qa);assert.equal(qa.disk().memory.consolidateMinIntervalMs,7230000);const memoryBefore=qa.disk().memory;await memoryToggle.press('Space');await save(qa);assert.equal(qa.disk().memory.consolidateEnabled,false);assert.equal(await cooldown.isVisible(),false);assert.deepEqual({...qa.disk().memory,consolidateEnabled:true},{...memoryBefore,consolidateEnabled:true});await settle(frame);assert.equal((await memoryColor()).border,offColor.border);
  await memoryToggle.press('Enter');await save(qa);assert.equal(await cooldownInput.inputValue(),'120.5');assert.equal(await cooldown.isVisible(),true);
  await page.emulateMedia({reducedMotion:'reduce'});await memoryToggle.click();await memoryToggle.click();assert.equal(await cooldown.evaluate(n=>getComputedStyle(n).animationName),'none');await page.emulateMedia({reducedMotion:'no-preference'});
  await page.setViewportSize({width:560,height:900});await searchShot('memory-auto-narrow');assert.ok(await frame.locator('body').evaluate(el=>el.ownerDocument.documentElement.scrollWidth<=el.ownerDocument.documentElement.clientWidth+1));await page.setViewportSize({width:1360,height:900});
  await memoryToggle.click();await save(qa);await frame.locator('#reload').click();await frame.locator('#status').filter({hasText:'配置已读取'}).waitFor();await pick(frame,'memory');assert.equal(await memoryToggle.getAttribute('aria-checked'),'false');assert.equal(await cooldown.isVisible(),false);assert.equal(await cooldownInput.inputValue(),'120.5');assert.equal(qa.disk().memory.consolidateMinIntervalMs,7230000);assert.deepEqual(await paths(frame),baselinePaths);
  console.log('✓ automatic memory switch preserves cooldown; minutes display, 30-minute validation and fractional-minute saves round-trip to milliseconds; adjacent controls, reveal animation, reload and narrow layout work');
  const sharedToggle=frame.getByRole('switch',{name:'整理使用聊天主模型',exact:true}),memoryChoice=frame.locator('#memory-model-choice > button'),memorySlide=frame.locator('#memory-model-choice');
  const [autoHeight,sharedHeight]=await Promise.all([memoryToggle.boundingBox(),sharedToggle.boundingBox()]);assert.equal(autoHeight.height,sharedHeight.height);assert.equal(autoHeight.height,40);assert.equal(await memoryChoice.textContent(),'选择整理专用模型');
  const assertHiddenMemoryFields=async()=>{for(const id of ['useChatModel','provider','model'])assert.equal(await frame.locator('#field-memory-'+id).isVisible(),false,id);};
  assert.equal(await sharedToggle.getAttribute('aria-checked'),'true');assert.equal(await memoryChoice.isVisible(),false);assert.equal(await sharedToggle.locator('input,.switch-state').count(),0);await assertHiddenMemoryFields();await searchShot('memory-main-model');
  const sharedColor=()=>sharedToggle.evaluate(n=>{const style=getComputedStyle(n);return{border:style.borderTopColor,glow:style.boxShadow};});const sharedOn=await sharedColor();assert.match(sharedOn.glow,/inset/);
  await sharedToggle.evaluate(n=>{window.memoryModelReveal=new Promise(resolve=>n.addEventListener('click',()=>{const slide=n.nextElementSibling,samples=[];const sample=()=>{const animation=slide.getAnimations().find(a=>a.animationName==='memory-cooldown-appear'),style=getComputedStyle(slide),matrix=new DOMMatrixReadOnly(style.transform);samples.push({clip:style.clipPath,x:matrix.e,y:matrix.f,progress:animation?.effect.getComputedTiming().progress});if(animation?.playState==='running')requestAnimationFrame(sample);else resolve(samples);};requestAnimationFrame(sample);},{once:true}));});
  await sharedToggle.click();const modelReveal=await sharedToggle.evaluate(()=>window.memoryModelReveal);assert.ok(modelReveal.length>3);assert.ok(modelReveal[0].x<=-17);assert.equal(modelReveal.at(-1).x,0);assert.equal(modelReveal.at(-1).progress,1);assert.ok(modelReveal.every((sample,i)=>sample.y===0&&(!i||sample.x>=modelReveal[i-1].x-0.001)));assert.notEqual(modelReveal[0].clip,modelReveal.at(-1).clip);if(searchEvidence)fs.writeFileSync(path.join(searchEvidence,'memory-model-reveal-frames.json'),JSON.stringify(modelReveal,null,2));
  await save(qa);assert.equal(qa.disk().memory.useChatModel,false);assert.equal(await memoryChoice.isVisible(),true);await assertHiddenMemoryFields();const sharedOff=await sharedColor();assert.notEqual(sharedOff.border,sharedOn.border);assert.match(sharedOff.glow,/inset/);const [sharedBox,choiceBox]=await Promise.all([sharedToggle.boundingBox(),memoryChoice.boundingBox()]);assert.ok(Math.abs(choiceBox.x-sharedBox.x-sharedBox.width-12)<1);assert.ok(Math.abs(choiceBox.y-sharedBox.y)<1);assert.ok(choiceBox.height>=await memoryChoice.evaluate(el=>parseFloat(getComputedStyle(el).getPropertyValue('--control-height'))));await searchShot('memory-dedicated-model');
  const mainBeforeMemory=qa.disk().api;await settingsPickModel(frame,'memory','b','shared');assert.equal(qa.disk().memory.provider,'b');assert.equal(qa.disk().memory.model,'shared');assert.equal(qa.disk().memory.useChatModel,false);assert.deepEqual(qa.disk().api,mainBeforeMemory);assert.equal(await memoryChoice.textContent(),'B显示名');assert.equal(await memoryChoice.getAttribute('title'),'Channel B · shared');assert.equal((await memoryChoice.boundingBox()).height,40);await assertHiddenMemoryFields();await searchShot('memory-selected-model');
  await sharedToggle.press('Space');await save(qa);assert.equal(qa.disk().memory.useChatModel,true);assert.equal(await memoryChoice.isVisible(),false);assert.equal(qa.disk().memory.model,'shared');assert.equal(qa.disk().memory.provider,'b');await sharedToggle.press('Enter');await save(qa);assert.equal(await memoryChoice.isVisible(),true);assert.equal(qa.disk().memory.useChatModel,false);
  await page.emulateMedia({reducedMotion:'reduce'});await sharedToggle.click();await sharedToggle.click();assert.equal(await memorySlide.evaluate(n=>getComputedStyle(n).animationName),'none');await page.emulateMedia({reducedMotion:'no-preference'});
  await page.setViewportSize({width:560,height:900});await searchShot('memory-dedicated-narrow');assert.ok(await frame.locator('body').evaluate(el=>el.ownerDocument.documentElement.scrollWidth<=el.ownerDocument.documentElement.clientWidth+1));await page.setViewportSize({width:1360,height:900});await frame.locator('#save').click();await frame.locator('#reload').click();await frame.locator('#status').filter({hasText:'配置已读取'}).waitFor();await pick(frame,'memory');assert.equal(await sharedToggle.getAttribute('aria-checked'),'false');assert.equal(await memoryChoice.isVisible(),true);assert.equal(qa.disk().memory.provider,'b');assert.equal(qa.disk().memory.model,'shared');assert.equal(await memoryChoice.textContent(),'B显示名');await assertHiddenMemoryFields();assert.deepEqual(await paths(frame),baselinePaths);
  console.log('✓ memory main-model card switch reveals the dedicated selector on its right; ID inputs stay hidden, chosen route survives switching/reload, horizontal frames and reduced motion are verified');
  await pick(frame,'access');assert.equal(await frame.locator('#field-onebot-wsUrl').isVisible(),false);
  await pick(frame,'onebot');assert.equal(await frame.locator('#field-onebot-wsUrl').isVisible(),true);
  console.log('✓ current search source only; memory conditional model; independent OneBot section');

  await pick(frame,'desktop');assert.equal(await frame.locator('#field-ui-refreshMs').isVisible(),false);
  await frame.locator('[data-settings-group="layout-desktop-interface"] > summary').click();await settle(frame);
  await open(frame,'appearance');assert.equal(await frame.locator('#field-uikit-radius').isVisible(),true);
  await page.locator('#ready-model').click();await frame.locator('dialog[data-settings-editor]').waitFor({state:'detached'});await frame.locator('#settings-sidebar a[data-target=models].is-active').waitFor();
  await pick(frame,'desktop');
  await frame.locator('[data-settings-group="layout-data"] > summary').click();await settle(frame);assert.equal(await frame.locator('#reset').isVisible(),true);
  assert.equal(qa.writes.some(row=>row.path.includes('reset')),false,'viewing data controls never resets');
  await pick(frame,'tools');const preview=await open(frame,'prompt-preview');assert.equal(await frame.locator('#preview').isVisible(),true);await preview.locator('.settings-dialog-head button').click();
  assert.deepEqual(await paths(frame),baselinePaths,'open/close/reload has not removed or duplicated controls');

  await page.setViewportSize({width:560,height:820});await pick(frame,'models');const narrow=await open(frame,'model-config');
  const geometry=await narrow.evaluate(el=>({left:el.getBoundingClientRect().left,right:el.getBoundingClientRect().right,width:innerWidth,scroll:el.scrollWidth,client:el.clientWidth}));
  assert.ok(geometry.left>=0&&geometry.right<=geometry.width+1);assert.ok(geometry.scroll<=geometry.client+1);
  await page.keyboard.press('Escape');assert.deepEqual(qa.errors,[]);assert.equal(qa.outbound(),0);
  console.log('✓ appearance, data and preview remain reachable; narrow dialog fits; no page errors or external requests');
}finally{await qa.close();}

const source=fs.readFileSync(path.resolve(import.meta.dirname,'../ui/panels/settings/structure.js'),'utf8');
const replaced=await modelUiFixture({config,uiAsset:source.replace("['models','模型 API']","['models','追加层模型设置']"),uiAssetPath:'panels/settings/structure.js'});
try{
  assert.equal(await replaced.frame.locator('#settings-sidebar a[data-target=models] .channel-title').textContent(),'追加层模型设置');
  assert.equal(await replaced.frame.locator('#settings-sidebar a[data-target=chat] .channel-title').textContent(),'聊天设置');
  await open(replaced.frame,'model-config');assert.equal(await replaced.frame.locator('#model').inputValue(),'shared');assert.deepEqual(replaced.errors,[]);
}finally{await replaced.close();}
console.log('✓ one appended structure asset changes the actual default settings, keeping other controls');
const disabled=await modelUiFixture({config,uiAsset:source.replace("['models','模型 API']","['models','disabled layer must not appear']"),uiAssetPath:'panels/settings/structure.js',uiAssetEnabled:false});
try{
  assert.equal(await disabled.frame.locator('#settings-sidebar a[data-target=models] .channel-title').textContent(),'模型 API');
  assert.deepEqual(await paths(disabled.frame),baselinePaths);assert.deepEqual(disabled.errors,[]);assert.equal(disabled.outbound(),0);
}finally{await disabled.close();}
console.log('✓ disabling the appended structure restores the actual default page and all fields');
