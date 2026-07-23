"""Persistent, DE-IDENTIFIED log of AI Search queries + answers — the capture
foundation for the future "house knowledge" learning loop (Phases 2-3 add
retrieval + synthesis over this data with NO migration).

Design: spec docs/superpowers/specs/2026-07-21-aisearch-learning-loop-design.md §9
(finalized after the 11-specialist panel review).

Principles:
  - Best-effort: a logging failure NEVER affects or slows the answer path (all
    swallowed). Off the request's critical result.
  - De-identified: stores the question + answer + metadata but NOT who asked — only
    an HMAC day-bucket (keyed, day-rotating, redeploy-stable; secret never persisted).
  - Freshness gate is CONSERVATIVE + rule-based (free): a time-sensitive answer can
    never become stale "house knowledge" (a false-evergreen poisons the future brain;
    a false-time_sensitive merely fails to compound).
  - Additive, forward-compatible schema: new columns are ALTER-added on init, so
    later fields need no migration.

Gated by AI_SEARCH_LOG_ENABLED (default on). DB at AI_SEARCH_LOG_DB_PATH
(default /data/ai_search_log.db).
"""
from __future__ import annotations

import contextlib
import hashlib
import hmac
import json
import os
import re
import sqlite3
import threading
import time
import uuid
from datetime import datetime, timedelta, timezone

# capture_version: bump on a MATERIAL prompt/grounding pipeline change so future
# training/synthesis can filter by pipeline generation. classifier_version: bump on
# a classifier rule change so old rows can be re-binned with no migration.
CAPTURE_VERSION = 1
CLASSIFIER_VERSION = 1

_LOCK = threading.Lock()
_INIT_DONE = False
_LAST_PRUNE = 0.0


def _enabled() -> bool:
    return os.environ.get("AI_SEARCH_LOG_ENABLED", "1") == "1"


def _db_path() -> str:
    return os.environ.get("AI_SEARCH_LOG_DB_PATH", "/data/ai_search_log.db")


def _retention_days() -> int:
    try:
        return max(1, int(os.environ.get("AI_SEARCH_LOG_RETENTION_DAYS", "60")))
    except ValueError:
        return 60


def new_answer_id() -> str:
    return uuid.uuid4().hex


# ── connection + additive schema ─────────────────────────────────────────────
def _connect() -> sqlite3.Connection:
    conn = sqlite3.connect(_db_path(), timeout=5)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA busy_timeout=2000")
    return conn


# Every column, in order. _ensure_init ADD-COLUMNs any that are missing, so adding a
# field later is migration-free (the no-migration promise). Never reorder/rename —
# only append.
_COLUMNS: list[tuple[str, str]] = [
    ("answer_id", "TEXT"), ("ts", "TEXT"), ("day_et", "TEXT"),
    ("session_bucket", "TEXT"), ("endpoint", "TEXT"),
    ("query", "TEXT"), ("query_norm", "TEXT"), ("question_type", "TEXT"),
    ("first_person", "INTEGER DEFAULT 0"),
    ("answer", "TEXT"), ("answer_kind", "TEXT"), ("answer_hash", "TEXT"),
    ("answer_chars", "INTEGER"),
    ("mode", "TEXT"), ("model", "TEXT"), ("fallback_used", "INTEGER DEFAULT 0"),
    ("recency", "TEXT"), ("freshness", "TEXT"), ("classifier_version", "INTEGER"),
    ("cached", "INTEGER DEFAULT 0"),
    ("grounded_sources", "TEXT"), ("grounding_intents", "TEXT"),
    ("regime_label", "TEXT"), ("had_live_price", "INTEGER DEFAULT 0"),
    ("grounding_context", "TEXT"),
    ("query_tickers", "TEXT"), ("answer_tickers", "TEXT"),
    ("primary_ticker", "TEXT"), ("primary_sector", "TEXT"), ("primary_themes", "TEXT"),
    ("citations_json", "TEXT"), ("citation_count", "INTEGER DEFAULT 0"),
    ("related_questions", "TEXT"), ("domain_pack", "TEXT"),
    ("elapsed_ms", "INTEGER"), ("error", "TEXT"), ("units", "INTEGER DEFAULT 0"),
    ("conversation_id", "TEXT"), ("turn_index", "INTEGER"), ("has_history", "INTEGER DEFAULT 0"),
    ("user_bucket", "TEXT"), ("pinned", "INTEGER DEFAULT 0"), ("excluded", "INTEGER DEFAULT 0"),
    ("capture_version", "INTEGER"),
    # Explicit personal-branch marker (Task 7). Belt-and-suspenders backstop: the
    # personal branch never logs at all (invariant #2), but if a personal row ever
    # reached this table, this flag lets brain ingest independently exclude it.
    ("personal", "INTEGER DEFAULT 0"),
]


