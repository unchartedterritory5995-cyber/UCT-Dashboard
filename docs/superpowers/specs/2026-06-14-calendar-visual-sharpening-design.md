# Calendar Visual Sharpening + Calm Restyle — Design

**Date:** 2026-06-14
**Status:** Approved (pending spec review)
**Surface:** `/calendar` (Feed / Week / Month / day-detail drawer)

## Problem

The calendar page reads as pixelated and slightly busy. Two root causes:

1. **Logos are stored low-res.** `api/services/ticker_logos.py::_normalize_png()`
   downscales every logo to `(96, 96)` before caching, even though logo.dev is
   already requested at `size=128&retina=true` (~256px). Rendered in Retina card
   boxes (and as larger inspection sizes), the 96px cache and any sub-96px
   upstream logos get upscaled → soft / blocky edges.
2. **Card density.** The earnings cards carry several boxed widgets and competing
   accent colors, which makes the feed feel cluttered rather than premium.

## Goals

- Make every logo on the calendar crisp on Retina/HiDPI displays.
- Lift the overall feel to "premium by doing less" — calmer, cleaner Feed cards.
- Full pass: high-res logos on **all** surfaces; calm restyle on the Feed cards;
  light spacing/consistency tidy on Week/Month/drawer (no structural change).

## Non-goals

- No new data, endpoints, or features. Purely visual + the logo resolution fix.
- No restructure of Week/Month/drawer layouts.
- No change to the logo source chain / SSRF guard / miss-retry behavior beyond
  the requested resolution.

## Decisions (locked with user)

- **Logo target:** high-res pipeline (256px Retina source, stored at 256px cap).
  Confirmed visually against today's 96px result.
- **Card feel:** Direction **B — Calm & Simplified** (chosen over "Refined" and
  "Premium/Elevated").
- **Beat-history bars:** replaced by a plain sentence ("Beat N of last M quarters").
- **Scope:** full pass — logos everywhere + B restyle on Feed + tidy elsewhere.

---

## 1. High-res logo pipeline (backend)

File: `api/services/ticker_logos.py`

- `_normalize_png()`: change `im.thumbnail((96, 96))` → `im.thumbnail((256, 256))`.
  `thumbnail()` only ever downsizes, so logos whose native source is smaller than
  256px are **not** upscaled (no fake sharpness, no artifacts).
- `_logodev_logo_bytes()` and `_logodev_domain_bytes()`: change the URL
  `size=128` → `size=256` (keep `retina=true`, `fallback=404`, `format=png`).
- Other sources (Parqet, FMP, Finnhub, Clearbit) are unchanged — `_normalize_png`
  caps whatever they return at 256px.

**Storage impact:** ~256px PNGs ≈ 10–20KB each; ×~3,600 ≈ +40–60MB on the
`/data` volume. Negligible.

## 2. One-time re-cache of existing logos (backend)

The ~3,600 logos already on disk are 96px and must be re-resolved at high res.

- Add a **flag-gated one-shot upgrade pass**, mirroring the existing
  `run_miss_retry()` pattern and the chart heal-flag convention
  (`.fmp_tz_heal_v1` etc.):
  - Flag file: `<DATA_DIR>/.logo_hires_v1`.
  - On startup (in `api/main.py` lifespan, alongside other heal/seed steps), if
    the flag is absent, launch a **background daemon thread** that walks existing
    `{SYM}.png` files and re-resolves each at high res, overwriting in place via
    the atomic `tmp → os.replace` write already used in `resolve_and_cache`.
  - **Low concurrency** (≤2 workers) with inter-fetch sleeps (reuse the
    `_MISS_RETRY_*` politeness constants) so the pass never hammers logo.dev.
  - Write the flag when the pass completes so it runs exactly once.
  - Function lives in `ticker_logos.py` (e.g. `run_hires_upgrade()`), guarded by
    a non-blocking lock like `run_miss_retry()` so concurrent calls no-op.
- **Manual trigger:** wire an optional mode into the existing
  `POST /api/logos/prewarm` (e.g. `?hires=1`) so the pass can be re-run on demand
  without a redeploy. Optional but cheap; follows the `?misses=1` precedent.

**Why a background pass, not a mass-delete:** deleting all `.png` files would make
every logo cold simultaneously → a fetch stampede on first view. Re-resolving in
the background at low concurrency keeps existing (if soft) logos serving until the
crisp version overwrites them.

## 3. Bust the browser/CDN cache (frontend, one line)

File: `app/src/components/CompanyLogo.jsx`

