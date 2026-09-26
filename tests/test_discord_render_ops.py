"""The Discord render products' own instruments (2026-09-25): the /flow outcome ledger and its
daily line, the flow pre-warm, the post-deploy render smoke, the window buttons on a /flow card,
and the V2 /flow deadline. See api/services/flow_card_ops.py for why each exists.
"""
from __future__ import annotations

import ast
import datetime as dt
import pathlib

import pytest

from api.services import flow_card_ops as ops
from tests.discord_harness import UT_GUILD, _app_client, _keypair, _post

ET_NOON_MON = dt.datetime(2026, 9, 28, 12, 0, tzinfo=dt.timezone(dt.timedelta(hours=-4))).timestamp()
ET_SAT = dt.datetime(2026, 9, 26, 12, 0, tzinfo=dt.timezone(dt.timedelta(hours=-4))).timestamp()


@pytest.fixture(autouse=True)
def _ledger(tmp_path, monkeypatch):
    monkeypatch.setattr(ops, "_DB_PATH", str(tmp_path / "flow_card_stats.db"))
    for k in ("DISCORD_FLOW_HOTWARM_ENABLED", "DISCORD_RENDER_SMOKE_ENABLED", "DISCORD_FLOW_STATS_ENABLED",
              "DISCORD_RENDER_V2_ENABLED"):
        monkeypatch.delenv(k, raising=False)


# ── the ledger ────────────────────────────────────────────────────────────────────────────

def test_the_ledger_counts_outcomes_reasons_latency_and_names():
    t = ET_NOON_MON
    ops.record("AMD", "stocks", "1", "page", ms=2000, now=t)
    ops.record("AMD", "stocks", "5", "page_asof", ms=300, now=t + 1)
    ops.record("NVDA", "stocks", "1", "rollup_fallback", "timeout", ms=45000, now=t + 2)
    ops.record("NVDA", "stocks", "1", "rollup_fallback", "busy", ms=900, now=t + 3)
    ops.record("SPY", "etfs", "1", "failed", "flow_timeout", ms=30000, now=t + 4)
    ops.record("ZZZQX", "stocks", "1", "empty", now=t + 5)
    s = ops.summary(t - 1, t + 10)
    assert s["total"] == 6 and s["by"]["page"] == 1 and s["by"]["page_asof"] == 1
    assert s["reasons"]["rollup_fallback"] == {"timeout": 1, "busy": 1}
    assert s["reasons"]["failed"] == {"flow_timeout": 1}
    assert s["page_p50_ms"] in (300, 2000) and s["page_p95_ms"] == 2000
    assert s["top"][0] == ("AMD", 2) or s["top"][0] == ("NVDA", 2)
    line = ops.daily_text(t + 10)
    assert line.startswith("📊 /flow · Mon Sep 28 · 6 cards")
    assert "page-derived 2 (as-of 1)" in line and "rollup fallback 2 (" in line and "timeout 1" in line
    assert "failed 1 (flow_timeout 1)" in line and "empty 1" in line and "page p50" in line


def test_a_quiet_day_says_so_and_a_broken_ledger_never_raises(monkeypatch):
    assert ops.daily_text(ET_NOON_MON).endswith("no cards requested today")
    monkeypatch.setattr(ops, "_DB_PATH", "Z:/definitely/not/a/dir/x.db")
    assert ops.record("AMD", "stocks", "1", "page") is False
    assert ops.recent_names(now=ET_NOON_MON) == []


def test_recent_names_are_the_last_hours_most_asked():
    t = ET_NOON_MON
    for i in range(3):
        ops.record("AMD", "stocks", "1", "page", now=t - 60 * i)
    ops.record("SPY", "etfs", "1", "page", now=t - 120)
    ops.record("OLD", "stocks", "1", "page", now=t - 7200)                  # outside the hour
    assert ops.recent_names(3600, 4, now=t) == [("AMD", "stocks"), ("SPY", "etfs")]


# ── the flow pre-warm ─────────────────────────────────────────────────────────────────────

def _page_on(monkeypatch, on=True):
    from api.services import flow_card_from_page as page
    monkeypatch.setattr(page, "enabled", lambda: on)


def test_the_pre_warm_warms_the_hours_names_in_market_hours_only(monkeypatch):
    _page_on(monkeypatch)
    ops.record("AMD", "stocks", "1", "page", now=ET_NOON_MON - 60)
    ops.record("SPY", "etfs", "1", "page", now=ET_NOON_MON - 30)
    seen = []
    r = ops.flow_hot_warm(now=ET_NOON_MON, fetch=lambda t, s: seen.append((t, s)) or {"ok": True})
    assert sorted(seen) == [("AMD", "stocks"), ("SPY", "etfs")] and sorted(r["warmed"]) == ["AMD", "SPY"]
    assert ops.flow_hot_warm(now=ET_SAT, fetch=lambda *a: pytest.fail("weekend"))["skipped"] == "market closed"


