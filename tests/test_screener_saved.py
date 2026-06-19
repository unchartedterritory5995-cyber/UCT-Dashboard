import importlib


def _svc(tmp_path, monkeypatch):
    monkeypatch.setenv("AUTH_DB_PATH", str(tmp_path / "auth.db"))
    import api.services.auth_db as adb
    importlib.reload(adb)
    adb.init_db()
    import api.services.screener.saved_screens as ss
    importlib.reload(ss)
    ss.init()
    return ss


def test_create_list_get_delete(tmp_path, monkeypatch):
    ss = _svc(tmp_path, monkeypatch)
    spec = {"filters": [{"key": "rsi14", "op": "lte", "max": 30}], "view": "overview"}
    rec = ss.create(user_id="u7", name="Oversold", spec=spec)
    assert rec["id"] and rec["name"] == "Oversold"
    assert ss.list_for("u7")[0]["name"] == "Oversold"
    assert ss.get(rec["id"], "u7")["spec"]["view"] == "overview"
    assert ss.get(rec["id"], "other") is None       # not owner
    assert ss.delete(rec["id"], "u7") is True
    assert ss.list_for("u7") == []


def test_public_share(tmp_path, monkeypatch):
    ss = _svc(tmp_path, monkeypatch)
    rec = ss.create("u7", "Shared", {"filters": [], "view": "overview"}, is_public=True)
    assert rec["share_token"]
    got = ss.get_public(rec["share_token"])
    assert got and got["name"] == "Shared"


def test_starters_present(tmp_path, monkeypatch):
    ss = _svc(tmp_path, monkeypatch)
    assert len(ss.starters()) >= 3
    assert all("spec" in s for s in ss.starters())
