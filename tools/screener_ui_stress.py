"""Exhaustive automated UI diagnostics harness for /screener.

Simulates N concurrent paid test users exhaustively exercising the Scanner UI
(ScannerShell — the world-class rail/grid/columns/screens shell mounted as the
"Scanner" tab of /screener). Each worker is its own browser context with a
seeded RNG driving a weighted random action library; every action is followed
by a battery of structural invariant checks. Violations dedupe by signature;
the FIRST occurrence of each signature gets a screenshot.

Login idiom (mirrors tools/mobile_audit.py's `do_login`): POST
/api/auth/login via the context's `page.request` API so the Set-Cookie lands
in that context's cookie jar — robust vs the intro overlay, no UI login flow
needed.

Usage:
    python tools/screener_ui_stress.py --base http://localhost:8077
    python tools/screener_ui_stress.py --base http://localhost:8077 --workers 2 --iters 15   # pilot

Output: tools/ui_stress_out/{findings.jsonl, report.md, anomalies/*.png}
"""
import argparse
import asyncio
import json
import random
import re
import sys
import time
import traceback
import urllib.request
from collections import Counter
from pathlib import Path
from urllib.parse import urlsplit

from playwright.async_api import async_playwright

OUT_DIR = Path(__file__).parent / "ui_stress_out"
ANOM_DIR = OUT_DIR / "anomalies"

ACCOUNTS = [(f"t{i}@local.dev", "LocalTest2026!") for i in range(1, 11)]

VIEWPORTS = {
    "desktop": {"width": 1568, "height": 900},
    "tablet": {"width": 820, "height": 1180},
    "phone": {"width": 390, "height": 844},
}


def viewport_for(idx):
    if idx == 8:
        return "tablet"
    if idx == 9:
        return "phone"
    return "desktop"


MAX_FINDINGS_PER_SIGNATURE = 50
PROGRESS_EVERY = 100
RECYCLE_EVERY = 200
ACTION_TIMEOUT_MS = 4000
ACTION_WALL_TIMEOUT_S = 8.0
# nav_roundtrip does up to 2 full navigations, each followed by intro-overlay
# dismissal (every full nav remounts <App/> and replays the cinematic intro —
# see dismiss_intro()) — give it real headroom instead of racing the default
# wall clock against that dismissal sequence.
ACTION_WALL_TIMEOUT_OVERRIDE = {"nav_roundtrip": 25.0}

# ---------------------------------------------------------------------------
# Ignore lists — kept short and DOCUMENTED. Verified against a 2-worker/
# 15-iteration pilot run before the full run: both patterns fired repeatedly
# and were confirmed benign (a11y-lib layout warning unrelated to our DOM;
# navigation-cancelled fetches from our own aggressive reload/back/forward
# actions, not server or app defects).
# ---------------------------------------------------------------------------
IGNORE_CONSOLE_RE = [
    re.compile(r"ResizeObserver loop"),
    re.compile(r"Download the React DevTools"),
]
IGNORE_NETFAIL_ERRTEXT = {"NS_BINDING_ABORTED", "net::ERR_ABORTED"}

# ---------------------------------------------------------------------------
# Global, cross-worker dedupe state (single process, asyncio — no IPC needed)
# ---------------------------------------------------------------------------
FINDINGS_LOCK = asyncio.Lock()
SIG_FIRST = {}
SIG_COUNT = Counter()
FINDINGS_FH = None


def normalize(text):
    text = str(text)
    text = re.sub(r"https?://\S+", "<URL>", text)
    text = re.sub(r"\b[0-9a-fA-F]{8}-[0-9a-fA-F-]{27}\b", "<UUID>", text)
    text = re.sub(r"\b\d+\b", "#", text)
    return text.strip()


def normalize_url(url):
    try:
        parts = urlsplit(url)
        path = re.sub(r"/\d+", "/#", parts.path)
        return f"{parts.scheme}://{parts.netloc}{path}"
    except Exception:
        return str(url)[:120]


def safe_sig_name(sig):
    return re.sub(r"[^a-zA-Z0-9_.-]+", "_", sig)[:80]


async def record_finding(w, signature, detail, page=None, action=None):
    global SIG_FIRST, SIG_COUNT
    worker_id = w["id"]
    iter_num = w.get("iter", 0)
    seed = w.get("seed")
    action = action or w.get("current_action", "?")
    url = None
    if page is not None:
        try:
            url = page.url
        except Exception:
            url = None
    async with FINDINGS_LOCK:
        first = signature not in SIG_FIRST
        SIG_COUNT[signature] += 1
        count = SIG_COUNT[signature]
        if first:
            SIG_FIRST[signature] = {
                "worker": worker_id, "iter": iter_num, "action": action,
                "detail": str(detail)[:300], "url": url,
            }
        do_write = count <= MAX_FINDINGS_PER_SIGNATURE
        if do_write and FINDINGS_FH is not None:
            rec = {
                "ts": round(time.time(), 3), "worker": worker_id, "iter": iter_num,
                "seed": seed, "action": action, "signature": signature,
                "detail": str(detail)[:500], "url": url, "occurrence": count,
            }
            FINDINGS_FH.write(json.dumps(rec) + "\n")
            FINDINGS_FH.flush()
    if first and page is not None:
        fname = ANOM_DIR / f"{safe_sig_name(signature)}_{worker_id}_{iter_num}.png"
        try:
            await page.screenshot(path=str(fname), timeout=4000)
        except Exception:
            pass
    return count


