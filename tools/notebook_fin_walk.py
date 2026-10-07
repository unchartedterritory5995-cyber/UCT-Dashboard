"""Notebook finish program, lane WALK -- one independent, end-to-end, real-browser acceptance walk
of everything waves 12-15 add, as a new member meets it. Record: docs/notebook/fin-walk.md.

THREE CONFIGURATIONS, each on its own sandbox boot (scripts/hub_sandbox_boot.py through
`notebook_perf_harness.Sandbox`), its own EMPTY data dir, port 8132:

  c1  every Notebook flag OFF except those the ledger (docs/feature_flags.json) records as armed
      on web today. No wave 12-15 surface may appear anywhere, and the product must work
      (create a note, type, reload, find it, delete it).
  c2  c1's flags plus every wave 11-14 switch (formulas, template gallery, the fourteen wave-13
      switches, NOTEBOOK_GETTING_STARTED_ENABLED). Fresh empty account: first run, the sample
      notebook, the Get started list, the offer and What's new, every feature's main path, all
      tours at 1280 and 390, then the sample removed in one click.
      (tools/notebook_fin_walk_features.py holds the feature steps.)
  c3  dependency order: visual playbook without fingerprint, setups board without chart plan,
      review drafts without plan grading. Each must degrade with an honest message, not an error.

AT EVERY STEP the recorder stores: console errors, page errors, every response with status >= 400
(with URL), request AND response of every write the page made, horizontal overflow, controls under
the tap floor on touch widths, whether the app's error boundary rendered, and one screenshot.
R-RAW: walk.json is rewritten after every step, before any verdict is printed.

A step's verdict here is PASS / FAIL / NOT_RUN / INFO. PRODUCT versus INSTRUMENT is a judgement
made from the product's own answer afterwards and written in fin-walk.md; the tool never guesses it.

No ANTHROPIC / OPENAI key exists in a sandbox boot (the launcher blanks them): steps that need a
model are recorded NOT_RUN with reason "NO KEY", never as a pass or a fail.

Usage (PowerShell, or forward slashes through bash):
    python tools/notebook_fin_walk.py --config c1 --data-root C:/data-fin-walk --port 8132 \
        --out docs/notebook/evidence/fin-walk/<short-sha>
    ... --serve-only           boot the config's sandbox and hold it until <out>/STOP exists
    ... --attach --only a,b    run named steps against an already-held sandbox (development)

This driver never imports api.* in its own process. Never run on import.
"""
from __future__ import annotations

import argparse
import io
import json
import os
import re
import shutil
import subprocess
import sys
import time
import traceback
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
for _p in (REPO / "tools", REPO / "scripts"):
    if str(_p) not in sys.path:
        sys.path.insert(0, str(_p))

import notebook_perf_harness as h  # noqa: E402
import notebook_w14_onboarding_walk as w  # noqa: E402  -- probes, member factory
import notebook_w13x_walk as x13  # noqa: E402  -- PRE_CHILD (bars / transcript / intel seed), series

PORT = 8132            # this lane's port; 8134 is the fallback when 8132 is someone else's
PORTS = (8132, 8134)
WALK_FILE = "walk.json"   # a --serve-only process writes walk-serve.json, never a walk's own file
# The product's trading day is the ET day. A walk started late in the evening in another zone
# would otherwise date its trades "yesterday" and read an empty daily review as a finding.
from zoneinfo import ZoneInfo  # noqa: E402
TODAY = datetime.now(ZoneInfo("America/New_York")).date()
VIEWPORTS = {"1280": (1280, 800), "820": (820, 1180), "390": (390, 844)}
TOUCH_MAX = 1024
ERROR_BOUNDARY_TEXT = "Something went wrong on this page"
CAL_FILE = "fin-walk-sandbox-calendar.json"

# Sandbox degradation every lane's sandbox already serves (13X's list, reused, not widened).
BENIGN = ("/api/j2/broker/sync", "/api/stream/bars", "/api/live-prices", "warm=1", "/api/stream/prices")

# The seventeen switches waves 11-14 add and production has not armed. Read against the ledger at
# run time (`flag_sets`), so a name that is not a real flag refuses the run.
WAVE_FLAGS = [
    "NOTEBOOK_FORMULAS_ENABLED", "NOTEBOOK_TEMPLATE_GALLERY_ENABLED",
    "NOTEBOOK_TA_FINGERPRINT_ENABLED", "NOTEBOOK_PLAN_GRADING_ENABLED", "NOTEBOOK_ENTRY_CONTEXT_ENABLED",
    "NOTEBOOK_CHART_PLAN_ENABLED", "NOTEBOOK_VISUAL_PLAYBOOK_ENABLED", "NOTEBOOK_PLAYBOOK_ENABLED",
    "NOTEBOOK_SETUPS_BOARD_ENABLED", "NOTEBOOK_FIND_SIMILAR_ENABLED", "NOTEBOOK_EARNINGS_PREP_ENABLED",
    "NOTEBOOK_TRANSCRIPT_CAPTURE_ENABLED", "NOTEBOOK_PASSED_SETUPS_ENABLED",
    "AWARENESS_NOTE_RESURFACE_ENABLED", "NOTEBOOK_THESIS_CHIPS_ENABLED", "NOTEBOOK_REVIEW_DRAFTS_ENABLED",
    "NOTEBOOK_GETTING_STARTED_ENABLED",
]
# Armed in c2 for the meaning-search TOUR only (the tour lists only while its flag is on). The
# search itself needs an embedding key and is recorded NOT_RUN.
TOUR_ONLY_FLAGS = ["NOTEBOOK_SEMANTIC_SEARCH_ENABLED"]
# c3: the dependents ON, their prerequisites OFF.
C3_ON = ["NOTEBOOK_VISUAL_PLAYBOOK_ENABLED", "NOTEBOOK_SETUPS_BOARD_ENABLED", "NOTEBOOK_REVIEW_DRAFTS_ENABLED",
         "NOTEBOOK_GETTING_STARTED_ENABLED"]
C3_OFF = ["NOTEBOOK_TA_FINGERPRINT_ENABLED", "NOTEBOOK_CHART_PLAN_ENABLED", "NOTEBOOK_PLAN_GRADING_ENABLED"]
# Ledger-armed names that are jobs / infrastructure / a mode, not a member-facing gate: left unset.
NOT_MEMBER_GATES = {"NOTEBOOK_DOOR_GUARD", "J2_ATTACHMENT_BACKUP_ENABLED", "J2_ATTACHMENT_GC_ENABLED", "J2_OCR_ENABLED"}

REC: dict = {"tool": "tools/notebook_fin_walk.py", "steps": [], "configs": {}}
OUT: Path | None = None
STATE: dict = {}


# ── recorder ──────────────────────────────────────────────────────────────────────────────

def flush() -> None:
    if OUT is not None:
        tmp = OUT / (WALK_FILE + ".tmp")
        tmp.write_text(newline=chr(10), data=json.dumps(REC, indent=1, ensure_ascii=False, default=str), encoding="utf-8")
        os.replace(tmp, OUT / WALK_FILE)
        if WALK_FILE == "walk.json":
            (OUT / f"state-{REC.get('config', 'x')}.json").write_text(newline=chr(10), data=
                json.dumps({**STATE, "tip": REC.get("tip")}, indent=1, default=str), encoding="utf-8")


