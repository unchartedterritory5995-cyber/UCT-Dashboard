"""Tests for the chat tool catalog."""
from __future__ import annotations
import importlib, json, os, sqlite3, tempfile, uuid
import pytest


@pytest.fixture
def db_conn(monkeypatch):
    tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
    tmp.close()
    monkeypatch.setenv("AUTH_DB_PATH", tmp.name)
    from api.services import auth_db
    importlib.reload(auth_db)
    auth_db.init_db()
    conn = sqlite3.connect(tmp.name)
    conn.row_factory = sqlite3.Row
    yield conn
    conn.close()
    os.unlink(tmp.name)


def _seed_account(db_conn, user_id="u_chat"):
    from api.services.journal_two import accounts as accounts_service
    return accounts_service.get_or_migrate_default_account(user_id, conn=db_conn)


def _insert_trade(conn, *, user_id, account_id, exit_iso, **kwargs):
    """Closed-trade insert helper (mirrors test_coach_data_assembler.py)."""
    defaults = dict(
        symbol="TEST", side="Long", shares=100,
        entry_price=100.0, entry_date=exit_iso,
        exit_price=105.0, exit_date=exit_iso,
        original_stop=95.0, setup="Bull Flag", notes=None,
        pnl_dollar=500.0, pnl_percent=5.0, r_multiple=1.0,
        hold_days=2, result="Win", context_at_entry="{}",
        created_at=exit_iso, mistake_tags="[]", emotion_tags="[]",
        fees=0, regime=None,
    )
    defaults.update(kwargs)
    conn.execute(
        """INSERT INTO j2_trades (
            id, user_id, position_id, symbol, side, shares,
            entry_price, entry_date, exit_price, exit_date,
            original_stop, setup, notes, pnl_dollar, pnl_percent,
            r_multiple, hold_days, result, context_at_entry,
            created_at, account_id, mistake_tags, emotion_tags, fees, regime
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (str(uuid.uuid4()), user_id, str(uuid.uuid4()),
         defaults["symbol"], defaults["side"], defaults["shares"],
         defaults["entry_price"], defaults["entry_date"],
         defaults["exit_price"], defaults["exit_date"],
         defaults["original_stop"], defaults["setup"], defaults["notes"],
         defaults["pnl_dollar"], defaults["pnl_percent"], defaults["r_multiple"],
         defaults["hold_days"], defaults["result"], defaults["context_at_entry"],
         defaults["created_at"], account_id, defaults["mistake_tags"],
         defaults["emotion_tags"], defaults["fees"], defaults["regime"]),
    )
    conn.commit()


def test_tools_dict_exposes_expected_entries():
    from api.services.journal_two import coach_chat_tools as tools
    expected_read = {"list_recent_trades", "get_aggregates", "get_open_positions",
                     "get_trader_profile", "get_recent_recaps", "get_account_settings",
                     "get_setup_stats", "find_arcs"}
    assert expected_read.issubset(tools.TOOLS.keys()), f"missing: {expected_read - tools.TOOLS.keys()}"
    for name in expected_read:
        spec = tools.TOOLS[name]
        assert spec["requires_confirm"] is False
        assert callable(spec["executor"])
        assert "input_schema" in spec


def test_list_recent_trades_returns_filtered_trades(db_conn):
    from api.services.journal_two import coach_chat_tools as tools
    acc = _seed_account(db_conn)
    _insert_trade(db_conn, user_id="u_chat", account_id=acc["id"],
                  exit_iso="2026-05-11T20:00:00+00:00",
                  symbol="NVDA", setup="Bull Flag", result="Win")
    _insert_trade(db_conn, user_id="u_chat", account_id=acc["id"],
                  exit_iso="2026-05-10T20:00:00+00:00",
                  symbol="AAPL", setup="Pullback", result="Loss")
    result = tools.TOOLS["list_recent_trades"]["executor"](
        user_id="u_chat", account_id=acc["id"], args={"days": 7}, conn=db_conn,
    )
    assert result["count"] == 2
    assert len(result["trades"]) == 2


def test_list_recent_trades_filters_by_setup(db_conn):
    from api.services.journal_two import coach_chat_tools as tools
    acc = _seed_account(db_conn)
    _insert_trade(db_conn, user_id="u_chat", account_id=acc["id"],
                  exit_iso="2026-05-11T20:00:00+00:00",
                  symbol="NVDA", setup="Bull Flag", result="Win")
    _insert_trade(db_conn, user_id="u_chat", account_id=acc["id"],
                  exit_iso="2026-05-10T20:00:00+00:00",
                  symbol="AAPL", setup="Pullback", result="Loss")
    result = tools.TOOLS["list_recent_trades"]["executor"](
        user_id="u_chat", account_id=acc["id"], args={"days": 7, "setup": "Bull Flag"}, conn=db_conn,
    )
    assert result["count"] == 1
    assert result["trades"][0]["symbol"] == "NVDA"


def test_get_aggregates_period_week_returns_summary(db_conn):
    from api.services.journal_two import coach_chat_tools as tools
    acc = _seed_account(db_conn)
    _insert_trade(db_conn, user_id="u_chat", account_id=acc["id"],
                  exit_iso="2026-05-11T20:00:00+00:00",
                  pnl_dollar=400, r_multiple=2.0, result="Win")
    _insert_trade(db_conn, user_id="u_chat", account_id=acc["id"],
                  exit_iso="2026-05-12T20:00:00+00:00",
                  pnl_dollar=-200, r_multiple=-1.0, result="Loss")
    result = tools.TOOLS["get_aggregates"]["executor"](
        user_id="u_chat", account_id=acc["id"], args={"period": "week"}, conn=db_conn,
    )
    assert result["aggregates"]["trade_count"] == 2
    assert result["aggregates"]["wins"] == 1
    assert result["aggregates"]["losses"] == 1


def test_get_aggregates_with_breakdown_by_setup(db_conn):
    from api.services.journal_two import coach_chat_tools as tools
    acc = _seed_account(db_conn)
    _insert_trade(db_conn, user_id="u_chat", account_id=acc["id"],
                  exit_iso="2026-05-11T20:00:00+00:00",
                  setup="Bull Flag", r_multiple=1.5, result="Win")
    _insert_trade(db_conn, user_id="u_chat", account_id=acc["id"],
                  exit_iso="2026-05-12T20:00:00+00:00",
                  setup="Pullback", r_multiple=-1.0, result="Loss")
    result = tools.TOOLS["get_aggregates"]["executor"](
        user_id="u_chat", account_id=acc["id"],
        args={"period": "week", "breakdown_by": "setup"}, conn=db_conn,
    )
    setups = {b["key"]: b for b in result["breakdown"]}
    assert "Bull Flag" in setups
    assert "Pullback" in setups


def test_get_trader_profile_returns_account_blob(db_conn):
    from api.services.journal_two import coach_chat_tools as tools
    acc = _seed_account(db_conn)
    db_conn.execute(
        "UPDATE j2_accounts SET trader_profile = ? WHERE id = ?",
        ("# Trader Profile\n\nDisciplined Long-only trader.", acc["id"]),
    )
    db_conn.commit()
    result = tools.TOOLS["get_trader_profile"]["executor"](
        user_id="u_chat", account_id=acc["id"], args={}, conn=db_conn,
    )
    assert "Disciplined" in result["profile_markdown"]


def test_get_account_settings_returns_dict(db_conn):
    from api.services.journal_two import coach_chat_tools as tools
    acc = _seed_account(db_conn)
    result = tools.TOOLS["get_account_settings"]["executor"](
        user_id="u_chat", account_id=acc["id"], args={}, conn=db_conn,
    )
    assert isinstance(result["settings"], dict)


def test_get_open_positions_returns_only_open(db_conn):
    from api.services.journal_two import coach_chat_tools as tools
    acc = _seed_account(db_conn)
    db_conn.execute(
        """INSERT INTO j2_positions (id, user_id, symbol, side, entry_date,
           shares, original_shares, entry_price, stop_price, breakeven_stop,
           raise_to_breakeven, setup, notes, context_at_entry, account_id,
           created_at, updated_at, closed_at)
           VALUES (?, 'u_chat', 'NVDA', 'Long', '2026-05-10T14:00:00+00:00',
           100, 100, 200.0, 195.0, NULL, 0, 'Bull Flag', NULL, '{}', ?,
           '2026-05-10T14:00:00+00:00', '2026-05-10T14:00:00+00:00', NULL)""",
        (str(uuid.uuid4()), acc["id"]),
    )
    db_conn.commit()
    result = tools.TOOLS["get_open_positions"]["executor"](
        user_id="u_chat", account_id=acc["id"], args={}, conn=db_conn,
    )
    assert result["count"] == 1
    assert result["positions"][0]["symbol"] == "NVDA"


def test_get_recent_recaps_returns_eod_and_weekly(db_conn):
    from api.services.journal_two import coach_chat_tools as tools
    acc = _seed_account(db_conn)
    for kind, day in (("eod_recap", "2026-05-11"), ("weekly_review", "2026-05-04")):
        db_conn.execute(
            """INSERT INTO j2_coach_outputs
               (id, user_id, account_id, output_type, body, summary, metadata, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            (str(uuid.uuid4()), "u_chat", acc["id"], kind,
             f"{kind} body", f"{kind} summary",
             json.dumps({"day": day, "week_start": day}),
             f"{day}T20:00:00+00:00"),
        )
    db_conn.commit()
    result = tools.TOOLS["get_recent_recaps"]["executor"](
        user_id="u_chat", account_id=acc["id"], args={"kind": "all"}, conn=db_conn,
    )
    assert result["count"] == 2


def test_find_arcs_uses_assembler_detectors(db_conn):
    from api.services.journal_two import coach_chat_tools as tools
    acc = _seed_account(db_conn)
    for day, sym in (("2026-05-07", "TSLA"), ("2026-05-08", "NVDA"), ("2026-05-11", "CRWD")):
        _insert_trade(db_conn, user_id="u_chat", account_id=acc["id"],
                      exit_iso=f"{day}T20:00:00+00:00", setup="Bull Flag",
                      symbol=sym, result="Loss", r_multiple=-1.0, pnl_dollar=-100)
    result = tools.TOOLS["find_arcs"]["executor"](
        user_id="u_chat", account_id=acc["id"], args={"lookback_days": 10}, conn=db_conn,
    )
    assert any("Bull Flag" in arc for arc in result["arcs"])


def test_get_setup_stats_returns_per_setup_breakdown(db_conn):
    from api.services.journal_two import coach_chat_tools as tools
    acc = _seed_account(db_conn)
    for r, setup in ((2.1, "Bull Flag"), (-1.0, "Pullback"), (1.5, "Bull Flag")):
        _insert_trade(db_conn, user_id="u_chat", account_id=acc["id"],
                      exit_iso="2026-05-10T20:00:00+00:00",
                      setup=setup, r_multiple=r,
                      result="Win" if r > 0 else "Loss",
                      pnl_dollar=r * 100)
    result = tools.TOOLS["get_setup_stats"]["executor"](
        user_id="u_chat", account_id=acc["id"], args={}, conn=db_conn,
    )
    assert isinstance(result["setups"], list)
    setups = {s["setup"]: s for s in result["setups"]}
    assert "Bull Flag" in setups


def test_analyze_time_of_day_buckets_by_hour(db_conn):
    from api.services.journal_two import coach_chat_tools as tools
    acc = _seed_account(db_conn)
    # 14:00 ET trades (win) and 15:00 ET trades (loss)
    _insert_trade(db_conn, user_id="u_chat", account_id=acc["id"],
                  exit_iso="2026-05-11T18:00:00+00:00",
                  entry_date="2026-05-11T18:00:00+00:00",  # 14:00 ET
                  result="Win", r_multiple=2.0, pnl_dollar=200)
    _insert_trade(db_conn, user_id="u_chat", account_id=acc["id"],
                  exit_iso="2026-05-11T19:00:00+00:00",
                  entry_date="2026-05-11T19:00:00+00:00",  # 15:00 ET
                  result="Loss", r_multiple=-1.0, pnl_dollar=-100)
    result = tools.TOOLS["analyze_time_of_day"]["executor"](
        user_id="u_chat", account_id=acc["id"], args={"days": 30}, conn=db_conn,
    )
    assert "buckets" in result
    assert isinstance(result["buckets"], dict)


def test_analyze_day_of_week_returns_weekday_buckets(db_conn):
    from api.services.journal_two import coach_chat_tools as tools
    acc = _seed_account(db_conn)
    _insert_trade(db_conn, user_id="u_chat", account_id=acc["id"],
                  exit_iso="2026-05-11T20:00:00+00:00",
                  entry_date="2026-05-11T18:00:00+00:00",  # Mon
                  result="Win", r_multiple=1.0)
    _insert_trade(db_conn, user_id="u_chat", account_id=acc["id"],
                  exit_iso="2026-05-12T20:00:00+00:00",
                  entry_date="2026-05-12T18:00:00+00:00",  # Tue
                  result="Loss", r_multiple=-1.0)
    result = tools.TOOLS["analyze_day_of_week"]["executor"](
        user_id="u_chat", account_id=acc["id"], args={"days": 30}, conn=db_conn,
    )
    assert "buckets" in result


def test_analyze_hold_duration_returns_winner_loser_compare(db_conn):
    from api.services.journal_two import coach_chat_tools as tools
    acc = _seed_account(db_conn)
    # Winners with 4-day holds, losers with 1-day holds (classic "cutting winners")
    for _ in range(3):
        _insert_trade(db_conn, user_id="u_chat", account_id=acc["id"],
                      exit_iso="2026-05-11T20:00:00+00:00",
                      hold_days=4, result="Win", r_multiple=2.0)
    for _ in range(3):
        _insert_trade(db_conn, user_id="u_chat", account_id=acc["id"],
                      exit_iso="2026-05-11T20:00:00+00:00",
                      hold_days=1, result="Loss", r_multiple=-1.0)
    result = tools.TOOLS["analyze_hold_duration"]["executor"](
        user_id="u_chat", account_id=acc["id"], args={"days": 90}, conn=db_conn,
    )
    assert result["winners"]["avg_days"] == 4.0
    assert result["losers"]["avg_days"] == 1.0
    assert result["hint"] in {"cutting_winners_short", "holding_losers", "balanced"}


def test_analyze_sequence_returns_post_outcome_stats(db_conn):
    from api.services.journal_two import coach_chat_tools as tools
    acc = _seed_account(db_conn)
    for day in ("2026-05-04", "2026-05-05", "2026-05-06", "2026-05-07"):
        result_type = "Win" if day == "2026-05-04" else "Loss"
        _insert_trade(db_conn, user_id="u_chat", account_id=acc["id"],
                      exit_iso=f"{day}T20:00:00+00:00",
                      result=result_type, r_multiple=1.5 if result_type == "Win" else -1.0,
                      pnl_dollar=150 if result_type == "Win" else -100)
    result = tools.TOOLS["analyze_sequence"]["executor"](
        user_id="u_chat", account_id=acc["id"],
        args={"prior_outcome": "Win", "n": 3}, conn=db_conn,
    )
    assert "trade_count" in result


def test_analyze_sizing_curve_runs_without_error(db_conn):
    from api.services.journal_two import coach_chat_tools as tools
    acc = _seed_account(db_conn)
    _insert_trade(db_conn, user_id="u_chat", account_id=acc["id"],
                  exit_iso="2026-05-11T20:00:00+00:00",
                  shares=100, entry_price=100.0, original_stop=98.0,
                  r_multiple=1.0, pnl_dollar=100, result="Win")
    result = tools.TOOLS["analyze_sizing_curve"]["executor"](
        user_id="u_chat", account_id=acc["id"], args={"days": 180}, conn=db_conn,
    )
    assert "buckets" in result


def test_analyze_correlation_returns_dict(db_conn):
    from api.services.journal_two import coach_chat_tools as tools
    acc = _seed_account(db_conn)
    result = tools.TOOLS["analyze_correlation"]["executor"](
        user_id="u_chat", account_id=acc["id"], args={}, conn=db_conn,
    )
    assert "open_positions_overlap" in result


def test_compare_setups_returns_side_by_side(db_conn):
    from api.services.journal_two import coach_chat_tools as tools
    acc = _seed_account(db_conn)
    _insert_trade(db_conn, user_id="u_chat", account_id=acc["id"],
                  exit_iso="2026-05-11T20:00:00+00:00",
                  setup="Bull Flag", r_multiple=2.0, result="Win", pnl_dollar=200)
    _insert_trade(db_conn, user_id="u_chat", account_id=acc["id"],
                  exit_iso="2026-05-11T20:00:00+00:00",
                  setup="Pullback", r_multiple=-1.0, result="Loss", pnl_dollar=-100)
    result = tools.TOOLS["compare_setups"]["executor"](
        user_id="u_chat", account_id=acc["id"],
        args={"setup_a": "Bull Flag", "setup_b": "Pullback"}, conn=db_conn,
    )
    assert "setup_a" in result
    assert "setup_b" in result
    assert result["setup_a"]["setup"] == "Bull Flag"


# ── Action tools ─────────────────────────────────────────────────────────────


def test_tag_trade_preview_returns_narration(db_conn):
    from api.services.journal_two import coach_chat_tools as tools
    acc = _seed_account(db_conn)
    trade_id = str(uuid.uuid4())
    db_conn.execute(
        """INSERT INTO j2_trades (id, user_id, position_id, symbol, side, shares,
           entry_price, entry_date, exit_price, exit_date, original_stop, setup,
           notes, pnl_dollar, pnl_percent, r_multiple, hold_days, result,
           context_at_entry, created_at, account_id, mistake_tags, emotion_tags, fees)
           VALUES (?, 'u_chat', ?, 'NVDA', 'Long', 100, 200.0,
           '2026-05-11T18:00:00+00:00', 205.0, '2026-05-11T20:00:00+00:00',
           198.0, 'Bull Flag', NULL, 500, 2.5, 2.0, 0, 'Win',
           '{}', '2026-05-11T20:00:00+00:00', ?, '[]', '[]', 0)""",
        (trade_id, str(uuid.uuid4()), acc["id"]),
    )
    db_conn.commit()
    preview = tools.TOOLS["tag_trade"]["preview"](
        user_id="u_chat", account_id=acc["id"],
        args={"trade_id": trade_id, "mistake_tags": ["FOMO"]}, conn=db_conn,
    )
    assert "narration" in preview
    assert "NVDA" in preview["narration"] or "trade" in preview["narration"].lower()


def test_tag_trade_execute_appends_tags(db_conn):
    from api.services.journal_two import coach_chat_tools as tools
    acc = _seed_account(db_conn)
    trade_id = str(uuid.uuid4())
    db_conn.execute(
        """INSERT INTO j2_trades (id, user_id, position_id, symbol, side, shares,
           entry_price, entry_date, exit_price, exit_date, original_stop, setup,
           notes, pnl_dollar, pnl_percent, r_multiple, hold_days, result,
           context_at_entry, created_at, account_id, mistake_tags, emotion_tags, fees)
           VALUES (?, 'u_chat', ?, 'NVDA', 'Long', 100, 200.0,
           '2026-05-11T18:00:00+00:00', 205.0, '2026-05-11T20:00:00+00:00',
           198.0, 'Bull Flag', NULL, 500, 2.5, 2.0, 0, 'Win',
           '{}', '2026-05-11T20:00:00+00:00', ?, '[]', '[]', 0)""",
        (trade_id, str(uuid.uuid4()), acc["id"]),
    )
    db_conn.commit()
    result = tools.TOOLS["tag_trade"]["executor"](
        user_id="u_chat", account_id=acc["id"],
        args={"trade_id": trade_id, "mistake_tags": ["FOMO"], "emotion_tags": ["rushed"]},
        conn=db_conn,
    )
    assert result["ok"] is True
    row = db_conn.execute(
        "SELECT mistake_tags, emotion_tags FROM j2_trades WHERE id = ?", (trade_id,),
    ).fetchone()
    assert "FOMO" in row["mistake_tags"]
    assert "rushed" in row["emotion_tags"]


def test_set_weekly_focus_writes_to_metadata(db_conn):
    from api.services.journal_two import coach_chat_tools as tools
    acc = _seed_account(db_conn)
    result = tools.TOOLS["set_weekly_focus"]["executor"](
        user_id="u_chat", account_id=acc["id"],
        args={"text": "Skip Pullbacks until Friday."}, conn=db_conn,
    )
    assert result["ok"] is True
    row = db_conn.execute(
        "SELECT metadata FROM j2_coach_outputs WHERE user_id = ? AND output_type = 'weekly_review' ORDER BY created_at DESC LIMIT 1",
        ("u_chat",),
    ).fetchone()
    meta = json.loads(row["metadata"])
    assert "Skip Pullbacks" in (meta.get("this_weeks_focus") or "")


def test_mute_setup_appends_to_account_list(db_conn):
    from api.services.journal_two import coach_chat_tools as tools
    acc = _seed_account(db_conn)
    result = tools.TOOLS["mute_setup"]["executor"](
        user_id="u_chat", account_id=acc["id"],
        args={"setup_name": "Pullback", "until_date": "2026-05-25"}, conn=db_conn,
    )
    assert result["ok"] is True
    row = db_conn.execute("SELECT muted_setups FROM j2_accounts WHERE id = ?", (acc["id"],)).fetchone()
    muted = json.loads(row["muted_setups"])
    assert any(m["setup_name"] == "Pullback" for m in muted)


def test_unmute_setup_removes_from_list(db_conn):
    from api.services.journal_two import coach_chat_tools as tools
    acc = _seed_account(db_conn)
    db_conn.execute(
        "UPDATE j2_accounts SET muted_setups = ? WHERE id = ?",
        (json.dumps([{"setup_name": "Pullback", "until_date": "2026-05-25"}]), acc["id"]),
    )
    db_conn.commit()
    result = tools.TOOLS["unmute_setup"]["executor"](
        user_id="u_chat", account_id=acc["id"], args={"setup_name": "Pullback"}, conn=db_conn,
    )
    assert result["ok"] is True
    row = db_conn.execute("SELECT muted_setups FROM j2_accounts WHERE id = ?", (acc["id"],)).fetchone()
    muted = json.loads(row["muted_setups"])
    assert not any(m["setup_name"] == "Pullback" for m in muted)


def test_set_a_plus_setups_adds_and_removes(db_conn):
    from api.services.journal_two import coach_chat_tools as tools
    acc = _seed_account(db_conn)
    result = tools.TOOLS["set_a_plus_setups"]["executor"](
        user_id="u_chat", account_id=acc["id"],
        args={"add": ["High Tight Flag"], "remove": []}, conn=db_conn,
    )
    assert result["ok"] is True
    row = db_conn.execute("SELECT a_plus_setups FROM j2_accounts WHERE id = ?", (acc["id"],)).fetchone()
    a_plus = json.loads(row["a_plus_setups"])
    assert "High Tight Flag" in a_plus


def test_update_discipline_preview_includes_warnings(db_conn):
    from api.services.journal_two import coach_chat_tools as tools
    acc = _seed_account(db_conn)
    preview = tools.TOOLS["update_discipline_setting"]["preview"](
        user_id="u_chat", account_id=acc["id"],
        args={"field": "maxRiskPerTradePct", "value": 2.5}, conn=db_conn,
    )
    # Even without a current value set, preview should return the shape
    assert isinstance(preview.get("contextual_warnings"), list)
    assert "confirm_label" in preview
    assert "elevated" in preview


def test_update_discipline_execute_changes_setting(db_conn):
    from api.services.journal_two import coach_chat_tools as tools
    acc = _seed_account(db_conn)
    result = tools.TOOLS["update_discipline_setting"]["executor"](
        user_id="u_chat", account_id=acc["id"],
        args={"field": "maxRiskPerTradePct", "value": 1.0}, conn=db_conn,
    )
    assert result["ok"] is True
    settings = tools.TOOLS["get_account_settings"]["executor"](
        user_id="u_chat", account_id=acc["id"], args={}, conn=db_conn,
    )["settings"]
    assert float(settings["maxRiskPerTradePct"]) == 1.0


def test_schedule_paper_only_day_appends_to_list(db_conn):
    from api.services.journal_two import coach_chat_tools as tools
    acc = _seed_account(db_conn)
    result = tools.TOOLS["schedule_paper_only_day"]["executor"](
        user_id="u_chat", account_id=acc["id"],
        args={"date": "2026-05-15"}, conn=db_conn,
    )
    assert result["ok"] is True
    row = db_conn.execute("SELECT paper_only_days FROM j2_accounts WHERE id = ?", (acc["id"],)).fetchone()
    days = json.loads(row["paper_only_days"])
    assert any(d["date"] == "2026-05-15" for d in days)


# ── Onboarding tools (read + silent action) ─────────────────────────────────


def test_get_onboarding_progress_empty_session(db_conn):
    from api.services.journal_two import coach_chat_tools as tools
    acc = _seed_account(db_conn)
    db_conn.execute(
        "UPDATE j2_accounts SET onboarding_session_id = ? WHERE id = ?",
        ("sess_1", acc["id"]),
    )
    db_conn.commit()
    result = tools.TOOLS["get_onboarding_progress"]["executor"](
        user_id="u_chat", account_id=acc["id"], args={}, conn=db_conn,
    )
    assert result["session_id"] == "sess_1"
    assert result["questions_asked"] == 0
    assert set(result["categories_remaining"]) == {
        "identity", "account", "style", "setups", "sizing",
        "strengths", "weaknesses", "psychology", "process", "goals",
    }
    assert result["categories_covered"] == []


def test_get_onboarding_progress_with_some_answers(db_conn):
    from api.services.journal_two import coach_chat_tools as tools
    acc = _seed_account(db_conn)
    db_conn.execute(
        "UPDATE j2_accounts SET onboarding_session_id = ? WHERE id = ?",
        ("sess_2", acc["id"]),
    )
    for i, cat in enumerate(["identity", "style", "style"]):
        db_conn.execute(
            """INSERT INTO j2_onboarding_responses
               (id, user_id, account_id, session_id, category, question, answer, asked_at)
               VALUES (?, 'u_chat', ?, 'sess_2', ?, ?, ?, ?)""",
            (str(uuid.uuid4()), acc["id"], cat, f"Q{i}", f"A{i}", f"2026-05-12T1{i}:00:00+00:00"),
        )
    db_conn.commit()
    result = tools.TOOLS["get_onboarding_progress"]["executor"](
        user_id="u_chat", account_id=acc["id"], args={}, conn=db_conn,
    )
    assert result["questions_asked"] == 3
    assert set(result["categories_covered"]) == {"identity", "style"}
    assert "identity" not in result["categories_remaining"]
    assert "style" not in result["categories_remaining"]


def test_record_onboarding_answer_inserts_row(db_conn):
    from api.services.journal_two import coach_chat_tools as tools
    acc = _seed_account(db_conn)
    db_conn.execute(
        "UPDATE j2_accounts SET onboarding_session_id = ? WHERE id = ?",
        ("sess_3", acc["id"]),
    )
    db_conn.commit()
    result = tools.TOOLS["record_onboarding_answer"]["executor"](
        user_id="u_chat", account_id=acc["id"],
        args={"category": "identity", "question": "Years trading?", "answer": "3 years"},
        conn=db_conn,
    )
    assert result["ok"] is True
    row = db_conn.execute(
        "SELECT category, question, answer, session_id FROM j2_onboarding_responses WHERE account_id = ?",
        (acc["id"],),
    ).fetchone()
    assert row["category"] == "identity"
    assert row["question"] == "Years trading?"
    assert row["answer"] == "3 years"
    assert row["session_id"] == "sess_3"


def test_record_onboarding_answer_rejects_unknown_category(db_conn):
    from api.services.journal_two import coach_chat_tools as tools
    acc = _seed_account(db_conn)
    db_conn.execute(
        "UPDATE j2_accounts SET onboarding_session_id = ? WHERE id = ?",
        ("sess_4", acc["id"]),
    )
    db_conn.commit()
    result = tools.TOOLS["record_onboarding_answer"]["executor"](
        user_id="u_chat", account_id=acc["id"],
        args={"category": "BAD_CAT", "question": "Q", "answer": "A"},
        conn=db_conn,
    )
    assert result["ok"] is False
    assert "category" in result.get("error", "").lower()


def test_record_onboarding_answer_marked_no_confirm_required(db_conn):
    """Silent archive write — should NOT require_confirm in the catalog."""
    from api.services.journal_two import coach_chat_tools as tools
    spec = tools.TOOLS["record_onboarding_answer"]
    assert spec["requires_confirm"] is False
