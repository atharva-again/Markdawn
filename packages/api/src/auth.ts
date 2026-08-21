import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { authDatabase, getAuthTransaction } from './db/authTransaction';
import { accounts, sessions, users, verifications } from './db/schema';
import { publicFrontendUrl } from './utils/publicWebUrl';
import { createWelcomePageForUser } from './utils/welcomePage';

type CreateAuthOptions = {
  provisionWelcomePage?: typeof createWelcomePageForUser;
};

export function createAuth(options: CreateAuthOptions = {}) {
  const provisionWelcomePage = options.provisionWelcomePage ?? createWelcomePageForUser;

  return betterAuth({
    baseURL: publicFrontendUrl,
    trustedOrigins: [publicFrontendUrl],
    database: drizzleAdapter(authDatabase, {
      provider: 'pg',
      transaction: true,
      schema: {
        user: users,
        session: sessions,
        account: accounts,
        verification: verifications,
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
            await provisionWelcomePage(getAuthTransaction(), user.id);
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
