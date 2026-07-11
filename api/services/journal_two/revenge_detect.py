"""Journal 2.0 — pure revenge-trade detector (Journal A+ P5, Task A8).

A revenge flag is a trade that re-enters the SAME symbol shortly after a LOSING
trade on that symbol just closed — the classic tilt tell (loss + fast re-entry
on the scene of the loss = the >=2 corroborating signals). It is a MINUTES-apart
signal, so it needs real execution times: a trade is only considered when BOTH
its entry and its exit carry a real time component (`timeutil._is_date_only`
False). Date-only rows (bare dates / exact-UTC-midnight manual/CSV entries) are
skipped entirely — never flagged and never counted as "timed".

Pure + deterministic + side-effect-free: no DB, no clock, no mutation of inputs.
"""
from __future__ import annotations

from typing import Any

from api.services.journal_two.timeutil import _is_date_only, _parse


def _timed_instant(iso: str | None):
    """Return the parsed datetime IFF `iso` carries a real execution time —
    else None (bare date, exact-UTC-midnight date-only, or unparseable)."""
    if not iso:
        return None
    dt = _parse(iso)
    if dt is None:
        return None
    if _is_date_only(iso, dt):
        return None
    return dt


def _net(row: dict) -> float:
    """Net-of-fees P&L for the loss test; fall back to gross when net absent."""
    v = row.get("pnlDollarNet")
    if v is None:
        v = row.get("pnlDollar")
    return float(v or 0.0)


def _ref(row: dict) -> str:
    """Stable annotation ref for a row (prefer the caller-supplied tradeRef)."""
    return str(row.get("tradeRef") or row.get("id"))


def detect(
    rows: list[dict[str, Any]],
    suppressed_pairs: frozenset[str] | set[str] = frozenset(),
    window_minutes: float = 60,
) -> dict[str, Any]:
    """Detect same-symbol revenge re-entries.

    Args:
      rows: trade dicts (each with ``symbol``, ``entry_date``/``exit_date`` ISO,
        ``pnlDollar``/``pnlDollarNet``, and an ``id``/``tradeRef``).
      suppressed_pairs: pair keys (``f"{prevRef}->{curRef}"``) the user dismissed
        as "not revenge" — excluded from ``flags``.
      window_minutes: max minutes between the prior trade's exit and this trade's
        entry for it to count as revenge (default 60).

    Returns ``{flags, timeComponentCoverage}`` where each flag is
    ``{symbol, prevTradeRef, tradeRef, minutesApart, pairKey}`` and
    ``timeComponentCoverage`` is ``{timed, total}`` — ``timed`` = rows usable by
    the detector (real time on BOTH entry and exit), ``total`` = all rows. When
    ``timed`` is tiny the FE can say "requires execution times".
    """
    total = len(rows)

    # Only rows with a real time on BOTH ends can participate — a revenge flag
    # needs the prior EXIT instant and this ENTRY instant.
    timed_rows: list[dict[str, Any]] = []
    for r in rows:
        entry_dt = _timed_instant(r.get("entry_date"))
        exit_dt = _timed_instant(r.get("exit_date"))
        if entry_dt is None or exit_dt is None:
            continue
        timed_rows.append({
            "ref": _ref(r),
            "symbol": r.get("symbol"),
            "entry_dt": entry_dt,
            "exit_dt": exit_dt,
            "net": _net(r),
        })
    timed = len(timed_rows)

    # Deterministic scan order: by entry instant, tie-break on ref.
    timed_rows.sort(key=lambda t: (t["entry_dt"], t["ref"]))

    window = float(window_minutes)
    flags: list[dict[str, Any]] = []
    for cur in timed_rows:
        # Nearest prior same-symbol LOSING trade that closed at/before this entry
        # and within the window (smallest gap = largest prior exit_dt).
        best_prev = None
        best_gap = None
        for prev in timed_rows:
            if prev is cur or prev["ref"] == cur["ref"]:
                continue
            if prev["symbol"] != cur["symbol"]:
                continue
            if prev["net"] >= 0:            # the prior trade must be a LOSS
                continue
            if prev["exit_dt"] > cur["entry_dt"]:  # must have closed first
                continue
            gap_min = (cur["entry_dt"] - prev["exit_dt"]).total_seconds() / 60.0
            if gap_min > window:
                continue
            if best_gap is None or gap_min < best_gap:
                best_gap = gap_min
                best_prev = prev
        if best_prev is None:
            continue
        pair_key = f"{best_prev['ref']}->{cur['ref']}"
        if pair_key in suppressed_pairs:
            continue
        flags.append({
            "symbol": cur["symbol"],
            "prevTradeRef": best_prev["ref"],
            "tradeRef": cur["ref"],
            "minutesApart": round(best_gap, 2),
            "pairKey": pair_key,
        })

    return {
        "flags": flags,
        "timeComponentCoverage": {"timed": timed, "total": total},
    }
