import { HocuspocusProvider, HocuspocusProviderWebsocket } from '@hocuspocus/provider';
import type { connectedPayload, Document, Server } from '@hocuspocus/server';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import WebSocket from 'ws';
import * as Y from 'yjs';
import type { CollabSession } from './collabSession';
import { getSessionUser, isAnonymousSession } from './collabSession';
import { encodeAuthenticationMessage } from './collabTestUtils';
import { createCollabServer } from './server';
import {
  canonicalTestAwarenessUser,
  createAuthenticatePayload,
  createConnectionConfig,
  decodeProtocolMessageType,
  encodeYjsUpdateMessage,
  expectAuthenticationFailure,
  createMockLogger as mockLogger,
  sleep,
  waitFor,
} from './serverTestHarness';
import { createTestPage, createTestSession, createTestUser, getTestPool } from './test-utils';

describe('collab server authentication hooks', () => {
  const pool = getTestPool();
  const logger = mockLogger();
  let server: Server;
  let port: number;
  beforeAll(async () => {
    server = createCollabServer({
      port: 0,
      internalSecret: 'test-collaboration-internal-secret',
      pool,
      logger,
      debounceMs: 50,
      maxDebounceMs: 100,
      permissionRevalidationMs: 0,
    });
    await server.listen();
    port = (server as unknown as { address: { port: number } }).address.port;
  });
  afterAll(async () => {
    await server.destroy();
    await pool.end();
  });

  describe('onAuthenticate', () => {
    it('rejects connection without a token', async () => {
      await expectAuthenticationFailure(port);
    });

    it('rejects connection with an invalid token', async () => {
      await expectAuthenticationFailure(port, 'this-token-does-not-exist');
    });

    it('rejects connection with an expired session token', async () => {
      const user = await createTestUser(pool);
      const sessionId = crypto.randomUUID();
      const token = crypto.randomUUID();

      await pool.query(
        `INSERT INTO sessions (id, token, expires_at, created_at, updated_at, user_id)
         VALUES ($1, $2, NOW() - INTERVAL '1 day', NOW(), NOW(), $3)`,
        [sessionId, token, user.id],
      );

      await expectAuthenticationFailure(port, token);
    });

    it('authenticates with bearer token from request headers', async () => {
      const user = await createTestUser(pool);
      const session = await createTestSession(pool, user.id);
      const page = await createTestPage(pool, user.id);

      const payload = createAuthenticatePayload(server, {
        documentName: page.id,
        requestHeaders: {
          authorization: `Bearer ${session.token}`,
        },
      });

      const result = await server.hocuspocus.hooks('onAuthenticate', payload);
      const authenticated = result as CollabSession;
      expect(getSessionUser(authenticated).id).toBe(user.id);
    });

    it('authenticates with better-auth session cookie', async () => {
      const user = await createTestUser(pool);
      const session = await createTestSession(pool, user.id);
      const page = await createTestPage(pool, user.id);

      const payload = createAuthenticatePayload(server, {
        documentName: page.id,
        requestHeaders: {
          cookie: `better-auth.session_token=${session.token}`,
        },
      });

      const result = await server.hocuspocus.hooks('onAuthenticate', payload);
      const authenticated = result as CollabSession;
      expect(getSessionUser(authenticated).id).toBe(user.id);
    });

    it('authenticates with secure better-auth session cookie', async () => {
      const user = await createTestUser(pool);
      const session = await createTestSession(pool, user.id);
      const page = await createTestPage(pool, user.id);

      const payload = createAuthenticatePayload(server, {
        documentName: page.id,
        requestHeaders: {
          cookie: `__Secure-better-auth.session_token=${session.token}`,
        },
      });

      const result = await server.hocuspocus.hooks('onAuthenticate', payload);
      const authenticated = result as CollabSession;
      expect(getSessionUser(authenticated).id).toBe(user.id);
    });

    it('allows anonymous access to pages public through an ancestor folder', async () => {
      const owner = await createTestUser(pool);
      const folderId = crypto.randomUUID();
      await pool.query(
        `insert into folders (
           id, parent_id, name, position, created_by, public_permission, created_at, updated_at
         ) values ($1, null, 'Public Folder', '0', $2, 'view', now(), now())`,
        [folderId, owner.id],
      );
      const page = await createTestPage(pool, owner.id, 'Folder Public Page');
      await pool.query('update pages set parent_id = $1 where id = $2', [folderId, page.id]);

      const anonymousId = crypto.randomUUID();
      const connectionConfig = createConnectionConfig();
      const payload = createAuthenticatePayload(server, {
        documentName: page.id,
        token: `anon:${anonymousId}`,
        connectionConfig,
      });

      const result = await server.hocuspocus.hooks('onAuthenticate', payload);
      const authenticated = result as CollabSession;
      expect(getSessionUser(authenticated).id).toBe(anonymousId);
      expect(isAnonymousSession(authenticated)).toBe(true);
      expect(authenticated.permission).toBe('view');
      expect(connectionConfig.readOnly).toBe(true);
    });

    it('emits an authoritative revisioned permission snapshot on every connection', async () => {
      const user = await createTestUser(pool);
      const session = await createTestSession(pool, user.id);
      const page = await createTestPage(pool, user.id);
      const context = (await server.hocuspocus.hooks(
        'onAuthenticate',
        createAuthenticatePayload(server, { documentName: page.id, token: session.token }),
      )) as {
        permission: 'view' | 'edit' | 'admin';
        accessRevision: string;
      };
      const connection = {
        sendStateless: vi.fn(),
        close: vi.fn(),
      } as unknown as connectedPayload['connection'];

      await server.hocuspocus.hooks('connected', {
        context,
        documentName: page.id,
        instance: server.hocuspocus,
        request: {} as connectedPayload['request'],
        requestHeaders: {},
        requestParameters: new URLSearchParams(),
        socketId: crypto.randomUUID(),
        connectionConfig: createConnectionConfig(),
        connection,
      });

      expect(context.accessRevision).toMatch(/^\d+$/);
      expect(connection.sendStateless).toHaveBeenCalledWith(
        JSON.stringify({
          type: 'permission_snapshot',
          permission: context.permission,
          accessRevision: context.accessRevision,
        }),
      );
    });

    it('orders delayed permission delivery by durable access revision', async () => {
      const owner = await createTestUser(pool);
      const editor = await createTestUser(pool);
      const page = await createTestPage(pool, owner.id);
      await pool.query(
        `insert into shares (entity_type, entity_id, shared_by, recipient_user_id, permission)
         values ('page', $1, $2, $3, 'edit')`,
        [page.id, owner.id, editor.id],
      );
      const blocker = await pool.connect();
      const delayedReader = await pool.connect();
      const mutationClient = await pool.connect();
      let mutationCommitted = false;
      const barrierKey = BigInt(
        `0x${crypto.randomUUID().replaceAll('-', '').slice(0, 15)}`,
      ).toString();

      try {
        await blocker.query('select pg_advisory_lock($1::bigint)', [barrierKey]);
        await mutationClient.query('begin');
        await mutationClient.query(
          `insert into workspace_access_versions (workspace_owner_id, version)
           values ($1, nextval('workspace_access_revision_seq'))
           on conflict (workspace_owner_id) do update
           set version = nextval('workspace_access_revision_seq')`,
          [owner.id],
        );
        await mutationClient.query(
          `update shares set permission = 'view'
           where entity_type = 'page' and entity_id = $1 and recipient_user_id = $2`,
          [page.id, editor.id],
        );
        const delayedResultPromise = delayedReader.query<{
          permission: string | null;
          access_revision: string;
        }>(
          `with barrier as materialized (
             select pg_advisory_lock($3::bigint)
           ), permission_snapshot as materialized (
             select get_page_access_revision($1)::text as access_revision
             from barrier
           )
           select access.permission, permission_snapshot.access_revision
           from permission_snapshot
           left join lateral get_effective_page_permission($1, $2) access on true`,
          [page.id, editor.id, barrierKey],
        );
        const delayedReaderPid = (delayedReader as unknown as { processID: number }).processID;
        await waitFor(
          async () => {
            const waiting = await pool.query<{ waiting: boolean }>(
              `select exists (
                 select 1 from pg_locks
                 where pid = $1 and locktype = 'advisory' and granted = false
               ) as waiting`,
              [delayedReaderPid],
            );
            return waiting.rows[0]?.waiting === true;
          },
          5_000,
          'pre-revoke permission query to reach the advisory barrier',
        );

        await mutationClient.query('commit');
        mutationCommitted = true;
        const currentResult = await pool.query<{
          permission: string | null;
          access_revision: string;
        }>(
          `select access.permission,
                  get_page_access_revision($1)::text as access_revision
           from get_effective_page_permission($1, $2) access`,
          [page.id, editor.id],
        );

        await blocker.query('select pg_advisory_unlock($1::bigint)', [barrierKey]);
        const delayedResult = await delayedResultPromise;
        await delayedReader.query('select pg_advisory_unlock($1::bigint)', [barrierKey]);

        expect(delayedResult.rows[0]?.permission).toBe('edit');
        expect(currentResult.rows[0]?.permission).toBe('view');
        expect(BigInt(delayedResult.rows[0]?.access_revision ?? '0')).toBeLessThan(
          BigInt(currentResult.rows[0]?.access_revision ?? '0'),
        );
      } finally {
        if (!mutationCommitted) await mutationClient.query('rollback').catch(() => undefined);
        await blocker.query('select pg_advisory_unlock($1::bigint)', [barrierKey]);
        await delayedReader.query('select pg_advisory_unlock($1::bigint)', [barrierKey]);
        blocker.release();
        delayedReader.release();
        mutationClient.release();
      }
    });

    it('quarantines all outbound document traffic until the post-auth access check succeeds', async () => {
      const owner = await createTestUser(pool);
      const editor = await createTestUser(pool);
      const page = await createTestPage(pool, owner.id);
      const ownerSession = await createTestSession(pool, owner.id);
      const editorSession = await createTestSession(pool, editor.id);
      await pool.query(
        `insert into shares (entity_type, entity_id, shared_by, recipient_user_id, permission)
         values ('page', $1, $2, $3, 'edit')`,
        [page.id, owner.id, editor.id],
      );

      let editorAccessChecks = 0;
      let releaseConnectedCheck: (() => void) | undefined;
      let markConnectedCheckReached: (() => void) | undefined;
      const connectedCheckReached = new Promise<void>((resolve) => {
        markConnectedCheckReached = resolve;
      });
      const connectedCheckRelease = new Promise<void>((resolve) => {
        releaseConnectedCheck = resolve;
      });
      const gatedPool = new Proxy(pool, {
        get(target, property) {
          if (property === 'query') {
            return async (text: string, values?: unknown[]) => {
              const result = await target.query(text, values);
              if (
                text.includes('get_effective_page_permission') &&
                Array.isArray(values?.[1]) &&
                values[1].includes(editor.id) &&
                ++editorAccessChecks === 2
              ) {
                markConnectedCheckReached?.();
                await connectedCheckRelease;
              }
              return result;
            };
          }
          const value: unknown = Reflect.get(target, property, target);
          return typeof value === 'function' ? value.bind(target) : value;
        },
      });
      const gatedServer = createCollabServer({
        port: 0,
        internalSecret: 'test-collaboration-internal-secret',
        pool: gatedPool,
        logger: mockLogger(),
        permissionRevalidationMs: 0,
      });
      await gatedServer.listen();
      const gatedPort = (gatedServer as unknown as { address: { port: number } }).address.port;
      const ownerDocument = new Y.Doc();
      const ownerProvider = new HocuspocusProvider({
        url: `ws://localhost:${gatedPort}`,
        name: page.id,
        document: ownerDocument,
        token: ownerSession.token,
      });
      let racedSocket: WebSocket | undefined;

      try {
        await waitFor(() => ownerProvider.synced, 5_000, 'owner provider to establish the room');

        const receivedTypes: number[] = [];
        let resolveProtocolClose: (() => void) | undefined;
        const protocolClose = new Promise<void>((resolve) => {
          resolveProtocolClose = resolve;
        });
        racedSocket = new WebSocket(`ws://localhost:${gatedPort}`);
        racedSocket.on('message', (data) => {
          const bytes = Array.isArray(data)
            ? new Uint8Array(Buffer.concat(data))
            : data instanceof ArrayBuffer
              ? new Uint8Array(data)
              : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
          const messageType = decodeProtocolMessageType(bytes);
          receivedTypes.push(messageType);
          if (messageType === 7) resolveProtocolClose?.();
        });
        await new Promise<void>((resolve, reject) => {
          racedSocket?.once('open', resolve);
          racedSocket?.once('error', reject);
        });
        racedSocket.send(encodeAuthenticationMessage(page.id, editorSession.token));
        racedSocket.send(
          encodeYjsUpdateMessage(page.id, Y.encodeStateVector(new Y.Doc()), { syncType: 0 }),
        );

        await Promise.race([
          connectedCheckReached,
          sleep(5_000).then(() => {
            throw new Error('Timed out waiting for the post-auth connected check');
          }),
        ]);

        await pool.query(
          `delete from shares
           where entity_type = 'page' and entity_id = $1 and recipient_user_id = $2`,
          [page.id, editor.id],
        );

        ownerDocument.getText('content').insert(0, 'must never reach revoked socket');
        const activeDocument = gatedServer.hocuspocus.documents.get(page.id) as
          | Document
          | undefined;
        expect(activeDocument).toBeDefined();
        await waitFor(
          () => activeDocument?.getText('content').toString() === 'must never reach revoked socket',
          5_000,
          'established editor update to reach the server document',
        );
        activeDocument?.awareness.setLocalState({
          user: canonicalTestAwarenessUser(owner.id),
        });
        activeDocument?.broadcastStateless('must never reach revoked socket');
        await sleep(50);

        expect(receivedTypes.filter((type) => [0, 1, 3, 4, 5, 6, 8].includes(type))).toEqual([]);

        const provisionalConnection = activeDocument?.getConnections().find((connection) => {
          const context = connection.context as CollabSession | undefined;
          return context?.principal && getSessionUser(context).id === editor.id;
        });
        expect(provisionalConnection).toBeDefined();
        provisionalConnection?.close({ code: 4401, reason: 'Access revoked' });
        await Promise.race([
          protocolClose,
          sleep(5_000).then(() => {
            throw new Error('Timed out waiting for raced connection close');
          }),
        ]);

        releaseConnectedCheck?.();
        await sleep(50);
        expect(receivedTypes.filter((type) => [0, 1, 3, 4, 5, 6, 8].includes(type))).toEqual([]);
        expect(receivedTypes).toContain(2);
        expect(receivedTypes.at(-1)).toBe(7);
        activeDocument?.awareness.setLocalState(null);
      } finally {
        releaseConnectedCheck?.();
        racedSocket?.terminate();
        ownerProvider.destroy();
        await gatedServer.destroy();
      }
    });

    it('authenticates via WebSocket handshake with cookie header', async () => {
      const user = await createTestUser(pool);
      const session = await createTestSession(pool, user.id);
      const page = await createTestPage(pool, user.id);
      const websocketProvider = new HocuspocusProviderWebsocket({
        url: `ws://localhost:${port}`,
        WebSocketPolyfill: class extends WebSocket {
          constructor(url: string, protocols?: string | string[]) {
            const options = {
              headers: { cookie: `better-auth.session_token=${session.token}` },
            };
            if (protocols === undefined) {
              super(url, options);
              return;
            }
            super(url, protocols, options);
          }
        },
      });

      const provider = new HocuspocusProvider({
        name: page.id,
        document: new Y.Doc(),
        websocketProvider,
      });

      try {
        provider.attach();
        await waitFor(() => provider.synced, 5_000, 'cookie-auth provider to sync');
        expect(provider.isAuthenticated).toBe(true);
      } finally {
        provider.destroy();
        websocketProvider.destroy();
      }
    });
  });
});