# ---------------------------------------------------------------------------
# Invariant checks (combined into one page.evaluate for cheapness)
# ---------------------------------------------------------------------------
INVARIANT_JS = r"""
() => {
  const out = {};
  const de = document.documentElement;
  out.overflowX = de.scrollWidth - window.innerWidth;

  const root = document.getElementById('root');
  out.rootEmpty = !root || root.children.length === 0;

  const live = document.querySelector('[aria-live="polite"]');
  out.matchCountText = live ? live.textContent.trim() : null;

  const text = (root ? root.innerText : document.body.innerText) || '';
  const badMatch = text.match(/\bundefined\b|\bNaN\b|\[object Object\]/);
  out.badText = badMatch ? badMatch[0] : null;
  if (badMatch) {
    const idx = text.indexOf(badMatch[0]);
    out.badTextContext = text.slice(Math.max(0, idx - 40), idx + 40).replace(/\s+/g, ' ');
  }

  const overflowingPopovers = [];
  // '[class*="_pop_"]' catches PatternFeedbackChip's compact "..." popover
  // (its CSS-module class compiles to literally "_pop_<hash>") — it carries
  // no ARIA role, so the role selector alone would miss it. This is the
  // recently-fixed gold-chip-in-ticker-cell area (commits 3eacf47de/90a02d892)
  // — watched deliberately, not incidentally.
  document.querySelectorAll('[role="dialog"], [role="menu"], [class*="_pop_"]').forEach(el => {
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') return;
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return;
    const label = el.getAttribute('aria-label') || el.getAttribute('role') || 'pattern-feedback-popover';
    if (r.right > window.innerWidth + 8 || r.bottom > window.innerHeight + 8) {
      overflowingPopovers.push({
        label, right: Math.round(r.right), bottom: Math.round(r.bottom),
        vw: window.innerWidth, vh: window.innerHeight,
      });
    }
  });
  out.overflowingPopovers = overflowingPopovers;

  // PatternFeedbackChip wrap-regression watch: its compact root is a
  // CSS-module class compiling to literally "_compact_<hash>", flex-wrap:
  // nowrap by design after the fix. If its children ever land on two
  // different lines again, that IS the original defect (gold artifacts
  // wrapping into the next 30px grid row) coming back.
  const wrappedChips = [];
  document.querySelectorAll('[class*="_compact_"]').forEach(el => {
    const kids = [...el.children].filter(k => {
      const r = k.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    });
    if (kids.length < 2) return;
    const tops = kids.map(k => Math.round(k.getBoundingClientRect().top));
    if (Math.max(...tops) - Math.min(...tops) > 4) {
      wrappedChips.push({ childCount: kids.length, tops });
    }
  });
  out.wrappedPatternChips = wrappedChips.slice(0, 5);

  const testids = [...document.querySelectorAll('[data-testid^="scan-chip-"]')]
    .map(e => e.getAttribute('data-testid'));
  const seenT = new Set(); const dupTestids = new Set();
  testids.forEach(t => { if (seenT.has(t)) dupTestids.add(t); seenT.add(t); });
  out.dupScanChipTestids = [...dupTestids];

  const headers = [...document.querySelectorAll('[role="columnheader"]')]
    .map(e => e.textContent.replace(/[↓↑]/g, '').trim())
    .filter(Boolean);
  const seenH = new Map(); const dupHeaders = new Set();
  headers.forEach(h => seenH.set(h, (seenH.get(h) || 0) + 1));
  seenH.forEach((c, h) => { if (c > 1) dupHeaders.add(h); });
  out.dupHeaders = [...dupHeaders];

  const activeTab = document.querySelector('[role="tab"][aria-selected="true"]');
  out.activeView = activeTab ? activeTab.textContent.trim() : null;

  let totalNonTickerCells = 0, blankCells = 0;
  document.querySelectorAll('[role="row"]').forEach(row => {
    const cells = row.querySelectorAll('[role="cell"]');
    if (cells.length <= 1) return;
    for (let i = 1; i < cells.length; i++) {
      totalNonTickerCells++;
      if (cells[i].textContent.trim() === '') blankCells++;
    }
  });
  out.blankViewSample = totalNonTickerCells;
  out.blankViewCandidate = !!(out.activeView && out.activeView !== 'Overview'
    && totalNonTickerCells >= 5 && blankCells === totalNonTickerCells);

  const zeroNameSigs = new Set();
  document.querySelectorAll('button').forEach(b => {
    const style = window.getComputedStyle(b);
    if (style.display === 'none' || style.visibility === 'hidden') return;
    const name = (b.getAttribute('aria-label') || b.textContent || '').replace(/\s+/g, ' ').trim();
    if (!name) {
      const cls = (b.className && b.className.toString) ? b.className.toString().split(' ')[0] : '';
      zeroNameSigs.add(cls || 'button[no-class]');
    }
  });
  out.zeroNameSigs = [...zeroNameSigs];

  return out;
}
"""

STATE_SYNC_JS = r"""
() => {
  const btn = [...document.querySelectorAll('button')]
    .find(b => /^Filters(\s.\s\d+)?$/.test(b.textContent.trim()));
  let railCount = null;
  if (btn) {
    const m = btn.textContent.match(/(\d+)\s*$/);
    railCount = m ? parseInt(m[1], 10) : 0;
  }
  const usp = new URLSearchParams(window.location.search);
  const s = usp.get('s');
  let urlCount = 0, decodeError = false;
  if (s) {
    try {
      const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
      const json = decodeURIComponent(escape(atob(b64)));
      const p = JSON.parse(json);
      urlCount = (p && p.f) ? Object.keys(p.f).length : 0;
    } catch (e) { decodeError = true; }
  }
  return { railCount, urlCount, decodeError, s };
}
"""


