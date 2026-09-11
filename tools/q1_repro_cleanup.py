"""⛔⛔ CLEAN UP THE GREEN REPRO RUNS — BY PRIMARY KEY, FROM MY OWN RECORDS.

R-10: artifacts are preserved on a finding, and cleaned to baseline otherwise.
`q1_repro.py` never wired the cleanup, so ~55 notes accumulated on the canary
account across the reproduction sampling. This removes exactly the ones that
belong to runs that went GREEN.

⛔⛔ WHY THIS SELECTS BY NOTE ID AND NOTHING ELSE.

⚰️ Ruling R-X, earned the hard way: a cleanup that selected by the
`sync-conflict` TAG would have soft-deleted the OWNER'S OWN notes, because a tag
says what HAPPENED to a note, never WHO MADE IT. So:

  · the delete set is the `noteId` recorded in a GREEN run's own artifact —
    a primary key this tool wrote down itself at creation time;
  · every id is re-read from the server and its title must still carry the repro
    marker before anything is deleted (capture before clean);
  · a run with ANY finding, or an INCONCLUSIVE close, keeps its note. Absence of
    evidence resolves to KEEP (ruling R-Z);
  · the preserved round-3 evidence has no artifact here, so it cannot be
    selected even in principle.

⛔⛔ R-26 — THE EVIDENCE SET IS NOW CLEANABLE TOO, AND ONLY BY NAME.

Ruling R-26 (2026-09-11) authorises removing the KEPT set as well, on the single
condition that made it safe: **the content is durable in git**. All seventeen
were written into `docs/notebook/wave-q1-RESUME-HERE.md` first — door, note id,
the sentence typed offline, every finding verbatim, the wire summary — so the
notes are a duplicate of the record, not the record.

⛔ It is a SEPARATE FLAG (`--evidence`), never the default, and it still selects
by primary key from this tool's own artifacts and still re-reads every title
before deleting. R-26 names the tool's classification as the authority, so the
delete set is exactly what `classify()` returns as KEEP — not a count, not a
hand-list. The ruling said fifteen and the classifier says seventeen; the
classifier is what runs.

Usage:
    python tools/q1_repro_cleanup.py              # dry run — prints, deletes nothing
    python tools/q1_repro_cleanup.py --apply
    python tools/q1_repro_cleanup.py --evidence            # dry run over the KEPT set
    python tools/q1_repro_cleanup.py --evidence --apply    # R-26
    python tools/q1_repro_cleanup.py --self-check
"""
from __future__ import annotations

import argparse
import glob
import json
import pathlib
import sys

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

import window_check as wc  # noqa: E402

ART = pathlib.Path(__file__).resolve().parents[1] / "docs" / "notebook" / "wave-q1-repro"
MARKER = f"{wc.SENTINEL} repro "

# ⛔ THE SECOND WAY (R-26). `NOTES_JS` asks the SERVER. This asks the SCREEN.
#
# ⚰️ The first draft of this queried `[data-note-id]`, `[data-testid="note-card"]`
# and `article[data-note]`. NONE of them exist — the notebook's rows are keyed by
# `key={note.id}` and styled with a hashed CSS-module class, so all three would
# have matched nothing and reported a confident **zero**, which is the answer this
# check is looking for. A fixture that cannot tell "gone" from "never looked" is
# not a check (`lesson_a_fixture_that_cannot_distinguish_is_not_a_rail`).
#
# ⭐ So it counts the MARKER TEXT instead — product copy a member can read on
# screen, which no refactor can silently rename out from under it. And it carries
# its own non-vacuity control: it reports `bodyChars`, so an empty or unrendered
# page is distinguishable from a page that genuinely shows no repro notes.
DOM_COUNT_JS = """(marker) => {
  const body = document.body ? (document.body.innerText || '') : '';
  const hits = body.split(marker).length - 1;
  return {ok: true, marker, onScreen: hits, bodyChars: body.length};
}"""


def classify(d: dict) -> tuple[str, str]:
    """GREEN / KEEP, and why. ⛔ Only GREEN is ever deletable."""
    if d.get("error"):
        return "KEEP", f"errored: {d['error'][:60]}"
    if d.get("findings"):
        return "KEEP", f"{len(d['findings'])} finding(s) — evidence"
    if d.get("inconclusive"):
        return "KEEP", "inconclusive close — absence of evidence resolves to KEEP"
    settled = (d.get("layers") or {}).get("settled") or {}
    srv = settled.get("server")
    if not isinstance(srv, dict) or not isinstance(srv.get("updatedAt"), str):
        return "KEEP", "the closing read failed — cannot prove it was clean"
    if d.get("landed") is not True:
        return "KEEP", f"landed={d.get('landed')!r}"
    return "GREEN", "clean run"


def collect() -> tuple[list, list]:
    green, keep = [], []
    for f in sorted(glob.glob(str(ART / "*.json"))):
        try:
            d = json.load(open(f, encoding="utf-8"))
        except Exception:  # noqa: BLE001
            continue
        nid = d.get("noteId")
        if not nid:
            continue
        verdict, why = classify(d)
        row = {"file": pathlib.Path(f).name, "noteId": nid, "why": why,
               "ordering": d.get("ordering"), "door": d.get("door")}
        (green if verdict == "GREEN" else keep).append(row)
    return green, keep


