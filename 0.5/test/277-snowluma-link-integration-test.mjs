// Actual default plugin descriptor -> provider -> resolver -> OneBot client.
// Only synthetic account files and authenticated loopback HTTP/WS are used;
// no SnowLuma executable, native module, portable QQ or real account is present.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { setTimeout as sleep } from 'node:timers/promises';
import { WebSocketServer } from 'ws';
import transportPlugin from '../bundled/transport-onebot/index.js';

async function until(condition, message, timeout = 7500) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { if (condition()) return; await sleep(15); }
  assert.ok(condition(), message);
}

async function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-agent-link-277-'));
  const runtime = path.join(root, 'snowluma');
  fs.mkdirSync(path.join(runtime, 'config'), { recursive: true });
  const endpoints = [], hosts = [];
  t.after(async () => {
    for (const host of hosts) await host.instance.stop();
    for (const target of endpoints) await target.dispose();
    const absolute = path.resolve(root), parent = path.resolve(os.tmpdir()) + path.sep;
    assert.ok(absolute.startsWith(parent) && path.basename(absolute).startsWith('qq-agent-link-277-'));
    fs.rmSync(absolute, { recursive: true, force: true });
  });

  async function endpoint(id, label = id) {
    const state = { id, wsId: id, wsToken: `SYNTHETIC_277_WS_${label}`, httpToken: `SYNTHETIC_277_HTTP_${label}`,
      wsPath: `/events/${label}`, httpPath: `/actions/${label}`, httpStatus: 200, loginGate: null };
    const requests = [], handshakes = [], sockets = new Set();
    const httpServer = http.createServer(async (request, response) => {
      const url = new URL(request.url, 'http://127.0.0.1');
      let raw = ''; for await (const part of request) raw += part;
      const action = url.pathname.split('/').at(-1), token = url.searchParams.get('access_token') || '';
      requests.push({ path: url.pathname, action, token, body: raw });
      if (!url.pathname.startsWith(state.httpPath + '/')) { response.writeHead(404); response.end('{}'); return; }
      if (token !== state.httpToken) { response.writeHead(401); response.end('{}'); return; }
      if (state.httpStatus !== 200) { response.writeHead(state.httpStatus); response.end('{}'); return; }
      if (action === 'get_login_info' && state.loginGate) await state.loginGate.promise;
      if (response.destroyed) return;
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ status: 'ok', retcode: 0,
        data: action === 'get_login_info' ? { user_id: Number(state.id), nickname: `SYNTHETIC_277_${id}` } : { endpoint: id, message_id: 27701 } }));
    });
    const wsHttp = http.createServer((_request, response) => { response.writeHead(426); response.end(); });
    const wsServer = new WebSocketServer({ noServer: true });
    wsHttp.on('upgrade', (request, socket, head) => {
      const url = new URL(request.url, 'http://127.0.0.1');
      handshakes.push({ path: url.pathname, token: url.searchParams.get('access_token') || '' });
      if (url.pathname !== state.wsPath || (url.searchParams.get('access_token') || '') !== state.wsToken) {
        socket.end('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\nContent-Length: 0\r\n\r\n'); return;
      }
      wsServer.handleUpgrade(request, socket, head, connection => wsServer.emit('connection', connection));
    });
    wsServer.on('connection', socket => {
      sockets.add(socket); socket.on('close', () => sockets.delete(socket));
      socket.send(JSON.stringify({ post_type: 'meta_event', meta_event_type: 'lifecycle', self_id: Number(state.wsId) }));
    });
    let httpPort = 0, wsPort = 0;
    const listen = (server, port) => new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, '127.0.0.1', () => { server.off('error', reject); resolve(server.address().port); });
    });
    async function resume() { httpPort = await listen(httpServer, httpPort); wsPort = await listen(wsHttp, wsPort); }
    async function pause() {
      for (const socket of sockets) socket.terminate();
      for (const server of [httpServer, wsHttp]) {
        if (!server.listening) continue;
        server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
      }
    }
    await resume();
    const target = { state, requests, handshakes, sockets, pause, resume,
      get httpUrl() { return `http://127.0.0.1:${httpPort}${state.httpPath}`; },
      get wsUrl() { return `ws://127.0.0.1:${wsPort}${state.wsPath}`; },
      config() { return { mode: 'snapshot', networks: {
        httpServers: [{ name: 'http-default', host: '127.0.0.1', port: httpPort, path: state.httpPath, accessToken: state.httpToken }],
        wsServers: [{ name: 'ws-default', host: '127.0.0.1', port: wsPort, path: state.wsPath, role: 'Universal', accessToken: state.wsToken }],
      } }; },
      emit(event) { for (const socket of sockets) socket.send(JSON.stringify(event)); },
      async dispose() { await pause(); await new Promise(resolve => wsServer.close(resolve)); },
    };
    endpoints.push(target); return target;
  }
  function write(id, target) { fs.writeFileSync(path.join(runtime, 'config', `onebot_${id}.json`), JSON.stringify(target.config())); }
  function host(options = {}) {
    let current = { snowluma: { dir: runtime, autoLaunch: false, connectionMode: 'auto', accountId: '',
      // Deliberately use profile 2's defaults; runtime listener ports are random.
      wsUrl: 'ws://127.0.0.1:3101', httpUrl: 'http://127.0.0.1:3100', accessToken: '', httpAccessToken: '', ...options } };
    const listeners = new Set(), events = [], statuses = [], logs = [], writes = [];
    const configFile = path.join(root, `host-config-${hosts.length}.json`);
    const save = () => fs.writeFileSync(configFile, JSON.stringify(current));
    const update = patch => {
      current = { ...current, ...patch, snowluma: { ...current.snowluma, ...patch.snowluma } };
      save(); for (const listener of listeners) listener(structuredClone(current));
      return structuredClone(current);
    };
    save();
    let descriptor;
    const hostConfig = { get: () => structuredClone(current), update(patch) { writes.push(structuredClone(patch)); return update(patch); },
      onChange(callback) { listeners.add(callback); return () => listeners.delete(callback); } };
    transportPlugin.setup({
      log: Object.fromEntries(['info', 'warn', 'error'].map(kind => [kind, message => logs.push(String(message))])),
      capability(name) { return name === 'host.config' ? hostConfig : { appRoot: root }; },
      registerTransport(value) { descriptor = value; }, registerCapability() {}, lifecycle: { onStop() {} },
    });
    assert.equal(descriptor.id, 'onebot');
    const controller = new AbortController();
    const instance = descriptor.create({ signal: controller.signal, current: () => true,
      onEvent: event => events.push(event), onStatus: status => statuses.push(status) });
    const result = { instance, events, statuses, logs, listeners, controller, writes,
      settings() { return structuredClone(current); },
      persistedSettings() { return JSON.parse(fs.readFileSync(configFile, 'utf8')); },
      update(options) { return update({ snowluma: options }); },
    };
    hosts.push(result); return result;
  }
  return { root, runtime, endpoint, write, host };
}

