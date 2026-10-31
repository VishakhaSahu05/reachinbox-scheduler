import { CircleAlert, CircleCheck, Clock, Hourglass, LoaderCircle } from 'lucide-react';
import type { ReactNode } from 'react';
import type { EmailStatus } from '../../api/types';
import { cn } from '../../lib/cn';
import { formatChipTime } from '../../lib/format';

const config: Record<EmailStatus, { className: string; icon: ReactNode; label?: string }> = {
  SCHEDULED: { className: 'bg-orange-50 text-orange-700', icon: <Clock className="size-3.5" /> },
  RATE_LIMITED: { className: 'bg-amber-50 text-amber-700', icon: <Hourglass className="size-3.5" /> },
  SENDING: { className: 'bg-blue-50 text-blue-700', icon: <LoaderCircle className="size-3.5 animate-spin" />, label: 'Sending' },
  SENT: { className: 'bg-gray-100 text-gray-700', icon: <CircleCheck className="size-3.5" />, label: 'Sent' },
  FAILED: { className: 'bg-red-50 text-red-700', icon: <CircleAlert className="size-3.5" />, label: 'Failed' },
};

interface StatusBadgeProps {
  status: EmailStatus;
  scheduledAt: string;
  className?: string;
}

/** Scheduled emails show their send time inside the chip; finished ones show the outcome. */
export function StatusBadge({ status, scheduledAt, className }: StatusBadgeProps) {
  const { className: tone, icon, label } = config[status];
  const text =
    label ?? (status === 'RATE_LIMITED' ? `Rate limited · ${formatChipTime(scheduledAt)}` : formatChipTime(scheduledAt));

  return (
    <span
      className={cn('inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium whitespace-nowrap', tone, className)}
      title={status === 'RATE_LIMITED' ? 'Hourly limit reached; moved to the next available window' : undefined}
    >
      {icon}
      {text}
    </span>
  );
}
