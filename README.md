# Override Scout

A VEX V5RC scouting web app for team **1940D Override**. It installs on your phone like a normal app and works offline at events.

**What's inside**

- **Team search & profiles:** search by number, name, school or city. Each profile shows TrueSkill, record, OPR/DPR/CCWM, skills (total, auton, driver), events, matches, awards, scouting notes and editable social links.
- **TrueSkill & rankings:** world, country and grade TrueSkill rankings, plus official world Robot Skills standings.
- **Events:** live match schedules and results, rankings, OPR/DPR/CCWM tables, predictions for every unplayed match, an alliance-selection pick list, and printable event reports.
- **Event Day:** while your team is at an event, Home shows your next match, partner, opponents, win chance and current rank. It refreshes every 30 seconds.
- **Match predictor & compare:** win probability for any 2v2, plus side-by-side stats with head-to-head records.
- **Scouting:** Override match and pit forms with counters, ratings and tags. You can attach photos, videos or YouTube links, export to CSV and share with teammates.
- **Practice log:** time runs with the match timer, score them with the Override calculator, attach video and track your best scores.
- **Robot tools:** gear ratio, drive speed, intake grip, rotating arm output, V5RC/VIQRC match timer, and the Override score calculator.
- **Rules & Q&A:** the official Game and Judging Q&A, searchable by rule tag (e.g. `SG5`) and saved for offline use.
- **Friends & sharing:** add friends by QR code or email invite. Share scouting through links, QR codes or files, which needs no internet. Optional live team sync is also available.

> VEX and the REC Foundation split in 2026. Competition data now comes from **events.vex.com**, which replaced robotevents.com. This app uses its official API.

---

## 1. Get a VEX Events API key

1. Sign in at **https://events.vex.com/api/v2**. Any VEX Events account works.
2. Click **Request Access**, then create a token and copy it.

The same key is used in two places: the GitHub secret (step 2) and the app's Settings (step 3).

## 2. Put the site online (GitHub Pages, free)

1. Create a GitHub repository (e.g. `override-scout`) and push this folder to its `main` branch.
2. In the repo: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
3. In the repo: **Settings → Secrets and variables → Actions → New repository secret**:
   - Name: `VEX_API_TOKEN`
   - Value: your API key
4. Go to **Actions → "Build season data & deploy" → Run workflow**.

The first run downloads the whole season and can take up to an hour. After that it re-runs every 3 hours and only fetches new events. Your site is at `https://<your-username>.github.io/override-scout/`.

The job builds `data/`, which holds TrueSkill ratings, the team search index, season stats, event results and a Q&A snapshot. Anyone opening the site sees these without needing a key.

> GitHub pauses scheduled workflows in repos with no activity for 60 days. Push any change or click **Run workflow** to restart it.

## 3. Install on your phone

Open the site in **Safari (iPhone)** or **Chrome (Android)**, then use **Share → Add to Home Screen** (or **Install app**). It opens full-screen like a native app and works offline.

For up-to-the-minute data during events (every match as it's scored), open **Profile → Live VEX data** and paste the API key. A teammate who already has it set up can use **Share with teammate** to show a QR code. You scan it from **Friends & sharing → Scan**. Only share it within your team.

## 4. Optional: live team sync (Cloudflare Worker, free)

Sharing via links, QR codes and files works out of the box. If you want everyone's scouting notes to sync automatically, deploy the tiny team server in [`worker/worker.js`](worker/worker.js). It also hides the API key, so phones don't need one at all.

1. Create a free account at https://dash.cloudflare.com → **Workers & Pages → Create → Create Worker**. Name it `override-scout`, deploy, then **Edit code**, paste `worker/worker.js`, and deploy.
2. **Storage & Databases → D1 → Create database** (name `override_scout`).
3. In the Worker: **Settings → Bindings → Add → D1 database**, variable name `DB`, pick the database.
4. **Settings → Variables and Secrets**:
   - Add secret `VEX_API_TOKEN` with your key.
   - Optionally add text `ALLOWED_ORIGINS` = `https://<your-username>.github.io`.
5. Put the Worker URL (e.g. `https://override-scout.<you>.workers.dev`) into `config.js` → `workerUrl`, commit and push. You can also enter it per-phone under **Settings → Advanced**.

In the app, open **Friends & sharing → Team workspace → Create**. Teammates scan your QR code to join.

## Run it locally

```bash
python scripts/dev_server.py
```

Then open http://localhost:8640. To try every screen without an API key, generate synthetic test data:

```bash
python scripts/build_data.py --fixture --out test-data
```

```bash
python scripts/dev_server.py 8641 --test-data
```

`test-data/` is git-ignored and never deployed.

## How the numbers work

- **TrueSkill** is the Bayesian skill rating from Microsoft Research (μ = 25, σ = 25/3, β = 25/6, τ = 0.083). Every V5RC qualification and elimination match this season is replayed in order, with each alliance treated as a team of two. Ratings show μ − 3σ, a conservative estimate that grows as a team plays more.
- **OPR / DPR / CCWM** are least-squares fits over an event's qualification matches. OPR is the points a team adds to its alliance, DPR the points it allows, and CCWM their difference (contribution to the winning margin). Season values average a team's events.
- **Predictions** use season TrueSkill for win probability: P(red) = Φ(Δμ / √(nβ² + Σσ²)). Expected scores are the sum of each alliance's OPR. If no season ratings exist yet, ratings from the event alone are used.
- **Override scoring** (game manual v2.1): alliance-coloured pin half 5, owned yellow pin half 10, robot in the Midfield 8, autonomous bonus 12 (6 each on a tie).

## Project layout

```
index.html, config.js, sw.js, manifest.webmanifest   app shell + PWA
css/app.css                                          design system (brand: #FFD000 / #0E0E0E)
js/lib/      api (VEX API), data (snapshot + live), stats (TrueSkill/OPR), state, sync, share (QR/links)
js/views/    home, explore, team, event, match, compare, scout, practice, tools, qa, me, report
scripts/     build_data.py (season builder), dev_server.py
worker/      optional Cloudflare Worker (API proxy + team sync)
```

No build step and no npm. It's plain ES modules with Preact + htm loaded from jsDelivr and cached for offline use.

Not affiliated with or endorsed by VEX Robotics, Innovation First or the REC Foundation.
