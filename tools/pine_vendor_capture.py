"""R39 — the vendor capture in a SESSION-OWNED browser, signed in by the owner.

⛔⛔ WHY THIS EXISTS, AND IT IS NOT A PREFERENCE. Three runs on 2026-09-18 read
`document.visibilityState === "hidden"` on the operator's own Chrome, with
`outerWidth/outerHeight` at **0 × 0** — the window is not being composited at all
(a locked machine, a disconnected RDP session, a sleeping monitor). Gate v2.1
cannot pass there, and nothing in a session can move it: Windows' foreground lock
refuses `SetForegroundWindow` to a background process, `WScript.Shell.AppActivate`
returns `False`, and the P/Invoke route is refused by the harness. Bringing a
window "to the front" cannot help when nobody is looking at the desktop.

⭐ SO THE SESSION BRINGS ITS OWN WINDOW. A Playwright context owns its viewport
and its visibility — Chromium under automation runs with occlusion backgrounding
disabled — so the gate passes **honestly** rather than being waived, exactly as it
does in `pine_member_pane_capture.py`, whose `_gate` this file imports rather than
copies. One gate, one authority.

⛔⛔ AND THE CREDENTIAL NEVER COMES NEAR THIS PROCESS. The browser opens on the
layout and STOPS. The owner signs in **in that window, at the keyboard, once**.
This tool does not read, type, store or log a credential, does not touch the
owner's own Chrome (pid 57780) and does not borrow its profile. The persistent
profile it creates is the owner's to delete, its path is printed, and it is
refused if it would land inside a git worktree.

⭐ SIGN-IN IS MEASURED, NOT ASSUMED, AND THE PRODUCT ANSWERS IT. A background
request for the private layout, sharing the browser context's cookie jar (it
reads no cookie), returns **403 "Chart Not Found"** to a stranger — measured
2026-09-18 — and the owner can open their own layout, so the same request
flipping to a plain 200 IS the sign-in. It touches no tab, so it is polled while
the owner types. Both answers are PRESENCES — a 403 carrying TradingView's own
"Chart Not Found", or a 200 that is still the layout — so a first reading of 200
proceeds (the persistent profile doing its job, no keyboard), and in the wait
loop the same measurement flipping 403 -> 200 is the evidence. Anything else — a
bot-wall 403 without the marker, a redirect off the layout, a soft 404, a 5xx,
no answer — is INCONCLUSIVE, never a pass and never a prompt.

⚰️ The first version decided from header markup, and on the owner's first real
run the layout tab landed on the HOME page, whose signed-out control is a
"Get started" SPAN inside an A. The own-text probe saw neither marker and the
tool exited INCONCLUSIVE before it ever asked for the sign-in. The DOM reading
is still printed, as context; it no longer decides.

⛔ PHASES, BECAUSE A WRITE ON SOMEBODY ELSE'S ACCOUNT IS NOT WRITTEN BLIND.

    recon    (default)  sign-in acquisition + READ-ONLY readings: the layout, the
                        symbol and resolution, the study count, the corrected
                        binding gate (own text only), the Monaco `placement`.
                        Nothing is clicked, nothing is changed.
    capture              the write path — set SPY 1D, add Clouds through the
                        Monaco handle per `capture-procedure.md` S1-S5, shoot
                        both tables at both tiers, remove Clouds, restore the
                        symbol. Only ever run against readings `recon` produced.

The persistent profile is the point: the owner signs in ONCE, and every later
phase reuses that session with no keyboard step at all.

Usage:
    python tools/pine_vendor_capture.py --self-check
    python tools/pine_vendor_capture.py                 # recon; prompts sign-in
    python tools/pine_vendor_capture.py --phase capture # once recon has read the DOM

Exit codes:
    0  the phase completed
    1  a MEASURED failure (a gate refused, a reading contradicted the procedure)
    2  INCONCLUSIVE — no sign-in inside the wait, the probe could see neither
       marker, the page never loaded. Never a pass, never reported as a product
       failure.
"""
from __future__ import annotations

import argparse
import json
import os
import pathlib
import sys
import time
from urllib.parse import urlparse

REPO =pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / "tools"))

