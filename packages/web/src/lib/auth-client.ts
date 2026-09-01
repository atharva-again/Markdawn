import { oauthProviderClient } from '@better-auth/oauth-provider/client';
import type { BetterAuthClientOptions } from 'better-auth/client';
import { createAuthClient, type ReactAuthClient } from 'better-auth/react';

type MarkdawnAuthClientOptions = BetterAuthClientOptions & {
  plugins: [ReturnType<typeof oauthProviderClient>];
};

export const authClient: ReactAuthClient<MarkdawnAuthClientOptions> = createAuthClient({
  baseURL: `${window.location.origin}/api/auth`,
  plugins: [oauthProviderClient()],
});
