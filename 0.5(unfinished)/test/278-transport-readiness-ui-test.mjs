// Actual console route, production panel source and browser settings form.
// Synthetic provider states only; no system QQ or SnowLuma is started.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import vm from 'node:vm';
import { registerConsoleRoutes } from '../src/console/routes.js';
import { buildDefaultConfig } from '../src/kernel/config.js';
import { modelUiFixture } from './model-ui-fixture.mjs';

const panelSource = fs.readFileSync(new URL('../ui/panels/snowluma/panel.js', import.meta.url), 'utf8').replace(/^import .*\r?\n/gm, '');
async function statusPage(t, transport, snowPatch = {}, legacyOverlay = false) {
  const handlers = new Map(), cfg = buildDefaultConfig();
  registerConsoleRoutes({ route(method, url, handler) { handlers.set(method + ' ' + url, handler); } }, {
    config: { get: () => structuredClone(cfg), update() {} }, sessions: { todayUsage: () => ({}) }, loader: { listEntries: () => [] },
    orchestrator: { status: () => ({}) }, dataDir: os.tmpdir(), priceUpdates: { resolve: () => null }, marketClient: {}, communityClient: {},
    transportStatus: () => structuredClone(transport),
    statusProviders: { snowluma: () => ({ running: true, configured: true, ...snowPatch }), qqPortable: () => ({ ready: false, launchAllowed: false, diagnosis: 'UNRELATED_PORTABLE_PAUSE_278' }) },
  });
  const state = await handlers.get('GET /api/status')({});
  const nodes = new Map();
  const $ = id => { assert.ok(!['#quick-start','#reload','#qq-start','#qq-stop','#qq-status','#qq-log'].includes(id),'removed portable controls are never queried'); if (!nodes.has(id)) nodes.set(id, { textContent: '', addEventListener() {} }); return nodes.get(id); };
  let leave;
  const context = vm.createContext({ $, request: async (_method, url) => url === '/api/status' ? structuredClone(state) : { logs: [] },
    onShellEvent: () => () => {}, onLeave(fn) { leave = fn; }, dateTime: String,
    createLogStream: () => ({ refresh: async () => {}, append() {}, dispose() {} }),
    window: { addEventListener() {} }, setTimeout, clearTimeout, console });
  vm.runInContext(panelSource, context, { filename: 'production-snowluma-panel.js' });
  for (let index = 0; index < 5; index++) await new Promise(setImmediate);
  t.after(() => leave?.());
  return { state, text: $('#status').textContent, nodes };
}

test('port failure remains a port diagnosis even after a previous successful login', async t => {
  const { state, text } = await statusPage(t, { connected: false, everConnected: true, error: 'connect ECONNREFUSED 127.0.0.1:31991' });
  assert.match(state.onebot.diagnosis, /端口未监听/); assert.match(text, /31991/);
  assert.doesNotMatch(text, /无账号登录|UNRELATED_PORTABLE_PAUSE_278/);
});
test('401 remains an authentication diagnosis', async t => {
  const { state, text } = await statusPage(t, { connected: false, error: 'Unexpected server response: 401' });
  assert.match(state.onebot.diagnosis, /认证失败/); assert.match(text, /对应协议的令牌/);
});
test('a WS socket alone is shown as verifying when the provider has not verified HTTP/account readiness', async t => {
  const { state, text } = await statusPage(t, { connected: true, transportReady: false, stage: 'verifying', selfId: null });
  assert.equal(state.onebot.transportReady, false); assert.match(text, /OneBot：验证中/); assert.doesNotMatch(text, /OneBot：已连接/);
});

test('a disconnected status cannot retain a cached ready flag', async t => {
  const { state, text } = await statusPage(t, { connected: false, transportReady: true, selfId: null });
  assert.equal(state.onebot.transportReady, false); assert.match(text, /OneBot：未连接/); assert.doesNotMatch(text, /OneBot：已连接/);
});
test('verified account status exposes actual endpoints and no private binding or credential metadata', async t => {
  const { state, text } = await statusPage(t, { connected: true, transportReady: true, selfId: '27801', stage: 'ready',
    bindingKey: 'PRIVATE_BINDING_278', candidateScope: 'PRIVATE_SCOPE_278', accessToken: 'PRIVATE_TOKEN_278',
    connection: { mode: 'auto', accountId: '27801', wsUrl: 'ws://127.0.0.1:31992/events', httpUrl: 'http://127.0.0.1:31993/actions', accessToken: 'PRIVATE_TOKEN_278' } });
  assert.equal(state.onebot.diagnosis, null); assert.match(text, /OneBot：已连接/); assert.match(text, /31992\/events/); assert.match(text, /账号 27801/);
  assert.doesNotMatch(JSON.stringify(state.onebot), /PRIVATE_/);
});
test('account mismatch from the provider is preserved even with an open socket', async t => {
  const { state, text } = await statusPage(t, { connected: true, transportReady: false, stage: 'account_mismatch', errorCode: 'ONEBOT_ACCOUNT_MISMATCH', diagnosis: 'HTTP、WS 与所选 QQ 账号不一致' });
  assert.equal(state.onebot.errorCode, 'ONEBOT_ACCOUNT_MISMATCH'); assert.match(text, /账号不一致/); assert.doesNotMatch(text, /OneBot：已连接/);
});
test('native component failure remains visible without portable controls', async t => {
  const { text, nodes } = await statusPage(t, { connected: false, error: 'ECONNREFUSED' }, { nativeState: 'load_failed', nativeDiagnosis: 'SnowLuma 原生模块加载失败，请核对完整安装包' });
  assert.match(text, /原生模块加载失败/); assert.equal(nodes.get('#sl-start').disabled, true, 'running Snow component is not started twice');
  assert.doesNotMatch(text, /UNRELATED_PORTABLE_PAUSE_278/);
  assert.equal(nodes.has('#qq-status'), false, 'removed portable status is never reconstructed');
});
test('replacement transports without the optional readiness extension retain their connected contract', async t => {
  const { state, text } = await statusPage(t, { id: 'replacement-transport', connected: true, selfId: '27802' });
  assert.equal(Object.hasOwn(state.onebot, 'transportReady'), false); assert.match(text, /OneBot：已连接/);
});

