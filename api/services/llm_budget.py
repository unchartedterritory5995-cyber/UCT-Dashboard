"""Daily AI budgets over the one AI-spend ledger (api/services/llm_usage.py).

WHY. The ledger says where the money goes; this decides how much may go. One
table of daily dollar budgets, editable from /admin/ai-spend, keyed by:

  * a feature's module path (`api/services/tsdr_lessons.py`) -- the same key the
    ledger records, so a budget and the spend it bounds can never disagree;
  * `*`            -- the whole site;
  * `*background`  -- every feature that is NOT a member door (background,
                      operator, eval, unlisted) -- the lane where nobody is
                      waiting, so stopping it costs a delay, not a member.

Each budget has a MODE:
  * `alert` -- the watchdog posts to the ops channel at 80% / 100% (and when the
               day's pace projects past the budget). Nothing is refused.
  * `block` -- the same alerts, AND once the day's spend reaches the budget the
               SDK hook refuses further calls from that feature with
               `LLMBudgetExceeded` before any request is sent. Background jobs
               ask `allows(door)` first and skip their tick instead of failing.

FAIL DIRECTIONS, chosen deliberately:
  * A budget lookup or spend read that ERRORS allows the call (one log line).
    A metering fault must never become a site outage; the alerts still fire.
  * `*` in block mode refuses member doors too -- that is the owner's explicit
    choice when they set it. `*background` never touches a member door.
  * Spend is read from the ledger, cached `_CACHE_S` seconds per process, so a
    hot path costs one dict lookup, not a query.
  * The ET day is the budget day (the ledger's `day` column).
"""
from __future__ import annotations

import contextlib
import logging
import threading
import time
from dataclasses import dataclass
from datetime import datetime
from zoneinfo import ZoneInfo

from api.services import llm_usage

log = logging.getLogger(__name__)
_ET = ZoneInfo("America/New_York")
_CACHE_S = 20.0
MODES = ("alert", "block")
GLOBAL, BACKGROUND = "*", "*background"
_MEMBER_KINDS = ("member",)

# Seeded ONCE when the table is first created (an edited or deleted row is never
# re-seeded). Chosen 2026-11-10 against ~$80/day total: the two background lanes
# with no dollar cap of their own, plus a site-wide alert.
DEFAULT_BUDGETS = (
    (GLOBAL, 60.0, "alert", "site-wide daily alert"),
    ("api/services/tsdr_lessons.py", 10.0, "block",
     "Opus 5.5 lesson backfill, every 15 min; had no spend ledger of its own"),
    ("api/services/desk_session_insights.py", 5.0, "block",
     "desk session transcripts; ticker backfill can re-bill a session every pass"),
)

_DDL = """
CREATE TABLE IF NOT EXISTS llm_budgets (
  door TEXT PRIMARY KEY,
  daily_usd REAL NOT NULL,
  mode TEXT NOT NULL DEFAULT 'alert',
  note TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS llm_budget_alerts (
  day TEXT NOT NULL,
  door TEXT NOT NULL,
  level TEXT NOT NULL,
  at TEXT NOT NULL,
  PRIMARY KEY (day, door, level)
);
CREATE TABLE IF NOT EXISTS llm_budget_meta (k TEXT PRIMARY KEY, v TEXT NOT NULL);
"""

_lock = threading.Lock()
_spend_cache: tuple[float, str, dict[str, float]] = (0.0, "", {})
_budget_cache: tuple[float, dict[str, dict]] = (0.0, {})


class LLMBudgetExceeded(Exception):
    """Raised by the SDK hook, before any request is sent, when a feature's
    block-mode budget is spent for the day."""

    def __init__(self, door: str, budget_key: str, spent: float, cap: float):
        self.door, self.budget_key, self.spent, self.cap = door, budget_key, spent, cap
        super().__init__(f"daily AI budget reached for {door} ({budget_key}: ${spent:.2f} of ${cap:.2f})")


@dataclass(frozen=True)
class Decision:
    allowed: bool
    budget_key: str = ""
    spent: float = 0.0
    cap: float = 0.0


