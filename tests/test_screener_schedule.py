import api.main as m


class _FakeSched:
    def __init__(self):
        self.ids = []

    def add_job(self, *a, **k):
        self.ids.append(k.get("id"))


def test_screener_job_registered(monkeypatch):
    monkeypatch.setenv("SCREENER_SNAPSHOT_ENABLED", "1")
    sched = _FakeSched()
    assert m.register_screener_jobs(sched) is True
    assert "screener_snapshot_nightly" in sched.ids


def test_screener_job_can_be_disabled(monkeypatch):
    monkeypatch.setenv("SCREENER_SNAPSHOT_ENABLED", "0")
    sched = _FakeSched()
    assert m.register_screener_jobs(sched) is False
    assert sched.ids == []
