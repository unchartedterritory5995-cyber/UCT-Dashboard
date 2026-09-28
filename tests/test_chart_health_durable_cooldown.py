"""TERM-016 / FB-OBS-05 - the page cooldown survives a deploy, and a second pod.

`chart_health_alerts` held both "we already told you" stamps (`_discord_last`,
`_email_last`) in module dicts. A redeploy is a fresh module, so a STANDING critical
re-paged on the first cycle after every deploy - fourteen pages for one fault on a
day with fourteen deploys in it (ARCH-07 section 2.5). The spec's acceptance:

  (a) a standing critical does NOT re-page across a simulated deploy, seen red first;
  (b) the cooldown survives in a table, asserted by reading the TABLE, not the module.

HOW A "DEPLOY" AND A "SECOND POD" ARE SIMULATED. `_boot_pod` executes the module's
source into a brand-new module object - fresh `_throttle`, fresh `_discord_last`,
fresh `_email_last`, fresh deque - exactly what a new process gets. The only thing
two pods share is the store path, which is what production shares. Resetting named
dicts by hand would miss the next in-memory stamp somebody adds; a fresh module
cannot.

THE CLOCK IS INJECTED, NEVER READ. Each pod's `time` attribute is a `_Clock`, the
same stand-in `test_chart_health_escalation.py` uses; no assertion depends on the
wall clock.

FAIL OPEN. A broken cooldown must never silence a critical: an unreadable or corrupt
store PAGES. It degrades to the pre-TERM-016 per-process cooldown, which still bounds
a flood inside one process.
"""
from __future__ import annotations

import importlib.util
import itertools
import sqlite3
import threading

import pytest

from api.services import alert_routing as ar
from api.services import chart_health_alerts as cha

CHA_PATH = cha.__file__
#: The real product key (`bars_continuous_audit.py`), so a failure names a pipeline.
KEY = "bars_store_unhealthy"
T0 = 1_700_000_000
_POD_IDS = itertools.count()


class _Clock:
    def __init__(self, t: int = T0):
        self.t = t

    def time(self) -> float:
        return float(self.t)


def _boot_pod(name, clock, pages, emails=None):
    """A new process: the module's source executed into a fresh module object."""
    spec = importlib.util.spec_from_file_location(
        f"_cha_pod_{name}_{next(_POD_IDS)}", CHA_PATH)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    assert mod is not cha and mod._discord_last == {} and mod._email_last == {}
    mod.time = clock
    mod._page_discord = lambda key, message: pages.append((name, key))
    mod._email_second_transport = (
        lambda key, message, recipients: (emails if emails is not None else []).append(
            (name, key, tuple(recipients))))
    return mod


@pytest.fixture
def store(tmp_path, monkeypatch):
    path = tmp_path / "chart_health_alerts.db"
    monkeypatch.setenv("CHART_HEALTH_COOLDOWN_DB_PATH", str(path))
    return path


@pytest.fixture(autouse=True)
def discord_only(monkeypatch):
    """A configured primary, no second transport - unless a test says otherwise."""
    for name in (ar.OPS_WEBHOOK_ENV, ar.BUSINESS_WEBHOOK_ENV, ar.OPS_EMAIL_ENV,
                 ar.ROUTING_FLAG_ENV):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv(ar.ADMIN_WEBHOOK_ENV, "https://example.invalid/hook")
    monkeypatch.setenv("CHART_HEALTH_DISCORD_ENABLED", "1")


def _rows(path):
    """(b): the TABLE's answer, read with sqlite3 - never through the module."""
    conn = sqlite3.connect(str(path))
    try:
        return sorted(conn.execute(
            "SELECT channel, alert_key, last_sent_at FROM alert_cooldown").fetchall())
    finally:
        conn.close()


# == (a) the defect ==========================================================

