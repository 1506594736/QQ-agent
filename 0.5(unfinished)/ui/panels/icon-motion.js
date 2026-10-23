// Selection drives glyph motion. One document observer, no hover/focus handlers
// or JS frame loop; browser-native effects run only for visible selected owners.
const installed = new WeakMap();
const OWNER = 'button,a[href],[role="button"],[role="link"],[role="tab"],[data-icon-active]';
const SELECTED = ['button', 'a[href]', '[role="button"]', '[role="link"]', '[role="tab"]']
  .flatMap(selector => [selector + '[aria-current="page"]', selector + '[aria-selected="true"]'])
  .concat('[data-icon-active="true"]').join(',');
const SIGNALS = new Set(['aria-current', 'aria-selected', 'data-icon-active', 'role', 'href']);
const HIDDEN = '[hidden],.hidden,.is-hidden,dialog:not([open])';
const EASE = 'cubic-bezier(.2,.75,.25,1)';
const MAX_OWNER_ICONS = 4, MAX_DOCUMENT_ICONS = 8, MAX_DOCUMENT_EFFECTS = 24;

function hiddenByClosedDetails(node) {
  let child = node;
  for (let parent = node?.parentElement; parent; child = parent, parent = parent.parentElement) {
    if (parent.tagName !== 'DETAILS' || parent.open) continue;
    const summary = [...parent.children].find(element => element.tagName === 'SUMMARY');
    if (child !== summary) return true;
  }
  return false;
}

function plans(icon) {
  const parts = [...icon.querySelectorAll('[data-icon-part]')];
  const part = index => parts[index] || icon;
  const role = (name, fallback = 1) => icon.querySelector('[data-icon-role="' + name + '"]') || part(fallback);
  // A readable gesture, return, then a brief rest instead of barely visible drift.
  const move = (target, middle, delay = 0, duration = 2200) => ({
    target, frames: [{ transform: 'none', opacity: 1, offset: 0 }, { ...middle, offset: .35 }, { transform: 'none', opacity: 1, offset: .85 }, { transform: 'none', opacity: 1, offset: 1 }], delay, duration,
  });
  switch (icon.dataset.iconMotion) {
    case 'sessions': return [move(role('cursor', 2), { transform: 'translateX(1.5px)', opacity: .45 })];
    case 'chats': return [move(role('message', 2), { transform: 'translateX(1.5px)', opacity: .45 })];
    case 'memory': return [move(role('portrait'), { transform: 'translateY(-1px)', opacity: .55 })];
    case 'usage': return ['meter-a', 'meter-b', 'meter-c'].map((name, step) => move(role(name, step + 1), { transform: 'scaleY(' + [.25, .45, .2][step] + ')' }, step * 200));
    case 'skills': return [move(role('tool', 0), { transform: 'rotate(-8deg)' })];
    case 'plugins': return [move(role('module'), { transform: 'translateX(-1.5px)', opacity: .55 })];
    case 'settings': return ['control-a', 'control-b', 'control-c'].map((name, step) => move(role(name, step + 1), { transform: 'translateX(' + [3, -3, 2][step] + 'px)' }, step * 200));
    case 'community': return [move(role('avatar', 0), { transform: 'translateY(-1px)' }, 0, 2600), move(role('identity', 2), { opacity: .35, transform: 'scaleX(.65)' }, 300, 2600)];
    case 'activity': return [move(role('cursor'), { transform: 'translateX(-2px)', opacity: .55 })];
    // Limit the open frame's turn: its corners/stroke stay inside the viewport.
    case 'emblem': return [move(role('core'), { transform: 'scale(.8)', opacity: .65 }, 0, 2400), move(role('frame', 0), { transform: 'rotate(15deg)' }, 300, 2400)];
    case 'archive': return [move(role('payload'), { transform: 'translateY(2px)', opacity: .55 }, 0, 2400)];
    // Status cycles illustrate the host's declared state; they are not a load
    // progress measurement. The explicit opt-in still uses the same budget.
    case 'status-onebot-ready': return [move(role('bridge'), { opacity: .6 }, 0, 2800), move(role('ready', 2), { opacity: .7 }, 300, 2800)];
    case 'status-onebot-pending': return [move(role('bridge'), { opacity: .55 }, 0, 2800), move(role('gap', 2), { transform: 'translateY(-1px)', opacity: .55 }, 300, 2800)];
    case 'status-model-ready': return [move(role('nodes'), { transform: 'scale(.86)', opacity: .7 }, 0, 3000), move(role('ready', 2), { opacity: .7 }, 300, 3000)];
    case 'status-model-pending': return [move(role('nodes'), { opacity: .55 }, 0, 3000), move(role('gap', 2), { transform: 'translateX(1px)', opacity: .55 }, 300, 3000)];
    default: return [move([...icon.querySelectorAll('[data-icon-role]')].at(-1) || part(1), { opacity: .45 })];
  }
}

