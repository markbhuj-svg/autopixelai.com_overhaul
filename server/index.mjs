import express from 'express';
import { stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createDemoHandler } from './demo.mjs';
import { createLeadRoutes } from './leads.mjs';

const dist = fileURLToPath(new URL('../dist/', import.meta.url));
await stat(new URL('../dist/index.html', import.meta.url));
const app = express();
app.disable('x-powered-by');
app.use((_req, res, next) => {
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  if (process.env.NOINDEX === 'true') res.set('X-Robots-Tag', 'noindex, nofollow');
  next();
});

const leads = createLeadRoutes();
const demo = createDemoHandler();
app.use('/api', (_req, res, next) => {
  res.set({ 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' });
  next();
});
app.get('/api/lead-config', leads.config);
app.post('/api/leads', express.json({ limit: '12kb' }), leads.submit);
app.use((req, res, next) => {
  if (req.path.startsWith('/api/demo/')) return demo(req, res);
  next();
});
app.get('/healthz', (_req, res) => res.set('Cache-Control', 'no-store').json({ status: 'ok' }));
app.get('/BlackFriday', (_req, res) => res.sendFile('BlackFriday/index.html', { root: dist }));
app.use('/_astro', express.static(fileURLToPath(new URL('../dist/_astro/', import.meta.url)), {
  maxAge: '1y', immutable: true, index: false, redirect: false,
}));
app.use(express.static(dist, { maxAge: '1h' }));
app.use((_req, res) => res.status(404).type('text/plain').send('Page not found.'));
app.use((error, _req, res, next) => {
  if (res.headersSent) return next(error);
  const status = error.status === 413 ? 413 : error.status === 400 ? 400 : 500;
  return res.status(status).json({
    message: status === 413 ? 'Please shorten your enquiry.' : status === 400 ? 'Please check the form and try again.' : 'The request could not be completed.',
  });
});

const server = app.listen(Number(process.env.PORT ?? 4173), '0.0.0.0', () => {
  console.log(`AutoPixelAI listening on port ${server.address().port}`);
});
process.on('SIGTERM', () => {
  demo.close();
  server.close();
});
