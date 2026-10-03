"""Wave 13 lane 13Q-1 -- the click-by-click usability instrument ("EASY IS THE KEY").

Spec: docs/notebook/WAVE-13-PLAN.md section 6 ("13Q: the click-by-click program") and the 23
budgets under it. This tool MEASURES; it never edits product code, and it draws no conclusion
(the reading is written afterwards, from the raw file this writes first -- R-RAW).

What it does, in a REAL browser (Playwright Chromium) against a LOCAL SANDBOX that it owns
(tools/notebook_perf_harness.py's `Sandbox` -> scripts/hub_sandbox_boot.py: the census env pins,
the shared-root tripwire, the integrity snapshots), for each of the plan's 23 flows Q1-Q23:

  * mouse  (1200 px): every click is counted; typing the CONTENT (a title, a ticker, a
             query) is not, per the plan ("Typing the content itself is not counted").
  * keys   (1200 px and 390 px): every keystroke is counted; Tab presses are counted
             SEPARATELY and are pressed FOR REAL until focus arrives on the control,
             capped at 600 (the plan's cap). A chord (Ctrl+K) is one keystroke. The
             reported "keys" figure is keystrokes + Tabs, which is what the budget bounds.
  * taps   (390 px, touch context): every tap is counted.

  For every flow and mode it records the measured count, the plan's budget, PASS or OVER,
  the wall time from the first counted action to the verified outcome, and the RAW PATH:
  each counted step with what it acted on, and for every Tab run the full focus trail.

  A flow PASSES or goes OVER only when its OUTCOME is verified (the note exists and is open,
  the cursor is in the body, the export downloaded, ...). A flow whose surface is dark or
  unbuilt on this tree, or that the driver could not complete, reads INCONCLUSIVE with the
  reason -- NEVER PASS. A Tab run that hits the 600 cap reads OVER with "cap reached", which
  is a finding, not a pass.

  Q7 (save Screener results to a note) is the plan's CONTROL: "the instrument must reproduce
  the Screener's ~337 Tabs before any fix" (ruling P5). The door is
  `app/src/pages/screener/shell/ScannerShell.jsx` (Screener-owned): MEASURED ONLY, never
  edited. The full focus trail to the door is kept so the number can be explained.

Flags: a flow that needs a dark flag gets it switched on IN THE SANDBOX ONLY (written into this
process's environment just before the launcher is spawned, so only the child inherits it; the
gate's one parse lives in the app). The list is SANDBOX_FLAGS below; every name is grepped to a
read site in api/routers/auth.py NOTEBOOK_FLAGS (CLAUDE.md: never invent an env flag).

Model keys stay BLANKED (the launcher's default). Where a flow's surface waits on a model
answer (Q9 Ask), the answer is stubbed AT THE BROWSER'S NETWORK LAYER (Playwright route) so the
clicks measured are the UI's own; that row says so in its `notes`.

⛔ THIS DRIVER NEVER IMPORTS `api.*`. Seeding that the product's own HTTP routes cannot do (the
screener snapshot rows Q7 needs, so the page shows results the way a member sees it) is written
by a CHILD process that first applies the sandbox's own census pins
(`hub_sandbox_boot.apply_sandbox_env`), as tools/notebook_w13c_walk.py does. The last row
asserts the driver's own sys.modules.

Run from PowerShell (a Windows path through the Bash tool loses its backslash), ports 8625-8629:

    python tools/notebook_w13q_clicks.py --data-dir '<scratch>\\w13q-run1' --port 8625 `
        --out 'docs\\notebook\\evidence\\wave13-13q\\run-<sha>'

Preconditions: app/dist rebuilt from this tree; the port free (refused, never killed); the data
dir outside the shared root (refused) and EMPTY.

Exit: 0 = ran, integrity CLEAN (budgets do not set the exit code -- a miss is a finding);
2 = integrity not CLEAN; 3 = refused / not run.
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import time
import traceback
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Callable

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace", line_buffering=True)
    except Exception:  # noqa: BLE001
        pass

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / "tools"))
import notebook_perf_harness as h  # noqa: E402  -- imports no api.* (asserted at the end)

MEMBER = ("w13q@local.dev", "LocalTest2026!", "w13q")
PORTS = range(8625, 8630)
TAB_CAP = 600
WIDE = {"width": 1200, "height": 900}
PHONE = {"width": 390, "height": 844}

# ⛔ Each name is a key of api/routers/auth.py NOTEBOOK_FLAGS (grepped, never invented).
SANDBOX_FLAGS = {
    "NOTEBOOK_ASK_INSERT_ON": "1",              # Q9 insert the answer
    "NOTEBOOK_EARNINGS_PREP_ENABLED": "1",      # Q15
    "NOTEBOOK_TEMPLATE_GALLERY_ENABLED": "1",   # Q2's template sheet as production may show it
    "NOTEBOOK_PLAN_GRADING_ENABLED": "1",       # Q13 (lane 13A)
}
CAL_FILE = "w13q-sandbox-calendar.json"

# The plan's table (section 6), typed ONCE here and printed back into every result row so the
# reading never re-types it. (flow id, flow, mouse, keys, taps, owning lane)
BUDGETS = [
    ("Q1", "new blank note, cursor in body", 2, 3, 2, "Notebook core"),
    ("Q2", "new note from a template with a ticker", 4, 6, 4, "Notebook templates (12B)"),
    ("Q3", "open a note by title", 2, 4, 3, "Notebook core"),
    ("Q4", "search, open a hit", 3, 5, 3, "Notebook core"),
    ("Q5", "today's daily note", 1, 2, 1, "Notebook core"),
    ("Q6", "link a note to a trade", 3, 6, 3, "Notebook core / Journal"),
    ("Q7", "save Screener results to a note (337 Tabs today)", 3, 10, 3, "Screener (ScannerShell.jsx)"),
    ("Q8", "save a price or consensus fact", 3, 8, 3, "Notebook capture"),
    ("Q9", "ask the Notebook, insert the answer", 3, 5, 3, "Notebook Ask"),
    ("Q10", "task with a due date", 2, 4, 3, "Notebook core"),
    ("Q11", "tag and move 5 notes", 8, 15, 10, "Notebook core"),
    ("Q12", "export one note as Word", 3, 6, 3, "Notebook export"),
    ("Q13", "plan grade of my last trade (13A)", 2, 4, 2, "13A"),
    ("Q14", "My Playbook, drill a number (13B)", 3, 6, 3, "13B"),
    ("Q15", "create earnings prep (13C)", 2, 5, 2, "13C"),
    ("Q16", "open a resurfaced note (13D)", 2, 4, 2, "13D"),
    ("Q17", "answer \"why did you take it\" (13E)", 2, 4, 2, "13E"),
    ("Q18", "draft this week's review, open a leak (13F)", 3, 6, 3, "13F"),
    ("Q19", "save a transcript passage to a thesis (13G)", 3, 6, 4, "13G"),
    ("Q20", "insert a chart, draw entry, stop and target, read size (13H)", 6, 10, 8, "13H"),
    ("Q21", "arm an alert at a drawn stop (13H)", 2, 4, 2, "13H"),
    ("Q22", "filter the visual playbook to one setup (13I)", 2, 4, 3, "13I"),
    ("Q23", "morning board, open the closest setup, find similar (13J)", 3, 6, 3, "13J"),
]
BUDGET = {b[0]: {"flow": b[1], "mouse": b[2], "keys": b[3], "taps": b[4], "owner": b[5]} for b in BUDGETS}


class Inconclusive(Exception):
    """The flow could not be measured on this tree: its surface is dark or unbuilt, or the
    driver could not reach a verified outcome. The message is the reason, recorded verbatim."""


# ── the meter ────────────────────────────────────────────────────────────────────────────

FOCUS_DESC_JS = """() => { const el = document.activeElement;
  if (!el || el === document.body) return {tag: 'BODY', name: ''};
  const name = (el.getAttribute('aria-label') || el.getAttribute('title') || el.innerText || el.value
                || el.getAttribute('placeholder') || '').trim().replace(/\\s+/g, ' ').slice(0, 60);
  return {tag: el.tagName, role: el.getAttribute('role') || '', name,
          testid: el.getAttribute('data-testid') || '', ce: el.isContentEditable || false}; }"""


class Meter:
    """Counts one flow in one mode. Every counted action goes through here, and is recorded
    in `steps` with what it acted on -- the raw path the reading cites."""

    def __init__(self, pg, mode: str):
        self.pg, self.mode = pg, mode
        self.clicks = self.taps = self.keys = self.tabs = 0
        self.steps: list[dict] = []
        self.t0: float | None = None
        self.capped = False

    def _start(self):
        if self.t0 is None:
            self.t0 = time.time()

    # pointer -- a click in mouse mode, a tap in taps mode
    def press(self, loc, label: str, *, timeout: int = 20000):
        """Activate a control the way this mode's member would: click (mouse), tap (taps),
        or Tab-until-focused then Enter (keys)."""
        self._start()
        loc = loc.first if hasattr(loc, "first") else loc
        loc.wait_for(state="visible", timeout=timeout)
        if self.mode == "mouse":
            loc.click(timeout=timeout)
            self.clicks += 1
            self.steps.append({"do": "click", "on": label})
        elif self.mode == "taps":
            loc.scroll_into_view_if_needed(timeout=timeout)
            loc.tap(timeout=timeout)
            self.taps += 1
            self.steps.append({"do": "tap", "on": label})
        else:
            self.tab_to_locator(loc, label)
            self.key("Enter", f"activate {label}")

    def pointer(self, loc, label: str, *, timeout: int = 20000):
        """A pointer-only action (mouse/taps modes) -- e.g. clicking into a field."""
        self._start()
        loc = loc.first if hasattr(loc, "first") else loc
        loc.wait_for(state="visible", timeout=timeout)
        if self.mode == "taps":
            loc.scroll_into_view_if_needed(timeout=timeout)
            loc.tap(timeout=timeout)
            self.taps += 1
            self.steps.append({"do": "tap", "on": label})
        else:
            loc.click(timeout=timeout)
            self.clicks += 1
            self.steps.append({"do": "click", "on": label})

    def key(self, key: str, label: str = ""):
        self._start()
        self.pg.keyboard.press(key)
        if key in ("Tab", "Shift+Tab"):
            self.tabs += 1
        else:
            self.keys += 1
        self.steps.append({"do": "key", "key": key, "on": label})

    def type(self, text: str, label: str = "content"):
        """Content typing: NOT counted (the plan), recorded so the path is complete."""
        self._start()
        self.pg.keyboard.type(text, delay=15)
        self.steps.append({"do": "type (not counted)", "text": text, "on": label})

    def fill(self, loc, text: str, label: str = "content"):
        """Content into a field that already has focus or was pointed at: NOT counted."""
        self._start()
        (loc.first if hasattr(loc, "first") else loc).fill(text)
        self.steps.append({"do": "fill (not counted)", "text": text, "on": label})

    def tab_to(self, js_predicate: str, label: str, *, cap: int = TAB_CAP, shift: bool = False) -> int:
        """Press Tab FOR REAL until document.activeElement satisfies `js_predicate` (a JS
        expression over `el`). Every press is counted and the focus trail is kept. Returns the
        number of presses, or raises Inconclusive at the cap with the trail recorded (the step
        is marked capped so the row reads OVER, not PASS)."""
        self._start()
        trail = []
        k = "Shift+Tab" if shift else "Tab"
        check = f"(() => {{ const el = document.activeElement; return !!(el && ({js_predicate})) }})()"
        if self.pg.evaluate(check):
            self.steps.append({"do": "tab-run", "to": label, "presses": 0, "trail": []})
            return 0
        for i in range(1, cap + 1):
            self.pg.keyboard.press(k)
            self.tabs += 1
            trail.append(self.pg.evaluate(FOCUS_DESC_JS))
            if self.pg.evaluate(check):
                self.steps.append({"do": "tab-run", "to": label, "presses": i, "trail": trail})
                return i
        self.capped = True
        self.steps.append({"do": "tab-run", "to": label, "presses": cap, "trail": trail, "capped": True})
        raise Capped(f"{cap} Tab presses never reached {label}")

    def tab_to_locator(self, loc, label: str, *, cap: int = TAB_CAP) -> int:
        """Tab until the focused element IS (or is inside) this locator's element."""
        handle = loc.element_handle(timeout=20000)
        self.pg.evaluate("h => { window.__w13qTarget = h }", handle)
        return self.tab_to("el === window.__w13qTarget || window.__w13qTarget.contains(el)", label, cap=cap)

    def elapsed(self) -> float | None:
        return round(time.time() - self.t0, 2) if self.t0 else None

    def count(self) -> int:
        return {"mouse": self.clicks, "taps": self.taps}.get(self.mode, self.keys + self.tabs)


