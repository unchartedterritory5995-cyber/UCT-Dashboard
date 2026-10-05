"""Wave 14, lane W14-Q1 -- click budgets for the NON-tour onboarding flows.

A sibling of tools/notebook_w13q_clicks.py (WAVE-14-PLAN.md 3.4: "reuse means adding entries to this
file, or a sibling file following the same pattern"). It IMPORTS that tool's meter -- `Meter`,
`Capped`, `Inconclusive`, `open_start`, `focus_editor_body`, `wait_note_open`, `use_skip_link` -- so
mouse clicks, keystrokes, REAL Tab presses (capped at 600) and taps are counted exactly the way every
wave-13 row was. What it adds is the one thing these flows need and the wave-13 flows did not: every
(flow, mode, width) run starts on a BRAND-NEW member (no notes, no preferences), because "a new member"
is the precondition of every flow here and a reused account stops being new after its first run.

Flows and budgets. WAVE-14-PLAN.md 6.1 NAMES the flows but sets no numbers, so each budget below is
the wave-13 row with the same shape (WAVE-13-PLAN.md section 6, typed once in w13q's BUDGETS), stated
here BEFORE the first measurement and never moved to fit one:

  O1 new member to first note (cursor in body)  = Q1 "new blank note, cursor in body"   2 / 3 / 2
  O2 open the sample notebook                   = Q1's shape (clear the way, one door) 2 / 3 / 2
  O3 dismiss the get-started checklist          = Q5 "today's daily note" (one door)     1 / 2 / 1
  O4 replay a walkthrough from Help             = Q3 "open a note by title" (find, open) 2 / 4 / 3
  O5 accept a tour offer                        = Q5 (one door)                           1 / 2 / 1
  O6 decline a tour offer                       = Q5 (one door)                           1 / 2 / 1

Setup that is not the flow (the once-per-tab intro, the "Meet Compass" card, and for O3/O5/O6 the
base tour and checklist that stand in front of the surface under test) is done UNCOUNTED and recorded
in the row's `setup` list. A flow's verdict is PASS/OVER only once its OUTCOME is verified by reading
the member's own data back; otherwise INCONCLUSIVE with the reason -- never PASS.

Flags: the sandbox gets NOTEBOOK_ONBOARDING_ENABLED, NOTEBOOK_GETTING_STARTED_ENABLED and two tour
capability gates (writing help, template gallery) -- a plain LIST armed with os.environ.update, the
ledger convention.

Usage (PowerShell; ports 8720-8724; an EMPTY data dir):
    python tools/notebook_w14q_clicks.py --data-dir '<scratch>\\w14q-clicks' --port 8720 `
        --out 'docs\\notebook\\evidence\\wave14-q1\\clicks'

Exit: 0 = ran (budgets do not set the exit code -- a miss is a finding); 3 = refused / not run.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import time
import traceback
from datetime import datetime, timezone
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / "tools"))
import notebook_perf_harness as h  # noqa: E402
import notebook_w13q_clicks as w13q  # noqa: E402  -- the meter; imports no api.*
from notebook_w13q_clicks import Capped, Inconclusive, Meter  # noqa: E402

PORTS = range(8720, 8725)
WIDE = {"width": 1200, "height": 900}
PHONE = {"width": 390, "height": 844}

FLAGS = [
    "NOTEBOOK_ONBOARDING_ENABLED",
    "NOTEBOOK_GETTING_STARTED_ENABLED",
    "NOTEBOOK_WRITING_HELP_ENABLED",
    "NOTEBOOK_TEMPLATE_GALLERY_ENABLED",
]

BUDGETS = [
    ("O1", "new member to first note, cursor in body", 2, 3, 2, "Q1"),
    ("O2", "open the sample notebook", 2, 3, 2, "Q1 shape"),
    ("O3", "dismiss the get-started checklist", 1, 2, 1, "Q5"),
    ("O4", "replay a walkthrough from Help", 2, 4, 3, "Q3"),
    ("O5", "accept a tour offer (a tour opens)", 1, 2, 1, "Q5"),
    ("O6", "decline a tour offer", 1, 2, 1, "Q5"),
    # W14-keys (docs/notebook/wave14-keys.md): O4 through the app's own nav instead of the
    # command palette -- the path the held NavBar decision governs. Keys only; same budget.
    ("O4N", "replay a walkthrough from Help, via the nav", 2, 4, 3, "Q3"),
]
BUDGET = {b[0]: {"flow": b[1], "mouse": b[2], "keys": b[3], "taps": b[4], "derived_from": b[5]} for b in BUDGETS}

TOUR = "[role=dialog][aria-modal=true]"


# ── helpers ─────────────────────────────────────────────────────────────────────────────

def prefs(cx, base: str) -> dict:
    r = cx.request.get(base + "/api/auth/preferences")
    body = r.json() if r.status == 200 else {}
    return body.get("preferences", body) if isinstance(body, dict) else {}


def pref_json(cx, base: str, key: str):
    raw = prefs(cx, base).get(key)
    try:
        return json.loads(raw) if isinstance(raw, str) else raw
    except ValueError:
        return raw


def wait_until(fn, timeout_s: float = 15.0, every: float = 0.4):
    end = time.time() + timeout_s
    last = None
    while time.time() < end:
        last = fn()
        if last:
            return last
        time.sleep(every)
    return last


def first_run(pg, base: str) -> None:
    """Load the Notebook as a new member arrives (setup, uncounted)."""
    w13q.open_start(pg, base, "/journal/notebook")
    pg.get_by_role("heading", name="Welcome to your Notebook", level=2).first.wait_for(timeout=30000)


def tour_open(pg) -> bool:
    return pg.locator(TOUR).count() > 0 and pg.locator(TOUR).first.is_visible()


def clear_tour_counted(m: Meter, setup: list) -> None:
    """The base tour auto-starts for a new member and is a MODAL (aria-modal, focus trapped). Count
    what a member must spend to get past it: Escape in keys mode; with a pointer, only if the card's
    layer actually covers the page (a click through to the page is otherwise free)."""
    pg = m.pg
    try:
        pg.locator(TOUR).first.wait_for(state="visible", timeout=6000)
    except Exception:  # noqa: BLE001
        setup.append("base tour did not auto-start in this run")
        return
    if m.mode == "keys":
        m.key("Escape", "close the base tour")
    else:
        m.press(pg.get_by_role("button", name="Skip tour"), "Skip tour")
    pg.locator(TOUR).first.wait_for(state="hidden", timeout=6000)


def clear_tour_setup(pg, setup: list) -> None:
    try:
        pg.locator(TOUR).first.wait_for(state="visible", timeout=6000)
        pg.keyboard.press("Escape")
        pg.locator(TOUR).first.wait_for(state="hidden", timeout=6000)
        setup.append("base tour closed with Escape (uncounted)")
    except Exception:  # noqa: BLE001
        setup.append("base tour not on screen")


def focus_from_top(pg, setup: list) -> None:
    """W14-keys: closing the auto-started tour now puts focus on the first-run heading, and a
    `blur()` leaves the browser's sequential-focus starting point THERE, so the next Tab would
    continue from the middle of the page -- a start no keyboard member arriving fresh has.
    Reload so focus navigation starts at the top of the document, as every Q1 row did (the tour
    is recorded dismissed, so it does not come back)."""
    pg.reload(wait_until="domcontentloaded")
    h._dismiss_intro(pg)
    pg.get_by_role("heading", name="Welcome to your Notebook", level=2).first.wait_for(timeout=30000)
    if pg.locator(TOUR).count() and pg.locator(TOUR).first.is_visible():
        raise Inconclusive("the base tour came back after a reload")
    setup.append("page reloaded so focus navigation starts at the top")


def to_offer_setup(pg, setup: list) -> None:
    """Base tour closed, checklist hidden, Compass card closed -- the offer's preconditions."""
    clear_tour_setup(pg, setup)
    pg.get_by_role("button", name="Hide the get started list").first.click(timeout=15000)
    setup.append("checklist hidden (uncounted)")
    try:
        pg.get_by_role("button", name="Got it", exact=True).first.click(timeout=4000)
        setup.append("Meet Compass card closed (uncounted)")
    except Exception:  # noqa: BLE001
        pass
    pg.locator("[data-tour-offer]").first.wait_for(state="visible", timeout=15000)
    # The uncounted pointer clicks above leave the browser's sequential-focus starting point INSIDE
    # the first-run slot, so the next Tab lands on the offer for free -- a keyboard member who
    # never clicked would not get that. Reload: the session's offer is unanswered, so the SAME
    # offer comes back (W14-C2 1.3), and focus navigation starts at the top of the document.
    pg.reload(wait_until="domcontentloaded")
    h._dismiss_intro(pg)
    pg.locator("[data-tour-offer]").first.wait_for(state="visible", timeout=20000)
    setup.append("page reloaded so focus navigation starts at the top (offer re-shown, same session)")
    setup.append("offer on screen: " + pg.locator("[data-tour-offer] h2").first.inner_text())
    pg.evaluate("() => { if (document.activeElement && document.activeElement.blur) document.activeElement.blur();"
                " window.scrollTo(0, 0) }")


