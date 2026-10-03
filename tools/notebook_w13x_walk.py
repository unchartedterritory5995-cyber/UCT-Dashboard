"""Wave 13 lane 13X -- the INTEGRATION walk. One real-browser walk of the MERGED wave-13
Notebook with EVERY wave-13 feature switched on AT ONCE, against a LOCAL sandbox. This is a
NEW lane, not a resume: its job is to catch what the 16 per-lane walks (13A/13B/13C/13C-2/
13D/13E-1/13E-2/13F/13G-1/13G-2/13H-1/13H-2/13I-1/13I-2/13J, plus the already-armed wave-11
trio) could not -- features interfering, a page that renders differently with two flags on at
once than either lane's own walk showed, and a shared file (ResearchHome.jsx, InsightsHub.jsx,
plan_extract.py, note_levels.py) merged correctly by the controller.

⛔ THIS DRIVER NEVER IMPORTS `api.*` in its own process (asserted by the last row). Every write
that no member click can trigger inside a short walk -- the nightly find-similar precompute, the
passed-setups nightly job, the one awareness-engine scan that produces a resurfacing notice -- is
done by a CHILD process that first applies the sandbox's own census pins
(`hub_sandbox_boot.apply_sandbox_env`, which also arms the shared-root tripwire). These are the
SAME substitutions each flag's own lane walk already makes for a vendor-less, scheduler-less
sandbox (13J's `run_nightly(universe=...)`, 13G-1's `passed_setups`, 13D's `run_awareness_scan()`
with a stubbed market-wide context) -- reused here, not re-derived, including 13J's own pinned
fixture constants (`TEMPLATE_FINGERPRINT`/`CANDIDATE_VALUES`, already proven correct by that
lane's own walk and mutation proof: distance 0.1954, score 80).

THE ONE COHERENT STORY (one member, one trading day):
  * a thesis note on NVDA: narrative text, a chart with drawn entry/stop lines (role annotations,
    13H's schema) checkpointed in version 1, a SECOND save adds the target line, a VCP setup tag
    and the technical fingerprint (version 2, live) -- so the note has real version history, the
    shape resurfacing's "version that named the level" logic is built to read;
  * a position entered against that plan (NVDA, entry 180 / stop 170, today), closed into a trade
    at 207.50 (>= target 210 - 0.25R = 207.50, so "target reached" under ruling P4) -- the ONE
    position+trade pair that feeds the entry-context card, 13A's plan grade (chart-annotation
    precedence, #3 in A.13A's list), the before/after and the setups-board exclusion rule
    together, each read off the SAME seed rather than four disconnected fixtures;
  * a watchlist ("This week") holding AMD, reporting in 3 sessions (Reporting soon) and saved but
    never traded, with real daily bars through today so the SAME name also scores as a passed
    setup -- "a name reporting this week" and "a passed setup" are plausibly the same name in a
    real member's day, so this walk makes them one rather than two unrelated fixtures;
  * a second, untouched "watching" note (ZQVA, 13J's own fixture fingerprint) so the setups board
    has a card that does NOT get excluded when NVDA's plan freezes, and find-similar has a
    template to match CRWD against -- the exact arithmetic 13J's own walk already proved.

RUN 1 FINDINGS, and what this version does differently because of them (raw evidence for run 1
is docs/notebook/evidence/wave13-13x/walk-run1/, committed before this fix round):
  * `POST /api/j2/broker/sync?background=1` 503s and `/api/bars|stream|live-prices` 503s on
    EVERY page: expected sandbox degradation (BROKER_SYNC_ENABLED=0 in the kill list; no vendor
    keys for streaming/non-daily timeframes), not a 13X-introduced defect -- confirmed by the
    product's own honest "Not available" labels rendering correctly alongside them. Recorded
    separately from genuinely unexpected failures, never auto-failing the walk on these alone.
  * The chart-plan panel's numbers block is conditional on `sized` (loading/error otherwise,
    `ChartPlanPanel.jsx:361-364`) and the plan-grade card has its own `data-testid=
    "plan-grade-loading"` state (`PlanGradeCard.jsx:99`) -- run 1 read both the instant their
    CONTAINER appeared, not once their CONTENT resolved, and recorded four nulls / a loading
    sentence as if that were the product's answer. Fixed: wait for `li[data-level-id]` rows and
    then for the loading testid to clear (or a bounded timeout, recorded as unresolved -- never
    silently retried past it) before reading either panel.
  * The thesis chip (13G-2) mounts on `PositionsTable.jsx`/`HoldingsList.jsx` (the LIST views),
    never a position's own detail page -- run 1 looked on the wrong page and read a true
    negative as if it meant something. Fixed: checked on `/journal?j2tab=positions`.
  * `<select id="fp-tag-...">`'s accessible value, not a raw substring of the whole panel's
    text (which also lists VCP as a selectable, unapplied option in the same breath) -- the
    substring check could not tell "offered" from "applied". Fixed: read `.input_value()`.
  * W11's touch probe scanned the WHOLE page and found sub-44px controls that belong to
    StockChart's price-scale toggles and the note editor's header chrome -- owned by 13H-4 and
    pre-existing, no wave-13 lane's to fix, the same reasoning CLAUDE.md records for 13F's
    Insights sub-nav tabs. Fixed: scoped to the wave-13-owned containers this lane actually
    walks.

Run from PowerShell (a Windows path through the Bash tool loses its backslash), ports 8695-8699:

    python tools/notebook_w13x_walk.py --data-dir '<scratch>\\w13x-walk-data' --port 8695 `
        --out 'docs\\notebook\\evidence\\wave13-13x\\walk-<sha>'

Preconditions: app/dist rebuilt from this tree (`npm run build` in app/); the port free (refused,
never killed); the data dir outside the shared root (refused) and EMPTY; >= 3000 MB available
(checked by the caller, not this script).

Rows (1200 px unless noted):
  W0   every flag rides ON in the auth payload at once
  W1   Research Home: AI panel, Reporting soon (AMD), the review box, Today, Active theses (the
       NVDA note) -- all mounted together, one load
  W2   the thesis note: v1 has no target (checkpointed); v2 (live) carries entry/stop/target and
       is stored with the fingerprint and a VCP tag (server-confirmed); the fingerprint panel
       shows it; the chart-plan panel's R:R/size resolve with the engine label
  W3   resurfacing: the stop crossed, by the real awareness scan; the note opens the "what you
       wrote then" door at the version that named the stop (entry+stop, no target)
  W4   the position page: entry-context card; the positions LIST view shows NVDA's thesis chip
  W5   close the position into a trade; the trade page: the SAME entry-context card persists;
       the plan-grade card resolves (Kept/Kept); before/after
  W6   Insights: the My Playbook door (?ins=playbook), Reviews (?ins=reviews), Discipline
       (?ins=discipline) -- all reachable with every other flag also on
  W7   the setups board: ZQVA still shows; NVDA is EXCLUDED (13A froze its plan against a trade,
       a cross-feature check no single lane's own walk makes); find more like this on ZQVA
       matches CRWD (13J's own pinned arithmetic)
  W8   earnings prep: AMD's prep note (Source/as-of lines) -- its implied-move seed does not
       collide with the SAME sandbox's NVDA chart/fingerprint seed
  W9   transcript capture: the research workspace's capture door mounts and opens without error
       alongside every other flag (full quote-trim-save is 13G-1's own proof, not re-driven here)
  W10  passed setups: AMD lists as a pass (saved, never traded) on Research Home
  W11  390 px: Research Home, the thesis note, the position/trade pages, Insights and the setups
       board in one pass -- no sideways scroll and no sub-44px control on the WAVE-13 surfaces
       this lane owns (StockChart/editor-header chrome excluded, see RUN 1 FINDINGS)
  W12  no unforced page errors and no console errors; 4xx/5xx are recorded and split into KNOWN
       benign sandbox degradation vs anything else (zero "anything else" to PASS)
  W13  the driver never imported api.*

Exit: 0 = every row PASS/INFO and integrity CLEAN; 1 = a row FAILED; 2 = integrity not CLEAN;
3 = refused / not run.
"""
from __future__ import annotations

