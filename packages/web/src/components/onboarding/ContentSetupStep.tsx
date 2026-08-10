import {
  ArrowLeft,
  ArrowRight,
  FileInput,
  FilePenLine,
  FileText,
  FolderUp,
  type LucideIcon,
} from 'lucide-react';
import { type ChangeEvent, type ReactNode, useRef, useState } from 'react';
import { useIdentityLifecycle } from '../../contexts/IdentityLifecycleContext';
import { useImportMarkdown } from '../../hooks/use-pages';
import { buildPagePath } from '../../utils/url';
import { ObsidianImportDialog } from '../import/ObsidianImportDialog';
import { OnboardingActionButton } from './OnboardingActionButton';

type FolderImportVariant = 'markdown-folder' | 'obsidian';
type ContentFlow =
  | { kind: 'choose-content' }
  | { kind: 'choose-import' }
  | { kind: 'folder-import'; variant: FolderImportVariant };

function ChoiceCard({
  icon: Icon,
  title,
  description,
  disabled = false,
  onClick,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="group flex w-full cursor-pointer items-center gap-4 px-3 py-3.5 text-left transition-colors hover:bg-zinc-100/80 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-zinc-900 disabled:cursor-not-allowed disabled:opacity-60 dark:hover:bg-zinc-900 dark:focus-visible:outline-zinc-100"
    >
      <span className="flex size-8 shrink-0 items-center justify-center text-zinc-500 dark:text-zinc-400">
        <Icon size={18} aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-zinc-900 dark:text-zinc-50">{title}</span>
        <span className="mt-1 block text-sm text-zinc-500 dark:text-zinc-400">{description}</span>
      </span>
      <ArrowRight
        size={16}
        aria-hidden="true"
        className="shrink-0 text-zinc-400 transition-transform group-hover:translate-x-0.5 group-hover:text-zinc-700 dark:group-hover:text-zinc-200"
      />
    </button>
  );
}

function ImportOption({
  children,
  disabled,
  icon,
  onClick,
  title,
}: {
  children: ReactNode;
  disabled: boolean;
  icon: ReactNode;
  onClick: () => void;
  title: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="cursor-pointer rounded-lg border border-zinc-200 bg-white p-4 text-left transition-colors hover:border-zinc-300 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-700 dark:hover:bg-zinc-800/50"
    >
      {icon}
      <span className="mt-4 block text-sm font-medium text-zinc-900 dark:text-zinc-50">
        {title}
      </span>
      <span className="mt-1 block text-sm leading-6 text-zinc-500 dark:text-zinc-400">
        {children}
      </span>
    </button>
  );
}