FOCUS_IN_MAIN_JS = """() => { const el = document.activeElement;
  return !!(el && el !== document.body && el.closest && el.closest('#main-content')) }"""


def in_main(m: Meter, *, main_first: bool = False, prefer: str | None = None) -> None:
    """Keys mode: a keyboard member takes a skip link rather than walking the app nav (13Q-3's
    convention, w13q.use_skip_link): the Notebook's own "Skip to notes list" (NotebookTab.jsx) where
    the page has one, else "Skip to main content". Which one was taken is in the row's steps.

    W14-keys: when focus is ALREADY in <main> (closing the auto-started tour now lands it on the
    first-run heading), no skip link is taken -- a member whose focus is in the page does not go
    back to the top to skip into it. `prefer` names a page skip link to try first ("Skip to
    getting started")."""
    if m.pg.evaluate(FOCUS_IN_MAIN_JS):
        m.steps.append({"do": "already in <main> (free)", "on": m.pg.evaluate(w13q.FOCUS_DESC_JS)})
        return
    if prefer and w13q.use_skip_link(m, "^" + re.escape(prefer) + "$", prefer):
        return
    if main_first:
        # the offer card is portaled into the first-run slot, FIRST in <main> (W14-C2 1.4), so
        # "Skip to notes list" would land past it; "Skip to main content" lands right before it
        w13q.use_skip_link(m, r"^Skip to main content$", "Skip to main content")
        return
    if not w13q.use_skip_link(m, r"^Skip to notes list$", "Skip to notes list"):
        w13q.use_skip_link(m, r"^Skip to main content$", "Skip to main content")


