import { describe, expect, it } from 'vitest';
import { createCollabSession, isCollabSession } from './collabSession';
import { createConnectionLifecycle } from './connectionLifecycle';

function accountSession() {
  return createCollabSession({
    principal: {
      kind: 'account',
      user: {
        id: 'user-1',
        email: 'user-1@example.com',
        name: 'User One',
        avatarUrl: null,
      },
      credential: { kind: 'session', raw: 'session-1' },
    },
    permission: 'edit',
    accessRevision: '1',
    lifecycle: createConnectionLifecycle(),
  });
}

describe('collaboration session validation', () => {
  it('accepts a complete account session', () => {
    expect(isCollabSession(accountSession())).toBe(true);
  });

  it('rejects an unbranded session-shaped object', () => {
    const session = accountSession();
    expect(
      isCollabSession({
        principal: session.principal,
        permission: session.permission,
        accessRevision: session.accessRevision,
        lifecycle: session.lifecycle,
      }),
    ).toBe(false);
  });

  it('preserves the brand when Hocuspocus merges hook context', () => {
    expect(isCollabSession({ ...accountSession() })).toBe(true);
  });

  it('accepts a branded anonymous session', () => {
    const lifecycle = createConnectionLifecycle();
    expect(
      isCollabSession({
        principal: {
          kind: 'anonymous',
          user: { id: 'guest-1', name: 'Anonymous Fox' },
          sessionToken: 'guest-1',
        },
        permission: 'view',
        accessRevision: '1',
        lifecycle,
      }),
    ).toBe(false);
    expect(
      isCollabSession(
        createCollabSession({
          principal: {
            kind: 'anonymous',
            user: { id: 'guest-1', name: 'Anonymous Fox' },
            sessionToken: 'anon:guest-1',
          },
          permission: 'view',
          accessRevision: '1',
          lifecycle,
        }),
      ),
    ).toBe(true);
  });
});
