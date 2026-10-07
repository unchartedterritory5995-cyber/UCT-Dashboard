"""The visual playbook: the member's tagged chart blocks, each with its frozen chart, its
frozen fingerprint and the outcome of the trade it planned (wave 13, lane 13I-2).

Every number here is READ from an authority, never re-derived:

  * the chart blocks and their frozen fingerprints come from 13I-1's index
    (`chart_blocks.catch_up` + `chart_blocks.list_blocks`), and a block's filterable values
    are `tech_fingerprint.summary_values` -- the ONE projection 13J's distance reads too;
  * the OUTCOME joins through 13A's frozen plan links (`j2_trade_plan_links`) on the stable
    `trade_ref` (`trade_refs.resolve_trade_by_ref`), NEVER on `j2_trades.id`: a broker resync
    reissues every trade id, and a card keyed on the id would silently lose its outcome;
  * the slice's stats are `playbook_stats._setup_record` over the slice's trade rows -- the
    per-setup authority's own arithmetic (win rate over decisive trades, mean `r_multiple`),
    so a slice that is exactly one setup's trades reads the same numbers as its Playbook card;
  * the sample-size wording (ruling R3) goes through `_sample` below, a THIN ADAPTER marked
    for the integrator: 13B's `sample_size.py` had not landed when this lane was built.

⛔ NEVER A SECOND WRITER INTO NOTES (plan R-12). This module reads `j2_notes` bodies only to
find each block's archived chart image; the only writes it can cause are 13I-1's own
projection and freeze ledger (through `chart_blocks.catch_up`). No model call, no vendor call.
"""
from __future__ import annotations

import json
import math
import sqlite3
from typing import Any, Iterable

from api.services.journal_two import chart_blocks, entry_context, playbook_stats, plan_grading
from api.services.journal_two import regime as regime_service
from api.services.journal_two import tech_fingerprint as tfp
from api.services.journal_two.timeutil import compute_trading_day_et
from api.services.journal_two.trade_refs import resolve_trade_by_ref, trade_ref_for_row
from api.services.notebook_flags import flag_on

#: The enablement gate for the grid, the suggestion and before/after (plan section 3.6).
FLAG = "NOTEBOOK_VISUAL_PLAYBOOK_ENABLED"


def enabled() -> bool:
    """Read PER CALL through the one Notebook flag parse (unset = OFF)."""
    return flag_on(FLAG, False)


#: Fingerprint fields a range filter may name: the scalar NUMBERS. The rest of
#: `tech_fingerprint.FIELDS` is categorical or a list and is declared below, so a
#: field added to the fingerprint must be placed in one of the two (a rail checks).
RANGE_FIELDS = (
    "adr_pct", "pct_vs_sma10", "pct_vs_sma20", "pct_vs_sma50", "pct_vs_sma200",
    "rs_rank", "base_length_bars", "base_depth_pct", "pullback_depth_pct",
    "vol_nweek_low", "close_cv_pct", "pole_pct",
)
NON_RANGE_FIELDS = ("ma_stack", "ema_stack_intact", "rs_line_trend", "patterns")

#: Outcome filter values. `none` = no trade is linked to the block's plan yet.
OUTCOMES = ("win", "loss", "breakeven", "none")
_RESULT_OUTCOME = {"Win": "win", "Loss": "loss", "BE": "breakeven"}

#: The most tags one request may name (a setup group is a handful).
MAX_SETUPS = 40
#: The most range clauses one request may carry.
MAX_RANGES = 8

#: While 13E's gate (`NOTEBOOK_ENTRY_CONTEXT_ENABLED`) is OFF the regime filter stays the
#: labelled placeholder it was before 13E landed -- this sentence and the payload shape are
#: byte-identical to that build (wave 14 playbook fixes: "flag off, behaviour unchanged").
REGIME_UNAVAILABLE = ("Filtering by market regime needs the entry context lane (13E), "
                      "which is not built yet.")

