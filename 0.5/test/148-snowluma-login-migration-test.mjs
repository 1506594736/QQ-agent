// DSH10.3: real temporary files, fixed runtime identities, source remains read-only.
// All login files below are synthetic. No QQ/Node runtime is executed or contacted.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { migrateFrom04, detectMigrationSource } from '../src/kernel/migrator.js';
import { createKernel } from '../src/kernel/kernel.js';
import { installRuntime } from '../scripts/lib/runtime-installer.mjs';
import { RUNTIME_DOWNLOADS, RUNTIME_PROOF_FILE } from '../bundled/transport-onebot/runtime-lock.js';
import { eq, ok, section, summary, mktmp } from './helpers.mjs';

const root = mktmp('qqa-login148-'), log = {};
let number = 0;
const write = (file, value) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value)); };
const hash = dir => {
  if (!fs.existsSync(dir)) return {};
  const out = {};
  const walk = (current, relative = '') => { for (const item of fs.readdirSync(current, { withFileTypes: true })) {
    const file = path.join(current, item.name), name = path.join(relative, item.name);
    if (item.isSymbolicLink()) out[name] = `link:${fs.readlinkSync(file)}`;
    else if (item.isDirectory()) walk(file, name);
    else out[name] = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  } };
  walk(dir); return out;
};
function runtime(app, { qqVersion = '9.9.33-51802', snowBuild = '9.9.33-51802', snow = path.join(app, 'snowluma') } = {}) {
  write(path.join(app, 'runtime', 'qq-portable', 'QQ.exe'), 'QA_ONLY_NOT_EXECUTABLE');
  fs.mkdirSync(path.join(app, 'runtime', 'qq-portable', 'versions', qqVersion), { recursive: true });
  write(path.join(snow, 'index.mjs'), `const LIST_QQ_VERSION = "${snowBuild}"; const BUILD_VERSION_SHORT = "9.9.33";`);
  write(path.join(snow, 'node.exe'), 'QA_ONLY_NOT_EXECUTABLE');
  for (const ext of ['node', 'dll']) write(path.join(snow, 'native', `snowluma-win32-x64.${ext}`), 'QA148_ONLY_NOT_NATIVE');
  return snow;
}
function fixture(layout = 'sibling') {
  const base = path.join(root, `case-${++number}`), legacyApp = path.join(base, 'legacy'), appRoot = path.join(base, 'new');
  const source = path.join(legacyApp, 'data'), targetDataDir = path.join(appRoot, 'data');
  const programRoot = layout === 'embedded' ? source : layout === 'installed' ? path.join(legacyApp, 'resources', 'app') : legacyApp;
  const oldSnow = runtime(programRoot), newSnow = runtime(appRoot);
  write(path.join(source, 'config.json'), { api: { model: 'QA148' }, snowluma: { wsUrl: 'ws://127.0.0.1:3001', accessToken: 'QA148_ONLY_OLD_ONEBOT' }, persona: { botName: 'QA148' } });
  write(path.join(oldSnow, 'config', 'runtime.json'), { webuiPort: 5099, note: 'QA148_ONLY_SYNTHETIC_RUNTIME' });
  write(path.join(oldSnow, 'config', 'onebot_14801.json'), { networks: { accessToken: 'QA148_ONLY_SYNTHETIC_TOKEN' } });
  write(path.join(oldSnow, 'config', 'nested', 'account.fixture'), 'QA148_ONLY_SYNTHETIC_STATE');
  fs.mkdirSync(path.join(oldSnow, 'config', 'empty-template'));
  fs.mkdirSync(targetDataDir, { recursive: true });
  return { source, targetDataDir, appRoot, legacyApp, programRoot, oldSnow, newSnow };
}
const run = (f, opts = {}) => migrateFrom04({ source: f.source, targetDataDir: f.targetDataDir, appRoot: f.appRoot, log, ...opts });
const json = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const assertManual = (result, label) => { eq(result.sections.snowlumaLogin?.ok, false, `${label}: 不伪报成功`); eq(result.sections.snowlumaLogin?.loginCopied, false, `${label}: 没有复制成功`); eq(result.sections.snowlumaLogin?.status, 'manual', `${label}: 保持明确人工处理状态`); };
// A tiny complete stored ZIP exercises the actual installer/proof producer.
function syntheticZip(files) {
  const local = [], central = []; let offset = 0;
  for (const [name, value] of Object.entries(files)) {
    const filename = Buffer.from(name), bytes = Buffer.from(value); let crc = 0xffffffff;
    for (const byte of bytes) { crc ^= byte; for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); } crc = (crc ^ 0xffffffff) >>> 0;
    const header = Buffer.alloc(30); header.writeUInt32LE(0x04034b50); header.writeUInt16LE(20, 4); header.writeUInt32LE(crc, 14); header.writeUInt32LE(bytes.length, 18); header.writeUInt32LE(bytes.length, 22); header.writeUInt16LE(filename.length, 26);
    local.push(header, filename, bytes);
    const directory = Buffer.alloc(46); directory.writeUInt32LE(0x02014b50); directory.writeUInt16LE(0x0314, 4); directory.writeUInt16LE(20, 6); directory.writeUInt32LE(crc, 16); directory.writeUInt32LE(bytes.length, 20); directory.writeUInt32LE(bytes.length, 24); directory.writeUInt16LE(filename.length, 28); directory.writeUInt32LE(0x80000000, 38); directory.writeUInt32LE(offset, 42); central.push(directory, filename);
    offset += header.length + filename.length + bytes.length;
  }
  const entries = Buffer.concat(central), end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(Object.keys(files).length, 8); end.writeUInt16LE(Object.keys(files).length, 10); end.writeUInt32LE(entries.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, entries, end]);
}
async function defaultFixture() {
  const f = fixture(), archive = path.join(f.appRoot, 'synthetic-snow.zip'), bytes = syntheticZip({ 'index.mjs': 'const LIST_QQ_VERSION="9.9.33-51802";', 'node.exe': 'QA148_ONLY_NOT_EXECUTABLE', 'native/snowluma-win32-x64.node': 'QA148_ONLY_NOT_NATIVE', 'native/snowluma-win32-x64.dll': 'QA148_ONLY_NOT_NATIVE', 'config/runtime.json': '{"webuiPort":5099,"QA148_DEFAULT":true}', 'config/templates/default.json': '{"QA148_ENABLED":false}' });
  fs.writeFileSync(archive, bytes);
  await installRuntime({ appRoot: f.appRoot, kind: 'snowluma', spec: { ...RUNTIME_DOWNLOADS.snowluma, sha256: crypto.createHash('sha256').update(bytes).digest('hex'), origin: 'synthetic-test-only' }, archiveFile: archive, isRunning: () => false });
  return f;
}

