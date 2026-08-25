import { defineConfig } from 'astro/config';

export default defineConfig({
  site: 'https://markdawn.space',
  output: 'static',
  server: {
    port: 8888,
  },
});