PROBE_JS = r"""
(args) => {
  const [scopes, touch, boundaryText] = args
  const de = document.documentElement, vw = de.clientWidth
  const main = document.querySelector('[class*="_main_"]')
  const hScrollable = (e) => { for (let a = e; a && a !== document.body; a = a.parentElement) {
      const ox = getComputedStyle(a).overflowX; if ((ox === 'auto' || ox === 'scroll') && a.scrollWidth > a.clientWidth + 1 && a !== main) return true } return false }
  const offenders = []
  if (de.scrollWidth > vw + 1 || document.body.scrollWidth > vw + 1 || (main && main.scrollWidth > main.clientWidth + 1)) {
    for (const el of document.querySelectorAll('body *')) {
      const b = el.getBoundingClientRect()
      if (b.width > 0 && b.height > 0 && b.right > vw + 1 && !hScrollable(el)) {
        offenders.push({ tag: el.tagName, cls: String(el.className && el.className.baseVal !== undefined ? el.className.baseVal : (el.className || '')).slice(0, 50), right: Math.round(b.right),
                         label: (el.getAttribute('aria-label') || (el.children.length ? '' : el.textContent) || '').trim().slice(0, 40),
                         testid: el.getAttribute('data-testid') || el.getAttribute('data-tour') || null })
        if (offenders.length >= 6) break
      } } }
  const overflow = { vw, doc: de.scrollWidth, body: document.body.scrollWidth,
                     main: main ? [main.scrollWidth, main.clientWidth] : null,
                     mainOverflowX: main ? getComputedStyle(main).overflowX : null,
                     horizontal: de.scrollWidth > vw + 1 || document.body.scrollWidth > vw + 1 || (main ? main.scrollWidth > main.clientWidth + 1 : false),
                     offenders }
  let small = null
  if (touch) {
    const raw = getComputedStyle(de).getPropertyValue('--tap-min').trim()
    const tapMin = parseFloat(raw) || 44
    const roots = (scopes && scopes.length) ? scopes.flatMap(s => [...document.querySelectorAll(s)]) : [document.body]
    const seen = new Set(), rows = []
    let total = 0, inline = 0
    for (const r of roots) for (const el of r.querySelectorAll('button, a[href], [role=button], input:not([type=hidden]), select, textarea, summary')) {
      if (seen.has(el)) continue; seen.add(el)
      const b = el.getBoundingClientRect(); const cs = getComputedStyle(el)
      if (b.width <= 0 || b.height <= 0 || cs.visibility === 'hidden' || el.disabled) continue
      if (el.closest('[aria-hidden="true"]')) continue
      total++
      if (b.width + 0.5 >= tapMin && b.height + 0.5 >= tapMin) continue
      if (el.tagName === 'A' && cs.display === 'inline') { inline++; continue }
      const host = el.closest('[data-testid],[data-tour],[data-widget-embed-view],[data-chart-plan-panel],nav,header')
      rows.push({ label: (el.getAttribute('aria-label') || el.innerText || el.getAttribute('title') || el.tagName).trim().replace(/\s+/g, ' ').slice(0, 44),
                  tag: el.tagName, w: Math.round(b.width), h: Math.round(b.height),
                  host: host ? (host.getAttribute('data-testid') || host.getAttribute('data-tour') || host.tagName.toLowerCase() + (host.hasAttribute('data-widget-embed-view') ? ':embed' : '')) : null })
    }
    small = { tapMin, scoped: !!(scopes && scopes.length), scope_matched: roots.length, controls: total, inline_links: inline,
              under: rows.length, sample: rows.slice(0, 30) }
  }
  const boundary = (document.body.innerText || '').includes(boundaryText)
  return { overflow, small, error_boundary: boundary, url: location.pathname + location.search }
}
"""


class Inst:
    """One browser context's instrumentation. Events land in the CURRENT step's buckets."""

    def __init__(self, ctx, config: str, vp: str):
        self.ctx, self.config, self.vp = ctx, config, vp
        self.touch = VIEWPORTS[vp][0] <= TOUCH_MAX
        self._reset()
        ctx.on("page", self._attach)
        for pg in ctx.pages:
            self._attach(pg)
        ctx.on("response", self._on_response)
        # A response body is read only once its request has FINISHED: `response.text()` has no
        # timeout, and on a response that is still streaming it blocks the walk for good.
        self._finished: set = set()
        ctx.on("requestfinished", lambda req: self._finished.add(id(req)))
        ctx.on("requestfailed", lambda req: self._finished.add(id(req)))

    def _reset(self):
        self.console, self.page_errors, self.failed, self.pending_writes = [], [], [], []
        self.pending_fail_bodies = []

    def _attach(self, pg):
        pg.on("pageerror", lambda e: self.page_errors.append(str(e)[:400]))
        pg.on("console", lambda m: self.console.append(m.text[:300]) if m.type == "error" else None)

    def _on_response(self, r):
        try:
            req = r.request
            url = r.url
            path = re.sub(r"^https?://[^/]+", "", url)[:200]
            if r.status >= 400:
                row = {"status": r.status, "method": req.method, "url": path, "benign": any(b in url for b in BENIGN)}
                # By design, stated in FingerprintPanel.jsx's header: the freeze route answers 404
                # until the note's save has landed, and the panel retries. Kept out of the
                # unexpected list, but counted by name so a freeze that NEVER lands still shows.
                if r.status == 404 and "/notebook-fingerprint/blocks/" in url and url.endswith("/freeze"):
                    row["benign"], row["by_design"] = True, "freeze before the save landed (retried)"
                self.failed.append(row)
                if not row["benign"]:
                    self.pending_fail_bodies.append((req, r, row))
            if req.method in ("POST", "PUT", "PATCH", "DELETE") and "/api/" in url:
                self.pending_writes.append((req, r, path))
        except Exception:  # noqa: BLE001 -- an event handler must never raise into the walk
            pass

    def drain(self) -> dict:
        writes = []
        for req, r, path in self.pending_writes[:60]:
            try:
                body = (req.post_data or "")[:1500]
            except Exception as e:  # noqa: BLE001
                body = f"(request body unavailable: {type(e).__name__})"
            if id(req) not in self._finished:
                resp = "(response still in flight when the step ended: body not read)"
            else:
                try:
                    resp = (r.text() or "")[:1500]
                except Exception as e:  # noqa: BLE001
                    resp = f"(response body unavailable: {type(e).__name__})"
            writes.append({"method": req.method, "url": path, "status": r.status, "request": body, "response": resp})
        for req, r, row in self.pending_fail_bodies[:20]:
            if id(req) in self._finished:
                try:
                    row["body"] = (r.text() or "")[:400]
                except Exception as e:  # noqa: BLE001
                    row["body"] = f"(unavailable: {type(e).__name__})"
        out = {"console_errors": self.console[:40], "page_errors": self.page_errors[:20],
               "failed_requests": self.failed[:80], "writes": writes}
        self._reset()
        return out


def snap(pg, name: str, full: bool = False) -> str | None:
    try:
        from PIL import Image
        png = pg.screenshot(timeout=10000, full_page=full)
        im = Image.open(io.BytesIO(png)).convert("RGB")
        if im.width > 700:
            im = im.resize((700, int(im.height * 700 / im.width)))
        if im.height > 2400:
            im = im.crop((0, 0, im.width, 2400))
        im = im.quantize(colors=64)
        dest = OUT / "shots" / (re.sub(r"[^A-Za-z0-9_.-]+", "-", name) + ".png")
        dest.parent.mkdir(parents=True, exist_ok=True)
        im.save(dest, optimize=True)
        return dest.name
    except Exception as e:  # noqa: BLE001
        return f"(screenshot failed: {type(e).__name__}: {str(e)[:100]})"


def step(pg, inst: Inst, feature: str, name: str, verdict: str, *, scope: list[str] | None = None,
         shot: bool = True, **facts) -> dict:
    """Record one step. `verdict`: PASS / FAIL / NOT_RUN / INFO."""
    probe = None
    if pg is not None:
        try:
            probe = pg.evaluate(PROBE_JS, [scope or [], inst.touch, ERROR_BOUNDARY_TEXT])
        except Exception as e:  # noqa: BLE001 -- a navigation mid-probe
            probe = {"error": f"{type(e).__name__}: {str(e)[:160]}"}
    row = {"tip": REC.get("tip"), "config": inst.config, "viewport": inst.vp, "feature": feature, "step": name, "verdict": verdict,
           "at": datetime.now(timezone.utc).isoformat(timespec="seconds"), **facts}
    if probe:
        row.update(probe)
    row.update(inst.drain())
    if pg is not None and inst.config == "c2" and "surfaces_present" not in row:
        row["surfaces_present"] = census(pg)   # the control for c1's absence checks
    if shot and pg is not None:
        row["screenshot"] = snap(pg, f"{inst.config}-{inst.vp}-{feature}-{name}")
    REC["steps"].append(row)
    unexpected = [f for f in row.get("failed_requests", []) if not f["benign"]]
    flags = []
    if row.get("error_boundary"):
        flags.append("ERROR-BOUNDARY")
    if row.get("page_errors"):
        flags.append(f"pageerrors={len(row['page_errors'])}")
    if unexpected:
        flags.append("http=" + ",".join(f"{f['status']} {f['url'][:50]}" for f in unexpected[:3]))
    if (row.get("overflow") or {}).get("horizontal"):
        flags.append("OVERFLOW")
    if (row.get("small") or {}).get("under"):
        flags.append(f"small={row['small']['under']}")
    short = {k: (v[:90] if isinstance(v, str) else v) for k, v in facts.items()
             if isinstance(v, (str, int, float, bool, type(None))) and k not in ("page_text", "traceback", "path")}
    print(f"{verdict:<7} [{inst.config} {inst.vp}] {feature}: {name} {json.dumps(short, default=str, ensure_ascii=True)[:300]} {' '.join(flags)}",
          flush=True)
    flush()
    return row


