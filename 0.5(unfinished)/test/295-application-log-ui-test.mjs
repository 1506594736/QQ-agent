// Generic application-log UI stays usable without an external process integration.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createLogStream} from '../ui/panels/logs/log-stream.js';

const read = name => fs.readFileSync(new URL(`../ui/${name}`, import.meta.url), 'utf8');

test('log panel is restricted to application logs and level settings', () => {
  const manifest = JSON.parse(read('panels/manifest.json'));
  assert.deepEqual(manifest.panels.find(panel => panel.id === 'logs').api, [
    {method:'GET',path:'/api/logs'}, {method:'POST',path:'/api/logs/level'},
  ]);
  const panel = read('panels/logs/panel.js');
  assert.deepEqual([...new Set([...panel.matchAll(/'\/api\/[^']+'/g)].map(match => match[0]))], ["'/api/logs'", "'/api/logs/level'"]);
  assert.match(read('panels/logs/index.html'), /data-panel="logs"/);
  assert.match(read('shell/sse-client.js'), /'log'/);
});

test('bounded log stream merges snapshots and live events, retains errors and disposes', async t => {
  const originals = ['requestAnimationFrame','cancelAnimationFrame'].map(key => [key,Object.getOwnPropertyDescriptor(globalThis,key)]);
  t.after(() => { for (const [key,descriptor] of originals) { if (descriptor) Object.defineProperty(globalThis,key,descriptor); else delete globalThis[key]; } });
  let sequence=0; const frames=new Map();
  globalThis.requestAnimationFrame=fn=>{frames.set(++sequence,fn);return sequence;};
  globalThis.cancelAnimationFrame=id=>frames.delete(id);
  const flush=()=>{const pending=[...frames.values()];frames.clear();for(const fn of pending)fn();};
  const node={textContent:'',scrollHeight:100,scrollTop:0,clientHeight:100};
  const stream=createLogStream(node,{format:entry=>typeof entry==='string'?entry:entry.text,limit:3});
  let resolveSnapshot;
  const snapshot=stream.refresh(()=>new Promise(resolve=>{resolveSnapshot=resolve;}));
  const first={text:'FIRST',at:1},live={text:'LIVE',at:2};
  assert.equal(stream.append(live),true);flush();assert.equal(node.textContent,'LIVE');
  resolveSnapshot({logs:[first,live]});await snapshot;flush();assert.equal(node.textContent,'FIRST\nLIVE');
  stream.append({text:'<script>inert text</script>',at:3});stream.append({text:'LATEST',at:4});flush();
  assert.equal(node.textContent,'LIVE\n<script>inert text</script>\nLATEST');
  assert.equal(stream.append({invalid:true}),false);
  await stream.refresh(async()=>{throw new Error('snapshot unavailable');});flush();
  assert.match(node.textContent,/日志快照读取失败：snapshot unavailable/);assert.match(node.textContent,/LATEST/);
  stream.append({text:'RECOVERED',at:5});flush();assert.doesNotMatch(node.textContent,/snapshot unavailable/);
  let resolveOld;const old=stream.refresh(()=>new Promise(resolve=>{resolveOld=resolve;}));
  await stream.refresh(async()=>({logs:[{text:'NEW SNAPSHOT',at:6}]}));resolveOld({logs:[{text:'STALE',at:0}]});await old;flush();assert.equal(node.textContent,'NEW SNAPSHOT');
  stream.append({text:'MUST NOT RENDER',at:7});stream.dispose();flush();assert.equal(node.textContent,'NEW SNAPSHOT');assert.equal(stream.append(live),false);assert.equal(frames.size,0);
});

test('panel loads, changes log level, follows log events and stops work on leave', async () => {
  const nodes=Object.fromEntries(['#status','#log-level','#reload','#app-log'].map(key=>[key,{value:'info',events:{},addEventListener(name,handler){this.events[name]=handler;}}]));
  const calls=[],appended=[],lifecycle={};let level='info',disposed=0,off=0;
  const context=vm.createContext({
    $:selector=>nodes[selector],dateTime:value=>String(value),
    request:async(method,path,body,query)=>{calls.push({method,path,body,query});if(method==='POST')level=body.level;return {level,logs:[]};},
    createLogStream:(node,options)=>({append:value=>appended.push(value),refresh:async read=>options.onSnapshot(await read()),dispose:()=>disposed++}),
    onShellEvent:handler=>{lifecycle.event=handler;return()=>off++;},onLeave:handler=>{lifecycle.leave=handler;},
    window:{addEventListener:(name,handler)=>{lifecycle[name]=handler;}},
  });
  vm.runInContext(read('panels/logs/panel.js').replace(/^import .*;\n/gm,''),context);
  await Promise.resolve();await Promise.resolve();
  assert.equal(calls.length,1);assert.equal(calls[0].path,'/api/logs');assert.equal(calls[0].query.limit,200);
  lifecycle.event('log',{text:'live record'});assert.equal(appended[0].text,'live record');
  lifecycle.event('status',{});assert.equal(calls.length,1);
  lifecycle.event('hello',{});await Promise.resolve();assert.equal(calls.length,2);
  nodes['#log-level'].value='warn';await nodes['#log-level'].events.change();
  assert.equal(calls.at(-2).path,'/api/logs/level');assert.equal(calls.at(-2).body.level,'warn');assert.equal(calls.at(-1).path,'/api/logs');assert.equal(nodes['#log-level'].disabled,false);
  const previous=calls.length;lifecycle.leave();lifecycle.pagehide();lifecycle.event('log',{text:'ignored'});nodes['#reload'].events.click();
  assert.equal(calls.length,previous);assert.equal(appended.length,1);assert.equal(disposed,1);assert.equal(off,1);
});
