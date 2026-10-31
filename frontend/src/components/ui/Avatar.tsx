import { useState } from 'react';
import { cn } from '../../lib/cn';
import { initials } from '../../lib/format';

interface AvatarProps {
  name: string;
  src?: string | null;
  className?: string;
}

export function Avatar({ name, src, className }: AvatarProps) {
  const [broken, setBroken] = useState(false);
  const classes = cn('size-9 shrink-0 rounded-full', className);

  if (src && !broken) {
    return <img src={src} alt={name} className={cn(classes, 'object-cover')} referrerPolicy="no-referrer" onError={() => setBroken(true)} />;
  }
  return (
    <span className={cn(classes, 'flex items-center justify-center bg-brand-100 text-xs font-semibold text-brand-700')} aria-label={name}>
      {initials(name)}
    </span>
  );
}
