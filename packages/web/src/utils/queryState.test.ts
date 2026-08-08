import { describe, expect, it } from 'vitest';
import { getInitialQueriesState, type InitialQueryState } from './queryState';

const queryState = (overrides: Partial<InitialQueryState>): InitialQueryState => ({
  data: undefined,
  error: null,
  isPending: true,
  isFetching: true,
  fetchStatus: 'fetching',
  ...overrides,
});

describe('getInitialQueriesState', () => {
  it('reports an initial load failure when no cached data exists', () => {
    expect(getInitialQueriesState([queryState({ error: new Error('offline') })])).toEqual({
      status: 'error',
    });
  });

  it('keeps cached data visible after a background refresh failure', () => {
    expect(
      getInitialQueriesState([
        queryState({ data: ['cached'], error: new Error('offline'), isPending: false }),
      ]),
    ).toEqual({ status: 'ready' });
  });

  it('reports only an active first fetch as initial loading', () => {
    expect(getInitialQueriesState([queryState({})])).toEqual({ status: 'loading' });
    expect(getInitialQueriesState([queryState({ data: ['cached'], isPending: false })])).toEqual({
      status: 'ready',
    });
  });

  it('reports an offline first fetch as paused instead of loading forever', () => {
    expect(
      getInitialQueriesState([queryState({ isFetching: false, fetchStatus: 'paused' })]),
    ).toEqual({ status: 'paused' });
  });
});
