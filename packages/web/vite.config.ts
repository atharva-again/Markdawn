import { copyFileSync } from 'node:fs';
import path from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv, type Plugin } from 'vite';
import { copyEmojiData } from './vite/emojiDataPlugin';

const monorepoRoot = path.resolve(__dirname, '../../');

function copyInstallerScripts(): Plugin {
  return {
    name: 'copy-installer-scripts',
    apply: 'build',
    closeBundle() {
      copyFileSync(
        path.join(monorepoRoot, 'scripts', 'install-cli.sh'),
        path.join(monorepoRoot, 'packages', 'web', 'dist', 'install.sh'),
      );
      copyFileSync(
        path.join(monorepoRoot, 'scripts', 'install-cli.ps1'),
        path.join(monorepoRoot, 'packages', 'web', 'dist', 'install.ps1'),
      );
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, monorepoRoot, '');

  return {
    envDir: monorepoRoot,
    plugins: [react(), tailwindcss(), copyInstallerScripts(), copyEmojiData()],
    build: {
      rollupOptions: {
        output: {
          manualChunks: (id) => {
            if (id.includes('node_modules')) {
              if (id.includes('@milkdown') || id.includes('prosemirror')) {
                return 'editor';
              }
              if (id.includes('yjs') || id.includes('@hocuspocus')) {
                return 'collab';
              }

              if (id.includes('react') || id.includes('react-dom')) {
                return 'react';
              }
            }
          },
        },
      },
    },
    server: {
      proxy: {
        '/api': {
          target: env.VITE_API_URL ?? 'http://localhost:3001',
          changeOrigin: true,
        },
        '/collab': {
          target: 'http://localhost:1234',
          ws: true,
          changeOrigin: true,
          rewrite: (path: string) => path.replace(/^\/collab/, ''),
        },
      },
    },
  };
});
