import fs from 'node:fs';
import path from 'node:path';
import { createHttpServer } from '../src/kernel/http.js';
import { createConfig, buildDefaultConfig } from '../src/kernel/config.js';
import { createSessionRegistry } from '../src/kernel/sessions.js';
import { createSseBridge } from '../src/console/sse-bridge.js';
import { registerConsoleRoutes } from '../src/console/routes.js';
import { Bus } from '../src/kernel/bus.js';
import { eq, ok, mktmp, section, summary } from './helpers.mjs';

const dataDir = mktmp('qqa-m3-process-');
const staticDir = mktmp('qqa-m3-process-static-');
fs.writeFileSync(path.join(staticDir, 'index.html'), 'ok');
const log = { level: 'info', error() {}, warn() {}, info() {}, recent: () => [], setLevel(level) { this.level = level; return level; } };
const config = createConfig({ dataDir, defaults: buildDefaultConfig(), log });
config.load();
config.update({ server: { port: 0, token: 'process-secret' }, snowluma: { dir: '/snowluma' } });
const bus = new Bus(log);
const calls = [];
const snowLogs = Array.from({ length: 250 }, (_, i) => ({ at: i, stream: 'stdout', text: `snow-${i}` }));
const qqLogs = Array.from({ length: 210 }, (_, i) => ({ at: i, stream: 'stderr', text: `qq-${i}` }));
const snowluma = {
  async launch(body, context) { calls.push(['snow-launch', body, context]); return { embedded: true }; },
  logs() { return { logs: snowLogs }; },
  async stop() { return { ok: true, stopped: true, embedded: true, pid: 321 }; },
  async openFolder() { return { ok: true }; },
  async openWebui() { return { ok: true, webuiUrl: 'http://127.0.0.1:5099/' }; },
  status() { return { running: true, webuiUrl: 'http://127.0.0.1:5099/' }; },
};
const qqPortable = {
  async launch(body) { calls.push(['qq-launch', body]); return { alreadyRunning: false, launching: true }; },
  async stop() { return { ok: true, stopped: false, reason: 'not_running' }; },
  logs() { return qqLogs; },
  status() { return { ready: true, running: false, pid: null, dir: '/qq', dataDir: '/qq-data' }; },
};
const sessions = createSessionRegistry({ dataDir, log, bus });
const noops = { status: () => ({}), listEntries: () => [], promptSections: () => [] };
const http = createHttpServer({ config, log, staticDir });
createSseBridge({ bus, http });
registerConsoleRoutes(http, { config, sessions, store: noops, memory: noops, loader: noops, orchestrator: noops, capability: { names: () => [], explain: () => ({}) }, registry: noops, dataDir, bus, log, processAdapters: { snowluma, qqPortable } });
const port = await http.listen();
async function request(method, pathname, body) {
  const response = await fetch(`http://127.0.0.1:${port}${pathname}`, { method, headers: { 'x-console-token': 'process-secret', ...(body === undefined ? {} : { 'content-type': 'application/json' }) }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: response.status, data: await response.json() };
}

section('R08 launch 注入 adapter 参数与 DTO');
let response = await request('POST', '/api/snowluma/launch', { requested: true });
eq(response.status, 200, 'snow launch status');
eq(response.data.ok, true, 'snow launch ok');
eq(response.data.launched, true, 'snow launch launched');
eq(response.data.embedded, true, 'snow launch embedded');
eq(calls[0][1], { requested: true }, 'snow launch receives body');
section('R09/R15 日志最多返回最近 200 条');
response = await request('GET', '/api/snowluma/logs'); eq(response.data.logs.length, 200, 'snow logs slice'); eq(response.data.logs[0].text, 'snow-50', 'snow logs recent first');
response = await request('GET', '/api/qq-portable/logs'); eq(response.data.logs.length, 200, 'qq logs slice'); eq(response.data.logs[0].text, 'qq-10', 'qq logs recent first');
section('R10 stop 及 SSE');
const controller = new AbortController(); const sse = await fetch(`http://127.0.0.1:${port}/api/events?token=process-secret`, { signal: controller.signal }); const reader = sse.body.getReader(); const decoder = new TextDecoder(); let stream = ''; while (!stream.includes('event: hello')) { const { done, value } = await reader.read(); if (done) break; stream += decoder.decode(value); }
response = await request('POST', '/api/snowluma/stop'); eq(response.status, 200, 'snow stop status'); eq(response.data.pid, 321, 'snow stop pid'); while (!stream.includes('event: snowluma-status')) { const { done, value } = await reader.read(); if (done) break; stream += decoder.decode(value); } ok(stream.includes('"running":false'), 'snow stop emits status'); controller.abort(); await reader.cancel().catch(() => {});
section('R11/R12/R13/R14/R16 DTO');
response = await request('POST', '/api/snowluma/open-folder'); eq(response.data.ok, true, 'open folder'); response = await request('POST', '/api/snowluma/open-webui'); eq(response.data.webuiUrl, 'http://127.0.0.1:5099/', 'open webui'); response = await request('POST', '/api/qq-portable/launch', { isolated: true }); eq(response.data.launching, true, 'qq launch'); response = await request('POST', '/api/qq-portable/stop'); eq(response.data.reason, 'not_running', 'qq not running reason'); response = await request('GET', '/api/qq-portable/status'); eq(response.data, { ready: true, running: false, pid: null, dir: '/qq', dataDir: '/qq-data' }, 'qq exact status');
section('缺 capability 返回 503'); const missing = createHttpServer({ config, log, staticDir }); registerConsoleRoutes(missing, { config, sessions, store: noops, loader: noops, orchestrator: noops, dataDir, log }); const missingPort = await missing.listen(); const missingRes = await fetch(`http://127.0.0.1:${missingPort}/api/snowluma/logs`, { headers: { 'x-console-token': 'process-secret' } }); eq(missingRes.status, 503, 'missing adapter status'); await missing.close(); await http.close(); summary('40-m3-process-routes');
