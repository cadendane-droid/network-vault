'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

export default function Nav() {
  const pathname = usePathname();

  const isPeople = pathname.startsWith('/people') || pathname === '/people';
  const isQuery = pathname.startsWith('/query');
  const isNetwork = pathname.startsWith('/network');

  const tabStyle = (active: boolean): React.CSSProperties => ({
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
    height: '100%',
    color: active ? 'var(--brand)' : 'var(--text-faint)',
    textDecoration: 'none',
    transition: `color var(--dur-fast)`,
    minWidth: 44,
    minHeight: 44,
  });

  const labelStyle: React.CSSProperties = {
    fontFamily: 'var(--font-sans)',
    fontSize: 'var(--text-xs)',
    lineHeight: 1,
    letterSpacing: 0,
  };

  return (
    <nav
      style={{
        position: 'fixed',
        bottom: 0,
        left: 0,
        right: 0,
        zIndex: 50,
        paddingBottom: 'max(0px, env(safe-area-inset-bottom))',
        background: 'color-mix(in oklab, var(--surface-card) 86%, transparent)',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
        borderTop: '1px solid var(--border-subtle)',
      }}
    >
      <div
        style={{
          position: 'relative',
          height: 'var(--nav-height)',
          maxWidth: 'var(--screen-max)',
          margin: '0 auto',
          display: 'flex',
          alignItems: 'center',
        }}
      >
        {/* People — left */}
        <Link href="/people" style={tabStyle(isPeople)}>
          <svg
            width="22"
            height="22"
            viewBox="0 0 24 24"
            fill="currentColor"
            aria-hidden="true"
          >
            <path d="M9 12c2.21 0 4-1.79 4-4S11.21 4 9 4 5 5.79 5 8s1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v1c0 .55.45 1 1 1h14c.55 0 1-.45 1-1v-1c0-2.66-5.33-4-8-4zm7-2c.06 0 .11.01.17.01C17.54 11.37 18.5 10.28 18.5 9c0-1.38-1.12-2.5-2.5-2.5-.85 0-1.59.43-2.04 1.08.36.59.54 1.26.54 1.92 0 .72-.19 1.39-.52 1.97C14.3 11.8 14.9 12 16 12zm2 2c-.73 0-1.42.1-2.04.25.1.02.19.05.28.07.91.35 1.88.96 2.63 1.8.44.5.56 1.04.56 1.38v1h4c.55 0 1-.45 1-1v-.5C24.43 15.4 19.4 14 18 14z" />
          </svg>
          <span style={labelStyle}>People</span>
        </Link>

        {/* Spacer so the two tabs sit on either side of the raised button */}
        <div style={{ width: 80, flexShrink: 0 }} />

        {/* Map — right */}
        <Link href="/network" style={tabStyle(isNetwork)}>
          {/* Constellation: nodes + edges icon */}
          <svg
            width="22"
            height="22"
            viewBox="0 0 24 24"
            fill="currentColor"
            aria-hidden="true"
          >
            <circle cx="5" cy="5" r="2.2" />
            <circle cx="19" cy="5" r="2.2" />
            <circle cx="12" cy="19" r="2.2" />
            <circle cx="19" cy="13" r="1.6" />
            <line
              x1="5"
              y1="5"
              x2="19"
              y2="5"
              stroke="currentColor"
              strokeWidth="1.5"
            />
            <line
              x1="5"
              y1="5"
              x2="12"
              y2="19"
              stroke="currentColor"
              strokeWidth="1.5"
            />
            <line
              x1="19"
              y1="5"
              x2="12"
              y2="19"
              stroke="currentColor"
              strokeWidth="1.5"
            />
            <line
              x1="19"
              y1="5"
              x2="19"
              y2="13"
              stroke="currentColor"
              strokeWidth="1.5"
            />
          </svg>
          <span style={labelStyle}>Map</span>
        </Link>

        {/* Ask — center, raised 18px above the bar */}
        <Link
          href="/query"
          aria-label="Ask"
          style={{
            position: 'absolute',
            left: '50%',
            transform: 'translateX(-50%)',
            top: -18,
            width: 46,
            height: 46,
            borderRadius: '50%',
            background: isQuery ? 'var(--brand-hover)' : 'var(--brand)',
            color: 'var(--text-on-accent)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: 'var(--shadow-md), var(--glow-brand)',
            textDecoration: 'none',
            transition: `background var(--dur-fast)`,
            flexShrink: 0,
          }}
        >
          {/* Chat bubble with three dots */}
          <svg
            width="22"
            height="22"
            viewBox="0 0 24 24"
            fill="currentColor"
            aria-hidden="true"
          >
            <path d="M20 2H4C2.9 2 2 2.9 2 4v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zM9 11H7V9h2v2zm4 0h-2V9h2v2zm4 0h-2V9h2v2z" />
          </svg>
        </Link>
      </div>
    </nav>
  );
}
