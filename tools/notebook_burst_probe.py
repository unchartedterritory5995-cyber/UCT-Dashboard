#!/usr/bin/env python3
"""Typing-burst probe — can a 409 from a metadata door lose or fork a member's words?

Wave 10, lane 10C (F-5, ruling R-12). T-12 step 3 logged `PUT -> 409 "note changed —
refresh and retry"` then a landed PUT, on both production runs. The sandbox trace
(`t12_smoke_runner.py --base ... --trace-out`) reproduced it: the TAG door's
`PATCH /notes/{id}/tags` advances the note's revision, the editor's next body save
still carries the PRE-tag baseline, 409s, and `reconcileConflict` resends. R-12 lifts
the F5 freeze only if that 409 can LOSE or FORK words. This probe asks, harder than
T-12 does: it applies metadata changes in the MIDDLE of typing, back to back, and
repeats, then judges every run from the network trace plus a reload:

  * LOSS  — any typed fragment absent from the note after a reload
  * FORK  — any "(conflicted copy)" note exists afterwards
  * TAGS  — a tag the member added is gone after the body save that followed it
  * an UNSETTLED 409 — a 409 on the note's PUT never followed by a landed PUT
  * "Save failed" shown to the member at any point (reported, not a loss by itself)

SANDBOX ONLY. It refuses production, proves the sandbox's identity by its nonce, and
signs in as the local sandbox member `t12_smoke_runner.py` provisions. Raw per-run
traces go to `--out` (R-RAW) before any summary is printed.

    python tools/notebook_burst_probe.py --base http://127.0.0.1:8213 \\
        --integrity-log <path the launcher printed> --runs 3 --out <evidence dir>
    python tools/notebook_burst_probe.py --self-check
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import pathlib
import sys
import time

REPO = pathlib.Path(__file__).resolve().parents[1]
PROD = "https://uctintelligence.com"

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except (AttributeError, ValueError):
    pass


def _t12():
    spec = importlib.util.spec_from_file_location("t12", REPO / "tools" / "t12_smoke_runner.py")
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


# Each scenario: a list of actions. ("type", text) types at the END of the body;
# ("tag", name) adds a tag through the member's tag input; ("ticker", sym) sets the
# ticker through its input. The fragments typed are what must survive.
SCENARIOS = {
    "t12-shape": [("tag", "t12-smoke"), ("type", "The pre-launch smoke run typed this sentence.")],
    "tag-mid-typing": [("type", "First half typed before the tag,"), ("tag", "mid-a"),
                       ("type", " second half typed after it.")],
    "two-tags-back-to-back": [("type", "Words before two tags,"), ("tag", "burst-a"), ("tag", "burst-b"),
                              ("type", " words after both tags.")],
    "ticker-mid-typing": [("type", "Before the ticker,"), ("ticker", "NVDA"),
                          ("type", " after the ticker.")],
}


def judge(t12, calls, note_id, titles_after, body_after, fragments, tags_after, tags_added,
          save_failed_seen) -> dict:
    """Pure: one run's evidence -> its verdict. Built on the T-12 typing-burst rail."""
    missing = [f for f in fragments if f.strip() and f.strip() not in body_after]
    base = t12.burst_verdict(calls, note_id, titles_after, sentence_present=not missing)
    unread = list(base.get("unread") or [])
    # ⛔ An unread tag list (None) is not an empty one -- wave 10 10C fix round 1.
    if tags_after is None and tags_added:
        unread.append("the note's stored tags could not be read")
        lost_tags = []
    else:
        lost_tags = [t for t in tags_added if t not in (tags_after or [])]
    problems = list(base["problems"])
    if missing:
        problems = [p for p in problems if not p.startswith("LOSS")]
        problems.insert(0, f"LOSS: {len(missing)} typed fragment(s) absent after reload: {missing}")
    if lost_tags:
        problems.append(f"TAG LOSS: {lost_tags} absent after the save that followed them")
    # ⚰️ This read `"FAIL" if problems else "PASS"`, which turned the rail's
    # INCONCLUSIVE (an unread note list) back into a pass.
    verdict = "FAIL" if problems else ("INCONCLUSIVE" if unread else "PASS")
    return {**base, "verdict": verdict, "problems": problems, "unread": unread,
            "missing_fragments": missing, "lost_tags": lost_tags, "save_failed_seen": save_failed_seen}


