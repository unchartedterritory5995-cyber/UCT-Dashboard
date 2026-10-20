"""Study's scheduler jobs (spec §7.1 "Jobs on web", §6.2b, §13.2 T8/T9):

  run_reminders        every 15 min — push + bell for a member whose chosen
                       reminder time has passed in THEIR zone and whose daily
                       set is unfinished; once per member per day through the
                       study_reminder_log claim row.
  run_weekly_close     Sunday 23:59 ET — freeze the week's leaderboard.
  weekly_close_catchup on boot — close any past week that holds XP and was
                       never closed (T9: there is no misfire grace anywhere).
  run_gen_detections   02:30 ET weekdays — resolved pattern detections → draft
                       spot / levels / next / family items with templated
                       lessons, into study_items with a review lane.

⛔ NO 06:30 fan-out (T9): Today's Study is created lazily on GET /today.

⛔ `STUDY_ENABLED` is read PER CALL, never captured at import; every job_*
wrapper returns None without touching a store when it is off.

⛔ T8: patterns.db is indexed on (sym,tf), pattern_id, status and detected_at
ONLY. The detections query filters by a detected_at window + status with a
LIMIT; confidence and the public-id allowlist are filtered in Python.
`tests/test_study_jobs.py` reads the SQL this module issues and refuses a
`confidence` in the WHERE clause.

Seams are late-bound (`fn=None` resolved in the body) so a test can patch the
module attribute or pass a fake.
"""
from __future__ import annotations

import hashlib
import json
import os
import time
from datetime import datetime, timedelta, timezone
from typing import Any, Callable, Iterable, Optional

from api.services import study_import, study_store, study_templates

_OFF_VALUES = ("0", "false", "no", "off")

REMINDER_TITLE = "Today's Study is waiting"
REMINDER_BODY = "Ten questions. Finish the set and the streak stays."
REMINDER_URL = "/desk?section=courses&study=today"
REMINDER_TAG = "study-reminder"
REMINDER_ALERT_TYPE = "study_reminder"

DETECTIONS_LIMIT = 200
DETECTIONS_WINDOW_DAYS = 45
DETECTIONS_MIN_CONFIDENCE = 70.0
DETECTION_BARS_WINDOW = 120
DETECTION_FORWARD_BARS = 20
DETECTION_ITEM_TYPES = ("spot", "levels", "next", "family")
NEXT_WINDOW_SESSIONS = study_templates.NEXT_WINDOW_SESSIONS

#: The seven internal UCT detector ids the generator may draft from even
#: though `INTERNAL_PATTERN_IDS` keeps them off member chart surfaces: the
#: drafts land in the owner's review queue, never live unreviewed (§8.8).
STUDY_INTERNAL_ALLOWLIST: frozenset = frozenset({
    "uct_launch_pad", "uct_gap_support", "uct_capitulation", "uct_go_signal",
    "uct_undercut_reclaim", "uct_episodic_pivot_v2", "uct_pullback_ma_v5",
})

FAMILIES = ("Bases & Breakouts", "Momentum & Trend", "Gaps & Catalysts",
            "Reversals & Reclaims", "Intraday")

#: The detections query. Only indexed columns in WHERE (detected_at, status);
#: everything else is filtered in Python. Kept as a constant so the test can
#: read it instead of trusting a docstring.
DETECTIONS_SQL = (
    "SELECT d.id, d.sym, d.tf, d.pattern_id, d.category, d.direction, d.start_t, d.end_t, "
    "d.confidence, d.geometry_json, d.levels_json, d.context_json, d.status, d.detected_at, "
    "o.entry_hit, o.stop_hit, o.target_hit, o.mfe_pct, o.mae_pct, o.bars_to_resolve "
    "FROM pattern_detections d JOIN pattern_outcomes o ON o.detection_id = d.id "
    "WHERE d.detected_at >= ? AND d.detected_at < ? AND d.status IN ('completed', 'failed') "
    "ORDER BY d.detected_at DESC LIMIT ?"
)


