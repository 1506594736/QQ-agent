// Verify a Preview build without reading or copying user SnowLuma/QQ credentials.
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const appRoot = process.argv[2] ? path.resolve(process.argv[2]) : path.join(root, 'dist', 'win-unpacked', 'resources', 'app');
const required = ['electron', 'src', 'ui', 'bundled', 'package.json'];
const missing = required.filter((name) => !fs.existsSync(path.join(appRoot, name)));
const external = {
  snowluma: fs.existsSync(path.join(appRoot, 'snowluma')),
  qqPortable: fs.existsSync(path.join(appRoot, 'runtime', 'qq-portable', 'QQ.exe')),
};
console.log(JSON.stringify({ appRoot, required, missing, external }, null, 2));
if (missing.length > 0) process.exitCode = 1;
if (!external.snowluma || !external.qqPortable) {
  console.warn('外部运行时未随 Preview 分发：需在设置中配置 SnowLuma 目录/便携 QQ 目录后才能启用对应功能。');
}
