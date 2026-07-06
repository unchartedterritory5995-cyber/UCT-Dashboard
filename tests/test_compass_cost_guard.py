from api.services.journal_two import compass_cost_guard as cg


def _reset(monkeypatch, cap=None):
    cg._reset_for_test()
    if cap is None:
        monkeypatch.delenv("COMPASS_COST_CAP_DAILY", raising=False)
    else:
        monkeypatch.setenv("COMPASS_COST_CAP_DAILY", str(cap))


def test_disabled_by_default(monkeypatch):
    _reset(monkeypatch, cap=None)
    cg.record(10_000_000, 10_000_000)          # huge spend
    assert cg.over_budget() is False           # no cap set → never trips


def test_zero_cap_is_disabled(monkeypatch):
    _reset(monkeypatch, cap=0)
    cg.record(10_000_000, 10_000_000)
    assert cg.over_budget() is False


def test_trips_when_over_cap(monkeypatch):
    _reset(monkeypatch, cap=1.0)               # $1/day
    assert cg.over_budget() is False           # nothing spent yet
    # 1M output tokens at $15/MTok = $15 > $1 cap
    cg.record(0, 1_000_000)
    assert cg.over_budget() is True


def test_under_cap_stays_open(monkeypatch):
    _reset(monkeypatch, cap=100.0)
    cg.record(100_000, 100_000)                # ~$1.80 spend, well under $100
    assert cg.over_budget() is False


def test_pricing_math(monkeypatch):
    _reset(monkeypatch, cap=1000.0)
    cg.record(1_000_000, 1_000_000)            # $3 in + $15 out = $18
    assert cg.snapshot()["spent_usd"] == 18.0


def test_record_from_usage(monkeypatch):
    _reset(monkeypatch, cap=1000.0)

    class _U:
        input_tokens = 1_000_000
        output_tokens = 0

    cg.record_from_usage(_U())
    assert cg.snapshot()["spent_usd"] == 3.0
    cg.record_from_usage(None)                 # no-op, never raises
    assert cg.snapshot()["spent_usd"] == 3.0


def test_snapshot_shape(monkeypatch):
    _reset(monkeypatch, cap=5.0)
    s = cg.snapshot()
    assert s["enabled"] is True and s["cap_usd"] == 5.0 and s["over_budget"] is False


def test_handle_user_turn_refuses_when_over_budget(monkeypatch):
    import sqlite3
    from api.services.journal_two import coach_chat as cc
    from api.services.journal_two import compass_cost_guard as cgm
    monkeypatch.setattr(cc, "get_rate_limit_info",
                        lambda **kw: {"remaining": 10, "limit": 200, "used": 0})
    monkeypatch.setattr(cgm, "over_budget", lambda: True)
    conn = sqlite3.connect(":memory:")
    events = list(cc.handle_user_turn(user_id="u", account_id="a", user_message="hi", conn=conn))
    assert events and events[0].get("code") == "cost_capped"


def test_handle_user_turn_not_blocked_when_under_budget(monkeypatch):
    # under budget -> cost guard does NOT short-circuit (it proceeds past the check;
    # we assert the FIRST event is not a cost_capped error)
    import sqlite3
    from api.services.journal_two import coach_chat as cc
    from api.services.journal_two import compass_cost_guard as cgm
    monkeypatch.setattr(cc, "get_rate_limit_info",
                        lambda **kw: {"remaining": 10, "limit": 200, "used": 0})
    monkeypatch.setattr(cgm, "over_budget", lambda: False)
    monkeypatch.setattr(cc, "_maybe_summarize", lambda **kw: False)

    class _BoomClient:  # first real work after the guard raises -> proves guard passed
        def start_stream(self, **kw):
            raise RuntimeError("reached streaming")

    conn = sqlite3.connect(":memory:")
    conn.executescript(
        "CREATE TABLE j2_chat_messages (id INTEGER PRIMARY KEY, user_id TEXT, account_id TEXT,"
        " role TEXT, content TEXT, tool_calls TEXT, created_at TEXT);"
        "CREATE TABLE j2_accounts (id TEXT, user_id TEXT, onboarding_mode INTEGER);")
    got_cost_capped = False
    try:
        for ev in cc.handle_user_turn(user_id="u", account_id="a", user_message="hi",
                                      client=_BoomClient(), conn=conn):
            if ev.get("code") == "cost_capped":
                got_cost_capped = True
                break
    except Exception:
        pass  # streaming path blew up (expected) — the point is we got PAST the guard
    assert got_cost_capped is False