def study_enabled() -> bool:
    """READ PER CALL (T10). Unset means ON: it is a kill switch."""
    return os.environ.get("STUDY_ENABLED", "1").strip().lower() not in _OFF_VALUES


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _zone(name: Optional[str]):
    from zoneinfo import ZoneInfo
    try:
        return ZoneInfo(name or "America/New_York")
    except Exception:  # noqa: BLE001 -- unknown zone or no tzdata: ET
        try:
            return ZoneInfo("America/New_York")
        except Exception:  # noqa: BLE001
            return timezone(timedelta(hours=-4))


def _parse_hhmm(s: str) -> Optional[tuple[int, int]]:
    try:
        hh, mm = str(s).strip().split(":")[:2]
        h, m = int(hh), int(mm)
    except (TypeError, ValueError):
        return None
    if not (0 <= h <= 23 and 0 <= m <= 59):
        return None
    return h, m


# ── reminders ─────────────────────────────────────────────────────────────────

def run_reminders(now: Optional[datetime] = None, *, dispatch: Optional[Callable] = None,
                  add_alert: Optional[Callable] = None) -> dict:
    """One pass. Returns {checked, sent, not_due, finished, already}."""
    now = now or _now()
    if dispatch is None:
        from api.services import web_push
        dispatch = web_push.dispatch
    if add_alert is None:
        from api.services import alerts
        add_alert = alerts.add_alert
    out = {"checked": 0, "sent": 0, "not_due": 0, "finished": 0, "already": 0}
    day = study_store.et_day_of(now)
    for p in study_store.list_reminder_profiles():
        out["checked"] += 1
        hm = _parse_hhmm(p.get("reminder_time") or "")
        if hm is None:
            out["not_due"] += 1
            continue
        local = now.astimezone(_zone(p.get("reminder_tz")))
        if (local.hour, local.minute) < hm:
            out["not_due"] += 1
            continue
        uid = p["user_id"]
        if study_store.daily_session_finished(uid, day):
            out["finished"] += 1
            continue
        if not study_store.claim_reminder(uid, day):
            out["already"] += 1
            continue
        try:
            dispatch(uid, REMINDER_TITLE, REMINDER_BODY, REMINDER_URL, REMINDER_TAG)
        except Exception as e:  # noqa: BLE001 -- one member's push never stops the pass
            print(f"[study] reminder push error for {uid}: {e}")
        try:
            add_alert(REMINDER_ALERT_TYPE, REMINDER_TITLE, REMINDER_BODY, severity="info",
                      data={"url": REMINDER_URL}, user_id=uid)
        except Exception as e:  # noqa: BLE001
            print(f"[study] reminder bell error for {uid}: {e}")
        out["sent"] += 1
    return out


# ── weekly close ──────────────────────────────────────────────────────────────

def run_weekly_close(now: Optional[datetime] = None) -> Optional[dict]:
    """Freeze the week that `now` (ET) belongs to. Idempotent."""
    now = now or _now()
    week = study_store.week_of(study_store.et_day_of(now))
    return study_store.close_week(week, now=now)


def weekly_close_catchup(now: Optional[datetime] = None) -> list[str]:
    """Close every past week that holds XP and has no close row. Runs on
    boot because a Sunday 23:59 slot lost to a redeploy is lost outright."""
    now = now or _now()
    current = study_store.week_of(study_store.et_day_of(now))
    closed = study_store.closed_weeks()
    done: list[str] = []
    for week in study_store.weeks_with_xp(before_week=current):
        if week in closed:
            continue
        if study_store.close_week(week, now=now) is not None:
            done.append(week)
    return done


# ── detections → drafts ───────────────────────────────────────────────────────

def _skill_map_setups() -> list[dict]:
    here = os.path.dirname(os.path.abspath(__file__))
    path = os.path.join(here, "..", "..", "docs", "study", "skill_map.json")
    try:
        with open(path, encoding="utf-8") as fh:
            return list(json.load(fh).get("setups") or [])
    except (OSError, ValueError):
        return []