def test_a_standing_critical_does_not_repage_across_a_simulated_deploy(store):
    clock, pages = _Clock(), []
    pod1 = _boot_pod("pod1", clock, pages)
    assert pod1.emit(KEY, "critical", "bars store answered nothing") is True
    assert pages == [("pod1", KEY)]

    # Deploy: pod1 is gone, pod2 boots with empty module state, 5 minutes later.
    clock.t += 300
    pod2 = _boot_pod("pod2", clock, pages)
    assert pod2.emit(KEY, "critical", "still broken") is True, (
        "the deque/throttle is per-process and pod2's is empty - the alert must still "
        "QUEUE on the new pod; only the PAGE is suppressed")
    assert pages == [("pod1", KEY)], (
        "a standing critical re-paged on the first cycle after a deploy - the cooldown "
        f"lived in the dead process. pages={pages}")


def test_fourteen_deploys_inside_one_cooldown_are_one_page(store):
    """ARCH-07 section 2.5's day: fourteen deploys. One fault, one page."""
    clock, pages = _Clock(), []
    for n in range(14):
        pod = _boot_pod(f"pod{n}", clock, pages)
        pod.emit(KEY, "critical", f"cycle after deploy {n}")
        clock.t += 120                                  # 14 x 2 min < 30 min cooldown
    assert pages == [("pod0", KEY)], f"{len(pages)} pages for one standing fault"


def test_CONTROL_the_durable_cooldown_still_EXPIRES(store):
    """Durable must not mean permanent: past the cooldown a new pod pages again."""
    clock, pages = _Clock(), []
    _boot_pod("pod1", clock, pages).emit(KEY, "critical", "m")
    clock.t += cha._DISCORD_COOLDOWN_SEC
    _boot_pod("pod2", clock, pages).emit(KEY, "critical", "m")
    assert pages == [("pod1", KEY), ("pod2", KEY)]


# == (b) the state is in a table =============================================

def test_the_cooldown_survives_in_a_TABLE_read_without_the_module(store):
    clock, pages = _Clock(), []
    _boot_pod("pod1", clock, pages).emit(KEY, "critical", "m")
    assert store.exists(), "no store file was written - the cooldown is still a dict"
    assert _rows(store) == [("discord", KEY, T0)]

    # A suppressed attempt does NOT advance the stamp (the window is measured from
    # the page, not from the last attempt - same as the dict it replaces).
    clock.t += 700
    _boot_pod("pod2", clock, pages).emit(KEY, "critical", "m")
    assert _rows(store) == [("discord", KEY, T0)]


# == two pods, one store =====================================================

def test_two_live_pods_sharing_the_store_do_not_double_page(store):
    clock, pages = _Clock(), []
    pod_a = _boot_pod("a", clock, pages)
    pod_b = _boot_pod("b", clock, pages)
    assert pod_a.emit(KEY, "critical", "m") is True
    assert pod_b.emit(KEY, "critical", "m") is True     # both QUEUE ...
    assert len(pages) == 1, f"a second instance doubled the page: {pages}"  # ... one PAGE


