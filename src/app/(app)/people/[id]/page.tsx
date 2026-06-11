import Link from 'next/link';
import { auth } from '@clerk/nextjs/server';
import { redirect, notFound } from 'next/navigation';
import prisma from '@/lib/prisma';
import { ProcessingIndicator } from '@/components/processing-indicator';
import DeletePersonButton from '@/components/delete-person-button';
import TrackProfileView from '@/components/track-profile-view';

async function getPersonProfile(personId: string, userId: string) {
  const person = await prisma.people.findUnique({
    where: { id: personId },
    select: {
      id: true,
      name: true,
      status: true,
      created_at: true,
      user_id: true,
    },
  });

  if (!person || person.user_id !== userId) return null;

  const [facts, conversations, edges, latestSource] = await Promise.all([
    prisma.fact.findMany({
      where: { person_id: personId, status: { in: ['raw', 'confirmed'] } },
      select: {
        id: true,
        type: true,
        value: true,
        status: true,
        created_at: true,
      },
      orderBy: [{ status: 'asc' }, { created_at: 'desc' }],
    }),
    prisma.conversation.findMany({
      where: { participants: { some: { person_id: personId } } },
      select: { id: true, date: true, summary: true },
      orderBy: { date: 'desc' },
    }),
    prisma.edge.findMany({
      where: { OR: [{ person_a: personId }, { person_b: personId }] },
      select: {
        id: true,
        relationship_type: true,
        status: true,
        person_a: true,
        person_b: true,
        personA: { select: { id: true, name: true } },
        personB: { select: { id: true, name: true } },
      },
    }),
    prisma.source.findFirst({
      where: { user_id: userId },
      orderBy: { created_at: 'desc' },
      select: { processing_status: true, raw_text: true },
    }),
  ]);

  const factsByType = facts.reduce<Record<string, typeof facts>>(
    (acc, f) => ({ ...acc, [f.type]: [...(acc[f.type] ?? []), f] }),
    {}
  );

  const connections = edges.map((e) => {
    const connected = e.person_a === personId ? e.personB : e.personA;
    return {
      id: e.id,
      relationship_type: e.relationship_type,
      status: e.status,
      connected_person_id: connected.id,
      connected_person_name: connected.name,
    };
  });

  return { person, factsByType, conversations, connections, latestSource };
}

const TYPE_LABELS: Record<string, string> = {
  role: 'Role',
  org: 'Organisation',
  location: 'Location',
  interest: 'Interests',
  background: 'Background',
  context: 'How you know them',
  connection: 'Connections',
  quote: 'Quotes',
  life_situation: 'Life situation',
  religion: 'Religion',
  contact_info: 'Contact info',
  personality: 'Personality',
  values: 'Values',
  skills: 'Skills',
  needs: 'Needs',
  future_plans: 'Future plans',
  dates: 'Important dates',
  miscellaneous: 'Notes',
};

// Avatar helpers (mirrors person-card.tsx)
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

