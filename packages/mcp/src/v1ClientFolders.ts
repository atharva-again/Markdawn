import {
  type McpActor,
  McpBackendError,
  type McpFolder,
  type McpFolderList,
  type McpRequestOptions,
  mcpFolderListSchema,
  mcpFolderResolutionSchema,
} from './types';
import {
  asString,
  type FolderReference,
  folderOutput,
  isUuid,
  type JsonRecord,
  parseApiResponse,
} from './v1ClientResponse';
import type { V1ClientIO } from './v1ClientTransport';

export class V1FolderClient {
  constructor(private readonly io: V1ClientIO) {}

  async listFolders(
    actor: McpActor,
    input: { cursor?: string; limit?: number },
    options?: McpRequestOptions,
  ): Promise<McpFolderList> {
    const query = new URLSearchParams();
    if (input.cursor !== undefined) query.set('cursor', input.cursor);
    if (input.limit !== undefined) query.set('limit', String(input.limit));
    return parseApiResponse(
      mcpFolderListSchema,
      await this.io.readJson(
        await this.io.send(actor.token, `/folders?${query.toString()}`, {}, options?.signal),
      ),
    );
  }

  async createFolder(
    actor: McpActor,
    input: { name?: string; parentId?: string | null },
    options?: McpRequestOptions,
  ): Promise<McpFolder> {
    const body: JsonRecord = {};
    if (input.name !== undefined) body.name = input.name;
    if (input.parentId !== undefined) body.parentId = input.parentId;
    return this.io.readMutationJson(
      await this.io.send(
        actor.token,
        '/folders',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
        options?.signal,
      ),
      folderOutput,
    );
  }

  async updateFolder(
    actor: McpActor,
    reference: string,
    input: { name?: string },
    options?: McpRequestOptions,
  ): Promise<McpFolder> {
    const folder = await this.resolveFolder(actor, reference, options?.signal);
    return this.io.readMutationJson(
      await this.io.send(
        actor.token,
        `/folders/${folder.id}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: input.name }),
        },
        options?.signal,
      ),
      folderOutput,
    );
  }

  async resolveFolder(
    actor: McpActor,
    reference: string,
    signal?: AbortSignal,
  ): Promise<FolderReference> {
    if (isUuid(reference)) {
      const folder = folderOutput(
        await this.io.readJson(
          await this.io.send(actor.token, `/folders/${reference}`, {}, signal),
        ),
      );
      return { id: folder.id, folder };
    }
    const query = new URLSearchParams({ name: reference });
    const body = parseApiResponse(
      mcpFolderResolutionSchema,
      await this.io.readJson(
        await this.io.send(actor.token, `/folders/resolve?${query.toString()}`, {}, signal),
      ),
    );
    const rows = body.data;
    if (rows.length === 0) {
      throw new McpBackendError(`No folder named ${JSON.stringify(reference)}`, 404);
    }
    if (rows.length > 1) {
      throw new McpBackendError(`Folder reference ${JSON.stringify(reference)} is ambiguous`, 409, {
        code: 'folder_ambiguous',
        details: {
          candidates: rows.map((value) => {
            return {
              id: value.id,
              name: value.name,
              folderPath: value.folderPath,
            };
          }),
        },
      });
    }
    const row = rows[0];
    if (row === undefined) throw new McpBackendError('Folder not found', 404);
    const folder = folderOutput(row);
    return { id: asString(folder.id, 'id'), folder };
  }
}
