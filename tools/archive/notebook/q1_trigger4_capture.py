"""Capture what trigger 4 is firing on — URL, method, status, and who issued it.

⛔⛔ WHY THIS EXISTS. Three consecutive observation rows read, in full:
    "2 console/page error(s): console.error: Failed to load resource: the server
     responded with a status of 401 ()"
No URL. No method. Nothing to chase. Trigger 4 — the gate's console-error trigger —
was firing on evidence nobody could act on without spending a rig window, and a
trigger that fires on unactionable evidence is a trigger that gets waived.

The sampler now records URL/method/status going forward. This tool answers the
question for the rows already written, by reproducing the load and watching the
wire.

⭐ IT DOES NOT DECIDE THE CLASSIFICATION. It produces evidence; INSTRUMENT /
PRODUCT / FOREIGN is a judgement made against deploy history, and a tool that
guessed it would be a second authority over that call.

Usage:
    python tools/q1_trigger4_capture.py [--profile <rig profile>] [--out <file>]
    python tools/q1_trigger4_capture.py --self-check     # proves it can report a failure
"""
from __future__ import annotations

import argparse
import json
import pathlib
import sys
import datetime

REPO = pathlib.Path(__file__).resolve().parents[1]


def load_rig():
    """The ONE authority on the rig profile and how to reach the browser."""
    sys.path.insert(0, str(REPO / "tools"))
    import window_check as wc  # noqa: PLC0415
    return wc


def capture(rig, profile, base, log=print):
    """Open the Notebook on the rig and record every console error and HTTP failure."""
    from playwright.sync_api import sync_playwright  # noqa: PLC0415

    console: list[dict] = []
    http: list[dict] = []

    rig.use_profile(rig.resolve_profile(profile))
    if not rig.PROFILE.exists():
        return {"ok": False,
                "why": ("that profile directory does not exist. A missing profile is NOT an "
                        "empty one to fill in — a fresh profile is a SIGNED-OUT profile.")}

    proc, endpoint, ver = rig.spawn_rig()
    if ver is None:
        return {"ok": False, "why": "the rig browser never answered on CDP — nothing measured"}
    try:
        with sync_playwright() as pw:
            b = pw.chromium.connect_over_cdp(endpoint)
            ctx = b.contexts[0]
            page = ctx.pages[0] if ctx.pages else ctx.new_page()

            # ⛔ ATTACHED BEFORE the navigation, or the very errors this exists to
            # catch happen while the bundle evaluates and are missed.
            def on_console(m):
                if m.type != "error":
                    return
                loc = m.location or {}
                console.append({"text": m.text,
                                "issued_by": str(loc.get("url") or ""),
                                "line": loc.get("lineNumber")})

            def on_response(r):
                try:
                    if r.status >= 400:
                        http.append({"method": r.request.method, "url": r.url,
                                     "status": r.status,
                                     "resource_type": r.request.resource_type})
                except Exception:  # noqa: BLE001
                    pass

            def on_requestfailed(r):
                try:
                    http.append({"method": r.method, "url": r.url, "status": "FAILED",
                                 "failure": str(r.failure),
                                 "resource_type": r.resource_type})
                except Exception:  # noqa: BLE001
                    pass

            page.on("console", on_console)
            page.on("response", on_response)
            page.on("requestfailed", on_requestfailed)

            page.goto(base + "/journal/notebook", wait_until="domcontentloaded")
            page.wait_for_timeout(12000)

            # ⛔ Who are we? A 401 against a SIGNED-OUT rig is a different fact
            # from a 401 against a signed-in one, and the row cannot tell them
            # apart. Ask, and record the answer beside the failures.
            who = page.evaluate("""async () => {
              const r = await fetch('/api/auth/me', {credentials:'include'});
              const ct = r.headers.get('content-type') || '';
              return {status: r.status, json: ct.includes('application/json')};
            }""")
            b.close()
    finally:
        try:
            rig.teardown(proc)
        except Exception:  # noqa: BLE001
            log("      (teardown reported a problem — check the profile lock)")

    return {"ok": True, "auth_me": who, "console": console, "http": http}


