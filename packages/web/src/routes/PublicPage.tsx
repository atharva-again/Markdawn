import { useQuery } from '@tanstack/react-query';
import React from 'react';
import { Link, useParams } from 'react-router-dom';

const API_BASE = '/api';

interface PublicPageData {
  title: string;
  icon: string | null;
  coverType: string | null;
  coverValue: string | null;
  content: number[] | null;
}

async function fetchPublicPage(token: string): Promise<PublicPageData> {
  const res = await fetch(`${API_BASE}/public/${token}`);
  if (!res.ok) {
    if (res.status === 404) {
      throw new Error('Page not found');
    }
    throw new Error('Failed to fetch page');
  }
  return res.json();
}

export default function PublicPage() {
  const { token } = useParams<{ token: string }>();

  const {
    data: page,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['public-page', token],
    queryFn: () => {
      if (!token) throw new Error('token is required');
      return fetchPublicPage(token);
    },
    enabled: !!token,
    retry: false,
  });

  if (isLoading) {
    return (
      <div className="min-h-screen flex flex-col bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-50">
        <header className="h-14 border-b border-zinc-200 dark:border-zinc-800 flex items-center px-6">
          <Link
            to="/"
            className="font-semibold text-lg tracking-tight hover:opacity-80 transition-opacity"
          >
            Markdawn
          </Link>
        </header>
        <div className="flex-1 flex items-center justify-center">
          <div className="w-8 h-8 border-2 border-zinc-300 dark:border-zinc-600 border-t-zinc-600 dark:border-t-zinc-300 rounded-full animate-spin" />
        </div>
      </div>
    );
  }

  if (error || !page) {
    return (
      <div className="min-h-screen flex flex-col bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-50">
        <header className="h-14 border-b border-zinc-200 dark:border-zinc-800 flex items-center px-6">
          <Link
            to="/"
            className="font-semibold text-lg tracking-tight hover:opacity-80 transition-opacity"
          >
            Markdawn
          </Link>
        </header>
        <div className="flex-1 max-w-3xl mx-auto w-full px-6 py-10 text-center mt-20">
          <h1 className="text-2xl font-semibold mb-2">Page not found</h1>
          <p className="text-zinc-500 dark:text-zinc-400">
            The page you are looking for does not exist or the link has expired.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-50">
      <header className="h-14 border-b border-zinc-200 dark:border-zinc-800 flex items-center px-6">
        <Link
          to="/"
          className="font-semibold text-lg tracking-tight hover:opacity-80 transition-opacity"
        >
          Markdawn
        </Link>
      </header>

      <main className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-6 py-10 animate-fade-in">
          {(page.coverType || page.coverValue) && (
            <div
              className="w-full h-[200px] rounded-xl mb-8 overflow-hidden"
              style={{
                background:
                  page.coverType === 'gradient' ? (page.coverValue ?? undefined) : undefined,
                backgroundColor:
                  page.coverType === 'solid' ? (page.coverValue ?? undefined) : undefined,
              }}
            />
          )}

          <div className="mb-8">
            <h1 className="text-4xl font-bold flex items-center gap-3">
              {page.icon && <span>{page.icon}</span>}
              {page.title || 'Untitled'}
            </h1>
          </div>

          <div className="p-8 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/50 text-center">
            <p className="text-zinc-600 dark:text-zinc-400 mb-4">
              Content preview is not available for public pages yet.
            </p>
            <Link
              to="/"
              className="inline-flex items-center justify-center px-4 py-2 text-sm font-medium rounded-md bg-zinc-900 text-white dark:bg-white dark:text-zinc-900 hover:opacity-90 transition-opacity"
            >
              Open in Markdawn
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}
