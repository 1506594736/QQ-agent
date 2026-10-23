// Original theme-colored glyphs: clipped corners, open rails and solid anchors.
// Constant geometry and a name allowlist keep plugin metadata inert.
import { installIconMotion } from './icon-motion.js';
const NS = 'http://www.w3.org/2000/svg';
const line = (role, d) => ({ role, d });
const solid = (role, d) => ({ role, d, solid: true });
const GLYPHS = Object.freeze({
  // Executions and their trace steps, rather than another chat/document symbol.
  sessions: [
    line('rail', 'M5 7v3M5 14v3M10 5h10M10 12h5M10 19h10'),
    solid('nodes', 'M3 3h4v4H3zM3 10h4v4H3zM3 17h4v4H3z'),
    solid('cursor', 'M17 9l4 3-4 3z'),
  ],
  chats: [
    line('back', 'M8 3h10l3 3v7h-3'),
    line('shell', 'M3 7h11l3 3v8H9l-4 3v-3H3z'),
    solid('message', 'M6 12h2v2H6zM10 12h2v2h-2z'),
  ],
  // Member impressions: portrait + index edge + short record lines.
  memory: [
    line('index', 'M3 7V3h5M3 17v4h5M16 3h5v5'),
    line('portrait', 'M7 8l3-2 3 2v3l-3 2-3-2zM4 18v-2l4-3h4l4 3v2'),
    line('impressions', 'M17 12h4M18 16h3'),
  ],
  usage: [
    line('rail', 'M3 4v17h18'),
    solid('meter-a', 'M6 12h3v6H6z'),
    solid('meter-b', 'M11 6h3v12h-3z'),
    solid('meter-c', 'M16 10h3v8h-3z'),
  ],
  skills: [
    line('tool', 'M15 3l-4 4v4L3 19l2 2 8-8h4l4-4V5l-4 4-2-2 4-4z'),
    line('marks', 'M3 4h4M3 8h3'),
  ],
  plugins: [
    line('socket', 'M3 4h6v5H6v6h3v5H3z'),
    line('module', 'M14 4h4l3 3v13h-7v-5h-2V9h2z'),
    solid('contacts', 'M4 6h2v2H4zM4 16h2v2H4z'),
  ],
  settings: [
    line('rail', 'M3 6h18M3 12h18M3 18h18'),
    solid('control-a', 'M7 4h4v4H7z'),
    solid('control-b', 'M13 10h4v4h-4z'),
    solid('control-c', 'M5 16h4v4H5z'),
  ],
  // Personal account: portrait, shoulders and a small identity badge.
  community: [
    line('avatar', 'M12 3a4 4 0 0 1 4 4v1a4 4 0 0 1-8 0V7a4 4 0 0 1 4-4z'),
    line('shoulders', 'M4 21v-3l4-4h8l4 4v3H4z'),
    solid('identity', 'M10 17h4v2h-4z'),
  ],
  panel: [line('shell', 'M3 4h14l4 4v12H3zM3 9h18M9 9v11'), solid('anchor', 'M5 6h2v1H5z')],
  activity: [line('rail', 'M2 14h4l3-9 6 15 3-6h4'), solid('cursor', 'M20 13h2v2h-2z')],
  menu: [line('rails', 'M3 6h18M3 12h12M3 18h18')],
  arrow: [line('direction', 'M3 12h18M14 5l7 7-7 7')],
  chevron: [line('direction', 'M4 8l8 8 8-8')],
  check: [line('direction', 'M3 12l6 6L21 5')],
  close: [line('direction', 'M4 4l16 16M20 4L4 20')],
  search: [line('lens', 'M8 3h6l4 4v7l-4 4H8l-4-4V7z'), line('handle', 'M17 17l5 5')],
  refresh: [line('forward', 'M20 9V6l-3-3H8L4 7M4 3v4h4'), line('return', 'M4 15v3l3 3h9l4-4M20 21v-4h-4')],
  plus: [line('direction', 'M12 3v18M3 12h18')],
  trash: [line('shell', 'M4 7h16M8 7V3h8v4M6 7v14h10l2-2V7'), line('slots', 'M10 11v6M14 11v6')],
  pause: [solid('bars', 'M6 4h4v16H6zM14 4h4v16h-4z')],
  play: [solid('direction', 'M6 3l15 9-15 9z')],
  upload: [line('direction', 'M12 15V3M7 8l5-5 5 5'), line('dock', 'M3 15v6h16l2-2v-4')],
  folder: [line('shell', 'M3 5h7l3 3h8v10l-3 3H3z'), line('records', 'M7 13h10M7 17h6')],
  link: [line('chain', 'M10 8l4-4h5l2 2v5l-4 4M14 16l-4 4H5l-2-2v-5l4-4'), line('join', 'M8 16l8-8')],
  copy: [line('back', 'M14 7V3H3v13h4'), line('sheet', 'M7 7h12l2 2v12H7z')],
  save: [line('shell', 'M3 3h15l3 3v15H3zM7 21v-8h10v8'), solid('slot', 'M7 3h8v5H7z')],
  info: [line('shell', 'M7 3h10l4 4v10l-4 4H7l-4-4V7z'), line('stem', 'M12 10v7'), solid('dot', 'M11 6h2v2h-2z')],
  warning: [line('shell', 'M12 3l10 18H2z'), solid('mark', 'M11 8h2v7h-2zM11 17h2v2h-2z')],
  emblem: [
    line('frame', 'M3 9V5l2-2h4M15 3h4l2 2v4M21 15v4l-2 2h-4M9 21H5l-2-2v-4'),
    { ...solid('core', 'M12 5l7 7-7 7-7-7zM12 9l-3 3 3 3 3-3z'), evenodd: true },
    solid('anchor', 'M11 11h2v2h-2z'),
  ],
  archive: [line('tray', 'M3 9h5l2 3h4l2-3h5v12H3zM8 17h8'), solid('payload', 'M10 3h4v3h3l-5 5-5-5h3z')],
  // Readiness decoration: a filled check/connected path versus an open block
  // and stop rails. The host's text label supplies the actual state meaning.
  'status-onebot-ready': [
    line('endpoints', 'M3 4h5v6H3zM16 14h5v6h-5z'),
    line('bridge', 'M8 7h5v10h3'),
    solid('ready', 'M14 6l2 2 4-5 1 1-5 6-3-3z'),
  ],
  'status-onebot-pending': [
    line('endpoints', 'M3 4h5v6H3zM16 14h5v6h-5z'),
    line('bridge', 'M8 7h5v4M13 14v3h3'),
    line('gap', 'M11 11h4M11 14h4'),
  ],
  'status-model-ready': [
    line('network', 'M5 6h7l6 6-6 6H5M5 6v12M12 6v12'),
    solid('nodes', 'M3 4h4v4H3zM3 16h4v4H3zM10 4h4v4h-4zM10 16h4v4h-4zM16 10h4v4h-4z'),
    solid('ready', 'M15 5l2 2 4-5 1 1-5 6-3-3z'),
  ],
  'status-model-pending': [
    line('network', 'M5 6h5M13 7l5 5-6 6H5M5 6v12M12 10v8'),
    line('nodes', 'M3 4h4v4H3zM3 16h4v4H3zM10 4h4v4h-4zM10 16h4v4h-4zM16 10h4v4h-4z'),
    line('gap', 'M16 4h6M16 8h3'),
  ],
});
const ALIASES = Object.freeze({logs:'activity',extension:'plugins',plugin:'plugins',chat:'chats',session:'sessions',profile:'community',globe:'community',chart:'usage',gear:'settings'});

