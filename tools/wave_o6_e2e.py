"""Wave O6 §20-§23 — can the member FIND, and be ANSWERED FROM, what they decided?

Wave O's own flagship harness proves the review loop: open a thesis, weigh the
evidence, record a judgement, come back and see what changed. It stops there.
This one starts there, and asks the two questions a member asks next:

    §20  I wrote something in a review three months ago. Can I find it?
    §21  What did I decide last time? And the time before that? And when?

plus the two controls that decide whether the answers can be trusted:

    §22  a question about NVDA must never reach an AAPL review
    §23  an OLD decision must never be presented as the current thesis

⛔⛔ THE INSTRUMENTATION DOCTRINE (§62), inherited and still load-bearing:

  · WAIT ON SEMANTIC STATE, never a sleep.
  · UNIQUE MARKERS. Every string this harness looks for carries a per-run
    token, so a match cannot be another run's leftovers.
  · SCOPE THE PROBE. A whole-page word check catches legitimate copy — the
    words "thesis" and "review" are all over this product.
  · CASE-INSENSITIVE where CSS `text-transform` renders the string. Wave N and
    Wave O each lost a run to exactly that.
  · THE HARNESS MUST REPORT ON RED. stdout is UTF-8 before anything quotes a
    page.

⛔ AND IT CARRIES ITS OWN NEGATIVE CONTROL. Step S0 searches for a token that
was never written and requires the review section to be ABSENT. Without it,
"the section appeared" could be satisfied by a section that always appears, and
the whole §20 block would be unfalsifiable
(`lesson_a_fixture_that_cannot_distinguish_is_not_a_rail`).

    python tools/local_backend_sandbox.py --port 8077
    python tools/wave_o6_e2e.py --base http://127.0.0.1:8077
"""
from __future__ import annotations

import argparse
import json
import pathlib
import re
import sys
import time
import uuid

OUT_DIR = pathlib.Path(__file__).parent / "wave_o6_e2e_out"
DESKTOP = {"width": 1440, "height": 900}

TOKEN = "zq" + uuid.uuid4().hex[:8]

# ⛔ THREE DISTINCT MARKERS, ONE PER REVIEW, so "which review answered" is a
# string comparison rather than a judgement call. NEVERWRITTEN is the negative
# control's token and is deliberately never stored anywhere.
OLD_MARK = f"kimberlite{TOKEN}"      # NVDA, older review — an INVALIDATED view
NEW_MARK = f"gabbro{TOKEN}"          # NVDA, newer review — the current view
AAPL_MARK = f"laterite{TOKEN}"       # AAPL review, sharing the SHARED word
SHARED = f"tailings{TOKEN}"          # appears in the NVDA *and* AAPL reviews
NEVERWRITTEN = f"olivine{TOKEN}"

OLD_NOTE = (f"{OLD_MARK}: I no longer believe the datacenter build-out story, "
            f"and the {SHARED} numbers are why.")
NEW_NOTE = (f"{NEW_MARK}: back to where I started — the thesis holds, and the "
            f"{SHARED} numbers turned out fine.")
AAPL_NOTE = (f"{AAPL_MARK}: services growth is the whole case now, and the "
             f"{SHARED} numbers barely matter here.")



class Findings:
    def __init__(self) -> None:
        self.items: list[str] = []
        self.steps: dict[str, object] = {}

    def fail(self, step: str, msg: str) -> None:
        self.items.append(f"{step}: {msg}")

    def note(self, step: str, **kw) -> None:
        cur = self.steps.setdefault(step, {})
        if isinstance(cur, dict):
            cur.update(kw)

    def check(self, step: str, cond: bool, msg: str) -> bool:
        if not cond:
            self.fail(step, msg)
        return bool(cond)


def api(ctx, method, path, base, **kw):
    return getattr(ctx.request, method.lower())(f"{base}{path}", **kw)


def jbody(resp):
    try:
        return resp.json()
    except Exception:  # noqa: BLE001
        return {}


