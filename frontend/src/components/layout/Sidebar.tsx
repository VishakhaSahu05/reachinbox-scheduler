import { Activity, Clock, Send, SquarePen } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link, NavLink } from 'react-router';
import { useEmailCounts } from '../../api/queries';
import { cn } from '../../lib/cn';
import { buttonClasses } from '../ui/Button';
import { Logo } from './Logo';

interface NavItemProps {
  to: string;
  icon: ReactNode;
  label: string;
  count?: number;
}

function NavItem({ to, icon, label, count }: NavItemProps) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        cn(
          'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
          isActive ? 'bg-brand-50 text-brand-700' : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900',
        )
      }
    >
      {icon}
      <span className="flex-1">{label}</span>
      {count !== undefined && <span className="text-xs tabular-nums text-gray-500">{count.toLocaleString()}</span>}
    </NavLink>
  );
}

export function Sidebar() {
  const { data: counts } = useEmailCounts();

  return (
    <aside className="hidden w-64 shrink-0 flex-col border-r border-gray-100 bg-white px-4 py-5 md:flex">
      <div className="px-2">
        <Logo />
      </div>

      <Link to="/compose" className={buttonClasses('outline', 'md', 'mt-7 w-full')}>
        <SquarePen className="size-4" />
        Compose
      </Link>

      <p className="mt-8 px-3 text-xs font-semibold uppercase tracking-wider text-gray-400">Core</p>
      <nav className="mt-2 space-y-1">
        <NavItem to="/scheduled" icon={<Clock className="size-4" />} label="Scheduled" count={counts?.scheduled} />
        <NavItem to="/sent" icon={<Send className="size-4" />} label="Sent" count={counts?.sent} />
      </nav>

      <a
        href="/admin/queues"
        target="_blank"
        rel="noreferrer"
        className="mt-auto flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-gray-500 hover:bg-gray-50 hover:text-gray-900"
      >
        <Activity className="size-4" />
        Queue dashboard
      </a>
    </aside>
  );
}

/** Tab strip shown instead of the sidebar on small screens. */
export function MobileNav() {
  const tab = ({ isActive }: { isActive: boolean }) =>
    cn('flex-1 rounded-lg py-2 text-center text-sm font-medium', isActive ? 'bg-brand-50 text-brand-700' : 'text-gray-600');

  return (
    <nav className="flex gap-1 border-b border-gray-100 px-4 py-2 md:hidden">
      <NavLink to="/scheduled" className={tab}>
        Scheduled
      </NavLink>
      <NavLink to="/sent" className={tab}>
        Sent
      </NavLink>
      <NavLink to="/compose" className={tab}>
        Compose
      </NavLink>
    </nav>
  );
}
