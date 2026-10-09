"""Production check of the Notebook's AI doors, as the smoke account, on ONE note the run creates
and removes.

What it proves, on the LIVE site, in one run of about a minute:
  * Research Home carries an Ask door for a member with notes (fin-walk 8.3; the quiet-home fix).
  * A whole-Notebook question is answered FROM A NOTE: the answer carries both numbers the note
    holds, cites the note, and the citation opens it (G-051 on production; K1's shape).
  * Inside that note, Ask about this note answers from it (G-050 on production).
  * Writing help on that note drafts a summary and Discard adds nothing to the note (G-165 on
    production; ruling D-H1, the draft lives in the panel until Accept).
  * The note the run created is removed again (the smoke-account rule: whatever a run creates,
    that run removes).

Preconditions, the same as `tools/hub_nav_smoke.py --auth`:
  * `SMOKE_EMAIL` / `SMOKE_PASSWORD` in the operator's environment (never in the repo, a log or a
    commit). The account is asserted SYNTHETIC from `/api/auth/me` -- its email must end in
    `@uctintelligence.internal` -- before anything is written or clicked. Any other account stops
    the run with exit 2 and writes nothing.
  * Playwright with Chromium installed (the repo's Python environment has it).
  * `NOTEBOOK_WRITING_HELP_ENABLED=1` on the service, or the writing-help leg reads as
    INCONCLUSIVE (the button is not rendered while the switch is off) and the run exits 2.

What it writes to production, and removes: ONE note, titled so a human reading the trash knows
what it was, with synthetic text (a made-up ticker `ZZZT`, two numbers, one rule). Created through
`POST /api/j2/notes`, removed in a `finally` block through `DELETE /api/j2/notes/{id}` -- the
product's own soft delete, so it lands in the trash like any member deletion -- and checked gone
(`GET` answers 404). Three model calls: two questions and one summary draft that is discarded.
Writing help spends one of the member's 60 daily calls; the smoke account is nobody's.

Exit codes, three facts (the same split as `hub_nav_smoke.py`; H15 never fires on a 2):
  0  PASS           every leg measured and healthy
  1  FAIL           a measured failure: no door, an error/limit message, an answer without the
                    numbers or without a citation, a citation that opened nothing, a note-scoped
                    answer without the stop, an empty draft, or Discard changing the note
  2  INCONCLUSIVE   not signed in, wrong account domain, the note could not be created, a page or
                    an answer never arrived, the writing-help door not rendered

Evidence: `--out <dir>` writes `result.json` + screenshots there; the default is a temp directory
printed at the end. The repo does not grow one directory per run.

Usage
-----
    python tools/notebook_prod_ask_check.py                 # production
    python tools/notebook_prod_ask_check.py --base http://127.0.0.1:8700
    python tools/notebook_prod_ask_check.py --out docs/notebook/evidence/prod-ask/2026-10-08
    python tools/notebook_prod_ask_check.py --self-check    # rule 14: the verdict can fail

Rule 14 (`--self-check`): the verdict is a pure function of what was measured, and the self-check
feeds it each failing shape and asserts each one is a 1, and the healthy shape a 0. A probe whose
verdict cannot go red is a probe that would report a dead door as PASS.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import tempfile
import time
from pathlib import Path

PROD = "https://uctintelligence.com"
SYNTHETIC_DOMAIN = "@uctintelligence.internal"
TITLE = "Smoke check: ZZZT plan (automated, removed by the run)"
TEXT = ("ZZZT plan. Planned entry 41.20 on a close above the 10-day high. Stop 39.80, under the "
        "last swing low. Rule for this trade: no adds until two closes above 43.")
QUESTION = "What are my planned entry and my stop for ZZZT, and what is my rule for the trade?"
EXPECT = ("41.20", "39.80")
NOTE_QUESTION = "What is my stop for ZZZT?"
NOTE_EXPECT = "39.80"
DRAFT_PLACEHOLDERS = ("The draft appears here.", "Writing…")


def verdict(*, doors: int, alert: str, answer: str, sources: int, cited_opened: bool | None,
            note_answer: str = NOTE_EXPECT, note_alert: str = "", draft: str = "x",
            help_alert: str = "", note_unchanged: bool = True,
            home_state: str = "full") -> tuple[int, str]:
    """The one place a measurement becomes a code. Pure, so `--self-check` can feed it."""
    if doors == 0:
        return 1, "no Ask door on Research Home for a member with notes"
    if alert:
        return 1, f"the panel showed: {alert}"
    if not answer.strip():
        return 1, "empty answer"
    if not all(x in answer for x in EXPECT):
        return 1, "the answer did not carry both numbers from the note"
    if sources == 0:
        return 1, "the answer cited nothing"
    if cited_opened is False:
        return 1, "the citation did not open the cited note"
    if note_alert:
        return 1, f"Ask inside the note showed: {note_alert}"
    if NOTE_EXPECT not in note_answer:
        return 1, "Ask inside the note did not carry the stop"
    if help_alert:
        return 1, f"writing help showed: {help_alert}"
    if not draft.strip() or draft.strip() in DRAFT_PLACEHOLDERS:
        return 1, "writing help produced no draft"
    if not note_unchanged:
        return 1, "Discard changed the note"
    return 0, (f"door present ({home_state} home); whole-Notebook answer with both numbers, "
               f"{sources} source(s), citation opened the note; Ask inside the note carried the stop; "
               f"writing help drafted and Discard left the note unchanged; note removed")


def self_check() -> int:
    healthy = dict(doors=1, alert="", answer=f"Entry {EXPECT[0]}, stop {EXPECT[1]}.", sources=1,
                   cited_opened=True, note_answer=f"Your stop is {NOTE_EXPECT}.", note_alert="",
                   draft="A short summary of the plan.", help_alert="", note_unchanged=True)
    cases = [
        ("healthy", healthy, 0),
        ("no door", {**healthy, "doors": 0}, 1),
        ("alert shown", {**healthy, "alert": "Ask is unavailable right now."}, 1),
        ("empty answer", {**healthy, "answer": "   "}, 1),
        ("a number missing", {**healthy, "answer": f"Entry {EXPECT[0]} only."}, 1),
        ("no citation", {**healthy, "sources": 0}, 1),
        ("citation opened nothing", {**healthy, "cited_opened": False}, 1),
        ("note-scoped alert", {**healthy, "note_alert": "limit"}, 1),
        ("note-scoped answer without the stop", {**healthy, "note_answer": "I couldn't find that."}, 1),
        ("writing help alert", {**healthy, "help_alert": "You've used today's writing help"}, 1),
        ("empty draft", {**healthy, "draft": "The draft appears here."}, 1),
        ("Discard changed the note", {**healthy, "note_unchanged": False}, 1),
    ]
    bad = 0
    for name, kw, want in cases:
        code, why = verdict(**kw)
        ok = code == want
        bad += 0 if ok else 1
        print(f"  {'ok ' if ok else 'BAD'} {name}: {code} ({why})")
    print("SELF-CHECK " + ("PASS" if not bad else f"FAIL ({bad})"))
    return 0 if not bad else 1


def _ask(page, scope: str, question: str, out: Path, tag: str, step) -> tuple[str, str, int]:
    """Open the Ask door for `scope`, ask, wait. Returns (answer, alert, sources)."""
    page.locator(f"[data-ask-toggle][aria-label='Ask a question about {scope}']").first.click()
    input_id = "#ask-input-" + ("notebook" if scope == "my notebook" else "note")
    page.wait_for_selector(input_id, timeout=15_000)
    page.fill(input_id, question)
    page.get_by_role("button", name="Ask", exact=True).click()
    step(f"asked_{tag}")
    page.wait_for_selector('[data-testid="ask-answer"][aria-busy="false"], [role="alert"]', timeout=120_000)
    alert = page.locator('[role="alert"]')
    alert_text = alert.first.inner_text()[:300] if alert.count() else ""
    ans_loc = page.locator('[data-testid="ask-answer"]')
    answer = ans_loc.first.inner_text() if ans_loc.count() else ""
    sources = page.locator('[data-testid="ask-sources"] button').count()
    page.screenshot(path=str(out / f"{tag}.png"), full_page=True)
    return answer, alert_text, sources


def run(base: str, out: Path) -> int:
    from playwright.sync_api import sync_playwright  # noqa: PLC0415

    email = os.environ.get("SMOKE_EMAIL")
    pw = os.environ.get("SMOKE_PASSWORD")
    if not email or not pw:
        print("INCONCLUSIVE: SMOKE_EMAIL / SMOKE_PASSWORD not in the environment")
        return 2
    out.mkdir(parents=True, exist_ok=True)
    rec: dict = {"base": base, "steps": []}
    t0 = time.time()

    def step(name, **kw):
        kw["t"] = round(time.time() - t0, 1)
        rec["steps"].append({"name": name, **kw})
        print(f"  {name}: {json.dumps(kw)}")

    def finish(code: int, why: str) -> int:
        rec["verdict"] = {"code": code, "why": why}
        (out / "result.json").write_text(json.dumps(rec, indent=1), encoding="utf-8")
        print(f"evidence: {out}")
        print(("PASS: " if code == 0 else "FAIL: " if code == 1 else "INCONCLUSIVE: ") + why)
        return code

    with sync_playwright() as p:
        br = p.chromium.launch()
        ctx = br.new_context(viewport={"width": 1280, "height": 900})
        page = ctx.new_page()
        errors: list[str] = []
        page.on("pageerror", lambda e: errors.append(str(e)[:200]))
        api = page.request

        r = api.post(f"{base}/api/auth/login", data=json.dumps({"email": email, "password": pw}),
                     headers={"Content-Type": "application/json"})
        step("login", status=r.status)
        if not r.ok:
            return finish(2, "sign-in refused")
        me = api.get(f"{base}/api/auth/me")
        try:
            body = me.json()
            who = (body.get("user") or {}).get("email") or body.get("email") or ""
        except Exception:
            who = ""
        domain_ok = who.endswith(SYNTHETIC_DOMAIN)
        step("me", status=me.status, synthetic_domain=domain_ok)
        if not domain_ok:
            return finish(2, "not the synthetic smoke account; nothing written")

        note_id = None
        try:
            doc = {"type": "doc", "content": [{"type": "paragraph", "content": [{"type": "text", "text": TEXT}]}]}
            c = api.post(f"{base}/api/j2/notes", data=json.dumps({"title": TITLE, "bodyJson": doc}),
                         headers={"Content-Type": "application/json"})
            try:
                note_id = (c.json().get("note") or {}).get("id")
            except Exception:
                note_id = None
            step("note_created", status=c.status, id_present=bool(note_id))
            if not note_id:
                return finish(2, "the check note could not be created")

            # Leg A: the home's door and a whole-Notebook question.
            page.goto(f"{base}/journal/notebook", wait_until="domcontentloaded", timeout=60_000)
            try:
                page.wait_for_selector("[data-ask-toggle], h2:has-text('Welcome to your Notebook')", timeout=45_000)
            except Exception as e:
                page.screenshot(path=str(out / "home-timeout.png"), full_page=True)
                step("home", settled=False, error=str(e)[:160])
                return finish(2, "Research Home never settled")
            quiet = page.get_by_text("Nothing needs your attention right now.").count() > 0
            full = page.get_by_text("Continue working").count() > 0
            doors = page.locator("[data-ask-toggle]").count()
            home_state = "quiet" if quiet else "full" if full else "other"
            rec["home_state"] = home_state
            step("home", state=home_state, ask_doors=doors)
            page.screenshot(path=str(out / "home.png"), full_page=True)
            if doors == 0:
                return finish(*verdict(doors=0, alert="", answer="", sources=0, cited_opened=None))
            try:
                answer, alert_text, sources = _ask(page, "my notebook", QUESTION, out, "answer", step)
            except Exception as e:
                page.screenshot(path=str(out / "ask-timeout.png"), full_page=True)
                step("answer", arrived=False, error=str(e)[:160])
                return finish(2, "no whole-Notebook answer within 120 s")
            step("answer", chars=len(answer), sources=sources, numbers=all(x in answer for x in EXPECT),
                 alert=alert_text, page_errors=len(errors))
            rec.update({"answer_excerpt": answer[:500], "sources": sources, "alert": alert_text})

            cited_opened: bool | None = None
            if sources:
                page.locator('[data-testid="ask-sources"] button').first.click()
                try:
                    page.wait_for_url(lambda u: note_id in u, timeout=15_000)
                    cited_opened = True
                except Exception:
                    cited_opened = note_id in page.url
                step("citation_opens_note", opened=cited_opened)
                page.screenshot(path=str(out / "cited-note.png"), full_page=True)
            rec["cited_opened"] = cited_opened
            early = verdict(doors=doors, alert=alert_text, answer=answer, sources=sources, cited_opened=cited_opened,
                            home_state=home_state)
            if early[0] != 0:
                return finish(*early)

            # Leg B: Ask inside the note (we are on it: the citation opened it).
            try:
                page.wait_for_selector("[data-ask-toggle][aria-label='Ask a question about this note']", timeout=30_000)
                note_answer, note_alert, _ = _ask(page, "this note", NOTE_QUESTION, out, "note-answer", step)
            except Exception as e:
                page.screenshot(path=str(out / "note-ask-timeout.png"), full_page=True)
                step("note_answer", arrived=False, error=str(e)[:160])
                return finish(2, "no note-scoped answer within 120 s")
            step("note_answer", chars=len(note_answer), has_stop=NOTE_EXPECT in note_answer, alert=note_alert)
            rec.update({"note_answer_excerpt": note_answer[:300], "note_alert": note_alert})
            page.get_by_role("button", name="Close Ask").first.click()

            # Leg C: writing help, Summarize, then Discard. The note must not change.
            before = api.get(f"{base}/api/j2/notes/{note_id}").text()
            wh = page.locator("button[aria-label='Writing help']")
            if wh.count() == 0:
                step("writing_help", door=False)
                return finish(2, "the Writing help door is not rendered (switch off, or the note is locked)")
            wh.first.click()
            try:
                page.wait_for_selector("[role='group'][aria-label='What should Compass do?']", timeout=15_000)
                page.get_by_role("button", name="Summarize", exact=True).click()
                page.get_by_role("button", name="Write it", exact=True).click()
                step("writing_help_asked")
                page.wait_for_function(
                    """() => {
                        const r = document.querySelector("[role='region'][aria-label='Draft preview']");
                        const a = document.querySelector("[role='alert']");
                        if (a) return true;
                        if (!r || r.getAttribute('aria-busy') === 'true') return false;
                        const t = (r.innerText || '').trim();
                        return t && t !== 'The draft appears here.' && t !== 'Writing…';
                    }""", timeout=120_000)
            except Exception as e:
                page.screenshot(path=str(out / "writing-help-timeout.png"), full_page=True)
                step("writing_help", arrived=False, error=str(e)[:160])
                return finish(2, "no writing-help draft within 120 s")
            help_alert_loc = page.locator("[role='alert']")
            help_alert = help_alert_loc.first.inner_text()[:300] if help_alert_loc.count() else ""
            draft = page.locator("[role='region'][aria-label='Draft preview']").first.inner_text()
            page.screenshot(path=str(out / "writing-help.png"), full_page=True)
            step("writing_help", draft_chars=len(draft.strip()), alert=help_alert)
            rec.update({"draft_excerpt": draft[:300], "help_alert": help_alert})
            discard = page.get_by_role("button", name="Discard", exact=True)
            if discard.count():
                discard.first.click()
            else:
                page.get_by_role("button", name="Cancel", exact=True).first.click()
            page.wait_for_timeout(1500)  # a settle for any autosave the panel might (must not) cause
            after = api.get(f"{base}/api/j2/notes/{note_id}").text()
            note_unchanged = before == after
            step("discard", note_unchanged=note_unchanged)
            rec["note_unchanged"] = note_unchanged

            return finish(*verdict(doors=doors, alert=alert_text, answer=answer, sources=sources,
                                   cited_opened=cited_opened, note_answer=note_answer, note_alert=note_alert,
                                   draft=draft, help_alert=help_alert, note_unchanged=note_unchanged,
                                   home_state=home_state))
        finally:
            if note_id:
                d = api.delete(f"{base}/api/j2/notes/{note_id}")
                g = api.get(f"{base}/api/j2/notes/{note_id}")
                step("note_removed", delete_status=d.status, get_after=g.status)
                rec["note_removed"] = {"delete": d.status, "get_after": g.status}
                (out / "result.json").write_text(json.dumps(rec, indent=1), encoding="utf-8")
            ctx.close()
            br.close()


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--base", default=PROD)
    ap.add_argument("--out", default=None, help="evidence directory (default: a temp directory)")
    ap.add_argument("--self-check", action="store_true", help="rule 14: prove the verdict can fail")
    args = ap.parse_args(argv)
    if args.self_check:
        return self_check()
    out = Path(args.out) if args.out else Path(tempfile.mkdtemp(prefix="prod-ask-"))
    return run(args.base, out)


if __name__ == "__main__":
    sys.exit(main())
