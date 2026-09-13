"""CALL-REPLAY: was the ticker in UCT's own recorded output on the session of the call?
(W1 §6.1, manifest §7.1, CONTRACTS §6.5; the eval-inputs map names every source.)

SESSION. The session of stated_at, or the prior session for a pre-open or non-trading-day
statement (timeutil.session_for). A day- or week-precision statement has no hour, so it is
judged against its own date when that date is a session.

EVERY SOURCE ANSWERS ONE OF THREE WORDS, and the difference is the whole method:
  hit       the ticker is in that source's output for that session
  miss      the source provably ran for that session and the ticker is not in it
  unproven  we cannot show what the source said that day (no rows for the date, pruned,
            outside retention, no coverage receipt, file absent). NEVER counted as a miss.

LEVELS (strictness), derived from the per-source verdicts by level_verdicts() and nowhere else:
  any    hit in any source
  topn   hit in a RANKED source at rank <= that source's desk display count (unranked sources
         do not take part at this level)
  setup  hit in a source whose setup string maps, through wisdom_vocab_maps, to the call's own
         vocabulary id

All reads are read-only (sqlite URI mode=ro, or a JSON read). Nothing here writes to a source.
"""
from __future__ import annotations

import importlib
import importlib.util
import json
import os
import sqlite3
from dataclasses import asdict, dataclass, field
from datetime import date, datetime, time, timedelta
from typing import Callable, Iterable, Optional

from api.services.wisdom.core import timeutil

METHOD_VERSION = "replay-v1"
LEVELS = ("any", "topn", "setup")
DESK_TOP_N = 20                     # LeadershipTile.jsx / UCT20.jsx slice(0,20); catalysts desk N=20
PATTERN_RETENTION_DAYS = 120        # pattern_engine.memory.PRUNE_RETENTION_DAYS default


class SourceUnavailable(RuntimeError):
    pass


@dataclass
class Check:
    source: str
    verdict: str
    as_of: str
    rank: Optional[int] = None
    top_n: Optional[int] = None
    setups: list = field(default_factory=list)
    list_name: Optional[str] = None
    reason: Optional[str] = None
    setup_raw: Optional[str] = None
    vocab_id: Optional[str] = None


def replay_session(record: dict) -> Optional[date]:
    stated = timeutil.parse_iso(record.get("stated_at_et"))
    if stated is None:
        return None
    if (record.get("stated_at_precision") or "minute") != "minute":
        stated = datetime.combine(stated.date(), time(12, 0), tzinfo=timeutil.ET)
    return timeutil.session_for(stated)