# ── flows ───────────────────────────────────────────────────────────────────────────────

def o1_first_note(cx, pg, m: Meter, base: str, setup: list) -> dict:
    first_run(pg, base)
    clear_tour_counted(m, setup)
    if m.mode == "keys":
        in_main(m)
    m.press(pg.get_by_role("button", name="Start a note"), "Start a note")
    nid = w13q.wait_note_open(pg)
    w13q.focus_editor_body(m)
    if not w13q.focus_in_editor(pg):
        raise Inconclusive(f"note {nid} opened but the cursor is not in its body")
    return {"note": nid, "cursor_in_body": True}


def o2_sample(cx, pg, m: Meter, base: str, setup: list) -> dict:
    first_run(pg, base)
    clear_tour_counted(m, setup)
    if m.mode == "keys":
        in_main(m)
    m.press(pg.get_by_role("button", name=re.compile(r"^Add a sample notebook")), "Add a sample notebook")
    sample = wait_until(lambda: (pref_json(cx, base, "notebook_sample") or {}).get("ids"), 30)
    if not sample:
        raise Inconclusive("no sample ids recorded within 30 s")
    try:
        pg.get_by_role("heading", name="Welcome to your Notebook", level=2).first.wait_for(state="hidden",
                                                                                           timeout=20000)
    except Exception:  # noqa: BLE001
        raise Inconclusive("the sample was added but the first-run screen is still showing")
    return {"sample_notes": len(sample), "first_run_gone": True}


def o3_dismiss_checklist(cx, pg, m: Meter, base: str, setup: list) -> dict:
    first_run(pg, base)
    clear_tour_setup(pg, setup)
    focus_from_top(pg, setup)
    pg.get_by_role("heading", name="Get started").first.wait_for(timeout=15000)
    if m.mode == "keys":
        in_main(m, prefer="Skip to getting started")
    m.press(pg.get_by_role("button", name="Hide the get started list"), "Hide (checklist)")
    gs = wait_until(lambda: (pref_json(cx, base, "notebook_getting_started") or {}).get("state") == "dismissed"
                    and pref_json(cx, base, "notebook_getting_started"))
    if not gs:
        raise Inconclusive("the checklist's dismissed state was not recorded")
    return {"notebook_getting_started": gs}


def _replay_row(pg):
    return pg.locator("li", has_text="Notebook basics").filter(has=pg.get_by_role("link", name="Replay"))