export default async function PersonProfilePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { userId: clerkId } = await auth();
  if (!clerkId) redirect('/sign-in');

  const dbUser = await prisma.user.findUnique({
    where: { clerk_id: clerkId },
    select: { id: true },
  });
  if (!dbUser) redirect('/sign-in');

  const { id } = await params;
  const data = await getPersonProfile(id, dbUser.id);
  if (!data) notFound();

  const { person, factsByType, conversations, connections, latestSource } =
    data;

  const processingStatus = latestSource?.processing_status ?? 'complete';
  const isProcessing =
    processingStatus === 'pending' || processingStatus === 'processing';

  const palette = getAvatarPalette(person.name);
  const initials = getInitials(person.name);

  const role = factsByType.role?.[0]?.value ?? null;
  const org = factsByType.org?.[0]?.value ?? null;

  const sectionOverlineStyle: React.CSSProperties = {
    fontFamily: 'var(--font-mono)',
    fontSize: 'var(--text-xs)',
    textTransform: 'uppercase',
    letterSpacing: 'var(--tracking-mono)',
    color: 'var(--text-muted)',
    margin: '0 0 10px',
  };

  const cardStyle: React.CSSProperties = {
    background: 'var(--surface-card)',
    borderRadius: 'var(--radius-lg)',
    boxShadow: 'var(--shadow-sm)',
    border: '1px solid var(--border-subtle)',
    overflow: 'hidden',
    padding: '14px 16px',
  };

  return (
    <div
      style={{
        maxWidth: 'var(--screen-max)',
        margin: '0 auto',
        paddingBottom: 40,
      }}
    >
      <TrackProfileView personId={person.id} />
      {/* Sticky top bar */}
      <header
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 10,
          padding: '54px 16px 10px',
          background: 'linear-gradient(var(--surface-canvas) 72%, transparent)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        {/* Back button */}
        <Link
          href="/people"
          aria-label="Back to people"
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
            textDecoration: 'none',
            flexShrink: 0,
          }}
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 20 20"
            fill="currentColor"
            aria-hidden="true"
          >
            <path
              fillRule="evenodd"
              d="M12.707 5.293a1 1 0 010 1.414L9.414 10l3.293 3.293a1 1 0 01-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z"
              clipRule="evenodd"
            />
          </svg>
        </Link>

        {/* More button (placeholder) */}
        <button
          aria-label="More options"
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
            flexShrink: 0,
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
      </header>

      {/* Identity section */}
      <div style={{ padding: '8px var(--gutter) 28px', textAlign: 'center' }}>
        {/* Avatar */}
        <div
          style={{
            width: 88,
            height: 88,
            borderRadius: '50%',
            background: palette.bg,
            color: palette.text,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontFamily: 'var(--font-sans)',
            fontSize: 'var(--text-h3)',
            fontWeight: 600,
            margin: '0 auto 16px',
            outline: '2px solid var(--brand)',
            outlineOffset: 3,
            userSelect: 'none',
          }}
          aria-hidden="true"
        >
          {initials}
        </div>

        {/* Name */}
        <h1
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: 'var(--text-display)',
            fontWeight: 600,
            color: 'var(--text-strong)',
            letterSpacing: 'var(--tracking-tight)',
            lineHeight: 'var(--leading-tight)',
            margin: '0 0 6px',
          }}
        >
          {person.name}
        </h1>

        {/* Role · Org */}
        {(role || org) && (
          <p
            style={{
              fontSize: 'var(--text-lg)',
              color: 'var(--text-muted)',
              margin: 0,
              lineHeight: 'var(--leading-snug)',
            }}
          >
            {[role, org].filter(Boolean).join(' · ')}
          </p>
        )}

        {/* Processing indicator */}
        <ProcessingIndicator personId={id} initialStatus={processingStatus} />
      </div>

      {/* Main content */}
      <div
        style={{
          padding: '0 var(--gutter)',
          display: 'flex',
          flexDirection: 'column',
          gap: 20,
        }}
      >
        {/* Facts by type */}
        {Object.keys(factsByType).length > 0 && (
          <section>
            <p style={sectionOverlineStyle}>About</p>
            <div style={cardStyle}>
              {Object.entries(factsByType).map(
                ([type, typeFacts], sectionIdx) => (
                  <div
                    key={type}
                    style={{
                      paddingTop: sectionIdx > 0 ? 14 : 0,
                      marginTop: sectionIdx > 0 ? 14 : 0,
                      borderTop:
                        sectionIdx > 0
                          ? '1px solid var(--border-subtle)'
                          : 'none',
                    }}
                  >
                    <p
                      style={{
                        fontFamily: 'var(--font-sans)',
                        fontSize: 'var(--text-sm)',
                        color: 'var(--text-muted)',
                        margin: '0 0 6px',
                      }}
                    >
                      {TYPE_LABELS[type] ?? type}
                    </p>
                    <ul
                      style={{
                        margin: 0,
                        padding: 0,
                        listStyle: 'none',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 4,
                      }}
                    >
                      {typeFacts.map((f) => (
                        <li key={f.id}>
                          <span
                            style={{
                              fontFamily: 'var(--font-sans)',
                              fontSize: 'var(--text-base)',
                              fontWeight: 500,
                              color: 'var(--text-strong)',
                              lineHeight: 'var(--leading-snug)',
                            }}
                          >
                            {f.value}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )
              )}
            </div>
          </section>
        )}

        {/* Empty facts state */}
        {Object.keys(factsByType).length === 0 && !isProcessing && (
          <p style={{ color: 'var(--text-faint)', fontSize: 'var(--text-sm)' }}>
            No facts extracted yet. Try adding more notes.
          </p>
        )}

        {/* Connections */}
        {connections.length > 0 && (
          <section>
            <p style={sectionOverlineStyle}>Connections</p>
            <div style={{ ...cardStyle, padding: 0 }}>
              {connections.map((c, i) => (
                <div key={c.id}>
                  {i > 0 && (
                    <div
                      style={{
                        height: 1,
                        background: 'var(--border-subtle)',
                        margin: '0 16px',
                      }}
                    />
                  )}
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '12px 16px',
                      minHeight: 52,
                    }}
                  >
                    <span
                      style={{
                        fontFamily: 'var(--font-sans)',
                        fontSize: 'var(--text-base)',
                        fontWeight: 500,
                        color: 'var(--text-strong)',
                      }}
                    >
                      {c.connected_person_name}
                    </span>
                    <span
                      style={{
                        fontFamily: 'var(--font-mono)',
                        fontSize: 'var(--text-xs)',
                        textTransform: 'uppercase',
                        letterSpacing: 'var(--tracking-mono)',
                        background: 'var(--surface-sunken)',
                        borderRadius: 'var(--radius-pill)',
                        padding: '3px 8px',
                        color: 'var(--text-muted)',
                        whiteSpace: 'nowrap',
                        marginLeft: 8,
                      }}
                    >
                      {c.relationship_type.replace(/_/g, ' ')}
                      {c.status === 'inferred' ? ' · inferred' : ''}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Conversations */}
        {conversations.length > 0 && (
          <section>
            <p style={sectionOverlineStyle}>Conversations</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {conversations.map((c) => (
                <div key={c.id} style={cardStyle}>
                  <p
                    style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: 'var(--text-xs)',
                      color: 'var(--text-faint)',
                      margin: '0 0 6px',
                    }}
                  >
                    {new Date(c.date).toLocaleDateString('en-US', {
                      year: 'numeric',
                      month: 'short',
                      day: 'numeric',
                    })}
                  </p>
                  {c.summary && (
                    <p
                      style={{
                        fontFamily: 'var(--font-sans)',
                        fontSize: 'var(--text-sm)',
                        color: 'var(--text-body)',
                        margin: 0,
                        lineHeight: 'var(--leading-normal)',
                      }}
                    >
                      {c.summary}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Raw source notes (collapsible) */}
        {latestSource?.raw_text && (
          <details style={{ marginTop: 4 }}>
            <summary
              style={{
                cursor: 'pointer',
                fontFamily: 'var(--font-sans)',
                fontSize: 'var(--text-xs)',
                color: 'var(--text-faint)',
                listStyle: 'none',
                display: 'flex',
                alignItems: 'center',
                gap: 4,
              }}
            >
              <svg
                className="w-3 h-3"
                viewBox="0 0 20 20"
                fill="currentColor"
                width={12}
                height={12}
              >
                <path
                  fillRule="evenodd"
                  d="M7.293 4.707a1 1 0 011.414 0l5 5a1 1 0 010 1.414l-5 5a1 1 0 01-1.414-1.414L11.586 10 7.293 5.707a1 1 0 010-1.414z"
                  clipRule="evenodd"
                />
              </svg>
              Show original notes
            </summary>
            <p
              style={{
                marginTop: 10,
                fontFamily: 'var(--font-sans)',
                fontSize: 'var(--text-sm)',
                color: 'var(--text-muted)',
                whiteSpace: 'pre-wrap',
                lineHeight: 'var(--leading-normal)',
              }}
            >
              {latestSource.raw_text}
            </p>
          </details>
        )}

        {/* Delete */}
        <div
          style={{
            paddingTop: 20,
            borderTop: '1px solid var(--border-subtle)',
            display: 'flex',
            justifyContent: 'center',
          }}
        >
          <div style={{ color: 'var(--danger)' }}>
            <DeletePersonButton personId={person.id} />
          </div>
        </div>
      </div>
    </div>
  );
}