section('三种可信旧布局的独立复制：同机双侧版本一致、配置真实绑定、源hash不变');
for (const layout of ['sibling', 'embedded', 'installed']) {
  const f = fixture(layout), before = hash(f.legacyApp), report = run(f);
  eq(report.sections.snowlumaLogin?.ok, true, `${layout} 已完成配置复制`);
  eq(report.sections.snowlumaLogin?.loginCopied, true, `${layout} 报告实际复制成功`);
  eq(report.sections.snowlumaLogin?.loginVerified, false, `${layout} 不把复制写成已登录实测`);
  eq(report.requiresAction, false, `${layout} 固定本地条件齐备无需假人工步骤`);
  eq(hash(path.join(f.newSnow, 'config')), hash(path.join(f.oldSnow, 'config')), `${layout} 配置逐字节完整复制`);
  ok(fs.existsSync(path.join(f.newSnow, 'config', 'empty-template')), `${layout} 源空目录也完整保留`);
  eq(json(path.join(f.targetDataDir, 'config.json')).snowluma.dir, f.newSnow, `${layout} 目标配置指向新runtime而非旧源`);
  eq(hash(f.legacyApp), before, `${layout} 旧安装只读`);
  ok(!JSON.stringify(report).includes('QA148_ONLY_SYNTHETIC_TOKEN'), `${layout} 报告不含登录令牌`);
}

