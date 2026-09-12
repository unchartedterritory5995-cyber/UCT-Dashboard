#!/usr/bin/env python3
"""Q1-F4 — DID THE HERO DOOR WORK AT ALL? Three measurements, one verdict.

⛔⛔ WHY THIS EXISTS. `window_check.py` reported `heroImageUrl = None` after a
hero-door canary. That has two readings and they call for opposite actions:

  (a) PRODUCT — the drain's body PUT clobbered the hero the member just set;
  (b) INSTRUMENT — the door never set a hero, and the canary is reporting its
      own failure as a product defect.

This wave has already spent three deploys reading (b) as (a), so the answer is
MEASURED, never inferred. Three numbers:

  (a) the hero POST's response body, captured VERBATIM — if the server returned
      a heroImageUrl, the door set it;
  (b) heroImageUrl read from the server immediately AFTER the hero POST and
      BEFORE any drain, then again AFTER a drain;
  (c) the drain's PUT payload keys — measured statically and RAILED in
      `outboxDrain.test.js`; printed here for the record.

⛔ IT REUSES `window_check`'s OWN SPAWN PATH. The first version called
Playwright's `launch_persistent_context` and the browser died at launch, twice.
`window_check` spawns REAL Chrome with `--remote-debugging-port` and connects
over CDP — that is what works with a signed-in persistent profile, and having a
second way to start the rig would be a second authority over the one thing the
whole observation window depends on.

It never signs in, never deletes the profile, and cleans up the note it made.
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import pathlib
import sys

REPO = pathlib.Path(__file__).resolve().parents[1]

PNG = bytes.fromhex(
    "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489"
    "0000000d4944415478da63f8ffff3f0005fe02fea735a09b0000000049454e44ae426082"
)


def load_rig():
    spec = importlib.util.spec_from_file_location("window_check", REPO / "tools" / "window_check.py")
    m = importlib.util.module_from_spec(spec)
    sys.modules["window_check"] = m
    spec.loader.exec_module(m)
    return m


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--profile", required=True)
    ap.add_argument("--base", default="https://uctintelligence.com")
    args = ap.parse_args()

    rig = load_rig()
    rig.PROFILE = pathlib.Path(args.profile)
    rig.MARKER = rig.PROFILE.name

    from playwright.sync_api import sync_playwright

    proc, endpoint, ver = rig.spawn_rig()
    if ver is None:
        print("⛔ the rig browser never answered on CDP — nothing measured.")
        return 4
    print(f"rig: {ver.get('Browser')} · {endpoint}")

    note_id = None
    try:
        with sync_playwright() as pw:
            b = pw.chromium.connect_over_cdp(endpoint)
            ctx = b.contexts[0]
            page = ctx.pages[0] if ctx.pages else ctx.new_page()

            # ⛔ NAVIGATE FIRST. The rig opens on `about:blank`, which has no
            # origin — a fetch from there is cross-origin, carries no cookies,
            # and fails with a bare "Failed to fetch" that reads like the site
            # being down rather than the page having nowhere to fetch FROM.
            page.goto(args.base, wait_until="domcontentloaded")
            page.wait_for_timeout(2000)
            # ⛔⛔ A 502 IS NOT A 401, AND THIS TOOL CONFLATED THEM ONCE.
            #
            # ⚰️ 2026-09-12: another session pushed to master mid-probe, `web`
            # restarted, `/api/auth/me` answered 502, and this printed
            # "SIGN-IN REQUIRED — nothing measured." The rig was signed in the
            # whole time. A ~1 min `/api/*` blip is the DOCUMENTED cost of any
            # Tier 1 push, so the instrument must survive one rather than
            # misdiagnose it — and "the deploy was mid-flight" and "the profile
            # is signed out" call for completely different actions.
            me = None
            for attempt in range(6):
                me = page.evaluate(
                    "async (b) => { try { return (await fetch(b + '/api/auth/me',"
                    " {credentials:'include'})).status } catch { return 0 } }", args.base)
                if me == 200 or me == 401:
                    break
                print(f"auth: {me} — transient, waiting for the pod (attempt {attempt + 1}/6)")
                page.wait_for_timeout(20000)
            print(f"auth: {me}")
            if me == 401:
                print("⛔ SIGN-IN REQUIRED — nothing measured.")
                return 2
            if me != 200:
                print(f"⛔ INCONCLUSIVE — the API never came back ({me}). Nothing measured, and this")
                print("   is NOT a sign-out and NOT a product finding. Re-run once the deploy settles.")
                return 6

            note = page.evaluate(
                "async (b) => { const r = await fetch(b + '/api/j2/notes', {method:'POST',"
                " credentials:'include', headers:{'Content-Type':'application/json'},"
                " body: JSON.stringify({title:'HERO DOOR PROBE — delete me'})});"
                " return (await r.json()).note; }", args.base)
            note_id = note["id"]
            print(f"note {note_id}  heroImageUrl(before) = {note.get('heroImageUrl')!r}")

            page.goto(f"{args.base}/journal?j2tab=notebook&note={note_id}", wait_until="domcontentloaded")
            page.wait_for_timeout(7000)

            # ⭐ ENUMERATE THE INPUTS FIRST. The canary's driver took the first
            # `input[type=file]`; if that is the ATTACHMENT input the probe would
            # post to the wrong endpoint and read as a product bug.
            inputs = page.evaluate(
                "() => [...document.querySelectorAll('input[type=file]')].map((el,i) => ({"
                " i, accept: el.accept || null }))")
            print(f"file inputs on the page: {inputs}")
            if not inputs:
                print("⛔ INSTRUMENT: no file input rendered — the hero picker is not on this page.")
                return 3

            # ── (a) THE HERO POST'S RESPONSE, VERBATIM ────────────────────────
            responses: list[dict] = []

            def _on_response(r):
                # ⛔ EVERY note POST, not only `/hero`. "No /hero POST" and "the
                # input I drove posts somewhere else" are different facts, and
                # naming the endpoint it DID hit is what tells the next session
                # whether the picker is absent or simply not the input matched.
                if "/api/j2/notes/" in r.url and r.request.method == "POST":
                    try:
                        responses.append({"url": r.url, "status": r.status, "body": r.text()[:600]})
                    except Exception:  # noqa: BLE001
                        responses.append({"url": r.url, "status": r.status, "body": "<unreadable>"})

            page.on("response", _on_response)

            # ⛔⛔ THE HERO PICKER'S OWN ACCEPT LIST, NOT `*=image`.
            #
            # ⚰️ The note editor renders up to THREE file inputs and two of them
            # accept images: the hero picker
            # (`image/png,image/jpeg,image/gif,image/webp`) and the editor's
            # INLINE image insert (`image/*`, which posts to `/images` — not a
            # door). `[accept*="image"]` matches both and returns whichever the
            # page rendered first, so the probe was driving a different input on
            # different runs and calling the result the hero door's.
            #
            # ⛔ And which inputs exist DEPENDS ON LOAD TIMING — one run saw three,
            # the next saw one. So an absent picker is reported as absent, never
            # substituted for.
            HERO_SEL = 'input[type="file"][data-uct-hero-input]'
            if not page.query_selector(HERO_SEL):
                print(f"\n⛔ INSTRUMENT: the HERO picker's input is not on this page.")
                print(f"   inputs present: {inputs}")
                print("   The rig cannot reach the hero door on a freshly created note — a DRIVER")
                print("   gap (Q1-F5), not a product finding. Nothing about the product measured.")
                return 3
            target = HERO_SEL
            print(f"driving: {target}")
            page.set_input_files(target, {"name": "probe-hero.png", "mimeType": "image/png", "buffer": PNG})
            page.wait_for_timeout(9000)

            print("\n(a) every note POST the driven input produced, verbatim:")
            if not responses:
                # ⛔ THE PRECISE FACT, not a conclusion about why. "No POST at
                # all" and "a POST to the wrong endpoint" are different, and an
                # earlier version printed the second while measuring the first.
                print("    ⛔ THE DRIVEN INPUT PRODUCED NO NOTE POST AT ALL.")
            hero_posts = [r for r in responses if "/hero" in r.get("url", "")]
            if responses and not hero_posts:
                print("    ⛔ none of them is /hero — the input matched is NOT the hero picker.")
            for r in responses:
                print(f"    {r.get('url')}  status {r['status']}  body {r['body'][:300]}")

            # ── (b) THE SERVER, BEFORE ANY DRAIN ─────────────────────────────
            mid = page.evaluate(
                "async ([b,id]) => (await (await fetch(b + '/api/j2/notes/' + id,"
                " {credentials:'include'})).json()).note", [args.base, note_id])
            print(f"\n(b) heroImageUrl AFTER the POST, BEFORE any drain = {mid.get('heroImageUrl')!r}")

            # …then a body PUT, which is exactly what the drain sends.
            page.evaluate(
                "async ([b,id,base]) => { await fetch(b + '/api/j2/notes/' + id, {method:'PUT',"
                " credentials:'include', headers:{'Content-Type':'application/json'},"
                " body: JSON.stringify({title:'HERO DOOR PROBE — delete me',"
                " subtitle:null, bodyJson:{type:'doc',content:[{type:'paragraph',"
                " content:[{type:'text',text:'probe body'}]}]}, baseUpdatedAt: base})}); }",
                [args.base, note_id, mid.get("updatedAt")])
            page.wait_for_timeout(2000)
            after = page.evaluate(
                "async ([b,id]) => (await (await fetch(b + '/api/j2/notes/' + id,"
                " {credentials:'include'})).json()).note", [args.base, note_id])
            print(f"    heroImageUrl AFTER a drain-shaped body PUT   = {after.get('heroImageUrl')!r}")

            print("\n(c) the drain's PUT payload keys (railed in outboxDrain.test.js):")
            print("    title · subtitle · bodyJson · baseUpdatedAt — no heroImageUrl")

            set_it = bool(mid.get("heroImageUrl"))
            survived = bool(after.get("heroImageUrl"))
            print("\n⇒ VERDICT")
            if not set_it:
                print("   INSTRUMENT. The door never set a hero, so the canary was reporting its")
                print("   own failure as a product defect. Nothing to fix in the product.")
                rc = 1
            elif set_it and not survived:
                print("   ⛔⛔ PRODUCT. The hero was set and a body PUT removed it. This is a")
                print("   real clobber and it blocks — report before anything else.")
                rc = 5
            else:
                print("   DOOR WORKS AND THE HERO SURVIVES A BODY PUT. The canary red was the")
                print("   canary's own driver; the product is correct.")
                rc = 0
            return rc
    finally:
        if note_id:
            try:
                with sync_playwright() as pw2:
                    b2 = pw2.chromium.connect_over_cdp(endpoint)
                    p2 = b2.contexts[0].pages[0]
                    p2.evaluate(
                        "async ([b,id]) => { await fetch(b + '/api/j2/notes/' + id,"
                        " {method:'DELETE', credentials:'include'}); }", [args.base, note_id])
                    print(f"cleaned up {note_id}")
            except Exception as e:  # noqa: BLE001
                print(f"⚠️ could not clean up {note_id}: {e}")
        rig.teardown()


if __name__ == "__main__":
    raise SystemExit(main())
