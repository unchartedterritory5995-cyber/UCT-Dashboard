"""Multi-Chart "Groups" service.

Turns a theme (or a ticker's theme) into a chartable, ranked list of symbols
for the /charts grid. Identity/holdings come from theme_db (SQLite, always
warm); the ranking overlay comes from theme_performance + rs_ranking with a
cold-cache fallback to the taxonomy's curated tier order.

CANONICAL SYMBOL FORM IS HYPHEN + UPPERCASE (BRK-B) — matches cap_universe,
ticker-search, and /api/bars. The taxonomy stores dot class-shares (BRK.B);
convert with to_taxonomy_sym() only for theme_db lookups.
"""
import concurrent.futures as _cf
import json
import logging
import os
import threading
import time

from api.services.cache import cache
from api.services.ticker_meta import _TIER_RANK

_logger = logging.getLogger(__name__)

_CAP_CACHE = {"set": None, "at": 0.0}
_CAP_TTL = 3600.0

_SIZES_CACHE = {"map": None, "at": 0.0}
_SIZES_TTL = 3600.0

_AI_PEERS_MODEL = os.environ.get("GROUPS_AI_PEERS_MODEL", "claude-haiku-4-5")
_AI_PEERS_TTL = 6 * 3600.0            # peers of a ticker barely change — cache 6h
_AI_PEERS_VERSION = "v1"              # bump to invalidate the whole AI-peer cache
_AI_PEERS_TIMEOUT = float(os.environ.get("GROUPS_AI_PEERS_TIMEOUT", "6"))
_AI_PEERS_SEM = threading.Semaphore(int(os.environ.get("GROUPS_AI_PEERS_CONCURRENCY", "3")))

# The "today's move" ranking snapshot fires a LIVE Massive batch on the request
# path (rank_holdings -> _today_map). The Massive httpx client's read timeout is
# 25s, so a single cold/stalled snapshot pinned /api/groups/peers for ~30s and
# no peer/sympathy cell appeared until it returned (the 30-40s cold peer-fill
# bug). Bound the call hard + cache the result briefly so a stall degrades to RS
# ordering fast and a group switch's peers-fill + badge top_n share one snapshot.
_TODAY_TIMEOUT_S = float(os.environ.get("GROUPS_TODAY_SNAPSHOT_TIMEOUT", "3"))
_TODAY_CACHE_TTL = float(os.environ.get("GROUPS_TODAY_SNAPSHOT_TTL", "20"))
_TODAY_CACHE = {}                    # {sym-set key: (out, at)} — tiny, self-pruning by TTL
_TODAY_POOL = _cf.ThreadPoolExecutor(max_workers=4, thread_name_prefix="grp-today")


def normalize_sym(s: str) -> str:
    """App-canonical form for charting/search/cells: uppercase, dot->hyphen."""
    return (s or "").strip().upper().replace(".", "-")


def to_taxonomy_sym(s: str) -> str:
    """Taxonomy (theme_db) form: uppercase, hyphen->dot class-shares."""
    return (s or "").strip().upper().replace("-", ".")


def _cap_universe_path() -> str:
    here = os.path.join(os.path.dirname(__file__), "..", "data", "cap_universe.json")
    return here if os.path.exists(here) else os.path.join("api", "data", "cap_universe.json")


def cap_universe_set() -> set:
    """Cached set of chartable tickers (hyphen form). 1h TTL. A failed/empty
    load is NOT cached so a transient miss retries next call (never pins the
    whole feature 'non-chartable' for an hour)."""
    now = time.monotonic()
    if _CAP_CACHE["set"] and (now - _CAP_CACHE["at"]) < _CAP_TTL:
        return _CAP_CACHE["set"]
    out = set()
    try:
        with open(_cap_universe_path(), "r", encoding="utf-8") as fh:
            data = json.load(fh)
        if isinstance(data, list):
            out = {normalize_sym(t) for t in data if t}
    except Exception as e:
        _logger.warning("groups: cap_universe load failed: %s", e)
        out = set()
    if out:                       # only cache a real (non-empty) universe
        _CAP_CACHE["set"] = out
        _CAP_CACHE["at"] = now
    return out


def is_chartable(sym: str) -> bool:
    return normalize_sym(sym) in cap_universe_set()


def _get_all_themes():
    from api.services import theme_db
    return theme_db.get_all_themes()


