// DSH10.3 / reviewed 0.4 installer: preserve snowluma/config in a new runtime.
// Version checks read program files only; account/config bytes are copied unchanged.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { inspectQqRuntime, inspectSnowlumaRuntime, QQ_RUNTIME_VERSION, EXPECTED_CLIENT_BUILD, RUNTIME_PROOF_FILE } from '../../bundled/transport-onebot/runtime-lock.js';

const inside = (file, root) => { const rel = path.relative(path.resolve(root), path.resolve(file)); return rel === '' || (!rel.startsWith(`..${path.sep}`) && rel !== '..' && !path.isAbsolute(rel)); };
const exists = file => { try { return fs.existsSync(file); } catch { return false; } };
function plainPath(file, root) {
  if (!inside(file, root)) return false;
  const absolute = path.resolve(file);
  let ancestor = absolute;
  while (!exists(ancestor)) { const next = path.dirname(ancestor); if (next === ancestor) return false; ancestor = next; }
  try { return path.relative(ancestor, fs.realpathSync(ancestor)) === '' && !fs.lstatSync(ancestor).isSymbolicLink(); } catch { return false; }
}
function directory(file) { try { const stat = fs.lstatSync(file); return stat.isDirectory() && !stat.isSymbolicLink(); } catch { return false; } }
const digest = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
function loginTree(dir) {
  const files = [], directories = [];
  const walk = (current, relative = '') => {
    if (!plainPath(current, dir) || !directory(current)) throw new Error('LOGIN_PATH_UNSAFE');
    for (const item of fs.readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const source = path.join(current, item.name), name = path.join(relative, item.name);
      if (item.isSymbolicLink()) throw new Error('LOGIN_PATH_UNSAFE');
      if (item.isDirectory()) { directories.push(name); walk(source, name); }
      else if (item.isFile()) files.push({ source, relative: name, bytes: fs.statSync(source).size });
      else throw new Error('LOGIN_PATH_UNSAFE');
    }
  };
  walk(dir); return { files, directories };
}
const manual = (note, fields = {}) => ({ ok: false, status: 'manual', requiresAction: true, loginCopied: false, loginVerified: false, note, ...fields });
// Keep delegated program identity checks inside their declared roots, including
// all ancestors; a modified proof must not turn them into credential readers.
function programFs(root) {
  const guarded = Object.create(fs);
  for (const method of ['existsSync', 'lstatSync', 'readdirSync', 'readFileSync']) guarded[method] = (file, ...args) => {
    const relative = path.relative(root, String(file));
    if (!plainPath(String(file), root) || relative.split(path.sep).some(part => /^(?:config|userdata|user-data|qq-portable-data)$/i.test(part))) throw new Error('RUNTIME_PATH_UNSAFE');
    return fs[method](file, ...args);
  };
  return guarded;
}
function versionsMatch({ sourceQq, targetQq, sourceSnow, targetSnow }) {
  const qq = dir => inspectQqRuntime(dir, { fsImpl: programFs(dir), fresh: true });
  const snow = dir => inspectSnowlumaRuntime(dir, { fsImpl: programFs(dir), fresh: true });
  const qqMatches = item => item.present && item.versionKnown && item.versionMatches && (!item.proofPresent || item.proofValid);
  const snowMatches = item => item.present && item.buildMatches && (!item.proofPresent || item.proofValid);
  try { return qqMatches(qq(sourceQq)) && qqMatches(qq(targetQq)) && snowMatches(snow(sourceSnow)) && snowMatches(snow(targetSnow)); }
  catch { return false; }
}

