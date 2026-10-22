import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createSnowlumaConnectionResolver } from '../bundled/transport-onebot/connection.js';
import { resolveSnowlumaDirectory } from '../bundled/transport-onebot/runtime-lock.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-agent-binding-274-'));
const checks = [];
const check = (name, callback) => { callback(); checks.push(name); console.log(`✓ 274 ${name}`); };
const runtime = name => { const dir = path.join(root, name); fs.mkdirSync(path.join(dir, 'config'), { recursive: true }); return dir; };
const write = (dir, name, config) => fs.writeFileSync(path.join(dir, 'config', name), JSON.stringify(config));
const networks = (port, wsToken, httpToken, extra = {}) => ({ networks: {
  wsServers: [{ name: 'ws-default', host: '127.0.0.1', port: port + 1, path: '/events', accessToken: wsToken, ...extra.ws }],
  httpServers: [{ name: 'http-default', host: '127.0.0.1', port, path: '/actions', accessToken: httpToken, ...extra.http }],
} });
const config = (dir, options = {}) => ({ snowluma: { dir, wsUrl: 'ws://127.0.0.1:3001/events', httpUrl: 'http://127.0.0.1:3000/actions', ...options } });
const error = (actual, code) => {
  assert.equal(actual.connectionCode, code); assert.ok(actual.connectionError);
  assert.equal(actual.wsUrl, ''); assert.equal(actual.httpUrl, '');
  assert.equal(actual.accessToken, ''); assert.equal(actual.httpToken, '');
  assert.equal(actual.scopedCredentials, true);
};
try {
  const dir = runtime('single'), resolve = createSnowlumaConnectionResolver({ appRoot: root });
  write(dir, 'onebot_12345.json', networks(4200, 'account-a-ws', 'account-a-http'));
  check('single account follows actual ports and independent protocol credentials', () => {
    const result = resolve(config(dir));
    assert.equal(result.connectionError, null); assert.equal(result.accountId, '12345'); assert.equal(result.expectedSelfId, '12345');
    assert.equal(result.wsUrl, 'ws://127.0.0.1:4201/events'); assert.equal(result.httpUrl, 'http://127.0.0.1:4200/actions');
    assert.equal(result.accessToken, 'account-a-ws'); assert.equal(result.httpToken, 'account-a-http'); assert.equal(result.scopedCredentials, true);
    assert.equal(result.mode, 'auto'); assert.equal(JSON.stringify([result.bindingKey, result.candidateScope]).includes('account-a'), false);
    assert.equal(resolve(config(dir)).bindingKey, result.bindingKey);
  });
  check('live disk token and port updates change binding without cached credentials', () => {
    const before = resolve(config(dir)); write(dir, 'onebot_12345.json', networks(4300, 'rotated-ws', 'rotated-http'));
    const after = resolve(config(dir)); assert.notEqual(after.bindingKey, before.bindingKey); assert.equal(after.candidateScope, before.candidateScope);
    assert.equal(after.wsUrl, 'ws://127.0.0.1:4301/events'); assert.equal(after.accessToken, 'rotated-ws'); assert.equal(after.httpToken, 'rotated-http');
  });
  check('HTTP-only rotation preserves WS scope and credential', () => {
    const before = resolve(config(dir)); write(dir, 'onebot_12345.json', networks(4300, 'rotated-ws', 'http-next'));
    const after = resolve(config(dir)); assert.notEqual(after.bindingKey, before.bindingKey); assert.equal(after.candidateScope, before.candidateScope);
    assert.equal(after.accessToken, before.accessToken); assert.equal(after.wsUrl, before.wsUrl); assert.equal(after.httpToken, 'http-next');
  });
  check('automatic mode uses only account credentials and ignores stored manual tokens', () => {
    const result = resolve(config(dir, { accessToken: 'explicit-ws' }));
    assert.equal(result.accessToken, 'rotated-ws'); assert.equal(result.httpToken, 'http-next');
    const both = resolve(config(dir, { accessToken: 'explicit-ws', httpAccessToken: 'explicit-http' })); assert.equal(both.httpToken, 'http-next');
    assert.equal(result.bindingKey, both.bindingKey);
  });
  check('empty HTTP disk credential never inherits a WS credential in auto mode', () => {
    write(dir, 'onebot_12345.json', networks(4300, 'ws-only-secret', ''));
    assert.equal(resolve(config(dir)).httpToken, '');
  });

  const multi = runtime('multiple');
  write(multi, 'onebot_12345.json', networks(3000, 'first-ws', 'first-http'));
  write(multi, 'onebot_67890.json', networks(4100, 'second-ws', 'second-http'));
  check('multiple accounts select only the unique matching HTTP and WS pair', () => {
    const result = resolve(config(multi)); assert.equal(result.accountId, '12345'); assert.equal(result.accessToken, 'first-ws'); assert.equal(result.httpToken, 'first-http');
  });
  check('explicit second account follows its own endpoints and cannot borrow first token', () => {
    const result = resolve(config(multi, { accountId: '67890' }));
    assert.equal(result.accountId, '67890'); assert.equal(result.accessToken, 'second-ws'); assert.equal(result.httpToken, 'second-http');
    assert.equal(result.httpUrl, 'http://127.0.0.1:4100/actions');
    assert.notEqual(result.candidateScope, resolve(config(multi)).candidateScope);
  });
  check('HTTP match plus another account WS match does not form a connection', () => {
    error(resolve(config(multi, { wsUrl: 'ws://127.0.0.1:4101/events' })), 'SNOWLUMA_ACCOUNT_AMBIGUOUS');
  });
  check('identical endpoints across accounts require an explicit QQ account', () => {
    write(multi, 'onebot_67890.json', networks(3000, 'second-ws', 'second-http'));
    error(resolve(config(multi)), 'SNOWLUMA_ACCOUNT_AMBIGUOUS');
    assert.equal(resolve(config(multi, { accountId: '67890' })).accessToken, 'second-ws');
  });
  check('missing explicit account fails without fallback to an existing account', () => error(resolve(config(multi, { accountId: '55555' })), 'SNOWLUMA_ACCOUNT_NOT_FOUND'));
  check('invalid account is rejected before filesystem token discovery', () => error(resolve(config(multi, { accountId: '../12345' })), 'SNOWLUMA_ACCOUNT_INVALID'));
  check('WS trailing slash and distinct loopback listeners remain separate bindings', () => {
    const exact = runtime('exact-endpoint');
    write(exact, 'onebot_12345.json', networks(3000, 'without-slash', 'first-http'));
    write(exact, 'onebot_67890.json', networks(3000, 'with-slash', 'second-http', { ws: { path: '/events/' } }));
    assert.equal(resolve(config(exact)).accountId, '12345');
    assert.equal(resolve(config(exact, { wsUrl: 'ws://127.0.0.1:3001/events/' })).accountId, '67890');
    write(exact, 'onebot_67890.json', networks(3000, 'different-loopback', 'second-http', { ws: { host: '127.0.0.2' } }));
    assert.equal(resolve(config(exact)).accountId, '12345');
  });

  const inherited = runtime('inherited');
  write(inherited, 'onebot.json', networks(3000, 'global-ws', 'global-http'));
  write(inherited, 'onebot_12345.json', { mode: 'overlay', networks: { wsServers: [{ name: 'ws-default', port: 5301, path: '/new', accessToken: 'overlay-ws' }] } });
  check('named account overlay replaces WS and inherits the global HTTP adapter', () => {
    const result = resolve(config(inherited)); assert.equal(result.wsUrl, 'ws://127.0.0.1:5301/new'); assert.equal(result.accessToken, 'overlay-ws'); assert.equal(result.httpToken, 'global-http');
  });
  check('snapshot mode excludes global adapters and credentials', () => {
    write(inherited, 'onebot_12345.json', { mode: 'snapshot', ...networks(5400, 'snapshot-ws', 'snapshot-http') });
    const result = resolve(config(inherited)); assert.equal(result.httpUrl, 'http://127.0.0.1:5400/actions'); assert.equal(result.httpToken, 'snapshot-http');
    write(inherited, 'onebot_12345.json', { mode: 'snapshot', networks: {} }); error(resolve(config(inherited)), 'SNOWLUMA_NETWORK_DISABLED');
  });
  check('legacy top-level per-account network lists retain account binding', () => {
    write(inherited, 'onebot_12345.json', { mode: 'snapshot', ...networks(5500, 'legacy-ws', 'legacy-http').networks });
    const result = resolve(config(inherited)); assert.equal(result.accountId, '12345'); assert.equal(result.accessToken, 'legacy-ws'); assert.equal(result.httpToken, 'legacy-http');
  });
  check('global-only configuration is readable without inventing account identity', () => {
    const global = runtime('global-only'); write(global, 'onebot.json', networks(5600, 'global-only-ws', 'global-only-http'));
    const result = resolve(config(global)); assert.equal(result.expectedSelfId, ''); assert.equal(result.accountId, ''); assert.equal(result.httpToken, 'global-only-http');
  });
  check('unnamed overlay adapters append and ambiguous services require a URL match', () => {
    const appended = runtime('appended');
    write(appended, 'onebot.json', networks(5600, 'named-ws', 'named-http'));
    write(appended, 'onebot_12345.json', networks(5700, 'unnamed-ws', 'unnamed-http', { ws: { name: '' }, http: { name: '' } }));
    error(resolve(config(appended)), 'SNOWLUMA_NETWORK_AMBIGUOUS');
    assert.equal(resolve(config(appended, { wsUrl: 'ws://127.0.0.1:5701/events', httpUrl: 'http://127.0.0.1:5700/actions' })).accessToken, 'unnamed-ws');
  });

  const merged = runtime('merged-port');
  write(merged, 'onebot_12345.json', { networks: { httpServers: [{ port: 5800, path: '/', enableWebSocket: true, accessToken: 'merged-token' }], wsServers: [] } });
  check('HTTP enableWebSocket supports one shared listener and token', () => {
    const result = resolve(config(merged)); assert.equal(result.wsUrl, 'ws://127.0.0.1:5800/'); assert.equal(result.httpUrl, 'http://127.0.0.1:5800/');
    assert.equal(result.accessToken, 'merged-token'); assert.equal(result.httpToken, 'merged-token');
  });
  check('API-only WebSocket cannot be mistaken for a usable event channel', () => {
    write(merged, 'onebot_12345.json', networks(5800, 'api-ws', 'http', { ws: { role: 'Api' } })); error(resolve(config(merged)), 'SNOWLUMA_WS_ROLE_INVALID');
  });
  check('event-only WebSocket remains usable with independent HTTP actions', () => {
    write(merged, 'onebot_12345.json', networks(5800, 'event-ws', 'http', { ws: { role: 'Event' } })); assert.equal(resolve(config(merged)).accessToken, 'event-ws');
  });
  check('disabled and empty networks report unavailable listeners', () => {
    write(merged, 'onebot_12345.json', networks(5800, 'disabled-ws', 'http', { ws: { enabled: false } })); error(resolve(config(merged)), 'SNOWLUMA_NETWORK_DISABLED');
    write(merged, 'onebot_12345.json', { networks: {} }); error(resolve(config(merged)), 'SNOWLUMA_NETWORK_DISABLED');
  });
  check('bind-any hosts become loopback targets for both IPv4 and IPv6', () => {
    write(merged, 'onebot_12345.json', networks(5800, 'v4', 'v6', { ws: { host: '0.0.0.0' }, http: { host: '::' } }));
    const result = resolve(config(merged)); assert.equal(result.wsUrl, 'ws://127.0.0.1:5801/events'); assert.equal(result.httpUrl, 'http://[::1]:5800/actions');
  });
  check('automatic disk configuration cannot point credentials at a remote listener', () => {
    write(merged, 'onebot_12345.json', networks(5800, 'protected-secret', 'protected-secret', { ws: { host: '203.0.113.8' } }));
    error(resolve(config(merged)), 'SNOWLUMA_HOST_INVALID');
  });
  check('configured remote endpoint automatically uses only manual explicit credentials', () => {
    let accesses = 0;
    const guarded = createSnowlumaConnectionResolver({ appRoot: root, fsImpl: new Proxy(fs, { get(target, key) {
      if (['readFileSync', 'readdirSync', 'lstatSync'].includes(key)) return () => { accesses++; throw new Error('disk must not be inspected'); };
      return target[key];
    } }) });
    const result = guarded(config(dir, { wsUrl: 'wss://example.invalid/events', httpUrl: 'https://example.invalid/actions', accessToken: 'explicit-remote' }));
    assert.equal(result.mode, 'manual'); assert.equal(result.accessToken, 'explicit-remote'); assert.equal(result.httpToken, 'explicit-remote'); assert.equal(accesses, 0);
    const empty = guarded(config(dir, { wsUrl: 'ws://127.0.0.1:3001', httpUrl: 'https://example.invalid/actions' })); assert.equal(empty.accessToken, ''); assert.equal(empty.httpToken, '');
  });
  check('manual mode ignores disk and preserves HTTP-empty fallback to explicit WS token', () => {
    const result = resolve(config(path.join(root, 'absent'), { connectionMode: 'manual', accessToken: 'manual-ws' }));
    assert.equal(result.connectionError, null); assert.equal(result.mode, 'manual'); assert.equal(result.httpToken, 'manual-ws'); assert.equal(result.accountId, '');
  });
  check('manual and auto-remote split hosts never inherit a local WS token into HTTP', () => {
    for (const connectionMode of ['auto', 'manual']) {
      const result = resolve(config(dir, { connectionMode, wsUrl: 'ws://127.0.0.1:3001/events', httpUrl: 'https://example.invalid/actions', accessToken: 'local-ws-secret' }));
      assert.equal(result.connectionError, null); assert.equal(result.mode, 'manual'); assert.equal(result.accessToken, 'local-ws-secret'); assert.equal(result.httpToken, '');
      const explicit = resolve(config(dir, { connectionMode, wsUrl: 'ws://127.0.0.1:3001/events', httpUrl: 'https://example.invalid/actions', accessToken: 'local-ws-secret', httpAccessToken: 'explicit-http-secret' }));
      assert.equal(explicit.httpToken, 'explicit-http-secret');
    }
  });
  check('manual HTTP inheritance requires matching TLS and never downgrades a WSS secret', () => {
    for (const [wsUrl, httpUrl] of [['wss://example.invalid/events', 'http://example.invalid/actions'], ['ws://example.invalid/events', 'https://example.invalid/actions']]) {
      const result = resolve(config(dir, { connectionMode: 'manual', wsUrl, httpUrl, accessToken: 'tls-bound-secret' }));
      assert.equal(result.connectionError, null); assert.equal(result.httpToken, '');
    }
    assert.equal(resolve(config(dir, { connectionMode: 'manual', wsUrl: 'wss://example.invalid:443/events', httpUrl: 'https://example.invalid:8443/actions', accessToken: 'same-tls-secret' })).httpToken, 'same-tls-secret');
    assert.equal(resolve(config(dir, { connectionMode: 'manual', wsUrl: 'ws://localhost:3001/events', httpUrl: 'http://127.0.0.1:3000/actions', accessToken: 'same-local-secret' })).httpToken, 'same-local-secret');
  });
  check('implicit runtime fallback also blocks credentials between distinct local listeners', () => {
    const result = resolve({ onebot: { wsUrl: 'ws://127.0.0.2:6001', httpUrl: 'http://127.0.0.1:6000', accessToken: 'other-host-secret' } });
    assert.equal(result.connectionError, null); assert.equal(result.mode, 'manual'); assert.equal(result.httpToken, '');
  });
  check('missing implicit SnowLuma runtime falls back to generic OneBot', () => {
    const result = resolve({ onebot: { wsUrl: 'ws://127.0.0.1:6001', httpUrl: 'http://127.0.0.1:6000', accessToken: 'generic' } });
    assert.equal(result.mode, 'manual'); assert.equal(result.connectionError, null); assert.equal(result.accessToken, 'generic'); assert.equal(result.httpToken, 'generic');
  });
  check('missing explicit directory never falls back to another runtime', () => error(resolve(config(path.join(root, 'absent'))), 'SNOWLUMA_CONFIG_UNREADABLE'));
  check('existing runtime without account configuration reports a useful error', () => error(resolve(config(runtime('empty-config'))), 'SNOWLUMA_CONFIG_MISSING'));

  const invalid = runtime('invalid');
  check('invalid JSON and oversized files fail closed without generic fallback', () => {
    const file = path.join(invalid, 'config', 'onebot_12345.json'); fs.writeFileSync(file, '{bad-json'); error(resolve(config(invalid)), 'SNOWLUMA_CONFIG_INVALID');
    fs.writeFileSync(file, ' '.repeat(256 * 1024 + 1)); error(resolve(config(invalid)), 'SNOWLUMA_CONFIG_TOO_LARGE');
  });
  check('UTF-8 BOM does not prevent loading a valid account file', () => {
    fs.writeFileSync(path.join(invalid, 'config', 'onebot_12345.json'), '\uFEFF' + JSON.stringify(networks(6200, 'bom-ws', 'bom-http')));
    assert.equal(resolve(config(invalid)).accessToken, 'bom-ws');
  });
  check('invalid port and route are rejected before exposing a token', () => {
    for (const port of [0, -1, 65536, 3000.5, '3000junk']) {
      write(invalid, 'onebot_12345.json', networks(6200, 'port-secret', 'http', { ws: { port } })); error(resolve(config(invalid)), 'SNOWLUMA_PORT_INVALID');
    }
    for (const route of ['//remote', '/?access_token=x', '/../events', '/x#y', '/%2fremote', '/with space']) {
      write(invalid, 'onebot_12345.json', networks(6200, 'route-secret', 'http', { ws: { path: route } })); error(resolve(config(invalid)), 'SNOWLUMA_PATH_INVALID');
    }
  });
  check('credential-bearing or wrong-protocol configured URLs cannot enter discovery', () => {
    for (const wsUrl of ['http://127.0.0.1:3001', 'ws://user:password@127.0.0.1:3001', 'ws://127.0.0.1:3001/?access_token=hidden', 'ws://127.0.0.1:3001/#secret']) {
      error(resolve(config(dir, { wsUrl })), 'ONEBOT_URL_INVALID');
    }
  });
  check('a symlink or junction runtime/config directory is refused', () => {
    const target = runtime('junction-target'), junction = path.join(root, 'junction');
    write(target, 'onebot_12345.json', networks(6300, 'junction-secret', 'http'));
    fs.symlinkSync(target, junction, process.platform === 'win32' ? 'junction' : 'dir');
    error(resolve(config(junction)), 'SNOWLUMA_CONFIG_LINK');
    const parent = path.join(root, 'config-junction'); fs.mkdirSync(parent); fs.symlinkSync(path.join(target, 'config'), path.join(parent, 'config'), process.platform === 'win32' ? 'junction' : 'dir');
    error(resolve(config(parent)), 'SNOWLUMA_CONFIG_LINK');
  });
  check('injected filesystem seam refuses a linked account file before reading it', () => {
    const file = path.join(dir, 'config', 'onebot_12345.json'); let linkedReads = 0;
    const guarded = createSnowlumaConnectionResolver({ appRoot: root, fsImpl: new Proxy(fs, { get(target, key) {
      if (key === 'lstatSync') return name => { const stat = fs.lstatSync(name); return name === file ? Object.assign(Object.create(stat), { isSymbolicLink: () => true }) : stat; };
      if (key === 'readFileSync') return (...args) => { if (args[0] === file) linkedReads++; return fs.readFileSync(...args); };
      return target[key];
    } }) });
    error(guarded(config(dir)), 'SNOWLUMA_CONFIG_LINK'); assert.equal(linkedReads, 0);
  });
  check('runtime change revokes scope even when credentials/endpoints are identical', () => {
    const first = runtime('first-scope'), second = runtime('second-scope');
    for (const item of [first, second]) write(item, 'onebot_12345.json', networks(6400, 'same-ws', 'same-http'));
    assert.notEqual(resolve(config(first)).candidateScope, resolve(config(second)).candidateScope);
  });
  check('a discovered account stays pinned when another historical account is added', () => {
    const stable = runtime('stable-selection'), sticky = createSnowlumaConnectionResolver({ appRoot: root });
    write(stable, 'onebot_12345.json', networks(6500, 'original-ws', 'original-http'));
    const before = sticky(config(stable)); assert.equal(before.accountId, '12345');
    write(stable, 'onebot_67890.json', networks(3000, 'new-account-ws', 'new-account-http'));
    const after = sticky(config(stable)); assert.equal(after.accountId, '12345'); assert.equal(after.bindingKey, before.bindingKey);
    write(stable, 'onebot_12345.json', networks(6600, 'original-rotated-ws', 'original-rotated-http'));
    assert.equal(sticky(config(stable)).accessToken, 'original-rotated-ws');
  });
  check('a missing pinned account never silently falls through to the remaining account', () => {
    const stable = runtime('missing-pinned'), sticky = createSnowlumaConnectionResolver({ appRoot: root });
    write(stable, 'onebot_12345.json', networks(6500, 'old-ws', 'old-http'));
    assert.equal(sticky(config(stable)).accountId, '12345');
    fs.unlinkSync(path.join(stable, 'config', 'onebot_12345.json'));
    write(stable, 'onebot_67890.json', networks(3000, 'remaining-ws', 'remaining-http'));
    error(sticky(config(stable)), 'SNOWLUMA_ACCOUNT_NOT_FOUND');
    assert.equal(sticky(config(stable, { accountId: '67890' })).accountId, '67890');
  });
  check('changing a connection hint deliberately permits a new automatic selection', () => {
    const stable = runtime('changed-selection'), sticky = createSnowlumaConnectionResolver({ appRoot: root });
    write(stable, 'onebot_12345.json', networks(6500, 'old-ws', 'old-http'));
    assert.equal(sticky(config(stable)).accountId, '12345');
    write(stable, 'onebot_67890.json', networks(6600, 'chosen-ws', 'chosen-http'));
    const after = sticky(config(stable, { wsUrl: 'ws://127.0.0.1:6601/events', httpUrl: 'http://127.0.0.1:6600/actions' }));
    assert.equal(after.accountId, '67890'); assert.equal(after.accessToken, 'chosen-ws');
  });
  check('malformed or empty historical accounts cannot block one valid endpoint match', () => {
    const mixed = runtime('mixed-history');
    write(mixed, 'onebot_12345.json', { mode: 'snapshot', ...networks(3000, 'valid-ws', 'valid-http') });
    write(mixed, 'onebot_67890.json', { mode: 'snapshot', networks: {} });
    fs.writeFileSync(path.join(mixed, 'config', 'onebot_55555.json'), '{broken-json');
    const select = createSnowlumaConnectionResolver({ appRoot: root });
    const result = select(config(mixed)); assert.equal(result.accountId, '12345'); assert.equal(result.accessToken, 'valid-ws'); assert.equal(result.httpToken, 'valid-http');
    error(select(config(mixed, { accountId: '67890' })), 'SNOWLUMA_NETWORK_DISABLED');
    error(select(config(mixed, { accountId: '55555' })), 'SNOWLUMA_CONFIG_INVALID');
  });
  check('an invalid pinned account cannot fall through to a valid matching history entry', () => {
    const mixed = runtime('invalid-pin'), select = createSnowlumaConnectionResolver({ appRoot: root });
    write(mixed, 'onebot_12345.json', networks(6500, 'pin-ws', 'pin-http'));
    assert.equal(select(config(mixed)).accountId, '12345');
    write(mixed, 'onebot_12345.json', { mode: 'snapshot', networks: {} });
    write(mixed, 'onebot_67890.json', networks(3000, 'history-ws', 'history-http'));
    error(select(config(mixed)), 'SNOWLUMA_NETWORK_DISABLED');
  });
  check('a valid snapshot can match despite a damaged unused global file', () => {
    const mixed = runtime('invalid-global'); fs.writeFileSync(path.join(mixed, 'config', 'onebot.json'), '{bad-global');
    write(mixed, 'onebot_12345.json', { mode: 'snapshot', ...networks(3000, 'snapshot-valid-ws', 'snapshot-valid-http') });
    write(mixed, 'onebot_67890.json', { mode: 'overlay', networks: {} });
    const select = createSnowlumaConnectionResolver({ appRoot: root });
    assert.equal(select(config(mixed)).accountId, '12345');
    error(select(config(mixed, { accountId: '67890' })), 'SNOWLUMA_CONFIG_INVALID');
  });
  check('switching automatic runtime never carries stored manual credentials into the new account', () => {
    const first = runtime('credential-owner-a'), second = runtime('credential-owner-b'), select = createSnowlumaConnectionResolver({ appRoot: root });
    write(first, 'onebot_12345.json', networks(6500, 'owner-a-ws', 'owner-a-http'));
    write(second, 'onebot_67890.json', networks(6600, 'owner-b-ws', 'owner-b-http'));
    const manualTokens = { accessToken: 'old-agent-ws', httpAccessToken: 'old-agent-http' };
    assert.equal(select(config(first, manualTokens)).accessToken, 'owner-a-ws');
    const after = select(config(second, manualTokens)); assert.equal(after.accountId, '67890'); assert.equal(after.accessToken, 'owner-b-ws'); assert.equal(after.httpToken, 'owner-b-http');
  });
  check('empty configured directory uses the shared app.asar.unpacked runtime selection', () => {
    const appRoot = path.join(root, 'asar-layout', 'resources', 'app.asar');
    const unpacked = path.join(root, 'asar-layout', 'resources', 'app.asar.unpacked', 'snowluma');
    fs.mkdirSync(appRoot, { recursive: true }); fs.mkdirSync(path.join(unpacked, 'config'), { recursive: true });
    write(unpacked, 'onebot_12345.json', networks(6700, 'unpacked-ws', 'unpacked-http'));
    assert.equal(resolveSnowlumaDirectory('', { appRoot }), unpacked);
    const select = createSnowlumaConnectionResolver({ appRoot });
    const result = select(config('')); assert.equal(result.accountId, '12345'); assert.equal(result.accessToken, 'unpacked-ws'); assert.equal(result.httpToken, 'unpacked-http');
  });
  check('relative configured directory resolves from appRoot rather than process working directory', () => {
    const appRoot = path.join(root, 'relative-layout', 'app-root'), relativeRuntime = path.join(appRoot, 'custom-runtime');
    fs.mkdirSync(path.join(relativeRuntime, 'config'), { recursive: true });
    write(relativeRuntime, 'onebot_12345.json', networks(6800, 'relative-ws', 'relative-http'));
    assert.equal(resolveSnowlumaDirectory('custom-runtime', { appRoot }), relativeRuntime);
    const select = createSnowlumaConnectionResolver({ appRoot }), result = select(config('custom-runtime'));
    assert.equal(result.accountId, '12345'); assert.equal(result.accessToken, 'relative-ws'); assert.equal(result.httpToken, 'relative-http');
    assert.equal(select(config(relativeRuntime)).candidateScope, result.candidateScope);
  });
  console.log(`274 SnowLuma binding: ${checks.length}/${checks.length} passed`);
} finally {
  const absolute = path.resolve(root), parent = path.resolve(os.tmpdir()) + path.sep;
  assert.ok(absolute.startsWith(parent) && path.basename(absolute).startsWith('qq-agent-binding-274-'));
  fs.rmSync(absolute, { recursive: true, force: true });
}
