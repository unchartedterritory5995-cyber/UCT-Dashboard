"""Wave 13 lane 13H-1 -- the chart plan, as the SERVER reads it: one chart block's plan levels,
the member's sizing inputs, and Compass's sizing answer.

The member draws the plan on a chart in a note (lane 13H-2's panel, `lib/chartPlan.js` writes
the shape): a horizontal line carries `role: entry | stop | target` inside the embed's existing
`annotations`, and the planned shares ride `ta.planBlock`. This module never parses that shape.

⛔ ONE READER OF PLAN LEVELS. `read_block_plan` hands the block to `plan_extract.read_note_plan`
(lane 13A-1) wrapped as a one-node document, so the panel, the grader, the export line and every
later consumer read the SAME numbers through the SAME precedence and contradiction rules
("unreadable", nearest target). A second parser here would be a second authority.

⛔ NO NEW SIZING FORMULA (ruling P3). Compass's `brain_service.size_a_trade` answers for a long
when the brain pack is installed; the client's `lib/chartPlan.js` evaluates the trader STARTER
FORMULAS (`position_size`, `risk_per_share`, `r_multiple`) otherwise. This module only asks
Compass, labels the answer, and never computes shares itself.

⛔ THE SERVER NEVER WRITES A NOTE. Everything here is a read; a plan reaches a note only through
the member's own editor transaction (R-12). `notebook_chart_alerts.py` is the router; arming an
alert goes through the EXISTING watchlist-alert route function, never a new pipeline.

The gate is `NOTEBOOK_CHART_PLAN_ENABLED` (unset = OFF), read per call through the one Notebook
flag parse. The `ta` schema attribute itself is NOT gated (it is schema, always present).
"""
from __future__ import annotations

import json
import math
from typing import Any

from api.services.notebook_flags import flag_on
from api.services.journal_two import plan_extract

FLAG = "NOTEBOOK_CHART_PLAN_ENABLED"

#: The widget id of a chart embed (`widgets/registry.js` `chart`).
CHART_WIDGET = "chart"

#: How the two sizing engines name themselves. ⛔ ONE FACT IN TWO FILES with `SIZED_BY` in
#: app/src/pages/journal-2-0/lib/chartPlan.js, pinned by tests/test_notebook_chart_plan.py.
SIZED_BY_COMPASS = "compass"
SIZED_BY_STARTER = "starter"

COMPASS_PAID_REASON = "Compass sizing needs a paid plan"
COMPASS_LONG_ONLY_REASON = "Compass sizes longs only"


def enabled() -> bool:
    """The gate, read PER CALL (default OFF)."""
    return flag_on(FLAG, False)


def _finite_positive(v: Any) -> float | None:
    if isinstance(v, bool) or not isinstance(v, (int, float)):
        return None
    f = float(v)
    return f if math.isfinite(f) and f > 0 else None


def clean_symbol(v: Any) -> str | None:
    if not isinstance(v, str):
        return None
    s = v.strip().lstrip("$").upper()
    return s if s and len(s) <= 16 and all(c.isalnum() or c in ".-" for c in s) else None


# ── the block, and its plan through plan_extract ──────────────────────────────────────────────

def block_doc(attrs: dict[str, Any]) -> dict[str, Any]:
    """A one-node document holding the chart block, the shape `plan_extract` walks."""
    return {"type": "doc", "content": [{"type": "widgetEmbed", "attrs": attrs}]}


def read_block_plan(attrs: Any, symbol: str | None = None) -> dict[str, Any]:
    """The plan ONE chart block names, read by plan_extract (chart shape only -- a lone block
    has no canvas, properties or text). Never raises.

    -> {"roles": {entry|stop|target|shares: RoleReading.as_dict()}, "setup": str|None,
        "entry": float|None, "stop": float|None, "target": float|None, "shares": float|None,
        "side": "long"|"short"|None}
    """
    a = attrs if isinstance(attrs, dict) else {}
    reading = plan_extract.read_note_plan(block_doc(a), None, None, symbol)
    entry, stop = reading.value("entry"), reading.value("stop")
    side = None
    if entry is not None and stop is not None and entry != stop:
        side = "long" if stop < entry else "short"
    return {
        "roles": {r: reading.role(r).as_dict() for r in plan_extract.PLAN_ROLES},
        "setup": reading.setup,
        "entry": entry,
        "stop": stop,
        "target": reading.value("target"),
        "shares": reading.value("shares"),
        "side": side,
    }


def find_chart_block(body_json: Any, embed_id: str) -> dict[str, Any] | None:
    """The attrs of the chart embed whose `embedId` is `embed_id` in a stored body, or None."""
    if isinstance(body_json, (str, bytes)):
        try:
            body_json = json.loads(body_json)
        except ValueError:
            return None
    if not isinstance(embed_id, str) or not embed_id:
        return None
    stack = [body_json]
    seen = 0
    while stack and seen < 20000:
        node = stack.pop()
        seen += 1
        if not isinstance(node, dict):
            continue
        if node.get("type") == "widgetEmbed":
            attrs = node.get("attrs") if isinstance(node.get("attrs"), dict) else {}
            if attrs.get("widgetId") == CHART_WIDGET and attrs.get("embedId") == embed_id:
                return attrs
        content = node.get("content")
        if isinstance(content, list):
            stack.extend(content)
    return None


