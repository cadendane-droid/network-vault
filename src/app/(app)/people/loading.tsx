export default function PeopleLoading() {
  return (
    <div className="px-4 pt-6 pb-4 max-w-lg mx-auto">
      {/* Header row */}
      <div className="flex items-center justify-between mb-5">
        <div className="h-6 w-20 rounded-md bg-zinc-200 animate-pulse" />
        <div className="h-9 w-16 rounded-full bg-zinc-200 animate-pulse" />
      </div>

      {/* Card skeletons */}
      <ul className="flex flex-col gap-2">
        {[1, 2, 3].map((i) => (
          <li
            key={i}
            className="rounded-xl border border-zinc-100 bg-white px-4 py-3"
          >
            <div className="flex items-center justify-between">
              <div className="h-4 w-32 rounded bg-zinc-200 animate-pulse" />
              <div className="h-3 w-20 rounded bg-zinc-100 animate-pulse" />
            </div>
            <div className="mt-2 h-3 w-24 rounded bg-zinc-100 animate-pulse" />
          </li>
        ))}
      </ul>
    </div>
  );
}