- The endpoint serves logos with `Cache-Control: public, max-age=604800, immutable`
  (7 days). Browsers/Cloudflare will keep the old 96px file for up to a week and
  will **not** revalidate (it's `immutable`).
- Add a global asset-version param to the logo URL so the upgrade is visible
  immediately: `const LOGO_V = 2` → append `v=${LOGO_V}` to `src` (joined with
  the existing optional `name`/`alt`/`_r` query params). The backend already
  ignores unknown query params.
- No other rendering change is required: serving a 256px file makes every box size
  (38px cards, 46px after restyle, 18–20px week/month) crisp automatically.
  `CompanyLogo.module.css` stays as-is (`object-fit: cover`).

## 4. Calm restyle — Direction B (Feed cards)

Files: `app/src/pages/calendar/EarningsCard.jsx`,
`app/src/pages/calendar/EventCard.jsx`, `app/src/pages/calendar/Calendar.module.css`.

Earnings + event cards share the `.card` base. Apply Direction B:

- **Card shell:** padding `12 → 16`, radius `12 → 14`.
- **Logo:** `size={38} → size={46}`, CSS radius to match (logo box stays
  `object-fit: cover`). Applies on both `EarningsCard` and `EventCard`.
- **Ticker:** `.sym` `15 → 17px`; `.nm` (company name) `10 → 11px`.
- **Timing (BMO/AMC):** de-pill — render as quiet text at the top-right of the
  card head instead of a colored pill. (BEAT/MISS pill may stay as the single
  status accent, or also soften — keep BEAT/MISS as a small pill.)
- **Metric rows (`.met`):** `11 → 12px`, add a hairline bottom border between
  rows (`1px solid` low-alpha line), last row no border.
- **Expected move:** convert the bordered box (`.emv`) to an **inline line** —
  uppercase muted label on the left, large gold value on the right, no container
  border/background.
- **Beat history:** remove the `.hist` bars markup + `beats.map(...)` rendering;
  replace with a single muted sentence built from `beatCount`/`beats.length`
  (e.g. `Beat {beatCount} of last {beats.length} quarters`). Keep the underlying
  `entry.beat_history` computation; only the presentation changes.
- **Color discipline:** gold (expected move) + green (surprise/positive) +
  red (negative) remain the only accents; reduce incidental blue/gold pill usage.
- **EventCard (IPO/dividend/split):** inherit the calmer base; keep the existing
  subtle type tints (`evtCardIpo/Div/Split`) but lighten to match the quieter feel.

`.cardMine` (gold-tinted "my stocks") and the `★` star are preserved.

## 5. Tidy everywhere else (full pass)

Files: `WeekView.jsx`, `MonthView.jsx`, `DayDetailDrawer.jsx`, `Calendar.module.css`.

- High-res logos are inherited automatically (no per-component change).
- Light consistency tidy only: align spacing/hairline treatment with the calmer
  Feed (e.g. consistent gaps, hairline dividers). **No layout restructure.**
- Verify the small logos (`size={18}` month, `size={20}` week) render crisp with
  the new 256px source.

## 6. Tests

- `app/src/pages/calendar/EarningsCard.test.jsx` and
  `app/src/pages/calendar/eventCard.test.jsx`: update assertions that reference
  removed/changed elements (beat-history bars, the boxed expected-move,
  de-pilled timing). Logo is already mocked, so logo changes don't affect tests.
- Add/adjust a test for the new beat sentence text.
- Backend: the resolution change is internal; if a `_normalize_png` test exists,
  update the expected max dimension. No new endpoints to test (manual prewarm
  mode is a thin wrapper).

## Rollout / verification

1. Ship backend (resolution + upgrade pass + manual mode) and frontend
   (`v=2` bust + B restyle) together.
2. On deploy, the `.logo_hires_v1` background pass re-caches logos over time;
   the `v=2` URL ensures clients pull crisp logos as they're upgraded.
3. Verify in-browser on `/calendar`: Feed cards crisp + calmer; Week/Month/drawer
   logos crisp; check a few historically-soft tickers.
4. Watch `/api/logos/status` coverage during the upgrade pass.

## Risks / mitigations

- **Cache staleness:** handled by the `v=2` URL param (§3).
- **Fetch stampede on re-cache:** avoided via background low-concurrency pass (§2).
- **Upstream rate limits during upgrade:** ≤2 workers + sleeps reuse the proven
  miss-retry politeness budget.
- **Volume growth:** +40–60MB, negligible.

## Files touched

Backend:
- `api/services/ticker_logos.py` (resolution + `run_hires_upgrade()`)
- `api/routers/ticker_logos.py` (optional `?hires=1` mode on prewarm)
- `api/main.py` (flag-gated startup upgrade pass)

Frontend:
- `app/src/components/CompanyLogo.jsx` (`v=2` cache-bust)
- `app/src/pages/calendar/EarningsCard.jsx` (B restyle, beat sentence, 46px logo)
- `app/src/pages/calendar/EventCard.jsx` (B base, 46px logo)
- `app/src/pages/calendar/Calendar.module.css` (B styles + tidy)
- `WeekView.jsx` / `MonthView.jsx` / `DayDetailDrawer.jsx` (light tidy only)

Tests:
- `app/src/pages/calendar/EarningsCard.test.jsx`
- `app/src/pages/calendar/eventCard.test.jsx`