const ready = host => host.instance.client.transportReady && host.instance.client.stage === 'ready';
const message = (id, user = 77777) => ({ post_type: 'message', message_type: 'private', self_id: Number(id), user_id: user, message: [{ type: 'text', data: { text: 'synthetic 277' } }] });

test('actual plugin follows profile 2 runtime ports and isolates two explicitly selected account instances', async t => {
  const f = await fixture(t), first = await f.endpoint('27701'), second = await f.endpoint('27702');
  f.write('27701', first);
  const a = f.host(); await a.instance.start();
  await until(() => ready(a), 'single account follows actual listeners rather than profile 2 default ports');
  assert.equal(a.instance.client.wsUrl, first.wsUrl); assert.equal(a.instance.client.httpUrl, first.httpUrl); assert.equal(a.instance.selfId, '27701');
  assert.equal(a.instance.status().connection.accountId, '27701');
  const previousSocket = a.instance.client.ws;
  f.write('27702', second);
  const b = f.host({ accountId: '27702' }); await b.instance.start(); await until(() => ready(b), 'second instance binds the second account');
  await sleep(2200); // Exercise a real production polling tick after adding an account.
  assert.ok(ready(a)); assert.equal(a.instance.client.ws, previousSocket); assert.equal(a.instance.selfId, '27701');
  a.update({ accountId: '27701' }); // Both instances now also exercise explicit account bindings.
  assert.equal((await a.instance.client.call('get_group_list')).data.endpoint, '27701');
  assert.equal((await b.instance.client.call('get_group_list')).data.endpoint, '27702');
  first.emit(message('27701')); second.emit(message('27702'));
  await until(() => a.events.length === 1 && b.events.length === 1, 'each provider dispatches only its own account event');
  assert.equal(String(a.events[0].event.self_id), '27701'); assert.equal(String(b.events[0].event.self_id), '27702');
  for (const target of [first, second]) {
    assert.ok(target.handshakes.length > 0 && target.requests.length > 0);
    assert.ok(target.handshakes.every(request => request.token === target.state.wsToken));
    assert.ok(target.requests.every(request => request.token === target.state.httpToken));
  }
  assert.equal(fs.existsSync(path.join(f.runtime, 'index.mjs')), false);
});

