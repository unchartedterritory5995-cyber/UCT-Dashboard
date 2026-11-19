"""Door vs browser, swept. MEASURE-ONLY: not a gate, wired into no workflow.

For many small schema-valid patches: does the SERVER door (`definition_conversation.converse`)
accept it, and does the BROWSER's own patch engine (the shipped modules, in node) apply it?

  * ACCEPT-THEN-REFUSE -- the door accepts, the browser refuses. On 2026-11-17 this reached
    production six times as "Nothing was changed" for a request the assistant had built. The first
    run of this sweep measured it at about a third of one-operation patches, across some forty
    browser rules, which is why the browser now sends its own refusal back for one repair
    (`definition_conversation.browser_refusal`) instead of the door restating each rule.
  * DOOR-STRICTER -- the door refuses, the browser alone would apply. Expected only for the door's
    word-based checks (a symbol the request did not name, a rename nobody asked for).
  * agree -- both accept, or both refuse.

Run it after any change to the door's checks or to the browser's patch engine, and compare the
tallies with the last run. Offline: the scripted model of `converse_eval`, its sandbox, no money.

    python tools/door_browser_sweep.py [--out rows.jsonl] [--pairs] [--limit N]

`--pairs` adds ordered pairs of presentation operations on three starting indicators (minutes
rather than seconds). The last line printed is `SWEEP DONE <n> <tallies as JSON>`.
"""
import argparse
import io
import itertools
import json
import sys
import tempfile
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))
sys.path.insert(0, str(ROOT))
import converse_eval as ce  # noqa: E402

PATCH = "uct.authoring.patch/1"
num = lambda v: {"type": "num", "value": v}
S = lambda n: {"type": "series", "name": n}
call = lambda name, *a: {"type": "call", "name": name, "args": list(a)}
op = lambda name, *a: {"type": "op", "name": name, "args": list(a)}
EMA = call("ema", S("close"), num(10))
SMA = call("sma", S("close"), num(20))
SMA50 = call("sma", S("close"), num(50))
COND = op(">", S("close"), SMA)
COND2 = call("crossOver", EMA, SMA)
RSI = call("rsi", S("close"), num(14))
RATIO = op("/", S("close"), {"type": "sym", "value": "SPY", "args": [S("close")]})
WK = {"type": "tf", "value": "W", "args": [EMA]}
GREEN, RED, GREY = "#089981", "#F23645", "#787B86"

out = lambda key, tree, **kw: dict({"key": key, "tree": tree}, **kw)
BASES = {
    "line": {"op": "create", "name": "Sweep", "placement": "price", "outputs": [out("a", EMA)]},
    "cond": {"op": "create", "name": "Sweep", "placement": "price", "outputs": [out("a", COND)]},
    "linecond": {"op": "create", "name": "Sweep", "placement": "price", "outputs": [out("a", EMA), out("b", COND)]},
    "twolines": {"op": "create", "name": "Sweep", "placement": "price", "outputs": [out("a", EMA), out("b", SMA)]},
    "sym": {"op": "create", "name": "Sweep", "placement": "pane", "outputs": [out("a", RATIO), out("b", COND)]},
    "tf": {"op": "create", "name": "Sweep", "placement": "price", "outputs": [out("a", WK), out("b", COND)]},
    "input": {"op": "create", "name": "Sweep", "placement": "price",
              "inputs": [{"key": "mult", "label": "Multiplier", "default": 2}],
              "outputs": [out("a", op("*", S("close"), S("mult"))), out("b", COND)]},
    "pane": {"op": "create", "name": "Sweep", "placement": "pane",
             "outputs": [out("a", RSI), out("b", op(">", RSI, num(70)))]},
}


