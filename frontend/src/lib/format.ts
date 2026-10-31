const DAY_MS = 24 * 3600 * 1000;

const weekdayTime = new Intl.DateTimeFormat(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit', second: '2-digit' });
const shortDateTime = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const fullDateTime = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'medium' });

/** "Tue 9:21:47 AM" for the coming/past week, "Nov 5, 9:21 AM" further out. */
export function formatChipTime(iso: string): string {
  const date = new Date(iso);
  return Math.abs(date.getTime() - Date.now()) < 6 * DAY_MS ? weekdayTime.format(date) : shortDateTime.format(date);
}

export function formatDateTime(iso: string): string {
  return fullDateTime.format(new Date(iso));
}

export function formatShortDateTime(iso: string): string {
  return shortDateTime.format(new Date(iso));
}

/** Value for <input type="datetime-local"> in the user's own timezone. */
export function toDateTimeLocal(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function pluralize(count: number, word: string): string {
  return `${count.toLocaleString()} ${word}${count === 1 ? '' : 's'}`;
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join('');
}
