import { createHash, createCipheriv, createDecipheriv, randomBytes, randomUUID } from 'node:crypto';
import sharp from 'sharp';

const api = 'https://apis.autobg.ai/public/api/v1/images/';
const maxImage = 15_000_000,
  life = 3600000,
  wait = 120000;
const formats = { jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };
const idPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const unavailable = 'Image processing is unavailable right now. Please try again later.';
const fault = (status, message, extra = {}) => Object.assign(new Error(message), { status, ...extra });

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0,
      finished = false;
    const chunks = [];
    const fail = (error) => {
      if (!finished) {
        finished = true;
        chunks.length = 0;
        reject(error);
      }
    };
    req.on('data', (chunk) => {
      if (finished) return;
      size += chunk.length;
      if (size > maxImage + 65536) fail(fault(413, 'Choose one photo no larger than 15 MB.'));
      else chunks.push(chunk);
    });
    req.once('end', () => {
      if (!finished) {
        finished = true;
        resolve(Buffer.concat(chunks));
      }
    });
    req.once('error', () => fail(fault(400, 'The upload was interrupted.')));
    req.once('aborted', () => fail(fault(400, 'The upload was interrupted.')));
  });
}

async function parseImage(req) {
  const type = req.headers['content-type'] || '';
  if (!type.toLowerCase().startsWith('multipart/form-data;'))
    throw fault(415, 'Please upload a JPG, PNG or WebP photo.');
  if (Number(req.headers['content-length']) > maxImage + 65536)
    throw fault(413, 'Choose one photo no larger than 15 MB.');
  const bytes = await readBody(req);
  let form;
  try {
    form = await new Response(bytes, { headers: { 'content-type': type } }).formData();
  } catch {
    throw fault(400, 'The upload could not be read. Choose the photo again.');
  }
  const image = form.get('image'),
    id = form.get('submissionId');
  if (
    form.getAll('image').length !== 1 ||
    form.getAll('submissionId').length !== 1 ||
    typeof id !== 'string' ||
    !idPattern.test(id) ||
    !image ||
    typeof image === 'string' ||
    [...form].some(([name, value]) => name !== 'image' && typeof value !== 'string')
  )
    throw fault(400, 'Please choose one photo at a time.');
  if (image.size > maxImage) throw fault(413, 'Choose one photo no larger than 15 MB.');
  if (!image.size) throw fault(422, 'This photo is empty. Choose another image.');
  if (!Object.values(formats).includes(image.type)) throw fault(415, 'Choose a JPG, PNG or WebP photo.');
  const data = Buffer.from(await image.arrayBuffer());
  let format;
  try {
    const decoder = sharp(data, { limitInputPixels: 25_000_000, failOn: 'warning' }),
      metadata = await decoder.metadata();
    format = metadata.format;
    if (!formats[format] || formats[format] !== image.type || (metadata.pages || 1) > 1)
      throw new Error('Unsupported format');
    await decoder.resize(1, 1).raw().toBuffer();
  } catch {
    throw fault(
      422,
      'This image could not be read. Choose a valid JPG, PNG or WebP photo up to 25 megapixels.',
    );
  }
  return {
    id,
    data,
    type: formats[format],
    extension: format === 'jpeg' ? 'jpg' : format,
    digest: createHash('sha256').update(data).update(image.type).digest('hex'),
  };
}