# ⭐ ONE GATE AUTHORITY. `_gate` is imported, never re-implemented: two copies of
# a gate is two gates, and the day one is relaxed nobody notices the other.
from pine_member_pane_capture import _gate, sha16, TIERS  # noqa: E402

LAYOUT = "https://www.tradingview.com/chart/01f1AcIj/"
FIXTURE = REPO / "tests" / "fixtures" / "member" / "uncharted-clouds.pine"

#: ⛔ OUTSIDE EVERY WORKTREE, and refused rather than trusted — the same rule
#: `boot_rig.py` learned when its sandbox defaulted inside the repo.
DEFAULT_PROFILE = pathlib.Path(
    os.environ.get("LOCALAPPDATA") or os.environ.get("TEMP") or "/tmp"
) / "uct-capture-profile" / "tradingview"


def _worktree_root(path: pathlib.Path):
    """Ask git, never pattern-match — imported behaviour, re-used shape."""
    import subprocess
    probe = path
    while not probe.exists() and probe != probe.parent:
        probe = probe.parent
    try:
        out = subprocess.run(["git", "-C", str(probe), "rev-parse", "--show-toplevel"],
                             capture_output=True, text=True, timeout=15)
    except (OSError, subprocess.SubprocessError):
        return None
    if out.returncode != 0:
        return None
    top = out.stdout.strip()
    return pathlib.Path(top) if top else None


def resolve_profile(raw: str | None) -> pathlib.Path:
    p = pathlib.Path(raw).expanduser() if raw else DEFAULT_PROFILE
    p = pathlib.Path(os.path.abspath(str(p)))
    root = _worktree_root(p)
    if root is not None:
        raise SystemExit(
            "REFUSED: the browser profile would sit inside the git worktree at\n"
            f"  {root}\n  resolved profile: {p}\n"
            "A signed-in browser profile inside a checkout is both a dirty tree and a\n"
            "credential store in a repository. Pass --profile with a path outside it."
        )
    return p


#: The private layout's answer to a STRANGER, measured 2026-09-18 through the
#: browser context's own request API: HTTP 403 carrying this title. The status
#: alone is not the verdict — Cloudflare's bot wall is also a 403 — the marker is
#: what makes it TradingView answering "not yours".
STRANGER_MARKER = "Chart Not Found"


def classify_layout_access(status, body, final_url) -> str:
    """'signed_out' | 'signed_in' | 'inconclusive', from the layout's HTTP answer.

    Only the measured shape (403 + marker) and its direct opposite (200, still on
    the layout, no marker) decide. ⛔ A redirect that lands anywhere but the
    layout is NOT the layout opening — a stranger bounced to the home page is a
    plain 200 with no marker — so the final URL has to still be the layout.
    Everything else is reported, never guessed."""
    if status is None or not body or not final_url:
        return "inconclusive"
    on_layout = urlparse(final_url).path.startswith(urlparse(LAYOUT).path)
    if status == 403 and on_layout and STRANGER_MARKER in body:
        return "signed_out"
    if status == 200 and on_layout and STRANGER_MARKER not in body:
        return "signed_in"
    return "inconclusive"


def layout_access(page) -> tuple[str, str]:
    """Ask the server whether this browser may open the layout — from the page's
    own context, so it carries the session the owner signs into, and WITHOUT
    touching the tab, so it can be polled while the owner types. It sends the
    context's cookies and reads none."""
    try:
        resp = page.context.request.get(LAYOUT)
        body = resp.text()
    except Exception as exc:  # no answer is not an answer
        return "inconclusive", f"request failed: {type(exc).__name__}: {str(exc)[:160]}"
    return (classify_layout_access(resp.status, body, resp.url),
            f"HTTP {resp.status} at {resp.url}")


