'use strict';
// E-posta gönderimi (SMTP). Ayarlar ortam değişkenlerinden okunur:
//   SMTP_HOST, SMTP_PORT (varsayılan 587), SMTP_USER, SMTP_PASS, SMTP_SECURE ("1": 465/SSL)
//   MAIL_FROM  — gönderen, ör. "Kuran Araştırması <bildirim@alanadiniz.com>"
// SMTP_HOST tanımlı değilse e-posta gönderilmez; içerik sunucu kaydına (konsola) yazılır.
// Bu yalnızca geliştirme/deneme içindir.

const nodemailer = require('nodemailer');

let transport = null;
if (process.env.SMTP_HOST) {
  transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === '1',
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
  });
}

const configured = () => !!transport;

async function send({ to, subject, text, html }) {
  if (!transport) {
    console.log(`\n[E-POSTA — SMTP ayarlı değil, gönderilmedi]\nKime: ${to}\nKonu: ${subject}\n${text}\n`);
    return { sent: false };
  }
  await transport.sendMail({ from: process.env.MAIL_FROM || process.env.SMTP_USER, to, subject, text, html });
  return { sent: true };
}

module.exports = { send, configured };
