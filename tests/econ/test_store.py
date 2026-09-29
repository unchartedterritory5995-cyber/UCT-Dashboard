import sqlite3
import time

import pytest

from api.services.econ import store as st
from api.services.econ.model import PitClass

T0 = 1_780_000_000
DAY = 86_400


@pytest.fixture
def s(tmp_path):
    db = st.connect(str(tmp_path / "econ.db"))
    yield db
    db.close()


def row(ps, pe, v, avail, flag="", pit="L", method="rule", acq=None, inputs=None):
    return (ps, pe, v, flag, avail, method, pit, acq, inputs)


def rel(s, key, kind="live"):
    return s.upsert_release(key, "bea_gdp", kind, None, None)


# ── schema / migrations ─────────────────────────────────────────────────────

def test_wal_and_version(s):
    assert s.conn.execute("PRAGMA journal_mode").fetchone()[0] == "wal"
    assert s.conn.execute("PRAGMA user_version").fetchone()[0] == st.SCHEMA_VERSION


def test_refuses_newer_db(tmp_path):
    p = str(tmp_path / "n.db")
    st.connect(p).close()
    c = sqlite3.connect(p)
    c.execute(f"PRAGMA user_version = {st.SCHEMA_VERSION + 1}")
    c.commit(); c.close()
    with pytest.raises(st.SchemaTooNew):
        st.connect(p)
    with pytest.raises(st.SchemaTooNew):
        st.connect(p, readonly=True)


def test_reopen_is_noop(tmp_path):
    p = str(tmp_path / "r.db")
    a = st.connect(p)
    r = rel(a, "k")
    a.write_observations("USGDP", r, [row("2026-04-01", "2026-06-30", 2.4, T0)])
    a.close()
    b = st.connect(p)
    assert b.latest_point("USGDP").value == 2.4
    b.close()


# ── releases ────────────────────────────────────────────────────────────────

def test_upsert_release_idempotent(s):
    a = s.upsert_release("bls:cpi:2026-08", "bls_cpi", "live", T0, None)
    b = s.upsert_release("bls:cpi:2026-08", "bls_cpi", "live", T0 + 5, None)
    assert a == b
    assert s.get_release(a)["scheduled_at"] == T0      # first writer wins
    assert s.upsert_release("other", None, "backfill") != a
    with pytest.raises(ValueError):
        s.upsert_release("bad", None, "nonsense")


# ── (1) append-only: a revision never overwrites ────────────────────────────

def test_revision_appends_and_db_refuses_update_delete(s):
    r1, r2 = rel(s, "adv"), rel(s, "second")
    s.write_observations("USGDP", r1, [row("2026-04-01", "2026-06-30", 2.4, T0)])
    w = s.write_observations("USGDP", r2, [row("2026-04-01", "2026-06-30", 2.6, T0 + 30 * DAY)])
    assert w == st.WriteStats(0, 0, 1)
    vs = s.versions("USGDP", "2026-04-01")
    assert [v.value for v in vs] == [2.4, 2.6]
    with pytest.raises(sqlite3.DatabaseError, match="append-only"):
        s.conn.execute("UPDATE observation SET value=9 WHERE series_id='USGDP'")
    with pytest.raises(sqlite3.DatabaseError, match="append-only"):
        s.conn.execute("DELETE FROM observation")
    # INSERT OR REPLACE deletes under the hood -- recursive_triggers makes it fire too
    with pytest.raises(sqlite3.DatabaseError, match="append-only"):
        s.conn.execute(
            "INSERT OR REPLACE INTO observation(series_id, period_start, release_id, period_end, value,"
            " flag, available_at, available_method, pit_class, ingested_at)"
            " VALUES ('USGDP','2026-04-01',?,'2026-06-30',99,'',1,'rule','L',1)", (r1,))
    assert [v.value for v in s.versions("USGDP", "2026-04-01")] == [2.4, 2.6]


# ── (2)+(3) latest / as-of / first availability: GDP 2.4 -> 2.6 -> 2.7 ─────

def _gdp(s):
    t1, t2, t3 = T0, T0 + 30 * DAY, T0 + 60 * DAY
    for key, v, t in (("adv", 2.4, t1), ("second", 2.6, t2), ("third", 2.7, t3)):
        s.write_observations("USGDP", rel(s, key), [row("2026-04-01", "2026-06-30", v, t)])
    return t1, t2, t3