export function createDemoHandler({
  env = process.env,
  fetchImpl = fetch,
  now = Date.now,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
} = {}) {
  const key = env.Autobg_API_KEY || '',
    secret = env.DEMO_JOB_SECRET || '';
  const enabled = Boolean(key && !/[\r\n]/.test(key) && secret.length >= 32);
  const encryptionKey = createHash('sha256').update(secret).digest();
  // shortcut: submission deduplication is process-local; use durable shared state before multi-instance scaling.
  const submissions = new Map(),
    jobs = new Map(),
    queue = [],
    calls = [];
  const shutdown = new AbortController();
  let closed = false,
    busy = false,
    pumpTimer = null,
    blockedUntil = 0;
  const timer = (fn, ms) => {
    const handle = setTimer(fn, Math.min(2147483647, Math.max(0, ms)));
    handle?.unref?.();
    return handle;
  };
  const snapshot = (job) => ({
    state: job.state,
    ...(job.state === 'ready' ? { imageUrl: job.imageUrl } : {}),
    ...(job.message ? { message: job.message } : {}),
  });
  const reply = (res, status, body) => {
    if (!res.destroyed)
      res
        .writeHead(status, {
          'content-type': 'application/json; charset=utf-8',
          'cache-control': 'no-store',
          'x-robots-tag': 'noindex',
          'x-content-type-options': 'nosniff',
        })
        .end(JSON.stringify(body));
  };
  function seal(payload) {
    const iv = randomBytes(12),
      cipher = createCipheriv('aes-256-gcm', encryptionKey, iv);
    const data = Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), data]).toString('base64url');
  }
  function open(receipt) {
    let data;
    try {
      if (!/^[a-z0-9_-]{40,1024}$/i.test(receipt)) throw new Error();
      const packed = Buffer.from(receipt, 'base64url');
      if (packed.toString('base64url') !== receipt) throw new Error();
      const decipher = createDecipheriv('aes-256-gcm', encryptionKey, packed.subarray(0, 12));
      decipher.setAuthTag(packed.subarray(12, 28));
      data = JSON.parse(Buffer.concat([decipher.update(packed.subarray(28)), decipher.final()]).toString());
      if (
        !idPattern.test(data.id) ||
        !/^\d{1,30}$/.test(data.batchID) ||
        !Number.isSafeInteger(data.acceptedAt) ||
        data.acceptedAt > now() + 30000 ||
        data.expiresAt !== data.acceptedAt + life
      )
        throw new Error();
    } catch {
      throw fault(404, 'This result link is invalid.');
    }
    if (data.expiresAt <= now()) throw fault(410, 'This result link has expired.');
    return data;
  }
  function publish(job) {
    const body = `data: ${JSON.stringify(snapshot(job))}\n\n`;
    for (const res of job.listeners) {
      if (!res.destroyed) res.write(body);
      if (job.state !== 'processing') res.end();
    }
    if (job.state !== 'processing') {
      clearTimer(job.timer);
      clearTimer(job.deadlineTimer);
      job.timer = null;
    }
  }
  function pause(job) {
    if (job.state === 'processing') {
      job.state = 'paused';
      job.message = 'We haven’t received your result yet. Check this photo again without uploading it.';
      publish(job);
    }
  }
  async function provider(path, body, upload = false) {
    let response;
    try {
      response = await fetchImpl(api + path, {
        method: 'POST',
        headers: { Authorization: key, ...(!upload ? { 'content-type': 'application/json' } : {}) },
        body: upload ? body : JSON.stringify(body),
        redirect: 'error',
        signal: AbortSignal.any([shutdown.signal, AbortSignal.timeout(upload ? 60000 : 10000)]),
      });
    } catch {
      throw fault(503, unavailable, { transient: true });
    }
    if (response.status === 429) {
      const raw = response.headers.get('retry-after'),
        seconds = Number(raw),
        date = Date.parse(raw || '');
      const delay =
        raw && Number.isFinite(seconds) ? seconds * 1000 : Number.isFinite(date) ? date - now() : 10000;
      throw fault(503, 'Processing is busy. We’ll check this photo again.', {
        transient: true,
        retryAfter: Math.max(1000, delay),
      });
    }
    if (!response.ok) throw fault(503, unavailable, { transient: response.status >= 500 });
    let text = '';
    try {
      for await (const chunk of response.body) {
        text += Buffer.from(chunk).toString('utf8');
        if (text.length > 262144) throw new Error();
      }
    } catch {
      throw fault(503, unavailable, { transient: true });
    }
    let payload;
    try {
      payload = JSON.parse(text);
    } catch {
      throw fault(503, unavailable, { transient: true });
    }
    if (!payload || payload.status !== true) throw fault(503, unavailable);
    return payload;
  }
  function resultUrl(value, batchID) {
    try {
      const url = new URL(value);
      if (
        url.protocol !== 'https:' ||
        url.hostname !== 's3.ap-south-1.amazonaws.com' ||
        url.port ||
        url.username ||
        url.password ||
        url.search ||
        url.hash ||
        !new RegExp(`^/autobgv1\\.1/processed/\\d+/${batchID}/[a-z0-9._-]+\\.(?:jpe?g|png|webp)$`, 'i').test(
          url.pathname,
        )
      )
        throw new Error();
      return url.href;
    } catch {
      throw fault(503, 'The finished image could not be verified. Please contact our team.');
    }
  }
  async function retrieve(job) {
    const payload = await provider('downloadImages-v2', { batchID: job.batchID });
    if (
      !Array.isArray(payload.data) ||
      payload.data.length !== 1 ||
      !payload.data[0] ||
      typeof payload.data[0] !== 'object'
    )
      throw fault(503, unavailable, { transient: true });
    const image = payload.data[0];
    if (image.isFailed === true)
      return {
        state: 'failed',
        message: 'This photo could not be processed. Please try another valid vehicle photo.',
      };
    if (image.isProcessed === true && image.isFailed === false)
      return { state: 'ready', imageUrl: resultUrl(image.s3Url, job.batchID) };
    if (image.isProcessed === false && image.isFailed === false)
      return { state: now() >= job.deadline ? 'paused' : 'processing' };
    throw fault(503, unavailable, { transient: true });
  }
  async function pump() {
    if (busy || closed || pumpTimer !== null) return;
    busy = true;
    try {
      while (queue.length && !closed) {
        while (calls.length && calls[0] <= now() - 60000) calls.shift();
        const delay = Math.max(blockedUntil - now(), calls.length >= 90 ? calls[0] + 60001 - now() : 0);
        if (delay > 0) {
          pumpTimer = timer(() => {
            pumpTimer = null;
            void pump();
          }, delay);
          break;
        }
        const entry = queue.shift(),
          { job, manual, resolve } = entry;
        if (job.expiresAt <= now() || (!manual && now() >= job.deadline)) {
          pause(job);
          resolve(snapshot(job));
          continue;
        }
        calls.push(now());
        try {
          const result = await retrieve(job);
          Object.assign(job, result);
          if (!result.message) job.message = '';
          job.failures = 0;
        } catch (error) {
          if (error.retryAfter) blockedUntil = Math.max(blockedUntil, now() + error.retryAfter);
          job.failures++;
          if (!error.transient) {
            job.state = 'failed';
            job.message = error.message || unavailable;
          } else {
            job.message = 'Processing is temporarily delayed. Your photo has not been uploaded again.';
          }
        }
        publish(job);
        resolve(snapshot(job));
      }
    } finally {
      busy = false;
    }
  }
  function check(job, manual = false) {
    if (['ready', 'failed'].includes(job.state)) return Promise.resolve(snapshot(job));
    if (job.checkPromise) return job.checkPromise;
    const promise = new Promise((resolve) => {
      queue.push({ job, manual, resolve });
    });
    job.checkPromise = promise.finally(() => {
      job.checkPromise = null;
    });
    void pump();
    return job.checkPromise;
  }
  async function poll(job) {
    if (closed || job.state !== 'processing') return;
    if (now() >= job.deadline) {
      pause(job);
      return;
    }
    await check(job);
    if (!closed && job.state === 'processing') {
      const delay = job.failures
        ? Math.min(20000, 5000 * 2 ** Math.min(job.failures - 1, 2))
        : now() - job.acceptedAt < 30000
          ? 3000
          : 5000;
      job.timer = timer(
        () => {
          job.timer = null;
          return poll(job);
        },
        Math.min(delay, Math.max(0, job.deadline - now())),
      );
    }
  }
  function makeJob(payload) {
    const job = {
      ...payload,
      deadline: payload.acceptedAt + wait,
      state: now() < payload.acceptedAt + wait ? 'processing' : 'paused',
      listeners: new Set(),
      failures: 0,
      message: '',
    };
    jobs.set(job.id, job);
    if (job.state === 'processing') {
      job.deadlineTimer = timer(() => pause(job), job.deadline - now());
      job.timer = timer(() => {
        job.timer = null;
        return poll(job);
      }, 0);
    }
    return job;
  }
  function sweep() {
    for (const [id, entry] of submissions) if (entry.expiresAt <= now()) submissions.delete(id);
    for (const [id, job] of jobs)
      if (job.expiresAt <= now()) {
        pause(job);
        clearTimer(job.timer);
        clearTimer(job.deadlineTimer);
        for (const res of job.listeners) res.end();
        jobs.delete(id);
      }
  }
  const handler = async (req, res) => {
    try {
      sweep();
      const path = new URL(req.url, 'http://localhost').pathname;
      if (path === '/api/demo/config' && req.method === 'GET') {
        reply(res, 200, { enabled });
        return;
      }
      if (!enabled || closed) {
        reply(res, 503, { message: unavailable });
        return;
      }
      if (path === '/api/demo/jobs' && req.method === 'POST') {
        let origin;
        try {
          origin = new URL(req.headers.origin).host;
        } catch {}
        if (!origin || origin !== req.headers.host) throw fault(403, 'Please upload from this website.');
        const image = await parseImage(req),
          existing = submissions.get(image.id);
        if (existing) {
          if (existing.digest !== image.digest)
            throw fault(409, 'This upload reference belongs to a different photo.');
          const result = await existing.promise;
          reply(res, result.status, result.body);
          return;
        }
        const send = async () => {
          try {
            const form = new FormData();
            form.set(
              'cc',
              new Blob([image.data], { type: image.type }),
              randomUUID() + '.' + image.extension,
            );
            form.set('numberPlate', 'DEMO' + randomUUID().replaceAll('-', ''));
            form.set('templateCC', '129492');
            form.set('processType', 'ai');
            const payload = await provider('uploadWithTemplateCC', form, true),
              batchID = String(payload.data?.batchID ?? '');
            if (!/^\d{1,30}$/.test(batchID)) throw new Error();
            const acceptedAt = now(),
              record = { id: image.id, batchID, acceptedAt, expiresAt: acceptedAt + life };
            makeJob(record);
            return { status: 202, body: { receipt: seal(record), acceptedAt, expiresAt: record.expiresAt } };
          } catch {
            return {
              status: 503,
              body: {
                message:
                  'We could not confirm the upload. It may already be processing; do not upload this photo again immediately. Contact our team if this continues.',
              },
            };
          }
        };
        const promise = send();
        submissions.set(image.id, { digest: image.digest, promise, expiresAt: now() + life });
        const result = await promise;
        reply(res, result.status, result.body);
        return;
      }
      const match = path.match(/^\/api\/demo\/jobs\/([a-z0-9_-]+)(\/events)?$/i);
      if (match && req.method === 'GET') {
        const payload = open(match[1]);
        let job = jobs.get(payload.id);
        if (!job) job = makeJob(payload);
        if (!match[2]) {
          const result = job.state === 'paused' ? await check(job, true) : snapshot(job);
          reply(res, 200, result);
          return;
        }
        res.writeHead(200, {
          'content-type': 'text/event-stream; charset=utf-8',
          'cache-control': 'no-store',
          'x-robots-tag': 'noindex',
          'x-accel-buffering': 'no',
          'referrer-policy': 'no-referrer',
        });
        let heartbeat;
        res.once('close', () => {
          clearTimer(heartbeat);
          job.listeners.delete(res);
        });
        res.flushHeaders();
        job.listeners.add(res);
        res.write(`retry: 3000\ndata: ${JSON.stringify(snapshot(job))}\n\n`);
        if (job.state !== 'processing') {
          res.end();
          return;
        }
        const beat = () => {
          if (!res.destroyed) {
            res.write(': keep-alive\n\n');
            heartbeat = timer(beat, 15000);
          }
        };
        heartbeat = timer(beat, 15000);
        return;
      }
      reply(res, req.method === 'GET' ? 404 : 405, { message: 'This demo request is not supported.' });
    } catch (error) {
      reply(res, error.status || 503, { message: error.status ? error.message : unavailable });
    }
  };
  handler.close = () => {
    closed = true;
    shutdown.abort();
    clearTimer(pumpTimer);
    for (const job of jobs.values()) {
      clearTimer(job.timer);
      clearTimer(job.deadlineTimer);
      for (const res of job.listeners) res.end();
    }
    for (const entry of queue) entry.resolve(snapshot(entry.job));
    queue.length = 0;
  };
  return handler;
}