def guarded(pg_getter, inst_getter, feature: str):
    """A step function that raises is recorded as FAIL with its traceback, never lost, and the
    walk goes on. Whether that FAIL is the product's or the instrument's is decided afterwards."""
    def wrap(fn):
        def inner(*a, **kw):
            try:
                return fn(*a, **kw)
            except Exception as e:  # noqa: BLE001
                pg, inst = pg_getter(), inst_getter()
                step(pg, inst, feature, f"{fn.__name__} (driver exception)", "FAIL",
                     error=f"{type(e).__name__}: {str(e)[:500]}", traceback=traceback.format_exc()[-1500:])
        return inner
    return wrap


def api(ctx, inst: Inst, method: str, base: str, path: str, data=None) -> tuple[int, object]:
    """A write the walk makes as the member through the product's own route. Recorded with its
    request and response in REC['api_writes'] (the page never saw it)."""
    fn = getattr(ctx.request, method.lower())
    r = fn(base + path, data=data) if data is not None else fn(base + path)
    try:
        body = r.json()
    except Exception:  # noqa: BLE001
        body = (r.text() or "")[:600]
    if method.upper() != "GET":
        REC.setdefault("api_writes", []).append({
            "config": inst.config, "viewport": inst.vp, "method": method.upper(), "url": path, "status": r.status,
            "request": json.dumps(data, default=str)[:1500] if data is not None else None,
            "response": json.dumps(body, default=str)[:1500]})
    return r.status, body


def goto(pg, base: str, path: str, wait: str | None = None, timeout: int = 60000) -> None:
    pg.goto(base + path, wait_until="domcontentloaded", timeout=timeout)
    h._dismiss_intro(pg)
    if wait:
        pg.locator(wait).first.wait_for(state="visible", timeout=timeout)


def vis(pg, selector: str, timeout: int = 15000) -> bool:
    try:
        pg.locator(selector).first.wait_for(state="visible", timeout=timeout)
        return True
    except Exception:  # noqa: BLE001
        return False


def vis_loc(loc, timeout: int = 15000) -> bool:
    try:
        loc.first.wait_for(state="visible", timeout=timeout)
        return True
    except Exception:  # noqa: BLE001
        return False


C_vis = vis_loc


def notes_list(ctx, base: str) -> list[dict]:
    r = ctx.request.get(base + "/api/j2/notes?limit=500")
    try:
        body = r.json()
    except Exception:  # noqa: BLE001
        return []
    return (body.get("notes") or body.get("items") or []) if isinstance(body, dict) else body


def new_ctx(browser, vp: str, storage=None):
    wd, ht = VIEWPORTS[vp]
    touch = wd <= TOUCH_MAX
    return browser.new_context(viewport={"width": wd, "height": ht}, has_touch=touch, is_mobile=touch,
                               reduced_motion="reduce", storage_state=storage)


def member(browser, admin_req, base: str, tag: str, vp: str):
    """A fresh paid-equivalent member. `w.fresh_member` raises SetupFailed when the account is not
    paid-equivalent: an unpaid account is redirected to /subscribe and every step would measure a
    redirect, so the config aborts instead."""
    wd, ht = VIEWPORTS[vp]
    ctx, email, me = w.fresh_member(browser, admin_req, base, tag, wd, ht)
    if not me.get("paid_equiv"):
        raise h.SetupFailed(f"{email} is not paid-equivalent")
    return ctx, email, me


def settle_first_run(pg) -> dict:
    """Close what a new member meets first, the way a member does. Returns what was there."""
    seen = {"base_tour": False, "compass": False}
    d = pg.locator("[role=dialog][aria-modal=true]")
    try:
        d.first.wait_for(state="visible", timeout=6000)
        if "Welcome to your Notebook" in (d.first.inner_text() or ""):
            seen["base_tour"] = True
            pg.keyboard.press("Escape")
            d.first.wait_for(state="hidden", timeout=5000)
    except Exception:  # noqa: BLE001
        pass
    return seen


# ── the absence census (c1) -- the same selectors c2 must find PRESENT ─────────────────────

SURFACES = {
    "capability_preview": ("text", "What your Notebook can do"),
    "get_started_list": ("heading", "Get started"),
    "tour_offer": ("css", "[data-tour-offer]"),
    "tour_card": ("css", "[data-tour-card]"),
    "tour_explainer": ("css", "[data-tour-explainer]"),
    "reporting_soon": ("css", "[data-reporting-soon]"),
    "passed_setups": ("css", "[data-passed-setups]"),
    "review_box_home": ("text", "Reviews that write themselves"),
    "fingerprint_panel": ("css", '[data-testid="fingerprint-panel"]'),
    "chart_plan_panel": ("css", "[data-chart-plan-panel]"),
    "chart_plan_button": ("embedbtn", "Plan"),
    "chart_replay_button": ("embedbtn", "Replay"),
    "visual_playbook": ("css", '[data-testid="visual-playbook"]'),
    "visual_playbook_door": ("button", "Visual playbook"),
    "entry_context_card": ("css", '[data-testid="entry-context-card"]'),
    "plan_grade_card": ("css", '[data-testid="plan-grade-card"]'),
    "trade_before_after": ("css", '[data-testid="trade-before-after"]'),
    "unplanned_chip": ("css", '[data-testid="unplanned-chip"]'),
    "thesis_chip": ("css", "[data-thesis-chip]"),
    "discipline_record": ("css", '[data-testid="discipline-record"]'),
    "discipline_tab": ("button", "Discipline"),
    "reviews_tab": ("button", "Reviews"),
    "review_drafts_section": ("css", '[data-testid="review-drafts-section"]'),
    "my_playbook_door": ("css", '[data-testid="open-my-playbook"]'),
    "my_playbook": ("css", '[data-testid="my-playbook"]'),
    "setups_board_card": ("css", "[data-board-card]"),
    "setups_board_heading": ("heading", "Active setups"),
    "find_similar_button": ("buttonprefix", "Find more like"),
    "gallery_door": ("button", "Browse the community gallery"),
    "transcript_door": ("button", "Save from a transcript"),
    "help_walkthroughs": ("text", "Walkthroughs"),
    "help_whats_new": ("css", "section[aria-labelledby='support-whats-new']"),
    "help_replay_links": ("link", "Replay"),
    "resurface_sheet": ("dialog", "What you wrote then"),
}

CENSUS_JS = r"""
(S) => {
  const vis = (e) => { const b = e.getBoundingClientRect(); const s = getComputedStyle(e);
                       return b.width > 0 && b.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' }
  // textContent, lower-cased: innerText follows CSS text-transform, so an upper-cased heading
  // would read as a different string and an absence check would pass on a present element
  const txt = (e) => (e.textContent || '').trim().replace(/\s+/g, ' ').toLowerCase()
  const out = {}
  for (const [key, [kind, v]] of Object.entries(S)) {
    let els = []
    if (kind === 'css') els = [...document.querySelectorAll(v)]
    else if (kind === 'text') els = [...document.querySelectorAll('h1,h2,h3,h4,h5,p,span,summary,legend,strong')].filter(e => txt(e) === v.toLowerCase())
    else if (kind === 'heading') els = [...document.querySelectorAll('h1,h2,h3,h4')].filter(e => txt(e) === v.toLowerCase())
    else if (kind === 'button') els = [...document.querySelectorAll('button,[role=button],[role=tab]')].filter(e => txt(e) === v.toLowerCase() || e.getAttribute('aria-label') === v)
    else if (kind === 'buttonprefix') els = [...document.querySelectorAll('button')].filter(e => (e.getAttribute('aria-label') || txt(e)).toLowerCase().startsWith(v.toLowerCase()))
    else if (kind === 'embedbtn') els = [...document.querySelectorAll('[data-widget-embed-view] button')].filter(e => txt(e) === v.toLowerCase() || e.getAttribute('aria-label') === v)
    else if (kind === 'link') els = [...document.querySelectorAll('a')].filter(e => txt(e).startsWith(v.toLowerCase()) || (e.getAttribute('aria-label') || '').toLowerCase().startsWith(v.toLowerCase()))
    else if (kind === 'dialog') els = [...document.querySelectorAll('[role=dialog]')].filter(e => e.getAttribute('aria-label') === v || txt(e).startsWith(v.toLowerCase()))
    const n = els.filter(vis).length
    if (n) out[key] = n
  }
  return out
}
"""