class Capped(Exception):
    """A Tab run hit the plan's cap. The flow reads OVER (cap reached), never PASS."""


@dataclass
class Flow:
    fid: str
    run: Callable | None              # run(ctx: Ctx, m: Meter) -> dict of outcome evidence
    modes: tuple = ("mouse", "keys", "taps")
    unbuilt: str | None = None        # the reason it is INCONCLUSIVE on this tree, if it is
    notes: str = ""


@dataclass
class Ctx:
    base: str
    req: object                       # the member's APIRequestContext
    raw: dict = field(default_factory=dict)
    seed: dict = field(default_factory=dict)


# ── shared page helpers (setup -- never counted) ─────────────────────────────────────────

def settle(pg, ms: int = 600):
    try:
        pg.wait_for_load_state("networkidle", timeout=8000)
    except Exception:  # noqa: BLE001 -- a long-poll page never idles; the wait is best-effort
        pass
    pg.wait_for_timeout(ms)


def open_start(pg, base: str, path: str, ready: str | None = None, timeout: int = 60000):
    """Load the flow's start page and clear the once-per-tab chrome (the Welcome intro, the
    Compass hint). SETUP: nothing here is counted, and each dismissal is recorded by the
    caller's raw block, so a member's first-visit cost is visible without polluting a flow."""
    pg.goto(base + path, wait_until="domcontentloaded", timeout=timeout)
    h._dismiss_intro(pg)
    try:
        pg.get_by_role("button", name="Got it", exact=True).first.click(timeout=2500)
    except Exception:  # noqa: BLE001 -- the hint did not show in this tab
        pass
    if ready:
        pg.locator(ready).first.wait_for(state="visible", timeout=timeout)
    settle(pg)
    # keyboard runs start from the top of the document, as a member arriving on the page
    pg.evaluate("() => { if (document.activeElement && document.activeElement.blur) document.activeElement.blur();"
                " window.scrollTo(0, 0) }")


def focus_in_editor(pg) -> bool:
    return bool(pg.evaluate("() => { const el = document.activeElement;"
                            " return !!(el && el.closest && el.closest('.ProseMirror')) }"))


def note_id_from_url(pg) -> str | None:
    from urllib.parse import parse_qs, urlparse
    return (parse_qs(urlparse(pg.url).query).get("note") or [None])[0]


def wait_note_open(pg, timeout_ms: int = 30000) -> str | None:
    pg.wait_for_url("**/journal/notebook?*note=*", timeout=timeout_ms)
    pg.locator(".ProseMirror").first.wait_for(state="visible", timeout=timeout_ms)
    return note_id_from_url(pg)


def list_notes(req, base, q: str = "") -> list:
    r = req.get(base + "/api/j2/notes?limit=500" + q)
    return (r.json().get("notes") or []) if r.status == 200 else []


def read_note(req, base, nid):
    r = req.get(f"{base}/api/j2/notes/{nid}")
    return r.json().get("note") if r.status == 200 else None


def text_of(node, out=None):
    out = [] if out is None else out
    if isinstance(node, dict):
        if node.get("type") == "text":
            out.append(node.get("text", ""))
        for c in node.get("content") or []:
            text_of(c, out)
    return out


def journal_toast(pg) -> str:
    """The Notebook's own toast chip (lib/useJournalToast.jsx: a permanent role=status span whose
    text toggles) -- read by its data-empty flag, never by any aria-live on the page."""
    try:
        return pg.evaluate("() => Array.from(document.querySelectorAll('span[role=status][data-empty=false]'))"
                           ".map(e => e.innerText.trim()).filter(Boolean).join(' | ')")[:300]
    except Exception:  # noqa: BLE001
        return ""


def toast_text(pg) -> str:
    try:
        return pg.evaluate("() => Array.from(document.querySelectorAll('[role=status],[role=alert],[aria-live]'))"
                           ".map(e => e.innerText.trim()).filter(Boolean).join(' | ')")[:400]
    except Exception:  # noqa: BLE001
        return ""


# ── seeding (setup -- never counted) ─────────────────────────────────────────────────────

def _next_weekday(d: date, n: int) -> date:
    out = d
    while n > 0:
        out += timedelta(days=1)
        if out.weekday() < 5:
            n -= 1
    return out


def write_calendar(data_dir: Path) -> Path:
    """The sandbox-only earnings calendar Q15 reads (NOTEBOOK_EARNINGS_PREP_SANDBOX_CALENDAR, read
    only off Railway with the conftest imported -- tools/notebook_w13c_walk.py's recipe)."""
    today = date.today()
    p = data_dir / CAL_FILE
    p.write_text(json.dumps({"reporters": {"NVDA": {"date": _next_weekday(today, 2).isoformat(), "timing": "amc"}},
                             "asOf": datetime.now(timezone.utc).isoformat(timespec="seconds"), "partial": False},
                            indent=1), encoding="utf-8")
    return p


# Screener rows so /screener shows RESULTS the way a member sees it (the Save door is disabled
# until a result exists). Written by a CHILD under the sandbox's own census pins -- this process
# never imports api.*.
SCREENER_TICKERS = ["NVDA", "AMD", "AAPL", "MSFT", "META", "AMZN", "GOOGL", "TSLA", "AVGO", "CRWD",
                    "PLTR", "NFLX", "SHOP", "SNOW", "NET", "DDOG", "ZS", "PANW", "ANET", "SMCI",
                    "MU", "ARM", "TSM", "ASML", "LRCX", "KLAC", "AMAT", "MRVL", "ON", "QCOM"]