function canonicalDefaults(value) {
  if (!value || value.schema !== 1 || value.present !== true || !value.files || typeof value.files !== 'object' || Array.isArray(value.files) || !Array.isArray(value.directories)) return null;
  const safeName = name => typeof name === 'string' && !name.includes('\\') && !name.includes(':') && !path.isAbsolute(name) && name.split('/').every(part => part && part !== '.' && part !== '..');
  const entries = Object.entries(value.files).sort(([a], [b]) => a.localeCompare(b));
  if (entries.some(([name, hash]) => !safeName(name) || typeof hash !== 'string' || !/^[a-f0-9]{64}$/i.test(hash))) return null;
  if (value.directories.some(name => !safeName(name)) || new Set(value.directories).size !== value.directories.length) return null;
  return { files: entries.map(([name, hash]) => [name, hash.toLowerCase()]), directories: [...value.directories].sort() };
}
// Only the installer can label an untouched, fresh archive config as defaults.
// Runtime readiness keeps this separate and never hashes account/config files.
function trustedDefaults(targetSnow) {
  try {
    const state = inspectSnowlumaRuntime(targetSnow, { fsImpl: programFs(targetSnow), fresh: true });
    if (!state.proofValid || !state.installationVerified || !state.buildMatches) return null;
    const file = path.join(targetSnow, RUNTIME_PROOF_FILE);
    if (!plainPath(file, targetSnow) || !fs.lstatSync(file).isFile() || fs.lstatSync(file).isSymbolicLink()) return null;
    const proof = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (proof.source?.type !== 'verified-archive' || !/^[a-f0-9]{64}$/i.test(proof.archiveSha256 ?? '')) return null;
    const manifest = canonicalDefaults(proof.configDefaults);
    return manifest ? { manifest, proofDigest: digest(file) } : null;
  } catch { return null; }
}
function pristineDefaults(targetSnow, targetConfig, expected = null) {
  try {
    const proof = trustedDefaults(targetSnow);
    if (!proof || expected && JSON.stringify(proof) !== JSON.stringify(expected)) return null;
    const tree = loginTree(targetConfig);
    const actual = { files: tree.files.map(file => [file.relative.split(path.sep).join('/'), digest(file.source)]).sort(([a], [b]) => a.localeCompare(b)), directories: tree.directories.map(name => name.split(path.sep).join('/')).sort() };
    return JSON.stringify(actual) === JSON.stringify(proof.manifest) ? proof : null;
  } catch { return null; }
}

