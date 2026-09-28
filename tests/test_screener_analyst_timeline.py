"""TERM-073 (FB-A4-01) — the nightly analyst pass is RETAINED into a timeline.

Before this, ``analyst_pass.upsert`` wrote ``INSERT OR REPLACE INTO analyst_rows`` keyed on the
ticker, so every night's consensus / price target / grade counts / EPS growth overwrote the
previous night's. A revision series cannot be backfilled from the vendor, so each night not kept
was lost for good. These rails pin the retention:

  * a second night APPENDS, it does not replace (and a same-night re-run appends too);
  * the timeline is DATED (ET night) and ORDERED;
  * a crash inside the append leaves the previous timeline exactly as it was, and never touches
    the screener's own row (the member path);
  * no code path updates, replaces or deletes a timeline row;
  * the store holding it is registered for off-box backup, and that backup carries the timeline;
  * two identical snapshots are NOT a revision (the acceptance test of FB-A4-01).

Every clock is injected: ``run_pass(now=...)`` plus a frozen ``ap._now_et``. No FMP calls.
"""
import ast
import contextlib
import datetime
import pathlib
import re
import sqlite3

import api.services.screener.analyst_pass as ap
import api.services.store_backup as sb

REPO = pathlib.Path(__file__).resolve().parents[1]

NIGHT_1 = datetime.datetime(2026, 9, 1, 2, 0, tzinfo=ap._ET)
NIGHT_2 = datetime.datetime(2026, 9, 2, 2, 0, tzinfo=ap._ET)


def _use_tmp_db(monkeypatch, tmp_path):
    monkeypatch.setenv("SCREENER_ANALYST_DB_PATH", str(tmp_path / "analyst.db"))
    monkeypatch.setenv("SCREENER_ANALYST_GAP_SECONDS", "0")
    ap.init_db()


def _row(pt, consensus="Buy", up=0, down=0, eps=12.5):
    return {"consensus": consensus, "pt_target": pt, "upgrades_30d": up,
            "downgrades_30d": down, "eps_next_y_growth": eps}


def _night(monkeypatch, anchor, values, *, clock=None):
    """One run_pass over exactly the tickers in ``values`` (None = the fetch failed)."""
    names = set(values)
    monkeypatch.setattr(ap, "actives", lambda failures=None: set(names))
    monkeypatch.setattr(ap, "_cap_universe", lambda: set(names))
    monkeypatch.setattr(ap, "_now_et", lambda: clock or anchor)
    monkeypatch.setattr(ap, "fetch_one",
                        lambda t: None if values[t] is None else dict(values[t]))
    return ap.run_pass(now=anchor)


def _raw_timeline(db_path):
    """Read the table with a plain connection — independent of the module under test."""
    with contextlib.closing(sqlite3.connect(db_path)) as c:
        c.row_factory = sqlite3.Row
        return [dict(r) for r in c.execute(
            "SELECT * FROM analyst_timeline ORDER BY ticker, fetched_at")]


# ── append, not replace ──────────────────────────────────────────────────────
def test_a_second_night_appends_rather_than_replaces(monkeypatch, tmp_path):
    _use_tmp_db(monkeypatch, tmp_path)
    r1 = _night(monkeypatch, NIGHT_1, {"AAA": _row(100.0), "BBB": _row(50.0)})
    after_night_1 = _raw_timeline(ap.get_db_path())
    assert len(after_night_1) == 2 and r1["timeline_appended"] == 2

    r2 = _night(monkeypatch, NIGHT_2, {"AAA": _row(110.0), "BBB": _row(50.0)})
    assert r2["timeline_appended"] == 2 and r2["timeline_errors"] == 0

    tl = ap.read_timeline("AAA")
    assert [r["pass_date"] for r in tl] == ["2026-09-01", "2026-09-02"]
    assert [r["pt_target"] for r in tl] == [100.0, 110.0]
    # Night 1's rows survive night 2 byte-for-byte: the second night only ADDED.
    after_night_2 = _raw_timeline(ap.get_db_path())
    assert len(after_night_2) == 4
    assert all(r in after_night_2 for r in after_night_1)

    # The member-facing current-state row is still REPLACED, exactly as before TERM-073.
    cur = ap.read_analyst_fields(["AAA"], now=NIGHT_2.timestamp())
    assert cur["AAA"]["pt_target"] == 110.0


def test_a_same_night_rerun_appends_and_keeps_the_first_observation(monkeypatch, tmp_path):
    _use_tmp_db(monkeypatch, tmp_path)
    _night(monkeypatch, NIGHT_1, {"AAA": _row(100.0)})
    rerun_clock = NIGHT_1 + datetime.timedelta(minutes=10)
    _night(monkeypatch, NIGHT_1, {"AAA": _row(101.0)}, clock=rerun_clock)

    tl = ap.read_timeline("AAA")
    assert [r["pt_target"] for r in tl] == [100.0, 101.0]
    assert [r["pass_date"] for r in tl] == ["2026-09-01", "2026-09-01"]


