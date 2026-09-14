#!/usr/bin/env python3
"""WHOSE OPT-INS ARE THEY? — attribute the sampler's member count by identity.

⛔⛔ THE K WINDOW'S CENTRAL CLAIM IS "ORGANIC MEMBERS EXPOSED = 0", and on
2026-09-13 the sampler's 15:00 ET row reported **members 7**. Before that number
reaches the Sunday gate it has to be attributed, because the two possible
readings could not be further apart:

  · seven real people opened the Notebook  → the K window finally has exposure
  · seven runs of OUR OWN smoke account    → the instrument counting itself

⭐ IT READS THE ACCOUNT'S OWN ACTIVITY, NOT THE ADMIN FEED. `/api/auth/export-data`
is gated only by `get_current_user`, so the smoke identity can read its own rows
without the rig, without admin, and without waiting for a clear rig window. If
the seven events are in the smoke account's OWN log, they are ours and the
question is closed.

⛔ IT DOES NOT OPEN THE NOTEBOOK. Opening it would emit another
`notebook_offline_opt_in` and inflate the very count under investigation — an
instrument that changes what it measures. Sign in, read, leave.

⛔ Credentials come from the environment and are never printed.
"""
from __future__ import annotations

import argparse
import os
import sys

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except (AttributeError, ValueError):
    pass

PROD = "https://uctintelligence.com"
ACTION = "notebook_offline_opt_in"

READ_JS = """async (action) => {
  const r = await fetch('/api/auth/export-data', {credentials:'include'});
  if (!r.ok) return {err: 'HTTP ' + r.status};
  const ct = r.headers.get('content-type') || '';
  if (!ct.includes('application/json')) return {err: 'not JSON (deploy blip?)'};
  const j = await r.json();
  const rows = j.activity || [];
  const mine = rows.filter(x => String(x.action || '').includes(action));
  return {
    email: (j.user && j.user.email) || j.email || null,
    activityRows: rows.length,
    // ⛔ A FULL PAGE OF ROWS IS A CAP, NOT A COUNT. Say so, or "we found N" reads
    // as "there are N" and the oldest events are silently outside the window.
    capped: rows.length >= 100,
    optIns: mine.length,
    stamps: mine.slice(0, 12).map(x => x.created_at),
  };
}"""


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--identity", default="member-smoke")
    args = ap.parse_args()

    email = os.environ.get("MEMBER_SMOKE_EMAIL")
    pwd = os.environ.get("MEMBER_SMOKE_PASSWORD")
    if not email or not pwd:
        print("⛔ MEMBER_SMOKE_EMAIL / MEMBER_SMOKE_PASSWORD are not in this process's "
              "environment. Launch from a shell that has them.")
        return 3

    from playwright.sync_api import sync_playwright

    with sync_playwright() as pw:
        b = pw.chromium.launch(headless=True)
        ctx = b.new_context()
        page = ctx.new_page()
        try:
            page.goto(PROD + "/login", wait_until="domcontentloaded")
            page.wait_for_timeout(3500)
            boxes = page.query_selector_all("input")
            ebox = pbox = None
            for x in boxes:
                t = (x.get_attribute("type") or "").lower()
                if t == "password":
                    pbox = pbox or x
                elif t in ("email", "text"):
                    ebox = ebox or x
            if not ebox or not pbox:
                print(f"⛔ INCONCLUSIVE — no login form ({len(boxes)} inputs)")
                return 6
            ebox.click(); page.keyboard.type(email)
            pbox.click(); page.keyboard.type(pwd)
            page.keyboard.press("Enter")
            page.wait_for_timeout(6000)

            out = page.evaluate(READ_JS, ACTION)
            if not isinstance(out, dict) or out.get("err"):
                print(f"⛔ INCONCLUSIVE — could not read the account's own activity: {out}")
                return 6

            who = str(out.get("email") or "")
            masked = (who.split("@")[0][:6] + "…@" + who.split("@")[-1]) if "@" in who else "?"
            print(f"identity            : {masked}")
            print(f"activity rows read  : {out.get('activityRows')}"
                  + ("  ⚠️ CAPPED — older rows are outside this page" if out.get("capped") else ""))
            print(f"`{ACTION}` events   : **{out.get('optIns')}**")
            for s in out.get("stamps") or []:
                print(f"    {s}")
            return 0
        finally:
            ctx.close()
            b.close()


if __name__ == "__main__":
    raise SystemExit(main())
