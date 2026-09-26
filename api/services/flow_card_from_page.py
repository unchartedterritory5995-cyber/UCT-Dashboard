"""The Discord `/flow` card derived from the Options Flow PAGE's own product (option A, 2026-09-25).

WHY THIS EXISTS. Until now the card was a second derivation of the tape: `live_massive_router`'s
By-Contract rollup through `_row_to_alert`, while the page a member opens runs `processFlowData`
(the partner's `app/src/pages/optionsFlow/flowCompute.js`, executed server-side by the `flow-facts`
Node bundle). Two classifiers over one tape agree on direction most days and disagree on size
every day (the page has no premium floor; the card admits only coloured prints), and on a thin
day the card's blank-sweep presumption can flip a net direction the page does not
(`docs/discord-render/FLOW-CARD-SOURCE-DECISION-2026-09-25.md`). One authority ends that: this
module asks flow-worker for the page's product over the card's window and shapes it into the
payload `flow_ticker_card.render_ticker_flow_card` already draws.

⛔ NOTHING HERE RE-IMPLEMENTS `processFlowData`. Every direction, every side, every dropped print
is the page's own answer. This module only (1) scopes rows to the window the way the page's
Search block does (`_scopeAllDirectional`), (2) re-sums per contract the way its
`_scopedByContract` does, and (3) renames fields.

⛔ THE WINDOWED PRODUCT IS CLOSE TO, NOT IDENTICAL TO, THE PAGE. `processFlowData`'s contract-level
rules (the rescue rule's dominance gate, `consMap`) see only the rows they are given; the page
gives them the ticker's full history and scopes afterwards, this path gives them the window. The
card says "page-derived" in its footer so a reader knows which it is looking at, and the parity
instrument (`tools/flow_card_parity_audit.py`) measures the residual before the flag flips.

⛔ DARK BY DEFAULT. `DISCORD_FLOW_CARD_PAGE_ENABLED` unset or `0` = the card members have today;
`1` = this path, with the rollup as a LABELLED fallback when the product cannot be derived.
"""
from __future__ import annotations

import collections
import datetime as dt
import logging
import os

log = logging.getLogger(__name__)

#: The windows the page-derived path climbs when the one asked for is empty — the same ladder
#: `live_massive_router.TICKER_FLOW_WIDEN_LADDER` uses, restated here only because this module
#: must not import the rollup it exists to replace.
WIDEN_LADDER = (1, 5, 20, "all")
FLAG = "DISCORD_FLOW_CARD_PAGE_ENABLED"


def enabled() -> bool:
    """True only when the operator has opted this path in (`1`/`true`/`on`). Unset is the rollup.

    ⛔ The environment name is a LITERAL here on purpose: `api/services/feature_flag_index.py`
    derives the flag ledger's universe by AST from `os.environ.get("<literal>")`, and a read
    through the `FLAG` constant is invisible to it, which made the ledger's entry read as
    "a gate the code does not read at all". `FLAG` stays for the tests' `monkeypatch.setenv`."""
    return str(os.environ.get("DISCORD_FLOW_CARD_PAGE_ENABLED", "")).strip().lower() in ("1", "true", "yes", "on", "page")


# ── field normalisation ─────────────────────────────────────────────────────────────────────

def mdy(d: dt.date) -> str:
    return f"{d.month}/{d.day}/{d.year}"


def parse_mdy(s) -> dt.date | None:
    """'9/24/2026' → date. The page's rows carry `Dt` as year-less 'M/D'; those are resolved
    against the window's dates by `_resolve_row_date`, never guessed from the wall clock."""
    try:
        m, d, y = (int(x) for x in str(s).strip().split("/"))
        if y < 100:
            y += 2000
        return dt.date(y, m, d)
    except (ValueError, TypeError):
        return None


def expiry_mdy(row: dict) -> str | None:
    """The card wants 'M/D/YYYY'. The page row carries `expiry` as ISO ('2026-10-09T00:00:00.000Z'),
    which is unambiguous; `E` ('10/9' or '1/15/27') is the display form and is the fallback."""
    iso = str(row.get("expiry") or "")
    if len(iso) >= 10:
        try:
            d = dt.date.fromisoformat(iso[:10])
            return mdy(d)
        except ValueError:
            pass
    d = parse_mdy(row.get("E"))
    return mdy(d) if d else None


