"""The flow CSV version must be a CHANGE signal, not a clock.

_current_version() gates a 60s time bucket on the data actually having changed.
The asymmetry that shapes every test here: a false "changed" costs one needless
rebuild, a false "unchanged" serves STALE DATA to every user until something
else happens to move the version. So the gate must fail OPEN everywhere.
"""
import time
import pytest

from api import flow_router


@pytest.fixture(autouse=True)
def _reset_gate():
    """Each test starts from a cold gate and leaves one behind."""
    def clear():
        flow_router._SIG_LAST = None
        flow_router._SIG_VERSION = None
        flow_router._SIG_PROBED_AT = 0.0
        flow_router._FORCE_BUMP_OFFSET = 0
    clear()
    yield
    clear()


class _FakeDB:
    """Stands in for FlowDB; `sig` is what the next probe will observe."""
    def __init__(self, sig=(100, 100)):
        self.sig = sig
        self.probes = 0

    def data_signature(self):
        self.probes += 1
        if isinstance(self.sig, Exception):
            raise self.sig
        return self.sig


@pytest.fixture
def fake_db(monkeypatch):
    d = _FakeDB()
    monkeypatch.setattr(flow_router, "db", d)
    return d


def _advance(monkeypatch, seconds):
    """Move BOTH clocks: wall clock drives the bucket, monotonic the probe window."""
    t0_wall, t0_mono = time.time(), time.monotonic()
    monkeypatch.setattr(time, "time", lambda: t0_wall + seconds)
    monkeypatch.setattr(time, "monotonic", lambda: t0_mono + seconds)


# ── the actual bug being fixed ──────────────────────────────────────────────

def test_version_is_frozen_while_data_is_unchanged(fake_db, monkeypatch):
    """A quiet tape must NOT keep minting new versions.

    This is the whole point: before the gate, the version advanced every 60s
    whether or not a row moved, and clients treat a new version as "refetch" —
    so every user paid a full multi-MB CSV download per minute for byte-
    identical data (all night, all weekend, and through every quiet stretch).
    """
    v0 = flow_router._current_version()
    for minutes in (2, 5, 30, 120):
        _advance(monkeypatch, minutes * 60)
        assert flow_router._current_version() == v0, (
            f"version moved after {minutes}min with unchanged data — "
            "every client would refetch the whole CSV for nothing"
        )


def test_version_advances_as_soon_as_rows_change(fake_db, monkeypatch):
    """The freeze must never outlive the data. Stale is the unacceptable failure."""
    v0 = flow_router._current_version()
    fake_db.sig = (101, 101)                  # an insert landed
    _advance(monkeypatch, 61)                 # past probe window + bucket
    v1 = flow_router._current_version()
    assert v1 != v0
    assert v1 > v0, "version must be monotonic — Cloudflare keys its cache on it"


def test_deletes_move_the_version_even_though_max_rowid_does_not(fake_db, monkeypatch):
    """The prune job deletes OLD rows, so MAX(rowid) is unchanged.

    Gating on MAX(rowid) alone would freeze the version through a prune and
    serve deleted rows indefinitely. COUNT(*) is in the signature for exactly
    this and nothing else.
    """
    v0 = flow_router._current_version()
    fake_db.sig = (100, 90)                   # same max rowid, 10 rows pruned
    _advance(monkeypatch, 61)
    assert flow_router._current_version() != v0, (
        "a prune left the version frozen — deleted rows would be served on"
    )


# ── fail-open paths ─────────────────────────────────────────────────────────

def test_probe_failure_fails_open(fake_db, monkeypatch):
    """An unreadable DB must never freeze the version."""
    v0 = flow_router._current_version()
    fake_db.sig = RuntimeError("database is locked")
    _advance(monkeypatch, 61)
    v1 = flow_router._current_version()
    assert v1 != v0, "a failed probe froze the version — that serves stale data"

    # ...and it must not have latched a bogus state that freezes later calls.
    _advance(monkeypatch, 122)
    assert flow_router._current_version() != v1


def test_recovery_after_probe_failure_does_not_freeze_on_a_stale_signature(fake_db, monkeypatch):
    """After a failure the gate must re-adopt, not resume an old signature."""
    flow_router._current_version()
    fake_db.sig = RuntimeError("boom")
    _advance(monkeypatch, 61)
    flow_router._current_version()
    fake_db.sig = (100, 100)                  # same data as the very first call
    _advance(monkeypatch, 122)
    v = flow_router._current_version()
    _advance(monkeypatch, 183)
    assert flow_router._current_version() == v, "should re-freeze cleanly once readable"


# ── the coupling that would silently break admin mutations ──────────────────

def test_bump_data_version_releases_the_freeze(fake_db, monkeypatch):
    """In-place updates leave the signature IDENTICAL.

    apply-cancel-patches / rebuild-color / cluster-filter mutate Color, Side,
    source on existing rows — no insert, no delete, so (max_rowid, count) does
    not move. Without an explicit release the gate would hold the old version
    and swallow the bump entirely, which is precisely the bug bump_data_version
    was written to fix.
    """
    v0 = flow_router._current_version()
    assert fake_db.sig == (100, 100)
    _advance(monkeypatch, 61)
    v1 = flow_router.bump_data_version()      # signature deliberately unchanged
    assert v1 != v0, "bump_data_version was swallowed by the change gate"
    assert v1 > v0


def test_bump_survives_a_subsequent_frozen_read(fake_db, monkeypatch):
    """The bumped version must stick, not fall back to the pre-bump one."""
    flow_router._current_version()
    _advance(monkeypatch, 61)
    bumped = flow_router.bump_data_version()
    _advance(monkeypatch, 63)
    assert flow_router._current_version() == bumped


# ── cost ────────────────────────────────────────────────────────────────────

def test_probe_is_rate_limited_regardless_of_request_volume(fake_db, monkeypatch):
    """200 users polling must not mean 200 DB probes."""
    flow_router._current_version()
    assert fake_db.probes == 1
    for _ in range(200):
        flow_router._current_version()
    assert fake_db.probes == 1, (
        f"{fake_db.probes} probes for 201 calls — the probe window is not holding"
    )
    _advance(monkeypatch, flow_router._SIG_PROBE_SEC + 0.1)
    flow_router._current_version()
    assert fake_db.probes == 2


def test_cold_gate_does_not_serve_a_frozen_version_before_it_has_probed(fake_db):
    """First call must probe rather than reuse an unset version."""
    assert fake_db.probes == 0
    flow_router._current_version()
    assert fake_db.probes == 1