def census(pg) -> dict:
    try:
        return pg.evaluate(CENSUS_JS, SURFACES)
    except Exception as e:  # noqa: BLE001
        return {"__error__": str(e)[:160]}


# ── flags ─────────────────────────────────────────────────────────────────────────────────

def flag_sets() -> dict:
    """The three configurations' flag lists, derived: the gate names from api/routers/auth.py
    NOTEBOOK_FLAGS (source text, never imported), production's armed set from the ledger."""
    src = (REPO / "api" / "routers" / "auth.py").read_text(encoding="utf-8")
    block = src.split("NOTEBOOK_FLAGS = {", 1)[1].split("\n}\n", 1)[0]
    gates = {m.group(1): (m.group(2) == "True") for m in re.finditer(r'^\s+"([A-Z0-9_]+)":\s*(True|False)', block, re.M)}
    ledger = json.loads((REPO / "docs" / "feature_flags.json").read_text(encoding="utf-8"))["flags"]
    led = ledger if isinstance(ledger, dict) else {f.get("name"): f for f in ledger}
    armed = sorted(n for n, f in led.items() if isinstance(f, dict) and f.get("status") == "armed" and "web" in (f.get("where") or [])
                   and (n in gates or n == "COMPASS_NOTES_TOOL_ENABLED" or n == "NOTEBOOK_INBOUND_EMAIL_ENABLED")
                   and n not in NOT_MEMBER_GATES)
    unknown = [n for n in WAVE_FLAGS + TOUR_ONLY_FLAGS if n not in gates]
    armed_wave = [n for n in WAVE_FLAGS if n in armed]
    if unknown:
        raise h.SetupFailed(f"not a NOTEBOOK_FLAGS gate: {unknown}")
    every = sorted(set(gates) | set(armed) | set(led) & {n for n in led if n.startswith("NOTEBOOK_")})
    return {"gates": gates, "prod_armed": armed, "wave": WAVE_FLAGS, "armed_wave_flags_in_ledger": armed_wave,
            "all_names": every,
            "c1": armed, "c2": armed + WAVE_FLAGS + TOUR_ONLY_FLAGS,
            "c3": armed + C3_ON}


# ── seeding children (the driver itself never imports api.*) ───────────────────────────────

SYMS = {"SPY": (500.0, 0.01), "QQQ": (480.0, 0.012), "AAPL": (230.0, 0.03), "MSFT": (420.0, 0.03),
        "NVDA": (120.0, 0.05), "GOOGL": (170.0, 0.04), "TSLA": (250.0, 0.06), "AMZN": (190.0, 0.04),
        "AMD": (150.0, 0.06), "CRWD": (300.0, 0.05), "IBM": (200.0, 0.02)}

TRANSCRIPT = (
    "Operator: Good afternoon. Welcome to the Tesla third quarter call.\n"
    "Vaibhav Taneja: Revenue was a record, up 12% year over year. Automotive gross margin\n"
    "excluding credits was 17.1%, and energy storage deployments reached a new high.\n"
    "Elon Musk: Demand for the refreshed model is strong. We expect to grow deliveries next year.\n"
    "Analyst One: Can you talk about capital spending?\n"
    "Vaibhav Taneja: Capital spending stays above ten billion dollars this year.\n"
)


def seed_pre_boot(data_dir: Path, out: Path, d_report: date) -> None:
    spec = {
        "bars": {s: x13.weekday_series(TODAY, 90, b, a) for s, (b, a) in SYMS.items()},
        "transcript": {"symbol": "TSLA", "fy": 2026, "q": 3, "call_date": "2026-10-01", "content": TRANSCRIPT},
        "implied": [{"sym": sym, "report_date": d_report.isoformat(), "pct": 6.4, "dollar": 12.2,
                     "captured_at": datetime.now(timezone.utc).isoformat(timespec="seconds")} for sym in ("AMD", "AMZN")],
        "intel": x13.intel_payload("AMD", d_report.isoformat(), TODAY),
    }
    env = {k: v for k, v in os.environ.items() if not k.startswith("RAILWAY_")}
    r = subprocess.run([sys.executable, "-c", x13.PRE_CHILD, str(REPO), str(data_dir), json.dumps(spec)],
                       cwd=str(REPO), env=env, capture_output=True, text=True, encoding="utf-8", errors="replace",
                       timeout=900)
    (out / f"pre-seed-child-{REC.get('config')}.log").write_text(newline=chr(10), data=
        f"tip: {REC.get('tip')}\n" + (r.stdout or "")[-3000:] + "\n--- stderr ---\n" + (r.stderr or "")[-6000:], encoding="utf-8")
    if r.returncode != 0 or "SEEDED" not in (r.stdout or ""):
        raise h.SetupFailed(f"pre-boot seeding failed (rc {r.returncode}); see pre-seed-child log")


POST_CHILD = r'''
import json, sys, os
repo, data_dir, spec = sys.argv[1], sys.argv[2], json.loads(sys.argv[3])
sys.path.insert(0, repo); sys.path.insert(0, repo + "/scripts")
import hub_sandbox_boot as b
b.apply_sandbox_env(data_dir, reclaim_conftest_temp=True)
for k in spec["flags"]:
    os.environ[k] = "1"
from api.services import auth_db
from api.services.journal_two import note_levels as nl, similar_matches as sm, passed_setups as ps
conn = auth_db.get_connection()
uid = conn.execute("SELECT id FROM users WHERE email = ?", (spec["email"],)).fetchone()["id"]
out = {}

def walk(n, acc):
    if isinstance(n, dict):
        if n.get("type") == "widgetEmbed": acc.append(n.get("attrs") or {})
        for v in n.values(): walk(v, acc)
    elif isinstance(n, list):
        for v in n: walk(v, acc)

# 1) find more like this: tonight's universe is ONE candidate whose values are the template's own
tpl = None
from api.services.journal_two import chart_blocks as cb
cb.ensure_schema(conn)
try:
    cb.catch_up(uid, conn)
    conn.commit()
except Exception as e:
    out["catch_up_error"] = repr(e)[:200]
def find_fields(o):
    if isinstance(o, str):
        try: o = json.loads(o)
        except Exception: return None
    if isinstance(o, dict):
        if isinstance(o.get("fields"), dict): return o["fields"]
        for v in o.values():
            f = find_fields(v)
            if f: return f
    return None
blocks = [dict(b) if not isinstance(b, dict) else b for b in cb.list_blocks(uid, conn, limit=cb.LIST_LIMIT)]
out["block_keys"] = sorted(blocks[0].keys()) if blocks else []
out["block_symbols"] = [[b.get("symbol"), b.get("setupTag") or b.get("setup_tag")] for b in blocks]
for b in blocks:
    if b.get("symbol") == spec["template_symbol"]:
        f = find_fields(b)
        if f:
            tpl = {"note": b.get("noteId") or b.get("note_id"), "tag": b.get("setupTag") or b.get("setup_tag"), "fields": f}
out["template"] = {"found": bool(tpl), "tag": (tpl or {}).get("tag")}
if tpl:
    vals = {k: v.get("value") for k, v in tpl["fields"].items() if isinstance(v, dict) and k != "patterns" and v.get("value") is not None}
    tag = (tpl.get("tag") or "vcp").lower()
    universe = {"as_of": spec["today"], "rows": [{"symbol": spec["candidate"], "as_of": spec["today"], "is_etf": False, "values": vals}], "truncated": False}
    try:
        out["nightly"] = sm.run_nightly(conn=conn, universe=universe, pattern_field=lambda as_of, sym: {"value": [{"setup": tag}], "missing": None})
    except Exception as e:
        out["nightly"] = {"error": repr(e)[:300]}

# 2) passed setups: the nightly refresh
try:
    out["passed_setups"] = ps.refresh(uid, conn=conn)
except Exception as e:
    out["passed_setups"] = {"error": repr(e)[:300]}

# 3) resurfacing: project the member's own notes, then two awareness scans (above, then through, the stop)
nl.ensure_schema(conn)
proj = 0
for nid in spec["project_note_ids"]:
    row = conn.execute("SELECT id, ticker, body_json, properties_json, updated_at FROM j2_notes WHERE id = ? AND user_id = ?", (nid, uid)).fetchone()
    if row is not None:
        nl.project_note(conn, uid, row); proj += 1
conn.commit()
out["projected"] = proj
from datetime import date as _date
from api.routers.live_prices import cache, _px_key
os.environ["AWARENESS_ENGINE_ENABLED"] = "1"
from api.services.awareness import engine as eng
eng._build_market_scan_ctx = lambda user_ctxs: {"live_prices": {}, "regime": {"label": None, "confidence": None, "prev_label": None},
    "earnings_by_symbol": {}, "earnings_window_days": 3, "today": _date.today()}
scans = []
import unittest.mock as um
with um.patch("api.services.watchlist_alert_service.deliver_alert_payload", side_effect=AssertionError("deliver_alert_payload reached")) as deliver:
    for label, quotes in spec["quotes"]:
        for sym, price in quotes.items():
            cache.set(_px_key(sym), {"price": price, "change_pct": 0.0}, ttl=600)
        price = quotes
        try:
            result = eng.run_awareness_scan()
        except Exception as e:
            result = {"error": repr(e)[:300]}
        rows = [dict(r) for r in conn.execute("SELECT id, kind, symbol, headline, importance FROM voice_proactive_insights WHERE user_id = ? ORDER BY id", (uid,))]
        levels = [dict(r) for r in conn.execute("SELECT note_id, level_id, role, price, version_id, last_side FROM j2_note_levels WHERE user_id = ? AND role != 'none' ORDER BY note_id, level_id", (uid,))]
        scans.append({"label": label, "price": price, "result": {k: v for k, v in result.items() if k in ("resurface", "error")}, "insights": rows, "levels": levels, "deliver_calls": deliver.call_count})
conn.commit(); conn.close()
out["scans"] = scans
print("POSTSEED " + json.dumps(out, default=str))
'''