section('dry-run只规划、两个目录都不写，不把预计复制标成loginCopied');
const preview = fixture(), previewBefore = hash(preview.appRoot), previewSource = hash(preview.legacyApp), planned = run(preview, { dryRun: true });
eq(planned.sections.snowlumaLogin?.status, 'planned', 'dry-run明确计划状态');
eq(planned.sections.snowlumaLogin?.loginCopied, false, 'dry-run未复制');
eq(planned.sections.snowlumaLogin?.ok, false, 'dry-run没有完成实际迁移');
eq(hash(preview.appRoot), previewBefore, 'dry-run目标业务和runtime都不写');
eq(hash(preview.legacyApp), previewSource, 'dry-run源只读');

section('缺失/未知/不一致的双侧版本、空登录目录，均保持manual且不复制');
for (const issue of ['old-qq-mismatch', 'new-qq-mismatch', 'old-qq-unknown', 'new-qq-unknown', 'old-snow-mismatch', 'new-snow-mismatch', 'empty-login']) {
  const f = fixture();
  if (issue.endsWith('qq-mismatch')) fs.renameSync(path.join(issue.startsWith('old') ? f.programRoot : f.appRoot, 'runtime', 'qq-portable', 'versions', '9.9.33-51802'), path.join(issue.startsWith('old') ? f.programRoot : f.appRoot, 'runtime', 'qq-portable', 'versions', '9.9.33-99999'));
  if (issue.endsWith('qq-unknown')) fs.renameSync(path.join(issue.startsWith('old') ? f.programRoot : f.appRoot, 'runtime', 'qq-portable', 'versions'), path.join(issue.startsWith('old') ? f.programRoot : f.appRoot, 'runtime', 'qq-portable', 'unknown-versions'));
  if (issue.endsWith('snow-mismatch')) write(path.join(issue.startsWith('old') ? f.oldSnow : f.newSnow, 'index.mjs'), 'const LIST_QQ_VERSION="9.9.33-99999";');
  if (issue === 'empty-login') fs.renameSync(path.join(f.oldSnow, 'config'), path.join(f.oldSnow, 'saved-synthetic-config'));
  const before = hash(f.legacyApp); assertManual(run(f), issue);
  ok(!fs.existsSync(path.join(f.newSnow, 'config')), `${issue}: 新runtime无假登录文件`);
  eq(hash(f.legacyApp), before, `${issue}: 源未变化`);
}

section('现有新profile/登录config不覆盖；相同或嵌套目标拒绝');
const existingLogin = fixture(); write(path.join(existingLogin.newSnow, 'config', 'new-profile.fixture'), 'QA148_KEEP_NEW_PROFILE');
const loginBefore = hash(existingLogin.newSnow); assertManual(run(existingLogin), '目标已有登录配置'); eq(hash(existingLogin.newSnow), loginBefore, '新profile原文件不改');
const occupied = fixture(); write(path.join(occupied.targetDataDir, 'config.json'), { persona: { botName: 'QA148_KEEP_TARGET' } });
const occupiedBefore = hash(occupied.appRoot), rejected = run(occupied); eq(rejected.ok, false, '直接调用不能绕过目标空闸'); eq(hash(occupied.appRoot), occupiedBefore, '拒绝后新目标逐字节保持');
const secondary = fixture(); assertManual(run(secondary, { profile: 2 }), 'secondary profile不能借共享runtime');
const same = fixture(), sameBefore = hash(same.legacyApp); const sameReport = migrateFrom04({ source: same.source, targetDataDir: same.source, appRoot: same.legacyApp, log });
eq(sameReport.ok, false, '同一路径拒绝'); eq(hash(same.legacyApp), sameBefore, '同一路径不会改旧源');
const nested = fixture(), nestedBefore = hash(nested.legacyApp); const nestedReport = migrateFrom04({ source: nested.source, targetDataDir: path.join(nested.source, 'nested-target'), appRoot: nested.appRoot, log });
eq(nestedReport.ok, false, '源内目标拒绝'); eq(hash(nested.legacyApp), nestedBefore, '源内目标没有落盘');