def _ensure_init() -> None:
    global _INIT_DONE
    if _INIT_DONE:
        return
    with _LOCK:
        if _INIT_DONE:
            return
        try:
            d = os.path.dirname(_db_path())
            if d:
                os.makedirs(d, exist_ok=True)
        except OSError:
            pass
        with contextlib.closing(_connect()) as conn:
            conn.execute("CREATE TABLE IF NOT EXISTS ai_search_log (id INTEGER PRIMARY KEY AUTOINCREMENT)")
            have = {r[1] for r in conn.execute("PRAGMA table_info(ai_search_log)").fetchall()}
            for name, decl in _COLUMNS:
                if name not in have:
                    conn.execute(f"ALTER TABLE ai_search_log ADD COLUMN {name} {decl}")
            for stmt in (
                "CREATE INDEX IF NOT EXISTS idx_ais_day ON ai_search_log(day_et)",
                "CREATE INDEX IF NOT EXISTS idx_ais_ts ON ai_search_log(ts)",
                "CREATE INDEX IF NOT EXISTS idx_ais_fresh ON ai_search_log(freshness)",
                "CREATE INDEX IF NOT EXISTS idx_ais_aid ON ai_search_log(answer_id)",
                "CREATE INDEX IF NOT EXISTS idx_ais_pt ON ai_search_log(primary_ticker)",
                "CREATE TABLE IF NOT EXISTS ai_search_feedback ("
                "id INTEGER PRIMARY KEY AUTOINCREMENT, answer_id TEXT, kind TEXT, ts TEXT)",
                "CREATE INDEX IF NOT EXISTS idx_aisf_aid ON ai_search_feedback(answer_id)",
                # Content-free counter for the personal branch (invariant #2: the
                # personal branch never logs query/answer text anywhere). ONLY a
                # per-day invocation + degraded tally — no query/answer columns.
                "CREATE TABLE IF NOT EXISTS ai_search_personal_counter ("
                "day TEXT PRIMARY KEY, invocations INTEGER DEFAULT 0, degraded INTEGER DEFAULT 0)",
            ):
                conn.execute(stmt)
            conn.commit()
        _INIT_DONE = True


def _reset_for_tests() -> None:
    global _INIT_DONE, _LAST_PRUNE
    _INIT_DONE = False
    _LAST_PRUNE = 0.0


def _reset_for_test() -> None:
    """Alias — some test suites use the singular spelling."""
    _reset_for_tests()


def _all_rows_for_test() -> list[dict]:
    """Test helper: every ai_search_log row, oldest first."""
    _ensure_init()
    with contextlib.closing(_connect()) as conn:
        conn.row_factory = sqlite3.Row
        return [dict(r) for r in conn.execute("SELECT * FROM ai_search_log ORDER BY id").fetchall()]


# ── grounding tiers ───────────────────────────────────────────────────────────
# Sources that inject on ~every query (ambient context, not differentiating
# "desk" grounding from a generic web answer). Excluded from the tier decision
# so the coverage metric reflects real proprietary grounding, not noise.
_AMBIENT = {"regime", "recency"}