def self_check() -> int:
    bad = 0

    def case(name, ok):
        nonlocal bad
        print(f"  {'ok  ' if ok else 'FAIL'} {name}")
        bad += 0 if ok else 1

    ok_run = {"noteId": "n", "landed": True,
              "layers": {"settled": {"server": {"updatedAt": "T"}}}}
    case("a clean run is GREEN", classify(ok_run)[0] == "GREEN")
    case("⛔ a run with a finding is KEPT",
         classify({**ok_run, "findings": ["x"]})[0] == "KEEP")
    case("⛔ an errored run is KEPT", classify({**ok_run, "error": "boom"})[0] == "KEEP")
    case("⛔ an INCONCLUSIVE run is KEPT — absence of evidence resolves to keep",
         classify({**ok_run, "inconclusive": "read failed"})[0] == "KEEP")
    case("⛔ a run whose closing read failed is KEPT",
         classify({"noteId": "n", "landed": True, "layers": {"settled": {"server": None}}})[0] == "KEEP")
    case("⛔ landed=False is KEPT", classify({**ok_run, "landed": False})[0] == "KEEP")
    case("⛔ landed=None is KEPT", classify({**ok_run, "landed": None})[0] == "KEEP")
    case("the marker is derived from the tool's own sentinel, not retyped",
         MARKER.startswith(wc.SENTINEL))
    print("self-check:", "PASS" if not bad else f"FAIL ({bad})")
    return 1 if bad else 0


ORPHAN_JS = """async (marker) => {
  const r = await fetch('/api/j2/notes?limit=300', {credentials:'include'});
  if (!r.ok) return {ok:false, status:r.status};
  const notes = (await r.json()).notes || [];
  // The discriminator is THIS TOOL'S OWN MARKER plus the server's fork suffix.
  // Never the tag: the account holds two notes the OWNER made that carry
  // `sync-conflict`, and selecting on it would delete their work (R-X).
  const mine = notes.filter(n => (n.title || '').startsWith(marker)
                              && (n.title || '').endsWith('(conflicted copy)'));
  return {ok:true, total: notes.length,
          orphans: mine.map(n => ({id: n.id, title: n.title})),
          // the control: what selecting on the TAG would have taken instead
          byTag: notes.filter(n => (n.tags || []).includes('sync-conflict'))
                      .map(n => n.title)};
}"""


def _sweep_orphan_forks(page) -> tuple[int, list]:
    """⛔ The forks left behind when a repro run's PARENT is deleted.

    ⚰️ Deleting the seventeen left twelve children standing: the server created
    them, so they appear in no artifact of this tool's and cannot be selected by
    primary key the way everything else here is. They are selected by the tool's
    own title marker instead — and the run PRINTS what a tag-based selection
    would have taken, because that selection would have included two notes the
    owner wrote (R-X), and a guard is worth more when you can see it refuse.
    """
    d = page.evaluate(ORPHAN_JS, MARKER) or {}
    if not d.get("ok"):
        print(f"  orphan sweep: the list did not answer ({d!r})")
        return 0, []
    orphans = d.get("orphans") or []
    by_tag = d.get("byTag") or []
    print(f"  by MARKER (what this deletes): {len(orphans)}")
    print(f"  by TAG    (what R-X forbids) : {len(by_tag)}")
    for t in by_tag:
        if not t.startswith(MARKER):
            print(f"    ⭐ the tag would also have taken: {t!r} — not this tool's note")
    removed, refused = 0, []
    for o in orphans:
        st = page.evaluate("""async (id) => {
            const r = await fetch('/api/j2/notes/' + id, {method:'DELETE', credentials:'include'});
            return r.status;
        }""", o["id"])
        if st in (200, 204):
            removed += 1
        else:
            refused.append((o["id"], f"delete returned {st}"))
    return removed, refused


