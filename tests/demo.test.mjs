import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { setImmediate as tick } from 'node:timers/promises';
import { createDemoHandler } from '../server/demo.mjs';

const env = {
  Autobg_API_KEY: 'private-test-key',
  DEMO_JOB_SECRET: 'private-test-receipt-secret-32-characters',
};
const photo = await readFile('public/media/original-front-small.webp');
const imageUrl = 'https://s3.ap-south-1.amazonaws.com/autobgv1.1/processed/100/12345/result.jpg';
const pending = {
  status: true,
  message: '',
  data: [
    {
      picID: null,
      picName: 'photo.webp',
      s3Url: null,
      isProcessed: false,
      isFailed: false,
      picStatus: 'PENDING',
    },
  ],
};
const ready = {
  status: true,
  message: '',
  data: [{ picID: 42, picName: 'photo.webp', s3Url: imageUrl, isProcessed: true, isFailed: false }],
};

function clock() {
  let time = 1700000000000,
    id = 0;
  const timers = new Map();
  return {
    now: () => time,
    setTimer: (fn, delay) => {
      const key = ++id;
      timers.set(key, { fn, at: time + delay });
      return key;
    },
    clearTimer: (key) => timers.delete(key),
    async advance(ms) {
      const target = time + ms;
      for (let count = 0; count < 1000; count++) {
        await tick();
        const next = [...timers]
          .filter(([, timer]) => timer.at <= target)
          .sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) {
          time = target;
          await tick();
          return;
        }
        time = next[1].at;
        timers.delete(next[0]);
        void next[1].fn();
        await tick();
        await tick();
      }
      throw new Error('Timer loop did not settle');
    },
  };
}
async function fixture(t, options = {}) {
  const timers = clock(),
    calls = [],
    responses = options.responses || [pending, ready];
  const handler = createDemoHandler({
    ...timers,
    env,
    ...options,
    fetchImpl:
      options.fetchImpl ||
      (async (url, request) => {
        calls.push({ url, request });
        if (url.endsWith('/uploadWithTemplateCC'))
          return Response.json({
            status: true,
            message: '',
            data: {
              batchID: String(
                12345 + calls.filter((c) => c.url.endsWith('/uploadWithTemplateCC')).length - 1,
              ),
            },
          });
        assert.ok(url.endsWith('/downloadImages-v2'));
        const response = responses.length > 1 ? responses.shift() : responses[0];
        return response instanceof Response ? response : Response.json(response);
      }),
  });
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => {
    handler.close();
    server.closeAllConnections();
    server.close();
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  function form(id = randomUUID(), bytes = photo, type = 'image/webp') {
    const body = new FormData();
    body.set('submissionId', id);
    body.set('image', new Blob([bytes], { type }), 'photo.webp');
    return body;
  }
  const upload = (body = form(), headers = {}) =>
    fetch(base + '/api/demo/jobs', { method: 'POST', body, headers: { origin: base, ...headers } });
  const state = async (receipt) => {
    const response = await fetch(base + '/api/demo/jobs/' + receipt);
    return { status: response.status, ...(await response.json()) };
  };
  return { base, timers, calls, handler, form, upload, state };
}

test('unconfigured demo fails closed without exposing private configuration', async (t) => {
  const f = await fixture(t, { env: {} });
  assert.deepEqual(await (await fetch(f.base + '/api/demo/config')).json(), { enabled: false });
  assert.equal((await f.upload()).status, 503);
  assert.equal(f.calls.length, 0);
});
test('one upload fixes AI/default template privately and returns an opaque accepted receipt', async (t) => {
  const f = await fixture(t),
    form = f.form();
  form.set('templateCC', '999');
  form.set('processType', 'collab');
  const response = await f.upload(form);
  assert.equal(response.status, 202);
  const body = await response.json();
  assert.ok(body.receipt);
  assert.ok(body.acceptedAt);
  assert.ok(body.expiresAt);
  assert.doesNotMatch(JSON.stringify(body), /private-test|12345|autobg|Authorization/);
  const upload = f.calls[0].request;
  assert.equal(upload.headers.Authorization, env.Autobg_API_KEY);
  assert.equal(upload.redirect, 'error');
  assert.equal(upload.body.get('templateCC'), '129492');
  assert.equal(upload.body.get('processType'), 'ai');
  assert.match(upload.body.get('cc').name, /^[a-f0-9-]+\.webp$/);
  await f.timers.advance(0);
  assert.equal((await f.state(body.receipt)).state, 'processing');
  await f.timers.advance(3000);
  assert.equal((await f.state(body.receipt)).imageUrl, imageUrl);
  const count = f.calls.length;
  await f.timers.advance(30000);
  assert.equal(f.calls.length, count);
});
test('concurrent identical submissions reuse one upload; changed input conflicts', async (t) => {
  const f = await fixture(t),
    id = randomUUID();
  const responses = await Promise.all([f.upload(f.form(id)), f.upload(f.form(id))]);
  assert.ok(responses.every((r) => r.status === 202));
  const bodies = await Promise.all(responses.map((r) => r.json()));
  assert.equal(bodies[0].receipt, bodies[1].receipt);
  assert.equal(f.calls.filter((c) => c.url.endsWith('/uploadWithTemplateCC')).length, 1);
  const other = await readFile('public/media/original-side-small.webp');
  assert.equal((await f.upload(f.form(id, other))).status, 409);
});
test('unsupported, corrupt, empty, multiple and oversized images never reach provider', async (t) => {
  const f = await fixture(t);
  for (const [bytes, type] of [
    [Buffer.from('<svg/>'), 'image/svg+xml'],
    [Buffer.from('not an image'), 'image/webp'],
    [Buffer.alloc(0), 'image/webp'],
    [photo.subarray(0, 40), 'image/webp'],
    [Buffer.alloc(15_000_001), 'image/webp'],
  ]) {
    assert.ok([413, 415, 422].includes((await f.upload(f.form(randomUUID(), bytes, type))).status));
  }
  const multiple = f.form();
  multiple.append('image', new Blob([photo], { type: 'image/webp' }), 'second.webp');
  assert.equal((await f.upload(multiple)).status, 400);
  assert.equal(f.calls.length, 0);
});
test('missing origin and cross-origin upload are rejected', async (t) => {
  const f = await fixture(t);
  assert.equal((await f.upload(f.form(), { origin: 'https://evil.example' })).status, 403);
  assert.equal((await fetch(f.base + '/api/demo/jobs', { method: 'POST', body: f.form() })).status, 403);
  assert.equal(f.calls.length, 0);
});
test('expired and forged receipts cannot query provider', async (t) => {
  const f = await fixture(t),
    accepted = await (await f.upload()).json();
  assert.equal((await f.state(accepted.receipt + 'x')).status, 404);
  const calls = f.calls.length;
  await f.timers.advance(3600001);
  assert.equal((await f.state(accepted.receipt)).status, 410);
  const after = f.calls.length;
  assert.ok(after >= calls);
  await f.state('not-a-receipt');
  assert.equal(f.calls.length, after);
});
test('per-image failure is terminal even when overall status is true', async (t) => {
  const failed = {
    status: true,
    message: '',
    data: [
      {
        picID: 1,
        picName: 'x.webp',
        s3Url: null,
        isProcessed: false,
        isFailed: true,
        picStatus: 'FAILED',
        errorMessage: 'private-test-key internal error',
      },
    ],
  };
  const f = await fixture(t, { responses: [failed] }),
    accepted = await (await f.upload()).json();
  await f.timers.advance(0);
  const result = await f.state(accepted.receipt);
  assert.equal(result.state, 'failed');
  assert.doesNotMatch(JSON.stringify(result), /private-test-key|internal error/);
  const count = f.calls.length;
  await f.timers.advance(30000);
  assert.equal(f.calls.length, count);
});
test('unsafe result URL is never sent to the browser', async (t) => {
  for (const url of [
    'https://evil.example/result.jpg',
    'http://s3.ap-south-1.amazonaws.com/x',
    'https://s3.ap-south-1.amazonaws.com/autobgv1.1/original/x.jpg',
    'https://user:pass@s3.ap-south-1.amazonaws.com/autobgv1.1/processed/x.jpg',
  ]) {
    const f = await fixture(t, { responses: [{ ...ready, data: [{ ...ready.data[0], s3Url: url }] }] }),
      accepted = await (await f.upload()).json();
    await f.timers.advance(0);
    const result = await f.state(accepted.receipt);
    assert.equal(result.state, 'failed');
    assert.equal(result.imageUrl, undefined);
  }
});
test('waiting deadline pauses, manual recovery retrieves same batch without re-upload', async (t) => {
  const f = await fixture(t, { responses: [pending] }),
    accepted = await (await f.upload()).json();
  await f.timers.advance(120001);
  const count = f.calls.length;
  await f.timers.advance(10000);
  assert.equal(f.calls.length, count);
  assert.equal((await f.state(accepted.receipt)).state, 'paused');
  assert.equal(f.calls.filter((c) => c.url.endsWith('/uploadWithTemplateCC')).length, 1);
});
test('HTTP-200 business failure is not reported as a successful image', async (t) => {
  const f = await fixture(t, {
      responses: [{ status: false, message: 'Authentication Error: Batch Not Found', data: [] }],
    }),
    accepted = await (await f.upload()).json();
  await f.timers.advance(0);
  const result = await f.state(accepted.receipt);
  assert.equal(result.state, 'failed');
  assert.equal(result.imageUrl, undefined);
});
test('an uncertain upload timeout is not automatically re-uploaded on replay', async (t) => {
  let uploads = 0;
  const f = await fixture(t, {
      fetchImpl: async () => {
        uploads++;
        throw new Error('private-test-key timeout');
      },
    }),
    id = randomUUID();
  for (let i = 0; i < 2; i++) {
    const result = await f.upload(f.form(id));
    assert.equal(result.status, 503);
    assert.doesNotMatch(await result.text(), /private-test-key/);
  }
  assert.equal(uploads, 1);
});
test('SSE replays completed result and closes without another provider call', async (t) => {
  const f = await fixture(t, { responses: [ready] }),
    accepted = await (await f.upload()).json();
  await f.timers.advance(0);
  const count = f.calls.length,
    response = await fetch(f.base + '/api/demo/jobs/' + accepted.receipt + '/events');
  assert.match(response.headers.get('content-type'), /text\/event-stream/);
  assert.match(await response.text(), /"state":"ready"/);
  assert.equal(f.calls.length, count);
});
test('poll intervals back off after thirty seconds and active status reads do not duplicate checks', async (t) => {
  const f = await fixture(t, { responses: [pending] }),
    accepted = await (await f.upload()).json();
  await f.timers.advance(0);
  let count = f.calls.length;
  await Promise.all([f.state(accepted.receipt), f.state(accepted.receipt)]);
  assert.equal(f.calls.length, count);
  await f.timers.advance(2999);
  assert.equal(f.calls.length, count);
  await f.timers.advance(1);
  assert.equal(f.calls.length, count + 1);
  await f.timers.advance(27000);
  count = f.calls.length;
  await f.timers.advance(4999);
  assert.equal(f.calls.length, count);
  await f.timers.advance(1);
  assert.equal(f.calls.length, count + 1);
});
test('429 respects Retry-After before retrieving an accepted result', async (t) => {
  const f = await fixture(t, {
      responses: [new Response('{}', { status: 429, headers: { 'retry-after': '10' } }), ready],
    }),
    accepted = await (await f.upload()).json();
  await f.timers.advance(0);
  const count = f.calls.length;
  await f.timers.advance(9999);
  assert.equal(f.calls.length, count);
  await f.timers.advance(1);
  assert.equal((await f.state(accepted.receipt)).state, 'ready');
});
test('a long provider cooldown is respected even after the automatic waiting deadline', async (t) => {
  const f = await fixture(t, {
    responses: [new Response('{}', { status: 429, headers: { 'retry-after': '180' } }), pending],
  });
  await f.upload();
  await f.timers.advance(0);
  await f.timers.advance(120001);
  await f.upload();
  await f.timers.advance(0);
  const results = () => f.calls.filter((c) => c.url.endsWith('/downloadImages-v2')).length;
  assert.equal(results(), 1);
  await f.timers.advance(59998);
  assert.equal(results(), 1);
  await f.timers.advance(1);
  assert.ok(results() > 1);
});
test('accepted receipt survives handler restart without another image upload', async (t) => {
  const first = await fixture(t, { responses: [pending] }),
    accepted = await (await first.upload()).json();
  first.handler.close();
  const second = await fixture(t, { responses: [ready] });
  assert.equal((await second.state(accepted.receipt)).state, 'processing');
  await second.timers.advance(0);
  assert.equal((await second.state(accepted.receipt)).state, 'ready');
  assert.ok(second.calls.every((c) => c.url.endsWith('/downloadImages-v2')));
});
test('shared result scheduler stays under ninety requests in a rolling minute', async (t) => {
  const f = await fixture(t, { responses: [pending] });
  await Promise.all(Array.from({ length: 91 }, () => f.upload()));
  await f.timers.advance(0);
  const results = () => f.calls.filter((c) => c.url.endsWith('/downloadImages-v2')).length;
  assert.equal(results(), 90);
  await f.timers.advance(59999);
  assert.equal(results(), 90);
  await f.timers.advance(2);
  assert.ok(results() > 90);
});
