"""Wave 14, lane W14-Q2 -- the real-browser walk of EVERY capability tour.

Spec: docs/notebook/WAVE-14-PLAN.md section 6 (6.2 real-browser walks, 6.3 a11y) and 5.3-5.6.
Lane record: docs/notebook/wave14-w14-q2.md. Reuses W14-Q1's walk tool (its probes, its axe
runner, its member factory, its R-RAW recorder) by IMPORT, so a check here means what it meant
there.

Phases (each on its own sandbox, `notebook_perf_harness.Sandbox`, empty data dir):

  on   the wave-14 switch ON (onboarding + getting started) and EVERY tour capability flag ON.
       Per width (1200; 390 with touch): one member with the sample notebook added (and one
       manual trade, so the two trade tours have something to open: the sample adds none by
       design, wave14-integration.md R2.4). For every replayable tour listed in Help >
       Walkthroughs: Replay, then walk it as a member would -- Next by keyboard, Back once,
       a "do this to continue" step answered by clicking what the card points at -- and
       record: opens, reaches its start, steps shown of declared, every skipped step with
       why (anchor absent from the page / present but not on screen), the card's modality,
       the effective opacity of what it points at, overflow, the tap floor (390), keyboard
       reach inside the card, the focus trap (modal: kept; non-modal: absent), axe on the
       card, Escape, and one small screenshot. Then the passive resurfacing explainer, and
       S6: accepting an offer for writing-help and for template-gallery, plus an offer
       accepted by a member with nothing to open (must not be spent).
  off  the wave-14 switch OFF (getting started unset; onboarding ON, as in production today)
       with every capability flag still ON: first-run screen, Help, Home and an open note
       carry no tour, offer, explainer, Walkthroughs or What's new.

Usage (PowerShell; ports 8730-8734; never 8077):
    python tools/notebook_w14q2_tours_walk.py --data-root '<scratch>\\w14q2' --port 8730 `
        --out docs\\notebook\\evidence\\wave14-q2

Exit: 0 = every check PASSED; 1 = at least one FAILED; 3 = not run.
"""
from __future__ import annotations

import argparse
import io
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
if str(REPO / "tools") not in sys.path:
    sys.path.insert(0, str(REPO / "tools"))
import notebook_perf_harness as h  # noqa: E402
import notebook_w14_onboarding_walk as w  # noqa: E402  -- its probes, recorder and member factory

PORTS = range(8730, 8735)
WIDTHS = [(1200, 900), (390, 844)]
TOURS_DIR = REPO / "app" / "src" / "pages" / "journal-2-0" / "components" / "notebook" / "onboarding" / "tours"
TRACKS = ["b1Core.js", "b2Trading.js", "b3Research.js"]

# Plain lists (the ledger convention). The switch, then every capability a registered tour rides on
# (plus find-similar, which the setups-board tour's last steps sit on).
SWITCH_FLAGS = ["NOTEBOOK_ONBOARDING_ENABLED", "NOTEBOOK_GETTING_STARTED_ENABLED"]
CAPABILITY_FLAGS = [
    "NOTEBOOK_WRITING_HELP_ENABLED", "NOTEBOOK_IMAGE_DOCX_DOCUMENTS_ENABLED", "NOTEBOOK_PUBLISH_ENABLED",
    "NOTEBOOK_TASK_REMINDERS_ENABLED", "NOTEBOOK_TEMPLATE_GALLERY_ENABLED", "NOTEBOOK_SEMANTIC_SEARCH_ENABLED",
    "NOTEBOOK_FORMULAS_ENABLED", "NOTEBOOK_PLAN_GRADING_ENABLED", "NOTEBOOK_ENTRY_CONTEXT_ENABLED",
    "NOTEBOOK_REVIEW_DRAFTS_ENABLED", "NOTEBOOK_PLAYBOOK_ENABLED", "NOTEBOOK_CHART_PLAN_ENABLED",
    "NOTEBOOK_TA_FINGERPRINT_ENABLED", "NOTEBOOK_VISUAL_PLAYBOOK_ENABLED", "NOTEBOOK_SETUPS_BOARD_ENABLED",
    "NOTEBOOK_FIND_SIMILAR_ENABLED", "NOTEBOOK_EARNINGS_PREP_ENABLED", "NOTEBOOK_TRANSCRIPT_CAPTURE_ENABLED",
    "NOTEBOOK_PASSED_SETUPS_ENABLED", "NOTEBOOK_THESIS_CHIPS_ENABLED", "AWARENESS_NOTE_RESURFACE_ENABLED",
]
ARMED_ON = SWITCH_FLAGS + CAPABILITY_FLAGS
ARMED_OFF = ["NOTEBOOK_ONBOARDING_ENABLED"] + CAPABILITY_FLAGS

record = w.record

# Lane WALK (finish program): an optional helper a caller may set for a "do this to continue" step
# whose action is not a press on the thing the card points at (typing /transcript in the note).
# Called as WAIT_ASSIST(pg, tour_id, step); a true return means "the action was done".
WAIT_ASSIST = None


# ── the registry, read from the source (never restated) ───────────────────────────────────

def read_registry() -> list[dict]:
    """Every registered tour, in registry order, with its declared steps (id, anchor, waitFor)."""
    out = []
    for track in TRACKS:
        src = (TOURS_DIR / track).read_text(encoding="utf-8")
        for block in re.split(r"\n  \{\n", src)[1:]:
            tid = re.search(r"id: '([^']+)'", block)
            if not tid:
                continue
            mod = re.search(r"import\('\./([^']+)'\)", block)
            title = re.search(r"title: '([^']+)'", block)
            repl = re.search(r"replayable: (true|false)", block)
            steps = []
            if mod:
                ssrc = (TOURS_DIR / f"{mod.group(1)}.js").read_text(encoding="utf-8")
                body = ssrc.split("STEPS", 1)[1] if "STEPS" in ssrc else ssrc
                body = body.split("COPY", 1)[0]
                for m in re.finditer(r"step\('([^']+)',\s*'([^']+)'|id: '([^']+)', anchor: '([^']+)'(?:, file: [A-Z_]+)?(?:, waitFor: '([^']+)')?", body):
                    if m.group(1):
                        steps.append({"id": m.group(1), "anchor": m.group(2), "waitFor": None})
                    else:
                        steps.append({"id": m.group(3), "anchor": m.group(4), "waitFor": m.group(5)})
            out.append({"id": tid.group(1), "title": title.group(1) if title else tid.group(1),
                        "replayable": (repl.group(1) == "true") if repl else True, "steps": steps,
                        "module": mod.group(1) if mod else None})
    return out


