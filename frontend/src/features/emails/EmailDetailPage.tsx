import { ArrowLeft, ExternalLink, TriangleAlert } from 'lucide-react';
import type { ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router';
import { useEmail } from '../../api/queries';
import { Avatar } from '../../components/ui/Avatar';
import { Button, buttonClasses } from '../../components/ui/Button';
import { EmptyState } from '../../components/ui/EmptyState';
import { Spinner } from '../../components/ui/Spinner';
import { StatusBadge } from '../../components/ui/StatusBadge';
import { formatDateTime } from '../../lib/format';

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-gray-500">{label}</dt>
      <dd className="mt-0.5 text-sm break-all text-gray-900">{children}</dd>
    </div>
  );
}

export function EmailDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { data: email, isPending, isError, error } = useEmail(id);

  const back = (
    <Button variant="ghost" size="sm" onClick={() => navigate(-1)} icon={<ArrowLeft className="size-4" />}>
      Back
    </Button>
  );

  if (isPending) {
    return (
      <div className="flex justify-center py-20 text-brand-600">
        <Spinner className="size-6" />
      </div>
    );
  }
  if (isError) {
    return <EmptyState icon={<TriangleAlert className="size-5" />} title="Couldn't load this email" description={error.message} action={back} />;
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 md:px-8">
      {back}

      <div className="mt-4 flex flex-wrap items-start justify-between gap-3">
        <h1 className="text-xl font-semibold text-gray-900">{email.subject}</h1>
        <StatusBadge status={email.status} scheduledAt={email.scheduledAt} />
      </div>

      <div className="mt-6 flex items-start gap-3 border-b border-gray-100 pb-5">
        <Avatar name={email.sender.name} />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-gray-900">
            {email.sender.name} <span className="font-normal text-gray-500">&lt;{email.sender.email}&gt;</span>
          </p>
          <p className="text-xs text-gray-500">to {email.to}</p>
        </div>
        <time className="shrink-0 text-xs text-gray-500">{formatDateTime(email.sentAt ?? email.scheduledAt)}</time>
      </div>

      {email.error && (
        <div className="mt-5 flex gap-2 rounded-lg bg-red-50 px-3 py-2.5 text-sm text-red-700" role="alert">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" />
          {email.error}
        </div>
      )}

      <div className="py-6 text-sm leading-relaxed whitespace-pre-wrap text-gray-800">{email.body}</div>

      <dl className="grid grid-cols-1 gap-4 rounded-xl bg-gray-50 p-4 sm:grid-cols-2 lg:grid-cols-3">
        <Detail label="Scheduled for">{formatDateTime(email.scheduledAt)}</Detail>
        <Detail label={email.status === 'FAILED' ? 'Failed at' : 'Sent at'}>{email.sentAt ? formatDateTime(email.sentAt) : '—'}</Detail>
        <Detail label="Send attempts">{email.attempts}</Detail>
        <Detail label="Moved by rate limit">{email.rescheduleCount ? `${email.rescheduleCount}×` : 'No'}</Detail>
        <Detail label="Campaign settings">
          {email.campaign.delayMs / 1000}s between emails · {email.campaign.hourlyLimit}/hour
        </Detail>
        {email.messageId && <Detail label="Message-ID">{email.messageId}</Detail>}
      </dl>

      {email.previewUrl && (
        <a href={email.previewUrl} target="_blank" rel="noreferrer" className={buttonClasses('outline', 'sm', 'mt-5')}>
          Open in Ethereal
          <ExternalLink className="size-3.5" />
        </a>
      )}
    </div>
  );
}
