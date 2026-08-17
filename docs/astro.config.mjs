import starlight from '@astrojs/starlight';
import { defineConfig } from 'astro/config';
import starlightOpenAPI, { openAPISidebarGroups } from 'starlight-openapi';

const inlineCodeStylesPlugin = {
  name: 'markdawn-inline-code-styles',
  hooks: {
    'config:setup': ({ command, config, updateConfig }) => {
      if (command !== 'build') return;
      // Apply after starlight-openapi so its config update does not restore external styles.
      const expressiveCode = typeof config.expressiveCode === 'object' ? config.expressiveCode : {};
      updateConfig({ expressiveCode: { ...expressiveCode, emitExternalStylesheet: false } });
    },
  },
};

export default defineConfig({
  site: 'https://docs.markdawn.space',
  redirects: {
    '/api-reference/': '/api-reference/endpoints/',
  },
  integrations: [
    starlight({
      title: 'Markdawn Docs',
      description: 'Learn Markdawn, build with the API, and bring your own agents.',
      favicon: 'https://markdawn.space/icon-192.png',
      editLink: {
        baseUrl: 'https://github.com/atharva-again/Markdawn/edit/master/docs/',
      },
      lastUpdated: true,
      social: [
        {
          icon: 'github',
          label: 'Markdawn on GitHub',
          href: 'https://github.com/atharva-again/Markdawn',
        },
      ],
      customCss: ['./src/styles/custom.css'],
      plugins: [
        starlightOpenAPI([
          {
            base: 'api-reference/endpoints',
            schema: './openapi.json',
            sidebar: {
              label: 'Endpoints',
              collapsed: false,
              operations: { badges: true, labels: 'summary', sort: 'document' },
              tags: { sort: 'document' },
            },
            snippets: {
              operation: {
                clients: { javascript: ['fetch'], shell: ['curl'] },
                default: { target: 'shell', client: 'curl' },
              },
            },
          },
        ]),
        inlineCodeStylesPlugin,
      ],
      sidebar: [
        {
          label: 'Getting Started',
          items: [
            { label: 'Getting Started', link: '/getting-started/' },
            { label: 'Create Your First Page', link: '/getting-started/create-your-first-page/' },
            { label: 'Markdown Support', link: '/getting-started/markdown-support/' },
            { label: 'Bring Your Notes to Markdawn', link: '/getting-started/bring-your-notes/' },
            {
              label: 'Organize Pages and Folders',
              link: '/getting-started/organize-pages-and-folders/',
            },
            { label: 'Share a Page', link: '/getting-started/share-a-page/' },
          ],
        },
        {
          label: 'Agents',
          items: [
            { label: 'Agents', link: '/agents/' },
            {
              label: 'Use Markdawn With AI Assistants',
              link: '/agents/use-markdawn-with-ai-assistants/',
            },
            { label: 'Markdawn CLI', link: '/agents/markdawn-cli/' },
            { label: 'MCP', link: '/agents/mcp/' },
          ],
        },
        {
          label: 'API Reference',
          items: [...openAPISidebarGroups],
        },
        {
          label: 'Self-Hosting',
          items: [
            { label: 'Self-Hosting', link: '/self-hosting/' },
            { label: 'Deploy Markdawn on a VPS', link: '/self-hosting/deploy-markdawn-on-a-vps/' },
            {
              label: 'Maintain a Self-Hosted Markdawn',
              link: '/self-hosting/maintain-a-self-hosted-markdawn/',
            },
            {
              label: 'Move a Markdawn Deployment',
              link: '/self-hosting/move-a-markdawn-deployment/',
            },
          ],
        },
        {
          label: 'Comparisons',
          items: [
            { label: 'Apple Notes', link: '/comparisons/markdawn-vs-apple-notes/' },
            { label: 'Coda / Superhuman Docs', link: '/comparisons/markdawn-vs-coda/' },
            { label: 'Confluence', link: '/comparisons/markdawn-vs-confluence/' },
            { label: 'Craft', link: '/comparisons/markdawn-vs-craft/' },
            { label: 'Evernote', link: '/comparisons/markdawn-vs-evernote/' },
            { label: 'GitBook', link: '/comparisons/markdawn-vs-gitbook/' },
            { label: 'Google Docs', link: '/comparisons/markdawn-vs-google-docs/' },
            { label: 'Notion', link: '/comparisons/markdawn-vs-notion/' },
            { label: 'Obsidian', link: '/comparisons/markdawn-vs-obsidian/' },
            { label: 'OneNote', link: '/comparisons/markdawn-vs-onenote/' },
            { label: 'Outline', link: '/comparisons/markdawn-vs-outline/' },
            { label: 'Slite', link: '/comparisons/markdawn-vs-slite/' },
          ],
        },
      ],
      components: {
        Head: './src/components/Head.astro',
        Header: './src/components/Header.astro',
        Sidebar: './src/components/Sidebar.astro',
        PageSidebar: './src/components/PageSidebar.astro',
        ThemeProvider: './src/components/ThemeProvider.astro',
        ThemeSelect: './src/components/ThemeToggle.astro',
        MobileMenuFooter: './src/components/MobileMenuFooter.astro',
      },
    }),
  ],
});