def signed_moneyness(cp: str, strike: float, spot) -> float | None:
    """The card's convention (`live_massive_router._moneyness`): (spot − strike) / strike × 100,
    sign flipped for puts, so POSITIVE is in the money and |pct| < 1 reads ATM. ⛔ The page's
    `pctFromSpot` is `Math.abs(strike − spot) / spot` — UNSIGNED, a distance — and passing it
    through drew "2% ITM" on an out-of-the-money call. Computed here from the row's own strike
    and spot, never copied."""
    try:
        spot = float(spot); strike = float(strike)
    except (TypeError, ValueError):
        return None
    if not spot or not strike:
        return None
    pct = (spot - strike) / strike * 100.0
    if cp == "P":
        pct = -pct
    return round(pct, 1)


def _resolve_row_date(row: dict, window_dates: list[str]) -> str | None:
    """`Dt` is 'M/D'. Map it onto the window's 'M/D/YYYY' dates by month/day; a row whose M/D is
    not in the window is outside it (or, for an all-history product, resolved to the most recent
    year that makes it ≤ the window end, which is the only reading that cannot invent a future)."""
    raw = str(row.get("Dt") or "").strip()
    parts = raw.split("/")
    if len(parts) == 3:
        d = parse_mdy(raw)
        return mdy(d) if d else None
    if len(parts) != 2:
        return None
    try:
        m, dd = int(parts[0]), int(parts[1])
    except ValueError:
        return None
    for w in window_dates:
        wd = parse_mdy(w)
        if wd and wd.month == m and wd.day == dd:
            return w
    end = max((parse_mdy(w) for w in window_dates if parse_mdy(w)), default=None)
    if end is None:
        return None
    for year in (end.year, end.year - 1):
        try:
            cand = dt.date(year, m, dd)
        except ValueError:
            continue
        if cand <= end:
            return mdy(cand)
    return None


# ── the mapper ──────────────────────────────────────────────────────────────────────────────