async def check_invariants(w):
    page = w["page"]
    try:
        out = await page.evaluate(INVARIANT_JS)
    except Exception as e:
        await record_finding(w, "action_error:invariant_eval_failed", str(e)[:200], page=page)
        return

    if out.get("overflowX", 0) > 1:
        await record_finding(w, "layout_overflow",
                              f"overflowX={out['overflowX']}px view={out.get('activeView')}", page=page)
    if out.get("rootEmpty"):
        await record_finding(w, "root_empty", "React #root has zero children", page=page)

    mct = out.get("matchCountText")
    if mct is None:
        await record_finding(w, "match_count_missing", "no [aria-live=polite] element found", page=page)
    elif mct != "Scanning…" and not re.match(r"^[\d,]+\s+matches$", mct):
        await record_finding(w, "match_count_invalid", f"text='{mct}'", page=page)

    if out.get("badText"):
        await record_finding(w, f"bad_text:{out['badText']}", out.get("badTextContext", ""), page=page)

    for p in out.get("overflowingPopovers", []):
        await record_finding(w, f"popover_overflow:{p.get('label')}", json.dumps(p), page=page)

    if out.get("wrappedPatternChips"):
        await record_finding(w, "pattern_feedback_chip_wrapped",
                              f"PatternFeedbackChip compact chip wrapped onto multiple lines "
                              f"(the fixed gold-artifact defect, commits 3eacf47de/90a02d892): "
                              f"{out['wrappedPatternChips']}", page=page)

    if out.get("dupScanChipTestids"):
        await record_finding(w, "duplicate_scan_chip_testid", out["dupScanChipTestids"], page=page)

    if out.get("dupHeaders"):
        await record_finding(w, "duplicate_column_header", out["dupHeaders"], page=page)

    if out.get("blankViewCandidate"):
        await record_finding(w, f"blank_view:{out.get('activeView')}",
                              f"sample={out.get('blankViewSample')}", page=page)

    for sig in out.get("zeroNameSigs", []):
        await record_finding(w, f"zero_a11y_name:{sig}", "button with no accessible name", page=page)


async def check_state_sync(w):
    page = w["page"]
    await page.wait_for_timeout(550)  # let the 400ms URL-write debounce flush
    try:
        out = await page.evaluate(STATE_SYNC_JS)
    except Exception:
        return
    if out.get("decodeError"):
        await record_finding(w, "state_desync:url_decode_error", out.get("s"), page=page)
        return
    rc, uc = out.get("railCount"), out.get("urlCount")
    if rc is not None and rc != uc:
        await record_finding(w, "state_desync:filter_count_mismatch",
                              f"railCount={rc} urlCount={uc} s={out.get('s')}", page=page)


async def drain_events(w):
    while w["console_ptr"] < len(w["console_buf"]):
        msg = w["console_buf"][w["console_ptr"]]
        w["console_ptr"] += 1
        if any(p.search(msg) for p in IGNORE_CONSOLE_RE):
            continue
        sig = f"console_error:{normalize(msg)[:100]}"
        await record_finding(w, sig, msg, page=w.get("page"))

    while w["pageerror_ptr"] < len(w["pageerror_buf"]):
        msg = w["pageerror_buf"][w["pageerror_ptr"]]
        w["pageerror_ptr"] += 1
        sig = f"pageerror:{normalize(msg)[:100]}"
        await record_finding(w, sig, msg, page=w.get("page"))

    while w["netfail_ptr"] < len(w["netfail_buf"]):
        url, errtext = w["netfail_buf"][w["netfail_ptr"]]
        w["netfail_ptr"] += 1
        if errtext in IGNORE_NETFAIL_ERRTEXT:
            continue
        sig = f"network_fail:{errtext}:{normalize_url(url)}"
        await record_finding(w, sig, f"{url} -> {errtext}", page=w.get("page"))


# ---------------------------------------------------------------------------
# Auth
# ---------------------------------------------------------------------------
INTRO_SEL = '[role="dialog"][aria-label="Welcome"]'


async def dismiss_intro(page):
    """Dismiss the cinematic intro overlay after a full navigation/reload —
    mirrors tools/mobile_audit.py's `_dismiss_intro`. EVERY full page load
    (initial visit, reload, or a Playwright `goto`/`go_back`/`go_forward` —
    all of which are real browser navigations, not SPA pushState) remounts
    <App/> and replays the ~9.3s intro (App.jsx). An undismissed intro sits on
    top of the real page: subsequent clicks/timeouts against covered controls
    would misreport as app defects when the app underneath is fine. VERIFY
    detached, never assume a click worked — the reduced-motion branch (which
    we request via context reduced_motion="reduce" for a short, predictable
    ~1.6s fade) has NO Skip button, it only dismisses via a click on the
    overlay itself or self-finishes.
    """
    for attempt in (
        lambda: page.click('[aria-label="Skip intro"]', timeout=800),
        lambda: page.click(INTRO_SEL, timeout=800),
        lambda: page.keyboard.press("Escape"),
    ):
        try:
            await attempt()
            await page.wait_for_timeout(250)
        except Exception:
            pass
        if await page.locator(INTRO_SEL).count() == 0:
            return
    try:
        await page.locator(INTRO_SEL).wait_for(state="detached", timeout=5000)
    except Exception:
        pass


async def do_login(page, base, email, password):
    for attempt in range(2):  # one retry past a 429 — the shared-IP rate-limit bucket
        try:
            resp = await page.request.post(
                f"{base}/api/auth/login",
                data={"email": email, "password": password},
                headers={"Content-Type": "application/json"},
            )
            if resp.status == 429 and attempt == 0:
                print(f"  ! login 429 for {email} — backing off 65s and retrying once", file=sys.stderr)
                await page.wait_for_timeout(65000)
                continue
            return resp.ok
        except Exception as e:
            print(f"  ! login failed for {email}: {e}", file=sys.stderr)
            return False
    return False


# ---------------------------------------------------------------------------
# Actions — each returns a short string describing what happened, or raises.
# The caller wraps every call in a timeout + try/except; a timeout/exception
# IS a finding, recorded by the loop.
# ---------------------------------------------------------------------------
async def _pick_and_set_filter(page, rng, scope):
    await scope.wait_for(state="visible", timeout=4000)
    selects = scope.locator("select")
    n = await selects.count()
    if n == 0:
        return "no-op: no selects visible"
    idx = rng.randrange(n)
    sel = selects.nth(idx)
    options = await sel.locator("option").all_text_contents()
    non_any = [o for o in options if o.strip() != "Any"]
    if not non_any:
        return "no-op: only Any option"
    choice = rng.choice(non_any)
    await sel.select_option(label=choice)
    await page.wait_for_timeout(150)
    return f"set select#{idx} -> '{choice}'"


