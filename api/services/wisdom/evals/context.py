"""CONTEXT_SNAPSHOT at stated_at (D11; W1 Part 1; manifest §4.6).

Taken AS OF stated_at, stored on the call, immutable (INSERT OR IGNORE; never recomputed).
Every field is {value, source, retrieved_at}; a field that cannot be read AS OF the statement is
{value: null, source: null, retrieved_at: null, gap: "<named reason>"} — never backfilled from a
later reading. completeness = populated fields / defined fields.

THREE KINDS OF READER, and the rule for each:
  durable-by-date   bars (<= the last session that had closed), breadth_snapshots, ENGINE
                    market_regimes (created before the statement), catalysts by market_date,
                    tweets inside the 7-day store window — readable for any date they hold.
  current-only      screener_rows, theme memberships — used ONLY when the snapshot is taken on the
                    statement's own ET date (the daily chain, for today's calls); screener rows are
                    built at 03:00 from the prior close, so a same-day read is as-of by construction.
  capture archive   the Wisdom D12 archive (S-A, R2 wisdom/context/<session>/<family>.json.gz) for
                    everything current-only on older dates. Absent archive = a named gap.

Flow-worker data (options flow, dark pool) has no web-side as-of reader in W1: named gap unless the
archive holds it.
"""
from __future__ import annotations

import gzip
import json
import os
import sqlite3
from dataclasses import dataclass, field
from datetime import date, datetime, time, timedelta, timezone
from typing import Callable, Optional

from api.services.wisdom.core import timeutil
from api.services.wisdom.evals.bars_asof import BarsAsOf, int_to_date, last_closed_session_date

SNAPSHOT_VERSION = "context-v1"
FIELDS = ("index_regime", "uct_exposure", "breadth", "vix", "sector", "themes", "rs_rank", "days_to_earnings",
          "catalysts", "news_24h", "tweets_24h", "fundamentals", "options_flow", "dark_pool")
INDEXES = ("SPY", "QQQ", "IWM")
MA_PERIODS = (10, 20, 50, 200)
TWEET_STORE_RETENTION_DAYS = 7
BREADTH_FLAGSHIP = ("breadth_score", "uct_exposure", "pct_above_20ema", "pct_above_50sma", "pct_above_200sma",
                    "up_4pct_today", "down_4pct_today", "new_52w_highs", "new_52w_lows", "mcclellan", "phase",
                    "stage2", "stage4")
# D12 archive family names (S-A owns them; one table so a rename is one line here).
ARCHIVE_FAMILY = {"screener": "screener", "themes": "themes", "rs": "rs", "tweets": "tweets",
                  "street": "street", "news": "news", "options_flow": "gex", "dark_pool": "darkpool"}


class ArchiveShapeError(ValueError):
    pass


@dataclass
class ContextEnv:
    bars: BarsAsOf
    now: datetime
    engine_db_path: Optional[str] = None
    breadth_row: Optional[Callable[[date], Optional[dict]]] = None
    catalyst_rows: Optional[Callable[[str], list]] = None
    tweets_window: Optional[Callable[[int, int], list]] = None
    themes_for_ticker: Optional[Callable[[str], list]] = None
    screener_row: Optional[Callable[[str], Optional[dict]]] = None
    archive: Optional[Callable[[str, str], Optional[dict]]] = None
    notes: dict = field(default_factory=dict)
    _archive_cache: dict = field(default_factory=dict)

    def archived(self, family_key: str, day_iso: str) -> tuple:
        family = ARCHIVE_FAMILY.get(family_key, family_key)
        key = (family, day_iso)
        if key not in self._archive_cache:
            if self.archive is None:
                result = (None, "capture_archive_reader_absent")
            else:
                try:
                    payload = self.archive(family, day_iso)
                    result = (payload, None if payload is not None else f"capture_archive_missing:{family}:{day_iso}")
                except Exception as exc:
                    result = (None, f"capture_archive_unreachable:{type(exc).__name__}")
            self._archive_cache[key] = result
        return self._archive_cache[key]


@dataclass
class AsOf:
    record: dict
    ticker: str
    stated: datetime
    precision: str
    last_closed: Optional[int]
    session: date
    fresh: bool
    retrieved_at: str


def _ok(value, source: str, a: AsOf) -> dict:
    return {"value": value, "source": source, "retrieved_at": a.retrieved_at}


def _gap(reason: str) -> dict:
    return {"value": None, "source": None, "retrieved_at": None, "gap": reason}


