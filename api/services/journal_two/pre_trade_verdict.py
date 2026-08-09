"""
Pre-Trade Verdict — two-stage decision pipeline.

Stage 1 (hard checks, no LLM): muted setups, paper-only days, risk cap,
daily-loss-limit, account size. ANY failure → return immediately.

Stage 2 (LLM via Sonnet 4.6): structured JSON verdict on soft factors.

Every verdict is logged to `j2_verdicts` for audit.
"""
from __future__ import annotations
import json
import os
import sqlite3
import uuid
from datetime import datetime, timezone, timedelta, date
from typing import Any

from api.services.auth_db import get_connection
from api.services.journal_two import accounts as accounts_service
from api.services.journal_two import coach_data_assembler


class AnthropicVerdictClient:
    DEFAULT_MODEL = "claude-sonnet-4-6"

    def __init__(self, api_key: str | None = None):
        import anthropic
        from api.services import llm_timeouts
        key = api_key or os.environ.get("ANTHROPIC_API_KEY")
        if not key:
            raise RuntimeError("ANTHROPIC_API_KEY not set")
        # BOUNDED — request path (🧭 on AddPositionModal), 600 max_tokens. A
        # trader is staring at this button; 60s is already generous.
        self._client = anthropic.Anthropic(
            api_key=key,
            timeout=llm_timeouts.seconds("COMPASS_VERDICT_LLM_TIMEOUT_SECS",
                                         llm_timeouts.REQUEST_PATH),
        )

    def write_verdict(self, *, system_prompt: str, user_message: str,
                      user_id: str = "unknown") -> dict:
        msg = self._client.messages.create(
            model=self.DEFAULT_MODEL,
            max_tokens=600,
            temperature=0.3,
            metadata={"user_id": f"compass_pre_trade_verdict:{user_id}"},
            system=[{"type": "text", "text": system_prompt,
                     "cache_control": {"type": "ephemeral"}}],
            messages=[{"role": "user", "content": user_message}],
        )
        body = msg.content[0].text if msg.content else ""
        return {"body": body}


def _get_conn(conn=None):
    if conn is not None:
        return conn, False
    import sqlite3 as _sq
    path = os.environ.get("AUTH_DB_PATH") or "/data/auth.db"
    c = _sq.connect(path)
    c.row_factory = _sq.Row
    return c, True


def _compute_risk_pct(params: dict, account_size: float) -> float | None:
    shares = float(params.get("shares") or 0)
    entry = float(params.get("entry_price") or 0)
    stop = float(params.get("stop_price") or 0)
    if shares <= 0 or entry <= 0 or stop <= 0 or account_size <= 0:
        return None
    per_share = abs(entry - stop)
    return (shares * per_share / account_size) * 100.0


