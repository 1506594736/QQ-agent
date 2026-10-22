// Synthetic files and injected processes only. Never load a real native addon,
// enumerate QQ, inject a DLL, open an account or launch the SnowLuma entry point.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { runInNewContext } from 'node:vm';
import { inspectSnowlumaRuntime, resolveSnowlumaDirectory } from '../bundled/transport-onebot/runtime-lock.js';
import { createRealProcessAdapters } from '../bundled/transport-onebot/processes.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qqa-snow-native276-'));
let sequence = 0;
const closedNet = { createConnection() { return { once(name, fn) { if (name === 'error') queueMicrotask(() => fn(new Error('QA276_CLOSED'))); return this; }, setTimeout() {}, destroy() {} }; } };
const options = { snowlumaPlatform: 'win32', snowlumaArch: 'x64', netImpl: closedNet };
function fixture(t, { native = true, dll = true } = {}) {
  const dir = path.join(root, `中文 SnowLuma ${++sequence}`);
  fs.mkdirSync(path.join(dir, 'native'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'index.mjs'), 'const LIST_QQ_VERSION="9.9.33-51802";');
  fs.writeFileSync(path.join(dir, 'node.exe'), 'QA276_NOT_EXECUTABLE');
  if (native) fs.writeFileSync(path.join(dir, 'native', 'snowluma-win32-x64.node'), 'QA276_NOT_NATIVE');
  if (dll) fs.writeFileSync(path.join(dir, 'native', 'snowluma-win32-x64.dll'), 'QA276_NOT_DLL');
  const context = { config: { snowluma: { dir } } };
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return { dir, context };
}
function child() {
  const value = new EventEmitter();
  Object.assign(value, { pid: 276, exitCode: null, signalCode: null, stdout: new EventEmitter(), stderr: new EventEmitter() });
  value.kill = () => { value.exitCode = 0; value.emit('exit', 0); return true; };
  return value;
}
function adapter(f, extra = {}) {
  return createRealProcessAdapters({ appRoot: root, ...options, execFile() { assert.fail('No real child execution permitted'); }, spawn() { assert.fail('No real SnowLuma permitted'); }, ...extra }).snowluma;
}

test('missing addon and DLL remain native failures rather than healthy or no-QQ states', async t => {
  for (const missing of [{ native: false }, { dll: false }]) {
    const f = fixture(t, missing), a = adapter(f);
    const installed = inspectSnowlumaRuntime(f.dir, { platform: 'win32', arch: 'x64' });
    assert.equal(installed.present, true); assert.equal(installed.buildMatches, true);
    assert.equal(installed.nativePresent, false); assert.equal(installed.nativeErrorCode, 'SNOWLUMA_NATIVE_FILES_MISSING');
    const status = a.statusSync(f.context);
    assert.equal(status.nativeState, 'missing'); assert.equal(status.qqProcessState, 'unknown');
    assert.match(status.diagnosis, /原生组件不完整/);
    await assert.rejects(a.launch({}, f.context), error => error.code === 'SNOWLUMA_NATIVE_FILES_MISSING');
  }
});

test('native symlinks cannot satisfy the ordinary-file installation contract', t => {
  const f = fixture(t), addon = path.join(f.dir, 'native', 'snowluma-win32-x64.node');
  const fsImpl = Object.create(fs);
  fsImpl.lstatSync = file => file === addon ? { isSymbolicLink: () => true, isFile: () => true } : fs.lstatSync(file);
  assert.equal(inspectSnowlumaRuntime(f.dir, { fsImpl, platform: 'win32', arch: 'x64' }).nativePresent, false);
});