#: The regime labels, DERIVED from the one classifier (`regime.classify_regime`) by sweeping
#: the UCT Exposure Rating's whole 0-150 scale, best first. Never a typed list: a fifth tier
#: added there appears here on the next import, and no threshold is restated.
REGIMES = tuple(dict.fromkeys(
    r for r in (regime_service.classify_regime(s) for s in range(150, -1, -1)) if r))

#: Why a card has no regime to filter on (the filter EXCLUDES and COUNTS these, the same
#: rule as a missing fingerprint number -- unknown is never counted as a match).
REGIME_UNKNOWN = {
    "no_trade": "no trade is linked to this chart, so there is no entry day",
    "not_captured": "no market context was frozen on this trade's entry day",
    "captured_late": "the context was frozen after the entry day, so it is not the market at the fill",
    "regime_missing": "the frozen context has no regime value",
}


def _regime_of(trades: list[sqlite3.Row], contexts: dict[str, dict | None]) -> dict:
    """The regime at the fill of the card's PRIMARY trade (the same trade its outcome reads),
    straight off 13E's frozen `at_entry` context. Never re-derived, never guessed: anything
    else is a labelled unknown."""
    if not trades:
        return {"value": None, "status": "no_trade", "entryDay": None}
    t = trades[0]
    ctx = contexts.get(str(t["id"]))
    day = entry_context.entry_day_for(t["entry_date"])
    if not ctx:
        return {"value": None, "status": "not_captured", "entryDay": day}
    if ctx.get("captureKind") != "at_entry":
        return {"value": None, "status": "captured_late", "entryDay": ctx.get("entryDay")}
    field = (ctx.get("fields") or {}).get("regime") or {}
    value = field.get("value")
    if value not in REGIMES:
        return {"value": None, "status": "regime_missing", "entryDay": ctx.get("entryDay"),
                "missing": field.get("missing")}
    return {"value": value, "status": "captured", "entryDay": ctx.get("entryDay"),
            "asOf": field.get("asOf")}


class PlaybookRequestError(ValueError):
    """A filter the caller must fix."""


# ── the R3 sample-size wording: a THIN ADAPTER ────────────────────────────────
#
# ⛔ INTEGRATOR: SWAP THIS FOR 13B's `sample_size.py` WHEN IT LANDS (plan section 3.1:
# "lib/sampleSize.js + sample_size.py, with a parity rail", owner 13B). Until then it
# delegates the band, the wording and the Wilson range to 13A's R3 implementation
# (`plan_grading.sample_band` / `SAMPLE_WORDING` / `wilson`, already on the landing branch),
# and computes ONLY the mean-R range itself, a t-interval as A.13B specifies.

#: Two-sided 95% t critical values for the thin band (10 <= n <= 24, so df 9..23).
_T95 = {9: 2.262, 10: 2.228, 11: 2.201, 12: 2.179, 13: 2.160, 14: 2.145, 15: 2.131,
        16: 2.120, 17: 2.110, 18: 2.101, 19: 2.093, 20: 2.086, 21: 2.080, 22: 2.074,
        23: 2.069}


def _sample(n: int) -> dict:
    band = plan_grading.sample_band(n)
    return {"n": n, "band": band, "wording": plan_grading.SAMPLE_WORDING[band]}


def _mean_r_range(rs: list[float]) -> list[float] | None:
    n = len(rs)
    t = _T95.get(n - 1)
    if t is None:
        return None
    mean = sum(rs) / n
    sd = math.sqrt(sum((x - mean) ** 2 for x in rs) / (n - 1))
    half = t * sd / math.sqrt(n)
    return [round(mean - half, 4), round(mean + half, 4)]


# ── filters ───────────────────────────────────────────────────────────────────