def setup_for_detector(pattern_id: str, setups: Optional[Iterable[dict]] = None) -> Optional[dict]:
    """The canonical setup (name, family, skill_id) a detector id maps to via
    skill_map.json's aliases, or None."""
    for s in (setups if setups is not None else _skill_map_setups()):
        al = s.get("aliases") or {}
        if pattern_id in (al.get("detector"), al.get("detector_internal")):
            return {"name": s.get("canonical"), "family": s.get("family"), "skill_id": s.get("skill_id")}
    return None


def public_pattern_ids() -> set[str]:
    """_PATTERN_METADATA minus INTERNAL_PATTERN_IDS, plus the study allowlist."""
    from api.routers.patterns import _PATTERN_METADATA
    from api.services.pattern_engine.detectors.registry import INTERNAL_PATTERN_IDS
    return (set(_PATTERN_METADATA) - set(INTERNAL_PATTERN_IDS)) | set(STUDY_INTERNAL_ALLOWLIST)


def pattern_names() -> dict:
    from api.routers.patterns import _PATTERN_METADATA
    return {k: v.get("name") for k, v in _PATTERN_METADATA.items()}


def item_id_for(detection_id: str, item_type: str) -> str:
    return "si_" + hashlib.sha1(f"det:{detection_id}:{item_type}".encode("utf-8")).hexdigest()[:12]


def _ymd_from_epoch(t: Any) -> Optional[str]:
    try:
        t = int(t)
    except (TypeError, ValueError):
        return None
    if t > 10_000_000_000:          # milliseconds
        t //= 1000
    if 19000101 <= t <= 21001231:   # already a YYYYMMDD key
        s = str(t)
        return f"{s[:4]}-{s[4:6]}-{s[6:8]}"
    return datetime.fromtimestamp(t, tz=timezone.utc).strftime("%Y-%m-%d")


def _loads(s: Any, default):
    if isinstance(s, (dict, list)):
        return s
    try:
        v = json.loads(s or "")
        return v if isinstance(v, type(default)) else default
    except (TypeError, ValueError):
        return default


def _next_outcome(facts: dict) -> str:
    """up / down / undecided over ONE window of NEXT_WINDOW_SESSIONS (C14)."""
    oc = facts.get("outcome")
    n = facts.get("bars_to_resolve")
    if oc not in ("target_hit", "stop_hit") or n is None or int(n) > NEXT_WINDOW_SESSIONS:
        return "undecided"
    bullish = str(facts.get("direction") or "bullish") != "bearish"
    if oc == "target_hit":
        return "up" if bullish else "down"
    return "down" if bullish else "up"


def _distractor_names(name: str, pool: list[str], n: int, seed: str) -> list[str]:
    others = sorted({p for p in pool if p and p != name})
    if not others:
        return []
    start = int(hashlib.sha1(seed.encode("utf-8")).hexdigest()[:8], 16) % len(others)
    rot = others[start:] + others[:start]
    return rot[:n]