# ⚰️ NO LONGER DECIDES ANYTHING — printed as context beside the server's answer.
# It read OWN text on button/a only, and on 2026-09-18 the layout tab landed on
# the home page, whose signed-out control is a "Get started" SPAN inside an A:
# neither marker, exit 2, and the owner was never asked to sign in.
AUTH_JS = r"""() => {
  const ownText = (el) => [...el.childNodes].filter((n) => n.nodeType === 3)
    .map((n) => n.textContent.trim()).join(' ').trim();
  const vis = (el) => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const all = [...document.querySelectorAll('button, a, [role="button"]')];
  const signedOut = all.filter((el) => vis(el)
    && /^(sign in|log in|get started)$/i.test(ownText(el)))
    .map((el) => ownText(el));
  // TradingView marks its header controls with data-name; several spellings have
  // shipped, so every hit is REPORTED rather than one being assumed.
  const names = ['header-user-menu-toggle', 'base-user-menu', 'user-menu',
                 'header-toolbar-user-menu'];
  const signedIn = names.filter((n) => {
    const el = document.querySelector(`[data-name="${n}"]`);
    return el && vis(el);
  });
  // ⚰️ `aria-label` "Open user menu" IS NOT A SIGNED-IN MARKER, and this probe
  // reported one on its first real run. TradingView renders that control in BOTH
  // states, so on a signed-OUT page the tool saw `signedOut: ["sign in"]` AND
  // `avatars: ["Open user menu"]` at the same moment and — checking signedIn
  // first — announced "already signed in". A marker that cannot distinguish the
  // two states is not a marker; it is kept here only as REPORTED context.
  const ambiguous = all.filter((el) => vis(el)
    && /user menu|account|profile/i.test(el.getAttribute('aria-label') || ''))
    .map((el) => el.getAttribute('aria-label'));
  return { signedOut, signedIn, ambiguous, title: document.title };
}"""


#: ⭐ THE CORRECTED BINDING GATE, verbatim from `capture-procedure.md`: OWN TEXT
#: only. The old `title || textContent` form matched a 34x34 disabled icon with
#: no text and reported BOUND for a control nobody could click.
BINDING_JS = r"""() => {
  const ownText = (el) => [...el.childNodes].filter((n) => n.nodeType === 3)
    .map((n) => n.textContent.trim()).join(' ').trim();
  const vis = (el) => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && !el.disabled;
  };
  const all = [...document.querySelectorAll('button, a, [role="button"], div, span')];
  const add = all.filter((el) => vis(el) && ownText(el) === 'Add to chart');
  const upd = all.filter((el) => vis(el) && ownText(el) === 'Update on chart');
  // ⛔ COUNT THE SPANS. A zero-height duplicate is the trap SESSION-STATE:2209
  // records: a second node carrying the same text, sized 0, reads as a match to
  // anything that does not measure the box.
  return {
    addToChart: add.length,
    updateOnChart: upd.length,
    gate: add.length === 1 && upd.length === 0,
  };
}"""


#: Read-only. The chart model is on `window`; which handle it is has moved
#: between builds, so every candidate is TRIED and the winner REPORTED rather
#: than a name being typed into this file as if it were stable.
CHART_JS = r"""() => {
  const out = { handle: null, symbol: null, resolution: null, studies: null,
                studyNames: [], placement: null, error: null };
  const cands = ['tvWidget', 'TradingViewApi', 'widget', 'chartWidgetCollection'];
  for (const name of cands) {
    const w = window[name];
    if (!w) continue;
    try {
      const chart = typeof w.activeChart === 'function' ? w.activeChart() : null;
      if (!chart) continue;
      out.handle = name;
      out.symbol = typeof chart.symbol === 'function' ? chart.symbol() : null;
      out.resolution = typeof chart.resolution === 'function' ? chart.resolution() : null;
      if (typeof chart.getAllStudies === 'function') {
        const s = chart.getAllStudies();
        out.studies = s.length;
        out.studyNames = s.map((x) => x.name);
      }
      break;
    } catch (e) { out.error = String(e); }
  }
  try {
    const models = (window.monaco && window.monaco.editor)
      ? window.monaco.editor.getModels() : [];
    out.placement = models.length
      ? models.map((m) => String(m.uri)).find((u) => u.includes('.pine')) || null
      : null;
  } catch (e) { /* the editor may simply not be docked */ }
  return out;
}"""


def _to_layout(page) -> None:
    """Put the tab on the layout for recon — only ever after the server has said
    this browser may open it, so it never interrupts the owner mid-sign-in."""
    page.goto(LAYOUT, wait_until="domcontentloaded")
    page.wait_for_timeout(9000)


