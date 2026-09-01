import { Connection, Document } from '@hocuspocus/server';
import { describe, expect, it, vi } from 'vitest';
import { createConnectionLifecycle, releaseConnectionTraffic } from './connectionLifecycle';
import { createHocuspocusAdapter } from './hocuspocusAdapter';

function createAdapter() {
  return createHocuspocusAdapter({
    rememberOutboundAwarenessEntries: vi.fn(),
    applyMessage: async ({ apply }) => apply(),
  });
}

describe('Hocuspocus adapter', () => {
  it('allows a verified permission snapshot before deferred initial awareness', () => {
    const lifecycle = createConnectionLifecycle();
    const context = { lifecycle };
    const adapter = createAdapter();

    releaseConnectionTraffic(context);

    expect(lifecycle.traffic.deferInitialAwareness).toBe(true);
    expect(
      adapter.lifecycleHooks.beforeSend?.({ context } as Connection, new Uint8Array([0])),
    ).toBe(true);
  });

  it('preserves the selected close event when application is deferred', async () => {
    let resolveCompletion: (() => void) | undefined;
    const completion = new Promise<void>((resolve) => {
      resolveCompletion = resolve;
    });
    const lifecycle = createConnectionLifecycle();
    lifecycle.application = {
      state: 'running',
      inFlight: 1,
      completion,
      resolveCompletion: () => resolveCompletion?.(),
      closeScheduled: false,
      pendingCloseEvent: null,
    };
    const close = vi.fn();
    const event = {
      code: 4500,
      reason: 'Write application timed out',
    } as NonNullable<Parameters<Connection['close']>[0]>;
    const adapter = createAdapter();

    expect(
      adapter.lifecycleHooks.beforeClose?.({ context: { lifecycle } } as Connection, event, close),
    ).toBe(true);
    resolveCompletion?.();
    await completion;
    await Promise.resolve();

    expect(close).toHaveBeenCalledWith(event);
  });

  it('keeps accepted traffic established until pending messages drain on close', async () => {
    let resolvePending: (() => void) | undefined;
    const pending = new Promise<void>((resolve) => {
      resolvePending = resolve;
    });
    const lifecycle = createConnectionLifecycle();
    releaseConnectionTraffic({ lifecycle });
    const adapter = createAdapter();
    const connection = {
      context: { lifecycle },
      waitForPendingMessages: () => pending,
    } as Connection;

    expect(adapter.lifecycleHooks.beforeClose?.(connection, undefined, vi.fn())).toBe(false);
    expect(lifecycle.traffic.gate.state).toBe('established');

    resolvePending?.();
    await pending;
    await Promise.resolve();

    expect(lifecycle.traffic.gate.state).toBe('rejected');
  });

  it('rejects a provisional connection before sending its close packet', () => {
    const lifecycle = createConnectionLifecycle();
    const adapter = createAdapter();
    const connection = {
      context: { lifecycle },
    } as Connection;

    expect(adapter.lifecycleHooks.beforeClose?.(connection, undefined, vi.fn())).toBe(false);
    expect(lifecycle.traffic.gate.state).toBe('rejected');
  });

  it('transfers awareness ownership to a duplicate and removes it after the final close', () => {
    const document = new Document(crypto.randomUUID());
    const clientId = document.clientID;
    const adapter = createAdapter();
    const createConnection = () => {
      const lifecycle = createConnectionLifecycle();
      lifecycle.awareness.clientId = clientId;
      releaseConnectionTraffic({ lifecycle });
      return new Connection(
        { readyState: 1, send: vi.fn() } as never,
        new Request('http://localhost'),
        document,
        crypto.randomUUID(),
        { lifecycle },
        false,
        undefined,
        undefined,
        adapter.lifecycleHooks,
      );
    };
    const first = createConnection();
    const duplicate = createConnection();
    document.awareness.setLocalState({ user: { name: 'Test User' } });
    document.getClients(first).add(clientId);

    try {
      first.close();

      expect(document.hasConnection(first)).toBe(false);
      expect(document.hasConnection(duplicate)).toBe(true);
      expect(document.getClients(first).has(clientId)).toBe(false);
      expect(document.getClients(duplicate).has(clientId)).toBe(true);
      expect(document.awareness.getStates().has(clientId)).toBe(true);

      duplicate.close();

      expect(document.hasConnection(duplicate)).toBe(false);
      expect(document.awareness.getStates().has(clientId)).toBe(false);
    } finally {
      first.close();
      duplicate.close();
      document.destroy();
    }
  });

  it('ignores only the selected message', async () => {
    const applyMessage = vi.fn(async ({ apply }: { apply(): void }) => apply());
    const adapter = createHocuspocusAdapter({
      rememberOutboundAwarenessEntries: vi.fn(),
      applyMessage,
    });
    const ignored = new Uint8Array([1]);
    const accepted = new Uint8Array([2]);
    const applyIgnored = vi.fn();
    const applyAccepted = vi.fn();
    const connection = {} as Connection;

    adapter.ignoreMessage(ignored);
    await adapter.lifecycleHooks.aroundApplyMessage?.(connection, ignored, applyIgnored);
    await adapter.lifecycleHooks.aroundApplyMessage?.(connection, accepted, applyAccepted);

    expect(applyIgnored).not.toHaveBeenCalled();
    expect(applyAccepted).toHaveBeenCalledOnce();
    expect(applyMessage).toHaveBeenCalledOnce();
  });

  it('keeps lifecycle hooks scoped to each connection', () => {
    const firstRemember = vi.fn();
    const secondRemember = vi.fn();
    const createConnection = (remember: (context: object, message: unknown) => void) => {
      const lifecycle = createConnectionLifecycle();
      lifecycle.traffic.gate.settle(true);
      lifecycle.traffic.deferInitialAwareness = false;
      const socket = {
        binaryType: 'nodebuffer',
        readyState: 1,
        send: vi.fn((_message: unknown, callback?: (error?: Error) => void) => callback?.()),
      };
      const adapter = createHocuspocusAdapter({
        rememberOutboundAwarenessEntries: remember,
        applyMessage: async ({ apply }) => apply(),
      });
      return new Connection(
        socket as never,
        new Request('http://localhost'),
        new Document(crypto.randomUUID()),
        crypto.randomUUID(),
        { lifecycle },
        false,
        undefined,
        undefined,
        adapter.lifecycleHooks,
      );
    };
    const firstConnection = createConnection(firstRemember);
    const secondConnection = createConnection(secondRemember);

    firstConnection.send(new Uint8Array([1]));

    expect(firstRemember).toHaveBeenCalledTimes(1);
    expect(secondRemember).not.toHaveBeenCalled();
    firstConnection.close();
    secondConnection.close();
  });
});
