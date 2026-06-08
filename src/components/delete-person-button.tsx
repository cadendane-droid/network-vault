'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

type State = 'idle' | 'confirming' | 'deleting';

export default function DeletePersonButton({ personId }: { personId: string }) {
  const [state, setState] = useState<State>('idle');
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function handleConfirm() {
    setState('deleting');
    setError(null);

    try {
      const res = await fetch(`/api/people/${personId}`, { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(
          (data as { error?: string }).error ?? 'Deletion failed'
        );
      }
      router.push('/people');
    } catch {
      setError('Something went wrong — please try again.');
      setState('idle');
    }
  }

  return (
    <div className="flex flex-col items-center gap-2">
      {state === 'idle' && (
        <button
          onClick={() => setState('confirming')}
          className="text-sm text-red-500 hover:text-red-700 transition-colors"
        >
          Delete person
        </button>
      )}

      {state === 'confirming' && (
        <div className="flex items-center gap-3">
          <span className="text-sm text-zinc-500">Are you sure?</span>
          <button
            onClick={handleConfirm}
            className="text-sm font-medium text-red-600 hover:text-red-800 transition-colors"
          >
            Yes, delete
          </button>
          <button
            onClick={() => setState('idle')}
            className="text-sm text-zinc-400 hover:text-zinc-600 transition-colors"
          >
            Cancel
          </button>
        </div>
      )}

      {state === 'deleting' && (
        <span className="text-sm text-zinc-400">Deleting…</span>
      )}

      {error && <p className="text-xs text-red-500">{error}</p>}
    </div>
  );
}