# ── page probes ───────────────────────────────────────────────────────────────────────────

STATE_JS = """(tourTitle) => {
  const vis = (e) => { const b = e.getBoundingClientRect(); const s = getComputedStyle(e);
                       return b.width > 0 && b.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' };
  const vw = document.documentElement.clientWidth, vh = window.innerHeight;
  const c = document.querySelector('[data-tour-card]');
  if (c && vis(c)) {
    const m = /step (\\d+) of (\\d+)/i.exec((c.querySelector('p') || {}).innerText || '');
    const act = document.querySelector('[data-tour-active="true"]');
    let op = null, actRect = null;
    if (act) { op = 1; for (let a = act; a && a !== document.documentElement; a = a.parentElement) op *= parseFloat(getComputedStyle(a).opacity || '1');
               const r = act.getBoundingClientRect(); actRect = [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)] }
    const r = c.getBoundingClientRect();
    const btn = (name) => [...c.querySelectorAll('button')].find(b => b.innerText.trim() === name);
    const host = c.parentElement && c.parentElement.closest('[role=dialog]');
    return { kind: 'step', mode: c.getAttribute('data-tour-card'), n: m ? +m[1] : null, of: m ? +m[2] : null,
             title: (c.querySelector('h2') || {}).innerText || '', waiting: /Do this to continue/.test(c.innerText),
             moving: /Looking for the next step/.test(c.innerText), active: act ? act.getAttribute('data-tour') : null,
             activeOpacity: op === null ? null : Math.round(op * 100) / 100, activeRect: actRect,
             cardInView: r.left >= -1 && r.top >= -1 && r.right <= vw + 1 && r.bottom <= vh + 1,
             cardRect: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)],
             inSheet: !!host, hasDone: !!btn('Done'), backDisabled: btn('Back') ? btn('Back').disabled : null,
             url: location.pathname + location.search };
  }
  const dlg = [...document.querySelectorAll('[role=dialog]')].filter(vis).find(d => {
      const p = d.querySelector('p'); return p && p.innerText.trim().toLowerCase() === tourTitle.toLowerCase() });
  if (dlg) return { kind: 'unreachable', title: (dlg.querySelector('h2') || {}).innerText || '',
                    body: (dlg.querySelectorAll('p')[1] || {}).innerText || '', url: location.pathname + location.search };
  const ex = document.querySelector('[data-tour-explainer]');
  if (ex && vis(ex)) return { kind: 'explainer', url: location.pathname + location.search };
  return { kind: 'none', url: location.pathname + location.search };
}"""

ANCHOR_JS = """(a) => { const els = [...document.querySelectorAll(`[data-tour="${a}"]`)];
  const on = els.filter(e => { const b = e.getBoundingClientRect(); return b.width > 0 && b.height > 0 });
  return { count: els.length, withBox: on.length,
           hidden: els.some(e => e.closest('[hidden],[aria-hidden="true"]')) } }"""

MARK_CARD_JS = """() => { document.querySelectorAll('[data-q1-root]').forEach(e => e.removeAttribute('data-q1-root'));
  const c = document.querySelector('[data-tour-card]') || document.querySelector('[data-tour-explainer]');
  if (c) c.setAttribute('data-q1-root', '1'); return !!c }"""

IN_CARD_JS = """() => { const c = document.querySelector('[data-tour-card]'); const a = document.activeElement;
  return !!(c && a && c.contains(a)) }"""


def state(pg, title: str) -> dict:
    try:
        return pg.evaluate(STATE_JS, title)
    except Exception as e:  # noqa: BLE001 -- a navigation mid-evaluate
        return {"kind": "none", "error": str(e)[:120]}


def wait_state(pg, title: str, pred, timeout_s: float) -> dict:
    end = time.time() + timeout_s
    st = state(pg, title)
    while time.time() < end:
        if pred(st):
            return st
        pg.wait_for_timeout(150)
        st = state(pg, title)
    return st


def snap(pg, name: str) -> str | None:
    """One small viewport PNG (<= 600 px wide, 48 colours)."""
    try:
        from PIL import Image
        png = pg.screenshot(timeout=8000)
        im = Image.open(io.BytesIO(png)).convert("RGB")
        if im.width > 600:
            im = im.resize((600, int(im.height * 600 / im.width)))
        im = im.quantize(colors=48)
        dest = w.OUT / "shots" / f"{name}.png"
        dest.parent.mkdir(parents=True, exist_ok=True)
        im.save(dest, optimize=True)
        return dest.name
    except Exception as e:  # noqa: BLE001
        return f"(screenshot failed: {type(e).__name__}: {str(e)[:100]})"


def tours_rows(ctx, base: str) -> dict:
    raw = w.prefs_of(ctx, base).get("notebook_tours")
    try:
        return json.loads(raw) if isinstance(raw, str) else (raw or {})
    except Exception:  # noqa: BLE001
        return {}