def _now_iso() -> str:
    return datetime.now(_ET).isoformat(timespec="seconds")


def today() -> str:
    return datetime.now(_ET).date().isoformat()


def _conn():
    c = llm_usage.connect()
    c.executescript(_DDL)
    seeded = c.execute("SELECT v FROM llm_budget_meta WHERE k = 'seeded'").fetchone()
    if not seeded:
        for door, usd, mode, note in DEFAULT_BUDGETS:
            c.execute("INSERT OR IGNORE INTO llm_budgets (door, daily_usd, mode, note, updated_at, updated_by) "
                      "VALUES (?,?,?,?,?, 'default')", (door, usd, mode, note, _now_iso()))
        c.execute("INSERT OR REPLACE INTO llm_budget_meta (k, v) VALUES ('seeded', ?)", (_now_iso(),))
        c.commit()
    return c


def _invalidate() -> None:
    global _spend_cache, _budget_cache
    _spend_cache, _budget_cache = (0.0, "", {}), (0.0, {})


# ── budgets ──────────────────────────────────────────────────────────────────

def budgets(fresh: bool = False) -> dict[str, dict]:
    global _budget_cache
    if not fresh and time.time() - _budget_cache[0] < _CACHE_S:
        return _budget_cache[1]
    with contextlib.closing(_conn()) as c:
        rows = c.execute("SELECT door, daily_usd, mode, note, updated_at, updated_by FROM llm_budgets").fetchall()
    out = {r[0]: {"door": r[0], "daily_usd": float(r[1]), "mode": r[2], "note": r[3],
                  "updated_at": r[4], "updated_by": r[5]} for r in rows}
    _budget_cache = (time.time(), out)
    return out


def set_budget(door: str, daily_usd: float, mode: str = "alert", note: str = "", by: str = "") -> dict:
    door = (door or "").strip()
    if not door or len(door) > 300:
        raise ValueError("door is required")
    if mode not in MODES:
        raise ValueError(f"mode must be one of {MODES}")
    usd = float(daily_usd)
    if not (usd > 0):  # ⛔ a 0 / negative / NaN budget must never read as "unlimited" or "block all"
        raise ValueError("daily_usd must be > 0")
    with contextlib.closing(_conn()) as c:
        c.execute("INSERT INTO llm_budgets (door, daily_usd, mode, note, updated_at, updated_by) "
                  "VALUES (?,?,?,?,?,?) ON CONFLICT(door) DO UPDATE SET daily_usd=excluded.daily_usd, "
                  "mode=excluded.mode, note=excluded.note, updated_at=excluded.updated_at, "
                  "updated_by=excluded.updated_by", (door, usd, mode, note[:300], _now_iso(), by[:120]))
        c.commit()
    _invalidate()
    return budgets(fresh=True)[door]


def delete_budget(door: str) -> bool:
    with contextlib.closing(_conn()) as c:
        n = c.execute("DELETE FROM llm_budgets WHERE door = ?", (door,)).rowcount
        c.commit()
    _invalidate()
    return bool(n)


# ── spend ────────────────────────────────────────────────────────────────────

def spend_by_door(day: str | None = None, fresh: bool = False) -> dict[str, float]:
    global _spend_cache
    day = day or today()
    ts, cday, cached = _spend_cache
    if not fresh and cday == day and time.time() - ts < _CACHE_S:
        return cached
    llm_usage.flush()  # rows still queued in this process count too
    with contextlib.closing(llm_usage.connect()) as c:
        rows = c.execute("SELECT door, COALESCE(SUM(cost_usd),0) FROM llm_usage_calls WHERE day = ? "
                         "GROUP BY door", (day,)).fetchall()
    out = {r[0]: float(r[1]) for r in rows}
    _spend_cache = (time.time(), day, out)
    return out


def _door_kind(door: str) -> str:
    try:
        from api.services import ai_doors
        d = ai_doors.DOORS.get(door)
        return d.kind if d else "unlisted"
    except Exception:  # noqa: BLE001
        return "unlisted"


