// Real kernel -> SSE -> shell bridge -> sandbox iframe in installed Chromium.
// All process observations are inert local objects; no process is launched and
// the browser/kernel cannot reach a vendor, account, QQ profile, or external API.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import dns from 'node:dns/promises';
import { createRequire } from 'node:module';
import { createKernel } from '../src/kernel/kernel.js';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qqa-live-logs166-')), token = 'synthetic-logs166';
// The real imported default kernel/UI is under test; no installed extension
// belongs in this regression's temporary application root.
const appRoot = path.join(dataDir, 'application'); fs.mkdirSync(appRoot);
fs.cpSync(path.resolve(import.meta.dirname, '../ui'), path.join(appRoot, 'ui'), { recursive: true });
for (const directory of ['bundled', 'plugins', 'skills']) fs.mkdirSync(path.join(appRoot, directory));
let isolatedOutbound = 0, dnsCalls = 0; const browserOutbound = [], ownedOrigins = new Set();
const nativeFetch = globalThis.fetch, nativeLookup = dns.lookup;
globalThis.fetch = async (input, options) => {
  const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
  if (ownedOrigins.has(url.origin)) return nativeFetch(input, options);
  isolatedOutbound++; throw new Error('QA166 external fetch disabled');
};
dns.lookup = async () => { dnsCalls++; throw new Error('QA166 external DNS disabled'); };
const routeOwnedPage = (page, base, onBlocked = () => {}) => page.route('**/*', route => {
  const url = route.request().url();
  if (new URL(url).origin === new URL(base).origin) return route.continue();
  browserOutbound.push(url); onBlocked(url); return route.abort();
});
function assertOffline() {
  assert.equal(isolatedOutbound, 0, 'no external Node fetch was attempted');
  assert.equal(dnsCalls, 0, 'no external DNS was attempted');
  assert.deepEqual(browserOutbound, [], 'all browser pages used only their owned console origin');
}