def items_for_detection(row: dict, *, setups: Optional[list] = None, names: Optional[dict] = None,
                        name_pool: Optional[list] = None) -> list[dict]:
    """The draft items one eligible detection yields (no bars yet)."""
    pid = str(row.get("pattern_id") or "")
    setup = setup_for_detector(pid, setups)
    names = names if names is not None else {}
    name = (setup or {}).get("name") or names.get(pid) or pid
    family = (setup or {}).get("family")
    skill_id = (setup or {}).get("skill_id") or f"setup.detector.{pid}"
    geometry = _loads(row.get("geometry_json"), {})
    levels = _loads(row.get("levels_json"), {})
    context = _loads(row.get("context_json"), {})
    regime = context.get("regime_bucket") or context.get("regime")
    outcome = {k: row.get(k) for k in ("entry_hit", "stop_hit", "target_hit", "mfe_pct", "mae_pct",
                                       "bars_to_resolve")}
    facts = study_templates.facts_from_detection(
        row, outcome, name=name, family=family, geometry=geometry, levels=levels,
        regime_bucket=regime if isinstance(regime, str) else None)
    det_id = str(row["id"])
    asof = _ymd_from_epoch(row.get("end_t"))
    sym = str(row.get("sym") or "").upper()
    tf = str(row.get("tf") or "D")
    signals = [{"name": "detector_confidence", "verdict": "yes"},
               {"name": "outcome_resolved", "verdict": "yes" if facts.get("outcome") in ("target_hit", "stop_hit") else "no"}]
    base = {
        "version": 1, "module": None, "source_kind": "detection", "source_ref": f"det:{det_id}",
        "sym": sym, "asof": asof, "lesson_origin": study_templates.LESSON_ORIGIN,
        "adjustment_basis": "split-adjusted", "review_status": "draft",
        "bars": {"sym": sym, "tf": tf, "asof": asof, "window": DETECTION_BARS_WINDOW,
                 "forward": DETECTION_FORWARD_BARS},
    }
    pool = name_pool or sorted({(s.get("canonical") or "") for s in (setups or [])})
    out: list[dict] = []

    def _mk(item_type: str, skill: str, prompt: dict, answer: dict, difficulty: int, extra_reveal: dict = None):
        reveal = {"facts": facts, "detector": pid, "signals": signals, "outcome": facts.get("outcome")}
        reveal.update(extra_reveal or {})
        it = dict(base)
        it.update({"id": item_id_for(det_id, item_type), "type": item_type, "skill_id": skill,
                   "difficulty": difficulty, "prompt_json": prompt, "answer_json": answer,
                   "reveal_json": reveal, "lesson_text": study_templates.render(item_type, facts)})
        it["review_lane"] = study_import.assign_review_lane(it)
        return it

    # spot: which setup is this, or none?
    distractors = _distractor_names(name, pool, 3, det_id)
    choices = [name] + distractors + ["None of these"]
    out.append(_mk("spot", skill_id, {"q": "Which setup is this, or none?", "choices": choices,
                                      "chart": {"window_bars": DETECTION_BARS_WINDOW}},
                   {"answer": name}, 3))
    # levels: entry / stop / target
    lv = facts.get("levels") or {}
    if all(k in lv for k in ("entry", "stop", "target")):
        atr = geometry.get("atr14") if isinstance(geometry.get("atr14"), (int, float)) else None
        key = {"entry": lv["entry"], "stop": lv["stop"], "target": lv["target"]}
        if atr:
            key["atr14"] = round(float(atr), 4)
        out.append(_mk("levels", "setup.levels",
                       {"q": f"Mark the entry, the stop and the target for this {name}.",
                        "roles": ["entry", "stop", "target"], "chart": {"window_bars": 60}},
                       key, 3))
    # next: up / down / undecided over 20 sessions
    nxt = _next_outcome(facts)
    out.append(_mk("next", "manage.replay",
                   {"q": f"Cut here. Over the next {NEXT_WINDOW_SESSIONS} sessions, which way does it go?",
                    "choices": ["up", "down", "undecided"], "chart": {"window_bars": DETECTION_BARS_WINDOW}},
                   {"outcome": nxt, "window": NEXT_WINDOW_SESSIONS}, 4,
                   {"outcome": "undecided" if nxt == "undecided" else facts.get("outcome")}))
    # family: which family does this setup sit in?
    if family in FAMILIES:
        out.append(_mk("family", "setup.placement",
                       {"q": "Which family does this setup belong to?", "choices": list(FAMILIES),
                        "chart": {"window_bars": DETECTION_BARS_WINDOW}},
                       {"answer": family}, 2))
    return out


def fetch_candidates(conn, now: Optional[datetime] = None, *, limit: int = DETECTIONS_LIMIT,
                     window_days: int = DETECTIONS_WINDOW_DAYS) -> list[dict]:
    """The LIMITed, index-friendly read (T8). Returns plain dicts."""
    now = now or _now()
    hi = int(now.timestamp())
    lo = hi - int(window_days) * 86400
    cur = conn.execute(DETECTIONS_SQL, (lo, hi, int(limit)))
    cols = [d[0] for d in cur.description]
    return [dict(zip(cols, r)) for r in cur.fetchall()]


