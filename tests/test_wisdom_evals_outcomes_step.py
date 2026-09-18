"""R90 rehearsal: the evals OUTCOMES STEP on real records (pipeline.run_outcomes, outcomes-v1).

`tests/test_wisdom_evals_outcomes.py` rails the PURE function `outcomes.compute`. Nothing railed
the STEP — the read, the write, and above all the JOIN that decides WHICH record an outcome is
attached to. An outcome attached to the wrong record is a lie about a trader's call, so the join
is the part this file exists to be able to say RED for.

WHAT THIS FILE HAS TO BE ABLE TO SAY RED FOR
1. an outcome attached to the wrong record — the load-bearing case is two CALLs on ONE ticker on
   ONE day with DIFFERENT levels; a ticker-keyed or ticker+date-keyed join makes them cross, and
   every per-record assertion in `test_wisdom_evals_outcomes.py` stays green while it does.
2. hit / miss / open resolved against the wrong prices, or not resolved at all.
3. the step writing a second row for a record it has already resolved (not idempotent).
4. provenance broken: an outcome that cannot be joined back to its record's own segment.
5. the population filter going vacuous — a rejected record, or a NEGATIVE_CALL with no direction,
   picking up an outcome.
6. the step spending money: constructing a paid client, importing a model SDK, or opening a socket.

⛔ No production wiring is changed by this file. It reads the step and writes only to a temp store
(WISDOM_DB_PATH under tmp_path) and synthesises every bar in memory.
"""
from __future__ import annotations

import ast
import builtins
import json
import pathlib
import socket
from datetime import date, datetime, timedelta

import pytest

from api.services.wisdom import registry
from api.services.wisdom.core import flags, store
from api.services.wisdom.core.timeutil import ET
from api.services.wisdom.evals import outcomes, pipeline
from api.services.wisdom.evals.bars_asof import BarsAsOf, MemoryReader, ymd_int

NOW = datetime(2026, 9, 30, 18, 0, tzinfo=ET)
STATED = "2026-08-05T10:00:00-04:00"           # Wednesday, pre-close, minute precision
ANCHOR = "2026-08-05"


def _weekdays(start: date, n: int) -> list[int]:
    out, cur = [], start
    while len(out) < n:
        if cur.weekday() < 5:
            out.append(ymd_int(cur))
        cur += timedelta(days=1)
    return out


SESSIONS = _weekdays(date(2026, 8, 3), 40)     # 2026-08-03 is a Monday
S = {d.isoformat(): ymd_int(d) for d in (date(2026, 8, 5), date(2026, 8, 6), date(2026, 8, 7))}


# ── the seeded world: synthesised records and synthesised bars, nothing copied ───────────────

#: ticker -> (flat default bar, {session: bar}). Every path is invented for this test.
PATHS: dict[str, tuple[tuple, dict]] = {
    # target trades, stop never -> HIT
    "NVDA": ((100.0, 102.0, 98.0, 100.0), {
        S["2026-08-05"]: (100.0, 100.5, 99.5, 100.0),
        S["2026-08-07"]: (101.0, 111.0, 100.0, 110.5),
    }),
    # stop trades, target never -> MISS
    "AMD": ((50.0, 51.0, 49.0, 50.0), {
        S["2026-08-05"]: (50.0, 50.4, 49.6, 50.0),
        S["2026-08-06"]: (50.0, 50.5, 46.5, 47.2),
    }),
    # neither level trades -> OPEN
    "MSFT": ((200.0, 210.0, 195.0, 200.0), {
        S["2026-08-05"]: (200.0, 201.0, 199.0, 200.0),
    }),
    # ONE path, TWO calls with different levels: 290 low then 310 high.
    # tight (295/305) sees both, stop first. wide (250/400) sees neither.
    "TSLA": ((300.0, 302.0, 298.0, 300.0), {
        S["2026-08-05"]: (300.0, 301.0, 299.0, 300.0),
        S["2026-08-06"]: (300.0, 300.5, 290.0, 292.0),
        S["2026-08-07"]: (292.0, 310.0, 291.0, 308.0),
    }),
    # a SHORT, neither level trades -> OPEN
    "AMZN": ((140.0, 142.0, 138.0, 140.0), {
        S["2026-08-05"]: (140.0, 140.5, 139.5, 140.0),
    }),
    "GOOG": ((90.0, 91.0, 89.0, 90.0), {}),
    "META": ((500.0, 505.0, 495.0, 500.0), {}),
}

