"""Wave 4: the latest-coverage primitives — scan_coverage is the ONLY source.

Every test pins SCREENER_DB_PATH to a tmp file (the shared-root guard and
C:\\data both make the default path radioactive on this box).
"""
import importlib

import pytest


@pytest.fixture()
def store(tmp_path, monkeypatch):
    monkeypatch.setenv("SCREENER_DB_PATH", str(tmp_path / "screener.db"))
    from api.services.screener import snapshot_db, scan_store
    importlib.reload(snapshot_db)
    importlib.reload(scan_store)
    scan_store.init_db()
    return scan_store


H1 = "sha256:" + "a" * 64
H2 = "sha256:" + "b" * 64


def _cover(store, h, day, answered=10, hits=("NVDA",)):
    store.record_hits(h, "D", day, list(hits))
    store.record_coverage(h, "D", day, evaluated=12, answered=answered,
                          dropped=1, not_computable=12 - answered - 1,
                          dropped_symbols=[{"ticker": "XX", "reason": "no-bars"}])


def test_latest_reads_scan_coverage_never_scan_hits(store):
    # Day 1: hits + coverage. Day 2: swept, ZERO hits -- coverage row only.
    _cover(store, H1, 20260818, hits=("NVDA", "AMD"))
    store.record_coverage(H1, "D", 20260819, evaluated=12, answered=12,
                          dropped=0, not_computable=0, dropped_symbols=[])
    # K8: a hits-derived latest would answer 20260818 and silently join the
    # older day's matches. The coverage-derived answer is the quiet day.
    assert store.latest_covered_as_of(H1, "D") == 20260819


def test_never_swept_is_none_not_zero(store):
    assert store.latest_covered_as_of(H1, "D") is None


def test_batch_returns_each_hashes_own_latest_and_omits_the_unswept(store):
    _cover(store, H1, 20260818)
    _cover(store, H1, 20260820, answered=9)
    _cover(store, H2, 20260819)
    out = store.latest_coverage_for([H1, H2, "sha256:" + "c" * 64], "D")
    assert set(out) == {H1, H2}          # the unswept hash is ABSENT, not null
    assert out[H1]["as_of"] == 20260820
    assert out[H1]["answered"] == 9
    assert out[H2]["as_of"] == 20260819
    for k in ("as_of", "evaluated", "answered", "dropped",
              "not_computable", "freshness"):
        assert k in out[H1]


def test_batch_empty_input_is_empty_dict(store):
    assert store.latest_coverage_for([], "D") == {}
    assert store.latest_coverage_for(None, "D") == {}


def test_scalar_is_the_batch_not_a_second_query(store):
    # Derive, never restate: the scalar delegates to the batch.
    _cover(store, H1, 20260818)
    calls = []
    real = store.latest_coverage_for
    store.latest_coverage_for = lambda hs, tf: (calls.append(1) or real(hs, tf))
    try:
        assert store.latest_covered_as_of(H1, "D") == 20260818
    finally:
        store.latest_coverage_for = real
    assert calls == [1]


def test_scan_join_tf_is_the_sweeps_default_tf(store):
    # The literal "D" is forced by the off-request-path rail (query/filters
    # cannot import the evaluator). THIS test may -- it pins the two spellings
    # together so they cannot drift.
    from api.services.screener import scan_evaluator
    assert store.SCAN_JOIN_TF == scan_evaluator.DEFAULT_TF


def test_tf_label_still_refused_by_name(store):
    with pytest.raises(ValueError):
        store.latest_covered_as_of(H1, "1D")
