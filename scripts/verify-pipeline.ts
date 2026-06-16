/**
 * verify-pipeline.ts — post-deploy sanity check for the intake pipeline fix.
 *
 * Usage:
 *   npx tsx scripts/verify-pipeline.ts <email-or-personId>
 *
 *   <email>     — a user's email; checks ALL of that user's people.
 *   <personId>  — a people.id UUID; checks just that person.
 *
 * Requires DATABASE_URL in the environment. `vercel env pull` writes it to
 * .env.local, which this script loads automatically. Reuses the app's Prisma
 * singleton (src/lib/prisma).
 *
 * Prints PASS/FAIL for each check and exits non-zero if anything FAILs:
 *   1. The user's latest source processing_status is 'complete'.
 *   2. The person(s) have > 0 facts.
 *   3. Zero facts have a NULL embedding.
 *   4. Embedding dimension is 1024 (voyage-3).
 *
 * Checks 3 & 4 use $queryRaw because facts.embedding is an Unsupported
 * pgvector type the typed client cannot select.
 *
 * Read-only: this script never writes. Do NOT run it without DB access.
 */
import { config } from 'dotenv';

// Load .env.local first (what `vercel env pull` writes), then .env. dotenv does
// not override already-set process.env, so the first loaded value wins.
config({ path: '.env.local' });
config();

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

let hadFailure = false;
function report(ok: boolean, label: string, detail: string) {
  if (!ok) hadFailure = true;
  console.log(`${ok ? '[PASS]' : '[FAIL]'} ${label} — ${detail}`);
}

async function main() {
  const arg = process.argv[2];
  if (!arg) {
    console.error(
      'Usage: npx tsx scripts/verify-pipeline.ts <email-or-personId>'
    );
    process.exit(1);
  }
  if (!process.env.DATABASE_URL) {
    console.error(
      'DATABASE_URL is not set. Run `vercel env pull` (writes .env.local) or export it, then retry.'
    );
    process.exit(1);
  }

  // Import after the env check so the Prisma adapter sees DATABASE_URL.
  const { default: prisma } = await import('../src/lib/prisma');

  try {
    // ── Resolve the target user + the people to check ─────────────────────────
    let userId: string;
    let personIds: string[];
    let scope: string;

    if (UUID_RE.test(arg)) {
      const person = await prisma.people.findUnique({
        where: { id: arg },
        select: { id: true, name: true, user_id: true },
      });
      if (!person) {
        console.error(`No people row found with id ${arg}`);
        process.exit(1);
      }
      userId = person.user_id;
      personIds = [person.id];
      scope = `person "${person.name}" (${person.id})`;
    } else {
      const user = await prisma.user.findFirst({
        where: { email: { equals: arg, mode: 'insensitive' } },
        select: { id: true },
      });
      if (!user) {
        console.error(`No user found with email ${arg}`);
        process.exit(1);
      }
      userId = user.id;
      const people = await prisma.people.findMany({
        where: { user_id: userId },
        select: { id: true },
      });
      personIds = people.map((p) => p.id);
      scope = `all ${personIds.length} people for ${arg}`;
    }

    console.log(`Verifying pipeline for ${scope}\n`);

    // ── Check 1: latest source status (V1 heuristic — most recent for user) ──
    const source = await prisma.source.findFirst({
      where: { user_id: userId },
      orderBy: { created_at: 'desc' },
      select: { id: true, processing_status: true, created_at: true },
    });
    if (!source) {
      report(false, 'latest source status', 'no source rows for this user');
    } else {
      report(
        source.processing_status === 'complete',
        'latest source status',
        `processing_status='${source.processing_status}' (source ${source.id}, ${source.created_at.toISOString()}) — expect 'complete'`
      );
    }

    // ── Check 2: fact count ──────────────────────────────────────────────────
    const factCount =
      personIds.length === 0
        ? 0
        : await prisma.fact.count({ where: { person_id: { in: personIds } } });
    report(factCount > 0, 'fact count', `${factCount} fact(s) — expect > 0`);

    // ── Checks 3 & 4: embedding null-count + dimension (raw, pgvector) ───────
    if (personIds.length === 0 || factCount === 0) {
      report(false, 'embeddings non-null', 'no facts to check');
      report(false, 'embedding dimension', 'no facts to check');
    } else {
      const rows = await prisma.$queryRaw<
        Array<{ null_count: bigint; total: bigint; dims: number | null }>
      >`
        SELECT
          count(*) FILTER (WHERE embedding IS NULL) AS null_count,
          count(*) AS total,
          max(vector_dims(embedding)) AS dims
        FROM facts
        WHERE person_id = ANY(${personIds}::uuid[])
      `;
      const nullCount = Number(rows[0]?.null_count ?? 0);
      const dims = rows[0]?.dims ?? null;

      report(
        nullCount === 0,
        'embeddings non-null',
        `${nullCount} fact(s) with NULL embedding — expect 0`
      );
      report(
        dims === 1024,
        'embedding dimension',
        `vector_dims=${dims ?? 'null'} — expect 1024 (voyage-3)`
      );
    }

    console.log(`\n${hadFailure ? 'RESULT: FAIL' : 'RESULT: PASS'}`);
  } finally {
    const { default: prisma } = await import('../src/lib/prisma');
    await prisma.$disconnect();
  }

  process.exit(hadFailure ? 1 : 0);
}

main().catch((err) => {
  console.error('verify-pipeline crashed:', err);
  process.exit(1);
});