test('unsupported platform and architecture block before loader or entry execution', async t => {
  const f = fixture(t);
  for (const [snowlumaPlatform, snowlumaArch] of [['linux', 'x64'], ['win32', 'arm64'], ['win32', 'ia32']]) {
    const a = adapter(f, { snowlumaPlatform, snowlumaArch, nativeProbe() { assert.fail('Wrong platform must not load an addon'); } });
    assert.equal(a.statusSync(f.context).nativeState, 'unsupported');
    await assert.rejects(a.launch({}, f.context), error => error.code === 'SNOWLUMA_NATIVE_PLATFORM_UNSUPPORTED');
  }
});

test('status never loads native code and never infers QQ visibility from a running WebUI', async t => {
  const f = fixture(t);
  const html = '<title>SnowLuma 控制台</title>snowluma_ui_appearance<script type="module" src="/assets/index-qa276.js"></script>';
  const a = adapter(f, {
    nativeProbe() { assert.fail('Status cannot run a native probe'); },
    netImpl: { createConnection() { return { once(name, fn) { if (name === 'connect') queueMicrotask(fn); return this; }, setTimeout() {}, destroy() {} }; } },
    fetchImpl: async () => ({ status: 200, headers: { get: () => 'text/html' }, text: async () => html }),
  });
  const status = await a.status(f.context);
  assert.equal(status.running, true); assert.equal(status.processState, 'running');
  assert.equal(status.nativeState, 'unchecked'); assert.equal(status.qqProcessState, 'unknown');
  assert.match(status.qqProcessDiagnosis, /不代表.*QQ|未核对/);
});

test('injected native failure is classified and hides raw exceptions and credentials', async t => {
  const f = fixture(t), secret = 'QA276_SECRET_TOKEN user/private/addon.node';
  const a = adapter(f, { nativeProbe: async () => { throw new Error(secret); } });
  await assert.rejects(a.launch({}, f.context), error => error.code === 'SNOWLUMA_NATIVE_LOAD_FAILED' && !error.message.includes(secret));
  const status = a.statusSync(f.context);
  assert.equal(status.nativeState, 'load_failed'); assert.equal(status.running, false); assert.equal(status.qqProcessState, 'unknown');
  assert.doesNotMatch(JSON.stringify(status), /QA276_SECRET_TOKEN|user\/private/);
  const auto = await a.ensureAutoLaunch(f.context);
  assert.equal(auto.launched, false); assert.equal(auto.nativeState, 'load_failed'); assert.equal(auto.code, 'SNOWLUMA_NATIVE_LOAD_FAILED');
});

test('unresponsive injected loader is bounded without spawning the SnowLuma entry point', async t => {
  const f = fixture(t), a = adapter(f, { snowlumaNativeProbeTimeoutMs: 25, nativeProbe: () => new Promise(() => {}) });
  const start = Date.now();
  await assert.rejects(a.launch({}, f.context), error => error.code === 'SNOWLUMA_NATIVE_PROBE_TIMEOUT');
  assert.ok(Date.now() - start < 1000); assert.equal(a.statusSync(f.context).nativeState, 'timeout');
});

