// Controlled lifecycle boundaries only: never run SnowLuma/QQ or inspect real accounts.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { EventEmitter } from 'node:events';
import { spawn as spawnNode, execFile as execFileNode } from 'node:child_process';
const { createRealProcessAdapters } = await import(process.env.QA157_PROCESS_MODULE || '../src/console/process-adapters.js');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qqa-snow157-'));
let sequence=0;
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const quote=value=>'"'+value+'"';
// Public v1.14.19 client/index.html has this title, appearance bootstrap key and
// module asset. This is a synthetic response, never vendor code execution.
const webuiHtml='<!doctype html><html><head><title>SnowLuma 控制台</title><script>localStorage.getItem("snowluma_ui_appearance")</script><script type="module" src="/assets/index-qa157.js"></script></head></html>';
function fixture(t,{open=false}={}){
  const dir=path.join(root,'中文 SnowLuma '+(++sequence));fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir,'index.mjs'),'const LIST_QQ_VERSION="9.9.33-51802";');fs.writeFileSync(path.join(dir,'node.exe'),'QA157_NOT_EXECUTABLE');
  fs.mkdirSync(path.join(dir,'native'));for(const ext of ['node','dll'])fs.writeFileSync(path.join(dir,'native',`snowluma-win32-x64.${ext}`),'QA157_NOT_NATIVE');
  const netImpl={createConnection(){const s={once(name,fn){if(name===(open?'connect':'error'))queueMicrotask(()=>fn(new Error('QA157_CLOSED')));return this;},setTimeout(){return this;},destroy(){}};return s;}};
  fs.mkdirSync(path.join(dir,'config'));fs.writeFileSync(path.join(dir,'config','runtime.json'),JSON.stringify({webuiHost:'127.0.0.1',webuiPort:20000+sequence}));
  const context={config:{snowluma:{dir}}};
  const fetchImpl=async()=>({status:200,headers:{get:()=> 'text/html; charset=utf-8'},text:async()=>webuiHtml});
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));return {dir,context,netImpl,fetchImpl};
}
function row(f,pid,overrides={}){const exe=path.join(f.dir,'node.exe');return {ProcessId:pid,ExecutablePath:exe,CommandLine:quote(exe)+' '+quote(path.join(f.dir,'index.mjs')),CreatedAt:'2026-10-15T02:00:00.000Z',...overrides};}
function execRows(getRows,calls=[]){return(command,args,options,callback)=>{calls.push({command,args,options});if(command!=='powershell.exe')return callback(new Error('QA157_WMIC_UNAVAILABLE'));assert.equal(options.windowsHide,true);assert.equal(options.encoding,'utf8');assert.match(args.at(-1),/Get-CimInstance/);assert.match(args.at(-1),/UTF8/);queueMicrotask(()=>callback(null,JSON.stringify(getRows())));};}
function child(pid){const c=new EventEmitter();Object.assign(c,{pid,exitCode:null,signalCode:null,killed:false,stdout:new EventEmitter(),stderr:new EventEmitter()});c.finish=()=>{c.exitCode=0;c.signalCode='SIGTERM';c.emit('exit',0,'SIGTERM');};c.kill=()=>{c.killed=true;setTimeout(c.finish,25);return true;};return c;}
const options={snowlumaStopTimeoutMs:80,snowlumaStopPollMs:5,snowlumaPlatform:'win32',snowlumaArch:'x64',nativeProbe:async()=>({ok:true})};

