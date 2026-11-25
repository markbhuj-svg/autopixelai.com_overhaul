# AutoPixelAI

Local Astro implementation of the AutoPixelAI website. The site includes the Phyron-style video-ready homepage, Photo App, Showrooms, Try a Photo, Integrations & Partners, Book a Demo, and the original-case `/BlackFriday` campaign route.

```sh
npm ci
npm run dev
```

Open [the local preview](http://localhost:4321). Run `npm test` to build the static output and check that homepage links and assets resolve. Run `npm run preview` after a build to view the static output.

The homepage hero uses a dealership poster until a video is available. Put the final muted MP4 at `public/media/hero.mp4` and rebuild. The video respects reduced motion.

The product pages use samples from the live [AutoPixelAI asset library](https://www.autopixelai.com/). The local showroom gallery has 12 examples, category links, and an enlarged preview.

The original client pages are restored at `/SeeAll` (388 themes), `/ViewAll` (36 photo pairs), and `/vlp` (ten vehicle profiles with 349 photos). Lowercase gallery URLs and legacy `.html` links redirect to their original paths. Inventory URLs are case-insensitive, and legacy `/inventory` links redirect to `/vlp`. These pages and the inventory detail pages carry `noindex, nofollow, noimageindex` in both HTML and HTTP headers and stay outside the sitemap. The client gallery image responses also carry the indexing exclusions. Inventory images retain their original AutoBG CDN URLs.

The homepage and Try a Photo send a selected vehicle photo to AutoBG and show its progress while it processes. **Compare** opens the finished photo alongside the original. To use the processor locally, run `npm run build` then `node --env-file=.env server/index.mjs` with the AutoBG settings in `.env`. The Astro dev server supports the local preview.

The demo and Black Friday forms use local previews on loopback addresses. On the hosted site, both use the same-origin lead endpoint and require a verified Turnstile response before sending an email to `team@autopixelai.com`.

## Render

For the existing Node web service, open **Settings → Build → Source → Edit**, select `markbhuj-svg/autopixelai.com_overhaul` and branch `main`, and leave the root directory blank. Confirm the settings below before submitting the source change, which starts a deploy. For a separate service, use [render.yaml](render.yaml). [Render source settings](https://render.com/changelog/change-your-services-backing-repo-or-image-in-the-render-dashboard)

- Build command `npm ci && npm test`
- Start command `npm start`
- Health check `/healthz`
- Node version `24.15.0` from `.node-version`. An existing `NODE_VERSION` setting overrides it. [Render Node version precedence](https://render.com/docs/node-version)
- An SMTP-capable instance such as Starter. [Render's SMTP port policy](https://render.com/changelog/free-web-services-will-no-longer-allow-outbound-traffic-to-smtp-ports)

Keep the existing `GOOGLE_SMTP_USER`, `GOOGLE_SMTP_APP_PASSWORD`, `TURNSTILE_SITE_KEY`, and `TURNSTILE_SECRET_KEY` values in Render. Add any missing values and allow any new deployment hostname in Turnstile. The endpoint records the time of campaign enquiries and returns a reference after Gmail accepts the message. When credentials are absent, the site remains available and the forms offer the contact email.

For photo processing, keep the existing `Autobg_API_KEY` (case-sensitive) and `DEMO_JOB_SECRET` in Render. If you need a new receipt secret, generate it with `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"` and keep it stable across deploys. Once deployed, `/api/demo/config` should return `{"enabled":true}`. Without these values, the uploader offers a local preview. The processor uses the same AutoBG account and template as the existing demo.

For a staged service, set `NOINDEX=true`. Verify the health endpoint, the enabled lead configuration, and receipt of an authorized test enquiry before switching the live domain. The existing service can continue serving the current website while the overhaul is reviewed.
