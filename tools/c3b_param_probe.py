# -*- coding: utf-8 -*-
"""C3B-CLOSE item 6 -- does a PARAMETER move an OBJECT, and does the move persist?

    import -> save -> observe -> CHANGE THE PARAMETER -> reload -> observe again

WHY THIS IS A SEPARATE PROBE. `c0_visual_journey.py` measures one import end to
end and cleans up after itself; it never touches an instance's inputs. The wave
asks a different question -- *"change parameter, recompute, verify object
coordinates change, save, reopen, verify they persist"* -- and that needs the
instance to survive between two page loads with a different input in between.

WHY THE PREFERENCES BLOB AND NOT THE SETTINGS UI. The instance list the chart
reads IS `chart_settings.indicatorInstances` / the workspace widget's copy of it
(`_instance_ids` in the journey documents the shape and how it is written). Going
through the product's own persisted artifact exercises exactly the path a member's
edit takes -- and, unlike driving a slider, it cannot pass because a UI control
happened to be in view.

⛔ THE DISCRIMINATION IS THE OBJECT'S OWN COORDINATE. `c3b_07_param_driven` draws
one line whose y is `ta.sma(close, len)`. If `len` reaches the object program, a
20-bar mean and a 200-bar mean put that line at visibly different heights on the
same bars; if it does not, the line does not move and the probe says so. A test
that only checked the input VALUE persisted would be green on an engine that
ignored it.
"""
import argparse
import json
import os
import sys

_HERE = os.path.dirname(os.path.abspath(__file__))
if _HERE not in sys.path:
    sys.path.insert(0, _HERE)

from c0_visual_journey import (  # noqa: E402
    JS_OBJECT_LAYERS, JS_CHIPS, login, run_one, _open_workspace, _hover_plot,
)


def _prefs(page, base):
    r = page.request.get(f"{base}/api/auth/preferences")
    return (r.json() or {}) if r.ok else {}


def _put_pref(page, base, key, value):
    r = page.request.post(
        f"{base}/api/auth/preferences",
        data=json.dumps({"key": key, "value": value}),
        headers={"Content-Type": "application/json"})
    return r.ok


def _patch_instances(prefs, def_id, mutate, include_deleted=False):
    """Apply `mutate(instance)` to every instance of `def_id`, in every blob the
    chart reads. Returns `{key: new_json}` for the blobs that changed.

    ⛔ MATCHED ON THE INSTANCE ID, NOT ON `defId`. A REMOVED instance is a
    TOMBSTONE — `{instanceId, deleted: true}` and nothing else — so a `defId`
    match finds none of them, which is how the first run of this probe reported
    `reinstated: []` and measured nothing. The id itself carries the definition
    (`inst:<defId>:<n>`, `newInstanceId`), and that is the only field a tombstone
    is guaranteed to have.
    """
    out = {}
    for key in ("chart_settings", "charts_workspace_layout"):
        raw = prefs.get(key)
        if not raw:
            continue
        try:
            blob = json.loads(raw) if isinstance(raw, str) else raw
        except Exception:  # noqa: BLE001
            continue
        touched = False

        def walk(settings):
            nonlocal touched
            for inst in ((settings or {}).get("indicatorInstances") or []):
                if not isinstance(inst, dict):
                    continue
                iid = inst.get("instanceId") or ""
                if not iid.startswith(f"inst:{def_id}:"):
                    continue
                if inst.get("deleted") is True and not include_deleted:
                    continue
                mutate(inst)
                touched = True

        if key == "chart_settings":
            walk(blob)
        else:
            for w in ((blob or {}).get("widgets") or []):
                walk(((w or {}).get("opts") or {}).get("settings"))
        if touched:
            out[key] = json.dumps(blob)
    return out


def _objects(page):
    try:
        return page.evaluate(JS_OBJECT_LAYERS)
    except Exception as e:  # noqa: BLE001
        return [{"error": str(e)[:120]}]


def _observe(page, base):
    _open_workspace(page, base)
    page.wait_for_timeout(2500)
    _hover_plot(page)
    page.wait_for_timeout(1200)
    objs = _objects(page)
    # ⛔ "no object layer" and "an object layer that drew nothing" are different
    # findings, and so is "the indicator is not on the chart at all". The chips
    # separate the third from the first two.
    try:
        chips = page.evaluate(JS_CHIPS)
    except Exception:  # noqa: BLE001
        chips = []
    return {"objects": objs, "chips": chips}


