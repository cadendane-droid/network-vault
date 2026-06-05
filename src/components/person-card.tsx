import Link from 'next/link';

interface PersonCardProps {
  id: string;
  name: string;
  confirmed_fact_count: number;
  status: string;
  created_at: Date;
}

export default function PersonCard({
  id,
  name,
  confirmed_fact_count,
  status,
}: PersonCardProps) {
  return (
    <Link
      href={`/people/${id}`}
      className="flex items-center justify-between rounded-xl border border-zinc-100 bg-white px-4 py-3.5 active:bg-zinc-50"
    >
      <div className="flex flex-col gap-0.5">
        <span className="text-base font-medium text-zinc-900">{name}</span>
        <span className="text-sm text-zinc-400">
          {status === 'active'
            ? confirmed_fact_count > 0
              ? `${confirmed_fact_count} confirmed fact${confirmed_fact_count === 1 ? '' : 's'}`
              : 'Processing…'
            : 'Archived'}
        </span>
      </div>
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 20 20"
        fill="currentColor"
        className="w-4 h-4 shrink-0 text-zinc-300"
      >
        <path
          fillRule="evenodd"
          d="M7.293 4.707a1 1 0 011.414 0l5 5a1 1 0 010 1.414l-5 5a1 1 0 01-1.414-1.414L11.586 10 7.293 5.707a1 1 0 010-1.414z"
          clipRule="evenodd"
        />
      </svg>
    </Link>
  );
}