def self_check() -> int:
    t12 = _t12()
    ok = True

    def case(name, cond):
        nonlocal ok
        ok = ok and cond
        print(f"  {'ok  ' if cond else 'FAIL'} {name}")

    path = "/api/j2/notes/n"
    put = {"m": "PUT", "u": path, "status": 200}
    c409 = {"m": "PUT", "u": path, "status": 409}
    good = judge(t12, [put, c409, put], "n", ["x"], "alpha beta", ["alpha", "beta"], ["a"], ["a"], False)
    case("a settled 409 with every fragment and tag present -> PASS", good["verdict"] == "PASS")
    case("a missing fragment -> FAIL (loss)",
         judge(t12, [put], "n", ["x"], "alpha", ["alpha", "beta"], ["a"], ["a"], False)["verdict"] == "FAIL")
    case("a conflicted copy -> FAIL (fork)",
         judge(t12, [put], "n", ["x (conflicted copy)"], "alpha", ["alpha"], [], [], False)["verdict"] == "FAIL")
    case("an unread note list -> INCONCLUSIVE, never a pass",
         judge(t12, [put], "n", None, "alpha", ["alpha"], [], [], False)["verdict"] == "INCONCLUSIVE")
    case("unread stored tags -> INCONCLUSIVE, never a pass",
         judge(t12, [put], "n", ["x"], "alpha", ["alpha"], None, ["a"], False)["verdict"] == "INCONCLUSIVE")
    case("a tag gone after the save -> FAIL",
         judge(t12, [put], "n", ["x"], "alpha", ["alpha"], [], ["a"], False)["verdict"] == "FAIL")
    case("an unsettled 409 -> FAIL",
         judge(t12, [put, c409], "n", ["x"], "alpha", ["alpha"], [], [], False)["verdict"] == "FAIL")
    print("self-check:", "PASS" if ok else "FAIL")
    return 0 if ok else 1


def _open_new_note(page, base: str, title: str) -> str | None:
    page.goto(base + "/journal/notebook", wait_until="domcontentloaded")
    page.wait_for_timeout(5000)
    made = page.evaluate("""async () => {
      const find = () => [...document.querySelectorAll('button,[role=button],a')].find(x =>
        /start a note|new note|create note/i.test(((x.innerText||'') + ' ' + (x.getAttribute('aria-label')||'')).trim()));
      let b = find();
      if (!b) {
        const all = [...document.querySelectorAll('button,[role=button],a,li,div,span')]
          .find(x => (x.innerText||'').trim() === 'All notes');
        if (all) { (all.closest('button,[role=button],a,li') || all).click(); await new Promise(r => setTimeout(r, 3000)); b = find(); }
      }
      if (!b) return false;
      b.click();
      await new Promise(r => setTimeout(r, 4000));
      return true;
    }""")
    if not made:
        return None
    tbox = page.query_selector('input[placeholder*="title" i], textarea[placeholder*="title" i]')
    if tbox is None:
        return None
    tbox.click()
    page.keyboard.type(title)
    page.wait_for_timeout(1500)
    return page.evaluate("() => new URLSearchParams(location.search).get('note')")