def test_the_pre_warm_stops_at_its_budget_and_obeys_its_switches(monkeypatch):
    _page_on(monkeypatch)
    for i, t in enumerate(("A1", "A2", "A3")):
        ops.record(t, "stocks", "1", "page", now=ET_NOON_MON - 10 * (i + 1))
    ticks = iter([0.0, 0.0] + [ops.FLOW_WARM_BUDGET_S + 1] * 10)          # t0, first name in budget, then out
    r = ops.flow_hot_warm(now=ET_NOON_MON, fetch=lambda *a: {"ok": True}, clock=lambda: next(ticks))
    assert len(r["warmed"]) == 1, r
    monkeypatch.setenv("DISCORD_FLOW_HOTWARM_ENABLED", "0")
    assert ops.flow_hot_warm(now=ET_NOON_MON, fetch=lambda *a: pytest.fail("off"))["skipped"] == "disabled"
    monkeypatch.delenv("DISCORD_FLOW_HOTWARM_ENABLED")
    _page_on(monkeypatch, False)
    assert ops.flow_hot_warm(now=ET_NOON_MON, fetch=lambda *a: pytest.fail("off"))["skipped"] == "page card off"


# ── the smoke ─────────────────────────────────────────────────────────────────────────────

def _bars(week_close=630.63, week_high=639.0):
    def fetch(sym, tf, n):
        if tf == "D":
            return [{"t": "2026-09-24", "o": 1, "h": 632.0, "l": 1, "c": 620.0, "v": 1},
                    {"t": "2026-09-25", "o": 1, "h": 639.0, "l": 1, "c": 630.63, "v": 1}]
        return [{"t": "2026-09-25", "o": 1, "h": week_high, "l": 1, "c": week_close, "v": 1}]
    return fetch


def test_a_healthy_deploy_reads_green(monkeypatch):
    _page_on(monkeypatch)
    r = ops.run_smoke(produce=lambda tf: ("ok", b"png", "f.png"), bars=_bars(),
                      flow=lambda diag: {"derivation": "page"})
    assert r["ok"] and r["text"].startswith("✅ render smoke")
    assert "chart D ok" in r["text"] and "chart W ok" in r["text"] and "weekly = daily ok (5/5)" in r["text"]
    assert "/flow AMD ok (page-derived" in r["text"]


def test_each_shipped_defect_turns_it_red(monkeypatch):
    _page_on(monkeypatch)
    stand_in = ops.run_smoke(produce=lambda tf: ("fallback" if tf == "W" else "ok", b"png", "f"), bars=_bars(),
                             flow=lambda d: {"derivation": "page"})
    assert not stand_in["ok"] and "chart W FAIL (fallback" in stand_in["text"]
    frozen = ops.run_smoke(produce=lambda tf: ("ok", b"", "f"), bars=_bars(week_close=615.52, week_high=616.69),
                           flow=lambda d: {"derivation": "page"})
    assert not frozen["ok"] and "weekly = daily FAIL (0/5 off:" in frozen["text"]

    def rollup(diag):
        diag["reason"] = "busy"
        return None
    no_page = ops.run_smoke(produce=lambda tf: ("ok", b"", "f"), bars=_bars(), flow=rollup)
    assert not no_page["ok"] and "no page card (busy)" in no_page["text"]


def test_with_the_page_card_off_the_flow_check_says_so_and_passes(monkeypatch):
    _page_on(monkeypatch, False)
    r = ops.run_smoke(produce=lambda tf: ("ok", b"", "f"), bars=_bars(), flow=lambda d: pytest.fail("off"))
    assert r["ok"] and "page card off (rollup)" in r["text"]


def test_smoke_and_post_posts_the_line_and_a_failure_also_alerts(monkeypatch):
    posted = {"smoke": [], "alert": []}
    monkeypatch.setattr(ops, "post_smoke", lambda c: posted["smoke"].append(c) or True)
    monkeypatch.setattr(ops, "post_alert", lambda c: posted["alert"].append(c) or True)
    monkeypatch.setattr(ops, "run_smoke", lambda: {"ok": True, "text": "✅ x", "checks": []})
    ops.smoke_and_post()
    assert posted == {"smoke": ["✅ x"], "alert": []}
    monkeypatch.setattr(ops, "run_smoke", lambda: {"ok": False, "text": "❌ y", "checks": []})
    ops.smoke_and_post()
    assert posted["smoke"][-1] == "❌ y" and posted["alert"] == ["❌ y"]
    monkeypatch.setenv("DISCORD_RENDER_SMOKE_ENABLED", "0")
    assert ops.smoke_and_post() == {"skipped": "disabled"}


