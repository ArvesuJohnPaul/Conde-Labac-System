# Deploy: GitHub Pages frontend + your laptop as the API/DB server

This exposes the API running on your laptop to the public internet over HTTPS, so
a frontend hosted on GitHub Pages can reach it. Your laptop must be **on and
running `npm start`** (plus the tunnel) for the live site to work.

```
 yourname.github.io/repo   ──HTTPS──►  your-name.ngrok-free.app  ──►  localhost:3000
   (static frontend,                    (permanent ngrok tunnel)      (Express + PostGIS
    served by GitHub)                                                  on your laptop)
```

> Do the **frontend rewiring first** (localStorage → `apiGet`/`apiPost`). A tunnel
> to a frontend that still uses localStorage syncs nothing.

---

## Stage 2 — Permanent public URL with an ngrok static domain (free)

The free ngrok plan includes **one permanent domain**, so the URL never changes
between restarts (unlike Cloudflare's random quick tunnel).

### One-time setup
1. Sign up (free): <https://dashboard.ngrok.com/signup>
2. Install: `winget install --id ngrok.ngrok`
3. Connect your account (token from the dashboard):
   ```powershell
   ngrok config add-authtoken <YOUR_AUTHTOKEN>
   ```
4. Claim your domain: dashboard → **Domains** → **New Domain**. You get e.g.
   `conde-labac-8842.ngrok-free.app`.

### Every time you want the site live
With `npm start` running, in a second PowerShell window (use the exact command
your dashboard shows for your domain):
```powershell
ngrok http --url=conde-labac-8842.ngrok-free.app 3000
```

Test from your phone (on mobile data, to prove it's really public):
```
https://conde-labac-8842.ngrok-free.app/api/health
```
Expect `{ "ok": true, "postgis": "3.x" }`.

> The free-ngrok browser "warning" page is bypassed automatically for the app's
> API calls — `js/api.js` sends the `ngrok-skip-browser-warning` header.

### Wire the permanent URL into the frontend (once)
Open `js/api-config.js` and set:
```js
var PERMANENT_API_BASE = "https://conde-labac-8842.ngrok-free.app";
```
Now the GitHub Pages site uses it automatically — **no `?api=` needed, ever.**
(Running locally still uses `localhost` — the config detects that.)

---

## Stage 3 — Put the frontend on GitHub Pages

1. **Remove secrets first.** Delete the `password: "conde123"` line from
   `server/README.md`. `server/.env` is already git-ignored. Never commit a real
   password.

2. **Push the repo:**
   ```powershell
   cd "C:\Users\Nitro V 15\Documents\Conde Labac System"
   git add .
   git commit -m "Add API server + DB + tunnel-ready frontend config"
   git push
   ```

3. **Enable Pages:** repo → **Settings → Pages** → *Source:* **Deploy from a
   branch** → Branch **main**, folder **/ (root)** → Save. Your site appears at
   `https://<your-username>.github.io/<repo-name>/`.

4. **Open it** — because `PERMANENT_API_BASE` is set, it already talks to your
   laptop. No parameter needed. (The `?api=<url>` override still exists for
   one-off testing against a different backend.)

### Checklist for it to actually work
- [ ] `npm start` running on your laptop
- [ ] `ngrok http --url=<your-domain> 3000` running (window open)
- [ ] `/api/health` works over the ngrok URL
- [ ] `PERMANENT_API_BASE` set in `js/api-config.js`
- [ ] Frontend rewiring done (pages call `apiGet`/`apiPost`, not `localStorage`)
- [ ] Every page includes `js/api-config.js` **then** `js/api.js` before other scripts

---

## Alternative: Cloudflare *named* tunnel (needs a domain you own)
More professional (no interstitial, custom domain) but requires a domain added to
a Cloudflare account. If you buy/own one: `cloudflared tunnel login`, create a
tunnel, and route `api.yourdomain.com → http://localhost:3000`. Then set
`PERMANENT_API_BASE = "https://api.yourdomain.com"`. Not necessary for a thesis.

## Reminder: what GitHub Pages can and can't do
- ✅ Host the static frontend (HTML/CSS/JS).
- ❌ Run Node/Express or PostgreSQL — those live on your laptop.
- Mixed content is handled (tunnel is HTTPS); CORS is handled (the `cors()`
  middleware sends `Access-Control-Allow-Origin`).
