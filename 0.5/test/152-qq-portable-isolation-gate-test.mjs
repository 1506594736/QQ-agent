// Synthetic program files and injected process discovery only; never executes QQ.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { createHttpServer } from '../src/kernel/http.js';
import { createConfig, buildDefaultConfig } from '../src/kernel/config.js';
import { registerConsoleRoutes } from '../src/console/routes.js';

const adapterIndex = process.argv.indexOf('--adapter');
const adapterFile = adapterIndex < 0 ? path.resolve('bundled/transport-onebot/processes.js') : path.resolve(process.argv[adapterIndex + 1]);
const { createRealProcessAdapters } = await import(pathToFileURL(adapterFile));
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qqa-qq-isolation152-'));
const hash = value => createHash('sha256').update(value).digest('hex');
const log = { error() {}, warn() {}, info() {} };
let passed = 0, failed = 0;
const check = (name, fn) => { try { fn(); passed++; console.log('PASS ' + name); } catch (error) { failed++; console.error('FAIL ' + name + ': ' + error.message); } };
const fakeChild = () => ({ pid: 152, exitCode: null, stdout: { on() {} }, stderr: { on() {} }, once() {}, unref() {}, kill() {} });
const program = (name, { build = '51802', proof = true } = {}) => {
  const appRoot = path.join(root, name), dir = path.join(appRoot, 'runtime/qq-portable');
  const resource = path.join(dir, `versions/9.9.33-${build}/resources/app`);
  fs.mkdirSync(resource, { recursive: true });
  const exeBytes = Buffer.from('QA_ONLY_SYNTHETIC_QQ152_' + name), pkgBytes = Buffer.from(JSON.stringify({ version: `9.9.33-${build}`, buildVersion: build }));
  fs.writeFileSync(path.join(dir, 'QQ.exe'), exeBytes); fs.writeFileSync(path.join(resource, 'package.json'), pkgBytes);
  // Vendor metadata is untrusted for launch isolation even if it asserts it.
  fs.writeFileSync(path.join(dir, 'portable-info.json'), JSON.stringify({ qqVersion: '9.9.33-51802', isolationVerified: true, note: '--user-data-dir guarantees complete isolation' }));
  if (proof) fs.writeFileSync(path.join(dir, 'qq-agent-install.json'), JSON.stringify({ schema: 1, kind: 'qq', version: '9.9.33.51802', archiveSha256: hash('QA_ONLY_ARCHIVE'), source: { type: 'verified-archive' }, launchIsolation: { verified: true, status: 'verified' }, files: { 'QQ.exe': hash(exeBytes), [`versions/9.9.33-${build}/resources/app/package.json`]: hash(pkgBytes) } }));
  return { appRoot, dir, exe: path.join(dir, 'QQ.exe'), profile: path.join(appRoot, 'runtime/qq-portable-data') };
};
const adapterFor = (fixture, discovery = []) => {
  const effects = { spawns: [], kills: [], mkdirs: [], discoveries: 0 };
  const fsImpl = Object.create(fs);
  fsImpl.mkdirSync = (file, ...args) => { effects.mkdirs.push(String(file)); return fs.mkdirSync(file, ...args); };
  const processes = discovery;
  const adapters = createRealProcessAdapters({ appRoot: fixture.appRoot, fsImpl, log,
    spawn(file, args, options) { effects.spawns.push({ file, args, options }); return fakeChild(); },
    execFile(_file, _args, _options, done) { effects.discoveries++; done(null, JSON.stringify(processes), ''); },
    kill(pid, signal) { effects.kills.push({ pid, signal }); const index = processes.findIndex(item => item.ProcessId === pid); if (index >= 0) processes.splice(index, 1); },
  });
  return { qq: adapters.qqPortable, effects, processes };
};
let http;
try {
  const verified = program('verified'), { qq, effects } = adapterFor(verified);
  const before = qq.statusSync();
  check('verified installation retained', () => assert.equal(before.installationVerified, true));
  check('matching version retained', () => assert.equal(before.versionVerified, true));
  check('installation separately ready', () => assert.equal(before.installedReady, true));
  check('portable executable readiness blocked', () => assert.equal(before.ready, false));
  check('portable launch disallowed', () => assert.equal(before.launchAllowed, false));
  check('code-owned isolation is unverified', () => assert.deepEqual({ status: before.launchIsolation?.status, verified: before.launchIsolation?.verified }, { status: 'unverified', verified: false }));
  check('installation diagnosis remains clear', () => assert.equal(before.installationDiagnosis, null));
  check('actionable isolation reason visible', () => assert.match(before.diagnosis || '', /独立数据目录.*暂停便携启动/));
  const result = await qq.launch({ isolated: true, isolationVerified: true, allowUnverified: true, env: { APPDATA: verified.profile }, launchIsolation: { verified: true } }, { config: { qqPortable: { isolationVerified: true }, launchIsolation: { verified: true } } });
  check('valid archive still returns explicit refusal', () => assert.equal(result.ok, false));
  check('isolation refusal uses 409', () => assert.equal(result.status, 409));
  check('isolation refusal identifies contract', () => assert.equal(result.code, 'QQ_LAUNCH_ISOLATION_UNVERIFIED'));
  check('no process spawn on unverified launch', () => assert.equal(effects.spawns.length, 0));
  check('no profile directory created', () => assert.equal(fs.existsSync(verified.profile), false));
  check('no directory write on launch refusal', () => assert.equal(effects.mkdirs.length, 0));
  check('no process discovery needed for launch refusal', () => assert.equal(effects.discoveries, 0));

  const localCopy = program('manual-copy', { proof: false }), manual = adapterFor(localCopy);
  const manualState = manual.qq.statusSync();
  check('local copy remains version known', () => assert.equal(manualState.versionVerified, true));
  check('local copy never labelled archive verified', () => assert.equal(manualState.installationVerified, false));
  check('local copy launch blocked', () => assert.equal(manualState.ready, false));
  const manualLaunch = await manual.qq.launch();
  check('local copy cannot bypass isolation policy', () => assert.equal(manualLaunch.status, 409));
  check('local copy no spawn/profile', () => { assert.equal(manual.effects.spawns.length, 0); assert.equal(fs.existsSync(localCopy.profile), false); });

  fs.appendFileSync(verified.exe, '-QA_ONLY_TAMPER');
  const invalid = qq.statusSync(), invalidLaunch = await qq.launch();
  check('tampered installation proof remains rejected', () => assert.equal(invalid.installationVerified, false));
  check('tampered installation separately not ready', () => assert.equal(invalid.installedReady, false));
  check('installation error takes precedence', () => assert.match(invalidLaunch.error || '', /安装证明失效/));
  check('tampered program no spawn', () => assert.equal(effects.spawns.length, 0));

  const wrong = program('wrong-build', { build: '52230', proof: false }), wrongAdapter = adapterFor(wrong);
  check('wrong version stays nonready', () => assert.equal(wrongAdapter.qq.statusSync().versionVerified, false));
  const wrongLaunch = await wrongAdapter.qq.launch();
  check('wrong version refusal remains specific', () => assert.match(wrongLaunch.error || '', /锁定版本.*51802/));

  const stopping = program('owned-stop'), otherExe = path.join(root, 'daily-qq/QQ.exe');
  const owned = adapterFor(stopping, [{ ProcessId: 999, ExecutablePath: otherExe, CommandLine: 'QA_ONLY_OTHER_INSTANCE' }, { ProcessId: 1524, ExecutablePath: stopping.exe, CreationDate: '2026-10-14T21:00:00.000Z', CreationTimeTicks: '134049492000000000', CommandLine: 'QA_ONLY_OWNED_INSTANCE' }]);
  const running = await owned.qq.status();
  check('owned process discovery still works', () => { assert.equal(running.running, true); assert.equal(running.pid, 1524); });
  check('running never bypasses launch isolation', () => assert.equal(running.launchAllowed, false));
  const stopped = await owned.qq.stop();
  check('existing exact-path process remains stoppable', () => { assert.equal(stopped.stopped, true); assert.equal(stopped.pid, 1524); });
  check('daily QQ never killed', () => assert.deepEqual(owned.effects.kills, [{ pid: 1524, signal: 'SIGTERM' }]));
  check('other process remains present', () => assert.deepEqual(owned.processes.map(item => item.ProcessId), [999]));
  const stoppedState = await owned.qq.status(), repeatedStop = await owned.qq.stop();
  check('owned status resolves stopped', () => assert.equal(stoppedState.running, false));
  check('repeat stop safely does nothing', () => assert.equal(repeatedStop.stopped, false));

  const routed = program('route'), routedAdapter = adapterFor(routed), dataDir = path.join(root, 'route-config');
  const config = createConfig({ dataDir, defaults: buildDefaultConfig(), log }); config.load(); config.update({ server: { port: 0, token: 'qa152-loopback-token' } });
  http = createHttpServer({ config, log, staticDir: root });
  const noops = { status: () => ({}), listEntries: () => [], promptSections: () => [] };
  registerConsoleRoutes(http, { config, sessions: noops, store: noops, loader: noops, orchestrator: noops, dataDir, log, processAdapters: { qqPortable: routedAdapter.qq } });
  const port = await http.listen();
  const api = async (pathname, method = 'GET') => { const response = await fetch(`http://127.0.0.1:${port}${pathname}`, { method, headers: { 'x-console-token': 'qa152-loopback-token', 'content-type': 'application/json' }, ...(method === 'POST' ? { body: '{"isolated":true,"isolationVerified":true}' } : {}) }); return { status: response.status, body: await response.json() }; };
  const routeLaunch = await api('/api/qq-portable/launch', 'POST');
  check('production launch route preserves refusal status', () => assert.equal(routeLaunch.status, 409));
  check('production launch route cannot claim success', () => { assert.notEqual(routeLaunch.body.ok, true); assert.notEqual(routeLaunch.body.launching, true); });
  check('production route exposes understandable reason', () => assert.match(routeLaunch.body.error || '', /独立数据目录.*暂停便携启动/));
  const routeStatus = await api('/api/qq-portable/status');
  check('status route retains installation evidence', () => { assert.equal(routeStatus.body.installedReady, true); assert.equal(routeStatus.body.installationVerified, true); });
  check('status route retains isolation refusal', () => { assert.equal(routeStatus.body.launchAllowed, false); assert.equal(routeStatus.body.launchIsolation?.verified, false); assert.match(routeStatus.body.diagnosis || '', /暂停便携启动/); });
  check('loopback launch causes no spawn or profile', () => { assert.equal(routedAdapter.effects.spawns.length, 0); assert.equal(fs.existsSync(routed.profile), false); });
} finally {
  if (http) await http.close();
  assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()));
  fs.rmSync(root, { recursive: true, force: true });
}
console.log(JSON.stringify({ test: '152-qq-portable-isolation-gate', passed, failed, realQqExecuted: false, osSettingsModified: false }));
if (failed) process.exitCode = 1;
