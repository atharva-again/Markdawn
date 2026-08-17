import { getCollection } from 'astro:content';
import type { APIRoute, GetStaticPaths } from 'astro';
import { getApiReferenceMarkdownEntries } from '../lib/apiReferenceMarkdown';

interface MarkdownProps {
  body: string;
}

export const getStaticPaths: GetStaticPaths = async () => {
  const entries = await getCollection('docs');
  const apiEntries = getApiReferenceMarkdownEntries();

  return [
    ...entries.map((entry) => ({
      params: { slug: entry.id },
      props: { body: entry.body ?? '' } satisfies MarkdownProps,
    })),
    ...apiEntries.map((entry) => ({
      params: { slug: entry.slug },
      props: { body: entry.body } satisfies MarkdownProps,
    })),
  ];
};

export const GET: APIRoute = ({ props }) => {
  const { body } = props as MarkdownProps;

  return new Response(body, {
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
      'X-Robots-Tag': 'noindex',
    },
  });
};