#: record_id -> the row seeded into wisdom_records. Levels differ per record BY DESIGN.
SEEDS: dict[str, dict] = {
    "r-nvda-hit": dict(ticker="NVDA", direction="long", entry=100.0, stop=95.0, target=110.0,
                       segment_id="seg-nvda"),
    "r-amd-stopped": dict(ticker="AMD", direction="long", entry=50.0, stop=47.0, target=60.0,
                          segment_id="seg-amd"),
    "r-msft-open": dict(ticker="MSFT", direction="long", entry=200.0, stop=180.0, target=260.0,
                        segment_id="seg-msft"),
    "r-tsla-tight": dict(ticker="TSLA", direction="long", entry=300.0, stop=295.0, target=305.0,
                         segment_id="seg-tsla-tight"),
    "r-tsla-wide": dict(ticker="TSLA", direction="long", entry=300.0, stop=250.0, target=400.0,
                        segment_id="seg-tsla-wide"),
    "r-amzn-short": dict(ticker="AMZN", direction="short", entry=140.0, stop=145.0, target=120.0,
                         segment_id="seg-amzn", record_type="NEGATIVE_CALL"),
    # excluded: status rejected
    "r-goog-rejected": dict(ticker="GOOG", direction="long", entry=90.0, stop=85.0, target=99.0,
                            segment_id="seg-goog", status="rejected"),
    # excluded: a NEGATIVE_CALL with no direction (pipeline._records' second clause)
    "r-meta-nodir": dict(ticker="META", direction=None, entry=None, stop=None, target=None,
                         segment_id="seg-meta", record_type="NEGATIVE_CALL"),
}

RESOLVED = ("r-nvda-hit", "r-amd-stopped", "r-msft-open", "r-tsla-tight", "r-tsla-wide",
            "r-amzn-short")
EXCLUDED = ("r-goog-rejected", "r-meta-nodir")


def _bars() -> BarsAsOf:
    rows = {("SPY", "D"): [(s, 100.0, 101.0, 99.0, 100.0, 1e6) for s in SESSIONS]}
    for ticker, (flat, overrides) in PATHS.items():
        rows[(ticker, "D")] = [(s,) + tuple(overrides.get(s, flat)) + (1e5,) for s in SESSIONS]
    return BarsAsOf(MemoryReader(rows))


@pytest.fixture
def db(tmp_path, monkeypatch):
    monkeypatch.setenv("WISDOM_DB_PATH", str(tmp_path / "wisdom.db"))
    store.init_db()
    with store.write() as conn:
        conn.execute("INSERT INTO wisdom_sources (source_id, stream, external_ref, raw_sha256, "
                     "ingest_version, ingested_at) VALUES ('s-zoom','zoom_live','s-zoom','x','t','t')")
        for ordinal, (rid, seed) in enumerate(SEEDS.items()):
            conn.execute(
                "INSERT INTO wisdom_segments (segment_id, source_id, source_version, ordinal, kind, "
                "path, text, text_sha256, normalizer_version) VALUES (?,?,1,?,'section',?,?,?,'n1')",
                (seed["segment_id"], "s-zoom", ordinal, f"synthetic/{rid}", f"synthetic segment {ordinal}",
                 f"sha-{ordinal}"))
            row = {
                "record_id": rid, "record_type": seed.get("record_type", "CALL"),
                "segment_id": seed["segment_id"], "source_id": "s-zoom", "source_version": 1,
                "extractor_version": "wx-test", "record_hash": f"h-{rid}", "author_id": "tsdr",
                "stated_at_et": STATED, "stated_at_precision": "minute", "ticker": seed["ticker"],
                "direction": seed["direction"], "stance": "taking", "hindsight": 0,
                "entry": seed["entry"], "stop": seed["stop"],
                "targets_json": json.dumps([{"price": seed["target"], "text": "t1"}]
                                           if seed["target"] else []),
                "extraction_confidence": "high", "status": seed.get("status", "confirmed"),
                "created_at": "t",
            }
            conn.execute(f"INSERT INTO wisdom_records ({', '.join(row)}) "
                         f"VALUES ({', '.join('?' for _ in row)})", tuple(row.values()))
    return tmp_path / "wisdom.db"