async def ensure_sheet_open(page):
    rail = page.locator('[data-testid="filter-rail"]')
    if await rail.count() and await rail.first.is_visible():
        return
    toggle = page.get_by_role("button", name=re.compile(r"^Filters"))
    if await toggle.count():
        await toggle.first.click()
        await page.wait_for_timeout(300)


async def act_set_filter(w):
    page, rng = w["page"], w["rng"]
    scope = page.locator('[data-testid="filter-rail"]').first
    return await _pick_and_set_filter(page, rng, scope)


async def act_set_filter_sheet(w):
    page, rng = w["page"], w["rng"]
    await ensure_sheet_open(page)
    scope = page.locator('[data-testid="filter-rail"]').first
    result = await _pick_and_set_filter(page, rng, scope)
    if rng.random() < 0.4:
        apply_btn = page.get_by_role("button", name=re.compile(r"^Show results"))
        if await apply_btn.count():
            await apply_btn.first.click()
            await page.wait_for_timeout(200)
    return result


async def _type_and_clear_filter_search(page, scope, rng):
    box = scope.get_by_label("Find a filter")
    await box.click()
    words = ["ma", "vol", "rsi", "cap", "gap", "ea", "pe", "div", "adr", "atr", "rs", "macd", "beta"]
    text = rng.choice(words)[: rng.randint(2, 3)]
    await box.fill(text)
    await page.wait_for_timeout(200)
    await box.fill("")
    await page.wait_for_timeout(150)
    return f"typed '{text}' into filter search then cleared"


async def act_filter_search(w):
    page, rng = w["page"], w["rng"]
    scope = page.locator('[data-testid="filter-rail"]').first
    return await _type_and_clear_filter_search(page, scope, rng)


async def act_filter_search_sheet(w):
    page, rng = w["page"], w["rng"]
    await ensure_sheet_open(page)
    scope = page.locator('[data-testid="filter-rail"]').first
    return await _type_and_clear_filter_search(page, scope, rng)


async def act_remove_chip(w):
    page, rng = w["page"], w["rng"]
    chip_btns = page.locator('button[aria-label^="Remove "]')
    n = await chip_btns.count()
    if n == 0:
        return "no-op: no removable chips"
    if rng.random() < 0.25:
        clear_btn = page.get_by_role("button", name="Clear all")
        if await clear_btn.count():
            await clear_btn.first.click()
            await page.wait_for_timeout(200)
            return "clicked Clear all"
    idx = rng.randrange(n)
    label = await chip_btns.nth(idx).get_attribute("aria-label")
    await chip_btns.nth(idx).click()
    await page.wait_for_timeout(200)
    return f"removed chip: {label}"


async def act_switch_view(w):
    page, rng = w["page"], w["rng"]
    tabs = page.get_by_role("tab")
    n = await tabs.count()
    if n == 0:
        return "no-op: no view tabs found"
    idx = rng.randrange(n)
    label = (await tabs.nth(idx).inner_text()).strip()
    await tabs.nth(idx).click()
    await page.wait_for_timeout(300)
    return f"view -> {label}"


async def act_sort_header(w):
    page, rng = w["page"], w["rng"]
    if rng.random() < 0.2:
        live_btn = page.get_by_role("button", name=re.compile(r"Re-sort loaded rows live"))
        if await live_btn.count():
            await live_btn.first.click()
            await page.wait_for_timeout(150)
            return "toggled live-sort chip"
    headers = page.locator('[role="columnheader"] button')
    n = await headers.count()
    if n == 0:
        return "no-op: no sortable headers (not grid view)"
    idx = rng.randrange(n)
    label = (await headers.nth(idx).inner_text()).strip()
    await headers.nth(idx).click()
    await page.wait_for_timeout(150)
    return f"clicked sort header '{label}'"


async def act_columns_picker(w):
    page, rng = w["page"], w["rng"]
    btn = page.get_by_role("button", name="Choose columns")
    if not await btn.count():
        return "no-op: Columns button not found"
    await btn.click()
    await page.wait_for_timeout(200)
    picker = page.locator('[role="dialog"][aria-label="Choose columns"]')
    if not await picker.count():
        return "opened Columns but dialog not found"
    op = rng.random()
    if op < 0.55:
        boxes = picker.locator("input[type=\"checkbox\"]:not([disabled])")
        n = await boxes.count()
        if n:
            idx = rng.randrange(n)
            await boxes.nth(idx).click()
            result = f"toggled column checkbox #{idx}"
        else:
            result = "no toggleable columns"
    elif op < 0.75:
        reset_btn = picker.get_by_role("button", name="Reset to view")
        await reset_btn.click()
        result = "reset columns to view"
    else:
        result = "left picker open briefly"
    if rng.random() < 0.7:
        close_btn = picker.get_by_role("button", name="Close column picker")
        if await close_btn.count():
            await close_btn.click()
    await page.wait_for_timeout(150)
    return result


async def act_scroll_more(w):
    page = w["page"]
    rng = w["rng"]
    scroller = page.locator("[data-density]")
    if not await scroller.count():
        scroller = page.locator('[class*="cardsScroll"]')
    if not await scroller.count():
        return "no-op: no scrollable results container (charts view?)"
    n_pages = rng.randint(1, 3)
    for _ in range(n_pages):
        try:
            await scroller.first.evaluate("el => el.scrollTop = el.scrollHeight")
        except Exception:
            break
        await page.wait_for_timeout(400)
    return f"scrolled results {n_pages}x"


async def act_csv_export(w):
    page = w["page"]
    btn = page.get_by_role("button", name=re.compile(r"^(CSV|Exporting…)$"))
    if not await btn.count():
        return "no-op: CSV button not found"
    await btn.first.click()
    try:
        await page.wait_for_selector('[role="status"]', timeout=5000)
        note = (await page.locator('[role="status"]').first.inner_text()).strip()
    except Exception:
        note = "(no status note appeared within 5s)"
    return f"csv export -> {note}"


