import { richText } from './richText';
import { DOCS_ORIGIN } from './siteConfig';

export const USE_CASES = [
  {
    id: 'individuals',
    title: 'For individuals building a personal knowledge base.',
    body: richText({
      kind: 'text',
      value:
        'Capture notes, ideas, plans, and reference material on pages you can connect and revisit. Import markdown files or an Obsidian vault, then use folders, tags, links, and backlinks to keep your knowledge navigable.',
    }),
    docsUrl: `${DOCS_ORIGIN}/getting-started/bring-your-notes/`,
    docsLabel: 'Read about importing notes',
  },
  {
    id: 'teams',
    title: 'For teams creating a shared knowledge base.',
    body: richText({
      kind: 'text',
      value:
        'Share project notes, decisions, research, and plans with the people who need them. View, Edit, and Admin access make sharing clear, while real-time editing keeps collaboration in one place.',
    }),
    docsUrl: `${DOCS_ORIGIN}/getting-started/share-a-page/`,
    docsLabel: 'Read about sharing',
  },
  {
    id: 'writers-researchers',
    title: 'For writers and researchers connecting ideas.',
    body: richText(
      {
        kind: 'text',
        value:
          'Keep sources, drafts, questions, and discoveries connected as your work develops. Link related pages with ',
      },
      { kind: 'code', value: '[[Page Name]]' },
      {
        kind: 'text',
        value: ', then follow backlinks to retrace how an idea, source, or decision fits together.',
      },
    ),
    docsUrl: `${DOCS_ORIGIN}/getting-started/organize-pages-and-folders/`,
    docsLabel: 'Read about pages and folders',
  },
  {
    id: 'developers',
    title: 'For developers and technical teams working in markdown.',
    body: richText({
      kind: 'text',
      value:
        'Write in the browser, work from a terminal with the CLI, and connect scripts through the API. The same pages remain available across each interface, so technical context does not get trapped in one tool.',
    }),
    docsUrl: `${DOCS_ORIGIN}/agents/markdawn-cli/`,
    docsLabel: 'Read about the CLI',
  },
  {
    id: 'ai-assisted',
    title: 'For people and teams using AI assistants.',
    body: richText({
      kind: 'text',
      value:
        'Give an AI assistant read access to the pages it needs instead of copying context into a second store. Add write access when the workflow calls for it, and use exact edits when a change should be controlled.',
    }),
    docsUrl: `${DOCS_ORIGIN}/agents/use-markdawn-with-ai-assistants/`,
    docsLabel: 'Read about agent access',
  },
] as const;
