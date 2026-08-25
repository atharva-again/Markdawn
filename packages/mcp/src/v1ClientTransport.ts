import { MCP_INTERNAL_AUTH_HEADER } from '@markdawn/shared/node/mcp-internal-auth';
import { McpBackendError } from './types';
import { responseErrorBody } from './v1ClientResponse';

export type V1ClientRequestOptions = {
  method?: string;
  headers?: HeadersInit;
  body?: BodyInit;
};

export type V1ClientIO = {
  send: (
    token: string,
    path: string,
    options?: V1ClientRequestOptions,
    signal?: AbortSignal,
  ) => Promise<Response>;
  readJson: (response: Response, mutationResponse?: boolean) => Promise<unknown>;
  readMutationJson: <T>(response: Response, parse: (value: unknown) => T) => Promise<T>;
  readBytes: (response: Response, signal?: AbortSignal) => Promise<Buffer>;
  readBinaryOrMarkdown: (
    response: Response,
    contentType: string,
    signal?: AbortSignal,
  ) => Promise<Buffer | string>;
  discardResponse: (response: Response) => Promise<void>;
};

export type V1ClientTransportOptions = {
  baseUrl: string;
  fetcher?: typeof fetch;
};

export class V1ClientTransport {
  private readonly baseUrl: string;
  private readonly fetcher: typeof fetch;

  constructor(options: V1ClientTransportOptions) {
    const base = new URL(options.baseUrl);
    this.baseUrl = base.toString().replace(/\/$/, '');
    this.fetcher = options.fetcher ?? fetch;
  }

  protected async readBinaryOrMarkdown(
    response: Response,
    contentType: string,
    signal?: AbortSignal,
  ): Promise<Buffer | string> {
    const bytes = await this.readBytes(response, signal);
    if (contentType.toLowerCase().startsWith('text/markdown')) {
      try {
        return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      } catch (error) {
        throw new McpBackendError('Markdawn export returned invalid UTF-8', 503, {
          code: 'invalid_upstream_response',
          details: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return bytes;
  }

  protected async readMutationJson<T>(
    response: Response,
    parse: (value: unknown) => T,
  ): Promise<T> {
    try {
      return parse(await this.readJson(response, true));
    } catch (error) {
      if (error instanceof McpBackendError && error.code === 'outcome_uncertain') {
        throw error;
      }
      const details = error instanceof McpBackendError ? error.details : error;
      throw new McpBackendError('Mutation response was invalid; outcome is uncertain', 503, {
        code: 'outcome_uncertain',
        details,
      });
    }
  }

  protected async readBytes(response: Response, signal?: AbortSignal): Promise<Buffer> {
    if (!response.body) return Buffer.alloc(0);
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
      for (;;) {
        signal?.throwIfAborted();
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        chunks.push(value);
      }
    } catch (error) {
      if (signal?.aborted) throw signal.reason ?? error;
      throw new McpBackendError('Markdawn export response could not be read', 503, {
        code: 'invalid_upstream_response',
        details: error instanceof Error ? error.message : String(error),
      });
    } finally {
      reader.releaseLock();
    }

    const result = Buffer.allocUnsafe(total);
    let offset = 0;
    for (const chunk of chunks) {
      result.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return result;
  }

  protected async discardResponse(response: Response): Promise<void> {
    try {
      await response.body?.cancel();
    } catch (error) {
      throw new McpBackendError(
        'Mutation response could not be drained; outcome is uncertain',
        503,
        {
          code: 'outcome_uncertain',
          details: error instanceof Error ? error.message : String(error),
        },
      );
    }
  }

  protected async send(
    token: string,
    path: string,
    options: V1ClientRequestOptions = {},
    signal?: AbortSignal,
  ): Promise<Response> {
    const headers = new Headers(options.headers);
    // The OAuth bearer token terminates at MCP. Only the signed private
    // MCP-to-API context crosses this service boundary.
    headers.delete('Authorization');
    headers.set(MCP_INTERNAL_AUTH_HEADER, token);
    headers.set('Accept', headers.get('Accept') ?? 'application/json');
    const method = (options.method ?? 'GET').toUpperCase();
    const mutationMayHaveCommitted = method !== 'GET' && method !== 'HEAD';
    const retrySafe = (headers.get('Idempotency-Key')?.trim().length ?? 0) > 0;
    const request: RequestInit = {
      method,
      headers,
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(30_000)])
        : AbortSignal.timeout(30_000),
    };
    if (options.body !== undefined) request.body = options.body;
    let response: Response;
    try {
      response = await this.fetcher(`${this.baseUrl}${path}`, request);
    } catch (error) {
      if (signal?.aborted) throw signal.reason ?? error;
      const details = error instanceof Error ? error.message : String(error);
      if (mutationMayHaveCommitted && !retrySafe) {
        throw new McpBackendError(
          'Mutation outcome is uncertain; do not retry automatically',
          503,
          { code: 'outcome_uncertain', details },
        );
      }
      throw new McpBackendError('Markdawn API is unavailable', 503, {
        code: 'service_unavailable',
        details,
      });
    }
    if (!response.ok) {
      let body: unknown;
      try {
        body = await response.json();
      } catch (error) {
        const uncertain = mutationMayHaveCommitted && !retrySafe && response.status >= 500;
        throw new McpBackendError(
          uncertain
            ? 'Mutation error response was invalid; outcome is uncertain'
            : 'Markdawn API returned invalid JSON error response',
          503,
          {
            code: uncertain ? 'outcome_uncertain' : 'invalid_upstream_response',
            details: error instanceof Error ? error.message : String(error),
          },
        );
      }
      const error = responseErrorBody(body);
      if (response.status === 401) {
        throw new McpBackendError('MCP access token is no longer valid', 401, {
          code: 'invalid_token',
          ...(error.details === undefined ? {} : { details: error.details }),
        });
      }
      const responseCode =
        mutationMayHaveCommitted && !retrySafe && response.status >= 500
          ? 'outcome_uncertain'
          : error.code;
      throw new McpBackendError(error.message, response.status, {
        ...(responseCode ? { code: responseCode } : {}),
        ...(error.details === undefined ? {} : { details: error.details }),
      });
    }
    return response;
  }

  protected async readJson(response: Response, mutationResponse = false): Promise<unknown> {
    try {
      return (await response.json()) as unknown;
    } catch (error) {
      throw new McpBackendError(
        mutationResponse
          ? 'Mutation response was invalid; outcome is uncertain'
          : 'Markdawn API returned invalid JSON',
        503,
        {
          code: mutationResponse ? 'outcome_uncertain' : 'invalid_upstream_response',
          details: error instanceof Error ? error.message : String(error),
        },
      );
    }
  }
}
