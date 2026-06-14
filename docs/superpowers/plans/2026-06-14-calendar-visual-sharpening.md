# Calendar Visual Sharpening + Calm Restyle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every logo on the `/calendar` page crisp on Retina displays and give the Feed cards a calmer, more premium feel ("Direction B").

**Architecture:** Backend stores logos at 256px instead of 96px and ships a flag-gated one-shot background pass to re-cache the ~3,600 existing logos at the new resolution. The frontend adds a one-line cache-bust so browsers pull the fresh logos immediately, then restyles the shared `.card` (earnings + event cards) and lightly tidies Week/Month/drawer.

**Tech Stack:** FastAPI + Pillow (backend), React + Vite + CSS Modules (frontend), pytest (backend tests), vitest + Testing Library (frontend tests).

**Spec:** `docs/superpowers/specs/2026-06-14-calendar-visual-sharpening-design.md`

---

## File Structure

Backend:
- `api/services/ticker_logos.py` — resolution cap (256px) + `run_hires_upgrade()` one-shot pass.
- `api/routers/ticker_logos.py` — `?hires=1` mode on the existing prewarm endpoint.
- `api/main.py` — flag-gated startup call to the upgrade pass (mirrors `.fmp_tz_heal_v1`).

Frontend:
- `app/src/components/CompanyLogo.jsx` — `v=2` cache-bust on the logo URL.
- `app/src/pages/calendar/EarningsCard.jsx` — Direction B restyle (46px logo, de-pilled timing, beat sentence).
- `app/src/pages/calendar/EventCard.jsx` — 46px logo (inherits B base CSS).
- `app/src/pages/calendar/Calendar.module.css` — Direction B styles + Week/Month/drawer tidy.

Tests:
- `tests/test_ticker_logos.py` — new: resolution cap unit test.
- `app/src/pages/calendar/EarningsCard.test.jsx` — updated for de-pilled timing + new beat sentence.
- `app/src/pages/calendar/eventCard.test.jsx` — unchanged (logo is mocked; size change invisible) — verify still green.

---

## Task 1: Raise the logo resolution cap (backend)

**Files:**
- Test: `tests/test_ticker_logos.py` (create)
- Modify: `api/services/ticker_logos.py` (`_normalize_png` ~line 238, `_logodev_logo_bytes` ~line 124, `_logodev_domain_bytes` ~line 167)

- [ ] **Step 1: Write the failing test**

Create `tests/test_ticker_logos.py`:

```python
import io
from PIL import Image
from api.services import ticker_logos as tl


def _png_bytes(w, h):
    im = Image.new("RGBA", (w, h), (200, 30, 30, 255))
    buf = io.BytesIO()
    im.save(buf, format="PNG")
    return buf.getvalue()


def test_normalize_png_caps_at_256():
    # A 400x400 source must be downscaled so the long edge is 256, not 96.
    out = tl._normalize_png(_png_bytes(400, 400))
    assert out is not None
    im = Image.open(io.BytesIO(out))
    assert max(im.size) == 256


def test_normalize_png_does_not_upscale_small_logos():
    # A 64x64 source must be left at 64 (thumbnail only downsizes).
    out = tl._normalize_png(_png_bytes(64, 64))
    assert out is not None
    im = Image.open(io.BytesIO(out))
    assert max(im.size) == 64
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd "C:\Users\Patrick\uct-dashboard" && python -m pytest tests/test_ticker_logos.py -v`
Expected: `test_normalize_png_caps_at_256` FAILS (`assert 96 == 256`); the no-upscale test PASSES.

- [ ] **Step 3: Raise the thumbnail cap**

In `api/services/ticker_logos.py`, `_normalize_png()`, change:

```python
        im.thumbnail((96, 96))
```

to:

```python
        im.thumbnail((256, 256))
```

- [ ] **Step 4: Request higher resolution from logo.dev**

In `_logodev_logo_bytes()` change the URL `size=128` → `size=256`:

