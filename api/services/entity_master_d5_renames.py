"""D5 CHECKPOINT 6 (renamed only) -- the confirmed-rename producer.

⛔⛔ SCOPE, STATED EXACTLY. The packet's CP6 row names TWO event types:
`symbol_change -> renamed` and `merger -> relation_added`. This module builds
ONLY the first. The second stays unbuilt, and it is not a business decision
withheld -- it is an ABSENT VENDOR SIGNAL, verified live on 2026-09-18:

    GET /vX/reference/tickers/{ticker}/events?apiKey=... on a ticker with a
    REAL, well-known M&A/going-private history --

        ATVI (Activision, acquired by Microsoft, 2023)  -> 404 NOT_FOUND
        TWTR (Twitter, taken private, 2022)               -> 404 NOT_FOUND

    ...while the SAME endpoint, same account, on a ticker with a REAL,
    well-known RENAME history returns real, dated events:

        META -> {"events": [
            {"type": "ticker_change", "ticker_change": {"ticker": "FB"},   "date": "2012-05-18"},
            {"type": "ticker_change", "ticker_change": {"ticker": "META"}, "date": "2022-06-09"},
        ]}

Massive's reference API genuinely covers ticker changes and genuinely does
NOT cover mergers/acquisitions on this account. Fabricating a merger source
would be exactly the violation the spec's own anti-inference rule exists to
prevent, one layer up: inventing a vendor ENDPOINT is worse than inventing a
CORRELATION. `relation_added` stays open until a real source is found -- see
`docs/terminal-research/00-program-control/LEDGER.md`'s D5 CP6 entry for the
proposed next steps if one ever is.

⛔⛔ THE SPEC'S OWN HARD RULE, HONORED EXACTLY (reference-corp-actions-spec.md
§4.2): *"D5 MAY NOT EMIT `renamed` FROM AN INFERENCE... A `symbol_change` row
whose `source_activity` cannot be named is a row that must stay `detected`
and emit nothing."* `entity_master.reconciliation`'s own explicit, tested
boundary is that `proposed_creates` and `proposed_delists` are computed with
NO correlation between them -- a rename looks identical to an unrelated
delisting plus an unrelated new listing from that feed alone. THIS MODULE
DOES NOT CORRELATE THEM EITHER. It reads reconciliation's two independent
lists UNCHANGED, then asks the VENDOR -- for each candidate new symbol, does
Massive's OWN ticker-change history for that instrument name one of
reconciliation's OWN candidate delisted symbols as the immediately preceding
ticker? If yes, that is a vendor-sourced fact (the `source_activity` is the
vendor's own event, with its own date) -- confirmed, not correlated. If no,
the candidate stays exactly as reconciliation left it: `detected`, nothing
emitted.

⛔ INERT-STRAND PRECONDITION, same as CP5: this module is a NEW file OUTSIDE
`entity_master/**`, so flow-worker's existing reachability of that package
(which it RUNS) gains no new edge into this module's own network call.
`tests/test_entity_master_d5_renames.py` proves this both directions --
this module imports nothing new INTO `entity_master/**`, and nothing under
`entity_master/**` imports this module back.

⛔ Never reads `delisted_registry` (Checkpoint-7's guarantee, carried
forward) -- this module's only external inputs are `reconciliation.
run_reconciliation` (itself immune) and Massive's own ticker-events call.
"""
from __future__ import annotations

import logging
from typing import Any

_log = logging.getLogger(__name__)


def _fetch_ticker_events(ticker: str) -> list[dict[str, str]]:
    """Massive's `/vX/reference/tickers/{ticker}/events`, `ticker_change`
    entries only, as `[{"ticker": <prior/current alias>, "date": <ISO>}, ...]`
    in WHATEVER order the vendor returns them -- callers sort by date
    themselves, never assumed here. Returns `[]` on any failure, on a 404
    (no event history for this ticker -- the normal case for most tickers,
    never treated as an error), or if the response shape is not what this
    function expects. Never raises.
    """
    from api.services import massive as _massive

    out: list[dict[str, str]] = []
    try:
        client = _massive._get_client()
        url = (f"{_massive._REST_BASE}/vX/reference/tickers/{ticker}/events"
               f"?apiKey={client._api_key}")
        data = client._get(url) or {}
        events = ((data.get("results") or {}).get("events")) or []
        for e in events:
            if not isinstance(e, dict) or e.get("type") != "ticker_change":
                continue
            tc = e.get("ticker_change") or {}
            prior = tc.get("ticker")
            date = e.get("date")
            if prior and date:
                out.append({"ticker": str(prior).upper(), "date": str(date)})
    except Exception as e:
        _log.info("[d5-renames] ticker-events fetch failed for %s: %s", ticker, e)
        return []
    return out


