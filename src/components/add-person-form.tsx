'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { PERSON_LIMIT } from '@/lib/limits';

export default function AddPersonForm() {
  const router = useRouter();

  const [name, setName] = useState('');
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
        }),
      });

      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as {
          error?: string;
          message?: string;
        };
        // Person cap hit — show the dedicated banner instead of a generic
        // error. Other limit errors (e.g. DAILY_UPLOAD_LIMIT) also come back
        // as 402 but carry their own message.
        if (data.error === 'PEOPLE_LIMIT') {
          setLimitReached(true);
          setSubmitting(false);
          return;
        }
        setError(data.message ?? data.error ?? 'Something went wrong.');
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
            You&apos;ve reached the {PERSON_LIMIT}-person limit for the beta.{' '}
            <Link
              href="/account"
              className="font-semibold underline underline-offset-2 hover:text-amber-900"
            >
              View your usage
            </Link>{' '}
            on the account page.
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
