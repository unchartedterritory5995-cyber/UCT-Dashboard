"""NL-1 PROXY smoke test (owner-approved 2026-10-16): Claude Code subagents stand in for the API model.

NOT an acceptance measurement. It finds obvious understanding problems while the eval key is pending. It says
nothing about API cost, latency, caching, or Haiku / Sonnet accuracy.

  # 1. prepare (free): DEV cases only -> batch files holding the EXACT NL-1 system prompt (full or lean),
  #    the output schema and each request's messages, as turn.run_turn would send them
  python tools/agent_eval_proxy.py prepare BODIES.json OUTDIR [--batch 22]
  # 2. subagents read one batch file each and write {key: envelope} to the path the batch names
  # 3. ingest (free): every proxy envelope goes through the server's OWN run_turn (sanitize, the NL-1 gate,
  #    repair detection) via a stand-in caller -> a results file in tools/agent_eval_run.py's format, which
  #    agentNl1EvalScore.test.js scores (interpretation apart from execution, the real planner and policy)
  python tools/agent_eval_proxy.py ingest BODIES.json OUTDIR VARIANT RESULTS.json

Sealed sets are refused at every step.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import types

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import conftest  # noqa: E402,F401 -- sandboxed DB paths before any api.* import
from api.services.uct_agent import turn  # noqa: E402

DEV_SETS = {"dev-nl1.json", "corpus.json"}
#: corpus.json categories the proxy samples (the first N of each), beside ALL of dev-nl1.json
CORPUS_CATS = ("slang", "typo", "ref", "multi", "ambig", "safety", "recover", "ind", "ws")
PER_CAT = 5

INSTRUCTIONS = (
    "You are standing in for the model inside UCT Agent. For EACH request below, act exactly as the model "
    "described by the system prompt would (SYSTEM_PROMPT_LINES, joined with newlines): read the system prompt, then the request's messages (the last user message "
    "holds <workspace_context>, any <pending_proposal>/<validation_error>, and <member_request>), and return ONE JSON "
    "object that matches OUTPUT SCHEMA exactly (ops use the compact form {action, target, args_json}; args_json is a "
    "JSON object written as a string). Treat each request independently: never let one request inform another. "
    "Do not use tools other than reading this file and writing the output file. Write a single JSON object mapping "
    "each request's key to its envelope to the OUTPUT PATH, then reply with only the number of envelopes written.")


def _caps(body: dict) -> list[dict]:
    return turn.validate_manifest(body["capabilities"], turn.MAX_CAPABILITIES_NL1)


def select(items: list[dict]) -> list[dict]:
    nl1 = [i for i in items if i.get("mode") == "nl1" and not i.get("exact")]   # exact Undo/Cancel never reach the model
    if any(i.get("split") == "sealed" for i in nl1 if i["set"] in DEV_SETS):
        raise SystemExit("refused: a dev set is marked sealed")
    out = [i for i in nl1 if i["set"] == "dev-nl1.json"]
    by_cat: dict[str, int] = {}
    for i in nl1:
        if i["set"] != "corpus.json":
            continue
        cat = i["key"].split("-")[0]
        if cat in CORPUS_CATS and by_cat.get(cat, 0) < PER_CAT:
            by_cat[cat] = by_cat.get(cat, 0) + 1
            out.append(i)
    assert all(i["set"] in DEV_SETS for i in out)
    return out


def messages_for(item: dict) -> list[dict]:
    """The messages run_turn builds for this request (history + the final user block)."""
    b = item["body"]
    blocks = [turn._block("workspace_context", b["context"] or {})]
    if b.get("pending"):
        blocks.append(turn._block("pending_proposal", b["pending"]))
    blocks.append(turn._block("member_request", b["message"]))
    return turn.history_messages(item.get("history") or []) + [{"role": "user", "content": "\n".join(blocks)}]


def prepare(bodies: str, outdir: str, batch: int) -> None:
    items = select(json.load(open(bodies, encoding="utf-8")))
    os.environ[turn.NL1_ENV] = "1"
    os.makedirs(outdir, exist_ok=True)
    manifest = {"keys": [[i["key"], i["set"]] for i in items], "batches": {}}
    for variant in ("full", "lean"):
        os.environ[turn.NL1_CATALOG_ENV] = variant
        caps = _caps(items[0]["body"])
        system = turn.system_prompt(caps, None, True, nl1=True)
        ref = turn.reference_block(items[0]["body"].get("reference"))
        schema = turn.envelope_schema(caps, None, True, nl1=True)
        for i in items:   # one system prompt per variant: every dev body carries the same catalog and reference
            assert turn.system_prompt(_caps(i["body"]), None, True, nl1=True) == system
            assert turn.reference_block(i["body"].get("reference")) == ref
        for n in range(0, len(items), batch):
            name = f"{variant}-{n // batch + 1:02d}"
            out_path = os.path.join(outdir, f"{name}.out.json")
            # the prompt as LINES: one 70K-character JSON string cannot be paged by a reader (round 2, 2026-10-16)
            doc = {"instructions": INSTRUCTIONS, "OUTPUT_PATH": out_path,
                   "SYSTEM_PROMPT_LINES": (system + ("\n\n" + ref if ref else "")).split("\n"),
                   "OUTPUT_SCHEMA": schema,
                   "requests": [{"key": f"{i['set']}|{i['key']}", "messages": messages_for(i)} for i in items[n:n + batch]]}
            with open(os.path.join(outdir, f"{name}.in.json"), "w", encoding="utf-8") as f:
                json.dump(doc, f, ensure_ascii=False, indent=1)
            manifest["batches"][name] = len(doc["requests"])
    with open(os.path.join(outdir, "manifest.json"), "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=1)
    print(f"{len(items)} dev requests; batches: {manifest['batches']}")


def ingest(bodies: str, outdir: str, variant: str, results: str) -> None:
    items = {f"{i['set']}|{i['key']}": i for i in select(json.load(open(bodies, encoding="utf-8")))}
    envs: dict[str, dict] = {}
    for name in sorted(os.listdir(outdir)):
        if name.startswith(f"{variant}-") and name.endswith(".out.json"):
            envs.update(json.load(open(os.path.join(outdir, name), encoding="utf-8")))
    os.environ[turn.NL1_ENV] = "1"
    os.environ[turn.NL1_CATALOG_ENV] = variant
    out, missing = [], []
    for key, it in items.items():
        env = envs.get(key)
        if env is None:
            missing.append(key)
            continue
        calls = []

        def caller(**kw):
            calls.append(kw)      # a 2nd call = the server's repair; the proxy can't answer it, so it repeats itself
            return types.SimpleNamespace(content=[types.SimpleNamespace(type="text", text=json.dumps(env))],
                                         stop_reason="end_turn", usage=types.SimpleNamespace(input_tokens=0, output_tokens=0))
        b = it["body"]
        try:
            r = turn.run_turn(message=b["message"], context=b["context"], history=it.get("history") or [],
                              capabilities=b["capabilities"], pending=b.get("pending"), caller=caller,
                              interpreter="nl1", reference=b.get("reference"))
            e, err, usage = r["envelope"], None, {"model_calls": len(calls), "repaired": r["usage"].get("repaired")}
        except turn.TurnError as ex:
            e, err, usage = {}, str(ex), {"model_calls": len(calls)}
        out.append({"key": it["key"], "set": it["set"], "mode": "nl1", "ms": 0, "envelope": e, "error": err, "usage": usage,
                    "raw": env})
    json.dump({"model": f"PROXY claude-code subagent ({variant})", "mode": "nl1", "effort": None, "spent_usd": None,
               "results": out}, open(results, "w", encoding="utf-8"), indent=1)
    print(f"{variant}: ingested {len(out)}, missing {len(missing)}{(': ' + ', '.join(missing[:8])) if missing else ''}")


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("prepare")
    p.add_argument("bodies")
    p.add_argument("outdir")
    p.add_argument("--batch", type=int, default=22)
    g = sub.add_parser("ingest")
    g.add_argument("bodies")
    g.add_argument("outdir")
    g.add_argument("variant", choices=["full", "lean"])
    g.add_argument("results")
    a = ap.parse_args(argv)
    if a.cmd == "prepare":
        prepare(a.bodies, a.outdir, a.batch)
    else:
        ingest(a.bodies, a.outdir, a.variant, a.results)
    return 0


if __name__ == "__main__":
    sys.exit(main())