def _persist_verdict(
    conn, *,
    user_id: str, account_id: str, params: dict, risk_pct: float | None,
    label: str, paragraph: str, factors: list, source: str,
    hard_check_failed: str | None = None,
) -> str:
    vid = str(uuid.uuid4())
    now_iso = datetime.now(timezone.utc).isoformat()
    conn.execute(
        """INSERT INTO j2_verdicts
           (id, user_id, account_id, symbol, side, shares, entry_price, stop_price,
            target_price, setup, risk_pct, label, paragraph, factors, source,
            hard_check_failed, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (vid, user_id, account_id,
         params.get("symbol"), params.get("side"),
         params.get("shares"), params.get("entry_price"), params.get("stop_price"),
         params.get("target_price"), params.get("setup"),
         risk_pct, label, paragraph, json.dumps(factors), source,
         hard_check_failed, now_iso),
    )
    conn.commit()
    return vid


def _hard_checks(*, user_id: str, account_id: str, params: dict, conn) -> dict | None:
    settings = accounts_service.get_account_settings(user_id, account_id, conn=conn) or {}
    account_size = float(settings.get("accountSize") or 0)
    risk_pct = _compute_risk_pct(params, account_size)

    if account_size <= 0:
        return {
            "label": "ERROR",
            "paragraph": "Your account size is not configured. Set it in Settings before I can evaluate trades.",
            "factors": ["account_size unset"],
            "source": "hard_check",
            "hard_check_failed": "account_size_unset",
            "risk_pct": None,
        }

    setup_name = params.get("setup")
    if setup_name:
        muted_row = conn.execute(
            "SELECT muted_setups FROM j2_accounts WHERE id = ? AND user_id = ?",
            (account_id, user_id),
        ).fetchone()
        try:
            muted = json.loads(muted_row["muted_setups"] or "[]") if muted_row else []
        except (TypeError, json.JSONDecodeError):
            muted = []
        for m in muted:
            if m.get("setup_name") == setup_name:
                until = m.get("until_date") or ""
                return {
                    "label": "SKIP",
                    "paragraph": f"You muted {setup_name} until {until}. If you've changed your mind, unmute it first.",
                    "factors": [f"{setup_name} is muted until {until}"],
                    "source": "hard_check",
                    "hard_check_failed": "muted_setup",
                    "risk_pct": risk_pct,
                }

    today_iso = datetime.now(timezone.utc).date().isoformat()
    paper_row = conn.execute(
        "SELECT paper_only_days FROM j2_accounts WHERE id = ? AND user_id = ?",
        (account_id, user_id),
    ).fetchone()
    try:
        paper_days = json.loads(paper_row["paper_only_days"] or "[]") if paper_row else []
    except (TypeError, json.JSONDecodeError):
        paper_days = []
    if any((d.get("date") == today_iso) for d in paper_days):
        return {
            "label": "SKIP",
            "paragraph": f"Today ({today_iso}) is marked paper-only. Take this trade in your paper account.",
            "factors": ["today is paper-only"],
            "source": "hard_check",
            "hard_check_failed": "paper_only_day",
            "risk_pct": risk_pct,
        }

    cap_pct = settings.get("maxRiskPerTradePct")
    if cap_pct is not None and risk_pct is not None and risk_pct > float(cap_pct):
        return {
            "label": "SKIP",
            "paragraph": f"This trade risks {risk_pct:.2f}% of your account. Your cap is {cap_pct}%. Reduce shares or widen account size.",
            "factors": [f"risk {risk_pct:.2f}% > cap {cap_pct}%"],
            "source": "hard_check",
            "hard_check_failed": "risk_cap_breach",
            "risk_pct": risk_pct,
        }

    daily_limit_pct = settings.get("dailyLossLimitPct")
    if daily_limit_pct is not None and account_size > 0:
        threshold_dollar = -float(daily_limit_pct) * account_size / 100.0
        rows = conn.execute(
            """SELECT pnl_dollar FROM j2_trades
               WHERE user_id = ? AND account_id = ?
                 AND substr(exit_date, 1, 10) = ?""",
            (user_id, account_id, today_iso),
        ).fetchall()
        net = sum(float(r["pnl_dollar"] or 0) for r in rows)
        if net <= threshold_dollar:
            return {
                "label": "SKIP",
                "paragraph": f"You're already down ${abs(net):.0f} today — past your daily loss limit of {daily_limit_pct}%. Step away.",
                "factors": [f"today realized {net:.0f} ≤ -{daily_limit_pct}% threshold"],
                "source": "hard_check",
                "hard_check_failed": "daily_loss_limit_breach",
                "risk_pct": risk_pct,
            }

    return None


def _llm_verdict(
    *, user_id: str, account_id: str, params: dict, risk_pct: float | None,
    client, conn,
) -> dict:
    # Import lazily — COMPASS_VERDICT_SYSTEM_PROMPT lands in Task 3
    from api.services.journal_two import coach_prompts
    prompt = getattr(coach_prompts, "COMPASS_VERDICT_SYSTEM_PROMPT", None)
    if prompt is None:
        # Use a minimal stub so injected test clients still exercise the parse path.
        # Production calls with AnthropicVerdictClient will get a richer prompt in Task 3.
        prompt = (
            "You are a pre-trade verdict engine. "
            "Return a JSON object with keys label (GO|HOLD|SKIP), paragraph, and factors."
        )

    settings = accounts_service.get_account_settings(user_id, account_id, conn=conn) or {}
    setup_name = params.get("setup")
    end = datetime.now(timezone.utc)
    start = end - timedelta(days=90)
    trades = coach_data_assembler._trades_in_range(conn, user_id, account_id, start, end)
    setup_trades = [t for t in trades if t.get("setup") == setup_name] if setup_name else []
    setup_agg = coach_data_assembler._aggregate_trades(setup_trades)

    regime_label = None
    try:
        from api.services.journal_two import regime as regime_service
        info = regime_service.get_current_regime() or {}
        regime_label = info.get("regime")
    except Exception:
        pass

    arcs = []
    try:
        rolling = coach_data_assembler._trades_in_range(
            conn, user_id, account_id, end - timedelta(days=10), end,
        )
        arcs = coach_data_assembler._detect_recent_arcs(rolling, today_date=end.date())
    except Exception:
        pass

    focus = None
    try:
        focus_row = conn.execute(
            """SELECT metadata FROM j2_coach_outputs
               WHERE user_id = ? AND account_id = ? AND output_type='weekly_review' AND forgotten=0
               ORDER BY created_at DESC LIMIT 1""",
            (user_id, account_id),
        ).fetchone()
        if focus_row:
            meta = json.loads(focus_row["metadata"] or "{}")
            focus = meta.get("this_weeks_focus")
    except Exception:
        pass

    profile_row = conn.execute(
        "SELECT trader_profile FROM j2_accounts WHERE id = ? AND user_id = ?",
        (account_id, user_id),
    ).fetchone()
    profile = (profile_row["trader_profile"] or "")[:1500] if profile_row else ""

    parts = [
        "# Pre-Trade Verdict request",
        "",
        "## Proposed trade",
        f"- Symbol: {params.get('symbol')}",
        f"- Side: {params.get('side')}",
        f"- Shares: {params.get('shares')}",
        f"- Entry: {params.get('entry_price')}",
        f"- Stop: {params.get('stop_price')}",
        f"- Target: {params.get('target_price') or '(none)'}",
        f"- Setup: {setup_name or '(unspecified)'}",
        f"- Computed risk: {risk_pct:.2f}%" if risk_pct is not None else "- Risk: (cannot compute)",
        "",
        f"## Current regime: {regime_label or 'unknown'}",
        "",
        f"## Setup performance over last 90 days ({setup_name or 'all'})",
        f"- Trades: {setup_agg.get('trade_count', 0)}",
        f"- Wins/Losses: {setup_agg.get('wins', 0)}/{setup_agg.get('losses', 0)}",
        f"- Avg R: {setup_agg.get('avg_r')}",
        f"- Profit factor: {setup_agg.get('profit_factor')}",
        "",
    ]
    if arcs:
        parts.append("## Recent patterns")
        for a in arcs:
            parts.append(f"- {a}")
        parts.append("")
    if focus:
        parts.append("## This week's focus (from Sunday's Weekly Review)")
        parts.append(focus)
        parts.append("")
    if profile:
        parts.append("## Trader profile")
        parts.append(profile)
        parts.append("")
    parts.append("Return your verdict as JSON only — no surrounding text.")
    user_message = "\n".join(parts)

    response = client.write_verdict(system_prompt=prompt, user_message=user_message, user_id=user_id)
    raw = response.get("body", "").strip()

    parsed = None
    try:
        if raw.startswith("```"):
            raw = raw.split("```", 2)[1]
            if raw.startswith("json"):
                raw = raw[4:]
            raw = raw.strip()
            if raw.endswith("```"):
                raw = raw.rsplit("```", 1)[0].strip()
        parsed = json.loads(raw)
    except (json.JSONDecodeError, IndexError):
        pass

    if parsed and isinstance(parsed, dict) and parsed.get("label") in ("GO", "HOLD", "SKIP"):
        return {
            "label": parsed["label"],
            "paragraph": (parsed.get("paragraph") or "")[:2000],
            "factors": parsed.get("factors") or [],
            "source": "llm",
            "risk_pct": risk_pct,
        }

    return {
        "label": "HOLD",
        "paragraph": "Compass couldn't produce a structured verdict on this trade. Consider taking a smaller size or paper-trading it.",
        "factors": ["LLM response was unparseable"],
        "source": "llm",
        "risk_pct": risk_pct,
    }


def generate_verdict(
    *,
    user_id: str,
    account_id: str,
    params: dict,
    client=None,
    conn=None,
) -> dict:
    """Two-stage verdict: hard checks first, LLM second. Persists to j2_verdicts."""
    _conn, _close = _get_conn(conn)
    try:
        hard = _hard_checks(
            user_id=user_id, account_id=account_id, params=params, conn=_conn,
        )
        if hard is not None:
            vid = _persist_verdict(
                _conn, user_id=user_id, account_id=account_id, params=params,
                risk_pct=hard.get("risk_pct"),
                label=hard["label"], paragraph=hard["paragraph"],
                factors=hard.get("factors") or [], source="hard_check",
                hard_check_failed=hard.get("hard_check_failed"),
            )
            return {**hard, "verdict_id": vid}

        settings = accounts_service.get_account_settings(user_id, account_id, conn=_conn) or {}
        account_size = float(settings.get("accountSize") or 0)
        risk_pct = _compute_risk_pct(params, account_size)

        active_client = client or AnthropicVerdictClient()
        llm = _llm_verdict(
            user_id=user_id, account_id=account_id, params=params,
            risk_pct=risk_pct, client=active_client, conn=_conn,
        )
        vid = _persist_verdict(
            _conn, user_id=user_id, account_id=account_id, params=params,
            risk_pct=risk_pct,
            label=llm["label"], paragraph=llm["paragraph"],
            factors=llm.get("factors") or [], source="llm",
        )
        return {**llm, "verdict_id": vid}
    finally:
        if _close:
            _conn.close()