/** Read-only plan. Old program layout comes from the reviewed installer/setup. */
export function planLoginMigration({ sourceDataDir, targetDataDir, appRoot, legacyConfig, profile = 1, snowlumaDir = null, qqPortableDir = null } = {}) {
  const sourceRoot = path.dirname(sourceDataDir), targetRoot = path.resolve(appRoot);
  const targetSnow = path.resolve(snowlumaDir || path.join(targetRoot, 'snowluma'));
  const targetQq = path.resolve(qqPortableDir || path.join(targetRoot, 'runtime', 'qq-portable'));
  const plan = { report: manual('未找到可校验的 snowluma/config 登录配置'), configDir: null };
  const targetAllowed = file => (inside(file, targetRoot) || inside(file, targetDataDir)) && plainPath(file, inside(file, targetRoot) ? targetRoot : targetDataDir);
  if (!targetAllowed(targetSnow) || !targetAllowed(targetQq)) { plan.report = manual('目标运行时路径不在新安装目录或目标 data 范围内'); return plan; }
  // The old absolute source path must never survive into the new config.
  plan.configDir = targetSnow;
  if (Number(profile) > 1 && (!snowlumaDir || !inside(targetSnow, targetDataDir))) {
    plan.report = manual('多 PROFILE 需独立且已校验的 snowluma 运行时，不能覆盖共享登录配置'); return plan;
  }
  const configured = typeof legacyConfig?.snowluma?.dir === 'string' ? legacyConfig.snowluma.dir.trim() : '';
  const candidates = configured ? [path.resolve(sourceRoot, configured)] : [
    path.join(sourceDataDir, 'snowluma'), path.join(sourceRoot, 'snowluma'),
    path.join(sourceRoot, 'resources', 'app', 'snowluma'), path.join(sourceRoot, 'resources', 'app.asar.unpacked', 'snowluma'),
  ];
  if (candidates.some(dir => !inside(dir, sourceRoot) || !plainPath(dir, sourceRoot))) {
    plan.report = manual('旧 snowluma 目录越界或包含链接，保留原安装不迁移'); return plan;
  }
  const sourceSnow = candidates.find(dir => directory(path.join(dir, 'config')));
  if (!sourceSnow) return plan;
  const sourceConfig = path.join(sourceSnow, 'config'), targetConfig = path.join(targetSnow, 'config');
  if (inside(targetSnow, sourceSnow) || inside(sourceSnow, targetSnow) || inside(targetSnow, sourceDataDir)) {
    plan.report = manual('新旧 snowluma 运行时重合，不能回写旧安装'); return plan;
  }
  let defaults = null;
  if (exists(targetConfig)) {
    if (!plainPath(targetConfig, targetSnow) || !directory(targetConfig)) { plan.report = manual('目标 snowluma/config 路径不安全，未覆盖新 PROFILE'); return plan; }
    if (fs.readdirSync(targetConfig).length > 0 && !(defaults = pristineDefaults(targetSnow, targetConfig))) {
      plan.report = manual('目标 snowluma/config 已有状态或无法证明仍为初装默认模板，未覆盖新 PROFILE'); return plan;
    }
  }
  const sourceProgram = path.dirname(sourceSnow);
  const qqCandidates = [...new Set([path.join(sourceProgram, 'runtime', 'qq-portable'), path.join(sourceRoot, 'runtime', 'qq-portable')])];
  const sourceQq = qqCandidates.find(dir => exists(path.join(dir, 'QQ.exe')));
  if (!sourceQq || !plainPath(sourceQq, sourceRoot)) { plan.report = manual('旧便携 QQ 路径或实际版本证明缺失'); return plan; }
  if (!versionsMatch({ sourceQq, targetQq, sourceSnow, targetSnow })) {
    plan.report = manual(`新旧 QQ 必须实际为 ${QQ_RUNTIME_VERSION}，SnowLuma 声明必须为 ${EXPECTED_CLIENT_BUILD}；版本未知、冲突或不匹配时不迁移`, { versionVerified: false }); return plan;
  }
  let tree;
  try { tree = loginTree(sourceConfig); } catch { plan.report = manual('旧 snowluma/config 含链接或不可读取，未复制任何登录配置'); return plan; }
  const { files, directories } = tree;
  if (!files.length) { plan.report = manual('旧 snowluma/config 为空，没有可迁移的登录配置'); return plan; }
  Object.assign(plan, { sourceConfig, targetConfig, targetSnow, sourceSnow, sourceQq, targetQq, files, directories, defaults });
  plan.report = manual('新旧版本已核对，尚未执行登录配置复制', { versionVerified: true, qqVersion: QQ_RUNTIME_VERSION, clientBuild: EXPECTED_CLIENT_BUILD, sourceConfig, targetConfig, files: files.length, bytes: files.reduce((sum, file) => sum + file.bytes, 0) });
  return plan;
}