def card_battery(pg, P: str, width: int, tid: str) -> dict:
    """Axe, tap floor, overflow and keyboard reach on the card as it stands."""
    out = {}
    pg.evaluate(MARK_CARD_JS)
    ov = pg.evaluate(w.OVERFLOW_JS)
    out["overflow"] = not ov["horizontal"] and not ov["offenders"]
    record(P, width, tid, "no horizontal overflow", out["overflow"], **ov)
    if width <= w.TOUCH_MAX:
        tap = pg.evaluate(w.TAP_JS)
        out["tap"] = bool(tap["tapMin"]) and not tap["small"]
        record(P, width, tid, "card controls >= --tap-min", out["tap"], **tap)
    try:
        res = w.axe(pg)
        v = res.get("violations") or []
        out["axe"] = (not res.get("error") and not v)
        out["axe_ids"] = [f"{x['id']}({x['impact']})" for x in v]
        record(P, width, tid, "axe on the card", out["axe"], axe_version=res.get("version"),
               error=res.get("error"), violation_ids=out["axe_ids"], violations=v)
    except Exception as e:  # noqa: BLE001
        out["axe"] = False
        record(P, width, tid, "axe on the card", False, error=str(e)[:200])
    pg.evaluate(MARK_CARD_JS)
    kr = w.key_reach(pg, from_top=False, cap=12)
    out["keys"] = not kr["missing"] and bool(kr["controls"])
    record(P, width, tid, "keyboard reach inside the card", out["keys"], **kr)
    pg.evaluate("() => document.querySelectorAll('[data-q1-root]').forEach(e => e.removeAttribute('data-q1-root'))")
    return out


def trap_probe(pg, mode: str) -> dict:
    """From the card's last button, Tab six times: does focus stay in the card?"""
    pg.evaluate("""() => { const c = document.querySelector('[data-tour-card]');
        const b = [...c.querySelectorAll('button')].filter(x => !x.disabled); b[b.length - 1].focus() }""")
    inside = []
    for _ in range(6):
        pg.keyboard.press("Tab")
        inside.append(pg.evaluate(IN_CARD_JS))
    stays = all(inside)
    # put focus back on the card's Next/Done so the walk goes on from the card
    pg.evaluate("""() => { const c = document.querySelector('[data-tour-card]'); if (!c) return;
        const b = [...c.querySelectorAll('button')].filter(x => !x.disabled); b[b.length - 1].focus() }""")
    return {"mode": mode, "stays_in_card": stays, "trail": inside,
            "as_designed": stays if mode == "modal" else not stays}


def press_card(pg, name: str) -> bool:
    """Focus the card's button `name` and press Enter (the keyboard path)."""
    ok = pg.evaluate("""(n) => { const c = document.querySelector('[data-tour-card]'); if (!c) return false;
        const b = [...c.querySelectorAll('button')].find(x => x.innerText.trim() === n && !x.disabled);
        if (!b) return false; b.focus(); return true }""", name)
    if ok:
        pg.keyboard.press("Enter")
    return ok


def skip_reasons(pg, steps: list[dict], idxs: list[int]) -> list[dict]:
    out = []
    for k in idxs:
        s = steps[k]
        a = pg.evaluate(ANCHOR_JS, s["anchor"])
        why = ("anchor absent from the page" if a["count"] == 0 else
               "anchor hidden (hidden / aria-hidden ancestor)" if a["hidden"] else
               "anchor present but has no box" if a["withBox"] == 0 else
               "anchor present but not on screen (clipped / off-window)")
        out.append({"step": k + 1, "id": s["id"], "anchor": s["anchor"], "why": why, **a})
    return out


# ── one tour ──────────────────────────────────────────────────────────────────────────────