def run_gen_detections(now: Optional[datetime] = None, *, conn=None, resolve_bars: Optional[Callable] = None,
                       public_ids: Optional[set] = None, names: Optional[dict] = None,
                       limit: int = DETECTIONS_LIMIT, window_days: int = DETECTIONS_WINDOW_DAYS,
                       min_confidence: float = DETECTIONS_MIN_CONFIDENCE) -> dict:
    """One nightly pass. Returns {candidates, eligible, items, skipped, misses}."""
    now = now or _now()
    close = False
    if conn is None:
        from api.services.pattern_engine import pattern_db
        conn = pattern_db.get_connection()
        close = True
    if resolve_bars is None:
        from api.routers.study import resolve_bars as _rb
        resolve_bars = _rb
    if public_ids is None:
        public_ids = public_pattern_ids()
    if names is None:
        try:
            names = pattern_names()
        except Exception:  # noqa: BLE001
            names = {}
    try:
        rows = fetch_candidates(conn, now, limit=limit, window_days=window_days)
    finally:
        if close:
            conn.close()
    setups = _skill_map_setups()
    pool = sorted({(s.get("canonical") or "") for s in setups})
    out = {"candidates": len(rows), "eligible": 0, "items": 0, "skipped": [], "misses": []}
    ready: list[dict] = []
    for row in rows:
        try:
            conf = float(row.get("confidence") or 0)
        except (TypeError, ValueError):
            conf = 0.0
        pid = str(row.get("pattern_id") or "")
        if conf < min_confidence or pid not in public_ids:
            out["skipped"].append({"id": row.get("id"), "pattern_id": pid, "confidence": conf})
            continue
        out["eligible"] += 1
        items = items_for_detection(row, setups=setups, names=names, name_pool=pool)
        if not items:
            continue
        spec = items[0]["bars"]
        res = resolve_bars(spec)
        if not res.get("ok"):
            out["misses"].append({"id": row.get("id"), **{k: v for k, v in res.items() if k != "ok"}})
            continue
        bars_id = f"sb_det_{row['id']}"
        study_store.upsert_bars(bars_id, res["tf"], res["visible"], res.get("forward"), res.get("sha256"))
        for it in items:
            it.pop("bars", None)
            it.pop("review_status", None)
            it["bars_ref"] = bars_id
            ready.append(it)
    if ready:
        up = study_store.upsert_items(ready, now=now)
        out["items"] = up["inserted"] + up["updated"]
    return out


# ── scheduler wrappers (what api/main.py registers) ──────────────────────────

def job_reminders() -> Optional[dict]:
    if not study_enabled():
        return None
    try:
        out = run_reminders()
        if out.get("sent"):
            print(f"[study] reminders sent to {out['sent']} member(s)")
        return out
    except Exception as e:  # noqa: BLE001
        print(f"[study] reminders error (non-fatal): {e}")
        return None


def job_weekly_close() -> Optional[dict]:
    if not study_enabled():
        return None
    try:
        out = run_weekly_close()
        if out:
            print(f"[study] weekly close: {out['week_et']} frozen ({len(out['rows'])} rows)")
        return out
    except Exception as e:  # noqa: BLE001
        print(f"[study] weekly close error (non-fatal): {e}")
        return None


def job_weekly_close_catchup() -> Optional[list]:
    if not study_enabled():
        return None
    try:
        done = weekly_close_catchup()
        if done:
            print(f"[study] weekly close catch-up closed {done}")
        return done
    except Exception as e:  # noqa: BLE001
        print(f"[study] weekly close catch-up error (non-fatal): {e}")
        return None


def job_gen_detections() -> Optional[dict]:
    if not study_enabled():
        return None
    try:
        t0 = time.time()
        out = run_gen_detections()
        print(f"[study] detections → {out['items']} draft item(s) from {out['eligible']}/{out['candidates']} "
              f"candidates, {len(out['misses'])} bar miss(es), {time.time() - t0:.1f}s")
        return out
    except Exception as e:  # noqa: BLE001
        print(f"[study] detections generator error (non-fatal): {e}")
        return None
