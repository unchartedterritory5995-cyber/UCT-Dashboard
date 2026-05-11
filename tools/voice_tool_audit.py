"""
Live audit of every voice tool. Exercises each one against real services
and reports PASS / FAIL / EMPTY with a one-line summary of what was returned.

Run from repo root:
  python tools/voice_tool_audit.py

This is a diagnostic — not part of CI.
"""

import json
import sys
import traceback


def heading(s: str) -> None:
    print(f"\n{'=' * 6} {s} {'=' * 6}")


def report(name: str, status: str, detail: str = "") -> None:
    """status: PASS | EMPTY | FAIL"""
    mark = {"PASS": "[OK]", "EMPTY": "[--]", "FAIL": "[XX]"}.get(status, "[??]")
    line = f"  {mark} {name:35s} {status:6s}"
    if detail:
        line += f"  | {detail[:80]}"
    print(line)


def safe_call(name, fn, *, expect_keys=None, expect_nonempty=None):
    """Call fn() and report PASS / EMPTY / FAIL based on output shape."""
    try:
        out = fn()
    except Exception as e:
        report(name, "FAIL", f"{type(e).__name__}: {e}")
        return None

    if not isinstance(out, dict):
        report(name, "FAIL", f"returned non-dict: {type(out).__name__}")
        return out

    if expect_keys:
        missing = [k for k in expect_keys if k not in out]
        if missing:
            report(name, "FAIL", f"missing keys: {missing}")
            return out

    if expect_nonempty:
        empty = []
        for k in expect_nonempty:
            v = out.get(k)
            if v is None or v == "" or v == 0 or v == [] or (isinstance(v, str) and "no " in v.lower()):
                empty.append(k)
        if empty:
            preview = json.dumps({k: out.get(k) for k in expect_nonempty}, default=str)[:80]
            report(name, "EMPTY", preview)
            return out

    preview = ""
    for k in (expect_keys or expect_nonempty or []):
        if k in out:
            v = out[k]
            if isinstance(v, str):
                preview = v[:80]
                break
            preview = f"{k}={v}"[:80]
            break
    report(name, "PASS", preview)
    return out


# Set up a synthetic user
from api.services.auth_db import init_db
from api.services.auth_service import create_user

init_db()
TEST_USER = create_user(f"audit_{__import__('uuid').uuid4()}@example.com", "p")
UID = TEST_USER["id"]
print(f"Audit user: {UID}\n")

# Import tool implementations (triggers registration)
from api.services import voice_tool_impls  # noqa
from api.services import voice_tools


# ── Slice 2: Read-only data tools ──────────────────────────────────────────

heading("Slice 2 — Read-only data tools")

safe_call("get_quote(NVDA)",
          lambda: voice_tools.dispatch("get_quote", {"symbol": "NVDA"}, user={"id": UID}),
          expect_nonempty=["last"])

safe_call("get_movers(gainers,3)",
          lambda: voice_tools.dispatch("get_movers", {"direction": "gainers", "count": 3}, user={"id": UID}),
          expect_nonempty=["top_movers"])

safe_call("get_breadth()",
          lambda: voice_tools.dispatch("get_breadth", {}, user={"id": UID}),
          expect_nonempty=["advancing"])

safe_call("get_sector_strength()",
          lambda: voice_tools.dispatch("get_sector_strength", {}, user={"id": UID}),
          expect_nonempty=["top_sectors"])

safe_call("get_news()",
          lambda: voice_tools.dispatch("get_news", {"count": 3}, user={"id": UID}),
          expect_nonempty=["headlines"])

safe_call("get_earnings_today()",
          lambda: voice_tools.dispatch("get_earnings_today", {}, user={"id": UID}),
          expect_nonempty=["tickers"])

safe_call("get_theme_status()",
          lambda: voice_tools.dispatch("get_theme_status", {"count": 3}, user={"id": UID}),
          expect_nonempty=["top_themes"])

safe_call("get_options_flow()",
          lambda: voice_tools.dispatch("get_options_flow", {}, user={"id": UID}),
          expect_nonempty=["flow"])

safe_call("get_dark_pool()",
          lambda: voice_tools.dispatch("get_dark_pool", {}, user={"id": UID}),
          expect_nonempty=["prints"])

safe_call("get_economic_calendar()",
          lambda: voice_tools.dispatch("get_economic_calendar", {}, user={"id": UID}),
          expect_nonempty=["events"])

safe_call("get_company_info(NVDA)",
          lambda: voice_tools.dispatch("get_company_info", {"symbol": "NVDA"}, user={"id": UID}),
          expect_nonempty=["sector"])

safe_call("compare_tickers([NVDA,AAPL])",
          lambda: voice_tools.dispatch("compare_tickers", {"symbols": ["NVDA", "AAPL"]}, user={"id": UID}),
          expect_nonempty=["summary"])


# ── Slice 6: Agentic flows ─────────────────────────────────────────────────

heading("Slice 6 — Agentic flows")

safe_call("morning_briefing()",
          lambda: voice_tools.dispatch("morning_briefing", {}, user={"id": UID}),
          expect_nonempty=["narration"])