# ── export: the "Plan levels" line ────────────────────────────────────────────────────────────

_ROLE_LABELS = {"entry": "Entry", "stop": "Stop", "target": "Target", "shares": "Shares"}


def _fmt_level(role: str, value: float) -> str:
    if role == "shares":
        return f"{value:,.0f}" if float(value).is_integer() else f"{value:,}"
    # The trade-plan canvas's own price format (the 11D export precedent), so a level reads the
    # same in every export.
    from api.services.journal_two.trade_canvas import fmt_price  # noqa: PLC0415
    return fmt_price(value)


def plan_levels_line(attrs: Any) -> str | None:
    """`Plan levels: Entry 42.50 · Stop 40.10 · Target 48.00, 52.00 · Shares 200` for a chart
    block whose drawings carry plan roles, or None. Every exporter (Markdown, web page, Word)
    prints this one line.

    The levels are `plan_extract.note_levels` of the block (the ONE reader), chart shape only:
    every drawn level, unmerged -- an export shows what the member DREW, including a second
    target or a contradiction the grader would read as unreadable. Never raises."""
    try:
        a = attrs if isinstance(attrs, dict) else {}
        if a.get("widgetId") not in (None, CHART_WIDGET):
            return None
        by_role: dict[str, list[float]] = {}
        for lv in plan_extract.note_levels(block_doc(a)):
            if lv.get("shape") == "chart":
                by_role.setdefault(lv["role"], []).append(lv["price"])
        parts = [f"{_ROLE_LABELS[r]} {', '.join(_fmt_level(r, v) for v in by_role[r])}"
                 for r in plan_extract.PLAN_ROLES if by_role.get(r)]
        return f"Plan levels: {' · '.join(parts)}" if parts else None
    except Exception:  # noqa: BLE001 -- an export never fails on one block's shape
        return None


# ── sizing inputs and Compass ─────────────────────────────────────────────────────────────────

def account_inputs(user_id: str, account_id: str | None = None) -> dict[str, Any]:
    """The member's sizing inputs: account size and max risk per trade % (accounts.py). Missing
    values are None -- the client says which one is missing; nothing is defaulted here."""
    from api.services.journal_two import accounts  # noqa: PLC0415 -- heavy import, route-time only
    try:
        s = accounts.get_account_settings(user_id, account_id) or {}
    except Exception:  # noqa: BLE001 -- an unreadable account sizes nothing, never 500s a panel
        s = {}
    return {
        "accountId": s.get("accountId"),
        "accountSize": _finite_positive(s.get("accountSize")),
        "riskPct": _finite_positive(s.get("maxRiskPerTradePct")),
    }


def compass_size(entry: Any, stop: Any, account_size: Any, risk_pct: Any, *,
                 paid: bool, size_fn=None) -> dict[str, Any]:
    """Compass's sizing answer for a LONG, labelled; or why it was not asked.

    `size_fn` defaults to `brain_service.size_a_trade`, resolved at CALL time so a module patch
    reaches it. Its own 0.1-2% clamp and regime scaling apply; this returns what it said.
    """
    e, s = _finite_positive(entry), _finite_positive(stop)
    acct, pct = _finite_positive(account_size), _finite_positive(risk_pct)
    if not paid:
        return {"ok": False, "reason": COMPASS_PAID_REASON}
    if e is None or s is None or s >= e:
        return {"ok": False, "reason": COMPASS_LONG_ONLY_REASON}
    if acct is None or pct is None:
        return {"ok": False, "reason": "No account size or max risk per trade is set"}
    if size_fn is None:
        from api.services import brain_service  # noqa: PLC0415
        size_fn = brain_service.size_a_trade
    try:
        res = size_fn(e, s, acct, risk_pct=pct)
    except Exception as exc:  # noqa: BLE001 -- the facade never raises; a fake might
        return {"ok": False, "reason": f"Compass could not size this: {exc}"}
    res = dict(res or {})
    if not res.get("ok"):
        return {"ok": False, "reason": str(res.get("reason") or res.get("error") or "Compass did not answer")}
    shares = res.get("shares")
    if isinstance(shares, bool) or not isinstance(shares, (int, float)) or not math.isfinite(float(shares)) \
            or shares < 0:
        return {"ok": False, "reason": "Compass answered without a share count"}
    out = {"ok": True, "shares": int(shares), "sizedBy": SIZED_BY_COMPASS}
    for k in ("regime", "grade", "risk_pct", "recommendation", "dollar_risk", "max_position_pct"):
        if k in res:
            out[k] = res[k]
    return out