def test_the_smoke_posts_to_render_smoke_as_the_bot_and_falls_back_to_the_alert_webhook(monkeypatch):
    class R:
        def __init__(self, ok, code): self.is_success, self.status_code = ok, code

    class C:
        def __init__(self, ok, code): self.calls, self.r = [], R(ok, code)
        def post(self, url, headers=None, json=None): self.calls.append((url, json)); return self.r
    alerts = []
    monkeypatch.setattr(ops, "post_alert", lambda c: alerts.append(c) or True)
    monkeypatch.setenv("DISCORD_BOT_TOKEN", "t")
    ok = C(True, 200)
    assert ops.post_smoke("hello", client=ok) and alerts == []
    assert ok.calls[0][0].endswith(f"/channels/{ops.SMOKE_CHANNEL_DEFAULT}/messages")
    assert ok.calls[0][1]["allowed_mentions"] == {"parse": []}
    assert ops.post_smoke("refused", client=C(False, 403)) and alerts == ["refused"]
    monkeypatch.delenv("DISCORD_BOT_TOKEN")
    assert ops.post_smoke("no token", client=C(True, 200)) and alerts[-1] == "no token"


# ── the /flow card: window buttons and the outcome recorded by the job ──────────────────────

def test_the_card_carries_view_chart_and_four_windows_with_the_served_one_lit():
    from api.services import discord_interactions as di
    rows = di.flow_components("AMD", active="5")
    btns = rows[0]["components"]
    assert len(rows) == 1 and len(btns) == 5
    assert btns[0]["custom_id"] == "flowchart|AMD"
    assert [(b["label"], b["custom_id"], b["style"]) for b in btns[1:]] == [
        ("1D", "flowwin|AMD|1", 2), ("5D", "flowwin|AMD|5", 1), ("20D", "flowwin|AMD|20", 2), ("All", "flowwin|AMD|all", 2)]
    assert di.parse_flow_window({"data": {"custom_id": "flowwin|AMD|20"}}) == ("AMD", "20")
    for bad in ("flowwin|AMD|7", "flowwin|AM D|1", "flowwin|AMD", "flowchart|AMD|1"):
        with pytest.raises(di.CommandError):
            di.parse_flow_window({"data": {"custom_id": bad}})


def test_a_window_click_redraws_the_card_in_place_through_the_route(monkeypatch):
    sk, pk = _keypair()
    monkeypatch.setenv("DISCORD_CHART_PUBLIC_KEY", pk)
    client, rt = _app_client()
    ran = []
    monkeypatch.setattr(rt, "run_flow_card_job", lambda *a, **k: ran.append((a, k)))
    click = {"type": 3, "id": "1", "application_id": "APP", "token": "TOK", "guild_id": UT_GUILD,
             "member": {"user": {"id": "42"}}, "data": {"custom_id": "flowwin|AMD|20", "component_type": 2}}
    r = _post(client, sk, click)
    assert r.status_code == 200 and r.json() == {"type": 6}, r.text
    assert ran == [(("APP", "TOK", "AMD", "20"), {})], "no source= on the ack path; the job resolves it"
    r = _post(client, sk, {**click, "data": {"custom_id": "flowwin|AMD|7", "component_type": 2}})
    assert r.json()["type"] == 4 and r.json()["data"]["flags"] == 64


def _run_job(monkeypatch, *, page_payload=None, page_reason=None, page_on=True, rollup=None):
    from api.routers import discord_interactions as rt
    from api.services import flow_card_from_page as page
    rec, posted = [], {}
    monkeypatch.setattr(ops, "record", lambda *a, **k: rec.append(a[:5]))
    monkeypatch.setattr(page, "enabled", lambda: page_on)

    def fake_page(t, d, s, timeout_s=None, diag=None, **k):
        if page_reason and diag is not None:
            diag["reason"] = page_reason
        return page_payload
    monkeypatch.setattr(page, "page_derived_payload", fake_page)
    rt.run_flow_card_job("A", "T", "AMD", "1", source="stocks", fetch_fn=lambda t, d: rollup,
                         render_fn=lambda d: b"png",
                         edit_fn=lambda *a, **k: posted.update(k) or (True, "ok"))
    return rec, posted


CARD = {"ok": True, "contracts": [{"cp": "C"}], "net": {}, "derivation": "page",
        "window": {"days_requested": "5", "widened_from": "1"}}