def test_gdp_vintages_asof(s):
    t1, t2, t3 = _gdp(s)
    latest = s.latest_rows("USGDP")
    assert len(latest) == 1
    L = latest[0]
    assert (L.value, L.available_at, L.first_available_at, L.n_versions) == (2.7, t3, t1, 3)
    assert s.latest_rows("USGDP", asof=t1 - 1) == []                     # before first availability
    assert s.latest_rows("USGDP", asof=t1)[0].value == 2.4
    assert s.latest_rows("USGDP", asof=t2 - 1)[0].value == 2.4           # before the revision
    a2 = s.latest_rows("USGDP", asof=t2 + 1)[0]
    assert (a2.value, a2.first_available_at) == (2.6, t1)
    assert s.latest_rows("USGDP", asof=t3)[0].value == 2.7
    assert s.latest_point("USGDP", asof=t2).value == 2.6
    assert s.latest_point("USGDP", asof=t1 - 1) is None
    assert [r.value for r in s.since("USGDP", t1)] == [2.6, 2.7]


def test_future_release_invisible_to_asof_now(s):
    now = int(time.time())
    r = rel(s, "k")
    s.write_observations("USCPI", r, [row("2026-07-01", "2026-07-31", 320.0, now - DAY),
                                      row("2026-08-01", "2026-08-31", 321.0, now + 10 * DAY)])
    rows = s.latest_rows("USCPI", asof=now)
    assert [x.period_start for x in rows] == ["2026-07-01"]
    assert s.latest_point("USCPI", asof=now).period_start == "2026-07-01"
    assert s.period_bounds("USCPI", asof=now) == {"oldest": "2026-07-01", "newest": "2026-07-01", "count": 1}
    assert s.period_bounds("USCPI")["count"] == 2


def test_tie_on_available_at_breaks_by_release_id(s):
    ra, rb = rel(s, "a"), rel(s, "b")
    s.write_observations("X", ra, [row("2026-01-01", "2026-01-31", 1.0, T0)])
    s.write_observations("X", rb, [row("2026-01-01", "2026-01-31", 2.0, T0)])
    assert s.latest_rows("X")[0].value == 2.0


def test_start_end_filter(s):
    r = rel(s, "k")
    s.write_observations("X", r, [row(f"2026-{m:02d}-01", f"2026-{m:02d}-28", m, T0) for m in range(1, 7)])
    assert [x.period_start for x in s.latest_rows("X", start="2026-02-01", end="2026-04-01")] == \
        ["2026-02-01", "2026-03-01", "2026-04-01"]


# ── (5) idempotence ─────────────────────────────────────────────────────────

def test_idempotent_double_write(s):
    r = rel(s, "cpi-aug")
    rows = [row("2026-07-01", "2026-07-31", 320.0, T0), row("2026-08-01", "2026-08-31", None, T0, flag="na")]
    assert s.write_observations("USCPI", r, rows) == st.WriteStats(2, 0, 0)
    assert s.write_observations("USCPI", rel(s, "cpi-aug"), rows) == st.WriteStats(0, 2, 0)
    # a later release re-seeing identical values is a no-op too
    assert s.write_observations("USCPI", rel(s, "cpi-sep"), rows) == st.WriteStats(0, 2, 0)
    assert s.conn.execute("SELECT COUNT(*) FROM observation").fetchone()[0] == 2


def test_none_vs_value_and_flag_change_are_new_vintages(s):
    r1, r2, r3 = rel(s, "1"), rel(s, "2"), rel(s, "3")
    s.write_observations("X", r1, [row("2026-01-01", "2026-01-31", None, T0)])
    assert s.write_observations("X", r2, [row("2026-01-01", "2026-01-31", 0.0, T0 + 1)]).revised == 1
    assert s.write_observations("X", r3, [row("2026-01-01", "2026-01-31", 0.0, T0 + 2, flag="p")]).revised == 1
    assert len(s.versions("X", "2026-01-01")) == 3


def test_replay_of_older_release_after_revision_is_noop(s):
    r1, r2 = rel(s, "1"), rel(s, "2")
    s.write_observations("X", r1, [row("2026-01-01", "2026-01-31", 1.0, T0)])
    s.write_observations("X", r2, [row("2026-01-01", "2026-01-31", 2.0, T0 + 1)])
    assert s.write_observations("X", r1, [row("2026-01-01", "2026-01-31", 1.0, T0)]) == st.WriteStats(0, 1, 0)
    with pytest.raises(st.StoreConflict):
        s.write_observations("X", r1, [row("2026-01-01", "2026-01-31", 5.0, T0)])


def test_write_is_transactional(s):
    r = rel(s, "k")
    with pytest.raises(ValueError):
        s.write_observations("X", r, [row("2026-01-01", "2026-01-31", 1.0, T0),
                                      row("2026-02-01", "2026-02-28", float("nan"), T0)])
    assert s.latest_rows("X") == []


# ── state / calendar / validators / leases / events / acquisitions ─────────