def _dismiss_first_run_hints(page) -> list[str]:
    """Dismiss the one-time hints a member dismisses once (the voice-dictation "New:"
    popover, the "Meet Compass" card). ⛔ Recorded: on 2026-09-26 the voice hint sat over
    the tag input once a tag chip had pushed the input right, and a click on the tag
    input timed out behind it (a surface finding in the 10C report)."""
    return page.evaluate("""() => {
      const done = [];
      for (const el of [...document.querySelectorAll('button,[role=button]')]) {
        const label = ((el.getAttribute('aria-label')||'') + ' ' + (el.innerText||'')).trim();
        const inHint = el.closest('[role=status],[role=dialog],[class*="hint" i],[class*="coach" i]');
        if (/^got it$/i.test((el.innerText||'').trim()) || (inHint && /dismiss|close|✕|×/i.test(label))) {
          el.click(); done.push(label.slice(0, 40));
        }
      }
      return done;
    }""")


def _type_at_end(page, text: str) -> None:
    pm = page.query_selector(".ProseMirror")
    pm.click()
    page.keyboard.press("Control+End")
    page.keyboard.type(text)


class ControlBlocked(Exception):
    """The member's control could not be clicked: something covered it. A finding about
    the SURFACE, recorded with a screenshot -- never a verdict about the 409."""


def _click_or_blocked(page, box, what: str, timeout_ms: int = 12000) -> None:
    try:
        box.click(timeout=timeout_ms)
    except Exception as e:  # noqa: BLE001 -- Playwright TimeoutError: an element intercepts
        raise ControlBlocked(f"{what} could not be clicked for {timeout_ms / 1000:.0f} s: "
                             f"{str(e).splitlines()[0][:160]}") from e


def _add_tag(page, tag: str) -> bool:
    box = page.query_selector('input[placeholder*="tag" i]')
    if box is None:
        return False
    _click_or_blocked(page, box, "the tag input")
    page.keyboard.type(tag)
    page.keyboard.press("Enter")
    return True


def _set_ticker(page, sym: str) -> bool:
    box = page.query_selector('input[placeholder="Ticker"], input[placeholder*="ticker" i]')
    if box is None:
        return False
    _click_or_blocked(page, box, "the ticker input")
    page.keyboard.type(sym)
    page.keyboard.press("Enter")
    return True


