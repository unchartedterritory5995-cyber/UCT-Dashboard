"""The ETF/INDEX classification GENERATION — one authority for the digest.

Extracted so both ends of the replication wire can compute it without the
receiver importing `api.ticker_types`. That module is the ROUTING classifier
(`classify` -> `massive_processor.is_index_source` -> where every live OPRA trade
is stored), and the Options Flow replica is deliberately forbidden from touching
it. A shared pure function is the way to have one digest without one coupling.

⛔ `last_synced` + a row count is NOT an identity. Timestamps are operational
metadata, and two different symbol sets can share a count — a swap of one ticker
for another is invisible to both. Measured 2026-09-07: web held 19,483 ETF/INDEX
symbols at 2026-09-07T09:30 while flow-worker held 18,863 at 2026-07-14T05:30,
frozen at the P5 cutover for 55 days. The digest is what makes that provable
rather than inferred.
"""
import hashlib


def generation_from_pairs(pairs) -> str:
    """sha256 over the canonical sorted (ticker, asset_type) projection.

    Order-independent by construction (the input is sorted here, not by the
    caller), so two services that hold the same classification always agree
    regardless of how their rows happen to be stored.
    """
    h = hashlib.sha256()
    for ticker, asset_type in sorted((str(t), str(a)) for t, a in pairs):
        h.update(ticker.encode("utf-8"))
        h.update(b"\x1f")
        h.update(asset_type.encode("utf-8"))
        h.update(b"\x1e")
    return h.hexdigest()