def parse_range(raw: str) -> tuple[str, float | None, float | None]:
    """`field:min:max`, either bound may be blank (`rs_rank:90:` = RS rank >= 90)."""
    parts = str(raw or "").split(":")
    if len(parts) != 3:
        raise PlaybookRequestError(f"a range reads field:min:max, not {raw!r}")
    field, lo, hi = parts[0].strip(), parts[1].strip(), parts[2].strip()
    if field not in RANGE_FIELDS:
        raise PlaybookRequestError(f"{field!r} is not a fingerprint number a range can filter")

    def num(s: str) -> float | None:
        if s == "":
            return None
        try:
            v = float(s)
        except ValueError:
            raise PlaybookRequestError(f"{s!r} is not a number") from None
        if not math.isfinite(v):
            raise PlaybookRequestError(f"{s!r} is not a number")
        return v

    lo_v, hi_v = num(lo), num(hi)
    if lo_v is None and hi_v is None:
        raise PlaybookRequestError(f"the range on {field} names no bound")
    if lo_v is not None and hi_v is not None and lo_v > hi_v:
        raise PlaybookRequestError(f"the range on {field} is empty ({lo_v} > {hi_v})")
    return field, lo_v, hi_v


def _in_range(value: Any, lo: float | None, hi: float | None) -> bool | None:
    """True / False, or None when the block has no number for the field (missing data is
    never counted as passing a range -- it is reported as excluded)."""
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        return None
    if lo is not None and value < lo:
        return False
    if hi is not None and value > hi:
        return False
    return True


# ── the frozen chart image (read off the note body, read-only) ────────────────

def _chart_nodes(body_json: Any) -> list[dict]:
    """The chart `widgetEmbed` nodes' attrs in document order -- the SAME traversal
    `chart_blocks.extract_blocks` makes, so a block's `position` indexes this list."""
    return chart_blocks.iter_chart_attrs(body_json)     # the one walk, a loop (review M-4)


def _archived_images(conn: sqlite3.Connection, user_id: str, note_ids: Iterable[str]) -> dict:
    """{(note_id, position): {url, w, h} | None}."""
    ids = sorted(set(note_ids))
    out: dict = {}
    for i in range(0, len(ids), 200):
        chunk = ids[i:i + 200]
        marks = ",".join("?" for _ in chunk)
        for r in conn.execute(f"SELECT id, body_json FROM j2_notes WHERE user_id = ? AND id IN ({marks})",
                              (user_id, *chunk)):
            body = chart_blocks.parse_body(r["body_json"])
            for pos, attrs in enumerate(_chart_nodes(body)):
                fb = attrs.get("fallback") if isinstance(attrs.get("fallback"), dict) else None
                url = fb.get("url") if fb else None
                out[(r["id"], pos)] = ({"url": url, "w": fb.get("w"), "h": fb.get("h")}
                                       if isinstance(url, str) and url else None)
    return out


# ── the outcome: 13A's frozen links, on the stable trade_ref ──────────────────

def _trade_public(t: sqlite3.Row) -> dict:
    return {
        "tradeId": t["id"], "tradeRef": trade_ref_for_row(t), "symbol": t["symbol"],
        "side": t["side"], "result": t["result"],
        "outcome": _RESULT_OUTCOME.get(t["result"], "none"),
        "rMultiple": float(t["r_multiple"]) if t["r_multiple"] is not None else None,
        "pnlDollar": float(t["pnl_dollar"]) if t["pnl_dollar"] is not None else None,
        "entryDate": t["entry_date"], "exitDate": t["exit_date"], "setup": t["setup"],
    }


