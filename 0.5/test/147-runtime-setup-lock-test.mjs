// Only synthetic archives/files and loopback/injected HTTP; never launches QQ.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { deflateRawSync } from 'node:zlib';
import { createRealProcessAdapters } from '../bundled/transport-onebot/processes.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qqa-setup147-'));
try {
  const wrongDir = path.join(root, 'runtime', 'qq-portable');
  fs.mkdirSync(path.join(wrongDir, 'versions', '9.9.33-52230'), { recursive: true });
  fs.writeFileSync(path.join(wrongDir, 'QQ.exe'), 'QA_ONLY_PROGRAM');
  const adapter = createRealProcessAdapters({ appRoot: root, execFile(_file, _args, _options, done) { done(null, '[]', ''); }, spawn() { throw new Error('must not launch any real process'); } });
  assert.equal((await adapter.qqPortable.status()).ready, false, 'a known wrong QQ build must not be presented as ready');
  const denied = await adapter.qqPortable.launch();
  assert.equal(denied.ok, false, 'a known wrong QQ build must be blocked before spawn');
  assert.match(denied.error, /9\.9\.33[.-]51802/);
  console.log('147 baseline: wrong QQ build rejected before launch');
  const unknownGateRoot = path.join(root, 'unknown-gate'), unknownGateDir = path.join(unknownGateRoot, 'runtime', 'qq-portable'); fs.mkdirSync(unknownGateDir, { recursive: true }); fs.writeFileSync(path.join(unknownGateDir, 'QQ.exe'), 'QA_ONLY_UNKNOWN_VERSION');
  let unknownSpawns = 0; const unknownGate = createRealProcessAdapters({ appRoot: unknownGateRoot, execFile(_file, _args, _options, done) { done(null, '[]', ''); }, spawn() { unknownSpawns++; return { pid: 147, once() {}, unref() {} }; } });
  assert.equal(unknownGate.qqPortable.statusSync().ready, false, 'unknown QQ version must not be ready');
  assert.equal((await unknownGate.qqPortable.launch()).ok, false, 'unknown QQ version must fail before spawn'); assert.equal(unknownSpawns, 0);
  const unknownSnow = path.join(unknownGateRoot, 'snowluma'); fs.mkdirSync(unknownSnow); fs.writeFileSync(path.join(unknownSnow, 'node.exe'), 'QA_ONLY_NODE'); fs.writeFileSync(path.join(unknownSnow, 'index.mjs'), 'QA_ONLY_UNKNOWN_HANDSHAKE');
  const unknownSnowGate = createRealProcessAdapters({ appRoot: unknownGateRoot, netImpl: { createConnection() { return { once(name, done) { if (name === 'error') queueMicrotask(() => done(new Error('closed'))); return this; }, setTimeout() {}, destroy() {} }; } }, spawn() { unknownSpawns++; return { pid: 147, once() {}, unref() {} }; } });
  await assert.rejects(unknownSnowGate.snowluma.launch({}, {}), /版本未知/); assert.equal(unknownSpawns, 0);
  console.log('147 version lock: unknown QQ/SnowLuma identities blocked with zero spawn');
  const { installRuntime: realInstall, checkRuntime, ownedPath } = await import('../scripts/lib/runtime-installer.mjs');
  const installRuntime = options => realInstall({ isRunning: () => false, ...options });
  const { download, verifyArchive } = await import('../scripts/lib/download.mjs');
  const { inspectRuntimeArchive } = await import('../scripts/lib/runtime-archive.mjs');
  const { runSetup } = await import('../scripts/setup.mjs');
  const { RUNTIME_DOWNLOADS, RUNTIME_PROOF_FILE, inspectQqRuntime, inspectSnowlumaRuntime } = await import('../bundled/transport-onebot/runtime-lock.js');
  const hash = bytes => createHash('sha256').update(bytes).digest('hex');
  function crc32(bytes) { let value = 0xffffffff; for (const byte of bytes) { value ^= byte; for (let i = 0; i < 8; i++) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0); } return (value ^ 0xffffffff) >>> 0; }
  function zip(files, { mode = 0x8000, deflate = false } = {}) {
    const locals = [], centers = []; let offset = 0;
    for (const [name, content] of Object.entries(files)) {
      const filename = Buffer.from(name), bytes = Buffer.from(content), crc = crc32(bytes), packed = deflate ? deflateRawSync(bytes) : bytes;
      const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4); local.writeUInt16LE(deflate ? 8 : 0, 8); local.writeUInt32LE(crc, 14); local.writeUInt32LE(packed.length, 18); local.writeUInt32LE(bytes.length, 22); local.writeUInt16LE(filename.length, 26);
      locals.push(local, filename, packed);
      const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50); central.writeUInt16LE(0x0314, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(deflate ? 8 : 0, 10); central.writeUInt32LE(crc, 16); central.writeUInt32LE(packed.length, 20); central.writeUInt32LE(bytes.length, 24); central.writeUInt16LE(filename.length, 28); central.writeUInt32LE((mode * 65536) >>> 0, 38); central.writeUInt32LE(offset, 42); centers.push(central, filename); offset += local.length + filename.length + packed.length;
    }
    const center = Buffer.concat(centers), end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(Object.keys(files).length, 8); end.writeUInt16LE(Object.keys(files).length, 10); end.writeUInt32LE(center.length, 12); end.writeUInt32LE(offset, 16); return Buffer.concat([...locals, center, end]);
  }
  const archive = (name, files, options) => { const file = path.join(root, `${name}.zip`), bytes = zip(files, options); fs.writeFileSync(file, bytes); return { file, sha256: hash(bytes) }; };
  const qqFiles = build => ({ 'QQ.exe': 'QA_ONLY_PORTABLE_PROGRAM', [`versions/9.9.33-${build}/resources/app/package.json`]: JSON.stringify({ version: `9.9.33.${build}` }), 'portable-info.json': JSON.stringify({ qqVersion: '9.9.33-51802' }) });
  const qqArchive = archive('qq-good', qqFiles('51802'));
  const qqSpec = { ...RUNTIME_DOWNLOADS.qq, sha256: qqArchive.sha256, origin: 'synthetic-test-only' };
  const dataDir = path.join(root, 'runtime', 'qq-portable-data'); fs.mkdirSync(dataDir); fs.writeFileSync(path.join(dataDir, 'account.dat'), 'QA_ONLY_DATA_MUST_STAY');
  const previous = fs.readFileSync(path.join(wrongDir, 'QQ.exe'));
  await assert.rejects(installRuntime({ appRoot: root, kind: 'qq', spec: qqSpec, archiveFile: qqArchive.file, isRunning: () => true }), /仍在运行/);
  await assert.rejects(installRuntime({ appRoot: root, kind: 'qq', spec: { ...qqSpec, sha256: '' }, archiveFile: qqArchive.file }), /可信 SHA256/);
  await assert.rejects(installRuntime({ appRoot: root, kind: 'qq', spec: { ...qqSpec, sha256: '0'.repeat(64) }, archiveFile: qqArchive.file }), /SHA256 校验失败/);
  assert.deepEqual(fs.readFileSync(path.join(wrongDir, 'QQ.exe')), previous, 'failed verification retains old installation');
  const malicious = archive('traversal', { '../outside147.txt': 'escape' });
  await assert.rejects(installRuntime({ appRoot: root, kind: 'qq', spec: { ...qqSpec, sha256: malicious.sha256 }, archiveFile: malicious.file }), /非法或越界路径/);
  assert.equal(fs.existsSync(path.join(root, 'runtime', 'outside147.txt')), false);
  const link = archive('link', { 'QQ.exe': 'target' }, { mode: 0xa000 });
  assert.throws(() => inspectRuntimeArchive(link.file), /符号链接/);
  const wrongArchive = archive('qq-wrong-build', qqFiles('52230'));
  await assert.rejects(installRuntime({ appRoot: root, kind: 'qq', spec: { ...qqSpec, sha256: wrongArchive.sha256 }, archiveFile: wrongArchive.file }), /51802/);
  assert.deepEqual(fs.readFileSync(path.join(wrongDir, 'QQ.exe')), previous, 'a self-reported portable-info target cannot override the real version directory');
  let install = await installRuntime({ appRoot: root, kind: 'qq', spec: qqSpec, archiveFile: qqArchive.file });
  assert.equal(install.archiveVerified, true); assert.equal(fs.existsSync(install.backup), true);
  assert.equal(inspectQqRuntime(wrongDir).installationVerified, true); assert.equal(inspectQqRuntime(wrongDir).versionMatches, true);
  assert.equal(fs.readFileSync(path.join(dataDir, 'account.dat'), 'utf8'), 'QA_ONLY_DATA_MUST_STAY', 'QQ program replacement leaves the independent data sibling intact');
  assert.equal((await installRuntime({ appRoot: root, kind: 'qq', spec: qqSpec, archiveFile: qqArchive.file })).skipped, true);
  const qqBeforeRollback = fs.readFileSync(path.join(wrongDir, 'QQ.exe'));
  await assert.rejects(installRuntime({ appRoot: root, kind: 'qq', spec: qqSpec, archiveFile: qqArchive.file, force: true, rename(from, to) { if (from.includes('stage-')) throw new Error('QA_ONLY_COMMIT_FAILURE'); fs.renameSync(from, to); } }), /COMMIT_FAILURE/);
  assert.deepEqual(fs.readFileSync(path.join(wrongDir, 'QQ.exe')), qqBeforeRollback, 'commit failure restores the old complete directory');
  assert.equal(fs.existsSync(path.join(root, 'runtime', '.setup', 'setup.lock')), false);
  console.log('147 install: missing/wrong hashes, traversal/link archives, wrong build, verified replacement and rollback passed');

  let reads = 0, spawned = 0; const exe = path.join(wrongDir, 'QQ.exe');
  const watchedFs = Object.create(fs); watchedFs.openSync = (file, ...options) => { if (file === exe) reads++; return fs.openSync(file, ...options); };
  const fakeChild = () => ({ pid: 147, exitCode: null, stdout: { on() {} }, stderr: { on() {} }, once() {}, unref() {} });
  const measured = createRealProcessAdapters({ appRoot: root, fsImpl: watchedFs, execFile(_file, _args, _options, done) { done(null, '[]', ''); }, spawn() { spawned++; return fakeChild(); } });
  for (let i = 0; i < 5; i++) assert.equal(measured.qqPortable.statusSync().installationVerified, true);
  assert.equal(reads, 1, 'unchanged repeated status reads hash the executable once');
  assert.equal(measured.qqPortable.statusSync().installedReady, true); assert.equal(measured.qqPortable.statusSync().ready, false, 'installation proof does not prove portable launch isolation');
  const atLaunch = reads; assert.equal((await measured.qqPortable.launch()).status, 409); assert.equal(reads, atLaunch + 1, 'launch forces a fresh complete executable hash before rejecting unverified isolation'); assert.equal(spawned, 0);
  fs.appendFileSync(exe, '-QA_ONLY_MODIFIED');
  assert.equal(measured.qqPortable.statusSync().ready, false); assert.equal(reads, atLaunch + 2, 'a changed critical file invalidates the status cache');
  fs.writeFileSync(exe, qqBeforeRollback);
  const stableStat = fs.lstatSync(exe), frozenFs = Object.create(fs); frozenFs.lstatSync = file => file === exe ? stableStat : fs.lstatSync(file);
  const frozenAdapter = createRealProcessAdapters({ appRoot: root, fsImpl: frozenFs, execFile(_file, _args, _options, done) { done(null, '[]', ''); }, spawn() { throw new Error('fresh validation must block tampered bytes'); } });
  assert.equal(frozenAdapter.qqPortable.statusSync().installationVerified, true);
  fs.writeFileSync(exe, 'QA_ONLY_SAME_STAT_TAMPER');
  assert.equal(frozenAdapter.qqPortable.statusSync().installationVerified, true, 'synthetic frozen stats demonstrate the cache window');
  assert.equal((await frozenAdapter.qqPortable.launch()).ok, false, 'fresh launch rejects changed bytes even under frozen stats');
  fs.writeFileSync(exe, qqBeforeRollback);
  const linkedFs = Object.create(fs); linkedFs.lstatSync = file => file === exe ? { isSymbolicLink: () => true, isFile: () => false } : fs.lstatSync(file);
  const linkedAdapter = createRealProcessAdapters({ appRoot: root, fsImpl: linkedFs, spawn() { throw new Error('symbolic executable must not launch'); } }); assert.equal((await linkedAdapter.qqPortable.launch()).ok, false);
  const proofFile = path.join(wrongDir, RUNTIME_PROOF_FILE), goodProof = fs.readFileSync(proofFile, 'utf8'), badProof = JSON.parse(goodProof);
  fs.mkdirSync(path.join(wrongDir, 'config')); const credential = path.join(wrongDir, 'config', 'onebot_147.json'); fs.writeFileSync(credential, 'QA_ONLY_MUST_NOT_READ');
  badProof.files['config/onebot_147.json'] = hash('QA_ONLY_MUST_NOT_READ'); fs.writeFileSync(proofFile, JSON.stringify(badProof));
  const guardedFs = Object.create(fs); guardedFs.readFileSync = (file, ...options) => { assert.notEqual(file, credential, 'proof may never request account/configuration files'); return fs.readFileSync(file, ...options); };
  assert.equal(inspectQqRuntime(wrongDir, { fsImpl: guardedFs }).proofValid, false); fs.writeFileSync(proofFile, goodProof);
  console.log('147 runtime: repeated-status caching, stat invalidation, fresh launch and credential-proof rejection passed');

  const snowArchive = archive('snow-good', { 'SnowLuma/index.mjs': 'var LIST_QQ_VERSION = "9.9.26-44343"; var BUILD_VERSION_SHORT = "9.9.26";\n', 'SnowLuma/node.exe': 'QA_ONLY_NODE_PROGRAM', 'SnowLuma/native/snowluma-win32-x64.node': 'QA_ONLY_NATIVE_ADDON', 'SnowLuma/native/snowluma-win32-x64.dll': 'QA_ONLY_NATIVE_DLL', 'SnowLuma/config/runtime.json': '{"webuiPort":5099}', 'SnowLuma/config/templates/default.json': '{"enabled":false}' }, { deflate: true });
  const snowSpec = { ...RUNTIME_DOWNLOADS.snowluma, sha256: snowArchive.sha256, origin: 'synthetic-test-only' };
  const snow = path.join(root, 'snowluma'); fs.mkdirSync(path.join(snow, 'config'), { recursive: true }); fs.writeFileSync(path.join(snow, 'config', 'onebot_147.json'), 'QA_ONLY_KEEP_ACCOUNT'); fs.writeFileSync(path.join(snow, 'index.mjs'), 'QA_ONLY_OLD_PROGRAM');
  const incompleteSnowArchive = archive('snow-native-missing', { 'SnowLuma/index.mjs': 'const LIST_QQ_VERSION="9.9.33-51802";', 'SnowLuma/node.exe': 'QA_ONLY_NODE_PROGRAM' });
  await assert.rejects(installRuntime({ appRoot: root, kind: 'snowluma', spec: { ...snowSpec, sha256: incompleteSnowArchive.sha256 }, archiveFile: incompleteSnowArchive.file }), /原生组件不完整/);
  assert.equal(fs.readFileSync(path.join(snow, 'index.mjs'), 'utf8'), 'QA_ONLY_OLD_PROGRAM');
  assert.equal(fs.readFileSync(path.join(snow, 'config', 'onebot_147.json'), 'utf8'), 'QA_ONLY_KEEP_ACCOUNT');
  install = await installRuntime({ appRoot: root, kind: 'snowluma', spec: snowSpec, archiveFile: snowArchive.file });
  assert.equal(install.alignment.before, '9.9.26-44343'); assert.equal(install.alignment.after, '9.9.33-51802');
  assert.equal(fs.readFileSync(path.join(snow, 'config', 'onebot_147.json'), 'utf8'), 'QA_ONLY_KEEP_ACCOUNT');
  assert.equal(JSON.parse(fs.readFileSync(path.join(snow, RUNTIME_PROOF_FILE), 'utf8')).configDefaults, null, 'preserved existing account state is never labelled pristine');
  assert.equal(inspectSnowlumaRuntime(snow).installationVerified, true); assert.equal(inspectSnowlumaRuntime(snow).buildMatches, true); assert.equal(checkRuntime(root).installedReady, true); assert.equal(checkRuntime(root).ready, false, 'runtime package verification is independent from launch isolation');
  const nativeDll = path.join(snow, 'native', 'snowluma-win32-x64.dll'); fs.unlinkSync(nativeDll);
  assert.equal(checkRuntime(root).installedReady, false, 'Deleting native runtime files invalidates Snow readiness even with a valid old installation proof');
  assert.notEqual((await installRuntime({ appRoot: root, kind: 'snowluma', spec: snowSpec, archiveFile: snowArchive.file })).skipped, true, 'A verified but incomplete SnowLuma package is repaired instead of skipped');
  const cliBefore = fs.readdirSync(path.join(root, 'runtime', '.setup')).sort();
  assert.equal((await runSetup(['--check'], { appRoot: root, env: {}, log() {} })).ok, false); assert.deepEqual(fs.readdirSync(path.join(root, 'runtime', '.setup')).sort(), cliBefore, '--check is read-only');
  await assert.rejects(runSetup(['--skip-snowluma', '--qq-archive', qqArchive.file], { appRoot: root, env: { QQ_PORTABLE_URL: 'https://example.invalid/other.zip' }, log() {} }), /可信 SHA256/);
  await assert.rejects(runSetup(['--run-installer'], { appRoot: root, env: {}, log() {} }), /不会自动执行/);
  await assert.rejects(runSetup(['--typo'], { appRoot: root, env: {}, log() {} }), /未知 setup 参数/);
  console.log('147 SnowLuma: nested complete package, deterministic client-build alignment, preserved config and read-only CLI passed');
  const freshSnowApp = path.join(root, 'fresh-snow-app'); await installRuntime({ appRoot: freshSnowApp, kind: 'snowluma', spec: snowSpec, archiveFile: snowArchive.file });
  const freshSnow = path.join(freshSnowApp, 'snowluma'), freshProof = JSON.parse(fs.readFileSync(path.join(freshSnow, RUNTIME_PROOF_FILE), 'utf8'));
  assert.deepEqual(freshProof.configDefaults, { schema: 1, present: true, files: { 'runtime.json': hash('{"webuiPort":5099}'), 'templates/default.json': hash('{"enabled":false}') }, directories: ['templates'] });
  assert.ok(Object.keys(freshProof.files).every(name => !name.startsWith('config/')), 'default template digests stay separate from runtime readiness hashes');
  const noConfigReads = Object.create(fs); noConfigReads.readFileSync = (file, ...options) => { assert.ok(!String(file).startsWith(path.join(freshSnow, 'config')), 'runtime inspector never opens default or account configuration'); return fs.readFileSync(file, ...options); };
  assert.equal(inspectSnowlumaRuntime(freshSnow, { fsImpl: noConfigReads, fresh: true }).installationVerified, true);
  console.log('147 SnowLuma defaults: only fresh archive templates attested; readiness never reads config');
  let logHandler, openerSpawns = [];
  const closedNet = { createConnection() { return { once(name, done) { if (name === 'error') queueMicrotask(() => done(new Error('closed'))); return this; }, setTimeout() {}, destroy() {} }; } };
  const opener = createRealProcessAdapters({ appRoot: freshSnowApp, netImpl: closedNet, snowlumaPlatform:'win32', snowlumaArch:'x64', nativeProbe:async()=>({ok:true}), spawn(file, args) { openerSpawns.push({ file, args }); return { pid: 147, exitCode: null, stdout: { on(name, done) { if (name === 'data') logHandler = done; } }, stderr: { on() {} }, once() {}, unref() {} }; } });
  await opener.snowluma.launch({}, {}); logHandler(Buffer.from('listening http://127.0.0.1:5099/?key=QA_ONLY&QA_COMMAND_MARKER\n'));
  await opener.snowluma.openWebui({}); assert.equal(openerSpawns.at(-1).file, 'explorer.exe'); assert.deepEqual(openerSpawns.at(-1).args, ['http://127.0.0.1:5099/?key=QA_ONLY&QA_COMMAND_MARKER']); assert.equal(openerSpawns.some(call => call.file === 'cmd.exe'), false, 'WebUI query metacharacters never enter a command shell');
  const beforeRejectedOpen = openerSpawns.length; logHandler(Buffer.from('listening http://qa-user:QA_ONLY_PASSWORD@127.0.0.1:5099/\n')); await assert.rejects(opener.snowluma.openWebui({}), /不含凭据/); assert.equal(openerSpawns.length, beforeRejectedOpen);
  const unsafeLauncher = path.join(root, 'fallback&QA_MARKER'); fs.mkdirSync(unsafeLauncher); fs.writeFileSync(path.join(unsafeLauncher, 'launcher.bat'), '@echo off'); fs.writeFileSync(path.join(unsafeLauncher, 'index.mjs'), 'const LIST_QQ_VERSION="9.9.33-51802";');
  const launcherGate = createRealProcessAdapters({ appRoot: root, netImpl: closedNet, spawn() { throw new Error('unsafe batch path must be rejected before spawn'); } }); await assert.rejects(launcherGate.snowluma.launch({}, { config: { snowluma: { dir: unsafeLauncher } } }), /命令元字符/);
  console.log('147 opener: validated WebUI URL opens without cmd; unsafe batch paths rejected');

  const from = path.join(root, 'explicit-from'); fs.mkdirSync(path.join(from, 'versions', '9.9.33-51802'), { recursive: true }); fs.writeFileSync(path.join(from, 'QQ.exe'), 'QA_ONLY_LOCAL_COPY');
  const privateTrees = ['UserData', 'user-data', 'user data', 'qq-portable-data', 'Tencent Files', 'login', 'cache', 'GPUCache'];
  const privateHashes = new Map();
  for (const name of privateTrees) { fs.mkdirSync(path.join(from, name)); const file = path.join(from, name, 'account.bin'); fs.writeFileSync(file, `QA_ONLY_SKIP_${name}`); privateHashes.set(name, hash(fs.readFileSync(file))); }
  const copyApp = path.join(root, 'copy-app'); await installRuntime({ appRoot: copyApp, kind: 'qq', fromDir: from });
  const copy = path.join(copyApp, 'runtime', 'qq-portable'); assert.equal(inspectQqRuntime(copy).versionMatches, true); assert.equal(inspectQqRuntime(copy).installationVerified, false, 'explicit local copying is not labelled publisher-archive verified'); assert.equal(fs.existsSync(path.join(copy, 'Tencent Files')), false);
  let knownCopySpawns = 0; const knownCopy = createRealProcessAdapters({ appRoot: copyApp, execFile(_file, _args, _options, done) { done(null, '[]', ''); }, spawn() { knownCopySpawns++; return fakeChild(); } }); assert.equal(knownCopy.qqPortable.statusSync().installedReady, true); assert.equal(knownCopy.qqPortable.statusSync().ready, false); assert.equal((await knownCopy.qqPortable.launch()).status, 409); assert.equal(knownCopySpawns, 0, 'known exact local-copy version cannot bypass unverified launch isolation');
  for (const name of privateTrees) { assert.equal(fs.existsSync(path.join(copy, name)), false, `program copying excludes ${name}`); assert.equal(hash(fs.readFileSync(path.join(from, name, 'account.bin'))), privateHashes.get(name), 'private source bytes remain unchanged'); }
  const tooLargeApp = path.join(root, 'too-large-copy'); await assert.rejects(installRuntime({ appRoot: tooLargeApp, kind: 'qq', fromDir: from, copyLimits: { maxBytes: 3 } }), /大小超限/); assert.equal(fs.existsSync(path.join(tooLargeApp, 'runtime', 'qq-portable')), false); assert.equal(fs.readdirSync(path.join(tooLargeApp, 'runtime', '.setup')).some(name => name.startsWith('stage-') || name === 'setup.lock'), false);
  const privateArchive = archive('qq-with-private-data', { ...qqFiles('51802'), 'UserData/account.bin': 'QA_ONLY_ARCHIVE_ACCOUNT' });
  await assert.rejects(installRuntime({ appRoot: root, kind: 'qq', spec: { ...qqSpec, sha256: privateArchive.sha256 }, archiveFile: privateArchive.file, force: true }), /包含用户数据目录/);
  for (const [index, sourceRelative] of ['runtime', 'runtime/.setup/subdir', 'runtime/qq-portable', 'runtime/qq-portable/subdir'].entries()) {
    const caseRoot = path.join(root, `overlap-${index}`), source = path.join(caseRoot, sourceRelative), target = path.join(caseRoot, 'runtime', 'qq-portable'), scratch = path.join(caseRoot, 'runtime', '.setup');
    fs.mkdirSync(path.join(source, 'versions', '9.9.33-51802'), { recursive: true }); fs.writeFileSync(path.join(source, 'QQ.exe'), 'QA_ONLY_OVERLAP_SOURCE');
    fs.mkdirSync(target, { recursive: true }); if (!fs.existsSync(path.join(target, 'QQ.exe'))) fs.writeFileSync(path.join(target, 'QQ.exe'), 'QA_ONLY_OVERLAP_TARGET');
    const sourceBefore = hash(fs.readFileSync(path.join(source, 'QQ.exe'))), targetBefore = hash(fs.readFileSync(path.join(target, 'QQ.exe'))), beforeScratch = fs.existsSync(scratch) ? fs.readdirSync(scratch).sort() : null;
    await assert.rejects(installRuntime({ appRoot: caseRoot, kind: 'qq', fromDir: source, force: true }), /交叠/);
    assert.equal(hash(fs.readFileSync(path.join(source, 'QQ.exe'))), sourceBefore); assert.equal(hash(fs.readFileSync(path.join(target, 'QQ.exe'))), targetBefore);
    assert.deepEqual(fs.existsSync(scratch) ? fs.readdirSync(scratch).sort() : null, beforeScratch, 'overlap rejection creates no stage or lock');
  }
  const independentRoot = path.join(root, 'independent-app'), independentInput = path.join(independentRoot, 'qq-input'); fs.mkdirSync(path.join(independentInput, 'versions', '9.9.33-51802'), { recursive: true }); fs.writeFileSync(path.join(independentInput, 'QQ.exe'), 'QA_ONLY_INDEPENDENT_INPUT');
  assert.equal((await installRuntime({ appRoot: independentRoot, kind: 'qq', fromDir: independentInput })).archiveVerified, false, 'a safe independent appRoot subdirectory is allowed');
  console.log('147 source-copy: bidirectional target/scratch overlap rejected before staging; independent input retained');
  const unknown = path.join(root, 'unknown-app', 'runtime', 'qq-portable'); fs.mkdirSync(unknown, { recursive: true }); fs.writeFileSync(path.join(unknown, 'QQ.exe'), 'QA_ONLY_UNKNOWN'); fs.writeFileSync(path.join(unknown, 'portable-info.json'), '{"qqVersion":"9.9.33-51802"}'); assert.equal(inspectQqRuntime(unknown).versionKnown, false); assert.equal(inspectQqRuntime(unknown).installationVerified, false);
  assert.throws(() => ownedPath(root, root), /独立子目录/);

  const bytes = Buffer.from('QA_ONLY_DOWNLOAD_CONTENT'), want = hash(bytes), destination = path.join(root, 'download.zip'); let requests = 0;
  const injected = { dnsLookup: async () => [{ address: '93.184.216.34', family: 4 }], fetchImpl: async () => { requests++; return new Response(new ReadableStream({ start(controller) { controller.enqueue(bytes.subarray(0, 4)); controller.enqueue(bytes.subarray(4)); controller.close(); } }), { status: 200, headers: { 'content-length': String(bytes.length) } }); } };
  const downloaded = await download('https://fixture.invalid/download.zip', destination, { ...injected, expectedSha256: want }); assert.equal(downloaded.sha256, want); verifyArchive(destination, want);
  assert.equal((await download('https://fixture.invalid/download.zip', destination, { ...injected, expectedSha256: want })).fromCache, true); assert.equal(requests, 1);
  await assert.rejects(download('https://fixture.invalid/download.zip', path.join(root, 'oversize.zip'), { ...injected, expectedSha256: want, maxBytes: bytes.length - 1 }), /大小上限/); assert.equal(fs.existsSync(path.join(root, 'oversize.zip')), false);
  await assert.rejects(download('https://fixture.invalid/download.zip', destination, { ...injected, expectedSha256: '0'.repeat(64) }), /校验失败/); assert.equal(fs.readFileSync(destination, 'utf8'), bytes.toString());
  const interrupted = path.join(root, 'interrupted.zip');
  await assert.rejects(download('https://fixture.invalid/download.zip', interrupted, { ...injected, expectedSha256: want, fetchImpl: async () => new Response(new ReadableStream({ start(controller) { controller.enqueue(bytes.subarray(0, 4)); controller.error(new Error('QA_ONLY_INTERRUPTED')); } })) }), /INTERRUPTED/);
  assert.equal(fs.existsSync(interrupted), false); assert.equal(fs.readdirSync(root).some(name => name.endsWith('.part')), false);
  let hops = 0; await assert.rejects(download('https://fixture.invalid/redirect', interrupted, { ...injected, expectedSha256: want, fetchImpl: async () => { hops++; return new Response('', { status: 302, headers: { location: 'http://127.0.0.1/private' } }); } }), /HTTPS/); assert.equal(hops, 1, 'TLS downgrade rejected before connecting to its target');
  await assert.rejects(download('https://fixture.invalid/redirect', interrupted, { ...injected, expectedSha256: want, dnsLookup: async () => [{ address: '127.0.0.1', family: 4 }] }), /内网地址/);
  console.log('147 downloader: bounded streamed writes, verified cache, interruption/mismatch cleanup and redirect/private-network limits passed');
  console.log('147-runtime-setup-lock: all synthetic runtime installation and lock checks passed');
} finally {
  assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()));
  fs.rmSync(root, { recursive: true, force: true });
}
