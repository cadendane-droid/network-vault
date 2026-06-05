import Link from 'next/link';

/**
 * Shown on the Query page when the authenticated user has no people in their
 * vault yet. Explains what the query surface does and directs them to add
 * someone first.
 */
export default function EmptyVaultQuery() {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-6 px-8 text-center">
      <div className="space-y-2">
        <h2 className="text-base font-semibold text-zinc-900">
          Your vault is empty
        </h2>
        <p className="text-sm text-zinc-500 leading-relaxed max-w-xs">
          Add people to your vault and I can answer questions about your network
          — who works where, shared interests, how you met, and more.
        </p>
      </div>
      <Link
        href="/people/new"
        className="rounded-full bg-zinc-900 px-5 py-2.5 text-sm font-medium text-white hover:bg-zinc-700 transition-colors"
      >
        Add your first person
      </Link>
    </div>
  );
}
