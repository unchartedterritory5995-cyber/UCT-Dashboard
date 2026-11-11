"""Rails for ``api/services/declared_splits.py``: the declared split lists the RS
batch jobs hand to the one split detector (owner decisions N4 / N5, 2026-11-07).

Every provider, cache and brake is injected: no network, no shared module state.
"""
from __future__ import annotations

import sqlite3

import pytest

from api.services import declared_splits as ds

DAY = 86400.0


class Provider:
    def __init__(self, answers=None):
        self.answers = dict(answers or {})
        self.asked = []

    def __call__(self, ticker):
        self.asked.append(ticker)
        if ticker in self.answers:
            return {"ipo": None, "splits": self.answers[ticker]}
        raise RuntimeError("refused")


class Brake:
    def __init__(self, open_=True):
        self.open = open_
        self.failures = 0
        self.successes = 0

    def gate(self):
        return (lambda: self.open, self._fail, self._ok)

    def _fail(self):
        self.failures += 1

    def _ok(self):
        self.successes += 1


def _reader(conn=None, *, answers=None, cache=None, budget=10, now=1_000_000.0, brake=None, **kw):
    prov = Provider(answers)
    cache = {} if cache is None else cache
    written = {}
    brake = brake or Brake()
    r = ds.DeclaredSplits(conn, budget=budget, fetch=prov, cache_get=cache.get,
                          cache_set=lambda t, meta: written.__setitem__(t, meta), gate=brake.gate(),
                          now=lambda: now, sleep=lambda s: None, ttl=7 * DAY, **kw)
    return r, prov, written, brake


def test_a_fresh_stored_answer_wins_and_the_provider_is_not_asked(tmp_path):
    conn = sqlite3.connect(str(tmp_path / "s.db"))
    first, prov, written, _ = _reader(conn, answers={"DD": [("2026-06-18", 0.3333)]})
    assert first("dd") == [("2026-06-18", 0.3333)] and prov.asked == ["DD"]
    assert written["DD"]["splits"] == [("2026-06-18", 0.3333)], "the answer also warms the shared cache"
    again, prov2, _, _ = _reader(conn, now=1_000_000.0 + 6 * DAY)
    assert again("DD") == [("2026-06-18", 0.3333)] and prov2.asked == []
    assert again.stats["memo"] == 1


def test_the_order_is_memo_then_cache_then_provider_then_stale_memo_then_unknown(tmp_path):
    conn = sqlite3.connect(str(tmp_path / "s.db"))
    seed, _, _, _ = _reader(conn, answers={"OLD": [("2020-01-02", 2.0)]})
    seed("OLD")
    later = 1_000_000.0 + 8 * DAY                          # the stored answer is now stale
    r, prov, _, _ = _reader(conn, cache={"CACHED": {"splits": [["2025-03-03", 3.0]]}},
                            answers={"NEW": []}, now=later)
    assert r("CACHED") == [("2025-03-03", 3.0)] and prov.asked == [], "the cache answers before the provider"
    assert r("NEW") == [] and prov.asked == ["NEW"], "nothing declared is an answer: []"
    assert r("OLD") == [("2020-01-02", 2.0)], "the provider refused: an older stored answer still counts"
    assert r("NONE") is None, "nothing anywhere: unknown, never guessed"
    assert {k: r.stats[k] for k in ("cache", "fetched", "fetch_failed", "stale_memo", "unknown")} == \
        {"cache": 1, "fetched": 1, "fetch_failed": 2, "stale_memo": 1, "unknown": 1}


def test_only_provider_answers_are_stored_never_the_cache_sentinel(tmp_path):
    """A cached ``{"splits": []}`` may be bars_sanitize's one-hour failure sentinel.
    Storing it for a week would make one refused call read as seven clean nights."""
    conn = sqlite3.connect(str(tmp_path / "s.db"))
    r, _, _, _ = _reader(conn, cache={"SENT": {"ipo": None, "splits": []}})
    assert r("SENT") == []
    assert conn.execute(f"SELECT COUNT(*) FROM {ds.TABLE}").fetchone()[0] == 0


def test_the_budget_bounds_provider_calls_and_counts_refusals_against_it():
    r, prov, _, _ = _reader(answers={"A": [], "C": []}, budget=2)
    assert r("A") == [] and r("B") is None and r("C") is None
    assert prov.asked == ["A", "B"], "two calls, one of them refused, and the budget is spent"
    zero, prov0, _, _ = _reader(answers={"A": []}, budget=0)
    assert zero("A") is None and prov0.asked == []
    unlimited, provn, _, _ = _reader(answers={t: [] for t in "ABCDE"}, budget=None)
    assert all(unlimited(t) == [] for t in "ABCDE") and len(provn.asked) == 5


def test_a_closed_brake_skips_the_call_and_a_refusal_engages_it():
    brake = Brake()
    r, prov, _, _ = _reader(answers={"OK": []}, brake=brake)
    assert r("BAD") is None and brake.failures == 1
    assert r("OK") == [] and brake.successes == 1
    brake.open = False
    shut, prov2, _, _ = _reader(answers={"X": []}, brake=brake)
    assert shut("X") is None and prov2.asked == [], "the provider just refused: do not ask through it"


def test_one_answer_per_name_per_run():
    r, prov, _, _ = _reader(answers={"A": [("2026-01-02", 2.0)]})
    assert r("A") == r("a") == [("2026-01-02", 2.0)] and prov.asked == ["A"]