def o4_replay(cx, pg, m: Meter, base: str, setup: list) -> dict:
    """W14-keys: on keys, the member's door is the ONE command palette (Ctrl+K, the door every
    wave-13 "find, open" budget was met through): "Help: Walkthroughs" lands on Help's
    Walkthroughs heading, and the next Tab is Replay. Pointer and touch walk the nav as before.
    The nav path on keys is measured separately as O4N."""
    first_run(pg, base)
    clear_tour_setup(pg, setup)
    focus_from_top(pg, setup)
    if m.mode == "keys":
        m.key("Control+k", "open the command palette")
        m.type("walkthroughs", "palette query")
        w13q.pick_option(m, r"Help: Walkthroughs", "Help: Walkthroughs")
        pg.wait_for_url("**/support#walkthroughs", timeout=20000)
        pg.get_by_role("heading", name="Walkthroughs", level=2).first.wait_for(timeout=20000)
        m.press(_replay_row(pg).first.get_by_role("link", name="Replay"), "Replay (Notebook basics)")
        return _replay_verify(pg)
    return _o4_via_nav(pg, m)


def o4n_replay_nav(cx, pg, m: Meter, base: str, setup: list) -> dict:
    """O4 on keys through the app nav (no palette): Support is the LAST sidebar entry, so this
    is the cost the held NavBar single-Tab-stop decision governs. On Help the member takes
    "Skip to Walkthroughs"."""
    first_run(pg, base)
    clear_tour_setup(pg, setup)
    focus_from_top(pg, setup)
    return _o4_via_nav(pg, m, skip_on_help=True)


def _o4_via_nav(pg, m: Meter, skip_on_help: bool = False) -> dict:
    support = pg.get_by_role("link", name="Support", exact=True).filter(visible=True)
    if support.count() == 0:
        # phone/tablet: the app directory lives behind the top bar's menu button; MoreSheet's rows
        # are BUTTONS, not links
        m.press(pg.get_by_role("button", name="Open menu"), "Open menu")
        support = (pg.get_by_role("link", name="Support", exact=True)
                   .or_(pg.get_by_role("button", name="Support", exact=True))).filter(visible=True)
    m.press(support, "Support (nav)")
    pg.wait_for_url("**/support", timeout=20000)
    row = _replay_row(pg)
    row.first.wait_for(timeout=20000)
    if skip_on_help and m.mode == "keys":
        w13q.use_skip_link(m, r"^Skip to Walkthroughs$", "Skip to Walkthroughs")
    m.press(row.first.get_by_role("link", name="Replay"), "Replay (Notebook basics)")
    return _replay_verify(pg)


def _replay_verify(pg) -> dict:
    d = pg.locator(TOUR).first
    d.wait_for(state="visible", timeout=20000)
    title = d.locator("h2").first.inner_text()
    if title != "Welcome to your Notebook":
        raise Inconclusive(f"the replayed tour opened on '{title}', not step one")
    return {"tour": "notebook-basics", "title": title}


def _offer_answer(cx, pg, m: Meter, base: str, setup: list, button: str) -> str:
    first_run(pg, base)
    to_offer_setup(pg, setup)
    offered = pg.locator("[data-tour-offer] h2").first.inner_text()
    if m.mode == "keys":
        in_main(m, main_first=True)
    if m.mode == "keys" and button == "Not now":
        # W14-keys: the offer's answers are ONE Tab stop, and "Not now" declares the key the card
        # has always honoured (aria-keyshortcuts="Escape"). Verified from the DOM, never assumed.
        later = pg.locator("[data-tour-offer]").get_by_role("button", name="Not now").first
        if later.get_attribute("aria-keyshortcuts") != "Escape":
            raise Inconclusive("'Not now' does not declare its Escape (aria-keyshortcuts)")
        m.tab_to("el.closest && el.closest('[data-tour-offer]')", "the offer card")
        m.key("Escape", "Not now (Escape, declared by aria-keyshortcuts)")
        return offered
    m.press(pg.locator("[data-tour-offer]").get_by_role("button", name=button), button)
    return offered


def o5_accept(cx, pg, m: Meter, base: str, setup: list) -> dict:
    offered = _offer_answer(cx, pg, m, base, setup, "Take the tour")
    try:
        pg.locator(TOUR).first.wait_for(state="visible", timeout=15000)
    except Exception:  # noqa: BLE001
        raise Inconclusive(f"'{offered}': Take the tour was pressed and no tour opened within 15 s "
                           f"(offer gone: {pg.locator('[data-tour-offer]').count() == 0}; "
                           f"notebook_tours={prefs(cx, base).get('notebook_tours')})")
    return {"offered": offered, "tour_title": pg.locator(TOUR).first.locator("h2").first.inner_text()}