def run_post_child(data_dir: Path, out: Path, spec: dict) -> dict:
    env = {k: v for k, v in os.environ.items() if not k.startswith("RAILWAY_")}
    r = subprocess.run([sys.executable, "-c", POST_CHILD, str(REPO), str(data_dir), json.dumps(spec)],
                       cwd=str(REPO), env=env, capture_output=True, text=True, encoding="utf-8", errors="replace",
                       timeout=900)
    (out / "post-seed-child.log").write_text(newline=chr(10), data=f"tip: {REC.get('tip')}\n" + (r.stdout or "")[-6000:] + "\n--- stderr ---\n" + (r.stderr or "")[-8000:],
                                             encoding="utf-8")
    line = [ln for ln in (r.stdout or "").splitlines() if ln.startswith("POSTSEED ")]
    if r.returncode != 0 or not line:
        return {"error": f"post child rc {r.returncode}; see post-seed-child.log", "stderr_tail": (r.stderr or "")[-600:]}
    return json.loads(line[-1][len("POSTSEED "):])


# ── c1: flags as production has them today ─────────────────────────────────────────────────

def c1_viewport(browser, admin, base: str, vp: str, fs: dict) -> None:
    cfg = "c1"
    ctx, email, me = member(browser, admin.request, base, f"c1v{vp}", vp)
    inst = Inst(ctx, cfg, vp)
    pg = ctx.new_page()
    G = lambda feature: guarded(lambda: pg, lambda: inst, feature)  # noqa: E731
    wave_keys = {f: me.get(f.lower()) for f in fs["wave"]}
    step(None, inst, "flags", "auth payload: every wave 12-15 switch reads OFF", "PASS" if not any(wave_keys.values()) else "FAIL",
         email=email, wave_flags=wave_keys, armed={f: me.get(f.lower()) for f in fs["c1"]}, shot=False)

    @G("first run")
    def first_run():
        goto(pg, base, "/journal/notebook")
        ok = vis_loc(pg.get_by_role("heading", name="Welcome to your Notebook", level=2), 30000)
        seen = settle_first_run(pg)
        pg.wait_for_timeout(2500)
        shape = pg.evaluate("""() => { const row = document.querySelector("[data-tour='first-run']"); const root = row && row.parentElement;
            return { children: root ? [...root.children].map(e => e.tagName) : null,
                     buttons: row ? [...row.querySelectorAll('button')].map(b => b.innerText.trim()) : null } }""")
        found = census(pg)
        step(pg, inst, "first run", "empty Notebook: welcome renders, no wave 12-15 surface",
             "PASS" if ok and not found else "FAIL", welcome=ok, base_tour_autostarted=seen["base_tour"],
             surfaces_found=found, **shape)
    first_run()

    marker = f"finwalk{vp}zebra"
    @G("note CRUD")
    def crud():
        pg.get_by_role("button", name="Start a note", exact=True).first.click()
        pg.locator(".ProseMirror").first.wait_for(state="visible", timeout=60000)
        title = pg.locator('input[aria-label="Note title"]').first
        title.fill(f"Fin walk note {vp}")
        pm = pg.locator(".ProseMirror").first
        pm.click()
        pg.keyboard.type(f"The plan for the week. {marker} is the word to find.", delay=15)
        nid, saved = None, False
        for _ in range(40):
            for n in notes_list(ctx, base):
                if n.get("title") == f"Fin walk note {vp}":
                    nid = n["id"]
                    r = ctx.request.get(base + f"/api/j2/notes/{nid}").json()
                    saved = marker in json.dumps((r.get("note") or r).get("bodyJson") or {})
            if saved:
                break
            pg.wait_for_timeout(500)
        STATE[f"c1_note_{vp}"] = nid
        step(pg, inst, "note CRUD", "create a note and type: the words are stored", "PASS" if saved else "FAIL", note=nid)
        # editor menus: slash menu, template picker door
        pg.keyboard.press("Enter")
        pg.keyboard.type("/", delay=30)
        pg.wait_for_timeout(900)
        opts = [o.strip().replace("\n", " ")[:60] for o in pg.locator('[role="option"]').all_inner_texts()]
        bad = [o for o in opts if re.search(r"transcript|versus", o, re.I)]
        found = census(pg)
        step(pg, inst, "editor menus", "slash menu carries no wave 12-15 entry", "PASS" if opts and not bad and not found else "FAIL",
             options=opts, wave_entries=bad, surfaces_found=found)
        pg.keyboard.press("Escape")
        pg.keyboard.press("Backspace")
        # reload, find, delete
        pg.reload(wait_until="domcontentloaded")
        h._dismiss_intro(pg)
        back = vis(pg, ".ProseMirror", 60000) and marker in (pg.locator(".ProseMirror").first.inner_text() or "")
        step(pg, inst, "note CRUD", "reload: the note and its words are still there", "PASS" if back else "FAIL")
        goto(pg, base, "/journal/notebook?view=all")
        box = pg.get_by_label("Search your notes").first
        found_it = False
        try:
            if not box.count() or not box.is_visible():
                # the search box lives behind the sidebar's "Search notes" door (a phone shows the
                # sidebar only when no note is open, which is the case on ?view=all)
                pg.locator('[aria-label="Search notes"]').first.click(timeout=15000)
            box.wait_for(state="visible", timeout=20000)
            box.fill(marker)
            found_it = vis_loc(pg.get_by_text(f"Fin walk note {vp}").first, 20000)
        except Exception as e:  # noqa: BLE001
            STATE[f"c1_search_err_{vp}"] = str(e)[:200]
        step(pg, inst, "note CRUD", "search finds it by a word in its body", "PASS" if found_it else "FAIL",
             search_error=STATE.get(f"c1_search_err_{vp}"))
        goto(pg, base, f"/journal/notebook?note={nid}", ".ProseMirror")
        deleted, how = False, None
        menu_items = None
        if how is None:
            more = pg.get_by_role("button", name="More note actions")
            if more.count():
                more.first.click()
                pg.wait_for_timeout(700)
                # the menu's entries are plain buttons (Version history, Duplicate note, ..., Delete)
                cand = pg.get_by_role("button", name="Delete", exact=True).filter(visible=True)
                menu_items = [t for t in pg.evaluate("() => [...document.querySelectorAll('button')].filter(b => b.getBoundingClientRect().width > 0).map(b => (b.innerText || '').trim()).filter(Boolean)")
                              if t in ("Version history", "Duplicate note", "Lock", "Archive", "Save as template", "Export", "Delete")]
                if cand.count():
                    how = "More note actions > Delete"
                    cand.last.click()
        if how:
            pg.wait_for_timeout(600)
            if C_vis(pg.get_by_text("Delete this note?"), 5000):
                pg.get_by_role("button", name="Delete", exact=True).filter(visible=True).last.click()
            for _ in range(30):
                if not any(n.get("id") == nid for n in notes_list(ctx, base)):
                    deleted = True
                    break
                pg.wait_for_timeout(400)
        buttons = None if how else pg.evaluate("() => [...document.querySelectorAll('button')].filter(b => b.getBoundingClientRect().width > 0).map(b => (b.getAttribute('aria-label') || b.innerText || b.title || '').trim().slice(0, 30)).filter(Boolean).slice(0, 80)")
        step(pg, inst, "note CRUD", "delete it: gone from the notes list", "PASS" if deleted else "FAIL", door=how,
             visible_buttons=buttons, menu_items=menu_items)
    crud()

    @G("editor menus")
    def editor_surfaces():
        st, body = api(ctx, inst, "POST", base, "/api/j2/notes", {"title": f"NVDA thesis {vp}", "ticker": "NVDA", "bodyJson": x13.doc_with(
            x13.para("Long into the breakout."), x13.chart_block("NVDA", [x13.level("entry", 125.0, "d-entry"), x13.level("stop", 118.0, "d-stop"),
                                                                           x13.level("target", 140.0, "d-target")], "e-c1"))})
        nid = body["note"]["id"]
        api(ctx, inst, "PUT", base, f"/api/j2/notes/{nid}", {"properties": {"builtin:thesis_status": "active"}, "baseUpdatedAt": body["note"]["updatedAt"]})
        STATE[f"c1_thesis_{vp}"] = nid
        goto(pg, base, f"/journal/notebook?note={nid}", ".ProseMirror")
        frame_ok = vis(pg, '[data-widget-embed-view="chart"]', 30000)
        if frame_ok and not inst.touch:
            pg.locator('[data-widget-embed-view="chart"]').first.hover()
        pg.wait_for_timeout(1500)
        btns = pg.evaluate("() => [...document.querySelectorAll('[data-widget-embed-view] button')].map(b => (b.getAttribute('aria-label') || b.innerText || '').trim().slice(0, 30)).filter(Boolean)")
        found = census(pg)
        step(pg, inst, "editor menus", "a note with a chart and drawn levels: no fingerprint, plan, replay or playbook door",
             "PASS" if frame_ok and not found else "FAIL", chart_embed_rendered=frame_ok, embed_buttons=btns, surfaces_found=found,
             scope=['[data-widget-embed-view="chart"]'])
        # property types
        types, prop_err = None, None
        try:
            add = pg.get_by_role("button", name="Add property")
            if add.count():
                add.first.click()
                newp = pg.get_by_role("button", name="+ New property…")
                if vis_loc(newp, 5000):
                    newp.first.click()
                sel = pg.get_by_role("combobox", name="Property type")
                sel.first.wait_for(state="visible", timeout=8000)
                types = [t.strip() for t in sel.first.locator("option").all_inner_texts()]
                pg.keyboard.press("Escape")
        except Exception as e:  # noqa: BLE001
            prop_err = str(e)[:200]
        bad = [t for t in (types or []) if re.search(r"formula|rollup", t, re.I)]
        step(pg, inst, "editor menus", "property types offer no Formula or Rollup",
             "PASS" if types and not bad else ("FAIL" if bad else "INFO"), types=types, wave_entries=bad, reach_error=prop_err)
        goto(pg, base, "/journal/notebook?view=all")
        tp_err, door = None, None
        try:
            pg.get_by_role("button", name="Templates", exact=True).first.click(timeout=15000)
            pg.wait_for_timeout(1200)
            door = pg.get_by_role("button", name="Browse the community gallery").count()
        except Exception as e:  # noqa: BLE001
            tp_err = str(e)[:200]
        step(pg, inst, "editor menus", "template picker: no community gallery door",
             "PASS" if door == 0 else ("FAIL" if door else "INFO"), gallery_door=door, reach_error=tp_err, surfaces_found=census(pg))
        pg.keyboard.press("Escape")
    editor_surfaces()

    @G("journal")
    def journal():
        s1, p1 = api(ctx, inst, "POST", base, "/api/j2/positions", {"symbol": "NVDA", "side": "Long", "shares": 20, "entryPrice": 125.0,
                                                                    "stopPrice": 118.0, "entryDate": TODAY.isoformat()})
        s2, p2 = api(ctx, inst, "POST", base, "/api/j2/positions", {"symbol": "IBM", "side": "Long", "shares": 10, "entryPrice": 200.0,
                                                                    "stopPrice": 190.0, "entryDate": TODAY.isoformat()})
        s3, tr = api(ctx, inst, "POST", base, f"/api/j2/positions/{p2.get('id')}/close", {"shares": 10, "exitPrice": 205.0, "exitDate": TODAY.isoformat()})
        tid = ((tr.get("trade") or tr) if isinstance(tr, dict) else {}).get("id")
        step(None, inst, "journal", "one open position and one closed trade exist (member API)",
             "PASS" if s1 in (200, 201) and s3 == 200 and tid else "FAIL", position=s1, close=s3, trade=tid, shot=False)
        pages = [
            ("Research Home with notes", "/journal/notebook", None),
            ("Open Positions rows", "/journal?j2tab=positions", None),
            ("closed trades table", "/journal/trades?seg=closed", None),
            ("trade page", f"/journal-2-0/trade/{tid}", None),
            ("position page", "/journal-2-0/position/NVDA", None),
            ("Insights", "/journal/insights", None),
            ("Insights ?ins=discipline", "/journal/insights?ins=discipline", None),
            ("Insights ?ins=reviews", "/journal/insights?ins=reviews", None),
            ("My Playbook route", "/journal-2-0/playbook", None),
            ("setups board route", "/journal/notebook/setups", None),
            ("research workspace", "/journal/notebook/research/NVDA", None),
            ("Help", "/support", None),
        ]
        for label, path, _ in pages:
            try:
                goto(pg, base, path)
                pg.wait_for_timeout(3500)
                found = census(pg)
                txt = pg.evaluate("() => (document.querySelector('[class*=\"_main_\"]') || document.body).innerText.trim().replace(/\\s+/g, ' ').slice(0, 260)")
                step(pg, inst, "absence", f"{label}: no wave 12-15 surface", "PASS" if not found else "FAIL",
                     path=path, landed=pg.url.split(base)[-1], surfaces_found=found, page_text=txt)
            except Exception as e:  # noqa: BLE001
                step(pg, inst, "absence", f"{label}: no wave 12-15 surface", "FAIL", path=path, error=str(e)[:300])
        # the trade drawer / row door: click the closed trade's row and read what opens
        try:
            goto(pg, base, "/journal/trades?seg=closed")
            row = pg.locator("tr", has_text="IBM").first
            row.wait_for(state="visible", timeout=20000)
            row.click()
            pg.wait_for_timeout(3000)
            step(pg, inst, "absence", "trade row opened (drawer or page): no wave 12-15 surface",
                 "PASS" if not census(pg) else "FAIL", landed=pg.url.split(base)[-1], surfaces_found=census(pg),
                 dialogs=pg.locator("[role=dialog]").count())
        except Exception as e:  # noqa: BLE001
            step(pg, inst, "absence", "trade row opened (drawer or page): no wave 12-15 surface", "INFO", reach_error=str(e)[:300])
        # navigation chrome
        nav = pg.evaluate("() => [...document.querySelectorAll('nav a, nav button, [role=tablist] [role=tab], [role=tablist] a')].filter(e => e.getBoundingClientRect().width > 0).map(e => (e.innerText || e.getAttribute('aria-label') || '').trim().replace(/\\s+/g, ' ')).filter(Boolean)")
        bad = [t for t in nav if re.search(r"setups|discipline|my playbook|walkthrough|gallery|reporting soon|passed", t, re.I)]
        step(pg, inst, "absence", "sidebar and tab bars name no wave 12-15 page", "PASS" if nav and not bad else "FAIL",
             nav_entries=nav[:80], wave_entries=bad)
    journal()
    ctx.close()


