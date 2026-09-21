"""ONE DISCOVERY SYSTEM over two catalogues.

⭐⭐ A MEMBER DOES NOT KNOW THERE ARE TWO CATALOGUES, AND MUST NOT HAVE TO. Typing
`50 day` should find the `% Above 50-Day MA` family across every universe; typing
`McClellan` should find the oscillator and the summation; typing `NASI` should find the
Nasdaq summation whether or not it is servable yet. Those answers live in
`breadth_symbols` (universe × metric) and in `market_indicators.registry` (derived and
ingested series) respectively, and this module is the only place they meet.

⛔⛔ IT OWNS NO FACTS. Every name, family, unit and universe is read from whichever
catalogue owns it, on every call. Adding a metric or a series shows up here without this
file being edited — the test of whether a facade is a projection or a copy.

⛔ AND IT APPLIES THE NAMING RULES RATHER THAN STORING THEIR OUTPUT. A breadth row's
member-facing name is `naming.universe_metric_display(universe, metric_name)`, computed
here, so `Nasdaq · % of Stocks Above 50-Day MA` cannot drift from `UCT · …`.

⚠️ DORMANT SERIES ARE INVISIBLE. `include_dormant` exists for the admin/diagnostic
surface and for tests; discovery never passes it. That is what keeps NYMO designed,
documented and unreachable.
"""
from __future__ import annotations

import re
from typing import Optional

from api.services.market_indicators import naming
from api.services.market_indicators import registry as reg

#: Query words that name the LIBRARY rather than anything in it. Mirrors
#: `breadth_symbols._LIBRARY_NOISE` — "market indicators" must not be required to appear
#: inside a series' own text.
_NOISE = frozenset({"MARKET", "INDICATOR", "INDICATORS", "INDEX", "LIBRARY",
                    "SERIES", "METRIC", "METRICS"})


def _matches(tok: str, text: str) -> bool:
    """Does `tok` occur in `text` as a token a member meant?

    ⛔⛔ A PLAIN SUBSTRING TEST IS WRONG FOR NUMBERS AND THE FAILURE IS SILENT.
    Measured: the query `50 day` returned `Cboe S&P 500 9-Day Volatility Index`,
    because "50" occurs inside "500" and "DAY" inside "9-Day" — a confident, plausible,
    completely irrelevant answer sitting above the A50 family the member asked for.
    A digit run must therefore match on digit boundaries; a word may still match as a
    substring, because `MA` inside `50-Day MA` and `HIGH` inside `HIGHS` are both
    answers somebody wanted.
    """
    if tok.isdigit():
        return re.search(rf"(?<!\d){re.escape(tok)}(?!\d)", text) is not None
    return tok in text


def _tokens(q: str) -> list[str]:
    out, cur = [], []
    for ch in (q or "").upper():
        if ch.isalnum() or ch == "%":
            cur.append(ch)
        elif cur:
            out.append("".join(cur))
            cur = []
    if cur:
        out.append("".join(cur))
    return out


# ── Row shapes ───────────────────────────────────────────────────────────────

def breadth_row(row: dict) -> dict:
    """A `breadth_symbols.library_rows()` row in the unified shape.

    ⭐ RULE 2 AND RULE 4 APPLIED HERE. `symbol` stays whatever the breadth registry
    minted — `UCTA50`, `NASDAQ:A50` — because stored layouts, watchlists and drawings
    hold it. `display` is the sentence. The two are different jobs and neither is
    rewritten to look like the other.
    """
    uni = row.get("universe")
    return {
        "id": f"{str(uni).upper()}:{row.get('code')}",
        "symbol": row.get("symbol"),
        "display": naming.universe_metric_display(uni, row.get("name") or ""),
        "short": naming.universe_metric_short(uni, row.get("short_name") or ""),
        "family": "breadth",
        "family_label": "Breadth",
        "universe": uni,
        "universe_label": naming.universe_display(uni),
        "source_type": reg.SRC_BREADTH_DERIVED,
        "frequency": reg.FREQ_DAILY,
        "unit": row.get("unit"),
        "domain": row.get("domain"),
        "presentation": row.get("presentation"),
        "ohlc_capable": False,
        "status": reg.ST_PUBLISHED,
        "catalogue": "breadth_library",
        # ⭐ THE BREADTH CATALOGUE'S OWN GROUP RIDES ALONG. Unifying everything under a
        # single "Breadth" family is right for the member-facing tab list, but it threw
        # away the sub-family the metrics are actually organised by — and the query
        # `high low` then found only the one metric with both words in its NAME, because
        # "Highs / Lows" was no longer anywhere in the haystack. `library_search` had
        # this right; the union lost it. Carried, not re-derived.
        "sub_family": row.get("group"),
        "sub_family_label": row.get("group_label"),
        "legacy": bool(row.get("legacy")),
        "aliases": [row.get("symbol")] if row.get("symbol") else [],
    }


def indicator_row(s: reg.Series) -> dict:
    out = s.to_row()
    out["catalogue"] = "market_indicators"
    out["legacy"] = False
    return out


def _breadth_haystack(row: dict) -> str:
    return " ".join(str(v).upper() for v in (
        row.get("display"), row.get("short"), row.get("symbol"),
        row.get("universe_label"), row.get("family_label"),
        row.get("sub_family_label")) if v)


