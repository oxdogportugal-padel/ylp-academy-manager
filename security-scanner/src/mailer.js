'use strict';
const fs = require('node:fs');
const path = require('node:path');
const nodemailer = require('nodemailer');

/** SMTP when configured; otherwise every message is written to an outbox folder as .eml (dev). */
function createMailer(mail) {
  const smtp = Boolean(mail.host);
  const transport = smtp
    ? nodemailer.createTransport({ host: mail.host, port: mail.port, secure: mail.secure, auth: mail.user ? { user: mail.user, pass: mail.pass } : undefined })
    : nodemailer.createTransport({ streamTransport: true, buffer: true, newline: 'unix' });

  const sent = [];
  async function send({ to, subject, html, text }) {
    const info = await transport.sendMail({ from: mail.from, to, subject, html, text });
    if (!smtp) {
      fs.mkdirSync(mail.outboxDir, { recursive: true });
      const file = path.join(mail.outboxDir, `${Date.now()}-${subject.replace(/[^a-z0-9]+/gi, '-').slice(0, 60)}.eml`);
      fs.writeFileSync(file, info.message);
      info.file = file;
    }
    sent.push({ to, subject, at: new Date().toISOString() });
    return info;
  }
  return { send, sent, mode: smtp ? 'smtp' : 'outbox' };
}

module.exports = { createMailer };
