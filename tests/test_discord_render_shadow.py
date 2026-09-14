"""Shadow mode: what would V2 have answered, without a member ever seeing it (step 2.4b P2.10).

`RENDER_V2_SHADOW=1` with the V2 master still unset. The pre-V2 path serves the member exactly as
today; alongside it, the acknowledgement V2 *would* have returned is recorded, so the flip is a
decision made on production traffic rather than on a bench.

The properties, and every one of them is about what a shadow must NOT do:
  * it cannot deliver — nothing here touches the token, the runtime, the store or `edit`, and that
    is asserted from the module's own parse tree rather than promised in a comment;
  * it cannot delay the member — it runs after the reply exists, on a thread, inside its own budget;
  * it cannot break the request it shadows — every failure path is a missing sample;
  * it is OFF by default, unlike the kill switches, because it ADDS work.
"""
from __future__ import annotations

import ast
import pathlib

import pytest

from api.services.discord_render import shadow, symbols

SRC = pathlib.Path(__file__).resolve().parents[1] / "api" / "services" / "discord_render" / "shadow.py"


def _chart(ticker="NVDA"):
    return {"type": 2, "id": "1", "application_id": "app", "token": "tkn",
            "guild_id": "882293203485720596",
            "data": {"name": "chart", "options": [{"name": "ticker", "value": ticker}]}}


# ── it cannot deliver ───────────────────────────────────────────────────────

def test_the_shadow_module_names_nothing_that_could_reach_a_member():
    """⛔ BY CONSTRUCTION, NOT BY CARE. "We were careful" is not a mechanism. This reads the parse
    tree for every name that could put something in front of a member, and the attribute access
    `interaction["token"]` is included — a shadow holding a live 15-minute credential is one
    mistake away from using it."""
    tree = ast.parse(SRC.read_text(encoding="utf-8"))
    names = {n.id for n in ast.walk(tree) if isinstance(n, ast.Name)}
    attrs = {n.attr for n in ast.walk(tree) if isinstance(n, ast.Attribute)}
    consts = {n.value for n in ast.walk(tree) if isinstance(n, ast.Constant) and isinstance(n.value, str)}
    forbidden = {"edit_original", "edit", "offer", "enqueue", "get_runtime", "JobsStore",
                 "run_chart_job", "run_flow_card_job", "post_webhook", "fail"}
    assert not (names | attrs) & forbidden, sorted((names | attrs) & forbidden)
    assert "token" not in consts and "app_id" not in consts, (
        "the shadow reads a field it has no business reading")


def test_the_shadow_never_returns_an_interaction_response():
    out = shadow.observe_ack(_chart(), pre_v2_reply={"type": 5},
                             resolve=lambda t, **k: symbols.Resolution(t, symbols.KNOWN))
    assert "type" not in out and "data" not in out, "a shadow that can be mistaken for a reply"


# ── it is off by default ────────────────────────────────────────────────────

def test_it_is_OFF_unless_explicitly_turned_on(monkeypatch):
    """⛔ THE OPPOSITE POLARITY TO THE KILL SWITCHES, ON PURPOSE. A kill switch defaults ON because
    unset must not look like a deliberate shutdown. This one ADDS work, so an enablement gate that
    defaulted on would turn itself on in every environment the moment it merged."""
    monkeypatch.delenv(shadow.ENV, raising=False)
    assert shadow.enabled() is False
    for on in ("1", "true", "YES", "on"):
        monkeypatch.setenv(shadow.ENV, on)
        assert shadow.enabled() is True
    for off in ("0", "false", "", "no", "maybe"):
        monkeypatch.setenv(shadow.ENV, off)
        assert shadow.enabled() is False, f"{off!r} must not enable it"


# ── what it actually measures ───────────────────────────────────────────────

def test_it_records_the_symbols_and_what_v2_would_have_refused():
    out = shadow.observe_ack(
        _chart("NDVA"), pre_v2_reply={"type": 5},
        resolve=lambda t, **k: symbols.Resolution(t, symbols.UNKNOWN, suggestions=("NVDA",)))
    assert out["symbols"] == 1 and out["would_refuse"] == "NDVA"
    assert out["pre_v2_type"] == 5
    assert out["divergence"] is True, (
        "the number worth watching: V2 would have refused a symbol the old path went on to draw")


def test_agreement_is_not_a_divergence():
    out = shadow.observe_ack(_chart(), pre_v2_reply={"type": 5},
                             resolve=lambda t, **k: symbols.Resolution(t, symbols.KNOWN))
    assert out["would_refuse"] is None and out["divergence"] is False


def test_an_unanswerable_verdict_is_not_a_divergence_either():
    """⛔ The symbol check fails OPEN: `UNANSWERABLE` means we could not tell, and V2 would have let
    it through exactly as the old path did. Counting it as a divergence would inflate the one number
    the flip decision rests on."""
    out = shadow.observe_ack(_chart("AEHL"), pre_v2_reply={"type": 5},
                             resolve=lambda t, **k: symbols.Resolution(t, symbols.UNANSWERABLE))
    assert out["would_refuse"] is None and out["divergence"] is False


def test_a_reply_that_was_not_a_defer_is_not_a_divergence():
    """If the old path answered ephemerally (type 4) it did not draw anything, so V2 refusing is not
    a difference a member would have noticed."""
    out = shadow.observe_ack(_chart("NDVA"), pre_v2_reply={"type": 4},
                             resolve=lambda t, **k: symbols.Resolution(t, symbols.UNKNOWN))
    assert out["would_refuse"] == "NDVA" and out["divergence"] is False


