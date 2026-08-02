import { statSync } from 'node:fs';
import type { OutputBundle, OutputOptions, PluginContext } from 'rollup';
import type { ViteDevServer } from 'vite';
import { describe, expect, it, vi } from 'vitest';
import { emojiDataFiles } from './emojiDataFiles';
import { copyEmojiData } from './emojiDataPlugin';

type TestRequest = {
  headers: Record<string, string | undefined>;
  method?: string;
  url?: string;
};

type TestResponse = {
  end: ReturnType<typeof vi.fn>;
  headers: Map<string, string>;
  setHeader: (name: string, value: string) => void;
  statusCode: number;
};

type TestMiddleware = (request: TestRequest, response: TestResponse, next: () => void) => void;

function createResponse(): TestResponse {
  const headers = new Map<string, string>();
  return {
    end: vi.fn(),
    headers,
    setHeader(name, value) {
      headers.set(name, value);
    },
    statusCode: 200,
  };
}

function getMiddleware(): TestMiddleware {
  let middleware: TestMiddleware | undefined;
  const use = (handler: TestMiddleware) => {
    middleware = handler;
  };
  const server = { middlewares: { use } } as unknown as ViteDevServer;
  const configureServer = copyEmojiData().configureServer;

  if (typeof configureServer !== 'function') {
    throw new Error('copyEmojiData must register a development server middleware');
  }

  configureServer(server);
  if (!middleware) throw new Error('copyEmojiData did not register a middleware');
  return middleware;
}

describe('copyEmojiData', () => {
  it('emits the self-hosted data files with their public paths', () => {
    const emitFile = vi.fn();
    const plugin = copyEmojiData();

    if (typeof plugin.generateBundle !== 'function') {
      throw new Error('copyEmojiData must emit assets during build');
    }

    plugin.generateBundle.call(
      { emitFile } as unknown as PluginContext,
      {} as OutputOptions,
      {} as OutputBundle,
    );

    expect(emitFile).toHaveBeenCalledTimes(2);
    emojiDataFiles.forEach((file, index) => {
      expect(emitFile).toHaveBeenNthCalledWith(
        index + 1,
        expect.objectContaining({
          fileName: file.fileName,
          type: 'asset',
        }),
      );
      expect(statSync(file.sourcePath).size).toBeGreaterThan(0);
    });
  });

  it('serves matching development requests with cache validators', () => {
    const middleware = getMiddleware();
    const response = createResponse();

    middleware(
      {
        headers: {},
        method: 'HEAD',
        url: '/emojibase-data/en/data.json?cache=1',
      },
      response,
      vi.fn(),
    );

    expect(response.headers.get('Content-Type')).toBe('application/json');
    expect(response.headers.get('Cache-Control')).toBe('no-cache');
    expect(response.headers.get('ETag')).toBeTruthy();
    expect(response.headers.get('Last-Modified')).toBeTruthy();
    expect(response.end).toHaveBeenCalledWith(undefined);
  });

  it('returns 304 for matching validators and rejects unsupported paths or methods', () => {
    const middleware = getMiddleware();
    const firstResponse = createResponse();

    middleware(
      { headers: {}, method: 'GET', url: '/emojibase-data/en/messages.json' },
      firstResponse,
      vi.fn(),
    );
    const etag = firstResponse.headers.get('ETag');
    if (!etag) throw new Error('Expected the emoji data response to include an ETag');

    const cachedResponse = createResponse();
    middleware(
      {
        headers: { 'if-none-match': etag },
        method: 'GET',
        url: '/emojibase-data/en/messages.json',
      },
      cachedResponse,
      vi.fn(),
    );
    expect(cachedResponse.statusCode).toBe(304);
    expect(cachedResponse.end).toHaveBeenCalledWith();

    const methodResponse = createResponse();
    middleware(
      { headers: {}, method: 'POST', url: '/emojibase-data/en/messages.json' },
      methodResponse,
      vi.fn(),
    );
    expect(methodResponse.statusCode).toBe(405);
    expect(methodResponse.headers.get('Allow')).toBe('GET, HEAD');

    const next = vi.fn();
    middleware({ headers: {}, method: 'GET', url: '/other.json' }, createResponse(), next);
    expect(next).toHaveBeenCalledOnce();
  });
});