def _ctx(force=True, dry_run=False):
    return registry.JobContext(job_id="t", now_et=NOW, due_key=None, force=force, dry_run=dry_run,
                               run_id="run")


def _outcome_rows() -> dict[str, dict]:
    with store.read() as conn:
        return {r["record_id"]: dict(r) for r in conn.execute("SELECT * FROM wisdom_outcomes")}


def _verdict(row: dict) -> str:
    """The product's own answer, read off the row it wrote — never recomputed here."""
    first = json.loads(row["horizons_json"] or "{}").get("first_hit")
    if first == "target":
        return "hit"
    if first == "stop":
        return "miss"
    if first == "ambiguous":
        return "ambiguous"
    return "open"


# ── 2. one outcome per CALL, resolved against the seeded prices ──────────────────────────────

def test_the_step_writes_one_outcome_per_call_resolved_against_the_seeded_prices(db):
    summary = pipeline.run_outcomes(_ctx(), bars=_bars())
    rows = _outcome_rows()

    assert summary["records"] == len(RESOLVED)
    assert summary["written"] == len(RESOLVED)
    assert sorted(rows) == sorted(RESOLVED)

    assert _verdict(rows["r-nvda-hit"]) == "hit"
    assert (rows["r-nvda-hit"]["target_hit"], rows["r-nvda-hit"]["target_hit_session"]) == (1, "2026-08-07")
    assert rows["r-nvda-hit"]["stop_hit"] == 0 and rows["r-nvda-hit"]["stop_hit_session"] is None

    assert _verdict(rows["r-amd-stopped"]) == "miss"
    assert (rows["r-amd-stopped"]["stop_hit"], rows["r-amd-stopped"]["stop_hit_session"]) == (1, "2026-08-06")
    assert rows["r-amd-stopped"]["target_hit"] == 0

    for rid in ("r-msft-open", "r-amzn-short"):
        assert _verdict(rows[rid]) == "open", rid
        assert (rows[rid]["stop_hit"], rows[rid]["target_hit"]) == (0, 0), rid

    # every row anchored on the session the call was made in, at the stated entry it traded through
    for rid in RESOLVED:
        assert rows[rid]["anchor_session"] == ANCHOR, rid
        assert rows[rid]["anchor_rule"] == "stated_entry_traded", rid
        assert rows[rid]["methodology_version"] == outcomes.METHODOLOGY_VERSION, rid
        assert rows[rid]["unverifiable_reason"] is None, rid


def test_the_population_filter_is_live_and_discriminating(db):
    """5. A rejected record and a directionless NEGATIVE_CALL get nothing; a NEGATIVE_CALL WITH a
    direction does — so "nothing was written" is never the answer to every question."""
    pipeline.run_outcomes(_ctx(), bars=_bars())
    rows = _outcome_rows()
    for rid in EXCLUDED:
        assert rid not in rows, rid
    assert "r-amzn-short" in rows           # control: the filter is not "drop every NEGATIVE_CALL"


# ── 1. THE JOIN. Two calls, one ticker, one day, different levels ───────────────────────────

def test_two_calls_on_one_ticker_with_different_levels_never_cross(db):
    """⛔ The load-bearing rail. Both records are TSLA, both stated 2026-08-05, and they share one
    price path. The tight call's levels trade; the wide call's do not. If an outcome is joined by
    ticker, or by ticker+date, or to the wrong row for any other reason, the wide call inherits the
    tight call's stop and target and this test goes red."""
    pipeline.run_outcomes(_ctx(), bars=_bars())
    rows = _outcome_rows()

    assert "r-tsla-tight" in rows and "r-tsla-wide" in rows, "both TSLA calls must have their OWN row"
    tight, wide = rows["r-tsla-tight"], rows["r-tsla-wide"]

    # each row carries the levels of ITS OWN record, not the other one's
    assert json.loads(tight["horizons_json"])["stop_used"] == 295.0
    assert json.loads(tight["horizons_json"])["target_used"] == 305.0
    assert json.loads(wide["horizons_json"])["stop_used"] == 250.0
    assert json.loads(wide["horizons_json"])["target_used"] == 400.0

    # the same path resolves to two DIFFERENT verdicts, which is only possible if they did not cross
    assert _verdict(tight) == "miss"
    assert (tight["stop_hit"], tight["stop_hit_session"]) == (1, "2026-08-06")
    assert (tight["target_hit"], tight["target_hit_session"]) == (1, "2026-08-07")
    assert tight["same_bar_ambiguity"] == 0

    assert _verdict(wide) == "open"
    assert (wide["stop_hit"], wide["target_hit"]) == (0, 0)
    assert (wide["stop_hit_session"], wide["target_hit_session"]) == (None, None)

    # and the pair is genuinely distinguishable — a rail that cannot tell them apart proves nothing
    assert _verdict(tight) != _verdict(wide)


