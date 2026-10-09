"""meta()'s member-independent filter list is built once per snapshot vintage.

Measured 2026-10-09 on prod: the `filters` part was 3.3 s of a 4.1 s /api/screener/meta and was
rebuilt on every request. It depends only on the snapshot and the ledgers.
"""
from api.services.screener import distribution, filters


def _patch(monkeypatch, basis):
    calls = {"n": 0}
    real = filters._build_shared_filters

    def counting(dist):
        calls["n"] += 1
        return real(dist)

    monkeypatch.setattr(filters, "_build_shared_filters", counting)
    monkeypatch.setattr(distribution, "distributions", lambda: {"basis": basis[0], "columns": {}})
    monkeypatch.setattr(filters, "_distinct_options", lambda col: [{"label": "Any"}])
    monkeypatch.setattr(filters, "_distinct_list_options", lambda col: [{"label": "Any"}])
    monkeypatch.setattr(filters, "_structure_evidence", lambda: {})
    filters._SHARED_CACHE.clear()
    return calls


def test_a_repeat_meta_reuses_the_build_and_a_new_vintage_rebuilds(monkeypatch):
    basis = [{"snapshot_date": "2026-10-08", "rows": 3999}]
    calls = _patch(monkeypatch, basis)
    a = filters.meta()
    b = filters.meta()
    assert calls["n"] == 1
    assert [f["key"] for f in a["filters"]] == [f["key"] for f in b["filters"]]
    basis[0] = {"snapshot_date": "2026-10-09", "rows": 4001}
    filters.meta()
    assert calls["n"] == 2


def test_a_member_entry_never_leaks_into_the_shared_list(monkeypatch):
    basis = [{"snapshot_date": "2026-10-08"}]
    _patch(monkeypatch, basis)
    monkeypatch.setattr(filters, "_my_lists_entry", lambda uid: {"key": "my_lists", "label": "My Lists"})
    monkeypatch.setattr(filters, "_my_scans_entry", lambda uid: None)
    with_member = filters.meta(user_id="u1")
    anonymous = filters.meta()
    assert "my_lists" in [f["key"] for f in with_member["filters"]]
    assert "my_lists" not in [f["key"] for f in anonymous["filters"]]


def test_no_vintage_means_no_caching(monkeypatch):
    basis = [None]
    calls = _patch(monkeypatch, basis)
    filters.meta()
    filters.meta()
    assert calls["n"] == 2
