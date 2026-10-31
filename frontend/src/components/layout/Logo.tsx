import { Mail } from 'lucide-react';
import { Link } from 'react-router';

export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <Link to="/" className="flex items-center gap-2.5" aria-label="ReachInbox home">
      <span className="flex size-8 items-center justify-center rounded-lg bg-brand-600 text-white">
        <Mail className="size-4.5" />
      </span>
      {!compact && <span className="text-lg font-bold tracking-tight text-gray-900">ReachInbox</span>}
    </Link>
  );
}
