"""Task 8.10 -- the bundled sample book: deterministic, synthetic, shaped like the real scans.

The parity rails seed the book's own trades and positions into a temp sqlite file (through
`auth_db.init_db`, the Task 8.5 fixtures) and compare what the REAL scans read with what
`run.sample_rows` serves, so the two derivations can never drift apart. Nothing reaches `C:\\data`.
"""
from __future__ import annotations

import importlib.util
import json
import re
import subprocess
import sys
from datetime import date
from pathlib import Path

import pytest

from api.services.journal_two.widget_engine import plan as wplan
from api.services.journal_two.widget_engine import run, sources
from tests.test_widget_sources import (  # noqa: F401 -- `conn` is a fixture used by name
    UID, add_account, add_trade, conn, raw_plan,
)

ROOT = Path(__file__).resolve().parent.parent
GEN = ROOT / "tools" / "gen_widget_sample_book.py"
BOOK = run.SAMPLE_BOOK_PATH
UUID_RE = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}", re.I)


def _gen_module():
    spec = importlib.util.spec_from_file_location("gen_widget_sample_book", GEN)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _book() -> dict:
    return json.loads(BOOK.read_text(encoding="utf-8"))


def _book_bytes() -> bytes:
    """The committed book as git stores it (LF). With `core.autocrlf=true` (this box) a checkout
    may write the working copy with CRLF; the generator always writes LF."""
    return BOOK.read_bytes().replace(b"\r\n", b"\n")


def _strings(x):
    if isinstance(x, str):
        yield x
    elif isinstance(x, dict):
        for k, v in x.items():
            yield k
            yield from _strings(v)
    elif isinstance(x, list):
        for v in x:
            yield from _strings(v)


# -- the file --------------------------------------------------------------------------------------

def test_sample_book_regenerates_identically(tmp_path):
    out = tmp_path / "book.json"
    proc = subprocess.run([sys.executable, str(GEN), "--seed", "20261024", "--out", str(out)],
                          capture_output=True, text=True, timeout=120)
    assert proc.returncode == 0, proc.stderr
    assert out.read_bytes() == _book_bytes()
    # control: a different seed writes different bytes, so the comparison above can fail
    other = tmp_path / "other.json"
    subprocess.run([sys.executable, str(GEN), "--seed", "1", "--out", str(other)], check=True,
                   capture_output=True, timeout=120)
    assert other.read_bytes() != _book_bytes()


def test_sample_book_is_sorted_json_with_lf_endings():
    blob = _book_bytes()
    assert b"\r" not in blob and blob.endswith(b"}\n")
    data = json.loads(blob)
    assert blob.decode("utf-8") == json.dumps(data, indent=1, sort_keys=True,
                                              ensure_ascii=False) + "\n"


def test_sample_book_has_no_real_member_ids(conn):
    book = _book()
    strings = list(_strings(book))
    assert strings, "control: the walk found the book's strings"
    assert not [s for s in strings if UUID_RE.search(s)]
    assert UID not in strings and not [s for s in strings if "@" in s]
    assert not [s for s in strings if "data" in s.lower() and ("c:" in s.lower() or "/data" in s)]
    ids = ([t["id"] for t in book["closed_trades"]] + [p["id"] for p in book["open_positions"]]
           + [a["id"] for a in book["accounts"]])
    assert ids and all(re.fullmatch(r"sample-[atp]-\d+", i) for i in ids)
    assert len(set(ids)) == len(ids)
    # control: the regex does match a real member id
    assert UUID_RE.search("6f1c2d3e-4a5b-4c6d-8e9f-0a1b2c3d4e5f")


def test_sample_book_contents():
    book, gen = _book(), _gen_module()
    trades, positions, days = book["closed_trades"], book["open_positions"], book["trading_days"]
    assert len(trades) == 120 and len(book["accounts"]) == 2 and len(positions) == 8
    assert {t["account"] for t in trades} == {a["id"] for a in book["accounts"]}
    assert len({t["setup"] for t in trades if t["setup"]}) == 6
    assert any(t["mistake"] for t in trades) and any(t["emotion"] for t in trades)
    timed = [t for t in trades if t["hour_et"] is not None]
    assert 0 < len(timed) < len(trades)                     # a mix of timed and date-only trades
    assert all("T" not in t["exit_at"] for t in trades if t["hour_et"] is None)
    span = (date.fromisoformat(trades[-1]["day"]) - date.fromisoformat(trades[0]["day"])).days
    assert 240 <= span <= 280                               # about nine months
    allowed = {s for s, _ in gen.SYMBOLS}
    assert {t["symbol"] for t in trades} | {p["symbol"] for p in positions} <= allowed
    assert sum(1 for p in positions if p["stop"] == p["entry_price"]) == 1     # placeholder stop
    assert sum(1 for p in positions if p["entry_estimated"]) == 1
    assert len(days) > 150 and all(date.fromisoformat(d["day"]).weekday() < 5 for d in days)
    assert book["anchor_day"] == days[-1]["day"] == run.sample_today().isoformat()


# -- sample_rows: the shape and the values of the real scans ----------------------------------------

