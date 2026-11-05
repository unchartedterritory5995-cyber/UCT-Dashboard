"""gen_kicker_levels -- `levels` items ("Mark the levels": the entry and the
stop) for the Kicker examples the owner kept, from the chart's own bars and
HIS rulings.

The Draw-it drill (lab piece 44; the product's "Mark the levels" skill
`setup.levels`; server scoring study_scoring.score_levels) needs bank items
that carry the house entry and stop for a chart. Nothing here is a model's
market fact: the levels follow the owner's rulings of 2026-11-02, verbatim in
docs/study/audits/2026-10-24/owner_verdicts.jsonl (pass workbench-ruling) and
the round-6 analysis in docs/study/RESUME.md:

  * ENTRY: a stop-buy $0.01 over the RED day's high (the day before the
    Kicker), triggered on the Kicker day when price crosses it ("the entry
    should 11.05 over THE previous day high, or on DAY 1 of the kicker candle
    on a 30 min ORB"; the ORB entry is intraday and is not drawn on a daily
    chart).
  * STOP: "Under the kicker candle low or entry with a 3.5% stop but we should
    get these with smaller than 3.5% stop usually" -> the Kicker's low when it
    sits within 3.5% of the entry, else 3.5% under the entry; a Kicker whose
    low is wider than that is flagged in the facts.
  * TARGETS and SELL RULES: not ruled ("we can work on those later,
    complicated"), so no target is asked for or stored.

Sources: the Kicker examples in docs/study/bank/spot.setups.json that the
owner KEPT (owner_verdicts.jsonl, setup "Kicker Candle", verdict keep /
keep_lesser / owner_reference, with his grade and his words), one `levels`
item per chart on the spot item's own bars spec. ATR14 (the firm's
uct_setups_common.atr) rides the key for the scorer's tolerance. Every item
is a draft for the owner's review on the pod; the product plays `levels`
items only when the "Mark the levels" drill exists (spec phase 2).

  python -X utf8 scripts/study/gen_kicker_levels.py --bars-db <bars_sqlite file>
"""
from __future__ import annotations

import argparse
import json
import pathlib
import sqlite3
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2]))

from api.services.pattern_engine.detectors.uct import uct_setups_common as U  # noqa: E402
from api.services.study_scoring import level_tolerance  # noqa: E402
from scripts.study._common import REPO, load_json, make_item, write_segment  # noqa: E402
from scripts.study.fill_setup_facts import load_bars  # noqa: E402

VERDICTS = REPO / "docs" / "study" / "audits" / "2026-10-24" / "owner_verdicts.jsonl"
SPOT = REPO / "docs" / "study" / "bank" / "spot.setups.json"
KICKER_SKILL = "setup.family3.kicker"
SKILL = "setup.levels"
KEEP = ("keep", "keep_lesser", "owner_reference")
WINDOW, FORWARD = 120, 20
OVER_HIGH = 0.01
MAX_STOP_PCT = 3.5
RULINGS = [
    {"topic": "kicker entry", "date": "2026-11-02",
     "words": "the entry should 11.05 over THE previous day high, or on DAY 1 of the kicker candle on a 30 min ORB"},
    {"topic": "kicker stop", "date": "2026-11-02",
     "words": "Under the kicker candle low or entry with a 3.5% stop but we should get these with smaller than 3.5% stop usually"},
    {"topic": "sell rules", "date": "2026-11-02",
     "words": "can pause here and ask about trimming and trailing and some sell rules ... we can work on those later, complicated"},
]
QUESTION = "A Kicker fired on the last bar. Mark the entry and the stop on this chart."


def pct_of(entry: float, level: float) -> float:
    """How far `level` sits under `entry`, as a percentage of the entry."""
    return (entry - level) / entry * 100.0


def house_levels(bars: list[dict]) -> dict:
    """The entry trigger and the stop for a Kicker whose last bar is the
    Kicker day, per the owner's rulings. The trigger is the line the member
    marks: a stop-buy 0.01 over the red day's high. A stop-buy fills where
    price first trades through it: at the open when the Kicker gaps over the
    line (the owner's own example: "$11.05, filled 9:30 ET"), else at the
    line. The stop is judged from that fill. Raises when the last bar did
    not close above the prior day's high (then it is not the Kicker)."""
    red, kick = bars[-2], bars[-1]
    if not (kick["c"] > red["h"]):
        raise ValueError("the last bar did not close above the prior day's high, so it is not the Kicker")
    entry = round(red["h"] + OVER_HIGH, 2)
    gapped_over = kick["o"] > entry
    fill = round(kick["o"], 2) if gapped_over else entry
    low_pct = round(pct_of(fill, kick["l"]), 2)
    if low_pct <= MAX_STOP_PCT:
        stop, basis = round(kick["l"], 2), "kicker_low"
    else:
        stop, basis = round(fill * (1 - MAX_STOP_PCT / 100.0), 2), "max_stop_pct"
    atr = U.atr(bars)[-1]
    return {
        "red_day_high": round(red["h"], 2), "red_day_close": round(red["c"], 2),
        "kicker_open": round(kick["o"], 2), "kicker_low": round(kick["l"], 2),
        "kicker_high": round(kick["h"], 2), "kicker_close": round(kick["c"], 2),
        "entry": entry, "gapped_over_trigger": gapped_over, "fill": fill,
        "stop": stop, "stop_basis": basis,
        "kicker_low_pct": low_pct, "stop_pct": round(pct_of(fill, stop), 2),
        "stop_wider_than_max": low_pct > MAX_STOP_PCT,
        "over_high": OVER_HIGH, "max_stop_pct": MAX_STOP_PCT,
        "atr14": None if atr is None else round(atr, 4),
        "tolerance": round(level_tolerance(entry, atr), 4),
    }