async def act_nav_roundtrip(w):
    page, rng, base = w["page"], w["rng"], w["base"]
    choice = rng.choice(["charts_back", "browser_back_forward", "reload"])
    before = page.url
    # Every branch below is a REAL browser navigation (goto/go_back/go_forward/
    # reload all remount <App/>), so the cinematic intro replays after each one
    # — dismiss_intro() after every leg, or later actions in this same
    # iteration will click a covered intro instead of the real page.
    if choice == "charts_back":
        await page.goto(f"{base}/charts", wait_until="domcontentloaded", timeout=6000)
        await dismiss_intro(page)
        await page.wait_for_timeout(300)
        await page.go_back(wait_until="domcontentloaded", timeout=6000)
        await dismiss_intro(page)
        await page.wait_for_timeout(300)
    elif choice == "browser_back_forward":
        await page.go_back(wait_until="domcontentloaded", timeout=6000)
        await dismiss_intro(page)
        await page.wait_for_timeout(200)
        await page.go_forward(wait_until="domcontentloaded", timeout=6000)
        await dismiss_intro(page)
        await page.wait_for_timeout(300)
    else:
        await page.reload(wait_until="domcontentloaded", timeout=6000)
        await dismiss_intro(page)
        await page.wait_for_timeout(400)
    return f"{choice}: {before} -> {page.url}"


async def act_ticker_popup(w):
    page, rng = w["page"], w["rng"]
    trigger = page.locator('[aria-label^="View chart for "]')
    n = await trigger.count()
    if n == 0:
        return "no-op: no ticker triggers visible"
    idx = rng.randrange(min(n, 50))
    await trigger.nth(idx).click()
    dialog = page.locator('[role="dialog"][aria-label$=" chart"]')
    try:
        await dialog.first.wait_for(state="visible", timeout=3000)
    except Exception:
        return "clicked ticker but popup dialog never appeared"
    await page.keyboard.press("Escape")
    await page.wait_for_timeout(200)
    return "opened+closed ticker popup"


async def act_screens_menu(w):
    page, rng = w["page"], w["rng"]
    menu_btn = page.get_by_role("button", name="Screens ▾")
    if not await menu_btn.count():
        return "no-op: Screens button not found"
    await menu_btn.click()
    pop = page.locator('[role="menu"]')
    try:
        await pop.first.wait_for(state="visible", timeout=3000)
    except Exception:
        return "clicked Screens but menu never opened"

    buttons = pop.locator("button")
    n = await buttons.count()
    infos = []
    for i in range(n):
        b = buttons.nth(i)
        try:
            aria = await b.get_attribute("aria-label")
            text = (await b.inner_text()).strip()
        except Exception:
            aria, text = None, ""
        infos.append({"i": i, "aria": aria, "text": text})

    op = rng.random()
    result = "opened menu, no sub-action"
    try:
        if op < 0.12:
            name_input = pop.get_by_placeholder("Name this screen…")
            uniq = f"stress_{rng.randint(100000, 999999)}"
            await name_input.fill(uniq)
            save_btn = pop.get_by_role("button", name="Save current")
            await save_btn.click()
            result = f"saved new screen '{uniq}'"
            await page.wait_for_timeout(400)
        elif op < 0.22:
            renamers = [x for x in infos if x["aria"] and x["aria"].startswith("Rename ")]
            if renamers:
                pick = rng.choice(renamers)
                await buttons.nth(pick["i"]).click()
                inp = pop.locator(":focus")
                newname = f"renamed_{rng.randint(1000, 9999)}"
                await inp.fill(newname)
                await inp.press("Enter")
                result = f"renamed '{pick['aria']}' -> {newname}"
            else:
                result = "no renamers available"
        elif op < 0.30:
            deleters = [x for x in infos if x["aria"] and x["aria"].startswith("Delete ")]
            if deleters:
                pick = rng.choice(deleters)
                await buttons.nth(pick["i"]).click()
                result = f"deleted '{pick['aria']}'"
            else:
                result = "no deletable screens"
        elif op < 0.45:
            sharers = [x for x in infos if x["aria"] and x["aria"].startswith("Share ")]
            if sharers:
                pick = rng.choice(sharers)
                await buttons.nth(pick["i"]).click()
                await page.wait_for_timeout(250)
                pub_btn = pop.get_by_role("button", name=re.compile("Publish a share link"))
                unpub_btn = pop.get_by_role("button", name=re.compile("Unpublish"))
                if await pub_btn.count():
                    await pub_btn.click()
                    await page.wait_for_timeout(300)
                    if await unpub_btn.count():
                        await unpub_btn.click()
                        result = f"published+unpublished '{pick['aria']}'"
                    else:
                        result = f"published '{pick['aria']}' (no unpublish button found)"
                elif await unpub_btn.count():
                    await unpub_btn.click()
                    result = f"unpublished '{pick['aria']}'"
                else:
                    result = f"opened share panel for '{pick['aria']}'"
            else:
                result = "no shareable screens"
        elif op < 0.55:
            users = [x for x in infos if x["aria"] and x["aria"].startswith("Use ") and x["aria"].endswith(" as filter")]
            if users:
                pick = rng.choice(users)
                await buttons.nth(pick["i"]).click()
                result = f"used scan as filter: {pick['aria']}"
                await page.wait_for_timeout(200)
            else:
                result = "no scans to use as filter"
        elif op < 0.60:
            # open a scan's definition detail (My-scans row name toggle)
            toggles = [x for x in infos if not x["aria"] and x["text"]
                       and x["text"] not in ("Save current",)]
            if toggles:
                pick = rng.choice(toggles)
                await buttons.nth(pick["i"]).click()
                await page.wait_for_timeout(300)
                result = f"toggled '{pick['text']}'"
            else:
                result = "no toggleable rows"
        elif op < 0.80:
            namers = [x for x in infos if not x["aria"] and x["text"] and x["text"] != "Save current"]
            if namers:
                pick = rng.choice(namers)
                await buttons.nth(pick["i"]).click()
                result = f"clicked screens-menu item '{pick['text']}'"
            else:
                result = "no name buttons found"
    except Exception as e:
        result = f"sub-action raised: {e}"

    await page.wait_for_timeout(200)
    try:
        pop_still = page.locator('[role="menu"]')
        if await pop_still.count() and await pop_still.first.is_visible():
            await page.mouse.click(5, 5)
    except Exception:
        pass
    return result


