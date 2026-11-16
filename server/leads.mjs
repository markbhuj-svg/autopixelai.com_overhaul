import { createHash } from 'node:crypto';
import nodemailer from 'nodemailer';
import { companyTypes } from '../src/lead-options.mjs';

const recipient = 'team@autopixelai.com';
const unavailable = 'We couldn’t confirm your enquiry. Please try again or email team@autopixelai.com.';
const invalid = 'Please check the required fields and complete the security check.';
const emailPattern = /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;
const uuidPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const limits = {
  firstName: 80, lastName: 80, email: 160, company: 160, companyType: 80, phone: 40,
  message: 2000, sourcePage: 200, requestType: 80, leadId: 36, turnstileToken: 2048, contactWebsite: 200,
};

function validate(body) {
  if (!body || Array.isArray(body) || body.consent !== true) return;
  const fields = {};
  for (const [key, limit] of Object.entries(limits)) {
    const value = body[key] ?? '';
    if (typeof value !== 'string' || value.length > limit || (key !== 'message' && /[\x00-\x1f\x7f]/.test(value))) return;
    fields[key] = value.trim();
  }
  if (!fields.firstName || !fields.company || !emailPattern.test(fields.email) || fields.contactWebsite ||
      (fields.companyType && !companyTypes.includes(fields.companyType)) ||
      !uuidPattern.test(fields.leadId) || !fields.turnstileToken || !/^\/[a-z0-9/_-]*$/i.test(fields.sourcePage)) return;
  return fields;
}

function isSameOrigin(origin, host) {
  if (!origin) return true;
  try { return new URL(origin).host === host; }
  catch { return false; }
}

export function createLeadRoutes({ env = process.env, verify = fetch, deliver } = {}) {
  const user = env.GOOGLE_SMTP_USER;
  const password = env.GOOGLE_SMTP_APP_PASSWORD?.replace(/\s/g, '');
  const enabled = Boolean(user && emailPattern.test(user) && password && env.TURNSTILE_SITE_KEY && env.TURNSTILE_SECRET_KEY);
  if (enabled && !deliver) {
    const transport = nodemailer.createTransport({
      host: 'smtp.gmail.com', port: 465, secure: true, auth: { user, pass: password },
      connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 15000,
      disableFileAccess: true, disableUrlAccess: true,
    });
    deliver = (mail) => transport.sendMail(mail);
  }

  // shortcut: request limits and receipts are per process; move them to shared storage before scaling beyond one instance.
  const receipts = new Map();
  let attemptWindow = 0;
  let attempts = 0;

  function config(_req, res) {
    res.json({ enabled, turnstileSiteKey: enabled ? env.TURNSTILE_SITE_KEY : '' });
  }

  async function submit(req, res) {
    if (!isSameOrigin(req.get('origin'), req.get('host'))) return res.status(403).json({ message: 'Please submit from this website.' });
    if (!enabled) return res.status(503).json({ message: unavailable });
    if (!req.is('application/json')) return res.status(415).json({ message: 'Please submit through the website form.' });
    const fields = validate(req.body);
    if (!fields) return res.status(400).json({ message: invalid });
    const { turnstileToken, contactWebsite, ...lead } = fields;
    const now = Date.now();
    const digest = createHash('sha256').update(JSON.stringify(lead)).digest('hex');
    for (const [id, receipt] of receipts) {
      if (now - receipt.created > 3600000) receipts.delete(id);
    }
    const existing = receipts.get(lead.leadId);
    if (existing && existing.digest !== digest) {
      return res.status(409).json({ message: 'The enquiry changed. Please reload the form and try again.' });
    }
    if (now - attemptWindow >= 600000) {
      attemptWindow = now;
      attempts = 0;
    }
    if (!existing && ++attempts > 30) {
      return res.set('Retry-After', String(Math.ceil((attemptWindow + 600000 - now) / 1000)))
        .status(429).json({ message: 'Please try again shortly or email team@autopixelai.com.' });
    }

    const result = existing?.result ?? sendLead(lead, turnstileToken, req.hostname, now);
    if (!existing) receipts.set(lead.leadId, { digest, created: now, result });
    const { status, body } = await result;
    if (status !== 202 && receipts.get(lead.leadId)?.result === result) receipts.delete(lead.leadId);
    return res.status(status).json(body);
  }

  async function sendLead(lead, token, hostname, receivedAt) {
    try {
      const verified = await verify('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ secret: env.TURNSTILE_SECRET_KEY, response: token, idempotency_key: lead.leadId }),
        signal: AbortSignal.timeout(10000),
      });
      const verdict = await verified.json();
      if (!verified.ok || verdict.success !== true || verdict.hostname !== hostname || verdict.action !== 'lead') {
        return { status: 400, body: { message: 'Please complete the security check again.' } };
      }

      const campaign = /^\/BlackFriday\/?$/.test(lead.sourcePage);
      const lines = [
        `Reference: ${lead.leadId}`, `Name: ${[lead.firstName, lead.lastName].filter(Boolean).join(' ')}`,
        `Email: ${lead.email}`, `Dealership or company: ${lead.company}`, `Company type: ${lead.companyType || 'Not provided'}`,
        `Phone: ${lead.phone || 'Not provided'}`, `Page: ${lead.sourcePage}`, `Topic: ${lead.requestType}`,
        ...(campaign ? [`Offer request recorded at (UTC): ${new Date(receivedAt).toISOString()}`] : []), '', lead.message,
      ];
      const mail = await deliver({
        from: { name: 'AutoPixelAI Website', address: user },
        to: recipient, replyTo: { address: lead.email },
        subject: `${campaign ? 'Black Friday' : 'Demo'} enquiry: ${lead.company}`,
        messageId: `<${lead.leadId}@autopixelai.com>`,
        text: lines.join('\n'),
      });
      if (!mail.accepted?.some((address) => address.toLowerCase() === recipient)) throw Error('Delivery was not accepted');
      return { status: 202, body: { reference: lead.leadId } };
    } catch {
      return { status: 503, body: { message: unavailable } };
    }
  }

  return { config, submit };
}