const snowHistory = [], qqHistory = [], errors = [], externalRequests = [], releases = new Set();
let outbound = 0, processActions = 0, statusReads = 0, statusCompleted = 0, statusGate = null, stamp = Date.now();
const snapshotPaths = ['/api/snowluma/logs', '/api/logs'];
const trackedPaths = [...snapshotPaths, '/api/status', '/api/snowluma/status', '/api/qq-portable/status', '/api/qq-portable/logs'];
const counts = Object.fromEntries(trackedPaths.map(name => [name, 0]));
const snowState = { configured: true, running: false, processState: 'stopped' };
const qqState = { ready: false, installedReady: false, running: false, processState: 'stopped', diagnosis: 'QA166 inert fixture; launch disabled' };
const gate = () => { let release; const promise = new Promise(resolve => { release = resolve; }); releases.add(release); return { promise, release() { releases.delete(release); release(); } }; };
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate, message, timeout = 5000) { const deadline = Date.now() + timeout; do { if (await predicate()) return; await delay(15); } while (Date.now() < deadline); assert.fail(message); }
const kernel = createKernel({ appRoot,
  env: { QQ_AGENT_DATA_DIR: dataDir, QQ_AGENT_PORT: '0', QQ_AGENT_MIGRATE_FROM: path.join(dataDir, 'absent-migration-source') }, headless: true,
  transport: { id: 'inert166', start() {}, stop() {}, status: () => ({ connected: false }), actions: {}, processes: {
    snowluma: { statusSync: () => ({ ...snowState }), status: async () => { statusReads++; const pending = statusGate; if (pending) await pending.promise; statusCompleted++; return { ...snowState }; }, logs: () => ({ logs: [...snowHistory] }), launch() { processActions++; throw new Error('QA166 must never launch SnowLuma'); } },
    qqPortable: { statusSync: () => ({ ...qqState }), async status() { return { ...qqState }; }, logs: () => ({ logs: [...qqHistory] }), launch() { processActions++; throw new Error('QA166 must never launch QQ'); } },
  } },
  priceUpdates: { refresh: async () => ({ok:true}), updateCheck: async () => ({ok:true,current:'0.5.0',latest:'0.5.0',hasUpdate:false}) },
  communityMarket: { syncGlobalBlocklist: async () => ({ ok: true, ids: [] }), getBlocklist: () => ({ ok: true, ids: [] }), listAccounts: () => ({ ok: true, accounts: [] }) },
  fetchImpl: async () => { outbound++; throw new Error('QA166 outbound network disabled'); },
});
kernel.log.setLevel('error'); kernel.loader.startWatchers = () => {};
kernel.config.update({ server: { port: 0, token }, telemetry: { enabled: false }, proactive: { enabled: false }, ui: { refreshMs: 15000 } });
function processEntry(source, text, publish = true) {
  const entry = { at: ++stamp, stream: source === 'snow' ? 'stdout' : 'stderr', text };
  (source === 'snow' ? snowHistory : qqHistory).push(entry);
  if (publish) kernel.bus.emit(source === 'snow' ? 'snowluma.log' : 'qq-portable.log', entry);
  return entry;
}
function appEntry(text, publish = true, level = 'error') {
  if (!publish) kernel.log.setBus(null);
  try { kernel.log[level](text); } finally { if (!publish) kernel.log.setBus(kernel.bus); }
  return kernel.log.recent({ n: 1 })[0];
}
function pair(tag, publish = true) { const snow=processEntry('snow', `SNOW166 ${tag}`, publish); processEntry('qq', `QQ166 ${tag}`, publish); return [snow, appEntry(`APP166 ${tag}`, publish)]; }
const ids = ['sl-log', 'app-log'], prefixes = ['SNOW166', 'APP166'];
const countText = (text, needle) => text.split(needle).length - 1;
function chromiumExecutable(playwright) {
  if (process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH) return process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
  const roots = [path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'ms-playwright'), path.join(os.homedir(), '.cache', 'ms-playwright'), path.join(os.homedir(), 'Library', 'Caches', 'ms-playwright')];
  for (const root of roots) {
    let versions; try { versions = fs.readdirSync(root).filter(name => /^chromium-\d+$/.test(name)).sort((a, b) => Number(b.slice(9)) - Number(a.slice(9))); } catch { continue; }
    for (const version of versions) for (const relative of ['chrome-win64/chrome.exe', 'chrome-win/chrome.exe', 'chrome-linux64/chrome', 'chrome-linux/chrome', 'chrome-mac-arm64/Chromium.app/Contents/MacOS/Chromium', 'chrome-mac/Chromium.app/Contents/MacOS/Chromium']) {
      const candidate = path.join(root, version, relative); if (fs.existsSync(candidate)) return candidate;
    }
  }
  const candidate = playwright.chromium.executablePath(); assert.ok(fs.existsSync(candidate), 'Use installed Chromium; this test never downloads a browser'); return candidate;
}