DESKTOP_ACTIONS = [
    ("set_filter", 20, act_set_filter, True),
    ("remove_chip", 8, act_remove_chip, True),
    ("switch_view", 12, act_switch_view, False),
    ("sort_header", 12, act_sort_header, False),
    ("columns_picker", 8, act_columns_picker, False),
    ("screens_menu", 12, act_screens_menu, True),
    ("scroll_more", 8, act_scroll_more, False),
    ("filter_search", 6, act_filter_search, False),
    ("csv_export", 3, act_csv_export, False),
    ("nav_roundtrip", 5, act_nav_roundtrip, True),
    ("ticker_popup", 6, act_ticker_popup, False),
]

PHONE_ACTIONS = [
    ("set_filter_sheet", 20, act_set_filter_sheet, True),
    ("remove_chip", 10, act_remove_chip, True),
    ("switch_view", 12, act_switch_view, False),
    ("columns_picker", 10, act_columns_picker, False),
    ("screens_menu", 12, act_screens_menu, True),
    ("scroll_more", 12, act_scroll_more, False),
    ("filter_search_sheet", 8, act_filter_search_sheet, False),
    ("csv_export", 4, act_csv_export, False),
    ("nav_roundtrip", 6, act_nav_roundtrip, True),
    ("ticker_popup", 6, act_ticker_popup, False),
]


# ---------------------------------------------------------------------------
# Worker
# ---------------------------------------------------------------------------
async def run_worker(browser, args, worker_id, total_iters):
    seed = 1000 + worker_id
    rng = random.Random(seed)
    vp_name = viewport_for(worker_id)
    vp = VIEWPORTS[vp_name]
    is_mobile_flag = vp_name == "phone"

    context = await browser.new_context(
        viewport={"width": vp["width"], "height": vp["height"]},
        is_mobile=is_mobile_flag,
        has_touch=vp_name in ("phone", "tablet"),
        reduced_motion="reduce",  # shortens the cinematic intro to a ~1.6s fade
    )
    context.set_default_timeout(ACTION_TIMEOUT_MS)

    w = {
        "id": worker_id, "seed": seed, "rng": rng, "viewport": vp_name,
        "base": args.base, "iter": 0, "actions": Counter(), "action_errors": 0,
        "recycles": 0,
    }

    async def new_page_and_attach():
        page = await context.new_page()
        page.set_default_timeout(ACTION_TIMEOUT_MS)
        w["console_buf"], w["console_ptr"] = [], 0
        w["pageerror_buf"], w["pageerror_ptr"] = [], 0
        w["netfail_buf"], w["netfail_ptr"] = [], 0

        def on_console(msg):
            try:
                if msg.type == "error":
                    w["console_buf"].append(msg.text)
            except Exception:
                pass

        def on_pageerror(exc):
            try:
                w["pageerror_buf"].append(getattr(exc, "message", str(exc)))
            except Exception:
                pass

        def on_requestfailed(req):
            try:
                errtext = req.failure or "unknown"
                w["netfail_buf"].append((req.url, errtext))
            except Exception:
                pass

        def on_response(resp):
            try:
                if resp.status >= 500:
                    w["netfail_buf"].append((resp.url, f"HTTP {resp.status}"))
            except Exception:
                pass

        page.on("console", on_console)
        page.on("pageerror", on_pageerror)
        page.on("requestfailed", on_requestfailed)
        page.on("response", on_response)
        w["page"] = page

    await new_page_and_attach()

    # Stagger login calls across workers — all 10 land on ONE rate-limit
    # bucket (client IP), and login is "5/minute" (see LOGIN_STAGGER_S note).
    if worker_id > 0:
        await asyncio.sleep(worker_id * LOGIN_STAGGER_S)

    email, password = ACCOUNTS[worker_id]
    login_ok = await do_login(w["page"], args.base, email, password)
    print(f"[worker {worker_id}] seed={seed} viewport={vp_name} account={email} login={'ok' if login_ok else 'FAILED'}")

    try:
        await w["page"].goto(f"{args.base}/screener", wait_until="domcontentloaded", timeout=15000)
        await dismiss_intro(w["page"])
        await w["page"].wait_for_timeout(1500)
    except Exception as e:
        await record_finding(w, "action_error:initial_nav_failed", str(e)[:200], page=w.get("page"))

    actions = PHONE_ACTIONS if vp_name == "phone" else DESKTOP_ACTIONS
    weights = [a[1] for a in actions]

    for i in range(1, total_iters + 1):
        w["iter"] = i
        name, _weight, fn, mutates = rng.choices(actions, weights=weights, k=1)[0]
        w["current_action"] = name
        wall_timeout = ACTION_WALL_TIMEOUT_OVERRIDE.get(name, ACTION_WALL_TIMEOUT_S)
        try:
            await asyncio.wait_for(fn(w), timeout=wall_timeout)
        except asyncio.TimeoutError:
            w["action_errors"] += 1
            await record_finding(w, f"action_error:{name}:timeout",
                                  f"action exceeded {wall_timeout}s", page=w.get("page"), action=name)
        except Exception as e:
            w["action_errors"] += 1
            await record_finding(w, f"action_error:{name}:{type(e).__name__}",
                                  str(e)[:200], page=w.get("page"), action=name)

        w["actions"][name] += 1

        try:
            await asyncio.wait_for(drain_events(w), timeout=5)
        except Exception:
            pass
        try:
            await asyncio.wait_for(check_invariants(w), timeout=5)
        except Exception:
            pass
        if mutates:
            try:
                await asyncio.wait_for(check_state_sync(w), timeout=3)
            except Exception:
                pass

        if i % PROGRESS_EVERY == 0:
            print(f"[worker {worker_id}] {i}/{total_iters} iterations complete "
                  f"(errors={w['action_errors']}, recycles={w['recycles']})")

        if i % RECYCLE_EVERY == 0 and i != total_iters:
            try:
                await w["page"].close()
            except Exception:
                pass
            try:
                await new_page_and_attach()
                await w["page"].goto(f"{args.base}/screener", wait_until="domcontentloaded", timeout=15000)
                await dismiss_intro(w["page"])
                await w["page"].wait_for_timeout(1200)
            except Exception as e:
                await record_finding(w, "action_error:recycle_nav_failed", str(e)[:200], page=w.get("page"))
            w["recycles"] += 1
            print(f"[worker {worker_id}] recycled page at iteration {i}")

    try:
        await context.close()
    except Exception:
        pass

    return {
        "worker": worker_id, "viewport": vp_name, "seed": seed,
        "iterations": w["iter"], "actions": dict(w["actions"]),
        "action_errors": w["action_errors"], "recycles": w["recycles"],
    }