def o6_decline(cx, pg, m: Meter, base: str, setup: list) -> dict:
    offered = _offer_answer(cx, pg, m, base, setup, "Not now")
    rows = wait_until(lambda: {k: v for k, v in (pref_json(cx, base, "notebook_tours") or {}).items()
                               if isinstance(v, dict) and v.get("state") == "dismissed"})
    if not rows or pg.locator("[data-tour-offer]").count():
        raise Inconclusive(f"decline not recorded or the card is still showing (rows={rows})")
    return {"offered": offered, "declined": rows}


FLOWS = [("O1", o1_first_note), ("O2", o2_sample), ("O3", o3_dismiss_checklist), ("O4", o4_replay),
         ("O5", o5_accept), ("O6", o6_decline), ("O4N", o4n_replay_nav)]
# W14-keys: a flow measured in fewer modes than the four (O4N is the keys-only nav path).
ALL_MODES = (("mouse", "1200"), ("keys", "1200"), ("keys", "390"), ("taps", "390"))
FLOW_MODES = {"O4N": (("keys", "1200"), ("keys", "390"))}


# ── runner ──────────────────────────────────────────────────────────────────────────────

def run_one(br, admin_req, base: str, fid: str, fn, mode: str, width: str, out: Path, n: int) -> dict:
    b = BUDGET[fid]
    budget = b[mode]
    row = {"flow": fid, "name": b["flow"], "derived_from": b["derived_from"], "mode": mode, "width": width,
           "budget": budget, "measured": None, "verdict": "INCONCLUSIVE", "reason": "", "tabs": None,
           "keystrokes": None, "clicks": None, "taps": None, "time_s": None, "steps": [], "setup": [],
           "outcome": None}
    vp = WIDE if width == "1200" else PHONE
    ctx = br.new_context(viewport=vp, has_touch=(width == "390"), is_mobile=(width == "390"),
                         reduced_motion="reduce")
    email = f"q1c{fid.lower()}{mode}{width}{n}{int(time.time() * 1000) % 1_000_000}@local.dev"
    try:
        sys.path.insert(0, str(REPO / "tools"))
        from notebook_w14_onboarding_walk import signup
        signup(ctx.request, base, email, "LocalTest2026!", "q1clicks")
        admin_req.post(base + "/api/auth/admin/comp-access", data={"email": email, "action": "grant"})
        admin_req.post(base + "/api/auth/admin/verify-email", data={"email": email})
        if not ctx.request.get(base + "/api/auth/me").json().get("paid_equiv"):
            raise h.SetupFailed(f"{email} is not paid-equivalent")
    except Exception as e:  # noqa: BLE001
        row["reason"] = f"setup: {e}"
        ctx.close()
        return row
    pg = ctx.new_page()
    pg.bring_to_front()
    errors: list = []
    pg.on("pageerror", lambda e: errors.append(str(e)[:300]))
    m = Meter(pg, mode)
    try:
        row["outcome"] = fn(ctx, pg, m, base, row["setup"])
        row["measured"] = m.count()
        row["verdict"] = "PASS" if row["measured"] <= budget else "OVER"
    except Capped as e:
        row["measured"] = m.count()
        row["verdict"] = "OVER"
        row["reason"] = f"cap reached: {e}"
    except Inconclusive as e:
        row["reason"] = str(e)[:600]
        row["measured_before_stop"] = m.count()
    except Exception as e:  # noqa: BLE001
        row["reason"] = f"driver could not complete: {type(e).__name__}: {str(e)[:400]}"
        row["measured_before_stop"] = m.count()
        row["traceback"] = traceback.format_exc()[-1500:]
    row["tabs"], row["keystrokes"], row["clicks"], row["taps"] = m.tabs, m.keys, m.clicks, m.taps
    row["time_s"] = m.elapsed()
    row["steps"] = m.steps
    row["page_errors"] = errors[:5]
    ctx.close()
    print(f"  {fid} {mode:>5} @{width:>4}: {row['verdict']:<12} measured={row['measured']} budget={budget} "
          f"tabs={m.tabs} {('-- ' + row['reason'][:160]) if row['reason'] else ''}", flush=True)
    return row


