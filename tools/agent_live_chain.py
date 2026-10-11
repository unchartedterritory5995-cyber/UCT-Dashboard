"""UCT Agent — PRODUCTION-SHAPED three-turn validation (stabilization review, 2026-10-11).

  1. "Show me my strongest stocks."
  2. "Now only the ones above $50."        (must continue turn 1's ACTUAL screen — real context)
  3. "Switch to my trading layout."

The REAL panel in a real browser, against an ISOLATED local backend (scratch databases — never
production data), so each turn's plan actually EXECUTES and turn 2 sees the screen turn 1 really
ran. Per turn it records, separately:
  · the model's PROPOSED operations (the envelope's ops, captured from /api/agent/turn's response)
  · the model's NATURAL-LANGUAGE text (reply / question)
  · the EXECUTION EVIDENCE the panel produced (receipts, result tables, questions, refusals,
    the layout actually open afterwards)
and flags any text that claims a completed action with no execution evidence in that turn.

MODES
  --mode scripted (default)  canned envelopes stand in for the model — free; verifies the harness.
  --mode live                the REAL model through the real backend. ⛔ Refuses unless
                             ANTHROPIC_API_KEY is already in this process's environment (it is never
                             read from any store, printed or written) AND --max-usd is given. It
                             launches its OWN isolated backend on :54714 (stop any other first) with
                             a fresh scratch cost ledger and the Agent's own per-turn ceiling
                             UCT_AGENT_COST_CAP_DAILY = max-usd − one turn's worst case, so the batch
                             can never pass --max-usd. Research (Perplexity) is off (no key passed).

  python tools/agent_live_chain.py --mode scripted
  python tools/agent_live_chain.py --mode live --max-usd 0.20 --out results.json
"""
from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import tempfile
import time
import urllib.request

BASE = "http://127.0.0.1:5176"           # the worktree's vite (proxies /api → :54714)
BACKEND = "http://127.0.0.1:54714"
EMAIL, PASSWORD = "dev@local.dev", "RevTest-local-1!"   # the LOCAL test account (isolated auth.db)
TURNS = ["Show me my strongest stocks.", "Now only the ones above $50.", "Switch to my trading layout."]
#: One turn's worst case on haiku-4-5: up to 3 calls × (~17k prompt tokens at the 1.25x cache-write
#: rate + 2,048 output tokens) ≈ $0.095, plus the naming call ≈ $0.003.
WORST_TURN_USD = 0.10

# A first-person / progressive claim that a UCT action happened or is happening.
CLAIM_RE = re.compile(
    r"\b(?:I(?:'ve| have| just)?|we(?:'ve| have)?)\s+(?:opened|switched|added|removed|created|filtered|screened|"
    r"changed|set|applied|saved|deleted|moved|renamed|updated|loaded|narrowed|sorted)\b"
    r"|^\s*(?:opening|switching|adding|removing|creating|filtering|screening|changing|applying|saving|loading|narrowing)\b"
    # "here are your/the … stocks/results/…" — results claimed; "here are the differences between…" is not
    r"|\bhere (?:are|is) (?:your|the)\b(?:\W+\w+){0,5}?\W+(?:stocks?|names|results|matches|screen|list|watchlist|layout|chart)\b",
    re.I | re.M)