def c1_sample(browser, admin, base: str, fs: dict) -> None:
    """With getting-started off the sample is exactly the wave-8 five notes."""
    ctx, email, me = member(browser, admin.request, base, "c1smp", "1280")
    inst = Inst(ctx, "c1", "1280")
    pg = ctx.new_page()
    try:
        goto(pg, base, "/journal/notebook")
        settle_first_run(pg)
        btn = pg.get_by_role("button", name="Add a sample notebook")
        btn.first.wait_for(state="visible", timeout=20000)
        btn.first.click()
        for _ in range(80):   # the click opens the sample's welcome note; the strip is on Home
            if len(notes_list(ctx, base)) >= 5:
                break
            pg.wait_for_timeout(500)
        landed = pg.url.split(base)[-1]
        goto(pg, base, "/journal/notebook")
        ok = vis_loc(pg.get_by_text("You're looking at the sample notebook"), 40000)
        pg.wait_for_timeout(2500)
        notes = notes_list(ctx, base)
        found = census(pg)
        step(pg, inst, "sample notebook", "Add a sample notebook: five wave-8 notes, no capability example, no wave surface",
             "PASS" if ok and len(notes) == 5 and not found else "FAIL", strip=ok, notes=len(notes),
             titles=[n.get("title") for n in notes], tickers=sorted({n.get("ticker") for n in notes if n.get("ticker")}),
             surfaces_found=found)
    except Exception as e:  # noqa: BLE001
        step(pg, inst, "sample notebook", "Add a sample notebook (driver exception)", "FAIL", error=str(e)[:400])
    ctx.close()