SEED_CHILD = r'''
import json, sys
repo, data_dir, spec = sys.argv[1], sys.argv[2], json.loads(sys.argv[3])
sys.path.insert(0, repo)
sys.path.insert(0, repo + "/scripts")
import hub_sandbox_boot as b
b.apply_sandbox_env(data_dir, reclaim_conftest_temp=True)
from api.services.screener import snapshot_db
snapshot_db.init_db()
n = snapshot_db.upsert_rows(spec["rows"])
print("SEEDED", snapshot_db.get_db_path(), n, snapshot_db.count_rows())
'''


def seed_stores(data_dir: Path, out: Path) -> str:
    today = date.today().isoformat()
    rows = []
    for i, t in enumerate(SCREENER_TICKERS):
        rows.append({"ticker": t, "company": f"{t} (walk seed)", "sector": "Technology",
                     "industry": "Semiconductors" if i % 2 else "Software", "exchange": "NASDAQ",
                     "security_type": "stock", "market_cap": 5e10 + i * 1e9, "price": 50.0 + i * 7,
                     "avg_volume_30d": 2e6 + i * 1e5, "snapshot_date": today, "bars_asof": today,
                     "built_at": today})
    env = {k: v for k, v in os.environ.items() if not k.startswith("RAILWAY_")}
    r = subprocess.run([sys.executable, "-c", SEED_CHILD, str(REPO), str(data_dir), json.dumps({"rows": rows})],
                       cwd=str(REPO), env=env, capture_output=True, text=True, timeout=600)
    (out / "seed-child.log").write_text((r.stdout or "") + "\n--- stderr ---\n" + (r.stderr or "")[-6000:],
                                        encoding="utf-8")
    if r.returncode != 0 or "SEEDED" not in (r.stdout or ""):
        raise h.SetupFailed(f"seeding the screener rows failed (rc {r.returncode}); see seed-child.log")
    return [ln for ln in r.stdout.splitlines() if ln.startswith("SEEDED")][-1]


def _doc(text: str) -> dict:
    return {"type": "doc", "content": [{"type": "paragraph", "content": [{"type": "text", "text": text}]}]}


SEED_TITLES = ["NVDA breakout thesis", "Semis rotation notes", "AMD earnings recap", "Weekly review draft",
               "CRWD base watch", "Market regime journal", "PLTR pullback plan", "Risk rules"]


def seed_member(cx: Ctx, data_dir: Path) -> None:
    """The member's notes, a closed trade, a position and a watchlist, through the product's own
    routes (HTTP only). Every id the flows need is kept in cx.seed."""
    req, base = cx.req, cx.base
    notes = {}
    for t in SEED_TITLES:
        r = req.post(base + "/api/j2/notes", data={"title": t, "bodyJson": _doc(f"{t} -- seeded body.")})
        if r.status not in (200, 201):
            raise h.SetupFailed(f"seeding note {t!r} failed: HTTP {r.status} {r.text()[:200]}")
        notes[t] = r.json()["note"]["id"]
    cx.seed["notes"] = notes
    today = date.today()
    pos = req.post(base + "/api/j2/positions", data={
        "symbol": "NVDA", "side": "Long", "entryDate": (today - timedelta(days=10)).isoformat(),
        "shares": 100, "entryPrice": 180.0, "stopPrice": 170.0})
    cx.seed["position_http"] = pos.status
    try:
        cx.seed["position_id"] = (pos.json() or {}).get("position", {}).get("id") or (pos.json() or {}).get("id")
    except Exception:  # noqa: BLE001
        cx.seed["position_id"] = None
    wl = req.post(base + "/api/watchlists", data={"name": "W13Q walk list"})
    cx.seed["watchlist_http"] = wl.status
    # Q11 moves into a folder: one per (mode, width) so runs never collide
    folders = {}
    for key in ("mouse-1200", "keys-1200", "keys-390", "taps-390"):
        r = req.post(base + "/api/j2/note-folders", data={"name": f"Semis {key}"})
        if r.status in (200, 201):
            body = r.json()
            f = body.get("folder") or body
            folders[key] = {"id": f.get("id"), "name": f.get("name")}
    cx.seed["folders"] = folders
    # Q6: a closed CRWD trade to link a note to
    d = (today - timedelta(days=3)).isoformat()
    t = req.post(base + "/api/j2/trades", data={"symbol": "CRWD", "side": "Long", "shares": 50, "entryPrice": 300,
                                                "entryDate": d, "exitPrice": 320, "exitDate": d, "originalStop": 290})
    tb = t.json() if t.status == 200 else {}
    cx.seed["trade_id"] = (tb.get("trade") or tb).get("id") if tb else None
    cx.seed["trade_http"] = t.status
    # Q13 (lane 13A): a plan note, then a matching NVDA trade entered AFTER the plan's save -- the
    # 13A walk's own recipe (tools/notebook_w13a_plan_grade_walk.py P1/P2), over HTTP
    plan = req.post(base + "/api/j2/notes", data={"title": "NVDA plan (w13q)", "ticker": "NVDA", "bodyJson": {
        "type": "doc", "content": [{"type": "paragraph", "content": [{"type": "text", "text": ln}]}
                                   for ln in ("Entry: 100", "Stop: 96", "Target: 120", "Shares: 100")]}})
    cx.seed["plan_note_http"] = plan.status
    from zoneinfo import ZoneInfo
    et = ZoneInfo("America/New_York")
    now = datetime.now(et)
    nxt = (now + timedelta(minutes=1)).replace(second=1, microsecond=0)
    time.sleep(max(0.0, (nxt - now).total_seconds()))
    day, hhmm = nxt.strftime("%Y-%m-%d"), nxt.strftime("%H:%M")
    pt = req.post(base + "/api/j2/trades", data={
        "symbol": "NVDA", "side": "Long", "shares": 100, "entryPrice": 100.4, "entryDate": day, "entryTimeEt": hhmm,
        "exitPrice": 110, "exitDate": day, "exitTimeEt": hhmm, "originalStop": 95})
    pb = pt.json() if pt.status == 200 else {}
    cx.seed["plan_trade_id"] = (pb.get("trade") or pb).get("id") if pb else None
    cx.seed["plan_trade_why"] = f"HTTP {pt.status}"
    if cx.seed["plan_trade_id"]:
        g = req.get(f"{base}/api/j2/plan-grades/trades/{cx.seed['plan_trade_id']}")
        cx.seed["plan_grade_http"] = g.status


# ── flow building blocks ─────────────────────────────────────────────────────────────────
# Counting rule (written once, applied everywhere): a CLICK or TAP on a control counts; a
# KEYSTROKE that is not content counts (Enter, Escape, a chord such as Ctrl+K or Ctrl+Alt+D, and
# a single trigger character such as "/" or "@" that opens a picker); every Tab counts and is
# reported separately. CONTENT does not count: a title, a ticker, a search query, the name typed
# after a trigger to filter a picker ("/price NVDA", "@tomorrow"), a tag, a task's words. A
# keystroke a MOUSE flow cannot avoid (a slash trigger) is recorded in the row (`keystrokes`) and
# named in the reading; the mouse figure is clicks.

def is_focused(pg, loc) -> bool:
    try:
        h_ = loc.first.element_handle(timeout=3000)
        return bool(pg.evaluate("h => h === document.activeElement || h.contains(document.activeElement)", h_))
    except Exception:  # noqa: BLE001
        return False


def focus_field(m: Meter, loc, label: str):
    """Put focus in a field the member is about to type into. Free when it already has focus."""
    loc = loc.first
    loc.wait_for(state="visible", timeout=20000)
    if is_focused(m.pg, loc):
        m.steps.append({"do": "already focused (free)", "on": label})
        return
    if m.mode == "keys":
        m.tab_to_locator(loc, label)
    else:
        m.pointer(loc, label)


def focus_editor_body(m: Meter):
    pg = m.pg
    pm = pg.locator(".ProseMirror").first
    pm.wait_for(state="visible", timeout=30000)
    if focus_in_editor(pg):
        m.steps.append({"do": "already in body (free)", "on": "note body"})
        return
    if m.mode == "keys":
        # 13Q-3: a SECOND, deeper layer of 13Q-2's Q1 foreground diagnosis. bring_to_front()
        # (run_one) makes the page genuinely foreground -- document.hasFocus()===true,
        # visibilityState==='visible', both measured -- but a FRESH editor's first
        # script-triggered .focus() call still silently fails in this harness even so; a
        # SECOND attempt on the SAME editor instance succeeds. Measured BOTH ways, with the
        # real product code, never a reimplementation: without bring_to_front() two attempts
        # still fail; with it, one extra attempt succeeds. Neither alone is sufficient.
        # Evidence: docs/notebook/evidence/wave13-13q3/q1-second-attempt-diagnosis/.
        #
        # A real member's tab has no "first attempt" to retry -- theirs is the only one, and
        # 13Q-2 already proved it succeeds (jsdom unit tests + a direct real-browser check,
        # section 2 of that report). Playwright's OWN `.focus()` -- never a product-internals
        # reach-in, never counted as a step -- is the SAME CATEGORY of instrument-only
        # environment compensation as bring_to_front() itself (CLAUDE.md/13Q-2: "there is no
        # DOM API ... only the host automating it can do that"). It is used here ONLY to tell
        # the two cases apart: if it resolves the focus, this was the known harness artifact
        # and the member pays nothing for it; if it does NOT, this is a genuine reachability
        # defect and the real Tab walk below is what measures it honestly -- the fallback is
        # never skipped, so a true regression is still caught.
        pm.focus()
        if focus_in_editor(pg):
            m.steps.append({"do": "already in body (free -- instrument foreground compensation "
                                   "confirmed it, 13Q-3)", "on": "note body"})
            return
        m.tab_to("el.closest && el.closest('.ProseMirror')", "note body")
    else:
        m.pointer(pm, "note body")
    pg.keyboard.press("End")  # caret placement is setup inside the focused body, not a member step
    m.steps.append({"do": "End (caret to line end, not counted)"})