def _indicator_haystack(s: reg.Series) -> str:
    return " ".join(s.tokens)


# ── The catalogue projection ─────────────────────────────────────────────────

def catalogue(include_dormant: bool = False, include_breadth: bool = True) -> dict:
    """Every discoverable canonical series, plus the families they fall into."""
    rows: list[dict] = []
    src = reg._ROWS if include_dormant else reg.published_rows()
    rows.extend(indicator_row(s) for s in src)

    if include_breadth:
        try:
            from api.services import breadth_symbols as bs
            for r in bs.library_rows():
                if not r.get("symbol"):
                    continue
                if not bs.is_published(r["universe"], r["metric"]):
                    continue
                rows.append(breadth_row(r))
        except Exception:
            pass

    fams = []
    seen = set()
    for f in reg.FAMILY_ORDER:
        if any(r["family"] == f for r in rows) and f not in seen:
            seen.add(f)
            fams.append({"id": f, "label": reg.FAMILY_LABEL[f]})
    return {"rows": rows, "families": fams,
            "family_order": reg.FAMILY_ORDER,
            "universes": [{"id": u, "label": naming.universe_display(u)}
                          for u in ("uct", "us", "nasdaq", "nyse")]}


# ── Search ───────────────────────────────────────────────────────────────────

def search(q: str, limit: int = 40, include_dormant: bool = False,
           include_breadth: bool = True) -> list[dict]:
    """Ranked results across both catalogues.

    Scoring, best first:

        0  an exact identity, symbol or alias        `NASI`, `UCTA50`, `NASDAQ:A50`
        1  every token is the series' own code       `A50`
        2  a bare universe query                     `NASDAQ`
        3  every token appears in the series' OWN text (name / short / symbol)
        4  every token appears anywhere it may match (family, universe, synonyms)

    ⭐ TIER 3 BEFORE TIER 4 IS WHAT MAKES `new lows` ANSWER WITH NEW LOWS. Both New
    Highs and New Lows match the shared family label "Highs / Lows"; only one of them
    matches "lows" in its own name. `breadth_symbols.library_search` learned this
    exactly, and repeating the tier here rather than importing it is deliberate — this
    ranks a UNION whose two halves have different row shapes.

    ⚠️ A UNIVERSE WORD NARROWS RATHER THAN MATCHES. `NASDAQ 50 MA` means "Nasdaq rows
    about the 50-day MA", not "rows whose text contains NASDAQ".
    """
    raw = (q or "").strip()
    if not raw:
        return []
    cat = catalogue(include_dormant=include_dormant, include_breadth=include_breadth)
    rows = cat["rows"]

    # ── 0. an exact identity wins outright ──────────────────────────────────
    want = raw.upper()
    scored: list[tuple[int, dict]] = []
    exact_ids = set()
    for r in rows:
        keys = {str(r.get("id", "")).upper(), str(r.get("symbol", "")).upper()}
        keys |= {str(a).upper() for a in (r.get("aliases") or [])}
        if want in keys:
            scored.append((0, r))
            exact_ids.add(r["id"])

    toks = _tokens(raw)
    label_to_id = {naming.universe_display(u).upper(): u
                   for u in ("uct", "us", "nasdaq", "nyse")}
    want_unis = {label_to_id[t] for t in toks if t in label_to_id}
    rest = [t for t in toks if t not in label_to_id and t not in _NOISE]

    for r in rows:
        if r["id"] in exact_ids:
            continue
        if want_unis and r.get("universe") not in want_unis:
            continue
        own = " ".join(str(v).upper() for v in
                       (r.get("display"), r.get("short"), r.get("symbol")) if v)
        if r["catalogue"] == "market_indicators":
            s = reg.get(r["id"])
            hay = _indicator_haystack(s) if s else own
        else:
            hay = _breadth_haystack(r)
        code = str(r.get("id", "")).split(":")[-1].upper()

        if not rest:
            score = 2 if want_unis else None
        elif all(t == code for t in rest):
            score = 1
        elif all(_matches(t, own) for t in rest):
            score = 3
        elif all(_matches(t, hay) for t in rest):
            score = 4
        else:
            score = None
        if score is not None:
            scored.append((score, r))

    # ⭐⭐ FAMILY FIRST, THEN THE SERIES' OWN ORDER, THEN UNIVERSE — so `high low`
    # reads as one metric with its universe variants adjacent rather than as every
    # UCT metric followed by every US metric. Stable: a search that reorders itself
    # between identical calls is one nobody can learn.
    fam_rank = {f: i for i, f in enumerate(reg.FAMILY_ORDER)}
    uni_rank = {u: i for i, u in enumerate(("uct", "us", "nasdaq", "nyse"))}
    scored.sort(key=lambda sr: (sr[0],
                                fam_rank.get(sr[1]["family"], 99),
                                str(sr[1].get("display") or ""),
                                uni_rank.get(sr[1].get("universe"), 99)))

    out, seen = [], set()
    for score, r in scored:
        if r["id"] in seen:
            continue
        seen.add(r["id"])
        out.append({**r, "score": score, "symbol_hit": score <= 1})
        if len(out) >= limit:
            break
    return out
