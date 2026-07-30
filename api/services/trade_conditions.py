"""SIP trade-condition eligibility — keep ghost prints out of the live candle.

The consolidated tapes (CTA for NYSE-listed, UTP for Nasdaq-listed) tag every
print with sale-condition codes. The SIP spec says which conditions are eligible
to update the LAST SALE and the session HIGH/LOW. Professional charts
(TC2000/TradingView) drop the ineligible ones so the tape's odd-lots, out-of-
sequence prints, form-T/extended-hours prints, average/derivatively-priced trades,
and corrected prints never move the last price or throw a "ghost wick" the stock
never actually traded.

Our developing intraday candle is built CLIENT-SIDE from raw trade ticks off two
feeds (Massive stock WS `T` events — primary; Finnhub trade WS — fallback), and
neither was consulting the condition array. This module is the single source of
truth for "may this print move last / high-low?" used at both ingest points.

Authority model (safe by default):
  • On startup we best-effort fetch the provider's OWN `update_rules` for every
    stock trade condition (Massive is Polygon-compatible: GET /v3/reference/
    conditions). That is the authoritative, always-correct, future-proof map.
  • Until/unless that loads we use a hardcoded fallback built from the published
    SIP consolidated-tape rules (the same condition IDs Massive documents).
  • classify() returns (True, True) — fully eligible — for an empty/missing
    condition list, an unknown code, or when the filter is disabled. So a real
    round-lot trade is NEVER hidden; the worst case is "no filtering" (status
    quo), and any residual ghost still self-heals via the server reconciliation.

Kill-switch: TRADE_CONDITION_FILTER_ENABLED=0 disables all filtering.
"""

from __future__ import annotations

import logging
import os
import threading

log = logging.getLogger(__name__)

# Default OFF after the 2026-07-16 extended-hours incident: filtering Form-T (see
# _SESSION_CODES) froze the post-market last-price cache and flickered the live
# candle during the NFLX earnings sell-off. Re-enable with
# TRADE_CONDITION_FILTER_ENABLED=1 once the extended-hours handling is verified
# live. The RTH ghost-wick heal (StockChart seed-reconcile) is unaffected.
FILTER_ENABLED = os.environ.get("TRADE_CONDITION_FILTER_ENABLED", "0") == "1"

# Extended-hours session-classification codes — NOT print-quality defects. A
# post-market trade is Form T (12); a late-reported ext print is 13. During
# extended hours EVERY print carries one, so filtering them here freezes the
# whole session. RTH-vs-extended is a CLIENT decision (the Regular/Extended
# toggle already gates ext prints by time), so this module must never drop them
# — they are stripped from the ineligible sets whether hardcoded or provider-loaded.
#
# This was the 2026-07-16 NFLX incident: Form-T got filtered → the post-market
# last-price cache froze and the live candle flickered. The IDs below protect the
# hardcoded fallback; the provider-load path ALSO protects by NAME (see
# _is_session_condition) so a differently-numbered Form-T on the feed can never
# re-freeze the session.
_SESSION_CODES = frozenset({12, 13})

# Name markers that identify a session-classification (extended-hours / Form-T)
# condition regardless of its numeric ID. Matched case-insensitively against the
# provider's condition `name`. Deliberately narrow: "out of sequence" alone is a
# genuine ghost (ids 32/33) and must stay filtered — only the extended-session
# markers below exempt a code. Polygon names: 12 "Form T", 13 "Extended Trading
# Hours (Sold Out Of Sequence)".
_SESSION_NAME_MARKERS = ("form t", "extended")


def _is_session_condition(name: str) -> bool:
    """True if a provider condition NAME denotes the extended-hours session
    (Form-T / extended trading hours) — those ride EVERY ext print, so they must
    never be treated as ineligible or the whole session freezes."""
    n = (name or "").lower()
    return any(m in n for m in _SESSION_NAME_MARKERS)


def _parse_provider_rules(results) -> tuple[set[int], set[int]]:
    """Pure parse of the provider's condition list → (hl_ineligible, last_ineligible).

    Extracted from load_from_provider so the session-code exemption is unit-
    testable without a live HTTP call. Session-classification codes are removed
    by BOTH their hardcoded SIP ids (_SESSION_CODES) AND any code the provider
    NAMES as Form-T / extended-hours — belt and suspenders against the freeze.
    """
    hl: set[int] = set()
    last: set[int] = set()
    session_ids: set[int] = set(_SESSION_CODES)
    for cond in results or []:
        cid = cond.get("id")
        if cid is None:
            continue
        try:
            cid = int(cid)
        except (TypeError, ValueError):
            continue
        if _is_session_condition(cond.get("name")):
            session_ids.add(cid)
        rules = (cond.get("update_rules") or {}).get("consolidated") or {}
        if rules.get("updates_high_low") is False:
            hl.add(cid)
        if rules.get("updates_open_close") is False:
            last.add(cid)
    # Never filter the extended session (by id OR by name) — the freeze guard.
    hl -= session_ids
    last -= session_ids
    return hl, last