```python
    url = (
        f"https://img.logo.dev/ticker/{_safe(sym)}"
        f"?token={_LOGODEV_TOKEN}&format=png&size=256&retina=true&fallback=404"
    )
```

In `_logodev_domain_bytes()` change the URL `size=128` → `size=256`:

```python
    url = (
        f"https://img.logo.dev/{domain}"
        f"?token={_LOGODEV_TOKEN}&format=png&size=256&retina=true&fallback=404"
    )
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd "C:\Users\Patrick\uct-dashboard" && python -m pytest tests/test_ticker_logos.py -v`
Expected: both tests PASS.

- [ ] **Step 6: Commit**

```bash
git add tests/test_ticker_logos.py api/services/ticker_logos.py
git commit -m "feat(logos): store logos at 256px (was 96px) for crisp Retina rendering"
```

---

## Task 2: One-shot hi-res upgrade pass for existing logos (backend)

**Files:**
- Test: `tests/test_ticker_logos.py` (append)
- Modify: `api/services/ticker_logos.py` (append `run_hires_upgrade()` near `run_miss_retry`)

The ~3,600 logos already on disk are 96px. This pass re-resolves each cached `{SYM}.png` at the new resolution, overwriting in place at low concurrency.

- [ ] **Step 1: Write the failing test**

Append to `tests/test_ticker_logos.py`:

```python
def test_run_hires_upgrade_recaches_existing(tmp_path, monkeypatch):
    # Point the cache dir at a temp dir with one existing (old) png.
    monkeypatch.setattr(tl, "_CACHE_DIR", str(tmp_path))
    old = _png_bytes(80, 80)
    png_path = tl._png_path("AAPL")
    with open(png_path, "wb") as fh:
        fh.write(old)

    # Stub the network: re-resolution returns a big 300x300 source.
    monkeypatch.setattr(tl, "_fetch_sources", lambda s: _png_bytes(300, 300))

    stats = tl.run_hires_upgrade(sleep_seconds=0.0)
    assert stats["total"] == 1
    assert stats["upgraded"] == 1

    from PIL import Image
    im = Image.open(png_path)
    assert max(im.size) == 256
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd "C:\Users\Patrick\uct-dashboard" && python -m pytest tests/test_ticker_logos.py::test_run_hires_upgrade_recaches_existing -v`
Expected: FAIL with `AttributeError: module ... has no attribute 'run_hires_upgrade'`.

- [ ] **Step 3: Implement `run_hires_upgrade()`**

In `api/services/ticker_logos.py`, add a module-level lock near the other locks:

```python
_HIRES_LOCK = threading.Lock()
```

Then append this function (after `run_miss_retry`):