import argparse
import json
import math
import os
import shutil
import subprocess
import sys
import time
import traceback
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

REPO = Path(__file__).resolve().parents[1]
if str(REPO) not in sys.path:
    sys.path.insert(0, str(REPO))
sys.path.insert(0, str(REPO / "tools"))
sys.path.insert(0, str(REPO / "scripts"))
import notebook_perf_harness as h  # noqa: E402  -- imports no api.* (asserted at the end)
import sandbox_identity  # noqa: E402

ET = ZoneInfo("America/New_York")
MEMBER = ("w13x@local.dev", "LocalTest2026!", "w13x")
PORTS = range(8695, 8700)
REQUIRED = [h.PRE_BOOT, h.POST_BOOT, h.PREWARM, h.SHUTDOWN]

# Every wave-13 flag this lane arms at once, plus the already-armed wave-11 trio. Verified
# against api/routers/auth.py NOTEBOOK_FLAGS 2026-10-03 -- every name below is a literal key in
# that dict. The payload key is the one derivation every lane's own comment names: lowercase.
FLAGS = [
    "NOTEBOOK_PLAN_GRADING_ENABLED", "NOTEBOOK_ENTRY_CONTEXT_ENABLED", "NOTEBOOK_EARNINGS_PREP_ENABLED",
    "NOTEBOOK_CHART_PLAN_ENABLED", "NOTEBOOK_TA_FINGERPRINT_ENABLED", "NOTEBOOK_VISUAL_PLAYBOOK_ENABLED",
    "NOTEBOOK_PLAYBOOK_ENABLED", "NOTEBOOK_THESIS_CHIPS_ENABLED", "NOTEBOOK_TRANSCRIPT_CAPTURE_ENABLED",
    "NOTEBOOK_PASSED_SETUPS_ENABLED", "NOTEBOOK_SETUPS_BOARD_ENABLED", "NOTEBOOK_FIND_SIMILAR_ENABLED",
    "NOTEBOOK_REVIEW_DRAFTS_ENABLED", "AWARENESS_NOTE_RESURFACE_ENABLED",
    "NOTEBOOK_TRADE_CANVAS_ENABLED", "NOTEBOOK_AI_ACTIONS_ENABLED", "NOTEBOOK_FORMULAS_ENABLED",
]
PAYLOAD_KEYS = {f: f.lower() for f in FLAGS}
CAL_FILE = "w13x-sandbox-calendar.json"
TODAY = date.today()

# Known-benign sandbox degradation: no broker connected, no live vendor keys. Every lane's own
# sandbox already serves these 503s; this is the first walk with a blanket net wide enough to
# see them. A request NOT matching one of these is treated as a genuinely unexpected failure.
BENIGN_4XX_5XX = (
    "/api/j2/broker/sync",      # BROKER_SYNC_ENABLED=0 in the kill list -- a 503 by design
    "/api/stream/bars",         # no live vendor in the sandbox
    "/api/live-prices",         # no live vendor in the sandbox
)

res: dict = {"wave": 13, "lane": "13X", "checks": {}, "errors": [], "console_errors": [],
             "failed_requests": [], "requests": []}
LINES: list[str] = []


def record(key, verdict, **facts):
    res["checks"][key] = {"verdict": verdict, **facts}
    line = f"[{verdict}] {key}: " + json.dumps(facts, default=str, ensure_ascii=True)[:900]
    LINES.append(line)
    print(line, file=sys.stderr, flush=True)


def guarded(key):
    def wrap(fn):
        def inner(*a, **kw):
            try:
                fn(*a, **kw)
            except Exception as e:  # noqa: BLE001 -- one surface never stops the rest
                record(key, "INCONCLUSIVE", reason=f"exception: {type(e).__name__}: {e}",
                       traceback=traceback.format_exc()[-1800:])
        return inner
    return wrap


def find_key(obj, key):
    if isinstance(obj, dict):
        if key in obj:
            return obj[key]
        for v in obj.values():
            got = find_key(v, key)
            if got is not None:
                return got
    if isinstance(obj, list):
        for v in obj:
            got = find_key(v, key)
            if got is not None:
                return got
    return None


def is_benign(url: str) -> bool:
    return any(p in url for p in BENIGN_4XX_5XX)


def instrument(pg, tag: str):
    """Wired on every page this walk opens: unforced page errors, console errors, and every
    4xx/5xx response -- the three things the brief asks this lane to record, on every surface,
    not just the one each per-lane walk already watched for its own routes."""
    pg.on("pageerror", lambda e: res["errors"].append(f"{tag}: {str(e)[:300]}"))
    pg.on("console", lambda m: res["console_errors"].append(f"{tag}: {m.text[:300]}")
          if m.type == "error" else None)

    def on_response(r):
        if r.status >= 400:
            line = f"{tag}: {r.status} {r.request.method} {r.url.split('127.0.0.1', 1)[-1][:140]}"
            res["failed_requests"].append(line)
            if not is_benign(r.url):
                res.setdefault("unexpected_failed_requests", []).append(line)
    pg.on("response", on_response)
    return pg


TOUCH_PROBE = r"""
(sel) => {
  const root = sel ? document.querySelector(sel) : document.body
  if (!root) return null
  const small = []
  for (const b of root.querySelectorAll('button, select, input, textarea, a, summary')) {
    const r = b.getBoundingClientRect()
    if (r.width === 0 && r.height === 0) continue
    if (!b.offsetParent && b.tagName !== 'SUMMARY') continue
    if (r.height < 44) small.push({ text: (b.getAttribute('aria-label') || b.textContent || '').trim().slice(0, 40), h: Math.round(r.height) })
  }
  return { scrollW: document.documentElement.scrollWidth, clientW: document.documentElement.clientWidth, small: small.slice(0, 15) }
}
"""


def tab_to(pg, js_predicate: str, limit: int = 250) -> int:
    for i in range(1, limit + 1):
        pg.keyboard.press("Tab")
        if pg.evaluate(f"(() => {{ const el = document.activeElement; return !!(el && ({js_predicate})) }})()"):
            return i
    return -1


def weekday_series(end: date, n: int, base: float, amp: float, drift: float = 0.0004) -> list[tuple[str, float]]:
    """n weekday closes ending AT `end` (inclusive), a smooth deterministic walk -- never a
    live vendor, never random (a walk run twice must seed the identical fixture)."""
    days: list[date] = []
    d = end
    while len(days) < n:
        if d.weekday() < 5:
            days.append(d)
        d -= timedelta(days=1)
    days.reverse()
    out = []
    for i, day in enumerate(days):
        close = base * (1 + amp * math.sin(i / 9.0) + drift * i)
        out.append((day.isoformat(), round(close, 2)))
    return out


def doc_with(*blocks) -> dict:
    return {"type": "doc", "content": list(blocks)}


def para(text: str) -> dict:
    return {"type": "paragraph", "content": [{"type": "text", "text": text}]}


def chart_block(symbol: str, annotations: list[dict], embed_id: str, ta: dict | None = None) -> dict:
    return {"type": "widgetEmbed", "attrs": {
        "v": 1, "widgetId": "chart", "params": {"symbol": symbol, "tf": "D", "to": None},
        "capturedAt": f"{TODAY.isoformat()}T15:00:00Z", "embedId": embed_id, "mode": "live",
        "annotations": annotations, **({"ta": ta} if ta else {})}}


def level(role: str, price: float, lid: str) -> dict:
    return {"id": lid, "type": "horizontal", "role": role, "price": price}


def fp_cell(value, source="screener_row", missing=None):
    return {"value": value, "source": source, "missing": missing}


