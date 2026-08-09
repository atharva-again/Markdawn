import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { OnboardingStatusBoundary } from './OnboardingStatusBoundary';

type OnboardingGateProps = {
  children: ReactNode;
};

export function OnboardingGate({ children }: OnboardingGateProps) {
  const location = useLocation();

  return (
    <OnboardingStatusBoundary>
      {(onboardingStatus) => {
        if (!onboardingStatus.completed) {
          return <Navigate to="/onboarding/1" replace state={{ from: location }} />;
        }

        return <>{children}</>;
      }}
    </OnboardingStatusBoundary>
  );
}