```python
def run_hires_upgrade(sleep_seconds: float = _MISS_RETRY_SLEEP) -> dict:
    """Re-resolve every already-cached {SYM}.png at the current (256px) cap and
    overwrite it in place. One-shot upgrade for logos cached at the old 96px size.

    Low concurrency (≤2 workers) with inter-fetch sleeps to respect upstream rate
    limits. Never deletes a logo: a failed re-fetch leaves the existing file alone
    (an existing soft logo beats a blank). Safe to call concurrently — a second
    call while one is running returns {"skipped": True}.
    """
    if not _HIRES_LOCK.acquire(blocking=False):
        _logger.info("[logo-hires] already running — skipping")
        return {"skipped": True}

    stats = {"total": 0, "upgraded": 0, "unchanged": 0}
    try:
        os.makedirs(_CACHE_DIR, exist_ok=True)
        try:
            syms = [f[:-4] for f in os.listdir(_CACHE_DIR) if f.endswith(".png")]
        except OSError as e:
            _logger.warning("[logo-hires] listdir failed: %s", e)
            return stats

        stats["total"] = len(syms)
        if not syms:
            return stats
        _logger.info("[logo-hires] starting: %d cached logos to upgrade", len(syms))

        def _upgrade_one(sym: str) -> bool:
            s = _safe(sym)
            try:
                if sleep_seconds:
                    time.sleep(sleep_seconds)
                raw = _fetch_sources(s)
                png = _normalize_png(raw) if raw else None
                if not png:
                    return False
                tmp = _png_path(s) + ".tmp"
                with open(tmp, "wb") as fh:
                    fh.write(png)
                os.replace(tmp, _png_path(s))
                return True
            except Exception as e:
                _logger.debug("[logo-hires] %s failed: %s", s, e)
                return False

        with ThreadPoolExecutor(max_workers=_MISS_RETRY_WORKERS,
                                thread_name_prefix="logo-hires") as ex:
            from concurrent.futures import as_completed
            futs = {ex.submit(_upgrade_one, sym): sym for sym in syms}
            for fut in as_completed(futs):
                stats["upgraded" if fut.result() else "unchanged"] += 1

        _logger.info("[logo-hires] done: upgraded=%d unchanged=%d",
                     stats["upgraded"], stats["unchanged"])
    finally:
        _HIRES_LOCK.release()
    return stats
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd "C:\Users\Patrick\uct-dashboard" && python -m pytest tests/test_ticker_logos.py -v`
Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add tests/test_ticker_logos.py api/services/ticker_logos.py
git commit -m "feat(logos): add run_hires_upgrade() one-shot re-cache pass"
```

---

## Task 3: Wire the upgrade pass to the prewarm endpoint + startup (backend)

**Files:**
- Modify: `api/services/ticker_logos_prewarm.py` (append `run_hires_upgrade_now()`)
- Modify: `api/routers/ticker_logos.py` (`prewarm_logos` ~line 36)
- Modify: `api/main.py` (lifespan, after the ticker-names prewarm scheduling ~line 1146)

- [ ] **Step 1: Add a background launcher in the prewarm module**

Append to `api/services/ticker_logos_prewarm.py`:

```python
def run_hires_upgrade_now() -> dict:
    """Kick the hi-res upgrade pass on a background thread. Returns immediately."""
    from api.services import ticker_logos as tl

    def _job():
        try:
            tl.run_hires_upgrade()
        except Exception as e:
            _logger.warning("[logo-prewarm] hires upgrade error: %s", e)

    threading.Thread(target=_job, daemon=True, name="logo-hires-now").start()
    return {"started": True, "note": "hi-res upgrade running in background"}
```

- [ ] **Step 2: Add the `?hires=1` mode to the endpoint**

In `api/routers/ticker_logos.py`, replace the `prewarm_logos` function body to handle the new mode:

```python
@router.post("/api/logos/prewarm")
def prewarm_logos(misses: int = 0, hires: int = 0):
    """Kick a logo warm pass.

    Query params:
        hires=1   Re-cache every existing logo at the current (256px) resolution.
        misses=1  Run the slow miss-retry pass (≤2 workers, extended source chain).
        (default) Run the normal full universe warm pass (12 workers, CDN-fast).
    """
    if hires:
        result = pw.run_hires_upgrade_now()
        return {"ok": True, "mode": "hires", **result}
    if misses:
        result = pw.run_miss_retry_now()
        return {"ok": True, "mode": "miss_retry", **result}
    started = pw.run_now()
    return {"ok": True, "started": started, "progress": pw.get_progress()}
