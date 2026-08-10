import { useState } from 'react';
import { Navigate, useLocation, useParams } from 'react-router-dom';
import { OnboardingStatusBoundary } from '../components/auth/OnboardingStatusBoundary';
import { AgentSetupStep } from '../components/onboarding/AgentSetupStep';
import { ContentSetupStep } from '../components/onboarding/ContentSetupStep';
import { useIdentityLifecycle, useIdentityNavigate } from '../contexts/IdentityLifecycleContext';
import { useCompleteOnboarding } from '../hooks/useOnboarding';
import { getOnboardingDestination, withImportedDestination } from '../utils/onboardingNavigation';

function OnboardingFlow({ onboardingStep }: { onboardingStep: '1' | '2' }) {
  const navigate = useIdentityNavigate();
  const location = useLocation();
  const identityLifecycle = useIdentityLifecycle();
  const completion = useCompleteOnboarding();
  const [completionError, setCompletionError] = useState<string | null>(null);

  const finish = async () => {
    setCompletionError(null);
    try {
      await completion.mutateAsync();
      if (!identityLifecycle.isActive()) return;
      navigate(getOnboardingDestination(location.state), { replace: true });
    } catch {
      // Completing onboarding is the route's API boundary. Keep the user in the
      // flow and provide a retry rather than navigating with unsaved progress.
      if (!identityLifecycle.isActive()) return;
      setCompletionError('We could not save your onboarding progress. Please try again.');
    }
  };

  const advance = (importedDestination?: string) => {
    setCompletionError(null);
    navigate('/onboarding/2', {
      state:
        importedDestination === undefined
          ? location.state
          : withImportedDestination(location.state, importedDestination),
    });
  };

  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-50">
      <main className="flex min-h-screen flex-col items-center justify-center px-5 py-10 sm:px-8">
        {onboardingStep === '1' ? (
          <ContentSetupStep
            completionError={completionError}
            isCompleting={completion.isPending}
            onAdvance={advance}
            onSkip={() => void finish()}
          />
        ) : (
          <AgentSetupStep
            completionError={completionError}
            isWorking={completion.isPending}
            onFinish={() => void finish()}
          />
        )}
      </main>
    </div>
  );
}

export default function Onboarding() {
  const { onboardingStep } = useParams<{ onboardingStep: string }>();
  const location = useLocation();

  if (onboardingStep !== '1' && onboardingStep !== '2') {
    return <Navigate to="/onboarding/1" replace state={location.state} />;
  }

  return (
    <OnboardingStatusBoundary>
      {(onboardingStatus) => {
        if (onboardingStatus.completed) {
          return <Navigate to={getOnboardingDestination(location.state)} replace />;
        }

        return <OnboardingFlow onboardingStep={onboardingStep} />;
      }}
    </OnboardingStatusBoundary>
  );
}