def linked_trades(conn: sqlite3.Connection, user_id: str,
                  note_ids: Iterable[str]) -> dict[tuple[str, str], list[sqlite3.Row]]:
    """{(note_id, SYMBOL): [trade rows]} for every frozen plan link whose plan came from one
    of these notes. The join is the link's `trade_ref` resolved to the trade row NOW, so a
    broker resync that reissued the trade's id still lands on the same trade."""
    ids = sorted(set(note_ids))
    out: dict[tuple[str, str], list[sqlite3.Row]] = {}
    if not ids:
        return out
    for i in range(0, len(ids), 200):
        chunk = ids[i:i + 200]
        marks = ",".join("?" for _ in chunk)
        try:
            links = conn.execute(
                f"SELECT trade_ref, note_id, symbol FROM j2_trade_plan_links WHERE user_id = ?"
                f" AND source_kind = 'note' AND note_id IN ({marks})", (user_id, *chunk)).fetchall()
        except sqlite3.OperationalError as e:
            if "no such table" in str(e).lower():
                return out
            raise
        for ln in links:
            t = resolve_trade_by_ref(user_id, ln["trade_ref"], conn)
            if t is None:
                continue                      # a parked ref (a re-sliced fingerprint): no outcome
            key = (ln["note_id"], (ln["symbol"] or "").upper())
            out.setdefault(key, []).append(t)
    for rows in out.values():
        rows.sort(key=lambda t: (t["exit_date"] or "", t["id"]), reverse=True)
    return out


# ── the grid ──────────────────────────────────────────────────────────────────

def _card(block: dict, trades: list[sqlite3.Row], image: dict | None) -> dict:
    pub = [_trade_public(t) for t in trades]
    primary = pub[0] if pub else None
    return {
        "noteId": block["noteId"], "noteTitle": block["noteTitle"], "embedKey": block["embedKey"],
        "symbol": block["symbol"], "timeframe": block["timeframe"], "asOf": block["asOf"],
        "setupTag": block["setupTag"],
        "fingerprintSource": block["fingerprintSource"],
        "fingerprintAsOf": (block["fingerprint"] or {}).get("as_of") if block["fingerprint"] else None,
        "values": block["values"] or {},
        "image": image,
        "outcome": primary["outcome"] if primary else "none",
        "trades": pub,
    }


def _slice_stats(cards: list[dict], rows_by_ref: dict[str, sqlite3.Row]) -> dict:
    """The slice's numbers, from the per-setup authority's own arithmetic over the DISTINCT
    trades the slice's cards link to (one trade linked from two charts counts once)."""
    refs: list[str] = []
    for c in cards:
        for t in c["trades"]:
            if t["tradeRef"] not in refs:
                refs.append(t["tradeRef"])
    rows = sorted((rows_by_ref[r] for r in refs), key=lambda t: t["exit_date"] or "")
    n = len(rows)
    out: dict[str, Any] = {"charts": len(cards), "trades": n, "unlinkedCharts":
                           sum(1 for c in cards if not c["trades"]), **_sample(n)}
    if not rows:
        out.update({"wins": 0, "losses": 0, "breakeven": 0, "winRate": None, "avgR": None,
                    "rTrades": 0, "totalPnlDollar": 0.0, "winRateRange": None, "avgRRange": None})
        return out
    rec = playbook_stats._setup_record("slice", rows, {}, {})
    wins, losses = rec["winCount"], rec["lossCount"]
    rs = [float(t["r_multiple"]) for t in rows if t["r_multiple"] is not None]
    thin = out["band"] == "thin"
    out.update({
        "wins": wins, "losses": losses, "breakeven": rec["beCount"],
        "winRate": rec["winRate"], "avgR": rec["avgR"], "rTrades": len(rs),
        "totalPnlDollar": rec["totalPnlDollar"],
        "winRateRange": (list(plan_grading.wilson(wins, wins + losses))
                         if thin and wins + losses > 0 else None),
        "avgRRange": _mean_r_range(rs) if thin and len(rs) >= 2 else None,
    })
    return out