def _seed_book(conn) -> dict:
    """The book's accounts, trades and positions, written the way the journal stores them."""
    book = _book()
    for a in book["accounts"]:
        add_account(conn, UID, a["name"], size=a["size"], aid=a["id"])
    for t in book["closed_trades"]:
        conn.execute(
            """INSERT INTO j2_trades (id, user_id, position_id, symbol, side, shares, entry_price,
                   entry_date, exit_price, exit_date, original_stop, setup, pnl_dollar,
                   pnl_percent, r_multiple, hold_days, result, context_at_entry, account_id,
                   created_at, trading_day_et, hour_et, fees, analytics_excluded, mistake_tags,
                   emotion_tags, source, regime)
               VALUES (?, ?, 'manual', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '{}', ?,
                       '2026-10-24T00:00:00Z', ?, ?, ?, ?, ?, ?, ?, ?)""",
            (t["id"], UID, t["symbol"], t["side"], t["shares"], t["entry_price"], t["entry_at"],
             t["exit_price"], t["exit_at"], t["stop"], t["setup"], t["gross"],
             t["pct_return"] / 100.0, t["r"], t["hold_days"], t["result"], t["account"],
             t["day"], t["hour_et"], t["fees"], 1 if t["flagged"] else 0,
             json.dumps(t["mistake"]) if t["mistake"] else None,
             json.dumps(t["emotion"]) if t["emotion"] else None,
             None if t["origin"] == "manual" else t["origin"], t["regime"]))
    for p in book["open_positions"]:
        conn.execute(
            """INSERT INTO j2_positions (id, user_id, symbol, side, entry_date, shares,
                   original_shares, entry_price, stop_price, setup, context_at_entry, created_at,
                   updated_at, entry_estimated, broker_price, account_id, source)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '{}', '2026-10-24T00:00:00Z',
                       '2026-10-24T00:00:00Z', ?, ?, ?, ?)""",
            (p["id"], UID, p["symbol"], p["side"], p["entry_at"], p["shares"], p["shares"],
             p["entry_price"], p["stop"], p["setup"], 1 if p["entry_estimated"] else 0, p["mark"],
             p["account"], None if p["origin"] == "manual" else p["origin"]))
    conn.commit()
    return book


def _real(conn, source, **kw):
    today = run.sample_today()
    p = wplan.validate_plan(raw_plan(source=source, measures=(run._COVER_MEASURE[source],), **kw),
                            sources.CATALOG)
    return sources.scan(conn, p, {}, wplan.resolve_range(p["range"], today), UID, today=today)


#: Fields the book's trades carry that the parity seed does not write (excursion, adherence and
#: plan-link tables), and the streak order key (it ties same-day rows by uuid in SQL).
_NOT_SEEDED = {"id", "mfe_r", "mae_r", "exit_efficiency", "adherence_pct", "plan_linked"}


def _same(a, b) -> bool:
    if isinstance(a, float) and isinstance(b, float):
        return a == pytest.approx(b, rel=1e-9, abs=1e-9)
    return a == b


def test_closed_rows_match_a_real_scan_of_the_same_trades(conn):
    _seed_book(conn)
    real = {r["_tid"]: r for r in _real(conn, "closed_trades", view={"type": "list"}).rows}
    mine = {r["_tid"]: r for r in run.sample_rows("closed_trades")}
    assert len(mine) == 120 and set(real) == set(mine)
    diffs = [(tid, k, mine[tid][k], real[tid][k]) for tid in mine for k in real[tid]
             if k not in _NOT_SEEDED and not _same(mine[tid][k], real[tid][k])]
    assert diffs == []
    assert all(set(m) == set(real[tid]) for tid, m in mine.items())       # the same keys, origin too


def test_position_rows_match_a_real_scan_of_the_same_positions(conn):
    _seed_book(conn)
    real = {r["_tid"]: r for r in _real(conn, "open_positions").rows}
    mine = {r["_tid"]: r for r in run.sample_rows("open_positions")}
    assert len(mine) == 8 and set(real) == set(mine)
    diffs = [(tid, k, mine[tid][k], real[tid][k]) for tid in mine for k in real[tid]
             if not _same(mine[tid][k], real[tid][k])]
    assert diffs == []
    assert all(set(m) == set(real[tid]) for tid, m in mine.items())
    assert sum(1 for r in mine.values() if not r["had_stop"]) == 1
    assert sum(1 for r in mine.values() if r["days_open"] is None) == 1


def test_trading_day_rows_have_the_real_scan_shapes(conn):
    add_trade(conn, UID, day="2026-10-20", pnl=50)
    add_trade(conn, UID, day="2026-10-21", pnl=50, source="csv")
    add_trade(conn, UID, day="2026-10-21", pnl=-20)
    real = _real(conn, "trading_days", range={"token": "last_7d"}).rows
    shapes = {frozenset(r) for r in real}
    assert len(shapes) == 3, "control: a one-origin day, a mixed day (origins) and a quiet day"
    mine = run.sample_rows("trading_days")
    assert {frozenset(r) for r in mine} == shapes
    by_day = {r["day"]: r for r in real}
    assert by_day["2026-10-21"]["origins"] == ["csv", "manual"]
    mixed = [r for r in mine if r.get("origin") == "mixed"]
    assert mixed and all(r["origins"] in (["broker", "manual"], ["broker", "csv"],
                                          ["csv", "manual"], ["broker", "csv", "manual"])
                         for r in mixed)
    assert [r["day"] for r in mine] == sorted((r["day"] for r in mine), reverse=True)


def test_sample_rows_are_fresh_copies():
    a = run.sample_rows("closed_trades")
    a[0]["net"] = 10 ** 9
    a.clear()
    assert run.sample_rows("closed_trades")[0]["net"] != 10 ** 9
