import { describe, expect, it } from 'vitest';
import {
  getOnboardingDestination,
  getWorkspaceDestination,
  withImportedDestination,
} from './onboardingNavigation';

describe('onboarding navigation', () => {
  it('preserves workspace destinations including search and hash', () => {
    const state = { destination: '/folder/example?view=list#page' };

    expect(getOnboardingDestination(state)).toBe('/folder/example?view=list#page');
  });

  it('preserves query strings and hashes on the workspace root', () => {
    expect(getOnboardingDestination({ destination: '/?tab=x' })).toBe('/?tab=x');
    expect(getOnboardingDestination({ destination: '/#section' })).toBe('/#section');
    expect(getWorkspaceDestination({ pathname: '/', search: '?tab=x' })).toBe('/?tab=x');
    expect(getWorkspaceDestination({ pathname: '/', hash: '#section' })).toBe('/#section');
  });

  it('rejects destinations outside the workspace', () => {
    expect(getOnboardingDestination({ destination: 'https://example.com/app' })).toBe('/');
    expect(getOnboardingDestination({ destination: '/../../login' })).toBe('/');
  });

  it('replaces only the plain workspace root with an imported page', () => {
    const imported = withImportedDestination(
      { destination: '/' },
      '/imported-11111111-1111-4111-8111-111111111111',
    );
    expect(getOnboardingDestination(imported)).toBe(
      '/imported-11111111-1111-4111-8111-111111111111',
    );

    expect(
      withImportedDestination({ destination: '/original-destination' }, '/imported-page'),
    ).toEqual({ destination: '/original-destination' });
    expect(withImportedDestination({ destination: '/?tab=x' }, '/imported-page')).toEqual({
      destination: '/?tab=x',
    });
  });
});