def _dismiss_intro(page) -> None:
    """The cinematic intro plays ~9.3s on every load and covers the app."""
    for _ in range(20):
        page.keyboard.press("Escape")
        page.wait_for_timeout(250)
        if page.locator('[class*="revealScene"]').count() == 0:
            break
    page.wait_for_timeout(400)


def _wait_for(fn, tries: int = 40, page=None) -> bool:
    for _ in range(tries):
        if fn():
            return True
        if page is not None:
            page.wait_for_timeout(500)
    return False


def _search(page, query: str) -> None:
    """Open the sidebar's search mode, type a query, and wait for it to settle.

    ⛔ WAIT ON THE SURFACE'S OWN SIGNAL. Each of the four sections renders
    "Searching …" while its fetch is in flight, so their absence is the
    product saying every section has answered. The one fixed wait is the
    250ms debounce itself — polling before it fires would read the previous
    query's results and call them this one's.
    """
    btn = page.get_by_label("Search notes")
    if btn.count():
        btn.first.click()
    box = page.get_by_placeholder(re.compile("search notes", re.I))
    box.first.fill("")
    box.first.fill(query)
    page.wait_for_timeout(500)          # the debounce, not a guess at the fetch
    _wait_for(lambda: "Searching" not in page.locator("body").inner_text(),
              tries=40, page=page)
    page.wait_for_timeout(250)


def _sse_sources(resp) -> tuple[list[dict], str]:
    """The numbered evidence packet and the answer, out of one SSE response.

    ⛔ THE PACKET IS THE CERTIFICATION, THE ANSWER IS THE EVIDENCE IT WAS USED.
    The `head` event is emitted before synthesis, so a model failure still
    leaves the retrieval provable — but an answer that never arrives is
    reported, never silently treated as a pass.
    """
    sources: list[dict] = []
    answer = ""
    for line in (resp.text() or "").splitlines():
        if not line.startswith("data: "):
            continue
        try:
            ev = json.loads(line[6:])
        except Exception:  # noqa: BLE001
            continue
        if ev.get("sources"):
            sources = ev["sources"]
        if ev.get("type") == "final":
            answer = ev.get("answer") or ""
        elif ev.get("type") == "delta" and not answer:
            pass
    return sources, answer


def _reviews_in(sources: list[dict]) -> list[dict]:
    return [s for s in sources if s.get("type") == "thesis_review"]


def _cited(answer: str, sources: list[dict]) -> list[dict]:
    """The sources the ANSWER actually leaned on.

    ⛔⛔ CITATIONS, NOT PROSE MATCHING. The first cut of this harness looked for
    a seeded marker token in the answer text and failed every step — because
    the model had paraphrased correctly ("you were back to where I started")
    instead of quoting a nonsense word. Asserting on wording measures the
    model's phrasing; asserting on the citation measures whether the right ROW
    was used, which is the thing O6 built. The product already owns this
    contract: a handle only resolves against the packet that was sent.
    """
    by_n = {s.get("n"): s for s in sources}
    out, seen = [], set()
    for m in re.finditer(r"\[(\d{1,3})\]", answer or ""):
        n = int(m.group(1))
        if n in by_n and n not in seen:
            seen.add(n)
            out.append(by_n[n])
    return out


def _ordinal(src: dict):
    return (src.get("payload") or {}).get("review_ordinal")


def _sentence_with(text: str, needle: str) -> str:
    """The sentence a marker landed in — so an attribution check can be scoped
    to the claim rather than to the whole answer."""
    for part in re.split(r"(?<=[.!?])\s+", text or ""):
        if needle.lower() in part.lower():
            return part
    return ""


