"""Wave 13 lane 13B -- My Playbook (`playbook_stats` uncertainty fields, `playbook_patterns`, the
router `notebook_playbook`).

Rails, each a ruling:
  * STATS PINNED ON FIXTURE TRADES: a 12-trade setup's win rate, avg R and expectancy, with their
    R3 wording and their ranges, pinned to independently derived values (scipy's Wilson and t);
    a 9-trade setup is "too few to judge" with no range; a 25-trade setup is normal;
  * ONE AUTHORITY: the route's setups ARE `get_playbook_stats(..., with_trades=True)`, byte for
    byte; the default call (the Insights cards) carries no drill list;
  * THE DRILL: every number opens the trades it came from -- the drill list is read from the same
    rows, so its length IS the count, its wins ARE the win count;
  * MIRROR: 30 broker trades in, 30 accounted for (tagged on cards, untagged counted, never
    hidden), and the trades table byte-identical after the read;
  * PATTERNS: fixed word lists; counts AND both n; the minimums; every finding cites its trades
    and notes, and every cited note really said the word AS IT STOOD AT ENTRY; a note written or
    edited after entry is not read; the account taxonomy is the word list when it has one;
  * THE GATE: 404 before the session while the flag is off; member-scoped when on.
"""
from __future__ import annotations

import hashlib
import importlib
import json
import os
import tempfile
import uuid

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.middleware import auth_middleware as authmw

FLAG = "NOTEBOOK_PLAYBOOK_ENABLED"
U, OTHER = "user-pb-a", "user-pb-b"

# The 12-trade Breakout fixture: 7 wins, 5 losses. Oracle (scipy 1.17): Wilson(7, 12) =
# (0.31951, 0.80674); mean R 0.541667, sd 1.440618, t(0.975, 11) = 2.201 -> (-0.37366, 1.45699).
BREAKOUT_R = [2.0, -1.0, 1.5, -1.0, 3.0, -0.5, 0.8, -1.0, 2.2, -1.0, 1.1, 0.4]


# ── fixtures ────────────────────────────────────────────────────────────────────────────

@pytest.fixture
def db_path(monkeypatch):
    tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
    tmp.close()
    monkeypatch.setenv("AUTH_DB_PATH", tmp.name)
    from api.services import auth_db
    importlib.reload(auth_db)
    auth_db.init_db()
    conn = auth_db.get_connection()
    for uid in (U, OTHER):
        conn.execute("INSERT INTO users (id, email, password_hash, display_name, role) VALUES (?,?,?,?,?)",
                     (uid, f"{uid}@example.com", "x", uid, "member"))
    conn.commit()
    conn.close()
    yield tmp.name
    for suffix in ("", "-wal", "-shm"):
        try:
            os.unlink(tmp.name + suffix)
        except OSError:
            pass


@pytest.fixture
def conn(db_path):
    from api.services.auth_db import get_connection
    c = get_connection()
    yield c
    c.close()


@pytest.fixture
def client(db_path, monkeypatch):
    monkeypatch.setenv(FLAG, "1")
    from api.routers import notebook_playbook
    fa = FastAPI()
    fa.include_router(notebook_playbook.router)
    fa.dependency_overrides[authmw.get_current_user] = lambda: {"id": U, "role": "member"}
    yield TestClient(fa)
    fa.dependency_overrides.clear()


_DAY = [0]


def add_trade(conn, *, r, setup=None, symbol="NVDA", user=U, source=None, external_id=None,
              entry_date=None, exit_date=None, account_id=None, tid=None, result=None):
    _DAY[0] += 1
    d = _DAY[0]
    tid = tid or f"t-{uuid.uuid4().hex[:10]}"
    entry_date = entry_date or f"2026-0{1 + (d // 28) % 8}-{1 + d % 28:02d}T14:30:00+00:00"
    exit_date = exit_date or entry_date.replace("T14:30", "T19:30")
    res = result or ("Win" if r > 0 else "Loss" if r < 0 else "BE")
    conn.execute(
        "INSERT INTO j2_trades (id, user_id, position_id, symbol, side, shares, entry_price, entry_date,"
        " exit_price, exit_date, original_stop, setup, notes, pnl_dollar, pnl_percent, r_multiple, hold_days,"
        " result, context_at_entry, created_at, source, external_id, account_id)"
        " VALUES (?,?,?,?,?,?,?,?,?,?,?,?,NULL,?,?,?,1,?,?,?,?,?,?)",
        (tid, user, f"pos-{tid}", symbol, "Long", 100, 100.0, entry_date, 100.0 + r, exit_date, 99.0, setup,
         round(r * 100, 2), r / 100, r, res, "{}", exit_date, source, external_id, account_id))
    conn.commit()
    return tid


