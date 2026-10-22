// Read-only runtime identity checks, shared by setup, process adapters and migration.
// No download, installation, execution or account/configuration reads occur here.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

export const QQ_RUNTIME_VERSION = '9.9.33.51802';
export const EXPECTED_CLIENT_BUILD = '9.9.33-51802';
export const RUNTIME_PROOF_FILE = 'qq-agent-install.json';
// Installation/hash provenance never proves a vendor process's data isolation.
// No reviewed launcher currently establishes isolation for this QQ build. This
// policy belongs to code, not configuration, portable-info or install proofs.
export function inspectQqLaunchIsolation(version) {
  return {
    status: 'unverified', verified: false, version: version ?? null,
    reason: 'QQ 独立数据目录尚未通过真实运行验证，已暂停便携启动，避免使用系统 QQ 数据。',
  };
}
// Values inherited from the explicitly reviewed develop/scripts/setup.mjs.
// The QQ mirror is a repack of installed Tencent files, not an official installer.
export const RUNTIME_DOWNLOADS = Object.freeze({
  qq: Object.freeze({ version: QQ_RUNTIME_VERSION, url: 'https://www.kondius.cn/netdisk/api/download/QQ_portable.zip', sha256: '2b669aae5237b2ce23fb092e4d8a226c3ccd50e87bf917d767c53226f33e8005', origin: 'reviewed-legacy-portable-mirror', maxBytes: 2 * 1024 ** 3 }),
  snowluma: Object.freeze({ version: 'v1.14.19', url: 'https://github.com/SnowLuma/SnowLuma/releases/download/v1.14.19/SnowLuma-v1.14.19-win-x64.zip', sha256: '2c77f0bcbe1f828e2d5109d193e71d8dac995e715dd144222a0a2c60a783c5a5', origin: 'official-github-release-asset', maxBytes: 1024 ** 3 }),
  qqInstaller: Object.freeze({ url: 'https://www.kondius.cn/netdisk/api/download/QQ_9.9.33_260813_x64_01.exe', sha256: 'b25c0d3ce9df764074a9118d0ded927e1b2d7ebf60e306112e8df18a040ec492', origin: 'reviewed-legacy-installer-mirror', note: 'HummerSetup requires manual installation; this filename does not prove build 51802.' }),
});

const fileCaches = new WeakMap();
function streamedDigest(file, fsImpl) {
  const fd = fsImpl.openSync(file, 'r'), chunk = Buffer.alloc(1024 * 1024), digest = createHash('sha256');
  try { for (;;) { const count = fsImpl.readSync(fd, chunk); if (!count) break; digest.update(chunk.subarray(0, count)); } return digest.digest('hex'); }
  finally { fsImpl.closeSync(fd); }
}
function cachedRead(file, fsImpl, kind, transform, fresh = false) {
  const stat = fsImpl.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('运行文件必须是普通文件');
  const signature = `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`;
  let cache = fileCaches.get(fsImpl); if (!cache) { cache = new Map(); fileCaches.set(fsImpl, cache); }
  const key = `${kind}:${file}`, previous = cache.get(key);
  if (!fresh && previous?.signature === signature) return previous.value;
  const value = kind === 'sha256' && fsImpl.openSync && fsImpl.readSync && fsImpl.closeSync ? streamedDigest(file, fsImpl) : transform(fsImpl.readFileSync(file));
  if (cache.size > 256) cache.clear(); cache.set(key, { signature, value }); return value;
}

function json(file, fsImpl) { try { return JSON.parse(fsImpl.readFileSync(file, 'utf8')); } catch { return null; } }
function regular(file, fsImpl) { try { const st = fsImpl.lstatSync(file); return !st.isSymbolicLink() && st.isFile(); } catch { return false; } }
function directory(file, fsImpl) { try { const st = fsImpl.lstatSync(file); return !st.isSymbolicLink() && st.isDirectory(); } catch { return false; } }
function parsed(value) {
  const match = String(value ?? '').match(/^(\d+\.\d+\.\d+)[.-](\d+)$/);
  return match ? { short: match[1], build: match[2], version: `${match[1]}.${match[2]}` } : null;
}