def spent_for_key(key: str, by_door: dict[str, float]) -> float:
    if key == GLOBAL:
        return sum(by_door.values())
    if key == BACKGROUND:
        return sum(v for d, v in by_door.items() if _door_kind(d) not in _MEMBER_KINDS)
    return by_door.get(key, 0.0)


def keys_for(door: str) -> list[str]:
    keys = [door, GLOBAL]
    if _door_kind(door) not in _MEMBER_KINDS:
        keys.append(BACKGROUND)
    return keys


# ── the decision ─────────────────────────────────────────────────────────────

def check(door: str) -> Decision:
    """Would a model call from `door` be allowed right now? Never raises."""
    try:
        bs = budgets()
        applicable = [bs[k] for k in keys_for(door) if k in bs and bs[k]["mode"] == "block"]
        if not applicable:
            return Decision(True)
        by_door = spend_by_door()
        for b in applicable:
            spent = spent_for_key(b["door"], by_door)
            if spent >= b["daily_usd"]:
                return Decision(False, b["door"], spent, b["daily_usd"])
        return Decision(True)
    except Exception:  # noqa: BLE001 -- a metering fault must not become an outage
        log.warning("[llm_budget] check failed for %s; allowing", door, exc_info=True)
        return Decision(True)


def allows(door: str) -> bool:
    """For a background job's tick: skip the run instead of failing its calls."""
    d = check(door)
    if not d.allowed:
        log.info("[llm_budget] %s skipped: %s at $%.2f of $%.2f today", door, d.budget_key, d.spent, d.cap)
    return d.allowed


def enforce(door: str) -> None:
    d = check(door)
    if not d.allowed:
        raise LLMBudgetExceeded(door, d.budget_key, d.spent, d.cap)


# ── status + the watchdog ────────────────────────────────────────────────────

def day_fraction_elapsed(now: datetime | None = None) -> float:
    now = (now or datetime.now(_ET)).astimezone(_ET)
    return (now.hour * 3600 + now.minute * 60 + now.second) / 86400.0


def status(day: str | None = None) -> list[dict]:
    by_door = spend_by_door(day, fresh=True)
    frac = day_fraction_elapsed()
    out = []
    for key, b in sorted(budgets(fresh=True).items()):
        spent = spent_for_key(key, by_door)
        projected = spent / frac if (day in (None, today()) and frac >= 2 / 24) else spent
        pct = spent / b["daily_usd"] if b["daily_usd"] else 0.0
        level = "over" if pct >= 1 else ("warn" if pct >= 0.8 or projected > b["daily_usd"] * 1.1 else "ok")
        out.append({**b, "spent": round(spent, 4), "projected": round(projected, 2), "pct": round(pct, 4),
                    "level": level, "blocking": b["mode"] == "block" and pct >= 1})
    return out


def _post(text: str) -> bool:
    try:
        from api.services.alert_destination import ops_webhook
        url = (ops_webhook("warning", producer="llm_budget") or "").strip()
        if not url:
            return False
        import json
        import urllib.request
        req = urllib.request.Request(url, data=json.dumps({"content": text[:1900]}).encode("utf-8"),
                                     headers={"Content-Type": "application/json",
                                              "User-Agent": "UCT-llm-budget/1.0"}, method="POST")
        with urllib.request.urlopen(req, timeout=10) as r:
            return 200 <= r.status < 300
    except Exception:  # noqa: BLE001
        log.warning("[llm_budget] alert post failed", exc_info=True)
        return False


def _label(door: str) -> str:
    if door == GLOBAL:
        return "whole site"
    if door == BACKGROUND:
        return "all background jobs"
    return door.replace("api/services/", "").replace("api/routers/", "").removesuffix(".py")