def run_c1(browser, admin, base: str, fs: dict, data_dir: Path, only) -> None:
    for vp in ("1280", "820", "390"):
        if only and vp not in only and "all" not in only:
            continue
        try:
            c1_viewport(browser, admin, base, vp, fs)
        except h.SetupFailed:
            raise
        except Exception as e:  # noqa: BLE001
            REC.setdefault("driver_errors", []).append(f"c1 {vp}: {type(e).__name__}: {str(e)[:300]}")
    if not only or "sample" in only or "all" in only:
        c1_sample(browser, admin, base, fs)
    import notebook_fin_walk_live as live
    for vp in ("1280", "820", "390"):
        if only and f"live{vp}" not in only and "all" not in only:
            continue
        try:
            live.run_live(sys.modules[__name__], browser, admin, base, fs, vp)
        except h.SetupFailed:
            raise
        except Exception as e:  # noqa: BLE001
            REC.setdefault("driver_errors", []).append(f"c1 live {vp}: {type(e).__name__}: {str(e)[:300]}")
    if not only or "unpaid" in only or "all" in only:
        for vp in ("1280", "390"):
            try:
                live.run_unpaid(sys.modules[__name__], browser, admin, base, vp)
            except Exception as e:  # noqa: BLE001
                REC.setdefault("driver_errors", []).append(f"c1 unpaid {vp}: {type(e).__name__}: {str(e)[:300]}")


# ── c3: a dependent switched on without its prerequisite ────────────────────────────────────

def run_c3(browser, admin, base: str, fs: dict, data_dir: Path, only) -> None:
    cfg = "c3"
    ctx, email, me = member(browser, admin.request, base, "c3m", "1280")
    inst = Inst(ctx, cfg, "1280")
    pg = ctx.new_page()
    flags = {f: me.get(f.lower()) for f in C3_ON + C3_OFF}
    ok_flags = all(flags[f] for f in C3_ON) and not any(flags[f] for f in C3_OFF)
    step(None, inst, "flags", "dependents ON, prerequisites OFF in the auth payload", "PASS" if ok_flags else "FAIL",
         email=email, flags=flags, shot=False)
    st, body = api(ctx, inst, "POST", base, "/api/j2/onboarding/sample-notebook")
    s1, p1 = api(ctx, inst, "POST", base, "/api/j2/positions", {"symbol": "IBM", "side": "Long", "shares": 10, "entryPrice": 200.0,
                                                                "stopPrice": 190.0, "entryDate": TODAY.isoformat()})
    s3, tr = api(ctx, inst, "POST", base, f"/api/j2/positions/{p1.get('id')}/close", {"shares": 10, "exitPrice": 205.0, "exitDate": TODAY.isoformat()})
    tid = ((tr.get("trade") or tr) if isinstance(tr, dict) else {}).get("id")
    notes = notes_list(ctx, base)
    plan = next((n for n in notes if "AAPL" in (n.get("title") or "")), None)   # the example names its symbol in its title
    step(None, inst, "setup", "member with the sample notebook and one closed trade", "PASS" if st == 200 and tid and plan else "FAIL",
         sample=st, trade=tid, notes=len(notes), plan_note=(plan or {}).get("id"), shot=False)
    storage = ctx.storage_state()

    def checks(pg, inst):
        def page_text():
            return pg.evaluate("() => (document.querySelector('[class*=\"_main_\"]') || document.body).innerText.trim().replace(/\\s+/g, ' ').slice(0, 700)")

        def healthy(row_facts):
            return not row_facts

        # 1) visual playbook without fingerprint
        try:
            goto(pg, base, f"/journal/notebook?note={plan['id']}", ".ProseMirror")
            pg.wait_for_timeout(4000)
            found = census(pg)
            api_st, api_body = api(ctx, inst, "GET", base, "/api/j2/visual-playbook")
            step(pg, inst, "visual playbook without fingerprint", "the plan note (its usual door is the fingerprint panel)", "INFO",
                 surfaces_found=found, api_status=api_st, api_body=json.dumps(api_body, default=str)[:300])
            goto(pg, base, f"/journal-2-0/trade/{tid}")
            pg.wait_for_timeout(5000)
            ba = pg.locator('[data-testid="trade-before-after"]')
            step(pg, inst, "visual playbook without fingerprint", "trade page: before/after renders or says why not", "INFO",
                 before_after_present=ba.count(), before_after_text=(ba.first.inner_text()[:400] if ba.count() else None),
                 surfaces_found=census(pg), scope=['[data-testid="trade-before-after"]'])
        except Exception as e:  # noqa: BLE001
            step(pg, inst, "visual playbook without fingerprint", "driver exception", "FAIL", error=str(e)[:400])
        # 2) setups board without chart plan
        try:
            goto(pg, base, "/journal/notebook/setups")
            pg.wait_for_timeout(5000)
            step(pg, inst, "setups board without chart plan", "the board page: an honest message, not an error", "INFO",
                 heading=pg.get_by_role("heading", name="Active setups").count(), cards=pg.locator("[data-board-card]").count(),
                 alerts=[a[:200] for a in pg.get_by_role("alert").all_inner_texts()], page_text=page_text())
        except Exception as e:  # noqa: BLE001
            step(pg, inst, "setups board without chart plan", "driver exception", "FAIL", error=str(e)[:400])
        # 3) review drafts without plan grading
        try:
            goto(pg, base, "/journal/notebook")
            box = pg.locator('[data-tour="review-drafts-home"]')
            present = vis_loc(box, 20000)
            created, body_text, err = None, None, None
            if present:
                pg.locator('[data-tour="review-drafts-daily"]').first.click()
                try:
                    pg.wait_for_url(lambda u: "note=" in u, timeout=45000)
                    created = pg.url.split("note=")[-1].split("&")[0]
                    pg.locator(".ProseMirror").first.wait_for(state="visible", timeout=30000)
                    body_text = pg.locator(".ProseMirror").first.inner_text()[:1500]
                except Exception as e:  # noqa: BLE001
                    err = str(e)[:200]
            step(pg, inst, "review drafts without plan grading", "Draft today from Home: a note, with the discipline part honest", "INFO",
                 review_box=present, note=created, note_text=body_text, wait_error=err,
                 alerts=[a[:200] for a in pg.get_by_role("alert").all_inner_texts()])
            goto(pg, base, "/journal/insights?ins=reviews")
            pg.wait_for_timeout(4000)
            sec = pg.locator('[data-testid="review-drafts-section"]')
            step(pg, inst, "review drafts without plan grading", "Insights > Reviews section", "INFO",
                 section=sec.count(), section_text=(sec.first.inner_text()[:500] if sec.count() else None),
                 discipline_tab=pg.get_by_role("button", name="Discipline", exact=True).count())
        except Exception as e:  # noqa: BLE001
            step(pg, inst, "review drafts without plan grading", "driver exception", "FAIL", error=str(e)[:400])

    checks(pg, inst)
    ctx.close()
    for vp in ("820", "390"):
        c2 = new_ctx(browser, vp, storage)
        i2 = Inst(c2, cfg, vp)
        p2 = c2.new_page()
        try:
            checks(p2, i2)
        except Exception as e:  # noqa: BLE001
            step(p2, i2, "c3", "driver exception", "FAIL", error=str(e)[:400])
        c2.close()


# ── boot / orchestration ───────────────────────────────────────────────────────────────────

