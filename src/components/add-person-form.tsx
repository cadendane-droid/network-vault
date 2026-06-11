'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { FREE_PERSON_LIMIT } from '@/lib/limits';

const SOURCE_KINDS = [
  { value: 'conversation', label: 'Conversation' },
  { value: 'note', label: 'Note' },
  { value: 'profile', label: 'Profile' },
  { value: 'observation', label: 'Observation' },
] as const;

function todayISODate() {
  return new Date().toISOString().split('T')[0];
}

export default function AddPersonForm() {
  const router = useRouter();

  const [name, setName] = useState('');
  const [sourceKind, setSourceKind] = useState<string>('note');
  const [sourceDate, setSourceDate] = useState(todayISODate());
  const [rawText, setRawText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [limitReached, setLimitReached] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      const res = await fetch('/api/people', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          raw_text: rawText.trim(),
          source_kind: sourceKind,
          source_date: sourceDate,
        }),
      });

      if (!res.ok) {
        // 402 = free-tier limit hit — show upgrade prompt instead of generic error.
        if (res.status === 402) {
          setLimitReached(true);
          setSubmitting(false);
          return;
        }
        const data = await res.json().catch(() => ({}));
        setError((data as { error?: string }).error ?? 'Something went wrong.');
        setSubmitting(false);
        return;
      }

      const { person_id } = (await res.json()) as { person_id: string };
      router.push(`/people/${person_id}`);
    } catch {
      setError('Network error. Please try again.');
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-5">
      {/* Name */}
      <div className="flex flex-col gap-1.5">
        <label htmlFor="name" className="text-sm font-medium text-zinc-700">
          Name <span className="text-zinc-400">(required)</span>
        </label>
        <input
          id="name"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Full name"
          required
          disabled={submitting}
          className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2.5 text-base text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-900 disabled:opacity-50"
        />
      </div>

      {/* Source kind */}
      <div className="flex flex-col gap-1.5">
        <label
          htmlFor="source-kind"
          className="text-sm font-medium text-zinc-700"
        >
          Source type
        </label>
        <select
          id="source-kind"
          value={sourceKind}
          onChange={(e) => setSourceKind(e.target.value)}
          disabled={submitting}
          className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2.5 text-base text-zinc-900 focus:outline-none focus:ring-2 focus:ring-zinc-900 disabled:opacity-50"
        >
          {SOURCE_KINDS.map((k) => (
            <option key={k.value} value={k.value}>
              {k.label}
            </option>
          ))}
        </select>
      </div>

      {/* Date */}
      <div className="flex flex-col gap-1.5">
        <label
          htmlFor="source-date"
          className="text-sm font-medium text-zinc-700"
        >
          Date
        </label>
        <input
          id="source-date"
          type="date"
          value={sourceDate}
          onChange={(e) => setSourceDate(e.target.value)}
          disabled={submitting}
          className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2.5 text-base text-zinc-900 focus:outline-none focus:ring-2 focus:ring-zinc-900 disabled:opacity-50"
        />
      </div>

      {/* Notes */}
      <div className="flex flex-col gap-1.5">
        <label htmlFor="raw-text" className="text-sm font-medium text-zinc-700">
          Notes <span className="text-zinc-400">(required)</span>
        </label>
        <textarea
          id="raw-text"
          value={rawText}
          onChange={(e) => setRawText(e.target.value)}
          placeholder="Write everything you know about this person — their role, where you met, what you talked about, shared connections, interests…"
          required
          rows={8}
          disabled={submitting}
          className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2.5 text-base text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-900 disabled:opacity-50 resize-none"
        />
      </div>

      {/* Limit reached (402) — upgrade prompt */}
      {limitReached && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5">
          <p className="text-sm text-amber-800">
            You&apos;ve reached the {FREE_PERSON_LIMIT}-person limit on the free
            plan.{' '}
            <Link
              href="/account"
              className="font-semibold underline underline-offset-2 hover:text-amber-900"
            >
              Upgrade to Pro
            </Link>{' '}
            to add unlimited people.
          </p>
        </div>
      )}

      {/* Generic error */}
      {error && !limitReached && (
        <p className="text-sm text-red-600">{error}</p>
      )}

      {/* Submit */}
      <button
        type="submit"
        disabled={submitting || name.trim() === '' || rawText.trim() === ''}
        className="w-full rounded-full bg-zinc-900 py-3 text-base font-medium text-white transition-colors hover:bg-zinc-700 disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {submitting ? 'Processing…' : 'Add person'}
      </button>
    </form>
  );
}
