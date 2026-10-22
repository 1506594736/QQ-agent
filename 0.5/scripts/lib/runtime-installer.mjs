import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { download, verifyArchive, requireSha256, fileSha256 } from './download.mjs';
import { extractRuntimeArchive, assertPlainTree } from './runtime-archive.mjs';
import { QQ_RUNTIME_VERSION, EXPECTED_CLIENT_BUILD, RUNTIME_DOWNLOADS, RUNTIME_PROOF_FILE, inspectQqRuntime, inspectQqLaunchIsolation, inspectSnowlumaRuntime, readQqVersion, readSnowlumaBuild } from '../../bundled/transport-onebot/runtime-lock.js';

const qqIsolationNote='QQ 安装校验只证明程序文件与版本，不证明账号数据隔离；档案中的 portable-info.json 和 --user-data-dir 声明未经真实运行验证，不能作为可启动凭据。';
function qqLaunchMetadata(version){return {launchIsolation:inspectQqLaunchIsolation(version),note:qqIsolationNote};}

export function ownedPath(root, target) {
  const base = path.resolve(root), resolved = path.resolve(target), rel = path.relative(base, resolved);
  if (!rel || rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel) || path.dirname(base) === base) throw new Error('安装目标必须是应用目录内的独立子目录');
  let cursor = base;
  for (const part of ['', ...rel.split(path.sep)]) {
    if (part) cursor = path.join(cursor, part);
    try { if (fs.lstatSync(cursor).isSymbolicLink()) throw new Error('安装路径不能经过符号链接'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  return resolved;
}
function removeOwned(root, target) { fs.rmSync(ownedPath(root, target), { recursive: true, force: true }); }
function realOrFuture(file) {
  let cursor = path.resolve(file), missing = [];
  while (!fs.existsSync(cursor)) { const parent = path.dirname(cursor); if (parent === cursor) throw new Error('无法解析安装路径'); missing.unshift(path.basename(cursor)); cursor = parent; }
  return path.join(fs.realpathSync(cursor), ...missing);
}
function overlaps(left, right) {
  const inside = (parent, child) => { const relative = path.relative(parent, child); return !relative || relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative); };
  return inside(left, right) || inside(right, left);
}
function runtimeInUse({ kind, dir }) {
  if (process.platform !== 'win32' || !fs.existsSync(dir)) return false;
  const script = "[Console]::OutputEncoding=[Text.Encoding]::UTF8; Get-CimInstance Win32_Process | Select-Object ExecutablePath,CommandLine | ConvertTo-Json -Compress";
  let rows;
  try { rows = JSON.parse(execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, encoding: 'utf8', timeout: 15000, maxBuffer: 8 * 1024 * 1024 }) || '[]'); }
  catch { throw new Error('无法核对运行组件是否仍在运行；请关闭 QQ/SnowLuma 并在可用的系统终端重试。'); }
  const needle = `${path.resolve(dir).toLowerCase()}${path.sep}`;
  return (Array.isArray(rows) ? rows : [rows]).some(row => {
    const executable = String(row?.ExecutablePath ?? '').toLowerCase();
    return executable.startsWith(needle) || kind === 'snowluma' && /node|cmd/i.test(executable) && String(row?.CommandLine ?? '').toLowerCase().includes(needle);
  });
}
const privateNames = new Set(['tencent files', 'myfiles', 'temp', 'logs', 'crashpad', 'cache', 'user data', 'userdata', 'user-data', 'qq-portable-data', 'login', 'accounts', 'local storage', 'session storage', 'gpucache', 'dawncache', 'code cache', 'shadercache', 'blob_storage', 'network', 'cookies', 'local state', 'preferences']);
function copyProgram(source, target, limits = {}, budget = { files: 0, bytes: 0 }) {
  fs.mkdirSync(target, { recursive: true });
  for (const name of fs.readdirSync(source)) {
    if (privateNames.has(name.toLowerCase()) || /\.log$/i.test(name) || name === RUNTIME_PROOF_FILE) continue;
    const from = path.join(source, name), to = path.join(target, name), stat = fs.lstatSync(from);
    if (stat.isSymbolicLink() || (!stat.isDirectory() && !stat.isFile())) throw new Error('QQ 源目录包含符号链接或特殊文件');
    if (++budget.files > (limits.maxFiles ?? 60000)) throw new Error('QQ 源程序文件数量超限');
    if (stat.isFile()) { budget.bytes += stat.size; if (budget.bytes > (limits.maxBytes ?? 4 * 1024 ** 3)) throw new Error('QQ 源程序大小超限'); }
    if (stat.isDirectory()) copyProgram(from, to, limits, budget); else fs.copyFileSync(from, to);
  }
}
function payloadRoot(stage, filename) {
  if (fs.existsSync(path.join(stage, filename))) return stage;
  const children = fs.readdirSync(stage).filter(name => fs.lstatSync(path.join(stage, name)).isDirectory() && fs.existsSync(path.join(stage, name, filename)));
  if (children.length !== 1) throw new Error(`安装包中没有唯一的 ${filename} 入口`);
  return path.join(stage, children[0]);
}
function archiveConfigDefaults(payload) {
  const configDir = path.join(payload, 'config'), files = {}, directories = [];
  const present = fs.existsSync(configDir);
  if (present) {
    assertPlainTree(configDir);
    function walk(dir) {
      for (const name of fs.readdirSync(dir).sort()) {
        const file = path.join(dir, name), relative = path.relative(configDir, file).split(path.sep).join('/');
        if (fs.lstatSync(file).isDirectory()) { directories.push(relative); walk(file); } else files[relative] = fileSha256(file);
      }
    }
    walk(configDir);
  }
  return { schema: 1, present, files, directories };
}
export function alignSnowlumaBuild(dir) {
  const file = path.join(dir, 'index.mjs'); const before = fs.readFileSync(file, 'utf8');
  const build = readSnowlumaBuild(dir);
  if (!build) throw new Error('无法核对 SnowLuma 的 CLIENT_BUILD/LIST_QQ_VERSION；拒绝修改未知声明');
  const after = before.replace(/(\b(?:var|let|const)\s+(?:CLIENT_BUILD|LIST_QQ_VERSION)\s*=\s*)(["'])\d+\.\d+\.\d+-\d+\2/g, `$1"${EXPECTED_CLIENT_BUILD}"`)
    .replace(/(\b(?:var|let|const)\s+BUILD_VERSION_SHORT\s*=\s*)(["'])\d+\.\d+\.\d+\2/g, '$1"9.9.33"');
  if (before !== after) { fs.copyFileSync(file, `${file}.orig`); fs.writeFileSync(file, after); }
  if (readSnowlumaBuild(dir) !== EXPECTED_CLIENT_BUILD) throw new Error('SnowLuma 版本对齐未生效');
  return { before: build, after: EXPECTED_CLIENT_BUILD, changed: before !== after };
}

export function checkRuntime(appRoot) {
  const root = path.resolve(appRoot);
  const qq = inspectQqRuntime(path.join(root, 'runtime', 'qq-portable'), { fresh: true });
  const snowluma = inspectSnowlumaRuntime(path.join(root, 'snowluma'), { fresh: true });
  const snowInstalled=snowluma.present&&snowluma.buildMatches&&snowluma.proofValid&&snowluma.nativePresent&&snowluma.nativePlatformSupported;
  return {qq,snowluma,installedReady:qq.installedReady===true&&qq.proofValid&&snowInstalled,ready:qq.launchAllowed===true&&qq.proofValid&&snowInstalled,launchAllowed:qq.launchAllowed===true,launchIsolation:qq.launchIsolation,note:qqIsolationNote};
}

export async function installRuntime({ appRoot, kind, spec = RUNTIME_DOWNLOADS[kind], archiveFile, fromDir, force = false, downloadOptions = {}, rename = fs.renameSync, isRunning = runtimeInUse, copyLimits = {} }) {
  if (!['qq', 'snowluma'].includes(kind)) throw new Error('未知运行组件');
  if (!spec || spec.version !== RUNTIME_DOWNLOADS[kind].version) throw new Error('运行组件版本不符合固定版本锁');
  // Validate package provenance before staging or fetching; no missing-hash bypass.
  const hash = fromDir ? null : requireSha256(spec.sha256);
  if (!fromDir) { const address = new URL(spec.url); if (address.protocol !== 'https:' || address.username || address.password) throw new Error('安装来源必须是不含凭据的 HTTPS 地址'); }
  if (fromDir && kind !== 'qq') throw new Error('--from 只接受指定的 QQ 程序目录');
  const root = path.resolve(appRoot);
  const target = ownedPath(root, path.join(root, kind === 'qq' ? 'runtime/qq-portable' : 'snowluma'));
  const scratch = ownedPath(root, path.join(root, 'runtime', '.setup'));
  let source = null;
  if (fromDir) {
    const requested = path.resolve(fromDir);
    if (fs.lstatSync(requested).isSymbolicLink()) throw new Error('QQ 源目录不能是符号链接');
    source = fs.realpathSync(requested);
    if (overlaps(source, realOrFuture(target)) || overlaps(source, realOrFuture(scratch))) throw new Error('QQ 源目录与安装目标或暂存目录交叠；拒绝递归复制。');
  }
  fs.mkdirSync(root, { recursive: true });
  const state = kind === 'qq' ? inspectQqRuntime(target, { fresh: true }) : inspectSnowlumaRuntime(target, { fresh: true });
  if (!force && state.installationVerified && (kind === 'qq' ? state.versionMatches : state.buildMatches && state.nativePresent && state.nativePlatformSupported)) return {skipped:true,kind,target,...(kind==='qq'?qqLaunchMetadata(state.version):{})};
  if (await isRunning({ kind, dir: target })) throw new Error('运行组件仍在运行；请先关闭后安装，保留现有程序和账号数据。');
  if (source) {
    const identity = readQqVersion(source);
    if (!identity || identity.ambiguous || identity.version !== QQ_RUNTIME_VERSION) throw new Error(`QQ 源目录必须证明完整版本 ${QQ_RUNTIME_VERSION}，不能以未知版本或仅短版本号代替。`);
    if (await isRunning({ kind: 'qq', dir: source })) throw new Error('QQ 源程序仍在运行；请先关闭，避免复制不一致的文件。');
  }
  fs.mkdirSync(scratch, { recursive: true });
  const lockFile = ownedPath(root, path.join(scratch, 'setup.lock'));
  let lock; try { lock = fs.openSync(lockFile, 'wx'); } catch { throw new Error('安装已在进行，或上次中断尚未检查；请先检查 runtime/.setup/setup.lock。'); }
  fs.writeFileSync(lock, JSON.stringify({ pid: process.pid, at: new Date().toISOString(), kind }));
  const stage = ownedPath(root, path.join(scratch, `stage-${randomUUID()}`));
  const backup = ownedPath(root, path.join(scratch, `backup-${kind}-${randomUUID()}`));
  let movedOld = false, committed = false, payload;
  try {
    fs.mkdirSync(stage);
    if (fromDir) {
      copyProgram(source, stage, copyLimits); payload = stage;
      if (await isRunning({ kind: 'qq', dir: source })) throw new Error('复制期间 QQ 源程序被启动；已取消安装。');
    } else {
      let archive = archiveFile;
      if (!archive) {
        const cache = ownedPath(root, path.join(scratch, `${kind}-${hash}.zip`));
        await download(spec.url, cache, { ...downloadOptions, expectedSha256: hash, maxBytes: spec.maxBytes ?? RUNTIME_DOWNLOADS[kind].maxBytes }); archive = cache;
      }
      verifyArchive(archive, hash);
      await extractRuntimeArchive(archive, stage, { validateEntries(entries) {
        if (kind === 'qq' && entries.some(entry => entry.name.split('/').some(name => privateNames.has(name.toLowerCase())))) throw new Error('QQ 安装包包含用户数据目录；拒绝安装');
      } });
      payload = payloadRoot(stage, kind === 'qq' ? 'QQ.exe' : 'index.mjs');
    }
    assertPlainTree(payload);
    let alignment = null, configDefaults = null;
    if (kind === 'qq') {
      const inspected = inspectQqRuntime(payload);
      if (!inspected.present || !inspected.versionMatches) throw new Error(inspected.reason ?? `安装包未证明 QQ ${QQ_RUNTIME_VERSION}`);
      // Never publish archive-carried account data into the portable program tree.
      for (const name of fs.readdirSync(payload)) if (privateNames.has(name.toLowerCase())) throw new Error('QQ 安装包包含用户数据目录；拒绝安装');
    } else {
      const node = path.join(payload, 'node.exe'); if (!fs.existsSync(node) || !fs.lstatSync(node).isFile()) throw new Error('SnowLuma 必须是含 node.exe/index.mjs 的完整 Windows 包');
      alignment = alignSnowlumaBuild(payload);
      const native = inspectSnowlumaRuntime(payload);
      if (!native.nativePresent) throw new Error(native.nativeDiagnosis ?? 'SnowLuma 原生组件不完整，请使用完整 Windows x64 包');
      const existingConfig = path.join(target, 'config');
      // Only the fresh verified archive can attest a pristine default template.
      // Existing profiles are preserved separately and never receive this label.
      if (!fs.existsSync(existingConfig)) configDefaults = archiveConfigDefaults(payload);
      if (fs.existsSync(existingConfig)) {
        assertPlainTree(existingConfig); const destination = path.join(payload, 'config');
        if (fs.existsSync(destination)) removeOwned(stage, destination);
        fs.cpSync(existingConfig, destination, { recursive: true, dereference: false, errorOnExist: true, force: false });
      }
    }
    const filenames = kind === 'qq' ? ['QQ.exe'] : ['node.exe', 'index.mjs'];
    if (kind === 'qq') {
      const identity = readQqVersion(payload), packageFile = `${identity.source.split(path.sep).join('/')}/resources/app/package.json`;
      if (fs.existsSync(path.join(payload, packageFile))) filenames.push(packageFile);
    }
    const proof = { schema: 1, kind, version: spec.version, archiveSha256: hash, source: fromDir ? { type: 'explicit-local-copy' } : { type: 'verified-archive', url: spec.url, origin: spec.origin ?? 'explicit-source-and-hash' }, alignment, configDefaults, installedAt: new Date().toISOString(), files: Object.fromEntries(filenames.map(name => [name, fileSha256(path.join(payload, name))])) };
    // This is an installation record, never an attestation of QQ data isolation.
    // Keep archive-carried portable-info.json intact and ignore its launch claims.
    if(kind==='qq')proof.launchIsolation={status:'unverified',verified:false};
    fs.writeFileSync(path.join(payload, RUNTIME_PROOF_FILE), JSON.stringify(proof, null, 2));
    if (await isRunning({ kind, dir: target })) throw new Error('安装期间运行组件被启动；已取消提交，现有程序和账号数据保持。');
    if (fs.existsSync(target)) { rename(target, backup); movedOld = true; }
    try { fs.mkdirSync(path.dirname(target), { recursive: true }); rename(payload, target); committed = true; }
    catch (error) { if (movedOld) rename(backup, target); movedOld = false; throw error; }
    return { kind, target, skipped: false, archiveVerified: !fromDir, version: spec.version, backup: movedOld ? backup : null, alignment,...(kind==='qq'?qqLaunchMetadata(spec.version):{}) };
  } finally {
    // The old installation is retained as a recoverable backup after a commit.
    // A failed staged install never removes the live target or its data sibling.
    if (fs.existsSync(stage)) removeOwned(root, stage);
    fs.closeSync(lock); fs.unlinkSync(lockFile);
    void committed;
  }
}