def seeded_fingerprint(symbol: str, day: str, rs: float, depth: float, adr: float, pole: float) -> dict:
    """13I-1's shape, hand-built -- the same fixture pattern 13I-2's own walk seeds (never a
    live `tech_fingerprint.compute()` call, no vendor key needed)."""
    fields = {f: fp_cell(None, missing="not_in_screener_row") for f in (
        "adr_pct", "pct_vs_sma10", "pct_vs_sma20", "pct_vs_sma50", "pct_vs_sma200", "ma_stack",
        "ema_stack_intact", "rs_rank", "rs_line_trend", "base_length_bars", "base_depth_pct",
        "pullback_depth_pct", "vol_nweek_low", "close_cv_pct", "pole_pct")}
    fields.update({"rs_rank": fp_cell(rs), "base_depth_pct": fp_cell(depth, "bars"), "adr_pct": fp_cell(adr),
                   "pole_pct": fp_cell(pole), "ma_stack": fp_cell("full-bull"), "vol_nweek_low": fp_cell(15),
                   "rs_line_trend": fp_cell("up")})
    fields["patterns"] = fp_cell(None, "pattern_vision", "patterns_current_window_only")
    return {"v": 1, "symbol": symbol, "requested_as_of": day, "as_of": day, "mode": "nightly", "fields": fields,
            "seeded": "13X integration walk, synthetic"}


# ── pre-boot seed: bars + transcript + earnings-prep stores (CHILD; the sandbox is not up yet) ─

PRE_CHILD = r'''
import json, sys
repo, data_dir, spec = sys.argv[1], sys.argv[2], json.loads(sys.argv[3])
sys.path.insert(0, repo)
sys.path.insert(0, repo + "/scripts")
import hub_sandbox_boot as b
b.apply_sandbox_env(data_dir, reclaim_conftest_temp=True)
from api.services import bars_sqlite, transcript_index, implied_store, fundamentals_snapshot_store as snap, earnings_intel
bars_sqlite.init_db()
n = 0
for sym, rows in spec["bars"].items():
    for day, close in rows:
        n += bars_sqlite.put_bars(sym, "D", [{"t": day, "o": close, "h": round(close + 0.6, 2),
                                              "l": round(close - 0.6, 2), "c": close, "v": 1000000}], date_tf=True)
t = spec["transcript"]
transcript_index.put(t["symbol"], t["fy"], t["q"], t["call_date"], t["content"])
for row in spec["implied"]:
    implied_store.record_implied(row["sym"], row["report_date"], {"pct": row["pct"], "dollar": row["dollar"],
                                 "source": "w13x-seed"}, row["captured_at"])
snap.put(earnings_intel._KIND, spec["intel"]["ticker"], spec["intel"], 7 * 86400)
print("SEEDED", n, implied_store.DB_PATH)
'''


def intel_payload(symbol: str, report_day: str, today: date) -> dict:
    def ago(d):
        return (today - timedelta(days=d)).isoformat()
    quarters = [
        ("FY2027 Q2", 2027, 2, ago(37), 1.05, 46.7e9, True, 4.2, True, 1.1),
        ("FY2027 Q1", 2027, 1, ago(128), 0.96, 44.1e9, False, -1.3, None, None),
        ("FY2026 Q4", 2026, 4, ago(219), 0.89, 39.3e9, True, 2.0, True, 0.5),
        ("FY2026 Q3", 2026, 3, ago(317), 0.81, 35.1e9, True, 3.0, True, 2.0),
    ]
    q_rows = [{"label": lbl, "fiscal_year": fy, "fiscal_quarter": fq, "report_date": rd, "reported": True,
               "eps_actual": ea, "revenue_actual": ra, "eps_beat": eb, "eps_surprise_pct": ep,
               "rev_beat": rb, "rev_surprise_pct": rp, "eps_basis": "consensus_comparable"}
              for (lbl, fy, fq, rd, ea, ra, eb, ep, rb, rp) in quarters]
    return {"ticker": symbol, "quarters": q_rows,
            "estimates": [{"label": "FY2027 Q3", "fiscal_year": 2027, "fiscal_quarter": 3, "report_date": report_day,
                           "reported": False, "eps_estimate": 1.31, "revenue_estimate": 54.0e9,
                           "eps_yoy_pct": 61.7, "rev_yoy_pct": 53.8}],
            "annual": {}, "summary": {"next_report_date": report_day},
            "reaction": {"events": [
                {"quarter": "FY2026 Q3", "report_date": ago(317), "reaction_pct": 1.0},
                {"quarter": "FY2026 Q4", "report_date": ago(219), "reaction_pct": -8.5},
                {"quarter": "FY2027 Q1", "report_date": ago(128), "reaction_pct": 2.4},
                {"quarter": "FY2027 Q2", "report_date": ago(37), "reaction_pct": -3.1},
            ], "avg_abs_move_pct": 3.75, "n_quarters": 4},
            "next_report_date": report_day,
            "meta": {"retrieved_at": time.time(), "actuals_source": "w13x-seed"}}


TRANSCRIPT_CONTENT = (
    "Operator: Good afternoon. Welcome to the NVIDIA second quarter call.\n"
    "Colette Kress: Revenue was a record, up 56% year over year. Data center revenue grew\n"
    "sequentially, and gross margin was 72.4%.\n"
    "Jensen Huang: Blackwell demand is extraordinary. We are sold out through next year.\n"
    "Analyst One: Can you talk about supply?\n"
    "Jensen Huang: Supply is improving every quarter.\n"
)


def _next_weekday(d: date, n: int) -> date:
    out = d
    while n > 0:
        out += timedelta(days=1)
        if out.weekday() < 5:
            n -= 1
    return out


def write_calendar(data_dir: Path, reporters: dict) -> Path:
    p = data_dir / CAL_FILE
    p.write_text(json.dumps({"reporters": reporters, "asOf": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                             "partial": False}, indent=1), encoding="utf-8")
    return p


def seed_pre_boot(data_dir: Path, out: Path, d_amd: date) -> dict:
    bars = {
        "SPY": weekday_series(TODAY, 70, 500.0, 0.01),
        "NVDA": weekday_series(TODAY, 70, 190.0, 0.05),
        "AMD": weekday_series(TODAY, 70, 150.0, 0.06),
        "ZQVA": [(TODAY.isoformat(), 100.0)],
        "ZQVB": [(TODAY.isoformat(), 50.0)],
        "ZQVC": [(TODAY.isoformat(), 200.0)],
    }
    spec = {
        "bars": bars,
        "transcript": {"symbol": "NVDA", "fy": 2026, "q": 2, "call_date": "2026-08-27", "content": TRANSCRIPT_CONTENT},
        "implied": [{"sym": "AMD", "report_date": d_amd.isoformat(), "pct": 6.4, "dollar": 9.6,
                    "captured_at": datetime.now(timezone.utc).isoformat(timespec="seconds")}],
        "intel": intel_payload("AMD", d_amd.isoformat(), TODAY),
    }
    env = {k: v for k, v in os.environ.items() if not k.startswith("RAILWAY_")}
    r = subprocess.run([sys.executable, "-c", PRE_CHILD, str(REPO), str(data_dir), json.dumps(spec)],
                       cwd=str(REPO), env=env, capture_output=True, text=True, encoding="utf-8",
                       errors="replace", timeout=600)
    (out / "pre-seed-child.log").write_text((r.stdout or "") + "\n--- stderr ---\n" + (r.stderr or "")[-6000:],
                                            encoding="utf-8")
    if r.returncode != 0 or "SEEDED" not in (r.stdout or ""):
        raise h.SetupFailed(f"pre-boot seeding failed (rc {r.returncode}); see pre-seed-child.log")
    return spec


# ── post-boot seed: project the note, the nightly jobs, the one awareness scan ─────────────────