def render(res) -> str:
    """A report a human can act on without re-running anything."""
    now = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    out = [f"# Trigger-4 capture — {now}", ""]
    if not res.get("ok"):
        out += ["⛔ **NOTHING WAS MEASURED.** " + str(res.get("why")), "",
                "An empty result is a failed invocation until proven otherwise, so this is "
                "recorded as a failed capture and NOT as a clean rig.", ""]
        return "\n".join(out)

    me = res.get("auth_me") or {}
    signed_in = me.get("status") == 200 and me.get("json")
    out += [f"**Rig auth state:** `/api/auth/me` → {me.get('status')} "
            f"({'signed in' if signed_in else 'NOT signed in'})",
            "",
            "⭐ This matters before anything below is read: a 401 against a signed-OUT rig "
            "is an instrument fact; a 401 against a signed-IN rig is not.",
            ""]

    http = res.get("http") or []
    console = res.get("console") or []
    out += [f"## HTTP failures ({len(http)})", ""]
    if not http:
        out += ["_none — and an empty list here is only meaningful because the console list "
                "below is also empty; if the console shows errors and this shows none, the "
                "capture is at fault, not the product._", ""]
    else:
        out += ["| method | status | type | url |", "|---|---|---|---|"]
        seen = set()
        for h in http:
            key = (h.get("method"), h.get("status"), h.get("url"))
            if key in seen:
                continue
            seen.add(key)
            out.append(f"| {h.get('method')} | {h.get('status')} | "
                       f"{h.get('resource_type','')} | `{h.get('url','')[:160]}` |")
        out.append("")

    out += [f"## Console errors ({len(console)})", ""]
    for c in console:
        out.append(f"- `{c.get('text','')[:200]}`  \n  issued by `{c.get('issued_by','')[:160]}`"
                   f":{c.get('line')}")
    out.append("")
    out += ["## Classification", "",
            "⛔ **Not decided by this tool.** It produces evidence; INSTRUMENT / PRODUCT / "
            "FOREIGN is a judgement made against the deploy history for the window in which "
            "the anomaly began, and a tool that guessed it would be a second authority over "
            "that call.", ""]
    return "\n".join(out)


def self_check() -> int:
    """⛔ A tool nobody has seen fail is not a tool. Prove the failure path renders."""
    bad = {"ok": False, "why": "the rig browser never answered on CDP — nothing measured"}
    text = render(bad)
    assert "NOTHING WAS MEASURED" in text, "a failed capture must say so"
    assert "failed capture" in text, "a failed capture must not read as a clean rig"
    good = render({"ok": True, "auth_me": {"status": 200, "json": True},
                   "console": [{"text": "Failed to load resource: 401", "issued_by": "x", "line": 0}],
                   "http": [{"method": "GET", "url": "https://x/api/y", "status": 401,
                             "resource_type": "fetch"}]})
    assert "| GET | 401 |" in good, "a real failure must reach the table"
    assert "NOTHING WAS MEASURED" not in good, "a good capture must not claim failure"
    print("self-check PASS — the failure path and the success path render differently")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--profile", default=None)
    ap.add_argument("--base", default="https://uctintelligence.com")
    ap.add_argument("--out", default=str(REPO / "docs" / "notebook" / "trigger4-capture.md"))
    ap.add_argument("--self-check", action="store_true")
    args = ap.parse_args()

    if args.self_check:
        return self_check()

    rig = load_rig()
    res = capture(rig, args.profile, args.base)
    text = render(res)
    pathlib.Path(args.out).write_text(text, encoding="utf-8")
    print(text)
    print(f"\nwritten → {args.out}")
    return 0 if res.get("ok") else 4


if __name__ == "__main__":
    raise SystemExit(main())
