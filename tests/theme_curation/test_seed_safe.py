from api.services import theme_db


def test_seed_safe_swallows_exception(monkeypatch):
    def boom():
        raise ValueError("malformed taxonomy row")   # what a bad Stage-4 output would trigger
    monkeypatch.setattr(theme_db, "seed_from_json", boom)
    assert theme_db.seed_from_json_safe() is False    # must NOT raise