def follow_ops():
    ops = {}
    for x, other in (("a", "b"), ("b", "a")):
        ops[f"marker:{x}"] = {"op": "set_marker", "output": x, "shape": "circle", "position": "aboveBar"}
        ops[f"unmarker:{x}"] = {"op": "remove_marker", "output": x}
        for st in ("histogram", "area", "baseline", "stepline"):
            ops[f"style-{st}:{x}"] = {"op": "set_style", "output": x, "style": st}
        ops[f"style-hidden:{x}"] = {"op": "set_style", "output": x, "hidden": True}
        ops[f"style-color:{x}"] = {"op": "set_style", "output": x, "color": GREEN, "width": 3}
        for ch in ("barcolor", "bgcolor"):
            ops[f"paint-{ch}:{x}"] = {"op": "set_paint", "output": x, "channel": ch, "color": GREEN}
            ops[f"unpaint-{ch}:{x}"] = {"op": "remove_paint", "output": x, "channel": ch}
        ops[f"states:{x}"] = {"op": "set_color_states", "output": x, "states": [{"when": COND2, "color": GREEN}], "otherwise": GREY}
        ops[f"states-rel:{x}"] = {"op": "set_color_states", "output": x, "states": [{"relation": "rising", "color": GREEN}], "otherwise": RED}
        ops[f"rule-sign:{x}"] = {"op": "set_color_rule", "output": x, "rule": "sign", "up": GREEN, "down": RED}
        ops[f"rule-rising:{x}"] = {"op": "set_color_rule", "output": x, "rule": "rising", "up": GREEN, "down": RED}
        ops[f"rule-cond:{x}"] = {"op": "set_color_rule", "output": x, "rule": "condition", "when": other, "up": GREEN, "down": RED}
        ops[f"rule-none:{x}"] = {"op": "set_color_rule", "output": x, "rule": "none"}
        ops[f"fill:{x}"] = {"op": "set_fill", "output": x, "with": other, "color": GREEN, "opacity": 0.2}
        ops[f"fill-when:{x}"] = {"op": "set_fill", "output": x, "with": other, "color": GREEN, "when": other}
        ops[f"fill-ab:{x}"] = {"op": "set_fill", "output": x, "with": other, "colorAbove": GREEN, "colorBelow": RED}
        ops[f"unfill:{x}"] = {"op": "remove_fill", "output": x}
        ops[f"table-out:{x}"] = {"op": "set_table", "position": "top_right", "cells": [
            {"row": 0, "col": 0, "text": "Value"}, {"row": 0, "col": 1, "output": x, "format": "decimal2"}]}
        ops[f"table-when:{x}"] = {"op": "set_table", "cells": [
            {"row": 0, "col": 0, "output": x, "colorWhen": {"output": other, "true": GREEN, "false": RED}}]}
        ops[f"table-bg:{x}"] = {"op": "set_table", "cells": [
            {"row": 0, "col": 0, "text": "State", "backgroundWhen": {"output": x, "true": GREEN, "false": RED}}]}
        for it in ("plot", "signal", "value"):
            ops[f"intent-{it}:{x}"] = {"op": "set_intent", "intent": it, "output": x}
        for f in ("auto", "yesno"):
            ops[f"info-{f}:{x}"] = {"op": "request_info_value", "output": x, "format": f}
        ops[f"alert-true:{x}"] = {"op": "request_alert", "output": x, "triggerPolicy": "becomes_true"}
        ops[f"alert-above:{x}"] = {"op": "request_alert", "output": x, "condition": "cross_above", "threshold": 50}
        ops[f"tree-cond:{x}"] = {"op": "set_output_tree", "output": x, "tree": COND2}
        ops[f"tree-line:{x}"] = {"op": "set_output_tree", "output": x, "tree": SMA50}
        ops[f"tree-sym:{x}"] = {"op": "set_output_tree", "output": x, "tree": RATIO}
        ops[f"tree-tf:{x}"] = {"op": "set_output_tree", "output": x, "tree": WK}
        ops[f"remove:{x}"] = {"op": "remove_output", "output": x}
        ops[f"relabel:{x}"] = {"op": "rename_output", "output": x, "label": "Renamed line"}
        ops[f"clause:{x}"] = {"op": "add_clause", "output": x, "join": "and", "tree": COND2}
    ops["states-barcolor"] = {"op": "set_color_states", "channel": "barcolor", "states": [{"when": COND2, "color": GREEN}], "otherwise": GREY}
    ops["states-bgcolor"] = {"op": "set_color_states", "channel": "bgcolor", "states": [{"when": COND2, "color": GREEN}]}
    ops["levels"] = {"op": "set_levels", "values": [30, 70]}
    ops["table-text"] = {"op": "set_table", "cells": [{"row": 0, "col": 0, "text": "Hello"}]}
    ops["table-setting"] = {"op": "set_table", "cells": [{"row": 0, "col": 0, "output": "mult"}]}
    ops["untable"] = {"op": "remove_table"}
    for t in ("W", "M", "D", "60", "5", "chart"):
        ops[f"calc-{t}"] = {"op": "set_calculation_timeframe", "timeframe": t}
    for p in ("pane", "price"):
        ops[f"place-{p}"] = {"op": "set_placement", "target": p}
    ops["add-line"] = {"op": "add_output", "key": "c", "tree": SMA50, "label": "SMA 50"}
    ops["add-cond"] = {"op": "add_output", "key": "c", "tree": COND2, "label": "Cross"}
    ops["add-hidden"] = {"op": "add_output", "key": "c", "tree": COND2, "hidden": True}
    ops["add-sym"] = {"op": "add_output", "key": "c", "tree": RATIO, "label": "Ratio"}
    ops["add-tf"] = {"op": "add_output", "key": "c", "tree": WK, "label": "Weekly"}
    ops["add-dup"] = {"op": "add_output", "key": "a", "tree": SMA50}
    ops["rename"] = {"op": "rename_definition", "name": "Swept indicator"}
    ops["slot"] = {"op": "set_slot", "slot": "value#1", "value": 21}
    ops["unclause"] = {"op": "remove_clause", "clause": "value#1"}
    for x in ("a", "b"):
        ops[f"cancel-alert:{x}"] = {"op": "cancel_request", "kind": "alert", "output": x}
        ops[f"cancel-info:{x}"] = {"op": "cancel_request", "kind": "info_value", "output": x}
    ops["input-new"] = {"op": "set_input", "input": {"key": "len", "label": "Length", "default": 14}}
    ops["input-edit"] = {"op": "set_input", "input": {"key": "mult", "label": "Multiplier", "default": 3}}
    ops["input-remove"] = {"op": "remove_input", "key": "mult"}
    return ops


