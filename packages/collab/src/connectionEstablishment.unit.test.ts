import type { Connection, connectedPayload } from '@hocuspocus/server';
import { describe, expect, it, vi } from 'vitest';
import { CollabAccessError } from './collabErrors';
import { createCollabSession } from './collabSession';
import { createConnectionEstablishmentHook } from './connectionEstablishment';
import { createConnectionLifecycle } from './connectionLifecycle';

function createSession() {
  return createCollabSession({
    principal: {
      kind: 'account',
      user: {
        id: 'user-1',
        email: 'user@example.com',
        name: 'User',
        avatarUrl: null,
      },
      credential: { kind: 'session', raw: 'session-token' },
    },
    permission: 'view',
    accessRevision: '1',
    lifecycle: createConnectionLifecycle(),
  });
}

function createConnection(session: ReturnType<typeof createSession>) {
  return {
    context: session,
    readOnly: true,
    sendStateless: vi.fn(),
    sendCurrentAwareness: vi.fn(),
    close: vi.fn(),
  } as unknown as Connection;
}

function createPayload(connection: Connection, context: ReturnType<typeof createSession>) {
  return {
    connection,
    context,
    documentName: '11111111-1111-1111-1111-111111111111',
  } as unknown as connectedPayload;
}

describe('connection establishment', () => {
  it('releases verified traffic and sends the initial permission snapshot', async () => {
    const hook = createConnectionEstablishmentHook({
      isMetaRoom: () => false,
      getSessionState: vi.fn(),
      assertAnonymousPageAccess: vi.fn(),
      assertPageAccess: vi.fn().mockResolvedValue({ permission: 'edit', accessRevision: '2' }),
    });
    const session = createSession();
    const connection = createConnection(session);

    await hook(createPayload(connection, session));

    expect(session.lifecycle.traffic.gate.state).toBe('established');
    expect(session.lifecycle.traffic.deferInitialAwareness).toBe(false);
    expect(connection.sendStateless).toHaveBeenCalledWith(
      JSON.stringify({ type: 'permission_snapshot', permission: 'edit', accessRevision: '2' }),
    );
    expect(connection.sendCurrentAwareness).toHaveBeenCalledOnce();
    expect(connection.close).not.toHaveBeenCalled();
  });

  it('fails closed without sending a snapshot when permission verification denies access', async () => {
    const hook = createConnectionEstablishmentHook({
      isMetaRoom: () => false,
      getSessionState: vi.fn(),
      assertAnonymousPageAccess: vi.fn(),
      assertPageAccess: vi.fn().mockRejectedValue(new CollabAccessError('2')),
    });
    const session = createSession();
    const connection = createConnection(session);

    await hook(createPayload(connection, session));

    expect(session.lifecycle.traffic.gate.state).toBe('rejected');
    expect(connection.sendStateless).not.toHaveBeenCalled();
    expect(connection.sendCurrentAwareness).not.toHaveBeenCalled();
    expect(connection.close).toHaveBeenCalledWith({
      code: 4401,
      reason: 'Access revoked',
    });
  });
});