def _ro(path: Optional[str]) -> sqlite3.Connection:
    if not path or not os.path.exists(path):
        raise SourceUnavailable("source_file_missing")
    conn = sqlite3.connect("file:" + str(path).replace("\\", "/") + "?mode=ro", uri=True, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    return conn


class _SqliteAdapter:
    name = "abstract"
    top_n: Optional[int] = None
    list_name: Optional[str] = None

    def __init__(self, path: Optional[str]):
        self.path = path
        self._conn: Optional[sqlite3.Connection] = None

    def conn(self) -> sqlite3.Connection:
        if self._conn is None:
            self._conn = _ro(self.path)
        return self._conn

    def close(self) -> None:
        if self._conn is not None:
            self._conn.close()
            self._conn = None

    def check(self, ticker: str, session: date) -> Check:
        try:
            return self._check(ticker.upper(), session)
        except SourceUnavailable as exc:
            return Check(self.name, "unproven", session.isoformat(), top_n=self.top_n,
                         list_name=self.list_name, reason=str(exc))
        except sqlite3.Error as exc:
            return Check(self.name, "unproven", session.isoformat(), top_n=self.top_n,
                         list_name=self.list_name, reason=f"source_error:{type(exc).__name__}")

    def _check(self, ticker: str, session: date) -> Check:  # pragma: no cover - abstract
        raise NotImplementedError

    def _verdict(self, session: date, *, covered: bool, row, rank=None, setups=(), reason_absent: str,
                 miss_reason: Optional[str] = None) -> Check:
        iso = session.isoformat()
        if not covered:
            return Check(self.name, "unproven", iso, top_n=self.top_n, list_name=self.list_name, reason=reason_absent)
        if row is None:
            return Check(self.name, "miss", iso, top_n=self.top_n, list_name=self.list_name, reason=miss_reason)
        clean = [s for s in setups if s]
        return Check(self.name, "hit", iso, rank=rank, top_n=self.top_n, list_name=self.list_name, setups=clean)


class LeadershipSnapshots(_SqliteAdapter):
    """ENGINE leadership_snapshots. TWO lanes per date; each lane is its own source so the two
    never double-count (eval-inputs map). rank 1..20, desk N=20."""

    top_n = DESK_TOP_N
    list_name = "engine_leadership_setup_type"

    def __init__(self, path: Optional[str], lane: str):
        super().__init__(path)
        self.lane = lane
        self.name = f"leadership_snapshots:{lane}"

    def _check(self, ticker, session):
        c = self.conn()
        d = session.isoformat()
        covered = c.execute("SELECT 1 FROM leadership_snapshots WHERE snapshot_date=? AND source=? LIMIT 1",
                            (d, self.lane)).fetchone() is not None
        row = c.execute("SELECT rank, setup_type FROM leadership_snapshots WHERE snapshot_date=? AND source=? "
                        "AND UPPER(symbol)=? ORDER BY rank LIMIT 1", (d, self.lane, ticker)).fetchone()
        return self._verdict(session, covered=covered, row=row, rank=row["rank"] if row else None,
                             setups=[row["setup_type"]] if row else [], reason_absent="no_snapshot_for_date")


class SetupTriggers(_SqliteAdapter):
    name = "setup_triggers"
    list_name = "engine_setup_triggers"

    def _check(self, ticker, session):
        c = self.conn()
        d = session.isoformat()
        covered = c.execute("SELECT 1 FROM setup_triggers WHERE trigger_date=? LIMIT 1", (d,)).fetchone() is not None
        rows = c.execute("SELECT setup_name FROM setup_triggers WHERE trigger_date=? AND UPPER(symbol)=?",
                         (d, ticker)).fetchall()
        return self._verdict(session, covered=covered, row=rows[0] if rows else None,
                             setups=[r["setup_name"] for r in rows], reason_absent="no_triggers_for_date")


class EpCandidates(_SqliteAdapter):
    name = "ep_candidates"
    list_name = "engine_ep_candidates"

    def _check(self, ticker, session):
        c = self.conn()
        d = session.isoformat()
        covered = c.execute("SELECT 1 FROM ep_candidates WHERE date_flagged=? LIMIT 1", (d,)).fetchone() is not None
        row = c.execute("SELECT setup_type FROM ep_candidates WHERE date_flagged=? AND UPPER(symbol)=? LIMIT 1",
                        (d, ticker)).fetchone()
        return self._verdict(session, covered=covered, row=row, setups=[row["setup_type"]] if row else [],
                             reason_absent="no_ep_candidates_for_date")


class WireUniverse(_SqliteAdapter):
    """ENGINE wire_universe: PASSED names only (dropped_at_stage IS NULL)."""

    name = "wire_universe"

    def _check(self, ticker, session):
        c = self.conn()
        d = session.isoformat()
        covered = c.execute("SELECT 1 FROM wire_universe WHERE issue_id=? LIMIT 1", (d,)).fetchone() is not None
        row = c.execute("SELECT dropped_at_stage FROM wire_universe WHERE issue_id=? AND UPPER(ticker)=? LIMIT 1",
                        (d, ticker)).fetchone()
        if row is not None and row["dropped_at_stage"] is not None:
            return Check(self.name, "miss", d, reason=f"dropped_at_stage_{row['dropped_at_stage']}")
        return self._verdict(session, covered=covered, row=row, reason_absent="no_wire_issue_for_date")


class Catalysts(_SqliteAdapter):
    """catalysts.db: RANKED rows are the published list (rank NULL = dropped, kept for history)."""

    name = "catalysts"
    top_n = DESK_TOP_N
    list_name = "catalysts_tag"

    def _check(self, ticker, session):
        c = self.conn()
        d = session.isoformat()
        covered = c.execute("SELECT 1 FROM catalysts WHERE market_date=? AND rank IS NOT NULL LIMIT 1",
                            (d,)).fetchone() is not None
        row = c.execute("SELECT rank, tag FROM catalysts WHERE market_date=? AND UPPER(ticker)=? AND rank IS NOT NULL",
                        (d, ticker)).fetchone()
        return self._verdict(session, covered=covered, row=row, rank=row["rank"] if row else None,
                             setups=[row["tag"]] if row else [], reason_absent="no_ranked_catalysts_for_date")


class PatternVerdicts(_SqliteAdapter):
    """pattern_vision.db pattern_verdicts: confirmed=1 on the evidence-bar date."""

    name = "pattern_verdicts"
    list_name = "pv_FOCUSED_SETUPS"

    def _check(self, ticker, session):
        c = self.conn()
        d = session.isoformat()
        covered = c.execute("SELECT 1 FROM pattern_verdicts WHERE asof_date=? LIMIT 1", (d,)).fetchone() is not None
        rows = c.execute("SELECT setup FROM pattern_verdicts WHERE asof_date=? AND UPPER(ticker)=? AND confirmed=1",
                         (d, ticker)).fetchall()
        return self._verdict(session, covered=covered, row=rows[0] if rows else None,
                             setups=[r["setup"] for r in rows], reason_absent="no_verdicts_for_date")


class PatternDetections(_SqliteAdapter):
    """patterns.db pattern_detections, daily. A shape counts for session D when it had formed by D
    (end_t <= D), had been detected by the end of D, and was still being seen on D
    (last_seen_at >= start of D). detected_at keeps the FIRST sighting and is wall clock, so it is
    never compared to D for equality. Outside the 120-day prune, or before the store's own floor,
    the answer is unproven."""

    name = "pattern_detections"
    list_name = "pattern_engine"

    def __init__(self, path: Optional[str], now: Optional[datetime] = None):
        super().__init__(path)
        self.now = timeutil.to_et(now) if now else timeutil.now_et()
        self._floor: Optional[int] = None
        self._floor_read = False

    def _store_floor(self) -> Optional[int]:
        if not self._floor_read:
            row = self.conn().execute("SELECT MIN(detected_at) FROM pattern_detections WHERE tf='D'").fetchone()
            self._floor = int(row[0]) if row and row[0] is not None else None
            self._floor_read = True
        return self._floor

    def _check(self, ticker, session):
        iso = session.isoformat()
        if session < self.now.date() - timedelta(days=PATTERN_RETENTION_DAYS):
            return Check(self.name, "unproven", iso, list_name=self.list_name, reason="outside_120d_retention")
        start = int(datetime.combine(session, time(0, 0), tzinfo=timeutil.ET).timestamp())
        end = int(datetime.combine(session + timedelta(days=1), time(0, 0), tzinfo=timeutil.ET).timestamp()) - 1
        floor = self._store_floor()
        if floor is None or end < floor:
            return Check(self.name, "unproven", iso, list_name=self.list_name, reason="before_store_floor")
        rows = self.conn().execute(
            "SELECT pattern_id, confidence FROM pattern_detections WHERE UPPER(sym)=? AND tf='D' AND end_t<=? "
            "AND detected_at<=? AND last_seen_at>=? ORDER BY confidence DESC",
            (ticker, session.year * 10000 + session.month * 100 + session.day, end, start)).fetchall()
        return self._verdict(session, covered=True, row=rows[0] if rows else None,
                             setups=[r["pattern_id"] for r in rows], reason_absent="")


class ScanHits(_SqliteAdapter):
    """screener.db scan_hits: a definition's hit counts ONLY beside its scan_coverage receipt.
    No receipt for the session = unproven, never a computed zero."""

    name = "scan_hits"
    list_name = "screener_definitions"

    def _check(self, ticker, session):
        c = self.conn()
        as_of = session.year * 10000 + session.month * 100 + session.day
        covered = c.execute("SELECT 1 FROM scan_coverage WHERE as_of=? LIMIT 1", (as_of,)).fetchone() is not None
        rows = c.execute(
            "SELECT h.def_hash FROM scan_hits h JOIN scan_coverage k ON k.def_hash=h.def_hash AND k.tf=h.tf "
            "AND k.as_of=h.as_of WHERE h.as_of=? AND UPPER(h.ticker)=?", (as_of, ticker)).fetchall()
        return self._verdict(session, covered=covered, row=rows[0] if rows else None,
                             setups=[r["def_hash"] for r in rows], reason_absent="no_scan_coverage_receipt")


class Uct20Compositions:
    """uct20_compositions.json: [{date, holdings[]}], one entry per ET date; rank = list order."""

    name = "uct20_compositions"
    top_n = DESK_TOP_N
    list_name = None

    def __init__(self, path: Optional[str]):
        self.path = path
        self._by_date: Optional[dict] = None

    def close(self) -> None:
        return None

    def check(self, ticker: str, session: date) -> Check:
        iso = session.isoformat()
        if self._by_date is None:
            if not self.path or not os.path.exists(self.path):
                return Check(self.name, "unproven", iso, top_n=self.top_n, reason="source_file_missing")
            try:
                with open(self.path, encoding="utf-8") as fh:
                    data = json.load(fh)
            except (OSError, ValueError) as exc:
                return Check(self.name, "unproven", iso, top_n=self.top_n, reason=f"source_error:{type(exc).__name__}")
            self._by_date = {str(e.get("date"))[:10]: e for e in data if isinstance(e, dict)} if isinstance(data, list) else {}
        entry = self._by_date.get(iso)
        if entry is None:
            return Check(self.name, "unproven", iso, top_n=self.top_n, reason="no_composition_for_date")
        holdings = [str(h.get("symbol") if isinstance(h, dict) else h).upper() for h in entry.get("holdings") or []]
        if ticker.upper() in holdings:
            return Check(self.name, "hit", iso, rank=holdings.index(ticker.upper()) + 1, top_n=self.top_n)
        return Check(self.name, "miss", iso, top_n=self.top_n)


class CapturedCandidates:
    """Scanner candidates from the Wisdom capture archive (S-A family 'candidates'). Before the
    capture started, candidates are unrecoverable and the answer is unproven."""

    name = "captured_candidates"
    top_n = None
    list_name = "screener_candidates"
    family = "candidates"

    def __init__(self, archive: Callable[[str, str], Optional[dict]]):
        self.archive = archive

    def close(self) -> None:
        return None

    def check(self, ticker: str, session: date) -> Check:
        iso = session.isoformat()
        try:
            payload = self.archive(self.family, iso)
        except Exception as exc:  # R2 unconfigured locally, network, shape
            return Check(self.name, "unproven", iso, list_name=self.list_name,
                         reason=f"capture_archive_unreachable:{type(exc).__name__}")
        if payload is None:
            return Check(self.name, "unproven", iso, list_name=self.list_name, reason="capture_archive_missing")
        body = payload.get("payload", payload) if isinstance(payload, dict) else payload
        buckets = body.get("candidates", body) if isinstance(body, dict) else {"rows": body}
        found = []
        if isinstance(buckets, dict):
            for bucket, rows in buckets.items():
                for row in rows if isinstance(rows, list) else []:
                    if isinstance(row, dict) and str(row.get("ticker", "")).upper() == ticker.upper():
                        found.append(row.get("setup_type") or bucket)
        if found:
            return Check(self.name, "hit", iso, setups=found, list_name=self.list_name)
        return Check(self.name, "miss", iso, list_name=self.list_name)


# ── vocabulary ───────────────────────────────────────────────────────────────

class VocabLookup:
    """Setup string -> vocab_id through wisdom_vocab_maps (the ONE authority, D9).

    Order: (1) S-B's core.vocab.lookup_vocab_id(list_name, external_name) when that module exists
    (find_spec seam); (2) exact then case-insensitive row in wisdom_vocab_maps for that list;
    (3) a case-insensitive name that maps to exactly ONE vocab_id across every list; (4) for a
    call's own raw setup name, a wisdom_vocab name or alias. Unmapped is None, reported, never guessed."""

    def __init__(self, conn: Optional[sqlite3.Connection]):
        self.conn = conn
        self._cache: dict = {}
        self._seam = None
        if importlib.util.find_spec("api.services.wisdom.core.vocab") is not None:
            try:
                mod = importlib.import_module("api.services.wisdom.core.vocab")
                self._seam = getattr(mod, "lookup_vocab_id", None)
            except Exception:
                self._seam = None

    def _q(self, sql: str, params: tuple) -> list:
        if self.conn is None:
            return []
        try:
            return self.conn.execute(sql, params).fetchall()
        except sqlite3.Error:
            return []

    def for_source(self, list_name: Optional[str], external: Optional[str]) -> Optional[str]:
        if not external:
            return None
        key = (list_name, external)
        if key in self._cache:
            return self._cache[key]
        found = None
        if callable(self._seam):
            try:
                found = self._seam(list_name, external)
            except Exception:
                found = None
        if found is None and list_name:
            rows = self._q("SELECT vocab_id FROM wisdom_vocab_maps WHERE list_name=? AND external_name=? "
                           "AND vocab_id IS NOT NULL", (list_name, external))
            rows = rows or self._q("SELECT vocab_id FROM wisdom_vocab_maps WHERE list_name=? AND "
                                   "LOWER(external_name)=LOWER(?) AND vocab_id IS NOT NULL", (list_name, external))
            found = rows[0][0] if rows else None
        if found is None:
            rows = self._q("SELECT DISTINCT vocab_id FROM wisdom_vocab_maps WHERE LOWER(external_name)=LOWER(?) "
                           "AND vocab_id IS NOT NULL", (external,))
            found = rows[0][0] if len(rows) == 1 else None
        self._cache[key] = found
        return found

    def for_record(self, record: dict) -> Optional[str]:
        if record.get("vocab_id"):
            return record["vocab_id"]
        raw = record.get("setup_name_raw")
        if not raw:
            return None
        found = self.for_source(None, raw)
        if found is None:
            rows = self._q("SELECT vocab_id FROM wisdom_vocab WHERE LOWER(name)=LOWER(?)", (raw,))
            found = rows[0][0] if rows else None
        if found is None:
            for vocab_id, aliases in self._q("SELECT vocab_id, aliases_json FROM wisdom_vocab", ()):
                try:
                    names = [str(a).casefold() for a in json.loads(aliases or "[]")]
                except ValueError:
                    names = []
                if raw.casefold() in names:
                    found = vocab_id
                    break
        return found


def resolve_setups(check: Check, vocab: VocabLookup, record_vocab: Optional[str]) -> Check:
    """Pick the setup string that matches the call's vocabulary when one does; else the first
    mapped one; else the first raw one. The raw list survives in setup_raw when there are several."""
    mapped = [(s, vocab.for_source(check.list_name, s)) for s in check.setups]
    match = next(((s, v) for s, v in mapped if record_vocab and v == record_vocab), None)
    pick = match or next(((s, v) for s, v in mapped if v), None) or (mapped[0] if mapped else (None, None))
    check.vocab_id = pick[1]
    if len(check.setups) > 1:
        check.setup_raw = json.dumps(check.setups)
    else:
        check.setup_raw = pick[0]
    return check


def replay_record(record: dict, adapters: Iterable, vocab: VocabLookup) -> dict:
    session = replay_session(record)
    ticker = (record.get("ticker") or "").strip().upper()
    record_vocab = vocab.for_record(record)
    if session is None or not ticker:
        return {"record_id": record.get("record_id"), "session": None, "checks": [], "record_vocab": record_vocab,
                "levels": level_verdicts([], record_vocab),
                "skipped": "no_stated_at" if session is None else "no_ticker"}
    checks = [resolve_setups(a.check(ticker, session), vocab, record_vocab) for a in adapters]
    as_dicts = [asdict(c) for c in checks]
    return {"record_id": record.get("record_id"), "session": session.isoformat(), "checks": as_dicts,
            "record_vocab": record_vocab, "levels": level_verdicts(as_dicts, record_vocab), "skipped": None}


def level_verdicts(checks: list, record_vocab: Optional[str]) -> dict:
    """THE one place the three strictness levels are decided (replay rows and metrics both call it)."""
    hits = [c for c in checks if c.get("verdict") == "hit"]
    proven = [c for c in checks if c.get("verdict") in ("hit", "miss")]
    unproven = [c for c in checks if c.get("verdict") == "unproven"]

    def verdict(level_hits, level_proven, empty_reason):
        if level_hits:
            return {"verdict": "hit", "sources": sorted({c["source"] for c in level_hits})}
        if level_proven:
            return {"verdict": "miss", "sources": [], "unproven_sources": len(unproven)}
        return {"verdict": "unproven", "sources": [], "reason": empty_reason}

    out = {"any": verdict(hits, proven, "not_replayed" if not checks else "every_source_unproven")}
    ranked = [c for c in checks if c.get("top_n")]
    topn_hits = [c for c in ranked if c.get("verdict") == "hit" and c.get("rank") is not None
                 and int(c["rank"]) <= int(c["top_n"])]
    topn_proven = [c for c in ranked if c.get("verdict") in ("hit", "miss")]
    out["topn"] = verdict(topn_hits, topn_proven, "no_ranked_source_proven")
    if not record_vocab:
        out["setup"] = {"verdict": "excluded", "sources": [], "reason": "record_setup_unmapped"}
    else:
        setup_hits = [c for c in hits if c.get("vocab_id") == record_vocab]
        setup_proven = [c for c in checks if c.get("verdict") == "miss"
                        or (c.get("verdict") == "hit" and c.get("vocab_id"))]
        out["setup"] = verdict(setup_hits, setup_proven, "no_source_setup_mapped")
    return out


def default_adapters(*, now: Optional[datetime] = None, engine_db: Optional[str] = None,
                     catalysts_db: Optional[str] = None, pattern_vision_db: Optional[str] = None,
                     patterns_db: Optional[str] = None, screener_db: Optional[str] = None,
                     uct20_file: Optional[str] = None,
                     archive: Optional[Callable[[str, str], Optional[dict]]] = None,
                     resolve_missing: bool = True) -> tuple[list, dict]:
    """Every source adapter. Explicit paths win; when resolve_missing, the product modules' OWN
    resolvers supply the rest (no path literal lives in this package). Returns (adapters, notes)
    where notes names every source that could not be located and why."""
    notes: dict = {}

    def resolve(label, explicit, fn):
        if explicit or not resolve_missing:
            return explicit
        try:
            return fn()
        except Exception as exc:
            notes[label] = f"path_unresolved:{type(exc).__name__}"
            return None

    def _engine():
        from api.services import brain_sync
        return os.path.join(brain_sync.brain_dir(), "data", "uct_intelligence.db")

    def _catalysts():
        from api.services.catalyst import store
        return store._DB_PATH

    def _pv():
        from api.services.pattern_vision import store
        return store.get_db_path()

    def _patterns():
        from api.services.pattern_engine import pattern_db
        return pattern_db._db_path()

    def _screener():
        from api.services.screener import snapshot_db
        return snapshot_db.get_db_path()

    def _uct20():
        from api.services import uct20_nav
        return uct20_nav._COMPOSITIONS_FILE

    engine = resolve("engine", engine_db, _engine)
    adapters = [
        LeadershipSnapshots(engine, "morning_wire"),
        LeadershipSnapshots(engine, "autonomous_brain"),
        SetupTriggers(engine),
        EpCandidates(engine),
        WireUniverse(engine),
        Catalysts(resolve("catalysts", catalysts_db, _catalysts)),
        PatternVerdicts(resolve("pattern_vision", pattern_vision_db, _pv)),
        PatternDetections(resolve("patterns", patterns_db, _patterns), now=now),
        ScanHits(resolve("screener", screener_db, _screener)),
        Uct20Compositions(resolve("uct20", uct20_file, _uct20)),
    ]
    if archive is not None:
        adapters.append(CapturedCandidates(archive))
    return adapters, notes