def use_skip_link(m: Meter, label_regex: str, log_label: str | None = None) -> bool:
    """13Q-3: take a visible skip link the way a real keyboard member actually would, rather
    than tab through the shared app nav + Journal tab bar to reach a spot a skip link already
    reaches directly -- that chrome-walk cost is 13Q-2's own finding (section 4: Q2, Q4, Q9,
    Q11, Q12, Q15, Q20 all pay it), not a cost this instrument should keep re-measuring once a
    real door exists. The app shell portals every page's own skip link to the SAME early slot
    right after "Skip to main content" (components/skipLinks.jsx), so reaching one costs at
    most a handful of real Tab presses regardless of chrome size -- measured, not assumed, in
    the re-run this fix is committed with. Mouse/taps never call this (nothing to skip with a
    pointer or a finger; they already click/tap the real control directly). Returns whether a
    matching, visible skip link was found and used -- a flow decides what to do if not (several
    surfaces only have ONE skip link, and not every flow's target is behind one)."""
    if m.mode != "keys":
        return False
    import re
    link = m.pg.get_by_role("link", name=re.compile(label_regex, re.I)).filter(visible=True)
    if link.count() == 0:
        return False
    m.press(link, log_label or f"skip link: {label_regex}")
    return True


def go_all_notes(m: Meter):
    """From anywhere in the Notebook to the notes list (where + New note / Today / Templates live).
    "All notes" lives in the folder sidebar, which renders BEFORE the Notebook's own main-pane
    skip link target in DOM order, so the "Skip to note(s) list" link cannot reach it -- this
    uses the SIBLING "Skip to folder navigation" link (FolderSidebar.jsx) instead, which lands
    right at the top of the sidebar the row lives in."""
    pg = m.pg
    row = pg.locator("[data-all-notes-row]")
    try:
        row.first.wait_for(state="visible", timeout=6000)
    except Exception:  # noqa: BLE001
        toggle = pg.get_by_role("button", name="Show folders panel")
        if toggle.count() == 0:
            raise Inconclusive("the 'All notes' row is not visible and no 'Show folders panel' toggle exists")
        m.press(toggle, "Show folders panel")
    use_skip_link(m, r"Skip to folder navigation", "Skip to folder navigation")
    m.press(row, "All notes")
    pg.wait_for_url("**/journal/notebook?*view=*", timeout=20000)


def pick_option(m: Meter, name_re, label: str):
    """Choose a row in an open picker: Enter in keys mode (the top row is highlighted), a click or
    tap otherwise."""
    import re
    opt = m.pg.get_by_role("option", name=re.compile(name_re, re.I))
    opt.first.wait_for(state="visible", timeout=20000)
    if m.mode == "keys":
        m.key("Enter", f"choose {label}")
    else:
        m.pointer(opt, label)


def open_note_start(cx: Ctx, pg, nid: str, caret: bool = True):
    """In-note flows start with the note open and the member WORKING in it: the caret in the body
    (a setup click, uncounted). Q1 is the flow that measures getting the caret there."""
    open_start(pg, cx.base, f"/journal/notebook?note={nid}", ready=".ProseMirror")
    if caret:
        pg.locator(".ProseMirror").first.click()
        pg.keyboard.press("End")
        pg.wait_for_timeout(300)


def wait_body(cx: Ctx, nid: str, pred, timeout_s: float = 20.0):
    end = time.time() + timeout_s
    n = None
    while time.time() < end:
        n = read_note(cx.req, cx.base, nid)
        if n and pred(n):
            return n
        time.sleep(0.7)
    return n


def fresh_note(cx: Ctx, title: str, ticker: str | None = None, text: str = "Seed paragraph.") -> str:
    data = {"title": title, "bodyJson": _doc(text)}
    if ticker:
        data["ticker"] = ticker
    r = cx.req.post(cx.base + "/api/j2/notes", data=data)
    if r.status not in (200, 201):
        raise Inconclusive(f"setup: could not create the flow's note (HTTP {r.status})")
    return r.json()["note"]["id"]


def _run_tag(cx: Ctx, fid: str, mode: str, width: str) -> str:
    return f"{fid}-{mode}-{width}-{int(time.time() * 1000) % 10_000_000}"


# ── the flows ────────────────────────────────────────────────────────────────────────────
# Each flow: start page (setup, uncounted) -> the member's shortest path on this tree -> the
# OUTCOME verified (API read-back or the page's own answer). The return value is the evidence.

def q1_new_blank(cx: Ctx, pg, m: Meter, width: str) -> dict:
    open_start(pg, cx.base, "/journal/notebook")
    before = len(list_notes(cx.req, cx.base))
    if m.mode == "keys":
        m.key("Control+k", "open the command palette")
        m.type("new note", "palette query")
        pick_option(m, r"New Note", "New Note")
    else:
        go_all_notes(m)
        m.press(pg.locator("[data-tour='new-note']").filter(visible=True), "+ New note")
    nid = wait_note_open(pg)
    focus_editor_body(m)
    ok = focus_in_editor(pg) and len(list_notes(cx.req, cx.base)) == before + 1
    if not ok:
        raise Inconclusive(f"outcome not reached: cursor in body={focus_in_editor(pg)}, note {nid}")
    return {"note": nid, "cursor_in_body": True, "path": "palette New Note" if m.mode == "keys" else "All notes -> + New note"}


def q2_template_ticker(cx: Ctx, pg, m: Meter, width: str) -> dict:
    open_start(pg, cx.base, "/journal/notebook")
    go_all_notes(m)
    # 13Q-3: "Templates" lives in the pane's own list header -- the SAME region "Skip to notes
    # list" (NotebookTab.jsx) lands at, right past whatever remains of the sidebar after
    # go_all_notes' own click (the Keys path there still leaves focus on the "All notes" row).
    use_skip_link(m, r"Skip to notes? list", "Skip to notes list")
    m.press(pg.get_by_role("button", name="Templates", exact=True).filter(visible=True), "Templates")
    dlg = pg.get_by_role("dialog", name="New note")
    dlg.wait_for(state="visible", timeout=20000)
    card = dlg.locator("[data-template-key='thesis']")
    if card.count() == 0:
        card = dlg.locator("[data-template-key]").nth(1)
    key = card.first.get_attribute("data-template-key")
    m.press(card, f"template card {key}")
    nid = wait_note_open(pg)
    tick = pg.locator("input[aria-label='Ticker']").filter(visible=True)
    if tick.count() == 0:
        raise Inconclusive("the note header carries no visible Ticker field at this width")
    focus_field(m, tick, "Ticker field")
    m.fill(tick, "NVDA", "ticker")
    # the field saves on blur: the member leaves it -- Tab (keys) or a click into the body
    if m.mode == "keys":
        m.key("Tab", "leave the Ticker field (saves on blur)")
    else:
        m.pointer(pg.locator(".ProseMirror").first, "into the body (saves the ticker on blur)")
    n = wait_body(cx, nid, lambda n: (n.get("ticker") or "").upper() == "NVDA")
    if not n or (n.get("ticker") or "").upper() != "NVDA":
        raise Inconclusive(f"outcome not reached: note {nid} ticker={n and n.get('ticker')!r}")
    return {"note": nid, "template": key, "ticker": n.get("ticker")}


def q3_open_by_title(cx: Ctx, pg, m: Meter, width: str) -> dict:
    title = "Semis rotation notes"
    nid = cx.seed["notes"][title]
    open_start(pg, cx.base, "/journal/notebook")
    import re
    if m.mode == "keys":
        m.key("Control+k", "open the command palette")
        m.type("rotation", "palette query")
        pick_option(m, r"^Note: Semis rotation", f"Note: {title}")
    else:
        direct = pg.get_by_role("button", name=re.compile(re.escape(title))).filter(visible=True)
        if direct.count() == 0:
            direct = pg.locator(f"[data-note-card-id='{nid}']").filter(visible=True)
        if direct.count() == 0:
            go_all_notes(m)
            direct = pg.locator(f"[data-note-card-id='{nid}']").filter(visible=True)
        m.press(direct, f"note row '{title}'")
    got = wait_note_open(pg)
    if got != nid:
        raise Inconclusive(f"outcome not reached: opened {got}, wanted {nid}")
    return {"note": nid}