section('相对越界配置及符号链接拒绝，不读取或复制链接目标');
const escaped = fixture(); const config = json(path.join(escaped.source, 'config.json')); config.snowluma.dir = '../../outside'; write(path.join(escaped.source, 'config.json'), config); assertManual(run(escaped), '旧SnowLuma目录越界');
const linked = fixture(), outside = path.join(root, 'outside-synthetic'); fs.mkdirSync(outside, { recursive: true }); write(path.join(outside, 'private.fixture'), 'QA148_KEEP_OUTSIDE');
fs.symlinkSync(outside, path.join(linked.oldSnow, 'config', 'escape'), process.platform === 'win32' ? 'junction' : 'dir');
const outsideBefore = hash(outside); assertManual(run(linked), '登录配置中符号链接'); eq(hash(outside), outsideBefore, '链接外文件未变');
ok(!fs.existsSync(path.join(linked.newSnow, 'config')), '无部分链接目录复制');
eq(detectMigrationSource(occupied.targetDataDir, occupied.source).eligible, false, 'detect仍拒绝已有目标');

section('复制失败原子回收：不留下部分登录文件、不写loginCopied');
const failed = fixture(), failedSource = hash(failed.legacyApp), copy = fs.copyFileSync;
let result;
try { fs.copyFileSync = (from, to, ...rest) => { if (from.endsWith('account.fixture')) throw new Error('QA148_SYNTHETIC_COPY_DENIED'); return copy(from, to, ...rest); }; result = run(failed); }
finally { fs.copyFileSync = copy; }
eq(result.sections.snowlumaLogin?.ok, false, '复制失败不成功'); eq(result.sections.snowlumaLogin?.loginCopied, false, '复制失败无loginCopied');
ok(!fs.existsSync(path.join(failed.newSnow, 'config')), '原子失败无部分config');
eq(fs.readdirSync(failed.newSnow).filter(name => name.startsWith('.login-migration-')), [], '暂存目录已回收');
eq(hash(failed.legacyApp), failedSource, '失败也不回写旧源');

section('等长复制损坏与规划后版本变化不能伪成功，合法空config原子替换');
const corrupt = fixture(); let corrupted;
try { fs.copyFileSync = (from, to, ...rest) => { const result = copy(from, to, ...rest); if (from.endsWith('account.fixture')) fs.writeFileSync(to, Buffer.alloc(fs.statSync(to).size)); return result; }; corrupted = run(corrupt); }
finally { fs.copyFileSync = copy; }
eq(corrupted.sections.snowlumaLogin?.loginCopied, false, '等长损坏也未复制成功'); ok(!fs.existsSync(path.join(corrupt.newSnow, 'config')), '损坏副本无目标登录数据');
const changed = fixture(), rename = fs.renameSync; let changedReport;
try { fs.renameSync = (from, to) => { const value = rename(from, to); if (to === path.join(changed.targetDataDir, 'config.json')) write(path.join(changed.newSnow, 'index.mjs'), 'const LIST_QQ_VERSION="9.9.33-99999";'); return value; }; changedReport = run(changed); }
finally { fs.renameSync = rename; }
assertManual(changedReport, '规划后版本变化'); eq(changedReport.sections.snowlumaLogin?.versionVerified, false, '提交前fresh再核发现变化');
const emptyConfig = fixture(); fs.mkdirSync(path.join(emptyConfig.newSnow, 'config')); const emptyCopied = run(emptyConfig);
eq(emptyCopied.sections.snowlumaLogin?.loginCopied, true, '合法目标空config可完成原子复制');

