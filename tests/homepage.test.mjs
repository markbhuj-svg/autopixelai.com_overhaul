import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import test from 'node:test';

test('the homepage renders its visualizer, booking path, and local media', async () => {
  const home = await readFile(new URL('../dist/index.html', import.meta.url), 'utf8');

  const heroTitle = home.match(/<h1[^>]*id="hero-title"[^>]*>(.*?)<\/h1>/s)?.[1] ?? '';
  assert.match(heroTitle, /AI Car Photography For Dealerships\./);
  const headlines = heroTitle.split(/<span\b[^>]*\bdata-hero-phrase(?=[\s=>])[^>]*>/).slice(1)
    .map((phrase) => phrase.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim());
  assert.deepEqual(headlines, [
    'AI Car Photography For Dealerships.',
    'Turn Lot Photos Into Studio-Quality Images.',
    'Every Vehicle Deserves A Showroom-Quality Impression.',
    'From Camera To Customer-Ready. Faster Than Ever.',
    'Better Vehicle Photos. Straight To Your Website.',
  ]);
  assert.doesNotMatch(home, /Concept imagery|<button\b[^>]*>\s*Pause/i);
  assert.match(home, /\/media\/showroom-hero\.webp/);
  assert.equal([...home.matchAll(/src="\/media\/autopixelai-logo\.webp"/g)].length, 3);
  assert.match(home, /id="visualizer-title"[^>]*>Showroom Visualizer\./);
  assert.doesNotMatch(home, /Try the photo transform\./);
  assert.match(home, /href="\/book-a-demo\//);
  const footer = home.match(/<footer\b[^>]*>(.*?)<\/footer>/s)?.[1] ?? '';
  assert.match(footer, /href="mailto:team@autopixelai\.com"/);
  assert.match(footer, /href="tel:\+14372373275"/);

  const strip = home.slice(home.indexOf('class="brand-strip"'), home.indexOf('id="visualizer"'));
  const logoRows = [...strip.matchAll(/<ul\b([^>]*)>(.*?)<\/ul>/gs)]
    .filter(([, attributes]) => !attributes.includes('aria-hidden'))
    .map(([, , list]) => [...list.matchAll(/<img[^>]*alt="([^"]+)"/g)].map(([, name]) => name));
  assert.deepEqual(logoRows.map((row) => row.length), [9, 46]);
  assert.deepEqual(logoRows[0].slice(1, 3), ['TRADER', 'AutoTrader.ca']);

  const workflow = home.match(/<section id="workflow"[^>]*>(.*?)<\/section>/s)?.[1] ?? '';
  const workflowFrames = [...workflow.matchAll(/src="\/media\/photo-app\/([\w-]+)\.webp"/g)].map(([, frame]) => frame);
  assert.deepEqual(workflowFrames, ['scan-vin', 'select-theme', 'capture-front', 'delivered-photos']);
  assert.match(workflow, /href="\/photo-app\//);
  assert.match(workflow, /Four Steps\./);
  assert.ok(home.indexOf('id="hero-title"') < home.indexOf('id="visualizer"'));
  assert.ok(home.indexOf('id="visualizer"') < home.indexOf('id="inventory-preview-title"'));
  assert.ok(home.indexOf('id="inventory-preview-title"') < home.indexOf('id="workflow"'));
  assert.ok(home.indexOf('id="workflow"') < home.indexOf('id="showrooms"'));
  const marquee = home.match(/<section id="showrooms"[^>]*>(.*?)<\/section>/s)?.[1] ?? '';
  assert.match(marquee, /href="\/virtual-showrooms\/#showroom-grid"/);
  assert.equal([...marquee.matchAll(/<img\b/g)].length, 120);

  const fragments = [...home.matchAll(/href="#([\w-]+)"/g)];
  for (const [, fragment] of fragments) {
    assert.ok(home.includes(`id="${fragment}"`), `Missing destination for #${fragment}`);
  }

  const sources = [...home.matchAll(/(?:src|srcset)="(\/(?:media|_astro)\/[^" ]+)"/g)];
  assert.ok(sources.length >= 5, 'Expected local hero and product images');
  for (const [, source] of sources) {
    await access(new URL(`../dist${source}`, import.meta.url));
  }
});

test('the public showroom library uses the numbered SeeAll examples', async () => {
  const catalog = JSON.parse(await readFile(new URL('../src/data/client-showrooms.json', import.meta.url), 'utf8'));
  const page = await readFile(new URL('../dist/virtual-showrooms/index.html', import.meta.url), 'utf8');
  const grid = page.match(/<section id="showroom-grid"[^>]*>(.*?)<\/section>/s)?.[1] ?? '';
  const labels = [...grid.matchAll(/<h3[^>]*>(Theme \d+)<\/h3>/g)].map(([, label]) => label);
  assert.deepEqual(labels, catalog.slides.slice(0, 120).map(({ label }) => label));
  assert.doesNotMatch(grid, /gallery-filters|data-category|Daylight gallery/);
  assert.match(grid, /400\+ showroom themes/);
  assert.match(grid, /href="\/book-a-demo\/\?request=custom-background"/);
});

test('the visualizer serves ten ordered processed views for all vehicle and background combinations', async () => {
  const home = await readFile(new URL('../dist/index.html', import.meta.url), 'utf8');
  const encoded = home.match(/data-visualizer="([^"]+)"/)?.[1];
  assert.ok(encoded);
  const { gallery, rooms, angles } = JSON.parse(encoded.replaceAll('&quot;', '"'));
  assert.deepEqual(gallery.map(({ name }) => name), ['BMW 5 Series', 'Chevrolet Tahoe', 'Ford F-150']);
  assert.equal(rooms.length, 3);
  assert.deepEqual(angles.map(({ file }) => file), [8, 7, 6, 5, 4, 3, 1, 2, 15, 10]);
  for (const { sets } of gallery) assert.deepEqual(sets.map((set) => set.length), [10, 10, 10]);
  for (const { sets } of gallery) assert.ok(sets.flat().every(Boolean));
  const photos = gallery.flatMap(({ sets }) => sets.flat()).filter(Boolean);
  for (const { src, thumb } of [...rooms, ...photos]) {
    await access(new URL(`../dist${src}`, import.meta.url));
    await access(new URL(`../dist${thumb}`, import.meta.url));
  }
  const first = gallery[0].sets[0][0];
  const original = await readFile(new URL('../src/assets/visualizer/bmw-5/1/8.jpg', import.meta.url));
  assert.deepEqual(await readFile(new URL(`../dist${first.src}`, import.meta.url)), original);
  assert.match(home, /data-placeholder[^>]*>Processed photo coming soon/);
  assert.match(home, /<figcaption class="visually-hidden"[^>]*data-caption/);
  assert.match(home, /<legend class="visually-hidden"[^>]*>View<\/legend>/);
  assert.match(home, /href="#image-demo"[^>]*>Try it on your own inventory/);
  assert.match(home.slice(home.indexOf('id="image-demo"')), /<input[^>]*type="file"/);
});

test('every launch route is built, linked, and included in the sitemap', async () => {
  const routes = [
    '/', '/photo-app/', '/virtual-showrooms/',
    '/try-it/', '/integrations/', '/book-a-demo/', '/BlackFriday',
  ];
  const origin = 'https://autopixelai.com';
  const pages = new Map();
  for (const route of routes) {
    const folder = route.endsWith('/') ? route : `${route}/`;
    const page = await readFile(new URL(`../dist${folder}index.html`, import.meta.url), 'utf8');
    assert.ok(page.includes(`rel="canonical" href="${origin}${route}"`), route);
    assert.equal([...page.matchAll(/<h1(?:\s|>)/g)].length, 1, route);
    pages.set(route, page);
  }

  const home = pages.get('/');
  const sitemap = await readFile(new URL('../dist/sitemap.xml', import.meta.url), 'utf8');
  const oldPartners = await readFile(new URL('../dist/partners/index.html', import.meta.url), 'utf8');
  assert.match(oldPartners, /http-equiv=["']refresh["']/i);
  assert.match(oldPartners, /\/integrations\/#partners/);
  assert.ok(!sitemap.includes(`<loc>${origin}/partners/</loc>`));
  for (const route of routes) {
    assert.ok(home.includes(`href="${route}"`), `Homepage links to ${route}`);
    assert.ok(sitemap.includes(`<loc>${origin}${route}</loc>`), `Sitemap includes ${route}`);
  }
  const logos = pages.get('/integrations/').match(/<ul class="partner-logos"[^>]*>(.*?)<\/ul>/s)?.[1] ?? '';
  const marks = [...logos.matchAll(/<img[^>]*src="([^"]+)"[^>]*alt="([^"]+)"/g)];
  assert.deepEqual(marks.map(([, , name]) => name), ['DealerOn', 'TRADER', 'AutoTrader.ca', 'HomeNet', '360.Agency', 'D2C Media', 'vAuto', 'AutoVision', 'CarGurus']);
  for (const [, source] of marks) assert.ok(home.includes(`src="${source}"`), `Partner logo is reused from the homepage: ${source}`);
  for (const [route, page] of pages) {
    for (const [, href] of page.matchAll(/href="([/#][^"]*)"/g)) {
      const url = new URL(href.replaceAll('&amp;', '&'), origin + route);
      const target = pages.get(url.pathname) ?? pages.get(url.pathname.replace(/\/$/, ''));
      if (target) {
        if (url.hash) assert.ok(target.includes(`id="${url.hash.slice(1)}"`), `${route} links to ${href}`);
      } else {
        await access(new URL(`../dist${url.pathname}`, import.meta.url));
      }
    }
  }

  assert.ok(home.includes('href="/BlackFriday#offer-form"'));
  assert.match(home, /<dialog[^>]*id="black-friday-offer"/);
  assert.match(home, /<link rel="icon"[^>]*href="\/favicon\.png"/);
  const campaign = pages.get('/BlackFriday');
  const nav = campaign.split('aria-label="Main navigation"')[1].split('</nav>')[0];
  assert.match(nav, /href="\/try-it\/"[^>]*>Try a Photo<\/a>\s*<a class="header-offer" href="\/BlackFriday" aria-current="page"/);
  assert.match(campaign, /<a class="header-offer mobile-offer" href="\/BlackFriday" aria-current="page"/);
  assert.match(campaign, /<form[^>]*id="black-friday-form"[^>]*action="\/api\/leads"/);
  assert.match(campaign, /name="consent" required/);
  assert.match(campaign, /Get the Black Friday Deal/);
  assert.match(campaign, /<dialog[^>]*id="lead-confirmation"[^>]*aria-labelledby="lead-confirmation-title"/);
  assert.match(campaign, /Black Friday\s*<strong[^>]*>request received\./);
  assert.match(campaign, /Book My Offer Call/);
  assert.match(campaign, /data-comparison-pairs=/);
});

test('both vehicle uploaders and the demo enquiry have on-page controls', async () => {
  const read = (slug) => readFile(new URL('../dist/' + slug + '/index.html', import.meta.url), 'utf8');
  const photo = await read('try-it');
  const home = await readFile(new URL('../dist/index.html', import.meta.url), 'utf8');
  const demo = await read('book-a-demo');
  for (const page of [home, photo]) {
    assert.match(page, /<input[^>]*type="file"[^>]*accept="image\/jpeg,image\/png,image\/webp"/);
    assert.match(page, /id="photo-preview"/);
    assert.match(page, /id="upload-title" class="visually-hidden"/);
    assert.match(page, /<progress[^>]*aria-label="Photo processing"/);
    assert.match(page, /<button[^>]*aria-label="Compare before and after"[^>]*aria-haspopup="dialog"/);
    assert.match(page, /aria-controls="vehicle-photo-comparison" hidden[^>]*>Compare\b/);
    assert.match(page, /<dialog[^>]*id="vehicle-photo-comparison"[^>]*aria-labelledby="photo-comparison-title"/);
    assert.doesNotMatch(page, /data-photo-view|data-process-label|id="photo-filename"|>Remove photo<|>Try another photo<|Photo preview ready\./);
  }
  assert.match(demo, /<form[^>]*id="demo-form"/);
  assert.match(demo, /id="demo-email"[^>]*type="email"[^>]*required/);
  assert.match(demo, /Request My Inventory Demo/);
  assert.match(demo, /<dialog[^>]*id="lead-confirmation"[^>]*aria-labelledby="lead-confirmation-title"/);
  assert.match(demo, /Inventory demo\s*<strong[^>]*>requested\./);
  assert.match(demo, /data-lead-reference/);
  assert.doesNotMatch(photo, /https:\/\/www\.autopixelai\.com\/try-it\//);
  assert.doesNotMatch(demo, /https:\/\/www\.autopixelai\.com\/book-a-demo\//);
});

test('the automatic comparison pairs each lot photo with three processed front-left views', async () => {
  const page = await readFile(new URL('../dist/try-it/index.html', import.meta.url), 'utf8');
  const encoded = page.match(/data-comparison-pairs="([^"]+)"/)?.[1];
  assert.ok(encoded);
  const demo = await readFile(new URL('../dist/book-a-demo/index.html', import.meta.url), 'utf8');
  assert.equal(demo.match(/data-comparison-pairs="([^"]+)"/)?.[1], encoded);
  const pairs = JSON.parse(encoded.replaceAll('&quot;', '"'));
  const vehicles = ['bmw-5', 'chevrolet-tahoe', 'ford-f-150'];
  const settings = ['warm studio', 'turntable studio', 'dealership exterior'];
  assert.deepEqual(pairs.map(({ before, setting }) => [before, setting]),
    settings.flatMap((setting) => vehicles.map((id) => [`/media/try-it/${id}-before.webp`, setting])));
  for (const [index, pair] of pairs.entries()) {
    const id = vehicles[index % vehicles.length];
    const room = Math.floor(index / vehicles.length) + 1;
    await access(new URL(`../dist${pair.before}`, import.meta.url));
    const original = await readFile(new URL(`../src/assets/visualizer/${id}/${room}/8.jpg`, import.meta.url));
    assert.deepEqual(await readFile(new URL(`../dist${pair.after}`, import.meta.url)), original);
  }
  const sample = page.slice(page.indexOf('<section id="sample-result"'));
  assert.doesNotMatch(sample, /type="range"|comparison-range|AutoPixelAI sample|>Original<|>Split<|>Finished</i);
  assert.doesNotMatch(page, /<button\b[^>]*>\s*Pause/i);
});

test('the product routes are linked, render canonical URLs, and include their sample imagery', async () => {
  const home = await readFile(new URL('../dist/index.html', import.meta.url), 'utf8');
  const products = [
    ['photo-app', /class="workflow-stage"/],
    ['virtual-showrooms', /<dialog[^>]*id="showroom-preview"/],
  ];
  for (const [slug, evidence] of products) {
    const path = `/${slug}/`;
    assert.ok(home.includes(`href="${path}"`), `Homepage links to ${path}`);
    const page = await readFile(new URL(`../dist${path}index.html`, import.meta.url), 'utf8');
    assert.ok(page.includes(`rel="canonical" href="https://autopixelai.com${path}"`));
    assert.ok(page.includes(`href="${path}" aria-current="page"`));
    assert.match(page, evidence);
    if (slug === 'photo-app') {
      assert.doesNotMatch(page, /type="range"|<figcaption/);
      const steps = [...page.matchAll(/<li id="(scan-vin|select-theme|capture-images|delivered-results)"/g)].map(([, id]) => id);
      assert.deepEqual(steps, ['scan-vin', 'select-theme', 'capture-images', 'delivered-results']);
      const frames = [...new Set([...page.matchAll(/src="\/media\/photo-app\/([\w-]+)\.webp"/g)].map(([, frame]) => frame))];
      assert.deepEqual(frames.sort(), ['capture-front', 'capture-side', 'delivered-photos', 'scan-vin', 'select-theme']);
    }
    for (const [, source] of page.matchAll(/(?:src|href)="(\/media\/[^" ]+)"/g)) {
      await access(new URL(`../dist${source}`, import.meta.url));
    }
  }
});