# ---------------------------------------------------------------------------
# Planted-violation control — proves the harness can actually detect what it
# claims to detect, on a throwaway context/page, before the real run starts.
# ---------------------------------------------------------------------------
async def run_self_test(browser, args):
    ctx = await browser.new_context(viewport={"width": 1280, "height": 800})
    page = await ctx.new_page()
    results = {}
    try:
        await page.goto(f"{args.base}/screener", wait_until="domcontentloaded", timeout=15000)
        await page.wait_for_timeout(1000)

        await page.evaluate("""() => {
            const d = document.createElement('div');
            d.id = '__stress_test_overflow__';
            d.style.cssText = 'position:absolute;left:0;top:0;width:6000px;height:5px;';
            document.body.appendChild(d);
        }""")
        out = await page.evaluate(INVARIANT_JS)
        results["overflow"] = out.get("overflowX", 0) > 1
        await page.evaluate("document.getElementById('__stress_test_overflow__')?.remove()")

        await page.evaluate("""() => {
            const d = document.createElement('div');
            d.id = '__stress_test_badtext__';
            d.textContent = 'value is undefined here';
            (document.getElementById('root') || document.body).appendChild(d);
        }""")
        out2 = await page.evaluate(INVARIANT_JS)
        results["bad_text"] = out2.get("badText") is not None
        await page.evaluate("document.getElementById('__stress_test_badtext__')?.remove()")

        got = []
        page.on("console", lambda m: got.append(m.text) if m.type == "error" else None)
        await page.evaluate("console.error('__STRESS_TEST_PLANTED_ERROR__')")
        await page.wait_for_timeout(150)
        results["console_error"] = any("__STRESS_TEST_PLANTED_ERROR__" in t for t in got)

        await page.evaluate("""() => {
            const d = document.createElement('div');
            d.setAttribute('role', 'dialog');
            d.setAttribute('aria-label', '__stress_test_popover__');
            d.style.cssText = 'position:fixed;left:0;top:0;width:9000px;height:9000px;';
            document.body.appendChild(d);
        }""")
        out3 = await page.evaluate(INVARIANT_JS)
        results["popover_overflow"] = len(out3.get("overflowingPopovers", [])) > 0
        await page.evaluate("document.querySelector('[aria-label=\"__stress_test_popover__\"]')?.remove()")
    except Exception as e:
        print(f"[self-test] exception: {e}", file=sys.stderr)
        results["exception"] = str(e)
    finally:
        await ctx.close()
    return results


# ---------------------------------------------------------------------------
# Orchestration
# ---------------------------------------------------------------------------
def _quiet_orphaned_playwright_futures(loop, context):
    """A cancelled asyncio.wait_for() around a Playwright call can leave an
    internal protocol Future whose TimeoutError/TargetClosedError fires after
    nobody is awaiting it anymore (observed during the pilot: harmless noise
    at shutdown, not a real error — every REAL error in this harness is
    already captured via try/except -> record_finding inside the worker
    loop). Swallow only that shape; anything else goes to the default
    handler so a genuine bug is never silently eaten."""
    exc = context.get("exception")
    msg = context.get("message", "")
    if isinstance(exc, Exception) and ("Timeout" in type(exc).__name__
                                        or "TargetClosed" in type(exc).__name__
                                        or "Timeout" in msg or "TargetClosed" in msg):
        return
    loop.default_exception_handler(context)


# slowapi's /api/auth/signup ("3/minute") and /api/auth/login ("5/minute")
# limits are keyed by client IP (api/limiter.py) — every one of our 10
# accounts hits from this same loopback IP, so unpaced calls exhaust the
# bucket after 3 (signup) / 5 (login) requests and the rest 429. Pace both.
SIGNUP_SPACING_S = 21
LOGIN_STAGGER_S = 13


async def main_async(args):
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    ANOM_DIR.mkdir(parents=True, exist_ok=True)
    global FINDINGS_FH
    FINDINGS_FH = open(OUT_DIR / "findings.jsonl", "w", encoding="utf-8")
    asyncio.get_running_loop().set_exception_handler(_quiet_orphaned_playwright_futures)

    async with async_playwright() as pw:
        req_ctx = await pw.request.new_context()
        for idx, (email, password) in enumerate(ACCOUNTS):
            try:
                resp = await req_ctx.post(
                    f"{args.base}/api/auth/signup",
                    data={"email": email, "password": password, "display_name": email.split("@")[0]},
                    headers={"Content-Type": "application/json"},
                )
                print(f"signup {email}: HTTP {resp.status}")
            except Exception as e:
                print(f"signup {email} error: {e}")
            if idx < len(ACCOUNTS) - 1:
                await asyncio.sleep(SIGNUP_SPACING_S)
        await req_ctx.dispose()

        browser = await pw.chromium.launch(headless=not args.headed)

        self_test = await run_self_test(browser, args)
        control_ok = all(self_test.get(k) for k in ("overflow", "bad_text", "console_error", "popover_overflow"))
        print(f"[self-test] planted-violation control: {self_test} -> {'PASS' if control_ok else 'FAIL'}")

        start = time.time()
        tasks = [run_worker(browser, args, i, args.iters) for i in range(args.workers)]
        results = await asyncio.gather(*tasks, return_exceptions=True)
        elapsed = time.time() - start

        await browser.close()

    FINDINGS_FH.close()
    write_report(results, elapsed, self_test, control_ok, args)
    return results