def doc(text):
    return {"type": "doc", "content": [{"type": "paragraph", "content": [{"type": "text", "text": text}]}]}


def add_note(conn, *, text, created, updated=None, user=U, title="Pre-trade", nid=None):
    nid = nid or f"n-{uuid.uuid4().hex[:10]}"
    conn.execute(
        "INSERT INTO j2_notes (id, user_id, title, body_json, body_plain, ticker, tags, created_at, updated_at)"
        " VALUES (?,?,?,?,?,?,?,?,?)",
        (nid, user, title, json.dumps(doc(text)), text, "NVDA", "[]", created, updated or created))
    conn.commit()
    return nid


def link(conn, nid, tid, user=U):
    conn.execute("INSERT INTO j2_note_embeds (note_id, user_id, position, widget_id, symbol, trade_ref,"
                 " trade_ref_type) VALUES (?,?,?,?,?,?,?)", (nid, user, 0, "chart", "NVDA", tid, "equity_trade"))
    conn.commit()


def trade_entry(conn, tid):
    return conn.execute("SELECT entry_date FROM j2_trades WHERE id = ?", (tid,)).fetchone()["entry_date"]


def before(iso, days=1):
    from datetime import datetime, timedelta
    return (datetime.fromisoformat(iso) - timedelta(days=days)).isoformat()


def after(iso, days=1):
    from datetime import datetime, timedelta
    return (datetime.fromisoformat(iso) + timedelta(days=days)).isoformat()


def noted_trade(conn, *, r, text, setup="Breakout", source=None):
    """A trade with a note linked to it, written the day before entry."""
    tid = add_trade(conn, r=r, setup=setup, source=source, external_id=(f"x-{uuid.uuid4().hex[:6]}" if source else None))
    nid = add_note(conn, text=text, created=before(trade_entry(conn, tid)))
    link(conn, nid, tid)
    return tid, nid


def table_hash(conn):
    rows = conn.execute("SELECT * FROM j2_trades ORDER BY id").fetchall()
    return hashlib.sha256(json.dumps([list(r) for r in rows], default=str).encode()).hexdigest()


# ── the stats, pinned ──────────────────────────────────────────────────────────────────────

def seed_three_setups(conn):
    for r in BREAKOUT_R:
        add_trade(conn, r=r, setup="Breakout")
    for i in range(9):
        add_trade(conn, r=(1.0 if i % 3 else -1.0), setup="EP")
    for i in range(25):
        add_trade(conn, r=(2.0 if i % 5 < 2 else -1.0), setup="Pullback")
    for _ in range(3):
        add_trade(conn, r=1.0, setup=None)


def by_setup(payload):
    return {s["setup"]: s for s in payload["setups"]}


def test_stats_are_pinned_on_fixture_trades(conn, client):
    seed_three_setups(conn)
    p = client.get("/api/j2/my-playbook").json()
    s = by_setup(p)
    b = s["Breakout"]
    assert (b["tradeCount"], b["winCount"], b["lossCount"]) == (12, 7, 5)
    assert b["sample"] == {"n": 12, "band": "thin", "wording": "thin sample"}
    assert b["winRateStat"] == {"k": 7, "n": 12, "rate": 0.5833, "band": "thin", "wording": "thin sample",
                                "range": [0.32, 0.807]}
    assert b["avgRStat"] == {"n": 12, "mean": 0.5417, "band": "thin", "wording": "thin sample",
                             "range": [-0.374, 1.457]}
    # Expectancy is the same mean in dollars (pnl = R x 100). With the TABLED t(0.975, 11) = 2.201
    # the upper end is 54.1667 + 2.201 x 144.0618 / sqrt(12) = 145.7000 (scipy's unrounded t gives
    # 145.699; the R range above hides that difference in its third decimal).
    assert b["expectancyStat"]["mean"] == 54.1667 and b["expectancyStat"]["range"] == [-37.366, 145.7]
    # The existing numbers are untouched.
    assert b["winRate"] == pytest.approx(7 / 12) and b["avgR"] == 0.5417

    ep = s["EP"]
    assert ep["sample"]["band"] == "too_few" and ep["sample"]["wording"] == "too few to judge"
    assert ep["winRateStat"]["range"] is None and ep["avgRStat"]["range"] is None
    assert ep["winRateStat"]["rate"] == 0.6667   # the number rides along, for the reveal

    pb = s["Pullback"]
    assert pb["sample"] == {"n": 25, "band": "normal", "wording": None}
    assert pb["winRateStat"]["k"] == 10 and pb["winRateStat"]["range"] is None

    assert p["untagged"] == {"count": 3}
    assert p["sample"]["tooFewBelow"] == 10 and p["sample"]["normalFrom"] == 25