def cards(user_id: str, conn: sqlite3.Connection | None = None, *,
          setups: list[str] | None = None, outcome: str | None = None,
          timeframe: str | None = None, ranges: list[str] | None = None,
          regime: str | None = None, catch_up: bool = True) -> dict:
    """The grid: the member's chart blocks that carry a setup tag, filtered, with the slice's
    stats. Facets (which tags and timeframes exist) are counted BEFORE filtering, so an empty
    slice still shows what there is to pick."""
    setups = [s.strip() for s in (setups or []) if isinstance(s, str) and s.strip()]
    if len(setups) > MAX_SETUPS:
        raise PlaybookRequestError(f"at most {MAX_SETUPS} setups at once")
    if outcome is not None and outcome not in OUTCOMES:
        raise PlaybookRequestError(f"outcome is one of {', '.join(OUTCOMES)}")
    parsed = [parse_range(r) for r in (ranges or [])]
    if len(parsed) > MAX_RANGES:
        raise PlaybookRequestError(f"at most {MAX_RANGES} ranges at once")
    # 13E's gate, read per call. OFF: the regime parameter is ignored exactly as it was before
    # this filter existed (an unknown query parameter), and the payload is unchanged.
    regime_on = entry_context.enabled()
    regime = (regime or "").strip().lower() or None
    if not regime_on:
        regime = None
    elif regime is not None and regime not in REGIMES:
        raise PlaybookRequestError(f"regime is one of {', '.join(REGIMES)}")

    owned = conn is None
    if owned:
        conn = chart_blocks._connect()
    try:
        progress = chart_blocks.catch_up(user_id, conn) if catch_up else {"pending": 0}
        blocks = [b for b in chart_blocks.list_blocks(user_id, conn) if b["setupTag"]]
        note_ids = {b["noteId"] for b in blocks}
        links = linked_trades(conn, user_id, note_ids)
        images = _archived_images(conn, user_id, note_ids)
        contexts: dict[str, dict | None] = {}
        if regime_on:
            primaries = [ts[0] for ts in links.values() if ts]
            contexts = entry_context.contexts_for_trades(
                user_id, [{"id": t["id"], "symbol": t["symbol"], "entryDate": t["entry_date"]}
                          for t in primaries], conn=conn)

        facets_setups: dict[str, int] = {}
        facets_tf: dict[str, int] = {}
        facets_regime: dict[str, int] = {r: 0 for r in REGIMES}
        regime_unknown = 0
        regime_by_block: dict[int, dict] = {}
        for i, b in enumerate(blocks):
            facets_setups[b["setupTag"]] = facets_setups.get(b["setupTag"], 0) + 1
            facets_tf[b["timeframe"]] = facets_tf.get(b["timeframe"], 0) + 1
            if regime_on:
                rg = _regime_of(links.get((b["noteId"], (b["symbol"] or "").upper()), []), contexts)
                regime_by_block[i] = rg
                if rg["value"]:
                    facets_regime[rg["value"]] += 1
                else:
                    regime_unknown += 1

        excluded_missing: dict[str, int] = {}
        excluded_no_regime = 0
        kept: list[dict] = []
        rows_by_ref: dict[str, sqlite3.Row] = {}
        for i, b in enumerate(blocks):
            if setups and b["setupTag"] not in setups:
                continue
            if timeframe and b["timeframe"] != timeframe:
                continue
            trades = links.get((b["noteId"], (b["symbol"] or "").upper()), [])
            card = _card(b, trades, images.get((b["noteId"], b["position"])))
            if outcome is not None and card["outcome"] != outcome:
                continue
            if regime_on:
                card["regime"] = regime_by_block[i]
                if regime is not None and card["regime"]["value"] != regime:
                    if card["regime"]["value"] is None:
                        excluded_no_regime += 1
                    continue
            missing_field = None
            passes = True
            for field, lo, hi in parsed:
                verdict = _in_range(card["values"].get(field), lo, hi)
                if verdict is None:
                    missing_field = field
                    passes = False
                    break
                if verdict is False:
                    passes = False
                    break
            if missing_field is not None:
                excluded_missing[missing_field] = excluded_missing.get(missing_field, 0) + 1
            if not passes:
                continue
            for t in trades:
                rows_by_ref[trade_ref_for_row(t)] = t
            kept.append(card)

        regime_payload: dict[str, Any] = (
            {"available": True, "values": list(REGIMES), "selected": regime,
             "facets": facets_regime, "unknown": regime_unknown,
             "excludedUnknown": excluded_no_regime,
             "unknownReasons": REGIME_UNKNOWN,
             "source": "entry_context (13E, at_entry rows only)"}
            if regime_on else {"available": False, "reason": REGIME_UNAVAILABLE})
        return {
            "cards": kept,
            "count": len(kept),
            "stats": _slice_stats(kept, rows_by_ref),
            "excludedMissing": excluded_missing,
            "facets": {"setups": facets_setups, "timeframes": facets_tf},
            "rangeFields": list(RANGE_FIELDS),
            "regime": regime_payload,
            "pending": progress.get("pending", 0),
            "sampleSizeSource": "adapter:plan_grading (swap for 13B sample_size.py)",
        }
    finally:
        if owned:
            conn.close()


