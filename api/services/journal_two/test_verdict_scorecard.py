"""P6 Task P6-2 — verdict-vs-outcome scorecard.

`get_verdict_scorecard` scores Compass GO/HOLD/SKIP pre-trade verdicts against
actual closed-trade outcomes. The verdict a trade was entered against is stored
trade-side in `j2_trades.context_at_entry`
(`{compass_verdict_id, compass_verdict_label}`, or `{}` when none). GO/HOLD →
`taken`; SKIP-taken-anyway → `overridden` + a hero loss-rate headline; a SKIP
verdict no trade ever took → `obeyed` (anti-join over j2_verdicts). Trades with
`{}` are excluded from the scored buckets but counted in coverage.

Equity-only (mirrors test_playbook_stats.py's temp-DB fixture + helper).
"""
from __future__ import annotations

import importlib
import json
import os
import sqlite3
import tempfile
import uuid
from datetime import datetime, timezone

import pytest


U = "u_vs"


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


def _seed_account(db_conn, user_id=U):
    from api.services.journal_two import accounts as accounts_service
    return accounts_service.get_or_migrate_default_account(user_id, conn=db_conn)


def _ctx_text(context):
    """A dict → JSON; a str → verbatim (lets a test inject malformed TEXT);
    None → '{}' (the pre-verdict / broker / CSV sentinel)."""
    if context is None:
        return "{}"
    if isinstance(context, str):
        return context
    return json.dumps(context)


def _insert_trade(
    conn, *, user_id, account_id,
    setup="VCP", symbol="NVDA", side="Long",
    result="Win", pnl=100, r=1.5, fees=0, exit_iso=None,
    context=None,
):
    """Insert one closed equity trade. `context` sets `context_at_entry`."""
    tid = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()
    exit_iso = exit_iso or now
    conn.execute(
        """
        INSERT INTO j2_trades (
            id, user_id, position_id, symbol, side, shares,
            entry_price, entry_date, exit_price, exit_date,
            original_stop, setup, notes, pnl_dollar, pnl_percent,
            r_multiple, hold_days, result, context_at_entry,
            account_id, fees, created_at, trading_day_et, hour_et
        ) VALUES (?, ?, 'manual', ?, ?, 100, 500, ?, 510, ?,
                  490, ?, NULL, ?, 0.02, ?, 1, ?, ?, ?, ?, ?, NULL, NULL)
        """,
        (
            tid, user_id, symbol, side, exit_iso, exit_iso,
            setup, pnl, r, result, _ctx_text(context), account_id, fees, now,
        ),
    )
    conn.commit()
    return tid


def _insert_verdict(
    conn, *, user_id, account_id, vid=None, label="SKIP",
    symbol="NVDA", side="Long", created_at=None, source="llm",
):
    vid = vid or str(uuid.uuid4())
    created_at = created_at or datetime.now(timezone.utc).isoformat()
    conn.execute(
        """
        INSERT INTO j2_verdicts (
            id, user_id, account_id, symbol, side, label,
            paragraph, source, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'p', ?, ?)
        """,
        (vid, user_id, account_id, symbol, side, label, source, created_at),
    )
    conn.commit()
    return vid


def _by_label(out):
    return {b["label"]: b for b in out["byVerdict"]}


# ── GO taken: win + loss → n:2, winRate 0.5 ──────────────────────────────────


def test_go_winner_and_loser_taken_winrate(db_conn):
    from api.services.journal_two import verdict_scorecard
    acc = _seed_account(db_conn)
    _insert_trade(db_conn, user_id=U, account_id=acc["id"], result="Win", pnl=200, r=2.0,
                  context={"compass_verdict_id": "g1", "compass_verdict_label": "GO"})
    _insert_trade(db_conn, user_id=U, account_id=acc["id"], result="Loss", pnl=-100, r=-1.0,
                  context={"compass_verdict_id": "g2", "compass_verdict_label": "GO"})
    out = verdict_scorecard.get_verdict_scorecard(U, acc["id"], conn=db_conn)
    go = _by_label(out)["GO"]["taken"]
    assert go["n"] == 2
    assert go["winRate"] == 0.5
    assert go["avgR"] == 0.5              # mean(2.0, -1.0)
    assert go["netPnl"] == 100.0         # 200 + (-100), fees 0
    assert out["coverage"] == {"tradesWithVerdict": 2, "tradesTotal": 2}


# ── SKIP overridden + headline loss-rate ─────────────────────────────────────


