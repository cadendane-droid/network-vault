'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

type State = 'closed' | 'open' | 'confirming' | 'deleting';

// Three-dots menu in the profile header. Deleting a person lives here —
// behind the menu — rather than as a standalone button on the page.
export default function ProfileMenu({ personId }: { personId: string }) {
  const [state, setState] = useState<State>('closed');
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
      setState('open');
    }
  }

  const isOpen = state !== 'closed';

  const menuItemStyle: React.CSSProperties = {
    width: '100%',
    border: 'none',
    background: 'none',
    padding: '10px 14px',
    textAlign: 'left',
    fontFamily: 'var(--font-sans)',
    fontSize: 'var(--text-sm)',
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  };

  return (
    <div style={{ position: 'relative', flexShrink: 0 }}>
      <button
        aria-label="More options"
        aria-expanded={isOpen}
        onClick={() => setState(isOpen ? 'closed' : 'open')}
        style={{
          width: 40,
          height: 40,
          borderRadius: '50%',
          background: 'var(--surface-card)',
          border: '1px solid var(--border-subtle)',
          color: 'var(--ink-700)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
        }}
      >
        <svg
          width="18"
          height="18"
          viewBox="0 0 20 20"
          fill="currentColor"
          aria-hidden="true"
        >
          <path d="M10 6a2 2 0 110-4 2 2 0 010 4zM10 12a2 2 0 110-4 2 2 0 010 4zM10 18a2 2 0 110-4 2 2 0 010 4z" />
        </svg>
      </button>

      {isOpen && (
        <>
          {/* Invisible backdrop — click anywhere outside to close */}
          <div
            style={{ position: 'fixed', inset: 0, zIndex: 20 }}
            onClick={() => setState('closed')}
          />

          {/* Dropdown */}
          <div
            style={{
              position: 'absolute',
              top: 'calc(100% + 6px)',
              right: 0,
              zIndex: 21,
              minWidth: 180,
              background: 'var(--surface-card)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 'var(--radius-md)',
              boxShadow: 'var(--shadow-md)',
              overflow: 'hidden',
              padding: '4px 0',
            }}
          >
            {state === 'open' && (
              <button
                onClick={() => setState('confirming')}
                style={{ ...menuItemStyle, color: 'var(--danger)' }}
              >
                Delete person
              </button>
            )}

            {state === 'confirming' && (
              <div style={{ padding: '10px 14px' }}>
                <p
                  style={{
                    margin: '0 0 8px',
                    fontFamily: 'var(--font-sans)',
                    fontSize: 'var(--text-sm)',
                    color: 'var(--text-body)',
                  }}
                >
                  Are you sure?
                </p>
                <div style={{ display: 'flex', gap: 12 }}>
                  <button
                    onClick={handleConfirm}
                    style={{
                      border: 'none',
                      background: 'none',
                      padding: 0,
                      fontFamily: 'var(--font-sans)',
                      fontSize: 'var(--text-sm)',
                      fontWeight: 600,
                      color: 'var(--danger)',
                      cursor: 'pointer',
                    }}
                  >
                    Yes, delete
                  </button>
                  <button
                    onClick={() => setState('closed')}
                    style={{
                      border: 'none',
                      background: 'none',
                      padding: 0,
                      fontFamily: 'var(--font-sans)',
                      fontSize: 'var(--text-sm)',
                      color: 'var(--text-muted)',
                      cursor: 'pointer',
                    }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {state === 'deleting' && (
              <p
                style={{
                  margin: 0,
                  padding: '10px 14px',
                  fontFamily: 'var(--font-sans)',
                  fontSize: 'var(--text-sm)',
                  color: 'var(--text-muted)',
                }}
              >
                Deleting…
              </p>
            )}

            {error && state !== 'deleting' && (
              <p
                style={{
                  margin: 0,
                  padding: '0 14px 8px',
                  fontFamily: 'var(--font-sans)',
                  fontSize: 'var(--text-xs)',
                  color: 'var(--danger)',
                }}
              >
                {error}
              </p>
            )}
          </div>
        </>
      )}
    </div>
  );
}