def test_a_dry_run_reads_the_store_and_writes_nothing(tmp_path):
    path = tmp_path / "s.db"
    conn = sqlite3.connect(str(path))
    seed, _, _, _ = _reader(conn, answers={"A": [("2026-01-02", 2.0)]})
    seed("A")
    conn.close()
    ro = sqlite3.connect(path.resolve().as_uri() + "?mode=ro", uri=True)
    r, prov, _, _ = _reader(ro, answers={"B": []}, persist=False)
    assert r("A") == [("2026-01-02", 2.0)] and r("B") == []
    ro.close()
    check = sqlite3.connect(str(path))
    assert [t for (t,) in check.execute(f"SELECT ticker FROM {ds.TABLE}")] == ["A"]
    nothing, _, _, _ = _reader(None, answers={"B": []})
    assert nothing("B") == [] and nothing.persist is False


def test_a_missing_table_on_a_read_only_store_is_an_empty_memo(tmp_path):
    path = tmp_path / "empty.db"
    sqlite3.connect(str(path)).close()
    ro = sqlite3.connect(path.resolve().as_uri() + "?mode=ro", uri=True)
    r, _, _, _ = _reader(ro, persist=False, budget=0)
    assert r("A") is None and r.stats["unknown"] == 1


def test_the_defaults_are_bars_sanitizes_own_fetcher_cache_and_lifetime(monkeypatch):
    from api.services import bars_sanitize as san
    calls = []
    monkeypatch.setattr(san, "_fetch_meta", lambda t: calls.append(t) or {"ipo": None, "splits": []})
    assert ds._default_fetch("ZZ") == {"ipo": None, "splits": []} and calls == ["ZZ"]
    assert ds._meta_ttl() == float(san._META_TTL)
    is_open, fail, ok = ds._default_gate()
    assert is_open is san._warm_gate_open and fail is san._warm_note_failure and ok is san._warm_note_success
    stored = {}
    monkeypatch.setattr(san.cache, "set", lambda k, v, ttl: stored.__setitem__(k, (v, ttl)))
    monkeypatch.setattr(san.cache, "get", lambda k: stored.get(k, (None,))[0])
    ds._default_cache_set("ZZ", {"splits": []})
    assert stored[san._META_KEY.format("ZZ")][1] == san._META_TTL
    assert ds._default_cache_get("ZZ") == {"splits": []}


@pytest.mark.parametrize("bad", [None, [("2026-01-02", 0)], [("", 2.0)], [("2026-01-02", "x")], [("x",)]])
def test_malformed_split_entries_are_dropped(bad):
    r, _, _, _ = _reader(cache={"A": {"splits": bad}})
    assert r("A") == []


# ── review fixes, 2026-11-07 ──────────────────────────────────────────────────

def test_a_closed_brake_is_waited_out_and_the_name_is_then_asked():
    """One refusal closes the shared brake for 30 s or more; the loop between names
    is milliseconds, so a reader that gave up at once left the rest of the run unknown."""
    brake = Brake(open_=False)
    slept = []

    def sleep(s):
        slept.append(s)
        if sum(slept) >= 30:
            brake.open = True

    prov = Provider({"AAA": [("2026-06-18", 0.5)]})
    r = ds.DeclaredSplits(None, budget=10, fetch=prov, cache_get={}.get, gate=brake.gate(),
                          now=lambda: 1.0, sleep=sleep, ttl=DAY)
    assert r("AAA") == [("2026-06-18", 0.5)] and prov.asked == ["AAA"]
    assert r.stats["gate_wait_s"] == 30.0 and r.stats["unknown"] == 0


def test_the_wait_is_capped_per_run_then_names_are_unknown_and_counted():
    brake = Brake(open_=False)
    prov = Provider({"AAA": [], "BBB": []})
    r = ds.DeclaredSplits(None, budget=10, fetch=prov, cache_get={}.get, gate=brake.gate(),
                          now=lambda: 1.0, sleep=lambda s: None, ttl=DAY, max_wait_s=20)
    assert r("AAA") is None and r("BBB") is None and prov.asked == []
    assert r.stats["gate_wait_s"] == 20.0 and r.stats["unknown"] == 2, "the allowance is per run, not per name"


def test_no_provider_key_asks_nothing_and_says_so(monkeypatch):
    monkeypatch.delenv("FMP_API_KEY", raising=False)
    called = []
    monkeypatch.setattr(ds, "_BUILTIN_FETCH", lambda t: called.append(t) or {"splits": []})
    monkeypatch.setattr(ds, "_default_fetch", ds._BUILTIN_FETCH)
    r = ds.DeclaredSplits(None, budget=10, cache_get={}.get, gate=Brake().gate(), sleep=lambda s: None)
    assert r("AAA") is None and called == []
    assert r.stats["no_key"] is True and r.stats["unknown"] == 1
    monkeypatch.setenv("FMP_API_KEY", "k")
    assert ds.DeclaredSplits(None, cache_get={}.get).stats["no_key"] is False


def test_a_batch_reader_does_not_fill_the_shared_cache_by_default(monkeypatch):
    shared = []
    monkeypatch.setattr(ds, "_default_cache_set", lambda t, meta: shared.append(t))
    prov = Provider({"AAA": []})
    r = ds.DeclaredSplits(None, budget=10, fetch=prov, cache_get={}.get, gate=Brake().gate(),
                          sleep=lambda s: None)
    assert r("AAA") == [] and shared == [], "the 1,000-entry app cache is the serve path's"
    r2 = ds.DeclaredSplits(None, budget=10, fetch=Provider({"BBB": []}), cache_get={}.get,
                           gate=Brake().gate(), sleep=lambda s: None, share_cache=True)
    assert r2("BBB") == [] and shared == ["BBB"]
