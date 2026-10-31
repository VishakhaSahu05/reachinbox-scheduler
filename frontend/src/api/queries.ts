import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from './client';
import type {
  EmailCounts,
  EmailDetail,
  EmailListResponse,
  EmailView,
  ScheduleCampaignInput,
  ScheduleCampaignResponse,
  SchedulerConfig,
  Sender,
  SlackStatus,
  User,
} from './types';

// Lists refresh on their own so emails visibly move from Scheduled to Sent.
const LIVE_REFRESH_MS = 5_000;

export const queryKeys = {
  me: ['me'] as const,
  config: ['config'] as const,
  senders: ['senders'] as const,
  emails: (view: EmailView, page: number, q: string) => ['emails', view, page, q] as const,
  emailCounts: ['emails', 'counts'] as const,
  email: (id: string) => ['email', id] as const,
  slack: ['slack'] as const,
};

export function useMe() {
  return useQuery({
    queryKey: queryKeys.me,
    queryFn: async () => {
      try {
        return (await api<{ user: User }>('/auth/me')).user;
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) return null;
        throw err;
      }
    },
    staleTime: 5 * 60_000,
    retry: false,
  });
}

export function useLogout() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api<void>('/auth/logout', { method: 'POST' }),
    onSuccess: () => {
      queryClient.clear();
      queryClient.setQueryData(queryKeys.me, null);
    },
  });
}

export function useSchedulerConfig() {
  return useQuery({
    queryKey: queryKeys.config,
    queryFn: () => api<SchedulerConfig>('/config'),
    staleTime: Infinity,
  });
}

export function useSenders() {
  return useQuery({
    queryKey: queryKeys.senders,
    queryFn: async () => (await api<{ senders: Sender[] }>('/senders')).senders,
    staleTime: 5 * 60_000,
  });
}

export function useEmails(view: EmailView, page: number, q: string) {
  return useQuery({
    queryKey: queryKeys.emails(view, page, q),
    queryFn: () => {
      const params = new URLSearchParams({ view, page: String(page), pageSize: '25' });
      if (q) params.set('q', q);
      return api<EmailListResponse>(`/emails?${params}`);
    },
    placeholderData: keepPreviousData,
    refetchInterval: LIVE_REFRESH_MS,
  });
}

export function useEmailCounts() {
  return useQuery({
    queryKey: queryKeys.emailCounts,
    queryFn: () => api<EmailCounts>('/emails/counts'),
    refetchInterval: LIVE_REFRESH_MS,
  });
}

export function useEmail(id: string) {
  return useQuery({
    queryKey: queryKeys.email(id),
    queryFn: async () => (await api<{ email: EmailDetail }>(`/emails/${id}`)).email,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === 'SENT' || status === 'FAILED' ? false : LIVE_REFRESH_MS;
    },
  });
}

export function useScheduleCampaign() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ input, idempotencyKey }: { input: ScheduleCampaignInput; idempotencyKey: string }) =>
      api<ScheduleCampaignResponse>('/campaigns', {
        method: 'POST',
        json: input,
        headers: { 'Idempotency-Key': idempotencyKey },
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['emails'] }),
  });
}

export function useSlackStatus() {
  return useQuery({
    queryKey: queryKeys.slack,
    queryFn: () => api<SlackStatus>('/slack/status'),
  });
}

export function useSlackTestMessage() {
  return useMutation({ mutationFn: () => api<void>('/slack/test', { method: 'POST' }) });
}

export function useSlackDisconnect() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api<void>('/slack', { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.slack }),
  });
}
