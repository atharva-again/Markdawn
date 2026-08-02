import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const emojiDataRoot = path.join(path.dirname(require.resolve('emojibase-data/package.json')), 'en');

export const emojiDataFiles = [
  {
    requestPath: '/emojibase-data/en/data.json',
    fileName: 'emojibase-data/en/data.json',
    sourcePath: path.join(emojiDataRoot, 'data.json'),
  },
  {
    requestPath: '/emojibase-data/en/messages.json',
    fileName: 'emojibase-data/en/messages.json',
    sourcePath: path.join(emojiDataRoot, 'messages.json'),
  },
] as const;
