import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { execFile as nodeExecFile, spawn as nodeSpawn } from 'node:child_process';
import { unavailable } from '../../src/console/route-adapters.js';
import { APP_ROOT } from '../../src/kernel/env.js';
import { inspectQqRuntime, inspectSnowlumaRuntime, resolveSnowlumaDirectory } from './runtime-lock.js';

/**
 * M3 process boundary. The console never spawns or kills external processes itself;
 * adapters own process discovery, lifecycle and platform-specific side effects.
 */
export function createProcessAdapters({ processAdapters, snowluma, qqPortable } = {}) {
  return {
    snowluma: processAdapters?.snowluma ?? snowluma ?? null,
    qqPortable: processAdapters?.qqPortable ?? processAdapters?.['qq-portable'] ?? qqPortable ?? null,
  };
}

export function requireProcessCapability(adapter, feature, method) {
  if (!adapter || typeof adapter[method] !== 'function') {
    unavailable(feature, `${feature}进程能力尚未配置，当前无法执行`);
  }
  return adapter[method].bind(adapter);
}

export function logsDto(value) {
  const logs = Array.isArray(value) ? value : value?.logs;
  return { logs: (Array.isArray(logs) ? logs : []).slice(-200) };
}

export function processError(err, fallback = '进程操作失败') {
  if (err && Number.isInteger(err.status)) {
    err.expose = true;
    return err;
  }
  const out = new Error(String(err?.message ?? fallback));
  out.status = 500;
  out.expose = true;
  return out;
}

export function adapterResultError(result, fallback = '进程操作失败') {
  if (!result || typeof result !== 'object' || result.ok !== false) return null;
  const error = new Error(String(result.error ?? result.message ?? fallback));
  error.status = Number.isInteger(result.status) ? result.status : 500;
  error.expose = true;
  return error;
}

function exposed(message, status = 400) {
  return Object.assign(new Error(message), { expose: true, status });
}

function alive(child) {
  return Boolean(child && child.exitCode == null && !child.killed);
}

function pushLog(buffer, emit, event, stream, text) {
  if (!text) return;
  const entry = { at: Date.now(), stream, text };
  buffer.push(entry);
  if (buffer.length > 500) buffer.splice(0, buffer.length - 500);
  emit?.(event, entry);
}

function pipeLogs(child, buffer, emit, event, onLine, transform = line => line) {
  const pending = { stdout: '', stderr: '' };
  for (const stream of ['stdout', 'stderr']) {
    child?.[stream]?.on?.('data', (chunk) => {
      pending[stream] += String(chunk ?? '');
      const lines = pending[stream].split(/\r?\n/);
      pending[stream] = lines.pop() ?? '';
      for (const raw of lines) { const line = transform(raw); pushLog(buffer, emit, event, stream, line); onLine?.({ stream, text: line }); }
    });
    child?.[stream]?.on?.('end', () => {
      if (pending[stream]) { const line = transform(pending[stream]); pushLog(buffer, emit, event, stream, line); onLine?.({ stream, text: line }); pending[stream] = ''; }
    });
  }
}

function parseJsonFile(file, fsImpl) {
  try { return JSON.parse(fsImpl.readFileSync(file, 'utf8')); } catch { return null; }
}

function exists(file, fsImpl) {
  try { return fsImpl.existsSync(file); } catch { return false; }
}

function snowDirOf(config, appRoot, fsImpl) {
  return resolveSnowlumaDirectory(config?.snowluma?.dir, { appRoot, fsImpl });
}

function runtimeOf(dir, fsImpl) {
  return dir ? parseJsonFile(path.join(dir, 'config', 'runtime.json'), fsImpl) ?? {} : {};
}

function webuiInfo(dir, logs, fsImpl) {
  const runtimeFile = dir ? path.join(dir, 'config', 'runtime.json') : '';
  const runtime = runtimeOf(dir, fsImpl);
  const port = Number(runtime.webuiPort) || 5099;
  const host = typeof runtime.webuiHost === 'string' && runtime.webuiHost.trim() ? runtime.webuiHost.trim() : '127.0.0.1';
  const scheme = runtime.webuiTls?.enabled ? 'https' : 'http';
  let url = exists(runtimeFile, fsImpl) ? `${scheme}://${host}:${port}/` : null;
  for (let i = logs.length - 1; i >= 0; i--) {
    const match = String(logs[i]?.text ?? '').match(/listening\s+(https?:\/\/[^\s]+)/i);
    if (match) { url = match[1]; break; }
  }
  return { host, port, url };
}

function probePort(port, host = '127.0.0.1', timeoutMs = 800, netImpl = net) {
  return new Promise((resolve) => {
    const socket = netImpl.createConnection({ host, port });
    let settled = false;
    const done = (value) => { if (settled) return; settled = true; socket.destroy?.(); resolve(value); };
    socket.setTimeout?.(timeoutMs, () => done(false));
    socket.once?.('connect', () => done(true));
    socket.once?.('error', () => done(false));
  });
}

// 端口能连不等于 SnowLuma 已启动：可能是别的进程占了 5099。
// 只有 HTTP 响应像 WebUI（HTML/JSON 且不是明显的拒绝）才判为外部已运行；
// 不能用网络请求时退回 TCP 探测，保持测试注入兼容。
async function probeWebui(info, { fetchImpl = globalThis.fetch, timeoutMs = 1200 } = {}) {
  if (typeof fetchImpl !== 'function' || !info?.url) return false;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(info.url, { method: 'GET', redirect: 'manual', signal: controller.signal });
    const type = String(res.headers?.get?.('content-type') ?? '').toLowerCase();
    return res.status >= 200 && res.status < 500 && (type.includes('text/html') || type.includes('application/json'));
  } catch { return false; }
  finally { clearTimeout(timer); }
}

function runExec(execFile, command, args, options = {}) {
  return new Promise((resolve, reject) => {
    execFile(command, args, options, (error, stdout = '', stderr = '') => error ? reject(Object.assign(error, { stdout, stderr })) : resolve({ stdout: String(stdout), stderr: String(stderr) }));
  });
}

function bindExit(child, onExit) {
  child?.once?.('exit', (code, signal) => onExit({ code, signal }));
  child?.once?.('error', (error) => onExit({ error }));
}

