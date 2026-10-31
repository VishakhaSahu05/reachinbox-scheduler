import { Outlet, useLocation } from 'react-router';
import { useCurrentUser } from '../../features/auth/RequireAuth';
import { SlackConnect } from '../../features/slack/SlackConnect';
import { Logo } from './Logo';
import { MobileNav, Sidebar } from './Sidebar';
import { UserMenu } from './UserMenu';

const SECTION_TITLES: [prefix: string, title: string][] = [
  ['/scheduled', 'Scheduled Emails'],
  ['/sent', 'Sent Emails'],
  ['/compose', 'Compose'],
  ['/emails', 'Email details'],
];

export function AppLayout() {
  const user = useCurrentUser();
  const { pathname } = useLocation();
  const title = SECTION_TITLES.find(([prefix]) => pathname.startsWith(prefix))?.[1] ?? '';

  return (
    <div className="flex h-dvh bg-white">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-16 shrink-0 items-center gap-3 border-b border-gray-100 px-4 md:px-6">
          <div className="md:hidden">
            <Logo compact />
          </div>
          <p className="hidden text-sm font-medium text-gray-500 md:block">{title}</p>
          <div className="ml-auto flex items-center gap-2 sm:gap-4">
            <SlackConnect />
            <UserMenu user={user} />
          </div>
        </header>
        <MobileNav />
        <main className="min-h-0 flex-1 overflow-y-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