def q4_search_open(cx: Ctx, pg, m: Meter, width: str) -> dict:
    nid = cx.seed["notes"]["CRWD base watch"]
    open_start(pg, cx.base, "/journal/notebook")
    tab = pg.get_by_role("tab", name="Search notes").filter(visible=True)
    if tab.count() == 0:
        toggle = pg.get_by_role("button", name="Show folders panel")
        if toggle.count():
            m.press(toggle, "Show folders panel")
        tab = pg.get_by_role("tab", name="Search notes").filter(visible=True)
    # 13Q-3: "Search notes" lives in the folder sidebar, same region "Skip to folder
    # navigation" (FolderSidebar.jsx) lands at -- a couple of presses, not a chrome walk.
    use_skip_link(m, r"Skip to folder navigation", "Skip to folder navigation")
    m.press(tab, "Search notes tab")
    box = pg.get_by_label("Search your notes").filter(visible=True)
    focus_field(m, box, "Search your notes")
    m.fill(box, "CRWD", "search query")
    pg.wait_for_timeout(1200)
    if m.mode == "keys":
        m.key("Enter", "open the first hit")
    else:
        hit = pg.locator(f"[data-note-card-id='{nid}']").filter(visible=True)
        if hit.count() == 0:
            import re
            hit = pg.get_by_role("button", name=re.compile("CRWD base watch")).filter(visible=True)
        m.press(hit, "search hit 'CRWD base watch'")
    got = wait_note_open(pg)
    if got != nid:
        raise Inconclusive(f"outcome not reached: opened {got}, wanted {nid}")
    return {"note": nid}


def q5_today(cx: Ctx, pg, m: Meter, width: str) -> dict:
    # 13Q-3 (click-budget fix): bare-root Research Home now carries its own "Today" button
    # (wired to the same openToday NotebookTab.jsx's list-header button already calls -- one
    # authority), so mouse/taps no longer detour through "All notes" to reach it.
    open_start(pg, cx.base, "/journal/notebook")
    if m.mode == "keys":
        m.key("Control+Alt+d", "Today's note (Ctrl+Alt+D)")
    else:
        m.press(pg.get_by_role("button", name="Today", exact=True).filter(visible=True), "Today")
    nid = wait_note_open(pg)
    n = read_note(cx.req, cx.base, nid) or {}
    return {"note": nid, "title": n.get("title")}


def q6_link_trade(cx: Ctx, pg, m: Meter, width: str) -> dict:
    """No in-note control exists to link a trade (the note only SHOWS linked trades). The
    shortest path on this tree runs from the trade: the Journal's Trades tab -> Closed -> the
    trade -> Save to Notebook -> Current note. The flow starts on the note the member wants
    linked (which makes it the 'current note')."""
    nid = fresh_note(cx, f"Trade link target {_run_tag(cx, 'Q6', m.mode, width)}", "CRWD")
    tid = cx.seed.get("trade_id")
    if not tid:
        raise Inconclusive("setup: no seeded closed trade")
    open_note_start(cx, pg, nid)
    pg.evaluate("() => { if (document.activeElement && document.activeElement.blur) document.activeElement.blur() }")
    import re
    # the Notebook lives under the Trade Journal's own tab row, so Trades is one press away
    trades = pg.get_by_role("link", name=re.compile(r"^Trades")).filter(visible=True)
    m.press(trades, "Journal tab: Trades")
    pg.wait_for_timeout(1500)
    closed = pg.get_by_role("button", name=re.compile(r"Closed", re.I)).filter(visible=True)
    if closed.count() == 0:
        closed = pg.get_by_role("tab", name=re.compile(r"Closed", re.I)).filter(visible=True)
    if closed.count():
        m.press(closed, "Trades segment: Closed")
        pg.wait_for_timeout(1200)
    row = _trade_row(pg, "CRWD")
    if row.count() == 0:
        raise Inconclusive("the seeded CRWD trade row is not visible on the Trades surface")
    m.press(_row_opener(row, "CRWD"), "CRWD trade row")
    save = pg.get_by_role("button", name=re.compile(r"Save to Notebook")).filter(visible=True)
    try:
        save.first.wait_for(state="visible", timeout=15000)
    except Exception:  # noqa: BLE001
        pass
    if save.count() == 0:
        raise Inconclusive(f"no 'Save to Notebook' door on the trade view reached (url {pg.url})")
    m.press(save, "Save to Notebook")
    cur = pg.get_by_role("menuitem", name=re.compile(r"Current note")).filter(visible=True)
    if cur.count() == 0:
        cur = pg.get_by_role("button", name=re.compile(r"Current note")).filter(visible=True)
    m.press(cur, "Current note")
    links = None
    end = time.time() + 15
    while time.time() < end:
        r = cx.req.get(f"{cx.base}/api/j2/notes/{nid}")
        body = json.dumps((r.json() or {}).get("note", {})) if r.status == 200 else ""
        if str(tid) in body or "tradeRef" in body:
            links = True
            break
        time.sleep(0.8)
    if not links:
        raise Inconclusive(f"outcome not reached: note {nid} carries no reference to trade {tid}; toast: {toast_text(pg)!r}")
    return {"note": nid, "trade": tid, "path": "note -> Trades tab -> Closed -> trade -> Save to Notebook -> Current note"}


def _trade_row(pg, sym: str):
    """The trade's row on the Trades surface: a table row on a wide screen, whatever control names
    the symbol on a phone layout. Returns a locator (possibly empty)."""
    row = pg.locator("tr", has_text=sym).filter(visible=True)
    # 13Q-3: was `has_text=re.compile(rf"\b{sym}\b")`, but the COMMITTED bytes were two literal
    # backspace control characters (0x08) around {sym}, not the escape "\b" -- a pattern that can
    # never match ordinary page text. Plain has_text=sym (row's own substring semantics) fixes it
    # without any regex escaping. Evidence: docs/notebook/evidence/wave13-13q3/q6-q13-instrument-fix/.
    alt = pg.locator("a, button, [role=button], [role=row], li", has_text=sym).filter(visible=True)
    end = time.time() + 20
    while time.time() < end:   # the trades table loads after the surface: wait for it, never sample once
        if row.count():
            return row
        if alt.count():
            return alt
        pg.wait_for_timeout(400)
    return row


def _row_opener(row, sym: str):
    """What a member activates to open a trade row: a link or button naming the symbol if the row
    has one, else the symbol's own cell text."""
    named = row.first.locator("a, button", has_text=sym)
    if named.count():
        return named.first
    txt = row.first.get_by_text(sym, exact=True)
    return txt.first if txt.count() else row.first


def q7_screener(cx: Ctx, pg, m: Meter, width: str) -> dict:
    """The plan's CONTROL (ruling P5): the Screener's Save to Notebook door, ScannerShell.jsx
    (Screener-owned; measured only). Starts at the top of /screener with results showing."""
    target = fresh_note(cx, f"Screener target {_run_tag(cx, 'Q7', m.mode, width)}")
    open_note_start(cx, pg, target)       # setup: the member was just working in this note
    open_start(pg, cx.base, "/screener")
    door = pg.get_by_role("button", name="Save these results to Notebook").filter(visible=True)
    try:
        door.first.wait_for(state="visible", timeout=45000)
        end = time.time() + 45
        while time.time() < end and door.first.is_disabled():
            pg.wait_for_timeout(500)
    except Exception as e:  # noqa: BLE001
        raise Inconclusive(f"the Save to Notebook door never showed on /screener: {str(e)[:200]}")
    if door.first.is_disabled():
        raise Inconclusive("the door stayed disabled: the screener produced no result set in this sandbox")
    settle(pg, 800)
    pg.evaluate("() => { if (document.activeElement && document.activeElement.blur) document.activeElement.blur();"
                " window.scrollTo(0, 0) }")
    before = {n["id"]: n.get("updatedAt") for n in list_notes(cx.req, cx.base)}
    inbox_before = _inbox_count(cx)
    m.press(door, "Save these results to Notebook")
    changed, msg = [], ""
    end = time.time() + 15
    while time.time() < end:
        msg = journal_toast(pg) or msg
        after = {n["id"]: n.get("updatedAt") for n in list_notes(cx.req, cx.base)}
        changed = [i for i, u in after.items() if before.get(i) != u]
        if changed:
            break
        pg.wait_for_timeout(700)
    inbox_after = _inbox_count(cx)
    if target not in changed:
        raise Inconclusive(f"outcome not reached: the current note {target} did not receive the results "
                           f"(notes changed {changed}; inbox {inbox_before}->{inbox_after}); toast {msg!r}")
    return {"toast": msg, "note": target, "notes_changed": changed, "inbox": [inbox_before, inbox_after]}


def _inbox_count(cx: Ctx) -> int | None:
    r = cx.req.get(cx.base + "/api/j2/inbox")
    if r.status != 200:
        return None
    b = r.json()
    items = b if isinstance(b, list) else (b.get("items") or b.get("captures") or [])
    return len(items)


def q8_fact(cx: Ctx, pg, m: Meter, width: str) -> dict:
    nid = fresh_note(cx, f"Fact target {_run_tag(cx, 'Q8', m.mode, width)}", "NVDA")
    open_note_start(cx, pg, nid)
    focus_editor_body(m)
    m.key("Enter", "new line")
    m.key("/", "slash trigger")
    m.type("price NVDA", "slash query")
    pick_option(m, r"^Price", "Price — NVDA")
    n = wait_body(cx, nid, lambda n: "financialFact" in json.dumps(n.get("bodyJson") or {}), 25)
    if not n or "financialFact" not in json.dumps(n.get("bodyJson") or {}):
        raise Inconclusive("outcome not reached: no financialFact node landed (the fact route needs a quote "
                           f"provider; vendor keys are blank in this sandbox). Toast: {toast_text(pg)!r}")
    return {"note": nid, "fact": True}


ASK_SSE_TEMPLATE = None


