'use client';

import { useState } from 'react';

interface Props {
  /** 'upgrade' hits /api/stripe/checkout; 'portal' hits /api/stripe/portal */
  action: 'upgrade' | 'portal';
  className?: string;
  children: React.ReactNode;
}

export default function UpgradeButton({ action, className, children }: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    setLoading(true);
    setError(null);

    const endpoint =
      action === 'upgrade' ? '/api/stripe/checkout' : '/api/stripe/portal';

    try {
      const res = await fetch(endpoint, { method: 'POST' });
      const data = (await res.json()) as { url?: string; error?: string };

      if (!res.ok || !data.url) {
        setError(data.error ?? 'Something went wrong. Please try again.');
        return;
      }

      // Redirect the browser to the Stripe-hosted page.
      window.location.href = data.url;
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <button onClick={handleClick} disabled={loading} className={className}>
        {loading ? 'Redirecting…' : children}
      </button>
      {error && <p className="mt-2 text-xs text-red-500">{error}</p>}
    </div>
  );
}
