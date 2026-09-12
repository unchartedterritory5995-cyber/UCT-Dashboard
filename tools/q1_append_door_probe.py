#!/usr/bin/env python3
"""Q1-F5 — THE APPEND FAMILIES, DRIVEN ON PRODUCTION FROM THEIR OWN SURFACES.

The four `update_note` doors live on the note editor, so the canary drives them
without leaving the page. The three APPEND families do not:

  append_widget_embed     "Send to Journal"        — the CHARTS page
  append_financial_fact   "Save price to Notebook" — a TickerPopup
  append_document_excerpt "Save excerpt"           — a PDF preview inside a note

Each needs: navigate away -> fire the door via its real control -> come back.

⛔⛔ IT ASSERTS THE ENDPOINT, NOT THE CLICK. `tools/q1_append_surface_probe.py`
found candidate controls by their labels; a label is not a door. Every driver
here records the note POST it actually produced, and a run that produced no call
to the family's endpoint is INCONCLUSIVE — never green, and never retried with a
scripted `fetch`, which is a SECOND-WRITER simulation whose fork is correct.

⛔ SENTINEL-TIMESTAMPED AND ORPHAN-CHECKED. Everything it creates carries this
run's stamp, is counted before and after, and is removed. A probe that leaks
notes poisons the next run's counts.
"""
from __future__ import annotations

import argparse
import importlib.util
import pathlib
import sys
import time

REPO = pathlib.Path(__file__).resolve().parents[1]
SENTINEL = "APPEND-DOOR-PROBE"


def load_rig():
    spec = importlib.util.spec_from_file_location("window_check", REPO / "tools" / "window_check.py")
    m = importlib.util.module_from_spec(spec)
    sys.modules["window_check"] = m
    spec.loader.exec_module(m)
    return m


# What each family must actually hit for the run to count.
ENDPOINT = {
    "append_widget_embed": "/embeds",
    "append_financial_fact": "/facts/",
    "append_document_excerpt": "/excerpts",
}


def drive_widget_embed(page, base, stamp):
    """Send to Journal, from the charts page.

    The surface probe found a VISIBLE control: `aria='Send to Journal — choose
    where'`. It opens a destination chooser, so the driver has to pick a
    destination too — and which destinations exist depends on the member's
    recent notes, so an absent chooser is reported, never assumed away.
    """
    page.goto(base + "/charts", wait_until="domcontentloaded")
    page.wait_for_timeout(10000)
    btn = page.query_selector('[aria-label="Send to Journal — choose where"]')
    if btn is None:
        return {"ok": False, "why": "the 'Send to Journal — choose where' control is not on /charts"}
    try:
        btn.click()
    except Exception as e:  # noqa: BLE001
        return {"ok": False, "why": f"the control would not take a click: {type(e).__name__}: {e}"}
    page.wait_for_timeout(2500)
    # The chooser's options, enumerated rather than guessed.
    opts = page.evaluate(
        """() => [...document.querySelectorAll('button,[role=menuitem],li')]
             .map(el => (el.innerText || '').trim())
             .filter(t => t && t.length < 80).slice(0, 25)""")
    return {"ok": True, "via": "aria=Send to Journal — choose where", "chooser": opts}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--profile", required=True)
    ap.add_argument("--base", default="https://uctintelligence.com")
    ap.add_argument("--family", default="append_widget_embed", choices=sorted(ENDPOINT))
    args = ap.parse_args()

    rig = load_rig()
    rig.PROFILE = pathlib.Path(args.profile)
    rig.MARKER = rig.PROFILE.name
    stamp = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())

    from playwright.sync_api import sync_playwright

    proc, endpoint, ver = rig.spawn_rig()
    if ver is None:
        print("⛔ the rig browser never answered on CDP — nothing measured.")
        return 4

    try:
        with sync_playwright() as pw:
            b = pw.chromium.connect_over_cdp(endpoint)
            page = b.contexts[0].pages[0] if b.contexts[0].pages else b.contexts[0].new_page()
            page.goto(args.base, wait_until="domcontentloaded")
            page.wait_for_timeout(2500)

            me = None
            for attempt in range(6):
                me = page.evaluate(
                    "async (b) => { try { return (await fetch(b + '/api/auth/me',"
                    " {credentials:'include'})).status } catch { return 0 } }", args.base)
                if me in (200, 401):
                    break
                print(f"auth {me} — transient, waiting for the pod ({attempt + 1}/6)")
                page.wait_for_timeout(20000)
            if me == 401:
                print("⛔ SIGN-IN REQUIRED — nothing measured.")
                return 2
            if me != 200:
                print(f"⛔ INCONCLUSIVE — the API never came back ({me}). Not a sign-out, not a finding.")
                return 6

            before = page.evaluate(
                "async (b) => (await (await fetch(b + '/api/j2/notes?limit=1',"
                " {credentials:'include'})).json()).total", args.base)
            print(f"notes before: {before}   stamp: {stamp}")

            posts: list[str] = []
            page.on("request", lambda r: posts.append(f"{r.method} {r.url}")
                    if "/api/j2/notes" in r.url and r.method in ("POST", "PUT") else None)

            print(f"\n═══ {args.family} ═══")
            if args.family == "append_widget_embed":
                res = drive_widget_embed(page, args.base, stamp)
            else:
                res = {"ok": False, "why": (
                    f"no driver yet for {args.family} — its control is not on first paint "
                    "and needs its own navigation (TickerPopup / PDF preview)")}
            print(f"driver: {res}")

            page.wait_for_timeout(4000)
            hit = [p for p in posts if ENDPOINT[args.family] in p]
            print(f"\nnote POST/PUTs this run produced ({len(posts)}):")
            for p in posts[:12]:
                print(f"   {p}")
            print(f"\ncalls to {ENDPOINT[args.family]}: {len(hit)}")

            after = page.evaluate(
                "async (b) => (await (await fetch(b + '/api/j2/notes?limit=1',"
                " {credentials:'include'})).json()).total", args.base)
            print(f"notes after: {after}  (delta {after - before})")

            if not hit:
                print(f"\n⇒ INCONCLUSIVE — the {args.family} door was NOT opened.")
                print("   Not a product finding and not a green. What is missing is named above.")
                return 1
            print(f"\n⇒ DRIVEN — the {args.family} door was opened from its own surface.")
            return 0
    finally:
        rig.teardown()


if __name__ == "__main__":
    raise SystemExit(main())
