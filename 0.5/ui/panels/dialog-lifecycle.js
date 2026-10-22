// Disposable dialogs only. This module has no panel client, storage or host APIs.
// Native close events are queued; explicit close and Escape must release state
// before another dialog can be opened in the same JavaScript task.
export function installDisposableDialog(dialog, { onClosed, canClose, dismissOnBackdrop = false } = {}) {
  const nativeClose = dialog.close.bind(dialog);
  const doc = dialog.ownerDocument;
  const parent = [...(doc?.querySelectorAll?.('dialog:modal') ?? [])].at(-1);
  const returnFocus = doc?.activeElement;
  let closed = false;
  let backdropPointer = null;
  function isBackdrop(event) {
    if (event.target !== dialog || !dialog.open) return false;
    const rect = dialog.getBoundingClientRect();
    return event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom;
  }
  function pointerDown(event) {
    backdropPointer = event.button === 0 && event.isPrimary !== false && isBackdrop(event) ? event.pointerId : null;
  }
  function pointerCancel() { backdropPointer = null; }
  function backdropClick(event) {
    // A drag or text selection starting in the content must not dismiss it.
    const outside = backdropPointer !== null && (event.pointerId === undefined || event.pointerId === backdropPointer) && event.button === 0 && !event.defaultPrevented && isBackdrop(event);
    backdropPointer = null;
    if (outside) close();
  }
  function restoreParentFocus() {
    if (!parent?.isConnected || !parent.open || [...doc.querySelectorAll('dialog:modal')].at(-1) !== parent || parent.contains(doc.activeElement)) return;
    // Async parent actions may disable their button before opening a nested
    // confirmation, so native close cannot focus it. Use a live parent field
    // instead, without taking focus from a newly opened modal or valid target.
    const usable = (node) => node && parent.contains(node) && !node.matches(':disabled') && node.tabIndex >= 0 && node.getClientRects().length > 0;
    const target = usable(returnFocus) ? returnFocus : [...parent.querySelectorAll('input, textarea, select, button, a[href], [tabindex]')].find(usable);
    (target || parent).focus({ preventScroll: true });
  }
  function finish() {
    if (closed) return;
    closed = true;
    backdropPointer = null;
    dialog.removeEventListener('close', finish);
    dialog.removeEventListener('cancel', cancel);
    dialog.removeEventListener('pointerdown', pointerDown);
    dialog.removeEventListener('pointercancel', pointerCancel);
    dialog.removeEventListener('click', backdropClick);
    dialog.remove();
    onClosed?.();
    restoreParentFocus();
  }
  function close(...args) {
    if (closed || canClose?.() === false) return;
    nativeClose(...args);
    finish();
  }
  function cancel(event) {
    if (event.defaultPrevented) return;
    event.preventDefault();
    close();
  }
  dialog.close = close;
  dialog.addEventListener('close', finish);
  dialog.addEventListener('cancel', cancel);
  if (dismissOnBackdrop) {
    dialog.addEventListener('pointerdown', pointerDown);
    dialog.addEventListener('pointercancel', pointerCancel);
    dialog.addEventListener('click', backdropClick);
  }
  return Object.freeze({ close, dispose: finish, get closed() { return closed; } });
}
