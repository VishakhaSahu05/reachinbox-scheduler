import { CalendarClock, MailCheck, RefreshCw, SearchX, SquarePen, TriangleAlert } from 'lucide-react';
import { useCallback } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useEmails } from '../../api/queries';
import type { EmailView } from '../../api/types';
import { Button, buttonClasses } from '../../components/ui/Button';
import { EmptyState } from '../../components/ui/EmptyState';
import { Pagination } from '../../components/ui/Pagination';
import { cn } from '../../lib/cn';
import { EmailRow, EmailRowSkeleton } from './EmailRow';
import { SearchBox } from './SearchBox';

const COPY: Record<EmailView, { title: string; emptyTitle: string; emptyText: string }> = {
  scheduled: {
    title: 'Scheduled',
    emptyTitle: 'No scheduled emails',
    emptyText: 'Compose a campaign and pick a start time. Upcoming emails will be listed here.',
  },
  sent: {
    title: 'Sent',
    emptyTitle: 'Nothing sent yet',
    emptyText: 'Emails show up here as soon as the worker delivers them (or gives up on them).',
  },
};

export function EmailListPage({ view }: { view: EmailView }) {
  const [params, setParams] = useSearchParams();
  const q = params.get('q') ?? '';
  const page = Math.max(1, Number(params.get('page')) || 1);
  const { data, isPending, isError, error, isFetching, refetch } = useEmails(view, page, q);

  const updateParams = useCallback(
    (next: { q?: string; page?: number }) =>
      setParams((current) => {
        if (next.q !== undefined) {
          if (next.q) current.set('q', next.q);
          else current.delete('q');
        }
        if (next.page && next.page > 1) current.set('page', String(next.page));
        else current.delete('page');
        return current;
      }),
    [setParams],
  );
  const onSearch = useCallback((value: string) => updateParams({ q: value, page: 1 }), [updateParams]);

  const copy = COPY[view];

  let content;
  if (isPending) {
    content = (
      <ul className="divide-y divide-gray-100" aria-busy="true">
        {Array.from({ length: 8 }, (_, i) => (
          <EmailRowSkeleton key={i} />
        ))}
      </ul>
    );
  } else if (isError) {
    content = (
      <EmptyState
        icon={<TriangleAlert className="size-5" />}
        title="Couldn't load emails"
        description={error.message}
        action={<Button onClick={() => refetch()}>Try again</Button>}
      />
    );
  } else if (data.items.length === 0) {
    content = q ? (
      <EmptyState icon={<SearchX className="size-5" />} title={`No results for “${q}”`} description="Try a different address or subject." />
    ) : (
      <EmptyState
        icon={view === 'scheduled' ? <CalendarClock className="size-5" /> : <MailCheck className="size-5" />}
        title={copy.emptyTitle}
        description={copy.emptyText}
        action={
          <Link to="/compose" className={buttonClasses('primary')}>
            <SquarePen className="size-4" />
            Compose new email
          </Link>
        }
      />
    );
  } else {
    content = (
      <ul className="divide-y divide-gray-100">
        {data.items.map((email) => (
          <EmailRow key={email.id} email={email} view={view} />
        ))}
      </ul>
    );
  }

  return (
    <div className="flex min-h-full flex-col">
      <div className="flex flex-wrap items-center gap-3 border-b border-gray-100 px-4 py-3 md:px-6">
        <h1 className="text-lg font-semibold text-gray-900">
          {copy.title}
          {data && <span className="ml-2 text-sm font-normal text-gray-400">{data.total.toLocaleString()}</span>}
        </h1>
        <div className="flex w-full items-center gap-2 sm:ml-auto sm:w-auto">
          <SearchBox value={q} onChange={onSearch} placeholder={`Search ${copy.title.toLowerCase()} emails`} />
          <Button variant="ghost" size="sm" onClick={() => refetch()} aria-label="Refresh">
            <RefreshCw className={cn('size-4', isFetching && 'animate-spin')} />
          </Button>
        </div>
        {q && data?.searchEngine && (
          <p className="w-full text-xs text-gray-400">
            {data.searchEngine === 'elasticsearch' ? 'Results from Elasticsearch' : 'Search index unavailable, results from the database'}
          </p>
        )}
      </div>

      <div className="flex-1">{content}</div>

      {data && <Pagination page={page} pageSize={data.pageSize} total={data.total} onPageChange={(next) => updateParams({ page: next })} />}
    </div>
  );
}
