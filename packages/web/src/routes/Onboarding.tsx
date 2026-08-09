import {
  ArrowLeft,
  ArrowRight,
  Check,
  Copy,
  FileInput,
  FilePenLine,
  FileText,
  FolderUp,
  Loader2,
  type LucideIcon,
} from 'lucide-react';
import { type ChangeEvent, type ReactNode, useEffect, useRef, useState } from 'react';
import { Navigate, useParams } from 'react-router-dom';
import { OnboardingStatusBoundary } from '../components/auth/OnboardingStatusBoundary';
import { ObsidianImportDialog } from '../components/import/ObsidianImportDialog';
import { useIdentityLifecycle, useIdentityNavigate } from '../contexts/IdentityLifecycleContext';
import { useImportMarkdown } from '../hooks/use-pages';
import { useCompleteOnboarding } from '../hooks/useOnboarding';
import { buildPagePath } from '../utils/url';

const CLI_GUIDE = 'https://github.com/atharva-again/Markdawn/blob/master/cli/README.md';
const UNIX_CLI_INSTALL_COMMAND = 'curl -fsSL https://markdawn.space/install.sh | sh';
const WINDOWS_CLI_INSTALL_COMMAND = 'irm https://markdawn.space/install.ps1 | iex';
const AGENT_PROMPT = `Set up Markdawn for use in this agent session by following the full CLI guide:
${CLI_GUIDE}

Read the guide from start to finish. Install the Markdawn CLI and its agent skill. Then guide me through creating an API token in Markdawn Settings, authenticate with markdawn login, and verify the connection with markdawn whoami and markdawn doctor. Do not create, modify, import, or delete workspace content unless I explicitly ask.`;

type ContentStep = 'content' | 'import';
type CliPlatform = 'linux' | 'macos' | 'unknown' | 'windows';
type CopiedItem = 'cli-unix' | 'cli-windows' | 'prompt';
type FolderImportVariant = 'markdown-folder' | 'obsidian';

function detectCliPlatform(): CliPlatform {
  const navigatorWithUserAgentData = navigator as Navigator & {
    userAgentData?: { platform?: string };
  };
  const platform = (
    navigatorWithUserAgentData.userAgentData?.platform || navigatorWithUserAgentData.userAgent
  ).toLowerCase();
  if (platform.includes('win')) return 'windows';
  if (platform.includes('mac')) return 'macos';
  if (platform.includes('linux')) return 'linux';
  return 'unknown';
}

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
      className="group flex w-full items-center gap-4 px-3 py-3.5 text-left transition-colors hover:bg-zinc-100/80 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-zinc-900 disabled:cursor-not-allowed disabled:opacity-60 dark:hover:bg-zinc-900 dark:focus-visible:outline-zinc-100 cursor-pointer"
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

function CopyIconButton({
  ariaLabel,
  copied,
  onClick,
}: {
  ariaLabel: string;
  copied: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="cursor-pointer rounded p-1 text-zinc-500 transition-colors hover:bg-zinc-200 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
      aria-label={ariaLabel}
      title={ariaLabel}
    >
      {copied ? <Check size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />}
    </button>
  );
}

function InstallCommand({
  command,
  copied,
  label,
  onCopy,
}: {
  command: string;
  copied: boolean;
  label?: string;
  onCopy: () => void;
}) {
  return (
    <div>
      {label ? (
        <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400">{label}</p>
      ) : null}
      <div
        className={`${label ? 'mt-2' : 'mt-3'} flex items-center gap-2 rounded-md bg-zinc-100 px-3 py-2.5 dark:bg-zinc-900`}
      >
        <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap font-mono text-xs text-zinc-800 dark:text-zinc-200">
          {command}
        </code>
        <CopyIconButton ariaLabel="Copy CLI install command" copied={copied} onClick={onCopy} />
      </div>
    </div>
  );
}

function OnboardingActionButton({
  children,
  disabled = false,
  isWorking = false,
  onClick,
}: {
  children: ReactNode;
  disabled?: boolean;
  isWorking?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="inline-flex h-9 items-center gap-2 rounded-md border border-zinc-200 bg-white px-3 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800 cursor-pointer"
    >
      {isWorking ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : null}
      {children}
    </button>
  );
}

