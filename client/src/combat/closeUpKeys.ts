/** What a keydown does while a close-up is showing. */
export type CloseUpKeyAction = 'skip' | 'swallow' | 'pass';

export interface KeyInfo { key: string; repeat: boolean; ctrlKey: boolean; metaKey: boolean; altKey: boolean; editable: boolean }

const MODIFIERS = new Set(['Shift', 'Control', 'Alt', 'Meta', 'CapsLock', 'AltGraph', 'OS']);

/**
 * pass: typing in a field, bare modifiers, browser shortcuts and F-keys go through untouched.
 * swallow: auto-repeat from a held key is blocked but doesn't skip (a held pan key would kill every close-up).
 * skip: any other fresh key press ends the close-up and is consumed.
 */
export function closeUpKeyAction(e: KeyInfo): CloseUpKeyAction {
  if (e.editable || MODIFIERS.has(e.key) || e.ctrlKey || e.metaKey || e.altKey || /^F\d{1,2}$/.test(e.key)) return 'pass';
  if (e.repeat) return 'swallow';
  return 'skip';
}

export function keyInfo(e: KeyboardEvent): KeyInfo {
  const t = e.target as HTMLElement | null;
  const editable = !!t && (t.isContentEditable || t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT');
  return { key: e.key, repeat: e.repeat, ctrlKey: e.ctrlKey, metaKey: e.metaKey, altKey: e.altKey, editable };
}
