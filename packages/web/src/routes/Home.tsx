import { Link, Navigate } from 'react-router-dom';
import { HeaderActions } from '../components/HeaderActions';
import { useAuth } from '../hooks/useAuth';

const GITHUB_REPO = 'https://github.com/atharva-again/Markdawn';
const CLI_GUIDE = `${GITHUB_REPO}/tree/master/cli`;

export default function Home() {
  const { data: session } = useAuth();

  if (session?.user) {
    return <Navigate to="/app" replace />;
  }
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
          <Link
            to="/login"
            className="inline-flex items-center justify-center px-8 py-3.5 text-sm font-semibold text-white bg-zinc-900 dark:bg-white dark:text-zinc-900 rounded-full hover:bg-zinc-800 dark:hover:bg-zinc-100 transition-all duration-200 shadow-lg hover:shadow-xl hover:-translate-y-0.5 active:translate-y-0 ring-1 ring-zinc-900 dark:ring-white"
          >
            Get Started
          </Link>
          <a
            href={GITHUB_REPO}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center justify-center px-8 py-3.5 text-sm font-semibold text-zinc-700 dark:text-zinc-300 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-full hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-all duration-200 shadow-sm hover:shadow-md"
          >
            Learn More
          </a>
          <a
            href={CLI_GUIDE}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center justify-center px-8 py-3.5 text-sm font-semibold text-zinc-700 dark:text-zinc-300 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-full hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-all duration-200 shadow-sm hover:shadow-md"
          >
            CLI &amp; agents
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