def _envelope_factory(turn_ix: int):
    """Scripted mode: the plan a correct model returns, built from the context the panel sent."""
    def make(body: dict) -> dict:
        ctx = body.get("context") or {}
        ref = lambda k: (ctx.get(k) or [{}])[0].get("ref")
        if turn_ix == 0 and os.environ.get("AGENT_CHAIN_NEGATIVE_CONTROL") == "1":
            # proves the detector: a claim with NOTHING executed must be flagged
            return {"disposition": "answer", "reply": "Here are your strongest stocks, sorted by RS Rank.", "question": None,
                    "unsupported_category": None, "ops": []}
        if turn_ix == 0:
            return {"disposition": "apply", "reply": "Using RS Rank (highest first).", "question": None, "unsupported_category": None,
                    "ops": [{"action": "screener.run", "target": ref("screener"), "args": {"filters": [], "sort_field": "rs_rank",
                             "sort_dir": "desc", "mode": "new", "show": None, "as": None, "within": None}}]}
        if turn_ix == 1:
            return {"disposition": "apply", "reply": "", "question": None, "unsupported_category": None,
                    "ops": [{"action": "screener.run", "target": ref("screener"), "args": {"filters": [{"field": "price", "op": "gt",
                             "value": 50, "max": None, "values": None}], "sort_field": None, "sort_dir": None, "mode": "refine",
                             "show": None, "as": None, "within": None}}]}
        return {"disposition": "apply", "reply": "", "question": None, "unsupported_category": None,
                "ops": [{"action": "layout.open", "target": ref("layouts"), "args": {"layout": "trading"}}]}
    return make


def _launch_live_backend(max_usd: float) -> subprocess.Popen:
    key = os.environ.get("ANTHROPIC_API_KEY")
    scratch = tempfile.mkdtemp(prefix="agent_live_chain_")
    s = os.environ.get("AGENT_CHAIN_STATE") or os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..")
    env = {k: os.environ[k] for k in ("PATH", "SYSTEMROOT", "SystemRoot", "TEMP", "TMP", "USERPROFILE", "HOMEDRIVE", "HOMEPATH", "COMSPEC", "PATHEXT") if k in os.environ}
    env.update({
        "ANTHROPIC_API_KEY": key, "UCT_AGENT_MODEL": "claude-haiku-4-5",
        "UCT_AGENT_COST_CAP_DAILY": f"{max(0.01, max_usd - WORST_TURN_USD):.4f}",
        "DATA_DIR": scratch, "UCT_AGENT_DB_PATH": os.path.join(scratch, "uct_agent.db"),
        "WORKER_ENABLED": "0", "CATALYST_ENGINE_ENABLED": "0", "TWITTERAPI_IO_ENABLED": "0", "BARS_PREWARM_DISABLED": "1",
        "TICKER_NAMES_PREWARM_DISABLED": "1", "COT_SEED_DISABLED": "1", "ADMIN_EMAILS": EMAIL, "PYTHONIOENCODING": "utf-8",
        "WORKSPACE_DOC_STORE_ENABLED": "1",
        # the isolated LOCAL test account's own databases (never production's) — same rig as the other harnesses
        **{k: os.environ[k] for k in ("AUTH_DB_PATH", "WORKSPACE_DOCS_DB_PATH", "USER_DEFINITIONS_DB_PATH", "SCREENER_DB_PATH") if k in os.environ},
    })
    for need in ("AUTH_DB_PATH", "WORKSPACE_DOCS_DB_PATH", "USER_DEFINITIONS_DB_PATH"):
        if need not in env:
            raise SystemExit(f"refused: {need} must point at the isolated local test database")
    repo = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    p = subprocess.Popen([sys.executable, "-m", "uvicorn", "api.main:app", "--host", "127.0.0.1", "--port", "54714"],
                         cwd=repo, env=env, stdout=open(os.path.join(scratch, "backend.log"), "w"), stderr=subprocess.STDOUT)
    for _ in range(120):
        try:
            urllib.request.urlopen(f"{BACKEND}/api/health", timeout=3)
            return p
        except Exception:  # noqa: BLE001
            time.sleep(2)
    p.kill()
    raise SystemExit("refused: the isolated backend did not start")


