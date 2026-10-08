"""Finish program, lane AI-FE -- the four frontend fixes in a real browser, with NO model key.

Every model answer is a FIXTURE served by the browser's own network layer (Playwright routes
`/api/j2/ask/stream` and `/api/j2/ai-actions/plan`). Nothing is sent to a vendor. The page code,
the stylesheets and the editor are the built app. A separate lane re-walks with real keys.

At 390 px (touch) on port 8133:
  K3  an Ask answer with **bold** and *italic*: the panel shows no asterisk, a <strong> and an
      <em>; inserted into the note, the block carries the editor's bold and italic.
  K7  the panel's run-together chips [1][2]: each box is at least 44 x 44, the boxes do not
      overlap, and the top element at each chip's centre is that chip. In a note: a toggle's
      title line is at least 44 tall beside its 44 x 44 fold button, and every in-note chip is
      the top element at its own centre (its width is recorded, not judged: it is a line of prose).
  K4  an AI plan with no changes: "Nothing to change", the explanation as text, no Apply button.
  K2  the weekly review draft from Research Home asks with the member's account id.

Same sandbox rules as the other fin-fe walks. Raw observations are written before any row is
judged. A step the walker could not reach is printed as OBSERVED, never as a pass.

    python tools/notebook_fin_ai_fe_walk.py --data-dir 'C:\\data-fin-fe\\ai1' --port 8133 `
        --out 'docs\\notebook\\evidence\\fin-ai\\fe-walk-<sha>'
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / "tools"))
import notebook_perf_harness as h  # noqa: E402
from notebook_fin_fe_walk import para, pause  # noqa: E402
from notebook_fin_fe2_walk import api_note, press  # noqa: E402
from notebook_w13h2_walk import Walk  # noqa: E402
from notebook_w13x_walk import FLAGS  # noqa: E402
from secret_scrub import brief, scrub  # noqa: E402

PW = "LocalTest2026!"
ANSWER = "**Planned entry (breakout plan):** above 412 [1][2]. It was *not* chased."
WHY = 'The tag "security" doesn\'t exist in the workspace\'s allowed tag list, so no changes are proposed.'

BOXES = """(sel) => [...document.querySelectorAll(sel)].map((el) => { const r = el.getBoundingClientRect();
  const cx = r.left + r.width / 2, cy = r.top + r.height / 2; const top = document.elementFromPoint(cx, cy);
  return { text: el.textContent.trim().slice(0, 40), label: el.getAttribute('aria-label'), tag: el.tagName,
           x: Math.round(r.left * 10) / 10, y: Math.round(r.top * 10) / 10, w: Math.round(r.width * 10) / 10, h: Math.round(r.height * 10) / 10,
           own_centre: !!top && (top === el || el.contains(top)), top_tag: top ? top.tagName : null } })"""


def seen(loc):
    return loc.locator("visible=true").first


def overlap(a, b):
    return not (a["x"] + a["w"] <= b["x"] or b["x"] + b["w"] <= a["x"] or a["y"] + a["h"] <= b["y"] or b["y"] + b["h"] <= a["y"])


def load(pg, base, path):
    pg.goto(base + path, wait_until="domcontentloaded")
    h._dismiss_intro(pg)
    pause(pg, 3.0)


def step(w, pg, tag, fn):
    try:
        fn()
    except h.SetupFailed:
        raise
    except Exception as e:  # noqa: BLE001
        print(f"  OBSERVED {tag}: not reached ({brief(e, 300)})")
        w.raw.setdefault("not_reached", {})[tag] = {"error": brief(e, 400), "stage": w.raw.get("stage"), "url": pg.url[-90:]}
        w.shot(pg, f"{tag}_not_reached")
        try:
            pg.keyboard.press("Escape")
        except Exception:  # noqa: BLE001
            pass


def source(n, note_id, label):
    return {"n": n, "type": "note", "label": label, "citation": "exact", "snippet": "entry above 412",
            "navigation": {"kind": "note", "note_id": note_id}, "location": {"from": 1, "to": 20, "fingerprint": "abc:12"},
            "payload": {}, "stance": None, "truncated": False}


def chip(n, note_id, label, claim):
    return {"type": "askCitation", "attrs": {"n": n, "label": label, "nav": {"kind": "note", "note_id": note_id},
                                             "citation": "exact", "claim": claim}}


def walk(pg, base, req, w):
    plan = api_note(req, base, "CRWD breakout plan", [para("Entry above 412 on volume. Stop under 398.")])
    review = api_note(req, base, "CRWD review", [para("Stop raised to breakeven after the report.")])
    claim = "Entry above 412 and stop moved up."
    voice = api_note(req, base, "Voice note fixture", [
        para("Summary of the recording."),
        {"type": "toggle", "attrs": {"open": True}, "content": [
            {"type": "toggleSummary", "content": [{"type": "text", "text": "Full transcript · 31 words"}]},
            {"type": "toggleContent", "content": [para("NVIDIA held its 10-week line and I added a small position.")]}]},
        {"type": "askInsert", "attrs": {"insertedAt": "2026-10-07T12:00:00.000Z", "scope": "notebook", "question": "entry?"}, "content": [
            {"type": "paragraph", "content": [
                {"type": "text", "text": "Entry above 412 "}, chip(1, plan["id"], "CRWD breakout plan", claim),
                chip(2, review["id"], "CRWD review", claim), chip(3, plan["id"], "CRWD breakout plan", claim),
                {"type": "text", "text": "and stop moved up."}]}]},
    ])
    w.raw["seed"] = {"plan": plan["id"], "review": review["id"], "voice": voice["id"]}

    sse = "".join(f"data: {json.dumps(ev)}\n\n" for ev in [
        {"type": "sources", "scope": "note", "scopeLabel": "This note", "coverageNotice": None, "independentSources": 2, "noAnswer": False,
         "sources": [source(1, plan["id"], "CRWD breakout plan"), source(2, review["id"], "CRWD review")]},
        {"type": "delta", "text": ANSWER},
        {"type": "final", "answer": ANSWER, "cited": [1, 2], "invalidCitations": []}])
    asked = []

    def ask_route(route):
        asked.append(route.request.post_data)
        route.fulfill(status=200, headers={"content-type": "text/event-stream"}, body=sse)
    pg.route("**/api/j2/ask/stream", ask_route)

    def k3_k7_panel():
        obs = {}
        w.raw["stage"] = "open the note and the Ask panel"
        load(pg, base, f"/journal/notebook?note={plan['id']}")
        pg.wait_for_selector(".ProseMirror", timeout=60000)
        press(pg, seen(pg.locator("[data-ask-toggle]")), True)
        box = seen(pg.get_by_role("textbox", name=re.compile(r"question", re.I)))
        box.fill("What was my planned entry?")
        w.raw["stage"] = "ask (the answer is a fixture)"
        press(pg, seen(pg.get_by_role("button", name="Ask", exact=True)), True)
        ans = pg.locator('[data-testid="ask-answer"]')
        ans.first.wait_for(state="visible", timeout=20000)
        pause(pg, 1.5)
        obs["asked_bodies"] = len(asked)
        obs["answer_text"] = ans.first.inner_text()
        obs["strong"] = ans.first.locator("strong").all_inner_texts()
        obs["em"] = ans.first.locator("em").all_inner_texts()
        obs["chips"] = pg.evaluate(BOXES, '[data-testid="ask-answer"] button[data-citation]')
        w.shot(pg, "k3_k7_ask_panel")
        w.dump("k3_k7_ask_panel.json", obs)
        w.record("V390_K3_panel_shows_emphasis_not_asterisks",
                 "*" not in obs["answer_text"] and obs["strong"] == ["Planned entry (breakout plan):"] and obs["em"] == ["not"],
                 f"text={obs['answer_text']!r}; strong={obs['strong']}; em={obs['em']}")
        chips = obs["chips"]
        w.record("V390_K7_panel_chips_44_by_44_and_own_their_centre",
                 len(chips) == 2 and all(c["w"] >= 44 and c["h"] >= 44 and c["own_centre"] for c in chips) and not overlap(chips[0], chips[1]),
                 "; ".join(f"{c['text']} {c['w']}x{c['h']} at {c['x']},{c['y']} own centre={c['own_centre']}" for c in chips)
                 + f"; boxes overlap={overlap(chips[0], chips[1]) if len(chips) == 2 else 'n/a'}")
        w.raw["stage"] = "insert into this note"
        ins = pg.get_by_role("button", name="Insert into this note")
        obs["insert_offered"] = ins.count()
        if ins.count():
            press(pg, seen(ins), True)
            pause(pg, 2.5)
            pg.keyboard.press("Escape")
            pause(pg, 1.0)
            blk = pg.locator('.ProseMirror [data-type="askInsert"], .ProseMirror .node-askInsert')
            obs["block_count"] = blk.count()
            obs["block_text"] = blk.first.inner_text() if blk.count() else None
            obs["block_strong"] = blk.first.locator("strong").all_inner_texts() if blk.count() else None
            obs["block_em"] = blk.first.locator("em").all_inner_texts() if blk.count() else None
            obs["block_chips"] = pg.evaluate(BOXES, ".ProseMirror .node-askCitation button, .ProseMirror .node-askCitation [data-citation]")
            w.shot(pg, "k3_inserted_block")
            w.dump("k3_k7_ask_panel.json", obs)
            body = obs["block_text"] or ""
            w.record("V390_K3_inserted_block_has_the_editors_bold_and_italic",
                     bool(blk.count()) and "**" not in body and "*not*" not in body
                     and obs["block_strong"] == ["Planned entry (breakout plan):"] and obs["block_em"] == ["not"],
                     f"block text={body[:160]!r}; strong={obs['block_strong']}; em={obs['block_em']}; "
                     f"edited chips={[c['text'] for c in obs['block_chips'] if 'edited' in c['text']]}")
        else:
            print("  OBSERVED V390_K3_insert: the Insert door was not offered (flag or host)")
        w.raw["k3_k7_panel"] = obs
    step(w, pg, "K3_K7_panel", k3_k7_panel)

    def k7_note():
        obs = {}
        w.raw["stage"] = "open the voice note fixture"
        load(pg, base, f"/journal/notebook?note={voice['id']}")
        pg.wait_for_selector(".ProseMirror summary", timeout=60000)
        pause(pg, 1.5)
        seen(pg.locator(".ProseMirror summary")).scroll_into_view_if_needed()
        pause(pg, 0.5)
        obs["summary"] = pg.evaluate(BOXES, ".ProseMirror summary")
        obs["chevron"] = pg.evaluate(BOXES, ".ProseMirror .uctToggleChevron")
        w.shot(pg, "k7_voice_note_toggle")
        # the chips sit below the fold: bring them to the middle of the screen before asking
        # the page what is on top at each centre (elementFromPoint answers null off screen)
        pg.evaluate("() => document.querySelector('.ProseMirror .node-askCitation button').scrollIntoView({ block: 'center' })")
        pause(pg, 0.8)
        obs["note_chips"] = pg.evaluate(BOXES, ".ProseMirror .node-askCitation button")
        obs["sideways_scroll"] = pg.evaluate("() => document.documentElement.scrollWidth - document.documentElement.clientWidth")
        w.shot(pg, "k7_voice_note")
        w.dump("k7_voice_note.json", obs)
        s = obs["summary"][0] if obs["summary"] else {}
        c = obs["chevron"][0] if obs["chevron"] else {}
        w.record("V390_K7_toggle_title_line_is_44_tall",
                 bool(s) and s["h"] >= 44 and bool(c) and c["w"] >= 44 and c["h"] >= 44,
                 f"summary {s.get('text')!r} {s.get('w')}x{s.get('h')}; fold button {c.get('w')}x{c.get('h')}")
        chips = obs["note_chips"]
        w.record("V390_K7_in_note_chips_keep_their_own_centre",
                 len(chips) == 3 and all(k["own_centre"] for k in chips) and all(k["h"] < 44 for k in chips) and obs["sideways_scroll"] <= 0,
                 "; ".join(f"{k['text']} {k['w']}x{k['h']} own centre={k['own_centre']}" for k in chips)
                 + f"; sideways scroll={obs['sideways_scroll']}")
        w.raw["k7_note"] = obs
    step(w, pg, "K7_note", k7_note)

    def k4():
        obs = {}
        empty = {"id": "set0empty000", "request": 'Tag my two CRWD notes with "security".', "status": "planned", "summary": WHY,
                 "capped": None, "skippedCount": 0, "skipped": [], "changes": []}
        pg.route("**/api/j2/ai-actions/plan", lambda route: route.fulfill(status=200, content_type="application/json", body=json.dumps(empty)))
        w.raw["stage"] = "open Research Home and the AI actions box"
        load(pg, base, "/journal/notebook")
        press(pg, seen(pg.get_by_role("button", name="Ask Notebook to do something")), True)
        seen(pg.get_by_role("textbox", name="What should Notebook do?")).fill(empty["request"])
        press(pg, seen(pg.get_by_role("button", name="Plan changes")), True)
        w.raw["stage"] = "wait for the empty plan"
        pg.get_by_role("heading", name="Nothing to change").first.wait_for(state="visible", timeout=20000)
        pause(pg, 0.8)
        region = pg.get_by_role("region", name="Ask Notebook to do something")
        obs["text"] = region.first.inner_text()[:600]
        obs["apply_buttons"] = pg.get_by_role("button", name=re.compile(r"^Apply")).count()
        obs["checkboxes"] = region.first.get_by_role("checkbox").count()
        obs["change_button"] = pg.evaluate(BOXES, "section[aria-label='Ask Notebook to do something'] button.btn-primary")
        w.shot(pg, "k4_empty_plan")
        w.dump("k4_empty_plan.json", obs)
        w.record("V390_K4_empty_plan_is_a_message_with_no_apply",
                 WHY in obs["text"] and obs["apply_buttons"] == 0 and obs["checkboxes"] == 0 and "0 proposed" not in obs["text"]
                 and "Uncheck" not in obs["text"] and "Nothing was written." in obs["text"],
                 f"Apply buttons={obs['apply_buttons']}; checkboxes={obs['checkboxes']}; text={obs['text'][:260]!r}")
        w.raw["k4"] = obs
    step(w, pg, "K4_empty_plan", k4)

    def k2():
        obs = {}
        accounts = (req.get(base + "/api/j2/accounts").json() or {}).get("accounts") or []
        obs["account_ids"] = [a.get("id") for a in accounts]
        seen_urls = []
        pg.on("request", lambda r: seen_urls.append(r.url) if "/api/j2/review-drafts/" in r.url else None)
        w.raw["stage"] = "Research Home, weekly review"
        load(pg, base, "/journal/notebook")
        btn = pg.locator('[data-tour="review-drafts-weekly"]')
        btn.first.wait_for(state="visible", timeout=20000)
        obs["selected_in_browser"] = pg.evaluate("() => localStorage.getItem('uct.j2.selectedAccountId')")
        press(pg, seen(btn), True)
        for _ in range(40):
            if seen_urls:
                break
            pause(pg, 0.5)
        pause(pg, 2.0)
        obs["urls"] = [u.split("/api/j2/")[-1] for u in seen_urls]
        w.dump("k2_weekly_request.json", obs)
        got = re.search(r"accountId=([^&]+)", seen_urls[0]) if seen_urls else None
        w.record("V390_K2_weekly_draft_request_names_the_account",
                 bool(got) and got.group(1) in obs["account_ids"],
                 f"request={obs['urls'][:1]}; the member's accounts={obs['account_ids']}")
        w.raw["k2"] = obs
    step(w, pg, "K2_weekly_request", k2)


def run(base, w):
    from playwright.sync_api import sync_playwright
    errors = []
    with sync_playwright() as pw:
        br = pw.chromium.launch()
        admin = br.new_context()
        ctx = br.new_context(reduced_motion="reduce", viewport={"width": 390, "height": 844}, has_touch=True, is_mobile=True)
        req = ctx.request
        h._provision(admin.request, req, base, member=("fin-ai-fe@local.dev", PW, "finaife"))
        pg = ctx.new_page()
        pg.on("pageerror", lambda e: errors.append(brief(e, 240)))
        walk(pg, base, req, w)
        w.raw["page_errors"] = errors
        w.record("V390_no_page_errors", not errors, f"page errors: {errors[:3]}")
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
        if k.startswith("RAILWAY_") or (k.startswith("NOTEBOOK_") and (k.endswith("_ENABLED") or k.endswith("_ON"))) or k == "AWARENESS_NOTE_RESURFACE_ENABLED":
            os.environ.pop(k, None)
    os.environ.update({f: "1" for f in FLAGS + ["NOTEBOOK_ASK_INSERT_ON"]})
    # No model key reaches this run: every vendor key is blanked, and every model answer is a fixture.
    os.environ.update({"NOTEBOOK_ONBOARDING_ENABLED": "1", "FMP_API_KEY": "", "FINNHUB_API_KEY": "", "ALPHAVANTAGE_API_KEY": "",
                       "MASSIVE_API_KEY": "", "ANTHROPIC_API_KEY": "", "OPENAI_API_KEY": "", "PERPLEXITY_API_KEY": ""})
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
                failure = f"the walk raised {brief(e, 400)}"
                w.raw["traceback"] = scrub(traceback.format_exc())[-3000:]
            box.wait_checkpoint(h.POST_BOOT, 60)
    finally:
        box.stop()
    integ = h.read_integrity(box.integrity_path(), [h.PRE_BOOT, h.POST_BOOT, h.SHUTDOWN])
    h._keep_integrity_log(integ, out / "integrity.md", own=True)
    print(h.integrity_line(integ, f"stop: {box.stop_how}", not_run=not_run))
    w.record("W10_port_free_after_shutdown", not h.port_busy(args.port), f"listener on {args.port}: {h.port_busy(args.port)}")
    (out / "walk.json").write_text(json.dumps({"tool": "tools/notebook_fin_ai_fe_walk.py", "integrity": integ, "failure": failure,
                                               "not_run": not_run, "rows": w.rows, "raw": w.raw}, indent=1, ensure_ascii=False, default=str), encoding="utf-8")
    if not_run:
        print(f"VERDICT: NOT RUN -- {not_run}")
        return 3
    failed = [r["id"] for r in w.rows if r["verdict"] != "PASS"]
    missed = sorted((w.raw.get("not_reached") or {}).keys())
    if failure or failed:
        print(f"VERDICT: FAIL -- {failure or ', '.join(failed)}" + (f"; not reached: {missed}" if missed else ""))
        return 1
    print(f"VERDICT: {'PASS' if not missed else 'PARTIAL'} -- {len(w.rows)} rows" + (f"; not reached: {missed}" if missed else ""))
    return 0 if not missed else 1


if __name__ == "__main__":
    sys.exit(main())
