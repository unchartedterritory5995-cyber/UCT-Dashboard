# Instant company logos — everywhere, no matter the company (2026-09-03)

**Goal:** company logos (watchlists, Theme Tracker, earnings calendar, Model Book,
research, chart widgets — every `CompanyLogo`) render instantly on first view, for
any ticker, instead of the current 1-2s pop-in.

Branch: `feat/instant-logos` (off `origin/master`). Worktree: `.worktrees/logos`.

---

## Investigation — what was actually slow (measured, not assumed)

The logo system is already well-built: one `CompanyLogo.jsx` component →
`/api/ticker-logo/{SYM}` proxy → disk cache on `/data/logo_cache/{SYM}.png` →
served with `Cache-Control: public, max-age=604800, immutable`. So repeat views in
the same browser are instant. The slowness is in getting a logo to the eye the
**first** time per browser.

Measured the live origin directly (`/api/ticker-logo/*` is public, no auth):

| Symbol | Result | Size | Origin time | Edge status |
|--------|--------|------|-------------|-------------|
| AAPL | real PNG | 5 KB | 0.21s | **DYNAMIC** |
| GBCI | real PNG | 20 KB | 0.13s | **DYNAMIC** |
| TFIN | real PNG | 7 KB | **3.35s** | **DYNAMIC** |
| BANC | real PNG | 36 KB | 0.13s | **DYNAMIC** |
| NVDA | real PNG | 18 KB | 0.59s | **DYNAMIC** |

Findings:

1. **No edge cache.** `cf-cache-status: DYNAMIC` on every logo — Cloudflare is not
   caching `/api/ticker-logo/*` at all, despite the perfect immutable header. Every
   logo request from every browser travels to the single origin web pod, and origin
   latency is wildly variable (0.13s → **3.35s** for TFIN). A watchlist fires ~20-40
   of these at once, competing with live-prices / bars on one uvicorn process → the
   1-2s (and worse) pop-in. **This is the dominant cause.**

2. **`loading="lazy"` on every logo `<img>`** deferred even on-screen logos —
   the browser waits to compute layout and decide the image is "near viewport"
   before fetching. For logos visible the instant a list opens, that deferral is
   pure added latency.

3. **The boot-time universe prewarmer was never wired.** `ticker_logos_prewarm`
   (12-worker full-universe warm) exists but `main.py` only called
   `ticker_names_prewarm.start_async()`, never the logo one. The daily miss-retry
   only re-attempts tickers that already FAILED; the hires pass only re-caches
   existing `.png`. So a never-yet-viewed symbol was only warmed if someone had
   run `POST /api/logos/prewarm` by hand and that disk survived. Coverage was good
   in practice but had no automatic guarantee — the long tail (new IPOs, foreign,
   obscure) stayed cold → transparent-pixel → ≥900ms client retry.

Not pursued: a batch/manifest logo endpoint. Once logos are edge-cached, per-symbol
requests are cheap edge hits, so a batch layer would be complexity for little gain.

---

## The fix

### Phase 1 — Cloudflare edge cache `/api/ticker-logo/*`  (OWNER — dashboard)

The single biggest lever. Logos are immutable, tiny, identical for every user.
Edge-caching them = every warm logo served ~10-30ms from the nearest PoP, once per
PoP instead of a per-browser origin round-trip. TFIN's 3.3s origin variance vanishes.

**Cloudflare dashboard → the `uctintelligence.com` zone → Caching → Cache Rules →
Create rule:**

- **Name:** `Cache ticker logos`
- **When incoming requests match:** `URI Path` `starts with` `/api/ticker-logo/`
- **Then / Cache eligibility:** **Eligible for cache**
- **Edge TTL:** **Use cache-control header if present, use default otherwise**
  (this makes it respect the origin: real logos cache 7 days, and the cold-miss
  pixel is now `no-store` so the edge never caches a blank — see Phase 2).
- **Browser TTL:** Respect origin.
- Leave **Cache Key → Query String** at the default *(include all)* — the
  `?v=` asset-version and `?name=` / `?alt=` hints must stay in the key so distinct
  variants cache as distinct objects.

Deploy the rule, then verify (below). No code depends on the rule existing — the
origin headers are already correct with or without it; the rule just lets the edge
act on them.

### Phase 2 — Origin  (CODE — done on this branch)

- **`api/routers/ticker_logos.py`** — split headers:
  - HIT (real logo) → `public, max-age=604800, immutable` (unchanged; edge-cacheable).
  - MISS (cold transparent pixel) → **`no-store`** (was `max-age=60`). A shared edge
    cache must NEVER pin the blank pixel — that would show a monogram to *other*
    viewers until the TTL expired, even after the logo resolved. `no-store` keeps
    the miss origin-only and makes the browser re-request next render, so the real
    logo is picked up the moment it's warm.
- **`api/main.py`** — wire the boot-time universe logo prewarm:
  `ticker_logos_prewarm.start_async()` beside the existing `ticker_names_prewarm`
  call. Idempotent across reboots (skips already-cached), 30s stagger + bounded CDN
  pool, env kill-switch `TICKER_LOGOS_PREWARM_DISABLED=1`. Now coverage is automatic
  and can't silently regress.

### Phase 3 — Client  (CODE — done on this branch)

- **`app/src/components/CompanyLogo.jsx`**:
  - `loading` is now a prop defaulting to **`eager`** (was hardcoded `lazy`). Kills
    the deferral pop-in for on-screen logos. A genuinely huge, mostly-off-screen
    virtualized list can pass `loading="lazy"`. (Watchlists — the only ~5,000-row
    surface — is already virtualized, so off-screen rows never mount: eager is safe.)
  - `decoding="async"` added.
  - First cold retry `900 → 500ms` (cold is the rare tail now that the universe is
    prewarmed; a freshly-resolved logo swaps in faster).

---

## Verify (after deploy + Cloudflare rule)

```
UA='Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120 Safari/537.36'
# Warm a logo (first hit may be MISS at the edge), then re-request — expect HIT:
for i in 1 2; do curl -s -D - -o /dev/null -A "$UA" \
  https://uctintelligence.com/api/ticker-logo/AAPL?v=2 | grep -i cf-cache-status; done
# Expect: cf-cache-status: MISS  then  cf-cache-status: HIT
```
- `GET /api/logos/status` → `coverage.pct` should climb toward ~100% after a boot
  (prewarm) and stay there.
- In the app: open a watchlist / theme / calendar in a fresh browser profile →
  logos should paint essentially immediately, no 1-2s letter-tile pop-in.

## Deploy notes
- Core member-facing path (~200 users). Build + tested locally on the branch;
  **deploy the web pod after close** per repo convention.
- Rollback: client/origin changes are a normal redeploy; the prewarm is behind
  `TICKER_LOGOS_PREWARM_DISABLED=1`; the Cloudflare rule can be disabled in the
  dashboard independently (origin headers stay correct either way).
