"""Finish program, lane FE round 2 -- settle one question: does the sample notebook's plan note
show its entry / stop / target rows in the chart's Plan panel, and if not, is that the walk or
the product?

Sandbox on port 8133, every wave-13/14 flag ON, sample notebook added through the product's own
route. Records, raw, for the SAMPLE plan note and for a COMPARISON note whose chart block carries
levels in the shape the editor itself writes when a member draws a line (id + points + role):
  * the stored chart block (annotations, ta);
  * the server's own reading of those annotations (POST /api/j2/chart-plan/size);
  * what the Plan panel renders after pressing Plan: the rows, their text, their data-level-id;
  * console errors and warnings while it renders.

    python tools/notebook_fin_fe_sample_plan_probe.py --data-dir 'C:\\data-fin-fe\\sample1' `
        --port 8133 --out 'docs\\notebook\\evidence\\fin-fe\\sample-plan-probe-<sha>'
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / "tools"))
import notebook_perf_harness as h  # noqa: E402
from notebook_fin_fe_walk import embeds_of, pause, read_note  # noqa: E402
from notebook_w13h2_walk import Walk, frame_of, install_bars_route, toolbar_button  # noqa: E402
from notebook_w13x_walk import FLAGS  # noqa: E402
from secret_scrub import brief, scrub  # noqa: E402

PANEL = """() => { const p = document.querySelector('[data-chart-plan-panel]'); if (!p) return null;
  const rows = [...p.querySelectorAll('ul[aria-label="Drawn levels"] > li')];
  return { text: p.innerText.slice(0, 600), row_count: rows.length,
           rows: rows.map((li) => ({ level_id: li.getAttribute('data-level-id'), text: li.innerText.replace(/\\n/g, ' | ').slice(0, 120),
                                     checked: [...li.querySelectorAll('[aria-checked=true]')].map((b) => b.textContent) })),
           numbers: [...p.querySelectorAll('[data-plan-value]')].map((d) => [d.getAttribute('data-plan-value'), d.textContent]) } }"""


def look(pg, base, req, w, tag, nid, console):
    note = read_note(req, base, nid)
    blocks = embeds_of(note)
    block = next((b for b in blocks if (b.get("attrs") or {}).get("widgetId") == "chart"), None)
    attrs = (block or {}).get("attrs") or {}
    out = {"note_id": nid, "title": note.get("title"), "stored_annotations": attrs.get("annotations"),
           "stored_ta_keys": sorted((attrs.get("ta") or {}).keys()), "stored_planBlock": (attrs.get("ta") or {}).get("planBlock"),
           "embedId": attrs.get("embedId"), "mode": attrs.get("mode"), "params": attrs.get("params")}
    size = req.post(base + "/api/j2/chart-plan/size", data={"annotations": attrs.get("annotations") or [],
                                                            "symbol": (attrs.get("params") or {}).get("symbol"),
                                                            **({"planBlock": out["stored_planBlock"]} if out["stored_planBlock"] else {})})
    out["server_plan_read"] = {"status": size.status, "plan": (size.json() or {}).get("plan") if size.status == 200 else size.text()[:200]}
    console.clear()
    pg.evaluate("(p) => { window.history.pushState({}, '', p); window.dispatchEvent(new PopStateEvent('popstate')) }",
                f"/journal/notebook?note={nid}")
    pg.wait_for_function("(id) => new URLSearchParams(location.search).get('note') === id", arg=nid, timeout=30000)
    pg.wait_for_selector(".ProseMirror [data-widget-embed-body]", timeout=90000)
    pause(pg, 3)
    out["body_kind"] = pg.evaluate("() => { const b = document.querySelector('.ProseMirror [data-widget-embed-body]'); "
                                   "return { canvas: !!b.querySelector('canvas'), img: !!b.querySelector('img'), text: b.innerText.slice(0, 80) } }")
    try:
        frame = frame_of(pg, 0)
        toolbar_button(pg, frame, "Plan", False).click()
        pg.wait_for_selector("[data-chart-plan-panel]", timeout=20000)
        pause(pg, 3)
        out["plan_button"] = "pressed"
    except Exception as e:  # noqa: BLE001
        out["plan_button"] = f"not available: {brief(e, 200)}"
    out["panel"] = pg.evaluate(PANEL)
    out["console"] = list(console)[:12]
    w.shot(pg, f"{tag}_plan_panel")
    w.raw[tag] = out
    w.dump(f"{tag}.json", out)
    return out


def run(base, w):
    from playwright.sync_api import sync_playwright
    served = []
    with sync_playwright() as pw:
        br = pw.chromium.launch()
        ctx = br.new_context(viewport={"width": 1280, "height": 1300}, reduced_motion="reduce")
        req = ctx.request
        h._signup_or_login(req, base, h.ADMIN_EMAIL, h.ADMIN_PW, "hubtest")
        req.post(base + "/api/auth/admin/comp-access", data={"email": h.ADMIN_EMAIL, "action": "grant"})
        req.post(base + "/api/auth/admin/verify-email", data={"email": h.ADMIN_EMAIL})
        me = req.get(base + "/api/auth/me").json()
        w.record("W0_flags_on", me.get("notebook_chart_plan_enabled") is True and me.get("notebook_ta_fingerprint_enabled") is True,
                 f"chart_plan={me.get('notebook_chart_plan_enabled')} fingerprint={me.get('notebook_ta_fingerprint_enabled')} "
                 f"getting_started={me.get('notebook_getting_started_enabled')}")
        add = req.post(base + "/api/j2/onboarding/sample-notebook")
        w.raw["sample_add"] = {"status": add.status, "body": add.text()[:300]}
        chk = req.post(base + "/api/j2/notes/import/check", data={"importKeys": ["sample-example:plan"]})
        plan_id = ((chk.json().get("existing") or {}).get("sample-example:plan") or {}).get("id") if chk.status == 200 else None
        w.raw["sample_plan_lookup"] = {"status": chk.status, "id": plan_id, "body": chk.text()[:300]}
        w.record("W1_sample_plan_note_exists", bool(plan_id), f"sample add HTTP {add.status}; plan note id={plan_id}")
        if not plan_id:
            raise h.SetupFailed(f"no sample plan note: {w.raw['sample_add']} {w.raw['sample_plan_lookup']}")
        sample = read_note(req, base, plan_id)
        s_attrs = next(b for b in embeds_of(sample) if b["attrs"].get("widgetId") == "chart")["attrs"]
        prices = {a.get("role"): a.get("price") for a in (s_attrs.get("annotations") or [])}
        # the comparison: the SAME levels, in the shape the editor writes for a line a member drew
        hand = json.loads(json.dumps(s_attrs))
        hand["embedId"] = "cmp-plan"
        hand["annotations"] = [{"id": f"ln-{r}", "type": "horizontal", "role": r, "points": [{"time": hand["params"]["to"], "price": p}]}
                               for r, p in prices.items()]
        doc = {"type": "doc", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "comparison"}]},
                                          {"type": "widgetEmbed", "attrs": hand}]}
        mk = req.post(base + "/api/j2/notes", data={"title": "probe: same levels, drawn-line shape", "bodyJson": doc})
        if mk.status not in (200, 201):
            raise h.SetupFailed(f"comparison note failed: HTTP {mk.status} {mk.text()[:300]}")
        cmp_id = mk.json()["note"]["id"]

        install_bars_route(ctx, served)
        pg = ctx.new_page()
        console = []
        pg.on("console", lambda m: console.append(f"{m.type}: {m.text[:260]}") if m.type in ("error", "warning") else None)
        pg.on("pageerror", lambda e: console.append(f"pageerror: {brief(e, 260)}"))
        pg.goto(f"{base}/journal/notebook", wait_until="domcontentloaded")
        h._dismiss_intro(pg)
        pause(pg, 2)
        a = look(pg, base, req, w, "SAMPLE", plan_id, console)
        b = look(pg, base, req, w, "COMPARISON", cmp_id, console)
        for tag, o in (("SAMPLE", a), ("COMPARISON", b)):
            p = o.get("panel") or {}
            ids = [r["level_id"] for r in p.get("rows", [])]
            print(f"  OBSERVED {tag}: plan button {o['plan_button']}; rows={p.get('row_count')}; data-level-id={ids}; "
                  f"server plan={o['server_plan_read'].get('plan')}; numbers={p.get('numbers')}")
        br.close()


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--data-dir", required=True)
    ap.add_argument("--port", type=int, default=8133)
    ap.add_argument("--out", required=True)
    args = ap.parse_args(argv)
    why = h.refuse_shared_root(args.data_dir)
    if why or args.port != 8133 or h.port_busy(args.port):
        print(f"REFUSED: {why or 'port must be 8133 and free'}")
        return 3
    data_dir = Path(args.data_dir)
    if data_dir.exists() and any(data_dir.iterdir()):
        print(f"REFUSED: {data_dir} is not empty")
        return 3
    data_dir.mkdir(parents=True, exist_ok=True)
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    w = Walk(out)
    for k in list(os.environ):
        if k.startswith("RAILWAY_"):
            os.environ.pop(k, None)
    os.environ.update({f: "1" for f in FLAGS})
    os.environ.update({"NOTEBOOK_ONBOARDING_ENABLED": "1", "NOTEBOOK_GETTING_STARTED_ENABLED": "1"})
    box = h.Sandbox(str(data_dir), args.port, out / "sandbox.log")
    base = f"http://127.0.0.1:{args.port}"
    not_run = failure = None
    box.start()
    try:
        if not box.wait_healthy(base, 300):
            failure = "the sandbox never answered /api/health"
        else:
            try:
                run(base, w)
            except h.SetupFailed as e:
                not_run = scrub(str(e))[:400]
            except Exception as e:  # noqa: BLE001
                import traceback
                failure = f"the probe raised {brief(e, 400)}"
                w.raw["traceback"] = scrub(traceback.format_exc())[-3000:]
            box.wait_checkpoint(h.POST_BOOT, 60)
    finally:
        box.stop()
    integ = h.read_integrity(box.integrity_path(), [h.PRE_BOOT, h.POST_BOOT, h.SHUTDOWN])
    h._keep_integrity_log(integ, out / "integrity.md", own=True)
    print(h.integrity_line(integ, f"stop: {box.stop_how}", not_run=not_run))
    w.record("W10_port_free_after_shutdown", not h.port_busy(args.port), f"listener on {args.port}: {h.port_busy(args.port)}")
    (out / "probe.json").write_text(json.dumps({"tool": "tools/notebook_fin_fe_sample_plan_probe.py", "integrity": integ,
                                                "failure": failure, "not_run": not_run, "rows": w.rows, "raw": w.raw},
                                               indent=1, ensure_ascii=False, default=str), encoding="utf-8")
    print(f"PROBE: {'NOT RUN -- ' + not_run if not_run else ('FAILED -- ' + failure if failure else 'recorded')}")
    return 3 if not_run else (1 if failure else 0)


if __name__ == "__main__":
    sys.exit(main())