# ── it cannot hurt the request it shadows ───────────────────────────────────

def test_a_resolver_that_raises_is_a_missing_sample_not_an_exception():
    def boom(t, **k):
        raise RuntimeError("authority down")
    out = shadow.observe_ack(_chart(), pre_v2_reply={"type": 5}, resolve=boom)
    assert out["error"] == "RuntimeError" and out["would_refuse"] is None


def test_past_its_own_budget_it_stops_rather_than_making_anyone_wait(monkeypatch):
    """⛔ ITS OWN BUDGET, SEPARATE FROM THE MEMBER'S. The reply has already gone; a shadow that ran
    long would be measuring the cost of measuring."""
    ticks = iter([0.0, 0.0, 9.9, 9.9, 9.9, 9.9])
    calls = []
    monkeypatch.setattr(shadow, "_tickers", lambda i: ["AAPL", "NVDA", "MSFT", "TSLA"])
    out = shadow.observe_ack(_chart(), pre_v2_reply={"type": 5}, now=lambda: next(ticks),
                             resolve=lambda t, **k: calls.append(t) or symbols.Resolution(t, symbols.KNOWN))
    assert out.get("budget") is True
    assert len(calls) < 4, "it kept resolving past its budget"


def test_an_interaction_it_cannot_parse_produces_no_symbols_and_no_crash():
    for inter in ({}, {"type": 2}, {"type": 2, "data": {"name": "buzz"}}, {"data": None}):
        out = shadow.observe_ack(inter, pre_v2_reply=None)
        assert out["symbols"] == 0 and out["divergence"] is False


# ── the wiring ──────────────────────────────────────────────────────────────

def test_the_route_runs_the_shadow_after_the_reply_and_off_the_loop():
    """⛔ THE ORDER IS THE POINT. The reply is produced first and returned unchanged; the shadow is
    submitted to a thread. A rail that only checked "shadow is imported" would pass on a version
    that ran it BEFORE the dispatch, on the loop, which is the one arrangement that could cost a
    member their acknowledgement."""
    route = (pathlib.Path(__file__).resolve().parents[1] / "api" / "routers" /
             "discord_interactions.py").read_text(encoding="utf-8")
    tree = ast.parse(route)
    fn = next(n for n in ast.walk(tree) if isinstance(n, ast.AsyncFunctionDef)
              and n.name == "discord_interactions")
    body_src = ast.dump(fn)
    assert "_dispatch_interaction" in body_src, "the route no longer delegates"
    assert "run_safely" in body_src and "submit" in body_src, "the shadow is not dispatched to a pool"
    dispatch_line = next(i for i, n in enumerate(ast.walk(fn))
                         if isinstance(n, ast.Name) and n.id == "_dispatch_interaction")
    shadow_line = next(i for i, n in enumerate(ast.walk(fn))
                       if isinstance(n, ast.Attribute) and n.attr == "run_safely")
    assert dispatch_line < shadow_line, "the shadow runs before the member's reply is produced"


def test_the_route_still_returns_the_dispatchers_reply_unchanged(monkeypatch):
    """The load-bearing one: whatever the shadow SETUP does, the member gets exactly what the pre-V2
    path produced.

    ⚰️ The first version made `observe_ack` explode and would have passed on ANY implementation —
    the route submits to a pool and never reads the future, so that exception never reaches it. The
    thing the route's guard actually covers is the setup: the import, the flag read, the submit.
    This raises from `enabled()`, which the route calls inline."""
    from tests.discord_harness import _app_client, _keypair, _post, UT_GUILD
    sk, pub = _keypair()
    client, rt = _app_client()
    monkeypatch.setattr(rt.di, "verify_signature", lambda *a: True)
    monkeypatch.setenv("DISCORD_CHART_PUBLIC_KEY", pub)
    monkeypatch.setattr(shadow, "enabled",
                        lambda: (_ for _ in ()).throw(RuntimeError("shadow setup exploded")))
    r = _post(client, sk, {"type": 1, "guild_id": UT_GUILD})
    assert r.status_code == 200 and r.json() == {"type": 1}


def test_the_work_on_the_pool_thread_reports_its_own_failure(monkeypatch):
    """⛔⛔ A FUTURE NOBODY READS SWALLOWS EVERYTHING. The route submits and never calls `.result()`,
    so the member is safe and a shadow failing on every interaction would leave no trace at all —
    the silent-failure shape this programme exists to close, re-created by the mechanism that
    protects the member."""
    from api.services.discord_render import observe
    seen = []
    monkeypatch.setattr(observe, "event", lambda evt, **f: seen.append((evt, f)) or {})
    monkeypatch.setattr(shadow, "observe_ack",
                        lambda *a, **k: (_ for _ in ()).throw(RuntimeError("boom")))
    assert shadow.run_safely(_chart(), {"type": 5}) is None
    assert ("shadow", {"outcome": "error", "detail": "RuntimeError"}) in seen


def test_the_route_submits_the_reporting_wrapper_not_the_bare_function():
    """Otherwise the guard above exists and nothing routes through it."""
    route = (pathlib.Path(__file__).resolve().parents[1] / "api" / "routers" /
             "discord_interactions.py").read_text(encoding="utf-8")
    fn = next(n for n in ast.walk(ast.parse(route)) if isinstance(n, ast.AsyncFunctionDef)
              and n.name == "discord_interactions")
    attrs = {n.attr for n in ast.walk(fn) if isinstance(n, ast.Attribute)}
    assert "run_safely" in attrs and "observe_ack" not in attrs, sorted(attrs)