safe_call("closing_briefing()",
          lambda: voice_tools.dispatch("closing_briefing", {}, user={"id": UID}),
          expect_nonempty=["narration"])

safe_call("pre_trade_check(NVDA)",
          lambda: voice_tools.dispatch("pre_trade_check", {"symbol": "NVDA"}, user={"id": UID}),
          expect_nonempty=["narration"])

safe_call("post_trade_review(NVDA)",
          lambda: voice_tools.dispatch("post_trade_review", {"symbol": "NVDA"}, user={"id": UID}),
          expect_nonempty=["narration"])

safe_call("plan_my_day()",
          lambda: voice_tools.dispatch("plan_my_day", {}, user={"id": UID}),
          expect_nonempty=["narration"])


# ── Slice 8: Memory ────────────────────────────────────────────────────────

heading("Slice 8 — Memory tools")

safe_call("remember(fact)",
          lambda: voice_tools.dispatch("remember", {"fact": "I trade small caps under $5B",
                                                    "category": "style"}, user={"id": UID}),
          expect_keys=["ok"])

safe_call("list_my_facts()",
          lambda: voice_tools.dispatch("list_my_facts", {}, user={"id": UID}),
          expect_nonempty=["facts_text"])

safe_call("recall_session(NVDA)",
          lambda: voice_tools.dispatch("recall_session", {"query": "NVDA"}, user={"id": UID}),
          expect_keys=["recall_text"])

safe_call("forget(small caps)",
          lambda: voice_tools.dispatch("forget", {"query": "small caps"}, user={"id": UID}),
          expect_keys=["ok"])


# ── Slice 7: Self-Q&A ──────────────────────────────────────────────────────

heading("Slice 7 — Self-Q&A tools")

safe_call("get_my_pnl(week)",
          lambda: voice_tools.dispatch("get_my_pnl", {"period": "week"}, user={"id": UID}),
          expect_keys=["narration"])

safe_call("get_my_setup_performance()",
          lambda: voice_tools.dispatch("get_my_setup_performance", {}, user={"id": UID}),
          expect_keys=["narration"])

safe_call("get_my_recent_mistakes()",
          lambda: voice_tools.dispatch("get_my_recent_mistakes", {"days": 30}, user={"id": UID}),
          expect_keys=["narration"])

safe_call("get_my_psychology()",
          lambda: voice_tools.dispatch("get_my_psychology", {"period": "month"}, user={"id": UID}),
          expect_keys=["narration"])

safe_call("find_my_trades(NVDA)",
          lambda: voice_tools.dispatch("find_my_trades", {"symbol": "NVDA"}, user={"id": UID}),
          expect_keys=["narration"])


# ── Slice 5: Write tools (preview phase) ───────────────────────────────────

heading("Slice 5 — Write tool previews")

cp_preview = safe_call("create_position preview",
                       lambda: voice_tools.dispatch("create_position", {
                           "account": "Swing", "symbol": "NVDA", "shares": 100,
                           "entry": 215.0, "stop": 213.0,
                       }, user={"id": UID}),
                       expect_keys=["action_id", "narration"])

safe_call("close_position preview",
          lambda: voice_tools.dispatch("close_position", {
              "symbol": "NVDA", "exit": 220.0,
          }, user={"id": UID}),
          expect_keys=["action_id", "narration"])

safe_call("update_position preview",
          lambda: voice_tools.dispatch("update_position", {
              "symbol": "NVDA", "field": "stop", "value": 214.0,
          }, user={"id": UID}),
          expect_keys=["action_id", "narration"])

note_preview = safe_call("add_daily_note preview",
                         lambda: voice_tools.dispatch("add_daily_note", {
                             "text": "Audit test note",
                         }, user={"id": UID}),
                         expect_keys=["action_id", "narration"])

mistake_preview = safe_call("log_mistake preview",
                            lambda: voice_tools.dispatch("log_mistake", {
                                "mistake_type": "overtrading", "text": "Audit test mistake",
                            }, user={"id": UID}),
                            expect_keys=["action_id", "narration"])

# ── Slice 5: Write tool confirms — THIS is where mismatches surface ────────

heading("Slice 5 — Write tool CONFIRMS (real writes)")

if cp_preview and cp_preview.get("action_id"):
    safe_call("confirm create_position",
              lambda: voice_tools.dispatch("confirm_action",
                                          {"action_id": cp_preview["action_id"]},
                                          user={"id": UID}),
              expect_keys=["ok"])

if note_preview and note_preview.get("action_id"):
    safe_call("confirm add_daily_note",
              lambda: voice_tools.dispatch("confirm_action",
                                          {"action_id": note_preview["action_id"]},
                                          user={"id": UID}),
              expect_keys=["ok"])

if mistake_preview and mistake_preview.get("action_id"):
    safe_call("confirm log_mistake",
              lambda: voice_tools.dispatch("confirm_action",
                                          {"action_id": mistake_preview["action_id"]},
                                          user={"id": UID}),
              expect_keys=["ok"])

print("\nAudit complete.\n")
