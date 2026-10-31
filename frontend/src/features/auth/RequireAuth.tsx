import { CloudOff } from 'lucide-react';
import type { ReactNode } from 'react';
import { Navigate } from 'react-router';
import { useMe } from '../../api/queries';
import type { User } from '../../api/types';
import { Button } from '../../components/ui/Button';
import { EmptyState } from '../../components/ui/EmptyState';
import { FullPageSpinner } from '../../components/ui/Spinner';

export function RequireAuth({ children }: { children: ReactNode }) {
  const { data: user, isPending, isError, error, refetch } = useMe();

  if (isPending) return <FullPageSpinner />;
  if (isError) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <EmptyState
          icon={<CloudOff className="size-5" />}
          title="Can't reach the server"
          description={error.message}
          action={<Button onClick={() => refetch()}>Try again</Button>}
        />
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

/** For components rendered under <RequireAuth>, where the user is always loaded. */
export function useCurrentUser(): User {
  const { data } = useMe();
  if (!data) throw new Error('useCurrentUser used outside <RequireAuth>');
  return data;
}
