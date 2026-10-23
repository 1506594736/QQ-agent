// 控制台主题引擎（shell 与所有面板共享）
// ---------------------------------------------------------------------------
// 为什么单独一个文件：面板运行在 iframe 里，与 shell 是不同文档，
// 但两边都通过 /panels/ 加载同一份 JS，主题逻辑只写一遍。
//
// ⚠️ 关键约束（踩过的坑）：面板 iframe 是 sandbox='allow-scripts'（无 allow-same-origin）
// → opaque origin，读不到宿主存储，shell 也拿不到它的 contentDocument。
// 所以分发只能走：config.json（真源）→ shell 应用 → RPC/事件推给 iframe。
//
// 方案模型（用户定稿）：
//   亮色基准 / 暗色基准 = 出厂默认项，不可被"覆盖式保存"污染，随时能回到；
//   在任一基准上改动了任何一项 → 进入"已修改态"（仍属于该基准的编辑中状态）；
//   把编辑中的方案"另存为" → 得到一个**独立于亮/暗基准之外**的自定义方案（可多个）。
//   自定义方案是完整方案：配色 + 圆角 + 密度 + 侧栏 + 按钮排布 + 背景。
//
// 契约不变：只写 CSS 变量与少量布局 data 属性，不新增组件样式。

const KEY = 'qq-agent.theme.v1';

const colorTransitionGates = new WeakMap();
const COLOR_DURATION = '--theme-color-duration';

/** Hold only color transitions for one render; never animate or obscure the document. */
export function holdThemeColorTransitions(doc) {
  const view = doc?.defaultView, style = doc?.documentElement?.style;
  if (!view?.requestAnimationFrame || !style?.getPropertyValue || !style?.removeProperty) return;
  const media = view.matchMedia?.('(prefers-reduced-motion: reduce)');
  if (doc.visibilityState === 'hidden' || media?.matches) { colorTransitionGates.get(doc)?.finish(); return; }
  let gate = colorTransitionGates.get(doc);
  if (!gate) {
    const previous = style.getPropertyValue(COLOR_DURATION), priority = style.getPropertyPriority(COLOR_DURATION);
    gate = { frame: 0 };
    gate.finish = () => {
      view.cancelAnimationFrame(gate.frame);
      if (previous) style.setProperty(COLOR_DURATION, previous, priority);
      else style.removeProperty(COLOR_DURATION);
      doc.removeEventListener('visibilitychange', visibility);
      view.removeEventListener('pagehide', gate.finish);
      media?.removeEventListener?.('change', preference);
      colorTransitionGates.delete(doc);
    };
    const visibility = () => { if (doc.visibilityState === 'hidden') gate.finish(); };
    const preference = () => { if (media.matches) gate.finish(); };
    doc.addEventListener('visibilitychange', visibility);
    view.addEventListener('pagehide', gate.finish, { once: true });
    media?.addEventListener?.('change', preference);
    colorTransitionGates.set(doc, gate);
  }
  view.cancelAnimationFrame(gate.frame);
  style.setProperty(COLOR_DURATION, '0ms');
  gate.frame = view.requestAnimationFrame(() => {
    gate.frame = view.requestAnimationFrame(gate.finish);
  });
}

/** 间距基准（4 的倍数），密度倍率在其上缩放。 */
const SPACING = { 1: 4, 2: 8, 3: 12, 4: 16, 5: 20, 6: 24, 8: 32 };

/** 项目亮色基准：骨白底色、深橄榄绿强调与浅灰分区。 */
export const LIGHT_BASE = {
  bg: '#e4e6de', surface: '#eeefea', surface2: '#f7f8f3', surface3: '#dcdfd2',
  text: '#242620', muted: '#5c6156', faint: '#8f9585',
  accent: '#838d1f', accent2: '#6d7719', gradient: false,
  line: '#00000026', lineSoft: '#00000012',
  good: '#2f7d4f', warn: '#8a6a12', bad: '#b0472f',
  accentInk: '#101408',
  bgImage: '', bgOpacity: 0.08, bgBlur: 0, bgFit: 'cover',
  bgRotate: 0, bgZoom: 1, bgOffsetX: 0, bgOffsetY: 0,
};

