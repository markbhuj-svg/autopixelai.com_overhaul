# AutoPixelAI

Local Astro implementation of the AutoPixelAI website. The site includes the Phyron-style video-ready homepage, Photo App, Showrooms, Try a Photo, Integrations & Partners, Book a Demo, and the original-case `/BlackFriday` campaign route.

```sh
npm ci
npm run dev
```

Open [the local preview](http://localhost:4321). Run `npm test` to build the static output and check that homepage links and assets resolve. Run `npm run preview` after a build to view the static output.

The homepage hero uses a dealership poster until a video is available. Put the final muted MP4 at `public/media/hero.mp4` and rebuild. The video respects reduced motion.

The product pages use samples from the live [AutoPixelAI asset library](https://www.autopixelai.com/). The local showroom gallery has 12 examples, category links, and an enlarged preview.

Try a Photo previews the chosen image in the browser. The demo and Black Friday forms use local previews on loopback addresses. On the hosted site, both use the same-origin lead endpoint and require a verified Turnstile response before sending an email to `team@autopixelai.com`.

## Render

Connect the `main` branch of `markbhuj-svg/autopixelai.com_overhaul` as a Node **Web Service**, using [render.yaml](render.yaml) or the settings below.

- Build command `npm ci && npm test`
- Start command `npm start`
- Health check `/healthz`
- Node version `24.15.0`
- An SMTP-capable instance such as Starter. [Render's SMTP port policy](https://render.com/changelog/free-web-services-will-no-longer-allow-outbound-traffic-to-smtp-ports)

Set `GOOGLE_SMTP_USER`, `GOOGLE_SMTP_APP_PASSWORD`, `TURNSTILE_SITE_KEY`, and `TURNSTILE_SECRET_KEY` in Render. Use the existing service's values or compatible credentials. Add the hostname serving the form to the Turnstile widget's allowed hostnames. The endpoint records the time of campaign enquiries and returns a reference after Gmail accepts the message. When credentials are absent, the site remains available and the forms offer the contact email.

For a staged service, set `NOINDEX=true`. Verify the health endpoint, the enabled lead configuration, and receipt of an authorized test enquiry before switching the live domain. The existing service can continue serving the current website while the overhaul is reviewed.
