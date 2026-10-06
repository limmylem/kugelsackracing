// Sending email (verification, password reset, account deletion): SMTP through nodemailer — Gmail with an
// app password to start, any SMTP service later, Mailpit in Docker Compose for development. The tests use
// an in-memory outbox. A message's text holds one-time links: it's never logged (only its kind and the
// address's domain are).

import nodemailer from 'nodemailer';

export type Mail = { to: string; subject: string; text: string; html: string; kind: string };
export type Mailer = { send(m: Mail): Promise<void>; outbox?: Mail[] };

export function createMailer({ smtpUrl, from, log }: { smtpUrl: string | null; from: string; log: { info: (o: object, msg: string) => void; error: (o: object, msg: string) => void } }): Mailer {
  if (smtpUrl === 'memory://') {
    const outbox: Mail[] = [];
    return { outbox, async send(m) { outbox.push(m); } };
  }
  if (!smtpUrl) {
    // (no way to send: the account flows that need email can't finish — said plainly in the log, the link never)
    return { async send(m) { log.error({ kind: m.kind, domain: m.to.split('@')[1] }, 'email not sent: SMTP_URL is not set'); } };
  }
  const transport = nodemailer.createTransport(smtpUrl);
  return {
    async send(m) {
      await transport.sendMail({ from, to: m.to, subject: m.subject, text: m.text, html: m.html });
      log.info({ kind: m.kind, domain: m.to.split('@')[1] }, 'email sent');
    },
  };
}

const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
export function linkMail(kind: string, to: string, subject: string, intro: string, url: string, outro: string): Mail {
  return {
    kind, to, subject,
    text: `${intro}\n\n${url}\n\n${outro}\n\nKugelsack Racing`,
    html: `<p>${esc(intro)}</p><p><a href="${esc(url)}">${esc(url)}</a></p><p>${esc(outro)}</p><p>Kugelsack Racing</p>`,
  };
}