/**
 * 项目暗色基准：暖黑底色、骨白文字与荧光黄绿强调。
 * 相邻灰阶区分内容层级，状态使用独立的成功、提醒和错误色。
 */
export const DARK_BASE = {
  bg: '#191a19', surface: '#202120', surface2: '#282927', surface3: '#312f30',
  text: '#eeefea', muted: '#a7aba3', faint: '#6b715f',
  accent: '#d6e452', accent2: '#c6ca4c', gradient: false,
  line: '#ffffff26', lineSoft: '#ffffff12',
  good: '#5cb87f', warn: '#e3a63f', bad: '#dd6f60',
  accentInk: '#1b1e15',
  bgImage: '', bgOpacity: 0.12, bgBlur: 0, bgFit: 'cover',
  bgRotate: 0, bgZoom: 1, bgOffsetX: 0, bgOffsetY: 0,
};

/** 外观模式白名单；保留既有配置标识，配色由颜色令牌控制。 */
export const STYLE_MODES = new Set(['endfield', 'classic', 'signal', 'flux']);

/** 成型风格预设：只作为配色起点（套用后仍需"另存为"才成为自定义方案）。 */
export const PRESETS = {
  endfield: {
    label: '暖黑黄绿',
    note: '荧光黄绿 + 暖黑 · 出厂默认',
    tokens: {
      bg: '#191a19', surface: '#202120', surface2: '#282927', surface3: '#312f30',
      text: '#eeefea', muted: '#a7aba3', faint: '#6b715f',
      accent: '#d6e452', accent2: '#c6ca4c', gradient: false,
      line: '#ffffff26', lineSoft: '#ffffff12',
      good: '#5cb87f', warn: '#e3a63f', bad: '#dd6f60',
      accentInk: '#1b1e15',
      styleMode: 'endfield',
    },
  },
  dark: {
    label: '0.4 暗色（经典）',
    note: '0.4 原版 · 靛蓝',
    tokens: {
      bg: '#0d0f12', surface: '#14161b', surface2: '#1b1e24', surface3: '#252a34',
      text: '#e3e6ef', muted: '#9aa3b8', faint: '#646b7a',
      accent: '#4f82e8', accent2: '#4f82e8', gradient: false,
      line: '#232730', lineSoft: '#191c22',
      good: '#4aaf77', warn: '#dd9f3f', bad: '#d67a7f',
      accentInk: '#ffffff',
    },
  },
  light: {
    label: '0.4 亮色（经典）',
    note: '0.4 原版浅色',
    tokens: {
      bg: '#eceef2', surface: '#f7f8fa', surface2: '#ffffff', surface3: '#ffffff',
      text: '#1b1e27', muted: '#5a6474', faint: '#8993a5',
      accent: '#3a62cd', accent2: '#3a62cd', gradient: false,
      line: '#d9ddeb', lineSoft: '#c8cede',
      good: '#2f9966', warn: '#b27d0e', bad: '#c2575e',
      accentInk: '#ffffff',
    },
  },
  cursor: {
    label: 'Cursor',
    note: '靛蓝→紫渐变，AI 编辑器感',
    tokens: {
      bg: '#0c0c0c', surface: '#181818', surface2: '#242424', surface3: '#2e2e2e',
      text: '#ffffff', muted: '#9ca3af', faint: '#6b7280',
      accent: '#6366f1', accent2: '#8b5cf6', gradient: true,
      line: '#262626', lineSoft: '#1f1f1f',
      accentInk: '#ffffff',
    },
  },
  supabase: {
    label: 'Supabase',
    note: '翠绿强调，代码优先',
    tokens: {
      bg: '#1c1c1c', surface: '#232323', surface2: '#2a2a2a', surface3: '#333333',
      text: '#ffffff', muted: '#9ca3af', faint: '#6b7280',
      accent: '#3ecf8e', accent2: '#3ecf8e', gradient: false,
      line: '#2f2f2f', lineSoft: '#262626',
      accentInk: '#06231a',
    },
  },
  linear: {
    label: 'Linear',
    note: '靛紫，克制精致',
    tokens: {
      bg: '#0e0e10', surface: '#1a1a1e', surface2: '#232329', surface3: '#2c2c33',
      text: '#ffffff', muted: '#9ca3af', faint: '#6b7280',
      accent: '#5e6ad2', accent2: '#5e6ad2', gradient: false,
      line: '#26262b', lineSoft: '#1f1f24',
      accentInk: '#ffffff',
    },
  },
  raycast: {
    label: 'Raycast',
    note: '橙渐变，命令面板感',
    tokens: {
      bg: '#0d0d0d', surface: '#1a1a1a', surface2: '#242424', surface3: '#2e2e2e',
      text: '#ffffff', muted: '#9ca3af', faint: '#6b7280',
      accent: '#ff5c00', accent2: '#ff9500', gradient: true,
      line: '#2a2a2a', lineSoft: '#202020',
      accentInk: '#ffffff',
    },
  },
  // 实验视觉语言：不只是配色，同时把 styleMode 切到 flux（玻璃/荧光/渐变描边那套）。
  // 只影响观感，不改变任何功能路径；不满意切回「信号仪表」即可。
  flux: {
    label: '实验 · Flux',
    note: '荧光渐变 + 玻璃质感（实验性视觉语言）',
    tokens: {
      bg: '#0b0713', surface: '#150c22', surface2: '#1e1233', surface3: '#291846',
      text: '#f6efff', muted: '#ab97cd', faint: '#7d6aa0',
      accent: '#b6ff3c', accent2: '#ff4fd8', gradient: true,
      line: '#3a2358', lineSoft: '#271740',
      good: '#5df2c2', warn: '#ffd166', bad: '#ff5d8f',
      accentInk: '#101a08',
      styleMode: 'flux',
    },
  },
};