def find_confirmed_prior_ticker(new_symbol: str) -> tuple[str, str] | None:
    """The vendor's own answer to "did `new_symbol` used to be called
    something else, and if so what, and when." Returns `(prior_ticker,
    transition_date)`, or `None` when there is no history, only one entry
    (this instrument has never been renamed -- IPO'd directly under this
    ticker), or the response shape does not match what this function
    expects (refuses rather than guesses).

    ⛔ The LAST entry by date is expected to be `new_symbol`'s OWN adoption --
    a sanity check against the vendor's response, not an assumption piled on
    top of it. If it does not hold, this returns `None` rather than reading
    some OTHER entry as "the prior ticker."
    """
    events = _fetch_ticker_events(new_symbol)
    if len(events) < 2:
        return None
    events = sorted(events, key=lambda e: e["date"])
    if events[-1]["ticker"] != new_symbol.upper():
        return None
    prior = events[-2]
    return prior["ticker"], events[-1]["date"]


def run_d5_rename_producer(dry_run: bool = True, db_path: str | None = None,
                            max_pages: int = 60) -> dict[str, Any]:
    """One pass: read reconciliation's two independent candidate lists
    UNCHANGED, ask the vendor whether it independently confirms a rename
    between any pair, apply only the confirmed ones.

    `dry_run=True` (default) computes and returns every confirmed candidate
    without calling `apply_event` at all. Never raises -- a provider outage
    on the events lookup costs that ONE candidate (skipped, not confirmed),
    never the whole pass; reconciliation's own dry-run is read-only, so
    calling it here has no side effects regardless of this pass's own
    `dry_run` value.
    """
    from api.services.entity_master import api as em_api
    from api.services.entity_master import reconciliation as _recon

    recon_result = _recon.run_reconciliation(dry_run=True, db_path=db_path, max_pages=max_pages)
    delisted_symbols = {d["symbol"] for d in recon_result["proposed_delists"]}
    create_symbols = [c["symbol"] for c in recon_result["proposed_creates"]]

    confirmed: list[dict[str, str]] = []
    for new_symbol in create_symbols:
        found = find_confirmed_prior_ticker(new_symbol)
        if found is None:
            continue
        old_symbol, transition_date = found
        # ⛔ THE ONE CORRELATION THIS MODULE MAKES, AND IT IS AGAINST THE
        # VENDOR'S OWN ANSWER, NOT RECONCILIATION'S TWO LISTS DIRECTLY: the
        # vendor names `old_symbol` as the prior ticker; if that name is not
        # even in reconciliation's own candidate-delisted set, the vendor is
        # describing a transition this run has no other evidence for at all
        # (e.g. it happened long ago, well outside this run's window) --
        # silently confirming it here would resurrect a ticker reconciliation
        # never proposed touching. Stay silent instead.
        if old_symbol not in delisted_symbols:
            continue
        confirmed.append({
            "old_symbol": old_symbol, "new_symbol": new_symbol,
            "transition_date": transition_date,
        })

    result: dict[str, Any] = {
        "dry_run": dry_run,
        "candidates_checked": len(create_symbols),
        "confirmed_renames": confirmed,
        "applied": 0,
        "rejected": [],
    }
    if dry_run:
        return result

    applied = 0
    for c in confirmed:
        r_old = em_api.resolve(c["old_symbol"], db_path=db_path)
        if r_old.status != "resolved":
            result["rejected"].append({
                "old_symbol": c["old_symbol"], "new_symbol": c["new_symbol"],
                "reason": f"old_symbol resolve status={r_old.status}",
            })
            continue
        r = em_api.apply_event(
            "renamed",
            {
                "entity_id": r_old.entity.entity_id,
                "old_alias": c["old_symbol"], "old_alias_valid_to": c["transition_date"],
                "new_alias": c["new_symbol"], "new_alias_valid_from": c["transition_date"],
            },
            dedup_key=f"d5-rename:{c['old_symbol']}:{c['new_symbol']}:{c['transition_date']}",
            source="d5-renames", db_path=db_path,
        )
        if r.accepted:
            applied += 1
        else:
            result["rejected"].append({
                "old_symbol": c["old_symbol"], "new_symbol": c["new_symbol"], "reason": r.reason,
            })
    result["applied"] = applied
    return result
