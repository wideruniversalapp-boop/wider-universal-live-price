/**
 * Minimal unsaved-changes guard for the admin area (the app uses BrowserRouter, so the
 * router's blocking APIs are not available). Editors register a dirty check; navigation
 * links in AdminLayout call confirmLeave() before switching pages.
 */
let isDirty: () => boolean = () => false;

export function setUnsavedCheck(fn: (() => boolean) | null) {
  isDirty = fn ?? (() => false);
}

export function confirmLeave(): boolean {
  return !isDirty() || window.confirm('You have unsaved changes. Leave this page and discard them?');
}