def watch(post=None) -> list[dict]:
    """Every 15 min: alert once per (day, budget, level). Returns what it sent."""
    post = post or _post
    day = today()
    sent: list[dict] = []
    try:
        rows = status(day)
        with contextlib.closing(_conn()) as c:
            for r in rows:
                if r["level"] == "ok":
                    continue
                if c.execute("SELECT 1 FROM llm_budget_alerts WHERE day=? AND door=? AND level=?",
                             (day, r["door"], r["level"])).fetchone():
                    continue
                verb = "REACHED" if r["level"] == "over" else "on pace to exceed"
                action = (" Further calls from it are now REFUSED until midnight ET." if r["blocking"]
                          else "" if r["mode"] == "alert" else " It will be refused once it reaches the budget.")
                text = (f"AI spend {verb} its budget: **{_label(r['door'])}** ${r['spent']:.2f} of "
                        f"${r['daily_usd']:.2f} today ({r['mode']}), projected ${r['projected']:.2f}.{action} "
                        f"Details: /admin/ai-spend")
                if post(text):
                    c.execute("INSERT OR IGNORE INTO llm_budget_alerts (day, door, level, at) VALUES (?,?,?,?)",
                              (day, r["door"], r["level"], _now_iso()))
                    c.commit()
                    sent.append({"door": r["door"], "level": r["level"], "text": text})
            c.execute("DELETE FROM llm_budget_alerts WHERE day < date(?, '-14 days')", (day,))
            c.commit()
    except Exception:  # noqa: BLE001
        log.warning("[llm_budget] watch failed", exc_info=True)
    return sent


# -- Daily digest (2026-11-10) ---------------------------------------------------
# One post a day to the ops channel: where the day's AI money went, by feature and by
# segment, against the day before and the trailing week. The budget alerts above say
# "something crossed a line"; this says "here is the whole bill", so a slow creep in a
# feature nobody budgeted is visible without opening /admin/ai-spend.
# Off with LLM_SPEND_DIGEST=0.
def _segment(door: str) -> str:
    # Site code is always attributed to an `api/` module (or "unattributed"); every other
    # door comes from outside: the PC meter (tools/pc_llm_meter, `<repo>/<entry script>`),
    # the sibling repos' sub_claude reporters, tx-recap.
    if not door.startswith("api/") and door != "unattributed":
        return "outside site"
    return "member" if _door_kind(door) in _MEMBER_KINDS else (
        "unlisted" if _door_kind(door) == "unlisted" else "background")


def digest_data(day: str | None = None) -> dict:
    """The numbers the digest prints, as data (tests and the admin page can read it)."""
    import datetime as _dt
    day = day or today()
    d0 = _dt.date.fromisoformat(day)
    prev = (d0 - _dt.timedelta(days=1)).isoformat()
    week0 = (d0 - _dt.timedelta(days=7)).isoformat()
    llm_usage.flush()
    with contextlib.closing(llm_usage.connect()) as c:
        rows = c.execute(
            "SELECT door, COUNT(*), COALESCE(SUM(cost_usd),0), GROUP_CONCAT(DISTINCT model), "
            "SUM(CASE WHEN kind='batch' THEN cost_usd ELSE 0 END), "
            "SUM(CASE WHEN ok=0 THEN cost_usd ELSE 0 END) "
            "FROM llm_usage_calls WHERE day = ? GROUP BY door", (day,)).fetchall()
        prev_by = dict(c.execute("SELECT door, COALESCE(SUM(cost_usd),0) FROM llm_usage_calls "
                                 "WHERE day = ? GROUP BY door", (prev,)).fetchall())
        week = c.execute("SELECT COUNT(DISTINCT day), COALESCE(SUM(cost_usd),0) FROM llm_usage_calls "
                         "WHERE day >= ? AND day < ?", (week0, day)).fetchone()
        models = c.execute("SELECT model, COALESCE(SUM(cost_usd),0) FROM llm_usage_calls WHERE day = ? "
                           "GROUP BY model ORDER BY 2 DESC", (day,)).fetchall()
    doors = sorted(({"door": r[0], "calls": int(r[1]), "usd": float(r[2]), "models": r[3] or "",
                     "batch_usd": float(r[4] or 0), "failed_usd": float(r[5] or 0),
                     "prev_usd": float(prev_by.get(r[0], 0.0)), "segment": _segment(r[0])}
                    for r in rows), key=lambda x: -x["usd"])
    total = sum(x["usd"] for x in doors)
    segments: dict[str, float] = {}
    for x in doors:
        segments[x["segment"]] = segments.get(x["segment"], 0.0) + x["usd"]
    week_days = int(week[0] or 0)
    return {"day": day, "total": total, "prev_total": float(sum(prev_by.values())),
            "week_avg": (float(week[1]) / week_days) if week_days else None, "week_days": week_days,
            "calls": sum(x["calls"] for x in doors), "doors": doors, "segments": segments,
            "models": [(m or "?", float(u)) for m, u in models],
            "batch_usd": sum(x["batch_usd"] for x in doors),
            "failed_usd": sum(x["failed_usd"] for x in doors),
            "budgets": [r for r in status(day) if r["level"] != "ok"]}


