#!/usr/bin/env node
// Explicit user-triggered setup. Importing this module does not install anything.
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { checkRuntime, installRuntime } from './lib/runtime-installer.mjs';
import { RUNTIME_DOWNLOADS } from '../bundled/transport-onebot/runtime-lock.js';

export async function runSetup(args = [], { appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), env = process.env, log = console.log } = {}) {
  const valued = new Set(['--qq-archive', '--snowluma-archive', '--from']), flags = new Set(['--help', '--check', '--force', '--skip-qq', '--skip-snowluma', '--run-installer']);
  for (let index = 0; index < args.length; index++) { if (valued.has(args[index])) { if (!args[index + 1] || args[index + 1].startsWith('--')) throw new Error(`${args[index]} 缺少参数`); index++; } else if (!flags.has(args[index])) throw new Error(`未知 setup 参数：${args[index]}`); }
  const option = name => { const index = args.indexOf(name); if (index < 0) return undefined; const value = args[index + 1]; if (!value || value.startsWith('--')) throw new Error(`${name} 缺少参数`); return value; };
  if (args.includes('--help')) { log('node scripts/setup.mjs [--check] [--force] [--skip-qq] [--skip-snowluma] [--qq-archive <ZIP>] [--snowluma-archive <ZIP>] [--from <已安装QQ目录>]'); return { ok: true }; }
  if (args.includes('--run-installer')) throw new Error('不会自动执行 QQ HummerSetup 安装器；请手工安装并使用 --from 指定经核对的 QQ 9.9.33.51802 程序目录。');
  if (args.includes('--check')) { const state = checkRuntime(appRoot); log(JSON.stringify(state, null, 2)); return { ok: state.ready, ...state }; }
  const results = [];
  for (const kind of ['snowluma', 'qq']) {
    if (args.includes(`--skip-${kind}`)) continue;
    const original = RUNTIME_DOWNLOADS[kind], prefix = kind === 'qq' ? 'QQ_PORTABLE' : 'SNOWLUMA';
    if (env[`${prefix}_VERSION`] && env[`${prefix}_VERSION`] !== original.version) throw new Error('版本覆盖不符合运行版本锁；请先审查并更新版本锁清单。');
    if (kind === 'snowluma' && env.SNOWLUMA_REPO && env.SNOWLUMA_REPO !== 'SnowLuma/SnowLuma' && (!env.SNOWLUMA_URL || !env.SNOWLUMA_SHA256)) throw new Error('替换 SnowLuma 仓库需提供明确 SNOWLUMA_URL 与 SNOWLUMA_SHA256；不会自动拼接未知源。');
    const changedSource = env[`${prefix}_URL`] && env[`${prefix}_URL`] !== original.url;
    if (changedSource && !env[`${prefix}_SHA256`]) throw new Error('更改安装源后必须显式提供可信 SHA256；不会沿用旧包散列。');
    const spec = { ...original, url: env[`${prefix}_URL`] || original.url, sha256: env[`${prefix}_SHA256`] ?? (changedSource ? '' : original.sha256) };
    const result = await installRuntime({ appRoot, kind, spec, archiveFile: option(kind === 'qq' ? '--qq-archive' : '--snowluma-archive'), fromDir: kind === 'qq' ? option('--from') : undefined, force: args.includes('--force') });
    results.push(result); log(`${kind}：${result.skipped ? '已校验，跳过' : `安装完成 ${result.version}`}${result.archiveVerified === false ? '（本地复制，未经发布包散列认证）' : ''}${result.note?`；${result.note}`:''}`);
  }
  return { ok: true, results };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try { const result = await runSetup(process.argv.slice(2)); if (!result.ok) process.exitCode = 1; }
  catch (error) { console.error(`[setup] ${error.message}`); process.exitCode = 1; }
}