def test_state_merge(s):
    s.put_state("USCPI", state="UNINITIALIZED")
    s.put_state("USCPI", latest_period="2026-08-01", failures=2)
    g = s.get_state("USCPI")
    assert (g["state"], g["latest_period"], g["failures"]) == ("UNINITIALIZED", "2026-08-01", 2)
    with pytest.raises(ValueError):
        s.put_state("USCPI", bogus=1)
    with pytest.raises(ValueError):
        s.put_state("NEW", failures=1)


def test_calendar_supersession(s):
    a = s.put_event("bls_cpi", "2026-08", "2026-09-10", sched_time="08:30", precision="exact",
                    source="authoritative_page", fetched_at=T0)
    assert s.put_event("bls_cpi", "2026-08", "2026-09-10", sched_time="08:30", precision="exact",
                       source="authoritative_page", fetched_at=T0 + 1) == a
    b = s.put_event("bls_cpi", "2026-08", "2026-09-11", sched_time="08:30", precision="exact",
                    source="authoritative_page", fetched_at=T0 + 2)
    assert b != a
    assert s.get_event(a)["superseded_at"] == T0 + 2
    assert [e["event_id"] for e in s.events("bls_cpi")] == [b]
    assert len(s.events("bls_cpi", include_superseded=True)) == 2
    assert s.next_event("bls_cpi", "2026-09-01")["sched_date"] == "2026-09-11"
    s.delete_event(b)
    assert s.events("bls_cpi") == []


def test_http_validator(s):
    assert s.get_validator("k") is None
    s.put_validator("k", '"e1"', None)
    s.put_validator("k", '"e2"', "Tue")
    v = s.get_validator("k")
    assert (v["etag"], v["last_modified"]) == ('"e2"', "Tue")


def test_lease_exclusive_and_expiry(s):
    assert s.acquire_lease("ingest", "w1", 60, now=T0)
    assert not s.acquire_lease("ingest", "w2", 60, now=T0 + 10)
    assert s.acquire_lease("ingest", "w1", 60, now=T0 + 10)         # re-entrant extend
    assert s.renew_lease("ingest", "w1", 60, now=T0 + 20)
    assert not s.renew_lease("ingest", "w2", 60, now=T0 + 20)
    assert s.lease_holder("ingest", now=T0 + 30) == "w1"
    assert s.acquire_lease("ingest", "w2", 60, now=T0 + 81)          # expired -> taken over
    assert not s.renew_lease("ingest", "w1", 60, now=T0 + 82)
    assert not s.release_lease("ingest", "w1")
    assert s.release_lease("ingest", "w2")
    assert s.lease_holder("ingest", now=T0 + 83) is None


def test_lease_two_connections(tmp_path):
    p = str(tmp_path / "l.db")
    a, b = st.connect(p), st.connect(p)
    assert a.acquire_lease("x", "A", 60, now=T0)
    assert not b.acquire_lease("x", "B", 60, now=T0 + 1)
    a.close(); b.close()


def test_validation_events_and_acquisitions(s):
    acq = s.record_acquisition("bls", "bls:v2:CUSR0000SA0:2016-2026", started_at=T0)
    s.finish_acquisition(acq, outcome="error", http_status=500, error="x" * 5000, finished_at=T0 + 3)
    a = s.get_acquisition(acq)
    assert a["outcome"] == "error" and len(a["error"]) <= 2000 and a["finished_at"] == T0 + 3
    assert s.list_acquisitions("bls")[0]["acq_id"] == acq
    s.add_validation_event("USCPI", "reject", ["scale: 1000x"], acq_id=acq, at=T0)
    ev = s.validation_events("USCPI")
    assert ev[0]["reasons"] == ["scale: 1000x"] and ev[0]["acq_id"] == acq


# ── timings (not asserted tight; printed with -s) ───────────────────────────

def test_perf_100k_write_and_latest_20k(s):
    r = rel(s, "bulk")
    rows = []
    for i in range(100_000):
        rows.append(row(f"p{i:06d}", f"p{i:06d}", float(i), T0 + i, pit=PitClass.LATEST_BACKFILL.value))
    t = time.perf_counter()
    w = s.write_observations("BIG", r, rows)
    tw = time.perf_counter() - t
    assert w.inserted == 100_000
    r2 = rel(s, "rev")
    s.write_observations("MID", r, [row(f"p{i:05d}", f"p{i:05d}", float(i), T0) for i in range(20_000)])
    s.write_observations("MID", r2, [row(f"p{i:05d}", f"p{i:05d}", float(i) + .5, T0 + 9) for i in range(0, 20_000, 2)])
    t = time.perf_counter()
    L = s.latest_rows("MID")
    tq = time.perf_counter() - t
    assert len(L) == 20_000 and L[0].value == 0.5 and L[1].value == 1.0
    print(f"\nPERF write 100k rows: {tw:.2f}s; latest_rows over 20k periods/30k rows: {tq*1000:.0f} ms")
    assert tw < 30 and tq < 5