def test_a_night_that_did_not_observe_a_ticker_writes_no_row_for_it(monkeypatch, tmp_path):
    """Not observed is a different fact from observed-and-unchanged, so a failed fetch
    leaves NO timeline row rather than a null one."""
    _use_tmp_db(monkeypatch, tmp_path)
    r = _night(monkeypatch, NIGHT_1, {"AAA": _row(100.0), "BBB": None})
    assert r["errors"] == 1 and r["timeline_appended"] == 1
    assert ap.read_timeline("BBB") == []
    assert len(ap.read_timeline("AAA")) == 1


# ── dated and ordered ────────────────────────────────────────────────────────
def test_the_timeline_is_dated_by_the_ET_night_and_read_oldest_first(monkeypatch, tmp_path):
    _use_tmp_db(monkeypatch, tmp_path)
    # Written out of order on purpose: the READ orders it, not the insert sequence.
    ap.append_timeline("AAA", _row(110.0), fetched_at=NIGHT_2.timestamp(), pass_date="2026-09-02")
    ap.append_timeline("AAA", _row(100.0), fetched_at=NIGHT_1.timestamp(), pass_date="2026-09-01")
    tl = ap.read_timeline("aaa")   # the ticker is normalised on read as on write
    assert [r["pass_date"] for r in tl] == ["2026-09-01", "2026-09-02"]
    assert [r["fetched_at"] for r in tl] == sorted(r["fetched_at"] for r in tl)


def test_pass_date_is_the_ET_calendar_date_not_the_UTC_one():
    # 21:30 ET on Sep 1 is 01:30 UTC on Sep 2 — a UTC date would file it under the wrong night.
    late = datetime.datetime(2026, 9, 1, 21, 30, tzinfo=ap._ET)
    assert late.astimezone(datetime.timezone.utc).date().isoformat() == "2026-09-02"
    assert ap.pass_date_for(late) == "2026-09-01"
    # A naive anchor is taken as already ET, like _deadline_et.
    assert ap.pass_date_for(datetime.datetime(2026, 9, 1, 21, 30)) == "2026-09-01"


# ── a crash mid-write ────────────────────────────────────────────────────────
class _CrashBeforeTimelineCommit:
    """A connection whose COMMIT fails once a timeline INSERT has been executed on it —
    the append got as far as writing the row into its transaction and died before
    committing. Everything else passes straight through."""

    def __init__(self, conn):
        self._c = conn
        self._timeline_insert = False

    def execute(self, sql, *args):
        if re.match(r"\s*INSERT\b", sql, re.I) and "analyst_timeline" in sql:
            self._timeline_insert = True
        return self._c.execute(sql, *args)

    def commit(self):
        if self._timeline_insert:
            raise sqlite3.OperationalError("simulated crash between INSERT and COMMIT")
        return self._c.commit()

    def close(self):
        return self._c.close()

    def __getattr__(self, name):
        return getattr(self._c, name)


def test_a_crash_mid_write_leaves_the_previous_timeline_intact(monkeypatch, tmp_path):
    _use_tmp_db(monkeypatch, tmp_path)
    _night(monkeypatch, NIGHT_1, {"AAA": _row(100.0), "BBB": _row(50.0)})
    before = _raw_timeline(ap.get_db_path())
    assert len(before) == 2

    real_connect = ap.connect
    monkeypatch.setattr(ap, "connect", lambda: _CrashBeforeTimelineCommit(real_connect()))
    r2 = _night(monkeypatch, NIGHT_2, {"AAA": _row(110.0), "BBB": _row(55.0)})

    # The failure is COUNTED, never raised and never silent.
    assert r2["timeline_errors"] == 2 and r2["timeline_appended"] == 0
    # Night 1 is exactly as it was, and no half-written night-2 row exists.
    assert _raw_timeline(ap.get_db_path()) == before
    # The member path was untouched by the timeline's failure: the current row moved on.
    monkeypatch.setattr(ap, "connect", real_connect)
    cur = ap.read_analyst_fields(["AAA", "BBB"], now=NIGHT_2.timestamp())
    assert cur["AAA"]["pt_target"] == 110.0 and cur["BBB"]["pt_target"] == 55.0


def test_the_crash_fixture_can_tell_a_committed_row_from_a_rolled_back_one(monkeypatch, tmp_path):
    """Non-vacuity for the test above: without the crash, the same night DOES land."""
    _use_tmp_db(monkeypatch, tmp_path)
    _night(monkeypatch, NIGHT_1, {"AAA": _row(100.0)})
    _night(monkeypatch, NIGHT_2, {"AAA": _row(110.0)})
    assert len(_raw_timeline(ap.get_db_path())) == 2


