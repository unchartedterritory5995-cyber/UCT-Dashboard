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

⭐ SIGN-IN IS MEASURED, NOT ASSUMED, AND THE PROBE PROVES ITSELF FIRST. The tool
requires that it can SEE the signed-OUT marker before it will believe the
signed-IN one — an absence is only evidence if the instrument could have seen a
presence. Neither marker visible is INCONCLUSIVE, never a pass.

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

REPO = pathlib.Path(__file__).resolve().parents[1]
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


# ⛔⛔ THE PROBE PROVES ITSELF BEFORE IT BELIEVES AN ABSENCE. `signedOut` is the
# control: if the tool cannot see the signed-out marker on a signed-out page it
# has no business reporting a signed-in one, and "neither" is INCONCLUSIVE.
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


def acquire(page, wait_s: int) -> int:
    """Get a signed-in session, or say plainly that we did not."""
    # ⛔ "NEITHER MARKER" IS OFTEN "NOT SETTLED YET", AND THE TWO MUST NOT BE
    # COLLAPSED. Measured 2026-09-18: one run read `signedOut: ["sign in"]` and
    # the next, on the same profile, read neither — the header simply had not
    # rendered at the 9-second mark, and the layout URL redirects a stranger to
    # the home page. So the probe is given a bounded chance to become
    # determinate before "neither" is believed, and only a persistent neither is
    # INCONCLUSIVE.
    first = None
    for _ in range(12):
        first = page.evaluate(AUTH_JS)
        if first["signedOut"] or first["signedIn"]:
            break
        page.wait_for_timeout(2500)
    print(f"[vendor] auth probe: {json.dumps(first)}")

    # ⛔⛔ SIGNED-OUT WINS A TIE, AND THE TIE IS REAL. Measured 2026-09-18: a
    # signed-out page shows the "Sign in" control AND an "Open user menu"
    # control simultaneously. Testing the positive first turned a signed-out
    # session into a confident "already signed in" — the instrument reporting a
    # property of itself as a property of what it measured. A private layout
    # also renders as "Chart Not Found" to a stranger, which is the corroborating
    # reading and the reason that title is carried here.
    if first["signedOut"]:
        pass
    elif first["signedIn"]:
        print("[vendor] already signed in — the persistent profile carried the session.")
        return 0
    elif not first["signedOut"]:
        # ⛔ Neither marker. The probe cannot see a presence, so its absence says
        # nothing. This is the one outcome that must never read as a pass.
        print("[vendor] INCONCLUSIVE: the probe saw neither a signed-out nor a "
              "signed-in marker. It is not reporting a state it cannot measure.")
        return 2

    print("")
    print("=" * 70)
    print("  >>  SIGN IN TO TRADINGVIEW IN THIS WINDOW.")
    print("     It is the browser this tool just opened — not your own Chrome.")
    print("     Nothing you type is read, stored or logged by this session.")
    span = f"{wait_s // 60} minutes" if wait_s >= 60 else f"{wait_s} seconds"
    print(f"     Waiting up to {span}; the profile is kept either way.")
    print("=" * 70)
    print("", flush=True)

    deadline = time.time() + wait_s
    last_beat = 0.0
    while time.time() < deadline:
        state = page.evaluate(AUTH_JS)
        # Same discipline as the first read: the signed-OUT control disappearing
        # is the necessary half, and a `data-name` user-menu control is the
        # sufficient one. The ambiguous aria-label is never allowed to decide.
        if not state["signedOut"] and state["signedIn"]:
            print(f"[vendor] signed in — evidence: {json.dumps(state['signedIn'])}, "
                  f"title now {state['title']!r}")
            return 0
        now = time.time()
        if now - last_beat > 60:
            last_beat = now
            print(f"[vendor] still waiting ({int(deadline - now)}s left)…", flush=True)
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
        ctx = p.chromium.launch_persistent_context(
            str(profile), headless=False,
            viewport={"width": TIERS[-1][1], "height": TIERS[-1][2]},
            args=["--window-position=40,40"])
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