def _theme_sizes() -> dict:
    """{theme_id: OWNER holding_count} for every theme. Cached 1h — owner sizes
    only change on a taxonomy reseed (deploy) or an explicit invalidate_sizes().
    ENGINE-INVARIANT: engine-added holdings are EXCLUDED from the count (absent
    source = owner, counted — backward compatible), so a background engine add
    can never change which theme resolve_primary_theme picks. Avoids routing a
    single size lookup through list_groups() (which also computes chartable
    counts + rotation order it doesn't need) and its uncached full-taxonomy
    read — this map backs resolve_primary_theme, which is on the universal
    chart-watermark hot path."""
    now = time.monotonic()
    if _SIZES_CACHE["map"] is not None and (now - _SIZES_CACHE["at"]) < _SIZES_TTL:
        return _SIZES_CACHE["map"]
    out = {}
    try:
        data = _get_all_themes()
        for t in data.get("themes", []):
            out[t["id"]] = sum(1 for h in (t.get("holdings") or []) if h.get("source") != "engine")
    except Exception:
        out = {}
    if out:                       # only cache a real (non-empty) map
        _SIZES_CACHE["map"] = out
        _SIZES_CACHE["at"] = now
    return out


def invalidate_sizes():
    """Drop the theme-size cache. Called by theme_db.invalidate_caches() when
    membership changes (taxonomy reseed / engine overlay swap) so size-based
    primary-theme resolution re-reads fresh counts on the next lookup."""
    _SIZES_CACHE["map"] = None
    _SIZES_CACHE["at"] = 0.0


def _rotation_order():
    """{key -> rank index, hottest first (highest 1-week rank percentile from
    theme-rotation)}. Each ranking row is keyed BOTH by its wire ticker
    (etf-ticker-or-theme-id — exactly what compute_rotation_signals keys
    rankings by) AND by its lowercased theme name, so list_groups() can look
    up etf_ticker/id first and only fall back to name — a wire↔DB name drift
    can no longer silently sink a theme to the cold bottom. {} when the
    rotation cache is cold / unavailable (falls back to name order)."""
    try:
        from api.services import theme_performance
        sig = theme_performance.compute_rotation_signals()
        rankings = (sig or {}).get("rankings") or {}
        rows = []
        for wire_tk, entry in rankings.items():
            nm = (entry.get("name") or "").strip().lower()
            tk = entry.get("ticker") or wire_tk or nm
            if tk or nm:
                rows.append((entry.get("1w_rank"), tk, nm))
        # Hottest first: highest 1w_rank; None ranks sink last; key for ties.
        rows.sort(key=lambda r: (-(r[0]) if r[0] is not None else float("inf"),
                                 str(r[1] or r[2] or "")))
        order = {}
        for i, (_, tk, nm) in enumerate(rows):
            if tk:
                order.setdefault(tk, i)
            if nm:
                order.setdefault(nm, i)
        return order
    except Exception:
        return {}


def list_groups() -> list:
    """Groups for the picker: {id,name,sector_id,etf_ticker,total,chartable,sub_theme_count}, hottest first."""
    data = _get_all_themes()
    cap = cap_universe_set()
    order = _rotation_order()
    rows = []
    for t in data.get("themes", []):
        holdings = t.get("holdings") or []
        chartable = sum(1 for h in holdings if normalize_sym(h.get("sym", "")) in cap)
        rows.append({
            "id": t["id"],
            "name": t["name"],
            "sector_id": t.get("sector_id"),
            "etf_ticker": t.get("etf_ticker"),
            "total": len(holdings),
            "chartable": chartable,
            "sub_theme_count": len(t.get("sub_themes") or []),
        })
    # Hot themes first (rotation rank); themes not in the signal sink to the
    # bottom in stable name order — cold cache => plain alphabetical.
    # Lookup order mirrors _rotation_order's dual keys: the wire ticker
    # (etf_ticker or theme id) is authoritative, name is the drift fallback.
    big = len(rows) + 1

    def _rank(r):
        v = order.get(r.get("etf_ticker") or r["id"])
        if v is None:
            v = order.get((r["name"] or "").strip().lower(), big)
        return v

    rows.sort(key=lambda r: (_rank(r), r["name"]))
    return rows


