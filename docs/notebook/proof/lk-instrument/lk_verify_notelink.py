"""Lane LK -- real-browser before/after proof for the `[[` link-suggestion fix
(`dcb7bfcb1`, `allowSpaces: true` in NoteLinkMenu.jsx).

Boots ONE sandbox, provisions a paid walk account (tools/notebook_perf_harness's
own `_provision` recipe), seeds a link TARGET note ("Beta thesis AMD") and a
SOURCE note, then drives the real editor with realistic per-key delays
(Playwright's own `type(..., delay=ms)`, not an instant burst): types
`See [[Beta thesis AMD`, waits for the popup + its result, picks it, confirms
the noteLink lands on screen, waits for the autosave to land, then GETs the
saved note AND the target's backlinks from the server to confirm the link
persisted both directions.

    python docs/notebook/proof/lk-instrument/lk_verify_notelink.py \
        --data-dir 'C:\\...\\lk-data' --port <free> --out-dir docs/notebook/proof/lk-dcb7bfcb1
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[3]
sys.path.insert(0, str(REPO))
sys.path.insert(0, str(REPO / "tools"))
import notebook_perf_harness as H  # noqa: E402

WALK_EMAIL, WALK_PW = "lkwalk@local.dev", "LocalTest2026!"
# Same production-armed gate set the wave-10 proof walk applies (tools/notebook_proof_walk.py
# GATES), no model key -- this proof does not need any of them, but it matches the standing
# convention rather than booting a narrower sandbox than the rest of the program.
FLAGS = {
    "J2_SHARE_LINKS_ENABLED": "1", "NOTEBOOK_PUBLISH_ENABLED": "1", "NOTEBOOK_ONBOARDING_ENABLED": "1",
    "NOTEBOOK_ASK_INSERT_ON": "1", "NOTEBOOK_WRITING_HELP_ENABLED": "1", "COMPASS_NOTES_TOOL_ENABLED": "1",
    "NOTEBOOK_PERSONAL_API_ENABLED": "1", "NOTEBOOK_IMAGE_DOCX_DOCUMENTS_ENABLED": "1",
    "NOTEBOOK_TASK_REMINDERS_ENABLED": "1", "NOTEBOOK_INBOUND_EMAIL_ENABLED": "1", "J2_OCR_ENABLED": "1",
    "ANTHROPIC_API_KEY": "", "OPENAI_API_KEY": "",
}

DUMP_JS = r"""
() => {
  const popup = document.querySelector('[class*="popupWrap"]');
  const listbox = document.querySelector('[role="listbox"]');
  return {
    popupPresent: !!popup,
    listboxPresent: !!listbox,
    listboxText: listbox ? listbox.textContent.slice(0, 300) : null,
    noteLinkCount: document.querySelectorAll('[data-type="noteLink"], .uctNoteLink, a[data-note-link]').length,
  };
}
"""


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--data-dir", required=True)
    ap.add_argument("--port", type=int, required=True)
    ap.add_argument("--out-dir", required=True)
    args = ap.parse_args()

    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    log_lines: list[str] = []

    def log(msg: str) -> None:
        print(msg)
        log_lines.append(msg)

    base = f"http://127.0.0.1:{args.port}"
    import os
    os.environ.update(FLAGS)

    sb = H.Sandbox(args.data_dir, args.port, out_dir / "sandbox.log")
    started = False
    result = {"ok": False}
    try:
        sb.start()
        started = True
        if not sb.wait_healthy(base, 180.0):
            log("REFUSED: sandbox never healthy")
            (out_dir / "debug_log.txt").write_text("\n".join(log_lines), encoding="utf-8", newline="\n")
            return 3
        from playwright.sync_api import sync_playwright
        with sync_playwright() as pw:
            br = pw.chromium.launch()
            admin_ctx = br.new_context()
            ctx = br.new_context(viewport={"width": 1280, "height": 900})
            H._provision(admin_ctx.request, ctx.request, base, member=(WALK_EMAIL, WALK_PW, "lk walk"))

            # Seed the link TARGET (what `[[Beta thesis AMD` must resolve to) and an
            # empty SOURCE note to type the link into -- through the app's own API
            # door, the same shape a member's own note-create makes.
            target_doc = {"type": "doc", "content": [{"type": "paragraph",
                          "content": [{"type": "text", "text": "Thesis body."}]}]}
            rt = ctx.request.post(f"{base}/api/j2/notes",
                                   data={"title": "Beta thesis AMD", "bodyJson": json.dumps(target_doc)})
            assert rt.status in (200, 201), f"seed target failed: {rt.status} {rt.text()[:300]}"
            target_id = rt.json()["note"]["id"]
            log(f"[seed] target note id={target_id} title='Beta thesis AMD'")

            source_doc = {"type": "doc", "content": [{"type": "paragraph", "content": []}]}
            rs = ctx.request.post(f"{base}/api/j2/notes",
                                   data={"title": "LK source note", "bodyJson": json.dumps(source_doc)})
            assert rs.status in (200, 201), f"seed source failed: {rs.status} {rs.text()[:300]}"
            source_id = rs.json()["note"]["id"]
            log(f"[seed] source note id={source_id}")

            pg = ctx.new_page()
            pg.on("console", lambda m: log(f"[console:{m.type}] {m.text}"[:300]))
            pg.on("pageerror", lambda e: log(f"[pageerror] {e}"[:300]))
            pg.on("requestfinished", lambda r: (
                log(f"[net] {r.method} {r.url} -> {r.response().status if r.response() else '?'}")
                if "j2/notes" in r.url else None
            ))
            pg.goto(f"{base}/journal/notebook?note={source_id}")
            H._dismiss_intro(pg)
            pg.wait_for_selector(".ProseMirror", timeout=20000)
            log("[step] ProseMirror ready")
            pg.locator(".ProseMirror").click()

            # Realistic per-key typing -- Playwright's own delay, not an instant burst.
            pg.keyboard.type("See ", delay=90)
            pg.keyboard.type("[[", delay=90)
            pg.screenshot(path=str(out_dir / "lk-1-after-brackets.png"))
            pg.keyboard.type("Beta thesis AMD", delay=90)
            pg.screenshot(path=str(out_dir / "lk-2-after-full-title-typed.png"))
            dump_after_typing = pg.evaluate(DUMP_JS)
            log(f"[dump right after typing the full title] {dump_after_typing}")

            # Let the search debounce (150ms) land.
            pg.wait_for_timeout(500)
            dump_after_search = pg.evaluate(DUMP_JS)
            log(f"[dump after search debounce] {dump_after_search}")
            pg.screenshot(path=str(out_dir / "lk-3-after-search-lands.png"))

            # Let the ~800ms autosave debounce land too, WHILE the popup is still open.
            pg.wait_for_timeout(700)
            dump_after_autosave = pg.evaluate(DUMP_JS)
            log(f"[dump after autosave debounce] {dump_after_autosave}")
            pg.screenshot(path=str(out_dir / "lk-4-after-autosave-lands.png"))

            popup_survived = bool(dump_after_search.get("popupPresent")) and bool(dump_after_autosave.get("popupPresent"))
            log(f"[check] popup survived search+autosave: {popup_survived}")

            # Pick the result.
            option = pg.locator('[role="option"]', has_text="Beta thesis AMD")
            if option.count() == 0:
                option = pg.locator('[role="option"]').first
            option.click(timeout=5000)
            pg.wait_for_timeout(300)
            dump_after_pick = pg.evaluate(DUMP_JS)
            log(f"[dump after picking the result] {dump_after_pick}")
            pg.screenshot(path=str(out_dir / "lk-5-after-pick.png"))

            # Let the insert's own autosave land.
            pg.wait_for_timeout(1200)

            gs = ctx.request.get(f"{base}/api/j2/notes/{source_id}")
            assert gs.status == 200, f"GET source failed: {gs.status}"
            source_body = gs.json()
            body_str = json.dumps(source_body.get("bodyJson") or source_body.get("note", {}).get("bodyJson"))
            has_link_in_body = ("noteLink" in body_str) and (target_id in body_str)
            log(f"[server] source note bodyJson contains noteLink to target: {has_link_in_body}")

            gb = ctx.request.get(f"{base}/api/j2/notes/{target_id}/backlinks")
            assert gb.status == 200, f"GET backlinks failed: {gb.status}"
            backlinks = gb.json()
            backlinks_str = json.dumps(backlinks)
            has_backlink = source_id in backlinks_str
            log(f"[server] target note's backlinks include the source note: {has_backlink}")

            result = {
                "ok": bool(popup_survived and has_link_in_body and has_backlink),
                "source_id": source_id, "target_id": target_id,
                "popup_survived_search_and_autosave": popup_survived,
                "dump_after_typing": dump_after_typing,
                "dump_after_search": dump_after_search,
                "dump_after_autosave": dump_after_autosave,
                "dump_after_pick": dump_after_pick,
                "server_body_has_link": has_link_in_body,
                "server_backlinks_has_source": has_backlink,
                "backlinks_raw": backlinks,
            }
            br.close()
    finally:
        if started:
            sb.stop()

    (out_dir / "debug_log.txt").write_text("\n".join(log_lines), encoding="utf-8", newline="\n")
    (out_dir / "result.json").write_text(json.dumps(result, indent=2), encoding="utf-8", newline="\n")
    log(f"[RESULT] {json.dumps(result.get('ok'))}")
    (out_dir / "debug_log.txt").write_text("\n".join(log_lines), encoding="utf-8", newline="\n")
    return 0 if result.get("ok") else 1


if __name__ == "__main__":
    raise SystemExit(main())