# ── 3. idempotence ───────────────────────────────────────────────────────────────────────────

def test_running_the_step_twice_leaves_one_outcome_per_record(db):
    first = pipeline.run_outcomes(_ctx(), bars=_bars())
    assert first["written"] == len(RESOLVED)        # non-vacuity: the first run really wrote

    before = _outcome_rows()
    second = pipeline.run_outcomes(_ctx(), bars=_bars())
    after = _outcome_rows()

    with store.read() as conn:
        total = conn.execute("SELECT COUNT(*) FROM wisdom_outcomes").fetchone()[0]
    assert total == len(RESOLVED), "a second run must not add a second row for a resolved record"
    assert sorted(after) == sorted(RESOLVED)
    assert second["written"] == 0 and second.get("final") == len(RESOLVED)
    for rid in RESOLVED:
        assert after[rid]["horizons_json"] == before[rid]["horizons_json"], rid


# ── 4. provenance ────────────────────────────────────────────────────────────────────────────

def test_every_outcome_joins_back_to_its_own_records_segment(db):
    """wisdom_outcomes carries record_id, not segment_id — so provenance is the join through
    wisdom_records, and it has to land on the segment that record was extracted from."""
    pipeline.run_outcomes(_ctx(), bars=_bars())
    with store.read() as conn:
        joined = {r["record_id"]: (r["segment_id"], r["ticker"], r["path"]) for r in conn.execute(
            "SELECT o.record_id, r.segment_id, r.ticker, g.path FROM wisdom_outcomes o "
            "JOIN wisdom_records r ON r.record_id = o.record_id "
            "JOIN wisdom_segments g ON g.segment_id = r.segment_id")}

    assert sorted(joined) == sorted(RESOLVED)
    for rid in RESOLVED:
        seg, ticker, path = joined[rid]
        assert seg == SEEDS[rid]["segment_id"], rid
        assert ticker == SEEDS[rid]["ticker"], rid
        assert path == f"synthetic/{rid}", rid
    # the two TSLA calls resolve to DIFFERENT segments: the join discriminates within one ticker
    assert joined["r-tsla-tight"][0] != joined["r-tsla-wide"][0]


# ── the flag: the step is dark ───────────────────────────────────────────────────────────────

def test_the_outcomes_step_is_dark_unless_its_own_switch_is_on(db, monkeypatch):
    for env in ("WISDOM_OUTCOMES_ENABLED", "WISDOM_CONTEXT_SNAPSHOT_ENABLED",
                "WISDOM_REPLAY_ENABLED", "WISDOM_METRICS_ENABLED"):
        monkeypatch.delenv(env, raising=False)
    assert flags.outcomes_enabled() is False, "WISDOM_OUTCOMES_ENABLED defaults OFF"

    summary = pipeline.run_daily(_ctx(force=False), bars=_bars())
    assert summary["outcomes"] == {"skipped": "kill switch off"}
    assert _outcome_rows() == {}

    # control: the gate can pass — flipping exactly this one switch runs exactly this one step
    monkeypatch.setenv("WISDOM_OUTCOMES_ENABLED", "1")
    assert flags.outcomes_enabled() is True
    summary = pipeline.run_daily(_ctx(force=False), bars=_bars())
    assert summary["outcomes"]["written"] == len(RESOLVED)
    assert summary["replay"] == {"skipped": "kill switch off"}
    assert sorted(_outcome_rows()) == sorted(RESOLVED)