def _today_map(syms: list) -> dict:
    """{sym(hyphen upper): todaysChangePerc}. One batched Massive snapshot; the
    same source theme_performance uses.

    HARD-BOUNDED (`_TODAY_TIMEOUT_S`) and briefly cached per sym-set: the Massive
    call runs on a dedicated pool with a wall-clock cap, so a stalled snapshot
    (the httpx client's read timeout is 25s) returns {} in ~3s instead of pinning
    /api/groups/peers for 30s — rank_holdings then falls back to RS ordering.
    Only a real (non-empty) result is cached, so a transient stall self-recovers
    on the next call rather than pinning RS-fallback for the whole TTL."""
    if not syms:
        return {}
    norm = sorted({normalize_sym(s) for s in syms if s})
    if not norm:
        return {}
    key = ",".join(norm)
    hit = _TODAY_CACHE.get(key)
    if hit is not None and (time.monotonic() - hit[1]) < _TODAY_CACHE_TTL:
        return hit[0]

    def _fetch():
        from api.services.massive import get_etf_snapshots
        raw = get_etf_snapshots(norm) or {}
        return {normalize_sym(k): v for k, v in raw.items()}

    try:
        out = _TODAY_POOL.submit(_fetch).result(timeout=_TODAY_TIMEOUT_S)
    except Exception:
        out = {}                     # timeout OR fetch error -> RS fallback in rank_holdings
    if out:                          # cache only real data (a stall retries next call)
        now = time.monotonic()
        if len(_TODAY_CACHE) > 256:  # bound the map: drop expired entries first
            for k in [k for k, v in _TODAY_CACHE.items() if (now - v[1]) >= _TODAY_CACHE_TTL]:
                _TODAY_CACHE.pop(k, None)
        _TODAY_CACHE[key] = (out, now)
    return out


def _rs_map() -> dict:
    """{ticker(hyphen upper): rs item}. Cache-only; {} when cold."""
    try:
        from api.services.rs_ranking import compute_rs_scores
        return {normalize_sym(it["ticker"]): it for it in (compute_rs_scores() or [])}
    except Exception:
        return {}


def rank_holdings(holdings: list, by: str = "today", seed: str = None,
                  seed_sub: str = None, scores_out: dict = None) -> list:
    """Rank taxonomy holdings; return chartable hyphen syms best-first.

    holdings: [{sym, tier, sub_theme_id?}] in taxonomy (dot) form.
    Excludes the seed and non-chartable names. No-data names sort last.

    When GROUPS_SWING_GATES_ENABLED, prepends swing-quality bands (a hard
    liquidity prefilter + an RS/ADR momentum sub-score) to the existing order;
    when off, the ordering is byte-identical to the pre-gate implementation.
    seed_sub (peer-fill) floats same-sub-theme names within the liquid tier.
    scores_out, if a dict, receives {sym: gate_score} for observability.
    """
    cap = cap_universe_set()
    seed_hy = normalize_sym(seed) if seed else None
    cands = []
    seen = set()
    for idx, h in enumerate(holdings):
        hy = normalize_sym(h.get("sym", ""))
        if not hy or hy in seen or hy not in cap or hy == seed_hy:
            continue
        # Defensive dedupe (first occurrence wins): a duplicate holdings row
        # (overlay drift, same sym under two sub-themes) must never become two
        # identical grid cells. theme_db's UNIQUE(theme_id, sym) currently
        # prevents dups, but the grid contract must not depend on it surviving.
        seen.add(hy)
        cands.append((idx, hy, h))
    if not cands:
        return []

    today = _today_map([hy for _, hy, _ in cands])
    rs = _rs_map()

    def bands(hy, h):
        t = today.get(hy)
        r = rs.get(hy) or {}
        rank = r.get("rs_rank")
        m1 = (r.get("returns") or {}).get("1m")
        tier = _TIER_RANK.get(h.get("tier"), 99)
        metrics = {"today": t, "rs": rank, "m1": m1}
        primary = "today" if by != "rs" else "rs"
        secondary = "rs" if by != "rs" else "today"
        order = [primary, secondary, "m1"]
        for band, key in enumerate(order):
            v = metrics[key]
            if v is not None:
                return (band, -float(v))
        # Band 3: no data — curated tier order, then taxonomy list position.
        return (len(order), tier)

    from api.services import groups_gates
    on = groups_gates.gates_enabled()
    metrics = groups_gates.swing_metrics([hy for _, hy, _ in cands], rs, today) if on else {}
    if on:
        if _logger.isEnabledFor(logging.DEBUG):
            _logger.debug("groups swing-gate pass-rates: %s", groups_gates.pass_rates(metrics))
        if scores_out is not None:
            for _, hy, _ in cands:
                scores_out[hy] = groups_gates.gate_score(metrics.get(hy))

    def sort_key(c):
        idx, hy, h = c
        existing = bands(hy, h)
        sub_band = 0 if (seed_sub and h.get("sub_theme_id") == seed_sub) else 1
        if on:
            liq, mom = groups_gates.gate_bands(metrics.get(hy))
            if seed_sub is not None:
                return (liq, sub_band, -mom, existing, idx)
            return (liq, -mom, existing, idx)
        if seed_sub is not None:
            return (sub_band, existing, idx)
        return (existing, idx)

    cands.sort(key=sort_key)
    return [hy for _, hy, _ in cands]