PAIR_OPS = ["marker:a", "marker:b", "style-histogram:a", "style-hidden:a", "style-hidden:b", "paint-barcolor:b",
            "paint-bgcolor:b", "states:a", "states:b", "states-rel:a", "states-barcolor", "rule-sign:a", "rule-cond:a",
            "fill:a", "fill-when:a", "levels", "table-out:a", "table-when:a", "table-bg:b", "calc-W", "calc-60",
            "intent-signal:a", "intent-plot:b", "intent-value:a", "intent-signal:b", "place-pane", "place-price",
            "info-auto:a", "alert-true:b", "add-cond", "add-hidden", "add-sym", "tree-cond:a", "tree-sym:a",
            "tree-line:b", "remove:a", "remove:b", "clause:b", "input-remove"]
PAIR_BASES = ["linecond", "sym", "input"]
env = lambda rev, ops: {"contract": PATCH, "baseRevision": rev, "disposition": "change", "reply": "Done.", "ops": ops}
WORDS = "Build the indicator as described."
#: a patch that reads SPY is sent with words that name it, or the door's own backstop (a symbol the
#: request did not name) answers first and the patch is never compared
WORDS_NAMING = "Build the indicator as described, against SPY."
words_for = lambda patch: WORDS_NAMING if '"sym"' in json.dumps(patch) else WORDS  # noqa: E731