test('UTF8 CIM stops only exact Chinese quoted Node entry paths, including multiple selected instances',async t=>{
  const f=fixture(t),calls=[],killed=[];const valid=[row(f,301),row(f,302)];
  let rows=[...valid,row(f,401,{CommandLine:quote(path.join(f.dir,'node.exe'))+' '+quote(path.join(f.dir+'-neighbor','index.mjs'))}),row(f,402,{CommandLine:quote(path.join(f.dir,'node.exe'))+' '+quote(path.join(f.dir,'index.mjs.bak'))}),row(f,403,{CommandLine:quote(path.join(f.dir,'node.exe'))+' --eval '+quote(path.join(f.dir,'index.mjs'))}),row(f,404,{ExecutablePath:path.join(f.dir,'not-node.exe')}),row(f,405,{CommandLine:quote(path.join(f.dir,'node.exe'))+' --require '+quote(path.join(f.dir,'index.mjs'))})];
  const a=createRealProcessAdapters({...options,appRoot:root,netImpl:f.netImpl,execFile:execRows(()=>rows,calls),kill(pid){assert.ok([301,302].includes(pid));killed.push(pid);rows=rows.filter(x=>x.ProcessId!==pid);}}).snowluma;
  const r=await a.stop(f.context);assert.equal(r.ok,true);assert.equal(r.stopped,true);assert.deepEqual(killed,[301,302]);assert.deepEqual(r.pids,[301,302]);assert.equal(r.exitConfirmed,true);assert.ok(calls.length>=3);assert.equal(rows.length,5);
});
test('relative external entry without proven CWD remains alive and explicit unknown, never fake not-running',async t=>{
  const f=fixture(t,{open:true});let kills=0;const relative=row(f,501,{CommandLine:quote(path.join(f.dir,'node.exe'))+' ./index.mjs'});
  const a=createRealProcessAdapters({...options,appRoot:root,netImpl:f.netImpl,fetchImpl:f.fetchImpl,execFile:execRows(()=>[relative]),kill(){kills++;}}).snowluma;
  assert.equal((await a.status(f.context)).running,true);const r=await a.stop(f.context);assert.equal(r.ok,false);assert.equal(r.stopped,false);assert.match(r.error,/确认|相对|手工/);assert.equal(kills,0);assert.equal(a.statusSync(f.context).running,true);
});
test('discovery failure is reported instead of silent stop success',async t=>{
  const f=fixture(t,{open:true});const a=createRealProcessAdapters({...options,appRoot:root,netImpl:f.netImpl,fetchImpl:f.fetchImpl,execFile(_c,_a,_o,cb){cb(new Error('QA157_CIM_DENIED'));},kill(){assert.fail('No unproven PID may be killed');}}).snowluma;
  await a.status(f.context);const r=await a.stop(f.context);assert.equal(r.ok,false);assert.equal(r.stopped,false);assert.match(r.error,/进程|确认|查询/);assert.equal(a.statusSync(f.context).running,true);
});
test('a changed creation identity before termination cannot kill a reused PID',async t=>{
  const f=fixture(t);let reads=0,kills=0;const original=row(f,601),replacement=row(f,601,{CreatedAt:'2026-10-15T02:00:01.000Z'});
  const a=createRealProcessAdapters({...options,appRoot:root,netImpl:f.netImpl,execFile:execRows(()=>++reads===1?[original]:[replacement]),kill(){kills++;}}).snowluma;
  const r=await a.stop(f.context);assert.equal(r.ok,false);assert.equal(r.stopped,false);assert.equal(kills,0);assert.match(r.error,/变化|确认/);
});
test('external kill acceptance without disappearance is not success, and stop can be retried',async t=>{
  const f=fixture(t,{open:true});let rows=[row(f,701)],kills=0,retire=false;
  const a=createRealProcessAdapters({...options,appRoot:root,netImpl:f.netImpl,fetchImpl:f.fetchImpl,execFile:execRows(()=>rows),kill(){kills++;if(retire)rows=[];}}).snowluma;
  const failed=await a.stop(f.context);assert.equal(failed.ok,false);assert.equal(failed.stopped,false);assert.equal(a.statusSync(f.context).running,true);
  retire=true;const retried=await a.stop(f.context);assert.equal(retried.ok,true);assert.equal(retried.stopped,true);assert.equal(retried.exitConfirmed,true);assert.equal(kills,2);
});
test('embedded termination stays running until actual exit rather than the killed bit',async t=>{
  const f=fixture(t),c=child(801);const a=createRealProcessAdapters({...options,appRoot:root,netImpl:f.netImpl,spawn:()=>c,execFile(){assert.fail('Owned child stop must not discover external processes');}}).snowluma;
  await a.launch({},f.context);let settled=false;const pending=a.stop(f.context).then(x=>{settled=true;return x;});await delay(5);assert.equal(c.killed,true);assert.equal(settled,false);assert.equal(a.statusSync(f.context).running,true);
  const r=await pending;assert.equal(r.stopped,true);assert.equal(r.exitConfirmed,true);assert.equal(a.statusSync(f.context).running,false);
});
test('shutdown never targets an external process; failed owned shutdown retains its handle for retry',async t=>{
  const f=fixture(t),c=child(901);let attempts=0,executions=0;c.kill=()=>{attempts++;c.killed=true;if(attempts===2)setTimeout(c.finish,10);return true;};
  const a=createRealProcessAdapters({...options,appRoot:root,netImpl:f.netImpl,spawn:()=>c,execFile(){executions++;assert.fail('Shutdown cannot discover/kill external processes');}}).snowluma;
  assert.equal((await a.shutdown()).stopped,false);await a.launch({},f.context);await assert.rejects(a.shutdown(),/退出|停止|确认/);assert.equal(a.statusSync(f.context).pid,901);assert.equal(a.statusSync(f.context).running,true);
  const r=await a.shutdown();assert.equal(r.stopped,true);assert.equal(r.exitConfirmed,true);assert.equal(executions,0);assert.equal(attempts,2);
});
test('repeated child termination errors keep a live retryable handle and an error listener',async t=>{
  const f=fixture(t),c=child(950);c.kill=()=>{c.emit('error',new Error('QA157_SIGNAL_DENIED'));return false;};
  const a=createRealProcessAdapters({...options,appRoot:root,netImpl:f.netImpl,spawn:()=>c}).snowluma;await a.launch({},f.context);
  for(let attempt=0;attempt<2;attempt++){const r=await a.stop(f.context);assert.equal(r.ok,false);assert.equal(r.stopped,false);assert.equal(a.statusSync(f.context).running,true);assert.equal(a.statusSync(f.context).pid,950);}
  c.kill=()=>{c.finish();return true;};assert.equal((await a.stop(f.context)).stopped,true);
});
test('late exit after stop timeout clears only that owned error and permits a new launch',async t=>{
  const f=fixture(t),first=child(970),second=child(971);let starts=0;
  first.kill=()=>{first.killed=true;setTimeout(first.finish,120);return true;};
  const a=createRealProcessAdapters({...options,appRoot:root,netImpl:f.netImpl,spawn:()=>++starts===1?first:second}).snowluma;
  await a.launch({},f.context);assert.equal((await a.stop(f.context)).ok,false);await delay(65);
  assert.equal(a.statusSync(f.context).running,false);await a.launch({},f.context);assert.equal(starts,2);assert.equal(a.statusSync(f.context).pid,971);assert.equal((await a.stop(f.context)).stopped,true);
});
test('healthy DTO explicitly replaces unknown after discovery recovery and on subsequent start/exit',async t=>{
  const f=fixture(t);let denied=true;const c=child(980);
  const execFile=(command,args,opts,cb)=>denied?cb(new Error('QA157_TEMPORARY_CIM_FAILURE')):execRows(()=>[])(command,args,opts,cb);
  const a=createRealProcessAdapters({...options,appRoot:root,netImpl:f.netImpl,execFile,spawn:()=>c}).snowluma;
  assert.equal((await a.stop(f.context)).ok,false);assert.equal(a.statusSync(f.context).processState,'unknown');
  denied=false;assert.equal((await a.stop(f.context)).ok,true);assert.equal(a.statusSync(f.context).processState,'stopped');assert.equal((await a.status(f.context)).processState,'stopped');
  await a.launch({},f.context);assert.equal(a.statusSync(f.context).processState,'running');assert.equal((await a.status(f.context)).processState,'running');
  await a.stop(f.context);assert.equal(a.statusSync(f.context).processState,'stopped');
});

