import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { createLeadRoutes } from '../server/leads.mjs';

test('lead delivery requires consent and a matching Turnstile result, and deduplicates retries', async () => {
  let verified = 0;
  const sent = [];
  const routes = createLeadRoutes({
    env: {
      GOOGLE_SMTP_USER: 'sender@example.com', GOOGLE_SMTP_APP_PASSWORD: 'test-only',
      TURNSTILE_SITE_KEY: 'test-site', TURNSTILE_SECRET_KEY: 'test-secret',
    },
    verify: async (_url, request) => {
      verified++;
      const { response } = JSON.parse(request.body);
      return { ok: true, json: async () => ({ success: true, hostname: response, action: 'lead' }) };
    },
    deliver: async (message) => {
      sent.push(message);
      return { accepted: [message.to] };
    },
  });
  const data = {
    firstName: 'Sample', lastName: 'Dealer', email: 'buyer@example.com', company: 'Sample Motors',
    companyType: 'Dealer group', consent: true, sourcePage: '/BlackFriday', requestType: 'black-friday',
    leadId: randomUUID(), turnstileToken: 'example.com',
  };
  function submit(body, origin = 'https://example.com') {
    return routes.submit({
      body, hostname: 'example.com', get: (header) => header === 'origin' ? origin : 'example.com',
      is: () => 'application/json',
    }, {
      status(code) { return { json: (value) => ({ code, value }) }; },
    });
  }

  assert.equal((await submit({ ...data, consent: false })).code, 400);
  assert.equal((await submit(data, 'https://unrelated.example')).code, 403);
  assert.equal((await submit({ ...data, turnstileToken: 'wrong.example' })).code, 400);
  assert.equal(sent.length, 0);
  assert.equal(verified, 1);

  const results = await Promise.all([submit(data), submit(data)]);
  assert.deepEqual(results.map(({ code, value }) => [code, value.reference]), [[202, data.leadId], [202, data.leadId]]);
  assert.equal(verified, 2);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, 'team@autopixelai.com');
  assert.match(sent[0].text, /Offer request recorded at \(UTC\)/);
  assert.equal((await submit({ ...data, company: 'Changed company' })).code, 409);

  const off = createLeadRoutes({ env: {} });
  let config;
  off.config({}, { json: (value) => { config = value; } });
  assert.deepEqual(config, { enabled: false, turnstileSiteKey: '' });
});
