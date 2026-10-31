const EMAIL_PATTERN = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;

/**
 * Pulls every email address out of free text: a CSV with any columns/headers, a plain list,
 * or something pasted from a spreadsheet. Lower-cased and de-duplicated, first occurrence wins.
 */
export function extractEmails(text: string): string[] {
  const found = text.match(EMAIL_PATTERN) ?? [];
  return [...new Set(found.map((email) => email.toLowerCase().replace(/\.+$/, '')))];
}

/** Adds new addresses to an existing list and reports how many were already there. */
export function mergeEmails(existing: string[], incoming: string[]): { emails: string[]; added: number; duplicates: number } {
  const seen = new Set(existing);
  const added = incoming.filter((email) => !seen.has(email));
  return { emails: [...existing, ...added], added: added.length, duplicates: incoming.length - added.length };
}