def walk_tour(pg, ctx, base: str, width: int, entry: dict, P: str = "on") -> dict:
    tid, title, steps = entry["id"], entry["title"], entry["steps"]
    M = len(steps)
    row = {"tour": tid, "width": width, "declared": M, "opens": False, "start": None, "shown": [],
           "skipped": [], "clicked": [], "modes": [], "notes": []}
    pg.goto(base + "/support", wait_until="domcontentloaded", timeout=60000)
    li = (pg.locator("li").filter(has=pg.get_by_text(title, exact=True))
          # not exact: the link is named "Replay the <title> tour" (lane FIN-A11Y, M-14)
          .filter(has=pg.get_by_role("link", name="Replay")))
    try:
        li.first.get_by_role("link", name="Replay").wait_for(timeout=20000)
    except Exception:  # noqa: BLE001
        record(P, width, tid, "listed in Help > Walkthroughs", False)
        row["notes"].append("not listed in Walkthroughs")
        return row
    li.first.get_by_role("link", name="Replay").click()
    st = wait_state(pg, title, lambda s: s["kind"] in ("step", "unreachable"), 25)
    row["start"] = st.get("url")
    if st["kind"] == "unreachable":
        row["notes"].append(f"unreachable card: {st['title']}")
        row["shot"] = snap(pg, f"{tid}-{width}")
        record(P, width, tid, "opens", False, unreachable=st)
        pg.get_by_role("button", name="Close", exact=True).first.click()
        return row
    if st["kind"] != "step":
        row["shot"] = snap(pg, f"{tid}-{width}")
        row["notes"].append("nothing opened within 25 s")
        census = pg.evaluate("() => [...new Set([...document.querySelectorAll('[data-tour]')].map(e => e.getAttribute('data-tour')))]")
        row["anchors_on_page"] = census
        row["skipped"] = skip_reasons(pg, steps, list(range(M)))
        record(P, width, tid, "opens", False, state=st, notebook_tours=tours_rows(ctx, base).get(tid),
               anchors_on_page=census, first_anchor=steps[0]["anchor"] if steps else None)
        return row
    row["opens"] = True
    row["reached_start_at_step"] = st["n"]
    record(P, width, tid, "opens", True, step=st["n"], of=st["of"], url=st["url"], title=st["title"])
    record(P, width, tid, "progress counts the declared steps", st["of"] == M, of=st["of"], declared=M)
    row["shot"] = snap(pg, f"{tid}-{width}")
    row["battery"] = card_battery(pg, P, width, tid)
    trap_done = set()
    back_done = False
    last_n = 0
    for _ in range(M + 6):
        st = state(pg, title)
        if st["kind"] != "step":
            break
        if st["n"] not in row["shown"]:
            row["shown"].append(st["n"])
            row["modes"].append(st["mode"])
            if st["n"] > last_n + 1:
                row["skipped"] += skip_reasons(pg, steps, list(range(last_n, st["n"] - 1)))
            last_n = max(last_n, st["n"])
            facts = {k: st[k] for k in ("n", "mode", "active", "activeOpacity", "activeRect", "cardInView",
                                        "inSheet", "waiting")}
            if st["activeOpacity"] is not None and st["activeOpacity"] < 0.3:
                row["notes"].append(f"step {st['n']} points at '{st['active']}' at opacity {st['activeOpacity']}")
            if not st["cardInView"]:
                row["notes"].append(f"step {st['n']} card not fully in the viewport {st['cardRect']}")
            ov = pg.evaluate("() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1")
            if ov:
                row["notes"].append(f"step {st['n']} horizontal overflow")
            record(P, width, tid, f"step {st['n']} shown", None, **facts)
            if st["mode"] not in trap_done:
                tp = trap_probe(pg, st["mode"])
                trap_done.add(st["mode"])
                row.setdefault("trap", {})[st["mode"]] = tp["as_designed"]
                record(P, width, tid, f"focus trap ({st['mode']}: {'kept' if st['mode'] == 'modal' else 'absent'})",
                       tp["as_designed"], **tp)
        if st["hasDone"]:
            break
        # Back is tested once, between two plain steps: Back onto a "do this to continue" step
        # whose thing is already done moves straight forward again (by design), which would
        # read as a broken Back.
        # Back is tested once. Onto a "do this to continue" step whose thing is already done, it
        # must SHOW that step and stay there (round 2), not jump forward again.
        if not back_done and len(row["shown"]) >= 2 and st["n"] == row["shown"][-1] and st["backDisabled"] is False:
            n0 = st["n"]
            press_card(pg, "Back")
            b = wait_state(pg, title, lambda s: s["kind"] != "step" or s["n"] != n0, 4)
            pg.wait_for_timeout(2000)
            b2 = state(pg, title)
            row["back_ok"] = b["kind"] == "step" and b["n"] < n0 and b2.get("n") == b["n"]
            record(P, width, tid, "Back returns to the previous shown step, and stays", row["back_ok"], frm=n0,
                   to=b.get("n"), after_2s=b2.get("n"), onto_waitfor=bool(steps[(b.get("n") or 1) - 1].get("waitFor")))
            back_done = True
            continue
        n0 = st["n"]
        wf = steps[n0 - 1].get("waitFor") if st["waiting"] else None
        if wf and pg.evaluate(ANCHOR_JS, wf)["withBox"]:
            st = {**st, "waiting": False}     # already done (we came Back onto it): Next moves on
        if st["waiting"] and WAIT_ASSIST is not None and WAIT_ASSIST(pg, tid, steps[n0 - 1]):
            nx = wait_state(pg, title, lambda s: s["kind"] != "step" or s["n"] != n0, 12)
            if nx["kind"] == "step" and nx["n"] != n0:
                row["clicked"].append(n0)
                continue
            row["notes"].append(f"step {n0}: the assisted action did not advance")
        if st["waiting"]:
            # "Do this to continue": do what the card asks -- click what it points at
            try:
                tgt = pg.locator('[data-tour-active="true"]').first
                tgt.scroll_into_view_if_needed(timeout=3000)
                try:
                    tgt.hover(timeout=2000)
                except Exception:  # noqa: BLE001
                    pass
                try:
                    tgt.click(timeout=4000)            # a member's tap: refused if the card covers it
                    pressable = True
                except Exception as e:  # noqa: BLE001
                    pressable = False
                    blocker = pg.evaluate("""() => { const t = document.querySelector('[data-tour-active="true"]');
                        if (!t) return null; const r = t.getBoundingClientRect();
                        const h = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
                        return h ? (h.closest('[data-tour-card]') ? 'the tour card' : h.tagName + '.' + String(h.className).slice(0, 40)) : null }""")
                    row["notes"].append(f"step {n0}: its control could not be pressed ({type(e).__name__}; on top: {blocker})")
                    tgt.click(timeout=4000, force=True)
                record(P, width, tid, f"step {n0}: the control it asks for can be pressed", pressable)
                pg.wait_for_timeout(600)
                # a step that asks for a search: what the click focused is the search box
                if pg.evaluate("() => (document.activeElement || {}).tagName === 'INPUT'"):
                    pg.keyboard.type("plan", delay=40)   # a word the sample notebook answers
                nx = wait_state(pg, title, lambda s: s["kind"] != "step" or s["n"] != n0, 8)
                if nx["kind"] == "step" and nx["n"] != n0:
                    row["clicked"].append(n0)
                    continue
                row["notes"].append(f"step {n0}: clicking its target did not advance")
            except Exception as e:  # noqa: BLE001
                row["notes"].append(f"step {n0}: could not click its target ({type(e).__name__})")
        if not press_card(pg, "Next"):
            row["notes"].append(f"step {n0}: no enabled Next")
            break
        wait_state(pg, title, lambda s: s["kind"] != "step" or (s["n"] != n0 and not s["moving"]), 6)
    st = state(pg, title)
    if st["kind"] == "step":
        if last_n < M and st["hasDone"] is False:
            row["notes"].append("walk stopped before Done")
        # Escape on the last step: the tour closes, a sheet beneath (if any) stays
        pg.keyboard.press("Escape")
        gone = wait_state(pg, title, lambda s: s["kind"] != "step", 3)
        row["escape_ok"] = gone["kind"] != "step"
        rec = tours_rows(ctx, base).get(tid)
        record(P, width, tid, "Escape closes the card and records the tour", row["escape_ok"] and bool(rec),
               notebook_tours_row=rec)
        pg.keyboard.press("Escape")   # close a sheet the tour walked into, if any
    else:
        rec = tours_rows(ctx, base).get(tid)
        row["escape_ok"] = None
        record(P, width, tid, "tour ended on its own after the last shown step", None, notebook_tours_row=rec)
    tail = list(range(last_n, M))
    if tail:
        row["skipped"] += skip_reasons(pg, steps, tail)
    row["complete"] = len(row["shown"]) == M
    record(P, width, tid, "steps shown of declared", None, shown=row["shown"], declared=M,
           skipped=row["skipped"], clicked=row["clicked"], notes=row["notes"])
    return row