/** 出厂默认值（预设未覆盖时的兜底）。 */
export const DEFAULT_THEME = {
  preset: 'dark',
  ...DARK_BASE,
  // 圆角基准（px）：6 推导出 sm 4 / md 6 / lg 8。
  // 默认使用小圆角，切角主按钮另走 clip-path；尺寸由配置决定。
  // --r-*，组件库的「圆角基准」滑条才能一直生效。
  radius: 6,
  density: 1,       // 间距倍率：0.85 紧凑 / 1 标准 / 1.25 宽松
  sidebar: 'left',  // left | right | hidden
  btnAlign: 'left', // left | center | right
  // 出厂默认外观模式；沿用既有存储标识以兼容已保存的主题。
  //            classic = 0.4 经典 | signal = 0.5 信号仪表 | flux = 实验（前卫玻璃/荧光）
  styleMode: 'endfield',
};

/** 参与方案的配色/背景键。 */
const SCHEMA_KEYS = ['bg', 'surface', 'surface2', 'surface3', 'text', 'muted', 'faint', 'accent', 'accent2', 'good', 'warn', 'bad', 'line', 'lineSoft', 'accentInk', 'bgImage', 'bgOpacity', 'bgBlur', 'bgFit', 'bgRotate', 'bgZoom', 'bgOffsetX', 'bgOffsetY'];
/** 形状/布局键（也属于一套完整方案）。 */
const LAYOUT_KEYS = ['radius', 'density', 'sidebar', 'btnAlign', 'styleMode'];

