"""serving.py -- the web read path in all three source modes, and its serve-time rails."""
from __future__ import annotations

import copy
import gzip
import json

import pytest

from api.services.econ import publish as P
from api.services.econ import registry as R
from api.services.econ import serving

from .test_publish import (ASOF_T1, LATEST, NOW, T1, assert_first_availability_placement,
                           assert_no_internals, seed_store)


@pytest.fixture
def db_path(tmp_path):
    return seed_store(str(tmp_path / "econ.db"))


@pytest.fixture(params=["db", "local", "r2"])
def mode(request, db_path, tmp_path, monkeypatch):
    """Every mode must give the SAME answers."""
    from api.services import data_sync
    from api.services.econ import store as S
    serving.clear_cache()
    P.clear_memo()
    m = request.param
    monkeypatch.setenv("ECON_SERVING_SOURCE", m)
    monkeypatch.setenv("ECON_DB_PATH", db_path)
    if m in ("local", "r2"):
        objs = {}
        monkeypatch.setattr(data_sync, "put_bytes", lambda k, b, ct: objs.__setitem__(k, b) or True)
        monkeypatch.setattr(data_sync, "get_bytes", lambda k: objs.get(k))
        root = str(tmp_path / "art")
        monkeypatch.setenv("ECON_ARTIFACT_DIR", root)
        s = S.connect(db_path)
        try:
            P.publish_all(s, local_root=root if m == "local" else "", r2=(m == "r2"), now=NOW)
        finally:
            s.close()
        monkeypatch.setenv("ECON_DB_PATH", str(tmp_path / "absent.db"))   # prove the DB is not read
    yield m
    serving.clear_cache()


def test_latest_and_asof(mode):
    st, body, tag = serving.series("USCPI")
    assert st == 200 and tag.startswith('"')
    assert_first_availability_placement(body["points"], LATEST)
    st, body, _ = serving.series("ECON:USCPI", asof=T1 + 1)
    assert st == 200 and body["view"] == "asof" and body["asof"] == T1 + 1
    assert_first_availability_placement(body["points"], ASOF_T1)
    st, body, _ = serving.series("econ:USCPI", start="2026-08-01")
    assert [p[2] for p in body["points"]] == ["2026-08-01"]


def test_modes_agree_with_the_builder(mode, db_path):
    from api.services.econ import store as S
    s = S.connect(db_path)
    try:
        want = P.build_series_payload(s, "USCPI", asof=T1 + 1, now=NOW)
    finally:
        s.close()
    st, body, _ = serving.series("USCPI", asof=T1 + 1)
    assert body["points"] == want["points"] and body["meta"] == want["meta"]


@pytest.mark.parametrize("sym", ["USCPIFOOD", "USPPIFDNSA", "USUMCSENT", "ECON:USCPIFOOD", "USNOPE",
                                 "AAPL", "ECON:AAPL", "FOO:USCPI", "USCPI:X", "x" * 80])
def test_non_servable_is_404_never_partial(mode, sym):
    st, body, tag = serving.series(sym)
    assert st == 404 and tag is None and "points" not in body


def test_enabled_without_data_is_404_no_data(mode):
    st, body, _ = serving.series("USUNRATE")
    assert (st, body["detail"]) == (404, "no_data")


def test_disabled_after_publish_is_refused_at_the_door(mode, monkeypatch):
    """⛔ belt and braces: the artifact exists, the web build's registry says no."""
    real_get = R.get

    def get(s):
        e = real_get(s)
        if e and e["symbol"] == "USCPI":
            e = copy.deepcopy(e); e["status"] = "disabled"
        return e

    monkeypatch.setattr(R, "get", get)
    serving.clear_cache()
    assert serving.series("USCPI")[0] == 404
    assert "USCPI" not in {r["symbol"] for r in serving.catalog()[1]["series"]}
    assert "USCPI" not in {r["symbol"] for r in serving.status()[1]["series"]}


def test_catalog_and_no_internals(mode):
    st, body, tag = serving.catalog()
    assert st == 200 and set(body) == {"series", "attributions"}
    assert len(body["series"]) == 42
    assert_no_internals(body)
    assert_no_internals(serving.series("USCPI")[1])


def test_status_is_values_free(mode):
    st, body, _ = serving.status()
    assert st == 200
    text = json.dumps(body)
    for v in ("320.5", "321.0", "320.0", "159000"):
        assert v not in text
    row = next(r for r in body["series"] if r["symbol"] == "USCPI")
    assert row["state"] == "CURRENT" and row["next_release"]["date"] == "2026-10-15"