test('panel without portable nodes retains SnowLuma and OneBot readiness', async t => {
  const { text, nodes } = await statusPage(t, { connected: true, transportReady: true, selfId: '27801' }, {}, true);
  assert.match(text, /OneBot：已连接/); assert.equal(nodes.get('#sl-start').disabled, true);
});
test('credential-shaped errors are redacted before reaching the status DTO or panel', async t => {
  const { state, text } = await statusPage(t, { connected: false, error: 'error token=PRIVATE_278 bearer PRIVATE_BEARER_278', connection: { wsUrl: 'ws://127.0.0.1:31994/?access_token=PRIVATE_QUERY_278' } });
  assert.doesNotMatch(JSON.stringify(state.onebot), /PRIVATE_/); assert.doesNotMatch(text, /PRIVATE_/);
});
test('real settings form saves connection mode/account through the existing lifecycle and preserves independent manual endpoints', async t => {
  const qa = await modelUiFixture({ config: { snowluma: { connectionMode: 'auto', accountId: '', wsUrl: 'ws://127.0.0.1:31701/events', httpUrl: 'http://127.0.0.1:31700/actions', accessToken: 'SYNTHETIC_SHOW_WS_278', httpAccessToken: '' } } });
  t.after(() => qa.close());
  const frame = qa.frame;
  await frame.locator('#settings-sidebar a[data-target="onebot"]').click();
  const mode = frame.locator('[data-config-path="snowluma.connectionMode"]'), account = frame.locator('[data-config-path="snowluma.accountId"]');
  await mode.waitFor({ state: 'visible' }); await account.waitFor({ state: 'visible' });
  assert.equal(await mode.inputValue(), 'auto');
  await account.fill('27801'); await mode.selectOption('manual');
  await frame.locator('#save').click(); await frame.locator('#status').filter({ hasText: '已保存' }).waitFor();
  assert.equal(qa.disk().snowluma.accountId, '27801'); assert.equal(qa.disk().snowluma.connectionMode, 'manual');
  assert.equal(qa.disk().snowluma.wsUrl, 'ws://127.0.0.1:31701/events'); assert.equal(qa.disk().snowluma.httpUrl, 'http://127.0.0.1:31700/actions');
  await mode.selectOption('auto'); await frame.locator('#save').click(); await frame.locator('#status').filter({ hasText: '已保存' }).waitFor();
  assert.equal(qa.disk().snowluma.connectionMode, 'auto'); assert.equal(qa.disk().snowluma.accountId, '27801');
  assert.equal((await qa.request('GET', '/api/onebot-token?which=ws')).data.token, 'SYNTHETIC_SHOW_WS_278');
  assert.equal((await qa.request('GET', '/api/onebot-token?which=http')).data.token, '', 'show existing HTTP credential must not display an inherited WS credential');
  // Real SSE -> shell state -> readiness UI across default/legacy providers.
  const readiness = qa.page.locator('#ready-onebot');
  const show = async (snapshot, expected, label) => {
    qa.kernel.bus.emit('onebot.status', snapshot);
    await qa.page.waitForFunction(({ expected, label }) => {
      const node = document.querySelector('#ready-onebot');
      return node?.dataset.state === expected && node.textContent.includes(label);
    }, { expected, label });
    assert.equal(await readiness.getAttribute('data-state'), expected);
  };
  await show({ id: 'onebot', connected: true, transportReady: false, stage: 'verifying' }, 'warn', '验证中');
  await show({ id: 'replacement278', connected: true, selfId: '27802' }, 'good', '已连接');
  await show({ id: 'onebot', connected: true, transportReady: false, stage: 'verifying' }, 'warn', '验证中');
  await show({ id: 'onebot', connected: true, transportReady: true, selfId: '27801' }, 'good', '已连接');
  await show({ id: 'onebot', connected: false, transportReady: true, selfId: null }, 'warn', '未连接');
  await show({ id: 'onebot', connected: true, selfId: '27801' }, 'good', '已连接');
  assert.equal(qa.errors.length, 0); assert.equal(qa.outbound(), 0);
});