def build_payload(product: dict, window_dates: list[str], sym: str, source: str,
                  days_label: str, top_n: int = 15, all_history: bool = False) -> dict:
    """Shape the page product into the `/ticker-flow` payload the card renders.

    `window_dates`: the sessions the product covers ('M/D/YYYY', newest last). For a windowed
    product they are also the rows' universe; for an all-history product (`all_history=True`)
    they are the dates the rows resolved to and nothing is filtered out.
    """
    rows = list((product or {}).get("all_directional") or [])
    win = set(window_dates)
    by: dict = collections.OrderedDict()
    resolved_dates: set = set()
    for r in rows:
        day = _resolve_row_date(r, window_dates)
        if day is None or (not all_history and day not in win):
            continue
        exp = expiry_mdy(r)
        cp = str(r.get("CP") or "").upper()[:1]
        try:
            strike = float(r.get("K"))
        except (TypeError, ValueError):
            continue
        if not cp or not exp:
            continue
        key = (cp, strike, exp)
        g = by.get(key)
        if g is None:
            g = by[key] = {"cp": cp, "strike": strike, "exp": exp, "premium": 0.0, "volume": 0.0,
                           "bull": 0.0, "bear": 0.0, "px_sum": 0.0, "px_vol": 0.0, "oi": 0,
                           "dte": None, "spot": None, "moneyness": None, "dates": set()}
        p = float(r.get("P") or 0)
        v = float(r.get("V") or 0)
        g["premium"] += p
        g["volume"] += v
        d = str(r.get("D") or "").upper()
        if d == "BULL":
            g["bull"] += p
        elif d == "BEAR":
            g["bear"] += p
        px = r.get("price")
        if px is not None and v > 0:
            g["px_sum"] += float(px) * v
            g["px_vol"] += v
        try:
            g["oi"] = max(g["oi"], int(r.get("OI") or 0))
        except (TypeError, ValueError):
            pass
        if r.get("DTE") is not None:
            try:
                g["dte"] = int(r["DTE"]) if g["dte"] is None else min(g["dte"], int(r["DTE"]))
            except (TypeError, ValueError):
                pass
        if r.get("Spot") is not None:
            g["spot"] = r.get("Spot")
            g["moneyness"] = signed_moneyness(cp, strike, r.get("Spot"))
        g["dates"].add(day)
        resolved_dates.add(day)

    contracts = []
    for g in by.values():
        if g["bull"] > 0 and g["bear"] > 0:
            direction = "Mixed"
        elif g["bull"] > g["bear"]:
            direction = "Bull"
        elif g["bear"] > g["bull"]:
            direction = "Bear"
        else:
            direction = "Unclear"
        days_sorted = sorted(g["dates"], key=lambda s: parse_mdy(s) or dt.date.min)
        contracts.append({
            "ticker": sym, "cp": g["cp"], "strike": g["strike"], "exp": g["exp"], "dte": g["dte"],
            "premium": round(g["premium"]), "volume": int(g["volume"]),
            "oi": g["oi"] or None,
            "voi": (round(g["volume"] / g["oi"], 1) if g["oi"] else None),
            "direction": direction,
            "bull_premium": round(g["bull"]), "bear_premium": round(g["bear"]),
            "grade": None, "moneynessPct": g["moneyness"],
            "days_active": len(days_sorted), "first_seen": days_sorted[0] if days_sorted else None,
            "entry": (round(g["px_sum"] / g["px_vol"], 2) if g["px_vol"] else None),
            "now": None, "perf": None, "oiSeries": None,
        })
    contracts.sort(key=lambda c: -c["premium"])
    bull = sum(c["bull_premium"] for c in contracts)
    bear = sum(c["bear_premium"] for c in contracts)
    spot = next((c_spot for c_spot in (g["spot"] for g in by.values()) if c_spot), None)
    ds = sorted(resolved_dates, key=lambda s: parse_mdy(s) or dt.date.min)
    return {
        "ok": True, "symbol": sym, "source": source, "spot": spot,
        "net": {"bull": round(bull), "bear": round(bear), "unclassified": 0,
                "dir": "BULL" if bull > bear else ("BEAR" if bear > bull else "NEUTRAL")},
        "window": {"start": ds[0] if ds else None, "end": ds[-1] if ds else None,
                   "active_days": len(ds), "days_requested": days_label},
        "contract_count": len(contracts), "contracts": contracts[:top_n],
        "query_date": window_dates[-1] if window_dates else None,
        "derivation": "page",
    }


def enrich_live(payload: dict) -> dict:
    """Best-effort live OI + mark for the shown contracts, the same call the rollup card makes
    (`massive_oi_snapshots.fetch_price_oi_for_contracts`, cached ≤60 s). Never raises; a miss
    leaves the page's OI and no perf, which the card renders as a dash."""
    try:
        from api import massive_oi_snapshots as moi
        chain = moi.fetch_price_oi_for_contracts(payload.get("symbol"), payload.get("contracts") or [])
        canon = moi._canon_mdy
    except Exception:  # noqa: BLE001 — decoration, never the card
        return payload
    for c in payload.get("contracts") or []:
        try:
            k = (c["cp"], float(c["strike"]), canon(str(c.get("exp") or "")))
        except (TypeError, ValueError):
            continue
        e = chain.get(k) or {}
        if e.get("oi") is not None:
            c["oi"] = e["oi"]
            c["voi"] = round(c["volume"] / e["oi"], 1) if e["oi"] else None
        now = e.get("price")
        if now is not None:
            c["now"] = now
            entry = c.get("entry")
            if entry and float(entry) > 0 and float(now) > 0:
                c["perf"] = round((float(now) - float(entry)) / float(entry) * 100.0, 1)
    return payload


# ── the fetch, with the ladder and the fallback ─────────────────────────────────────────────

def _ladder(days: str) -> list:
    d = str(days or "1").strip().lower()
    if d == "all":
        return ["all"]
    try:
        n = max(1, int(float(d)))
    except ValueError:
        n = 1
    return [n] + [r for r in WIDEN_LADDER if r == "all" or int(r) > n]


