"""UCT Agent — planner v2 paid-eval COST DRY RUN (Wave 2 W2-A2 part 4). NO key, NO call, NO network.

The owner has not authorized a paid v2 evaluation. Before one is proposed, this prints what it would cost at
WORST CASE — the same math the cumulative ledger reserves with (tools/agent_eval_ledger.worst_case_usd: every
request byte as a token + framing, all billed as a 5-minute cache write, + max_tokens of output, at the verified
prices) — and an EXPECTED figure with the static prefix (system + tools) cached after round 1, for each model in
tools/agent_eval_prices.json, per round and per turn, over the scripted acceptance set
(app/src/agent/__fixtures__/program/v2-acceptance.json) and against the per-turn cap (UCT_AGENT_TURN_USD) and
the $21 cumulative eval cap.

  python tools/agent_v2_cost_dryrun.py            # the markdown table
  python tools/agent_v2_cost_dryrun.py --json     # the same as JSON (what the test pins)
  python tools/agent_v2_cost_dryrun.py --write    # also save app/src/agent/__fixtures__/program/scores/v2-cost-dryrun.json

The request it prices is the REAL v2 request shape (turn_v2.build_tools over the golden manifest, V2_SYSTEM, a
representative four-chart workspace context) — nothing is sent anywhere. `--run` does not exist here on purpose.
"""
from __future__ import annotations

import argparse
import functools
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, ROOT)

GOLDEN = os.path.join(ROOT, "app", "src", "agent", "contract", "manifest.golden.json")
ACCEPTANCE = os.path.join(ROOT, "app", "src", "agent", "__fixtures__", "program", "v2-acceptance.json")
OUT = os.path.join(ROOT, "app", "src", "agent", "__fixtures__", "program", "scores", "v2-cost-dryrun.json")
CORPUS_EXPORT = os.path.join(ROOT, "tests", "fixtures", "agent_v2_corpus_requests.json")
CUMULATIVE_CAP_USD = 21.0
#: a step's tool_result as the browser writes it (receipt / value-free query summary), and the model's tool_use
STEP_RESULT_BYTES = 400
TOOL_USE_BYTES = 220
ROUNDS_TABLE = (1, 2, 3, 4, 6)

#: a representative Charts workspace context (four charts, two lists, the libraries) — the VOLATILE part of a request.
#: Its Screener section is real_screener_section(): never price against this dict alone (real_context()).
SAMPLE_CONTEXT = {
    "surface": "charts",
    "charts": [{"ref": f"c{i}", "label": f"Chart ({s})", "symbol": s, "tf": "D", "position": p, "indicators": ["EMA 9", "EMA 20", "SMA 50", "SMA 200"]}
               for i, (s, p) in enumerate([("NVDA", "top-left"), ("AMD", "top-right"), ("TSLA", "bottom-left"), ("SPY", "bottom-right")], 1)],
    "workspace": [{"ref": "w1", "label": "Workspace", "room": "room for 2 more charts"}],
    "layouts": [{"ref": "l1", "label": "Layouts", "layouts": [{"id": "1", "name": "Swing Board", "open": True}, {"id": "2", "name": "Day Trading"}]}],
    "watchlists": [{"ref": "w2", "label": "Swing", "count": 12}, {"ref": "w3", "label": "Momentum", "count": 40}],
    "watchlistLibrary": [{"ref": "w4", "label": "Watchlists (create new lists here)"}],
    "alertLibrary": [{"ref": "a1", "label": "Price alerts (create new alerts here)", "alerts": 5}],
    "indicatorEdits": [{"ref": f"i{i}", "chart": f"Chart ({s})", "indicators": [{"id": f"x{i}a", "name": "EMA 9"}, {"id": f"x{i}b", "name": "EMA 20"}]} for i, s in enumerate(["NVDA", "AMD", "TSLA", "SPY"], 1)],
    "board": [{"ref": "b1", "label": "Board (arrange, remove, link and configure the widgets on it)"}],
    "conversation_memory": {"recent_results": [{"set": "latest", "source": "screener.run", "count": 12, "symbols_in_order": ["AAA", "BBB", "CCC"]}]},
}
SAMPLE_MESSAGE = ("Find stocks above their 20 EMA with volume at least twice average, drop anything under $10, put the top five "
                  "by 3-month change on a new list called w1test-flagship, open the top two in the bottom row with my 9/20 EMAs, "
                  "and save this as W1 Test")


