export type EmailStatus = 'SCHEDULED' | 'RATE_LIMITED' | 'SENDING' | 'SENT' | 'FAILED';
export type EmailView = 'scheduled' | 'sent';

export interface User {
  id: string;
  name: string;
  email: string;
  avatarUrl: string | null;
}

export interface Sender {
  id: string;
  name: string;
  email: string;
}

export interface EmailItem {
  id: string;
  campaignId: string;
  to: string;
  subject: string;
  preview: string;
  status: EmailStatus;
  scheduledAt: string;
  sentAt: string | null;
  sender: { name: string; email: string };
  previewUrl: string | null;
  error: string | null;
  attempts: number;
  rescheduleCount: number;
}

export interface EmailDetail extends EmailItem {
  body: string;
  messageId: string | null;
  campaign: { delayMs: number; hourlyLimit: number };
  createdAt: string;
}

export interface EmailListResponse {
  items: EmailItem[];
  total: number;
  page: number;
  pageSize: number;
  searchEngine: 'elasticsearch' | 'postgres' | null;
}

export interface EmailCounts {
  scheduled: number;
  sent: number;
  failed: number;
}

export interface SchedulerConfig {
  minDelayBetweenEmailsMs: number;
  maxEmailsPerHourPerSender: number;
  maxEmailsPerHour: number;
  rateLimitWindowMs: number;
}

export interface SlackStatus {
  configured: boolean;
  connected: boolean;
  teamName: string | null;
  channelName: string | null;
  connectedAt: string | null;
}

export interface ScheduleCampaignInput {
  senderId: string;
  subject: string;
  body: string;
  recipients: string[];
  startAt: string;
  delayBetweenEmailsSec: number;
  hourlyLimit: number;
}

export interface ScheduleCampaignResponse {
  created: boolean;
  campaign: {
    id: string;
    totalEmails: number;
    startAt: string;
    delayMs: number;
    hourlyLimit: number;
    firstSendAt: string | null;
    lastSendAt: string | null;
  };
}
