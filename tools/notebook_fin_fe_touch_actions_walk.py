"""Finish program, lane FE round 3 -- on a phone and a tablet, how does a member remove or move a
LIVE chart block they cannot select by tap? Every wave flag OFF, port 8133, same sandbox rules as
the other fin-fe walks. Raw observations are written before any row is judged.

At 390 px and 820 px (touch) on a note holding [paragraph, live chart, paragraph, paragraph]:
  recorded: is the block's toolbar on screen without hover; the size of every toolbar control; what
            the block grip does after a tap on the chart; whether a caption or settings control exists
  judged:   the "Block actions" button is on screen, at least 44 x 44, with a real name;
            it opens a sheet whose rows are at least 44 px tall;
            Move down, then Move up twice, put the chart where they say;
            Remove block removes it;
            (a second note) the toolbar's own Remove button removes it and is at least 44 px tall.
At 1280 px (mouse): the "Block actions" button is not shown, hovered or not, and its file is not
requested at all.

    python tools/notebook_fin_fe_touch_actions_walk.py --data-dir 'C:\\data-fin-fe\\touch1' `
        --port 8133 --out 'docs\\notebook\\evidence\\fin-fe\\touch-actions-walk-<sha>'
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
from notebook_fin_fe_walk import chart_embed, para, pause  # noqa: E402
from notebook_fin_fe_select_walk import ORDER, COUNT, SEL, open_note  # noqa: E402
from notebook_w13h2_walk import Walk, install_bars_route  # noqa: E402
from secret_scrub import brief, scrub  # noqa: E402

BOXES = """() => { const f = document.querySelector('[data-widget-embed-view="chart"]'); if (!f) return null;
  const vis = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && cs.display !== 'none' && cs.visibility !== 'hidden' };
  const tb = [...f.children].find((c) => (c.className || '').includes('toolbar'));
  const ctl = [...f.querySelectorAll('button, select')].filter((b) => !b.closest('[data-widget-embed-body]')).map((b) => { const r = b.getBoundingClientRect();
    return { name: (b.getAttribute('aria-label') || b.title || b.textContent || '').trim().slice(0, 60), w: Math.round(r.width), h: Math.round(r.height), visible: vis(b) } });
  const grip = document.querySelector('.uctBlockHandle');
  return { toolbar_visible: !!tb && vis(tb), controls: ctl,
           grip: grip ? { hidden_attr: grip.hidden, visible: vis(grip), top: Math.round(grip.getBoundingClientRect().top) } : null,
           chart_top: Math.round(f.getBoundingClientRect().top), chart_bottom: Math.round(f.getBoundingClientRect().bottom) } }"""


def note(req, base, title):
    live = chart_embed("live-" + title[-6:].replace(" ", ""), "ln", 88.0, caption=None)
    live["attrs"]["annotations"] = []
    doc = {"type": "doc", "content": [para("one"), live, para("two"), para("three")]}
    r = req.post(base + "/api/j2/notes", data={"title": title, "bodyJson": doc})
    if r.status not in (200, 201):
        raise h.SetupFailed(f"creating '{title}' failed: HTTP {r.status} {r.text()[:300]}")
    return r.json()["note"]["id"]


def tap_or_click(pg, loc, touch):
    loc.evaluate("el => el.scrollIntoView({block: 'center'})")
    pause(pg, 0.3)
    (loc.tap() if touch else loc.click())


def touch_width(pg, base, req, w, width):
    tag = f"V{width}"
    obs = {}
    a = note(req, base, f"touch {width} moves")
    b = note(req, base, f"touch {width} remove")
    open_note(pg, base, a, True)
    pg.wait_for_selector("[data-widget-embed-body] canvas", timeout=90000)
    pause(pg, 2)
    pg.locator("[data-widget-embed-view]").first.evaluate("el => el.scrollIntoView({block: 'center'})")
    pause(pg, 0.5)
    obs["before_any_touch"] = pg.evaluate(BOXES)
    bb = pg.locator("[data-widget-embed-body]").first.bounding_box()
    pg.touchscreen.tap(bb["x"] + bb["width"] / 2, bb["y"] + bb["height"] * 0.6)
    pause(pg, 0.8)
    obs["after_tap_on_chart"] = {"block_selected": pg.evaluate(SEL), **(pg.evaluate(BOXES) or {})}
    w.shot(pg, f"{tag}_toolbar")
    names = [c["name"] for c in obs["before_any_touch"]["controls"] if c["visible"]]
    obs["visible_control_names"] = names
    obs["has_settings_control"] = any("setting" in n.lower() for n in names)
    obs["has_caption_control"] = any("caption" in n.lower() for n in names)
    obs["has_move_control_in_toolbar_besides_block_actions"] = any("move" in n.lower() for n in names)

    btn = pg.get_by_role("button", name="Block actions", exact=True)
    try:
        btn.first.wait_for(state="visible", timeout=15000)
        box = btn.first.bounding_box()
    except Exception:  # noqa: BLE001
        box = None
    obs["block_actions_box"] = box
    w.record(f"{tag}_1_block_actions_button_visible_and_44px",
             bool(box) and box["width"] >= 44 and box["height"] >= 44, f"box={box}")
    if box:
        obs["order_start"] = pg.evaluate(ORDER)
        tap_or_click(pg, btn.first, True)
        sheet = pg.get_by_role("dialog")
        sheet.first.wait_for(state="visible", timeout=10000)
        rows = pg.evaluate("""() => [...document.querySelectorAll('[role=dialog] button')].map((b) => { const r = b.getBoundingClientRect();
            return { name: (b.textContent || b.getAttribute('aria-label') || '').trim(), h: Math.round(r.height), w: Math.round(r.width), disabled: b.disabled } })""")
        obs["sheet_rows"] = rows
        w.shot(pg, f"{tag}_sheet")
        acts = [r for r in rows if r["name"] in ("Move up", "Move down", "Remove block")]
        w.record(f"{tag}_2_sheet_offers_three_actions_44px_rows",
                 [r["name"] for r in acts] == ["Move up", "Move down", "Remove block"] and all(r["h"] >= 44 for r in acts),
                 f"rows={acts}")
        tap_or_click(pg, pg.get_by_role("button", name="Move down", exact=True).first, True)
        pause(pg, 1.0)
        obs["order_after_move_down"] = pg.evaluate(ORDER)
        for _ in range(2):
            tap_or_click(pg, btn.first, True)
            pg.get_by_role("dialog").first.wait_for(state="visible", timeout=10000)
            tap_or_click(pg, pg.get_by_role("button", name="Move up", exact=True).first, True)
            pause(pg, 1.0)
        obs["order_after_two_move_ups"] = pg.evaluate(ORDER)
        strip = lambda o: [x for x in o if x]      # noqa: E731 -- the editor's trailing empty paragraph
        w.record(f"{tag}_3_move_down_then_up_twice",
                 strip(obs["order_start"]) == ["one", "BLOCK", "two", "three"]
                 and strip(obs["order_after_move_down"]) == ["one", "two", "BLOCK", "three"]
                 and strip(obs["order_after_two_move_ups"]) == ["BLOCK", "one", "two", "three"],
                 f"start={strip(obs['order_start'])} down={strip(obs['order_after_move_down'])} up,up={strip(obs['order_after_two_move_ups'])}")
        tap_or_click(pg, btn.first, True)
        pg.get_by_role("dialog").first.wait_for(state="visible", timeout=10000)
        obs["move_up_disabled_at_top"] = pg.get_by_role("button", name="Move up", exact=True).first.is_disabled()
        tap_or_click(pg, pg.get_by_role("button", name="Remove block", exact=True).first, True)
        pause(pg, 1.0)
        obs["blocks_after_remove_block"] = pg.evaluate(COUNT)
        w.record(f"{tag}_4_remove_block_removes_it", obs["blocks_after_remove_block"] == 0 and obs["move_up_disabled_at_top"] is True,
                 f"blocks left={obs['blocks_after_remove_block']}; Move up disabled at the top={obs['move_up_disabled_at_top']}")
        pause(pg, 2.5)                              # let autosave land
        stored = req.get(f"{base}/api/j2/notes/{a}").json()
        body = (stored.get("note") or stored).get("bodyJson") or {}
        obs["stored_types_after"] = [n.get("type") for n in (body.get("content") or [])]

    # the toolbar's own Remove button, on the second note
    open_note(pg, base, b, False)
    pg.wait_for_selector("[data-widget-embed-body] canvas", timeout=90000)
    pause(pg, 1.5)
    rm = pg.get_by_role("button", name="Remove embed", exact=True)
    try:
        rm.first.wait_for(state="visible", timeout=8000)
        rbox = rm.first.bounding_box()
        tap_or_click(pg, rm.first, True)
        pause(pg, 1.0)
        left = pg.evaluate(COUNT)
    except Exception as e:  # noqa: BLE001
        rbox, left = None, f"not reachable: {brief(e, 160)}"
    obs["toolbar_remove_box"] = rbox
    obs["blocks_after_toolbar_remove"] = left
    w.record(f"{tag}_5_toolbar_remove_works_by_touch", bool(rbox) and left == 0 and rbox["height"] >= 44,
             f"Remove embed box={rbox}; blocks left={left}")
    w.raw[tag] = obs
    w.dump(f"{tag}.json", obs)
    print(f"  OBSERVED {tag}: toolbar visible without hover={obs['before_any_touch']['toolbar_visible']}; "
          f"controls={[(c['name'], c['w'], c['h']) for c in obs['before_any_touch']['controls'] if c['visible']]}; "
          f"after a tap on the chart: selected={obs['after_tap_on_chart']['block_selected']}, grip={obs['after_tap_on_chart'].get('grip')}; "
          f"settings control={obs['has_settings_control']}, caption control={obs['has_caption_control']}")


def desktop(pg, base, req, w, requests):
    nid = note(req, base, "desktop 1280 none")
    open_note(pg, base, nid, True)
    pg.wait_for_selector("[data-widget-embed-body] canvas", timeout=90000)
    pause(pg, 1.5)
    pg.locator("[data-widget-embed-view]").first.hover()
    pause(pg, 1.0)
    state = pg.evaluate("""() => { const b = document.querySelector('[data-embed-block-actions]');
      const rm = [...document.querySelectorAll('[data-widget-embed-view] button')].find((x) => x.getAttribute('aria-label') === 'Remove embed');
      return { in_dom: !!b, shown: !!b && getComputedStyle(b).display !== 'none' && b.getBoundingClientRect().width > 0,
               remove_shown_on_hover: !!rm && rm.getBoundingClientRect().width > 0 } }""")
    asked = [u for u in requests if "EmbedBlockActions" in u]
    w.raw["V1280"] = {**state, "block_actions_chunk_requests": asked}
    w.dump("V1280.json", w.raw["V1280"])
    w.record("V1280_block_actions_not_shown_and_not_loaded_on_desktop",
             state["shown"] is False and not asked and state["remove_shown_on_hover"] is True,
             f"{state}; requests for its file={len(asked)} (control: the hover toolbar's Remove IS shown)")


def run(base, w):
    from playwright.sync_api import sync_playwright
    served, errors = [], []
    with sync_playwright() as pw:
        br = pw.chromium.launch()
        boot = br.new_context()
        req = boot.request
        h._signup_or_login(req, base, h.ADMIN_EMAIL, h.ADMIN_PW, "hubtest")
        req.post(base + "/api/auth/admin/comp-access", data={"email": h.ADMIN_EMAIL, "action": "grant"})
        req.post(base + "/api/auth/admin/verify-email", data={"email": h.ADMIN_EMAIL})
        me = req.get(base + "/api/auth/me").json()
        w.record("W0_paid_admin_wave_flags_off", bool(me.get("paid_equiv")) and me.get("notebook_chart_plan_enabled") is not True,
                 f"paid={me.get('paid_equiv')} chart_plan={me.get('notebook_chart_plan_enabled')}")
        state = boot.storage_state()
        for width, height in ((390, 844), (820, 1180)):
            ctx = br.new_context(storage_state=state, reduced_motion="reduce", viewport={"width": width, "height": height},
                                 has_touch=True, is_mobile=True)
            install_bars_route(ctx, served)
            pg = ctx.new_page()
            pg.on("pageerror", lambda e: errors.append(brief(e, 300)))
            try:
                touch_width(pg, base, req, w, width)
            except Exception as e:  # noqa: BLE001
                w.record(f"V{width}_walk", False, f"raised {brief(e, 400)}")
                w.shot(pg, f"V{width}_error")
            ctx.close()
        ctx = br.new_context(storage_state=state, reduced_motion="reduce", viewport={"width": 1280, "height": 1000})
        install_bars_route(ctx, served)
        pg = ctx.new_page()
        requests = []
        pg.on("request", lambda r: requests.append(r.url))
        try:
            desktop(pg, base, req, w, requests)
        except Exception as e:  # noqa: BLE001
            w.record("V1280_walk", False, f"raised {brief(e, 400)}")
        w.raw["page_errors"] = errors
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
        if k.startswith("RAILWAY_") or (k.startswith("NOTEBOOK_") and k.endswith("_ENABLED")):
            os.environ.pop(k, None)
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
                not_run = scrub(str(e))[:300]
            except Exception as e:  # noqa: BLE001
                import traceback
                failure = f"the walk raised {brief(e, 400)}"
                w.raw["traceback"] = scrub(traceback.format_exc())[-3000:]
            box.wait_checkpoint(h.POST_BOOT, 60)
    finally:
        box.stop()
    integ = h.read_integrity(box.integrity_path(), [h.PRE_BOOT, h.POST_BOOT, h.SHUTDOWN])
    h._keep_integrity_log(integ, out / "integrity.md", own=True)
    print(h.integrity_line(integ, f"stop: {box.stop_how}", not_run=not_run))
    w.record("W10_port_free_after_shutdown", not h.port_busy(args.port), f"listener on {args.port}: {h.port_busy(args.port)}")
    (out / "walk.json").write_text(json.dumps({"tool": "tools/notebook_fin_fe_touch_actions_walk.py", "integrity": integ,
                                               "failure": failure, "not_run": not_run, "rows": w.rows, "raw": w.raw},
                                              indent=1, ensure_ascii=False, default=str), encoding="utf-8")
    if not_run:
        print(f"VERDICT: NOT RUN -- {not_run}")
        return 3
    failed = [r["id"] for r in w.rows if r["verdict"] != "PASS"]
    if failure or failed:
        print(f"VERDICT: FAIL -- {failure or ', '.join(failed)}")
        return 1
    if not integ.get("clean"):
        print(f"VERDICT: INTEGRITY {integ.get('status')}")
        return 2
    print(f"VERDICT: PASS -- {len(w.rows)} rows")
    return 0


if __name__ == "__main__":
    sys.exit(main())