def set_env(fs: dict, config: str, data_dir: Path) -> None:
    for name in fs["all_names"]:
        os.environ.pop(name, None)
    for k in [k for k in os.environ if k.startswith("RAILWAY_")]:
        os.environ.pop(k, None)
    os.environ.update({name: "1" for name in fs[config]})
    os.environ.update({"NOTEBOOK_EARNINGS_PREP_SANDBOX_CALENDAR": str(data_dir / CAL_FILE),
                       "FMP_API_KEY": "", "FINNHUB_API_KEY": "", "ALPHAVANTAGE_API_KEY": "", "MASSIVE_API_KEY": ""})


def run_config(config: str, args, fs: dict) -> int:
    global OUT
    base = f"http://127.0.0.1:{args.port}"
    data_dir = Path(args.data_root) / config
    only = {x.strip() for x in args.only.split(",") if x.strip()} or None
    info = REC["configs"].setdefault(config, {})
    info.update({"base": base, "data_dir": str(data_dir), "flags_on": fs[config]})
    d_report = x13._next_weekday(TODAY, 3)
    STATE["report_day"] = d_report.isoformat()
    STATE["data_dir"] = str(data_dir)
    sb = None
    if not args.attach:
        if h.port_busy(args.port):
            print(f"REFUSED: port {args.port} already has a listener (never killed)")
            return 3
        if data_dir.exists() and any(data_dir.iterdir()):
            print(f"REFUSED: {data_dir} is not empty")
            return 3
        data_dir.mkdir(parents=True, exist_ok=True)
        set_env(fs, config, data_dir)
        seed_pre_boot(data_dir, OUT, d_report)
        (data_dir / CAL_FILE).write_text(newline=chr(10), data=json.dumps({"reporters": {"AMZN": {"date": d_report.isoformat()}, "AMD": {"date": d_report.isoformat()}},
                                                     "asOf": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                                                     "partial": False}, indent=1), encoding="utf-8")
        sb = h.Sandbox(str(data_dir), args.port, OUT / f"sandbox-{config}.log")
        sb.start()
        (OUT / f"sandbox-{config}.tip").write_text(newline=chr(10), data=f"sandbox-{config}.log is the boot of tip {REC.get('tip')}\n", encoding="utf-8")
    else:
        set_env(fs, config, data_dir)   # children (post-seed) read the same flags
    not_run, failure = None, None
    try:
        if sb is not None:
            if not sb.wait_healthy(base, 400):
                not_run = "the sandbox never answered /api/health"
            else:
                sb.wait_checkpoint(h.POST_BOOT, h.POST_BOOT_WAIT_S)
                import sandbox_identity
                v = sandbox_identity.verify(base, sb.integrity_path())
                info["sandbox_identity"] = {"ok": v.ok, "sentence": v.sentence}
                if not v.ok:
                    not_run = v.sentence
        if not not_run and args.serve_only:
            print(f"SERVING {config} at {base}; create {OUT / 'STOP'} to stop", flush=True)
            while not (OUT / "STOP").exists() and sb.alive():
                time.sleep(2)
        elif not not_run:
            from playwright.sync_api import sync_playwright
            with sync_playwright() as p:
                browser = p.chromium.launch()
                admin = browser.new_context()
                try:
                    h._signup_or_login(admin.request, base, h.ADMIN_EMAIL, h.ADMIN_PW, "hubtest")
                    if config == "c1":
                        run_c1(browser, admin, base, fs, data_dir, only)
                    elif config == "c3":
                        run_c3(browser, admin, base, fs, data_dir, only)
                    else:
                        import notebook_fin_walk_features as feat
                        feat.run_c2(sys.modules[__name__], browser, admin, base, fs, data_dir, only)
                except h.SetupFailed as e:
                    not_run = str(e)[:400]
                except Exception as e:  # noqa: BLE001
                    failure = f"{type(e).__name__}: {str(e)[:400]}"
                    info["traceback"] = traceback.format_exc()[-3000:]
                finally:
                    admin.close()
                    browser.close()
        if sb is not None and not args.serve_only:
            sb.wait_checkpoint(h.PREWARM, h.PREWARM_WAIT_S)
    finally:
        if sb is not None:
            info["stop"] = sb.stop()
    if sb is not None:
        integ = h.read_integrity(sb.integrity_path(), [h.PRE_BOOT, h.POST_BOOT, h.PREWARM, h.SHUTDOWN]
                                 if not args.serve_only else [h.PRE_BOOT, h.SHUTDOWN])
        ipath = sb.integrity_path()
        if ipath and Path(ipath).is_file():
            kept = OUT / f"integrity-{config}.md"
            kept.write_text(newline=chr(10), data=f"tip under test: {REC.get('tip')} (configuration {config})\n\n"
                            + Path(ipath).read_text(encoding="utf-8", errors="replace"), encoding="utf-8")
            integ["path"] = str(kept)
        info["integrity"] = integ
        info["first_line"] = h.integrity_line(integ, f"stop: {sb.stop_how}", not_run=not_run)
        print(info["first_line"])
    info.update({"not_run": not_run, "failure": failure, "port_free_after": not h.port_busy(args.port) if sb is not None else None})
    api_mods = sorted(m for m in sys.modules if m == "api" or m.startswith("api."))
    info["driver_imported_api"] = api_mods
    flush()
    if not_run:
        print(f"VERDICT {config}: NOT RUN -- {not_run}")
        return 3
    if failure:
        print(f"VERDICT {config}: DRIVER FAILURE -- {failure}")
        return 1
    rows = [s for s in REC["steps"] if s["config"] == config]
    fails = [f"[{s['viewport']}] {s['feature']}: {s['step']}" for s in rows if s["verdict"] == "FAIL"]
    print(f"VERDICT {config}: {len(rows)} steps, {len(fails)} FAIL" + ("\n  " + "\n  ".join(fails) if fails else ""))
    return 1 if fails else 0


def main(argv=None) -> int:
    global OUT
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--config", required=True, choices=["c1", "c2", "c3"])
    ap.add_argument("--data-root", required=True)
    ap.add_argument("--port", type=int, default=PORT)
    ap.add_argument("--out", required=True)
    ap.add_argument("--only", default="")
    ap.add_argument("--tip", required=True, help="the product commit under test; written into every evidence file")
    ap.add_argument("--attach", action="store_true", help="the sandbox is already up (development)")
    ap.add_argument("--serve-only", action="store_true", help="boot and hold until <out>/STOP exists")
    args = ap.parse_args(argv)
    # A walk that stops making progress says where: the Python stack goes to stderr every N seconds.
    import faulthandler
    faulthandler.dump_traceback_later(int(os.environ.get("FINWALK_STACK_S", "900")), repeat=True, file=sys.stderr)
    why = h.refuse_shared_root(args.data_root)
    if why:
        print(f"REFUSED: {why}")
        return 3
    if args.port not in PORTS:
        print(f"REFUSED: this lane's ports are {PORTS}")
        return 3
    global WALK_FILE
    if args.serve_only:
        WALK_FILE = "walk-serve.json"
    OUT = Path(args.out) / args.config
    OUT.mkdir(parents=True, exist_ok=True)
    w.OUT = OUT / "tours"
    sha = subprocess.run(["git", "rev-parse", "HEAD"], cwd=str(REPO), capture_output=True, text=True).stdout.strip()
    (OUT / "TIP").write_text(newline=chr(10), data=f"{args.tip}\n", encoding="utf-8")
    REC.update({"config": args.config, "tip": args.tip, "tool_tree": sha, "started": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                "viewports": VIEWPORTS, "status": "INCOMPLETE (run did not finish)"})
    if args.attach:
        sp = OUT / f"state-{args.config}.json"
        if sp.is_file():
            STATE.update(json.loads(sp.read_text(encoding="utf-8")))
        prev = OUT / "walk.json"
        if prev.is_file():
            shutil.copyfile(prev, OUT / f"walk-prev-{int(time.time())}.json")
    try:
        fs = flag_sets()
    except h.SetupFailed as e:
        print(f"REFUSED: {e}")
        return 3
    REC["flag_sets"] = {k: fs[k] for k in ("prod_armed", "wave", "c1", "c2", "c3")}
    flush()
    rc = run_config(args.config, args, fs)
    REC.update({"finished": datetime.now(timezone.utc).isoformat(timespec="seconds"), "status": "COMPLETE" if rc in (0, 1) else "NOT COMPLETE"})
    flush()
    print(f"raw log written: {OUT / 'walk.json'}")
    return rc


if __name__ == "__main__":
    sys.exit(main())
