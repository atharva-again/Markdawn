const REPOSITORY_PLACEHOLDER_SECRETS = new Set([
  'replace-with-a-separate-random-secret',
  'use-a-different-random-secret-here',
]);

/** Validate the private API-to-collaboration trust credential at startup. */
export function requireCollaborationInternalSecret(secret: string | undefined): string {
  if (!secret) throw new Error('COLLAB_INTERNAL_SECRET is required');
  if (REPOSITORY_PLACEHOLDER_SECRETS.has(secret)) {
    throw new Error('COLLAB_INTERNAL_SECRET must not use a repository placeholder');
  }
  if (secret.length < 32) {
    throw new Error('COLLAB_INTERNAL_SECRET must be at least 32 characters');
  }
  return secret;
}
