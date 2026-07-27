import 'server-only';
import { env } from '@/server/env';
import { logger } from '@/server/lib/logger';

/**
 * Email delivery behind a transport interface.
 *
 * No SMTP provider is configured yet, so the default transport logs the
 * message (including the action link, so local flows remain testable). Wiring
 * a real provider means implementing `EmailTransport` and passing it to
 * `setEmailTransport` — no call site changes.
 */

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export interface EmailTransport {
  send(message: EmailMessage): Promise<void>;
}

class ConsoleEmailTransport implements EmailTransport {
  send(message: EmailMessage): Promise<void> {
    logger.info(
      { to: message.to, subject: message.subject, body: message.text },
      'email (console transport — not actually delivered)',
    );
    return Promise.resolve();
  }
}

let transport: EmailTransport = new ConsoleEmailTransport();

export function setEmailTransport(next: EmailTransport): void {
  transport = next;
}

/** True once a real provider has been installed. */
export function isEmailConfigured(): boolean {
  return !(transport instanceof ConsoleEmailTransport);
}

function layout(heading: string, body: string, action?: { label: string; url: string }): string {
  return `<!doctype html>
<html>
  <body style="margin:0;padding:32px;background:#0a0a0f;font-family:ui-sans-serif,system-ui,sans-serif;">
    <table role="presentation" style="max-width:520px;margin:0 auto;background:#13131a;border-radius:16px;padding:40px;">
      <tr><td>
        <h1 style="margin:0 0 8px;font-size:22px;color:#fafafa;">${heading}</h1>
        <p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#a1a1aa;">${body}</p>
        ${
          action
            ? `<a href="${action.url}" style="display:inline-block;padding:12px 24px;background:linear-gradient(135deg,#8b5cf6,#6366f1);color:#fff;text-decoration:none;border-radius:10px;font-weight:600;font-size:15px;">${action.label}</a>
        <p style="margin:24px 0 0;font-size:13px;color:#71717a;">Or paste this link into your browser:<br><span style="color:#a78bfa;word-break:break-all;">${action.url}</span></p>`
            : ''
        }
      </td></tr>
    </table>
    <p style="max-width:520px;margin:16px auto 0;font-size:12px;color:#52525b;text-align:center;">StudentOS AI</p>
  </body>
</html>`;
}

export async function sendVerificationEmail(to: string, token: string): Promise<void> {
  const url = `${env.APP_URL}/verify-email?token=${encodeURIComponent(token)}`;
  await transport.send({
    to,
    subject: 'Verify your StudentOS AI email',
    text: `Welcome to StudentOS AI. Verify your email address: ${url}\n\nThis link expires in 24 hours.`,
    html: layout(
      'Verify your email',
      'Welcome to StudentOS AI. Confirm your email address to activate your account. This link expires in 24 hours.',
      { label: 'Verify email', url },
    ),
  });
}

export async function sendPasswordResetEmail(to: string, token: string): Promise<void> {
  const url = `${env.APP_URL}/reset-password?token=${encodeURIComponent(token)}`;
  await transport.send({
    to,
    subject: 'Reset your StudentOS AI password',
    text: `Reset your password: ${url}\n\nThis link expires in 1 hour. If you did not request this, you can ignore this email.`,
    html: layout(
      'Reset your password',
      'Use the button below to choose a new password. This link expires in 1 hour. If you did not request a reset, you can safely ignore this email.',
      { label: 'Reset password', url },
    ),
  });
}

export async function sendPasswordChangedEmail(to: string): Promise<void> {
  await transport.send({
    to,
    subject: 'Your StudentOS AI password was changed',
    text: 'Your password was just changed. If this was not you, reset your password immediately.',
    html: layout(
      'Your password was changed',
      'Your password was just changed and all other sessions were signed out. If this was not you, reset your password immediately.',
    ),
  });
}

export const emailService = {
  sendVerificationEmail,
  sendPasswordResetEmail,
  sendPasswordChangedEmail,
  setEmailTransport,
  isEmailConfigured,
} as const;