test('production polling follows disk-only WS/HTTP port/path/token changes and recovers a stopped service', async t => {
  const f = await fixture(t), initial = await f.endpoint('27711', 'initial'), moved = await f.endpoint('27711', 'moved');
  f.write('27711', initial);
  const a = f.host({ accountId: '27711' }); const originalSettings = a.settings(); await a.instance.start();
  await until(() => ready(a), 'initial plugin account is ready');
  const oldWs = a.instance.client.ws, oldGeneration = a.instance.client._gen;
  f.write('27711', moved); // No host config event and no explicit refresh/reconnect.
  await until(() => ready(a) && a.instance.client.wsUrl === moved.wsUrl && a.instance.client.httpUrl === moved.httpUrl, '2 second production poll follows the modified account file');
  assert.notEqual(a.instance.client.ws, oldWs); assert.ok(a.instance.client._gen > oldGeneration); assert.deepEqual(a.settings(), originalSettings);
  assert.equal((await a.instance.client.call('get_group_list')).data.endpoint, '27711');
  assert.ok(moved.handshakes.every(request => request.token === moved.state.wsToken && request.path === moved.state.wsPath));
  assert.ok(moved.requests.every(request => request.token === moved.state.httpToken && request.path.startsWith(moved.state.httpPath + '/')));
  const oldRequests = initial.requests.length, oldConnections = initial.handshakes.length;
  await sleep(100); assert.equal(initial.requests.length, oldRequests); assert.equal(initial.handshakes.length, oldConnections);

  await moved.pause(); await until(() => !a.instance.connected && !ready(a), 'stopped WS service invalidates readiness');
  await moved.resume(); await until(() => ready(a), 'production reconnect restores both channel identities after service returns', 8500);
  const states = a.statuses.map(status => status.stage); assert.ok(states.includes('disconnected')); assert.equal(states.at(-1), 'ready');

  await a.instance.stop(); const connectionsAfterStop = moved.handshakes.length, requestsAfterStop = moved.requests.length;
  moved.state.wsPath = '/events/stopped-change'; moved.state.httpPath = '/actions/stopped-change';
  moved.state.wsToken = 'SYNTHETIC_277_WS_STOPPED'; moved.state.httpToken = 'SYNTHETIC_277_HTTP_STOPPED'; f.write('27711', moved);
  await sleep(2200);
  assert.equal(moved.handshakes.length, connectionsAfterStop); assert.equal(moved.requests.length, requestsAfterStop);
  assert.equal(a.listeners.size, 0); assert.equal(a.instance.client.stage, 'stopped'); assert.equal(a.instance.connected, false);
});

test('disk-only HTTP credential rotation preserves a healthy WS and never sends its token to HTTP', async t => {
  const f = await fixture(t), target = await f.endpoint('27721'); f.write('27721', target);
  const a = f.host({ accountId: '27721' }); await a.instance.start(); await until(() => ready(a), 'initial account ready');
  const socket = a.instance.client.ws, connections = target.handshakes.length;
  target.state.httpToken = 'SYNTHETIC_277_HTTP_ROTATED'; f.write('27721', target);
  await until(() => ready(a) && a.instance.client.httpToken === target.state.httpToken, 'production polling adopts the rotated HTTP-only credential');
  assert.equal(a.instance.client.ws, socket); assert.equal(target.handshakes.length, connections);
  await a.instance.client.call('get_group_list');
  assert.ok(target.requests.every(request => request.token !== target.state.wsToken));
  assert.equal(target.requests.at(-1).token, 'SYNTHETIC_277_HTTP_ROTATED');
  const serialized = JSON.stringify([a.statuses, a.logs, a.instance.status()]);
  assert.equal(serialized.includes('SYNTHETIC_277_HTTP_ROTATED'), false); assert.equal(serialized.includes(target.state.wsToken), false);
});

