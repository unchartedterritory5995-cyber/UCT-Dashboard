#!/usr/bin/env python3
"""Did the HERO door work AT ALL? — isolated from the drain, on purpose.

⛔⛔ WHY THIS EXISTS. `window_check.py` reported `heroImageUrl = None` after a
hero-door canary. That has two readings and they call for opposite actions:

  (a) PRODUCT — the drain's body PUT clobbered the hero the member just set;
  (b) INSTRUMENT — the door never set a hero, and the canary is reporting its
      own failure as a product defect.

This wave has already spent three deploys on reading (b) as (a). So this probe
removes the drain entirely: create a note, fire the hero door through the
member's own file input, read the note back. Nothing offline, nothing queued.

  heroImageUrl set  -> the door works; the canary red is about the DRAIN.
  heroImageUrl null -> the door never fired; the canary red is INSTRUMENT.

It never signs in and never deletes the profile — same contract as the canary.
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

PNG = bytes.fromhex(
    "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489"
    "0000000d4944415478da63f8ffff3f0005fe02fea735a09b0000000049454e44ae426082"
)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--profile", required=True)
    ap.add_argument("--base", default="https://uctintelligence.com")
    args = ap.parse_args()

    from playwright.sync_api import sync_playwright

    with sync_playwright() as pw:
        ctx = pw.chromium.launch_persistent_context(args.profile, headless=False)
        page = ctx.pages[0] if ctx.pages else ctx.new_page()
        try:
            me = page.evaluate(
                "async (b) => { const r = await fetch(b + '/api/auth/me', {credentials:'include'});"
                " return r.status; }", args.base)
            print(f"auth: {me}")
            if me != 200:
                print("⛔ SIGN-IN REQUIRED — nothing measured.")
                return 2

            note = page.evaluate(
                "async (b) => { const r = await fetch(b + '/api/j2/notes', {method:'POST',"
                " credentials:'include', headers:{'Content-Type':'application/json'},"
                " body: JSON.stringify({title:'HERO DOOR PROBE — delete me'})});"
                " return (await r.json()).note; }", args.base)
            note_id = note["id"]
            print(f"note: {note_id}  updatedAt(before) = {note.get('updatedAt')!r}  "
                  f"heroImageUrl(before) = {note.get('heroImageUrl')!r}")

            page.goto(f"{args.base}/journal?j2tab=notebook&note={note_id}", wait_until="domcontentloaded")
            page.wait_for_timeout(6000)

            # ⭐ ENUMERATE THE INPUTS FIRST. The canary's driver took the first
            # `input[type=file]` on the page; if that is the ATTACHMENT input the
            # probe would post to the wrong endpoint and read as a product bug.
            inputs = page.evaluate(
                "() => [...document.querySelectorAll('input[type=file]')].map((el,i) => ({"
                " i, accept: el.accept || null, name: el.name || null,"
                " nearby: (el.closest('[class]')||{}).className || null }))")
            print("file inputs on the page:")
            for it in inputs:
                print(f"   [{it['i']}] accept={it['accept']!r} nearby={str(it['nearby'])[:60]!r}")
            if not inputs:
                print("⛔ INSTRUMENT: no file input rendered — the hero picker is not on this page.")
                return 3

            posts: list[dict] = []
            page.on("request", lambda r: posts.append({"m": r.method, "u": r.url})
                    if "/api/j2/notes/" in r.url and r.method in ("POST", "PUT", "DELETE") else None)

            sel = 'input[type="file"][accept*="image"]'
            target = sel if page.query_selector(sel) else 'input[type="file"]'
            print(f"driving: {target}")
            page.set_input_files(target, {"name": "probe-hero.png", "mimeType": "image/png", "buffer": PNG})
            page.wait_for_timeout(8000)

            print("requests this probe made to the note:")
            for p in posts:
                print(f"   {p['m']} {p['u']}")

            after = page.evaluate(
                "async ([b,id]) => { const r = await fetch(b + '/api/j2/notes/' + id, {credentials:'include'});"
                " return (await r.json()).note; }", [args.base, note_id])
            print(f"\nheroImageUrl(after)  = {after.get('heroImageUrl')!r}")
            print(f"updatedAt(after)     = {after.get('updatedAt')!r}")
            moved = after.get("updatedAt") != note.get("updatedAt")
            print(f"revision moved       = {moved}")

            verdict = "DOOR WORKS — the canary red is about the DRAIN" if after.get("heroImageUrl") \
                else "INSTRUMENT — the door never set a hero; the canary was reporting its own failure"
            print(f"\n⇒ {verdict}")

            page.evaluate(
                "async ([b,id]) => { await fetch(b + '/api/j2/notes/' + id, {method:'DELETE', credentials:'include'}); }",
                [args.base, note_id])
            print(f"cleaned up {note_id}")
            return 0 if after.get("heroImageUrl") else 1
        finally:
            ctx.close()


if __name__ == "__main__":
    raise SystemExit(main())
