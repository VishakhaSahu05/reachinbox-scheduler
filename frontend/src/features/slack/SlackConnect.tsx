import { useQueryClient } from '@tanstack/react-query';
import { ChevronDown, Hash, Send, Unplug } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useLocation, useSearchParams } from 'react-router';
import { queryKeys, useSlackDisconnect, useSlackStatus, useSlackTestMessage } from '../../api/queries';
import { buttonClasses } from '../../components/ui/Button';
import { Popover } from '../../components/ui/Popover';
import { useToast } from '../../components/ui/Toast';

const RESULT_MESSAGES: Record<string, { kind: 'success' | 'error' | 'info'; text: string }> = {
  connected: { kind: 'success', text: 'Slack connected. Rate-limit alerts will be posted to your channel.' },
  cancelled: { kind: 'info', text: 'Slack connection was cancelled.' },
  not_configured: { kind: 'error', text: 'Slack is not configured on the server (SLACK_CLIENT_ID / SLACK_CLIENT_SECRET).' },
  error: { kind: 'error', text: 'Could not connect Slack. Please try again.' },
};

/** Shows the toast for ?slack=... after the OAuth round trip, then cleans the URL. */
function useSlackRedirectResult() {
  const [params, setParams] = useSearchParams();
  const { pathname } = useLocation();
  const toast = useToast();
  const queryClient = useQueryClient();
  const result = params.get('slack');

  useEffect(() => {
    // Slack sends us back to "/", which immediately redirects; handle the result once, on the final page.
    if (!result || pathname === '/') return;
    const message = RESULT_MESSAGES[result] ?? RESULT_MESSAGES.error;
    toast[message.kind](message.text);
    queryClient.invalidateQueries({ queryKey: queryKeys.slack });
    setParams(
      (current) => {
        current.delete('slack');
        return current;
      },
      { replace: true },
    );
  }, [result, pathname, toast, queryClient, setParams]);
}

export function SlackConnect() {
  useSlackRedirectResult();
  const { data: status } = useSlackStatus();
  const testMessage = useSlackTestMessage();
  const disconnect = useSlackDisconnect();
  const toast = useToast();
  const [open, setOpen] = useState(false);

  if (!status) return null;

  if (!status.connected) {
    return (
      <a
        href="/api/slack/connect"
        className={buttonClasses('outline', 'sm')}
        onClick={(event) => {
          if (!status.configured) {
            event.preventDefault();
            toast.error(RESULT_MESSAGES.not_configured.text);
          }
        }}
      >
        <Hash className="size-4" />
        <span className="hidden sm:inline">Connect Slack</span>
      </a>
    );
  }

  return (
    <Popover
      open={open}
      onClose={() => setOpen(false)}
      trigger={
        <button
          onClick={() => setOpen((v) => !v)}
          className="inline-flex h-8 items-center gap-2 rounded-full bg-brand-50 px-3 text-sm font-medium text-brand-700 hover:bg-brand-100"
        >
          <span className="size-2 rounded-full bg-brand-500" />
          <span className="hidden sm:inline">Slack</span>
          <span className="hidden max-w-32 truncate text-brand-600 lg:inline">{status.channelName}</span>
          <ChevronDown className="size-3.5" />
        </button>
      }
    >
      <div className="w-64 p-1.5">
        <div className="border-b border-gray-100 px-3 pt-1.5 pb-2.5">
          <p className="text-sm font-semibold">{status.teamName}</p>
          <p className="text-xs text-gray-500">Alerts go to {status.channelName}</p>
        </div>
        <button
          className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-50"
          disabled={testMessage.isPending}
          onClick={() =>
            testMessage.mutate(undefined, {
              onSuccess: () => toast.success(`Test message sent to ${status.channelName}.`),
              onError: (err) => toast.error(err.message),
            })
          }
        >
          <Send className="size-4" />
          Send test message
        </button>
        <button
          className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50"
          disabled={disconnect.isPending}
          onClick={() =>
            disconnect.mutate(undefined, {
              onSuccess: () => {
                setOpen(false);
                toast.info('Slack disconnected. Rate-limit alerts are paused until you reconnect.');
              },
              onError: (err) => toast.error(err.message),
            })
          }
        >
          <Unplug className="size-4" />
          Disconnect
        </button>
      </div>
    </Popover>
  );
}