test('actual plugin blocks wrong-account HTTP actions and rejects foreign-account WS events', async t => {
  const f = await fixture(t), target = await f.endpoint('27731'); f.write('27731', target);
  const a = f.host({ accountId: '27731' }); await a.instance.start(); await until(() => ready(a), 'initial identity verified');
  target.state.id = '27732';
  const actionsBefore = target.requests.filter(request => request.action === 'send_private_msg').length;
  await assert.rejects(a.instance.send('private:77777', [{ type: 'text', text: 'must stay local' }]), /账号|配置/);
  assert.equal(target.requests.filter(request => request.action === 'send_private_msg').length, actionsBefore);
  assert.equal(a.instance.client.errorCode, 'ONEBOT_ACCOUNT_MISMATCH'); assert.equal(ready(a), false);
  target.state.id = '27731'; a.instance.reconnect(); await until(() => ready(a), 'correct account can recover');
  target.emit(message('27732'));
  await until(() => a.instance.client.errorCode === 'ONEBOT_ACCOUNT_MISMATCH', 'foreign-account event fails the binding');
  assert.equal(a.events.length, 0); assert.equal(ready(a), false);
});

test('actual manual HTTP requests do not receive WS credentials across hosts or TLS levels', async t => {
  const f = await fixture(t), target = await f.endpoint('27741');
  target.state.httpToken = '';
  // Both hostnames are loopback. Deliberately do not start WS: this test observes
  // the real HTTP action credential without making any remote connection.
  const crossHost = f.host({ connectionMode: 'manual', wsUrl: 'ws://127.0.0.2:65530/events', httpUrl: target.httpUrl,
    accessToken: 'SYNTHETIC_277_LOCAL_WS_SECRET', httpAccessToken: '' });
  assert.equal((await crossHost.instance.client.call('get_group_list')).data.endpoint, '27741');
  assert.equal(target.requests.at(-1).token, '');
  const downgrade = f.host({ connectionMode: 'manual', wsUrl: 'wss://127.0.0.1:65530/events', httpUrl: target.httpUrl,
    accessToken: 'SYNTHETIC_277_SECURE_WS_SECRET', httpAccessToken: '' });
  assert.equal((await downgrade.instance.client.call('get_group_list')).data.endpoint, '27741');
  assert.equal(target.requests.at(-1).token, '');
  target.state.httpToken = 'SYNTHETIC_277_SPLIT_HTTP_EXPLICIT';
  crossHost.update({ httpAccessToken: target.state.httpToken });
  assert.equal((await crossHost.instance.client.call('get_group_list')).data.endpoint, '27741');
  assert.equal(target.requests.at(-1).token, 'SYNTHETIC_277_SPLIT_HTTP_EXPLICIT');
  assert.ok(target.requests.every(request => !request.token.includes('WS_SECRET')));
  assert.equal(target.handshakes.length, 0);
});

test('automatic runtime switching ignores retained manual credentials on both real protocol channels', async t => {
  const f = await fixture(t), first = await f.endpoint('27751'), second = await f.endpoint('27752');
  f.write('27751', first);
  const secondRuntime = path.join(f.root, 'snowluma-other'); fs.mkdirSync(path.join(secondRuntime, 'config'), { recursive: true });
  fs.writeFileSync(path.join(secondRuntime, 'config', 'onebot_27752.json'), JSON.stringify(second.config()));
  const stored = { accessToken: first.state.wsToken, httpAccessToken: first.state.httpToken };
  const a = f.host(stored); await a.instance.start(); await until(() => ready(a), 'first runtime account ready');
  a.update({ dir: secondRuntime, accountId: '' });
  await until(() => ready(a) && a.instance.selfId === '27752', 'new runtime uses its own selected account');
  await a.instance.client.call('get_group_list');
  assert.ok(second.handshakes.length > 0 && second.requests.length > 0);
  assert.ok(second.handshakes.every(request => request.token === second.state.wsToken));
  assert.ok(second.requests.every(request => request.token === second.state.httpToken));
  assert.equal(a.settings().snowluma.accessToken, stored.accessToken); assert.equal(a.settings().snowluma.httpAccessToken, stored.httpAccessToken);
});

test('a direct HTTP action refreshes disk endpoints and public connection metadata immediately', async t => {
  const f = await fixture(t), first = await f.endpoint('27761', 'direct-first'), second = await f.endpoint('27761', 'direct-next');
  f.write('27761', first);
  const a = f.host({ accountId: '27761' }); await a.instance.start(); await until(() => ready(a), 'initial account ready');
  f.write('27761', second);
  // Deliberately call directly, with no explicit provider refresh or polling wait.
  assert.equal((await a.instance.client.call('get_group_list')).data.endpoint, '27761');
  assert.equal(a.instance.client.httpUrl, second.httpUrl); assert.equal(second.requests.at(-1).token, second.state.httpToken);
  assert.equal(a.instance.status().connection.httpUrl, second.httpUrl); assert.equal(a.instance.status().connection.wsUrl, second.wsUrl);
});