def ma_stack_tier(above: dict) -> str:
    """The Breadth monitor's SPY/QQQ MA-stack shading (CLAUDE.md 'MA Stack Shading'), 50SMA the line."""
    a10, a20, a50, a200 = (bool(above.get(p)) for p in MA_PERIODS)
    short = a10 or a20
    if a50:
        if a10 and a20 and a200:
            return "g3"
        if a200 and short:
            return "g2"
        if a200:
            return "g1"
        return "amber"
    if a200:
        return "r1"
    if short:
        return "r2"
    return "r3"


# ── archive shape helpers (defensive; S-A family payloads) ───────────────────

def _body(payload):
    return payload.get("payload", payload) if isinstance(payload, dict) else payload


def _archive_row(payload, ticker: str) -> Optional[dict]:
    body = _body(payload)
    rows = body.get("rows", body) if isinstance(body, dict) else body
    if isinstance(rows, dict):
        hit = rows.get(ticker) or rows.get(ticker.replace("-", "."))
        if isinstance(hit, dict):
            return hit
        if all(isinstance(v, dict) for v in rows.values()):
            return None
        raise ArchiveShapeError("rows")
    if isinstance(rows, list):
        for row in rows:
            if isinstance(row, dict) and str(row.get("ticker") or row.get("sym") or "").upper() == ticker:
                return row
        return None
    raise ArchiveShapeError("rows")


# ── providers ────────────────────────────────────────────────────────────────

def _p_index_regime(a: AsOf, env: ContextEnv) -> dict:
    if a.last_closed is None:
        return _gap("no_closed_session_before_statement")
    out, missing = {}, []
    for sym in INDEXES:
        hist = env.bars.history(sym, int_to_date(a.last_closed), max(MA_PERIODS) + 5)
        if not hist or hist[-1].d != a.last_closed or len(hist) < max(MA_PERIODS):
            missing.append(sym)
            continue
        closes = [b.c for b in hist]
        last = closes[-1]
        above = {str(p): last > sum(closes[-p:]) / p for p in MA_PERIODS}
        out[sym] = {"session": int_to_date(a.last_closed).isoformat(), "close": last, "above": above,
                    "tier": ma_stack_tier({p: above[str(p)] for p in MA_PERIODS})}
    if not out:
        return _gap("index_daily_bars_missing_or_stale")
    if missing:
        out["_missing"] = missing
    return _ok(out, "bars_sqlite daily closes <= last closed session; SMA 10/20/50/200; Breadth MA-stack tiers", a)


def _p_uct_exposure(a: AsOf, env: ContextEnv) -> dict:
    path = env.engine_db_path
    if not path or not os.path.exists(path):
        return _gap("engine_db_unavailable")
    conn = sqlite3.connect("file:" + path.replace("\\", "/") + "?mode=ro", uri=True)
    try:
        rows = conn.execute(
            "SELECT regime_date, phase, exposure_pct, distribution_days, trend_score, risk_score, created_at "
            "FROM market_regimes WHERE regime_date <= ? ORDER BY regime_date DESC LIMIT 5",
            (a.stated.date().isoformat(),)).fetchall()
    finally:
        conn.close()
    stated_utc = a.stated.astimezone(timezone.utc)
    for regime_date, phase, exposure, dist, trend, risk, created_at in rows:
        try:
            made = datetime.strptime(str(created_at)[:19], "%Y-%m-%d %H:%M:%S").replace(tzinfo=timezone.utc)
            known = made <= stated_utc
        except ValueError:
            known = regime_date < a.stated.date().isoformat()
        if known:
            return _ok({"regime_date": regime_date, "phase": phase, "exposure_pct": exposure,
                        "distribution_days": dist, "trend_score": trend, "risk_score": risk},
                       "engine.market_regimes (row created before the statement)", a)
    return _gap("no_regime_row_created_before_statement")


def _breadth(a: AsOf, env: ContextEnv) -> Optional[dict]:
    if env.breadth_row is None or a.last_closed is None:
        return None
    row = env.breadth_row(int_to_date(a.last_closed))
    if not row or str(row.get("date", ""))[:10] > int_to_date(a.last_closed).isoformat():
        return None
    return row


def _p_breadth(a: AsOf, env: ContextEnv) -> dict:
    if env.breadth_row is None:
        return _gap("breadth_reader_unavailable")
    row = _breadth(a, env)
    if row is None:
        return _gap("no_breadth_row_on_or_before_last_closed_session")
    value = {k: row[k] for k in BREADTH_FLAGSHIP if row.get(k) is not None}
    if not value:
        return _gap("breadth_row_has_no_flagship_metrics")
    value["date"] = str(row.get("date"))[:10]
    return _ok(value, "breadth_monitor.get_history(end=last closed session, anchor=le)", a)