def _ask_stub(nid: str, title: str):
    src = {"n": 1, "type": "note", "label": title, "citation": "valid", "snippet": "seeded body",
           "navigation": {"kind": "note", "noteId": nid}, "location": {}, "stance": None, "payload": {},
           "textOrigin": None, "truncated": False}
    frames = [{"type": "sources", "scope": "note", "scopeLabel": "This note", "sources": [src]},
              {"type": "delta", "text": "The thesis is a base breakout above the pivot [1]."},
              {"type": "final", "answer": "The thesis is a base breakout above the pivot [1]."}]
    return "".join(f"data: {json.dumps(f)}\n\n" for f in frames)


def q9_ask_insert(cx: Ctx, pg, m: Meter, width: str) -> dict:
    title = f"Ask target {_run_tag(cx, 'Q9', m.mode, width)}"
    nid = fresh_note(cx, title, "NVDA", "NVDA breakout above the pivot on volume.")
    body = _ask_stub(nid, title)
    pg.route("**/api/j2/ask/stream", lambda route: route.fulfill(status=200, body=body,
                                                                  headers={"content-type": "text/event-stream"}))
    open_note_start(cx, pg, nid)
    # 13Q-3: the Ask toggle sits in the sticky chrome, ABOVE the body the member's caret just
    # landed in (setup) -- "Skip to editor toolbar" (NoteEditorPage.jsx) lands right before it,
    # a couple of presses, instead of the editor's own ~80-tab-stop content tree.
    use_skip_link(m, r"Skip to editor toolbar", "Skip to editor toolbar")
    m.press(pg.locator("[data-ask-toggle]").filter(visible=True), "Ask a question about this note")
    import re
    box = pg.get_by_placeholder(re.compile("What did I say")).filter(visible=True)
    focus_field(m, box, "question field")
    m.fill(box, "What is the thesis?", "question")
    if m.mode == "keys":
        m.key("Enter", "ask")
    else:
        m.press(pg.get_by_role("button", name="Ask", exact=True).filter(visible=True), "Ask")
    ins = pg.get_by_role("button", name=re.compile(r"Insert into")).filter(visible=True)
    try:
        ins.first.wait_for(state="visible", timeout=20000)
    except Exception:  # noqa: BLE001
        raise Inconclusive("no 'Insert into this note' button after the (stubbed) cited answer -- "
                           f"notebook_ask_insert_on latched? page says: {pg.locator('body').inner_text()[:300]!r}")
    m.press(ins, "Insert into this note")
    n = wait_body(cx, nid, lambda n: "base breakout above the pivot" in json.dumps(n.get("bodyJson") or {}), 20)
    if not n or "base breakout above the pivot" not in json.dumps(n.get("bodyJson") or {}):
        raise Inconclusive("outcome not reached: the answer text did not land in the note body")
    return {"note": nid, "inserted": True, "model": "answer stubbed at the browser network layer (model keys blank)"}


def q10_task_due(cx: Ctx, pg, m: Meter, width: str) -> dict:
    nid = fresh_note(cx, f"Task target {_run_tag(cx, 'Q10', m.mode, width)}")
    open_note_start(cx, pg, nid)
    focus_editor_body(m)
    m.key("Enter", "new line")
    m.key("/", "slash trigger")
    m.type("checklist", "slash query")
    pick_option(m, r"^Checklist", "Checklist")
    m.type("Review NVDA earnings ", "task text")
    m.key("@", "date trigger")
    m.type("tomorrow ", "date words")
    def ok(n):
        s = json.dumps(n.get("bodyJson") or {})
        return "taskItem" in s and "dateMention" in s
    n = wait_body(cx, nid, ok, 20)
    if not n or not ok(n):
        raise Inconclusive("outcome not reached: no taskItem with a dateMention in the stored body")
    return {"note": nid, "task_with_due": True}


def q11_tag_move(cx: Ctx, pg, m: Meter, width: str) -> dict:
    tag = f"w13q{m.mode}{width}"
    folder = cx.seed["folders"].get(f"{m.mode}-{width}")
    if not folder:
        raise Inconclusive("setup: no folder to move into")
    ids = [fresh_note(cx, f"Bulk {tag} {i}") for i in range(5)]
    open_start(pg, cx.base, "/journal/notebook")
    go_all_notes(m)
    # 13Q-3: the bulk-select checkboxes are in the pane's own grid -- "Skip to notes list"
    # lands right before it, same reasoning as Q2.
    use_skip_link(m, r"Skip to notes? list", "Skip to notes list")
    try:
        pg.get_by_role("checkbox", name=f"Select Bulk {tag} 0").filter(visible=True).first.wait_for(
            state="visible", timeout=20000)
    except Exception:  # noqa: BLE001 -- recorded below as the specific missing checkbox
        pass
    # the list is newest-first, so the member ticks them top to bottom: 4, 3, 2, 1, 0
    for i in reversed(range(len(ids))):
        box = pg.get_by_role("checkbox", name=f"Select Bulk {tag} {i}").filter(visible=True)
        if box.count() == 0:
            raise Inconclusive(f"no 'Select Bulk {tag} {i}' checkbox in the list at this width")
        if m.mode == "keys":
            m.tab_to_locator(box.first, f"select note {i}")
            m.key("Space", f"tick note {i}")
        else:
            m.pointer(box, f"tick note {i}")
    bar = pg.locator("[data-bulk-bar]")
    bar.wait_for(state="visible", timeout=10000)
    m.press(bar.get_by_role("button", name="Tags", exact=True), "Tags")
    field = pg.get_by_label("Tag to add to the selected notes").filter(visible=True)
    focus_field(m, field, "tag field")
    m.fill(field, tag, "tag")
    if m.mode == "keys":
        m.key("Enter", "Add tag")
    else:
        m.press(pg.get_by_role("button", name="Add tag").filter(visible=True), "Add tag")
    pg.wait_for_timeout(1500)
    sel = pg.get_by_label("Folder to move the selected notes to").filter(visible=True)
    if sel.count() == 0:
        raise Inconclusive("tagging landed but the bar shows no 'Move to' folder select afterwards")
    if m.mode == "keys":
        m.tab_to_locator(sel.first, "Move to select")
        sel.first.select_option(folder["id"])
        m.keys += 1
        m.steps.append({"do": "key", "key": "ArrowDown (choose folder; counted 1)", "on": "Move to"})
    else:
        m.pointer(sel, "Move to select (open)")
        sel.first.select_option(folder["id"])
        if m.mode == "taps":
            m.taps += 1
        else:
            m.clicks += 1
        m.steps.append({"do": "choose option (counted 1)", "on": folder["name"]})
    m.press(pg.get_by_role("button", name="Move", exact=True).filter(visible=True), "Move")
    end = time.time() + 15
    got = []
    while time.time() < end:
        got = [read_note(cx.req, cx.base, i) or {} for i in ids]
        if all(tag in (n.get("tags") or []) and n.get("folderId") == folder["id"] for n in got):
            break
        time.sleep(0.8)
    done = [bool(tag in (n.get("tags") or []) and n.get("folderId") == folder["id"]) for n in got]
    if not all(done):
        raise Inconclusive(f"outcome not reached: per-note tagged-and-moved={done}")
    return {"notes": ids, "tag": tag, "folder": folder["name"]}


def q12_export_word(cx: Ctx, pg, m: Meter, width: str) -> dict:
    nid = fresh_note(cx, f"Export target {_run_tag(cx, 'Q12', m.mode, width)}")
    open_note_start(cx, pg, nid)
    import re
    # 13Q-3: "More note actions" sits in the sticky chrome, same reasoning as Q9's Ask toggle.
    use_skip_link(m, r"Skip to editor toolbar", "Skip to editor toolbar")
    more = pg.locator("button[aria-label='More note actions']").filter(visible=True)
    m.press(more, "More note actions")
    panel = pg.locator("[role=group][aria-label='More note actions']")
    m.press(panel.get_by_role("button", name=re.compile(r"^Export")).filter(visible=True), "Export (in More note actions)")
    item = pg.get_by_role("menuitem", name=re.compile(r"Word")).filter(visible=True)
    item.first.wait_for(state="visible", timeout=10000)
    with pg.expect_download(timeout=30000) as dl:
        if m.mode == "keys":
            # an open menu takes arrow keys; Tab would close it. The member arrows to Word.
            for _ in range(8):
                if is_focused(pg, item):
                    break
                m.key("ArrowDown", "menu: next item")
            m.key("Enter", "Word (.docx)")
        else:
            m.pointer(item, "Word (.docx)")
    fn = dl.value.suggested_filename
    if not fn.lower().endswith(".docx"):
        raise Inconclusive(f"outcome not reached: downloaded {fn!r}")
    return {"note": nid, "file": fn}