function OnboardingContent({ onboardingStep }: { onboardingStep: '1' | '2' }) {
  const navigate = useIdentityNavigate();
  const identityLifecycle = useIdentityLifecycle();
  const completion = useCompleteOnboarding();
  const importMarkdown = useImportMarkdown();
  const markdownFileRef = useRef<HTMLInputElement>(null);
  const [contentStep, setContentStep] = useState<ContentStep>('content');
  const [destination, setDestination] = useState('/app');
  const [folderImportVariant, setFolderImportVariant] = useState<FolderImportVariant | null>(null);
  const [hasImportedFolder, setHasImportedFolder] = useState(false);
  const [cliPlatform] = useState<CliPlatform>(detectCliPlatform);
  const [copyStatus, setCopyStatus] = useState<CopiedItem | 'failed' | null>(null);
  const copyResetTimeout = useRef<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const isAgentStep = onboardingStep === '2';

  const isWorking = completion.isPending || importMarkdown.isPending;
  const cliInstallCommand =
    cliPlatform === 'windows' ? WINDOWS_CLI_INSTALL_COMMAND : UNIX_CLI_INSTALL_COMMAND;

  useEffect(() => {
    return () => {
      if (copyResetTimeout.current !== null) window.clearTimeout(copyResetTimeout.current);
    };
  }, []);

  const finish = async (destination: string) => {
    setError(null);
    try {
      await completion.mutateAsync();
      if (!identityLifecycle.isActive()) return;
      navigate(destination, { replace: true });
    } catch {
      if (!identityLifecycle.isActive()) return;
      setError('We could not save your onboarding progress. Please try again.');
    }
  };

  const importMarkdownFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.md')) {
      setError('Choose a Markdown file ending in .md.');
      return;
    }

    setError(null);
    try {
      const { page } = await importMarkdown.mutateAsync({ file });
      if (!identityLifecycle.isActive()) return;
      setDestination(buildPagePath(page.title, page.id));
      setContentStep('content');
      navigate('/onboarding/2');
    } catch {
      if (!identityLifecycle.isActive()) return;
      setError('We could not import that Markdown file. Please try again.');
    }
  };

  const selectFolderForImport = (variant: FolderImportVariant) => {
    setHasImportedFolder(false);
    setFolderImportVariant(variant);
  };

  const copyText = async (text: string, copiedItem: CopiedItem) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopyStatus(copiedItem);
      if (copyResetTimeout.current !== null) window.clearTimeout(copyResetTimeout.current);
      copyResetTimeout.current = window.setTimeout(() => {
        setCopyStatus((currentStatus) => (currentStatus === copiedItem ? null : currentStatus));
        copyResetTimeout.current = null;
      }, 2000);
    } catch {
      setCopyStatus('failed');
    }
  };

  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-50">
      <main className="flex min-h-screen flex-col items-center justify-center px-5 py-10 sm:px-8">
        <div className="w-full max-w-xl">
          {!isAgentStep && contentStep === 'content' && (
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
                  onClick={() => navigate('/onboarding/2')}
                />
                <ChoiceCard
                  icon={FileInput}
                  title="Import Content"
                  description="Markdown files, folders, or an Obsidian vault."
                  disabled={isWorking}
                  onClick={() => setContentStep('import')}
                />
              </div>
              <div className="mt-5">
                <OnboardingActionButton
                  onClick={() => void finish('/app')}
                  disabled={isWorking}
                  isWorking={completion.isPending}
                >
                  Skip Onboarding
                </OnboardingActionButton>
              </div>
            </>
          )}

          {!isAgentStep && contentStep === 'import' && (
            <>
              <button
                type="button"
                onClick={() => {
                  setError(null);
                  setContentStep('content');
                }}
                className="inline-flex items-center gap-1.5 text-sm font-medium text-zinc-500 transition-colors hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100 cursor-pointer"
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
                <button
                  type="button"
                  onClick={() => markdownFileRef.current?.click()}
                  disabled={isWorking}
                  className="rounded-lg border border-zinc-200 bg-white p-4 text-left transition-colors hover:border-zinc-300 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-700 dark:hover:bg-zinc-800/50 cursor-pointer"
                >
                  <FileText
                    size={22}
                    aria-hidden="true"
                    className="text-zinc-700 dark:text-zinc-200"
                  />
                  <span className="mt-4 block text-sm font-medium text-zinc-900 dark:text-zinc-50">
                    Markdown file
                  </span>
                  <span className="mt-1 block text-sm leading-6 text-zinc-500 dark:text-zinc-400">
                    One Markdown
                    <br />
                    file.
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => void selectFolderForImport('markdown-folder')}
                  disabled={isWorking}
                  className="rounded-lg border border-zinc-200 bg-white p-4 text-left transition-colors hover:border-zinc-300 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-700 dark:hover:bg-zinc-800/50 cursor-pointer"
                >
                  <FolderUp
                    size={22}
                    aria-hidden="true"
                    className="text-zinc-700 dark:text-zinc-200"
                  />
                  <span className="mt-4 block text-sm font-medium text-zinc-900 dark:text-zinc-50">
                    Markdown folder
                  </span>
                  <span className="mt-1 block text-sm leading-6 text-zinc-500 dark:text-zinc-400">
                    Files, images,
                    <br />
                    and folders.
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => void selectFolderForImport('obsidian')}
                  disabled={isWorking}
                  className="rounded-lg border border-zinc-200 bg-white p-4 text-left transition-colors hover:border-zinc-300 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-700 dark:hover:bg-zinc-800/50 cursor-pointer"
                >
                  <img
                    src="https://obsidian.md/images/obsidian-logo-gradient.svg"
                    alt=""
                    aria-hidden="true"
                    className="size-[22px]"
                  />
                  <span className="mt-4 block text-sm font-medium text-zinc-900 dark:text-zinc-50">
                    Obsidian vault
                  </span>
                  <span className="mt-1 block text-sm leading-6 text-zinc-500 dark:text-zinc-400">
                    Notes, images,
                    <br />
                    and backlinks.
                  </span>
                </button>
              </div>
              <p className="mt-4 text-xs leading-5 text-zinc-500 dark:text-zinc-400">
                Other apps have not been tested yet. If they store your notes in a Markdown folder,
                choose{' '}
                <span className="font-medium text-zinc-700 dark:text-zinc-300">
                  Markdown folder
                </span>
                . First-class support for other apps is coming soon.
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

          {isAgentStep && (
            <>
              <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400">Step 2 of 2</p>
              <h1 className="mt-5 text-3xl font-semibold tracking-tight text-zinc-950 dark:text-white">
                Set up your agent workflow
              </h1>
              <p className="mt-3 max-w-xl text-sm leading-6 text-zinc-500 dark:text-zinc-400">
                The CLI lets your agent interact with Markdawn. It can create and organize pages and
                folders.
              </p>
              <div className="mt-8 border-y border-zinc-200 dark:border-zinc-800">
                <section className="py-4">
                  <p className="text-sm font-medium text-zinc-900 dark:text-zinc-50">
                    Install the CLI
                  </p>
                  {cliPlatform === 'unknown' ? (
                    <div className="mt-3 space-y-3">
                      <InstallCommand
                        label="macOS / Linux"
                        command={UNIX_CLI_INSTALL_COMMAND}
                        copied={copyStatus === 'cli-unix'}
                        onCopy={() => void copyText(UNIX_CLI_INSTALL_COMMAND, 'cli-unix')}
                      />
                      <InstallCommand
                        label="Windows"
                        command={WINDOWS_CLI_INSTALL_COMMAND}
                        copied={copyStatus === 'cli-windows'}
                        onCopy={() => void copyText(WINDOWS_CLI_INSTALL_COMMAND, 'cli-windows')}
                      />
                    </div>
                  ) : (
                    <InstallCommand
                      command={cliInstallCommand}
                      copied={
                        copyStatus === (cliPlatform === 'windows' ? 'cli-windows' : 'cli-unix')
                      }
                      onCopy={() =>
                        void copyText(
                          cliInstallCommand,
                          cliPlatform === 'windows' ? 'cli-windows' : 'cli-unix',
                        )
                      }
                    />
                  )}
                  {copyStatus === 'failed' && (
                    <p role="alert" className="mt-2 text-xs text-red-600 dark:text-red-400">
                      Copy failed. Copy the command manually instead.
                    </p>
                  )}
                </section>
                <section className="py-4">
                  <p className="text-sm font-medium text-zinc-900 dark:text-zinc-50">
                    First-time setup prompt
                  </p>
                  <div className="mt-3 flex items-start gap-2 rounded-md bg-zinc-100 px-3 py-2.5 dark:bg-zinc-900">
                    <pre className="min-w-0 flex-1 whitespace-pre-wrap break-words font-mono text-xs leading-5 text-zinc-800 dark:text-zinc-200">
                      {AGENT_PROMPT}
                    </pre>
                    <CopyIconButton
                      ariaLabel="Copy first-time setup prompt"
                      copied={copyStatus === 'prompt'}
                      onClick={() => void copyText(AGENT_PROMPT, 'prompt')}
                    />
                  </div>
                </section>
              </div>
            </>
          )}

          {error && (
            <p
              role="alert"
              className="mt-5 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300"
            >
              {error}
            </p>
          )}
        </div>

        <footer className="mt-8 flex min-h-9 w-full max-w-xl items-center justify-start">
          {isAgentStep ? (
            <div className="flex items-center gap-2">
              <a
                href={CLI_GUIDE}
                target="_blank"
                rel="noreferrer"
                className="inline-flex h-9 items-center rounded-md border border-zinc-200 bg-white px-3 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800 cursor-pointer"
              >
                Read the CLI Guide
              </a>
              <OnboardingActionButton
                onClick={() => void finish(destination)}
                disabled={isWorking}
                isWorking={isWorking}
              >
                Open App
              </OnboardingActionButton>
            </div>
          ) : null}
        </footer>
      </main>
      {folderImportVariant && (
        <ObsidianImportDialog
          variant={folderImportVariant}
          onClose={() => {
            setFolderImportVariant(null);
            if (hasImportedFolder) {
              setDestination('/app');
              setContentStep('content');
              navigate('/onboarding/2');
            }
          }}
          onSuccess={() => setHasImportedFolder(true)}
        />
      )}
    </div>
  );
}

export default function Onboarding() {
  const { onboardingStep } = useParams<{ onboardingStep: string }>();

  if (onboardingStep !== '1' && onboardingStep !== '2') {
    return <Navigate to="/onboarding/1" replace />;
  }

  return (
    <OnboardingStatusBoundary>
      {(onboardingStatus) => {
        if (onboardingStatus.completed) {
          return <Navigate to="/app" replace />;
        }

        return <OnboardingContent onboardingStep={onboardingStep === '2' ? '2' : '1'} />;
      }}
    </OnboardingStatusBoundary>
  );
}