test('default preflight uses the selected bundled Node, fixed loader script and hidden bounded execution', async t => {
  const f = fixture(t), c = child(), calls = [];
  let entrySpawns = 0;
  const a = adapter(f, {
    execFile(file, args, opts, done) {
      calls.push({ file, args, opts });
      assert.equal(file, path.join(f.dir, 'node.exe')); assert.equal(args[0], '--eval');
      assert.match(args[1], /process\.dlopen/); assert.match(args[1], /typeof mod\.exports\[key\]/);
      assert.doesNotMatch(args[1], /getAllMainProcess\s*\(|loadModuleManual\s*\(|getProcesses\s*\(|index\.mjs|require\(/);
      assert.equal(args[2], path.join(f.dir, 'native', 'snowluma-win32-x64.node'));
      assert.equal(opts.windowsHide, true); assert.ok(opts.timeout > 0 && opts.timeout <= 15000);
      assert.equal(opts.env.NODE_OPTIONS, undefined); assert.equal(opts.env.NODE_PATH, undefined);
      let output = '', dlopenCalls = 0;
      const probeProcess = { platform: 'win32', arch: 'x64', argv: ['QA_ONLY_NODE', args[2]], stdout: { write(value) { output += value; } }, dlopen(mod, addon) {
        dlopenCalls++; assert.equal(addon, args[2]);
        mod.exports = Object.fromEntries(['getAllMainProcess', 'loadModuleManual', 'unloadModuleManual'].map(name => [name, () => assert.fail('Probe cannot call a native export')]));
      } };
      runInNewContext(args[1], { process: probeProcess }, { timeout: 100 });
      assert.equal(dlopenCalls, 1); assert.equal(probeProcess.exitCode, 0);
      queueMicrotask(() => done(null, output));
      return { kill() { assert.fail('Completed probe cannot be killed'); } };
    },
    spawn(file, args, opts) { entrySpawns++; assert.equal(file, path.join(f.dir, 'node.exe')); assert.deepEqual(args, [path.join(f.dir, 'index.mjs')]); assert.equal(opts.windowsHide, true); return c; },
  });
  const result = await a.launch({}, f.context);
  assert.equal(result.launched, true); assert.equal(calls.length, 1); assert.equal(entrySpawns, 1);
  assert.equal(a.statusSync(f.context).nativeState, 'ready'); assert.equal(a.statusSync(f.context).running, true);
  assert.equal(a.statusSync(f.context).qqProcessState, 'unknown');
  await a.shutdown();
});

test('default loader times out, terminates only its own probe and ignores late successful callbacks', async t => {
  const f = fixture(t); let kills = 0, callback;
  const a = adapter(f, {
    snowlumaNativeProbeTimeoutMs: 25,
    execFile(_file, _args, _opts, done) { callback = done; return { kill(signal) { assert.equal(signal, 'SIGKILL'); kills++; } }; },
  });
  await assert.rejects(a.launch({}, f.context), error => error.code === 'SNOWLUMA_NATIVE_PROBE_TIMEOUT');
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(kills, 1); callback(null, 'QQA_NATIVE_PROBE:{"ok":true}\n');
  assert.equal(a.statusSync(f.context).nativeState, 'timeout');
});

test('invalid addon or mismatched builtin Node cannot become ready through arbitrary stdout', async t => {
  const f = fixture(t);
  for (const result of [
    { error: Object.assign(new Error('QA276_PRIVATE_PATH'), { code: 'ERR_DLOPEN_FAILED' }), stdout: 'QQA_NATIVE_PROBE:{"ok":true}\n', expected: 'load_failed' },
    { error: null, stdout: 'other-process:{"ok":true}\n', expected: 'load_failed' },
    { error: Object.assign(new Error('private'), { code: 1 }), stdout: 'QQA_NATIVE_PROBE:{"ok":false,"code":"SNOWLUMA_NATIVE_PLATFORM_UNSUPPORTED"}\n', expected: 'unsupported' },
  ]) {
    const a = adapter(f, { execFile(_file, _args, _opts, done) { queueMicrotask(() => done(result.error, result.stdout)); return {}; } });
    await assert.rejects(a.launch({}, f.context));
    assert.equal(a.statusSync(f.context).nativeState, result.expected); assert.doesNotMatch(JSON.stringify(a.statusSync(f.context)), /QA276_PRIVATE_PATH/);
  }
});

test('ProcessEnumerator failures and timeouts retain unknown QQ visibility with sanitized diagnostics', async t => {
  for (const [line, code] of [
    ['[ProcessEnumerator] process enumeration cannot be isolated (addon load failed in worker): C:/private/QA276_SECRET_TOKEN', 'SNOWLUMA_PROCESS_ENUMERATION_FAILED'],
    ['[ProcessEnumerator] process enumeration timed out after 1200ms (worker abandoned)', 'SNOWLUMA_PROCESS_ENUMERATION_TIMEOUT'],
  ]) {
    const f = fixture(t), c = child(), a = adapter(f, { nativeProbe: async () => ({ ok: true }), spawn: () => c });
    await a.launch({}, f.context); c.stderr.emit('data', Buffer.from(line + '\n'));
    const status = a.statusSync(f.context);
    assert.equal(status.running, true); assert.equal(status.nativeState, 'degraded'); assert.equal(status.nativeErrorCode, code);
    assert.equal(status.qqProcessState, 'unknown'); assert.doesNotMatch(JSON.stringify(a.logs()), /QA276_SECRET_TOKEN|C:\/private/);
    await a.shutdown();
  }
});

test('a repaired loader can retry and native state does not leak between selected directories', async t => {
  const first = fixture(t), second = fixture(t), c = child(); let succeed = false, probes = 0;
  const a = adapter(first, { nativeProbe: async () => { probes++; return { ok: succeed }; }, spawn: () => c });
  await assert.rejects(a.launch({}, first.context)); assert.equal(a.statusSync(first.context).nativeState, 'load_failed');
  assert.equal(a.statusSync(second.context).nativeState, 'unchecked');
  succeed = true; await a.launch({}, first.context); assert.equal(probes, 2); assert.equal(a.statusSync(first.context).nativeState, 'ready');
  fs.unlinkSync(path.join(first.dir, 'native', 'snowluma-win32-x64.dll'));
  assert.equal(fs.existsSync(path.join(first.dir, 'native', 'snowluma-win32-x64.dll')), false);
  assert.equal(inspectSnowlumaRuntime(first.dir, { platform: 'win32', arch: 'x64' }).nativeState, 'missing');
  assert.equal(a.statusSync(first.context).nativeState, 'missing', 'Deleted native files override the last successful load check');
  await a.shutdown();
});

test('external batch launcher requires static native files and remains explicitly unchecked', async t => {
  for (const native of [false, true]) {
    const f = fixture(t, { native }); fs.unlinkSync(path.join(f.dir, 'node.exe'));
    fs.writeFileSync(path.join(f.dir, 'launcher.bat'), '@echo off');
    let spawns = 0;
    const a = adapter(f, { nativeProbe() { assert.fail('No known Node means no native loader probe'); }, spawn(file, args, opts) {
      spawns++; assert.equal(file, 'cmd.exe'); assert.deepEqual(args, ['/c', path.join(f.dir, 'launcher.bat')]); assert.equal(opts.detached, true); return child();
    } });
    if (!native) { await assert.rejects(a.launch({}, f.context), error => error.code === 'SNOWLUMA_NATIVE_FILES_MISSING'); assert.equal(spawns, 0); }
    else {
      assert.equal((await a.launch({}, f.context)).embedded, false);
      const status = a.statusSync(f.context);
      assert.equal(status.nativeState, 'unchecked'); assert.match(status.nativeDiagnosis, /外部启动方式.*尚未验证/);
      assert.equal(status.processState, 'unknown'); assert.equal(status.qqProcessState, 'unknown');
    }
  }
});

test('late native diagnostics from an old child cannot poison a newly launched runtime', async t => {
  const f = fixture(t), first = child(), second = child(); let starts = 0;
  const a = adapter(f, { nativeProbe: async () => ({ ok: true }), spawn: () => ++starts === 1 ? first : second });
  await a.launch({}, f.context); await a.shutdown(); await a.launch({}, f.context);
  first.stderr.emit('data', Buffer.from('[ProcessEnumerator] addon load failed in worker: QA276_OLD_SECRET\n'));
  assert.equal(a.statusSync(f.context).nativeState, 'ready'); assert.doesNotMatch(JSON.stringify(a.logs()), /QA276_OLD_SECRET/);
  await a.shutdown();
});

test('runtime files changing during preflight stop before the real entry point starts', async t => {
  const f = fixture(t);
  const a = adapter(f, { nativeProbe: async () => { fs.unlinkSync(path.join(f.dir, 'native', 'snowluma-win32-x64.dll')); return { ok: true }; } });
  await assert.rejects(a.launch({}, f.context), error => error.code === 'SNOWLUMA_RUNTIME_CHANGED');
  assert.equal(a.statusSync(f.context).nativeState, 'missing');
});

test('switching selected directories keeps the owned runtime separate and requires an explicit stop', async t => {
  const first = fixture(t), second = fixture(t), oldChild = child(), newChild = child();
  for (const [f, port] of [[first, 5276], [second, 6276]]) {
    fs.mkdirSync(path.join(f.dir, 'config')); fs.writeFileSync(path.join(f.dir, 'config', 'runtime.json'), JSON.stringify({ webuiHost: '127.0.0.1', webuiPort: port }));
  }
  let probes = 0, starts = 0, oldKills = 0;
  const oldKill = oldChild.kill; oldChild.kill = () => { oldKills++; return oldKill(); };
  const a = adapter(first, { nativeProbe: async () => { probes++; return { ok: true }; }, spawn: () => ++starts === 1 ? oldChild : newChild });
  await a.launch({}, first.context);
  oldChild.stdout.emit('data', Buffer.from('listening http://127.0.0.1:5276/\n'));
  assert.equal(a.statusSync(first.context).nativeState, 'ready'); assert.equal(a.statusSync(first.context).running, true);
  const canonicalContext = { config: { snowluma: { dir: path.join(first.dir, '.') } } };
  assert.equal(a.statusSync(canonicalContext).running, true, 'Equivalent canonical directory spelling remains the owned runtime');
  for (const status of [a.statusSync(second.context), await a.status(second.context), await a.ensureAutoLaunch(second.context)]) {
    assert.equal(status.running, false); assert.equal(status.processState, 'unknown'); assert.equal(status.code, 'SNOWLUMA_RUNTIME_CHANGED');
    assert.equal(status.nativeState, 'unchecked'); assert.equal(status.pid, null); assert.equal(status.webuiUrl, 'http://127.0.0.1:6276/');
    assert.match(status.diagnosis, /另一目录.*仍在运行.*停止原实例/);
  }
  await assert.rejects(a.launch({}, second.context), error => error.code === 'SNOWLUMA_RUNTIME_CHANGED');
  await assert.rejects(a.openWebui(second.context), error => error.code === 'SNOWLUMA_RUNTIME_CHANGED');
  assert.equal(starts, 1); assert.equal(probes, 1); assert.equal(oldKills, 0, 'Directory selection cannot stop or replace the owned runtime');
  oldChild.stderr.emit('data', Buffer.from('[ProcessEnumerator] process enumeration timed out after 1200ms\n'));
  oldChild.stdout.emit('data', Buffer.from('listening http://127.0.0.1:5277/\n'));
  assert.equal(a.statusSync(second.context).nativeState, 'unchecked'); assert.equal(a.statusSync(second.context).webuiUrl, 'http://127.0.0.1:6276/');
  assert.equal((await a.stop(second.context)).stopped, true); assert.equal(oldKills, 1, 'Explicit stop keeps ownership of the actual old child');
  assert.equal(a.statusSync(second.context).running, false); assert.equal(a.statusSync(second.context).code, null);
  await a.launch({}, second.context);
  oldChild.stderr.emit('data', Buffer.from('[ProcessEnumerator] native addon load failed: QA276_OLD_DIRECTORY_SECRET\n'));
  oldChild.stdout.emit('data', Buffer.from('listening http://127.0.0.1:5278/\n'));
  const current = a.statusSync(second.context);
  assert.equal(current.running, true); assert.equal(current.nativeState, 'ready'); assert.equal(current.webuiUrl, 'http://127.0.0.1:6276/');
  assert.doesNotMatch(JSON.stringify(a.logs()), /QA276_OLD_DIRECTORY_SECRET/);
  await a.shutdown();
});

test('relative configured directories resolve from appRoot and a missing explicit directory never falls back', async t => {
  const f = fixture(t), appRoot = path.join(f.dir, 'agent-program'); fs.mkdirSync(appRoot);
  const bundled = path.join(appRoot, 'snowluma'); fs.mkdirSync(path.join(bundled, 'native'), { recursive: true });
  for (const file of ['index.mjs', 'node.exe', 'native/snowluma-win32-x64.node', 'native/snowluma-win32-x64.dll']) fs.copyFileSync(path.join(f.dir, file), path.join(bundled, file));
  const context = { config: { snowluma: { dir: '..' } } }, c = child(); let starts = 0;
  const a = createRealProcessAdapters({ ...options, appRoot, nativeProbe: async request => { assert.equal(request.dir, f.dir); return { ok: true }; }, spawn(file) { starts++; assert.equal(file, path.join(f.dir, 'node.exe')); return c; } }).snowluma;
  assert.equal(resolveSnowlumaDirectory('..', { appRoot }), f.dir);
  await a.launch({}, context); assert.equal(a.statusSync(context).running, true); await a.shutdown();
  const missing = { config: { snowluma: { dir: 'selected-missing-runtime' } } };
  assert.equal(resolveSnowlumaDirectory(missing.config.snowluma.dir, { appRoot }), path.join(appRoot, 'selected-missing-runtime'));
  assert.equal(a.statusSync(missing).configured, false); assert.equal(a.statusSync(missing).nativePresent, false);
  await assert.rejects(a.launch({}, missing), /找不到 SnowLuma 目录/); assert.equal(starts, 1, 'An explicit missing installation cannot launch the bundled package');
  assert.equal(a.statusSync({}).nativePresent, true, 'The bundled package remains separately available only for an unset directory');
});

test('default archive lookup shares the app.asar.unpacked path and does not replace partial folder names', async t => {
  const f = fixture(t), appRoot = path.join(f.dir, 'resources', 'app.asar');
  const unpacked = path.join(f.dir, 'resources', 'app.asar.unpacked', 'snowluma'); fs.mkdirSync(path.join(unpacked, 'native'), { recursive: true });
  for (const file of ['index.mjs', 'node.exe', 'native/snowluma-win32-x64.node', 'native/snowluma-win32-x64.dll']) fs.copyFileSync(path.join(f.dir, file), path.join(unpacked, file));
  assert.equal(resolveSnowlumaDirectory('', { appRoot }), unpacked);
  const a = createRealProcessAdapters({ ...options, appRoot, nativeProbe: async request => { assert.equal(request.dir, unpacked); return { ok: true }; }, spawn(file) { assert.equal(file, path.join(unpacked, 'node.exe')); return child(); } }).snowluma;
  await a.launch({}, {}); assert.equal(a.statusSync({}).running, true); await a.shutdown();
  const explicit = path.join(appRoot, 'snowluma');
  assert.equal(resolveSnowlumaDirectory('snowluma', { appRoot }), explicit, 'An explicit archive path is authoritative even when only an unpacked installation exists');
  await assert.rejects(a.launch({}, { config: { snowluma: { dir: 'snowluma' } } }), /找不到 SnowLuma 目录/);
  fs.mkdirSync(explicit, { recursive: true }); assert.equal(resolveSnowlumaDirectory('', { appRoot }), explicit, 'An existing default bundled path retains its normal priority');
  const partial = path.join(f.dir, 'resources', 'app.asar-not-an-archive');
  fs.mkdirSync(path.join(f.dir, 'resources', 'app.asar.unpacked-not-an-archive', 'snowluma'), { recursive: true });
  assert.equal(resolveSnowlumaDirectory('', { appRoot: partial }), path.join(partial, 'snowluma'));
});

test('an absent default directory stays uninstalled and does not probe another service on the default port', async t => {
  const f = fixture(t), appRoot = path.join(f.dir, 'not-installed');
  assert.equal(resolveSnowlumaDirectory('', { appRoot }), path.join(appRoot, 'snowluma'));
  const a = createRealProcessAdapters({ ...options, appRoot, netImpl: { createConnection() { assert.fail('No selected installation means no unrelated WebUI probe'); } }, nativeProbe() { assert.fail('Uninstalled runtime cannot probe native code'); }, spawn() { assert.fail('Uninstalled runtime cannot launch'); } }).snowluma;
  const state = await a.status({}); assert.equal(state.running, false); assert.equal(state.configured, false); assert.equal(state.nativePresent, false);
  const auto = await a.ensureAutoLaunch({}); assert.equal(auto.launched, false); assert.equal(auto.configured, false); assert.match(auto.error, /找不到 SnowLuma 目录/);
});

for (const change of ['directory', 'stop', 'shutdown']) test(`late native preflight cannot launch after ${change} invalidates the request`, async t => {
  const first = fixture(t), second = fixture(t), context = { config: { snowluma: { dir: first.dir } } };
  let releaseProbe, enteredProbe, starts = 0;
  const entered = new Promise(resolve => { enteredProbe = resolve; });
  const deferred = new Promise(resolve => { releaseProbe = resolve; });
  const a = adapter(first, { nativeProbe: () => { enteredProbe(); return deferred; }, spawn() { starts++; return child(); }, execFile(_file, _args, _opts, done) { queueMicrotask(() => done(null, '[]')); } });
  const launching = a.launch({}, context).then(value => ({ value }), error => ({ error }));
  await entered;
  if (change === 'directory') context.config.snowluma.dir = second.dir;
  else if (change === 'stop') await a.stop(context);
  else await a.shutdown();
  releaseProbe({ ok: true }); const result = await launching;
  assert.equal(starts, 0, 'A late native check cannot spawn the old selected runtime');
  assert.equal(result.error?.code, change === 'directory' ? 'SNOWLUMA_RUNTIME_CHANGED' : 'SNOWLUMA_LAUNCH_CANCELLED');
  assert.equal(a.statusSync(context).running, false); assert.equal(a.statusSync(context).nativeState, 'unchecked');
});

for (const change of ['directory', 'stop', 'shutdown']) test(`late WebUI probe cannot begin native loading after ${change} invalidates launch`, async t => {
  const first = fixture(t), second = fixture(t), context = { config: { snowluma: { dir: first.dir } } };
  let releaseWebui, enteredWebui, connections = 0, nativeProbes = 0, starts = 0;
  const entered = new Promise(resolve => { enteredWebui = resolve; });
  const netImpl = { createConnection() {
    const firstConnection = ++connections === 1;
    if (firstConnection) enteredWebui();
    return { once(name, done) { if (name === 'error') { if (firstConnection) releaseWebui = () => done(new Error('QA276_DEFERRED_CLOSED')); else queueMicrotask(() => done(new Error('QA276_CLOSED'))); } return this; }, setTimeout() {}, destroy() {} };
  } };
  const a = adapter(first, { netImpl, nativeProbe: async () => { nativeProbes++; return { ok: true }; }, spawn() { starts++; return child(); }, execFile(_file, _args, _opts, done) { queueMicrotask(() => done(null, '[]')); } });
  const launching = a.launch({}, context).then(value => ({ value }), error => ({ error }));
  await entered;
  if (change === 'directory') context.config.snowluma.dir = second.dir;
  else if (change === 'stop') await a.stop(context);
  else await a.shutdown();
  releaseWebui(); const result = await launching;
  assert.equal(starts, 0); assert.equal(nativeProbes, 0, 'An invalidated request cannot advance from WebUI discovery to native execution');
  assert.equal(result.error?.code, change === 'directory' ? 'SNOWLUMA_RUNTIME_CHANGED' : 'SNOWLUMA_LAUNCH_CANCELLED');
});

test.after(() => { assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir())); fs.rmSync(root, { recursive: true, force: true }); });