def _counts(page, label: str) -> dict:
    """⛔ TWO AUTHORITIES, ALWAYS BOTH (R-26). The server's list, and the screen.

    A count confirmed by one of them is one observation repeated. They can
    disagree — a delete that 200s but leaves the list cached would show exactly
    that — and the disagreement is the finding, so both are recorded either way.
    """
    api = page.evaluate(wc.NOTES_JS) or {}
    dom = page.evaluate(DOM_COUNT_JS, MARKER) or {}
    row = {
        "when": label,
        "api_total": api.get("total"),
        "api_canary": len(api.get("canary") or []),
        "api_conflicts": len(api.get("conflicts") or []),
        "dom_marker_on_screen": dom.get("onScreen"),
        "dom_body_chars": dom.get("bodyChars"),
    }
    print(f"  [{label}] server: total={row['api_total']} canary-titled={row['api_canary']} "
          f"sync-conflict={row['api_conflicts']}")
    print(f"  [{label}] screen: repro-marker occurrences={row['dom_marker_on_screen']} "
          f"(body {row['dom_body_chars']} chars)")
    if not api.get("ok"):
        print(f"  [{label}] ⛔ the server list did not answer: {api!r}")
    if not row["dom_body_chars"]:
        print(f"  [{label}] ⛔ the page rendered NOTHING — this read proves nothing")
    return row


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--evidence", action="store_true",
                    help="R-26: target the KEPT (evidence) set instead of the GREEN set")
    ap.add_argument("--orphan-forks", action="store_true",
                    help="sweep forks whose parent repro note is already deleted")
    ap.add_argument("--self-check", action="store_true")
    a = ap.parse_args()
    if a.self_check:
        return self_check()

    green, keep = collect()
    target = keep if a.evidence else green
    mode = "EVIDENCE (R-26)" if a.evidence else "GREEN"
    print(f"GREEN: {len(green)}      KEPT (evidence): {len(keep)}")
    print(f"mode: {mode} — delete set is {len(target)} note(s)\n")
    for r in target:
        print(f"  TARGET  {r['noteId'][:12]}  {r['ordering']}/{r['door']}  — {r['why']}")
    if not a.evidence:
        for r in keep:
            print(f"  KEEP    {r['noteId'][:12]}  {r['ordering']}/{r['door']}  — {r['why']}")

    if not a.apply:
        print(f"\nDRY RUN — nothing deleted. {len(target)} note(s) would be removed.")
        if a.evidence:
            print("⛔ R-26 selects the KEPT set. Their content is durable in")
            print("   docs/notebook/wave-q1-RESUME-HERE.md — confirm that before --apply.")
        return 0

    from playwright.sync_api import sync_playwright
    proc, endpoint, version = wc.spawn_rig()
    if not version:
        print("rig did not answer")
        return 1
    removed, refused, rows = 0, [], []
    try:
        with sync_playwright() as pw:
            b = pw.chromium.connect_over_cdp(endpoint)
            ctx = b.contexts[0]
            page = ctx.pages[0] if ctx.pages else ctx.new_page()
            page.goto(wc.PROD + "/journal/notebook", wait_until="domcontentloaded")
            page.wait_for_timeout(6000)

            print("\n── BASELINE BEFORE ──")
            rows.append(_counts(page, "before"))

            for r in target:
                # ⛔ CAPTURE BEFORE CLEAN: re-read the note and prove it is mine.
                got = page.evaluate("""async (id) => {
                    const r = await fetch('/api/j2/notes/' + id, {credentials:'include'});
                    if (!r.ok) return {ok:false, status:r.status};
                    const b = await r.json();
                    return {ok:true, title: (b.note ?? b)?.title ?? ''};
                }""", r["noteId"])
                title = (got or {}).get("title") or ""
                if not got.get("ok"):
                    refused.append((r["noteId"], f"unreadable ({got.get('status')})"))
                    continue
                if not title.startswith(MARKER):
                    # ⛔⛔ THE GUARD THAT MATTERS. If the title is not this tool's
                    # own, the id is not what this tool thinks it is — refuse.
                    refused.append((r["noteId"], f"title is not mine: {title[:40]!r}"))
                    continue
                d = page.evaluate("""async (id) => {
                    const r = await fetch('/api/j2/notes/' + id, {method:'DELETE', credentials:'include'});
                    return r.status;
                }""", r["noteId"])
                if d in (200, 204):
                    removed += 1
                else:
                    refused.append((r["noteId"], f"delete returned {d}"))

            if a.orphan_forks:
                print("")
                print("── ORPHANED FORKS ──")
                o_removed, o_refused = _sweep_orphan_forks(page)
                removed += o_removed
                refused.extend(o_refused)

            # ⛔ RE-READ FROM THE PRODUCT, not from memory: a fresh load, so the
            # "after" numbers come from the server and a repainted screen rather
            # than a list this session already had in hand.
            page.goto(wc.PROD + "/journal/notebook", wait_until="domcontentloaded")
            page.wait_for_timeout(6000)
            print("\n── BASELINE AFTER ──")
            rows.append(_counts(page, "after"))
    finally:
        wc.teardown()

    print(f"\nremoved {removed} · refused {len(refused)}")
    for nid, why in refused:
        print(f"  REFUSED {nid[:12]} — {why}")

    if len(rows) == 2:
        b_, a_ = rows
        print("\n── THE TWO WAYS, BEFORE → AFTER ──")
        print(f"  server total      : {b_['api_total']} → {a_['api_total']}"
              f"   (delta {(a_['api_total'] or 0) - (b_['api_total'] or 0)})")
        print(f"  server canary-titled: {b_['api_canary']} → {a_['api_canary']}")
        print(f"  screen marker hits: {b_['dom_marker_on_screen']} → {a_['dom_marker_on_screen']}")
        out = ART.parent / "wave-q1-cleanup-R26.json"
        out.write_text(json.dumps(
            {"mode": mode, "removed": removed,
             "refused": [{"noteId": n, "why": w} for n, w in refused],
             "targets": [r["noteId"] for r in target],
             "before": b_, "after": a_}, indent=2), encoding="utf-8")
        print(f"\nrecorded → {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