def lesson(f: dict) -> str:
    filled = (f"The Kicker opened at {f['fill']:.2f}, above the line, so the order filled at the open."
              if f["gapped_over_trigger"] else
              "The Kicker traded up through the line during the day, so the order filled there.")
    low_word = "within" if not f["stop_wider_than_max"] else "wider than"
    stop_word = ("the Kicker's low" if f["stop_basis"] == "kicker_low" else f"{f['max_stop_pct']}% under the fill")
    return (f"Entry: a stop-buy {f['over_high']} over the red day's high of {f['red_day_high']:.2f}, so the line sits at "
            f"{f['entry']:.2f}. {filled} Stop: the Kicker's low of {f['kicker_low']:.2f} sits {f['kicker_low_pct']}% "
            f"under the fill, {low_word} {f['max_stop_pct']}%, so the stop is {f['stop']:.2f}, {stop_word}. The best "
            f"Kickers allow a stop smaller than {f['max_stop_pct']}%. This drill marks the entry line and the stop only.")


def kept_kickers() -> dict[tuple[str, str], dict]:
    """(sym, asof) -> the owner's verdict row, for the Kicker charts he kept."""
    out: dict[tuple[str, str], dict] = {}
    with open(VERDICTS, encoding="utf-8") as fh:
        for line in fh:
            if not line.strip():
                continue
            r = json.loads(line)
            if r.get("setup") == "Kicker Candle" and r.get("sym") and r.get("asof") and r.get("verdict") in KEEP:
                out[(r["sym"], r["asof"])] = r          # a later row (a re-sitting) wins
    return out


def items_for(spot_items: list[dict], verdicts: dict, db: sqlite3.Connection) -> list[dict]:
    out = []
    for sp in spot_items:
        if sp.get("skill_id") != KICKER_SKILL:
            continue
        v = verdicts.get((sp["sym"], sp["asof"]))
        if not v:
            continue
        bars, _fwd = load_bars(db, sp["sym"], sp["asof"], WINDOW, FORWARD)
        f = house_levels(bars)
        ref = f"{sp['source_ref']}#levels"
        reveal = {"setup": "Kicker Candle", "skill": "Mark the levels", "facts": f,
                  "quote": RULINGS[1]["words"], "rulings": RULINGS,
                  "example_grade": v.get("grade"), "owner_words": v.get("owner_words"),
                  "spot_item": sp["id"], "source": ref, "window_bars": WINDOW, "forward_bars": FORWARD}
        out.append(make_item(
            type="levels", skill_id=SKILL, q=QUESTION, answer=None,
            answer_json={"entry": f["entry"], "stop": f["stop"], "atr14": f["atr14"]},
            prompt_extra={"chart": {"window_bars": WINDOW, "tf": "D"}, "roles": ["entry", "stop"],
                          "setup": "Kicker Candle"},
            reveal=reveal, lesson_text=lesson(f), lesson_origin="session",
            source_kind="setups", source_ref=ref, difficulty=4,
            sym=sp["sym"], asof=sp["asof"], adjustment_basis=sp.get("adjustment_basis") or "split-adjusted",
            bars={"sym": sp["sym"], "tf": "D", "asof": sp["asof"], "window": WINDOW, "forward": FORWARD}))
    return out


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="levels items for the owner's kept Kicker charts.")
    ap.add_argument("--bars-db", required=True, help="a bars_sqlite file (ohlcv table, daily rows)")
    args = ap.parse_args(argv)
    db = sqlite3.connect(f"file:{pathlib.Path(args.bars_db).as_posix()}?mode=ro", uri=True)
    items = items_for(load_json(SPOT), kept_kickers(), db)
    for it in items:
        f = it["reveal_json"]["facts"]
        print(f"[kicker-levels] {it['sym']:5} {it['asof']} entry {f['entry']:>8.2f} stop {f['stop']:>8.2f} "
              f"({f['stop_basis']}, {f['stop_pct']}%) grade {it['reveal_json']['example_grade']}")
    path = write_segment("levels.kicker", items)
    print(f"levels.kicker: {len(items)} items -> {path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