def acquire(page, wait_s: int) -> int:
    """Get a signed-in session, or say plainly that we did not."""
    # The page's own reading is printed as CONTEXT and decides nothing — see the
    # ⚰️ note above AUTH_JS for the run it stranded.
    print(f"[vendor] page (context only): {json.dumps(page.evaluate(AUTH_JS))}")

    # ⛔⛔ THE SERVER DECIDES, AND ONLY IN ITS TWO READABLE SHAPES. A first 200
    # proceeds — that is the persistent profile working, not an inference from
    # silence. Anything that is neither shape is INCONCLUSIVE, and the owner is
    # not asked to type into a browser whose state this tool cannot read.
    verdict, detail = layout_access(page)
    print(f"[vendor] layout access: {verdict} ({detail})")
    if verdict == "signed_in":
        print("[vendor] already signed in — the persistent profile carried the session.")
        _to_layout(page)
        return 0
    if verdict != "signed_out":
        print("[vendor] INCONCLUSIVE: the layout answered neither as a stranger (403 "
              f"'{STRANGER_MARKER}') nor as its owner (200). Not reporting a state "
              "it cannot measure.")
        return 2

    print("")
    print("=" * 70)
    print("  >>  SIGN IN TO TRADINGVIEW IN THIS WINDOW.")
    print("     It is the browser this tool just opened — not your own Chrome.")
    print("     Nothing you type is read, stored or logged by this session.")
    print("     The page may show 'Chart Not Found' or TradingView's home page —")
    print("     either is fine: use its Sign in / Get started control, or the")
    print("     person icon at the top right.")
    print("")
    print("     >> USE THE 'Email' OPTION, NOT 'Continue with Google'.")
    print("        Measured 2026-09-18: Google answers 'Couldn't sign you in —")
    print("        this browser or app may not be secure' and refuses. That is")
    print("        Google objecting to the bundled Chrome-for-Testing build, not")
    print("        a fault in this tool. TradingView's own email sign-in is not")
    print("        subject to it. If the account has no password because it was")
    print("        created through Google, set one on tradingview.com first, or")
    print("        re-run this tool with --channel chrome (see its docstring).")
    span = f"{wait_s // 60} minutes" if wait_s >= 60 else f"{wait_s} seconds"
    print(f"     Waiting up to {span}; the profile is kept either way.")
    print("=" * 70)
    print("", flush=True)

    deadline = time.time() + wait_s
    last_beat = 0.0
    while time.time() < deadline:
        verdict, detail = layout_access(page)
        # The same measurement that just said "stranger" flipping to "owner" is
        # the sign-in. An unreadable answer mid-wait is reported, not fatal — the
        # owner may be half-way through a 2FA step.
        if verdict == "signed_in":
            print(f"[vendor] signed in — the layout now opens for this browser ({detail}).")
            _to_layout(page)
            return 0
        now = time.time()
        if now - last_beat > 60:
            last_beat = now
            print(f"[vendor] still waiting ({int(deadline - now)}s left; last answer "
                  f"{verdict}, {detail})…", flush=True)
        page.wait_for_timeout(5000)

    print("[vendor] INCONCLUSIVE: no sign-in inside the wait. The profile is kept, "
          "so the next run resumes at this exact point with no re-sign-in.")
    return 2


def recon(page) -> int:
    _gate(page, "recon readings")
    chart = page.evaluate(CHART_JS)
    binding = page.evaluate(BINDING_JS)
    print(f"[vendor] chart:   {json.dumps(chart)}")
    print(f"[vendor] binding: {json.dumps(binding)}")

    if chart["handle"] is None:
        print("[vendor] INCONCLUSIVE: no chart handle answered on `window`. The write "
              "phase needs one; recording the candidates tried rather than guessing.")
        return 2
    if chart["studies"] is None:
        print("[vendor] INCONCLUSIVE: the handle answered but getAllStudies() did not.")
        return 2
    if chart["studies"] != 0:
        print(f"[vendor] MEASURED: the layout carries {chart['studies']} studies "
              f"{chart['studyNames']} — R37's rig is supposed to read 0. Not a "
              f"capture failure; a state to restore before one.")
        return 1
    print("[vendor] recon OK — layout empty, gate readings recorded above.")
    return 0