def _grounding_tier(sources) -> str:
    """"desk-grounded" when a real (non-ambient) source is present, else
    "web-only". `sources` is any iterable of source-name strings."""
    return "desk-grounded" if (set(sources or ()) - _AMBIENT) else "web-only"


# ── classifiers (rule-based, free, versioned) ────────────────────────────────
# Grounding sources that make an answer inherently perishable (a live price / an
# active pattern / today's flow / today's movers) — force time_sensitive.
_LIVE_SOURCES = {"quote", "patterns", "flow", "movers", "tape"}

_EVERGREEN_RE = re.compile(
    r"\b(what (?:is|are|does|do)|who (?:is|are)|how (?:does|do|to)|explain|define|definition"
    r"|history of|business model|competitors?|moat|market share|valuation|fundamentals?"
    r"|bull case|bear case|thesis|compare|comparison|versus|\bvs\.?\b|pros and cons"
    r"|p/?e ratio|balance sheet)\b", re.I)

_FIRST_PERSON_RE = re.compile(
    r"\b(my (?:position|shares|stake|cost basis|portfolio|calls?|puts?|account)"
    r"|i (?:bought|own|hold|holding|sold|have)|should i|i'?m (?:long|short|holding)"
    r"|\d{3}-\d{2}-\d{4})\b"                       # ssn-ish
    r"|\b[\w.+-]+@[\w-]+\.[\w.]{2,}\b"             # email
    r"|\b\d{9,}\b", re.I)                          # long number (acct/phone)

# First match wins — order is priority (most specific first).
_QTYPE_RES: list[tuple[str, re.Pattern]] = [
    ("portfolio-risk", re.compile(r"\b(should i (?:sell|buy|add|trim|hold)|my (?:position|risk|stop|shares)|position siz|risk manage|how much (?:should|to))\b", re.I)),
    ("why-move", re.compile(r"\bwhy (?:is|did|are|has)\b.{0,40}\b(up|down|moving|gapp|dropp|fall|spik|surg|tank|rally|rip|dump|crash|jump|pop|plung|soar|sink)", re.I)),
    ("options-flow", re.compile(r"\b(options? flow|sweeps?|unusual (?:options|activity)|call buying|put buying|smart money|gamma|gex|max pain|dark ?pool)\b", re.I)),
    ("compare", re.compile(r"\b(compare|comparison|versus|\bvs\.?\b|better (?:buy|than)|which (?:is better|of))\b", re.I)),
    ("valuation", re.compile(r"\b(valuation|p/?e|peg|market ?cap|overvalued|undervalued|cheap|expensive|fundamentals?|margins?|revenue growth|balance sheet|dividend)\b", re.I)),
    ("catalyst-news", re.compile(r"\b(catalyst|news|headline|earnings|guidance|upgrade|downgrade|analyst|price target|reports?)\b", re.I)),
    ("setup-technical", re.compile(r"\b(setup|pattern|breakout|support|resistance|extended|pullback|entry|stop|target|levels?|chart)\b", re.I)),
    ("macro", re.compile(r"\b(fed|fomc|cpi|inflation|rates?|macro|economy|gdp|jobs|treasury|yield|dollar|vix)\b", re.I)),
    ("idea-screen", re.compile(r"\b(best (?:stocks|names|plays|setups)|sympathy|candidates?|what(?:'?s| is) leading|movers?|screen|ideas?)\b", re.I)),
    ("concept-education", re.compile(r"\b(what (?:is|does|are)|how (?:does|do|to)|explain|definition|history of)\b", re.I)),
]


def classify_question_type(query: str) -> str:
    q = query or ""
    for name, rx in _QTYPE_RES:
        if rx.search(q):
            return name
    return "other"