def _ranked_as_of() -> str:
    try:
        from api.services.massive import _detect_session
        return _detect_session()
    except Exception:
        return "unknown"


def _theme_holdings(theme_id: str) -> list:
    """Fetch holdings for a theme. Helper for testing and top_n()."""
    from api.services import theme_db
    return theme_db.get_theme_holdings(theme_id)


def _theme_etf(theme_id: str) -> str | None:
    """The theme's ETF ticker (uppercased hyphen form), or None. ETFs chart via
    Massive on demand, so they are NOT cap_universe-filtered."""
    try:
        for t in _get_all_themes().get("themes", []):
            if t["id"] == theme_id:
                etf = t.get("etf_ticker")
                return normalize_sym(etf) if etf else None
    except Exception:
        pass
    return None


def top_n(theme_id: str, n: int, by: str = "today") -> dict:
    holdings = _theme_holdings(theme_id)
    scores = {}
    ranked = rank_holdings(holdings, by=by, scores_out=scores)
    top = ranked[: max(1, int(n))]
    # Per-sym tier + rationale + source + gate score for the cell badges / observability.
    meta = {normalize_sym(h.get("sym", "")): h for h in holdings}
    rows = [{
        "sym": s,
        "tier": (meta.get(s) or {}).get("tier"),
        "rationale": (meta.get(s) or {}).get("rationale") or "",
        "gate_score": scores.get(s),
        "source": (meta.get(s) or {}).get("source", "owner"),
    } for s in top]
    return {
        "group_id": theme_id,
        "syms": top,
        "rows": rows,
        "etf": _theme_etf(theme_id),
        "total": len(ranked),
        "by": "rs" if by == "rs" else "today",
        "ranked_as_of": _ranked_as_of(),
    }


# Style/factor buckets are poor peer sets — excluded from seed resolution.
_FACTOR_THEME_NAMES = {
    "meme & retail", "small cap growth", "dividend aristocrats",
}


def _ai_peer_raw(seed_hy: str, n: int, meta: dict) -> list:
    """One grounded Haiku call → a list of candidate tickers (unvalidated).
    Grounded on the seed's real company identity so the model reasons about a
    named company, not a bare symbol. Bounded by a module semaphore + a client
    timeout so a cold miss can't pin the web pod's shared threadpool. Returns []
    on any error (caller keeps the seed solo)."""
    name = meta.get("name") or ""
    sector = meta.get("sector") or "unknown sector"
    industry = meta.get("industry") or "unknown industry"
    system = (
        "You are a markets assistant. Given a company, list its closest US-listed "
        "public-equity peers — same sector/industry, comparable business. Reply with "
        "ONLY a JSON array of ticker symbols (e.g. [\"WDC\",\"STX\"]). No prose."
    )
    prompt = (
        f"Company: {name} (ticker {seed_hy}). Sector: {sector}. Industry: {industry}.\n"
        f"Return up to {n + 3} closest US-listed peer tickers as a JSON array, "
        f"excluding {seed_hy} itself."
    )
    if not _AI_PEERS_SEM.acquire(timeout=_AI_PEERS_TIMEOUT):
        return []
    try:
        from api.services.engine import _get_anthropic_client
        client = _get_anthropic_client().with_options(timeout=_AI_PEERS_TIMEOUT)
        msg = client.messages.create(
            model=_AI_PEERS_MODEL, max_tokens=200,
            system=system, messages=[{"role": "user", "content": prompt}],
        )
        text = "".join(getattr(b, "text", "") for b in msg.content)
        start, end = text.find("["), text.rfind("]")
        if start == -1 or end <= start:
            return []
        arr = json.loads(text[start:end + 1])
        return [str(t) for t in arr if t] if isinstance(arr, list) else []
    except Exception:
        return []
    finally:
        _AI_PEERS_SEM.release()