def main() -> int:
    # ⚰️ A cp1252 CONSOLE KILLS A RUN ON ITS FIRST NON-ASCII BYTE, and this file
    # earned that the hard way: the sign-in banner carried one glyph and the tool
    # died with UnicodeEncodeError at the exact moment it was about to ask the
    # owner for the one thing it needs. `tools/flag_ledger_audit.py` was
    # unrunnable for a month for the same reason, decoding the other direction.
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:  # a stream that cannot be reconfigured is not a reason to stop
        pass
    ap = argparse.ArgumentParser()
    ap.add_argument("--phase", choices=["recon", "capture"], default="recon")
    ap.add_argument("--profile", default=None)
    # ⭐ LAUNCH THE REAL INSTALLED CHROME INSTEAD OF THE BUNDLED BUILD.
    # ⚰️ Measured 2026-09-18: "Continue with Google" in the bundled Chrome for
    # Testing is answered with *"Couldn't sign you in — this browser or app may
    # not be secure"*. Google is objecting to that build.
    # ⛔⛔ AND THE LINE THIS STOPS AT IS DELIBERATE. `--channel chrome` runs the
    # ordinary Chrome already installed on the machine — a configuration choice,
    # and a better one anyway (real build, real fonts). It does NOT drop
    # `--enable-automation`, forge a user agent, or patch `navigator.webdriver`.
    # Suppressing the automation signal was written, then removed: that half is
    # specifically about not being DETECTED, and what it would get past is a
    # check guarding credential entry. ⭐ IF GOOGLE STILL REFUSES, THAT IS ITS
    # ANSWER AND IT STANDS — the supported route is TradingView's own Email
    # sign-in, which no anti-automation check applies to.
    ap.add_argument("--channel", default=None,
                    help="chrome | msedge — use the installed browser instead of "
                         "the bundled Chromium (Google refuses the bundled build)")
    ap.add_argument("--wait", type=int, default=1800, help="seconds to wait for sign-in")
    ap.add_argument("--self-check", action="store_true")
    args = ap.parse_args()

    profile = resolve_profile(args.profile)
    profile.mkdir(parents=True, exist_ok=True)
    print(f"[vendor] profile: {profile}  (yours to delete; never your own Chrome's)")

    from playwright.sync_api import sync_playwright

    if args.self_check:
        # ⛔ A GATE NOBODY HAS SEEN FIRE IS NOT A GATE.
        with sync_playwright() as p:
            ctx = p.chromium.launch_persistent_context(
                str(profile), headless=True, viewport={"width": 1440, "height": 900})
            page = ctx.new_page()
            page.goto("about:blank")
            page.evaluate("() => Object.defineProperty(document, 'visibilityState',"
                          " {get: () => 'hidden', configurable: true})")
            try:
                _gate(page, "self-check")
            except SystemExit as exc:
                print(f"[vendor] SELF-CHECK OK — the gate fired: {exc}")
                ctx.close()
                return 0
            print("[vendor] SELF-CHECK FAILED — the gate did not fire")
            ctx.close()
            return 1

    raw = FIXTURE.read_bytes()
    print(f"[vendor] fixture {FIXTURE.name}: {len(raw)} bytes, sha256 {sha16(raw)}...")

    with sync_playwright() as p:
        launch = dict(
            headless=False,
            viewport={"width": TIERS[-1][1], "height": TIERS[-1][2]},
            args=["--window-position=40,40"],
        )
        if args.channel:
            launch["channel"] = args.channel
            print(f"[vendor] launching the installed '{args.channel}' build")
        ctx = p.chromium.launch_persistent_context(str(profile), **launch)
        page = ctx.pages[0] if ctx.pages else ctx.new_page()
        page.goto(LAYOUT, wait_until="domcontentloaded")
        page.wait_for_timeout(9000)

        code = acquire(page, args.wait)
        if code != 0:
            ctx.close()
            return code

        page.wait_for_timeout(4000)
        code = recon(page)
        if code != 0 or args.phase == "recon":
            print("[vendor] recon complete. The write phase (--phase capture) is driven "
                  "from these readings, never written blind.")
            ctx.close()
            return code

        print("[vendor] capture phase is not implemented against measured DOM yet — "
              "run recon first and record its readings.")
        ctx.close()
        return 2


if __name__ == "__main__":
    sys.exit(main())