def classify_freshness(query: str, recency, grounded_sources) -> str:
    """Binary gate. time_sensitive when the ask is day/week-recency OR grounded on a
    live/perishable source; evergreen only on a positive evergreen signal with no live
    grounding; ambiguous defaults to time_sensitive (conservative — never poison the
    future brain)."""
    gs = set(grounded_sources or [])
    if recency in ("day", "week") or (gs & _LIVE_SOURCES):
        return "time_sensitive"
    if _EVERGREEN_RE.search(query or ""):
        return "evergreen"
    return "time_sensitive"


def first_person_flag(query: str) -> int:
    return 1 if _FIRST_PERSON_RE.search(query or "") else 0


_ANSWER_TICKER_RE = re.compile(r"\[[^\]]+\]\(\$([A-Za-z][A-Za-z.\-]{0,6})\)|\$([A-Z]{1,5}(?:\.[A-Z])?)\b")


def extract_answer_tickers(answer: str) -> list[str]:
    out: list[str] = []
    for m in _ANSWER_TICKER_RE.finditer(answer or ""):
        t = (m.group(1) or m.group(2) or "").upper()
        if t and t not in out:
            out.append(t)
    return out[:12]


def _session_bucket() -> str:
    try:
        from zoneinfo import ZoneInfo
        now = datetime.now(ZoneInfo("America/New_York"))
    except Exception:
        now = datetime.now(timezone.utc) - timedelta(hours=5)
    if now.weekday() >= 5:
        return "weekend"
    hm = now.hour * 60 + now.minute
    if 4 * 60 <= hm < 9 * 60 + 30:
        return "premarket"
    if 9 * 60 + 30 <= hm < 15 * 60:
        return "regular"
    if 15 * 60 <= hm < 16 * 60:
        return "power-hour"
    if 16 * 60 <= hm < 20 * 60:
        return "afterhours"
    return "overnight"


def _et_day() -> str:
    try:
        from zoneinfo import ZoneInfo
        return datetime.now(ZoneInfo("America/New_York")).strftime("%Y-%m-%d")
    except Exception:
        return (datetime.now(timezone.utc) - timedelta(hours=5)).strftime("%Y-%m-%d")


def _user_bucket(user_id, day_et: str):
    """HMAC(server-secret, user_id + day) → keyed (an admin with only the member
    table cannot brute-force it), day-rotating (cross-day unlinkability), and
    redeploy-stable (distinct-user counts survive a mid-day deploy). The secret is
    NEVER written to the log DB."""
    if user_id is None:
        return None
    secret = (os.environ.get("PUSH_SECRET") or "uct-ais-dev-salt").encode("utf-8")
    msg = f"{user_id}|{day_et}".encode("utf-8", "ignore")
    return hmac.new(secret, msg, hashlib.sha256).hexdigest()[:16]


