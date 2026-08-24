import type { APIRoute } from 'astro';
import { FEATURE_GROUPS, PRODUCT_SUMMARY } from '../data/features';
import { richTextToPlainText } from '../data/richText';
import { APP_ORIGIN, DOCS_ORIGIN, GITHUB_URL, SITE_ORIGIN } from '../data/siteConfig';
import { USE_CASES } from '../data/useCases';

export const prerender = true;

const featureLines = FEATURE_GROUPS.map(
  ({ title, body, docsUrl, docsLabel }) =>
    `- ${title} — [${docsLabel}](${docsUrl}): ${richTextToPlainText(body)}`,
).join('\n');
const useCaseLines = USE_CASES.map(
  ({ title, body, docsUrl, docsLabel }) =>
    `- ${title} — [${docsLabel}](${docsUrl}): ${richTextToPlainText(body)}`,
).join('\n');

const llms = `# Markdawn

> Markdawn is the collaborative knowledge base for humans and agents.

Markdawn is currently in public beta. ${PRODUCT_SUMMARY} Markdawn is open source under GNU AGPL v3 and can be used as a hosted service or self-hosted.

## Features

${featureLines}

## Use cases

${useCaseLines}

## Product links

- [Homepage](${SITE_ORIGIN}/): Product overview and entry points for the web app and CLI.
- [Web app](${APP_ORIGIN}): Open Markdawn in the browser.
- [Source code](${GITHUB_URL}): Markdawn source code and project README.

## Documentation

- [Documentation home](${DOCS_ORIGIN}/): Guides, API reference, comparisons, and self-hosting documentation.
- [Markdawn CLI](${DOCS_ORIGIN}/agents/markdawn-cli/): Install the CLI and manage pages from a terminal.
- [AI assistant access](${DOCS_ORIGIN}/agents/use-markdawn-with-ai-assistants/): Connect terminal-based assistants with scoped tokens and safe edits.
- [md support](${DOCS_ORIGIN}/getting-started/markdown-support/): Supported syntax, page links, frontmatter, and known limitations.
- [API reference](${DOCS_ORIGIN}/api-reference/endpoints/): Direct HTTP interface for Markdawn resources.
- [Self-hosting](${DOCS_ORIGIN}/self-hosting/): Deployment, maintenance, and migration guidance.

## Optional

- [Import existing notes](${DOCS_ORIGIN}/getting-started/bring-your-notes/): Import markdown files, folders, and Obsidian vaults.
- [Share a page](${DOCS_ORIGIN}/getting-started/share-a-page/): View, Edit, and Admin access with real-time collaboration.
- [Markdawn comparisons](${DOCS_ORIGIN}/comparisons/): Detailed comparisons with other knowledge tools.
`;

export const GET: APIRoute = () =>
  new Response(llms, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
    },
  });