let browser, page, holdSnapshots = null;
try {
  const base = `http://127.0.0.1:${await kernel.start()}`; ownedOrigins.add(base);
  assert.notEqual(new URL(base).port, '15967'); assert.deepEqual(kernel.loader.listEntries(), []);
  pair('initial snapshot', false);
  const playwright = createRequire(import.meta.url)('playwright-core');
  browser = await playwright.chromium.launch({ executablePath: chromiumExecutable(playwright), headless: process.env.QA_HEADLESS !== '0' });
  const context = await browser.newContext({ viewport: { width: 1360, height: 900 }, reducedMotion: 'reduce' });
  page = await context.newPage(); page.setDefaultTimeout(10000);
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { const url = new URL(request.url()); if (request.method() === 'GET' && Object.hasOwn(counts, url.pathname)) counts[url.pathname]++; });
  await routeOwnedPage(context, base, url => externalRequests.push(url));
  // Keep the real server stream and production reconnect loop. This hook only
  // exposes a way to end the current real reader, like a dropped connection.
  await page.addInitScript(() => {
    const original = window.fetch.bind(window); window.__qa166Sse = { connections: 0, disconnect: null };
    window.fetch = async (...args) => {
      const response = await original(...args), url = new URL(args[0] instanceof Request ? args[0].url : String(args[0]), location.href);
      if (url.pathname !== '/api/events' || !response.body) return response;
      const reader = response.body.getReader(); let closed = false, sink;
      window.__qa166Sse.connections++;
      const stream = new ReadableStream({
        start(controller) { sink = controller; },
        async pull(controller) { try { const next = await reader.read(); if (closed) return; if (next.done) { closed = true; controller.close(); } else controller.enqueue(next.value); } catch (error) { if (!closed) { closed = true; controller.error(error); } } },
        cancel(reason) { closed = true; return reader.cancel(reason); },
      });
      window.__qa166Sse.disconnect = () => { if (closed) return; closed = true; sink.close(); void reader.cancel(); };
      return new Response(stream, { status: response.status, statusText: response.statusText, headers: response.headers });
    };
  });
  const snapshotRoute = async route => {
    const pathname = new URL(route.request().url()).pathname, held = holdSnapshots;
    if (!held || !snapshotPaths.includes(pathname)) return route.continue();
    const response = await route.fetch(); held.paths.add(pathname); await held.wait.promise; await route.fulfill({ response }); held.completed.add(pathname);
  };
  await page.route('**/api/**', snapshotRoute);
  await page.goto(`${base}/?token=${token}`);
  await page.locator('#nav button[data-panel=snowluma]').waitFor();
  await page.locator('#ready-snow').filter({hasText:'未运行'}).waitFor();
  await page.waitForFunction(() => window.__qa166Sse?.connections === 1);
  statusGate = gate(); const completedBeforeHold = statusCompleted;
  await page.locator('#nav button[data-panel=snowluma]').click();
  let frame = page.frameLocator('#panel-host iframe');
  await frame.locator('#sl-log').waitFor();
  assert.equal(await frame.locator('#quick-start,#reload,#qq-start,#qq-stop,#qq-status,#qq-log').count(),0);
  assert.equal(counts['/api/qq-portable/logs'],0,'the removed QQ terminal has no snapshot subscription');
  await until(() => statusReads > completedBeforeHold, 'The panel must reach the held SnowLuma observation');

  console.log('· Initial snapshots and two live streams paint while the real SnowLuma status request is held');
  await until(async () => (await frame.locator('#sl-log').textContent()).includes('initial snapshot'), 'Initial log snapshots must not wait for SnowLuma status', 1000);
  for (let i = 0; i < ids.length; i++) assert.ok((await frame.locator('#' + ids[i]).textContent()).includes(`${prefixes[i]} initial snapshot`));
  const beforeBurst = { ...counts }, maxLatency = [];
  for (let index = 0; index < 8; index++) {
    const tag = `continuous-${index}`, started = Date.now(); pair(tag);
    await until(async () => (await Promise.all(ids.map(id => frame.locator('#' + id).textContent()))).every((text, i) => text.includes(`${prefixes[i]} ${tag}`)), 'All streams must remain live during slow process discovery', 1000);
    maxLatency.push(Date.now() - started); await delay(45);
  }
  await delay(260);
  assert.deepEqual(counts, beforeBurst, 'Log SSE payloads must not trigger log snapshots or status HTTP reads');
  assert.equal(statusCompleted, completedBeforeHold, 'SnowLuma is still blocked throughout live rendering');
  assert.ok(Math.max(...maxLatency) < 1000, 'Real end-to-end log latency stays below one second');

  console.log('· A delayed real snapshot preserves new events and deduplicates its overlapping live record');
  const overlap = pair('overlap snapshot', false);
  holdSnapshots = { paths: new Set(), completed: new Set(), wait: gate() };
  await page.locator('#nav button[data-panel=sessions]').click();
  await page.frameLocator('#panel-host iframe').locator('body[data-panel=sessions]').waitFor();
  await page.locator('#nav button[data-panel=snowluma]').click();frame=page.frameLocator('#panel-host iframe');
  await until(() => holdSnapshots.paths.size === 2, 'Both real snapshots must be captured before publishing new entries');
  kernel.bus.emit('snowluma.log', overlap[0]); kernel.bus.emit('log', overlap[1]);
  pair('after delayed snapshot');
  await until(async () => (await Promise.all(ids.map(id => frame.locator('#' + id).textContent()))).every(text => text.includes('after delayed snapshot')), 'Live updates cannot wait for any held snapshot', 1000);
  const held = holdSnapshots; holdSnapshots = null; held.wait.release();
  await until(() => held.completed.size === 2, 'All delayed real snapshot responses must finish');
  await until(async () => (await Promise.all(ids.map(id => frame.locator('#' + id).textContent()))).every(text => text.includes('overlap snapshot') && text.includes('after delayed snapshot')), 'Old snapshots must merge with events that arrived during the request');
  // Observe the settled real HTTP responses before checking the final merge.
  await until(async () => await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))), 'The browser paint must settle');
  for (let i = 0; i < ids.length; i++) {
    const text = await frame.locator('#' + ids[i]).textContent();
    assert.equal(countText(text, `${prefixes[i]} overlap snapshot`), 1, 'Snapshot/event overlap appears exactly once');
    assert.equal(countText(text, `${prefixes[i]} after delayed snapshot`), 1, 'Late old snapshot cannot replace a newer event');
  }
  statusGate.release(); statusGate = null;
  await until(() => statusCompleted > completedBeforeHold, 'The controlled SnowLuma status transaction must finish after release');

  console.log('· Each live buffer stays at 200 text-only entries and preserves upward reading scroll');
  for (let index = 0; index < 240; index++) pair(`bounded-${String(index).padStart(3, '0')}`);
  await until(async () => (await Promise.all(ids.map(id => frame.locator('#' + id).textContent()))).every(text => text.includes('bounded-239')), 'A burst must reach all visible terminals');
  for (const id of ids) {
    const lines = (await frame.locator('#' + id).textContent()).split('\n');
    assert.equal(lines.length, 200, `${id} has a bounded 200-entry DOM presentation`);
    assert.equal(lines.some(line => line.includes('bounded-039')), false); assert.ok(lines[0].includes('bounded-040'));
    assert.equal(await frame.locator('#' + id).locator('*').count(), 0, 'Log data is rendered as text');
    await frame.locator('#' + id).evaluate(node => { node.scrollTop = 37; });
  }
  const reading = await Promise.all(ids.map(id => frame.locator('#' + id).evaluate(node => ({ y: node.scrollTop, scrollable: node.scrollHeight > node.clientHeight }))));
  assert.ok(reading.every(item => item.scrollable && item.y > 0), 'Each terminal offers a real upward reading surface');
  const injection = '<img src=x onerror="window.__QA166_INJECTED=1"><script>window.__QA166_INJECTED=1</script>';
  pair(`literal ${injection}`);
  await until(async () => (await frame.locator('#sl-log').textContent()).includes(injection), 'Literal log text should arrive');
  for (let i = 0; i < ids.length; i++) {
    assert.ok((await frame.locator('#' + ids[i]).textContent()).includes(injection));
    assert.equal(await frame.locator('#' + ids[i]).locator('img,script').count(), 0);
    assert.equal(await frame.locator('#' + ids[i]).evaluate(node => node.scrollTop), reading[i].y, 'New logs preserve the upward reading position');
  }
  assert.equal(await frame.locator('body').evaluate(() => window.__QA166_INJECTED), undefined);
  await frame.locator('#sl-log').evaluate(node => { node.scrollTop = node.scrollHeight; });
  pair('tail-follow');
  await until(async () => (await frame.locator('#sl-log').textContent()).includes('tail-follow'), 'Tail-follow event should paint');
  assert.ok(await frame.locator('#sl-log').evaluate(node => node.scrollHeight - node.scrollTop - node.clientHeight < 8), 'A reader already at the bottom follows the live tail');

  console.log('· A genuine SSE disconnect/reconnect hello fills missed history once per log source');
  const reconnectBefore = { ...counts };
  await page.evaluate(() => window.__qa166Sse.disconnect());
  await until(() => kernel.httpServer.sseCount() === 0, 'The real server stream must disconnect');
  pair('missed while disconnected');
  await page.waitForFunction(() => window.__qa166Sse.connections === 2);
  await until(async () => (await Promise.all(ids.map(id => frame.locator('#' + id).textContent()))).every(text => text.includes('missed while disconnected')), 'Real reconnect hello must repair logs missed offline');
  await delay(260);
  for (const pathname of snapshotPaths) assert.equal(counts[pathname], reconnectBefore[pathname] + 1, 'A reconnect hello takes one snapshot per source');
  for (let i = 0; i < ids.length; i++) assert.equal(countText(await frame.locator('#' + ids[i]).textContent(), `${prefixes[i]} missed while disconnected`), 1);

  console.log('· Returning to the panel reads fresh history, and the actual application log level remains effective');
  pair('snapshot-only manual refresh', false);
  const manualBefore = { ...counts };
  await page.locator('#nav button[data-panel=sessions]').click();
  await page.frameLocator('#panel-host iframe').locator('body[data-panel=sessions]').waitFor();
  await page.locator('#nav button[data-panel=snowluma]').click();frame=page.frameLocator('#panel-host iframe');
  await until(async () => (await Promise.all(ids.map(id => frame.locator('#' + id).textContent()))).every(text => text.includes('snapshot-only manual refresh')), 'Remount must independently paint both fresh histories');
  for (const pathname of snapshotPaths) assert.equal(counts[pathname], manualBefore[pathname] + 1);
  let changed = page.waitForResponse(response => new URL(response.url()).pathname === '/api/logs/level' && response.request().method() === 'POST');
  await frame.locator('#log-level').selectOption('info'); assert.equal((await changed).status(), 200); assert.equal(kernel.log.level, 'info');
  appEntry('APP166 visible info before filter', true, 'info');
  await until(async () => (await frame.locator('#app-log').textContent()).includes('visible info before filter'), 'Info log is visible at info level');
  changed = page.waitForResponse(response => new URL(response.url()).pathname === '/api/logs/level' && response.request().method() === 'POST');
  await frame.locator('#log-level').selectOption('warn'); assert.equal((await changed).status(), 200); assert.equal(kernel.log.level, 'warn');
  await until(async () => !(await frame.locator('#app-log').textContent()).includes('visible info before filter'), 'The new application snapshot honors warn filtering');
  appEntry('APP166 filtered-out debug', true, 'debug'); appEntry('APP166 visible warning', true, 'warn');
  await until(async () => (await frame.locator('#app-log').textContent()).includes('visible warning'), 'Warning log arrives at warn level');
  assert.equal((await frame.locator('#app-log').textContent()).includes('filtered-out debug'), false);

  console.log('· Leaving the iframe stops reads; returning takes fresh snapshots for missed events');
  await page.locator('#nav button[data-panel=sessions]').click();
  await page.frameLocator('#panel-host iframe').locator('body[data-panel=sessions]').waitFor();
  const awayBefore = { ...counts }; pair('missed while panel absent'); await delay(300);
  for (const pathname of snapshotPaths) assert.equal(counts[pathname], awayBefore[pathname], 'An unloaded process panel never refreshes logs');
  await page.locator('#nav button[data-panel=snowluma]').click(); frame = page.frameLocator('#panel-host iframe');
  await until(async () => (await Promise.all(ids.map(id => frame.locator('#' + id).textContent()))).every(text => text.includes('missed while panel absent')), 'Remount fetches the history missed while away');
  if (process.env.QA_SCREENSHOT_DIR) {
    const directory = path.resolve(process.env.QA_SCREENSHOT_DIR); fs.mkdirSync(directory, { recursive: true });
    await frame.locator('body').evaluate(async () => { await document.fonts.ready; await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); });
    await page.screenshot({ path: path.join(directory, 'logs-166-live-process.png'), fullPage: true, animations: 'disabled' });
  }
  assert.equal(counts['/api/qq-portable/logs'],0,'no QQ log requests occur during reconnect or remount');
  assert.deepEqual(errors, []); assert.deepEqual(externalRequests, []); assert.equal(outbound, 0); assert.equal(processActions, 0);
  console.log(JSON.stringify({ test: '166-live-process-logs', result: 'passed', actualKernel: true, actualSse: true, actualChromium: true, maxContinuousLatencyMs: Math.max(...maxLatency), bufferLimit: 200, launchedProcesses: processActions, outboundRequests: outbound }));
} finally {
  for (const release of releases) release();
  await browser?.close(); await kernel.stop();
  assert.equal(path.dirname(path.resolve(dataDir)), path.resolve(os.tmpdir())); assert.ok(path.basename(dataDir).startsWith('qqa-live-logs166-'));
  globalThis.fetch = nativeFetch; dns.lookup = nativeLookup;
  fs.rmSync(dataDir, { recursive: true, force: true });
  assertOffline(); assert.deepEqual(kernel.loader.listEntries(), []);
}