def write_report(results, elapsed, self_test, control_ok, args):
    total_target = args.workers * args.iters
    total_done = sum(r["iterations"] for r in results if isinstance(r, dict))
    lines = []
    lines.append("# Screener UI Stress Test — Report")
    lines.append("")
    lines.append(f"Run date: {time.strftime('%Y-%m-%d %H:%M:%S')}")
    lines.append(f"Base URL: {args.base}")
    lines.append(f"Workers: {args.workers} · Target iterations/worker: {args.iters} · "
                 f"Target total: {total_target}")
    lines.append(f"**Total iterations completed: {total_done} / {total_target}**")
    lines.append(f"Wall clock: {elapsed/60:.1f} minutes ({elapsed:.0f}s)")
    lines.append("")
    lines.append("## Planted-violation control")
    lines.append("")
    lines.append("Before the real run, a throwaway browser context visited /screener and had four "
                  "violations injected directly into the live DOM (an overflowing element, an "
                  "`undefined`-bearing text node, a `console.error()` call, and an oversized "
                  "`role=\"dialog\"` popover), then removed. This proves the invariant checks below "
                  "can actually fire before trusting a zero-findings run.")
    lines.append("")
    lines.append(f"- Overflow detection: {'PASS' if self_test.get('overflow') else 'FAIL'}")
    lines.append(f"- Bad-text (`undefined`/NaN/[object Object]) detection: {'PASS' if self_test.get('bad_text') else 'FAIL'}")
    lines.append(f"- Console-error capture: {'PASS' if self_test.get('console_error') else 'FAIL'}")
    lines.append(f"- Popover-overflow detection: {'PASS' if self_test.get('popover_overflow') else 'FAIL'}")
    lines.append(f"- **Overall control: {'PASS' if control_ok else 'FAIL — treat a zero-findings run with suspicion'}**")
    lines.append("")
    lines.append("## Ignore lists in effect")
    lines.append("")
    lines.append("- Console errors matching: " + ", ".join(f"`{p.pattern}`" for p in IGNORE_CONSOLE_RE))
    lines.append("- Network `requestfailed` errorText ignored: " + ", ".join(f"`{e}`" for e in IGNORE_NETFAIL_ERRTEXT)
                  + " — these are near-exclusively caused by this harness's own aggressive "
                    "reload/back/forward/navigate actions cancelling in-flight fetches, not app defects.")
    lines.append("")
    lines.append("## Per-worker totals")
    lines.append("")
    lines.append("| Worker | Viewport | Seed | Iterations | Action errors | Recycles |")
    lines.append("|---|---|---|---|---|---|")
    action_totals = Counter()
    for r in results:
        if not isinstance(r, dict):
            lines.append(f"| ? | ? | ? | CRASHED | | {r!r} |")
            continue
        lines.append(f"| {r['worker']} | {r['viewport']} | {r['seed']} | {r['iterations']} | "
                      f"{r['action_errors']} | {r['recycles']} |")
        for k, v in r["actions"].items():
            action_totals[k] += v
    lines.append("")
    lines.append("## Actions by type (all workers)")
    lines.append("")
    lines.append("| Action | Count |")
    lines.append("|---|---|")
    for k, v in action_totals.most_common():
        lines.append(f"| {k} | {v} |")
    lines.append("")
    lines.append("## Deduped findings")
    lines.append("")
    lines.append("Screenshots are captured only for the FIRST occurrence of each signature. "
                  f"`findings.jsonl` logs up to {MAX_FINDINGS_PER_SIGNATURE} occurrences per "
                  "signature verbatim; the Occurrences column below is the TRUE total.")
    lines.append("")
    lines.append("| Signature | Occurrences | First seen (worker/iter/action) | Detail | Screenshot |")
    lines.append("|---|---|---|---|---|")
    for sig, count in SIG_COUNT.most_common():
        first = SIG_FIRST.get(sig, {})
        shot = ANOM_DIR / f"{safe_sig_name(sig)}_{first.get('worker')}_{first.get('iter')}.png"
        shot_rel = f"anomalies/{shot.name}" if shot.exists() else "(none)"
        detail = str(first.get("detail", "")).replace("|", "\\|")[:150]
        lines.append(f"| `{sig}` | {count} | w{first.get('worker')} / i{first.get('iter')} / "
                      f"{first.get('action')} | {detail} | {shot_rel} |")
    lines.append("")
    lines.append("## Candidate bugs vs environmental noise (triage)")
    lines.append("")
    lines.append("_TODO: filled in by hand after opening screenshots and reviewing findings.jsonl. "
                  "The local snapshot is stale (2026-08-12) and many columns are legitimately NULL "
                  "locally — em-dashes are DESIGNED null rendering, not bugs; missing my_scans for "
                  "definition-less accounts is designed; a data-empty column is not a UI defect._")
    lines.append("")
    REPORT_PATH = OUT_DIR / "report.md"
    REPORT_PATH.write_text("\n".join(lines), encoding="utf-8")
    print(f"\nReport written to {REPORT_PATH}")


def wait_for_health(base, timeout_s=180):
    deadline = time.time() + timeout_s
    while time.time() < deadline:
        try:
            with urllib.request.urlopen(f"{base}/api/health", timeout=5) as r:
                if r.status == 200:
                    return True
        except Exception:
            pass
        time.sleep(3)
    return False


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://localhost:8077")
    ap.add_argument("--workers", type=int, default=10)
    ap.add_argument("--iters", type=int, default=1150)
    ap.add_argument("--headed", action="store_true")
    args = ap.parse_args()

    print(f"Waiting for {args.base}/api/health ...")
    if not wait_for_health(args.base):
        print("BLOCKED: backend did not answer /api/health within 3 minutes")
        sys.exit(1)
    print("Backend is up.")

    asyncio.run(main_async(args))


if __name__ == "__main__":
    main()
