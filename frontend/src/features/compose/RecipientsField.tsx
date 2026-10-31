import { Upload, X } from 'lucide-react';
import { useRef, useState, type ClipboardEvent, type KeyboardEvent } from 'react';
import { cn } from '../../lib/cn';
import { extractEmails, mergeEmails } from '../../lib/leads';

const COLLAPSED_CHIPS = 3;
const EXPANDED_CHIPS = 100;
const MAX_FILE_BYTES = 5 * 1024 * 1024;

interface RecipientsFieldProps {
  id: string;
  value: string[];
  onChange: (emails: string[]) => void;
  error?: string;
}

export function RecipientsField({ id, value, onChange, error }: RecipientsFieldProps) {
  const [draft, setDraft] = useState('');
  const [note, setNote] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  function addFrom(text: string, source?: string): boolean {
    const found = extractEmails(text);
    if (found.length === 0) {
      setNote(source ? `No email addresses found in ${source}.` : `“${text.trim()}” is not a valid email address.`);
      return false;
    }
    const { emails, added, duplicates } = mergeEmails(value, found);
    onChange(emails);
    const skipped = duplicates ? `, ${duplicates} already in the list` : '';
    setNote(source ? `${source}: ${found.length} found, ${added} added${skipped}.` : duplicates ? 'Already in the list.' : null);
    return true;
  }

  function commitDraft() {
    if (draft.trim() && addFrom(draft)) setDraft('');
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if ((event.key === 'Enter' || event.key === ',' || event.key === ' ') && draft.trim()) {
      event.preventDefault();
      commitDraft();
    } else if (event.key === 'Backspace' && !draft && value.length > 0) {
      onChange(value.slice(0, -1));
    }
  }

  function onPaste(event: ClipboardEvent<HTMLInputElement>) {
    const text = event.clipboardData.getData('text');
    if (extractEmails(text).length > 1) {
      event.preventDefault();
      addFrom(text, 'Pasted list');
    }
  }

  async function onFile(file: File | undefined) {
    if (!file) return;
    if (file.size > MAX_FILE_BYTES) {
      setNote(`${file.name} is larger than 5 MB.`);
      return;
    }
    addFrom(await file.text(), file.name);
  }

  function clear() {
    onChange([]);
    setNote(null);
    setExpanded(false);
  }

  const visible = value.slice(0, expanded ? EXPANDED_CHIPS : COLLAPSED_CHIPS);
  const hidden = value.length - visible.length;

  return (
    <div>
      <div
        className={cn(
          'flex min-h-10 flex-wrap items-center gap-1.5 rounded-lg border bg-white px-2 py-1.5',
          'focus-within:border-brand-500 focus-within:ring-2 focus-within:ring-brand-100',
          error ? 'border-red-300' : 'border-gray-200',
        )}
      >
        {visible.map((email) => (
          <span key={email} className="inline-flex items-center gap-1 rounded-full border border-brand-200 bg-brand-50 py-0.5 pr-1 pl-2.5 text-xs text-brand-700">
            {email}
            <button
              type="button"
              onClick={() => onChange(value.filter((e) => e !== email))}
              className="rounded-full p-0.5 hover:bg-brand-100"
              aria-label={`Remove ${email}`}
            >
              <X className="size-3" />
            </button>
          </span>
        ))}
        {hidden > 0 && (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            disabled={expanded}
            className="rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-600 enabled:hover:bg-gray-200"
          >
            +{hidden.toLocaleString()}
            {expanded && ' more'}
          </button>
        )}
        <input
          id={id}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          onBlur={commitDraft}
          placeholder={value.length ? 'Add more…' : 'name@company.com'}
          className="h-7 min-w-40 flex-1 bg-transparent px-1 text-sm outline-none placeholder:text-gray-400"
          autoComplete="off"
        />
        <button
          type="button"
          onClick={() => fileInput.current?.click()}
          className="ml-auto inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-sm font-medium text-brand-700 hover:bg-brand-50"
        >
          <Upload className="size-4" />
          Upload List
        </button>
        <input
          ref={fileInput}
          type="file"
          accept=".csv,.txt,text/csv,text/plain"
          hidden
          onChange={(event) => {
            void onFile(event.target.files?.[0]);
            event.target.value = '';
          }}
        />
      </div>

      <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2 text-xs">
        <span className={error ? 'text-red-600' : 'text-gray-500'}>
          {error ?? note ?? 'Type or paste addresses, or upload a CSV / TXT file of leads.'}
        </span>
        {value.length > 0 && (
          <span className="flex items-center gap-3">
            <span className="font-medium text-brand-700">
              {value.length.toLocaleString()} email address{value.length === 1 ? '' : 'es'} detected
            </span>
            <button type="button" onClick={clear} className="text-gray-500 hover:text-gray-800">
              Clear
            </button>
          </span>
        )}
      </div>
    </div>
  );
}
