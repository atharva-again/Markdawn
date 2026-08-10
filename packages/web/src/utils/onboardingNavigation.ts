type LocationLike = {
  pathname: string;
  search?: string;
  hash?: string;
};

type OnboardingNavigationState = {
  destination?: unknown;
};

function isWorkspacePath(path: string): boolean {
  return path === '/app' || path.startsWith('/app/');
}

function getSafeWorkspacePath(value: unknown): string | null {
  if (typeof value !== 'string') return null;

  try {
    const url = new URL(value, window.location.origin);
    if (url.origin !== window.location.origin || !isWorkspacePath(url.pathname)) return null;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    // Navigation state is untrusted browser history data. A malformed URL is
    // rejected here and translated to a boundary-safe destination by callers.
    return null;
  }
}

function parseNavigationState(state: unknown): OnboardingNavigationState | null {
  return state && typeof state === 'object' ? (state as OnboardingNavigationState) : null;
}

export function getWorkspaceDestination(location: LocationLike): string {
  const destination = getSafeWorkspacePath(
    `${location.pathname}${location.search ?? ''}${location.hash ?? ''}`,
  );
  if (!destination) {
    throw new Error('Onboarding gate requires a workspace destination');
  }
  return destination;
}

export function getOnboardingDestination(state: unknown): string {
  return getSafeWorkspacePath(parseNavigationState(state)?.destination) ?? '/app';
}

export function withImportedDestination(state: unknown, importedDestination: string) {
  const parsedImportedDestination = getSafeWorkspacePath(importedDestination);
  if (!parsedImportedDestination) {
    throw new Error('Imported content requires a workspace destination');
  }

  const destination = getOnboardingDestination(state);
  return {
    destination: destination === '/app' ? parsedImportedDestination : destination,
  };
}
