import { getEnv } from './env.js';

export function isTransactionalEmailConfigured() {
  return Boolean(process.env.RESEND_API_KEY && process.env.RESEND_FROM_EMAIL);
}

export async function sendTransactionalEmail({ to, subject, html, text }) {
  const apiKey = getEnv('RESEND_API_KEY');
  const from = getEnv('RESEND_FROM_EMAIL');

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: Array.isArray(to) ? to : [to],
      subject,
      html,
      text,
    }),
  });

  if (!response.ok) {
    const payloadText = await response.text();
    let payload = null;

    if (payloadText) {
      try {
        payload = JSON.parse(payloadText);
      } catch (error) {
        payload = null;
      }
    }

    const message = payload?.message || payload?.error || 'Unable to send email right now.';
    throw new Error(message);
  }

  return response.json();
}