def run(mode: str, max_usd: float | None, out_path: str | None) -> int:
    from playwright.sync_api import sync_playwright
    backend = None
    if mode == "live":
        if max_usd is None or max_usd <= WORST_TURN_USD:
            print(f"refused: --mode live needs --max-usd above one turn's worst case (${WORST_TURN_USD:.2f})")
            return 2
        if not os.environ.get("ANTHROPIC_API_KEY"):
            print("refused: ANTHROPIC_API_KEY is not in this process's environment (never fetched from a store)")
            return 2
        try:
            urllib.request.urlopen(f"{BACKEND}/api/health", timeout=3)
            print("refused: something already listens on :54714 — stop it so the run uses ITS OWN isolated backend")
            return 2
        except Exception:  # noqa: BLE001
            pass
        backend = _launch_live_backend(max_usd)
    rows = []
    try:
        with sync_playwright() as p:
            b = p.chromium.launch()
            c = b.new_context(viewport={"width": 1600, "height": 900})
            if not c.request.post(f"{BASE}/api/auth/login", data={"email": EMAIL, "password": PASSWORD}).ok:
                print("refused: the local test account could not log in")
                return 2
            # PRECONDITION (the isolated LOCAL test account only): exactly ONE saved layout named with
            # "trading" — "Trading Desk" — through the Layout Dock's own create-only route (409 = exists).
            assert BASE.startswith("http://127.0.0.1"), "the harness only ever writes the local test account"
            c.request.post(f"{BASE}/api/charts/layouts", data={"name": "Trading Desk", "create_only": True,
                           "layout": {"widgets": [{"id": "w-chart-td", "type": "chart", "x": 0, "y": 0, "w": 24, "h": 20, "color": "A", "opts": {}}]}})
            c.add_init_script("localStorage.setItem('uct.feature.agent','1'); localStorage.setItem('uct.agent.open','1'); localStorage.setItem('uct.agent.welcomed','1'); localStorage.removeItem('uct.agent.conversation')")
            captured: list[dict] = []
            state = {"turn": 0}

            def on_turn(route):
                req = json.loads(route.request.post_data or "{}")
                if mode == "scripted":
                    env = _envelope_factory(state["turn"])(req)
                    cid = c.request.post(f"{BASE}/api/agent/record", data={"conversationId": req.get("conversationId"), "member": req.get("message"), "outcome": "(scripted)"}).json().get("conversationId")
                    captured.append({"turn": state["turn"], "request": req, "envelope": env, "status": 200})
                    route.fulfill(status=200, content_type="application/json", body=json.dumps({"conversationId": cid, "envelope": env, "usage": {}}))
                    return
                resp = route.fetch()                                   # the REAL backend → the real model
                try:
                    data = resp.json()
                except Exception:  # noqa: BLE001
                    data = {"raw": resp.text()[:500]}
                captured.append({"turn": state["turn"], "request": req, "envelope": data.get("envelope"), "usage": data.get("usage"), "status": resp.status})
                route.fulfill(response=resp)

            c.route("**/api/agent/turn", on_turn)
            pg = c.new_page()
            pg.goto(f"{BASE}/charts")
            pg.get_by_label("Message UCT Agent").wait_for(timeout=60000)
            pg.wait_for_timeout(3000)
            SEL = {"agent-receipt": "[data-testid=agent-receipt]", "agent-result-table": "[data-testid=agent-result-table]",
                   "agent-question": "[data-testid=agent-question]", "agent-proposal": "[data-testid=agent-proposal]",
                   "agent-refusal": "[data-testid=agent-transcript] [class*=refusal]"}
            count = lambda tid: pg.locator(SEL[tid]).count()
            for i, text in enumerate(TURNS):
                state["turn"] = i
                before = {t: count(t) for t in SEL}
                tx0 = len(pg.locator("[data-testid=agent-transcript]").inner_text())
                pg.wait_for_function("!document.querySelector('textarea[aria-label=\"Message UCT Agent\"]').disabled", timeout=60000)
                pg.wait_for_function("!document.querySelector('[data-testid=agent-restoring]')", timeout=60000)
                t0 = time.monotonic()
                for attempt in range(2):
                    pg.get_by_label("Message UCT Agent").fill(text)
                    pg.get_by_label("Message UCT Agent").press("Enter")
                    try:   # the member's line must appear — a swallowed send (panel still loading) is retried ONCE
                        pg.wait_for_function("(t) => document.querySelector('[data-testid=agent-transcript]').innerText.includes(t)", arg=text, timeout=5000)
                        break
                    except Exception:  # noqa: BLE001
                        if any(x["turn"] == i for x in captured):
                            break
                # done = the panel is idle AND (a model reply arrived OR the panel produced something new), stable 1.5 s
                deadline = time.monotonic() + 120
                stable = 0
                while time.monotonic() < deadline:
                    pg.wait_for_timeout(250)
                    idle = pg.evaluate("!document.querySelector('[data-testid=agent-typing]') && !document.querySelector('textarea[aria-label=\"Message UCT Agent\"]').disabled")
                    moved = any(count(t) > before[t] for t in SEL) or any(x["turn"] == i for x in captured)
                    stable = stable + 1 if (idle and moved) else 0
                    if stable >= 6:
                        break
                ms = int((time.monotonic() - t0) * 1000)
                after = {t: count(t) for t in before}
                new_text = pg.locator("[data-testid=agent-transcript]").inner_text()[tx0:]
                turns_here = [x for x in captured if x["turn"] == i]
                envs = [x.get("envelope") or {} for x in turns_here]
                ops = [{"action": o.get("action"), "args": o.get("args")} for e in envs for o in (e.get("ops") or [])]
                words = " ".join(filter(None, [e.get("reply") or "" for e in envs] + [((e.get("question") or {}).get("text") or "") for e in envs]))
                evidence = {k.replace("agent-", ""): after[k] - before[k] for k in before}
                executed = evidence["receipt"] > 0 or evidence["result-table"] > 0
                claims = [m.group(0) for m in CLAIM_RE.finditer(words)]
                unbacked = claims if (claims and not executed) else []
                row = {"turn": i + 1, "said": text, "ms": ms, "model_calls": len(turns_here),
                       "dispositions": [e.get("disposition") for e in envs], "proposed_ops": ops, "model_text": words,
                       "evidence": evidence, "panel_text": new_text.strip()[-600:], "claims": claims, "unbacked_claims": unbacked,
                       "usage": [x.get("usage") for x in turns_here]}
                if i == 1:      # turn 2 must carry turn 1's ACTUAL screen
                    last = (((turns_here[0]["request"].get("context") or {}).get("screener") or [{}])[0].get("lastScreen")) if turns_here else None
                    row["continues_turn1"] = bool(last)
                    row["turn1_screen_in_context"] = last
                if i == 2:
                    prefs = c.request.get(f"{BASE}/api/auth/preferences").json()
                    row["active_layout_after"] = prefs.get("charts_active_template")
                    first = turns_here[0]["request"] if turns_here else None
                    row["layouts_offered"] = [e.get("name") for e in (((first or {}).get("context") or {}).get("layouts") or [{}])[0].get("layouts", [])] if first else None
                rows.append(row)
                print(json.dumps({k: row[k] for k in ("turn", "said", "ms", "model_calls", "dispositions", "proposed_ops", "model_text", "evidence", "unbacked_claims")}, default=str))
            b.close()
    finally:
        if backend:
            backend.kill()
    spent = sum(float((u or {}).get("cost_usd") or 0) for r in rows for u in r["usage"])
    bad = [r for r in rows if r["unbacked_claims"]]
    print(f"mode={mode} turns={len(rows)} model_calls={sum(r['model_calls'] for r in rows)} "
          f"spent≈${spent:.4f} unbacked_claims={len(bad)} continues_turn1={rows[1].get('continues_turn1') if len(rows) > 1 else None}")
    if out_path:
        json.dump(rows, open(out_path, "w", encoding="utf-8"), indent=2, default=str)
    return 0


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--mode", choices=["scripted", "live"], default="scripted")
    ap.add_argument("--max-usd", type=float, default=None)
    ap.add_argument("--out", default=None)
    a = ap.parse_args()
    sys.stdout.reconfigure(encoding="utf-8")
    sys.exit(run(a.mode, a.max_usd, a.out))