def test_the_route_composes_the_one_authority_and_computes_nothing(conn, client):
    seed_three_setups(conn)
    from api.services.journal_two import playbook_stats
    p = client.get("/api/j2/my-playbook").json()
    assert p["setups"] == json.loads(json.dumps(playbook_stats.get_playbook_stats(U, conn=conn, with_trades=True)))
    # The Insights cards' default call carries no drill list (the field is opt-in).
    assert all("trades" not in r for r in playbook_stats.get_playbook_stats(U, conn=conn))


def test_every_number_opens_its_trades(conn, client):
    seed_three_setups(conn)
    for rec in client.get("/api/j2/my-playbook").json()["setups"]:
        trades = rec["trades"]
        assert len(trades) == rec["tradeCount"]
        assert sum(1 for t in trades if t["result"] == "Win") == rec["winCount"]
        assert sum(1 for t in trades if t["result"] == "Loss") == rec["lossCount"]
        assert round(sum(t["pnlDollar"] for t in trades), 2) == rec["totalPnlDollar"]
        rs = [t["rMultiple"] for t in trades if t["rMultiple"] is not None]
        assert len(rs) == rec["avgRStat"]["n"]


def test_broker_trades_are_mirrored_never_filtered(conn, client):
    for i in range(30):
        setup = ["Breakout", "EP", None][i % 3]
        add_trade(conn, r=(1.0 if i % 2 else -1.0), setup=setup, source="broker", external_id=f"snap-{i}")
    h0 = table_hash(conn)
    p = client.get("/api/j2/my-playbook").json()
    on_cards = sum(r["tradeCount"] for r in p["setups"])
    assert on_cards == 20 and p["untagged"]["count"] == 10 and on_cards + p["untagged"]["count"] == 30
    assert {t["source"] for r in p["setups"] for t in r["trades"]} == {"broker"}
    assert table_hash(conn) == h0          # a read writes nothing


def test_another_members_trades_never_appear(conn, client):
    add_trade(conn, r=1.0, setup="Breakout", user=OTHER)
    add_trade(conn, r=1.0, setup="Breakout")
    p = client.get("/api/j2/my-playbook").json()
    assert [r["tradeCount"] for r in p["setups"]] == [1]
    p2 = client.get("/api/j2/my-playbook", params={"accountId": "someone-elses"}).json()
    assert p2["setups"] == [] and p2["untagged"]["count"] == 0


# ── the gate ────────────────────────────────────────────────────────────────────────────────

def test_404_while_the_flag_is_off_before_any_session(db_path, monkeypatch):
    monkeypatch.delenv(FLAG, raising=False)
    from api.routers import notebook_playbook
    fa = FastAPI()
    fa.include_router(notebook_playbook.router)
    c = TestClient(fa)
    assert c.get("/api/j2/my-playbook").status_code == 404          # no session read: not a 401
    monkeypatch.setenv(FLAG, "1")
    assert c.get("/api/j2/my-playbook").status_code == 401          # control: on, the session IS read
    monkeypatch.setenv(FLAG, "0")
    assert c.get("/api/j2/my-playbook").status_code == 404


# ── patterns ────────────────────────────────────────────────────────────────────────────────

def test_the_miners_constants_are_pinned():
    from api.services.journal_two import playbook_patterns as pp
    assert dict(pp.CONSTANTS) == {"MIN_NOTED_PER_SIDE": 5, "MIN_MENTIONS": 3, "MAX_FINDINGS": 6, "MAX_TRADES": 500}
    assert pp.CAPTION == "Patterns, not proof"