# ── write path ───────────────────────────────────────────────────────────────
def log(*, user_id=None, answer_id=None, endpoint="single", query="", answer="",
        answer_kind="ok", mode=None, model=None, fallback_used=False, cached=False,
        recency=None, grounded_sources=None, grounding_intents=None, regime_label=None,
        had_live_price=False, grounding_context=None, query_tickers=None,
        primary_sector=None, primary_themes=None, citations=None, related_questions=None,
        domain_pack=None, elapsed_ms=None, error=None, units=0,
        conversation_id=None, turn_index=None, has_history=False, day_et=None,
        skip_query_text: bool = False, personal: bool = False) -> None:
    """Best-effort insert of one Q&A row. Swallows all errors — it can never break
    or slow the answer. Computes derived + classified fields internally so callers
    stay thin. `user_id` is used only to derive the HMAC day-bucket, never stored.
    `skip_query_text=True` stores "" for the query text (and everything derived
    from it) instead of the raw query — used by callers that must NOT persist
    query content. Invariant #6: raw-query text is ALSO auto-blanked (regardless
    of `skip_query_text`) whenever `first_person_flag(query)` is 1 — a
    detection-miss first-person query must never persist verbatim just because a
    caller forgot to pass `skip_query_text`. `first_person`/`question_type`/
    `freshness` are still classified off the RAW query so analytics survive the
    blank. `personal=True` marks the row as personal-branch content — an
    independent backstop so it can never be picked up by brain ingest even if it
    somehow reaches this table (the personal branch is not expected to log at all)."""
    if not _enabled():
        return
    try:
        _ensure_init()
        day = day_et or _et_day()
        # Invariant #6: a first-person query (detected on the RAW query, before any
        # blanking) must never persist its raw text, regardless of caller/branch.
        # `fp` is computed here and reused as the stored `first_person` label so a
        # re-derivation from the (now-blanked) `q` can never wrongly record 0.
        fp = first_person_flag(query)
        skip = bool(skip_query_text) or bool(fp)
        q = "" if skip else (query or "")[:2000]
        a = (answer or "")[:16000]
        gsrc = [str(s) for s in (grounded_sources or [])]
        qtk = [str(t).upper() for t in (query_tickers or [])]
        atk = extract_answer_tickers(a)
        primary = qtk[0] if qtk else (atk[0] if atk else None)
        cites = [str(c) for c in (citations or []) if c][:10]
        row = {
            "answer_id": answer_id or new_answer_id(),
            "ts": datetime.now(timezone.utc).isoformat(),
            "day_et": day,
            "session_bucket": _session_bucket(),
            "endpoint": endpoint,
            "query": q,
            # query_norm mirrors `q` (blanked when skip) — it holds normalized RAW
            # query text, so it must never survive a skip either.
            "query_norm": q.strip().lower(),
            # question_type/freshness are low-cardinality LABELS classified off the
            # RAW query (not `q`) so analytics survive a skip; first_person reuses
            # the RAW-derived `fp` computed above rather than re-deriving from the
            # (possibly blanked) `q`, which would wrongly record 0 for a skipped row.
            "question_type": classify_question_type(query),
            "first_person": fp,
            "answer": a,
            "answer_kind": answer_kind or "ok",
            "answer_hash": hashlib.sha256(a.encode("utf-8", "ignore")).hexdigest() if a else None,
            "answer_chars": len(a),
            "mode": mode,
            "model": model,
            "fallback_used": 1 if fallback_used else 0,
            "recency": recency,
            "freshness": classify_freshness(query, recency, gsrc),
            "classifier_version": CLASSIFIER_VERSION,
            "cached": 1 if cached else 0,
            "grounded_sources": json.dumps(gsrc),
            "grounding_intents": json.dumps([str(i) for i in (grounding_intents or [])]),
            "regime_label": regime_label,
            "had_live_price": 1 if had_live_price else 0,
            "grounding_context": (grounding_context or "")[:2600] or None,
            "query_tickers": json.dumps(qtk),
            "answer_tickers": json.dumps(atk),
            "primary_ticker": primary,
            "primary_sector": primary_sector,
            "primary_themes": json.dumps([str(t) for t in primary_themes]) if primary_themes else None,
            "citations_json": json.dumps(cites),
            "citation_count": len(cites),
            "related_questions": json.dumps([str(x) for x in (related_questions or [])][:4]),
            "domain_pack": domain_pack,
            "elapsed_ms": int(elapsed_ms) if elapsed_ms is not None else None,
            "error": ((error or "")[:300] or None),
            "units": int(units or 0),
            "conversation_id": conversation_id,
            "turn_index": int(turn_index) if turn_index is not None else None,
            "has_history": 1 if has_history else 0,
            "user_bucket": _user_bucket(user_id, day),
            "pinned": 0,
            "excluded": 0,
            "capture_version": CAPTURE_VERSION,
            "personal": 1 if personal else 0,
        }
        cols = list(row.keys())
        placeholders = ",".join("?" for _ in cols)
        with contextlib.closing(_connect()) as conn:
            conn.execute(
                f"INSERT INTO ai_search_log ({','.join(cols)}) VALUES ({placeholders})",
                [row[c] for c in cols])
            conn.commit()
    except Exception:
        pass  # best-effort: logging must never affect the answer


