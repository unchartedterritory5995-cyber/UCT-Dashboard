"""Discord's names for every breadth-family series `/chart` can draw.

The site charts far more than the 45 shipped `UCT…` symbols: the Breadth Library's
US / NYSE / Nasdaq rows (`US:A50`, `NASDAQ:NETHL`) and the market-indicator registry
(McClellan, exchange A/D, Zweig, sentiment, volatility, COT). `/chart` could reach
none of them: its ticker pattern refuses a colon, and a plain name like NAMO went
down the stock path and drew the candle stand-in with stock stats.

Owner ruling 2026-10-19: every one is typed as "UCT" + a short code, no colon
(`UCTNQA50`, `UCTNAMO`, `UCTESCOMM`). The Discord name is what the reply, the
buttons and every custom_id carry (they only allow `[A-Z0-9.^-]`); it is turned into
the site's own symbol only where data is read: `fetch_bars` (the stand-in) and
`/api/r/breadth-bars` (the house page).

⛔ NOTHING HERE IS A SECOND CATALOGUE. The rows come from `breadth_symbols` and
`market_indicators.registry` on every build, and an entry is offered or resolved
only while its own authority publishes it (`bs.resolve` / `reg.resolve`), so a flag
that hides `NASDAQ:A50` hides `UCTNQA50` too.
"""
from __future__ import annotations

import logging
import re
import threading
from dataclasses import dataclass
from typing import Optional

log = logging.getLogger("discord_breadth_names")

#: The Discord ticker pattern (`discord_interactions._TICKER_RE`); a name that does
#: not fit is never minted.
_NAME_RE = re.compile(r"^[A-Z0-9.^-]{1,12}$")

#: Universe / namespace → the letters after "UCT". Nasdaq is NQ and NYSE is NY, the
#: shapes members already read off futures and index tickers.
_UNIVERSE_CODE = {"us": "US", "nyse": "NY", "nasdaq": "NQ"}
_NAMESPACE_CODE = {"US": "US", "NYSE": "NY", "NASDAQ": "NQ", "SENT": "", "CBOE": "", "UCT": ""}

#: The exchange McClellan / A/D rows keep the names the market already uses (NAMO is
#: NAMO), so they become UCTNAMO rather than UCTNQMCO.
_ESTABLISHED = {"NYSE:MCO": "NYMO", "NYSE:MCS": "NYSI", "NYSE:AD": "NYAD",
                "NASDAQ:MCO": "NAMO", "NASDAQ:MCS": "NASI", "NASDAQ:AD": "NAAD"}

#: AAII's components, short enough to fit 12 characters beside "UCTAAII".
_AAII = {"BULLS": "BULL", "BEARS": "BEAR", "NEUTRAL": "NEUT"}

#: Group labels for the autocomplete's round-robin and the help text.
_FAMILY_GROUP = {"mcclellan": "McClellan", "breadth": "Breadth indicators",
                 "sentiment": "Sentiment", "volatility": "Volatility",
                 "positioning": "COT positioning"}


@dataclass(frozen=True)
class Entry:
    name: str        # what a member types: UCTNQA50
    symbol: str      # the site's own symbol: NASDAQ:A50
    title: str       # what the reply and the watermark say
    group: str       # autocomplete group
    kind: str        # 'breadth' (breadth_symbols) | 'indicator' (market_indicators)
    weekly: bool = False  # one observation a week (COT, AAII, NAAIM): opens on the weekly chart


_LOCK = threading.Lock()
_CANDIDATES: Optional[dict] = None


def _indicator_name(series_id: str) -> Optional[str]:
    """`COT:ES:COMM` → `UCTESCOMM`, `NASDAQ:MCO` → `UCTNAMO`, `CBOE:VIX9D` → `UCTVIX9D`."""
    sid = series_id.upper()
    if sid in _ESTABLISHED:
        return "UCT" + _ESTABLISHED[sid]
    parts = sid.split(":")
    if parts[0] == "COT" and len(parts) == 3:
        return "UCT" + parts[1] + parts[2]
    if parts[0] == "AAII" and len(parts) == 2:
        return "UCTAAII" + _AAII.get(parts[1], parts[1])
    if parts[0] in _NAMESPACE_CODE and len(parts) == 2:
        return "UCT" + _NAMESPACE_CODE[parts[0]] + parts[1]
    return None