```

- [ ] **Step 3: Add the flag-gated startup pass in main.py**

In `api/main.py`, inside `lifespan`, immediately AFTER the ticker-names prewarm scheduling block (the `print("[startup] ticker-names prewarm scheduled")` area ~line 1144), add:

```python
    # One-shot hi-res logo upgrade: re-cache ~3,600 existing 96px logos at 256px.
    # Flag-gated so it runs exactly once; background + low-concurrency so it never
    # hammers upstream. Mirrors the .fmp_tz_heal_v1 startup-heal pattern.
    try:
        _logo_hires_flag = os.path.join(os.environ.get("DATA_DIR", "/data"), ".logo_hires_v1")
        if not os.path.exists(_logo_hires_flag):
            from api.services import ticker_logos_prewarm as _logo_pw

            def _logo_hires_runner():
                import time as _t
                _t.sleep(90)  # let startup + names/bars prewarm settle first
                try:
                    from api.services import ticker_logos as _tl
                    _tl.run_hires_upgrade()
                    with open(_logo_hires_flag, "w"):
                        pass
                    print("[startup] logo_hires_v1: upgrade pass complete")
                except Exception as _e:
                    print(f"[startup] logo_hires_v1 error (non-fatal): {_e}")

            import threading as _threading
            _threading.Thread(target=_logo_hires_runner, daemon=True,
                              name="logo-hires-startup").start()
            print("[startup] logo_hires_v1: upgrade scheduled (~90s after boot)")
    except Exception as e:
        print(f"[startup] logo_hires_v1 scheduling failed (non-fatal): {e}")
```

- [ ] **Step 4: Verify the app boots and imports resolve**

Run: `cd "C:\Users\Patrick\uct-dashboard" && python -c "import api.main; import api.routers.ticker_logos; import api.services.ticker_logos_prewarm; print('imports ok')"`
Expected: prints `imports ok` with no traceback.

- [ ] **Step 5: Commit**

```bash
git add api/services/ticker_logos_prewarm.py api/routers/ticker_logos.py api/main.py
git commit -m "feat(logos): flag-gated startup hi-res upgrade + ?hires=1 endpoint mode"
```

---

## Task 4: Cache-bust the logo URL (frontend)

**Files:**
- Modify: `app/src/components/CompanyLogo.jsx` (~line 46-50)

The endpoint serves logos with `Cache-Control: ... immutable` (7 days). Bumping a version param in the URL forces browsers to fetch the new high-res file immediately.

- [ ] **Step 1: Add the version constant and append it to the URL**

In `app/src/components/CompanyLogo.jsx`, add a constant near the top (after the imports, beside `MAX_RETRY`):

```js
const LOGO_ASSET_VERSION = 2   // bump to force browsers past the 7-day immutable cache (e.g. after a resolution upgrade)
```

Then in the query-building block, add the version param. Change:

```js
  const q = []
  if (name) q.push(`name=${encodeURIComponent(name)}`)
  if (alt) q.push(`alt=${encodeURIComponent(alt)}`)
  if (retry) q.push(`_r=${retry}`)   // cache-bust the 60s placeholder so the retry re-hits the server
  const src = `/api/ticker-logo/${s}${q.length ? `?${q.join('&')}` : ''}`
```

to:

```js
  const q = [`v=${LOGO_ASSET_VERSION}`]
  if (name) q.push(`name=${encodeURIComponent(name)}`)
  if (alt) q.push(`alt=${encodeURIComponent(alt)}`)
  if (retry) q.push(`_r=${retry}`)   // cache-bust the 60s placeholder so the retry re-hits the server
  const src = `/api/ticker-logo/${s}?${q.join('&')}`
```

- [ ] **Step 2: Verify the frontend builds**

Run: `cd "C:\Users\Patrick\uct-dashboard\app" && npm run build`
Expected: build succeeds with no errors. (Per project rule: always `npm run build` locally before pushing.)

- [ ] **Step 3: Commit**

```bash
git add app/src/components/CompanyLogo.jsx
git commit -m "feat(logos): version-bust logo URLs so hi-res upgrade is picked up immediately"
```

---

## Task 5: Direction B restyle — EarningsCard (frontend + CSS)

**Files:**
- Modify: `app/src/pages/calendar/EarningsCard.jsx`
- Modify: `app/src/pages/calendar/Calendar.module.css`
- Test: `app/src/pages/calendar/EarningsCard.test.jsx`

Changes: 46px logo; ticker 17px; BMO/AMC moved to a quiet top-right label (de-pilled); the redundant bottom `sessionLbl` removed; the boxed Expected-move becomes an inline line; the beat-history bars become a plain sentence.

- [ ] **Step 1: Update the test for the new beat sentence + de-pilled timing**

Replace the contents of `app/src/pages/calendar/EarningsCard.test.jsx` with:

```jsx
// app/src/pages/calendar/EarningsCard.test.jsx
// Unit tests for the REAL EarningsCard (not mocked).
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

