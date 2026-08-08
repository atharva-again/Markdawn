import { Loader2 } from 'lucide-react';

type LoadingIndicatorProps = {
  label: string;
  size?: 'sm' | 'md';
};

const sizeClasses = {
  sm: 'h-5 w-5',
  md: 'h-6 w-6',
} as const;

export function LoadingIndicator({ label, size = 'sm' }: LoadingIndicatorProps) {
  return (
    <div role="status" aria-label={label}>
      <Loader2
        aria-hidden="true"
        className={`${sizeClasses[size]} animate-spin text-zinc-400 dark:text-zinc-500`}
      />
    </div>
  );
}
