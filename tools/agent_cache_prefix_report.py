"""UCT Agent — CACHE-PREFIX REPORT (free: no model call, no network, no key).

Runs captured /api/agent/turn bodies through the server's own `turn.run_turn` with a capturing fake model, and reports
how CACHEABLE the requests the provider would receive are. Prints counts, fingerprints (short hashes) and sizes only —
never a member's words, a reply, or a value.

  python tools/agent_cache_prefix_report.py BODIES.json [--json OUT.json]

BODIES.json: the capture of app/src/agent/agentNl1EvalCapture.test.js (AGENT_EVAL_MODE=legacy is the production path),
or of agentLatency.test.jsx (AGENT_LATENCY_BODIES) — items with a `body` (and optionally `history`, `mode`).

What it measures (the provider caches a PREFIX: model -> output schema -> system blocks, up to a `cache_control` mark;
a prefix shorter than the model's minimum is never written):
  schemas            distinct model-facing output schemas (each new one is a grammar compile)
  bp<i>              distinct prefixes ending at the i-th system cache mark, and their size
  first_cacheable    the first mark whose prefix reaches the model's minimum — the shortest prefix a cold request
                     must share with an earlier one to read anything from the cache
  hit_potential      in capture order, with an unlimited TTL: the share of requests whose first_cacheable prefix was
                     already seen, and the share of all system+schema tokens that could be cache reads
Tokens are ESTIMATED from characters (chars/4 low, chars/3.3 high); the minimum is checked against the LOW estimate,
so "cacheable" here is the conservative reading.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
from types import SimpleNamespace

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import conftest  # noqa: E402,F401 -- every *_DB_PATH -> a sandbox, before any api.* import
from api.services.uct_agent import turn  # noqa: E402

# Minimum cacheable prefix (tokens) per model family; Claude API prompt-caching docs.
MIN_CACHEABLE = {"claude-haiku-4-5": 4096, "claude-opus-4-5": 4096, "claude-opus-4-6": 4096,
                 "claude-opus-4-7": 2048, "claude-sonnet-4-5": 1024, "claude-sonnet-4-6": 1024}
LOW, HIGH = 4.0, 3.3
CANNED = json.dumps({"disposition": "answer", "reply": "ok", "question": None, "ops": [], "unsupported_category": None,
                     "research": None, "title": None, "need_groups": None})


def tok(chars: int, per: float = LOW) -> int:
    return int(chars / per)


def h(s: str) -> str:
    return hashlib.sha256(s.encode("utf-8")).hexdigest()[:10]


def capture(item: dict) -> dict | None:
    body = item.get("body") or {}
    seen = {}

    def caller(**kw):
        seen.setdefault("kw", kw)
        return SimpleNamespace(content=[SimpleNamespace(type="text", text=CANNED)], stop_reason="end_turn",
                               usage=SimpleNamespace(input_tokens=0, output_tokens=0, cache_read_input_tokens=0,
                                                     cache_creation_input_tokens=0))
    try:
        turn.run_turn(message=body.get("message") or "", context=body.get("context") or {},
                      history=item.get("history") or body.get("history") or [], capabilities=body.get("capabilities"),
                      manifest_version=body.get("manifestVersion"), routing=body.get("routing"),
                      conversation_title="(no name yet)", caller=caller)
    except turn.TurnError:
        pass
    return seen.get("kw")


def analyse(items: list[dict]) -> dict:
    model = turn.model()
    minimum = MIN_CACHEABLE.get(model, 1024)
    rows, refused = [], 0
    for it in items:
        if "body" not in it or (it.get("mode") not in (None, "legacy")):
            continue
        kw = capture(it)
        if kw is None:
            refused += 1
            continue
        schema = json.dumps(kw["output_config"], sort_keys=True, separators=(",", ":"))
        blocks = [b["text"] for b in kw["system"]]
        marks = [i for i, b in enumerate(kw["system"]) if b.get("cache_control")]
        msgs = json.dumps(kw["messages"], ensure_ascii=False)
        prefixes, cum = [], len(schema)
        acc = model + "\x00" + schema
        for i, text in enumerate(blocks):
            acc += "\x00" + text
            cum += len(text)
            if i in marks:
                prefixes.append({"fp": h(acc), "chars": cum})
        first = next((p for p in prefixes if tok(p["chars"]) >= minimum), None)
        rows.append({"schema": h(schema), "schema_chars": len(schema), "blocks": [len(b) for b in blocks],
                     "prefixes": prefixes, "first": first, "msg_chars": len(msgs),
                     "sys_chars": len(schema) + sum(len(b) for b in blocks)})
    n = len(rows)
    out = {"model": model, "min_cacheable_tokens": minimum, "requests": n, "refused_before_model": refused,
           "distinct_schemas": len({r["schema"] for r in rows})}
    depth = max((len(r["prefixes"]) for r in rows), default=0)
    for i in range(depth):
        ps = [r["prefixes"][i] for r in rows if len(r["prefixes"]) > i]
        chars = sorted(p["chars"] for p in ps)
        out[f"bp{i + 1}"] = {"requests": len(ps), "distinct": len({p["fp"] for p in ps}),
                             "tokens_low_p50": tok(chars[len(chars) // 2]), "tokens_low_min": tok(chars[0]),
                             "tokens_high_p50": tok(chars[len(chars) // 2], HIGH),
                             "reaches_minimum": sum(1 for c in chars if tok(c) >= minimum)}
    firsts = [r["first"] for r in rows]
    out["no_cacheable_prefix"] = sum(1 for f in firsts if f is None)
    out["first_cacheable_distinct"] = len({f["fp"] for f in firsts if f})
    seen, hits, cached, total = set(), 0, 0, 0
    for r in rows:
        total += tok(r["sys_chars"] + r["msg_chars"])
        elig = [p for p in r["prefixes"] if tok(p["chars"]) >= minimum]
        best = next((p for p in reversed(elig) if p["fp"] in seen), None)   # the longest prefix already written
        if best:
            hits += 1
            cached += tok(best["chars"])
        seen.update(p["fp"] for p in elig)
    out["hit_potential_requests"] = round(hits / n, 3) if n else 0
    out["hit_potential_token_share"] = round(cached / total, 3) if total else 0
    prefix_share = sorted((tok(f["chars"]) / max(1, tok(r["sys_chars"] + r["msg_chars"]))) for r, f in zip(rows, firsts) if f)
    out["first_cacheable_share_of_input_p50"] = round(prefix_share[len(prefix_share) // 2], 3) if prefix_share else 0
    # PAIRWISE (TTL-free, the low-traffic reading): request B follows a random OTHER request A while A's entry is live.
    # B reads the longest of its cacheable prefixes that A also wrote. Prefixes nest, so the requests sharing a longer
    # mark are a subset of those sharing a shorter one.
    count = {}
    for r in rows:
        for p in r["prefixes"]:
            count[p["fp"]] = count.get(p["fp"], 0) + 1
    p_hit, share = 0.0, 0.0
    for r in rows:
        elig = [p for p in r["prefixes"] if tok(p["chars"]) >= minimum]
        if not elig or n < 2:
            continue
        inp = max(1, tok(r["sys_chars"] + r["msg_chars"]))
        longer = 0
        for p in reversed(elig):                       # longest first
            k = count[p["fp"]] - 1 - longer            # other requests whose longest shared mark is this one
            share += k * tok(p["chars"]) / inp
            longer += k
        p_hit += longer
    out["pair_hit_probability"] = round(p_hit / (n * (n - 1)), 3) if n > 1 else 0
    out["pair_cached_token_share"] = round(share / (n * (n - 1)), 3) if n > 1 else 0
    sysc = sorted(r["sys_chars"] for r in rows)
    msgc = sorted(r["msg_chars"] for r in rows)
    out["schema_plus_system_tokens_low_p50"] = tok(sysc[n // 2]) if n else 0
    out["messages_tokens_low_p50"] = tok(msgc[n // 2]) if n else 0
    out["full_catalog_requests"] = sum(1 for it in items if "body" in it and it.get("mode") in (None, "legacy")
                                       and not (turn.validate_routing(it["body"].get("routing")) or {}).get("unselected"))
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("bodies")
    ap.add_argument("--json", default="")
    a = ap.parse_args()
    items = json.load(open(a.bodies, encoding="utf-8"))
    out = analyse(items)
    for k, v in out.items():
        print(f"{k}: {v}")
    if a.json:
        with open(a.json, "w", encoding="utf-8") as f:
            json.dump(out, f, indent=2)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
