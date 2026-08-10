import { AsyncLocalStorage } from 'node:async_hooks';
import { db } from './connection';
import type { QueryExecutor } from './query';

type DatabaseTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type TransactionConfig = Parameters<typeof db.transaction>[1];

const authTransactionStorage = new AsyncLocalStorage<QueryExecutor>();

const transaction = (<T>(
  callback: (transaction: DatabaseTransaction) => Promise<T>,
  config?: TransactionConfig,
) =>
  db.transaction(
    (databaseTransaction) =>
      authTransactionStorage.run(databaseTransaction, () => callback(databaseTransaction)),
    config,
  )) as typeof db.transaction;

/**
 * Gives Better Auth a normal Drizzle database while retaining access to the
 * raw Drizzle transaction used by its lifecycle hooks.
 *
 * Better Auth 1.4.18 opens this transaction before the Google/GitHub shared
 * user-creation path invokes databaseHooks.user.create.after. Keep
 * auth-welcome-page.test.ts passing and revalidate that ordering on upgrades.
 */
export const authDatabase = new Proxy(db, {
  get(target, property) {
    if (property === 'transaction') return transaction;
    const value: unknown = Reflect.get(target, property, target);
    return typeof value === 'function' ? value.bind(target) : value;
  },
});

export function getAuthTransaction(): QueryExecutor {
  const transactionExecutor = authTransactionStorage.getStore();
  if (!transactionExecutor) {
    throw new Error('Welcome page provisioning requires an active Better Auth transaction');
  }
  return transactionExecutor;
}
