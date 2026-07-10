"""Peer read-through — cache, cost-guard, and enable-gate behavior."""
from __future__ import annotations

import importlib
from unittest import mock


def _fresh(monkeypatch, enabled=True):
    monkeypatch.setenv("CALENDAR_SECTOR_READ_ENABLED", "1" if enabled else "0")
    import api.services.calendar_sector_read as m
    importlib.reload(m)
    return m


class _FakeCache:
    def __init__(self):
        self.d = {}

    def get(self, k):
        return self.d.get(k)

    def set(self, k, v, ttl=None):
        self.d[k] = v


def test_disabled_gate_is_unavailable(monkeypatch):
    m = _fresh(monkeypatch, enabled=False)
    assert m.status_for("Technology", "2026-07-13") == {"status": "unavailable"}
    # request_generation is a no-op when disabled (no crash, nothing cached)
    m.request_generation("Technology", "2026-07-13", [{"sym": "AAPL"}])


def test_cached_line_returns_ready(monkeypatch):
    m = _fresh(monkeypatch)
    fake = _FakeCache()
    with mock.patch.object(m, "_cache", return_value=fake):
        fake.set(m._key("Technology", "2026-07-13"),
                 {"line": "Watch AAPL guidance.", "model": "x", "at": "2026-07-13"})
        st = m.status_for("Technology", "2026-07-13")
    assert st["status"] == "ready"
    assert st["line"] == "Watch AAPL guidance."


def test_null_cache_is_unavailable_not_generating(monkeypatch):
    m = _fresh(monkeypatch)
    fake = _FakeCache()
    with mock.patch.object(m, "_cache", return_value=fake):
        fake.set(m._key("Financials", "2026-07-13"), "__null__")
        st = m.status_for("Financials", "2026-07-13")
    assert st == {"status": "unavailable"}


def test_uncached_is_generating(monkeypatch):
    m = _fresh(monkeypatch)
    fake = _FakeCache()
    with mock.patch.object(m, "_cache", return_value=fake):
        st = m.status_for("Energy", "2026-07-13")
    assert st == {"status": "generating"}


def test_generate_skips_when_cost_cap_reached(monkeypatch):
    m = _fresh(monkeypatch)
    fake = _FakeCache()
    guard = mock.Mock()
    guard.may_synthesize.return_value = False   # budget spent
    with mock.patch.object(m, "_cache", return_value=fake), \
         mock.patch.object(m, "_cost_guard", return_value=guard):
        m._generate("Technology", "2026-07-13", [{"sym": "AAPL", "name": "Apple", "mc_b": 3400}])
    # NOT cached (so it retries when budget frees), and no LLM client built
    assert fake.get(m._key("Technology", "2026-07-13")) is None
    guard.record.assert_not_called()


def test_generate_empty_reporters_null_caches(monkeypatch):
    m = _fresh(monkeypatch)
    fake = _FakeCache()
    with mock.patch.object(m, "_cache", return_value=fake):
        m._generate("Technology", "2026-07-13", [])
    assert fake.get(m._key("Technology", "2026-07-13")) == "__null__"


def test_generate_writes_line_and_records_cost(monkeypatch):
    m = _fresh(monkeypatch)
    fake = _FakeCache()
    guard = mock.Mock()
    guard.may_synthesize.return_value = True

    client = mock.Mock()
    resp = mock.Mock()
    resp.content = [mock.Mock(text='  "AAPL is the bellwether; watch services guidance."  ')]
    resp.usage = mock.Mock(input_tokens=200, output_tokens=30)
    client.messages.create.return_value = resp

    with mock.patch.object(m, "_cache", return_value=fake), \
         mock.patch.object(m, "_cost_guard", return_value=guard), \
         mock.patch.object(m, "_anthropic_client", return_value=client):
        m._generate("Technology", "2026-07-13",
                    [{"sym": "AAPL", "name": "Apple", "mc_b": 3400, "timing": "amc"}])

    stored = fake.get(m._key("Technology", "2026-07-13"))
    assert isinstance(stored, dict)
    assert stored["line"] == "AAPL is the bellwether; watch services guidance."
    guard.record.assert_called_once()


def test_fmt_cap():
    m = importlib.import_module("api.services.calendar_sector_read")
    assert m._fmt_cap(3400) == "$3.4T"
    assert m._fmt_cap(187) == "$187B"
    assert m._fmt_cap(0.5) == "$500M"
    assert m._fmt_cap(None) == ""
    assert m._fmt_cap(0) == ""