export function readQqVersion(dir, { fsImpl = fs } = {}) {
  try {
    const versions = path.join(dir, 'versions');
    if (!directory(versions, fsImpl)) return null;
    const candidates = fsImpl.readdirSync(versions).map(name => ({ name, ...parsed(name) })).filter(item => item.version && directory(path.join(versions, item.name), fsImpl));
    if (!candidates.length) return null;
    candidates.sort((a, b) => Number(b.build) - Number(a.build));
    const chosen = candidates[0];
    const packageFile = path.join(versions, chosen.name, 'resources', 'app', 'package.json');
    const pkg = json(packageFile, fsImpl);
    const declared = parsed(pkg?.qqVersion ?? pkg?.version) ?? parsed(`${pkg?.version ?? ''}.${pkg?.buildVersion ?? pkg?.build ?? ''}`);
    return { short: chosen.short, build: chosen.build, version: chosen.version, source: path.join('versions', chosen.name), ambiguous: new Set(candidates.map(item => item.version)).size > 1 || Boolean(declared && declared.version !== chosen.version) };
  } catch { return null; }
}

export function readSnowlumaBuild(dir, { fsImpl = fs, fresh = false } = {}) {
  try {
    const file = path.join(dir, 'index.mjs');
    if (!regular(file, fsImpl)) return null;
    return cachedRead(file, fsImpl, 'client-build', bytes => {
      const declarations = [...bytes.toString('utf8').matchAll(/\b(?:var|let|const)\s+(?:CLIENT_BUILD|LIST_QQ_VERSION)\s*=\s*["'](\d+\.\d+\.\d+-\d+)["']/g)].map(item => item[1]);
      return declarations.length && new Set(declarations).size === 1 ? declarations[0] : null;
    }, fresh);
  } catch { return null; }
}

function proofState(dir, kind, version, { fsImpl, fresh = false }) {
  const file = path.join(dir, RUNTIME_PROOF_FILE);
  if (!fsImpl.existsSync(file)) return { proofPresent: false, installationVerified: false, proofValid: false };
  const proof = json(file, fsImpl);
  if (!proof || proof.schema !== 1 || proof.kind !== kind || proof.version !== version || !proof.files || typeof proof.files !== 'object') return { proofPresent: true, installationVerified: false, proofValid: false };
  const required = kind === 'qq' ? ['QQ.exe'] : ['node.exe', 'index.mjs'];
  if (!required.every(name => /^[a-f0-9]{64}$/i.test(proof.files[name] ?? ''))) return { proofPresent: true, installationVerified: false, proofValid: false };
  for (const [relative, expected] of Object.entries(proof.files)) {
    if (!/^[a-f0-9]{64}$/i.test(expected) || relative.includes('\\') || relative.split('/').some(part => !part || part === '.' || part === '..') || path.isAbsolute(relative) || relative.includes(':')) return { proofPresent: true, installationVerified: false, proofValid: false };
    const allowed = kind === 'qq' ? relative === 'QQ.exe' || /^versions\/9\.9\.33[.-]51802\/resources\/app\/package\.json$/.test(relative) : ['node.exe', 'index.mjs'].includes(relative);
    if (!allowed) return { proofPresent: true, installationVerified: false, proofValid: false };
    const target = path.join(dir, relative);
    let parent = dir;
    if (relative.split('/').slice(0, -1).some(segment => { parent = path.join(parent, segment); return !directory(parent, fsImpl); })) return { proofPresent: true, installationVerified: false, proofValid: false };
    try {
      if (!regular(target, fsImpl) || cachedRead(target, fsImpl, 'sha256', bytes => createHash('sha256').update(bytes).digest('hex'), fresh) !== expected.toLowerCase()) return { proofPresent: true, installationVerified: false, proofValid: false };
    } catch { return { proofPresent: true, installationVerified: false, proofValid: false }; }
  }
  // Locally copied, explicitly selected installations have version evidence, not
  // publisher archive provenance. Never label them as archive-verified.
  const archiveVerified = /^[a-f0-9]{64}$/i.test(proof.archiveSha256 ?? '') && proof.source?.type === 'verified-archive';
  return { proofPresent: true, installationVerified: archiveVerified, proofValid: true };
}

export function inspectQqRuntime(dir, { fsImpl = fs, fresh = false } = {}) {
  const present = regular(path.join(dir, 'QQ.exe'), fsImpl);
  const identity = present ? readQqVersion(dir, { fsImpl }) : null;
  const versionKnown = Boolean(identity && !identity.ambiguous);
  const versionMatches = versionKnown && identity.version === QQ_RUNTIME_VERSION;
  const proof = proofState(dir, 'qq', QQ_RUNTIME_VERSION, { fsImpl, fresh });
  const reason = !present ? '便携 QQ 未安装：请先运行 npm run setup' : !identity ? `便携 QQ 版本未知；需要 ${QQ_RUNTIME_VERSION}，可运行 node scripts/setup.mjs --check 核对。` : !versionMatches ? `便携 QQ 版本不符合锁定版本 ${QQ_RUNTIME_VERSION}（实际 ${identity.version}${identity.ambiguous ? '，版本证明存在冲突' : ''}）。` : proof.proofPresent && !proof.proofValid ? '便携 QQ 安装证明失效；请重新校验或安装。' : null;
  const installedReady = present && versionMatches && (!proof.proofPresent || proof.proofValid);
  const launchIsolation = inspectQqLaunchIsolation(identity?.version);
  return { present, version: identity?.version ?? null, versionKnown, versionMatches, ...proof, reason, installedReady, launchAllowed: installedReady && launchIsolation.verified, launchIsolation };
}

export function inspectSnowlumaRuntime(dir, { fsImpl = fs, fresh = false, platform = process.platform, arch = process.arch } = {}) {
  const present = regular(path.join(dir, 'index.mjs'), fsImpl) && regular(path.join(dir, 'node.exe'), fsImpl);
  const clientBuild = readSnowlumaBuild(dir, { fsImpl, fresh });
  const proof = proofState(dir, 'snowluma', RUNTIME_DOWNLOADS.snowluma.version, { fsImpl, fresh });
  // Presence and release identity remain independent of native readiness. Status
  // only inspects ordinary files; it never loads an addon or enumerates QQ.
  const nativePlatformSupported = platform === 'win32' && arch === 'x64';
  const nativeDir = path.join(dir, 'native');
  const nativePresent = directory(nativeDir, fsImpl) && ['snowluma-win32-x64.node', 'snowluma-win32-x64.dll'].every(name => regular(path.join(nativeDir, name), fsImpl));
  const nativeState = !nativePlatformSupported ? 'unsupported' : !nativePresent ? 'missing' : 'unchecked';
  const nativeErrorCode = !nativePlatformSupported ? 'SNOWLUMA_NATIVE_PLATFORM_UNSUPPORTED' : !nativePresent ? 'SNOWLUMA_NATIVE_FILES_MISSING' : null;
  const nativeDiagnosis = !nativePlatformSupported ? '当前 SnowLuma 包仅支持 Windows x64；请使用对应平台和架构的完整运行包。' : !nativePresent ? 'SnowLuma 原生组件不完整：需要 native/snowluma-win32-x64.node 和 .dll 普通文件；请重新安装完整包，并检查安全软件的隔离记录。' : null;
  const reason = proof.proofPresent && !proof.proofValid ? 'SnowLuma 安装证明失效；请重新校验或安装。' : clientBuild && clientBuild !== EXPECTED_CLIENT_BUILD ? `SnowLuma 声明 ${clientBuild}，与 QQ 锁定版本 ${EXPECTED_CLIENT_BUILD} 不一致。` : !clientBuild ? `SnowLuma 握手版本未知；需要 ${EXPECTED_CLIENT_BUILD}，请运行 node scripts/setup.mjs --check 核对或重新安装。` : nativeDiagnosis;
  return { present, clientBuild, buildMatches: clientBuild === EXPECTED_CLIENT_BUILD, ...proof, nativePresent, nativePlatformSupported, nativeState, nativeErrorCode, nativeDiagnosis, reason };
}

// Process management and account discovery must resolve the same installation.
// A selected directory is authoritative even when absent; silently using a
// different package could pair its process with another installation's accounts.
export function resolveSnowlumaDirectory(configuredDir, { appRoot = process.cwd(), fsImpl = fs } = {}) {
  const root = path.resolve(appRoot);
  const configured = String(configuredDir ?? '').trim();
  if (configured) return path.resolve(root, configured);
  const bundled = path.join(root, 'snowluma');
  const present = file => { try { return fsImpl.existsSync(file); } catch { return false; } };
  if (present(bundled)) return bundled;
  // Replace an archive path component, never a similarly named parent folder.
  const segments = root.split(path.sep);
  const archive = segments.findLastIndex(segment => segment.toLowerCase() === 'app.asar');
  if (archive >= 0) {
    segments[archive] = 'app.asar.unpacked';
    const unpacked = path.join(segments.join(path.sep), 'snowluma');
    if (present(unpacked)) return unpacked;
  }
  return bundled;
}