@functools.lru_cache(maxsize=1)
def real_screener_section() -> list[dict]:
    """The `screener` context section the browser sends a member with no saved screens on a screening request. Read from the
    corpus fixture, which capabilities/screener.js's own provider wrote over the real registry and starters
    (agentPlannerV2CostExport.test.jsx): the section now carries notes and composing rules only that provider can build, and a
    second copy here would drift low. A stub or a partial section makes every v2 figure read low: this one rides every round."""
    with open(CORPUS_EXPORT, encoding="utf-8") as f:
        sec = json.load(f)["boards"]["ONE"]["screener"]
    if not sec or sec[0].get("fields") in (None, "", "loading") or not sec[0].get("compose"):
        raise RuntimeError("the corpus fixture has no real screener section: regenerate it (tools/agent_v2_corpus_cost.py)")
    return sec


def real_context() -> dict:
    """SAMPLE_CONTEXT with the real Screener section: what every cost tool prices."""
    ctx = json.loads(json.dumps(SAMPLE_CONTEXT))
    ctx["screener"] = real_screener_section()
    return ctx


def _manifest() -> list[dict]:
    with open(GOLDEN, encoding="utf-8") as f:
        return json.load(f)["capabilities"]


def _cases() -> int:
    try:
        with open(ACCEPTANCE, encoding="utf-8") as f:
            return len(json.load(f)["cases"])
    except (OSError, ValueError, KeyError):
        return 30


def build_request(model_id: str, rounds_done: int) -> dict:
    """The v2 Messages request as the loop sends it on round `rounds_done + 1` (STEP-1): tools from the golden
    manifest, the system block, the workspace message, and one assistant tool_use + user tool_result per round so far."""
    from api.services.uct_agent import turn as t1, turn_v2 as v2
    caps = t1.validate_manifest(_manifest(), v2.MAX_CAPABILITIES_V2)
    tools = v2.build_tools(caps, research=True)
    system = [{"type": "text", "text": v2.V2_SYSTEM + "\n\n" + t1.BREADTH_RULE, "cache_control": {"type": "ephemeral"}}]
    messages = [{"role": "user", "content": t1._block("workspace_context", real_context()) + "\n" + t1._block("member_request", SAMPLE_MESSAGE)}]
    for i in range(rounds_done):
        messages.append({"role": "assistant", "content": [{"type": "tool_use", "id": f"tu{i}", "name": "chart__setTimeframe", "input": {"target": "c1", "args": {"timeframe": "W"}}, "pad": "x" * (TOOL_USE_BYTES - 120)}]})
        messages.append({"role": "user", "content": [{"type": "tool_result", "tool_use_id": f"tu{i}", "content": "done: " + "x" * (STEP_RESULT_BYTES - 6)}]})
    kw = dict(model=model_id, max_tokens=t1.output_ceiling(model_id), system=system, tools=tools, messages=messages)
    e = t1.effort_for(model_id)
    if e:
        kw["output_config"] = {"effort": e}
    return kw


def price_model(model_id: str, rounds: int, led) -> dict:
    """Per-turn figures for `rounds` model calls: worst case (ledger math, every call) and expected (prefix cached
    after the first call: system + tools at the cache-read rate; the rest as input; 300 output tokens per call)."""
    from api.services.uct_agent import turn as t1
    worst = 0.0
    expected = 0.0
    prefix_tokens = None
    for r in range(rounds):
        kw = build_request(model_id, r)
        worst += led.worst_case_usd(kw)
        total_bytes = led.request_bytes(kw)
        # tokens ≈ bytes / 4 for English + JSON (an estimate for the EXPECTED column only; worst case uses bytes = tokens)
        if prefix_tokens is None:
            prefix_tokens = int(led.request_bytes({"system": kw["system"], "tools": kw["tools"]}) / 4) + 200
        total_tokens = int(total_bytes / 4) + 200
        volatile = max(total_tokens - prefix_tokens, 0)
        out_tokens = 300
        if r == 0:
            expected += led.cost_usd(model_id, input=volatile, cache_write=prefix_tokens, output=out_tokens)
        else:
            expected += led.cost_usd(model_id, input=volatile, cache_read=prefix_tokens, output=out_tokens)
    return {"rounds": rounds, "worst_usd": round(worst, 4), "expected_usd": round(expected, 4), "max_tokens": t1.output_ceiling(model_id),
            "prefix_tokens_est": prefix_tokens}