def _build() -> dict:
    """Every name that COULD be offered, published or not: {name: Entry}."""
    from api.services import breadth_symbols as bs
    from api.services.market_indicators import registry as reg
    out: dict = {}

    def add(e: Entry) -> None:
        if not _NAME_RE.match(e.name):
            log.error("[discord-breadth] %s (%s) does not fit a Discord ticker; not offered", e.name, e.symbol)
            return
        if e.name in out:
            log.error("[discord-breadth] %s names both %s and %s; keeping the first",
                      e.name, out[e.name].symbol, e.symbol)
            return
        out[e.name] = e

    # The 45 shipped symbols, unchanged: their Discord name IS their symbol.
    labels = {g: (bs.LIST_META.get(g) or {}).get("label", g) for g in getattr(bs, "GROUP_ORDER", [])}
    for sym, metric, title, group in bs._ROWS:
        add(Entry(sym.upper(), sym.upper(), title, labels.get(group, group), "breadth"))

    from api.services.market_indicators import naming
    for row in bs.library_rows():
        code = _UNIVERSE_CODE.get(row.get("universe"))
        if not code or not row.get("symbol") or not row.get("code"):
            continue
        add(Entry("UCT" + code + str(row["code"]).upper(), row["symbol"],
                  naming.universe_metric_display(row["universe"], row["name"]),
                  f"{naming.universe_display(row['universe'])} breadth", "breadth"))

    for sid in reg.SERIES_IDS:
        s = reg.SERIES.get(sid)
        if s is None:
            continue
        nm = _indicator_name(s.id)
        if nm is None:
            log.error("[discord-breadth] no Discord name rule for %s; not offered", s.id)
            continue
        add(Entry(nm, s.id, s.display, _FAMILY_GROUP.get(s.family, s.family), "indicator",
                  weekly=(s.frequency == reg.FREQ_WEEKLY)))
    return out


def _candidates() -> dict:
    global _CANDIDATES
    if _CANDIDATES is None:
        with _LOCK:
            if _CANDIDATES is None:
                _CANDIDATES = _build()
    return _CANDIDATES


def _published(e: Entry) -> bool:
    try:
        if e.kind == "breadth":
            from api.services import breadth_symbols as bs
            return e.symbol in bs.SYMBOLS or bs.resolve(e.symbol) is not None
        from api.services.market_indicators import registry as reg
        return reg.resolve(e.symbol) is not None
    except Exception as ex:  # noqa: BLE001 — an authority that cannot answer publishes nothing
        log.warning("[discord-breadth] publish check failed %s: %s", e.symbol, ex)
        return False


def lookup(name: str) -> Optional[Entry]:
    """The entry a member's typed name charts, or None (not ours, or not published)."""
    e = _candidates().get((name or "").strip().upper().lstrip("$"))
    return e if e is not None and _published(e) else None


def site_symbol(name: str) -> Optional[str]:
    """The site's own symbol for a Discord name, or None."""
    e = lookup(name)
    return e.symbol if e else None


def catalogue() -> list:
    """Every published entry, in build order (shipped 45 first)."""
    return [e for e in _candidates().values() if _published(e)]


def choices(q: str, cap: int) -> list:
    """Entries for the /chart autocomplete.

    A bare "UCT" or "BREADTH" takes the groups in turn so no group is cut off by the
    cap; any other query ranks a name prefix ahead of a title match ("nasdaq 50"
    matches every word of a title)."""
    needle = (q or "").strip().upper().lstrip("$")
    if not needle:
        return []
    rows = catalogue()
    if needle in ("UCT", "BREADTH"):
        groups: dict = {}
        for e in rows:
            groups.setdefault(e.group, []).append(e)
        cols = list(groups.values())
        picked = [col[i] for i in range(max((len(c) for c in cols), default=0)) for col in cols if i < len(col)]
        return picked[:cap]
    words = [w for w in re.split(r"[\s·:/,-]+", needle) if w]
    # ⛔ A SET GETS NO CHOICE ("UCTNYMO UCTNQNETHL" arrives truncated as "UCTNYMO UC").
    # A word search would match it to UCTNYMO, and Enter takes the highlighted choice,
    # so the member's set would chart one name (the #415 failure, measured live
    # 2026-10-19). A first word that is already a whole name or ticker means a set.
    tokens = [t for t in re.split(r"[\s,+]+", needle) if t]
    if len(tokens) > 1 and (tokens[0] in _candidates() or (tokens[0].startswith("UCT") and len(tokens[0]) > 3)):
        return []
    prefix = [e for e in rows if e.name.startswith(needle)]
    seen = {e.name for e in prefix}
    titled = [e for e in rows if e.name not in seen and words
              and all(w in (e.title.upper() + " " + e.group.upper() + " " + e.name) for w in words)]
    return (prefix + titled)[:cap]
