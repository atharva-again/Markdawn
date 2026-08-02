import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { Priority } from '../hooks/useKeyboardShortcuts';
import {
  isEditableFocused,
  keyboardRegistry,
  shouldIgnoreKeyboardEvent,
} from '../hooks/useKeyboardShortcuts';
import { formatShortcut } from '../utils/keyboardShortcuts';

type Scope = string;

export interface ShortcutDefinition {
  key: string;
  // biome-ignore lint/suspicious/noConfusingVoidType: void allows simple arrow functions like () => fn()
  handler: (event: KeyboardEvent) => boolean | void;
  scope?: Scope;
  priority?: Priority;
  preventDefault?: boolean;
  description?: string;
  /** 'allow' — fires even when input/textarea/contenteditable is focused.
   *  'block' — suppressed when an editable element is focused. */
  whenInputFocused?: 'allow' | 'block';
}

interface ShortcutContextValue {
  activeScopes: Scope[];
  pushScope: (scopes: Scope[]) => void;
  popScope: () => void;
  getScopeBindings: (scope: Scope) => { key: string; description: string }[];
}

const ShortcutContext = createContext<ShortcutContextValue | null>(null);

let hookIdCounter = 0;

export function KeyboardShortcutProvider({ children }: { children: React.ReactNode }) {
  const [scopeStack, setScopeStack] = useState<Scope[][]>([['*']]);
  const activeScopes = scopeStack[scopeStack.length - 1] ?? ['*'];

  useEffect(() => {
    keyboardRegistry.setActiveScopes(activeScopes);
  }, [activeScopes]);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (shouldIgnoreKeyboardEvent(event)) return;
      keyboardRegistry.dispatch(event, isEditableFocused());
    };

    document.addEventListener('keydown', handler);
    return () => {
      document.removeEventListener('keydown', handler);
    };
  }, []);

  const pushScope = useCallback((scopes: Scope[]) => {
    setScopeStack((prev) => [...prev, scopes]);
  }, []);

  const popScope = useCallback(() => {
    setScopeStack((prev) => {
      // Never pop the last scope (always keep the default ['*'])
      if (prev.length <= 1) return prev;
      return prev.slice(0, -1);
    });
  }, []);

  const getScopeBindings = useCallback((scope: Scope) => {
    return keyboardRegistry
      .getBindingsForScope(scope)
      .filter((b) => b.description)
      .map((b) => ({ key: formatShortcut(b.shortcutPattern), description: b.description }));
  }, []);

  const value = useMemo<ShortcutContextValue>(
    () => ({
      activeScopes,
      pushScope,
      popScope,
      getScopeBindings,
    }),
    [activeScopes, pushScope, popScope, getScopeBindings],
  );

  return <ShortcutContext.Provider value={value}>{children}</ShortcutContext.Provider>;
}

/**
 * Register a keyboard shortcut binding.
 *
 * The binding is active for the lifetime of the component that calls this hook.
 * Handlers always receive the latest closure — no stale callback issues.
 */
export function useShortcut(def: ShortcutDefinition): void {
  const ctx = useContext(ShortcutContext);
  if (!ctx) {
    throw new Error('useShortcut must be used within a KeyboardShortcutProvider');
  }

  const idRef = useRef<string | null>(null);
  if (!idRef.current) {
    idRef.current = `hook-${++hookIdCounter}`;
  }

  const handlerRef = useRef(def.handler);
  handlerRef.current = def.handler;

  useEffect(() => {
    const id = idRef.current;
    if (!id) return;

    const unregister = keyboardRegistry.register({
      id,
      shortcutPattern: def.key,
      handler: (event) => {
        return handlerRef.current(event);
      },
      scope: def.scope ?? '*',
      priority: def.priority ?? 'normal',
      preventDefault: def.preventDefault ?? true,
      description: def.description ?? '',
      whenInputFocused: def.whenInputFocused ?? 'allow',
    });

    return unregister;
  }, [def.key, def.scope, def.priority, def.preventDefault, def.description, def.whenInputFocused]);
}

/** Register a stable group of related shortcuts through one hook boundary. */
export function useShortcuts(definitions: readonly ShortcutDefinition[]): void {
  const ctx = useContext(ShortcutContext);
  if (!ctx) {
    throw new Error('useShortcuts must be used within a KeyboardShortcutProvider');
  }
  const definitionsRef = useRef(definitions);
  definitionsRef.current = definitions;
  const idsRef = useRef<string[]>([]);
  while (idsRef.current.length < definitions.length) {
    idsRef.current.push(`hook-${++hookIdCounter}`);
  }
  const signature = definitions
    .map((definition) =>
      [
        definition.key,
        definition.scope,
        definition.priority,
        definition.preventDefault,
        definition.description,
        definition.whenInputFocused,
      ].join('\u001f'),
    )
    .join('\u001e');

  useEffect(() => {
    if (signature.length === 0 && definitionsRef.current.length === 0) return;
    const unregister = definitionsRef.current.map((definition, index) =>
      keyboardRegistry.register({
        id: idsRef.current[index] ?? `hook-${++hookIdCounter}`,
        shortcutPattern: definition.key,
        handler: (event) => definitionsRef.current[index]?.handler(event),
        scope: definition.scope ?? '*',
        priority: definition.priority ?? 'normal',
        preventDefault: definition.preventDefault ?? true,
        description: definition.description ?? '',
        whenInputFocused: definition.whenInputFocused ?? 'allow',
      }),
    );
    return () => {
      for (const remove of unregister) remove();
    };
  }, [signature]);
}

/**
 * Access the shortcut scope stack for dialog/modal management.
 *
 * Components should call `pushScope` when a dialog opens to restrict
 * which shortcuts fire, and `popScope` when it closes.
 */
export function useShortcutScope() {
  const ctx = useContext(ShortcutContext);
  if (!ctx) {
    throw new Error('useShortcutScope must be used within a KeyboardShortcutProvider');
  }
  return ctx;
}
