// SnowLuma discovery stays inside the default OneBot adapter. Other transports
// can replace this provider without depending on SnowLuma or its disk layout.
import fs from 'node:fs';
import path from 'node:path';
import { createHmac, randomBytes } from 'node:crypto';
import { resolveSnowlumaDirectory } from './runtime-lock.js';

const MAX_CONFIG_BYTES = 256 * 1024;
const ACCOUNT_FILE = /^onebot_(\d{5,10})\.json$/i;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = value => typeof value === 'string' ? value : '';
const own = (value, key) => Object.hasOwn(value ?? {}, key);

function failure(code, message) { throw Object.assign(new Error(message), { connectionCode: code }); }

function localHost(host, { binding = false } = {}) {
  const value = host.toLowerCase().replace(/^\[|\]$/g, '');
  if (value === '0.0.0.0' && binding) return '127.0.0.1';
  if (value === '::' && binding) return '::1';
  if (value === 'localhost' || value === '::1' || /^127(?:\.\d{1,3}){3}$/.test(value)) return value;
  return null;
}

function endpoint(value, protocol, { optional = false } = {}) {
  if (!value && optional) return null;
  let url;
  try { url = new URL(value); } catch { failure('ONEBOT_URL_INVALID', `OneBot ${protocol === 'ws' ? 'WebSocket' : 'HTTP'} 地址为空或无效`); }
  if (!(protocol === 'ws' ? ['ws:', 'wss:'] : ['http:', 'https:']).includes(url.protocol) ||
      url.username || url.password || url.hash || url.search || /[\x00-\x20\\]/.test(value)) {
    failure('ONEBOT_URL_INVALID', 'OneBot 地址无效；请使用独立的令牌设置，地址不得包含凭据、查询参数或片段');
  }
  return url;
}

function comparable(url) {
  if (!url) return '';
  const copy = new URL(url);
  const host = localHost(copy.hostname, { binding: true });
  if (host === 'localhost' || host === '127.0.0.1') copy.hostname = '127.0.0.1';
  else if (host === '::1') copy.hostname = '[::1]';
  return copy.href;
}

function manualConnection(connection, configured) {
  const hostname = url => {
    const host = url?.hostname.toLowerCase().replace(/^\[|\]$/g, '') || '';
    return host === 'localhost' ? '127.0.0.1' : host;
  };
  // Legacy HTTP-empty fallback is safe only within one explicitly configured
  // host and TLS level. A local WS credential must never escape to a separately
  // hosted HTTP API or silently move from WSS to plaintext HTTP.
  const sameTrust = configured.ws && configured.http && hostname(configured.ws) === hostname(configured.http) &&
    (configured.ws.protocol === 'wss:') === (configured.http.protocol === 'https:');
  return { ...connection, mode: 'manual', httpToken: connection.httpToken || (sameTrust ? connection.accessToken : '') };
}