def main():
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")
        except Exception:  # noqa: BLE001
            pass
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", required=True)
    ap.add_argument("--fixture", required=True)
    ap.add_argument("--out", default="tools/c3b_param_out")
    ap.add_argument("--email", default=os.environ.get("C0_EMAIL", "gj_automation@local.dev"))
    ap.add_argument("--password", default=os.environ.get("C0_PASSWORD", "OosTest2026!"))
    ap.add_argument("--input-key", default="len")
    ap.add_argument("--to", type=float, default=200)
    args = ap.parse_args()

    from pathlib import Path
    from playwright.sync_api import sync_playwright

    src = Path(args.fixture).read_text(encoding="utf-8")
    name = Path(args.fixture).stem
    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)
    report = {"fixture": name, "input": args.input_key, "to": args.to}

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        ctx = browser.new_context(viewport={"width": 1600, "height": 900},
                                  reduced_motion="reduce")
        page = ctx.new_page()
        login(page, args.base, args.email, args.password)

        # 1. the ordinary journey, which saves the definition AND adds an instance
        #    (it removes the instance at the end -- we put one back below).
        row = run_one(page, args.base, name, src, out_dir)
        report["journey"] = row.get("result")
        report["def_id"] = row.get("def_id")
        if row.get("result") != "FULL_JOURNEY_PASS":
            report["detail"] = row.get("detail")
            Path(args.out, "report.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
            print(json.dumps(report, indent=2))
            return

        def_id = row["def_id"]

        # 1b. ⛔⛔ THE PROBE CHECKS ITS OWN PREMISE FIRST.
        #
        # ⚰ THE FIRST RUN OF THIS PROBE MEASURED THE VALIDATOR, NOT THE OBJECT
        # MODEL. It patched `inputs.len` onto an instance of a definition that
        # declares only `color` and `lineWidth` — because `len` sits in a WINDOW
        # slot (`ta.sma(close, len)`), which the Pine door folds to a literal and
        # never offers as a knob. `instances.js` then refused the whole instance
        # for naming an input the definition does not declare (correctly, and
        # fail-closed), so the chart lost the indicator entirely: no chip, no
        # object layer, `pixels_after: []`. That reads exactly like "the object
        # did not survive a parameter change" and is nothing of the kind.
        #
        # So: read the DEFINITION's declared inputs and stop, loudly, if the key
        # is not among them. A probe that cannot move the knob it names must say
        # so rather than produce a number.
        d = page.request.get(f"{args.base}/api/user-definitions/{def_id}")
        body = (d.json() or {}) if d.ok else {}
        definition = body.get("definition") or body
        declared = [i.get("key") for i in (definition.get("inputs") or []) if isinstance(i, dict)]
        report["declared_inputs"] = declared
        if args.input_key not in declared:
            report["result"] = "NOT_MEASURED"
            report["reason"] = (
                f"the saved definition declares {declared!r} and no input "
                f"{args.input_key!r}, so patching it would only exercise the "
                "instance validator's refusal of an undeclared key. This is a "
                "PRE-C3B input-declaration fact (the Pine door folds a "
                "window-slot input to a literal), NOT an object-model result.")
            Path(args.out, "report.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
            print(json.dumps(report, indent=2))
            browser.close()
            return

        # 2. put the instance back, at the DEFAULT input, and observe.
        prefs = _prefs(page, args.base)

        def revive(inst):
            # ⭐ A TOMBSTONE CARRIES ONLY ITS ID, so reviving one means writing the
            # record `addInstance` would have written: the definition, its version
            # and the declared input defaults. Anything less and the chart has an
            # id pointing at nothing.
            inst.pop("deleted", None)
            inst["defId"] = def_id
            if not isinstance(inst.get("inputs"), dict):
                inst["inputs"] = {}
            inst["hidden"] = False

        patched = _patch_instances(prefs, def_id, revive, include_deleted=True)
        for k, v in patched.items():
            _put_pref(page, args.base, k, v)
        report["reinstated"] = list(patched)
        obs = _observe(page, args.base)
        before = obs["objects"]
        report["before"] = before
        report["chips_before"] = obs["chips"]
        page.screenshot(path=str(out_dir / f"{name}-before.png"))

        # 3. CHANGE THE PARAMETER, through the same artifact the product writes.
        prefs = _prefs(page, args.base)

        def set_input(inst):
            inputs = inst.get("inputs")
            if not isinstance(inputs, dict):
                inputs = {}
                inst["inputs"] = inputs
            inputs[args.input_key] = args.to

        patched = _patch_instances(prefs, def_id, set_input)
        for k, v in patched.items():
            _put_pref(page, args.base, k, v)
        report["patched"] = list(patched)

        # 4. reload and observe again -- this is the REOPEN, with the new value.
        obs2 = _observe(page, args.base)
        after = obs2["objects"]
        report["after"] = after
        report["chips_after"] = obs2["chips"]
        page.screenshot(path=str(out_dir / f"{name}-after.png"))

        # 5. and confirm the changed input SURVIVED the round trip.
        prefs = _prefs(page, args.base)
        seen = []
        _patch_instances(prefs, def_id, lambda i: seen.append((i.get("inputs") or {}).get(args.input_key)))
        report["input_after_reload"] = seen

        # ⛔⛔ EVERY READING IS SCOPED TO **THIS** DEFINITION'S INSTANCE.
        #
        # ⚰ A RUN OF THIS PROBE LEAVES ITS REVIVED INSTANCE ON THE CHART — that is
        # the whole point of reviving one — so the next run opens a workspace that
        # already carries the previous fixture's layer. Unscoped, `probe_of` took
        # the FIRST layer it found and reported a stale instance's y-coordinate:
        # 808.6995 before and after, `object_moved: false`, while the layer that
        # actually belonged to this run had moved 741.77 -> 696.77 and repainted
        # 1350 -> 1800 pixels. A contaminated reading that says "no movement" is
        # worse than no reading, because it looks like a result.
        mine = lambda rows: [r for r in (rows or [])
                             if str(r.get("instanceId") or "").startswith(f"inst:{def_id}:")]

        def probe_of(rows):
            for r in mine(rows):
                if r.get("probe"):
                    try:
                        return json.loads(r["probe"])
                    except Exception:  # noqa: BLE001
                        return None
            return None

        pb, pa = probe_of(before), probe_of(after)
        report["y_before"] = (pb or {}).get("rawY")
        report["y_after"] = (pa or {}).get("rawY")
        report["pixels_before"] = [r.get("pixels") for r in mine(before)]
        report["pixels_after"] = [r.get("pixels") for r in mine(after)]
        report["layers_seen_before"] = [r.get("instanceId") for r in before]
        report["layers_seen_after"] = [r.get("instanceId") for r in after]
        report["chips_before"] = [c for c in report["chips_before"]
                                  if str(c.get("instanceId") or "").startswith(f"inst:{def_id}:")]
        report["chips_after"] = [c for c in report["chips_after"]
                                 if str(c.get("instanceId") or "").startswith(f"inst:{def_id}:")]
        report["object_moved"] = (
            pb is not None and pa is not None
            and isinstance(pb.get("rawY"), (int, float))
            and isinstance(pa.get("rawY"), (int, float))
            and abs(pb["rawY"] - pa["rawY"]) > 1e-9)
        # ⛔ THREE OUTCOMES, SAID APART. "the object moved", "the object is still
        # there and did not move" and "the indicator is not on the chart at all"
        # are different findings, and the last one is almost always the probe's
        # own fault rather than the engine's — which is why the chips are read
        # beside the layers.
        report["result"] = (
            "OBJECT_MOVED" if report["object_moved"]
            else "INSTANCE_MISSING_AFTER_RELOAD" if not report["chips_after"]
            else "NO_OBJECT_LAYER_AFTER_RELOAD" if not report["pixels_after"]
            else "OBJECT_DID_NOT_MOVE")

        browser.close()

    Path(args.out, "report.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps({k: v for k, v in report.items() if k not in ("before", "after")}, indent=2)[:2600])


if __name__ == "__main__":
    main()