def record_signal(answer_id, kind) -> None:
    """Attach a human quality signal (save / share / copy / pin / exclude / helpful)
    to a prior answer by its stable answer_id. Best-effort. pin/exclude also flip the
    curation flag on the log row."""
    if not _enabled() or not answer_id or not kind:
        return
    try:
        _ensure_init()
        aid = str(answer_id)[:64]
        k = str(kind)[:24]
        with contextlib.closing(_connect()) as conn:
            conn.execute("INSERT INTO ai_search_feedback (answer_id, kind, ts) VALUES (?,?,?)",
                         (aid, k, datetime.now(timezone.utc).isoformat()))
            if k in ("pin", "unpin", "exclude", "unexclude"):
                col = "pinned" if k in ("pin", "unpin") else "excluded"
                conn.execute(f"UPDATE ai_search_log SET {col}=? WHERE answer_id=?",
                             (0 if k.startswith("un") else 1, aid))
            conn.commit()
    except Exception:
        pass


def record_personal_invocation(degraded: bool = False) -> None:
    """Content-free tally of ONE personal-branch request. Stores NO query/answer
    text — just increments today's (day, invocations, degraded) counter row.
    Best-effort, swallows all errors (never affects the answer path)."""
    if not _enabled():
        return
    try:
        _ensure_init()
        day = _et_day()
        deg = 1 if degraded else 0
        with contextlib.closing(_connect()) as conn:
            conn.execute(
                "INSERT INTO ai_search_personal_counter (day, invocations, degraded) "
                "VALUES (?, 1, ?) "
                "ON CONFLICT(day) DO UPDATE SET "
                "invocations = invocations + 1, degraded = degraded + excluded.degraded",
                (day, deg))
            conn.commit()
    except Exception:
        pass


def _maybe_prune() -> None:
    """Retention: drop raw time_sensitive rows past the window (evergreen + pinned
    kept). Throttled to ~6h and triggered from insights() (admin path) — NEVER from a
    user request. De-identified data can't honor a per-user delete, so a bounded
    window is the erasure mechanism."""
    global _LAST_PRUNE
    now = time.time()
    if now - _LAST_PRUNE < 6 * 3600:
        return
    _LAST_PRUNE = now
    try:
        cutoff = (datetime.now(timezone.utc) - timedelta(days=_retention_days())).isoformat()
        with contextlib.closing(_connect()) as conn:
            conn.execute("DELETE FROM ai_search_log WHERE freshness='time_sensitive' "
                         "AND pinned=0 AND ts < ?", (cutoff,))
            conn.commit()
    except Exception:
        pass


# ── read path (admin analytics) ──────────────────────────────────────────────
def _recent_row(r) -> dict:
    ans = re.sub(r"\[([^\]]+)\]\(\$[A-Za-z][A-Za-z.\-]{0,6}\)", r"\1", r["answer"] or "").replace("**", "")
    return {
        "ts": r["ts"], "endpoint": r["endpoint"], "query": r["query"],
        "answer_snip": ans[:140], "answer_kind": r["answer_kind"],
        "mode": r["mode"], "model": r["model"], "freshness": r["freshness"],
        "question_type": r["question_type"], "first_person": bool(r["first_person"]),
        "cached": bool(r["cached"]), "grounded": (r["grounded_sources"] or "[]") != "[]",
        "regime": r["regime_label"], "tickers": r["query_tickers"],
        "citations": r["citation_count"], "elapsed_ms": r["elapsed_ms"],
        "error": r["error"], "pinned": bool(r["pinned"]), "excluded": bool(r["excluded"]),
        "answer_id": r["answer_id"],
    }