function createSnowlumaAdapter({ appRoot = APP_ROOT, fsImpl = fs, spawn = nodeSpawn, execFile = nodeExecFile, netImpl = net, fetchImpl = globalThis.fetch, kill = (pid, signal) => process.kill(pid, signal), emit, nativeProbe, snowlumaNativeProbeTimeoutMs = 5000, snowlumaPlatform = process.platform, snowlumaArch = process.arch, snowlumaStopTimeoutMs = 3000, snowlumaStopPollMs = 100 } = {}) {
  const logs = [];
  let proc = null;
  let procEmbedded = false;
  let procContext = null;
  let procDir = null;
  let launching = false;
  let launchEpoch = 0;
  let lastWebuiUrl = null;
  let lastWebuiDir = null;
  let lastRunning = false;
  let lastRunningDir = null;
  let stopIssue = null;
  let probeIssue = null;
  let nativeObservation = null;
  const nativeTimeout = Math.max(1, Math.min(15000, Math.floor(Number(snowlumaNativeProbeTimeoutMs) || 5000)));
  const inspectInstallation = (dir, fresh = false) => inspectSnowlumaRuntime(dir, { fsImpl, fresh, platform: snowlumaPlatform, arch: snowlumaArch });
  const nativeFailure = (state, code, diagnosis, dir) => ({ dir, nativeState: state, nativeErrorCode: code, nativeDiagnosis: diagnosis });
  const nativeLoadFailure = dir => nativeFailure('load_failed', 'SNOWLUMA_NATIVE_LOAD_FAILED', 'SnowLuma 原生模块加载失败；请确认完整 Windows x64 包、运行库及安全软件隔离记录。QQ 进程列表尚未确认，不能据此判断没有 QQ。', dir);
  const nativeTimedOut = dir => nativeFailure('timeout', 'SNOWLUMA_NATIVE_PROBE_TIMEOUT', 'SnowLuma 原生模块检查超时，已停止本次启动；请检查运行库、安全软件或重新安装完整包。', dir);
  // This child loads only the addon and inspects its export shape. It never calls
  // process enumeration, DLL injection, account login or SnowLuma's entry point.
  const probeScript = `let result;try{if(process.platform!=='win32'||process.arch!=='x64'){result={ok:false,code:'SNOWLUMA_NATIVE_PLATFORM_UNSUPPORTED'};}else{const mod={exports:{}};process.dlopen(mod,process.argv[1]);result={ok:['getAllMainProcess','loadModuleManual','unloadModuleManual'].every(key=>typeof mod.exports[key]==='function')};}}catch{result={ok:false,code:'SNOWLUMA_NATIVE_LOAD_FAILED'};}process.stdout.write('QQA_NATIVE_PROBE:'+JSON.stringify(result)+'\\n');process.exitCode=result.ok?0:1;`;
  const defaultNativeProbe = ({ nodeExe, addonPath, dir, timeoutMs }) => new Promise(resolve => {
    let settled = false, child;
    const finish = result => { if (settled) return; settled = true; clearTimeout(timer); resolve(result); };
    const timer = setTimeout(() => { try { child?.kill?.('SIGKILL'); } catch {} finish({ ok: false, code: 'SNOWLUMA_NATIVE_PROBE_TIMEOUT' }); }, timeoutMs);
    const env = { ...process.env }; delete env.NODE_OPTIONS; delete env.NODE_PATH;
    try {
      child = execFile(nodeExe, ['--eval', probeScript, addonPath], { cwd: dir, windowsHide: true, encoding: 'utf8', timeout: timeoutMs, maxBuffer: 64 * 1024, env }, (error, stdout = '') => {
        if (error?.killed || error?.code === 'ETIMEDOUT') return finish({ ok: false, code: 'SNOWLUMA_NATIVE_PROBE_TIMEOUT' });
        const line = String(stdout).split(/\r?\n/).findLast(value => value.startsWith('QQA_NATIVE_PROBE:'));
        try { const result = JSON.parse(line?.slice('QQA_NATIVE_PROBE:'.length)); finish(!error && result?.ok === true ? { ok: true } : { ok: false, code: result?.code }); }
        catch { finish({ ok: false }); }
      });
    } catch { finish({ ok: false }); }
  });
  const checkNative = async (dir, context, assertCurrent) => {
    let timer, result;
    try {
      const request = { nodeExe: path.join(dir, 'node.exe'), addonPath: path.join(dir, 'native', 'snowluma-win32-x64.node'), dllPath: path.join(dir, 'native', 'snowluma-win32-x64.dll'), dir, timeoutMs: nativeTimeout };
      result = await Promise.race([
        Promise.resolve().then(() => (nativeProbe ?? defaultNativeProbe)(request)),
        new Promise(resolve => { timer = setTimeout(() => resolve({ ok: false, code: 'SNOWLUMA_NATIVE_PROBE_TIMEOUT' }), nativeTimeout); }),
      ]);
    } catch { result = { ok: false }; }
    finally { clearTimeout(timer); }
    assertCurrent();
    nativeObservation = result?.ok === true ? { dir, nativeState: 'ready', nativeErrorCode: null, nativeDiagnosis: null }
      : result?.code === 'SNOWLUMA_NATIVE_PROBE_TIMEOUT' ? nativeTimedOut(dir)
        : result?.code === 'SNOWLUMA_NATIVE_PLATFORM_UNSUPPORTED' ? nativeFailure('unsupported', result.code, 'SnowLuma 内置 Node 与原生模块的平台或架构不匹配；需要 Windows x64 完整包。', dir)
          : nativeLoadFailure(dir);
    if (nativeObservation.nativeErrorCode) { publishStatus(context); throw Object.assign(exposed(nativeObservation.nativeDiagnosis), { code: nativeObservation.nativeErrorCode }); }
  };
  const observeNativeLog = (text, dir, current = true) => {
    if (!/(?:ProcessEnumerator|native addon|hook native|\.node\b|process enumeration)/i.test(text)) return text;
    let issue;
    if (/(?:timed?\s*out|timeout)/i.test(text)) issue = nativeFailure('degraded', 'SNOWLUMA_PROCESS_ENUMERATION_TIMEOUT', 'SnowLuma 的 QQ 进程发现超时；QQ 列表待确认，请检查 QQ 与 SnowLuma 是否使用同一 Windows 用户及相同权限级别。', dir);
    else if (/(?:fail|error|not found|unavailable|cannot be isolated)/i.test(text)) issue = nativeFailure('degraded', 'SNOWLUMA_PROCESS_ENUMERATION_FAILED', 'SnowLuma 的 QQ 进程发现或原生模块异常；QQ 列表待确认，请检查完整运行包、安全软件及双方权限级别。', dir);
    if (!issue) return text;
    if (current) nativeObservation = issue;
    // Native loader errors can contain absolute paths and arbitrary dependency
    // diagnostics. Publish a classified message instead of that raw exception.
    return `[${issue.nativeErrorCode}] ${issue.nativeDiagnosis}`;
  };
  const exited = new WeakSet();
  // ChildProcess.killed acknowledges the signal request, not process exit.
  const childRunning = child => Boolean(child && !exited.has(child) && child.exitCode == null && child.signalCode == null);
  const stopTimeout = Math.max(1, Math.min(15000, Number(snowlumaStopTimeoutMs) || 3000));
  const stopPoll = Math.max(1, Math.min(1000, Number(snowlumaStopPollMs) || 100));
  const failStop = (code, error, extra = {}, context) => { stopIssue = error; publishStatus(context); return { ok: false, status: 409, stopped: false, code, error, ...extra }; };
  // The locked v1.14.19 public client/index.html contains all three features.
  // This identifies a WebUI response; it never authorizes killing a process.
  const webuiIdentity = html => /<title>\s*SnowLuma\s+控制台\s*<\/title>/i.test(html)
    && html.includes('snowluma_ui_appearance')
    && /<script\b[^>]*\btype\s*=\s*["']module["'][^>]*\bsrc\s*=\s*["']\/assets\/index-[^"']+\.js["']/i.test(html);
  const readWebui = async response => {
    const limit = 64 * 1024;
    if (!response.body?.getReader) {
      const value = await response.text();
      if (Buffer.byteLength(value, 'utf8') > limit) throw new Error('WebUI response exceeds probe limit');
      return value;
    }
    const reader = response.body.getReader(), chunks = []; let bytes = 0;
    try {
      for (;;) { const { done, value } = await reader.read(); if (done) break; bytes += value.byteLength; if (bytes > limit) { await reader.cancel(); throw new Error('WebUI response exceeds probe limit'); } chunks.push(Buffer.from(value)); }
      return Buffer.concat(chunks, bytes).toString('utf8');
    } finally { reader.releaseLock(); }
  };
  const probeExternal = async info => {
    const occupied = await probePort(info.port, info.host, 800, netImpl);
    if (!occupied) return { running: false, occupied: false, diagnosis: null };
    const diagnosis = `SnowLuma WebUI 地址 ${info.host}:${info.port} 已有服务占用，但尚未确认是 SnowLuma；请检查端口或重新核对运行状态。`;
    if (typeof fetchImpl !== 'function') return { running: false, occupied: true, diagnosis };
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 1200);
    const aborted = new Promise((_, reject) => controller.signal.addEventListener('abort', () => reject(new Error('WebUI probe timed out')), { once: true }));
    try {
      const url = info.url ?? `http://${info.host}:${info.port}/`;
      const read = (async () => {
        const response = await fetchImpl(url, { method: 'GET', redirect: 'manual', signal: controller.signal });
        const type = String(response.headers?.get?.('content-type') ?? '').toLowerCase();
        if (response.status < 200 || response.status >= 300 || !type.includes('text/html')) return false;
        return webuiIdentity(await readWebui(response));
      })();
      const running = await Promise.race([read, aborted]);
      return { running, occupied: true, diagnosis: running ? null : diagnosis };
    } catch { return { running: false, occupied: true, diagnosis }; }
    finally { clearTimeout(timer); }
  };
  const normalized = value => path.normalize(String(value ?? '')).replace(/[\\/]+$/, '').toLowerCase();
  const absolute = value => path.isAbsolute(value) || path.win32.isAbsolute(value);
  const argvOf = text => {
    const args = []; let token = '', quoted = false, started = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (/\s/.test(ch) && !quoted) { if (started) args.push(token); token = ''; started = false; continue; }
      started = true;
      if (ch === '\\') {
        let count = 1; while (text[i + 1] === '\\') { count++; i++; }
        if (text[i + 1] === '"') { token += '\\'.repeat(Math.floor(count / 2)); i++; if (count % 2) token += '"'; else quoted = !quoted; }
        else token += '\\'.repeat(count);
      } else if (ch === '"') quoted = !quoted;
      else token += ch;
    }
    if (quoted) return [];
    if (started) args.push(token);
    return args;
  };
  const nodeEntry = row => {
    const exe = String(row?.ExecutablePath ?? ''), argv = argvOf(String(row?.CommandLine ?? ''));
    if (!absolute(exe) || path.basename(exe).toLowerCase() !== 'node.exe' || !argv.length) return null;
    if (absolute(argv[0]) ? normalized(argv[0]) !== normalized(exe) : !/^node(?:\.exe)?$/i.test(argv[0])) return null;
    const entry = argv[1] === '--' ? argv[2] : argv[1];
    // Do not mistake --eval/--require arguments or arbitrary later text for an entry.
    return entry && !entry.startsWith('-') ? { exe, entry } : null;
  };
  const listSnowProcesses = async () => {
    const script = `[Console]::OutputEncoding=[Text.Encoding]::UTF8; @(Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Select-Object ProcessId,ExecutablePath,CommandLine,@{Name='CreatedAt';Expression={$_.CreationDate.ToUniversalTime().ToString('o')}}) | ConvertTo-Json -Compress`;
    const result = await runExec(execFile, 'powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, encoding: 'utf8', timeout: 10000, maxBuffer: 2 * 1024 * 1024 });
    if (!result.stdout.trim()) return [];
    const parsed = JSON.parse(result.stdout.replace(/^\uFEFF/, ''));
    return (Array.isArray(parsed) ? parsed : [parsed]).filter(row => Number.isSafeInteger(Number(row?.ProcessId)) && Number(row.ProcessId) > 0);
  };
  const selected = (row, dir) => { const entry = nodeEntry(row); return entry && absolute(entry.entry) && normalized(entry.entry) === normalized(path.join(dir, 'index.mjs')); };
  const sameProcess = (left, right) => Number(left.ProcessId) === Number(right.ProcessId) && typeof left.CreatedAt === 'string' && left.CreatedAt.length > 0 && left.CreatedAt === right.CreatedAt && normalized(left.ExecutablePath) === normalized(right.ExecutablePath) && left.CommandLine === right.CommandLine;
  const terminateChild = child => new Promise(resolve => {
    let settled = false;
    const done = (confirmed, error) => { if (settled) return; settled = true; clearTimeout(timer); child.removeListener?.('exit', onExit); resolve({ confirmed, error }); };
    const onExit = () => { exited.add(child); done(true); };
    const timer = setTimeout(() => done(false, 'SnowLuma 停止请求已发出，但未确认进程退出；请重试或手工关闭。'), stopTimeout);
    child.once?.('exit', onExit);
    try { child.kill?.('SIGTERM'); if (!childRunning(child)) done(true); }
    catch (error) { done(false, `SnowLuma 停止失败：${String(error?.message ?? error)}`); }
  });
  const stopEmbedded = async () => {
    const child = proc, context = procContext, pid = child.pid ?? null;
    const result = await terminateChild(child);
    if (!result.confirmed) return failStop('SNOWLUMA_EXIT_UNCONFIRMED', result.error, { embedded: true, pid }, context);
    // An actual exit already publishes its snapshot. Do not clear a newer
    // child's state or duplicate that notification after this await resumes.
    if (proc === child) { proc = null; procEmbedded = false; procContext = null; procDir = null; lastRunning = false; stopIssue = null; probeIssue = null; publishStatus(context); }
    return { ok: true, stopped: true, embedded: true, pid, exitConfirmed: true };
  };
  const contextConfig = (context) => context?.config ?? {};
  const currentDir = (context) => snowDirOf(contextConfig(context), appRoot, fsImpl);
  const canonicalDir = dir => {
    if (!dir) return null;
    let resolved = dir;
    try { resolved = fsImpl.realpathSync(dir); } catch {}
    return (path.win32.isAbsolute(resolved) ? path.win32.normalize(resolved) : path.resolve(resolved)).replace(/[\\/]+$/, '').toLowerCase();
  };
  const sameDir = (left, right) => Boolean(left && right && canonicalDir(left) === canonicalDir(right));
  const changedRuntimeDiagnosis = '此 Agent 先前启动的另一目录 SnowLuma 组件仍在运行；请先停止原实例，再启动所选目录。';
  const changedRuntime = dir => Boolean(procEmbedded && childRunning(proc) && !sameDir(procDir, dir));
  const changedRuntimeError = () => Object.assign(exposed(changedRuntimeDiagnosis, 409), { code: 'SNOWLUMA_RUNTIME_CHANGED' });
  // Remembered WebUI addresses and running observations belong to their actual
  // directory, rather than whichever configuration is supplied by a later call.
  const webuiUrlFor = (dir, info) => sameDir(lastWebuiDir, dir) ? lastWebuiUrl ?? info.url : info.url;
  const installationStatus = dir => {
    const info = inspectInstallation(dir);
    const observed = info.nativeState === 'unchecked' && sameDir(nativeObservation?.dir, dir) ? nativeObservation : info;
    return { clientBuild: info.clientBuild, versionVerified: info.buildMatches, installationVerified: info.installationVerified, nativePresent: info.nativePresent, nativeState: observed.nativeState, nativeErrorCode: observed.nativeErrorCode, nativeDiagnosis: observed.nativeDiagnosis, qqProcessState: 'unknown', qqProcessDiagnosis: observed.nativeDiagnosis ?? 'QQ 进程可见性尚未核对；WebUI 已运行不代表已发现 QQ 或账号已连接。', diagnosis: info.reason ?? observed.nativeDiagnosis };
  };
  const changedRuntimeStatus = dir => ({ ...installationStatus(dir), diagnosis: changedRuntimeDiagnosis, code: 'SNOWLUMA_RUNTIME_CHANGED', processErrorCode: 'SNOWLUMA_RUNTIME_CHANGED', processState: 'unknown', running: false, configured: Boolean(dir && exists(dir, fsImpl)), pid: null, embedded: false, ownedRuntimeRunning: true, webuiUrl: webuiUrlFor(dir, webuiInfo(dir, [], fsImpl)) });
  const statusSync = (context) => {
    const dir = currentDir(context);
    if (changedRuntime(dir)) return changedRuntimeStatus(dir);
    const info = webuiInfo(dir, [], fsImpl);
    const owned = procEmbedded && childRunning(proc) && sameDir(procDir, dir), observedHere = sameDir(lastRunningDir, dir), running = (observedHere && lastRunning) || owned;
    const issue = stopIssue || (!owned && observedHere && probeIssue);
    return { ...installationStatus(dir), ...(issue ? { diagnosis: issue } : {}), code: null, processErrorCode: null, processState: issue ? 'unknown' : running ? 'running' : 'stopped', running, configured: Boolean(dir && exists(dir, fsImpl)), pid: childRunning(proc) && sameDir(procDir, dir) ? proc.pid ?? null : null, embedded: procEmbedded && sameDir(procDir, dir), webuiUrl: webuiUrlFor(dir, info) };
  };
  const publishStatus = context => (context?.emit ?? emit)?.('snowluma.status', statusSync(context));
  const status = async (context) => {
    const dir = currentDir(context);
    if (changedRuntime(dir)) return changedRuntimeStatus(dir);
    const info = webuiInfo(dir, [], fsImpl);
    let running = false;
    if (dir && procEmbedded && childRunning(proc)) { running = true; probeIssue = null; }
    else if (dir && stopIssue && lastRunning && sameDir(lastRunningDir, dir)) running = true;
    else if (dir && exists(dir, fsImpl)) { const probe = await probeExternal(info); running = probe.running; probeIssue = probe.diagnosis; }
    else probeIssue = null;
    lastRunning = running;
    lastRunningDir = dir;
    const issue = stopIssue || probeIssue;
    return { ...installationStatus(dir), ...(issue ? { diagnosis: issue } : {}), code: null, processErrorCode: null, processState: issue ? 'unknown' : running ? 'running' : 'stopped', running, configured: Boolean(dir && exists(dir, fsImpl)), pid: childRunning(proc) && sameDir(procDir, dir) ? proc.pid ?? null : null, embedded: procEmbedded && sameDir(procDir, dir), webuiUrl: webuiUrlFor(dir, info) };
  };
  const portOpen = async (url) => {
    let parsed;
    try { parsed = new URL(String(url)); } catch { return false; }
    return probePort(Number(parsed.port || 80), parsed.hostname || '127.0.0.1', 800, netImpl);
  };
  const tokenCandidates = (context) => {
    const dir = currentDir(context);
    const config = contextConfig(context);
    const configured = [config.snowluma?.accessToken, config.onebot?.accessToken].filter((token) => typeof token === 'string' && token);
    const discovered = [];
    let files = [];
    try { files = fsImpl.readdirSync(path.join(dir, 'config')).filter((name) => /^onebot_\d+\.json$/i.test(name) && name !== 'onebot_0.json').sort(); } catch { files = []; }
    for (const file of files) {
      const parsed = parseJsonFile(path.join(dir, 'config', file), fsImpl);
      for (const group of [parsed?.networks?.wsServers, parsed?.networks?.httpServers]) {
        for (const item of Array.isArray(group) ? group : []) if (item?.accessToken) discovered.push(String(item.accessToken));
      }
    }
    return [...new Set([...configured, ...discovered, ''])];
  };
  const ensureAutoLaunch = async (context) => {
    let current = await status(context);
    if (current.running) return { ...current, launched: false };
    try { await launch({}, context); } catch (error) { return { ...statusSync(context), launched: false, code: typeof error?.code === 'string' ? error.code : null, error: String(error?.message ?? error) }; }
    for (let attempt = 0; attempt < 20; attempt += 1) {
      current = await status(context);
      if (current.running) return { ...current, launched: true };
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    return { ...(await status(context)), launched: true, error: 'SnowLuma WebUI 在 20 秒内未就绪' };
  };
  const launch = async (body, context) => {
    void body;
    const dir = currentDir(context);
    if (changedRuntime(dir)) throw changedRuntimeError();
    if (!dir || !exists(dir, fsImpl)) throw exposed('找不到 SnowLuma 目录：请确认项目内 snowluma/ 文件夹存在，或在设置里填写 SnowLuma 目录');
    const launcherPath = path.join(dir, 'launcher.bat');
    if (!exists(path.join(dir, 'node.exe'), fsImpl) && exists(launcherPath, fsImpl) && /[&|<>^()%!\r\n]/.test(launcherPath)) throw exposed('SnowLuma 批处理路径包含命令元字符；请改用完整内置 node.exe/index.mjs 包或普通安装路径');
    const installation = inspectInstallation(dir, true);
    if (installation.reason) throw Object.assign(exposed(installation.reason), { code: installation.reason === installation.nativeDiagnosis ? installation.nativeErrorCode : 'SNOWLUMA_INSTALLATION_INVALID' });
    if (!installation.buildMatches) throw exposed('SnowLuma 握手版本未知或不符合锁定版本，请先运行 setup:check 核对');
    if (!installation.present && exists(path.join(dir, 'node.exe'), fsImpl)) throw Object.assign(exposed('SnowLuma 启动文件不完整或不是普通文件；需要完整 node.exe/index.mjs 包，无法执行原生组件检查。'), { code: 'SNOWLUMA_RUNTIME_FILES_MISSING' });
    if (stopIssue) throw exposed(stopIssue, 409);
    const info = webuiInfo(dir, [], fsImpl);
    if (launching) throw exposed('SnowLuma 正在启动，请稍候');
    if (childRunning(proc)) throw exposed('SnowLuma 已经在运行');
    launching = true;
    const epoch = ++launchEpoch;
    const assertCurrent = () => {
      if (launchEpoch !== epoch) throw Object.assign(exposed('SnowLuma 启动请求已取消；未启动新的组件进程。', 409), { code: 'SNOWLUMA_LAUNCH_CANCELLED' });
      if (!sameDir(currentDir(context), dir)) throw Object.assign(exposed('SnowLuma 所选目录在启动检查期间发生变化；请重新启动当前所选目录。', 409), { code: 'SNOWLUMA_RUNTIME_CHANGED' });
    };
    try {
      const probe = await probeExternal(info);
      assertCurrent();
      probeIssue = probe.diagnosis;
      if (probe.occupied) throw exposed(probe.running ? 'SnowLuma WebUI 已经在运行' : probe.diagnosis, 409);
      const nodeExe = path.join(dir, 'node.exe');
      const indexMjs = path.join(dir, 'index.mjs');
      const launcher = path.join(dir, 'launcher.bat');
      let embedded = false;
      let child;
      if (installation.present) {
        await checkNative(dir, context, assertCurrent);
        assertCurrent();
        const finalInstallation = inspectInstallation(dir, true);
        if (!finalInstallation.present || finalInstallation.reason) throw Object.assign(exposed(finalInstallation.reason ?? 'SnowLuma 启动文件在检查期间发生变化，请重新检查完整运行包。'), { code: 'SNOWLUMA_RUNTIME_CHANGED' });
        assertCurrent();
        child = spawn(nodeExe, [indexMjs], { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, detached: false });
        embedded = true;
        pipeLogs(child, logs, context?.emit ?? emit, 'snowluma.log', ({ text }) => {
          const match = text.match(/listening\s+(https?:\/\/[^\s]+)/i);
          if (proc === child && match) { lastWebuiUrl = match[1]; lastWebuiDir = dir; }
          if (proc === child && /^\[SNOWLUMA_PROCESS_ENUMERATION_/.test(text)) publishStatus(context);
        }, text => observeNativeLog(text, dir, proc === child));
      } else if (exists(launcher, fsImpl)) {
        if (/[&|<>^()%!\r\n]/.test(launcher)) throw exposed('SnowLuma 批处理路径包含命令元字符；请改用完整内置 node.exe/index.mjs 包或普通安装路径');
        assertCurrent();
        nativeObservation = { dir, nativeState: 'unchecked', nativeErrorCode: null, nativeDiagnosis: 'SnowLuma 使用外部启动方式，尚未验证原生加载；请核对日志和 QQ 进程列表，实际账号连接仍需 OneBot 验证。' };
        child = spawn('cmd.exe', ['/c', launcher], { cwd: dir, detached: true, stdio: 'ignore', windowsHide: false });
        child?.unref?.();
      } else {
        throw new Error('SnowLuma 启动文件不存在：需要 node.exe/index.mjs 或 launcher.bat');
      }
      proc = child;
      procEmbedded = embedded;
      procContext = context;
      procDir = dir;
      lastRunning = embedded;
      lastRunningDir = dir;
      probeIssue = embedded ? null : '启动器已运行，但尚未确认 SnowLuma WebUI 状态；请稍候重新查询。';
      const onExit = ({ error }) => {
        if (error && child.pid && childRunning(child)) { context?.log?.error?.(`[snowluma] ${error.message}`); return; }
        exited.add(child);
        if (proc !== child) return;
        proc = null;
        procEmbedded = false;
        procContext = null;
        procDir = null;
        lastRunning = false;
        // Only the owned runtime's exit resolves its stop error; a detached
        // launcher wrapper exiting does not prove its external Node exited.
        if (embedded) { stopIssue = null; probeIssue = null; }
        if (error) context?.log?.error?.(`[snowluma] ${error.message}`);
        publishStatus(context);
      };
      const onChildError = error => onExit({ error });
      child?.once?.('exit', (code, signal) => { child.removeListener?.('error', onChildError); onExit({ code, signal }); });
      if (typeof child?.on === 'function') child.on('error', onChildError);
      else child?.once?.('error', onChildError);
      lastWebuiUrl = info.url;
      lastWebuiDir = dir;
      publishStatus(context);
      return { ok: true, launched: true, embedded };
    } finally { launching = false; }
  };
  const shutdown = async () => {
    launchEpoch++;
    if (!childRunning(proc) || !procEmbedded) return { stopped: false };
    const result = await stopEmbedded();
    if (!result.ok) throw exposed(result.error, 503);
    return result;
  };
  const stop = async (context) => {
    launchEpoch++;
    const dir = currentDir(context);
    if (childRunning(proc) && procEmbedded) return stopEmbedded();
    if (!dir) return { ok: true, stopped: false, embedded: false, pid: null, reason: 'not_configured' };
    let rows;
    try { rows = await listSnowProcesses(); }
    catch { return failStop('SNOWLUMA_PROCESS_DISCOVERY_FAILED', '无法查询 SnowLuma 进程，尚未确认停止；请重试或手工关闭。', {}, context); }
    const targets = rows.filter(row => selected(row, dir));
    if (!targets.length) {
      const relative = rows.some(row => { const entry = nodeEntry(row); return entry && normalized(entry.exe) === normalized(path.join(dir, 'node.exe')) && !absolute(entry.entry) && /(?:^|[\\/])index\.mjs$/i.test(entry.entry); });
      const info = webuiInfo(dir, [], fsImpl);
      const probe = await probeExternal(info); probeIssue = probe.diagnosis;
      if (relative || probe.occupied || childRunning(proc)) return failStop('SNOWLUMA_PROCESS_IDENTITY_UNCONFIRMED', '无法确认 SnowLuma 的完整入口或相对路径工作目录，未停止任何进程；请手工关闭或从本程序重新启动。', {}, context);
      proc = null; procEmbedded = false; procContext = null; procDir = null; lastRunning = false; stopIssue = null; probeIssue = null; publishStatus(context);
      return { ok: true, stopped: false, embedded: false, pid: null, reason: 'not_running' };
    }
    lastRunning = true;
    lastRunningDir = dir;
    const pids = targets.map(row => Number(row.ProcessId));
    try {
      for (const target of targets) {
        const current = (await listSnowProcesses()).find(row => Number(row.ProcessId) === Number(target.ProcessId));
        if (!current) continue;
        if (!sameProcess(target, current)) return failStop('SNOWLUMA_PROCESS_IDENTITY_CHANGED', 'SnowLuma 进程身份已变化，未确认停止；请重新核对后重试。', {}, context);
        kill(Number(target.ProcessId), 'SIGTERM');
      }
      const deadline = Date.now() + stopTimeout;
      for (;;) {
        const remaining = (await listSnowProcesses()).filter(row => selected(row, dir));
        if (!remaining.length) break;
        if (Date.now() >= deadline) return failStop('SNOWLUMA_EXIT_UNCONFIRMED', 'SnowLuma 停止请求已发出，但未确认进程退出；请重试或手工关闭。', { pids }, context);
        await new Promise(resolve => setTimeout(resolve, stopPoll));
      }
    } catch { return failStop('SNOWLUMA_STOP_FAILED', 'SnowLuma 进程停止或退出核对失败，未确认停止；请重试或手工关闭。', { pids }, context); }
    proc = null; procEmbedded = false; procContext = null; procDir = null; lastRunning = false; stopIssue = null; probeIssue = null; publishStatus(context);
    return { ok: true, stopped: true, embedded: false, pid: pids[0], pids, exitConfirmed: true };
  };
  const openFolder = async (context) => {
    const dir = currentDir(context);
    if (!dir || !exists(dir, fsImpl)) throw exposed('找不到 SnowLuma 目录');
    const child = spawn('explorer.exe', [dir], { detached: true, stdio: 'ignore', windowsHide: true });
    child?.unref?.();
    return { ok: true };
  };
  const openWebui = async (context) => {
    const dir = currentDir(context);
    if (changedRuntime(dir)) throw changedRuntimeError();
    const info = webuiInfo(dir, [], fsImpl);
    const url = webuiUrlFor(dir, info);
    if (!url) throw exposed('没有找到 SnowLuma WebUI 地址（等日志出现 listening 后再试）');
    let target; try { target = new URL(url); } catch { throw exposed('SnowLuma WebUI 地址无效'); }
    if (!['http:', 'https:'].includes(target.protocol) || target.username || target.password) throw exposed('SnowLuma WebUI 只接受不含凭据的 HTTP(S) 地址');
    const child = spawn('explorer.exe', [target.href], { detached: true, stdio: 'ignore', windowsHide: true });
    child?.unref?.();
    return { ok: true, webuiUrl: url };
  };
  return { launch, stop, shutdown, ensureAutoLaunch, tokenCandidates, portOpen, logs: () => ({ logs }), openFolder, openWebui, status, statusSync };
}

function createPortableAdapter({ appRoot = APP_ROOT, fsImpl = fs, spawn = nodeSpawn, execFile = nodeExecFile, kill = null, emit, qqPortableStopTimeoutMs = 8000, qqPortableStopPollMs = 100, qqPortableQueryTimeoutMs = 2000 } = {}) {
  const logs = [];
  let proc = null;
  const dir = path.join(appRoot, 'runtime', 'qq-portable');
  const dataDir = path.join(appRoot, 'runtime', 'qq-portable-data');
  const exe = path.join(dir, 'QQ.exe');
  const installation = (fresh = false) => inspectQqRuntime(dir, { fsImpl, fresh });
  const installationStatus = () => {
    const info = installation();
    // A manual installation can prove its version without publisher archive
    // provenance; an unknown or incompatible version is never marked ready.
    // Neither provenance nor --user-data-dir establishes vendor data isolation.
    return { ready: info.launchAllowed, installedReady: info.installedReady, launchAllowed: info.launchAllowed, launchIsolation: info.launchIsolation, version: info.version, versionVerified: info.versionMatches, installationVerified: info.installationVerified, installationDiagnosis: info.reason, diagnosis: info.reason ?? info.launchIsolation.reason };
  };
  const queryTimeout = Math.max(1, Math.floor(Math.min(2000, Number(qqPortableQueryTimeoutMs) || 2000)));
  const stopTimeout = Math.max(1, Math.floor(Math.min(10000, Number(qqPortableStopTimeoutMs) || 8000)));
  const stopPoll = Math.max(1, Math.floor(Math.min(1000, Number(qqPortableStopPollMs) || 100)));
  let lastRows = [], processState = 'unknown', processIssue = 'QQ 进程状态尚未核对，请在 SnowLuma 面板刷新。', lastError = null;
  let operationTail = Promise.resolve(), statusPromise = null, stopPromise = null, lastPublished = '';
  const absolute = value => typeof value === 'string' && (path.isAbsolute(value) || path.win32.isAbsolute(value));
  const normalized = value => (path.win32.isAbsolute(value) ? path.win32.normalize(value) : path.normalize(value)).replace(/[\\/]+$/, '').toLowerCase();
  const fixedExecutables = () => {
    const files = [exe];
    // The only additional executable is the locked vendor layout, never a
    // directory prefix, arbitrary version, configured path or command-line text.
    if (installation().versionMatches) files.push(path.join(dir, 'versions', '9.9.33-51802', 'QQ.exe'));
    return new Set(files.map(normalized));
  };
  // WMI dates lose precision. Native FILETIME stays a decimal string all the way
  // through discovery and the held-handle identity check; never a JS Number.
  const validTicks = value => typeof value === 'string' && /^[1-9][0-9]{0,19}$/.test(value) && BigInt(value) <= 0xffffffffffffffffn;
  const encoded = value => Buffer.from(JSON.stringify(value), 'utf8').toString('base64');
  const nativePrelude = String.raw`$ErrorActionPreference='Stop'; [Console]::OutputEncoding=[Text.Encoding]::UTF8;
Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Diagnostics;
using System.Globalization;
using System.Runtime.InteropServices;
using System.Text;
public static class QqaPortableNativePid {
  [StructLayout(LayoutKind.Sequential)] public struct FileTime { public uint Low; public uint High; }
  [DllImport("kernel32.dll", SetLastError=true)] public static extern IntPtr OpenProcess(uint access, bool inherit, uint processId);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, ExactSpelling=true, SetLastError=true)]
  [return: MarshalAs(UnmanagedType.Bool)] public static extern bool QueryFullProcessImageNameW(IntPtr process, uint flags, StringBuilder name, ref uint size);
  [DllImport("kernel32.dll", SetLastError=true)]
  [return: MarshalAs(UnmanagedType.Bool)] public static extern bool GetProcessTimes(IntPtr process, out FileTime creation, out FileTime exit, out FileTime kernel, out FileTime user);
  [DllImport("kernel32.dll", SetLastError=true)]
  [return: MarshalAs(UnmanagedType.Bool)] public static extern bool TerminateProcess(IntPtr process, uint exitCode);
  [DllImport("kernel32.dll", SetLastError=true)]
  [return: MarshalAs(UnmanagedType.Bool)] public static extern bool CloseHandle(IntPtr handle);
  public static string Image(IntPtr handle) {
    var image=new StringBuilder(32768); uint size=(uint)image.Capacity;
    if (!QueryFullProcessImageNameW(handle, 0, image, ref size)) throw new Win32Exception(Marshal.GetLastWin32Error());
    return image.ToString();
  }
  public static string CreationTicks(IntPtr handle) {
    FileTime creation, exit, kernel, user;
    if (!GetProcessTimes(handle, out creation, out exit, out kernel, out user)) throw new Win32Exception(Marshal.GetLastWin32Error());
    return (((ulong)creation.High << 32) | creation.Low).ToString(CultureInfo.InvariantCulture);
  }
  public static uint[] QqProcessIds() {
    var processes=Process.GetProcessesByName("QQ");
    try {
      var ids=new uint[processes.Length];
      for (int index=0; index<processes.Length; index++) ids[index]=checked((uint)processes[index].Id);
      return ids;
    } finally { foreach (var process in processes) process.Dispose(); }
  }
}
'@;
function NormalizedImage([string]$image) { return [IO.Path]::GetFullPath($image).TrimEnd([char[]]@('\','/')); }
function SameImage([string]$left,[string]$right) { return [string]::Equals((NormalizedImage $left),(NormalizedImage $right),[StringComparison]::OrdinalIgnoreCase); }
`;
  const runPowerShell = async (script, deadline, failureMessage) => {
    // Node validates timeout as an integer. Floor also avoids crossing the
    // monotonic operation deadline when less than one millisecond remains.
    const timeout = Math.floor(Math.min(queryTimeout, deadline - performance.now()));
    if (timeout < 1) throw new Error('QQ 进程操作已达到时间上限，请重试。');
    let timer;
    try {
      const result = await Promise.race([
        runExec(execFile, 'powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, encoding: 'utf8', timeout, maxBuffer: 2 * 1024 * 1024 }),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(failureMessage)), timeout); }),
      ]);
      return JSON.parse(result.stdout.replace(/^\uFEFF/, ''));
    } finally { clearTimeout(timer); }
  };
  const listProcesses = async deadline => {
      const allowed = fixedExecutables();
      const script = `${nativePrelude}
# QQ_PORTABLE_DISCOVER: readonly PID enumeration, native image identity and fixed executable allowlist.
$decodedAllowed=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encoded([...allowed])}')) | ConvertFrom-Json;
$allowed=@($decodedAllowed);
$rows=@(foreach ($processId in @([QqaPortableNativePid]::QqProcessIds())) {
    $handle=[QqaPortableNativePid]::OpenProcess(0x1000,$false,[uint32]$processId);
    if ($handle -eq [IntPtr]::Zero) { throw "QQ native query handle unavailable: $([Runtime.InteropServices.Marshal]::GetLastWin32Error())"; }
    try {
      $image=[QqaPortableNativePid]::Image($handle); $ticks=$null; $owned=$false;
      foreach ($file in $allowed) { if (SameImage $image $file) { $owned=$true; break; } }
      if ($owned) { $ticks=[QqaPortableNativePid]::CreationTicks($handle); }
      [pscustomobject]@{ProcessId=$processId;ExecutablePath=$image;CreationTimeTicks=$ticks}
    } finally { [void][QqaPortableNativePid]::CloseHandle($handle); }
}); ConvertTo-Json -InputObject $rows -Compress`;
      const parsed = await runPowerShell(script, deadline, 'QQ 进程查询超时，请重试。');
      const rows = Array.isArray(parsed) ? parsed : parsed && typeof parsed === 'object' ? [parsed] : null;
      if (!rows) throw new Error('QQ 进程查询未返回有效列表。');
      const seen = new Set();
      for (const row of rows) {
        const pid = Number(row?.ProcessId);
        if (!Number.isSafeInteger(pid) || pid <= 0 || pid > 0xffffffff || !absolute(row?.ExecutablePath) || seen.has(pid)) throw new Error('QQ 进程路径或身份信息不完整，请重新核对。');
        seen.add(pid);
      }
      const targets = rows.filter(row => allowed.has(normalized(row.ExecutablePath))).sort((a, b) => Number(a.ProcessId) - Number(b.ProcessId));
      if (targets.some(row => !validTicks(row.CreationTimeTicks))) throw new Error('QQ 进程原生创建时间未知，未授权停止。');
      return { all: rows, targets };
  };
  const sameProcess = (left, right) => Number(left.ProcessId) === Number(right.ProcessId) && left.CreationTimeTicks === right.CreationTimeTicks && normalized(left.ExecutablePath) === normalized(right.ExecutablePath);
  const terminateTargets = async (targets, deadline) => {
    const remaining = Math.floor(Math.min(queryTimeout, deadline - performance.now()));
    if (remaining < 1) throw new Error('QQ 停止操作已达到时间上限，未发送后续停止请求。');
    const request = encoded({ Targets: targets.map(target => ({ ProcessId: Number(target.ProcessId), ExecutablePath: target.ExecutablePath, CreationTimeTicks: target.CreationTimeTicks })), DeadlineEpochMs: String(Date.now() + remaining) });
    const script = `${nativePrelude}
# QQ_PORTABLE_TERMINATE_HELD: fixed batch, all identities held before termination, no PID reopen.
$request=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${request}')) | ConvertFrom-Json;
$held=New-Object 'System.Collections.Generic.List[object]'; $terminated=New-Object 'System.Collections.Generic.List[object]';
try {
  foreach ($target in @($request.Targets)) {
    if ([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() -ge [long]$request.DeadlineEpochMs) { throw 'QQ stop deadline elapsed before native open'; }
    $handle=[QqaPortableNativePid]::OpenProcess(0x1001,$false,[uint32]$target.ProcessId);
    if ($handle -eq [IntPtr]::Zero) { throw "QQ native stop handle unavailable: $([Runtime.InteropServices.Marshal]::GetLastWin32Error())"; }
    $owned=[pscustomobject]@{Handle=$handle;Target=$target}; $held.Add($owned);
    $nativeImage=[QqaPortableNativePid]::Image($handle); $nativeTicks=[QqaPortableNativePid]::CreationTicks($handle);
    if (-not (SameImage $nativeImage ([string]$target.ExecutablePath)) -or $nativeTicks -cne [string]$target.CreationTimeTicks) { throw 'QQ native identity changed; no termination'; }
  }
  foreach ($owned in $held) {
    if ([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() -ge [long]$request.DeadlineEpochMs) { throw 'QQ stop deadline elapsed before termination'; }
    if (-not [QqaPortableNativePid]::TerminateProcess($owned.Handle,1)) { throw "QQ native termination failed: $([Runtime.InteropServices.Marshal]::GetLastWin32Error())"; }
    $terminated.Add($owned.Target);
  }
  [pscustomobject]@{ok=$true;acknowledged=$true;Targets=$terminated.ToArray()} | ConvertTo-Json -Depth 5 -Compress;
} catch {
  [pscustomobject]@{ok=$false;acknowledged=$false;error=$_.Exception.Message;Targets=$terminated.ToArray()} | ConvertTo-Json -Depth 5 -Compress;
} finally { foreach ($owned in $held) { [void][QqaPortableNativePid]::CloseHandle($owned.Handle); } }`;
    const ack = await runPowerShell(script, deadline, 'QQ 停止请求超时，退出状态待确认。');
    if (ack?.ok !== true || ack?.acknowledged !== true || !Array.isArray(ack.Targets) || ack.Targets.length !== targets.length || ack.Targets.some((row, index) => !sameProcess(targets[index], row))) throw new Error(ack?.error || 'QQ 停止请求身份确认失败，请重试。');
  };
  const statusSync = () => ({ ...installationStatus(), running: lastRows.length > 0 ? true : processState === 'stopped' ? false : null, pid: lastRows.length ? Number(lastRows[0].ProcessId) : null, pids: lastRows.map(row => Number(row.ProcessId)), processState, processDiagnosis: processIssue, error: lastError, discoveryVerified: processState !== 'unknown', dir, dataDir });
  const publishStatus = (force = false) => {
    const dto = statusSync(), serialized = JSON.stringify(dto);
    if (force || serialized !== lastPublished) { lastPublished = serialized; emit?.('qq-portable.status', dto); }
    return dto;
  };
  const observed = result => { lastRows = result.targets; processState = lastRows.length ? 'running' : 'stopped'; processIssue = null; lastError = null; };
  const unknown = error => { processState = 'unknown'; processIssue = `QQ 进程状态待确认：${String(error?.message ?? error).slice(0, 500)}`; lastError = processIssue; };
  const serialize = fn => { const work = operationTail.then(fn); operationTail = work.catch(() => {}); return work; };
  const status = () => {
    if (stopPromise) return stopPromise.then(() => statusSync());
    if (statusPromise) return statusPromise;
    const deadline = performance.now() + queryTimeout;
    const work = serialize(async () => { try { observed(await listProcesses(deadline)); } catch (error) { unknown(error); } return publishStatus(); });
    statusPromise = work.finally(() => { statusPromise = null; });
    return statusPromise;
  };
  const launch = async () => {
    if (!exists(exe, fsImpl)) return { ok: false, status: 400, error: '便携 QQ 未安装：请先运行 npm run setup' };
    const installed = installation(true);
    if (!installed.present || !installed.versionKnown || !installed.versionMatches || (installed.proofPresent && !installed.proofValid)) return { ok: false, status: 400, error: installed.reason };
    // Reject before creating a profile directory or discovering/spawning a
    // process. A future reviewed launcher must provide actual isolation; flags,
    // inherited environment and a writable metadata "verified" bit cannot.
    return { ok: false, status: 409, code: 'QQ_LAUNCH_ISOLATION_UNVERIFIED', error: installed.launchIsolation.reason };
  };
  const failStop = (code, error) => { unknown(error); publishStatus(true); return { ok: false, status: 409, stopped: false, exitConfirmed: false, code, error: processIssue, pids: lastRows.map(row => Number(row.ProcessId)) }; };
  const stop = () => {
    if (stopPromise) return stopPromise;
    const deadline = performance.now() + stopTimeout;
    const work = serialize(async () => {
      let initial;
      try { initial = await listProcesses(deadline); observed(initial); }
      catch (error) { return failStop('QQ_PORTABLE_DISCOVERY_FAILED', error); }
      if (!initial.targets.length) { publishStatus(true); return { ok: true, stopped: false, reason: 'not_running', exitConfirmed: true, pids: [] }; }
      const targets = initial.targets;
      processState = 'unknown'; processIssue = 'QQ 停止请求正在确认，退出前不会标记为已停止。'; lastError = null; publishStatus(true);
      const belongsToInitial = row => targets.some(target => sameProcess(target, row));
      try {
        if (typeof kill === 'function') for (const target of targets) {
          const current = await listProcesses(deadline); lastRows = current.targets;
          const identity = current.all.find(row => Number(row.ProcessId) === Number(target.ProcessId));
          if (identity && !sameProcess(target, identity)) return failStop('QQ_PORTABLE_IDENTITY_CHANGED', 'QQ 进程身份已变化，未停止复用的 PID；请重新核对。');
          if (current.targets.some(row => !belongsToInitial(row))) return failStop('QQ_PORTABLE_NEW_PROCESS', '发现新 QQ 进程，未将其当作原停止目标；请重试。');
          if (!identity) continue;
          if (performance.now() >= deadline) return failStop('QQ_PORTABLE_STOP_DEADLINE', 'QQ 停止操作已达到时间上限，未发送后续停止请求。');
          // Injected synchronous signal seam is used only by deterministic host tests.
          try { if (kill(Number(target.ProcessId), 'SIGTERM') === false) return failStop('QQ_PORTABLE_SIGNAL_FAILED', 'QQ 停止请求未被接受，请重试。'); }
          catch (error) { if (error?.code !== 'ESRCH') return failStop('QQ_PORTABLE_SIGNAL_FAILED', error); }
        } else {
          const current = await listProcesses(deadline); lastRows = current.targets;
          for (const target of targets) {
            const identity = current.all.find(row => Number(row.ProcessId) === Number(target.ProcessId));
            if (identity && !sameProcess(target, identity)) return failStop('QQ_PORTABLE_IDENTITY_CHANGED', 'QQ 进程身份已变化，未停止复用的 PID；请重新核对。');
          }
          if (current.targets.some(row => !belongsToInitial(row))) return failStop('QQ_PORTABLE_NEW_PROCESS', '发现新 QQ 进程，未将其当作原停止目标；请重试。');
          // One bounded native batch amortizes PowerShell/Add-Type startup for
          // a normal multiprocess QQ. Every identity is held before any kill.
          if (current.targets.length) await terminateTargets(current.targets, deadline);
        }
        for (;;) {
          const current = await listProcesses(deadline); lastRows = current.targets;
          if (current.targets.some(row => !belongsToInitial(row))) return failStop('QQ_PORTABLE_IDENTITY_CHANGED', '停止期间出现新的 QQ 进程或 PID 复用，未继续发送停止请求。');
          if (!current.targets.length) { observed(current); publishStatus(true); return { ok: true, stopped: true, exitConfirmed: true, pid: Number(targets[0].ProcessId), pids: targets.map(row => Number(row.ProcessId)) }; }
          const remaining = deadline - performance.now();
          if (remaining <= 0) return failStop('QQ_PORTABLE_EXIT_UNCONFIRMED', 'QQ 停止请求已发出，但未确认全部进程退出；请重试或手工关闭。');
          await new Promise(resolve => setTimeout(resolve, Math.min(stopPoll, remaining)));
        }
      } catch (error) { return failStop('QQ_PORTABLE_EXIT_UNCONFIRMED', error); }
    });
    stopPromise = work.finally(() => { stopPromise = null; });
    return stopPromise;
  };
  return { launch, stop, logs: () => ({ logs }), status, statusSync };
}

export function createRealProcessAdapters(options = {}) {
  const emit = options.emit;
  return {
    snowluma: createSnowlumaAdapter({ ...options, emit }),
    qqPortable: createPortableAdapter({ ...options, emit }),
  };
}