def fetch_product(ticker: str, source: str, window, timeout_s: float, *, get=None) -> dict | None:
    """One windowed page product from flow-worker, or None when it cannot be derived.

    `source` is the CARD's word (`stocks` | `etfs`); the page's is `indexes` for the ETF/index
    partition. `window` is an int of trading days or "all". The internal call carries the
    PUSH_SECRET bearer that `require_flow_user` accepts, so no session is needed."""
    base = (os.environ.get("WORKER_INTERNAL_URL") or "").rstrip("/")
    if not base:
        return None
    page_source = "indexes" if source == "etfs" else "stocks"
    params = {"source": page_source}
    if window != "all":
        params["window_days"] = int(window)
    headers = {}
    secret = os.environ.get("PUSH_SECRET") or ""
    if secret:
        headers["Authorization"] = f"Bearer {secret}"
    try:
        if get is None:
            import httpx
            r = httpx.get(f"{base}/api/flow/ticker-product/{ticker}", params=params,
                          headers=headers, timeout=timeout_s)
            if not r.is_success:
                log.info("[flow-card:page] %s window=%s declined: HTTP %s", ticker, window, r.status_code)
                return None
            body = r.json()
        else:
            body = get(ticker, params, headers)
    except Exception as e:  # noqa: BLE001 — a failed derivation is the fallback's job
        log.info("[flow-card:page] %s window=%s failed: %s", ticker, window, e)
        return None
    if not isinstance(body, dict) or not body.get("ok"):
        return None
    return body


#: The row cap for the derivation basis. Under it the basis is the symbol's FULL stored history
#: (exact parity with the page); over it, the newest sessions that fit, labelled on the card.
#:
#: ⭐ 250K, NOT 150K, and the reason is a wrong direction, not speed. Measured 2026-09-25 with the
#: page's own bundle in the flow-worker pod: AMD's newest 37 sessions (the 150K basis) read BULL
#: $9.2M/$2.7M for 9/25 while the page read BEAR $948K/$1.53M; full history (224K rows) matched
#: the page exactly. Rows per symbol that day: 14 names over 150K, 8 over 250K (SPXW 1262K, SPY
#: 956K, QQQ 791K, MU 609K, SPX 549K, SNDK 452K, NVDA 386K, TSLA 377K), so 250K gives META 238K,
#: AMD 224K, AMZN 196K, AAPL 170K and MSFT 150K their full history. Cost, end to end through
#: production after hours: AMD 19.9 s, PLTR 87K 6.4 s, MSTR 72K 5.7 s, HOOD 34K 3.3 s; a 400K
#: basis took SPY 27 s and NVDA over the page's own 48 MB budget. The pre-V2 job allows 30 s; the
#: dark V2 path's 10 s would send anything this size to the labelled rollup fallback.
BASIS_ROWS = 250_000

#: How long the job waits for the page-derived card before answering with the labelled rollup.
#: 45 s, not the rollup's 30: a first build of a 150-250K-row name after it traded takes ~10-20 s
#: on an idle pod (AMD 20.0 s, measured 2026-09-25 after the close), and during RTH the pod is also
#: consuming the tape. The interaction is deferred (Discord allows 15 min), and a wait is better
#: than a different classifier's answer (the rollup read BULL for AMD and META on 9/25 where the
#: page read BEAR). Every build that outlives the wait still lands and serves the next request.
PAGE_FETCH_TIMEOUT_S = float(os.environ.get("FLOW_CARD_PAGE_TIMEOUT_S", "45") or 45)


