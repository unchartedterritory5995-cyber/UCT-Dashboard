"""The app's key for a ticker as the market data vendor writes it, in WHOLE-MARKET feeds.

⚰️ 2026-11-18, production. Balchem's (BCPC) daily chart drew 20.55 on 11-16 and 20.11 on 11-17 after
173.14 on 11-13, and Tutor Perini's (TPC) 15.19 after 98.79: an 88% crash that never traded (an
independent vendor: BCPC 171.48 and 169.63; the stored hourly bars mixed $20 prints into $171 ones).

The vendor marks a preferred series with a lowercase `p` and a right with a lowercase `r`: Brunswick's
preferred C is `BCpC`, AT&T's is `TpC`. Every whole-market feed (the `AM.*` minute stream, the
all-tickers snapshot, grouped daily) carries them beside the common stocks, and each keyed its rows with
`.upper()`: `BCpC` became `BCPC`, and the preferred's bars were written over Balchem's (the snapshot
lists `BCpC` after `BCPC`, so its day bar won every poll). On 2026-11-17's vendor minute file (12,018
symbols, 390 with a lowercase marker) upper-casing collided exactly twice, BCPC and TPC; any new
preferred series can add another.

A vendor ticker with a lowercase letter is a security the app does not serve, so it has NO app key and
every whole-market reader skips it. Class shares keep their mapping (`BRK.B` -> `BRK-B`).

A feed asked for named tickers (`?tickers=` snapshots, per-ticker aggregates, a socket subscription by
symbol) only ever returns the tickers it was asked for and is not concerned.
"""
from __future__ import annotations


def marked(vendor_ticker) -> bool:
    """True when the vendor's ticker carries a lowercase marker (a preferred series, a right)."""
    return any(ch.islower() for ch in str(vendor_ticker or ""))


def app_symbol(vendor_ticker) -> str | None:
    """The app's storage key for a vendor ticker (`BRK.B` -> `BRK-B`), or None when it has none
    (empty, or a lowercase-marked security: `BCpC` is never `BCPC`)."""
    s = str(vendor_ticker or "").strip()
    if not s or marked(s):
        return None
    return s.replace(".", "-")