def main() -> int:  # noqa: C901 - a journey is a sequence
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://127.0.0.1:8077")
    ap.add_argument("--email", default="mobtest@local.dev")
    ap.add_argument("--password", default="LocalTest2026!")
    ap.add_argument("--headed", action="store_true")
    args = ap.parse_args()

    from playwright.sync_api import sync_playwright

    OUT_DIR.mkdir(exist_ok=True)
    F = Findings()
    base = args.base

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=not args.headed)
        ctx = browser.new_context(viewport=DESKTOP)
        if not ctx.request.post(f"{base}/api/auth/login",
                                data={"email": args.email,
                                      "password": args.password}).ok:
            print("login failed — start the sandbox first", file=sys.stderr)
            return 2

        # ── SEED ─────────────────────────────────────────────────────────────
        # Two theses, each with real captured evidence, and a review history on
        # the NVDA one. Seeded over HTTP, not typed: Wave O's own harness
        # already certifies the reviewing journey; this one is about what
        # happens to a review AFTERWARDS.
        def thesis(title: str, ticker: str) -> str:
            made = jbody(api(ctx, "post", "/api/j2/notes", base, data={
                "title": title, "ticker": ticker, "tags": ["thesis"],
                "bodyJson": {"type": "doc", "content": [{"type": "paragraph"}]}}))
            return (made.get("note") or made)["id"]

        def attach(note_id: str, stance: str, passage: str) -> None:
            cap = jbody(api(ctx, "post", "/api/j2/capture", base, data={
                "tier": "passage",
                "url": f"https://www.reuters.com/{uuid.uuid4().hex[:8]}",
                "title": "Reuters: quarterly detail", "passage": passage,
                "annotation": "my own read", "noteId": note_id}))
            api(ctx, "post", f"/api/j2/notes/{note_id}/evidence", base, data={
                "targetType": "document_excerpt", "targetId": cap.get("excerptId"),
                "stance": stance})

        def review(note_id: str, member_note: str, outcome: str) -> str:
            opened = jbody(api(ctx, "post", f"/api/j2/notes/{note_id}/reviews",
                               base, data={}))["review"]["id"]
            api(ctx, "post", f"/api/j2/reviews/{opened}/complete", base, data={
                "outcome": outcome, "memberNote": member_note})
            return opened

        nvda = thesis(f"NVDA thesis {TOKEN}", "NVDA")
        aapl = thesis(f"AAPL thesis {TOKEN}", "AAPL")
        # ⛔ A REAL THESIS HAS A STATE. §23 is about an old decision being
        # mistaken for the current position, and without a status property
        # there IS no current position for the answer to prefer — the control
        # would pass because the thing it protects does not exist.
        for nid in (nvda, aapl):
            api(ctx, "put", f"/api/j2/notes/{nid}", base, data={
                "properties": {"builtin:thesis_status": "active",
                               "builtin:confidence": "medium"}})
        attach(nvda, "supports", f"Reuters {TOKEN}: NVDA gross margin holds.")
        attach(nvda, "opposes", f"Reuters {TOKEN}: NVDA pricing pressure.")
        attach(aapl, "supports", f"Reuters {TOKEN}: AAPL services growth.")

        old_id = review(nvda, OLD_NOTE, "invalidated")
        # ⛔ A REAL GAP, NOT A BACKDATE. `completed_at` is stamped by the
        # service and this harness runs OUTSIDE the sandbox process, so it
        # cannot reach the database to rewrite one — and reaching in would mean
        # certifying an ordering the product never produced. This is the one
        # deliberate wait in the file: it is CREATING elapsed time, not waiting
        # on a state, so the instrumentation doctrine's "never sleep" does not
        # apply. Without it both reviews land in the same second and "last"
        # would be settled by the id tiebreak rather than by the dates the
        # member sees.
        time.sleep(1.2)
        new_id = review(nvda, NEW_NOTE, "no_change")
        aapl_id = review(aapl, AAPL_NOTE, "no_change")

        hist = jbody(api(ctx, "get", f"/api/j2/notes/{nvda}/reviews", base))
        done = {r["id"]: r for r in hist.get("reviews", [])}
        F.check("seed", done.get(new_id, {}).get("completedAt", "") >
                        done.get(old_id, {}).get("completedAt", "!"),
                "the two seeded reviews did not land in a definite order")
        newest_at = done.get(new_id, {}).get("completedAt") or ""
        F.note("seed", old_at=done.get(old_id, {}).get("completedAt"),
               new_at=newest_at)

        # ── §20 · SEARCH: FIND WHAT I CONCLUDED ──────────────────────────────
        page = ctx.new_page()
        page.goto(f"{base}/journal/notebook", wait_until="networkidle")
        _dismiss_intro(page)

        # S0 · NEGATIVE CONTROL, FIRST. If a review section renders for a word
        # nobody ever wrote, every assertion below is satisfied by a section
        # that always appears.
        _search(page, NEVERWRITTEN)
        body0 = page.locator("body").inner_text()
        F.check("S0", not re.search(r"\d+ thesis review", body0, re.I),
                f"a review section appeared for a token nobody wrote: "
                f"{body0[:200]!r}")

        # S1 · the member searches a word from their OWN review
        _search(page, OLD_MARK)
        body1 = page.locator("body").inner_text()
        F.note("S1", body=body1[:600])
        F.check("S1", re.search(r"1 thesis review\b", body1, re.I) is not None,
                f"searching a word from a review found no review: {body1[:300]!r}")

        # S2 · it says WHAT it is and WHICH thesis — never "Document"
        row = page.locator('button', has_text=re.compile("Thesis review", re.I))
        if F.check("S2", row.count() > 0, "the result is not labelled as a review"):
            rtext = row.first.inner_text()
            F.note("S2", row=rtext[:300])
            F.check("S2", TOKEN in rtext,
                    f"the result does not name the thesis: {rtext[:160]!r}")
            # ⛔ §8/§14 — the one mistake this must never make.
            low = rtext.lower()
            for banned in ("document", "captured passage", "saved passage"):
                F.check("S2", banned not in low,
                        f"a review result is labelled {banned!r}: {rtext[:160]!r}")
            # ⛔ The DECISION travels with the prose.
            F.check("S2", "invalidated" in low,
                    f"the result does not carry the outcome: {rtext[:200]!r}")
            page.screenshot(path=str(OUT_DIR / "o6_01_search.png"), full_page=True)

            # S3 · clicking it lands ON the review, not at the top of the note
            row.first.click()
            # ⛔⛔ WAIT ON A SIGNAL THAT WAS NOT ALREADY TRUE. The first cut
            # waited for the review's text to appear anywhere on the page —
            # which it already did, in the search result snippet still on
            # screen — so every assertion after it ran against a half-loaded
            # editor and reported a product defect that was the harness's own.
            # The product's own signal is the anchor being CONSUMED: the panel
            # clears `review=` from the URL once it has acted on it.
            opened = _wait_for(lambda: f"note={nvda}" in page.url, page=page)
            F.check("S3", opened,
                    f"the click did not open the owning thesis: {page.url}")
            consumed = _wait_for(lambda: "review=" not in page.url, page=page)
            F.note("S3", url=page.url, consumed=consumed)
            F.check("S3", consumed,
                    "the review anchor never reached the review panel")
            # ⛔ The history section is COLLAPSED by default and unmounts its
            # children, so "the text is on screen" is the whole proof that the
            # deep link actually opened it.
            # ⛔ PROBE THE SEMANTIC MARK, NOT THE CLASS NAME. A CSS-module
            # class is hashed differently in a production build than in the
            # jsdom transform the component rail runs under, so a class probe
            # here would be measuring the bundler. `aria-current` is the mark
            # the product actually makes, and the one a screen reader reads.
            marked = page.locator('li[aria-current="true"]')
            if F.check("S3", marked.count() > 0,
                       "the review that was navigated to is not marked in its history"):
                F.check("S3", OLD_NOTE[:30] in marked.first.inner_text(),
                        "the marked row is not the review that was clicked")
            page.screenshot(path=str(OUT_DIR / "o6_02_landed.png"), full_page=True)

        # ── §21 · ASK: WHAT DID I DECIDE? ────────────────────────────────────
        def ask(scope: str, target: str | None, query: str):
            path = "/api/j2/ask/stream"
            data: dict = {"scope": scope, "query": query}
            if target:
                data["target"] = target
            r = api(ctx, "post", path, base, data=data, timeout=180000)
            if not r.ok:
                return [], "", r.status
            s, a = _sse_sources(r)
            return s, a, r.status

        src, ans, st = ask("note", nvda, "What did I decide in my last review?")
        F.note("A1", status=st, answer=ans[:500],
               labels=[s["label"] for s in src])
        revs = _reviews_in(src)
        if F.check("A1", bool(revs),
                   f"Ask Current Note retrieved no review at all (status {st})"):
            first = [r for r in revs
                     if (r.get("payload") or {}).get("review_ordinal") == 1]
            F.check("A1", bool(first),
                    f"no review is marked as the most recent: "
                    f"{[r.get('payload') for r in revs]!r}")
            if first:
                # ⛔ §9 — the ANSWER to "last" is a ROW, and it is the newer one.
                F.check("A1", NEW_MARK in (first[0].get("snippet") or ""),
                        "the review marked most recent is not the newest one")
                F.check("A1", first[0]["label"].lower().startswith("your"),
                        f"the source is not attributed to the member: "
                        f"{first[0]['label']!r}")
        if ans:
            cited = _cited(ans, src)
            F.note("A1", cited=[(c.get("n"), c.get("type"), _ordinal(c))
                                for c in cited])
            F.check("A1", any(c.get("type") == "thesis_review" and _ordinal(c) == 1
                              for c in cited),
                    f"the answer did not cite the most recent review: {ans[:300]!r}")
            # ⛔ §8 — "Reuters says..." from review prose is the failure. Every
            # review the answer cited must be attributed to the member.
            for c in cited:
                if c.get("type") == "thesis_review":
                    F.check("A1", (c.get("label") or "").lower().startswith("your"),
                            f"a cited review is not attributed to the member: "
                            f"{c.get('label')!r}")
            F.check("A1", "reuters" not in ans.lower() or
                    any(c.get("type") != "thesis_review" for c in cited),
                    f"a publisher was named with only review sources cited: "
                    f"{ans[:300]!r}")
        else:
            F.fail("A1", f"no answer came back (status {st}) — the packet was "
                         f"provable but the journey was not")

        src2, ans2, st2 = ask("note", nvda,
                              "What did I decide in my previous review?")
        F.note("A2", status=st2, answer=ans2[:400])
        prev = [r for r in _reviews_in(src2)
                if (r.get("payload") or {}).get("review_ordinal") == 2]
        if F.check("A2", bool(prev),
                   "the review before last was not retrieved as ordinal 2"):
            F.check("A2", OLD_MARK in (prev[0].get("snippet") or ""),
                    "ordinal 2 is not the older review")
        if ans2:
            cited2 = _cited(ans2, src2)
            F.note("A2", cited=[(c.get("n"), c.get("type"), _ordinal(c))
                                for c in cited2])
            F.check("A2", any(c.get("type") == "thesis_review" and _ordinal(c) == 2
                              for c in cited2),
                    f"the answer did not cite the PREVIOUS review: {ans2[:300]!r}")

        src3, ans3, st3 = ask("note", nvda, "When did I last review this thesis?")
        F.note("A3", status=st3, answer=ans3[:300], expected_date=newest_at[:10])
        if ans3 and newest_at:
            # ⛔ THE DATE THE PRODUCT RECORDED, not a date this file chose. A
            # hard-coded expectation here would be testing the harness.
            y, m, d = newest_at[:4], newest_at[5:7], newest_at[8:10]
            month_name = ["", "January", "February", "March", "April", "May",
                          "June", "July", "August", "September", "October",
                          "November", "December"][int(m)]
            F.check("A3", y in ans3 and (month_name in ans3 or f"{m}/{d}" in ans3
                                         or f"-{m}-" in ans3),
                    f"the answer does not say when ({newest_at[:10]}): {ans3[:200]!r}")

        # ── §22 · CROSS-THESIS CONTROL ───────────────────────────────────────
        # Both reviews contain SHARED. Only the note-membership scope keeps the
        # AAPL one out, which is why this can fail rather than merely reorder.
        src4, ans4, st4 = ask("security", "NVDA",
                              f"What did I conclude about the {SHARED} numbers?")
        ids4 = [(s.get("navigation") or {}).get("review_id") for s in _reviews_in(src4)]
        F.note("S22", status=st4, review_ids=ids4, answer=ans4[:300])
        F.check("S22", aapl_id not in ids4,
                "a question about NVDA research retrieved an AAPL review")
        F.check("S22", any(i in ids4 for i in (old_id, new_id)),
                f"the NVDA reviews were not retrieved at all: {ids4!r}")
        if ans4:
            cited4 = _cited(ans4, src4)
            F.note("S22", cited=[(c.get("n"), c.get("type")) for c in cited4])
            F.check("S22", AAPL_MARK not in ans4,
                    f"the NVDA answer quoted the AAPL review: {ans4[:300]!r}")
            F.check("S22", aapl_id not in [(c.get("navigation") or {}).get("review_id")
                                           for c in cited4],
                    "the NVDA answer cited an AAPL review")

        # ── §23 · HISTORICAL CONTROL ─────────────────────────────────────────
        # The OLD review says the thesis is dead; the NEW one says it holds.
        # An old decision must never be presented as the current position.
        src5, ans5, st5 = ask("note", nvda, "What is my thesis on this now?")
        F.note("S23", status=st5, answer=ans5[:500],
               types=[s.get("type") for s in src5])
        F.check("S23", any(s.get("type") == "thesis_state" for s in src5),
                "the current thesis state was not retrieved for a current question")
        if ans5:
            low5 = ans5.lower()
            # ⛔ IT MAY LEGITIMATELY MENTION THE OLD DECISION — that is history,
            # and hiding it would be its own dishonesty. What it must never do
            # is present a reversed judgement as the standing position, so the
            # test is whether the answer DISTINGUISHES them. The chronology the
            # packet carries is what makes that possible; without it the model
            # would have two undated opinions and no way to tell.
            mentions_old = "invalidated" in low5 or "no longer" in low5
            distinguishes = any(w in low5 for w in
                                ("most recent", "latest", "previous", "earlier",
                                 "prior", "since"))
            F.check("S23", (not mentions_old) or distinguishes,
                    f"a reversed older decision is stated without saying it was "
                    f"superseded: {ans5[:300]!r}")

        # The thesis itself is still untouched by any of this.
        # ⛔ UNCHANGED, NOT ABSENT. The seed sets a status on purpose (§23 needs
        # a current position to protect), so "no status" would be the wrong
        # assertion here — it would pass on a product that had never written
        # one. What must hold is that completing two reviews, one of them
        # `invalidated`, left the member's own status exactly where they put it.
        note_after = jbody(api(ctx, "get", f"/api/j2/notes/{nvda}", base))
        props = (note_after.get("note") or note_after).get("propertiesJson") or {}
        F.check("S23", props.get("builtin:thesis_status") == "active",
                f"a review rewrote the thesis status the member set: {props!r}")

        return _finish(F, browser, page)


def _finish(F: Findings, browser, page=None) -> int:
    if page is not None:
        try:
            page.screenshot(path=str(OUT_DIR / "o6_99_final.png"), full_page=True)
        except Exception:  # noqa: BLE001
            pass
    browser.close()
    OUT_DIR.mkdir(exist_ok=True)
    (OUT_DIR / "report.json").write_text(
        json.dumps({"token": TOKEN, "findings": F.items, "steps": F.steps},
                   indent=2, ensure_ascii=False), encoding="utf-8")
    if F.items:
        print("FINDINGS:")
        for it in F.items:
            print(f"  [X] {it}")
        return 1
    print("Wave O6 recall journey: every step green")
    return 0


if __name__ == "__main__":
    sys.exit(main())
