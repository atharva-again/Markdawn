import { ChevronDown, ChevronRight } from 'lucide-react';
import type { ReactNode } from 'react';
import { SidebarEntityRow, type SidebarRowModel } from './SidebarEntityRow';
import type { SidebarTreeRuntime } from './sidebarRuntime';

export type SidebarAliasRow = {
  key: string;
  row: SidebarRowModel;
};

export function SidebarSection({
  title,
  collapsed,
  onToggle,
  children,
}: {
  title: string;
  collapsed: boolean;
  onToggle(): void;
  children: ReactNode;
}) {
  return (
    <section className="mb-1" aria-label={title}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={!collapsed}
        className="group/section flex w-full items-center justify-between px-2.5 py-1.5 text-left text-[11px] font-bold uppercase tracking-wider text-zinc-400 hover:text-zinc-600 dark:text-zinc-500 dark:hover:text-zinc-300 cursor-pointer transition-colors"
      >
        <span>{title}</span>
        {collapsed ? (
          <ChevronRight size={13} className="shrink-0 opacity-70" />
        ) : (
          <ChevronDown size={13} className="shrink-0 opacity-70" />
        )}
      </button>
      {!collapsed && children}
    </section>
  );
}

export function SidebarAliasSection({
  title,
  collapsed,
  onToggle,
  rows,
  runtime,
}: {
  title: string;
  collapsed: boolean;
  onToggle(): void;
  rows: readonly SidebarAliasRow[];
  runtime: SidebarTreeRuntime;
}) {
  if (rows.length === 0) return null;
  return (
    <SidebarSection title={title} collapsed={collapsed} onToggle={onToggle}>
      <div className="space-y-px">
        {rows.map(({ key, row }) => (
          <SidebarEntityRow key={key} runtime={runtime} entity={row} placement="alias" />
        ))}
      </div>
    </SidebarSection>
  );
}
