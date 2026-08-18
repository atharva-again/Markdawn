import clsx from 'clsx';
import { PageTree } from './sidebar/PageTree';

interface SidebarProps {
  className?: string;
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
}

export function Sidebar({ className, collapsed = false }: SidebarProps) {
  return (
    <aside
      className={clsx(
        'w-full h-full flex flex-col flex-shrink-0 z-40 relative overflow-hidden rounded-[1.25rem] border border-zinc-200/80 dark:border-zinc-800 bg-white/95 dark:bg-[#111113]/95 backdrop-blur-xl shadow-[0_12px_36px_rgba(24,24,27,0.08)] dark:shadow-[0_18px_48px_rgba(0,0,0,0.28)] transition-all duration-500 ease-[cubic-bezier(0.16,1,0.3,1)]',
        collapsed ? 'w-[68px]' : 'w-[240px]',
        className,
      )}
      data-testid={collapsed ? 'sidebar-collapsed' : 'sidebar'}
    >
      <div
        className={clsx(
          'absolute inset-0 flex flex-col items-center py-5 transition-all duration-400 ease-[cubic-bezier(0.16,1,0.3,1)]',
          collapsed
            ? 'opacity-100 translate-x-0 pointer-events-auto delay-100'
            : 'opacity-0 -translate-x-8 pointer-events-none',
        )}
      >
        <div className="flex-1 flex flex-col items-center gap-4 w-full pt-2" />
      </div>

      <div
        className={clsx(
          'absolute inset-0 flex flex-col transition-all duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] w-[240px]',
          collapsed
            ? 'opacity-0 translate-x-8 pointer-events-none'
            : 'opacity-100 translate-x-0 pointer-events-auto delay-100',
        )}
      >
        <div className="relative z-0 flex-1 overflow-hidden flex flex-col pt-3">
          <PageTree />
        </div>
      </div>
    </aside>
  );
}
