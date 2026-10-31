import { CalendarClock } from 'lucide-react';
import { useState } from 'react';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Popover } from '../../components/ui/Popover';
import { cn } from '../../lib/cn';
import { formatDateTime, toDateTimeLocal } from '../../lib/format';

function tomorrowAt(hour: number): Date {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  date.setHours(hour, 0, 0, 0);
  return date;
}

const PRESETS: { label: string; date: () => Date }[] = [
  { label: 'Now', date: () => new Date() },
  { label: 'In 5 minutes', date: () => new Date(Date.now() + 5 * 60_000) },
  { label: 'Tomorrow, 10:00 AM', date: () => tomorrowAt(10) },
  { label: 'Tomorrow, 11:00 AM', date: () => tomorrowAt(11) },
  { label: 'Tomorrow, 3:00 PM', date: () => tomorrowAt(15) },
];

// "Now" picked a few seconds ago is still fine; the server never schedules in the past.
const PAST_GRACE_MS = 2 * 60_000;

interface SendLaterPopoverProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRequestOpen: () => void;
  onSchedule: (startAt: Date) => void;
  loading: boolean;
}

export function SendLaterPopover({ open, onOpenChange, onRequestOpen, onSchedule, loading }: SendLaterPopoverProps) {
  const [startAt, setStartAt] = useState<Date>(() => PRESETS[1].date());
  const [preset, setPreset] = useState<string | null>(PRESETS[1].label);
  const inPast = startAt.getTime() < Date.now() - PAST_GRACE_MS;

  return (
    <Popover
      open={open}
      onClose={() => onOpenChange(false)}
      trigger={
        <Button variant="outline" icon={<CalendarClock className="size-4" />} onClick={() => (open ? onOpenChange(false) : onRequestOpen())}>
          Send Later
        </Button>
      }
      className="w-[min(20rem,calc(100vw-2rem))]"
    >
      <div className="p-4">
        <h3 className="text-sm font-semibold text-gray-900">Send Later</h3>
        <label htmlFor="start-at" className="mt-3 block text-xs text-gray-500">
          Pick date &amp; time
        </label>
        <Input
          id="start-at"
          type="datetime-local"
          className="mt-1"
          value={toDateTimeLocal(startAt)}
          onChange={(event) => {
            if (!event.target.value) return;
            setStartAt(new Date(event.target.value));
            setPreset(null);
          }}
        />

        <div className="mt-3 space-y-0.5">
          {PRESETS.map((option) => (
            <button
              key={option.label}
              type="button"
              onClick={() => {
                setStartAt(option.date());
                setPreset(option.label);
              }}
              className={cn(
                'w-full rounded-lg px-3 py-2 text-left text-sm',
                preset === option.label ? 'bg-brand-50 font-medium text-brand-700' : 'text-gray-700 hover:bg-gray-50',
              )}
            >
              {option.label}
            </button>
          ))}
        </div>

        <p className={cn('mt-3 text-xs', inPast ? 'text-red-600' : 'text-gray-500')}>
          {inPast ? 'Pick a time in the future.' : `First email goes out ${formatDateTime(startAt.toISOString())}`}
        </p>

        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button size="sm" loading={loading} disabled={inPast} onClick={() => onSchedule(preset === 'Now' ? new Date() : startAt)}>
            Schedule
          </Button>
        </div>
      </div>
    </Popover>
  );
}
