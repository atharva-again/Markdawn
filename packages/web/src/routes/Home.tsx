import {
  autoUpdate,
  FloatingPortal,
  flip,
  offset,
  safePolygon,
  shift,
  useDismiss,
  useFloating,
  useFocus,
  useHover,
  useInteractions,
  useRole,
  useTransitionStyles,
} from '@floating-ui/react';
import { MARKDAWN_CLI_DOCS_URL, MARKDAWN_DOCS_URL } from '@markdawn/shared';
import { Check, Copy, ExternalLink } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { HeaderActions } from '../components/HeaderActions';
import { getAppOrigin } from '../utils/url';

const CLI_GUIDE = MARKDAWN_CLI_DOCS_URL;
const SITE_ORIGIN = 'https://markdawn.space';
const CLI_INSTALL_COMMANDS = [
  {
    label: 'Linux / macOS',
    command: `curl -fsSL ${SITE_ORIGIN}/install.sh | sh`,
    ariaLabel: 'Copy Linux and macOS install command',
  },
  {
    label: 'Windows',
    command: `irm ${SITE_ORIGIN}/install.ps1 | iex`,
    ariaLabel: 'Copy Windows install command',
  },
] as const;

function CliInstallPopover() {
  const [copyStatus, setCopyStatus] = useState<{
    command: string;
    status: 'copied' | 'failed';
  } | null>(null);
  const copyResetTimeout = useRef<number | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const titleId = useId();
  const { refs, context, floatingStyles } = useFloating({
    placement: 'bottom',
    middleware: [offset(12), flip(), shift({ padding: 16 })],
    whileElementsMounted: autoUpdate,
    open: isOpen,
    onOpenChange: setIsOpen,
  });
  const hover = useHover(context, { move: false, handleClose: safePolygon() });
  const focus = useFocus(context);
  const dismiss = useDismiss(context);
  const role = useRole(context, { role: 'dialog' });
  const { getReferenceProps, getFloatingProps } = useInteractions([hover, focus, dismiss, role]);
  const { isMounted, styles: transitionStyles } = useTransitionStyles(context, {
    initial: { opacity: 0, transform: 'translateY(-4px)' },
  });

  useEffect(() => {
    return () => {
      if (copyResetTimeout.current !== null) {
        window.clearTimeout(copyResetTimeout.current);
      }
    };
  }, []);

  const copyCommand = async (command: string) => {
    try {
      await navigator.clipboard.writeText(command);
      setCopyStatus({ command, status: 'copied' });
      if (copyResetTimeout.current !== null) {
        window.clearTimeout(copyResetTimeout.current);
      }
      copyResetTimeout.current = window.setTimeout(() => {
        setCopyStatus((currentStatus) => {
          return currentStatus?.command === command && currentStatus.status === 'copied'
            ? null
            : currentStatus;
        });
        copyResetTimeout.current = null;
      }, 2000);
    } catch {
      setCopyStatus({ command, status: 'failed' });
    }
  };

  return (
    <>
      <a
        ref={refs.setReference}
        href={CLI_GUIDE}
        target="_blank"
        rel="noopener noreferrer"
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        className="inline-flex cursor-pointer items-center justify-center rounded-full border border-zinc-200 bg-white px-8 py-3.5 text-sm font-semibold text-zinc-700 shadow-sm transition-all duration-200 hover:bg-zinc-50 hover:shadow-md dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800"
        {...getReferenceProps()}
      >
        CLI &amp; Agents
      </a>

      {isMounted && (
        <FloatingPortal>
          <div
            ref={refs.setFloating}
            style={floatingStyles}
            className="z-[9999]"
            {...getFloatingProps({ 'aria-labelledby': titleId })}
          >
            <div
              style={transitionStyles}
              className="w-80 max-w-[calc(100vw-2rem)] rounded-2xl border border-zinc-200 bg-white p-4 text-left shadow-2xl dark:border-zinc-700 dark:bg-zinc-900"
            >
              <div className="mb-3 flex items-start justify-between gap-3">
                <h2 id={titleId} className="text-sm font-semibold text-zinc-900 dark:text-white">
                  Install the CLI
                </h2>
                <a
                  href={CLI_GUIDE}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="Open CLI documentation"
                  title="Open CLI documentation"
                  className="cursor-pointer text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white"
                >
                  <ExternalLink size={14} aria-hidden="true" />
                </a>
              </div>
              <div className="space-y-3 text-xs">
                {CLI_INSTALL_COMMANDS.map(({ label, command, ariaLabel }) => {
                  const status = copyStatus?.command === command ? copyStatus.status : null;
                  return (
                    <div key={command}>
                      <p className="mb-1 font-medium text-zinc-600 dark:text-zinc-400">{label}</p>
                      <div className="flex items-center gap-2 rounded-lg bg-zinc-100 px-3 py-2 dark:bg-zinc-800">
                        <code className="min-w-0 flex-1 overflow-x-auto font-mono text-zinc-800 dark:text-zinc-200">
                          {command}
                        </code>
                        <button
                          type="button"
                          onClick={() => void copyCommand(command)}
                          className="flex shrink-0 cursor-pointer items-center gap-1 text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white"
                          aria-label={
                            status === 'copied'
                              ? `${ariaLabel}; copied`
                              : status === 'failed'
                                ? `${ariaLabel}; copy failed, select the command and copy it manually`
                                : ariaLabel
                          }
                          title={
                            status === 'failed'
                              ? 'Copy failed; copy the command manually'
                              : 'Copy command'
                          }
                        >
                          {status === 'copied' ? (
                            <Check size={14} aria-hidden="true" />
                          ) : (
                            <Copy size={14} aria-hidden="true" />
                          )}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </FloatingPortal>
      )}
    </>
  );
}

export default function Home() {
  const webAppHref = getAppOrigin();

  return (
    <div className="relative flex flex-col items-center justify-center min-h-screen bg-zinc-50 dark:bg-zinc-950 overflow-hidden selection:bg-zinc-900 selection:text-white dark:selection:bg-white dark:selection:text-zinc-900">
      <div className="absolute top-4 right-4 z-50">
        <HeaderActions />
      </div>
      <div className="absolute inset-0 z-0 bg-gradient-to-b from-transparent to-zinc-100/50 dark:to-zinc-900/50 pointer-events-none" />

      {/* First Light Dawn Glow */}
      <div className="absolute -top-[400px] left-1/2 -translate-x-1/2 w-[800px] h-[800px] pointer-events-none z-0">
        <div className="w-full h-full rounded-full blur-md bg-gradient-to-b from-rose-500 via-orange-400 to-amber-300 dark:from-rose-900 dark:via-orange-800 dark:to-amber-700 animate-dawn-pulse shadow-[0_0_120px_rgba(245,158,11,0.4)] dark:shadow-[0_0_120px_rgba(234,88,12,0.2)]" />
      </div>

      <main className="relative z-10 flex flex-col items-center text-center px-6 max-w-3xl mx-auto animate-fade-in">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 text-sm text-zinc-600 dark:text-zinc-400 mb-8 shadow-sm">
          <span className="flex h-2 w-2 rounded-full bg-green-500" />
          Markdawn is now in public beta
        </div>

        <h1 className="text-5xl md:text-7xl font-extrabold tracking-tight text-zinc-900 dark:text-white mb-6 leading-[1.1]">
          Welcome to Markdawn
        </h1>

        <p className="text-lg md:text-xl text-zinc-600 dark:text-zinc-400 mb-10 max-w-2xl leading-relaxed font-medium">
          The collaborative markdown editor designed for speed, simplicity, and seamless team
          synchronization. Write together in the browser, or let your terminal and AI agents work
          through the same versioned API.
        </p>

        <div className="flex flex-col sm:flex-row gap-4 w-full sm:w-auto">
          <a
            href={webAppHref}
            className="inline-flex cursor-pointer items-center justify-center rounded-full border border-zinc-200 bg-white px-8 py-3.5 text-sm font-semibold text-zinc-700 shadow-sm transition-all duration-200 hover:bg-zinc-50 hover:shadow-md dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            Web
          </a>
          <CliInstallPopover />
          <a
            href={MARKDAWN_DOCS_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex cursor-pointer items-center justify-center rounded-full border border-zinc-200 bg-white px-8 py-3.5 text-sm font-semibold text-zinc-700 shadow-sm transition-all duration-200 hover:bg-zinc-50 hover:shadow-md dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            Learn More
          </a>
        </div>
      </main>

      <style>{`
        @keyframes dawn-pulse {
          0% { opacity: 0.8; transform: scale(1) translateY(-2%); }
          50% { opacity: 1; transform: scale(1.05) translateY(2%); }
          100% { opacity: 0.9; transform: scale(1.02) translateY(0); }
        }
        .animate-dawn-pulse {
          animation: dawn-pulse 15s ease-in-out infinite alternate;
        }
      `}</style>
    </div>
  );
}