def setup():
    run_id = "sweep-" + uuid.uuid4().hex[:6]
    work = Path(tempfile.gettempdir()) / "uct-converse-eval" / run_id
    out_dir = work / "out"
    out_dir.mkdir(parents=True, exist_ok=True)
    ce.refuse_shared_root("--work", work)
    ce.enter_sandbox(work / "data", live=False, cap_usd=None)
    from api.services.catalyst import store as catalyst_store
    from api.services import auth_db
    catalyst_store._init_db()
    auth_db.init_db()
    from api.services import indicator_alert_service
    indicator_alert_service.init_schema()
    client = ce.ScriptedClient({"input_tokens": 10, "output_tokens": 10})
    import api.services.engine as engine
    engine._get_anthropic_client = lambda: client
    lane = ce.Lane(work / "lane")
    lane.start()
    args = argparse.Namespace(max_usd=None, only=None, repeats=1)
    run = ce.Run(args, {"cases": []}, {"usage": {}}, None, out_dir, lane, client, False)
    return run, lane


def browser_alone(lane, sid, ops, rev):
    server = {"ok": True, "disposition": "change", "reply": "", "turn": "patch", "envelope": env(rev, ops),
              "not_understood": [], "unavailable": []}
    return lane.call("model", sid=sid, words=WORDS, serverBody=server)


def said(c):
    """The browser's words for a refusal. Since the browser sends its refusal back to the door, a
    refused patch comes out of the lane as the request it built for that (`needsServer`), which
    carries the engine's own code and sentence; an older lane answers with refusal entries."""
    want = (c or {}).get("needsServer") or {}
    errors = (want.get("browser_refusal") or {}).get("errors") or []
    if errors:
        return "; ".join(errors)[:260]
    return "; ".join(" ".join(e.get("lines") or []) for e in (c or {}).get("entries") or [])[:260]


def first_verdict(run, lane, sid, words, envelope):
    """The door's answer to ONE scripted patch and the browser's verdict on that answer. Not
    `Run.turn`: that follows the browser's repair through, and this measures what needed one."""
    body = lane.call("body", sid=sid, words=words)["body"]
    run.client.arm([envelope, envelope])
    server = run.conv.converse(
        body["message"], user_id=ce.EVAL_USER, view=body["view"], authoring=body.get("authoring"),
        snippets=body.get("snippets"), chart=body.get("chart") or {}, admin=True,
        conversation_id=body.get("conversationId"))
    server = json.loads(json.dumps(server, default=str))
    client = lane.call("model", sid=sid, words=words, serverBodies=[server])
    return server, client


def one(run, lane, base, names, ops_by_name, mode):
    ops = [ops_by_name[n] for n in names]
    row = {"base": base, "ops": list(names), "mode": mode}
    sid = "s-" + uuid.uuid4().hex[:10]
    lane.call("new", sid=sid, sym="TEST", tf="D")
    rev = 0
    if mode == "edit":
        first = browser_alone(lane, sid, [BASES[base]], 0)
        if not first.get("changed"):
            row.update(verdict="BASE-DID-NOT-BUILD", browser=said(first))
            return row
        rev = first.get("revision") or 1
        patch = ops
    else:
        patch = [BASES[base]] + ops
    e = env(rev, patch)
    server, client = first_verdict(run, lane, sid, words_for(patch), e)
    door_ok = bool(server.get("ok") and server.get("disposition") == "change")
    row["door"] = "accept" if door_ok else f"refuse {server.get('gate') or server.get('disposition')}"
    if door_ok:
        row["mended"] = (server.get("envelope") or {}).get("ops") != patch
        row["browser"] = "applied" if client.get("changed") else "refused: " + said(client)
        row["verdict"] = "agree" if client.get("changed") else "ACCEPT-THEN-REFUSE"
        return row
    row["door_said"] = str(server.get("reason") or server.get("detail") or server.get("reply") or "")[:260]
    # the browser alone, on a fresh session in the same starting state
    sid2 = "s-" + uuid.uuid4().hex[:10]
    lane.call("new", sid=sid2, sym="TEST", tf="D")
    if mode == "edit":
        browser_alone(lane, sid2, [BASES[base]], 0)
    alone = browser_alone(lane, sid2, patch, rev)
    row["browser"] = "applied" if alone.get("changed") else "refused: " + said(alone)
    row["verdict"] = "DOOR-STRICTER" if alone.get("changed") else "agree"
    return row


