import api.main as m


class _Fake:
    def __init__(self):
        self.ids = []

    def add_job(self, *a, **k):
        self.ids.append(k.get("id"))


def test_pattern_vision_job_registered(monkeypatch):
    monkeypatch.setenv("PATTERN_VISION_ENABLED", "1")
    f = _Fake()
    assert m.register_pattern_vision_jobs(f) is True
    assert "pattern_vision_judge" in f.ids


def test_disabled(monkeypatch):
    monkeypatch.setenv("PATTERN_VISION_ENABLED", "0")
    f = _Fake()
    assert m.register_pattern_vision_jobs(f) is False
    assert "pattern_vision_judge" not in f.ids


def test_active_set_resolver_returns_list():
    out = m._resolve_active_set_for_patterns()
    assert isinstance(out, list)
    assert len(out) == len(set(out))  # de-duped