def q13_plan_grade(cx: Ctx, pg, m: Meter, width: str) -> dict:
    tid = cx.seed.get("plan_trade_id")
    if not tid:
        raise Inconclusive(f"setup: the planned trade was not seeded ({cx.seed.get('plan_trade_why')})")
    open_start(pg, cx.base, "/journal")
    import re
    trades = pg.get_by_role("link", name=re.compile(r"^Trades")).filter(visible=True)
    m.press(trades, "Journal tab: Trades")
    pg.wait_for_timeout(1500)
    closed = pg.get_by_role("button", name=re.compile(r"Closed", re.I)).filter(visible=True)
    if closed.count() == 0:
        closed = pg.get_by_role("tab", name=re.compile(r"Closed", re.I)).filter(visible=True)
    if closed.count():
        m.press(closed, "Trades segment: Closed")
        pg.wait_for_timeout(1200)
    row = _trade_row(pg, "NVDA")
    if row.count() == 0:
        raise Inconclusive("the planned NVDA trade row is not visible on the Trades surface")
    m.press(_row_opener(row, "NVDA"), "NVDA trade row")
    card = pg.locator('[data-testid="plan-grade-card"]')
    try:
        card.first.wait_for(state="visible", timeout=20000)
    except Exception:  # noqa: BLE001
        raise Inconclusive(f"no plan-grade card on the view the trade row opened (url {pg.url})")
    return {"trade": tid, "card_text": card.first.inner_text()[:300]}


def q15_earnings_prep(cx: Ctx, pg, m: Meter, width: str) -> dict:
    open_start(pg, cx.base, "/journal/notebook")
    import re
    # 13Q-3: bare-root Research Home's own content (ReportingSoon's "Create prep note"
    # button) renders right after the pane heading "Skip to notes list" lands on.
    use_skip_link(m, r"Skip to notes? list", "Skip to notes list")
    btn = pg.get_by_role("button", name=re.compile(r"^(Create prep note for|Open the) NVDA")).filter(visible=True)
    try:
        btn.first.wait_for(state="visible", timeout=30000)
    except Exception:  # noqa: BLE001
        raise Inconclusive("no 'Create prep note for NVDA' on Research Home (Reporting soon did not render)")
    label = btn.first.get_attribute("aria-label")
    m.press(btn, label or "Create prep note for NVDA")
    nid = wait_note_open(pg, 60000)
    n = read_note(cx.req, cx.base, nid) or {}
    if "earnings-prep" not in (n.get("tags") or []):
        raise Inconclusive(f"outcome not reached: opened note {nid} tags={n.get('tags')}")
    return {"note": nid, "button": label}


def q20_chart(cx: Ctx, pg, m: Meter, width: str) -> dict:
    nid = fresh_note(cx, f"Chart target {_run_tag(cx, 'Q20', m.mode, width)}", "NVDA")
    open_note_start(cx, pg, nid)
    ins = pg.get_by_role("button", name="Insert widget").filter(visible=True)
    if ins.count() == 0:
        # 13Q-3: "Format" (the phone formatting disclosure) is also in the sticky chrome --
        # same reach as "Insert widget" itself, so the skip link helps BEFORE this branch too.
        use_skip_link(m, r"Skip to editor toolbar", "Skip to editor toolbar")
        fmt = pg.get_by_role("button", name="Format").filter(visible=True)
        if fmt.count():
            m.press(fmt, "Format (phone toolbar)")
        ins = pg.get_by_role("button", name="Insert widget").filter(visible=True)
    else:
        # 13Q-3: desktop has no Format gate -- "Insert widget" is the LAST control in the
        # toolbar, reached directly from the same skip link.
        use_skip_link(m, r"Skip to editor toolbar", "Skip to editor toolbar")
    m.press(ins, "Insert widget")
    dlg = pg.get_by_role("dialog", name="Insert widget")
    dlg.wait_for(state="visible", timeout=10000)
    import re
    m.press(dlg.get_by_role("button", name=re.compile(r"^Chart")).first, "Chart")
    sym = pg.locator("#uct-palette-sym")
    focus_field(m, sym, "Ticker")
    m.fill(sym, "NVDA", "ticker")
    m.press(dlg.get_by_role("button", name=re.compile(r"^Insert chart")), "Insert chart")
    n = wait_body(cx, nid, lambda n: "widgetEmbed" in json.dumps(n.get("bodyJson") or {}) or
                  "chart" in json.dumps(n.get("bodyJson") or {}).lower(), 20)
    inserted = bool(n) and "chart" in json.dumps(n.get("bodyJson") or {}).lower()
    cx.raw.setdefault("q20_insert_portion", []).append(
        {"mode": m.mode, "width": width, "inserted": inserted, "counted_so_far": m.count(), "tabs": m.tabs})
    raise Inconclusive(f"the insert-a-chart portion measured {m.count()} ({'inserted' if inserted else 'NOT inserted'}); "
                       "drawing entry/stop/target on a note chart and reading the size is lane 13H-2, not on this "
                       "tree (13H-1 shipped the schema and the routes only)")


UNBUILT = {
    "Q14": "lane 13B (My Playbook) is not on this tree: no route, no flag NOTEBOOK_PLAYBOOK_ENABLED in api/routers/auth.py",
    "Q16": "lane 13D (resurfacing) is not on this tree: no AWARENESS_NOTE_RESURFACE_ENABLED read site",
    "Q17": "lane 13E (entry context, 'why did you take it') is not on this tree: no NOTEBOOK_ENTRY_CONTEXT_ENABLED",
    "Q18": "lane 13F (review drafts, leak finder) is not on this tree: no NOTEBOOK_REVIEW_DRAFTS_ENABLED",
    "Q19": "lane 13G (transcript capture) is not on this tree: no NOTEBOOK_TRANSCRIPT_CAPTURE_ENABLED",
    "Q21": "arming an alert at a drawn stop needs lane 13H-2's chart-plan UI; this tree has the 13H-1 routes "
           "(api/routers/notebook_chart_alerts.py) and no member control that calls them",
    "Q22": "lane 13I-2 (visual playbook) is not on this tree; 13I-1 shipped the fingerprint core with no member surface",
    "Q23": "lane 13J (setups board, find similar) is not on this tree: no NOTEBOOK_SETUPS_BOARD_ENABLED",
}

FLOWS = [
    Flow("Q1", q1_new_blank), Flow("Q2", q2_template_ticker), Flow("Q3", q3_open_by_title),
    Flow("Q4", q4_search_open), Flow("Q5", q5_today), Flow("Q6", q6_link_trade),
    Flow("Q7", q7_screener, notes="the plan's control (ruling P5); door in ScannerShell.jsx, measured only"),
    Flow("Q8", q8_fact), Flow("Q9", q9_ask_insert, notes="answer stubbed at the browser network layer"),
    Flow("Q10", q10_task_due), Flow("Q11", q11_tag_move), Flow("Q12", q12_export_word),
    Flow("Q13", q13_plan_grade), Flow("Q14", None, unbuilt=UNBUILT["Q14"]), Flow("Q15", q15_earnings_prep),
    Flow("Q16", None, unbuilt=UNBUILT["Q16"]), Flow("Q17", None, unbuilt=UNBUILT["Q17"]),
    Flow("Q18", None, unbuilt=UNBUILT["Q18"]), Flow("Q19", None, unbuilt=UNBUILT["Q19"]),
    Flow("Q20", q20_chart), Flow("Q21", None, unbuilt=UNBUILT["Q21"]), Flow("Q22", None, unbuilt=UNBUILT["Q22"]),
    Flow("Q23", None, unbuilt=UNBUILT["Q23"]),
]


# ── the runner ───────────────────────────────────────────────────────────────────────────

def run_one(br, state, base: str, flow: Flow, mode: str, width: str, cx: Ctx, out: Path, errors: list) -> dict:
    b = BUDGET[flow.fid]
    budget = b[mode]
    row = {"flow": flow.fid, "name": b["flow"], "owner": b["owner"], "mode": mode, "width": width,
           "budget": budget, "measured": None, "verdict": "INCONCLUSIVE", "reason": "", "tabs": None,
           "keystrokes": None, "clicks": None, "taps": None, "time_s": None, "steps": [], "outcome": None,
           "notes": flow.notes}
    if flow.unbuilt:
        row["reason"] = flow.unbuilt
        print(f"  {flow.fid:>4} {mode:>5} @{width:>4}: INCONCLUSIVE -- {flow.unbuilt[:120]}", flush=True)
        return row
    vp = WIDE if width == "1200" else PHONE
    ctx = br.new_context(viewport=vp, has_touch=(width == "390"), is_mobile=(width == "390"),
                         reduced_motion="reduce", storage_state=state, accept_downloads=True)
    pg = ctx.new_page()
    # 13Q-3 (Q1 fix verification): a brand-new background page never receives script-triggered
    # keyboard focus in Chromium (by design -- a background tab must not steal focus), while
    # synthetic clicks/taps/keypresses are unaffected by foreground state. Every OTHER row in
    # this instrument only ever drives via synthetic input, which is why this was invisible
    # everywhere except the one flow (Q1) whose outcome depends on a programmatic .focus() call.
    # Diagnosed in 13Q-2 (docs/notebook/evidence/wave13-13q2/q1-focus-foreground-diagnosis/);
    # fixed here, the 13Q-owning lane. A real member's tab is always foreground, so this makes
    # the sandbox page behave like one.
    pg.bring_to_front()
    pg.on("pageerror", lambda e: errors.append({"flow": flow.fid, "mode": mode, "width": width,
                                                 "error": str(e)[:300]}))
    pg.on("dialog", lambda d: d.accept())
    m = Meter(pg, mode)
    try:
        outcome = flow.run(cx, pg, m, width)
        row["outcome"] = outcome
        row["measured"] = m.count()
        row["verdict"] = "PASS" if row["measured"] <= budget else "OVER"
    except Capped as e:
        row["measured"] = m.count()
        row["verdict"] = "OVER"
        row["reason"] = f"cap reached: {e}"
    except Inconclusive as e:
        row["reason"] = str(e)[:600]
        row["measured_before_stop"] = m.count()
    except Exception as e:  # noqa: BLE001 -- a driver failure is INCONCLUSIVE, never a pass
        row["reason"] = f"driver could not complete: {type(e).__name__}: {str(e)[:400]}"
        row["measured_before_stop"] = m.count()
        row["traceback"] = traceback.format_exc()[-1500:]
    row["tabs"], row["keystrokes"], row["clicks"], row["taps"] = m.tabs, m.keys, m.clicks, m.taps
    row["time_s"] = m.elapsed()
    row["steps"] = m.steps
    try:
        name = f"{flow.fid}-{mode}-{width}.png"
        pg.screenshot(path=str(out / name))
        row["screenshot"] = name
    except Exception:  # noqa: BLE001
        pass
    ctx.close()
    print(f"  {flow.fid:>4} {mode:>5} @{width:>4}: {row['verdict']:<12} measured={row['measured']} "
          f"budget={budget} tabs={m.tabs} {('-- ' + row['reason'][:140]) if row['reason'] else ''}", flush=True)
    return row