def test_the_job_records_what_it_delivered_and_lights_the_served_window(monkeypatch):
    rec, posted = _run_job(monkeypatch, page_payload=dict(CARD))
    assert rec == [("AMD", "stocks", "1", "page", None)]
    lit = [b["label"] for b in posted["components"][0]["components"] if b.get("style") == 1]
    assert lit == ["5D"], "the card widened to five days, so 5D is the one on screen"
    rec, _ = _run_job(monkeypatch, page_payload={**CARD, "window": {"days_requested": "1", "as_of": 1790000000}})
    assert rec[0][3] == "page_asof"
    rec, _ = _run_job(monkeypatch, page_reason="too big", rollup={"ok": True, "contracts": [{"cp": "P"}], "net": {},
                                                                  "window": {"days_requested": "1"}})
    assert rec == [("AMD", "stocks", "1", "rollup_fallback", "too big")]
    rec, _ = _run_job(monkeypatch, page_on=False, rollup={"ok": True, "contracts": [{"cp": "P"}], "net": {},
                                                          "window": {}})
    assert rec[0][3] == "rollup"
    rec, _ = _run_job(monkeypatch, page_payload={**CARD, "contracts": []})
    assert rec[0][3] == "empty"
    rec, _ = _run_job(monkeypatch, page_reason="timeout", rollup=None)
    assert rec[0][3] == "failed"


# ── the V2 /flow deadline ─────────────────────────────────────────────────────────────────

def test_the_v2_flow_job_gets_a_deadline_the_page_card_can_meet(monkeypatch):
    from api.services import flow_card_from_page as page
    from api.services.discord_render import commands as cmd
    inter = {"id": "9", "application_id": "APP", "token": "T", "guild_id": UT_GUILD, "type": 2,
             "member": {"user": {"id": "1"}}, "data": {"name": "flow"}}
    monkeypatch.setattr(page, "enabled", lambda: True)
    assert cmd.flow_deadline_s() == cmd.FLOW_PAGE_DEADLINE_S >= page.PAGE_FETCH_TIMEOUT_S + cmd.FLOW_TIMEOUT_S
    assert cmd._job(inter, "flow", "x", deadline_s=cmd.flow_deadline_s()).deadline_s == cmd.FLOW_PAGE_DEADLINE_S
    monkeypatch.setattr(page, "enabled", lambda: False)
    default = cmd._job(inter, "chart", "x").deadline_s
    assert cmd.flow_deadline_s() is None and cmd._job(inter, "flow", "x", deadline_s=None).deadline_s == default
    src = pathlib.Path(cmd.__file__).read_text(encoding="utf-8")
    code = "\n".join(l.split("#")[0] for l in src.splitlines())
    assert "deadline_s=flow_deadline_s()" in code, "the /flow enqueue no longer asks for the page-card deadline"


# ── wiring ────────────────────────────────────────────────────────────────────────────────

def test_the_three_jobs_are_registered_and_call_the_ops_module():
    src = pathlib.Path("api/main.py").read_text(encoding="utf-8")
    tree = ast.parse(src)
    ids = {kw.value.value for n in ast.walk(tree) if isinstance(n, ast.Call)
           and isinstance(n.func, ast.Attribute) and n.func.attr == "add_job"
           for kw in n.keywords if kw.arg == "id" and isinstance(kw.value, ast.Constant)}
    assert {"discord_flow_hot_warm", "discord_render_smoke", "discord_flow_daily_stats"} <= ids
    assert "discord_chart_hot_warm" in ids, "control: the probe can see a registration it is not looking for"
    import api.main as m
    for fn, target in ((m._discord_render_smoke, "smoke_and_post"), (m._discord_flow_hot_warm, "flow_hot_warm"),
                       (m._discord_flow_daily_stats, "daily_stats_and_post")):
        import inspect
        assert f"flow_card_ops.{target}()" in inspect.getsource(fn)


# ── the reason a page card could not be had ──────────────────────────────────────────────

def test_a_declined_page_card_says_why(monkeypatch):
    from api.services import flow_card_from_page as page
    monkeypatch.delenv("WORKER_INTERNAL_URL", raising=False)
    d = {}
    assert page.fetch_basis_product("AMD", "stocks", 10, 1.0, diag=d) is None and d["reason"] == "no worker url"
    for body, want in (({"ok": False, "error": "busy"}, "busy"),
                       ({"ok": False, "error": "too big to derive within budget"}, "too big"),
                       ({"ok": False}, "bad body")):
        d = {}
        assert page.fetch_basis_product("AMD", "stocks", 10, 1.0, get=lambda *a, b=body: b, diag=d) is None
        assert d["reason"] == want, (body, d)

    def slow(*a):
        raise TimeoutError("read")
    d = {}
    assert page.fetch_basis_product("AMD", "stocks", 10, 1.0, get=slow, diag=d) is None and d["reason"] == "timeout"