def _p_vix(a: AsOf, env: ContextEnv) -> dict:
    row = _breadth(a, env) if env.breadth_row is not None else None
    if row is None or row.get("vix") is None:
        return _gap("no_vix_in_breadth_row_as_of")
    return _ok({"vix": row.get("vix"), "date": str(row.get("date"))[:10]},
               "breadth_monitor snapshot vix (bars.db holds no VIX series)", a)


def _screener_as_of(a: AsOf, env: ContextEnv) -> tuple:
    """(row, source, gap). Same-day: the live screener row when its bars_asof <= last closed session.
    Otherwise the archived screener family for the last closed session."""
    if a.fresh and env.screener_row is not None:
        row = env.screener_row(a.ticker)
        if row and a.last_closed is not None and int(row.get("bars_asof") or 0) <= a.last_closed:
            return row, "screener snapshot_db.get_row (same-day read, bars_asof <= last closed session)", None
        if row is not None:
            return None, None, "screener_row_newer_than_statement"
    if a.last_closed is None:
        return None, None, "no_closed_session_before_statement"
    payload, why = env.archived("screener", int_to_date(a.last_closed).isoformat())
    if payload is None:
        return None, None, why if not a.fresh else (why or "screener_reader_unavailable")
    try:
        row = _archive_row(payload, a.ticker)
    except ArchiveShapeError:
        return None, None, "capture_archive_shape_unrecognised:screener"
    if row is None:
        return None, None, "ticker_not_in_archived_screener"
    return row, "wisdom capture archive: screener family", None


def _p_sector(a: AsOf, env: ContextEnv) -> dict:
    row, source, why = _screener_as_of(a, env)
    if row and row.get("sector"):
        return _ok({"sector": row.get("sector"), "industry": row.get("industry")}, source, a)
    return _gap(why or "sector_absent_in_row")


def _p_themes(a: AsOf, env: ContextEnv) -> dict:
    if a.fresh and env.themes_for_ticker is not None:
        rows = env.themes_for_ticker(a.ticker) or []
        return _ok([{"theme_id": r.get("theme_id"), "theme": r.get("theme_name"), "tier": r.get("tier"),
                     "membership_source": r.get("source")} for r in rows],
                   "theme_db.get_themes_for_ticker (same-day read)", a)
    if a.last_closed is None:
        return _gap("no_closed_session_before_statement")
    payload, why = env.archived("themes", int_to_date(a.last_closed).isoformat())
    if payload is None:
        return _gap(why or "current_only_store_not_as_of")
    body = _body(payload)
    themes = body.get("themes") if isinstance(body, dict) else None
    if not isinstance(themes, list):
        return _gap("capture_archive_shape_unrecognised:themes")
    dot = a.ticker.replace("-", ".")
    found = []
    for theme in themes:
        holdings = theme.get("holdings") if isinstance(theme, dict) else None
        for h in holdings or []:
            sym = str(h.get("sym") if isinstance(h, dict) else h).upper()
            if sym in (a.ticker, dot):
                found.append({"theme_id": theme.get("id"), "theme": theme.get("name"),
                              "tier": h.get("tier") if isinstance(h, dict) else None})
    return _ok(found, "wisdom capture archive: themes family", a)


def _p_rs_rank(a: AsOf, env: ContextEnv) -> dict:
    row, source, why = _screener_as_of(a, env)
    if row and row.get("rs_rank") is not None:
        return _ok({"rs_rank": row.get("rs_rank"), "bars_asof": row.get("bars_asof")}, source, a)
    if not a.fresh and a.last_closed is not None:
        payload, why_rs = env.archived("rs", int_to_date(a.last_closed).isoformat())
        if payload is not None:
            try:
                rs_row = _archive_row(payload, a.ticker)
            except ArchiveShapeError:
                return _gap("capture_archive_shape_unrecognised:rs")
            if rs_row and rs_row.get("rs_rank") is not None:
                return _ok({"rs_rank": rs_row.get("rs_rank")}, "wisdom capture archive: rs family", a)
        why = why or why_rs
    return _gap(why or "rs_rank_null_in_row")


def _p_days_to_earnings(a: AsOf, env: ContextEnv) -> dict:
    row, source, why = _screener_as_of(a, env)
    if row and row.get("next_earnings_date"):
        try:
            nxt = date.fromisoformat(str(row["next_earnings_date"])[:10])
        except ValueError:
            return _gap("next_earnings_date_unparseable")
        return _ok({"next_earnings_date": nxt.isoformat(), "days_to": (nxt - a.stated.date()).days}, source, a)
    return _gap(why or "no_next_earnings_date")