// Isolate EarningsCard from its heavy children.
vi.mock('../../components/CompanyLogo', () => ({ default: () => null }))
vi.mock('../../components/TickerActions', () => ({
  default: () => null,
  useTickerActions: () => ({ menu: null, openMenu: vi.fn(), closeMenu: vi.fn(), longPressProps: () => ({}) }),
}))

import EarningsCard from './EarningsCard'

describe('EarningsCard', () => {
  it('renders the ticker and timing label when timing is provided', () => {
    render(<EarningsCard entry={{ sym: 'AAPL', date: '2026-06-02' }} timing="bmo" />)
    expect(screen.getByText('AAPL')).toBeTruthy()
    expect(screen.getAllByText('BMO').length).toBeGreaterThan(0)
  })

  it('does not throw when timing is missing (defensive guard)', () => {
    expect(() =>
      render(<EarningsCard entry={{ sym: 'AAPL', date: '2026-06-02' }} />),
    ).not.toThrow()
    expect(screen.getByText('AAPL')).toBeTruthy()
  })

  it('renders the beat history as a plain sentence (not bars)', () => {
    render(
      <EarningsCard
        entry={{
          sym: 'AAPL', date: '2026-06-02',
          beat_history: [{ beat: true }, { beat: true }, { beat: false }, { beat: true }],
        }}
        timing="amc"
      />,
    )
    expect(screen.getByText(/Beat 3 of last 4 quarters/)).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run the test to verify the new case fails**

Run: `cd "C:\Users\Patrick\uct-dashboard\app" && npx vitest run src/pages/calendar/EarningsCard.test.jsx`
Expected: the "plain sentence" test FAILS (text not found); the other two PASS.

- [ ] **Step 3: Restyle the EarningsCard head (de-pilled timing + 46px logo)**

In `app/src/pages/calendar/EarningsCard.jsx`, replace the `cardTop` block (the `<div className={styles.cardTop}>...</div>` that contains the `CompanyLogo size={38}`):

```jsx
        <div className={styles.cardTop}>
          <CompanyLogo sym={entry.sym} size={46} />
          <div className={styles.cardHead}>
            <div className={styles.sym}>
              {entry.sym}
              {reported && <span className={styles.beatPill}>{
                surprise(entry.eps_act, entry.eps_est)?.startsWith('-') ? 'MISS' : 'BEAT'}</span>}
            </div>
            <div className={styles.nm}>{entry.name || ''}</div>
          </div>
          <span className={`${styles.session} ${timing === 'bmo' ? styles.sessionBmo : styles.sessionAmc}`}>
            {(timing || '').toUpperCase()}
          </span>
        </div>
```

- [ ] **Step 4: Replace the countdown/sessionLbl block with countdown-only**

In the pending branch (`!reported`), replace:

```jsx
            {/* A5: Countdown or session label */}
            {countdown ? (
              <div className={styles.countdown}>{countdown}</div>
            ) : (
              <div className={styles.sessionLbl}>{sessionLabel}</div>
            )}
```

with:

```jsx
            {/* A5: Countdown (timing now lives in the de-pilled top-right label) */}
            {countdown && <div className={styles.countdown}>{countdown}</div>}
```

(The `sessionLabel` variable becomes unused — delete its declaration `const sessionLabel = ...` near the top of the component.)

- [ ] **Step 5: Replace the beat-history bars with a sentence**

In the pending branch, replace:

```jsx
            {beats.length > 0 && (
              <div className={styles.hist}>
                {beats.map((b, i) => (
                  <i key={i} className={b.beat ? styles.histPos : styles.histNeg}
                     style={{ height: `${40 + i * 12}%` }} />
                ))}
                <span className={styles.histLbl}>{beatCount}/{beats.length} beat</span>
              </div>
            )}
```

with:

```jsx
            {beats.length > 0 && (
              <div className={styles.beatNote}>Beat {beatCount} of last {beats.length} quarters</div>
            )}
```

- [ ] **Step 6: Add/adjust the Direction B styles**

In `app/src/pages/calendar/Calendar.module.css`, apply these edits:

Change `.card` padding and radius:

```css
.card {
  position: relative;
  background: var(--cal-panel);
  border: 1px solid var(--cal-line);
  border-radius: 14px;
  padding: 16px;
  transition: border-color 0.12s, transform 0.12s;
  cursor: pointer;
  container-type: inline-size;
}
```

Change `.cardTop` (gap + alignment for the right-aligned session label):

```css
.cardTop {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 14px;
}
```

Add `.cardHead` (lets the name/ticker take the middle, session sits right):

```css
.cardHead {
  flex: 1;
  min-width: 0;
}
```

Change `.sym` font-size 15 → 17:

```css
.sym {
  font-size: 17px;
  font-weight: 800;
  line-height: 1.1;
  color: var(--cal-txt);
  display: flex;
  align-items: center;
  gap: 5px;
  flex-wrap: wrap;
}
```

Change `.nm` font-size 10 → 11:

```css
.nm {
  font-size: 11px;
  color: var(--cal-muted);
  line-height: 1.2;
  margin-top: 2px;
}
```

Add the de-pilled session label classes (place after the `.amc` rule):

```css
/* Direction B: timing as a quiet top-right label instead of a pill */
.session {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.4px;
  align-self: flex-start;
}
.sessionBmo { color: var(--cal-gold); }
.sessionAmc { color: var(--cal-blue); }
```

Change `.met` to 12px with a hairline divider:

```css
.met {
  display: flex;
  justify-content: space-between;
  font-size: 12px;
  padding: 5px 0;
  color: var(--cal-txt);
  border-bottom: 1px solid rgba(255, 255, 255, 0.04);
}
.met:last-of-type { border-bottom: none; }
```

Change `.emv` from a box to an inline line, and bump `.emvBig`:

```css
.emv {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  margin-top: 12px;
  padding: 0;
  background: none;
  border: none;
}

.emvBig {
  font-size: 16px;
  font-weight: 800;
  color: var(--cal-gold);
}
```

Add the beat sentence style (place after the `.histLbl` rule):

```css
.beatNote {
  font-size: 10px;
  color: var(--cal-green);
  font-weight: 600;
  margin-top: 9px;
}
```

- [ ] **Step 7: Run the test to verify all pass**

Run: `cd "C:\Users\Patrick\uct-dashboard\app" && npx vitest run src/pages/calendar/EarningsCard.test.jsx`
Expected: all three tests PASS.

- [ ] **Step 8: Build to confirm CSS/JSX compile**

Run: `cd "C:\Users\Patrick\uct-dashboard\app" && npm run build`
Expected: build succeeds.

- [ ] **Step 9: Commit**

```bash
git add app/src/pages/calendar/EarningsCard.jsx app/src/pages/calendar/Calendar.module.css app/src/pages/calendar/EarningsCard.test.jsx
git commit -m "feat(calendar): calm Direction B restyle for EarningsCard (46px logo, de-pilled timing, inline expected-move, beat sentence)"
```

---

## Task 6: Direction B base — EventCard logo size (frontend)

**Files:**
- Modify: `app/src/pages/calendar/EventCard.jsx` (three `CompanyLogo size={38}` calls)
- Test: `app/src/pages/calendar/eventCard.test.jsx` (verify still green)

Event cards already share the `.card` base (so they inherit the Task 5 CSS). Only the logo size needs to match.

- [ ] **Step 1: Bump all three EventCard logos to 46px**

In `app/src/pages/calendar/EventCard.jsx`, change every occurrence of:

```jsx
        <CompanyLogo sym={sym || '?'} size={38} />
```

to:

```jsx
        <CompanyLogo sym={sym || '?'} size={46} />
```

(There are three: `IpoCard`, `DividendCard`, `SplitCard`. Use replace-all.)

- [ ] **Step 2: Run the EventCard tests (must stay green)**

Run: `cd "C:\Users\Patrick\uct-dashboard\app" && npx vitest run src/pages/calendar/eventCard.test.jsx`
Expected: all tests PASS (CompanyLogo is mocked, so the size change is invisible to tests).

- [ ] **Step 3: Commit**

```bash
git add app/src/pages/calendar/EventCard.jsx
git commit -m "feat(calendar): match EventCard logos to Direction B 46px size"
```

---

## Task 7: Light tidy — Week / Month / drawer (CSS only)

**Files:**
- Modify: `app/src/pages/calendar/Calendar.module.css`

No structural change — only spacing/hairline consistency so these surfaces match the calmer Feed. Logos here are already crisp via Tasks 1–4.

- [ ] **Step 1: Soften the Week column + Month cell borders to match**

In `Calendar.module.css`, change `.wcol` radius to match the calmer cards:

```css
.wcol {
  background: var(--cal-panel);
  border: 1px solid var(--cal-line);
  border-radius: 12px;
  padding: 10px;
  min-height: 120px;
}
```

And `.gcell` radius:

```css
.gcell {
  background: var(--cal-panel);
  border: 1px solid var(--cal-line);
  border-radius: 10px;
  padding: 7px 8px;
  min-height: 104px;
  cursor: pointer;
  transition: border-color 0.12s;
  display: flex;
  flex-direction: column;
}
```

- [ ] **Step 2: Build to confirm**

Run: `cd "C:\Users\Patrick\uct-dashboard\app" && npm run build`
Expected: build succeeds.

- [ ] **Step 3: Manual verification (record result)**

Run the app locally per CLAUDE.md (`uvicorn api.main:app --port 8000` + `cd app && npm run dev`), open `/calendar`, and confirm:
- Feed cards: crisp logos, calmer layout, timing label top-right, expected-move as a line, beat sentence.
- Week / Month / drawer: crisp logos, consistent rounded cells.
Note any deviation before committing.

- [ ] **Step 4: Commit**

```bash
git add app/src/pages/calendar/Calendar.module.css
git commit -m "style(calendar): tidy Week/Month cell radii to match calmer feed"
```

---

## Task 8: Full verification + push

- [ ] **Step 1: Run the full calendar frontend test suite**

Run: `cd "C:\Users\Patrick\uct-dashboard\app" && npx vitest run src/pages/calendar`
Expected: all calendar tests PASS.

- [ ] **Step 2: Run the backend logo tests**

Run: `cd "C:\Users\Patrick\uct-dashboard" && python -m pytest tests/test_ticker_logos.py -v`
Expected: all PASS.

- [ ] **Step 3: Final production build**

Run: `cd "C:\Users\Patrick\uct-dashboard\app" && npm run build`
Expected: build succeeds.

- [ ] **Step 4: Push to Railway (per project workflow)**

```bash
git push origin master
```

After deploy, watch the logs for `[startup] logo_hires_v1: upgrade scheduled (~90s after boot)` then `...upgrade pass complete`, and check `/api/logos/status` coverage. The `v=2` URL means clients pull crisp logos as the background pass overwrites them.

---

## Self-Review Notes

- **Spec coverage:** §1 resolution → Task 1; §2 re-cache → Tasks 2–3; §3 cache-bust → Task 4; §4 Direction B Feed → Tasks 5–6; §5 tidy → Task 7; §6 tests → Tasks 1, 2, 5, 6, 8. All covered.
- **Type/name consistency:** `run_hires_upgrade` (service) / `run_hires_upgrade_now` (prewarm launcher) / `?hires=1` (endpoint) / `.logo_hires_v1` (flag) / `LOGO_ASSET_VERSION` (frontend) used consistently across tasks.
- **No placeholders:** every code step shows full code; every test step shows the command + expected result.
