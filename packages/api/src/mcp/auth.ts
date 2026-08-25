import { cimd } from '@better-auth/cimd';
import { fetchClientMetadataResource } from '@better-auth/cimd/node';
import type { BetterAuthPlugin } from '@better-auth/core';
import { mcp } from '@better-auth/mcp';
import { jwt } from 'better-auth/plugins';
import { createAuth } from '../auth';
import {
  jwks,
  oauthAccessTokens,
  oauthClientAssertions,
  oauthClientResources,
  oauthClients,
  oauthConsents,
  oauthRefreshTokens,
  oauthResources,
} from '../db/schema';
import { betterAuthIssuer, mcpResource } from '../env';

type BetterAuthMcpPlugin = ReturnType<typeof mcp>;
type BetterAuthEndpoints = NonNullable<BetterAuthPlugin['endpoints']>;

/**
 * Better Auth 1.7.1 only disagrees about the endpoint metadata type exported
 * by the MCP package. Keep the compatibility assertion limited to that
 * property instead of hiding the complete plugin contract.
 */
function adaptMcpPlugin(plugin: BetterAuthMcpPlugin): BetterAuthPlugin {
  const { endpoints, ...pluginWithoutEndpoints } = plugin;
  return {
    ...pluginWithoutEndpoints,
    ...(endpoints === undefined ? {} : { endpoints: endpoints as BetterAuthEndpoints }),
  };
}

const resource = mcpResource();

export const mcpAuth = createAuth({
  plugins: [
    jwt({ jwt: { issuer: betterAuthIssuer(), audience: resource } }),
    adaptMcpPlugin(
      mcp({
        loginPage: '/login',
        consentPage: '/oauth/authorize',
        resource,
        resources: [{ identifier: resource, dpopBoundAccessTokensRequired: false }],
        resourceSeedMode: 'merge',
        // MCP's proxy transport forwards bearer tokens only. An empty
        // algorithm allowlist makes DPoP proof validation fail closed and
        // prevents new DPoP-bound tokens from being issued for this resource.
        dpop: { signingAlgorithms: [] },
        scopes: ['openid', 'profile', 'offline_access', 'pages:read', 'pages:write'],
        allowDynamicClientRegistration: true,
        allowUnauthenticatedClientRegistration: true,
      }),
    ),
    cimd({
      fetchClientMetadataResource,
      metadataProfile: 'mcp-2026-07-28',
    }),
  ],
  schema: {
    jwks,
    oauthClient: oauthClients,
    oauthResource: oauthResources,
    oauthClientResource: oauthClientResources,
    oauthRefreshToken: oauthRefreshTokens,
    oauthAccessToken: oauthAccessTokens,
    oauthConsent: oauthConsents,
    oauthClientAssertion: oauthClientAssertions,
  },
});