def test_tampered_artifacts_are_sanitized(tmp_path, monkeypatch):
    """An artifact carrying extra fields (a leaked value in status, licensing in meta)
    is served through the whitelist, never verbatim."""
    root = tmp_path / "art"
    monkeypatch.setenv("ECON_SERVING_SOURCE", "local")
    monkeypatch.setenv("ECON_ARTIFACT_DIR", str(root))
    serving.clear_cache()
    meta = P.meta_for(R.get("USCPI"))
    bad_meta = dict(meta, licensing={"class": "GREEN"}, params={"api_key": "SECRET"})
    series = {"id": "ECON:USCPI", "symbol": "USCPI", "view": "latest", "asof": None, "meta": bad_meta,
              "currentness": {"state": "CURRENT"}, "columns": P.COLUMNS,
              "points": [[T1, 1.0, "2026-07-01", "2026-07-31", "V"]]}
    status = {"service": {"published_at": 1, "nested": {"x": 1}},
              "series": [{"symbol": "USCPI", "state": "CURRENT", "value": 320.5, "points": [1]},
                         {"symbol": "USCPIFOOD", "state": "CURRENT"}]}
    for key, doc, gz in ((P.series_key("USCPI"), series, True), (P.STATUS_KEY, status, False)):
        p = root.joinpath(*key.split("/"))
        p.parent.mkdir(parents=True, exist_ok=True)
        raw = json.dumps(doc).encode()
        p.write_bytes(gzip.compress(raw) if gz else raw)
    st, body, _ = serving.series("USCPI")
    assert st == 200 and body["meta"] == meta
    assert_no_internals(body)
    st, body, _ = serving.status()
    assert body["series"] == [{"symbol": "USCPI", "state": "CURRENT", "latest_period": None,
                               "expected_period": None, "next_release": None, "last_success_at": None}]
    assert body["service"] == {"published_at": 1}


def test_missing_status_artifact_is_503(tmp_path, monkeypatch):
    monkeypatch.setenv("ECON_SERVING_SOURCE", "local")
    monkeypatch.setenv("ECON_ARTIFACT_DIR", str(tmp_path / "empty"))
    serving.clear_cache()
    assert serving.status()[0] == 503
    assert serving.series("USCPI")[0] == 404
    assert serving.catalog()[0] == 200          # the catalog falls back to the registry


def test_db_mode_opens_readonly(db_path, monkeypatch):
    monkeypatch.setenv("ECON_SERVING_SOURCE", "db")
    monkeypatch.setenv("ECON_DB_PATH", db_path)
    serving.clear_cache()
    s = serving._open_db()
    try:
        with pytest.raises(Exception):
            s.conn.execute("CREATE TABLE x(y)")
    finally:
        s.close()


def test_ttl_cache_serves_repeat_reads_without_io(db_path, monkeypatch):
    monkeypatch.setenv("ECON_SERVING_SOURCE", "db")
    monkeypatch.setenv("ECON_DB_PATH", db_path)
    serving.clear_cache()
    assert serving.series("USCPI")[0] == 200
    monkeypatch.setattr(serving, "_open_db", lambda: (_ for _ in ()).throw(AssertionError("re-read")))
    assert serving.series("USCPI")[0] == 200


def test_artifact_currentness_comes_from_the_status_heartbeat(tmp_path, monkeypatch):
    """The series artifact is only rewritten when data changes; its baked-in
    currentness must not outlive the next status heartbeat."""
    from api.services.econ import store as S
    db = seed_store(str(tmp_path / "econ.db"))
    root = str(tmp_path / "art")
    serving.clear_cache(); P.clear_memo()
    monkeypatch.setenv("ECON_SERVING_SOURCE", "local")
    monkeypatch.setenv("ECON_ARTIFACT_DIR", root)
    s = S.connect(db)
    try:
        P.publish_all(s, local_root=root, r2=False, now=NOW)
        assert serving.series("USCPI")[1]["currentness"]["state"] == "CURRENT"
        # the next release window opens: state changes, data does not -> only status is re-published
        s.put_state("USCPI", state="CHECKING")
        P.publish_status(s, local_root=root, r2=False, now=NOW + 60)
    finally:
        s.close()
    serving.clear_cache()
    st, body, _ = serving.series("USCPI")
    assert st == 200 and body["currentness"]["state"] == "CHECKING"
    assert set(body["currentness"]) == {"state", "latest_period", "expected_period", "next_release"}
    serving.clear_cache()