# ── setup ─────────────────────────────────────────────────────────────────────────────────

def settle_home(pg) -> None:
    """Close what a new member meets first, the way a member does: the base tour (Escape), the
    Compass card (Got it), the get-started list (Hide)."""
    pg.wait_for_timeout(2500)
    d = pg.locator("[role=dialog][aria-modal=true]")
    if d.count() and "Welcome to your Notebook" in (d.first.inner_text() or ""):
        pg.keyboard.press("Escape")
        pg.wait_for_timeout(600)
    for name in ("Got it", "Hide the get started list"):
        b = pg.get_by_role("button", name=name, exact=True)
        if b.count():
            try:
                b.first.click(timeout=3000)
                pg.wait_for_timeout(500)
            except Exception:  # noqa: BLE001
                pass


def add_sample(ctx, base: str) -> dict:
    r = ctx.request.post(base + "/api/j2/onboarding/sample-notebook")
    return {"status": r.status, "body": (r.text() or "")[:200]}


def add_trade(ctx, base: str) -> dict:
    r = ctx.request.post(base + "/api/j2/trades", data={
        "symbol": "MSFT", "side": "Long", "shares": 10, "entryPrice": 400, "exitPrice": 410,
        "entryDate": "2026-09-14", "exitDate": "2026-09-16"})
    return {"status": r.status, "body": (r.text() or "")[:160]}


def mark_seen(ctx, base: str, ids: list[str]) -> list[int]:
    return [ctx.request.put(base + f"/api/j2/onboarding/tours/{i}", data={"state": "done", "step": None}).status
            for i in ids]


def new_member(browser, admin_req, base, tag, width, height, *, sample=True, trade=False):
    ctx, email, me = w.fresh_member(browser, admin_req, base, tag, width, height)
    facts = {"email": email}
    if sample:
        facts["sample"] = add_sample(ctx, base)
    if trade:
        facts["trade"] = add_trade(ctx, base)
    return ctx, me, facts


# ── phases ────────────────────────────────────────────────────────────────────────────────

def phase_on(browser, admin_req, base: str, registry: list[dict], only: set | None) -> None:
    P = "on"
    tours = [t for t in registry if t["replayable"] and (not only or t["id"] in only)]
    if only == {"S6"}:
        w.REPORT["registry"] = registry
        walk_s6_all(browser, admin_req, base, registry)
        return
    w.REPORT["registry"] = registry
    rows = w.REPORT.setdefault("rows", [])
    for width, height in WIDTHS:
        try:
            ctx, me, facts = new_member(browser, admin_req, base, f"q2t{width}", width, height, trade=True)
        except h.SetupFailed as e:
            record(P, width, "setup", "member", False, error=str(e))
            continue
        flags_off = [k for k, v in me.items() if k.endswith("_enabled") and v is False]
        record(P, width, "setup", "member with the sample notebook and one trade",
               facts["sample"]["status"] == 200 and facts["trade"]["status"] in (200, 201), **facts,
               payload_flags_off=flags_off)
        pg = ctx.new_page()
        errors: list = []
        pg.on("pageerror", lambda e: errors.append(str(e)[:300]))
        pg.goto(base + "/journal/notebook", wait_until="domcontentloaded", timeout=60000)
        h._dismiss_intro(pg)
        settle_home(pg)
        pg.goto(base + "/support", wait_until="domcontentloaded", timeout=60000)
        try:
            pg.get_by_role("link", name="Replay").first.wait_for(timeout=20000)
            listed = pg.locator("li", has=pg.get_by_role("link", name="Replay", exact=True)).all_inner_texts()
        except Exception:  # noqa: BLE001
            listed = []
        names = [x.replace("Replay", "").strip() for x in listed]
        want = [t["title"] for t in registry if t["replayable"]]
        record(P, width, "S0 Help", "Walkthroughs lists the base tour and every replayable tour",
               all(t in names for t in want) and len(names) == len(want) + 1, listed=names, expected=want)
        for t in tours:
            try:
                rows.append(walk_tour(pg, ctx, base, width, t))
            except Exception as e:  # noqa: BLE001
                record(P, width, t["id"], "walk completed", False, error=f"{type(e).__name__}: {str(e)[:300]}",
                       traceback=traceback.format_exc()[-1200:])
                rows.append({"tour": t["id"], "width": width, "opens": False, "declared": len(t["steps"]), "notes": [f"driver error {e}"[:200]]})
            w._flush()
        if not only or "note-resurfaces" in only:
            try:
                walk_explainer(pg, ctx, base, width)
            except Exception as e:  # noqa: BLE001
                record(P, width, "note-resurfaces", "walk completed", False, error=str(e)[:300])
        record(P, width, "driver", "no uncaught page errors", not errors, errors=errors[:10])
        ctx.close()
    if not only or "S6" in only:
        for width, height in WIDTHS:
            try:
                walk_s6(browser, admin_req, base, width, height, registry)
            except Exception as e:  # noqa: BLE001
                record(P, width, "S6", "walk completed", False, error=f"{type(e).__name__}: {str(e)[:300]}",
                       traceback=traceback.format_exc()[-1200:])


def walk_s6_all(browser, admin_req, base, registry) -> None:
    for width, height in WIDTHS:
        try:
            walk_s6(browser, admin_req, base, width, height, registry)
        except Exception as e:  # noqa: BLE001
            record("on", width, "S6", "walk completed", False, error=f"{type(e).__name__}: {str(e)[:300]}")