section('目标祖先junction拒绝、显式无效源不落入其它安装、未知输入明确拒绝');
const alias = fixture(), aliasTarget = path.join(root, 'outside-new-profile'); fs.mkdirSync(aliasTarget);
fs.symlinkSync(aliasTarget, path.join(alias.appRoot, 'alias'), process.platform === 'win32' ? 'junction' : 'dir');
const aliasBefore = hash(aliasTarget); const aliasReport = run(alias, { targetDataDir: path.join(alias.appRoot, 'alias', 'data') });
eq(aliasReport.ok, false, '目标祖先链接拒绝'); eq(hash(aliasTarget), aliasBefore, '外侧新profile无写入');
eq(detectMigrationSource(path.join(root, 'unused'), path.join(root, 'does-not-exist')).eligible, false, '显式失效源不自动选择别人的源');
eq(migrateFrom04({}).ok, false, '缺输入明确拒绝');

section('真实kernel首启包含info日志/custom dataDir，传入appRoot并完成受控迁移');
const automatic = fixture(); automatic.targetDataDir = path.join(path.dirname(automatic.appRoot), 'custom-data');
const automaticBefore = hash(automatic.legacyApp);
for (const dir of ['bundled', 'plugins', 'skills', 'ui/shell']) fs.mkdirSync(path.join(automatic.appRoot, dir), { recursive: true });
write(path.join(automatic.appRoot, 'ui/shell/index.html'), '<!doctype html><title>QA148 synthetic migration</title>');
let started = 0, stopped = 0;
const kernel = createKernel({ appRoot: automatic.appRoot, env: { QQ_AGENT_DATA_DIR: automatic.targetDataDir, QQ_AGENT_PORT: '0', QQ_AGENT_MIGRATE_FROM: automatic.source }, headless: true,
  transport: { id: 'qa148-noop', actions: {}, start() { started++; }, stop() { stopped++; }, status: () => ({ connected: false, synthetic: true }) },
  fetchImpl: async () => { throw new Error('QA148_NO_NETWORK'); }, priceUpdates: { refresh: async () => ({ ok: true }), resolve: () => null } });
try { await kernel.start();
  const autoReport = json(path.join(automatic.targetDataDir, 'migration-report.json'));
  eq(autoReport.sections.snowlumaLogin?.loginCopied, true, '真实首启info日志不阻止空业务目标迁移');
  eq(json(path.join(automatic.targetDataDir, 'config.json')).snowluma.dir, automatic.newSnow, 'custom dataDir仍绑定已传入appRoot的新runtime');
  eq(started, 1, '只启动注入的noop transport');
  eq(hash(automatic.legacyApp), automaticBefore, '真实kernel迁移仍旧源只读');
} finally { await kernel.stop(); }
eq(stopped, 1, '真实kernel正常回收noop，不运行QQ程序');

section('实际installer生成完整默认模板证明后可独立迁移，原defaults留可恢复备份');
const defaults = await defaultFixture(), defaultsBefore = hash(path.join(defaults.newSnow, 'config')), defaultsSource = hash(defaults.legacyApp), defaultsReport = run(defaults).sections.snowlumaLogin;
eq(defaultsReport?.loginCopied, true, 'verified archive新安装默认模板可完成迁移');
eq(defaultsReport?.defaultsReplaced, true, '报告明确替换了经证明的未变默认模板');
eq(hash(path.join(defaults.newSnow, 'config')), hash(path.join(defaults.oldSnow, 'config')), '默认模板被完整旧登录副本原子替换');
ok(typeof defaultsReport?.defaultsBackup === 'string' && fs.existsSync(defaultsReport.defaultsBackup), '原始默认模板有独立可恢复备份');
if (defaultsReport?.defaultsBackup) eq(hash(defaultsReport.defaultsBackup), defaultsBefore, '默认模板备份逐字节保持');
eq(hash(defaults.legacyApp), defaultsSource, '默认模板分支仍然旧源只读');
eq(defaultsReport?.loginVerified, false, '默认模板分支也不把复制视为QQ已登录');
const previewDefaults = await defaultFixture(), previewDefaultsBefore = hash(previewDefaults.appRoot), previewDefaultsSource = hash(previewDefaults.legacyApp), previewDefaultsReport = run(previewDefaults, { dryRun: true }).sections.snowlumaLogin;
eq(previewDefaultsReport?.status, 'planned', '带证明defaults的dry-run可以规划');
eq(previewDefaultsReport?.loginCopied, false, 'defaults dry-run不伪报复制');
eq(hash(previewDefaults.appRoot), previewDefaultsBefore, 'defaults dry-run不动模板/配置/证明或生成backup');
eq(hash(previewDefaults.legacyApp), previewDefaultsSource, 'defaults dry-run旧源只读');

