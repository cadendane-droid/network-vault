import { notFound } from 'next/navigation';
import prisma from '@/lib/prisma';
import { getAuthenticatedUser } from '@/lib/auth';
import { isAdminClerkId } from '@/lib/admin';

// Admin-only feedback intake. Non-admins (and unauthenticated visitors) get
// a 404 — the page never reveals that it exists.
export default async function AdminFeedbackPage() {
  let user: Awaited<ReturnType<typeof getAuthenticatedUser>>;
  try {
    user = await getAuthenticatedUser();
  } catch {
    notFound();
  }
  if (!isAdminClerkId(user.clerkId)) notFound();

  const rows = await prisma.feedback.findMany({
    orderBy: { created_at: 'desc' },
    select: {
      id: true,
      message: true,
      page: true,
      status: true,
      created_at: true,
      user: { select: { email: true } },
    },
  });

  return (
    <div
      style={{
        maxWidth: 'var(--screen-max)',
        margin: '0 auto',
        padding: '24px var(--gutter) 40px',
      }}
    >
      <h1
        style={{
          fontFamily: 'var(--font-display)',
          fontSize: 'var(--text-h2)',
          fontWeight: 600,
          color: 'var(--text-strong)',
          letterSpacing: 'var(--tracking-tight)',
          margin: '0 0 4px',
        }}
      >
        Feedback
      </h1>
      <p
        style={{
          fontFamily: 'var(--font-sans)',
          fontSize: 'var(--text-sm)',
          color: 'var(--text-muted)',
          margin: '0 0 20px',
        }}
      >
        {rows.length} submission{rows.length === 1 ? '' : 's'}, newest first
      </p>

      {rows.length === 0 ? (
        <p
          style={{
            fontFamily: 'var(--font-sans)',
            fontSize: 'var(--text-sm)',
            color: 'var(--text-faint)',
          }}
        >
          No feedback yet.
        </p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {rows.map((r) => (
            <div
              key={r.id}
              style={{
                background: 'var(--surface-card)',
                border: '1px solid var(--border-subtle)',
                borderLeft: '3px solid var(--brand)',
                borderRadius: 'var(--radius-lg)',
                boxShadow: 'var(--shadow-sm)',
                padding: '14px 16px',
              }}
            >
              <p
                style={{
                  fontFamily: 'var(--font-sans)',
                  fontSize: 'var(--text-base)',
                  color: 'var(--text-strong)',
                  lineHeight: 'var(--leading-normal)',
                  whiteSpace: 'pre-wrap',
                  margin: '0 0 10px',
                }}
              >
                {r.message}
              </p>
              <p
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 'var(--text-xs)',
                  color: 'var(--text-muted)',
                  margin: 0,
                }}
              >
                {r.user.email}
                {' · '}
                {new Date(r.created_at).toLocaleDateString('en-US', {
                  year: 'numeric',
                  month: 'short',
                  day: 'numeric',
                })}{' '}
                {new Date(r.created_at).toLocaleTimeString('en-US', {
                  hour: 'numeric',
                  minute: '2-digit',
                })}
                {r.page ? ` · ${r.page}` : ''}
                {' · '}
                <span
                  style={{
                    color:
                      r.status === 'new' ? 'var(--brand)' : 'var(--text-faint)',
                  }}
                >
                  {r.status}
                </span>
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