def walk_explainer(pg, ctx, base: str, width: int) -> None:
    P, tid = "on", "note-resurfaces"
    notes = ctx.request.get(base + "/api/j2/notes?limit=50").json()
    items = notes.get("notes", notes.get("items", notes)) if isinstance(notes, dict) else notes
    target = None
    for n in items or []:
        nid = n.get("id")
        vs = ctx.request.get(base + f"/api/j2/notes/{nid}/versions").json()
        vl = vs.get("versions", vs) if isinstance(vs, dict) else vs
        if vl:
            target = (nid, vl[0].get("id"))
            break
    if not target:
        # a saved version is made by editing; give the newest note one edit through its own door
        nid = (items or [{}])[0].get("id")
        record(P, width, tid, "a note with a saved version exists", False, note=nid)
        return
    pg.goto(base + f"/journal/notebook?note={target[0]}&resurfaceVersion={target[1]}",
            wait_until="domcontentloaded", timeout=60000)
    ex = pg.locator("[data-tour-explainer]")
    pg.evaluate(w.FOCUS_WATCH_JS.replace("[data-tour-offer]", "[data-tour-explainer]"))
    try:
        ex.first.wait_for(state="visible", timeout=20000)
    except Exception:  # noqa: BLE001
        record(P, width, tid, "the explainer shows when the resurfacing sheet first renders", False,
               shot=snap(pg, f"{tid}-{width}"))
        return
    pg.wait_for_timeout(1200)
    samples = pg.evaluate("() => window.__q1Focus || []")
    stolen = [x for x in samples if x["inOffer"]]
    role = ex.first.evaluate("e => [e.tagName, e.getAttribute('role'), e.getAttribute('aria-modal'), "
                             "!!e.closest('[role=dialog]')]")
    record(P, width, tid, "the explainer shows when the resurfacing sheet first renders", True,
           tag=role[0], role=role[1], in_sheet=role[3], shot=snap(pg, f"{tid}-{width}"))
    record(P, width, tid, "the explainer never takes focus", not stolen and bool(samples),
           frames=len(samples), frames_focus_in=len(stolen))
    record(P, width, tid, "not a dialog, not modal", role[1] is None and role[2] is None, tag=role[0])
    card_battery_explainer(pg, P, width, tid)
    w.wait_pref_post(pg, lambda: ex.first.get_by_role("button", name="Got it").click())
    rec = tours_rows(ctx, base).get(tid)
    record(P, width, tid, "Got it records done", bool(rec) and rec.get("state") == "done", row=rec)
    pg.reload(wait_until="domcontentloaded")
    pg.wait_for_timeout(4000)
    record(P, width, tid, "shown once per member (not again after reload)", ex.count() == 0)


def card_battery_explainer(pg, P, width, tid):
    pg.evaluate(MARK_CARD_JS)
    ov = pg.evaluate(w.OVERFLOW_JS)
    record(P, width, tid, "no horizontal overflow", not ov["horizontal"] and not ov["offenders"], **ov)
    if width <= w.TOUCH_MAX:
        tap = pg.evaluate(w.TAP_JS)
        record(P, width, tid, "controls >= --tap-min", bool(tap["tapMin"]) and not tap["small"], **tap)
    res = w.axe(pg)
    v = res.get("violations") or []
    record(P, width, tid, "axe on the explainer", not res.get("error") and not v,
           violation_ids=[f"{x['id']}({x['impact']})" for x in v], violations=v, error=res.get("error"))
    pg.evaluate("() => document.querySelectorAll('[data-q1-root]').forEach(e => e.removeAttribute('data-q1-root'))")


def accept_offer(pg, ctx, base, width, label, expect_id, expect_title, *, expect_open=True) -> None:
    P = "on"
    pg.goto(base + "/journal/notebook", wait_until="domcontentloaded", timeout=60000)
    h._dismiss_intro(pg)
    settle_home(pg)
    offer = pg.locator("[data-tour-offer]")
    # the "Meet Compass" card can arrive after settle_home looked, and holds the slot the offer
    # waits for (W14-C2 1.4); a member closes it with Got it, and so does the walk
    for _ in range(30):
        if offer.count():
            break
        if pg.evaluate(w.STAGE_JS)["slotOthers"]:
            try:
                pg.get_by_role("button", name="Got it", exact=True).first.click(timeout=2000)
            except Exception:  # noqa: BLE001
                pass
        pg.wait_for_timeout(500)
    try:
        offer.first.wait_for(state="visible", timeout=15000)
    except Exception:  # noqa: BLE001
        record(P, width, "S6", f"{label}: the offer appears", False, shot=snap(pg, f"S6-{label}-nooffer-{width}"),
               stage=pg.evaluate(w.STAGE_JS), notebook_tours=tours_rows(ctx, base))
        return
    offered = offer.first.locator("h2").inner_text()
    record(P, width, "S6", f"{label}: the offer appears", expect_title in offered, offered=offered)
    offer.first.get_by_role("button", name="Take the tour").click()
    st = wait_state(pg, expect_title, lambda s: s["kind"] in ("step", "unreachable"), 25)
    shot = snap(pg, f"S6-{label}-{width}")
    rows = tours_rows(ctx, base)
    if expect_open:
        record(P, width, "S6", f"{label}: accepting opens the tour", st["kind"] == "step",
               state=st, shot=shot, row=rows.get(expect_id))
        if st["kind"] == "step":
            pg.keyboard.press("Escape")
            pg.wait_for_timeout(800)
            # an in-app change of page remounts the shell (RouteErrorBoundary is keyed by
            # pathname): a closed tour must not come back with it
            pg.evaluate("() => { history.pushState({}, '', '/support'); window.dispatchEvent(new PopStateEvent('popstate')) }")
            pg.wait_for_timeout(3000)
            record(P, width, "S6", f"{label}: the closed tour does not reopen on the next in-app page change",
                   pg.locator("[data-tour-card]").count() == 0, url=pg.url)
    else:
        record(P, width, "S6", f"{label}: nothing to open -> the card says so, nothing recorded",
               st["kind"] == "unreachable" and expect_id not in rows, state=st, shot=shot, rows=rows)
        if st["kind"] == "unreachable":
            pg.get_by_role("button", name="Close", exact=True).first.click()
    sess = pg.evaluate("() => { const o = {}; for (let i = 0; i < sessionStorage.length; i++) { const k = sessionStorage.key(i);"
                       " if (/offer|tour/i.test(k)) o[k] = sessionStorage.getItem(k) } return o }")
    # back on Home in the SAME session: a spent offer must not be followed by a second one;
    # an unspent one may hand the session to the next tour.
    pg.goto(base + "/journal/notebook", wait_until="domcontentloaded", timeout=60000)
    settle_home(pg)
    pg.wait_for_timeout(2500)
    again = offer.first.locator("h2").inner_text() if offer.count() else None
    if expect_open:
        record(P, width, "S6", f"{label}: the session's offer is spent (no second offer this session)",
               again is None, second_offer=again, session=sess, row=tours_rows(ctx, base).get(expect_id))
    else:
        record(P, width, "S6", f"{label}: the offer was not spent on it", None, next_offer=again, session=sess,
               row=tours_rows(ctx, base).get(expect_id))


