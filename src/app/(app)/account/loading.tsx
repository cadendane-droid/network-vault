export default function AccountLoading() {
  return (
    <div className="px-4 pt-6 pb-4 max-w-lg mx-auto">
      {/* Heading */}
      <div className="h-6 w-24 rounded-md bg-zinc-200 animate-pulse mb-6" />

      {/* Card */}
      <div className="rounded-xl border border-zinc-100 bg-white divide-y divide-zinc-100">
        {[1, 2, 3].map((i) => (
          <div key={i} className="px-4 py-3 flex items-center justify-between">
            <div className="h-3.5 w-12 rounded bg-zinc-100 animate-pulse" />
            <div className="h-3.5 w-24 rounded bg-zinc-200 animate-pulse" />
          </div>
        ))}
        <div className="px-4 py-4 space-y-3">
          <div className="h-3.5 w-32 rounded bg-zinc-100 animate-pulse" />
          <div className="h-3 w-48 rounded bg-zinc-100 animate-pulse" />
          <div className="h-9 w-36 rounded-full bg-zinc-200 animate-pulse" />
        </div>
      </div>
    </div>
  );
}