def dry_run() -> dict:
    """The whole table, as data. Refuses to exist if a key is in the environment? No — a key changes nothing here:
    nothing in this module can make a call (the ledger is never opened, no client is built)."""
    from tools import agent_eval_ledger as led
    from api.services.uct_agent import turn_v2 as v2
    prices = led._prices()
    models = sorted((prices.get("models") or {}).keys())
    cases = _cases()
    turn_cap = v2.turn_usd()
    out = {"about": "planner v2 paid-eval cost DRY RUN — no call was made; worst case = tools/agent_eval_ledger.worst_case_usd per round, "
                    "expected = static prefix cached after round 1 (tokens ≈ bytes/4, 300 output tokens per round)",
           "acceptance_cases": cases, "turn_cap_usd": turn_cap, "cumulative_cap_usd": CUMULATIVE_CAP_USD,
           "request_bytes_round1": {}, "models": {}}
    for m in models:
        rows = {}
        for n in ROUNDS_TABLE:
            rows[str(n)] = price_model(m, n, led)
        kw1 = build_request(m, 0)
        out["request_bytes_round1"][m] = led.request_bytes(kw1)
        four = rows["4"]
        out["models"][m] = {
            "per_turn": rows,
            "set_worst_usd_4_rounds": round(four["worst_usd"] * cases, 2),
            "set_expected_usd_4_rounds": round(four["expected_usd"] * cases, 2),
            "rounds_under_turn_cap_worst": max([n for n in ROUNDS_TABLE if rows[str(n)]["worst_usd"] <= turn_cap] or [0]),
            "cases_under_cumulative_cap_worst_4_rounds": int(CUMULATIVE_CAP_USD // four["worst_usd"]) if four["worst_usd"] else None,
        }
    return out


def markdown(d: dict) -> str:
    lines = [f"# Planner v2 paid-eval cost dry run (NO run; {d['acceptance_cases']} scripted cases; per-turn cap ${d['turn_cap_usd']:.2f}; cumulative cap ${d['cumulative_cap_usd']:.0f})",
             "", "| model | rounds | worst/turn | expected/turn | set worst (4 rounds) | set expected (4 rounds) | rounds under turn cap (worst) | cases under $21 (worst, 4 rounds) |",
             "|---|---|---|---|---|---|---|---|"]
    for m, row in d["models"].items():
        for n in ROUNDS_TABLE:
            r = row["per_turn"][str(n)]
            tail = f"${row['set_worst_usd_4_rounds']:.2f} | ${row['set_expected_usd_4_rounds']:.2f} | {row['rounds_under_turn_cap_worst']} | {row['cases_under_cumulative_cap_worst_4_rounds']}" if n == 4 else " |  |  | "
            lines.append(f"| {m} | {n} | ${r['worst_usd']:.4f} | ${r['expected_usd']:.4f} | {tail} |")
    lines.append("")
    lines.append("Round-1 request bytes (tools + system + context): " + ", ".join(f"{m} {b:,}" for m, b in d["request_bytes_round1"].items()))
    lines.append("Worst case bills every request byte as a cache-write token on EVERY round (the ledger's reservation rule); expected assumes the static prefix is cached after round 1.")
    return "\n".join(lines)


def main(argv=None) -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")       # Windows consoles: the tables carry ≤ / → / …
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--json", action="store_true", help="print JSON instead of the table")
    ap.add_argument("--write", action="store_true", help=f"also write {os.path.relpath(OUT, ROOT)}")
    a = ap.parse_args(argv)
    d = dry_run()
    if a.write:
        os.makedirs(os.path.dirname(OUT), exist_ok=True)
        with open(OUT, "w", encoding="utf-8") as f:
            json.dump(d, f, indent=1)
    print(json.dumps(d, indent=1) if a.json else markdown(d))
    return 0


if __name__ == "__main__":
    sys.exit(main())