def walk_s6(browser, admin_req, base, width, height, registry) -> None:
    order = [t["id"] for t in registry if t["replayable"]]
    # A: the first offer a member with the sample meets (writing help, registry order)
    ctx, me, f = new_member(browser, admin_req, base, f"q2a{width}", width, height)
    pg = ctx.new_page()
    accept_offer(pg, ctx, base, width, "writing-help", "writing-help", "Writing help")
    ctx.close()
    # B: template gallery (every tour before it already seen, so it is the one offered)
    ctx, me, f = new_member(browser, admin_req, base, f"q2b{width}", width, height)
    mark_seen(ctx, base, order[:order.index("template-gallery")])
    pg = ctx.new_page()
    accept_offer(pg, ctx, base, width, "template-gallery", "template-gallery", "Template gallery")
    ctx.close()
    # C: writing help for a member with NO notes: nothing to open, the offer must not be spent
    ctx, me, f = new_member(browser, admin_req, base, f"q2c{width}", width, height, sample=False)
    pg = ctx.new_page()
    accept_offer(pg, ctx, base, width, "writing-help-no-notes", "writing-help", "Writing help", expect_open=False)
    ctx.close()


def phase_off(browser, admin_req, base: str) -> None:
    P = "off"
    for width, height in WIDTHS:
        ctx, me, facts = new_member(browser, admin_req, base, f"q2off{width}", width, height, sample=False)
        record(P, width, "setup", "member, switch OFF (onboarding on, getting started unset)",
               me.get("notebook_onboarding_enabled") is True and me.get("notebook_getting_started_enabled") is False,
               flags={k: me.get(k) for k in ("notebook_onboarding_enabled", "notebook_getting_started_enabled",
                                             "notebook_writing_help_enabled", "notebook_task_reminders_enabled")})
        pg = ctx.new_page()
        chunks: list[str] = []
        pg.on("response", lambda r: chunks.append(r.url.rsplit("/", 1)[-1]) if r.url.endswith(".js") else None)
        pg.goto(base + "/journal/notebook", wait_until="domcontentloaded", timeout=60000)
        h._dismiss_intro(pg)
        pg.get_by_role("heading", name="Welcome to your Notebook", level=2).first.wait_for(timeout=30000)
        pg.wait_for_timeout(2500)
        d = pg.locator("[role=dialog][aria-modal=true]")
        base_tour = d.count() > 0 and "Welcome to your Notebook" in (d.first.inner_text() or "")
        record(P, width, "first-run", "the wave-8 base tour still auto-starts (onboarding on)", base_tour)
        record(P, width, "first-run", "screenshot", None, shot=snap(pg, f"off-first-run-{width}"))
        if base_tour:
            pg.keyboard.press("Escape")
            pg.wait_for_timeout(600)
        settle_home(pg)
        pg.wait_for_timeout(2500)
        shape = pg.evaluate("""() => { const row = document.querySelector("[data-tour='first-run']");
            const root = row && row.parentElement;
            return { children: root ? [...root.children].map(e => e.tagName) : null,
                     buttons: row ? [...row.querySelectorAll('button')].map(b => b.innerText.trim()) : null } }""")
        none_w14 = {
            "preview": pg.get_by_role("heading", name="What your Notebook can do").count(),
            "checklist": pg.get_by_role("heading", name="Get started").count(),
            "offer": pg.locator("[data-tour-offer]").count(),
            "tour_card": pg.locator("[data-tour-card]").count(),
            "explainer": pg.locator("[data-tour-explainer]").count(),
        }
        record(P, width, "first-run", "no wave-14 surface (preview, checklist, offer, tour card, explainer)",
               not any(none_w14.values()), **none_w14, **shape)
        # Help
        pg.goto(base + "/support", wait_until="domcontentloaded", timeout=60000)
        pg.wait_for_timeout(3000)
        help_ = {"walkthroughs": pg.get_by_text("Walkthroughs", exact=True).count(),
                 "whats_new": pg.locator("section[aria-labelledby='support-whats-new']").count(),
                 "replay_links": pg.get_by_role("link", name="Replay", exact=True).count()}
        record(P, width, "Help", "no Walkthroughs, no What's new, no Replay", not any(help_.values()), **help_,
               shot=snap(pg, f"off-help-{width}"))
        # Home with notes, and an open note
        add_sample_status = add_sample(ctx, base)["status"]
        pg.goto(base + "/journal/notebook", wait_until="domcontentloaded", timeout=60000)
        settle_home(pg)
        pg.wait_for_timeout(3000)
        home = {"offer": pg.locator("[data-tour-offer]").count(), "tour_card": pg.locator("[data-tour-card]").count(),
                "checklist": pg.get_by_role("heading", name="Get started").count()}
        record(P, width, "Home", "no offer, tour card or checklist on Home with notes", not any(home.values()),
               sample_status=add_sample_status, **home, shot=snap(pg, f"off-home-{width}"))
        notes = ctx.request.get(base + "/api/j2/notes?limit=5").json()
        items = notes.get("notes", notes.get("items", notes)) if isinstance(notes, dict) else notes
        if items:
            pg.goto(base + f"/journal/notebook?note={items[0]['id']}", wait_until="domcontentloaded", timeout=60000)
            pg.wait_for_timeout(4000)
            note = {"offer": pg.locator("[data-tour-offer]").count(), "tour_card": pg.locator("[data-tour-card]").count(),
                    "explainer": pg.locator("[data-tour-explainer]").count()}
            record(P, width, "open note", "no tour, offer or explainer in an open note", not any(note.values()),
                   **note, shot=snap(pg, f"off-note-{width}"))
        eng = [c for c in chunks if c.startswith("GenericTourEngine") or ".steps" in c or re.match(r"(b1|chartPlan|planGrading)", c)]
        record(P, width, "bytes", "no tour engine or step chunk fetched with the switch off", not eng, fetched=eng)
        ctx.close()