section('默认模板的文件/目录/证明任一变化都保留manual，不覆盖新profile');
for (const issue of ['modified', 'extra-file', 'extra-directory', 'missing-file', 'no-proof', 'local-proof', 'invalid-proof']) {
  const f = await defaultFixture(), targetConfig = path.join(f.newSnow, 'config'), proofFile = path.join(f.newSnow, RUNTIME_PROOF_FILE);
  if (issue === 'modified') write(path.join(targetConfig, 'runtime.json'), '{"QA148_NEW_LOGIN":true}');
  if (issue === 'extra-file') write(path.join(targetConfig, 'onebot_14802.json'), 'QA148_NEW_PROFILE');
  if (issue === 'extra-directory') fs.mkdirSync(path.join(targetConfig, 'empty-account'));
  if (issue === 'missing-file') fs.unlinkSync(path.join(targetConfig, 'templates', 'default.json'));
  if (issue === 'no-proof') fs.unlinkSync(proofFile);
  if (issue === 'local-proof') { const proof = json(proofFile); proof.source.type = 'explicit-local-copy'; write(proofFile, proof); }
  if (issue === 'invalid-proof') write(path.join(f.newSnow, 'node.exe'), 'QA148_CHANGED_PROGRAM');
  const before = hash(f.newSnow); assertManual(run(f), issue); eq(hash(f.newSnow), before, `${issue}: 原target含登录态完整保留`);
}

section('默认模板在规划后变化则取消；提交失败恢复原defaults并回收stage');
const modifiedDefaults = await defaultFixture(); let modifiedDefaultsReport;
try { fs.copyFileSync = (from, to, ...rest) => { const value = copy(from, to, ...rest); if (from.endsWith('account.fixture')) write(path.join(modifiedDefaults.newSnow, 'config', 'new-account.fixture'), 'QA148_NEW_AFTER_PLAN'); return value; }; modifiedDefaultsReport = run(modifiedDefaults); }
finally { fs.copyFileSync = copy; }
eq(modifiedDefaultsReport.sections.snowlumaLogin?.loginCopied, false, '复制中出现新profile，提交前重比对取消');
const afterPlanAccount = path.join(modifiedDefaults.newSnow, 'config', 'new-account.fixture');
eq(fs.existsSync(afterPlanAccount) ? fs.readFileSync(afterPlanAccount, 'utf8') : null, 'QA148_NEW_AFTER_PLAN', '规划后新增profile完整保留');
const rollbackDefaults = await defaultFixture(), rollbackBefore = hash(path.join(rollbackDefaults.newSnow, 'config')), rollbackSource = hash(rollbackDefaults.legacyApp); let rollbackReport;
try { fs.renameSync = (from, to) => { if (path.basename(from).startsWith('.login-migration-') && to === path.join(rollbackDefaults.newSnow, 'config')) throw new Error('QA148_DEFAULT_COMMIT_FAILURE'); return rename(from, to); }; rollbackReport = run(rollbackDefaults); }
finally { fs.renameSync = rename; }
eq(rollbackReport.sections.snowlumaLogin?.loginCopied, false, '默认模板提交失败不伪报成功');
eq(hash(path.join(rollbackDefaults.newSnow, 'config')), rollbackBefore, '失败恢复原默认模板逐字节一致');
eq(fs.readdirSync(rollbackDefaults.newSnow).filter(name => name.startsWith('.login-migration-') || name.startsWith('.login-defaults-')), [], '恢复成功后无暂存/备份残留');
eq(hash(rollbackDefaults.legacyApp), rollbackSource, '回滚不改旧源');
summary('148-snowluma-login-migration');