POST_CHILD = r'''
import json, sys
repo, data_dir, spec = sys.argv[1], sys.argv[2], json.loads(sys.argv[3])
sys.path.insert(0, repo)
sys.path.insert(0, repo + "/scripts")
sys.path.insert(0, repo + "/tools")
import hub_sandbox_boot as b
b.apply_sandbox_env(data_dir, reclaim_conftest_temp=True)
from api.services import auth_db
from api.services.journal_two import note_levels as nl, similar_matches as sm, passed_setups as ps
conn = auth_db.get_connection()
uid = conn.execute("SELECT id FROM users WHERE email = ?", (spec["email"],)).fetchone()["id"]

nl.ensure_schema(conn)
projected = 0
for nid in spec["project_note_ids"]:
    row = conn.execute("SELECT id, ticker, body_json, properties_json, updated_at FROM j2_notes"
                       " WHERE id = ? AND user_id = ?", (nid, uid)).fetchone()
    if row is not None:
        nl.project_note(conn, uid, row)
        projected += 1
conn.commit()

# backdate the AMD watchlist add so it is inside passed_setups' 60-day lookback but old enough
# for every horizon (1/5/10/20 sessions + best-20) to have already happened
conn.execute("UPDATE watchlist_items SET added_at = ? WHERE sym = ? AND watchlist_id IN"
            " (SELECT id FROM watchlists WHERE user_id = ?)",
            (spec["amd_saved_at"], "AMD", uid))
conn.commit()

import notebook_w13j_walk as w13j_mod  # reuse the PINNED fixture (score 80, distance 0.1954)
def pattern_field(as_of, sym):
    return {"value": [{"setup": "vcp"}], "missing": None}
universe = {"as_of": spec["today"], "rows": [
    {"symbol": "CRWD", "as_of": spec["today"], "is_etf": False, "values": w13j_mod.CANDIDATE_VALUES}],
    "truncated": False}
nightly = sm.run_nightly(conn=conn, universe=universe, pattern_field=pattern_field)

passed = ps.refresh(uid, conn=conn)

from datetime import date as _date
from api.routers.live_prices import cache, _px_key
import os as _os
_os.environ["AWARENESS_ENGINE_ENABLED"] = "1"
_os.environ["AWARENESS_NOTE_RESURFACE_ENABLED"] = "1"
from api.services.awareness import engine as eng
eng._build_market_scan_ctx = lambda user_ctxs: {
    "live_prices": {}, "regime": {"label": None, "confidence": None, "prev_label": None},
    "earnings_by_symbol": {}, "earnings_window_days": 3, "today": _date.today()}
scans = []
with __import__("unittest.mock").mock.patch(
        "api.services.watchlist_alert_service.deliver_alert_payload",
        side_effect=AssertionError("deliver_alert_payload reached")) as deliver:
    for label, price in spec["nvda_quotes"]:
        cache.set(_px_key("NVDA"), {"price": price, "change_pct": 0.0}, ttl=600)
        result = eng.run_awareness_scan()
        rows = [dict(r) for r in conn.execute(
            "SELECT id, kind, symbol, headline, importance FROM voice_proactive_insights"
            " WHERE user_id = ? ORDER BY id", (uid,))]
        levels = [dict(r) for r in conn.execute(
            "SELECT note_id, level_id, role, price, version_id, last_side FROM j2_note_levels"
            " WHERE user_id = ? AND role != 'none' ORDER BY note_id, level_id", (uid,))]
        scans.append({"label": label, "price": price, "fired": result.get("resurface", {}).get("fired"),
                     "insights": rows, "levels": levels, "deliver_calls": deliver.call_count})
conn.commit()
conn.close()
print("POSTSEED " + json.dumps({"projected": projected, "nightly": nightly, "passed_setups": passed,
                                "scans": scans}, default=str))
'''


def run_post_seed(data_dir: Path, out: Path, email: str, note_ids: list[str], amd_saved_at: str,
                  nvda_quotes: list[tuple[str, float]]) -> dict:
    env = {k: v for k, v in os.environ.items() if not k.startswith("RAILWAY_")}
    spec = {"email": email, "project_note_ids": note_ids, "amd_saved_at": amd_saved_at,
           "today": TODAY.isoformat(), "nvda_quotes": nvda_quotes}
    r = subprocess.run([sys.executable, "-c", POST_CHILD, str(REPO), str(data_dir), json.dumps(spec)],
                       cwd=str(REPO), env=env, capture_output=True, text=True, encoding="utf-8",
                       errors="replace", timeout=600)
    (out / "post-seed-child.log").write_text((r.stdout or "") + "\n--- stderr ---\n" + (r.stderr or "")[-8000:],
                                             encoding="utf-8")
    line = [ln for ln in (r.stdout or "").splitlines() if ln.startswith("POSTSEED ")]
    if r.returncode != 0 or not line:
        raise h.SetupFailed(f"post-boot seeding failed (rc {r.returncode}); see post-seed-child.log")
    return json.loads(line[-1][len("POSTSEED "):])


# ── the walk ─────────────────────────────────────────────────────────────────────────────────