def test_skip_taken_anyway_overridden_and_headline(db_conn):
    from api.services.journal_two import verdict_scorecard
    acc = _seed_account(db_conn)
    # Took a SKIP anyway → lost.
    _insert_trade(db_conn, user_id=U, account_id=acc["id"], result="Loss", pnl=-150, r=-1.5,
                  context={"compass_verdict_id": "s1", "compass_verdict_label": "SKIP"})
    out = verdict_scorecard.get_verdict_scorecard(U, acc["id"], conn=db_conn)
    skip = _by_label(out)["SKIP"]
    assert skip["overridden"]["n"] >= 1
    assert skip["overridden"]["n"] == 1
    assert skip["overridden"]["winRate"] == 0.0    # 0 wins / 1 decisive
    assert skip["overridden"]["netPnl"] == -150.0
    hl = out["skipOverrideHeadline"]
    assert hl is not None
    assert hl["n"] == 1
    assert hl["lossRate"] == 1.0                    # took SKIP → lost 100%
    assert hl["losses"] == 1                        # honest integer count …
    assert hl["decisive"] == 1                      # … over the decisive denominator
    assert hl["netPnl"] == -150.0


# ── Headline: n counts BE, but losses/decisive are decisive-only ─────────────


def test_skip_override_headline_n_includes_be_but_decisive_excludes_it(db_conn):
    from api.services.journal_two import verdict_scorecard
    acc = _seed_account(db_conn)
    # Two SKIPs taken anyway: one Loss + one breakeven. The headline `n` counts
    # both (2), but losses/decisive/lossRate are over the DECISIVE set only (1).
    _insert_trade(db_conn, user_id=U, account_id=acc["id"], result="Loss", pnl=-150, r=-1.5,
                  context={"compass_verdict_id": "s1", "compass_verdict_label": "SKIP"})
    _insert_trade(db_conn, user_id=U, account_id=acc["id"], result="BE", pnl=0, r=0.0,
                  context={"compass_verdict_id": "s2", "compass_verdict_label": "SKIP"})
    out = verdict_scorecard.get_verdict_scorecard(U, acc["id"], conn=db_conn)
    hl = out["skipOverrideHeadline"]
    assert hl["n"] == 2                # total overridden, breakeven included
    assert hl["decisive"] == 1         # only the Loss reached a decision
    assert hl["losses"] == 1
    assert hl["lossRate"] == 1.0       # 1 loss / 1 decisive (BE not in denominator)


# ── SKIP obeyed: verdict with no matching trade ──────────────────────────────


def test_skip_verdict_with_no_trade_counts_as_obeyed(db_conn):
    from api.services.journal_two import verdict_scorecard
    acc = _seed_account(db_conn)
    # An untaken SKIP verdict → obeyed.
    _insert_verdict(db_conn, user_id=U, account_id=acc["id"], vid="skip-obeyed-1", label="SKIP")
    # A taken SKIP verdict (row + a trade referencing it) → overridden, NOT obeyed.
    _insert_verdict(db_conn, user_id=U, account_id=acc["id"], vid="skip-taken-1", label="SKIP")
    _insert_trade(db_conn, user_id=U, account_id=acc["id"], result="Loss", pnl=-50, r=-1.0,
                  context={"compass_verdict_id": "skip-taken-1", "compass_verdict_label": "SKIP"})
    out = verdict_scorecard.get_verdict_scorecard(U, acc["id"], conn=db_conn)
    skip = _by_label(out)["SKIP"]
    assert skip["obeyed"] == 1            # only the untaken verdict
    assert skip["overridden"]["n"] == 1  # the taken one is overridden, not obeyed


# ── Empty context '{}' → excluded from buckets, counted in total ─────────────


def test_empty_context_excluded_from_buckets_counted_in_total(db_conn):
    from api.services.journal_two import verdict_scorecard
    acc = _seed_account(db_conn)
    _insert_trade(db_conn, user_id=U, account_id=acc["id"], result="Win", pnl=100, r=1.0,
                  context={})  # pre-verdict / broker / CSV → '{}'
    _insert_trade(db_conn, user_id=U, account_id=acc["id"], result="Win", pnl=50, r=0.5,
                  context={"compass_verdict_id": "g1", "compass_verdict_label": "GO"})
    out = verdict_scorecard.get_verdict_scorecard(U, acc["id"], conn=db_conn)
    assert out["coverage"] == {"tradesWithVerdict": 1, "tradesTotal": 2}
    assert _by_label(out)["GO"]["taken"]["n"] == 1


# ── Breakeven excluded from the winRate denominator ──────────────────────────


