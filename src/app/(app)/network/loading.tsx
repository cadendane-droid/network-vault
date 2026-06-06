export default function NetworkLoading() {
  return (
    <div className="flex items-center justify-center h-[calc(100dvh-4rem)] bg-zinc-950">
      <div className="flex flex-col items-center gap-3">
        <div className="flex gap-1.5">
          <span className="h-2 w-2 rounded-full bg-zinc-500 animate-bounce [animation-delay:-0.3s]" />
          <span className="h-2 w-2 rounded-full bg-zinc-500 animate-bounce [animation-delay:-0.15s]" />
          <span className="h-2 w-2 rounded-full bg-zinc-500 animate-bounce" />
        </div>
        <p className="text-sm text-zinc-500">Loading your network&hellip;</p>
      </div>
    </div>
  );
}
