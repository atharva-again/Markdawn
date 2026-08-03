import { getLogger } from '../logger-init';
import { normalizeShortcutPattern } from '../utils/keyboardShortcuts';

export type Priority = 'high' | 'normal' | 'low';

const PRIORITY_RANK: Record<Priority, number> = { high: 0, normal: 1, low: 2 };

export interface HotkeyBinding {
  id: string;
  /** Normalized token used for matching keyboard events. */
  key: string;
  /** Original shortcut pattern used when presenting the binding to users. */
  shortcutPattern: string;
  // biome-ignore lint/suspicious/noConfusingVoidType: void allows simple arrow functions like () => fn()
  handler: (event: KeyboardEvent) => boolean | void;
  scope: string;
  priority: Priority;
  preventDefault: boolean;
  description: string;
  /** 'allow' — fires even when an input/textarea/contenteditable is focused.
   *  'block' — suppressed when an editable element is focused. */
  whenInputFocused: 'allow' | 'block';
}

type HotkeyRegistration = Omit<HotkeyBinding, 'id' | 'key'> & { id?: string };

let bindingCounter = 0;

/**
 * Module-level keyboard shortcut registry (zero React dependencies).
 *
 * Manages all keyboard bindings in a single place with priority ordering,
 * scope filtering, and input-focus awareness. The React layer wraps this
 * and provides component-lifecycle-safe registration.
 */
export class KeyboardRegistry {
  private bindings: HotkeyBinding[] = [];
  private activeScopes = new Set<string>(['*']);

  /**
   * Register a keyboard binding. Returns an unregister function.
   */
  register(binding: HotkeyRegistration): () => void {
    const id = binding.id ?? `kb-${++bindingCounter}`;
    const entry: HotkeyBinding = {
      ...binding,
      id,
      key: normalizeShortcutPattern(binding.shortcutPattern),
    };
    this.bindings.push(entry);
    this.bindings.sort((a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]);
    return () => {
      this.bindings = this.bindings.filter((b) => b.id !== id);
    };
  }

  /**
   * Dispatch a KeyboardEvent through the registry.
   * Returns true if a binding handled the event.
   */
  dispatch(event: KeyboardEvent, isEditableFocused: boolean): boolean {
    const keys = this.normalizeKeys(event);

    for (const b of this.bindings) {
      if (!keys.includes(b.key)) continue;

      if (b.whenInputFocused === 'block' && isEditableFocused) continue;
      if (!this.activeScopes.has(b.scope) && !this.activeScopes.has('*')) continue;

      try {
        const handled = b.handler(event);
        if (handled === false) continue; // Handler returned false — try next binding
        if (b.preventDefault) event.preventDefault();
        return true;
      } catch (err) {
        getLogger().error('[KeyboardRegistry] handler threw for binding: {id}', {
          id: b.id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    return false;
  }

  /**
   * Set the currently active scopes. Only bindings matching an active scope
   * will fire. The special scope '*' matches all bindings.
   */
  setActiveScopes(scopes: string[]): void {
    this.activeScopes = new Set(scopes);
  }

  getActiveScopes(): string[] {
    return Array.from(this.activeScopes);
  }

  /** Get all bindings for a given scope (for display in menus). */
  getBindingsForScope(scope: string): HotkeyBinding[] {
    return this.bindings.filter((b) => b.scope === scope || b.scope === '*');
  }

  /** Clear all registered bindings (for test isolation). */
  clearAll(): void {
    this.bindings = [];
    this.activeScopes = new Set(['*']);
    bindingCounter = 0;
  }

  normalizeKeys(event: KeyboardEvent): string[] {
    const parts: string[] = [];

    if (event.metaKey || event.ctrlKey) parts.push('mod');
    if (event.altKey && event.key !== 'Alt' && event.key !== 'AltGraph') parts.push('alt');
    if (event.shiftKey && event.key !== 'Shift') parts.push('shift');
    // Sort modifiers deterministically so key order never breaks matching
    parts.sort();

    return eventKeyTokens(event).map((key) => {
      if (['Control', 'Meta', 'Alt', 'AltGraph', 'Shift', 'OS'].includes(key)) {
        return parts.join('+') || key.toLowerCase();
      }

      if (key === ' ') return [...parts, 'space'].join('+');

      return [...parts, key.toLowerCase()].join('+');
    });
  }
}

function digitKeyToken(code: string): string | undefined {
  return /^Digit[0-9]$/.test(code) ? code.toLowerCase() : undefined;
}

function digitKeyTokenFromPattern(key: string): string {
  return /^[0-9]$/.test(key) ? `digit${key}` : key;
}

function eventKeyTokens(event: KeyboardEvent): string[] {
  const tokens = [digitKeyTokenFromPattern(event.key)];
  const physicalDigit = digitKeyToken(event.code);
  if (physicalDigit && !tokens.includes(physicalDigit)) {
    tokens.push(physicalDigit);
  }
  return tokens;
}

/** App-wide singleton registry. */
export const keyboardRegistry = new KeyboardRegistry();

/**
 * Determine if a keyboard event is clearly text input that should
 * NOT trigger global shortcuts.
 *
 * The gate is intentionally permissive: it only filters out plain
 * keypresses (no modifier) in editable areas. Modifier combos pass
 * through — the registry's per-binding `whenInputFocused` setting
 * handles finer-grained filtering.
 */
export function shouldIgnoreKeyboardEvent(event: KeyboardEvent): boolean {
  if (event.defaultPrevented) return true;

  const target = event.target;
  if (!(target instanceof HTMLElement)) return false;

  if (event.key === 'Escape') return false;

  const tagName = target.tagName;
  const isEditable =
    tagName === 'INPUT' ||
    tagName === 'TEXTAREA' ||
    tagName === 'SELECT' ||
    target.contentEditable === 'true';

  if (!isEditable) return false;
  if (event.metaKey || event.ctrlKey || event.altKey) return false;

  return true;
}

/**
 * Check whether the currently focused DOM element is an editable input
 * (input, textarea, select, or contenteditable). Used by the registry
 * to filter per-binding `whenInputFocused` settings.
 */
export function isEditableFocused(): boolean {
  const el = document.activeElement;
  if (!el) return false;
  const tagName = el.tagName;
  return (
    tagName === 'INPUT' ||
    tagName === 'TEXTAREA' ||
    tagName === 'SELECT' ||
    (el instanceof HTMLElement && el.contentEditable === 'true')
  );
}