def run_scenario(t12, page, run, base: str, name: str, actions, idx: int,
                 run_dir: pathlib.Path) -> dict:
    title = f"burst {name} {idx}"
    mark = len(run.calls)
    note_id = _open_new_note(page, base, title)
    if not note_id:
        return {"scenario": name, "run": idx, "verdict": "INCONCLUSIVE",
                "problems": ["could not create a note through the member's control"]}
    page.wait_for_timeout(800)
    _dismiss_first_run_hints(page)
    fragments, tags_added, save_failed = [], [], False
    blocked = None
    for kind, arg in actions:
        try:
            if kind == "type":
                _type_at_end(page, arg)
                fragments.append(arg)
            elif kind == "tag":
                if _add_tag(page, arg):
                    tags_added.append(arg)
            elif kind == "ticker":
                _set_ticker(page, arg)
        except ControlBlocked as e:
            blocked = str(e)
            shot = run_dir / f"blocked-{name}-{idx}.png"
            try:
                page.screenshot(path=str(shot))
            except Exception:  # noqa: BLE001
                pass
            break
        page.wait_for_timeout(400)
        save_failed = save_failed or page.evaluate("() => /Save failed/i.test(document.body.innerText||'')")
    if blocked:
        return {"scenario": name, "run": idx, "note_id": note_id, "verdict": "INCONCLUSIVE",
                "problems": [f"CONTROL BLOCKED: {blocked}"],
                "calls": [{k: v for k, v in c.items() if k != "_req"} for c in run.calls[mark:]
                          if "/api/j2/notes" in c["u"]]}
    for _ in range(12):
        page.wait_for_timeout(500)
        save_failed = save_failed or page.evaluate("() => /Save failed/i.test(document.body.innerText||'')")
    page.reload(wait_until="domcontentloaded")
    try:
        page.wait_for_selector(".ProseMirror", timeout=15000)
    except Exception:  # noqa: BLE001
        pass
    page.wait_for_timeout(3000)
    body_after = page.evaluate("() => (document.querySelector('.ProseMirror')||{}).innerText || ''")
    # INSTRUMENT READS (not member actions): the stored tags, and every live title.
    tags_after = page.evaluate("""async (id) => {
      const r = await fetch('/api/j2/notes/' + id, {credentials:'include'});
      return r.ok ? ((await r.json()).note || {}).tags || [] : null }""", note_id)
    titles = t12._titles_after(page)
    calls = run.calls[mark:]
    verdict = judge(t12, calls, note_id, titles, body_after, fragments, tags_after, tags_added, save_failed)
    return {"scenario": name, "run": idx, "note_id": note_id, **verdict,
            "calls": [{k: v for k, v in c.items() if k != "_req"} for c in calls if "/api/j2/notes" in c["u"]]}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base")
    ap.add_argument("--integrity-log")
    ap.add_argument("--runs", type=int, default=3)
    ap.add_argument("--scenarios", default=",".join(SCENARIOS))
    ap.add_argument("--out")
    ap.add_argument("--self-check", action="store_true")
    args = ap.parse_args()
    if args.self_check:
        return self_check()
    base = (args.base or "").rstrip("/")
    if not base or base == PROD or "uctintelligence.com" in base:
        print("REFUSED: the burst probe runs against a SANDBOX --base only, never production.")
        return 2
    sys.path.insert(0, str(REPO / "scripts"))
    import sandbox_identity as sid
    ver = sid.verify(base, args.integrity_log or "")
    print(f"sandbox identity: {'PROVEN' if ver.ok else 'NOT PROVEN'} -- {ver.sentence}")
    if not ver.ok:
        return 3
    t12 = _t12()
    t12.BASE = base
    out = pathlib.Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    from playwright.sync_api import sync_playwright
    with sync_playwright() as pw:
        why = t12.provision_sandbox_member(pw, base)
        if why:
            print(f"INCONCLUSIVE: could not provision the sandbox member: {why}")
            return 3
    results = []
    with sync_playwright() as pw:
        b = pw.chromium.launch(headless=True)
        ctx = b.new_context(viewport={"width": 1440, "height": 900})
        page = ctx.new_page()
        run = t12.Run("sandbox-member", time.strftime("%Y%m%dT%H%M%S"), trace=True)
        run.watch(page)
        v, d = t12.step0_sign_in(page, run, (t12.SANDBOX_MEMBER[0], t12.SANDBOX_MEMBER[1]))
        if v != "PASS":
            print(f"INCONCLUSIVE: sign-in failed: {d}")
            return 3
        for name in args.scenarios.split(","):
            for i in range(args.runs):
                r = run_scenario(t12, page, run, base, name, SCENARIOS[name], i, out)
                results.append(r)
                # R-RAW: each run's raw trace is on disk before the summary exists.
                (out / "burst-probe-raw.json").write_text(json.dumps(results, indent=2, default=str),
                                                          encoding="utf-8")
                print(f"  {r['verdict']:12s} {name} #{i}: 409s={r.get('conflicts_409')} "
                      f"unsettled={r.get('unsettled_409')} forks={len(r.get('forks') or [])} "
                      f"save_failed_seen={r.get('save_failed_seen')} "
                      + ("; ".join(r.get("problems") or []))[:200])
        ctx.close()
        b.close()
    fails = [r for r in results if r["verdict"] == "FAIL"]
    inconcl = [r for r in results if r["verdict"] == "INCONCLUSIVE"]
    total409 = sum(r.get("conflicts_409") or 0 for r in results)
    print(f"BURST PROBE: {len(results)} run(s), {len(fails)} FAIL, {len(inconcl)} INCONCLUSIVE, "
          f"{total409} 409(s) observed in total")
    return 1 if fails else (2 if inconcl else 0)


if __name__ == "__main__":
    raise SystemExit(main())
