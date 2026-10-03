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
