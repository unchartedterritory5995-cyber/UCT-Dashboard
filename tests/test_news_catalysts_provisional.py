"""A provisional catalyst set is not a finished one.

`needs_generation` used to be `if any row exists: return False`, which is not
"generate once" — it is "generate once, FOREVER". The from-memory fallback
(`source='ai'`, written whenever the web leg is unavailable, from a pre-cutoff
model that "produces less") counted as a finished answer, so ONE Perplexity 429
at the wrong moment pinned the weaker set permanently: no later pass could
replace it, because `retry_after` is consulted only when there are no rows.

Measured 2026-08-24 while warming 62 names at once: 142 429s in fourteen
minutes. Nothing was baked in only because the retries happened to win.
"""
import time

import pytest


@pytest.fixture
def store(tmp_path, monkeypatch):
    monkeypatch.setenv("NEWS_CATALYSTS_DB_PATH", str(tmp_path / "nc.db"))
    import importlib
    from api.services.news_catalysts import store as st
    importlib.reload(st)
    st._init_db()
    return st


WEB = [{"date": "2026-05-01", "title": "Signed a deal", "source": "web", "url": "https://x/1"}]
AI = [{"date": "2026-05-01", "title": "Moved on a report", "source": "ai"}]
DAY = 86400


def test_a_web_grounded_set_is_finished(store):
    store.replace_catalysts("AAA", "p1", WEB)
    assert store.needs_generation("AAA", "p1", DAY,
                                  error_retry_after=1800, upgrade_after=3600) is False


def test_a_fallback_only_set_is_provisional_and_gets_upgraded(store):
    """THE REGRESSION. Fallback rows exist, so the old gate said 'finished'."""
    store.replace_catalysts("BBB", "p1", AI)
    # Too fresh to re-try yet — we do not thrash.
    assert store.needs_generation("BBB", "p1", DAY,
                                  error_retry_after=1800, upgrade_after=3600) is False
    # Age both the rows and the attempt stamp past their windows.
    old = int(time.time()) - (2 * DAY)
    with store._WRITE_LOCK, store._connect() as c:
        c.execute("UPDATE news_catalysts SET created_at=? WHERE symbol='BBB'", (old,))
        c.execute("UPDATE news_catalyst_meta SET catalysts_at=? WHERE symbol='BBB'", (old,))
        c.commit()
    assert store.needs_generation("BBB", "p1", DAY,
                                  error_retry_after=1800, upgrade_after=3600) is True, \
        "a fallback-only set must be upgradeable to a web-grounded one"


def test_upgrading_is_bounded_by_the_ordinary_retry_window(store):
    """Old rows, but we ATTEMPTED recently → do not attempt again yet."""
    store.replace_catalysts("CCC", "p1", AI)
    old = int(time.time()) - (2 * DAY)
    with store._WRITE_LOCK, store._connect() as c:
        c.execute("UPDATE news_catalysts SET created_at=? WHERE symbol='CCC'", (old,))
        c.commit()          # meta.catalysts_at stays NOW
    assert store.needs_generation("CCC", "p1", DAY,
                                  error_retry_after=1800, upgrade_after=3600) is False


def test_a_mixed_set_counts_as_web_grounded(store):
    store.replace_catalysts("DDD", "p1", AI + WEB)
    assert store.needs_generation("DDD", "p1", DAY,
                                  error_retry_after=1800, upgrade_after=3600) is False


def test_a_failed_look_retries_in_minutes_not_a_day(store):
    """A 429 is not the finding 'this company has no catalysts'."""
    store.mark_attempt("EEE", "p1", kind="error")
    with store._WRITE_LOCK, store._connect() as c:
        c.execute("UPDATE news_catalyst_meta SET catalysts_at=? WHERE symbol='EEE'",
                  (int(time.time()) - 3600,))   # an hour ago
        c.commit()
    # Old behaviour (no error window) still waits the full day...
    assert store.needs_generation("EEE", "p1", DAY) is False
    # ...but a caller that opted in looks again.
    assert store.needs_generation("EEE", "p1", DAY, error_retry_after=1800) is True


def test_a_genuine_empty_still_waits_the_full_window(store):
    """A bond fund really has no catalysts — do not re-bill it every 30 min."""
    store.mark_attempt("FFF", "p1")          # no kind → 'we looked, nothing there'
    with store._WRITE_LOCK, store._connect() as c:
        c.execute("UPDATE news_catalyst_meta SET catalysts_at=? WHERE symbol='FFF'",
                  (int(time.time()) - 3600,))
        c.commit()
    assert store.needs_generation("FFF", "p1", DAY, error_retry_after=1800) is False


def test_the_new_bounds_are_opt_in_and_default_to_the_old_behaviour(store):
    """Any caller that has not opted in must be byte-for-byte unchanged."""
    store.replace_catalysts("GGG", "p1", AI)
    old = int(time.time()) - (30 * DAY)
    with store._WRITE_LOCK, store._connect() as c:
        c.execute("UPDATE news_catalysts SET created_at=? WHERE symbol='GGG'", (old,))
        c.execute("UPDATE news_catalyst_meta SET catalysts_at=? WHERE symbol='GGG'", (old,))
        c.commit()
    assert store.needs_generation("GGG", "p1", DAY) is False   # rows exist → old gate


def test_attempt_kind_survives_a_reopen_and_is_cleared_by_a_good_write(store):
    store.mark_attempt("HHH", "p1", kind="error")
    with store._connect() as c:
        assert c.execute("SELECT attempt_kind FROM news_catalyst_meta WHERE symbol='HHH'"
                         ).fetchone()[0] == "error"
    store.replace_catalysts("HHH", "p1", WEB)
    assert store.needs_generation("HHH", "p1", DAY,
                                  error_retry_after=1800, upgrade_after=3600) is False


# ── the service-level classification ────────────────────────────────────────

def test_web_catalysts_names_a_transport_failure_as_error_not_empty(monkeypatch):
    from api.services.news_catalysts import service as nc
    from api.services import perplexity_search
    monkeypatch.setattr(nc, "_web_enabled", lambda: True)
    monkeypatch.setattr(perplexity_search, "web_search",
                        lambda *a, **k: {"answer": "", "citations": [],
                                         "error": "request failed: 429 Too Many Requests"})
    oc: dict = {}
    items, _ = nc._web_catalysts("TST", None, [{"t": "2026-05-01", "c": 1.0}], None, outcome=oc)
    assert items is None
    assert oc["ok"] is False and oc["kind"] == "error"
    assert "429" in (oc.get("reason") or "")


def test_web_catalysts_names_a_disabled_leg_as_disabled(monkeypatch):
    from api.services.news_catalysts import service as nc
    monkeypatch.setattr(nc, "_web_enabled", lambda: False)
    oc: dict = {}
    assert nc._web_catalysts("TST", None, [], None, outcome=oc) == (None, None)
    assert oc["kind"] == "disabled"


def test_the_gate_has_one_authority_shared_by_the_warm_and_the_endpoint(monkeypatch):
    """The warm must not carry its own copy of the retry knobs."""
    from api.services.news_catalysts import service as nc
    from api.services import earnings_preview_warm as w
    seen = []
    monkeypatch.setattr(nc, "needs_catalysts", lambda sym: seen.append(sym) or True)
    assert w._needs_catalysts("ZZZ") is True
    assert seen == ["ZZZ"], "the warm must route through nc.needs_catalysts"
