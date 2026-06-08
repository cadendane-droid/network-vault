import Link from 'next/link';

interface PersonCardProps {
  id: string;
  name: string;
  fact_count: number;
  is_processing: boolean;
  status: string;
  created_at: Date;
}

// Deterministic palette selection based on name hash
const PALETTES = [
  { bg: 'var(--terracotta-500)', text: 'var(--cream-50)' },
  { bg: 'var(--amber-500)', text: 'var(--ink-900)' },
  { bg: 'var(--sage-500)', text: 'var(--cream-50)' },
  { bg: 'var(--berry-500)', text: 'var(--cream-50)' },
  { bg: 'var(--plum-500)', text: 'var(--cream-50)' },
] as const;

function getAvatarPalette(name: string) {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return PALETTES[Math.abs(h) % PALETTES.length];
}

function getInitials(name: string) {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export default function PersonCard({
  id,
  name,
  fact_count,
  is_processing,
  status,
}: PersonCardProps) {
  const palette = getAvatarPalette(name);
  const initials = getInitials(name);

  return (
    <Link
      href={`/people/${id}`}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        minHeight: 72,
        padding: '12px 14px',
        textDecoration: 'none',
        background: 'transparent',
        transition: `background var(--dur-fast)`,
      }}
      // hover handled by browser :hover — will fall back to active for mobile
    >
      {/* Avatar */}
      <div
        style={{
          width: 48,
          height: 48,
          borderRadius: '50%',
          background: palette.bg,
          color: palette.text,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: 'var(--font-sans)',
          fontSize: 'var(--text-sm)',
          fontWeight: 600,
          flexShrink: 0,
          letterSpacing: '0.02em',
          userSelect: 'none',
        }}
        aria-hidden="true"
      >
        {initials}
      </div>

      {/* Text */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <p
          style={{
            fontFamily: 'var(--font-sans)',
            fontSize: 'var(--text-base)',
            fontWeight: 600,
            color: 'var(--text-strong)',
            margin: 0,
            lineHeight: 'var(--leading-snug)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {name}
        </p>
        <p
          style={{
            fontFamily: is_processing ? 'var(--font-sans)' : 'var(--font-mono)',
            fontSize: 'var(--text-xs)',
            textTransform: is_processing ? 'none' : 'uppercase',
            letterSpacing: is_processing ? 0 : 'var(--tracking-mono)',
            color: is_processing ? 'var(--text-muted)' : 'var(--text-faint)',
            margin: '3px 0 0',
            lineHeight: 1,
            display: 'flex',
            alignItems: 'center',
            gap: 5,
          }}
        >
          {status === 'active' ? (
            is_processing ? (
              <>
                {/* Amber processing dot */}
                <span
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: '50%',
                    background: 'var(--warning)',
                    flexShrink: 0,
                    display: 'inline-block',
                  }}
                />
                Processing…
              </>
            ) : (
              `${fact_count} fact${fact_count === 1 ? '' : 's'}`
            )
          ) : (
            'Archived'
          )}
        </p>
      </div>
    </Link>
  );
}
