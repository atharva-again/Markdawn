export interface InitialQueryState {
  data: unknown;
  error: unknown;
  isPending: boolean;
  isFetching: boolean;
  fetchStatus: 'fetching' | 'paused' | 'idle';
}

export type InitialQueriesState =
  | { status: 'loading' }
  | { status: 'paused' }
  | { status: 'error' }
  | { status: 'ready' };

export function getInitialQueriesState(queries: InitialQueryState[]): InitialQueriesState {
  const initialQueries = queries.filter(({ data }) => data === undefined);
  if (initialQueries.some(({ error }) => error !== null && error !== undefined)) {
    return { status: 'error' };
  }
  if (initialQueries.some(({ isPending, fetchStatus }) => isPending && fetchStatus === 'paused')) {
    return { status: 'paused' };
  }
  if (initialQueries.some(({ isPending, isFetching }) => isPending && isFetching)) {
    return { status: 'loading' };
  }
  return { status: 'ready' };
}
