import type { ReactNode } from 'react';
import { type OnboardingStatus, useOnboardingStatus } from '../../hooks/useOnboarding';
import { LoadingIndicator } from '../ui/LoadingIndicator';

type OnboardingStatusBoundaryProps = {
  children: (status: OnboardingStatus) => ReactNode;
};

export function OnboardingStatusBoundary({ children }: OnboardingStatusBoundaryProps) {
  const onboardingStatus = useOnboardingStatus();

  if (onboardingStatus.isPending) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-white dark:bg-zinc-950">
        <LoadingIndicator label="Preparing your workspace" size="md" />
      </div>
    );
  }

  if (onboardingStatus.isError) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-white px-6 dark:bg-zinc-950">
        <div className="max-w-sm text-center">
          <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
            We could not prepare your workspace
          </h1>
          <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
            Check your connection and try again.
          </p>
          <button
            type="button"
            onClick={() => void onboardingStatus.refetch()}
            className="mt-5 rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200 cursor-pointer"
          >
            Try again
          </button>
        </div>
      </div>
    );
  }

  if (!onboardingStatus.data) {
    throw new Error('Onboarding status resolved without data');
  }

  return <>{children(onboardingStatus.data)}</>;
}