def _ai_peers(seed_hy: str, n: int) -> list:
    """Validated AI peers for a ticker NOT in the taxonomy. Grounds on
    ticker_meta; refuses when the seed has no name (nothing to ground on).
    Validates every returned ticker: in cap_universe, shares the seed's sector
    or industry, not the seed. Cached on (SEED, n, version)."""
    seed_hy = normalize_sym(seed_hy)
    key = f"grp_ai_peers::{seed_hy}::{n}::{_AI_PEERS_VERSION}"
    hit = cache.get(key)
    if hit is not None:
        return hit
    from api.services import ticker_meta
    meta = ticker_meta.get_ticker_meta(seed_hy) or {}
    if not meta.get("name"):
        cache.set(key, [], _AI_PEERS_TTL)     # cache the refusal too (cheap, avoids re-calling)
        return []
    seed_sector = (meta.get("sector") or "").strip().lower()
    seed_industry = (meta.get("industry") or "").strip().lower()
    cap = cap_universe_set()
    out = []
    seen = {seed_hy}
    for raw in _ai_peer_raw(seed_hy, n, meta):
        hy = normalize_sym(raw)
        if hy in seen or hy not in cap:
            continue
        pm = ticker_meta.get_ticker_meta(hy) or {}
        ps = (pm.get("sector") or "").strip().lower()
        pi = (pm.get("industry") or "").strip().lower()
        # Sector OR industry must match the seed (drops a real-but-unrelated ticker).
        if (seed_sector and ps == seed_sector) or (seed_industry and pi == seed_industry):
            seen.add(hy)
            out.append(hy)
        if len(out) >= n:
            break
    cache.set(key, out, _AI_PEERS_TTL)
    return out


def _themes_for_ticker(sym: str) -> list:
    from api.services import theme_db
    return theme_db.get_themes_for_ticker(to_taxonomy_sym(sym))


def _theme_size(theme_id: str) -> int:
    return _theme_sizes().get(theme_id, 0)


def resolve_primary_theme(sym: str):
    """The membership row whose theme the seed should take peers from, or None.
    OWNER memberships always outrank engine ones (an engine 'relevant' row must
    never beat ANY owner membership — keypress fills stay engine-invariant);
    within a source, smallest theme where the seed ranks highest by tier; factor
    buckets excluded. Shared with ticker_meta so the displayed theme and filled
    peers agree."""
    rows = [r for r in _themes_for_ticker(sym)
            if (r.get("theme_name") or "").strip().lower() not in _FACTOR_THEME_NAMES]
    if not rows:
        return None
    rows.sort(key=lambda r: (
        0 if r.get("source", "owner") == "owner" else 1,
        _TIER_RANK.get(r.get("tier"), 99),
        _theme_size(r.get("theme_id")),
        r.get("theme_id") or "",
    ))
    return rows[0]


# Finviz catch-all pseudo-industries — NOT peer sets. A broad ETF's "industry"
# is 'Exchange Traded Fund' (SPY's cohort = GLD/HYG/SLV/TAN...), SPACs are
# 'Shell Companies', CEFs are 'Closed-End Fund - *'. Grouping by these fills
# the grid with an unrelated grab-bag, so _industry_peers refuses them and the
# caller falls through to grounded AI peers (usually seed-stays-solo — strictly
# better than confidently wrong peers). Compared lowercased + stripped.
_NON_PEER_INDUSTRIES = {
    "exchange traded fund",
    "shell companies",
    "closed-end fund - debt",
    "closed-end fund - equity",
    "closed-end fund - foreign",
}

_INDUSTRY_COHORT_MAX = 60     # pre-trim big cohorts (Biotechnology ~268 in-cap)
_INDUSTRY_RANK_TTL = 60.0     # ranked-cohort reuse across typed commits


