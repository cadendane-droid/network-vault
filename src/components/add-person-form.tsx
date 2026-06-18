'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import { PERSON_LIMIT } from '@/lib/limits';
import { useCapture } from '@/components/capture-animation';

// Carries the API error code alongside the message so the catch block can
// branch on PEOPLE_LIMIT without re-reading the response.
class SubmitError extends Error {
  code?: string;
  constructor(message: string, code?: string) {
    super(message);
    this.code = code;
  }
}

export default function AddPersonForm() {
  const capture = useCapture();

  const [name, setName] = useState('');
  const [rawText, setRawText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [limitReached, setLimitReached] = useState(false);
  const submitRef = useRef<HTMLButtonElement>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLimitReached(false);
    setSubmitting(true);

    // Capture the animation origin at tap time (t=0), before any await.
    const originRect = submitRef.current?.getBoundingClientRect() ?? null;

    // Fire the POST immediately and expose it as a promise resolving to the
    // person id. The capture overlay drives the float + navigation off this;
    // we also await it below purely for the form's own error UX.
    const personIdPromise = (async () => {
      let res: Response;
      try {
        res = await fetch('/api/people', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: name.trim(),
            raw_text: rawText.trim(),
          }),
        });
      } catch {
        throw new SubmitError('Network error. Please try again.');
      }

      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as {
          error?: string;
          message?: string;
        };
        throw new SubmitError(
          data.message ?? data.error ?? 'Something went wrong.',
          data.error
        );
      }

      const { person_id } = (await res.json()) as { person_id: string };
      return person_id;
    })();

    // Start the fold-into-constellation animation. On rejection the overlay
    // cancels itself; we surface the error here.
    capture.start({ name: name.trim(), originRect, personIdPromise });

    try {
      await personIdPromise;
      // Success — the overlay owns navigation to /network. Leave the button in
      // its saving state; this form unmounts on the route change.
    } catch (err) {
      setSubmitting(false);
      // Person cap hit — show the dedicated banner instead of a generic error.
      // Other limit errors (e.g. DAILY_UPLOAD_LIMIT) carry their own message.
      if (err instanceof SubmitError && err.code === 'PEOPLE_LIMIT') {
        setLimitReached(true);
        return;
      }
      setError(err instanceof Error ? err.message : 'Something went wrong.');
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
        ref={submitRef}
        type="submit"
        disabled={submitting || name.trim() === '' || rawText.trim() === ''}
        className="w-full rounded-full bg-zinc-900 py-3 text-base font-medium text-white transition-colors hover:bg-zinc-700 disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {submitting ? 'Saving…' : 'Add person'}
      </button>
    </form>
  );
}