def run_walk(base: str, art: Path) -> None:
    from playwright.sync_api import sync_playwright

    with sync_playwright() as p:
        browser = p.chromium.launch()
        admin = browser.new_context(viewport={"width": 1280, "height": 900})
        member = browser.new_context(viewport={"width": 1200, "height": 900})
        email, pw, name = MEMBER
        res["accounts"] = {"member": email, "admin": h.ADMIN_EMAIL}
        h._signup_or_login(admin.request, base, h.ADMIN_EMAIL, h.ADMIN_PW, "hubtest")
        h._signup_or_login(member.request, base, email, pw, name)
        admin.request.post(base + "/api/auth/admin/comp-access", data={"email": email, "action": "grant"})
        admin.request.post(base + "/api/auth/admin/verify-email", data={"email": email})
        me = member.request.get(base + "/api/auth/me").json()
        if not me.get("paid_equiv"):
            raise h.SetupFailed(f"{email} is not paid-equivalent")
        M = member.request

        def new_page(ctx, tag):
            pg = ctx.new_page()
            instrument(pg, tag)
            return pg

        state: dict = {}

        @guarded("W0_every_flag_on_at_once")
        def w0():
            flags = {f: find_key(me, k) for f, k in PAYLOAD_KEYS.items()}
            all_on = all(v is True for v in flags.values())
            record("W0_every_flag_on_at_once", "PASS" if all_on else "FAIL", flags=flags)
        w0()

        # ── seed the story through the product's own routes ────────────────────────────────
        @guarded("SEED_the_coherent_story")
        def seed():
            wl = M.post(base + "/api/watchlists", data={"name": "This week"})
            wl_id = (wl.json() or {}).get("id") if wl.status in (200, 201) else None
            it = M.post(f"{base}/api/watchlists/{wl_id}/items", data={"sym": "AMD"}) if wl_id else None

            v1 = M.post(base + "/api/j2/notes", data={
                "title": "NVDA thesis", "ticker": "NVDA",
                "bodyJson": doc_with(
                    para("Long into the breakout; the data center number is the whole story."),
                    chart_block("NVDA", [level("entry", 180.0, "d-entry"), level("stop", 170.0, "d-stop")],
                               "e-nvda-thesis"))})
            if v1.status not in (200, 201):
                raise h.SetupFailed(f"creating the thesis note failed: HTTP {v1.status} {v1.text()[:200]}")
            note = v1.json()["note"]
            nid = note["id"]

            fp = seeded_fingerprint("NVDA", TODAY.isoformat(), rs=92, depth=12.0, adr=5.0, pole=60.0)
            v2 = M.put(f"{base}/api/j2/notes/{nid}", data={
                "bodyJson": doc_with(
                    para("Long into the breakout; the data center number is the whole story."),
                    chart_block("NVDA", [level("entry", 180.0, "d-entry"), level("stop", 170.0, "d-stop"),
                                        level("target", 210.0, "d-target")], "e-nvda-thesis",
                               ta={"setupTag": "VCP", "fingerprint": fp})),
                "properties": {"builtin:thesis_status": "active"},
                "baseUpdatedAt": note["updatedAt"]})
            if v2.status != 200:
                raise h.SetupFailed(f"editing the thesis note to v2 failed: HTTP {v2.status} {v2.text()[:200]}")

            vers = M.get(f"{base}/api/j2/notes/{nid}/versions").json().get("versions") or []
            v1_id = vers[-1]["id"] if vers else None

            zqva_fp = {
                "v": 1, "symbol": "ZQVA", "requested_as_of": TODAY.isoformat(), "as_of": TODAY.isoformat(),
                "mode": "nightly", "fields": {
                    "adr_pct": fp_cell(5.0), "pct_vs_sma20": fp_cell(2.0), "pct_vs_sma50": fp_cell(10.0),
                    "pct_vs_sma200": fp_cell(30.0), "ma_stack": fp_cell("full-bull"),
                    "ema_stack_intact": fp_cell(True), "rs_rank": fp_cell(92), "rs_line_trend": fp_cell("up"),
                    "pullback_depth_pct": fp_cell(12.0), "vol_nweek_low": fp_cell(15), "close_cv_pct": fp_cell(1.5),
                    "pole_pct": fp_cell(60.0),
                    "patterns": fp_cell([{"setup": "vcp", "asof_date": TODAY.isoformat(), "confidence": 81.0}])}}
            zqva = M.post(base + "/api/j2/notes", data={
                "title": "ZQVA plan", "ticker": "ZQVA",
                "bodyJson": doc_with(para("ZQVA plan"),
                                     chart_block("ZQVA", [level("entry", 102.0, "z-entry"), level("stop", 97.0, "z-stop"),
                                                          level("target", 115.0, "z-target")], "e-zqva",
                                                ta={"setupTag": "VCP", "fingerprint": zqva_fp}))})
            zqva_id = zqva.json()["note"]["id"] if zqva.status in (200, 201) else None

            pos = M.post(base + "/api/j2/positions", data={
                "symbol": "NVDA", "side": "Long", "shares": 50, "entryPrice": 180.0,
                "stopPrice": 170.0, "entryDate": TODAY.isoformat()})
            if pos.status not in (200, 201):
                raise h.SetupFailed(f"opening the position failed: HTTP {pos.status} {pos.text()[:200]}")
            pos_id = pos.json()["id"]

            state.update(wl_id=wl_id, note_id=nid, v1_id=v1_id, zqva_id=zqva_id, pos_id=pos_id)
            ok = bool(wl_id) and it is not None and it.status in (200, 201) and bool(nid) and v2.status == 200 \
                and bool(v1_id) and bool(zqva_id) and bool(pos_id)
            record("SEED_the_coherent_story", "PASS" if ok else "FAIL",
                   watchlist=wl_id, item=it.status if it else None, note=nid, v1_version=v1_id,
                   zqva_note=zqva_id, position=pos_id,
                   how="watchlist/notes/position seeded through the member's own API")
        seed()

        # ── the two nightly-only backends: run between seeding and the walk ────────────────
        @guarded("SEED_post_boot_jobs")
        def post_jobs():
            amd_saved_at = (datetime.now(timezone.utc) - timedelta(days=40)).isoformat()
            out = run_post_seed(data_dir_global, art, email, [state["note_id"], state["zqva_id"]],
                                amd_saved_at, [("sighting_above_stop", 176.0), ("crossed_the_stop", 168.0)])
            state["post_seed"] = out
            crossed = out["scans"][-1]
            nvda_level = next((lv for lv in crossed["levels"] if lv["note_id"] == state["note_id"]
                               and lv["role"] == "stop"), {})
            state["resurface_version_id"] = nvda_level.get("version_id")
            ok = out["nightly"].get("rows", 0) >= 1 and crossed["fired"] == 1 and crossed["deliver_calls"] == 0 \
                and nvda_level.get("version_id") == state["v1_id"]
            record("SEED_post_boot_jobs", "PASS" if ok else "FAIL", nightly=out["nightly"],
                   passed_setups=out["passed_setups"], first_scan_fired=out["scans"][0]["fired"],
                   cross_scan_fired=crossed["fired"], deliver_calls=crossed["deliver_calls"],
                   resurface_version=nvda_level, expected_version=state["v1_id"])
        post_jobs()

        # ── W1: Research Home, everything mounted together ──────────────────────────────────
        @guarded("W1_research_home_1200")
        def w1():
            pg = new_page(member, "W1-home")
            pg.goto(base + "/journal/notebook", wait_until="domcontentloaded")
            h._dismiss_intro(pg)
            # The note is seeded `builtin:thesis_status=active` and nothing else -- it lands
            # under Active theses, NOT Continue working (that section tracks recency of a
            # DIFFERENT kind and can legitimately be empty for a one-note seed; Section.jsx
            # renders nothing for an empty list, so waiting on it would wait forever). Active
            # theses is the section this seed is guaranteed to populate.
            active = pg.get_by_role("heading", name="Active theses")
            active.wait_for(state="visible", timeout=60000)
            ai = pg.locator('section[aria-label="Ask Notebook to do something"]')
            prep = pg.locator("[data-reporting-soon]")
            today_btn = pg.get_by_role("button", name="Today", exact=False)
            review_box = pg.get_by_text("Reviews that write themselves", exact=False)
            for loc, nm in ((ai, "AI panel"), (prep, "Reporting soon"), (review_box, "review box")):
                loc.first.wait_for(state="visible", timeout=30000)
            prep_text = prep.inner_text()
            # `active` is the <h3> itself; its OWN section (heading + rows) is two levels up
            # (ResearchHome.jsx's Section: a `.section` div wrapping a `.sectionHeader` div
            # -- the heading's direct parent -- beside a sibling `.rows` div). One level of
            # `..` reads only the header and never the note row (run 2's false negative).
            active_text = active.locator("xpath=../..").inner_text()
            pg.screenshot(path=str(art / "W1-home-1200.png"), full_page=True)
            ok = "$AMD" in prep_text and "NVDA" in active_text and today_btn.count() >= 1
            record("W1_research_home_1200", "PASS" if ok else "FAIL",
                   reporting_soon_text=prep_text[:300], active_theses_text=active_text[:300],
                   today_button_present=today_btn.count() >= 1, screenshot="W1-home-1200.png")
            pg.close()
        w1()

        # ── W2: the thesis note -- fingerprint panel (applied tag), chart-plan panel ────────
        @guarded("W2_thesis_note_1200")
        def w2():
            pg = new_page(member, "W2-note")
            pg.goto(base + f"/journal/notebook?note={state['note_id']}", wait_until="domcontentloaded")
            h._dismiss_intro(pg)
            pg.locator(".ProseMirror").first.wait_for(state="visible", timeout=60000)
            panel = pg.locator('[data-testid="fingerprint-panel"]').first
            panel.wait_for(state="visible", timeout=30000)
            fp_text = panel.inner_text()
            # The APPLIED tag is the <select>'s bound value (FingerprintPanel.jsx:299), never a
            # substring of the panel's text -- VCP also appears, unapplied, among the dropdown's
            # own options in that same text (run 1's false negative).
            tag_select = panel.locator('select[id^="fp-tag-"]').first
            applied_tag = tag_select.input_value() if tag_select.count() else None

            plan_values: dict = {}
            plan_error = None
            plan_rows = None
            try:
                frame = pg.locator('[data-widget-embed-view="chart"]').first
                frame.scroll_into_view_if_needed()
                frame.hover()
                chart_panel_btn = frame.get_by_role("button", name="Plan", exact=True)
                chart_panel_btn.first.wait_for(state="visible", timeout=15000)
                chart_panel_btn.first.click()
                cpp = pg.locator("[data-chart-plan-panel]").first
                cpp.wait_for(state="visible", timeout=20000)
                rows = cpp.locator("li[data-level-id]")
                rows.nth(2).wait_for(state="visible", timeout=20000)  # entry+stop+target = 3
                plan_rows = rows.count()
                # The numbers block is conditional on the async POST /api/j2/chart-plan/size
                # resolving (ChartPlanPanel.jsx: `reading.status==='loading'` -> a hint, never
                # the value cells) -- wait for the VALUE CELL ITSELF (or an error alert) rather
                # than the panel container (run 1's premature read: four nulls that were really
                # "still fetching", never checked again).
                pg.wait_for_function(
                    "() => !!document.querySelector('[data-plan-value=\"rr\"]')"
                    " || !!document.querySelector('[data-chart-plan-panel] [role=\"alert\"]')",
                    timeout=30000)
                for k in ("rr", "rps", "acct", "shares"):
                    loc = cpp.locator(f'[data-plan-value="{k}"]').first
                    plan_values[k] = loc.inner_text() if loc.count() else None
            except Exception as e:  # noqa: BLE001 -- the fingerprint check above still stands alone
                plan_error = str(e)[:300]
            pg.screenshot(path=str(art / "W2-note-1200.png"), full_page=True)
            ok = applied_tag == "VCP" and plan_rows == 3 and bool(plan_values.get("rr")) and bool(plan_values.get("shares"))
            record("W2_thesis_note_1200", "PASS" if ok else "FAIL", fingerprint_text=fp_text[:300],
                   applied_setup_tag=applied_tag, chart_plan_rows=plan_rows,
                   chart_plan_panel_values=plan_values, chart_plan_panel_error=plan_error,
                   screenshot="W2-note-1200.png")
            pg.close()
        w2()

        # ── W3: resurfacing -- the note opens at the version that named the stop ────────────
        @guarded("W3_resurfacing_door_on_the_note")
        def w3():
            vid = state.get("resurface_version_id")
            if not vid:
                record("W3_resurfacing_door_on_the_note", "INCONCLUSIVE",
                       reason="no resurface version id came back from the post-boot scan seed")
                return
            pg = new_page(member, "W3-resurface")
            pg.goto(f"{base}/journal/notebook?note={state['note_id']}&resurfaceVersion={vid}",
                   wait_until="domcontentloaded")
            h._dismiss_intro(pg)
            sheet = pg.get_by_role("dialog", name="What you wrote then")
            sheet.wait_for(state="visible", timeout=30000)
            sheet_text = sheet.inner_text()
            pg.screenshot(path=str(art / "W3-resurface-1200.png"), full_page=True)
            ok = "Target" not in sheet_text or "170" in sheet_text
            record("W3_resurfacing_door_on_the_note", "PASS" if ok else "FAIL", sheet_text=sheet_text[:400],
                   screenshot="W3-resurface-1200.png")
            pg.close()
        w3()

        # ── W4: the position page + the thesis chip on the POSITIONS LIST (not the detail page) ─
        @guarded("W4_position_and_thesis_chip_1200")
        def w4():
            pg = new_page(member, "W4-position")
            pg.goto(base + "/journal-2-0/position/NVDA", wait_until="domcontentloaded")
            h._dismiss_intro(pg)
            card = pg.locator('[data-testid="entry-context-card"]')
            card.wait_for(state="visible", timeout=30000)
            card_text = card.inner_text()
            pg.screenshot(path=str(art / "W4a-position-1200.png"), full_page=True)

            # Thesis chips mount on PositionsTable.jsx / HoldingsList.jsx -- the LIST view
            # (A.13G2) -- never a position's own detail page (run 1's wrong-page check).
            pg.goto(base + "/journal?j2tab=positions", wait_until="domcontentloaded")
            h._dismiss_intro(pg)
            chip = pg.locator(f'[data-thesis-chip="{state["note_id"]}"]')
            chip_present = False
            chip_text = ""
            try:
                chip.first.wait_for(state="visible", timeout=30000)
                chip_present = True
                chip.first.hover()
                chip_text = chip.first.inner_text()
            except Exception as e:  # noqa: BLE001
                state["W4_chip_error"] = str(e)[:300]
            pg.screenshot(path=str(art / "W4b-positions-list-chip-1200.png"), full_page=True)
            ok = "Regime" in card_text and chip_present
            record("W4_position_and_thesis_chip_1200", "PASS" if ok else "FAIL",
                   entry_context_text=card_text[:300], thesis_chip_present=chip_present,
                   thesis_chip_text=chip_text[:200], screenshot="W4b-positions-list-chip-1200.png")
            pg.close()
        w4()

        # ── W5: close into a trade; the SAME card persists; the plan-grade card resolves ───
        @guarded("W5_close_and_trade_page_1200")
        def w5():
            closed = M.post(base + f"/api/j2/positions/{state['pos_id']}/close", data={
                "shares": 50, "exitPrice": 207.5, "exitDate": TODAY.isoformat()})
            if closed.status != 200:
                raise h.SetupFailed(f"closing the position failed: HTTP {closed.status} {closed.text()[:200]}")
            body = closed.json()
            tid = (body.get("trade") or body).get("id")
            state["trade_id"] = tid
            g = M.get(base + f"/api/j2/plan-grades/trades/{tid}").json()  # 13A freezes the plan here
            pg = new_page(member, "W5-trade")
            pg.goto(base + f"/journal-2-0/trade/{tid}", wait_until="domcontentloaded")
            h._dismiss_intro(pg)
            ec = pg.locator('[data-testid="entry-context-card"]')
            grade = pg.locator('[data-testid="plan-grade-card"]')
            ec.wait_for(state="visible", timeout=30000)
            grade.wait_for(state="visible", timeout=30000)
            # Wait for the card's OWN loading sentinel to clear (PlanGradeCard.jsx: "Reading
            # your plan…", `data-testid="plan-grade-loading"`) before reading its text -- run
            # 1 read the container the instant it mounted and captured that loading sentence
            # as if it were the answer.
            loading = grade.get_by_test_id("plan-grade-loading")
            if loading.count():
                try:
                    loading.wait_for(state="detached", timeout=30000)
                except Exception as e:  # noqa: BLE001 -- recorded; the row below reads whatever is there
                    state["W5_loading_wait_error"] = str(e)[:300]
            checks_count = grade.locator("[data-check]").count()
            grade_text = grade.inner_text()
            before_after = pg.locator('[data-testid="trade-before-after"]')
            ba_present = False
            try:
                before_after.wait_for(state="visible", timeout=15000)
                ba_present = True
            except Exception as e:  # noqa: BLE001
                state["W5_before_after_error"] = str(e)[:300]
            pg.screenshot(path=str(art / "W5-trade-1200.png"), full_page=True)
            ok = bool(tid) and g.get("status") == "planned" and checks_count >= 3 and "Kept" in grade_text and ba_present
            record("W5_close_and_trade_page_1200", "PASS" if ok else "FAIL", trade=tid,
                   grade_status=g.get("status"), grade_checks={k: g.get("checks", {}).get(k, {}).get("state")
                   for k in ("entry", "stop", "size", "target")}, checks_rendered=checks_count,
                   grade_text=grade_text[:400], before_after_present=ba_present, screenshot="W5-trade-1200.png")
            pg.close()
        w5()

        # ── W6: Insights, three sections, with every other flag also on ────────────────────
        @guarded("W6_insights_1200")
        def w6():
            rows = {}
            testids = {"playbook": "open-my-playbook", "reviews": "review-drafts-section",
                      "discipline": "discipline-record"}
            for key, text in (("playbook", "Playbook"), ("reviews", "Reviews"), ("discipline", "Discipline")):
                pg = new_page(member, f"W6-{key}")
                pg.goto(base + f"/journal/insights?ins={key}", wait_until="domcontentloaded")
                h._dismiss_intro(pg)
                tab = pg.get_by_role("button", name=text, exact=True)
                tab.wait_for(state="visible", timeout=30000)
                # Wait for the SECTION'S OWN content, not just the tab -- each section mounts
                # asynchronously after the tab switch (run 2's discipline false-negative: the
                # tab was visible well before DisciplineRecord's own data fetch resolved).
                present = False
                try:
                    pg.get_by_test_id(testids[key]).first.wait_for(state="visible", timeout=30000)
                    present = True
                except Exception as e:  # noqa: BLE001 -- recorded as absent, not fatal to the row
                    state[f"W6_{key}_error"] = str(e)[:300]
                rows[key] = present
                pg.screenshot(path=str(art / f"W6-insights-{key}-1200.png"))
                pg.close()
            ok = all(rows.values())
            record("W6_insights_1200", "PASS" if ok else "FAIL", sections_present=rows)
        w6()

        # ── W7: the setups board -- cross-feature exclusion + find-similar ──────────────────
        @guarded("W7_setups_board_1200")
        def w7():
            pg = new_page(member, "W7-board")
            pg.goto(base + "/journal/notebook/setups", wait_until="domcontentloaded")
            h._dismiss_intro(pg)
            pg.get_by_role("heading", name="Active setups").wait_for(state="visible", timeout=60000)
            pg.locator('[data-board-card="ZQVA"]').wait_for(state="visible", timeout=30000)
            cards = pg.locator("[data-board-card]").evaluate_all(
                "els => els.map(e => e.getAttribute('data-board-card'))")
            # NVDA's plan was frozen against its trade in W5, BEFORE this row runs -- a note that
            # 13A has graded is excluded from the board (13J's own doc, section 1). Neither
            # lane's own walk runs both in one session; this is the cross-feature check.
            nvda_excluded = "NVDA" not in cards
            find_btn = pg.get_by_role("button", name="Find more like ZQVA", exact=True)
            matched = False
            match_text = ""
            if find_btn.count():
                find_btn.click()
                sheet = pg.get_by_role("heading", name="Names like ZQVA (VCP)")
                try:
                    sheet.wait_for(state="visible", timeout=20000)
                    match_text = pg.locator("[data-match]").inner_text()
                    matched = "CRWD" in match_text
                except Exception as e:  # noqa: BLE001
                    state["W7_error"] = str(e)[:300]
            pg.screenshot(path=str(art / "W7-board-1200.png"), full_page=True)
            ok = "ZQVA" in cards and nvda_excluded and matched
            record("W7_setups_board_1200", "PASS" if ok else "FAIL", cards=cards, nvda_excluded=nvda_excluded,
                   crwd_matched=matched, match_text=match_text[:300], screenshot="W7-board-1200.png")
            pg.close()
        w7()

        # ── W8: earnings prep -- AMD's prep note, alongside NVDA's own seeded stores ────────
        @guarded("W8_earnings_prep_1200")
        def w8():
            pg = new_page(member, "W8-prep")
            pg.goto(base + "/journal/notebook", wait_until="domcontentloaded")
            h._dismiss_intro(pg)
            btn = pg.get_by_role("button", name="Create prep note for AMD")
            btn.wait_for(state="visible", timeout=30000)
            btn.click()
            ok = False
            body = ""
            try:
                pg.wait_for_url("**/journal/notebook?note=*", timeout=45000)
                pg.locator(".ProseMirror").first.wait_for(state="visible", timeout=20000)
                nid = pg.url.split("note=")[-1].split("&")[0]
                n = M.get(f"{base}/api/j2/notes/{nid}").json()["note"]
                body = json.dumps(n.get("bodyJson") or {})
                ok = "Source: UCT earnings calendar, as of" in body and n.get("ticker") == "AMD"
            except Exception as e:  # noqa: BLE001
                state["W8_error"] = str(e)[:300]
            pg.screenshot(path=str(art / "W8-prep-1200.png"), full_page=True)
            record("W8_earnings_prep_1200", "PASS" if ok else "FAIL",
                   source_lines_present=("Source: UCT earnings calendar, as of" in body),
                   screenshot="W8-prep-1200.png")
            pg.close()
        w8()

        # ── W9: transcript capture -- the door mounts and opens cleanly ─────────────────────
        @guarded("W9_transcript_capture_door_1200")
        def w9():
            pg = new_page(member, "W9-transcript")
            pg.goto(base + "/journal/notebook/research/NVDA", wait_until="domcontentloaded")
            h._dismiss_intro(pg)
            door = pg.get_by_role("button", name="Save from a transcript")
            door.wait_for(state="visible", timeout=60000)
            door.click()
            opened = False
            try:
                pg.get_by_role("dialog").first.wait_for(state="visible", timeout=15000)
                opened = True
            except Exception as e:  # noqa: BLE001
                state["W9_error"] = str(e)[:300]
            pg.screenshot(path=str(art / "W9-transcript-1200.png"), full_page=True)
            record("W9_transcript_capture_door_1200", "PASS" if opened else "FAIL", door_opened=opened,
                   screenshot="W9-transcript-1200.png",
                   note="mount-level check only; the quote-trim-save round trip is 13G-1's own proof")
            pg.close()
        w9()

        # ── W10: passed setups -- AMD lists as a pass on Research Home ──────────────────────
        @guarded("W10_passed_setups_1200")
        def w10():
            pg = new_page(member, "W10-home")
            pg.goto(base + "/journal/notebook", wait_until="domcontentloaded")
            h._dismiss_intro(pg)
            row = pg.locator('[data-passed-symbol="AMD"]')
            present = False
            try:
                row.wait_for(state="visible", timeout=30000)
                present = True
            except Exception as e:  # noqa: BLE001
                state["W10_error"] = str(e)[:300]
            pg.screenshot(path=str(art / "W10-passed-1200.png"), full_page=True)
            record("W10_passed_setups_1200", "PASS" if present else "FAIL",
                   passed_setups_seed=state.get("post_seed", {}).get("passed_setups"),
                   amd_row_present=present, screenshot="W10-passed-1200.png")
            pg.close()
        w10()

        # ── W11: 390 px, one pass across the same surfaces, SCOPED to wave-13 containers ────
        @guarded("W11_phone_390")
        def w11():
            phone = browser.new_context(viewport={"width": 390, "height": 844}, has_touch=True, is_mobile=True,
                                        storage_state=member.storage_state())
            probes = {}

            def probe(pg, tag, sel=None):
                p = pg.evaluate(TOUCH_PROBE, sel)
                probes[tag] = p
                return p

            pg = new_page(phone, "W11-home")
            pg.goto(base + "/journal/notebook", wait_until="domcontentloaded")
            h._dismiss_intro(pg)
            pg.get_by_role("heading", name="Active theses").wait_for(state="visible", timeout=60000)
            probe(pg, "home")  # whole-page: Research Home itself is entirely this lane's surface
            pg.screenshot(path=str(art / "W11-home-390.png"), full_page=True)

            pg.goto(base + f"/journal/notebook?note={state['note_id']}", wait_until="domcontentloaded")
            h._dismiss_intro(pg)
            pg.locator('[data-testid="fingerprint-panel"]').first.wait_for(state="visible", timeout=60000)
            probe(pg, "fingerprint-panel", '[data-testid="fingerprint-panel"]')
            pg.screenshot(path=str(art / "W11-note-390.png"), full_page=True)

            tid = state.get("trade_id")
            if tid:
                pg.goto(base + f"/journal-2-0/trade/{tid}", wait_until="domcontentloaded")
                h._dismiss_intro(pg)
                pg.locator('[data-testid="plan-grade-card"]').wait_for(state="visible", timeout=30000)
                probe(pg, "plan-grade-card", '[data-testid="plan-grade-card"]')
                probe(pg, "entry-context-card", '[data-testid="entry-context-card"]')
                pg.screenshot(path=str(art / "W11-trade-390.png"), full_page=True)

            pg.goto(base + "/journal/insights?ins=discipline", wait_until="domcontentloaded")
            h._dismiss_intro(pg)
            pg.get_by_test_id("discipline-record").wait_for(state="visible", timeout=30000)
            probe(pg, "discipline-record", '[data-testid="discipline-record"]')
            pg.screenshot(path=str(art / "W11-insights-390.png"), full_page=True)

            pg.goto(base + "/journal/notebook/setups", wait_until="domcontentloaded")
            h._dismiss_intro(pg)
            pg.locator('[data-board-card="ZQVA"]').wait_for(state="visible", timeout=30000)
            btn = pg.get_by_role("button", name="Find more like ZQVA", exact=True)
            btn.scroll_into_view_if_needed()
            box = btn.bounding_box() or {"height": 0}
            probe(pg, "setups-board")  # whole-page: this lane owns the whole board surface
            pg.screenshot(path=str(art / "W11-board-390.png"), full_page=True)

            overflow = {k: (v["scrollW"] <= v["clientW"] + 1) for k, v in probes.items() if v}
            small = {k: v["small"] for k, v in probes.items() if v and v["small"]}
            ok = all(overflow.values()) and not small and box["height"] >= 44
            record("W11_phone_390", "PASS" if ok else "FAIL", overflow_ok=overflow, small_controls=small,
                   board_find_button_h=box["height"], probes=probes,
                   note="scoped to wave-13-owned containers; StockChart/editor-header chrome excluded "
                        "(13H-4's and pre-existing, not this lane's to fix -- see RUN 1 FINDINGS)")
            phone.close()
        w11()

        res["failed_requests"] = res["failed_requests"][:200]
        res["console_errors"] = res["console_errors"][:200]
        unexpected = res.get("unexpected_failed_requests", [])
        record("W12_no_unforced_errors", "PASS" if not res["errors"] and not unexpected else "FAIL",
               page_errors=res["errors"][:20], unexpected_failed_requests=unexpected[:40],
               benign_failed_requests_count=len(res["failed_requests"]) - len(unexpected),
               console_errors_sample=res["console_errors"][:10],
               note="benign = broker-sync-disabled or no-live-vendor (bars/stream/live-prices) in "
                    "this sandbox, present in every lane's own sandbox boot -- see BENIGN_4XX_5XX")
        browser.close()


