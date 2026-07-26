import { Check, Copy, KeyRound, Trash2 } from 'lucide-react';
import { useState } from 'react';
import {
  type ApiToken,
  useApiTokens,
  useCreateApiToken,
  useRevokeApiToken,
} from '../../hooks/useApiTokens';
import { showErrorToast, showSuccessToast } from '../../utils/toast';

export function ApiTokensPanel() {
  const [name, setName] = useState('');
  const [canWrite, setCanWrite] = useState(false);
  const [expiryDays, setExpiryDays] = useState('');
  const [createdSecret, setCreatedSecret] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const tokensQuery = useApiTokens();
  const createMutation = useCreateApiToken(setCreatedSecret);
  const revokeMutation = useRevokeApiToken();
  const tokens = tokensQuery.data ?? [];

  const createToken = () => {
    if (!name.trim()) return;
    createMutation.mutate(
      {
        name: name.trim(),
        canWrite,
        expiresAt: expiryDays
          ? new Date(Date.now() + Number(expiryDays) * 24 * 60 * 60 * 1000).toISOString()
          : null,
      },
      {
        onSuccess: () => {
          setName('');
          setCanWrite(false);
          setExpiryDays('');
        },
        onError: (error) => showErrorToast(error.message),
      },
    );
  };

  const revokeToken = (token: ApiToken) => {
    if (!window.confirm(`Revoke “${token.name}”? Applications using it will stop working.`)) return;
    revokeMutation.mutate(token.id, {
      onSuccess: () => showSuccessToast('API token revoked'),
      onError: (error) => showErrorToast(error.message),
    });
  };

  const copySecret = async () => {
    if (!createdSecret) return;
    await navigator.clipboard.writeText(createdSecret);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">API tokens</h2>
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          Create named tokens for the Markdawn CLI and local agents. New tokens are read-only by
          default.
        </p>
      </div>

      {createdSecret && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-950/30">
          <p className="text-sm font-medium text-amber-950 dark:text-amber-100">
            Copy this token now. It will not be shown again.
          </p>
          <div className="mt-3 flex gap-2">
            <input
              readOnly
              value={createdSecret}
              aria-label="New API token"
              className="min-w-0 flex-1 rounded-md border border-amber-300 bg-white px-3 py-2 font-mono text-xs text-zinc-900 dark:border-amber-800 dark:bg-zinc-950 dark:text-zinc-100"
            />
            <button
              type="button"
              onClick={() => void copySecret()}
              className="inline-flex cursor-pointer items-center gap-2 rounded-md bg-zinc-900 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-800 dark:bg-zinc-700 dark:hover:bg-zinc-600"
            >
              {copied ? <Check size={16} /> : <Copy size={16} />}
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
          <button
            type="button"
            onClick={() => setCreatedSecret(null)}
            className="mt-3 cursor-pointer text-xs font-medium text-amber-900 underline dark:text-amber-200"
          >
            I have saved it
          </button>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
        <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300">
          Token name
          <input
            value={name}
            maxLength={100}
            onChange={(event) => setName(event.target.value)}
            placeholder="Personal terminal"
            className="mt-1 block w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
          />
        </label>
        <button
          type="button"
          disabled={!name.trim() || createMutation.isPending}
          onClick={createToken}
          className="inline-flex cursor-pointer items-center justify-center gap-2 rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-700 dark:hover:bg-zinc-600"
        >
          <KeyRound size={16} />
          {createMutation.isPending ? 'Creating…' : 'Create token'}
        </button>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex cursor-pointer items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300">
          <input
            type="checkbox"
            checked={canWrite}
            onChange={(event) => setCanWrite(event.target.checked)}
            className="size-4"
          />
          Allow this token to create and edit pages
        </label>
        <label className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
          Expiry
          <select
            value={expiryDays}
            onChange={(event) => setExpiryDays(event.target.value)}
            className="mt-1 block w-full cursor-pointer rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
          >
            <option value="">No expiry</option>
            <option value="7">7 days</option>
            <option value="30">30 days</option>
            <option value="90">90 days</option>
            <option value="365">1 year</option>
          </select>
        </label>
      </div>

      <div className="divide-y divide-zinc-200 rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
        {tokensQuery.isLoading && <p className="p-4 text-sm text-zinc-500">Loading tokens…</p>}
        {tokensQuery.isError && (
          <p className="p-4 text-sm text-red-600 dark:text-red-400">{tokensQuery.error.message}</p>
        )}
        {!tokensQuery.isLoading && !tokensQuery.isError && tokens.length === 0 && (
          <p className="p-4 text-sm text-zinc-500">No API tokens yet.</p>
        )}
        {tokens.map((token) => (
          <div key={token.id} className="flex items-center justify-between gap-4 p-4">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">
                {token.name}
              </p>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                {token.scopes.includes('pages:write') ? 'Read and write' : 'Read only'} ·{' '}
                {token.lastUsedAt
                  ? `Last used ${new Date(token.lastUsedAt).toLocaleDateString()}`
                  : 'Never used'}
                {token.expiresAt
                  ? ` · Expires ${new Date(token.expiresAt).toLocaleDateString()}`
                  : ' · No expiry'}
              </p>
            </div>
            <button
              type="button"
              onClick={() => revokeToken(token)}
              aria-label={`Revoke ${token.name}`}
              className="cursor-pointer rounded-md p-2 text-zinc-500 hover:bg-red-50 hover:text-red-700 dark:hover:bg-red-950/40 dark:hover:text-red-300"
            >
              <Trash2 size={16} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
