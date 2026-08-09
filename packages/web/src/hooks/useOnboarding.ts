import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../utils/api';

const STATUS_QUERY_KEY = ['onboarding', 'status'] as const;

export type OnboardingStatus = {
  completed: boolean;
};

function parseOnboardingStatus(payload: unknown): OnboardingStatus {
  if (
    !payload ||
    typeof payload !== 'object' ||
    !('completed' in payload) ||
    typeof payload.completed !== 'boolean'
  ) {
    throw new Error('Invalid onboarding status response');
  }
  return { completed: payload.completed };
}

async function fetchOnboardingStatus(): Promise<OnboardingStatus> {
  return parseOnboardingStatus(await apiFetch<unknown>('/onboarding'));
}

async function completeOnboarding(): Promise<OnboardingStatus> {
  return parseOnboardingStatus(await apiFetch<unknown>('/onboarding/complete', { method: 'POST' }));
}

export function useOnboardingStatus() {
  return useQuery({
    queryKey: STATUS_QUERY_KEY,
    queryFn: fetchOnboardingStatus,
    staleTime: Number.POSITIVE_INFINITY,
  });
}

export function useCompleteOnboarding() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: completeOnboarding,
    onSuccess: (status) => {
      queryClient.setQueryData(STATUS_QUERY_KEY, status);
    },
  });
}