def sentence(browser: str) -> str:
    """The browser's refusal with this sweep's own names taken out, so one rule is one line."""
    text = browser[len("refused: "):] if browser.startswith("refused: ") else browser
    text = text.replace(" Nothing on the chart changed.", "")
    for name in ('"a"', '"b"', '"c"', "EMA 10 (W)", "EMA 10", "SMA 20", "SMA 50", "RSI 14 above 70", "RSI 14",
                 "Close above SMA 20", "Close divided by SPY Close", "Calculator", "Renamed line"):
        text = text.replace(name, "X")
    return " ".join(text.split())[:160]


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=None, help="write one JSON row per patch here")
    ap.add_argument("--pairs", action="store_true")
    ap.add_argument("--limit", type=int, default=0)
    a = ap.parse_args(argv)
    ops_by_name = follow_ops()
    jobs = []
    for base in BASES:
        for name in ops_by_name:
            jobs.append((base, (name,), "create"))
            jobs.append((base, (name,), "edit"))
    if a.pairs:
        for base in PAIR_BASES:
            for x, y in itertools.permutations(PAIR_OPS, 2):
                jobs.append((base, (x, y), "create"))
    if a.limit:
        jobs = jobs[:a.limit]
    run, lane = setup()
    tally = {}
    out_path = a.out or str(Path(tempfile.gettempdir()) / "uct-converse-eval" / f"door-browser-sweep-{uuid.uuid4().hex[:6]}.jsonl")
    Path(out_path).parent.mkdir(parents=True, exist_ok=True)
    refused_as, stricter_as = {}, {}
    with io.open(out_path, "w", encoding="utf-8", newline="\n") as fh:
        for i, (base, names, mode) in enumerate(jobs):
            try:
                row = one(run, lane, base, names, ops_by_name, mode)
            except Exception as exc:  # a crash in either half is a finding of its own
                row = {"base": base, "ops": list(names), "mode": mode, "verdict": "CRASH", "error": f"{type(exc).__name__}: {exc}"[:300]}
            tally[row["verdict"]] = tally.get(row["verdict"], 0) + 1
            if row["verdict"] == "ACCEPT-THEN-REFUSE":
                key = sentence(row.get("browser", ""))
                refused_as[key] = refused_as.get(key, 0) + 1
            elif row["verdict"] == "DOOR-STRICTER":
                stricter_as[row.get("door", "")] = stricter_as.get(row.get("door", ""), 0) + 1
            fh.write(json.dumps(row) + "\n")
            if i % 200 == 0:
                fh.flush()
                print(f"[sweep] {i}/{len(jobs)} {tally}", file=sys.stderr, flush=True)
    print(f"rows: {out_path}")
    print("the browser's refusals of what the door accepted, most common first:")
    for key, n in sorted(refused_as.items(), key=lambda kv: -kv[1]):
        print(f"  {n:5d}  {key}")
    print("what the door refused and the browser alone would apply:")
    for key, n in sorted(stricter_as.items(), key=lambda kv: -kv[1]):
        print(f"  {n:5d}  {key}")
    print("SWEEP DONE", len(jobs), json.dumps(tally, sort_keys=True))
    return tally


if __name__ == "__main__":
    main()