def run_phase(phase: str, data_root: Path, port: int, registry, only) -> str | None:
    data_dir = data_root / phase
    if data_dir.exists() and any(data_dir.iterdir()):
        return f"{data_dir} is not empty"
    data_dir.mkdir(parents=True, exist_ok=True)
    for name in set(ARMED_ON + ARMED_OFF):
        os.environ.pop(name, None)
    armed = ARMED_ON if phase == "on" else ARMED_OFF
    os.environ.update({name: "1" for name in armed})
    for k in [k for k in os.environ if k.startswith("RAILWAY_")]:
        os.environ.pop(k, None)
    base = f"http://127.0.0.1:{port}"
    box = h.Sandbox(str(data_dir), port, w.OUT / f"sandbox-{phase}.log")
    box.start()
    not_run = None
    try:
        if not box.wait_healthy(base, 300):
            not_run = "the sandbox never answered /api/health"
        else:
            from playwright.sync_api import sync_playwright
            with sync_playwright() as p:
                browser = p.chromium.launch()
                admin = browser.new_context()
                try:
                    h._signup_or_login(admin.request, base, h.ADMIN_EMAIL, h.ADMIN_PW, "hubtest")
                    if phase == "on":
                        phase_on(browser, admin.request, base, registry, only)
                    else:
                        phase_off(browser, admin.request, base)
                finally:
                    admin.close()
                    browser.close()
    finally:
        how = box.stop()
    w.REPORT.setdefault("phases", {})[phase] = {"base": base, "stop_how": how, "not_run": not_run, "armed": armed}
    w._flush()
    return not_run


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--data-root", required=True)
    ap.add_argument("--port", type=int, default=8730)
    ap.add_argument("--out", required=True)
    ap.add_argument("--phases", default="on,off")
    ap.add_argument("--only", default="", help="comma list of tour ids (skips S6 unless S6 is named); --only S6 runs S6 alone")
    args = ap.parse_args(argv)
    why = h.refuse_shared_root(args.data_root)
    if why:
        print(f"REFUSED: {why}")
        return 3
    if args.port not in PORTS:
        print("REFUSED: this lane uses ports 8730-8734 only (never 8077)")
        return 3
    if h.port_busy(args.port):
        print(f"REFUSED: port {args.port} already has a listener")
        return 3
    w.OUT = Path(args.out)
    w.OUT.mkdir(parents=True, exist_ok=True)
    registry = read_registry()
    only = {x.strip() for x in args.only.split(",") if x.strip()} or None
    sha = subprocess.run(["git", "rev-parse", "HEAD"], cwd=str(REPO), capture_output=True, text=True).stdout.strip()
    w.REPORT.update({"tool": "tools/notebook_w14q2_tours_walk.py", "tree": sha,
                     "started": datetime.now(timezone.utc).isoformat(timespec="seconds"), "widths": WIDTHS,
                     "status": "INCOMPLETE (run did not finish)"})
    w._flush()
    not_run = []
    for phase in [p.strip() for p in args.phases.split(",") if p.strip()]:
        nr = run_phase(phase, Path(args.data_root), args.port, registry, only)
        if nr:
            not_run.append(f"{phase}: {nr}")
    w.REPORT.update({"finished": datetime.now(timezone.utc).isoformat(timespec="seconds"), "not_run": not_run,
                     "status": "COMPLETE" if not not_run else "NOT COMPLETE"})
    w._flush()
    rows = w.REPORT.get("rows", [])
    print("\nTOUR TABLE")
    for r in rows:
        print(f"  {r['width']:>4} {r['tour']:<22} opens={str(r.get('opens')):<5} shown={len(r.get('shown', []))}/"
              f"{r.get('declared')} skipped={[s['id'] + ':' + s['why'][:22] for s in r.get('skipped', [])]} "
              f"axe={r.get('battery', {}).get('axe')} notes={r.get('notes')}")
    print(f"raw log written: {w.OUT / 'walk.json'}")
    if not_run:
        print(f"VERDICT: NOT RUN -- {not_run}")
        return 3
    failed = [f"[{c['phase']} {c['width']}] {c['surface']}: {c['check']}" for c in w.CHECKS if c["verdict"] == "FAIL"]
    if failed:
        print(f"VERDICT: FAIL -- {len(failed)} of {len(w.CHECKS)} checks failed:\n  " + "\n  ".join(failed))
        return 1
    print(f"VERDICT: PASS -- {len(w.CHECKS)} checks")
    return 0


if __name__ == "__main__":
    sys.exit(main())