# ── before and after ──────────────────────────────────────────────────────────

def before_after(user_id: str, trade_id: str, conn: sqlite3.Connection) -> dict | None:
    """The trade's entry and exit days, its fills, and the levels of the plan 13A froze for it
    (READ ONLY: `get_link`, never `match_trade`, so opening this view freezes nothing). The
    plan note's tagged chart block, when there is one, rides along with its archived image."""
    t = conn.execute("SELECT * FROM j2_trades WHERE user_id = ? AND id = ?", (user_id, trade_id)).fetchone()
    if t is None:
        return None
    ref = trade_ref_for_row(t)
    try:
        link = plan_grading.get_link(conn, user_id, ref)
    except sqlite3.OperationalError as e:
        if "no such table" not in str(e).lower():
            raise
        link = None
    plan = None
    plan_status = "none"
    plan_chart = None
    if link is not None and link["sourceKind"] == "none":
        plan_status = "member_none"
    elif link is not None:
        p = link["plan"] or {}
        plan_status = "linked"
        plan = {
            "entry": p.get("entry"), "stop": p.get("stop"), "target": p.get("target"),
            "shares": p.get("shares"), "sourceKind": link["sourceKind"], "noteId": link["noteId"],
            "planAsOf": link["planAsOf"], "flags": link["flags"],
        }
        if link["noteId"]:
            r = conn.execute("SELECT title, body_json FROM j2_notes WHERE id = ? AND user_id = ?"
                             " AND deleted_at IS NULL", (link["noteId"], user_id)).fetchone()
            if r is not None:
                plan["noteTitle"] = r["title"] or ""
                body = chart_blocks.parse_body(r["body_json"])
                sym = (t["symbol"] or "").upper()
                for b, attrs in zip(chart_blocks.extract_blocks(body), _chart_nodes(body)):
                    if (b["symbol"] or "") == sym:
                        fb = attrs.get("fallback") if isinstance(attrs.get("fallback"), dict) else None
                        ta = attrs.get("ta") if isinstance(attrs.get("ta"), dict) else {}
                        fp = ta.get("fingerprint") if isinstance(ta.get("fingerprint"), dict) else None
                        plan_chart = {
                            "embedKey": b["embed_key"], "asOf": b["as_of"], "timeframe": b["timeframe"],
                            "setupTag": b["setup_tag"],
                            "image": ({"url": fb["url"], "w": fb.get("w"), "h": fb.get("h")}
                                      if fb and isinstance(fb.get("url"), str) and fb["url"] else None),
                            "values": tfp.summary_values(fp) if fp else None,
                        }
                        break
    return {
        "trade": {**_trade_public(t), "shares": float(t["shares"]),
                  "entryPrice": float(t["entry_price"]), "exitPrice": float(t["exit_price"]),
                  "entryDay": compute_trading_day_et(t["entry_date"]),
                  "exitDay": compute_trading_day_et(t["exit_date"])},
        "planStatus": plan_status,
        "plan": plan,
        "planChart": plan_chart,
    }