# Fallback sets (Massive/Polygon numeric condition IDs — see the Stock Trade
# Conditions reference). A condition here means a print carrying it must NOT move
# that metric. Derived from the SIP consolidated-tape update_rules; the runtime
# provider fetch below replaces these with the authoritative live values.
#
#   updates_high_low = FALSE (don't extend the developing bar's high/low). Form-T
#   (12/13) are EXCLUDED via _SESSION_CODES — extended hours is a client decision:
#     2  Average Price Trade      7  Cash Sale            10 Derivatively Priced
#     15 MC Official Close        16 MC Official Open      20 Next Day
#     21 Price Variation          22 Prior Reference Price 29 Seller
#     32 Sold (Out of Seq)        33 Sold (Out of Seq)     37 Odd Lot Trade
#     38 Corrected Consol Close   46 Contingent Trade      52 Contingent Trade
#     53 Qualified Contingent
_HL_INELIGIBLE_FALLBACK = frozenset(
    {2, 7, 10, 15, 16, 20, 21, 22, 29, 32, 33, 37, 38, 46, 52, 53}
)
#   updates_open_close = FALSE (don't move the last price / candle close):
#     same as above minus the official open/close prints (15/16 DO set last) plus
#     30 Sold Last (a late print that can mark a high/low but is not the "last").
_LAST_INELIGIBLE_FALLBACK = frozenset(
    {2, 7, 10, 20, 21, 22, 29, 30, 32, 33, 37, 46, 52, 53}
)

_lock = threading.Lock()
_hl_ineligible: set[int] = set(_HL_INELIGIBLE_FALLBACK) - _SESSION_CODES
_last_ineligible: set[int] = set(_LAST_INELIGIBLE_FALLBACK) - _SESSION_CODES
_loaded_from_provider = False


def classify(conditions) -> tuple[bool, bool]:
    """Return (updates_high_low, updates_last) for a trade's condition list.

    A print is eligible for a metric unless one of its conditions forbids it (the
    most-restrictive condition wins — matches the SIP rule). Empty/missing
    conditions, unknown codes, or a disabled filter => fully eligible (True, True),
    so we never suppress a genuine trade.
    """
    if not FILTER_ENABLED or not conditions:
        return True, True
    hl_ok = True
    last_ok = True
    for c in conditions:
        try:
            ci = int(c)
        except (TypeError, ValueError):
            # Non-numeric code (e.g. a lettered feed) we don't recognize — leave
            # the trade eligible rather than risk hiding real price action.
            continue
        if ci in _hl_ineligible:
            hl_ok = False
        if ci in _last_ineligible:
            last_ok = False
        if not hl_ok and not last_ok:
            break
    return hl_ok, last_ok


def load_from_provider() -> None:
    """Best-effort replace the fallback sets with the provider's authoritative
    `update_rules`. One-shot, blocking (call off the request path — e.g. a startup
    daemon thread). Any failure keeps the safe fallback in place.
    """
    global _hl_ineligible, _last_ineligible, _loaded_from_provider
    if _loaded_from_provider or not FILTER_ENABLED:
        return
    key = os.environ.get("MASSIVE_API_KEY", "")
    if not key:
        return
    try:
        import httpx

        url = (
            "https://api.massive.com/v3/reference/conditions"
            f"?asset_class=stocks&data_type=trade&limit=1000&apiKey={key}"
        )
        r = httpx.get(url, timeout=10.0)
        r.raise_for_status()
        results = r.json().get("results", []) or []
        # The provider's rules are RTH-consolidated, so they mark Form-T /
        # extended-hours ineligible. _parse_provider_rules strips those (by id AND
        # by name) — extended hours is a client decision, never dropped here.
        hl, last = _parse_provider_rules(results)
        if hl or last:
            with _lock:
                _hl_ineligible = hl
                _last_ineligible = last
                _loaded_from_provider = True
            log.info(
                "[trade_conditions] loaded authoritative rules: "
                "%d high/low-ineligible, %d last-ineligible codes",
                len(hl),
                len(last),
            )
    except Exception as e:  # noqa: BLE001 — never let this break startup
        log.warning("[trade_conditions] provider load failed, using fallback: %s", e)


def start_background_load() -> None:
    """Spawn the one-shot provider load in a daemon thread (non-blocking startup)."""
    if not FILTER_ENABLED:
        return
    threading.Thread(target=load_from_provider, name="trade-cond-load", daemon=True).start()


def status() -> dict:
    """Diagnostics for the startup fingerprint / an admin probe."""
    return {
        "enabled": FILTER_ENABLED,
        "loaded_from_provider": _loaded_from_provider,
        "hl_ineligible_count": len(_hl_ineligible),
        "last_ineligible_count": len(_last_ineligible),
    }
