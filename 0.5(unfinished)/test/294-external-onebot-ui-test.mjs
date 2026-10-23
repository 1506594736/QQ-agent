// Static contract for an external, user-managed OneBot service.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = name => fs.readFileSync(new URL(`../ui/${name}`, import.meta.url), 'utf8');
const manifest = JSON.parse(read('panels/manifest.json'));

test('default navigation contains only supported application panels', () => {
  assert.deepEqual(manifest.panels.map(panel => panel.id), ['sessions','chats','memory','usage','skills','plugins','logs','settings','community']);
  for (const panel of manifest.panels) {
    assert.ok(fs.existsSync(new URL(`../ui/panels/${panel.id}/index.html`, import.meta.url)));
    assert.ok(panel.api.every(api => !/\/(?:launch|stop|open-webui)$/.test(api.path)));
  }
  const settings = manifest.panels.find(panel => panel.id === 'settings');
  assert.ok(settings.navigation.sections.includes('onebot'));
});

test('settings expose only explicit protocol endpoints and credentials', () => {
  const settings = read('panels/settings/panel.js');
  const paths = [...settings.matchAll(/(?:field|secretField)\(link, '([^']+)'/g)].map(match => match[1]);
  assert.deepEqual(paths, ['onebot.wsUrl','onebot.httpUrl','onebot.accessToken','onebot.httpAccessToken']);
  assert.match(settings, /协议端由你独立安装、启动和管理/);
  assert.match(settings, /\['models','access','onebot'\]\.includes\(payload\?\.section\)/);
});

test('shell readiness directs users to model and external protocol settings', () => {
  const shell = read('shell/index.html'), app = read('shell/app.js');
  assert.deepEqual([...shell.matchAll(/data-readiness="([^"]+)"/g)].map(match => match[1]), ['onebot','model']);
  assert.match(app, /open\('settings',\{section:id==='model'\?'models':'onebot'\}\)/);
  assert.match(read('shell/panel-registry.js'), /\['models','access','onebot'\]\.includes\(section\)/);
});