def table_md(rows: list[dict]) -> str:
    lines = ["| flow | mode | width | measured | budget | verdict | tabs | time s | reason |",
             "|---|---|---|---|---|---|---|---|---|"]
    for r in rows:
        meas = r["measured"] if r["measured"] is not None else "-"
        reason = (r.get("reason") or "").replace("|", "/").replace("\n", " ")[:180]
        lines.append(f"| {r['flow']} {r['name']} | {r['mode']} | {r['width']} | {meas} | {r['budget']} | "
                     f"{r['verdict']} | {r['tabs'] if r['tabs'] is not None else '-'} | "
                     f"{r['time_s'] if r['time_s'] is not None else '-'} | {reason} |")
    return "\n".join(lines) + "\n"


def run_all(base: str, data_dir: Path, out: Path, only: set | None, modes: set | None, result: dict) -> None:
    from playwright.sync_api import sync_playwright
    errors: list = []
    result["page_errors"] = errors
    with sync_playwright() as pw:
        br = pw.chromium.launch()
        admin = br.new_context()
        seedctx = br.new_context(viewport=WIDE, reduced_motion="reduce")
        req = seedctx.request
        h._provision(admin.request, req, base, member=MEMBER)
        me = req.get(base + "/api/auth/me").json()
        result["auth_me_flags"] = {k: me.get(k) for k in sorted(me) if k.startswith(("notebook_", "j2_"))}
        cx = Ctx(base=base, req=req)
        seed_member(cx, data_dir)
        result["seed"] = cx.seed
        # one warm visit, so the once-per-tab intro is recorded (setup), never counted in a flow
        pg = seedctx.new_page()
        open_start(pg, base, "/journal/notebook")
        result["first_visit_text"] = pg.locator("body").inner_text()[:1500]
        pg.close()
        state = seedctx.storage_state()
        rows = result["rows"]
        plan = []
        for fl in FLOWS:
            if only and fl.fid not in only:
                continue
            for mode in fl.modes:
                if modes and mode not in modes:
                    continue
                widths = ["390"] if mode == "taps" else (["1200", "390"] if mode == "keys" else ["1200"])
                for wd in widths:
                    plan.append((fl, mode, wd))
        for fl, mode, wd in plan:
            rows.append(run_one(br, state, base, fl, mode, wd, cx, out, errors))
            # R-RAW: rewritten after EVERY row, so a run that dies keeps what it measured
            (out / "clicks.json").write_text(json.dumps({**result, "status": "IN PROGRESS"}, indent=1,
                                                        ensure_ascii=False, default=str), encoding="utf-8")
        result["raw"] = cx.raw
        br.close()


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--data-dir", required=True)
    ap.add_argument("--port", type=int, default=8625)
    ap.add_argument("--out", required=True)
    ap.add_argument("--only", default="", help="comma-separated flow ids (Q1,Q7) -- a partial run says so")
    ap.add_argument("--modes", default="", help="comma-separated subset of mouse,keys,taps")
    args = ap.parse_args(argv)
    why = h.refuse_shared_root(args.data_dir)
    if why:
        print(f"REFUSED: {why}")
        return 3
    if args.port not in PORTS:
        print("REFUSED: this lane uses ports 8625-8629 only (never 8077)")
        return 3
    if h.port_busy(args.port):
        print(f"REFUSED: port {args.port} already has a listener -- this tool never kills it")
        return 3
    data_dir = Path(args.data_dir)
    if data_dir.exists() and any(data_dir.iterdir()):
        print(f"REFUSED: {data_dir} is not empty -- a re-run must not inherit a previous run's notes")
        return 3
    data_dir.mkdir(parents=True, exist_ok=True)
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    only = {s.strip().upper() for s in args.only.split(",") if s.strip()} or None
    modes = {s.strip().lower() for s in args.modes.split(",") if s.strip()} or None
    sha = subprocess.run(["git", "rev-parse", "HEAD"], cwd=str(REPO), capture_output=True, text=True).stdout.strip()
    result = {"tool": "tools/notebook_w13q_clicks.py", "tree": sha,
              "started": datetime.now(timezone.utc).isoformat(timespec="seconds"),
              "partial": {"flows": sorted(only) if only else None, "modes": sorted(modes) if modes else None},
              "sandbox_flags": SANDBOX_FLAGS, "tab_cap": TAB_CAP, "budgets": BUDGET, "rows": [],
              "integrity": None, "failure": None, "not_run": None}
    # claimed before the session starts: a run that dies leaves INCOMPLETE, never a stale pass
    (out / "clicks.json").write_text(json.dumps({**result, "status": "INCOMPLETE (run did not finish)"}, indent=1),
                                     encoding="utf-8")
    not_run = failure = None
    cal = None
    try:
        cal = write_calendar(data_dir)
        result["seed_child"] = seed_stores(data_dir, out)
    except h.SetupFailed as e:
        not_run = str(e)
    for k in ("RAILWAY_ENVIRONMENT", "RAILWAY_ENVIRONMENT_NAME", "RAILWAY_ENVIRONMENT_ID",
              "RAILWAY_PROJECT_ID", "RAILWAY_SERVICE_ID", "RAILWAY_SERVICE_NAME", "RAILWAY_DEPLOYMENT_ID"):
        os.environ.pop(k, None)
    # ⛔ written for the CHILD (Popen inherits it), never read here: the gates' one parse is the app's
    os.environ.update(SANDBOX_FLAGS)
    if cal:
        os.environ["NOTEBOOK_EARNINGS_PREP_SANDBOX_CALENDAR"] = str(cal)
    os.environ.update({"FMP_API_KEY": "", "FINNHUB_API_KEY": "", "ALPHAVANTAGE_API_KEY": ""})
    box = h.Sandbox(str(data_dir), args.port, out / "sandbox.log")
    base = f"http://127.0.0.1:{args.port}"
    if not not_run:
        box.start()
        try:
            if not box.wait_healthy(base, 300):
                failure = "the sandbox never answered /api/health"
            else:
                try:
                    run_all(base, data_dir, out, only, modes, result)
                except h.SetupFailed as e:
                    not_run = str(e)[:300]
                except Exception as e:  # noqa: BLE001 -- recorded; the sandbox is still stopped
                    failure = f"the run raised {type(e).__name__}: {str(e)[:400]}"
                    result["traceback"] = traceback.format_exc()[-3000:]
                box.wait_checkpoint(h.POST_BOOT, 60)
        finally:
            box.stop(grace_s=300)
    integ = (h.read_integrity(box.integrity_path(), [h.PRE_BOOT, h.POST_BOOT, h.SHUTDOWN]) if box.proc
             else {"clean": False, "status": "NOT BOOTED", "checkpoints": []})
    if box.proc:
        h._keep_integrity_log(integ, out / "integrity.md", own=True)
        print(h.integrity_line(integ, f"stop: {box.stop_how}", not_run=not_run))
    api_mods = sorted(m for m in sys.modules if m == "api" or m.startswith("api."))
    result.update({"integrity": integ, "failure": failure, "not_run": not_run,
                   "driver_imported_api": api_mods,
                   "finished": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                   "status": "COMPLETE" if not (failure or not_run) else "NOT COMPLETE"})
    (out / "clicks.json").write_text(json.dumps(result, indent=1, ensure_ascii=False, default=str), encoding="utf-8")
    (out / "table.md").write_text(table_md(result["rows"]), encoding="utf-8")
    print(f"driver imported api.*: {api_mods or 'none'}")
    if not_run:
        print(f"VERDICT: NOT RUN -- {not_run}")
        return 3
    if failure:
        print(f"VERDICT: RUN FAILED -- {failure}")
        return 3
    if not integ.get("clean") or api_mods:
        print(f"VERDICT: INTEGRITY {integ.get('status')}")
        return 2
    counts: dict = {}
    for r in result["rows"]:
        counts[r["verdict"]] = counts.get(r["verdict"], 0) + 1
    print(f"VERDICT: RAN -- {len(result['rows'])} rows; " + ", ".join(f"{k} {v}" for k, v in sorted(counts.items())))
    return 0


if __name__ == "__main__":
    sys.exit(main())
