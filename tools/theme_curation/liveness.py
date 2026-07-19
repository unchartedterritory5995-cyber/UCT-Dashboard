"""Liveness split — classify an audit 'dead' name as truly delisted vs merely off cap_universe.

A holding flagged 'dead' (absent from the dashboard's cap_universe) is one of two very
different things:
  - genuinely gone — delisted / taken-private / renamed (e.g. SQ -> XYZ) -> a DROP/REMAP;
  - a valid, still-trading ticker the cap_universe just never picked up (e.g. PAYO, RPAY,
    DDD, WU) -> add it to cap_universe, NOT a taxonomy change.

We split them with the Finnhub `/quote` endpoint (available both locally and on Railway;
the Massive feed key is Railway-only, but this is an owner-run local tool). A nonzero
current price means the ticker trades right now — and, crucially, it also catches
take-privates that leave a *stale* Finnhub company profile behind (SWI, MRO, OLO all
still return a profile but quote 0), which a profile-existence check would wrongly call
live.

Known limitation: a handful of live names quote 0 through this key — recent renames
whose NEW symbol the feed hasn't caught up to (FISV -> FI) and some foreign ADRs (CYBR).
Those stay flagged 'dead' and land in the DROP/REMAP worklist, where owner review (not a
silent auto-drop) is the backstop. The split is a bias, not an oracle.
"""
import os
import time

import requests

_QUOTE = "https://finnhub.io/api/v1/quote"
_TIMEOUT = 8
_SLEEP = 0.12       # politeness between per-ticker quote calls (Finnhub fallback only)
_ENDPOINT_BATCH = 100
_UA = {"User-Agent": "Mozilla/5.0 (curation-liveness)"}   # Cloudflare 1010-blocks bare UAs


def _live_via_endpoint(uniq, url, secret) -> set:
    """Reliable path: the deployed dashboard's Massive-backed /api/admin/ticker-liveness.
    Batched POSTs; a batch that errors leaves its names 'not live' (conservative)."""
    live = set()
    for i in range(0, len(uniq), _ENDPOINT_BATCH):
        chunk = uniq[i:i + _ENDPOINT_BATCH]
        try:
            r = requests.post(url, json={"tickers": chunk},
                              headers={**_UA, "Authorization": f"Bearer {secret}"},
                              timeout=30)
            r.raise_for_status()
            for sym, is_live in (r.json().get("live") or {}).items():
                if is_live:
                    live.add(sym.upper())
        except Exception:
            continue
    return live


def _finnhub_price(sym: str):
    key = os.environ["FINNHUB_API_KEY"]                  # presence guaranteed by live_syms
    fsym = sym.upper().replace("-", ".")                 # Finnhub uses DOT for class shares
    r = requests.get(_QUOTE, params={"symbol": fsym, "token": key}, timeout=_TIMEOUT)
    r.raise_for_status()
    c = (r.json() or {}).get("c")
    try:
        return float(c) if c is not None else None
    except (TypeError, ValueError):
        return None


def live_syms(syms, quote_fn=None) -> set:
    """Return the subset of `syms` (app/hyphen form) that still trade.

    quote_fn(sym) -> price|None; defaults to a Finnhub /quote lookup. A price > 0 means
    the ticker trades (a cap_universe gap); 0 / None / a transient error means a delisted
    candidate. Never raises on a per-ticker failure — that name is treated as 'not live'
    (kept in the curation worklist), the conservative default. A missing FINNHUB_API_KEY
    hard-fails up front (mis-classifying every name as delisted would be worse than a
    clear error) unless a quote_fn is injected.
    """
    uniq = list(dict.fromkeys(s.upper() for s in syms if s))
    if not uniq:
        return set()
    if quote_fn is None:
        # Prefer the reliable Massive-backed endpoint if configured; Finnhub /quote is a
        # fallback and is UNRELIABLE at scale (returns 0 for many live large-caps).
        url = os.environ.get("CURATION_LIVENESS_URL")
        secret = os.environ.get("PUSH_SECRET")
        if url and secret:
            return _live_via_endpoint(uniq, url, secret)
        if not os.environ.get("FINNHUB_API_KEY"):
            raise RuntimeError("liveness needs CURATION_LIVENESS_URL+PUSH_SECRET (reliable) "
                               "or FINNHUB_API_KEY (fallback) — or pass --no-liveness.")
        quote_fn = _finnhub_price
    live = set()
    for i, s in enumerate(uniq):
        try:
            px = quote_fn(s)
        except Exception:
            px = None
        try:
            if px and float(px) > 0:
                live.add(s)
        except (TypeError, ValueError):
            pass
        if quote_fn is _finnhub_price and i + 1 < len(uniq):
            time.sleep(_SLEEP)
    return live
