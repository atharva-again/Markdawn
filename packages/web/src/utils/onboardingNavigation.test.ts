import { describe, expect, it } from 'vitest';
import {
  getOnboardingDestination,
  getWorkspaceDestination,
  withImportedDestination,
} from './onboardingNavigation';

describe('onboarding navigation', () => {
  it('preserves workspace destinations including search and hash', () => {
    const state = { destination: '/app/folder/example?view=list#page' };

    expect(getOnboardingDestination(state)).toBe('/app/folder/example?view=list#page');
  });

  it('preserves query strings and hashes on the workspace root', () => {
    expect(getOnboardingDestination({ destination: '/app?tab=x' })).toBe('/app?tab=x');
    expect(getOnboardingDestination({ destination: '/app#section' })).toBe('/app#section');
    expect(getWorkspaceDestination({ pathname: '/app', search: '?tab=x' })).toBe('/app?tab=x');
    expect(getWorkspaceDestination({ pathname: '/app', hash: '#section' })).toBe('/app#section');
  });

  it('rejects destinations outside the workspace', () => {
    expect(getOnboardingDestination({ destination: 'https://example.com/app' })).toBe('/app');
    expect(getOnboardingDestination({ destination: '/app/../../login' })).toBe('/app');
  });

  it('replaces only the plain workspace root with an imported page', () => {
    const imported = withImportedDestination(
      { destination: '/app' },
      '/app/imported-11111111-1111-4111-8111-111111111111',
    );
    expect(getOnboardingDestination(imported)).toBe(
      '/app/imported-11111111-1111-4111-8111-111111111111',
    );

    expect(
      withImportedDestination({ destination: '/app/original-destination' }, '/app/imported-page'),
    ).toEqual({ destination: '/app/original-destination' });
    expect(withImportedDestination({ destination: '/app?tab=x' }, '/app/imported-page')).toEqual({
      destination: '/app?tab=x',
    });
  });
});