def _industry_cohort_ranked(ind: str) -> list:
    """Ranked chartable cohort for a Finviz industry, briefly cached.

    Ranking fires one live Massive batch snapshot (_today_map) + swing metrics
    over the cohort on the REQUEST path, so this (a) caches the ranked list per
    industry for _INDUSTRY_RANK_TTL — repeated typed commits reuse it — and
    (b) pre-trims oversized cohorts to the top _INDUSTRY_COHORT_MAX by the
    already-cached RS map before the snapshot call, keeping the batch bounded
    (~60 tickers, on par with a theme fill, vs Biotechnology's ~268). The cache
    is seed-agnostic; the caller excludes the seed from the returned list."""
    key = f"grp_ind_rank::{(ind or '').strip().lower()}"
    hit = cache.get(key)
    if hit is not None:
        return hit
    from api.services import industry_map
    cap = cap_universe_set()
    cohort = [normalize_sym(t) for t in industry_map.tickers_in_industry(ind)]
    cohort = [t for t in dict.fromkeys(cohort) if t in cap]
    if len(cohort) > _INDUSTRY_COHORT_MAX:
        rs = _rs_map()

        def _rs_key(t):
            r = (rs.get(t) or {}).get("rs_rank")
            try:
                return -float(r) if r is not None else float("inf")
            except (TypeError, ValueError):
                return float("inf")

        # Stable sort: no-RS names keep alphabetical order, sink last.
        cohort = sorted(cohort, key=_rs_key)[:_INDUSTRY_COHORT_MAX]
    holdings = [{"sym": t, "tier": "relevant", "sub_theme_id": None} for t in cohort]
    ranked = rank_holdings(holdings, by="today")
    cache.set(key, ranked, _INDUSTRY_RANK_TTL)
    return ranked


def _industry_peers(seed_hy: str, n: int) -> dict | None:
    """Orphan fallback: a stock in no theme groups with its Finviz-industry
    cohort (a real peer set — an orphan regional bank fills with regional banks).
    Chartable cap_universe members of the seed's industry, ranked by the same
    swing gate as theme peers. None => no industry / catch-all pseudo-industry
    (_NON_PEER_INDUSTRIES) / no cohort (caller tries AI)."""
    try:
        from api.services import industry_map
        ind = (industry_map.get_industries([seed_hy]) or {}).get(seed_hy)
        if not ind or ind.strip().lower() in _NON_PEER_INDUSTRIES:
            return None
        ranked = _industry_cohort_ranked(ind)
        peers = [t for t in ranked if t != seed_hy][: max(1, int(n))]
        if not peers:
            return None
        return {"industry": ind, "peers": peers}
    except Exception:
        return None   # industry map hiccup => caller falls through to AI peers


# ---------------------------------------------------------------------------
# Index & Macro — a SYNTHETIC group (not a taxonomy theme).
#
# Typing a broad index ETF used to dead-end: it belongs to no theme, and its
# Finviz industry is the catch-all "Exchange Traded Fund" (_NON_PEER_INDUSTRIES),
# so the whole fallback chain returned nothing. This board answers "what kind of
# tape is this?" — index proxies + vol + risk-appetite + cross-asset macro.
#
# It is NEVER a taxonomy theme: it must not appear in Theme Tracker, theme
# performance, or the theme engine's loops, and it never touches theme_db.
# ---------------------------------------------------------------------------
MACRO_GROUP_ID = "index_macro"
MACRO_GROUP_NAME = "Index & Macro"

# The core four are ALWAYS on the board, ALWAYS in this order — ranking purely
# by today's move would let SPY fall off a 3x3 on a quiet day.
MACRO_CORE = ("SPY", "QQQ", "IWM", "DIA")
# The rest, in curated fallback order. This order IS the cold-snapshot board, so
# keep it meaningful: vol, risk-appetite, rates/credit, metals, dollar, breadth.
MACRO_REST = ("VIXY", "SMH", "ARKK", "IBIT", "TLT", "HYG",
              "GLD", "SLV", "UUP", "RSP", "XLK", "XLF")
MACRO_ROSTER = MACRO_CORE + MACRO_REST

# Typed symbols that route to the board. Deliberately WIDER than the roster
# (VOO/UVXY/MDY aren't charted on it but should still land you here) and safe to
# be generous, because macro routing runs only AFTER theme resolution fails.
# SMH/ARKK/IBIT/XLF are intentionally ABSENT — they front real themes.
MACRO_TRIGGERS = frozenset({
    "SPY", "VOO", "IVV", "SPLG", "VTI", "QQQ", "QQQM", "QQQE",
    "IWM", "IJR", "IJH", "DIA", "RSP", "MDY",
    "VIXY", "VXX", "UVXY", "UVIX", "VIXM", "SVXY",
    "TLT", "IEF", "SHY", "HYG", "LQD", "GLD", "SLV", "UUP", "UDN", "XLK",
})