def insights(days: int = 7, recent_limit: int = 50) -> dict:
    """Aggregate-first analytics for the admin panel (de-identified — no user id)."""
    out = {
        "enabled": _enabled(), "total": 0, "window_days": days, "window_count": 0,
        "answered": 0, "distinct_buckets": 0, "top_questions": [], "top_tickers": [],
        "by_mode": {}, "by_question_type": {}, "by_freshness": {},
        "cache_rate": 0.0, "grounded_rate": 0.0, "error_rate": 0.0, "first_person_rate": 0.0,
        "grounding_coverage": {}, "personal": {"invocations": 0, "degraded": 0, "rate": 0.0},
        "recent": [],
    }
    try:
        _ensure_init()
        _maybe_prune()
        cutoff = (datetime.now(timezone.utc) - timedelta(days=max(1, days))).isoformat()
        cutoff_day = (datetime.now(timezone.utc) - timedelta(days=max(1, days))).strftime("%Y-%m-%d")
        with contextlib.closing(_connect()) as conn:
            conn.row_factory = sqlite3.Row
            c = conn.cursor()
            out["total"] = c.execute("SELECT COUNT(*) FROM ai_search_log").fetchone()[0]
            rows = c.execute("SELECT * FROM ai_search_log WHERE ts >= ? ORDER BY ts DESC", (cutoff,)).fetchall()
            prows = c.execute(
                "SELECT invocations, degraded FROM ai_search_personal_counter WHERE day >= ?",
                (cutoff_day,)).fetchall()
        n = len(rows)
        # Personal lane: content-free counter, independent of `n` (ai_search_log
        # never gets personal-branch rows — invariant #2 in the router). rate is
        # invocations over (logged non-personal + invocations) so it reads as
        # "share of all activity that was personalized".
        p_invocations = sum(r["invocations"] for r in prows)
        p_degraded = sum(r["degraded"] for r in prows)
        p_denom = n + p_invocations
        out["personal"] = {
            "invocations": p_invocations,
            "degraded": p_degraded,
            "rate": round(p_invocations / p_denom, 3) if p_denom else 0.0,
        }
        out["window_count"] = n
        if n:
            from collections import Counter
            qc = Counter((r["query_norm"] or "") for r in rows if r["query_norm"])
            out["top_questions"] = [{"q": q, "count": k} for q, k in qc.most_common(15)]
            tick = Counter()
            for r in rows:
                for col in ("query_tickers", "answer_tickers"):
                    try:
                        for t in json.loads(r[col] or "[]"):
                            tick[t] += 1
                    except Exception:
                        pass
            out["top_tickers"] = [{"ticker": t, "count": k} for t, k in tick.most_common(15)]
            out["by_mode"] = dict(Counter(r["mode"] or "?" for r in rows))
            out["by_question_type"] = dict(Counter(r["question_type"] or "other" for r in rows))
            out["by_freshness"] = dict(Counter(r["freshness"] or "?" for r in rows))
            tier_counts: Counter = Counter()
            for r in rows:
                try:
                    gs = json.loads(r["grounded_sources"] or "[]")
                except Exception:
                    gs = []
                tier_counts[_grounding_tier(gs)] += 1
            out["grounding_coverage"] = dict(tier_counts)
            out["cache_rate"] = round(sum(1 for r in rows if r["cached"]) / n, 3)
            out["grounded_rate"] = round(sum(1 for r in rows if (r["grounded_sources"] or "[]") != "[]") / n, 3)
            out["error_rate"] = round(sum(1 for r in rows if r["error"]) / n, 3)
            out["first_person_rate"] = round(sum(1 for r in rows if r["first_person"]) / n, 3)
            out["answered"] = sum(1 for r in rows if r["answer_kind"] == "ok")
            out["distinct_buckets"] = len({r["user_bucket"] for r in rows if r["user_bucket"]})
            out["recent"] = [_recent_row(r) for r in rows[:recent_limit]]
    except Exception:
        pass
    return out
