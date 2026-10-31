import nodemailer, { type Transporter } from 'nodemailer';
import type { Sender } from '@prisma/client';
import { env } from '../config/env.js';

const transports = new Map<string, Transporter>();

function getTransport(sender: Sender): Transporter {
  let transport = transports.get(sender.id);
  if (!transport) {
    transport =
      env.MAIL_TRANSPORT === 'stub'
        ? nodemailer.createTransport({ jsonTransport: true })
        : nodemailer.createTransport({
            host: sender.smtpHost,
            port: sender.smtpPort,
            secure: sender.smtpPort === 465,
            auth: { user: sender.smtpUser, pass: sender.smtpPass },
            pool: true,
            maxConnections: 2,
            connectionTimeout: 15_000,
            greetingTimeout: 10_000,
            socketTimeout: 30_000,
          });
    transports.set(sender.id, transport);
  }
  return transport;
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function textToHtml(text: string): string {
  return `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.5">${escapeHtml(text).replace(/\n/g, '<br>')}</div>`;
}

export interface OutgoingEmail {
  emailId: string;
  to: string;
  subject: string;
  text: string;
}

export async function sendEmail(sender: Sender, email: OutgoingEmail): Promise<{ messageId: string; previewUrl: string | null }> {
  const info = await getTransport(sender).sendMail({
    from: { name: sender.name, address: sender.email },
    to: email.to,
    subject: email.subject,
    text: email.text,
    html: textToHtml(email.text),
    // Stable Message-ID: if a send is ever retried, receivers can tell it is the same message.
    messageId: `<${email.emailId}@reachinbox.local>`,
  });

  const previewUrl = env.MAIL_TRANSPORT === 'smtp' ? nodemailer.getTestMessageUrl(info) || null : null;
  return { messageId: info.messageId, previewUrl };
}

// SMTP 5xx means the server refused the message for good (bad address, policy); retrying will not help.
export function isPermanentSmtpError(err: unknown): boolean {
  const code = (err as { responseCode?: number }).responseCode;
  return typeof code === 'number' && code >= 500 && code < 600;
}

export function closeTransports(): void {
  for (const transport of transports.values()) transport.close();
  transports.clear();
}
