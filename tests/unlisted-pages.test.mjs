import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { get } from 'node:http';
import test from 'node:test';

const robots = 'noindex, nofollow, noimageindex';

test('restored galleries and inventory retain their complete source sets', async () => {
  const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
  const catalog = JSON.parse(await read('src/data/client-showrooms.json'));
  const pairs = JSON.parse(await read('src/data/client-comparison.json'));
  const vehicles = JSON.parse(await read('src/data/inventory.json'));
  const showrooms = await read('dist/SeeAll/index.html');
  const comparison = await read('dist/ViewAll/index.html');
  const inventory = await read('dist/vlp/index.html');
  assert.ok(inventory.includes('rel="canonical" href="https://www.autopixelai.com/vlp"'));
  assert.equal(catalog.slides.length, 388);
  assert.equal(pairs.length, 36);
  assert.equal(vehicles.length, 10);
  assert.equal(vehicles.flatMap((vehicle) => vehicle.photos).length, 349);
  for (const slide of catalog.slides) {
    assert.ok(showrooms.includes(`>${slide.label}</h2>`));
    for (const path of [slide.image, slide.thumbnail]) {
      assert.ok(showrooms.includes(path));
      await access(new URL(`../dist${path}`, import.meta.url));
    }
  }
  for (const { id } of pairs) {
    for (const side of ['before', 'after']) {
      const path = `/assets/client-comparison/${side}-${id}.webp`;
      assert.ok(comparison.includes(path));
      await access(new URL(`../dist${path}`, import.meta.url));
    }
  }
  for (const vehicle of vehicles) {
    const path = `/vlp/${vehicle.id}/`;
    assert.ok(inventory.includes(`href="${path}"`));
    const detail = await read(`dist${path}index.html`);
    assert.ok(detail.includes(`rel="canonical" href="https://www.autopixelai.com${path}"`));
    assert.ok(detail.includes('href="/vlp">All inventory'));
    assert.ok(detail.includes(`${vehicle.year} ${vehicle.make} ${vehicle.model}`));
    for (const photo of vehicle.photos) assert.ok(detail.includes(`href="${photo}"`));
    assert.match(detail, /<meta name="robots" content="noindex, nofollow, noimageindex"/);
  }
  const sitemap = await read('dist/sitemap.xml');
  assert.doesNotMatch(sitemap, /seeall|viewall|inventory|vlp/i);
  for (const html of [showrooms, comparison, inventory]) {
    assert.match(html, /<meta name="robots" content="noindex, nofollow, noimageindex"/);
  }
});

test('production routes, aliases and image responses keep noindex', async (t) => {
  const child = spawn(process.execPath, ['server/index.mjs'], {
    env: { ...process.env, PORT: '0', NOINDEX: '', Autobg_API_KEY: '', DEMO_JOB_SECRET: '',
      GOOGLE_SMTP_USER: '', GOOGLE_SMTP_APP_PASSWORD: '', TURNSTILE_SITE_KEY: '', TURNSTILE_SECRET_KEY: '' },
    windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(() => child.kill());
  const base = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(Error('Production server did not start')), 8000);
    child.once('error', reject);
    child.once('exit', (code) => { clearTimeout(timeout); reject(Error(`Server exited with ${code}`)); });
    child.stdout.on('data', (data) => {
      const port = String(data).match(/listening on port (\d+)/)?.[1];
      if (port) { clearTimeout(timeout); resolve(`http://127.0.0.1:${port}`); }
    });
  });
  for (const path of ['/SeeAll', '/ViewAll', '/vlp', '/vlp/vehicle-01/']) {
    const response = await fetch(base + path);
    assert.equal(response.status, 200, path);
    assert.equal(response.headers.get('x-robots-tag'), robots);
  }
  for (const [alias, canonical] of [
    ['/seeall', '/SeeAll'], ['/SeeAll/', '/SeeAll'], ['/SeeAll.html', '/SeeAll'],
    ['/viewall', '/ViewAll'], ['/ViewAll/', '/ViewAll'], ['/ViewAll.html', '/ViewAll'],
    ['/VLP', '/vlp'], ['/vLp/', '/vlp'], ['/vlp/', '/vlp'],
    ['/inventory', '/vlp'], ['/inventory/', '/vlp'],
    ['/VLP/Vehicle-01', '/vlp/vehicle-01/'], ['/inventory/vehicle-01/', '/vlp/vehicle-01/'],
  ]) {
    const response = await fetch(base + alias + '?ref=client', { redirect: 'manual' });
    assert.equal(response.status, 301);
    assert.equal(response.headers.get('location'), canonical + '?ref=client');
    assert.equal(response.headers.get('x-robots-tag'), robots);
  }
  const photo = await fetch(base + '/assets/client-showrooms/theme-001.webp');
  assert.equal(photo.status, 200);
  assert.equal(photo.headers.get('x-robots-tag'), robots);
  for (const path of ['/SeeAll', '/ViewAll', '/VLP', '/vlp/vehicle-02/',
    '/assets/client-showrooms/theme-001.webp', '/assets/client-comparison/before-1.webp']) {
    const head = await fetch(base + path, { method: 'HEAD' });
    assert.equal(head.status, 200);
    assert.equal(head.headers.get('x-robots-tag'), robots);
  }
  const cached = await new Promise((resolve, reject) => {
    get(base + '/assets/client-showrooms/theme-001.webp', {
      headers: { 'If-None-Match': photo.headers.get('etag') },
    }, (response) => { response.resume(); resolve(response); }).on('error', reject);
  });
  assert.equal(cached.statusCode, 304);
  assert.equal(cached.headers['x-robots-tag'], robots);
  assert.equal((await fetch(base + '/vlp/vehicle-99/')).status, 404);
  assert.equal((await fetch(base + '/')).headers.get('x-robots-tag'), null);
});
