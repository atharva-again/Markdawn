export type AuthenticatedCredential =
  | { kind: 'session'; raw: string }
  | {
      kind: 'internal';
      raw: string;
      tokenId: string | null;
      idempotencyPrincipal: string;
    };

export function authenticatedCredentialKey(credential: AuthenticatedCredential): string {
  return `${credential.kind}:${credential.raw}`;
}