def seed_patterns(conn):
    """6 noted losses, 6 noted wins. FOMO before 4 losses and 1 win; patient before 4 wins; anxious
    before 1 loss only (below the 3-mention floor)."""
    ids = {"FOMO_L": [], "FOMO_W": [], "patient_W": []}
    for i in range(6):
        text = "Felt FOMO on the gap" if i < 4 else ("anxious, small size" if i == 4 else "plan is clear")
        tid, _ = noted_trade(conn, r=-1.0, text=text, source=("broker" if i == 0 else None))
        if i < 4:
            ids["FOMO_L"].append(tid)
    for i in range(6):
        text = "patient, waited for the pivot" if i < 4 else ("a bit of fomo" if i == 4 else "clean base")
        tid, _ = noted_trade(conn, r=2.0, text=text)
        if i < 4:
            ids["patient_W"].append(tid)
        if i == 4:
            ids["FOMO_W"].append(tid)
    return ids


def findings_by_term(p):
    return {f["term"]: f for f in p["patterns"]["findings"]}


def test_patterns_carry_both_counts_and_both_n(conn, client):
    ids = seed_patterns(conn)
    p = client.get("/api/j2/my-playbook").json()
    pat = p["patterns"]
    assert pat["status"] == "ok" and pat["caption"] == "Patterns, not proof"
    assert pat["noted"] == {"wins": 6, "losses": 6}
    f = findings_by_term(p)
    assert f["FOMO"]["leans"] == "losses"
    assert f["FOMO"]["losses"] == {"k": 4, "n": 6} and f["FOMO"]["wins"] == {"k": 1, "n": 6}
    assert f["patient"]["leans"] == "wins"
    assert f["patient"]["wins"] == {"k": 4, "n": 6} and f["patient"]["losses"] == {"k": 0, "n": 6}
    assert "anxious" not in f                      # 1 mention < MIN_MENTIONS
    assert {c["tradeId"] for c in f["FOMO"]["citations"]} == set(ids["FOMO_L"] + ids["FOMO_W"])
    assert {c["tradeId"] for c in f["patient"]["citations"]} == set(ids["patient_W"])


def test_every_finding_cites_notes_that_really_said_it_before_entry(conn, client):
    seed_patterns(conn)
    from api.services.journal_two import playbook_patterns as pp
    p = client.get("/api/j2/my-playbook").json()
    findings = p["patterns"]["findings"]
    assert findings, "no findings: the rail below would pass over an empty set"
    for f in findings:
        assert len(f["citations"]) == f["losses"]["k"] + f["wins"]["k"]
        assert sum(1 for c in f["citations"] if c["result"] == "Loss") == f["losses"]["k"]
        assert sum(1 for c in f["citations"] if c["result"] == "Win") == f["wins"]["k"]
        for c in f["citations"]:
            assert c["notes"], f"{f['term']} cites trade {c['tradeId']} with no note"
            trade = conn.execute("SELECT * FROM j2_trades WHERE id = ?", (c["tradeId"],)).fetchone()
            said = {n["noteId"]: n["text"] for n in pp.notes_before_trade(conn, U, trade)}
            for n in c["notes"]:
                assert pp.mentions(pp.normalize(said[n["noteId"]]), pp.normalize(f["term"]))


def test_a_note_written_after_entry_is_not_read(conn, client):
    seed_patterns(conn)
    tid = add_trade(conn, r=-1.0, setup="Breakout")
    nid = add_note(conn, text="FOMO FOMO", created=after(trade_entry(conn, tid)))
    link(conn, nid, tid)
    p = client.get("/api/j2/my-playbook").json()
    assert p["patterns"]["noted"]["losses"] == 6
    assert findings_by_term(p)["FOMO"]["losses"] == {"k": 4, "n": 6}


def test_a_notes_own_created_at_gates_it_even_when_updated_at_predates_entry(conn, client):
    """An importer sets created_at/updated_at independently from external source metadata
    (notes.py's `_import_date` on `n.get("createdAt")` / `n.get("updatedAt")`), so the two can
    disagree with each other. A note whose OWN created_at lands after entry is not a before-note
    even when its updated_at (also external, possibly stale or just wrong) sits before cutoff --
    `_note_state_at` alone cannot catch this (it reads updated_at first and would read the
    current body as the pre-entry state), so the created_at check in notes_before_trade is the
    only guard standing between this row and a fabricated "before" note."""
    seed_patterns(conn)
    tid = add_trade(conn, r=-1.0, setup="Breakout")
    entry = trade_entry(conn, tid)
    nid = add_note(conn, text="FOMO FOMO", created=after(entry), updated=before(entry))
    link(conn, nid, tid)
    p = client.get("/api/j2/my-playbook").json()
    assert p["patterns"]["noted"]["losses"] == 6
    assert findings_by_term(p)["FOMO"]["losses"] == {"k": 4, "n": 6}