test('verified automatic account binding survives a new transport and cannot switch to a default-port history account', async t => {
  const f = await fixture(t), first = await f.endpoint('27771'), history = await f.endpoint('27772');
  f.write('27771', first);
  // Isolated preset addresses intentionally point at history's listener, while
  // only the first account file initially exists. No fixed user port is opened.
  const a = f.host({ wsUrl: history.wsUrl, httpUrl: history.httpUrl });
  const reboundStatuses = [];
  a.instance.bind({ onStatus: status => reboundStatuses.push(status) });
  await a.instance.start(); await until(() => ready(a) && a.persistedSettings().snowluma.accountId === '27771', 'verified discovery saves its exact account in host config');
  assert.ok(reboundStatuses.some(status => status.transportReady), 'public status rebinding does not replace the private verified-binding observer');
  assert.deepEqual(a.writes, [{ snowluma: { accountId: '27771' } }]);
  const socket = a.instance.client.ws, generation = a.instance.client._gen, scope = a.instance.client._candidateScope, binding = a.instance.client.bindingKey;
  f.write('27772', history);
  await sleep(2200);
  assert.equal(a.writes.length, 1); assert.equal(a.instance.client.ws, socket); assert.equal(a.instance.client._gen, generation);
  assert.equal(a.instance.client._candidateScope, scope); assert.equal(a.instance.client.bindingKey, binding);
  await a.instance.stop();
  const restarted = f.host(a.persistedSettings().snowluma);
  await restarted.instance.start(); await until(() => ready(restarted), 'new transport restores persisted account binding');
  assert.equal(restarted.instance.selfId, '27771'); assert.equal(restarted.instance.client.wsUrl, first.wsUrl);
  assert.equal((await restarted.instance.client.call('get_group_list')).data.endpoint, '27771');
  assert.equal(history.handshakes.length, 0); assert.equal(history.requests.length, 0); assert.equal(restarted.writes.length, 0);
});

test('explicit account bindings and manual mode never rewrite the chosen account setting', async t => {
  const f = await fixture(t), target = await f.endpoint('27781'); f.write('27781', target);
  const explicit = f.host({ accountId: '27781' }); await explicit.instance.start(); await until(() => ready(explicit), 'explicit auto account ready');
  const manual = f.host({ connectionMode: 'manual', wsUrl: target.wsUrl, httpUrl: target.httpUrl,
    accessToken: target.state.wsToken, httpAccessToken: target.state.httpToken });
  await manual.instance.start(); await until(() => ready(manual), 'manual channel identities ready');
  assert.deepEqual(explicit.writes, []); assert.equal(explicit.persistedSettings().snowluma.accountId, '27781');
  assert.deepEqual(manual.writes, []); assert.equal(manual.persistedSettings().snowluma.accountId, '');
});

test('unverified 401 and account mismatch never persist an automatic account choice', async t => {
  const f = await fixture(t), target = await f.endpoint('27791');
  const invalid = target.config(); invalid.networks.httpServers[0].accessToken = 'SYNTHETIC_277_WRONG_HTTP';
  fs.writeFileSync(path.join(f.runtime, 'config', 'onebot_27791.json'), JSON.stringify(invalid));
  const unauthorized = f.host(); await unauthorized.instance.start();
  await until(() => unauthorized.instance.client.errorCode === 'ONEBOT_HTTP_UNAUTHORIZED', 'HTTP 401 reaches status before identity is trusted');
  assert.deepEqual(unauthorized.writes, []); assert.equal(unauthorized.persistedSettings().snowluma.accountId, '');
  await unauthorized.instance.stop();
  target.state.id = '27792'; f.write('27791', target);
  const mismatched = f.host(); await mismatched.instance.start();
  await until(() => mismatched.instance.client.errorCode === 'ONEBOT_ACCOUNT_MISMATCH', 'different HTTP account fails identity verification');
  assert.deepEqual(mismatched.writes, []); assert.equal(mismatched.persistedSettings().snowluma.accountId, '');
});

test('stopping while login verification is pending prevents a late account-config write', async t => {
  const f = await fixture(t), target = await f.endpoint('27801'); f.write('27801', target);
  let release; const promise = new Promise(resolve => { release = resolve; });
  target.state.loginGate = { promise };
  const a = f.host(); await a.instance.start();
  await until(() => target.requests.some(request => request.action === 'get_login_info'), 'verification is pending at the real HTTP endpoint');
  await a.instance.stop(); release(); await sleep(80);
  assert.deepEqual(a.writes, []); assert.equal(a.persistedSettings().snowluma.accountId, ''); assert.equal(a.instance.client.stage, 'stopped');
});
