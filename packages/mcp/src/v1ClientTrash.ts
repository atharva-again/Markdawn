import { z } from 'zod';
import {
  type McpActor,
  McpBackendError,
  type McpEmptied,
  type McpRequestOptions,
  type McpTrashList,
  mcpEmptiedSchema,
  mcpFolderTrashResponseSchema,
  mcpPageTrashResponseSchema,
  mcpTrashItemsSchema,
  mcpTrashListSchema,
} from './types';
import { isUuid, parseApiResponse } from './v1ClientResponse';
import type { V1ClientIO } from './v1ClientTransport';

type TrashType = 'page' | 'folder';

export class V1TrashClient {
  constructor(private readonly io: V1ClientIO) {}

  async listTrashed(
    actor: McpActor,
    options?: McpRequestOptions,
    type?: TrashType,
  ): Promise<McpTrashList> {
    const pageBodyPromise: Promise<unknown | undefined> =
      type === 'folder'
        ? Promise.resolve(undefined)
        : this.io
            .send(actor.token, '/trash/pages', {}, options?.signal)
            .then((response) => this.io.readJson(response));
    const folderBodyPromise: Promise<unknown | undefined> =
      type === 'page'
        ? Promise.resolve(undefined)
        : this.io
            .send(actor.token, '/trash/folders', {}, options?.signal)
            .then((response) => this.io.readJson(response));
    const [pageBody, folderBody] = await Promise.all([pageBodyPromise, folderBodyPromise]);
    const pageRows =
      pageBody === undefined ? [] : parseApiResponse(z.array(mcpPageTrashResponseSchema), pageBody);
    const folderRows =
      folderBody === undefined
        ? []
        : parseApiResponse(z.array(mcpFolderTrashResponseSchema), folderBody);
    const pages = pageRows.map((value) => ({
      id: value.id,
      type: 'page' as const,
      title: value.title,
      icon: value.icon,
      deletedAt: value.deletedAt,
    }));
    const folders = folderRows.map((value) => ({
      id: value.id,
      type: 'folder' as const,
      title: value.name,
      icon: value.icon,
      deletedAt: value.deletedAt,
    }));
    const items = parseApiResponse(
      mcpTrashItemsSchema,
      [...pages, ...folders].sort((left, right) =>
        (right.deletedAt ?? '').localeCompare(left.deletedAt ?? ''),
      ),
    );
    return parseApiResponse(mcpTrashListSchema, { items });
  }

  async emptyTrash(actor: McpActor, options?: McpRequestOptions): Promise<McpEmptied> {
    await this.io.discardResponse(
      await this.io.send(actor.token, '/trash/empty', { method: 'DELETE' }, options?.signal),
    );
    return parseApiResponse(mcpEmptiedSchema, { emptied: true });
  }

  resolveTrashReference(
    candidates: readonly McpTrashList['items'][number][],
    type: 'page' | 'folder',
    reference: string,
  ): { id: string } {
    const idMatch = candidates.find(
      (candidate) => candidate.id.toLowerCase() === reference.toLowerCase(),
    );
    if (idMatch) return { id: idMatch.id };

    const titleMatches = isUuid(reference)
      ? []
      : candidates.filter((candidate) => candidate.title.toLowerCase() === reference.toLowerCase());
    if (titleMatches.length === 0) {
      throw new McpBackendError(`No trashed ${type} ${JSON.stringify(reference)}`, 404, {
        code: 'not_found',
      });
    }
    if (titleMatches.length > 1) {
      throw new McpBackendError(
        `Trashed ${type} reference ${JSON.stringify(reference)} is ambiguous`,
        409,
        { code: `${type}_ambiguous` },
      );
    }
    const match = titleMatches[0];
    if (!match) throw new McpBackendError(`No trashed ${type}`, 404, { code: 'not_found' });
    return { id: match.id };
  }
}