# ── append-only by construction ──────────────────────────────────────────────
_REWRITE = re.compile(r"\b(DELETE|UPDATE|REPLACE|DROP|ALTER)\b", re.I)


def _sql_literals(path):
    """Every string constant in a Python file (adjacent literals arrive joined)."""
    tree = ast.parse(path.read_text(encoding="utf-8"))
    return [n.value for n in ast.walk(tree)
            if isinstance(n, ast.Constant) and isinstance(n.value, str)]


def _timeline_writers():
    """Python files under api/, tools/, scripts/ that name the timeline table in code."""
    out = []
    for root in ("api", "tools", "scripts"):
        for p in (REPO / root).rglob("*.py"):
            try:
                text = p.read_text(encoding="utf-8")
            except (UnicodeDecodeError, OSError):
                continue
            if "analyst_timeline" in text:
                out.append(p)
    return out


def test_no_code_path_updates_replaces_or_deletes_a_timeline_row():
    files = _timeline_writers()
    assert REPO / "api/services/screener/analyst_pass.py" in files   # non-vacuity: it can see the writer
    offenders = []
    saw_insert = False
    for p in files:
        for lit in _sql_literals(p):
            if "analyst_timeline" not in lit:
                continue
            if re.search(r"\bINSERT\s+INTO\s+analyst_timeline\b", lit, re.I):
                saw_insert = True
            if _REWRITE.search(lit):
                offenders.append(f"{p.relative_to(REPO)}: {lit.strip()[:120]}")
    assert saw_insert, "the scan found no INSERT into the timeline, so it is not looking at the writer"
    assert not offenders, "a SQL statement rewrites or deletes timeline rows:\n" + "\n".join(offenders)


def test_the_rewrite_scan_would_see_a_replace_if_one_were_there():
    """Control: the same pattern fires on the module's own current-state REPLACE."""
    lits = _sql_literals(REPO / "api/services/screener/analyst_pass.py")
    assert any("analyst_rows" in s and _REWRITE.search(s) for s in lits)


def test_the_retention_floor_is_stated_in_code_and_is_years_not_days():
    assert isinstance(ap.RETENTION_FLOOR_DAYS, int)
    assert ap.RETENTION_FLOOR_DAYS >= 5 * 365


# ── off-box backup ───────────────────────────────────────────────────────────
def test_the_timeline_store_is_registered_for_backup_through_its_own_module(monkeypatch, tmp_path):
    specs = [s for s in sb.STORES if s.module == ap.__name__]
    assert len(specs) == 1, "the analyst store must be registered exactly once"
    spec = specs[0]
    assert spec.klass == sb.CLASS_RETAINED
    monkeypatch.setenv("SCREENER_ANALYST_DB_PATH", str(tmp_path / "moved.db"))
    # The registry reads the path from the module at run time, so a moved store moves its backup.
    assert sb.resolve_path(spec.name) == ap.get_db_path() == str(tmp_path / "moved.db")


def test_the_registered_backup_carries_the_timeline(monkeypatch, tmp_path):
    _use_tmp_db(monkeypatch, tmp_path)
    _night(monkeypatch, NIGHT_1, {"AAA": _row(100.0), "BBB": _row(50.0)})
    _night(monkeypatch, NIGHT_2, {"AAA": _row(110.0), "BBB": _row(50.0)})
    (name,) = [s.name for s in sb.STORES if s.module == ap.__name__]
    work = tmp_path / "work"
    work.mkdir()
    art = sb.build_artifacts(name, sb.resolve_path(name), str(work), NIGHT_2)
    assert art["manifest"]["tables"]["analyst_timeline"] == 4


# ── what changed (FB-A4-01's acceptance test) ────────────────────────────────
def test_two_identical_snapshots_are_no_revision_and_a_moved_target_is_one(monkeypatch, tmp_path):
    _use_tmp_db(monkeypatch, tmp_path)
    _night(monkeypatch, NIGHT_1, {"AAA": _row(100.0), "BBB": _row(50.0)})
    _night(monkeypatch, NIGHT_2, {"AAA": _row(110.0, up=1), "BBB": _row(50.0)})

    assert ap.revisions(ap.read_timeline("BBB")) == []          # observed twice, unchanged
    (rev,) = ap.revisions(ap.read_timeline("AAA"))
    assert (rev["from_date"], rev["to_date"]) == ("2026-09-01", "2026-09-02")
    assert rev["changes"] == {"pt_target": (100.0, 110.0), "upgrades_30d": (0, 1)}


def test_a_value_appearing_from_null_is_a_revision():
    tl = [{"pass_date": "2026-09-01", "fetched_at": 1, **_row(None)},
          {"pass_date": "2026-09-02", "fetched_at": 2, **_row(42.0)}]
    assert ap.revisions(tl)[0]["changes"] == {"pt_target": (None, 42.0)}
