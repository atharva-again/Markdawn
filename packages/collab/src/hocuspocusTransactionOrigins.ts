import type { LocalTransactionOrigin } from '@hocuspocus/server';

/** Server-owned Yjs changes that are already persisted or derived elsewhere. */
export const SKIP_STORE_LOCAL_ORIGIN = Object.freeze({
  source: 'local',
  skipStoreHooks: true,
} satisfies LocalTransactionOrigin);
