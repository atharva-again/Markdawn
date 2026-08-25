import { createHash } from 'node:crypto';
import {
  type McpActor,
  McpBackendError,
  type McpLifecycleBatch,
  type McpRequestOptions,
  type McpTrashList,
  mcpLifecycleBatchSchema,
} from './types';
import {
  asRecord,
  asString,
  errorCode,
  type FolderReference,
  type JsonRecord,
  lifecycleStatus,
  type PageReference,
  parseApiResponse,
} from './v1ClientResponse';
import type { V1ClientIO } from './v1ClientTransport';

type PageResolver = (
  actor: McpActor,
  reference: string,
  signal?: AbortSignal,
) => Promise<PageReference>;

type FolderResolver = (
  actor: McpActor,
  reference: string,
  signal?: AbortSignal,
) => Promise<FolderReference>;

type TrashResolver = {
  listTrashed: (
    actor: McpActor,
    options?: McpRequestOptions,
    type?: 'page' | 'folder',
  ) => Promise<McpTrashList>;
  resolveTrashReference: (
    candidates: readonly McpTrashList['items'][number][],
    type: 'page' | 'folder',
    reference: string,
  ) => { id: string };
};

type LifecycleActionResult = {
  id?: string;
  sourceId?: string;
  skippedRestrictedItems?: boolean;
};

const PAGE_LIFECYCLE_CONCURRENCY = 8;
const FOLDER_LIFECYCLE_CONCURRENCY = 8;

function copyItemIdempotencyKey(
  kind: 'page' | 'folder',
  batchKey: string,
  index: number,
  sourceId: string,
): string {
  return `mcp-copy-${createHash('sha256')
    .update(JSON.stringify({ kind, batchKey, index, sourceId }))
    .digest('hex')}`;
}

async function mapWithConcurrency<T, R>(
  values: readonly T[],
  worker: (value: T, index: number) => Promise<R>,
  concurrency: number,
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= values.length) return;
      const value = values[index];
      if (value === undefined) throw new Error('Lifecycle batch item is missing');
      results[index] = await worker(value, index);
    }
  });
  await Promise.all(workers);
  return results;
}

export class V1LifecycleClient {
  constructor(
    private readonly io: V1ClientIO,
    private readonly resolvePage: PageResolver,
    private readonly resolveFolder: FolderResolver,
    private readonly trash: TrashResolver,
  ) {}

