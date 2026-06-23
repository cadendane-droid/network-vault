'use client';

import { useEffect, useState } from 'react';
import { usePostHog } from 'posthog-js/react';
import PersonCard from '@/components/person-card';

// Wait this long after the last keystroke before counting a search as
// "settled" and emitting people_search_performed — so a single typed query
// fires one event, not one per character.
const SEARCH_DEBOUNCE_MS = 350;

interface Person {
  id: string;
  name: string;
  status: string;
  fact_count: number;
  is_processing: boolean;
  created_at: Date;
}

export default function PeopleListWithSearch({ people }: { people: Person[] }) {
  const [query, setQuery] = useState('');
  const [focused, setFocused] = useState(false);
  const posthog = usePostHog();

  const filtered = query.trim()
    ? people.filter((p) => p.name.toLowerCase().includes(query.toLowerCase()))
    : people;

  // Fire people_search_performed once per settled query (debounced), suppressing
  // empty/whitespace-only queries. Lengths/counts only — never the query text.
  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed === '') return;
    const id = setTimeout(() => {
      const resultCount = people.filter((p) =>
        p.name.toLowerCase().includes(query.toLowerCase())
      ).length;
      posthog?.capture('people_search_performed', {
        query_length: trimmed.length,
        result_count: resultCount,
      });
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [query, people, posthog]);

  return (
    <div>
      {/* Search bar */}
      <div style={{ padding: '0 var(--gutter) 16px' }}>
        <div
          style={{
            height: 48,
            borderRadius: 'var(--radius-pill)',
            background: 'var(--surface-card)',
            border: `1.5px solid ${focused ? 'var(--border-focus)' : 'var(--border-subtle)'}`,
            boxShadow: focused ? 'var(--focus-ring)' : 'none',
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '0 14px',
            transition:
              'border-color var(--dur-fast), box-shadow var(--dur-fast)',
          }}
        >
          {/* Search icon */}
          <svg
            width="16"
            height="16"
            viewBox="0 0 20 20"
            fill="currentColor"
            style={{ color: 'var(--text-faint)', flexShrink: 0 }}
            aria-hidden="true"
          >
            <path
              fillRule="evenodd"
              d="M9 3.5a5.5 5.5 0 100 11 5.5 5.5 0 000-11zM2 9a7 7 0 1112.452 4.391l3.328 3.329a.75.75 0 11-1.06 1.06l-3.329-3.328A7 7 0 012 9z"
              clipRule="evenodd"
            />
          </svg>

          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            placeholder="Search people…"
            style={{
              flex: 1,
              border: 'none',
              background: 'transparent',
              fontFamily: 'var(--font-sans)',
              fontSize: 'var(--text-base)',
              color: 'var(--text-strong)',
              outline: 'none',
              minHeight: 44,
            }}
          />

          {/* Clear button — only when query is non-empty */}
          {query && (
            <button
              onClick={() => setQuery('')}
              aria-label="Clear search"
              style={{
                width: 28,
                height: 28,
                borderRadius: '50%',
                border: 'none',
                background: 'var(--surface-sunken)',
                color: 'var(--text-faint)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                flexShrink: 0,
                fontSize: 16,
                lineHeight: 1,
              }}
            >
              ×
            </button>
          )}
        </div>
      </div>

      {/* List */}
      {filtered.length > 0 ? (
        <div
          style={{
            margin: '0 12px',
            background: 'var(--surface-card)',
            borderRadius: 'var(--radius-lg)',
            boxShadow: 'var(--shadow-sm)',
            border: '1px solid var(--border-subtle)',
            overflow: 'hidden',
          }}
        >
          {filtered.map((p, i) => (
            <div key={p.id}>
              {i > 0 && (
                <div
                  style={{
                    height: 1,
                    background: 'var(--border-subtle)',
                    /* inset aligns with text column: 14px padding + 48px avatar + 11px gap */
                    margin: '0 14px 0 73px',
                  }}
                />
              )}
              <PersonCard {...p} />
            </div>
          ))}
        </div>
      ) : (
        <div
          style={{
            textAlign: 'center',
            padding: '40px 20px',
            color: 'var(--text-muted)',
            fontFamily: 'var(--font-sans)',
            fontSize: 'var(--text-sm)',
          }}
        >
          No one matches &ldquo;{query}&rdquo;
        </div>
      )}
    </div>
  );
}
