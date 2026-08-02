import { readFileSync, statSync } from 'node:fs';
import type { Plugin } from 'vite';
import { emojiDataFiles } from './emojiDataFiles';

export function copyEmojiData(): Plugin {
  return {
    name: 'copy-emoji-data',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const requestPath = request.url?.split('?')[0];
        const file = emojiDataFiles.find(
          ({ requestPath: expectedPath }) => expectedPath === requestPath,
        );

        if (!file) {
          next();
          return;
        }

        if (request.method !== 'GET' && request.method !== 'HEAD') {
          response.statusCode = 405;
          response.setHeader('Allow', 'GET, HEAD');
          response.end();
          return;
        }

        const stats = statSync(file.sourcePath);
        const etag = `"${stats.size.toString(16)}-${Math.trunc(stats.mtimeMs).toString(16)}"`;
        const lastModified = stats.mtime.toUTCString();
        response.setHeader('Content-Type', 'application/json');
        response.setHeader('Cache-Control', 'no-cache');
        response.setHeader('ETag', etag);
        response.setHeader('Last-Modified', lastModified);

        if (request.headers['if-none-match'] === etag) {
          response.statusCode = 304;
          response.end();
          return;
        }

        response.end(request.method === 'HEAD' ? undefined : readFileSync(file.sourcePath));
      });
    },
    generateBundle() {
      for (const file of emojiDataFiles) {
        this.emitFile({
          type: 'asset',
          fileName: file.fileName,
          source: readFileSync(file.sourcePath),
        });
      }
    },
  };
}