  async movePages(
    actor: McpActor,
    references: readonly string[],
    parentId: string | null,
    options?: McpRequestOptions,
  ): Promise<McpLifecycleBatch> {
    return this.lifecycleBatch(
      references,
      (reference) => this.resolvePage(actor, reference, options?.signal),
      async (id) => {
        await this.io.discardResponse(
          await this.io.send(
            actor.token,
            `/pages/${id}/move`,
            {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ parentId }),
            },
            options?.signal,
          ),
        );
        return { id };
      },
      options?.signal,
      PAGE_LIFECYCLE_CONCURRENCY,
    );
  }

  async copyPages(
    actor: McpActor,
    references: readonly string[],
    parentId: string | null,
    idempotencyKey: string,
    options?: McpRequestOptions,
  ): Promise<McpLifecycleBatch> {
    return this.lifecycleBatch(
      references,
      (reference) => this.resolvePage(actor, reference, options?.signal),
      async (id, index) => {
        const result = await this.io.readMutationJson(
          await this.io.send(
            actor.token,
            `/pages/${id}/copy`,
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Idempotency-Key': copyItemIdempotencyKey('page', idempotencyKey, index, id),
              },
              body: JSON.stringify({ parentId }),
            },
            options?.signal,
          ),
          (value) => {
            const record = asRecord(value);
            return { id: asString(record.id, 'id') };
          },
        );
        return { id: result.id, sourceId: id };
      },
      options?.signal,
      PAGE_LIFECYCLE_CONCURRENCY,
    );
  }

  async trashPages(
    actor: McpActor,
    references: readonly string[],
    options?: McpRequestOptions,
  ): Promise<McpLifecycleBatch> {
    return this.lifecycleBatch(
      references,
      (reference) => this.resolvePage(actor, reference, options?.signal),
      async (id) => {
        await this.io.discardResponse(
          await this.io.send(
            actor.token,
            `/pages/${id}/trash`,
            { method: 'DELETE' },
            options?.signal,
          ),
        );
        return { id };
      },
      options?.signal,
      PAGE_LIFECYCLE_CONCURRENCY,
    );
  }

  async moveFolders(
    actor: McpActor,
    references: readonly string[],
    parentId: string | null,
    options?: McpRequestOptions,
  ): Promise<McpLifecycleBatch> {
    return this.lifecycleBatch(
      references,
      (reference) => this.resolveFolder(actor, reference, options?.signal),
      async (id) => {
        await this.io.discardResponse(
          await this.io.send(
            actor.token,
            `/folders/${id}`,
            {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ parentId }),
            },
            options?.signal,
          ),
        );
        return { id };
      },
      options?.signal,
      FOLDER_LIFECYCLE_CONCURRENCY,
    );
  }

  async copyFolders(
    actor: McpActor,
    references: readonly string[],
    parentId: string | null,
    idempotencyKey: string,
    options?: McpRequestOptions,
  ): Promise<McpLifecycleBatch> {
    return this.lifecycleBatch(
      references,
      (reference) => this.resolveFolder(actor, reference, options?.signal),
      async (id, index) => {
        const result = await this.io.readMutationJson(
          await this.io.send(
            actor.token,
            `/folders/${id}/copy`,
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Idempotency-Key': copyItemIdempotencyKey('folder', idempotencyKey, index, id),
              },
              body: JSON.stringify({ parentId }),
            },
            options?.signal,
          ),
          (value) => {
            const record = asRecord(value);
            return {
              id: asString(record.id, 'id'),
              skippedRestrictedItems: record.skippedRestrictedItems === true,
            };
          },
        );
        return {
          id: result.id,
          sourceId: id,
          ...(result.skippedRestrictedItems ? { skippedRestrictedItems: true } : {}),
        };
      },
      options?.signal,
      FOLDER_LIFECYCLE_CONCURRENCY,
    );
  }

  async trashFolders(
    actor: McpActor,
    references: readonly string[],
    force: boolean,
    options?: McpRequestOptions,
  ): Promise<McpLifecycleBatch> {
    return this.lifecycleBatch(
      references,
      (reference) => this.resolveFolder(actor, reference, options?.signal),
      async (id) => {
        await this.io.discardResponse(
          await this.io.send(
            actor.token,
            `/folders/${id}/trash?force=${String(force)}`,
            { method: 'DELETE' },
            options?.signal,
          ),
        );
        return { id };
      },
      options?.signal,
      FOLDER_LIFECYCLE_CONCURRENCY,
    );
  }

  async restoreTrash(
    actor: McpActor,
    type: 'page' | 'folder',
    references: readonly string[],
    options?: McpRequestOptions,
  ): Promise<McpLifecycleBatch> {
    return this.trashLifecycleBatch(actor, type, references, 'restore', options?.signal);
  }

  async deleteTrash(
    actor: McpActor,
    type: 'page' | 'folder',
    references: readonly string[],
    options?: McpRequestOptions,
  ): Promise<McpLifecycleBatch> {
    return this.trashLifecycleBatch(actor, type, references, 'permanent', options?.signal);
  }

  private async lifecycleBatch(
    references: readonly string[],
    resolve: (reference: string) => Promise<{ id: string }>,
    action: (id: string, index: number) => Promise<LifecycleActionResult>,
    signal?: AbortSignal,
    concurrency = PAGE_LIFECYCLE_CONCURRENCY,
  ): Promise<McpLifecycleBatch> {
    const items = await mapWithConcurrency(
      references,
      async (reference, index): Promise<JsonRecord> => {
        signal?.throwIfAborted();
        try {
          const resolved = await resolve(reference);
          signal?.throwIfAborted();
          const result = await action(resolved.id, index);
          return {
            reference,
            id: result.id ?? resolved.id,
            ...(result.sourceId ? { sourceId: result.sourceId } : {}),
            status: 'success',
            ...(result.skippedRestrictedItems ? { skippedRestrictedItems: true } : {}),
          };
        } catch (error) {
          if (signal?.aborted) throw signal.reason ?? error;
          return {
            reference,
            status: lifecycleStatus(error),
            message:
              error instanceof McpBackendError ? error.message : 'Lifecycle operation failed',
            ...(errorCode(error) ? { code: errorCode(error) } : {}),
          };
        }
      },
      concurrency,
    );
    return parseApiResponse(mcpLifecycleBatchSchema, { items });
  }

  private async trashLifecycleBatch(
    actor: McpActor,
    type: 'page' | 'folder',
    references: readonly string[],
    operation: 'restore' | 'permanent',
    signal?: AbortSignal,
  ): Promise<McpLifecycleBatch> {
    const trash = await this.trash.listTrashed(actor, { signal }, type);
    const candidates = trash.items.filter((item) => item.type === type);
    return this.lifecycleBatch(
      references,
      async (reference) => this.trash.resolveTrashReference(candidates, type, reference),
      async (id) => {
        const path = type === 'page' ? `/pages/${id}/${operation}` : `/folders/${id}/${operation}`;
        await this.io.discardResponse(
          await this.io.send(
            actor.token,
            path,
            { method: operation === 'restore' ? 'PATCH' : 'DELETE' },
            signal,
          ),
        );
        return { id };
      },
      signal,
      type === 'page' ? PAGE_LIFECYCLE_CONCURRENCY : FOLDER_LIFECYCLE_CONCURRENCY,
    );
  }
}