def test_a_note_edited_after_entry_is_read_as_it_stood_at_entry(conn, client):
    seed_patterns(conn)
    tid = add_trade(conn, r=-1.0, setup="Breakout")
    entry = trade_entry(conn, tid)
    nid = add_note(conn, text="FOMO, chased it", created=before(entry, 2))
    link(conn, nid, tid)
    # Edited after entry: the pre-edit state becomes a version stamped when it became current.
    row = conn.execute("SELECT * FROM j2_notes WHERE id = ?", (nid,)).fetchone()
    conn.execute("INSERT INTO j2_note_versions (id, user_id, note_id, title, subtitle, body_json, body_plain,"
                 " properties_json, created_at) VALUES (?,?,?,?,?,?,?,?,?)",
                 (uuid.uuid4().hex, U, nid, row["title"], None, row["body_json"], "", None, row["updated_at"]))
    conn.execute("UPDATE j2_notes SET body_json = ?, updated_at = ? WHERE id = ?",
                 (json.dumps(doc("calm and patient")), after(entry), nid))
    conn.commit()
    f = findings_by_term(client.get("/api/j2/my-playbook").json())
    assert f["FOMO"]["losses"] == {"k": 5, "n": 7}        # read as it stood: FOMO, not "patient"
    assert f["patient"]["losses"]["k"] == 0


def test_an_edited_note_with_no_earlier_version_is_not_read(conn, client):
    seed_patterns(conn)
    tid = add_trade(conn, r=-1.0, setup="Breakout")
    entry = trade_entry(conn, tid)
    nid = add_note(conn, text="FOMO", created=before(entry), updated=after(entry))
    link(conn, nid, tid)
    assert client.get("/api/j2/my-playbook").json()["patterns"]["noted"]["losses"] == 6


def test_too_few_noted_trades_makes_no_comparison(conn, client):
    for _ in range(4):
        noted_trade(conn, r=-1.0, text="FOMO")
    for _ in range(6):
        noted_trade(conn, r=2.0, text="patient")
    pat = client.get("/api/j2/my-playbook").json()["patterns"]
    assert pat["status"] == "too_few_notes" and pat["findings"] == []
    assert pat["noted"] == {"wins": 6, "losses": 4}
    assert "at least 5 wins and 5 losses" in pat["message"]


def test_the_account_taxonomy_is_the_word_list(conn, client):
    conn.execute("INSERT INTO j2_accounts (id, user_id, name, color, starting_balance, account_size, created_at,"
                 " updated_at, mistake_tags, emotion_tags) VALUES (?,?,?,?,?,?,?,?,?,?)",
                 ("acct-1", U, "Main", "#fff", 1000, 1000, "2026-01-01", "2026-01-01",
                  json.dumps(["bought the gap"]), json.dumps(["wired"])))
    conn.commit()
    for i in range(6):
        noted_trade(conn, r=-1.0, text=("I bought the gap again" if i < 4 else "fine"))
        noted_trade(conn, r=2.0, text=("FOMO but wired" if i < 3 else "fine"))
    p = client.get("/api/j2/my-playbook").json()
    assert p["patterns"]["vocabulary"] == {"source": "account", "terms": ["wired", "bought the gap"]}
    f = findings_by_term(p)
    assert set(f) == {"bought the gap", "wired"}         # FOMO is not on this account's list
    assert f["bought the gap"]["losses"] == {"k": 4, "n": 6}


def test_matching_is_whole_word_and_separator_blind():
    from api.services.journal_two import playbook_patterns as pp
    assert pp.mentions(pp.normalize("I took an early-exit"), pp.normalize("early_exit"))
    assert pp.mentions(pp.normalize("FOMO!"), pp.normalize("FOMO"))
    assert not pp.mentions(pp.normalize("brushed it off"), pp.normalize("rushed"))


def test_notes_by_setup_lists_the_notes_behind_each_setup(conn, client):
    tid, nid = noted_trade(conn, r=1.0, text="the plan", setup="Breakout")
    add_trade(conn, r=-1.0, setup="EP")
    p = client.get("/api/j2/my-playbook").json()
    assert p["notesBySetup"]["Breakout"] == [{"noteId": nid, "title": "Pre-trade", "tradeCount": 1}]
    assert p["notesBySetup"]["EP"] == []