/** Stage, verify, then rename. Existing profiles are preserved; proven defaults get a backup. */
export function copyPlannedLogin(plan, { dryRun = false } = {}) {
  if (!plan.files) return plan.report;
  if (dryRun) return { ...plan.report, status: 'planned', note: 'dry-run：只规划 snowluma/config 独立复制，未写入或验证登录' };
  if (!versionsMatch(plan)) return { ...plan.report, status: 'manual', versionVerified: false, note: '复制前运行时版本证明已变化，snowluma/config 未迁移' };
  if (plan.defaults && !pristineDefaults(plan.targetSnow, plan.targetConfig, plan.defaults)) return { ...plan.report, status: 'manual', note: '复制前目标默认模板或安装证明已变化，未覆盖登录配置' };
  const stage = path.join(plan.targetSnow, `.login-migration-${process.pid}-${crypto.randomBytes(8).toString('hex')}`);
  const backup = path.join(plan.targetSnow, `.login-defaults-${process.pid}-${crypto.randomBytes(8).toString('hex')}`);
  let removedEmpty = false, movedDefaults = false;
  try {
    if (!plainPath(plan.targetSnow, plan.targetSnow) || !directory(plan.targetSnow)) throw new Error('TARGET_PATH_UNSAFE');
    fs.mkdirSync(stage, { recursive: false });
    for (const relative of plan.directories) fs.mkdirSync(path.join(stage, relative), { recursive: true });
    const hashes = new Map();
    for (const file of plan.files) {
      if (!plainPath(file.source, plan.sourceConfig) || !fs.lstatSync(file.source).isFile() || fs.lstatSync(file.source).isSymbolicLink()) throw new Error('SOURCE_CHANGED');
      const target = path.join(stage, file.relative);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      const sourceHash = digest(file.source); hashes.set(file.source, sourceHash);
      fs.copyFileSync(file.source, target, fs.constants.COPYFILE_EXCL);
      if (fs.statSync(target).size !== file.bytes || fs.statSync(file.source).size !== file.bytes || digest(target) !== sourceHash || digest(file.source) !== sourceHash) throw new Error('SOURCE_CHANGED');
    }
    const latest = loginTree(plan.sourceConfig);
    if (JSON.stringify(latest.files.map(file => [file.relative, file.bytes])) !== JSON.stringify(plan.files.map(file => [file.relative, file.bytes])) || JSON.stringify(latest.directories) !== JSON.stringify(plan.directories) || latest.files.some(file => digest(file.source) !== hashes.get(file.source))) throw new Error('SOURCE_CHANGED');
    if (!versionsMatch(plan)) throw new Error('RUNTIME_CHANGED');
    if (exists(plan.targetConfig)) {
      if (!plainPath(plan.targetConfig, plan.targetSnow) || !directory(plan.targetConfig)) throw new Error('TARGET_CHANGED');
      if (plan.defaults) {
        if (!pristineDefaults(plan.targetSnow, plan.targetConfig, plan.defaults)) throw new Error('TARGET_CHANGED');
        fs.renameSync(plan.targetConfig, backup); movedDefaults = true;
      } else {
        if (fs.readdirSync(plan.targetConfig).length > 0) throw new Error('TARGET_CHANGED');
        fs.rmdirSync(plan.targetConfig); removedEmpty = true;
      }
    } else if (plan.defaults) {
      throw new Error('TARGET_CHANGED');
    }
    fs.renameSync(stage, plan.targetConfig);
    return { ...plan.report, ok: true, status: 'copied', requiresAction: false, loginCopied: true, defaultsReplaced: movedDefaults, ...(movedDefaults ? { defaultsBackup: backup } : {}), note: '已按版本锁定独立复制 snowluma/config；原安装只读，实际 QQ 登录仍需运行时验证' };
  } catch {
    // stage is a fresh, fixed child of the validated target runtime, never a source.
    try { if (inside(stage, plan.targetSnow) && plainPath(stage, plan.targetSnow)) fs.rmSync(stage, { recursive: true, force: true }); } catch { /* preserve any unrecoverable stage */ }
    let recoveryRequired = false;
    try {
      if (movedDefaults) { if (exists(plan.targetConfig)) throw new Error('TARGET_CHANGED'); fs.renameSync(backup, plan.targetConfig); }
      if (removedEmpty && !exists(plan.targetConfig)) fs.mkdirSync(plan.targetConfig);
    } catch { recoveryRequired = true; }
    return { ...plan.report, ok: false, status: 'error', loginCopied: false, ...(recoveryRequired ? { requiresAction: true, defaultsBackup: backup } : {}), note: recoveryRequired ? 'snowluma/config 复制及恢复失败，原默认模板保留在备份目录，需人工恢复' : 'snowluma/config 复制失败，目标登录状态未覆盖', errors: [{ source: plan.sourceConfig, target: plan.targetConfig, reason: '登录配置复制失败' }] };
  }
}
