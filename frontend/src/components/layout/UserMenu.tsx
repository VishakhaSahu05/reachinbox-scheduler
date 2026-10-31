import { Activity, ChevronDown, ExternalLink, LogOut } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useLogout } from '../../api/queries';
import type { User } from '../../api/types';
import { Avatar } from '../ui/Avatar';
import { Popover } from '../ui/Popover';
import { useToast } from '../ui/Toast';

const menuItem = 'flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm hover:bg-gray-50';

export function UserMenu({ user }: { user: User }) {
  const [open, setOpen] = useState(false);
  const logout = useLogout();
  const navigate = useNavigate();
  const toast = useToast();

  const handleLogout = () =>
    logout.mutate(undefined, {
      onSuccess: () => navigate('/login', { replace: true }),
      onError: (err) => toast.error(err.message),
    });

  return (
    <Popover
      open={open}
      onClose={() => setOpen(false)}
      trigger={
        <button
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-3 rounded-full py-1 pr-2 pl-1 hover:bg-gray-50"
          aria-haspopup="menu"
          aria-expanded={open}
        >
          <Avatar name={user.name} src={user.avatarUrl} />
          <span className="hidden text-left sm:block">
            <span className="block text-sm leading-tight font-semibold text-gray-900">{user.name}</span>
            <span className="block text-xs text-gray-500">{user.email}</span>
          </span>
          <ChevronDown className="size-4 text-gray-400" />
        </button>
      }
    >
      <div className="w-60 p-1.5" role="menu">
        <div className="border-b border-gray-100 px-3 pt-1.5 pb-2.5 sm:hidden">
          <p className="text-sm font-semibold">{user.name}</p>
          <p className="truncate text-xs text-gray-500">{user.email}</p>
        </div>
        <a href="/admin/queues" target="_blank" rel="noreferrer" className={`${menuItem} text-gray-700`} role="menuitem">
          <Activity className="size-4" />
          <span className="flex-1">Queue dashboard</span>
          <ExternalLink className="size-3.5 text-gray-400" />
        </a>
        <button onClick={handleLogout} disabled={logout.isPending} className={`${menuItem} text-red-600`} role="menuitem">
          <LogOut className="size-4" />
          Log out
        </button>
      </div>
    </Popover>
  );
}