def table_md(rows: list[dict]) -> str:
    lines = ["| flow | mode | width | measured | budget | verdict | tabs | time s | reason |",
             "|---|---|---|---|---|---|---|---|---|"]
    for r in rows:
        meas = r["measured"] if r["measured"] is not None else f"({r.get('measured_before_stop', '-')})"
        reason = (r.get("reason") or "").replace("|", "/").replace("\n", " ")[:200]
        lines.append(f"| {r['flow']} {r['name']} | {r['mode']} | {r['width']} | {meas} | {r['budget']} | "
                     f"{r['verdict']} | {r['tabs'] if r['tabs'] is not None else '-'} | "
                     f"{r['time_s'] if r['time_s'] is not None else '-'} | {reason} |")
    return "\n".join(lines) + "\n"


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--data-dir", required=True)
    ap.add_argument("--port", type=int, default=8720)
    ap.add_argument("--out", required=True)
    ap.add_argument("--only", default="")
    args = ap.parse_args(argv)
    why = h.refuse_shared_root(args.data_dir)
    if why:
        print(f"REFUSED: {why}")
        return 3
    if args.port not in PORTS:
        print("REFUSED: this lane uses ports 8720-8724 only (never 8077)")
        return 3
    if h.port_busy(args.port):
        print(f"REFUSED: port {args.port} already has a listener -- this tool never kills it")
        return 3
    data_dir = Path(args.data_dir)
    if data_dir.exists() and any(data_dir.iterdir()):
        print(f"REFUSED: {data_dir} is not empty")
        return 3
    data_dir.mkdir(parents=True, exist_ok=True)
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    only = {s.strip().upper() for s in args.only.split(",") if s.strip()} or None
    sha = subprocess.run(["git", "rev-parse", "HEAD"], cwd=str(REPO), capture_output=True, text=True).stdout.strip()
    result = {"tool": "tools/notebook_w14q_clicks.py", "tree": sha,
              "started": datetime.now(timezone.utc).isoformat(timespec="seconds"),
              "sandbox_flags": FLAGS, "budgets": BUDGET, "rows": [], "status": "INCOMPLETE (run did not finish)"}
    (out / "clicks.json").write_text(json.dumps(result, indent=1), encoding="utf-8")
    for k in [k for k in os.environ if k.startswith("RAILWAY_")]:
        os.environ.pop(k, None)
    os.environ.update({name: "1" for name in FLAGS})
    box = h.Sandbox(str(data_dir), args.port, out / "sandbox.log")
    base = f"http://127.0.0.1:{args.port}"
    failure = None
    box.start()
    try:
        if not box.wait_healthy(base, 300):
            failure = "the sandbox never answered /api/health"
        else:
            from playwright.sync_api import sync_playwright
            with sync_playwright() as pw:
                br = pw.chromium.launch()
                admin = br.new_context()
                h._signup_or_login(admin.request, base, h.ADMIN_EMAIL, h.ADMIN_PW, "hubtest")
                n = 0
                for fid, fn in FLOWS:
                    if only and fid not in only:
                        continue
                    for mode, width in FLOW_MODES.get(fid, ALL_MODES):
                        n += 1
                        result["rows"].append(run_one(br, admin.request, base, fid, fn, mode, width, out, n))
                        (out / "clicks.json").write_text(json.dumps({**result, "status": "IN PROGRESS"}, indent=1,
                                                                    ensure_ascii=False, default=str), encoding="utf-8")
                br.close()
    except Exception as e:  # noqa: BLE001
        failure = f"the run raised {type(e).__name__}: {str(e)[:400]}"
        result["traceback"] = traceback.format_exc()[-3000:]
    finally:
        result["stop_how"] = box.stop()
    api_mods = sorted(mm for mm in sys.modules if mm == "api" or mm.startswith("api."))
    result.update({"failure": failure, "driver_imported_api": api_mods,
                   "finished": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                   "status": "COMPLETE" if not failure else "NOT COMPLETE"})
    (out / "clicks.json").write_text(json.dumps(result, indent=1, ensure_ascii=False, default=str), encoding="utf-8")
    (out / "table.md").write_text(table_md(result["rows"]), encoding="utf-8")
    if failure:
        print(f"VERDICT: RUN FAILED -- {failure}")
        return 3
    counts: dict = {}
    for r in result["rows"]:
        counts[r["verdict"]] = counts.get(r["verdict"], 0) + 1
    print(f"VERDICT: RAN -- {len(result['rows'])} rows; " + ", ".join(f"{k} {v}" for k, v in sorted(counts.items())))
    return 0


if __name__ == "__main__":
    sys.exit(main())
