import { Link } from 'react-router';
import type { EmailItem, EmailView } from '../../api/types';
import { StatusBadge } from '../../components/ui/StatusBadge';
import { formatShortDateTime } from '../../lib/format';

export function EmailRow({ email, view }: { email: EmailItem; view: EmailView }) {
  return (
    <li>
      <Link
        to={`/emails/${email.id}`}
        className="flex flex-col gap-1.5 px-4 py-3.5 transition-colors hover:bg-gray-50 md:flex-row md:items-center md:gap-4 md:px-6"
      >
        <div className="flex items-center justify-between gap-3 md:w-80 md:shrink-0">
          <p className="truncate text-sm">
            <span className="text-gray-500">To: </span>
            <span className="font-medium text-gray-900">{email.to}</span>
          </p>
          <StatusBadge status={email.status} scheduledAt={email.scheduledAt} className="md:hidden" />
        </div>
        <StatusBadge status={email.status} scheduledAt={email.scheduledAt} className="hidden md:inline-flex" />
        <p className="min-w-0 flex-1 truncate text-sm">
          <span className="font-semibold text-gray-900">{email.subject}</span>
          <span className="text-gray-500"> – {email.preview}</span>
        </p>
        <span className="shrink-0 text-xs text-gray-400">
          {view === 'sent' && email.sentAt ? formatShortDateTime(email.sentAt) : `from ${email.sender.email}`}
        </span>
      </Link>
    </li>
  );
}

export function EmailRowSkeleton() {
  return (
    <li className="flex animate-pulse items-center gap-4 px-4 py-4 md:px-6">
      <div className="h-4 w-48 rounded bg-gray-100" />
      <div className="h-6 w-28 rounded-full bg-gray-100" />
      <div className="h-4 flex-1 rounded bg-gray-100" />
    </li>
  );
}