def test_breakeven_excluded_from_winrate_denominator(db_conn):
    from api.services.journal_two import verdict_scorecard
    acc = _seed_account(db_conn)
    _insert_trade(db_conn, user_id=U, account_id=acc["id"], result="Win", pnl=100, r=1.0,
                  context={"compass_verdict_id": "g1", "compass_verdict_label": "GO"})
    _insert_trade(db_conn, user_id=U, account_id=acc["id"], result="BE", pnl=0, r=0.0,
                  context={"compass_verdict_id": "g2", "compass_verdict_label": "GO"})
    out = verdict_scorecard.get_verdict_scorecard(U, acc["id"], conn=db_conn)
    go = _by_label(out)["GO"]["taken"]
    assert go["n"] == 2
    assert go["winRate"] == 1.0          # 1 win / 1 decisive — BE not in denominator


# ── Empty account → empty structure + null headline ──────────────────────────


def test_empty_account_empty_structure_null_headline(db_conn):
    from api.services.journal_two import verdict_scorecard
    acc = _seed_account(db_conn)
    out = verdict_scorecard.get_verdict_scorecard(U, acc["id"], conn=db_conn)
    bl = _by_label(out)
    assert bl["GO"]["taken"] == {"n": 0, "winRate": None, "avgR": None, "netPnl": 0.0}
    assert bl["HOLD"]["taken"] == {"n": 0, "winRate": None, "avgR": None, "netPnl": 0.0}
    assert bl["SKIP"]["overridden"] == {"n": 0, "winRate": None, "avgR": None, "netPnl": 0.0}
    assert bl["SKIP"]["obeyed"] == 0
    assert out["coverage"] == {"tradesWithVerdict": 0, "tradesTotal": 0}
    assert out["skipOverrideHeadline"] is None


# ── User isolation ───────────────────────────────────────────────────────────


def test_user_isolation(db_conn):
    from api.services.journal_two import verdict_scorecard
    acc = _seed_account(db_conn)
    _insert_trade(db_conn, user_id=U, account_id=acc["id"], result="Win", pnl=100, r=1.0,
                  context={"compass_verdict_id": "mine", "compass_verdict_label": "GO"})
    # Another user's trade + SKIP verdict in the same account_id must NOT leak.
    _insert_trade(db_conn, user_id="u_other", account_id=acc["id"], result="Win", pnl=100, r=1.0,
                  context={"compass_verdict_id": "theirs", "compass_verdict_label": "GO"})
    _insert_verdict(db_conn, user_id="u_other", account_id=acc["id"], label="SKIP")
    out = verdict_scorecard.get_verdict_scorecard(U, acc["id"], conn=db_conn)
    assert out["coverage"]["tradesTotal"] == 1
    assert _by_label(out)["GO"]["taken"]["n"] == 1
    assert _by_label(out)["SKIP"]["obeyed"] == 0   # other user's SKIP verdict excluded


# ── Defensive parse: malformed context never crashes ─────────────────────────


def test_malformed_context_treated_as_no_verdict(db_conn):
    from api.services.journal_two import verdict_scorecard
    acc = _seed_account(db_conn)
    _insert_trade(db_conn, user_id=U, account_id=acc["id"], result="Win", pnl=100, r=1.0,
                  context="{not valid json")       # raw malformed TEXT
    _insert_trade(db_conn, user_id=U, account_id=acc["id"], result="Win", pnl=50, r=0.5,
                  context="[1, 2, 3]")              # valid JSON but not a dict
    out = verdict_scorecard.get_verdict_scorecard(U, acc["id"], conn=db_conn)
    assert out["coverage"] == {"tradesWithVerdict": 0, "tradesTotal": 2}
    assert out["skipOverrideHeadline"] is None


# ── Scope (FilterSpec) narrows + bounds the obeyed verdict window ─────────────


def test_scope_symbol_narrows_and_hold_bucket(db_conn):
    from api.services.journal_two import verdict_scorecard
    from api.services.journal_two.filters import FilterSpec
    acc = _seed_account(db_conn)
    _insert_trade(db_conn, user_id=U, account_id=acc["id"], symbol="NVDA", result="Win", pnl=100, r=1.0,
                  context={"compass_verdict_id": "h1", "compass_verdict_label": "HOLD"})
    _insert_trade(db_conn, user_id=U, account_id=acc["id"], symbol="AMD", result="Loss", pnl=-100, r=-1.0,
                  context={"compass_verdict_id": "h2", "compass_verdict_label": "HOLD"})
    out = verdict_scorecard.get_verdict_scorecard(
        U, acc["id"], spec=FilterSpec(symbol="nvda"), conn=db_conn,
    )
    hold = _by_label(out)["HOLD"]["taken"]
    assert hold["n"] == 1
    assert hold["netPnl"] == 100.0
    assert out["coverage"]["tradesTotal"] == 1