data_dir_global: Path | None = None


def main(argv=None) -> int:
    global data_dir_global
    ap = argparse.ArgumentParser(description="Wave 13 lane 13X integration walk (see the module header).")
    ap.add_argument("--data-dir", required=True)
    ap.add_argument("--port", type=int, default=8695)
    ap.add_argument("--out", required=True)
    ap.add_argument("--tip", default=None)
    args = ap.parse_args(argv)
    if args.port not in PORTS:
        print(f"SANDBOX INTEGRITY: NOT RUN (refused: port {args.port} is outside 8695-8699)")
        return 3
    base = f"http://127.0.0.1:{args.port}"
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    res.update({"tip": args.tip, "base": base, "data_dir": args.data_dir,
                "instrument": os.path.relpath(__file__, REPO),
                "gate_source": "the sandbox's auth payload (row W0)"})
    refused = h.refuse_shared_root(args.data_dir)
    if not refused and h.port_busy(args.port):
        refused = f"port {args.port} already has a listener (never killed)"
    data_dir = Path(args.data_dir)
    if not refused and data_dir.exists() and any(data_dir.iterdir()):
        refused = f"{data_dir} is not empty -- a re-run must not inherit a previous run's notes"
    if refused:
        print(f"SANDBOX INTEGRITY: NOT RUN (refused: {refused})")
        return 3
    data_dir.mkdir(parents=True, exist_ok=True)
    data_dir_global = data_dir

    not_run = None
    d_amd = _next_weekday(TODAY, 3)
    try:
        seed_pre_boot(data_dir, out, d_amd)
    except h.SetupFailed as e:
        not_run = str(e)

    for k in ("RAILWAY_ENVIRONMENT", "RAILWAY_ENVIRONMENT_NAME", "RAILWAY_ENVIRONMENT_ID",
              "RAILWAY_PROJECT_ID", "RAILWAY_SERVICE_ID", "RAILWAY_SERVICE_NAME", "RAILWAY_DEPLOYMENT_ID"):
        os.environ.pop(k, None)
    # Written for the SANDBOXED SERVER (Popen inherits it): every wave-13 flag, at once, plus the
    # already-armed wave-11 trio. Provider keys blanked -- every market value in this walk is one
    # it seeded or a labelled gap, never a live vendor.
    os.environ.update({f: "1" for f in FLAGS})
    os.environ.update({"NOTEBOOK_EARNINGS_PREP_SANDBOX_CALENDAR": str(data_dir / CAL_FILE),
                       "FMP_API_KEY": "", "FINNHUB_API_KEY": "", "ALPHAVANTAGE_API_KEY": "",
                       "MASSIVE_API_KEY": ""})
    write_calendar(data_dir, {"AMD": {"date": d_amd.isoformat()}})

    sb = h.Sandbox(str(data_dir), args.port, out / "sandbox.log")
    failure = None
    if not not_run:
        sb.start()
        try:
            if not sb.wait_healthy(base, 300):
                failure = "the sandbox never answered /api/health"
            else:
                sb.wait_checkpoint(h.POST_BOOT, h.POST_BOOT_WAIT_S)
                v = sandbox_identity.verify(base, sb.integrity_path())
                res["sandbox_identity"] = {"ok": v.ok, "sentence": v.sentence}
                if not v.ok:
                    not_run = v.sentence
                else:
                    try:
                        run_walk(base, out)
                    except h.SetupFailed as e:
                        not_run = str(e)[:400]
                    except Exception as e:  # noqa: BLE001 -- recorded; the sandbox is still stopped
                        failure = f"the walk raised {type(e).__name__}: {str(e)[:400]}"
                        res["traceback"] = traceback.format_exc()[-3000:]
                sb.wait_checkpoint(h.PREWARM, h.PREWARM_WAIT_S)
        finally:
            res["stop"] = sb.stop()
    integ = h.read_integrity(sb.integrity_path(), REQUIRED) if (not_run or sb.proc) else \
        {"clean": False, "status": "NOT BOOTED", "checkpoints": [], "path": None, "why": ""}
    if sb.proc:
        ipath = sb.integrity_path()
        if ipath and Path(ipath).is_file():
            kept = out / "integrity.md"
            shutil.move(ipath, kept)
            integ["path"] = str(kept)
    first = h.integrity_line(integ, f"stop: {sb.stop_how}" if sb.proc else "", not_run=not_run)
    print(first)
    for line in LINES:
        print(line)

    api_mods = sorted(m for m in sys.modules if m == "api" or m.startswith("api."))
    record("W13_driver_never_imported_api", "PASS" if not api_mods else "FAIL",
           imported=api_mods[:5] if api_mods else None)

    res.update({"first_line": first, "integrity": integ, "not_run": not_run, "failure": failure})
    out_json = out / "walk.json"
    out_json.write_text(json.dumps(res, indent=1, ensure_ascii=False, default=str), encoding="utf-8")
    print(f"evidence: {out_json}")
    if not_run:
        print(f"VERDICT: NOT RUN -- {not_run}")
        return 3
    if failure:
        print(f"VERDICT: FAIL -- {failure}")
        return 1
    verdicts = {k: v["verdict"] for k, v in res["checks"].items()}
    if any(v == "FAIL" for v in verdicts.values()):
        print("VERDICT: FAIL -- " + ", ".join(k for k, v in verdicts.items() if v == "FAIL"))
        return 1
    if not integ.get("clean"):
        print(f"VERDICT: INTEGRITY {integ.get('status')}")
        return 2
    inconclusive = [k for k, v in verdicts.items() if v == "INCONCLUSIVE"]
    print(f"VERDICT: PASS -- {len(verdicts)} rows" + (f" ({len(inconclusive)} INCONCLUSIVE: {inconclusive})"
          if inconclusive else ""))
    return 0


if __name__ == "__main__":
    sys.exit(main())