/** Shared icons are decoration. The surrounding button/link must keep its text label. */
export function createIcon(name, { size = 20 } = {}) {
  installIconMotion(document);
  const px = Number.isFinite(Number(size)) ? Math.min(96, Math.max(12, Number(size))) : 20;
  const key = Object.hasOwn(GLYPHS, name) ? name : Object.hasOwn(ALIASES, name) ? ALIASES[name] : 'panel';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('class', 'qq-icon icon-' + key);
  svg.dataset.iconMotion = key;
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(px));
  svg.setAttribute('height', String(px));
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.65');
  svg.setAttribute('stroke-linecap', 'square');
  svg.setAttribute('stroke-linejoin', 'miter');
  for (const [index, glyph] of GLYPHS[key].entries()) {
    const part = document.createElementNS(NS, 'path');
    part.setAttribute('d', glyph.d);
    part.dataset.iconPart = String(index);
    part.dataset.iconRole = glyph.role;
    if (glyph.solid) {
      part.setAttribute('fill', 'currentColor');
      part.setAttribute('stroke', 'none');
    }
    if (glyph.evenodd) part.setAttribute('fill-rule', 'evenodd');
    svg.append(part);
  }
  return svg;
}

export const ICON_NAMES = Object.freeze(Object.keys(GLYPHS));