/** Opt-in helper; createIcon lazily calls it. ARIA selection or data-icon-active
 * is the sole trigger. Disposing stops effects without changing DOM selection. */
export function installIconMotion(doc = typeof document !== 'undefined' ? document : null) {
  if (!doc?.addEventListener || !doc.defaultView) return () => {};
  if (installed.has(doc)) return installed.get(doc);
  const view = doc.defaultView, media = view.matchMedia?.('(prefers-reduced-motion: reduce)');
  const selectedOwners = new Set(), states = new Map(), runningIcons = new Map();
  let disposed = false, observer, effectCount = 0;
  const allowed = () => !disposed && doc.visibilityState !== 'hidden' && !media?.matches;
  const selected = owner => owner?.matches?.(SELECTED);
  const eligible = node => node?.isConnected && !node.matches?.(':disabled,[aria-disabled="true"]') && !node.closest?.(HIDDEN) && !hiddenByClosedDetails(node);
  // Only interaction/DOM-policy changes perform these bounded visibility reads.
  // SVG shapes have no independent CSS layout box; inspect their SVG ancestry.
  const rendered = node => {
    if (node?.namespaceURI !== 'http://www.w3.org/2000/svg' || node.localName === 'svg') return node?.checkVisibility?.({ visibilityProperty: true }) !== false;
    for (let current = node; current; current = current.parentElement) {
      const style = view.getComputedStyle?.(current);
      if (style?.display === 'none' || style?.visibility === 'hidden' || style?.visibility === 'collapse') return false;
      if (current.localName === 'svg') return current.checkVisibility?.({ visibilityProperty: true }) !== false;
    }
    return true;
  };
  const ownerOf = icon => icon.closest?.(OWNER);
  const stopIcon = (owner, icon) => {
    const state = states.get(owner);
    if (!state) return;
    for (const [animation, effect] of state.effects) {
      if (effect.icon !== icon) continue;
      state.effects.delete(animation); --effectCount;
      try { animation.cancel(); } catch { /* Detached glyphs still release their slot. */ }
    }
    if (runningIcons.get(icon) === owner) runningIcons.delete(icon);
  };
  const stop = owner => {
    const state = states.get(owner);
    if (!state) return;
    for (const icon of runningIcons.keys()) if (runningIcons.get(icon) === owner) stopIcon(owner, icon);
    states.delete(owner);
  };
  const stopAll = () => { for (const owner of states.keys()) stop(owner); };
  const track = owner => {
    if (owner?.isConnected && selected(owner)) selectedOwners.add(owner);
    else { selectedOwners.delete(owner); stop(owner); }
  };
  const discover = node => {
    if (node?.nodeType !== 1 && node !== doc) return;
    if (node.matches?.(SELECTED)) track(node);
    for (const owner of node.querySelectorAll?.(SELECTED) || []) track(owner);
  };
  const play = owner => {
    if (!allowed() || !selected(owner) || !eligible(owner) || !rendered(owner)) return;
    let state = states.get(owner), count = 0;
    const icons = owner.matches?.('.qq-icon[data-icon-motion]') ? [owner] : owner.querySelectorAll('.qq-icon[data-icon-motion]');
    for (const icon of icons) {
      // A nested ordinary action owns its icon and stays still unless selected.
      if (ownerOf(icon) !== owner || !eligible(icon) || !rendered(icon)) continue;
      if (count++ >= MAX_OWNER_ICONS) break;
      if (runningIcons.has(icon) || runningIcons.size >= MAX_DOCUMENT_ICONS) continue;
      for (const plan of plans(icon).slice(0, 3)) {
        if (effectCount >= MAX_DOCUMENT_EFFECTS) break;
        if (typeof plan.target.animate !== 'function' || !rendered(plan.target)) continue;
        let animation;
        try { animation = plan.target.animate(plan.frames, { duration: plan.duration, delay: plan.delay, easing: plan.easing || EASE, iterations: Infinity, fill: 'none' }); }
        catch { continue; }
        if (!state) { state = { effects: new Map() }; states.set(owner, state); }
        state.effects.set(animation, { icon, target: plan.target }); ++effectCount;
        runningIcons.set(icon, owner);
        const finish = () => {
          if (!state.effects.delete(animation)) return;
          --effectCount;
          if (![...state.effects.values()].some(effect => effect.icon === icon) && runningIcons.get(icon) === owner) runningIcons.delete(icon);
        };
        animation.finished?.then(finish, finish);
      }
    }
  };
  const sync = () => {
    if (!allowed()) { stopAll(); return; }
    for (const owner of selectedOwners) if (!owner.isConnected || !selected(owner)) track(owner);
    for (const [owner, state] of states) {
      if (!selectedOwners.has(owner) || !eligible(owner) || !rendered(owner)) { stop(owner); continue; }
      const visibleIcons = new Map();
      for (const { icon, target } of state.effects.values()) {
        if (!visibleIcons.has(icon)) visibleIcons.set(icon, ownerOf(icon) === owner && eligible(icon) && rendered(icon));
        if (!visibleIcons.get(icon) || !target.isConnected || !rendered(target)) stopIcon(owner, icon);
      }
    }
    for (const owner of selectedOwners) play(owner);
  };
  const changed = records => {
    let relevant = false;
    for (const record of records) {
      if (record.type === 'attributes' && SIGNALS.has(record.attributeName)) { track(record.target); relevant = true; }
      else if (record.type === 'childList') {
        for (const node of record.addedNodes) if (node.nodeType === 1) { discover(node); relevant = true; }
        if ([...record.removedNodes].some(node => node.nodeType === 1)) relevant = true;
      } else if ([...selectedOwners].some(owner => record.target === owner || record.target.contains?.(owner) || owner.contains?.(record.target))) relevant = true;
    }
    if (relevant) sync();
  };
  const cleanup = () => {
    if (disposed) return;
    disposed = true; stopAll(); selectedOwners.clear(); observer?.disconnect();
    doc.removeEventListener('visibilitychange', sync); view.removeEventListener('resize', sync); view.removeEventListener('pagehide', cleanup);
    media?.removeEventListener?.('change', sync); installed.delete(doc);
  };
  doc.addEventListener('visibilitychange', sync); view.addEventListener('resize', sync); view.addEventListener('pagehide', cleanup, { once: true });
  media?.addEventListener?.('change', sync);
  if (view.MutationObserver) {
    observer = new view.MutationObserver(changed);
    observer.observe(doc.documentElement, { childList: true, subtree: true, attributes: true,
      attributeFilter: ['aria-current', 'aria-selected', 'data-icon-active', 'role', 'href', 'disabled', 'aria-disabled', 'hidden', 'open', 'class', 'style', 'data-sidebar', 'data-rail-collapsed'] });
  }
  installed.set(doc, cleanup); discover(doc); sync();
  return cleanup;
}