def test_a_dry_run_resolves_every_record_and_writes_nothing(db):
    summary = pipeline.run_outcomes(_ctx(dry_run=True), bars=_bars())
    assert summary["records"] == len(RESOLVED) and summary["computed"] == len(RESOLVED)
    assert summary["written"] == 0
    assert _outcome_rows() == {}


# ── 6. it does not spend ─────────────────────────────────────────────────────────────────────

_EVALS_DIR = pathlib.Path(__file__).resolve().parents[1] / "api" / "services" / "wisdom" / "evals"
_PAID_MARKERS = ("anthropic", "openai", "messages.create", "completions.create")


def _code_names(source: str) -> set[str]:
    """Dotted names and import targets ONLY. A comment contributes nothing (it is not in the AST)
    and a docstring or any other string literal contributes nothing (ast.Constant is not walked),
    so this is a check on CODE and can never match prose."""
    names: set[str] = set()

    def render(node) -> str:
        if isinstance(node, ast.Name):
            return node.id
        if isinstance(node, ast.Attribute):
            base = render(node.value)
            return f"{base}.{node.attr}" if base else f"?.{node.attr}"
        return ""

    for node in ast.walk(ast.parse(source)):
        if isinstance(node, ast.Import):
            names.update(a.name for a in node.names)
        elif isinstance(node, ast.ImportFrom):
            module = node.module or ""
            names.add(module)
            names.update(f"{module}.{a.name}" for a in node.names)
        elif isinstance(node, (ast.Name, ast.Attribute)):
            rendered = render(node)
            if rendered:
                names.add(rendered)
    return {n for n in names if n}


def _paid_hits(source: str) -> set[str]:
    return {n for n in _code_names(source) if any(m in n.lower() for m in _PAID_MARKERS)}


def test_the_paid_client_detector_reads_code_and_not_prose():
    """CONTROL for the two tests below. Without this, a detector that matched comments would make
    them fire everywhere, and a detector that matched nothing would make them pass everywhere."""
    prose = ('"""This module never calls anthropic and never does messages.create."""\n'
             "# import anthropic  -- deliberately not done here\n"
             "NOTE = 'openai is not used'\n"
             "x = 1\n")
    assert _paid_hits(prose) == set(), "a comment, a docstring and a string literal are not code"

    real = "import anthropic\nc = anthropic.Anthropic()\nm = c.messages.create(model='x')\n"
    assert _paid_hits(real), "the detector must see an actual client construction"


def test_grounding_is_the_only_evals_module_that_constructs_a_paid_client():
    """`grounding.py` DOES call a model — so it is the built-in control: if this set ever comes
    back empty the detector has stopped working, and if it ever grows the outcomes step (or one of
    its neighbours) has started to spend."""
    spenders = {p.name for p in sorted(_EVALS_DIR.glob("*.py")) if _paid_hits(p.read_text(encoding="utf-8"))}
    assert "grounding.py" in spenders, "the control must find the module that really does spend"
    assert spenders == {"grounding.py"}, f"a new paid caller appeared in evals: {sorted(spenders)}"

    for name in ("pipeline.py", "outcomes.py", "bars_asof.py"):
        assert _paid_hits((_EVALS_DIR / name).read_text(encoding="utf-8")) == set(), name


def test_running_the_step_imports_no_model_sdk_and_opens_no_socket(db, monkeypatch):
    blocked = {"anthropic", "openai", "httpx", "requests", "aiohttp", "urllib3"}
    real_import = builtins.__import__

    def guarded_import(name, *args, **kwargs):
        if str(name).split(".")[0] in blocked:
            raise AssertionError(f"the outcomes step imported {name!r}")
        return real_import(name, *args, **kwargs)

    def no_socket(self, *args, **kwargs):
        raise AssertionError("the outcomes step opened a socket")

    monkeypatch.setattr(builtins, "__import__", guarded_import)
    monkeypatch.setattr(socket.socket, "connect", no_socket)

    # controls: both guards can actually fire
    with pytest.raises(AssertionError):
        builtins.__import__("anthropic")
    with pytest.raises(AssertionError):
        socket.socket().connect(("127.0.0.1", 9))

    summary = pipeline.run_outcomes(_ctx(), bars=_bars())
    # non-vacuity: the guarded run did the real work, it did not no-op its way past the guards
    assert summary["written"] == len(RESOLVED)
    assert sorted(_outcome_rows()) == sorted(RESOLVED)
