import type { BetterAuthPlugin } from '@better-auth/core';
import { getApiLogger } from '@markdawn/shared';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { db } from './db/connection';
import { accounts, sessions, users, verifications } from './db/schema';
import { publicFrontendUrl } from './utils/publicWebUrl';
import { createWelcomePageForUser } from './utils/welcomePage';

type CreateAuthOptions = {
  provisionWelcomePage?: typeof createWelcomePageForUser;
  plugins?: BetterAuthPlugin[];
  schema?: Record<string, unknown>;
};

export function createAuth(options: CreateAuthOptions = {}) {
  const provisionWelcomePage = options.provisionWelcomePage ?? createWelcomePageForUser;

  return betterAuth({
    baseURL: publicFrontendUrl,
    trustedOrigins: [publicFrontendUrl],
    plugins: options.plugins ?? [],
    database: drizzleAdapter(db, {
      provider: 'pg',
      transaction: true,
      schema: {
        user: users,
        session: sessions,
        account: accounts,
        verification: verifications,
        ...options.schema,
      },
    }),
    advanced: {
      database: {
        generateId: false,
      },
    },
    databaseHooks: {
      user: {
        create: {
          after: async (user) => {
            try {
              await db.transaction(async (transaction) => {
                await provisionWelcomePage(transaction, user.id);
              });
            } catch (error) {
              // The welcome page is optional. Better Auth 1.7 runs create.after
              // hooks after its transaction commits, so report provisioning
              // failures without turning a successful signup into an error.
              getApiLogger().error('Welcome page provisioning failed after signup', {
                userId: user.id,
                error: error instanceof Error ? error.message : String(error),
              });
            }
          },
        },
      },
    },
    socialProviders: {
      github: {
        clientId: process.env.GITHUB_CLIENT_ID as string,
        clientSecret: process.env.GITHUB_CLIENT_SECRET as string,
      },
      google: {
        clientId: process.env.GOOGLE_CLIENT_ID as string,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET as string,
      },
    },
  });
}

export const auth = createAuth();