test('changing the selected directory does not relabel an owned child and shutdown keeps its original ownership',async t=>{
  const first=fixture(t),second=fixture(t),oldChild=child(981),newChild=child(982);let starts=0,probes=0;
  const context={config:{snowluma:{dir:first.dir}}};
  const a=createRealProcessAdapters({...options,appRoot:root,netImpl:first.netImpl,nativeProbe:async()=>{probes++;return {ok:true};},spawn:()=>++starts===1?oldChild:newChild,execFile(){assert.fail('Owned shutdown cannot discover other processes');}}).snowluma;
  await a.launch({},context);assert.equal(a.statusSync(context).running,true);
  context.config.snowluma.dir=second.dir;
  const changed=await a.status(context);assert.equal(changed.running,false);assert.equal(changed.processState,'unknown');assert.equal(changed.code,'SNOWLUMA_RUNTIME_CHANGED');assert.equal(changed.nativeState,'unchecked');
  const auto=await a.ensureAutoLaunch(context);assert.equal(auto.launched,false);assert.equal(auto.code,'SNOWLUMA_RUNTIME_CHANGED');assert.equal(starts,1);assert.equal(probes,1);assert.equal(oldChild.killed,false);
  assert.equal((await a.shutdown()).stopped,true);assert.equal(oldChild.killed,true);assert.equal(newChild.killed,false);
  await a.launch({},context);oldChild.stderr.emit('data',Buffer.from('[ProcessEnumerator] addon load failed in worker: QA157_OLD_ONLY\n'));
  assert.equal(a.statusSync(context).nativeState,'ready');assert.equal(a.statusSync(context).pid,982);assert.equal((await a.shutdown()).stopped,true);
});
async function listener(t,f){
  let body='unrelated service',type='text/plain',status=200,stall=false,hits=0;const sockets=new Set();
  const server=http.createServer((_req,res)=>{hits++;if(stall)return;res.writeHead(status,{'content-type':type});res.end(body);});
  server.on('connection',socket=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket));});
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const port=server.address().port;fs.writeFileSync(path.join(f.dir,'config','runtime.json'),JSON.stringify({webuiHost:'127.0.0.1',webuiPort:port}));
  let closed=false;const close=async()=>{if(closed)return;closed=true;for(const socket of sockets)socket.destroy();await new Promise(resolve=>server.close(resolve));};t.after(close);
  return {set(b,m='text/html',s=200){body=b;type=m;status=s;stall=false;},stall(){stall=true;},hits:()=>hits,close};
}
test('default factory verifies actual loopback HTTP identity, rejects unrelated responses and recovers explicitly',async t=>{
  const f=fixture(t),s=await listener(t,f);let starts=0;
  const a=createRealProcessAdapters({appRoot:root,spawn(){starts++;assert.fail('Status cannot execute a vendor');}}).snowluma;
  for(const [body,type,status] of [['unrelated plain service','text/plain',200],['<!doctype html><title>Unrelated console</title>','text/html',200],['{"status":"running"}','application/json',200],['<title>SnowLuma 控制台</title>','text/html',200],[webuiHtml,'text/html',401],[webuiHtml,'text/html',302],[webuiHtml.repeat(400),'text/html',200]]){
    s.set(body,type,status);const r=await a.status(f.context);assert.equal(r.running,false,'An occupied port or generic brand text cannot prove SnowLuma');assert.equal(r.processState,'unknown');assert.match(r.diagnosis,/确认|占用|识别/);assert.equal(a.statusSync(f.context).processState,'unknown');
  }
  assert.ok(s.hits()>=7,'Default production dependency performs real HTTP probes');
  s.set(webuiHtml);const ready=await a.status(f.context);assert.equal(ready.running,true);assert.equal(ready.processState,'running');assert.equal(ready.diagnosis,null);assert.equal(a.statusSync(f.context).processState,'running');
  await s.close();const stopped=await a.status(f.context);assert.equal(stopped.running,false);assert.equal(stopped.processState,'stopped');assert.equal(stopped.diagnosis,null);assert.equal(a.statusSync(f.context).processState,'stopped');assert.equal(starts,0);
});
test('unidentified occupied loopback port blocks launch and never authorizes stopping another process',async t=>{
  const f=fixture(t),s=await listener(t,f);let starts=0,kills=0;
  const a=createRealProcessAdapters({...options,appRoot:root,spawn(){starts++;return child(990);},execFile:execRows(()=>[]),kill(){kills++;}}).snowluma;
  const state=await a.status(f.context);assert.equal(state.processState,'unknown');
  await assert.rejects(a.launch({},f.context),/占用|确认/);assert.equal(starts,0,'Unknown occupied WebUI cannot spawn into the same port');
  const auto=await a.ensureAutoLaunch(f.context);assert.equal(auto.launched,false);assert.match(auto.error,/占用|确认/);assert.equal(starts,0);
  const stop=await a.stop(f.context);assert.equal(stop.ok,false);assert.equal(stop.stopped,false);assert.equal(kills,0,'HTTP response is not permission or PID evidence to kill');
  await s.close();assert.equal((await a.stop(f.context)).ok,true);assert.equal(a.statusSync(f.context).processState,'stopped');assert.equal(a.statusSync(f.context).diagnosis,null);
});
test('unavailable HTTP identity and stalled loopback response remain bounded unknown, then recover',async t=>{
  const f=fixture(t),s=await listener(t,f);s.set(webuiHtml);
  const unavailable=createRealProcessAdapters({appRoot:root,fetchImpl:null}).snowluma;
  const noHttp=await unavailable.status(f.context);assert.equal(noHttp.running,false);assert.equal(noHttp.processState,'unknown');assert.match(noHttp.diagnosis,/确认|核实|识别/);
  s.stall();const a=createRealProcessAdapters({appRoot:root}).snowluma,started=Date.now();const uncertain=await a.status(f.context);
  assert.equal(uncertain.running,false);assert.equal(uncertain.processState,'unknown');assert.ok(Date.now()-started<6000,'Bounded probe cannot wait indefinitely');
  s.set(webuiHtml);const healthy=await a.status(f.context);assert.equal(healthy.running,true);assert.equal(healthy.processState,'running');assert.equal(healthy.diagnosis,null);
});
test('producer publishes shutdown uncertainty and a real owned late exit using its launch context',async t=>{
  const f=fixture(t),entry=path.join(f.dir,'canonical-owned-helper.mjs'),events=[];
  fs.writeFileSync(entry,'// QA157 owned harmless helper, not SnowLuma.\nprocess.on("message",m=>{if(m==="exit")process.exit(0)});console.log("QA157_CANONICAL_READY");setInterval(()=>{},1000);');
  let helper,exited=false,exitReceipt,originalKill;
  const a=createRealProcessAdapters({...options,appRoot:root,netImpl:f.netImpl,emit(name,payload){events.push({name,payload:structuredClone(payload)});},
    spawn(){helper=spawnNode(process.execPath,[entry],{cwd:f.dir,windowsHide:true,stdio:['ignore','pipe','pipe','ipc']});originalKill=helper.kill.bind(helper);exitReceipt=new Promise(resolve=>helper.once('exit',()=>{exited=true;resolve();}));
      // Inject signal acknowledgement; the real child exits voluntarily later.
      // This proves event delivery after actual exit, not Windows delayed signals.
      helper.kill=()=>{helper.killed=true;return true;};return helper;},execFile(){assert.fail('Owned shutdown cannot inspect other processes');}}).snowluma;
  try{
    await a.launch({},f.context);await new Promise((resolve,reject)=>{helper.once('error',reject);helper.stdout.once('data',data=>{assert.match(data.toString(),/QA157_CANONICAL_READY/);resolve();});});
    await assert.rejects(a.shutdown(),/退出|停止|确认/);
    const uncertain=events.at(-1);assert.equal(uncertain.name,'snowluma.status');assert.equal(uncertain.payload.processState,'unknown');assert.equal(uncertain.payload.running,true);assert.equal(uncertain.payload.configured,true,'Shutdown must retain the actual owned launch directory without a caller context');assert.match(uncertain.payload.diagnosis,/未确认/);
    helper.send('exit');await exitReceipt;const final=events.at(-1);assert.equal(final.name,'snowluma.status');assert.equal(final.payload.running,false);assert.equal(final.payload.processState,'stopped');assert.equal(final.payload.diagnosis,null);assert.equal(final.payload.pid,null);assert.equal(final.payload.configured,true);assert.equal(a.statusSync(f.context).processState,'stopped');
  }finally{if(helper&&!exited){try{helper.send('exit');}catch{originalKill('SIGTERM');}await exitReceipt;}}
});
test('confirmed external exit publishes the complete stopped snapshot without a wrapper child event',async t=>{
  const f=fixture(t),events=[];let rows=[row(f,1150)];
  const a=createRealProcessAdapters({...options,appRoot:root,netImpl:f.netImpl,execFile:execRows(()=>rows),kill(pid){assert.equal(pid,1150);rows=[];},emit(name,payload){events.push({name,payload:structuredClone(payload)});}}).snowluma;
  const stopped=await a.stop(f.context);assert.equal(stopped.ok,true);assert.equal(stopped.exitConfirmed,true);assert.equal(rows.length,0);
  assert.equal(events.length,1);const event=events[0];assert.equal(event.name,'snowluma.status');assert.equal(event.payload.running,false);assert.equal(event.payload.processState,'stopped');assert.equal(event.payload.configured,true);assert.equal(event.payload.diagnosis,null);assert.equal(event.payload.pid,null);
});
test('not-running retry publishes recovery while preserving a new installation diagnosis',async t=>{
  const f=fixture(t),events=[];let portOpen=true;
  const mutableNet={createConnection(){return {once(name,fn){if(name===(portOpen?'connect':'error'))queueMicrotask(()=>fn(new Error('QA closed')));return this;},setTimeout(){},destroy(){}};}};
  const a=createRealProcessAdapters({...options,appRoot:root,netImpl:mutableNet,fetchImpl:f.fetchImpl,execFile:execRows(()=>[]),kill(){assert.fail('An unconfirmed external instance cannot be killed');},emit(name,payload){events.push({name,payload:structuredClone(payload)});}}).snowluma;
  assert.equal((await a.stop(f.context)).ok,false);assert.equal(events.at(-1)?.payload.processState,'unknown');assert.match(events.at(-1).payload.diagnosis,/确认/);
  portOpen=false;fs.writeFileSync(path.join(f.dir,'index.mjs'),'const LIST_QQ_VERSION="9.9.32-11111";');
  const retry=await a.stop(f.context);assert.equal(retry.ok,true);assert.equal(retry.reason,'not_running');
  const event=events.at(-1);assert.equal(event.name,'snowluma.status');assert.equal(event.payload.running,false);assert.equal(event.payload.processState,'stopped');assert.equal(event.payload.configured,true);assert.equal(event.payload.versionVerified,false);assert.match(event.payload.diagnosis,/声明|锁定/);assert.doesNotMatch(event.payload.diagnosis,/未确认|无法确认/);
});
test('Windows actual CIM Unicode metadata and exit receipt use only one owned harmless Node helper',{skip:process.platform!=='win32'},async t=>{
  const f=fixture(t),entry=path.join(f.dir,'index.mjs');
  fs.writeFileSync(entry,'// QA157 harmless helper, not SnowLuma.\nconsole.log("QA157_READY");setInterval(()=>{},1000);');
  const helper=spawnNode(process.execPath,[entry],{cwd:f.dir,windowsHide:true,stdio:['ignore','pipe','pipe']});
  let exited=false;helper.once('exit',()=>{exited=true;});
  const exitReceipt=new Promise(resolve=>helper.once('exit',resolve));
  try {
  await new Promise((resolve,reject)=>{helper.once('error',reject);helper.stdout.once('data',data=>{assert.match(data.toString(),/QA157_READY/);resolve();});});
  const execOnlyOwned=(command,args,opts,callback)=>{
    if(command!=='powershell.exe')return callback(new Error('QA157 only owned CIM query is permitted'));
    const narrowed=args.map(arg=>String(arg).replace("Name='node.exe'","Name='node.exe' AND ProcessId="+helper.pid));
    assert.ok(narrowed.at(-1).includes('ProcessId='+helper.pid));execFileNode(command,narrowed,opts,callback);
  };
  const a=createRealProcessAdapters({appRoot:root,netImpl:f.netImpl,execFile:execOnlyOwned,kill(pid,signal){assert.equal(pid,helper.pid);return helper.kill(signal);},snowlumaStopTimeoutMs:5000,snowlumaStopPollMs:20}).snowluma;
  const r=await a.stop(f.context);assert.equal(r.ok,true);assert.equal(r.stopped,true);assert.equal(r.exitConfirmed,true);assert.equal(r.pid,helper.pid);await exitReceipt;assert.equal(exited,true);
  } finally { if(!exited){helper.kill('SIGTERM');await exitReceipt;} }
});
test.after(()=>{assert.equal(path.dirname(path.resolve(root)),path.resolve(os.tmpdir()));fs.rmSync(root,{recursive:true,force:true});});