/** bgZoom is the width of a 16:9 selection in the original 16:9 image plane. */
export function normalizeBackgroundCrop(input = {}) {
  const zoom = Number(input.bgZoom);
  const scale = Number.isFinite(zoom) && zoom > 0 ? Math.min(1, Math.max(0.2, zoom)) : 1;
  const limit = (1 - scale) * 50;
  const offset = (value) => Number.isFinite(Number(value)) ? Math.min(limit, Math.max(-limit, Number(value))) : 0;
  const angle = Number(input.bgRotate);
  return { scale, offsetX: offset(input.bgOffsetX), offsetY: offset(input.bgOffsetY),
    rotate: Number.isFinite(angle) ? ((angle % 360) + 360) % 360 : 0 };
}

/** Shared paint in the logical 16:9 plane; tile width scales with that plane. */
export function backgroundPaint(fit) {
  if (fit === 'repeat') return { size: '50% auto', repeat: 'repeat', position: '0% 0%' };
  return { size: fit === 'contain' ? 'contain' : 'cover', repeat: 'no-repeat', position: '50% 50%' };
}

/** 合并出厂默认 + 用户覆盖，保证缺字段也有值。 */
export function normalizeTheme(input) {
  const t = { ...DEFAULT_THEME, ...(input ?? {}) };
  if (t.gradient === undefined || t.gradient === null) t.gradient = false;
  return t;
}

/** 从"方案对象"里抽出完整方案（配色+背景+布局），缺失回落给定基准。 */
export function normalizeScheme(input, base = DEFAULT_THEME) {
  const out = { ...base };
  for (const k of [...SCHEMA_KEYS, ...LAYOUT_KEYS, 'gradient']) {
    const v = input?.[k];
    if (v !== undefined && v !== null && v !== '') out[k] = v;
  }
  if (typeof input?.gradient === 'boolean') out.gradient = input.gradient;
  return out;
}

/* ---------------------------------------------------------------- 方案存储 */

/**
 * 旧结构（扁平 ui.uikit.*）→ 新结构（mode + light/dark/custom）。
 * 老配置里那套配色一律归到"暗色基准的编辑态"，用户的既有外观不丢。
 */
export function migrateUikit(raw) {
  const u = raw && typeof raw === 'object' ? raw : {};
  // custom 用「id → 方案」的映射而不是数组：设置表单的路径是 ui.uikit.custom.<id>.tokens.bg，
  // 数组下标路径在 form 的 setPath 里会退化成对象，导致结构损坏。
  const asMap = (v) => {
    if (Array.isArray(v)) return Object.fromEntries(v.filter(Boolean).map((c) => [c.id, { name: c.name, tokens: c.tokens }]));
    if (v && typeof v === 'object' && !Array.isArray(v)) return v;
    return {};
  };
  // 旧扁平键（配色/背景/布局）先捞出来：只认方案词汇表内的键，
  // 下游 normalizeScheme 也只读这些，过滤后写回更干净。
  const flat = {};
  for (const k of [...SCHEMA_KEYS, ...LAYOUT_KEYS]) if (u[k] !== undefined) flat[k] = u[k];
  if (typeof u.gradient === 'boolean') flat.gradient = u.gradient;
  const hasAppearance = Object.keys(flat).length > 0;
  // mode 存在即视为新结构（哪怕还没有任何颜色编辑）——否则 {mode:'light'}
  // 会被误判成旧扁平结构，mode 被强制回 'dark'，亮色预设永远选不中。
  if (u.mode !== undefined || u.custom || u.light || u.dark) {
    // ⚠️ 新结构字段与旧扁平键可以并存：旧配置首次编辑只 POST 子路径（ui.uikit.dark.x），
    // 服务端深合并后就是「旧根键 + 新 dark 子键」的中间态。这里必须把旧键折叠进
    // 暗色编辑态（低优先级，新结构值覆盖），否则遗留配色会被静默丢弃、
    // 界面当场回落默认（实测：改一次强调色后旧底色全丢）。
    // 语义与下方纯扁平分支一致：老外观一律归到暗色基准的编辑态。
    const mergedDark = u.dark && typeof u.dark === 'object' ? { ...flat, ...u.dark } : (hasAppearance ? flat : null);
    return {
      mode: typeof u.mode === 'string' ? u.mode : 'dark',
      light: u.light && typeof u.light === 'object' ? u.light : null,
      dark: mergedDark,
      custom: asMap(u.custom),
    };
  }
  // 扁平旧结构：整块当作暗色编辑态
  return { mode: 'dark', light: null, dark: hasAppearance ? flat : null, custom: {} };
}