def _money(v: float) -> str:
    return f"${v:,.2f}"


def digest_text(data: dict, top: int = 10) -> str:
    t = data["total"]
    lines = [f"**AI spend {data['day']}: {_money(t)}** over {data['calls']:,} calls"]
    ref = []
    if data["prev_total"]:
        ref.append(f"yesterday {_money(data['prev_total'])} ({(t - data['prev_total']) / data['prev_total']:+.0%})")
    if data["week_avg"] is not None:
        ref.append(f"{data['week_days']}-day avg {_money(data['week_avg'])}")
    if ref:
        lines[0] += " | " + ", ".join(ref)
    seg = sorted(data["segments"].items(), key=lambda kv: -kv[1])
    if seg:
        lines.append("Segments: " + " | ".join(f"{k} {_money(v)} ({v / t:.0%})" if t else f"{k} {_money(v)}"
                                               for k, v in seg))
    if data["models"]:
        lines.append("Models: " + " | ".join(f"{m} {_money(u)}" for m, u in data["models"][:5]))
    lines.append(f"Top {min(top, len(data['doors']))} features:")
    for i, x in enumerate(data["doors"][:top], 1):
        delta = ""
        if x["prev_usd"]:
            delta = f", {(x['usd'] - x['prev_usd']) / x['prev_usd']:+.0%} vs yday"
        elif x["usd"] >= 0.5:
            delta = ", NEW vs yday"
        share = f"{x['usd'] / t:.0%}" if t else "-"
        lines.append(f"{i}. {_label(x['door'])}: {_money(x['usd'])} ({share}, {x['calls']} calls, "
                     f"{x['segment']}{delta}) [{x['models']}]")
    rest = data["doors"][top:]
    if rest:
        lines.append(f"...{len(rest)} more features: {_money(sum(x['usd'] for x in rest))}")
    if data["batch_usd"] or data["failed_usd"]:
        lines.append(f"Batch (half price): {_money(data['batch_usd'])} | paid for failed calls: "
                     f"{_money(data['failed_usd'])}")
    for b in data["budgets"]:
        lines.append(f"Budget {b['level'].upper()}: {_label(b['door'])} {_money(b['spent'])} of "
                     f"{_money(b['daily_usd'])} ({b['mode']})")
    lines.append("Details: /admin/ai-spend")
    return "\n".join(lines)


def digest(day: str | None = None, post=None, force: bool = False) -> str | None:
    """Post the day's digest once (scheduled 23:55 ET). Returns the text sent, else None."""
    import os
    if os.environ.get("LLM_SPEND_DIGEST", "1").strip().lower() in ("0", "false", "no"):
        return None
    post = post or _post
    day = day or today()
    key = f"digest:{day}"
    try:
        with contextlib.closing(_conn()) as c:
            if not force and c.execute("SELECT 1 FROM llm_budget_meta WHERE k = ?", (key,)).fetchone():
                return None
        text = digest_text(digest_data(day))
        if not post(text):
            return None
        with contextlib.closing(_conn()) as c:
            c.execute("INSERT OR REPLACE INTO llm_budget_meta (k, v) VALUES (?, ?)", (key, _now_iso()))
            c.commit()
        return text
    except Exception:  # noqa: BLE001
        log.warning("[llm_budget] digest failed", exc_info=True)
        return None