def fetch_basis_product(ticker: str, source: str, cap_rows: int, timeout_s: float, *, get=None,
                        diag: dict | None = None) -> dict | None:
    """The page's derivation over the largest recent history under `cap_rows`, or None.

    `get(ticker, params, headers)` replaces the internal HTTP call: the tests' fake, and the parity
    tool's member session through web. With a `get`, no worker URL is needed. `diag`, when given,
    receives `reason` for a None — timeout / busy / too big / … — which the /flow outcome ledger
    records so a rollup fallback says WHY (flow_card_ops)."""
    diag = diag if diag is not None else {}
    base = (os.environ.get("WORKER_INTERNAL_URL") or "").rstrip("/")
    if not base and get is None:
        diag["reason"] = "no worker url"
        return None
    params = {"source": "indexes" if source == "etfs" else "stocks", "basis_rows": int(cap_rows)}
    headers = {}
    secret = os.environ.get("PUSH_SECRET") or ""
    if secret:
        headers["Authorization"] = f"Bearer {secret}"
    try:
        if get is None:
            import httpx
            r = httpx.get(f"{base}/api/flow/ticker-product/{ticker}", params=params,
                          headers=headers, timeout=timeout_s)
            if not r.is_success:
                log.info("[flow-card:page] %s basis declined: HTTP %s", ticker, r.status_code)
                try:
                    why = (r.json() or {}).get("error")
                except Exception:  # noqa: BLE001
                    why = None
                diag["reason"] = _reason(why) or f"http {r.status_code}"
                return None
            body = r.json()
            as_of = r.headers.get("X-Flow-Basis-As-Of")
            if as_of and isinstance(body, dict):
                body["_as_of"] = float(as_of)       # served a product the tape has moved past
        else:
            body = get(ticker, params, headers)
    except Exception as e:  # noqa: BLE001 — a failed derivation is the fallback's job
        log.info("[flow-card:page] %s basis failed: %s", ticker, e)
        diag["reason"] = "timeout" if "timeout" in type(e).__name__.lower() else type(e).__name__
        return None
    if not isinstance(body, dict) or not body.get("ok"):
        diag["reason"] = _reason(body.get("error") if isinstance(body, dict) else None) or "bad body"
        return None
    return body


def _reason(error) -> str | None:
    """flow_router's decline words → the ledger's short reason ("too big to derive within budget"
    → "too big")."""
    e = str(error or "").strip().lower()
    if not e:
        return None
    for key, short in (("busy", "busy"), ("too big", "too big"), ("timeout", "timeout"),
                       ("bundle", "bundle unavailable"), ("not warm", "not warm")):
        if key in e:
            return short
    return e[:40]


def page_derived_payload(ticker: str, days: str, source: str, timeout_s: float = 20.0,
                         top_n: int = 15, *, get=None, cap_rows: int = BASIS_ROWS,
                         enrich: bool = True, diag: dict | None = None) -> dict | None:
    """The page-derived card payload for `/flow ticker days`: ONE derivation (`basis_rows`), then
    the display ladder (days → 5 → 20 → all) climbed over that same product, each rung scoped to
    the MARKET's last N sessions the way the page's `_scopeAllDirectional` scopes "Last N".

    Returns None only when the product could not be derived (the caller then answers with the
    LABELLED rollup). A product that is empty on every rung returns an empty payload carrying
    `widened_checked`, so the reply's "none on record" sentence is spoken on the same evidence
    the rollup path uses. `timeout_s` bounds the single fetch; nothing here retries.

    `window.scope_dates` names the sessions the served rung summed, so an audit can scope the
    page's own product to exactly those dates. `enrich=False` skips the live OI/mark decoration
    (it never changes a premium, a side or a count), which the parity tool does off-box."""
    body = fetch_basis_product(ticker, source, cap_rows, timeout_s, get=get, diag=diag)
    if body is None:
        return None
    product = body.get("product") or {}
    basis = list(body.get("window_dates") or [])
    market = list(body.get("market_dates") or []) or basis[-20:]
    complete = bool(body.get("basis_complete"))
    asked = str(days or "1")
    rungs = _ladder(asked)
    first_label = "all" if asked.lower() == "all" else str(rungs[0])
    payload = None
    for rung in rungs:
        if rung == "all":
            label = "all" if complete else str(len(basis))
            scope = basis or market
            payload = build_payload(product, scope, ticker, source, label,
                                    top_n=top_n, all_history=True)
        else:
            label = str(rung)
            scope = market[-int(rung):]
            payload = build_payload(product, scope, ticker, source, label, top_n=top_n)
        payload["window"]["basis_sessions"] = len(basis)
        payload["window"]["basis_complete"] = complete
        payload["window"]["scope_dates"] = list(scope)
        payload["window"]["scope_all_history"] = rung == "all"
        payload["window"]["as_of"] = body.get("_as_of")
        if payload["contracts"]:
            if label != first_label:
                payload["window"]["widened_from"] = first_label
            return enrich_live(payload) if enrich else payload
    payload["window"]["days_requested"] = first_label
    payload["window"]["widened_checked"] = [str(r) for r in rungs[1:]]
    return payload
