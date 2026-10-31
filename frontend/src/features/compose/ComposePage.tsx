import { ArrowLeft } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { useScheduleCampaign, useSchedulerConfig, useSenders } from '../../api/queries';
import { Button } from '../../components/ui/Button';
import { Field, Input, Select, Textarea } from '../../components/ui/Input';
import { useToast } from '../../components/ui/Toast';
import { formatChipTime, pluralize } from '../../lib/format';
import { RecipientsField } from './RecipientsField';
import { SendLaterPopover } from './SendLaterPopover';

const MAX_RECIPIENTS = 10_000;

interface ComposeForm {
  senderId: string;
  recipients: string[];
  subject: string;
  body: string;
  delaySec: string;
  hourlyLimit: string;
}

type FormErrors = Partial<Record<keyof ComposeForm, string>>;

function validate(form: ComposeForm): FormErrors {
  const errors: FormErrors = {};
  if (!form.senderId) errors.senderId = 'Choose a sender';
  if (form.recipients.length === 0) errors.recipients = 'Add at least one recipient';
  if (form.recipients.length > MAX_RECIPIENTS) errors.recipients = `At most ${MAX_RECIPIENTS.toLocaleString()} recipients per campaign`;
  if (!form.subject.trim()) errors.subject = 'Subject is required';
  if (!form.body.trim()) errors.body = 'Write the email body';
  const delay = Number(form.delaySec);
  if (form.delaySec === '' || !Number.isFinite(delay) || delay < 0) errors.delaySec = 'Enter 0 or more seconds';
  const limit = Number(form.hourlyLimit);
  if (!Number.isInteger(limit) || limit < 1) errors.hourlyLimit = 'Enter a whole number, at least 1';
  return errors;
}

/** Label on the left like the mail clients we're mimicking; stacks on small screens. */
function Row({ label, htmlFor, children }: { label: string; htmlFor: string; children: ReactNode }) {
  return (
    <div className="grid gap-1.5 md:grid-cols-[88px_1fr] md:items-start md:gap-4">
      <label htmlFor={htmlFor} className="text-sm text-gray-500 md:pt-2.5">
        {label}
      </label>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

export function ComposePage() {
  const navigate = useNavigate();
  const toast = useToast();
  const senders = useSenders();
  const { data: config } = useSchedulerConfig();
  const schedule = useScheduleCampaign();

  const [form, setForm] = useState<ComposeForm>({ senderId: '', recipients: [], subject: '', body: '', delaySec: '2', hourlyLimit: '50' });
  const [errors, setErrors] = useState<FormErrors>({});
  const [sendLaterOpen, setSendLaterOpen] = useState(false);
  // One key per compose session: a double click or retry can't create the campaign twice.
  const [idempotencyKey] = useState(() => crypto.randomUUID());

  useEffect(() => {
    if (!form.senderId && senders.data?.length) setForm((f) => ({ ...f, senderId: senders.data[0].id }));
  }, [senders.data, form.senderId]);

  function update<K extends keyof ComposeForm>(key: K, value: ComposeForm[K]) {
    setForm((f) => ({ ...f, [key]: value }));
    if (errors[key]) setErrors((e) => ({ ...e, [key]: undefined }));
  }

  function openSendLater() {
    const found = validate(form);
    setErrors(found);
    if (Object.keys(found).length > 0) {
      toast.error('Please fix the highlighted fields first.');
      return;
    }
    setSendLaterOpen(true);
  }

  function submit(startAt: Date) {
    schedule.mutate(
      {
        idempotencyKey,
        input: {
          senderId: form.senderId,
          recipients: form.recipients,
          subject: form.subject.trim(),
          body: form.body,
          startAt: startAt.toISOString(),
          delayBetweenEmailsSec: Number(form.delaySec),
          hourlyLimit: Number(form.hourlyLimit),
        },
      },
      {
        onSuccess: ({ campaign, created }) => {
          toast.success(
            created
              ? `Scheduled ${pluralize(campaign.totalEmails, 'email')}. First one goes out ${formatChipTime(campaign.firstSendAt ?? campaign.startAt)}.`
              : 'This campaign was already scheduled.',
          );
          navigate('/scheduled');
        },
        onError: (err) => toast.error(err.message),
      },
    );
  }

  const minDelaySec = config ? config.minDelayBetweenEmailsMs / 1000 : null;
  const senderCap = config?.maxEmailsPerHourPerSender;

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 md:px-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => navigate(-1)} aria-label="Back">
            <ArrowLeft className="size-4" />
          </Button>
          <h1 className="text-xl font-semibold text-gray-900">Compose New Email</h1>
        </div>
        <SendLaterPopover
          open={sendLaterOpen}
          onOpenChange={setSendLaterOpen}
          onRequestOpen={openSendLater}
          onSchedule={submit}
          loading={schedule.isPending}
        />
      </div>

      <div className="mt-6 space-y-5 rounded-2xl border border-gray-100 p-4 md:p-6">
        <Row label="From" htmlFor="sender">
          <Select
            id="sender"
            value={form.senderId}
            onChange={(event) => update('senderId', event.target.value)}
            disabled={senders.isPending}
            className="bg-gray-50 md:max-w-sm"
          >
            {senders.isPending && <option>Loading senders…</option>}
            {senders.data?.map((sender) => (
              <option key={sender.id} value={sender.id}>
                {sender.name} — {sender.email}
              </option>
            ))}
          </Select>
          {(errors.senderId || senders.isError) && (
            <p className="mt-1.5 text-xs text-red-600">{errors.senderId ?? senders.error?.message}</p>
          )}
        </Row>

        <Row label="To" htmlFor="recipients">
          <RecipientsField id="recipients" value={form.recipients} onChange={(emails) => update('recipients', emails)} error={errors.recipients} />
        </Row>

        <Row label="Subject" htmlFor="subject">
          <Input
            id="subject"
            value={form.subject}
            onChange={(event) => update('subject', event.target.value)}
            placeholder="Subject"
            maxLength={300}
            className={errors.subject ? 'border-red-300' : undefined}
          />
          {errors.subject && <p className="mt-1.5 text-xs text-red-600">{errors.subject}</p>}
        </Row>

        <div className="grid gap-4 sm:grid-cols-2 md:pl-[104px]">
          <Field
            label="Delay between 2 emails (seconds)"
            htmlFor="delay"
            error={errors.delaySec}
            hint={minDelaySec !== null && `The server never sends faster than one email every ${minDelaySec}s per sender.`}
          >
            <Input id="delay" type="number" min={0} step="any" value={form.delaySec} onChange={(event) => update('delaySec', event.target.value)} />
          </Field>
          <Field
            label="Hourly limit"
            htmlFor="hourly-limit"
            error={errors.hourlyLimit}
            hint={senderCap ? `Each sender is also capped at ${senderCap} emails/hour server-wide.` : undefined}
          >
            <Input
              id="hourly-limit"
              type="number"
              min={1}
              step={1}
              value={form.hourlyLimit}
              onChange={(event) => update('hourlyLimit', event.target.value)}
            />
          </Field>
        </div>

        <div>
          <label htmlFor="body" className="sr-only">
            Body
          </label>
          <Textarea
            id="body"
            rows={12}
            value={form.body}
            onChange={(event) => update('body', event.target.value)}
            placeholder="Type your email…"
            className={errors.body ? 'border-red-300 bg-gray-50' : 'bg-gray-50'}
          />
          {errors.body && <p className="mt-1.5 text-xs text-red-600">{errors.body}</p>}
        </div>
      </div>
    </div>
  );
}