def _p_catalysts(a: AsOf, env: ContextEnv) -> dict:
    if env.catalyst_rows is None:
        return _gap("catalyst_reader_unavailable")
    rows = env.catalyst_rows(a.session.isoformat()) or []
    if not rows:
        return _gap("catalysts_no_rows_for_session")
    row = next((r for r in rows if str(r.get("ticker", "")).upper() == a.ticker), None)
    source = "catalyst.store.get_for_date(session, ranked_only=False)"
    if row is None or row.get("rank") is None:
        return _ok({"listed": False}, source, a)
    written = row.get("thesis_at") or row.get("refreshed_at")
    if written and int(written) > int(a.stated.timestamp()):
        return _ok({"listed": False, "listed_later_same_session": True}, source, a)
    return _ok({"listed": True, "rank": row.get("rank"), "tag": row.get("tag"), "grade": row.get("grade"),
                "catalyst_type": row.get("catalyst_type")}, source, a)


def _p_news(a: AsOf, env: ContextEnv) -> dict:
    payload, why = env.archived("news", a.session.isoformat())
    if payload is None:
        return _gap("no_asof_news_reader_w1" if (why or "").startswith("capture_archive_reader_absent") else why)
    return _gap("capture_archive_news_parser_not_built_w1")


def _p_tweets(a: AsOf, env: ContextEnv) -> dict:
    until = int(a.stated.timestamp())
    since = until - 24 * 3600
    within_store = env.now - a.stated <= timedelta(days=TWEET_STORE_RETENTION_DAYS) - timedelta(hours=1)
    rows, source = None, None
    if within_store and env.tweets_window is not None:
        rows = env.tweets_window(since, until)
        source = "tweet_store official accounts, created_at in [stated-24h, stated] (read-only)"
    else:
        payload, why = env.archived("tweets", a.stated.date().isoformat())
        if payload is None:
            return _gap("tweets_store_retention_7d" if not within_store else "tweet_reader_unavailable")
        body = _body(payload)
        listed = body.get("rows", body) if isinstance(body, dict) else body
        if not isinstance(listed, list):
            return _gap("capture_archive_shape_unrecognised:tweets")
        rows = [t for t in listed if isinstance(t, dict) and since <= int(t.get("created_at") or 0) <= until]
        source = "wisdom capture archive: tweets family"
    mentioning = [t for t in rows if a.ticker in {str(x).upper() for x in (t.get("tickers") or [])}]
    return _ok({"count": len(rows), "mentioning_ticker": len(mentioning),
                "tweet_ids": [str(t.get("id")) for t in rows][:50]}, source, a)


def _p_archive_only(family_key: str, gap_reason: str):
    def provider(a: AsOf, env: ContextEnv) -> dict:
        if a.last_closed is None:
            return _gap("no_closed_session_before_statement")
        payload, why = env.archived(family_key, int_to_date(a.last_closed).isoformat())
        if payload is None:
            return _gap(gap_reason if (why or "").startswith(("capture_archive_reader_absent",
                                                              "capture_archive_missing")) else why)
        try:
            row = _archive_row(payload, a.ticker)
        except ArchiveShapeError:
            return _gap(f"capture_archive_shape_unrecognised:{family_key}")
        if row is None:
            return _gap(f"ticker_not_in_archived_{family_key}")
        return _ok(row, f"wisdom capture archive: {ARCHIVE_FAMILY.get(family_key, family_key)} family", a)
    return provider


PROVIDERS = {
    "index_regime": _p_index_regime,
    "uct_exposure": _p_uct_exposure,
    "breadth": _p_breadth,
    "vix": _p_vix,
    "sector": _p_sector,
    "themes": _p_themes,
    "rs_rank": _p_rs_rank,
    "days_to_earnings": _p_days_to_earnings,
    "catalysts": _p_catalysts,
    "news_24h": _p_news,
    "tweets_24h": _p_tweets,
    "fundamentals": _p_archive_only("street", "no_asof_fundamentals_reader_w1"),
    "options_flow": _p_archive_only("options_flow", "flow_worker_owned_no_web_asof_reader"),
    "dark_pool": _p_archive_only("dark_pool", "flow_worker_owned_no_web_asof_reader"),
}
assert tuple(PROVIDERS) == FIELDS


