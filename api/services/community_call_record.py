"""TERM-009 (FB-X1-01) — a member's call record, OPT-IN (owner ruling 2026-09-29).

Every $TICKER a member mentions on the floor already gets a price-at-mention mark
(`community_marks.capture`, table `ticker_marks`). This turns those marks into a record:
how each one has moved since, LOSSES INCLUDED, beside the member's name -- but only for
a member who chose to publish it.

⛔ A mention carries no direction. The record therefore reports the MOVE since the
mention (up, down, flat) and never labels a mark a "win" or a "loss": calling a +5% move
a win for somebody who was warning the room off the name would misstate what they said.
⛔ An unpriced mark is counted as UNPRICED, never dropped: a record that silently loses
the names it cannot price reads better than it is.
"""
from __future__ import annotations

import statistics
from typing import Optional

from api.services import community_marks, community_store as store

FLAT_BAND_PCT = 0.5     # |move| below this is "flat": noise, not a direction
MAX_PRICED = 60         # distinct tickers priced per record (cache-first, batched by 4)


def _prices(tickers: list[str]) -> dict[str, float]:
    out: dict[str, float] = {}
    uniq = list(dict.fromkeys(t.upper() for t in tickers if t))[:MAX_PRICED]
    for i in range(0, len(uniq), community_marks._MAX_MARKS):
        out.update(community_marks.prices_now(uniq[i:i + community_marks._MAX_MARKS]))
    return out


def build(user_id: str, limit: int = 300, prices: Optional[dict] = None) -> dict:
    marks = store.calls_for_member(user_id, limit=limit)
    now = prices if prices is not None else _prices([m["ticker"] for m in marks])
    rows, moves = [], []
    for m in marks:
        px = now.get(m["ticker"].upper())
        move = None
        if px and m["price"]:
            move = round((float(px) - float(m["price"])) / float(m["price"]) * 100, 2)
            moves.append(move)
        rows.append({"ticker": m["ticker"], "called_at": m["created_at"], "called_price": m["price"],
                     "now_price": px, "move_pct": move, "channel": m["channel_slug"],
                     "message_id": m["message_id"]})
    up = sum(1 for x in moves if x >= FLAT_BAND_PCT)
    down = sum(1 for x in moves if x <= -FLAT_BAND_PCT)
    return {
        "user_id": str(user_id),
        "summary": {
            "marks": len(rows), "priced": len(moves), "unpriced": len(rows) - len(moves),
            "up": up, "down": down, "flat": len(moves) - up - down,
            "median_move_pct": round(statistics.median(moves), 2) if moves else None,
            "flat_band_pct": FLAT_BAND_PCT,
        },
        "rows": rows,
    }