function serverEndpoint(raw, protocol) {
  if (!object(raw)) failure('SNOWLUMA_CONFIG_INVALID', 'SnowLuma 网络配置条目无效');
  if (raw.enabled !== undefined && typeof raw.enabled !== 'boolean') failure('SNOWLUMA_CONFIG_INVALID', 'SnowLuma 网络启用状态无效');
  if (raw.enabled === false) return null;
  const port = typeof raw.port === 'number' ? raw.port : /^\d+$/.test(text(raw.port)) ? Number(raw.port) : NaN;
  if (!Number.isInteger(port) || port < 1 || port > 65535) failure('SNOWLUMA_PORT_INVALID', 'SnowLuma 监听端口必须为 1 到 65535 的整数');
  const hostValue = raw.host === undefined || raw.host === '' ? '0.0.0.0' : text(raw.host);
  const host = localHost(hostValue, { binding: true });
  if (!host) failure('SNOWLUMA_HOST_INVALID', 'SnowLuma 自动接入仅支持本机监听地址；远程服务请使用手动模式');
  const route = raw.path === undefined || raw.path === '' ? '/' : text(raw.path);
  if (!route.startsWith('/') || route.startsWith('//') || /[\x00-\x20\\?#]/.test(route) || /%(?:00|0a|0d|2f|5c)/i.test(route)) {
    failure('SNOWLUMA_PATH_INVALID', 'SnowLuma 监听路径无效');
  }
  // URL normalization must not silently change the listener path (e.g. /../).
  const url = endpoint(`${protocol}://${host.includes(':') ? `[${host}]` : host}:${port}${route}`, protocol);
  if (url.pathname !== route) failure('SNOWLUMA_PATH_INVALID', 'SnowLuma 监听路径包含无法直接连接的字符或路径段');
  if (raw.accessToken !== undefined && typeof raw.accessToken !== 'string') failure('SNOWLUMA_CONFIG_INVALID', 'SnowLuma 令牌配置无效');
  return { url: url.href, token: text(raw.accessToken), raw };
}

// This follows SnowLuma's collectByName: each named adapter replaces the whole
// adapter of that name; unnamed adapters append. An empty overlay does not erase
// inherited adapters, while mode:snapshot omits the global source altogether.
function adapters(sources, kind) {
  const values = new Map();
  let counter = 0;
  for (const source of sources) {
    if (!object(source)) failure('SNOWLUMA_CONFIG_INVALID', 'SnowLuma 配置必须为 JSON 对象');
    if (source.networks !== undefined && !object(source.networks)) failure('SNOWLUMA_CONFIG_INVALID', 'SnowLuma networks 配置无效');
    for (const collection of [source.networks?.[kind], source[kind]]) {
      if (collection === undefined) continue;
      if (!Array.isArray(collection)) failure('SNOWLUMA_CONFIG_INVALID', 'SnowLuma 网络列表配置无效');
      for (const raw of collection) {
        if (!object(raw)) failure('SNOWLUMA_CONFIG_INVALID', 'SnowLuma 网络配置条目无效');
        const name = text(raw.name).trim();
        let key = name;
        if (!key) {
          const prefix = kind === 'httpServers' ? 'http' : 'ws';
          do { key = `${prefix}-${++counter}`; } while (values.has(key));
        }
        values.set(key, raw);
      }
    }
  }
  return [...values.values()];
}

function chooseEndpoint(candidates, configured, kind) {
  if (!candidates.length) failure('SNOWLUMA_NETWORK_DISABLED', `SnowLuma 未启用可供接入的 ${kind} 服务`);
  const matches = configured ? candidates.filter(item => comparable(item.url) === comparable(configured)) : [];
  if (matches.length === 1) return matches[0];
  if (matches.length > 1 || candidates.length > 1) failure('SNOWLUMA_NETWORK_AMBIGUOUS', `SnowLuma 存在多个 ${kind} 服务，请在接入地址中指定要使用的监听端口和路径`);
  return candidates[0];
}

function accountConnection(globalConfig, accountConfig, configured) {
  const sources = accountConfig?.mode === 'snapshot' ? [accountConfig] : [globalConfig, accountConfig].filter(Boolean);
  const http = adapters(sources, 'httpServers').map(raw => serverEndpoint(raw, 'http')).filter(Boolean);
  const ws = [];
  let apiOnly = false;
  for (const raw of adapters(sources, 'wsServers')) {
    const candidate = serverEndpoint(raw, 'ws');
    if (!candidate) continue;
    const role = raw.role === undefined ? 'universal' : text(raw.role).toLowerCase();
    if (!['api', 'event', 'universal'].includes(role)) failure('SNOWLUMA_CONFIG_INVALID', 'SnowLuma WebSocket role 配置无效');
    if (role === 'api') { apiOnly = true; continue; }
    ws.push(candidate);
  }
  for (const candidate of http) {
    const enabled = candidate.raw.enableWebSocket;
    if (enabled !== undefined && typeof enabled !== 'boolean') failure('SNOWLUMA_CONFIG_INVALID', 'SnowLuma HTTP WebSocket 开关无效');
    if (enabled === true) ws.push({ ...candidate, url: candidate.url.replace(/^http/, 'ws') });
  }
  if (!ws.length && apiOnly) failure('SNOWLUMA_WS_ROLE_INVALID', 'SnowLuma WebSocket 仅允许 API 调用，无法接收事件；请启用 Event 或 Universal 服务');
  const chosenHttp = chooseEndpoint(http, configured.http, 'HTTP');
  const chosenWs = chooseEndpoint(ws, configured.ws, 'WebSocket');
  return { wsUrl: chosenWs.url, httpUrl: chosenHttp.url, accessToken: chosenWs.token, httpToken: chosenHttp.token,
    matches: Boolean(configured.ws && configured.http && comparable(chosenWs.url) === comparable(configured.ws) && comparable(chosenHttp.url) === comparable(configured.http)) };
}

/** Resolve one account and its own credentials on every call; no disk token pool. */
export function createSnowlumaConnectionResolver({ appRoot = process.cwd(), fsImpl = fs } = {}) {
  const secret = randomBytes(32);
  const identity = value => createHmac('sha256', secret).update(JSON.stringify(value)).digest('hex');
  let selectionHints = null;
  let pinnedAccount = '';

  function inspect(file, { required = false, directory = false } = {}) {
    const absolute = path.resolve(file);
    const root = path.parse(absolute).root;
    let current = root;
    for (const part of absolute.slice(root.length).split(path.sep).filter(Boolean)) {
      current = path.join(current, part);
      let stat;
      try { stat = fsImpl.lstatSync(current); } catch (error) {
        if (error?.code === 'ENOENT' && !required) return null;
        failure('SNOWLUMA_CONFIG_UNREADABLE', '无法读取指定 SnowLuma 目录或配置，请检查目录是否存在及访问权限');
      }
      if (stat.isSymbolicLink()) failure('SNOWLUMA_CONFIG_LINK', 'SnowLuma 自动接入拒绝符号链接或目录联接，请使用真实运行目录');
      if (current !== absolute && !stat.isDirectory()) failure('SNOWLUMA_CONFIG_INVALID', 'SnowLuma 配置路径中存在非目录条目');
      if (current === absolute) {
        if (!(directory ? stat.isDirectory() : stat.isFile())) failure('SNOWLUMA_CONFIG_INVALID', 'SnowLuma 配置路径类型无效');
        return stat;
      }
    }
    return null;
  }

  function read(file, required = false) {
    const stat = inspect(file, { required });
    if (!stat) return null;
    if (stat.size > MAX_CONFIG_BYTES) failure('SNOWLUMA_CONFIG_TOO_LARGE', 'SnowLuma 接入配置过大，拒绝自动读取');
    let value;
    try {
      const content = fsImpl.readFileSync(file, 'utf8');
      if (Buffer.byteLength(content, 'utf8') > MAX_CONFIG_BYTES) failure('SNOWLUMA_CONFIG_TOO_LARGE', 'SnowLuma 接入配置过大，拒绝自动读取');
      value = JSON.parse(content.replace(/^\uFEFF/, ''));
    } catch (error) {
      if (error?.connectionCode) throw error;
      failure('SNOWLUMA_CONFIG_INVALID', 'SnowLuma 接入配置无法解析，请检查 JSON 文件和访问权限');
    }
    if (!object(value)) failure('SNOWLUMA_CONFIG_INVALID', 'SnowLuma 接入配置必须为 JSON 对象');
    return value;
  }

  return function resolve(config = {}) {
    const source = object(config.snowluma) ? config.snowluma : {};
    const legacy = object(config.onebot) ? config.onebot : {};
    const value = key => text((own(source, key) ? source : legacy)[key]);
    const accountId = value('accountId').trim();
    let mode = value('connectionMode') || 'auto';
    const initial = { wsUrl: value('wsUrl'), httpUrl: value('httpUrl'), accessToken: value('accessToken'), httpToken: value('httpAccessToken'),
      candidateScope: '', bindingKey: '', expectedSelfId: accountId, accountId, mode, scopedCredentials: true, connectionError: null, connectionCode: null };
    const result = (connection, scope = '') => {
      const bindingKey = identity([scope, connection.mode, connection.accountId, connection.wsUrl, connection.httpUrl,
        connection.accessToken, connection.httpToken, connection.connectionCode]);
      const candidateScope = identity([scope, connection.mode, connection.accountId]);
      return { ...connection, candidateScope, bindingKey };
    };
    let runtimeRoot = '';
    try {
      if (!['auto', 'manual'].includes(mode)) failure('SNOWLUMA_MODE_INVALID', 'SnowLuma 接入模式必须为 auto 或 manual');
      if (accountId && !/^\d{5,10}$/.test(accountId)) failure('SNOWLUMA_ACCOUNT_INVALID', 'SnowLuma 账号必须为 5 到 10 位 QQ 号');
      const explicitDir = value('dir').trim();
      runtimeRoot = resolveSnowlumaDirectory(explicitDir, { appRoot, fsImpl });
      const hints = identity([runtimeRoot, mode, accountId, initial.wsUrl, initial.httpUrl]);
      if (hints !== selectionHints) { selectionHints = hints; pinnedAccount = ''; }
      const configured = { ws: endpoint(initial.wsUrl, 'ws', { optional: true }), http: endpoint(initial.httpUrl, 'http', { optional: true }) };
      const remote = [configured.ws, configured.http].some(url => url && !localHost(url.hostname, { binding: true }));
      if (mode === 'manual' || remote) {
        endpoint(initial.wsUrl, 'ws'); endpoint(initial.httpUrl, 'http');
        return result(manualConnection(initial, configured));
      }
      const exists = inspect(runtimeRoot, { required: Boolean(explicitDir || accountId || pinnedAccount), directory: true });
      if (!exists) return result(manualConnection(initial, configured), runtimeRoot);
      const configRoot = path.join(runtimeRoot, 'config');
      if (!inspect(configRoot, { directory: true })) {
        if (accountId || pinnedAccount) failure('SNOWLUMA_ACCOUNT_NOT_FOUND', '已选择 QQ 账号的 SnowLuma 接入配置不存在，请先加载该账号或恢复配置');
        failure('SNOWLUMA_CONFIG_MISSING', 'SnowLuma 尚未生成接入配置，请先在 WebUI 加载 QQ 账号');
      }
      let globalConfig = null, globalError = null;
      try { globalConfig = read(path.join(configRoot, 'onebot.json')); } catch (error) { globalError = error; }
      let files;
      try { files = fsImpl.readdirSync(configRoot).filter(name => ACCOUNT_FILE.test(name)).sort(); }
      catch { failure('SNOWLUMA_CONFIG_UNREADABLE', '无法读取 SnowLuma 账号列表，请检查目录权限'); }
      if (files.length > 256) failure('SNOWLUMA_CONFIG_TOO_LARGE', 'SnowLuma 账号配置数量过多，拒绝自动选择');
      const fromAccount = file => {
        const accountConfig = read(path.join(configRoot, file), true);
        // A snapshot does not consume the global file. A malformed historical
        // global config must not prevent a valid snapshot from identifying QQ.
        if (accountConfig.mode !== 'snapshot' && globalError) throw globalError;
        return accountConnection(globalConfig, accountConfig, configured);
      };
      let selected;
      if (accountId) {
        const file = files.find(name => ACCOUNT_FILE.exec(name)[1] === accountId);
        if (!file) failure('SNOWLUMA_ACCOUNT_NOT_FOUND', '指定 QQ 账号的 SnowLuma 配置不存在，请检查 QQ 号并在 WebUI 加载该账号');
        selected = { ...fromAccount(file), accountId };
      } else if (pinnedAccount) {
        // Discover once, then follow that account's live configuration. Adding a
        // second or historical file must not move a healthy Agent to another QQ.
        const file = files.find(name => ACCOUNT_FILE.exec(name)[1] === pinnedAccount);
        if (!file) failure('SNOWLUMA_ACCOUNT_NOT_FOUND', '已绑定 QQ 账号的 SnowLuma 配置丢失；请恢复该账号配置，或明确更改 QQ 号及接入地址');
        selected = { ...fromAccount(file), accountId: pinnedAccount };
      } else if (files.length === 1) {
        selected = { ...fromAccount(files[0]), accountId: ACCOUNT_FILE.exec(files[0])[1] };
      } else if (files.length > 1) {
        const candidates = [], errors = [];
        for (const file of files) {
          try { candidates.push({ ...fromAccount(file), accountId: ACCOUNT_FILE.exec(file)[1] }); }
          catch (error) { errors.push(error); }
        }
        const matching = candidates.filter(candidate => candidate.matches);
        if (matching.length !== 1) {
          if (!candidates.length && errors.length) throw errors[0];
          failure('SNOWLUMA_ACCOUNT_AMBIGUOUS', 'SnowLuma 有多个 QQ 账号，无法唯一匹配有效接入配置；请在设置中填写要连接的 QQ 号并检查该账号配置');
        }
        selected = matching[0];
      } else if (globalConfig) selected = { ...accountConnection(globalConfig, null, configured), accountId: '' };
      else if (globalError) throw globalError;
      else failure('SNOWLUMA_CONFIG_MISSING', 'SnowLuma 尚未生成接入配置，请先在 WebUI 加载 QQ 账号');
      if (!accountId && selected.accountId) pinnedAccount = selected.accountId;
      return result({ ...initial, ...selected, expectedSelfId: selected.accountId, mode: 'auto',
        accessToken: selected.accessToken, httpToken: selected.httpToken }, runtimeRoot);
    } catch (error) {
      // Never return tokens or a usable endpoint after a binding failure. The
      // client reports this error and waits for a corrected configuration.
      return result({ ...initial, wsUrl: '', httpUrl: '', accessToken: '', httpToken: '',
        connectionError: error?.connectionCode ? error.message : 'SnowLuma 自动接入解析失败，请检查目录及网络配置',
        connectionCode: error?.connectionCode || 'SNOWLUMA_CONFIG_UNREADABLE' }, runtimeRoot);
    }
  };
}
