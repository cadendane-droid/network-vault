export default function PersonProfileLoading() {
  return (
    <div className="px-4 pt-6 pb-4 max-w-lg mx-auto space-y-6">
      {/* Name */}
      <div>
        <div className="h-7 w-48 rounded-md bg-zinc-200 animate-pulse" />
        <div className="mt-2 h-4 w-56 rounded bg-zinc-100 animate-pulse" />
      </div>

      {/* Facts section */}
      <section className="space-y-4">
        {[
          { label: 28, items: 1 },
          { label: 36, items: 2 },
          { label: 28, items: 3 },
        ].map(({ label, items }, si) => (
          <div key={si}>
            {/* Section label */}
            <div
              className="mb-1.5 h-3 rounded bg-zinc-100 animate-pulse"
              style={{ width: label * 4 }}
            />
            <ul className="space-y-2">
              {Array.from({ length: items }).map((_, i) => (
                <li key={i} className="flex items-center gap-2">
                  <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-zinc-200" />
                  <div className="h-3.5 rounded bg-zinc-100 animate-pulse flex-1" />
                </li>
              ))}
            </ul>
          </div>
        ))}
      </section>

      {/* Conversations section */}
      <section>
        <div className="mb-2 h-3 w-28 rounded bg-zinc-100 animate-pulse" />
        <div className="rounded-lg border border-zinc-100 bg-white p-3 space-y-1.5">
          <div className="h-3 w-20 rounded bg-zinc-100 animate-pulse" />
          <div className="h-3.5 w-full rounded bg-zinc-100 animate-pulse" />
          <div className="h-3.5 w-3/4 rounded bg-zinc-100 animate-pulse" />
        </div>
      </section>
    </div>
  );
}