/** 按 mode 取出当前生效的方案（含布局与背景）。 */
export function resolveScheme(uikit) {
  const store = migrateUikit(uikit);
  // 注意顺序：DEFAULT_THEME 里带着暗色值，必须让基准在后覆盖它，
  // 否则亮色方案会被 DEFAULT_THEME 的暗色 bg 顶掉（写成 {...LIGHT_BASE, ...DEFAULT_THEME} 就是 bug）。
  const darkFallback = { ...DEFAULT_THEME, ...DARK_BASE, preset: 'dark' };
  const lightFallback = { ...DEFAULT_THEME, ...LIGHT_BASE, preset: 'light' };
  if (store.mode === 'light') return normalizeScheme(store.light, lightFallback);
  if (store.mode === 'dark') return normalizeScheme(store.dark, darkFallback);
  if (store.mode.startsWith('custom:')) {
    const id = store.mode.slice(7);
    const found = store.custom[id];
    if (found) return normalizeScheme(found.tokens, darkFallback);
  }
  return normalizeScheme(null, darkFallback);
}

/** 生成一个自定义方案 id。 */
export function newSchemeId() {
  return `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/** 把当前编辑态另存为独立自定义方案（与亮/暗基准互不干扰）。 */
export function saveCustom(uikit, name, scheme) {
  const store = migrateUikit(uikit);
  const id = newSchemeId();
  const entry = { name: String(name || '未命名方案').slice(0, 40), tokens: normalizeScheme(scheme) };
  store.custom = { ...store.custom, [id]: entry };
  store.mode = `custom:${id}`;
  return { store, entry, id };
}

/** 删除自定义方案；若正在使用则回落到暗色基准。 */
export function deleteCustom(uikit, id) {
  const store = migrateUikit(uikit);
  const next = { ...store.custom };
  delete next[id];
  store.custom = next;
  if (store.mode === `custom:${id}`) store.mode = 'dark';
  return store;
}

/** 重命名自定义方案。 */
export function renameCustom(uikit, id, name) {
  const store = migrateUikit(uikit);
  const hit = store.custom[id];
  if (!hit) return store;
  store.custom = { ...store.custom, [id]: { ...hit, name: String(name || hit.name).slice(0, 40) } };
  return store;
}

/** 把某个基准（light/dark）的编辑态写回存储。 */
export function putSlot(uikit, slot, scheme) {
  const store = migrateUikit(uikit);
  if (slot === 'light' || slot === 'dark') store[slot] = normalizeScheme(scheme);
  store.mode = slot;
  return store;
}

/** 清掉某个基准的编辑态（恢复出厂）。 */
export function resetSlot(uikit, slot) {
  const store = migrateUikit(uikit);
  if (slot === 'light' || slot === 'dark') store[slot] = null;
  store.mode = slot;
  return store;
}

/* ------------------------------------------------------------------ 应用 */

/**
 * 背景图地址消毒：只允许 http(s) 绝对地址或站内 /api/ 路径，
 * 且不含引号/分号/反斜杠/括号等能跳出 CSS 值的字符（防 CSS 注入）。
 * 另：把历史遗留的 /api/uikit/background/xxx 迁移到静态别名 /ui/backgrounds/xxx
 * —— <img> 无法带 token 头，走 API 会401 裂图（详见 routes.js 上传路由注释）。
 */
export function safeBgUrl(raw) {
  const v = String(raw ?? '').trim();
  if (!v) return '';
  if (/["'\\;()<>[\]{}]/.test(v)) return '';
  if (/^\/api\/uikit\/background\/[A-Za-z0-9._-]+$/.test(v)) {
    return v.replace('/api/uikit/background/', '/ui/backgrounds/');
  }
  if (/^\/ui\/backgrounds\/[A-Za-z0-9._-]+$/.test(v)) return v;
  if (/^(https?:\/\/|\/api\/)/i.test(v)) return v;
  return '';
}

/** Keep a chosen accent label when readable; otherwise derive ink for the paint only. */
export function readableAccentInk(accent, preferred, accent2 = accent) {
  const luminance = value => {
    let hex = String(value ?? '').replace(/^#/, '');
    if (/^[0-9a-f]{3}$/i.test(hex)) hex = [...hex].map(char => char + char).join('');
    if (!/^[0-9a-f]{6}(?:[0-9a-f]{2})?$/i.test(hex)) return null;
    const rgb = [0, 2, 4].map(at => parseInt(hex.slice(at, at + 2), 16) / 255)
      .map(channel => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
    return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
  };
  const backgrounds = [luminance(accent), luminance(accent2)].filter(value => value !== null);
  if (!backgrounds.length) return preferred || DEFAULT_THEME.accentInk;
  const score = value => {
    const ink = luminance(value);
    if (ink === null) return 0;
    return Math.min(...backgrounds.map(background => (Math.max(ink, background) + 0.05) / (Math.min(ink, background) + 0.05)));
  };
  if (score(preferred) >= 4.5) return preferred;
  return score('#000000') >= score('#ffffff') ? '#000000' : '#ffffff';
}

/** Explicit paint DTO for an untrusted iframe. Never forward a full config/theme object. */
export function publicPanelTheme(input) {
  const theme = normalizeTheme(input), out = {};
  const colors = ['bg', 'surface', 'surface2', 'surface3', 'text', 'muted', 'faint', 'accent', 'accent2', 'line', 'lineSoft', 'good', 'warn', 'bad', 'accentInk'];
  const hexColor = /^#(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/i;
  for (const key of colors) out[key] = typeof theme[key] === 'string' && hexColor.test(theme[key]) ? theme[key] : DEFAULT_THEME[key];
  const bounded = (value, fallback, min, max) => Number.isFinite(Number(value)) ? Math.min(max, Math.max(min, Number(value))) : fallback;
  out.radius = bounded(theme.radius, DEFAULT_THEME.radius, 0, 16);
  out.density = bounded(theme.density, DEFAULT_THEME.density, 0.7, 1.4);
  out.sidebar = ['left', 'right', 'hidden'].includes(theme.sidebar) ? theme.sidebar : DEFAULT_THEME.sidebar;
  out.btnAlign = ['left', 'center', 'right'].includes(theme.btnAlign) ? theme.btnAlign : DEFAULT_THEME.btnAlign;
  out.styleMode = STYLE_MODES.has(theme.styleMode) ? theme.styleMode : DEFAULT_THEME.styleMode;
  out.gradient = theme.gradient === true;
  out.preset = Object.hasOwn(PRESETS, theme.preset) ? theme.preset : DEFAULT_THEME.preset;
  return out;
}

/**
 * 把主题写进 CSS 变量与布局属性。
 * 无 DOM 时（Node 侧 import 本模块做纯逻辑使用）只更新内存态、跳过样式写入——
 * 必须这样：panel-registry.js 会被 Node 测试 import，链式加载本模块时不能崩。
 */
export function applyTheme(t) {
  const theme = normalizeTheme(t);
  const s = typeof document !== 'undefined' ? document.documentElement?.style : null;
  if (!s) return theme;
  holdThemeColorTransitions(document);

  const light = theme.preset === 'light' || (() => {
    const hex = String(theme.bg ?? '').replace(/^#/, '');
    if (!/^[0-9a-f]{6}$/i.test(hex)) return false;
    const rgb = [0, 2, 4].map((at) => parseInt(hex.slice(at, at + 2), 16) / 255);
    return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722 > 0.55;
  })();
  s.setProperty('--overlay', theme.bg);
  s.setProperty('--line-strong', `color-mix(in srgb, ${theme.line} 70%, ${theme.text})`);
  s.setProperty('--focus', theme.accent);
  s.setProperty('--bevel', 'none');
  s.setProperty('--press', 'none');

  s.setProperty('--bg', theme.bg);
  s.setProperty('--surface', theme.surface);
  s.setProperty('--surface-2', theme.surface2);
  s.setProperty('--surface-3', theme.surface3);
  s.setProperty('--text', theme.text);
  s.setProperty('--muted', theme.muted);
  s.setProperty('--faint', theme.faint);
  s.setProperty('--accent', theme.accent);
  s.setProperty('--accent-2', theme.accent2);
  s.setProperty('--good', theme.good);
  s.setProperty('--warn', theme.warn);
  s.setProperty('--bad', theme.bad);
  s.setProperty('--line', theme.line);
  s.setProperty('--line-soft', theme.lineSoft);

  // shell 与 panels 历史上是两套变量名（同名但有个别名差异）。
  // 这里把别名一并写掉，一套 token 覆盖两边，避免"面板换了皮肤、外壳没换"。
  s.setProperty('--canvas', theme.bg);
  s.setProperty('--rail', theme.rail ?? theme.bg);        // 侧栏：与主背景同色，靠描边区分
  s.setProperty('--surface-raised', theme.surface3);
  s.setProperty('--ink', theme.text);
  s.setProperty('--accent-ink', readableAccentInk(theme.accent, theme.accentInk, theme.gradient ? theme.accent2 : theme.accent));
  s.setProperty('--danger', theme.bad);
  s.setProperty('--cyan', theme.accent);

  // 圆角：由基准推导一族，保持组件间比例
  const rawRadius = Number(theme.radius);
  const r = Number.isFinite(rawRadius) ? Math.max(0, Math.min(16, rawRadius)) : DEFAULT_THEME.radius;
  s.setProperty('--r-sm', `${r === 0 ? 0 : Math.max(2, Math.round(r * 0.7))}px`);
  s.setProperty('--r-md', `${r}px`);
  s.setProperty('--r-lg', `${Math.round(r * 1.4)}px`);
  s.setProperty('--r-pill', '999px');

  // 间距：按密度倍率缩放（不用 calc，直接算成具体值，避免嵌套变量）
  const d = Number(theme.density) || 1;
  for (const [k, base] of Object.entries(SPACING)) {
    s.setProperty(`--sp-${k}`, `${Math.round(base * d)}px`);
  }

  // 渐变开关：关闭时 accent2 回落到 accent，避免半途变色
  s.setProperty('--accent-grad', theme.gradient
    ? `linear-gradient(90deg, ${theme.accent}, ${theme.accent2})`
    : theme.accent);

  // 背景图（可选）：地址先消毒，非法值一律当"没设"
  const bgUrl = safeBgUrl(theme.bgImage);
  s.setProperty('--bg-image', bgUrl ? `url("${bgUrl}")` : 'none');
  const op = Number(theme.bgOpacity);
  s.setProperty('--bg-opacity', String(Number.isFinite(op) ? Math.min(1, Math.max(0, op)) : 0.12));
  const blur = Number(theme.bgBlur);
  s.setProperty('--bg-blur', `${Number.isFinite(blur) ? Math.min(40, Math.max(0, blur)) : 0}px`);
  const paint = backgroundPaint(theme.bgFit);
  s.setProperty('--bg-fit', paint.size);
  s.setProperty('--bg-repeat', paint.repeat);
  s.setProperty('--bg-position', paint.position);

  // 与编辑器共用选区定义。宿主先旋转原图，再把选区移到中心并按倒数
  // 放大：57% 是取原图57%的范围，而不是把整张图缩到57%。
  const crop = normalizeBackgroundCrop(theme);
  s.setProperty('--bg-rotate', `${crop.rotate}deg`);
  s.setProperty('--bg-zoom', String(crop.scale));
  s.setProperty('--bg-offset-x', `${crop.offsetX}%`);
  s.setProperty('--bg-offset-y', `${crop.offsetY}%`);
  s.setProperty('--bg-crop-scale', String(1 / crop.scale));
  s.setProperty('--bg-shift-x', `${-crop.offsetX / crop.scale}%`);
  s.setProperty('--bg-shift-y', `${-crop.offsetY / crop.scale}%`);

  // 布局偏好用 data 属性，由 common.css / shell 的属性选择器消费
  const body = typeof document !== 'undefined' ? document.body : null;
  if (body) {
    document.documentElement.classList?.toggle('theme-light', light);
    body.classList?.toggle('theme-light', light);
    s.setProperty('color-scheme', light ? 'light' : 'dark');
    body.dataset.sidebar = theme.sidebar;
    body.dataset.btnAlign = theme.btnAlign;
    // 模式标识用于形状与质感；显示名称使用配色描述。
    // 未知值回落到出厂默认模式。
    body.dataset.styleMode = STYLE_MODES.has(String(theme.styleMode)) ? String(theme.styleMode) : 'endfield';
    body.dataset.gradient = theme.gradient ? 'on' : 'off';
    body.dataset.bgImage = bgUrl ? 'on' : 'off';
    // 面板侧不画背景图（只有 shell 画），否则 shell + 每个 iframe 各一层会叠成两层。
    // panels/common.css 消费这个属性把 body::before 关掉。
    body.dataset.bgOwner = 'shell';
  }
  return theme;
}

/** 读当前主题：优先内存态，其次宿主存储（仅 shell 能读到），兜底出厂默认。 */
let memoryTheme = null;
export function getCurrentTheme() {
  if (memoryTheme) return normalizeTheme(memoryTheme);
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return normalizeTheme(JSON.parse(raw));
  } catch { /* opaque origin（面板 iframe）读不到，正常 */ }
  return normalizeTheme(null);
}

/** 写主题（shell 侧：内存 + 可选宿主存储镜像）。 */
export function writeTheme(theme, { persist = true } = {}) {
  const t = normalizeTheme(theme);
  memoryTheme = t;
  if (persist) {
    try { localStorage.setItem(KEY, JSON.stringify(t)); } catch { /* 面板侧读不到宿主存储，忽略 */ }
  }
  applyTheme(t);
  return t;
}

/** 应用某个预设（保留用户的圆角/密度/布局等非颜色偏好）。 */
export function applyPreset(name, base = getCurrentTheme()) {
  const preset = PRESETS[name];
  if (!preset) return base;
  return writeTheme({ ...base, preset: name, ...preset.tokens });
}

/** 出厂重置。 */
export function resetTheme() {
  memoryTheme = null;
  try { localStorage.removeItem(KEY); } catch { /* 忽略 */ }
  const t = normalizeTheme(null);
  applyTheme(t);
  return t;
}

// 自执行：有 DOM 时才应用。能读到（shell）就用读到的，读不到（面板 iframe）
// 就先用出厂默认，等 shell 通过 RPC 推送真正主题。
// 无 DOM（Node 侧 import 本模块）时完全跳过 —— 见 applyTheme 的注释。
if (typeof document !== 'undefined') applyTheme(getCurrentTheme());

// 面板侧：接收 shell 推送的主题（面板自身读不到宿主存储，只能靠这条通道）。
// persist=false —— 面板是 opaque origin，写宿主存储会抛异常。
if (typeof window !== 'undefined') {
  window.addEventListener('qq-theme', (e) => {
    if (e?.detail) writeTheme(e.detail, { persist: false });
  });
}