# ── /vs: the benchmarks a stock is compared against (wave 13 lane 13H-2) ──────────────────────
#
# The note's `/vs` insert puts a stock beside SPY, QQQ, its sector ETF or its theme ETF. The
# broad pair is fixed; the other two are LOOKED UP here, from authorities that already exist:
#   * sector ETF: the stock's sector (the nightly screener row, else the 24h-cached ticker meta)
#     mapped through `sector_strength.SECTOR_ETFS`, the one sector->SPDR table the app uses;
#   * theme ETF: `groups.resolve_primary_theme` (the theme ticker_meta and /charts Groups show)
#     and that theme's own `etf_ticker` from the taxonomy.
# ⛔ Nothing here is guessed. A stock with no known sector, or whose theme carries no ETF, gets
# no option for it and a reason saying so: an invented benchmark would be a chart that compares
# the member's stock against something nobody chose.

#: The two broad benchmarks, always offered (unless the stock IS one of them).
BROAD_BENCHMARKS = (("SPY", "S&P 500"), ("QQQ", "Nasdaq 100"))

#: Provider sector names -> the `SECTOR_ETFS` key they mean. yfinance/FMP say "Healthcare",
#: "Financial Services", "Consumer Cyclical"...; GICS says "Health Care", "Financials",
#: "Consumer Discretionary"... Both map to the one table; nothing else is restated.
_SECTOR_ALIASES = {
    "information technology": "Technology", "technology": "Technology",
    "financial services": "Financials", "financials": "Financials", "financial": "Financials",
    "energy": "Energy",
    "healthcare": "Healthcare", "health care": "Healthcare",
    "industrials": "Industrials",
    "consumer cyclical": "Consumer Discretionary", "consumer discretionary": "Consumer Discretionary",
    "consumer defensive": "Consumer Staples", "consumer staples": "Consumer Staples",
    "basic materials": "Materials", "materials": "Materials",
    "real estate": "Real Estate",
    "utilities": "Utilities",
    "communication services": "Communication Services", "communications": "Communication Services",
}


def sector_etf(sector: Any) -> tuple[str, str] | None:
    """(ETF, sector name) for a provider's sector string, or None when it is not one of the
    eleven the table knows."""
    from api.services.sector_strength import SECTOR_ETFS  # noqa: PLC0415 -- the one table
    if not isinstance(sector, str) or not sector.strip():
        return None
    key = _SECTOR_ALIASES.get(sector.strip().lower())
    etf = SECTOR_ETFS.get(key) if key else None
    return (etf, key) if etf else None


def _stock_sector(symbol: str) -> str | None:
    """The stock's sector: the nightly screener row (local), else the cached ticker meta."""
    try:
        from api.services.screener import snapshot_db  # noqa: PLC0415
        row = snapshot_db.get_row(symbol) or {}
        if isinstance(row.get("sector"), str) and row["sector"].strip():
            return row["sector"].strip()
    except Exception:  # noqa: BLE001 -- an unreadable snapshot falls through to the meta
        pass
    try:
        from api.services import ticker_meta  # noqa: PLC0415
        s = (ticker_meta.get_ticker_meta(symbol) or {}).get("sector")
        return s.strip() if isinstance(s, str) and s.strip() else None
    except Exception:  # noqa: BLE001
        return None


def _stock_theme_etf(symbol: str) -> tuple[str, str] | None:
    """(theme ETF, theme name) for the stock's primary theme, or None."""
    from api.services import groups, theme_db  # noqa: PLC0415
    row = groups.resolve_primary_theme(symbol) or {}
    theme_id = row.get("theme_id")
    if not theme_id:
        return None
    for t in (theme_db.get_all_themes() or {}).get("themes", []):
        if t.get("id") == theme_id:
            etf = clean_symbol(t.get("etf_ticker"))
            return (etf, t.get("name") or row.get("theme_name") or "") if etf else None
    return None


def benchmark_options(symbol: Any, *, sector_fn=None, theme_fn=None) -> dict[str, Any]:
    """The `/vs` choices for one stock. Never raises.

    -> {"symbol", "options": [{"key", "symbol", "label"}], "missing": {key: reason}}
    `sector_fn` / `theme_fn` are seams, resolved at CALL time (a module patch reaches them)."""
    sym = clean_symbol(symbol)
    if not sym:
        return {"symbol": None, "options": [], "missing": {}}
    sector_fn = sector_fn or _stock_sector
    theme_fn = theme_fn or _stock_theme_etf
    options = [{"key": etf, "symbol": etf, "label": name} for etf, name in BROAD_BENCHMARKS if etf != sym]
    missing: dict[str, str] = {}
    try:
        sec = sector_etf(sector_fn(sym))
    except Exception:  # noqa: BLE001
        sec = None
    if sec and sec[0] != sym:
        options.append({"key": "sector", "symbol": sec[0], "label": f"{sec[1]} sector"})
    else:
        missing["sector"] = f"No sector ETF is known for {sym}"
    try:
        theme = theme_fn(sym)
    except Exception:  # noqa: BLE001
        theme = None
    if theme and theme[0] != sym and all(o["symbol"] != theme[0] for o in options):
        options.append({"key": "theme", "symbol": theme[0], "label": f"{theme[1]} theme".strip()})
    elif not theme:
        missing["theme"] = f"No theme ETF is known for {sym}"
    return {"symbol": sym, "options": options, "missing": missing}