def test_two_pods_RACING_on_the_same_instant_claim_the_page_once(store):
    """The claim is one atomic statement, so a check-then-write race cannot split it."""
    clock, pages = _Clock(), []
    pods = [_boot_pod("a", clock, pages), _boot_pod("b", clock, pages)]
    workers = 8
    barrier = threading.Barrier(workers)
    results: list[bool] = []
    lock = threading.Lock()

    def claim(pod):
        barrier.wait()
        fired = pod._should_page_discord("race_key", "critical", T0,
                                         webhook_present=True, enabled=True)
        with lock:
            results.append(fired)

    threads = [threading.Thread(target=claim, args=(pods[i % 2],)) for i in range(workers)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(timeout=30)
    assert len(results) == workers
    assert results.count(True) == 1, f"{results.count(True)} pods claimed one page"


# == fail OPEN ===============================================================

def test_a_CORRUPT_store_fails_open_to_paging(store):
    """A broken cooldown must never silence a critical."""
    store.write_bytes(b"this is not a sqlite database" * 64)
    clock, pages = _Clock(), []
    assert _boot_pod("pod1", clock, pages).emit(KEY, "critical", "m") is True
    assert pages == [("pod1", KEY)], "a corrupt cooldown store SILENCED a critical page"


def test_an_UNOPENABLE_store_fails_open_to_paging(store):
    store.mkdir()                        # the path is a directory: sqlite cannot open it
    clock, pages = _Clock(), []
    _boot_pod("pod1", clock, pages).emit(KEY, "critical", "m")
    assert pages == [("pod1", KEY)], "an unopenable cooldown store SILENCED a page"


def test_a_store_that_breaks_AFTER_a_page_still_fails_open_on_the_next_pod(store):
    """The store held a fresh stamp and then became unreadable. It cannot be read, so
    it cannot be trusted to say "already told" - the new pod pages."""
    clock, pages = _Clock(), []
    _boot_pod("pod1", clock, pages).emit(KEY, "critical", "m")
    store.write_bytes(b"\x00garbage" * 512)
    clock.t += 60
    _boot_pod("pod2", clock, pages).emit(KEY, "critical", "m")
    assert pages == [("pod1", KEY), ("pod2", KEY)]


def test_CONTROL_failing_open_is_not_a_flood_inside_one_process(store):
    """Degraded, the gate is the pre-TERM-016 per-process cooldown - still bounded."""
    store.write_bytes(b"not a database" * 64)
    clock, pages = _Clock(), []
    pod = _boot_pod("pod1", clock, pages)
    pod.emit(KEY, "critical", "m")
    clock.t += cha._THROTTLE_SEC + 1                    # past the deque throttle
    pod.emit(KEY, "critical", "m")
    assert pages == [("pod1", KEY)]
    clock.t += cha._DISCORD_COOLDOWN_SEC
    pod.emit(KEY, "critical", "m")
    assert pages == [("pod1", KEY), ("pod1", KEY)]


# == the escapes the current code gives a critical ===========================

def test_a_warning_still_cannot_swallow_the_critical_page_across_a_deploy(store):
    """The per-(key, severity) throttle's escape is untouched: a warning on pod1, then
    the escalation to critical on a fresh pod, pages."""
    clock, pages = _Clock(), []
    _boot_pod("pod1", clock, pages).emit(KEY, "warning", "degrading")
    clock.t += 60
    _boot_pod("pod2", clock, pages).emit(KEY, "critical", "escalated")
    assert pages == [("pod2", KEY)]


def test_the_SECOND_transport_has_its_own_durable_budget(store, monkeypatch):
    """A spent Discord cooldown must not spend the email leg - in the table too."""
    clock, pages, emails = _Clock(), [], []
    _boot_pod("pod1", clock, pages, emails).emit(KEY, "critical", "m")   # discord only
    assert pages == [("pod1", KEY)] and emails == []

    monkeypatch.setenv(ar.OPS_EMAIL_ENV, "ops-pager@uct-ops.test")
    clock.t += 60
    _boot_pod("pod2", clock, pages, emails).emit(KEY, "critical", "m")
    assert pages == [("pod1", KEY)], "discord re-paged across the deploy"
    assert emails == [("pod2", KEY, ("ops-pager@uct-ops.test",))], (
        "the Discord leg's durable stamp silenced the SECOND transport")
    assert _rows(store) == [("discord", KEY, T0), ("email", KEY, T0 + 60)]

    clock.t += 60
    _boot_pod("pod3", clock, pages, emails).emit(KEY, "critical", "m")
    assert len(emails) == 1, "the email leg re-sent across a deploy"


def test_the_SECOND_transport_with_the_primary_BLANK_still_sends_once_across_deploys(
        store, monkeypatch):
    monkeypatch.setenv(ar.ADMIN_WEBHOOK_ENV, "")
    monkeypatch.setenv(ar.OPS_EMAIL_ENV, "ops-pager@uct-ops.test")
    clock, pages, emails = _Clock(), [], []
    _boot_pod("pod1", clock, pages, emails).emit(KEY, "critical", "m")
    clock.t += 300
    _boot_pod("pod2", clock, pages, emails).emit(KEY, "critical", "m")
    assert pages == []
    assert emails == [("pod1", KEY, ("ops-pager@uct-ops.test",))]


def test_clear_empties_the_durable_table_too(store):
    """`clear()` is the test-isolation helper; a stamp it left behind would make the
    next test's critical read as already-paged and pass for the wrong reason."""
    clock, pages = _Clock(), []
    pod = _boot_pod("pod1", clock, pages)
    pod.emit(KEY, "critical", "m")
    assert _rows(store)
    pod.clear()
    assert _rows(store) == []