def _macro_order(today: dict, seed: str = None) -> list:
    """The full roster ordered for the grid.

    seed first (so the cell you typed shows what you typed), then MACRO_CORE in
    fixed order, then MACRO_REST by DESCENDING ABSOLUTE today's move — a -4% VIXY
    day is as worth seeing as a +4% one. Names with no snapshot datum sink behind
    the movers in curated order, so a cold/failed snapshot degrades to
    MACRO_ROSTER verbatim rather than to something arbitrary.
    """
    def _rank(sym):
        try:
            return -abs(float(today.get(sym)))
        except (TypeError, ValueError):
            return float("inf")          # no data -> behind every mover

    rest = sorted(MACRO_REST, key=lambda s: (_rank(s), MACRO_REST.index(s)))
    out = list(MACRO_CORE) + rest
    seed_hy = normalize_sym(seed) if seed else None
    if seed_hy:
        out = [seed_hy] + [s for s in out if s != seed_hy]
    return out


def macro_board(n: int, seed: str = None) -> list:
    """The Index & Macro board, best-first, bounded to n cells.

    ONE batched snapshot over the 16 roster names (`_today_map` is already
    wall-clock bounded + briefly cached, so repeated typed commits reuse it).
    A snapshot failure is swallowed — the curated roster order is always a valid
    board, so this can never return empty or raise onto the request path.
    """
    try:
        today = _today_map(list(MACRO_ROSTER))
    except Exception:
        today = {}
    return _macro_order(today, seed)[: max(1, int(n))]


def resolve_peers(sym: str, n: int) -> dict:
    """Peers = the seed's primary theme's other chartable holdings, same
    sub-theme floated to the top, ranked by today's move. On a taxonomy miss,
    falls back to the seed's INDUSTRY cohort, then to grounded-Haiku AI peers."""
    seed_hy = normalize_sym(sym)
    row = resolve_primary_theme(sym)
    if not row:
        ind = _industry_peers(seed_hy, n)
        if ind and ind.get("peers"):
            return {"seed": seed_hy, "group_id": f"industry:{ind['industry']}",
                    "group_name": ind["industry"], "peers": ind["peers"], "source": "industry"}
        ai = _ai_peers(seed_hy, n)
        return {"seed": seed_hy, "group_id": None,
                "peers": ai, "source": "ai" if ai else "none"}

    theme_id = row.get("theme_id")
    seed_sub = row.get("sub_theme_id")
    holdings = _theme_holdings(theme_id)
    # sub-theme float now lives in rank_holdings (seed_sub) so it composes with
    # the swing gate in one pass — liquidity floor first, then sub-theme, then momentum.
    ranked = rank_holdings(holdings, by="today", seed=seed_hy, seed_sub=seed_sub)

    # Multi-membership switcher: the seed's OTHER (non-factor) theme memberships,
    # so the UI can offer "also in: [groups]" to flip which group fills the grid.
    # Defensive — a theme-DB hiccup must never break the peer fill.
    try:
        also_in = [{"id": r.get("theme_id"), "name": r.get("theme_name")}
                   for r in _themes_for_ticker(sym)
                   if r.get("theme_id") and r.get("theme_id") != theme_id
                   and (r.get("theme_name") or "").strip().lower() not in _FACTOR_THEME_NAMES]
    except Exception:
        also_in = []

    # Per-sym membership source for the cell dot (T8): map each ranked sym back
    # to its holding's source. First occurrence wins, mirroring rank_holdings'
    # dedupe; absent source = owner (backward compatible). Peers stay bare syms.
    src_by_sym = {}
    for h in holdings:
        src_by_sym.setdefault(normalize_sym(h.get("sym", "")), h.get("source", "owner"))

    return {
        "seed": seed_hy,
        "also_in": also_in,
        "group_id": theme_id,
        # The theme's display name — without it the frontend header inherits the
        # PREVIOUS group's name on a taxonomy fill (verified mislabel bug).
        "group_name": row.get("theme_name"),
        "peers": ranked[: max(1, int(n))],
        "sources": {s: src_by_sym.get(s, "owner") for s in ranked},
        "source": "taxonomy",
    }