def compute_snapshot(record: dict, env: ContextEnv) -> dict:
    now = timeutil.to_et(env.now)
    stated = timeutil.parse_iso(record.get("stated_at_et"))
    base = {"record_id": record.get("record_id"), "snapshot_version": SNAPSHOT_VERSION,
            "created_at": timeutil.iso_et(now)}
    if stated is None:
        fields = {name: _gap("no_stated_at") for name in FIELDS}
        return dict(base, as_of_et=None, fields=fields, completeness=0.0)
    precision = record.get("stated_at_precision") or "minute"
    cap = last_closed_session_date(stated, precision)
    closed = env.bars.sessions_before(cap, 1)
    session_probe = stated if precision == "minute" else datetime.combine(stated.date(), time(12, 0), tzinfo=timeutil.ET)
    a = AsOf(record=record, ticker=(record.get("ticker") or "").strip().upper(), stated=stated, precision=precision,
             last_closed=closed[-1] if closed else None, session=timeutil.session_for(session_probe),
             fresh=(now.date() == stated.date() and now >= stated), retrieved_at=timeutil.iso_et(now))
    fields = {}
    for name, provider in PROVIDERS.items():
        if not a.ticker and name in ("sector", "themes", "rs_rank", "days_to_earnings", "catalysts",
                                     "fundamentals", "options_flow", "dark_pool"):
            fields[name] = _gap("no_ticker")
            continue
        try:
            fields[name] = provider(a, env)
        except Exception as exc:
            fields[name] = _gap(f"reader_error:{type(exc).__name__}")
    populated = sum(1 for f in fields.values() if f.get("value") is not None)
    return dict(base, as_of_et=timeutil.iso_et(stated), fields=fields,
                completeness=round(populated / len(FIELDS), 4))


# ── production readers (each built lazily; a reader that cannot be built is a named gap) ─────

def archive_reader() -> Callable[[str, str], Optional[dict]]:
    """Read one D12 family for one session from R2 (core.r2.get; never a write)."""
    def read(family: str, day_iso: str) -> Optional[dict]:
        from api.services.wisdom.core import r2

        raw = r2.get(f"wisdom/context/{day_iso}/{family}.json.gz")
        if raw is None:
            return None
        data = gzip.decompress(raw) if raw[:2] == b"\x1f\x8b" else raw
        return json.loads(data.decode("utf-8"))
    return read


def default_env(now: Optional[datetime] = None, bars: Optional[BarsAsOf] = None) -> ContextEnv:
    env = ContextEnv(bars=bars or BarsAsOf(), now=timeutil.to_et(now or timeutil.now_et()))

    def build(label, fn):
        try:
            return fn()
        except Exception as exc:
            env.notes[label] = f"reader_unavailable:{type(exc).__name__}"
            return None

    def _engine():
        from api.services import brain_sync
        return os.path.join(brain_sync.brain_dir(), "data", "uct_intelligence.db")

    def _breadth_reader():
        from api.services import breadth_monitor

        def read(d: date) -> Optional[dict]:
            rows = breadth_monitor.get_history(days=1, end=d.isoformat(), anchor="le")
            return rows[0] if rows else None
        return read

    def _catalysts():
        from api.services.catalyst import store
        return lambda market_date: store.get_for_date(market_date, ranked_only=False)

    def _tweets():
        from api.services import tweet_store
        path = tweet_store._DB_PATH

        def read(since: int, until: int) -> list:
            if not os.path.exists(path):
                raise FileNotFoundError("tweets.db")
            conn = sqlite3.connect("file:" + path.replace("\\", "/") + "?mode=ro", uri=True)
            try:
                rows = conn.execute(
                    "SELECT t.id, t.author_handle, t.created_at, (SELECT GROUP_CONCAT(tt.ticker) FROM tweet_tickers tt "
                    "WHERE tt.tweet_id = t.id) FROM tweets t JOIN twitter_accounts a ON LOWER(a.handle) = "
                    "LOWER(t.author_handle) WHERE a.is_official = 1 AND t.created_at BETWEEN ? AND ? "
                    "ORDER BY t.created_at", (since, until)).fetchall()
            finally:
                conn.close()
            return [{"id": r[0], "author_handle": r[1], "created_at": r[2],
                     "tickers": [x for x in (r[3] or "").split(",") if x]} for r in rows]
        return read

    def _themes():
        from api.services import theme_db
        return theme_db.get_themes_for_ticker

    def _screener():
        from api.services.screener import snapshot_db
        return snapshot_db.get_row

    env.engine_db_path = build("engine", _engine)
    env.breadth_row = build("breadth", _breadth_reader)
    env.catalyst_rows = build("catalysts", _catalysts)
    env.tweets_window = build("tweets", _tweets)
    env.themes_for_ticker = build("themes", _themes)
    env.screener_row = build("screener", _screener)
    env.archive = archive_reader()
    return env