export function ContentSetupStep({
  completionError,
  isCompleting,
  onAdvance,
  onSkip,
}: {
  completionError: string | null;
  isCompleting: boolean;
  onAdvance: (importedDestination?: string) => void;
  onSkip: () => void;
}) {
  const identityLifecycle = useIdentityLifecycle();
  const importMarkdown = useImportMarkdown();
  const markdownFileRef = useRef<HTMLInputElement>(null);
  const [flow, setFlow] = useState<ContentFlow>({ kind: 'choose-content' });
  const [importError, setImportError] = useState<string | null>(null);
  const isWorking = isCompleting || importMarkdown.isPending;
  const error = flow.kind === 'choose-content' ? completionError : importError;

  const importMarkdownFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.md')) {
      setImportError('Choose a Markdown file ending in .md.');
      return;
    }

    setImportError(null);
    try {
      const { page } = await importMarkdown.mutateAsync({ file });
      if (!identityLifecycle.isActive()) return;
      onAdvance(buildPagePath(page.title, page.id));
    } catch {
      // The import request is a UI boundary where transport/API failures become
      // an actionable message while the mutation retains the original error.
      if (!identityLifecycle.isActive()) return;
      setImportError('We could not import that Markdown file. Please try again.');
    }
  };

  return (
    <div className="w-full max-w-xl">
      {flow.kind === 'choose-content' ? (
        <>
          <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400">Step 1 of 2</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-zinc-950 dark:text-white">
            Set up your workspace
          </h1>
          <p className="mt-3 max-w-xl text-sm leading-6 text-zinc-500 dark:text-zinc-400">
            Create your first page or bring your existing notes with you.
          </p>
          <div className="mt-8 divide-y divide-zinc-200 border-y border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
            <ChoiceCard
              icon={FilePenLine}
              title="Start Blank"
              description="Let your imagination run free!"
              disabled={isWorking}
              onClick={() => onAdvance()}
            />
            <ChoiceCard
              icon={FileInput}
              title="Import Content"
              description="Markdown files, folders, or an Obsidian vault."
              disabled={isWorking}
              onClick={() => setFlow({ kind: 'choose-import' })}
            />
          </div>
          <div className="mt-5">
            <OnboardingActionButton onClick={onSkip} disabled={isWorking} isWorking={isCompleting}>
              Skip Onboarding
            </OnboardingActionButton>
          </div>
        </>
      ) : (
        <>
          <button
            type="button"
            onClick={() => {
              setImportError(null);
              setFlow({ kind: 'choose-content' });
            }}
            className="inline-flex cursor-pointer items-center gap-1.5 text-sm font-medium text-zinc-500 transition-colors hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
          >
            <ArrowLeft size={16} aria-hidden="true" />
            Back
          </button>
          <h1 className="mt-5 text-3xl font-semibold tracking-tight text-zinc-950 dark:text-white">
            Bring your notes with you
          </h1>
          <p className="mt-3 max-w-lg text-sm leading-6 text-zinc-500 dark:text-zinc-400">
            Import one Markdown file, an entire Markdown folder, or an Obsidian vault.
          </p>
          <div className="mt-8 grid gap-3 sm:grid-cols-3">
            <ImportOption
              title="Markdown file"
              disabled={isWorking}
              onClick={() => markdownFileRef.current?.click()}
              icon={
                <FileText
                  size={22}
                  aria-hidden="true"
                  className="text-zinc-700 dark:text-zinc-200"
                />
              }
            >
              One Markdown
              <br />
              file.
            </ImportOption>
            <ImportOption
              title="Markdown folder"
              disabled={isWorking}
              onClick={() => setFlow({ kind: 'folder-import', variant: 'markdown-folder' })}
              icon={
                <FolderUp
                  size={22}
                  aria-hidden="true"
                  className="text-zinc-700 dark:text-zinc-200"
                />
              }
            >
              Files, images,
              <br />
              and folders.
            </ImportOption>
            <ImportOption
              title="Obsidian vault"
              disabled={isWorking}
              onClick={() => setFlow({ kind: 'folder-import', variant: 'obsidian' })}
              icon={
                <img
                  src="https://obsidian.md/images/obsidian-logo-gradient.svg"
                  alt=""
                  aria-hidden="true"
                  className="size-[22px]"
                />
              }
            >
              Notes, images,
              <br />
              and backlinks.
            </ImportOption>
          </div>
          <p className="mt-4 text-xs leading-5 text-zinc-500 dark:text-zinc-400">
            Other apps have not been tested yet. If they store your notes in a Markdown folder,
            choose{' '}
            <span className="font-medium text-zinc-700 dark:text-zinc-300">Markdown folder</span>.
            First-class support for other apps is coming soon.
          </p>
          <input
            ref={markdownFileRef}
            type="file"
            accept=".md,text/markdown"
            className="sr-only"
            onChange={(event) => void importMarkdownFile(event)}
          />
        </>
      )}

      {error ? (
        <p
          role="alert"
          className="mt-5 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300"
        >
          {error}
        </p>
      ) : null}

      {flow.kind === 'folder-import' ? (
        <ObsidianImportDialog
          variant={flow.variant}
          onClose={(outcome) => {
            if (outcome.kind === 'imported') {
              onAdvance('/app');
              return;
            }
            setFlow({ kind: 'choose-import' });
          }}
        />
      ) : null}
    </div>
  );
}
