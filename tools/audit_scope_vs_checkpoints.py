"""Every approval line must name a checkpoint its packet defines. **DECLARED, not derived.**

⛔ **THE STANDING RULE (owner, 2026-09-13):** an approval line names a §4
checkpoint ID, or it re-numbers §4 in the same commit so that it does. A scope
that matches no §4 row is **unsignable** — stop and say so rather than build
against it.

⚰️ **WHY, from two occurrences.** D4's signed line said *"the first two of the
five named adopters"* while its §4 CP1 was a test file with *"no product code
changes"*; S5's said *"extract the Notebook offline pattern"* while its §4 CP1
was *"documentation only, no code of any kind"*. **Both divergences hid a
hazard** — D4's spanned the flow-worker closure boundary, S5's spanned a live
subsystem rolled back 25 minutes after activation nine days earlier.

⛔⛔ **THIS FILE IS A DECLARATION BECAUSE THE DERIVED VERSION WAS RETIRED UNDER
THE TWO-CORRECTION RULE (F-AUDIT-2).** Three attempts to derive *what does this
packet define* each reported a property of the INSTRUMENT as a finding:

  1. v1 knew only the TABLE shape and reported 21 "mismatches", nearly all of
     them "NO §4 TABLE" — which was the tool's claim, not the packet's.
  2. v2 added HEADINGS and still reported 17, because the S7 packets define CP1
     in a heading and **CP2-CP4 in bold paragraphs** under it, and `price-level`
     spells its headings "4. Checkpoint 1", which contains no CP1 token at all.
  3. Worse than a missed definition: every scope also NAMES the checkpoint it is
     REFUSING — "CP3 NEEDS A NEW LINE", "So does CP4 and the flip". A matcher
     counting mentions reads an explicit EXCLUSION as an authorisation and flags
     the packet for it. ⭐ **That one is not a regex bug.** "Named" and
     "authorised" are different facts, and no pattern over one sentence
     separates them.

⭐ The verdicts below were reached by READING all 18 signed packets. What stays
automated is the part a machine is actually good at: noticing that this
declaration has gone stale.

    python tools/audit_scope_vs_checkpoints.py
    python tools/audit_scope_vs_checkpoints.py --self-check
"""
from __future__ import annotations

import argparse
import pathlib
import re
import sys

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

ROOT = pathlib.Path(__file__).resolve().parents[1]
GATES = ROOT / "docs/terminal-research/12-decisions/gates"

OK = "OK"
UNNUMBERED = "UNNUMBERED"          # the packet carries no checkpoint roster at all

#: One row per SIGNED approval line, read 2026-09-13:
#: (packet stem, which line, ids the line AUTHORISES, how the packet writes its
#:  roster, verdict, note).
#: ⛔ `authorises` EXCLUDES ids a scope names only in order to refuse them.
DECLARED: list[tuple] = [
    ("d2-canonical-data-model", "line 1", ["CP1", "CP2"], "table", OK, ""),
    ("d2-canonical-data-model", "line 2", ["CP2", "CP3"], "table", OK,
     "§9.5 CP1 is a sub-numbering inside CP3, not a fourth checkpoint"),
    ("d3-realtime-streaming", "line 1", ["CP1"], "table", OK, ""),
    ("d4-caching-and-serving", "line 1", ["CP1", "CP2", "CP3"], "table", OK,
     "§4 was re-numbered 2026-09-13 in the same commit, per the standing rule"),
    ("d5-reference-corp-actions", "line 1", ["CP1", "CP2", "CP7"], "table", OK, ""),
    ("h14-placeholder-stop-unification", "line 1", [], "none", UNNUMBERED,
     "a one-scope hazard-rule gate — one detector, five call sites, delivered whole. "
     "There is no roster to name and the work is done."),
    ("intelligence-layer", "slice 1", [], "none", UNNUMBERED,
     "names F-I1-1 and F-I1-4: this packet numbers FOLLOW-UPS, not checkpoints"),
    ("intelligence-layer", "slice 2", [], "none", UNNUMBERED,
     "names a component adoption; same packet, same absent roster"),
    ("s10-presentation-primitives", "line 1", [], "headings", UNNUMBERED,
     "it IS CP1 — the CP2 heading says 'the CP1 block above stands as granted' — "
     "but the scope text itself never says so"),
    ("s10-presentation-primitives", "line 2", ["CP2"], "headings", OK,
     "CP3 is named only to refuse it"),
    ("s12-rollout", "line 1", [], "none", UNNUMBERED,
     "names 'first migration'. The CP4 in its text is S7's CP4, not an S12 checkpoint — "
     "the derived audit scored this OK by matching a FOREIGN id"),
    ("s12-rollout", "line 2", [], "none", UNNUMBERED, "names 'second migration'"),
    ("s2-command-search", "line 1", ["CP1"], "table", OK,
     "CP2 is shaped by OI-06 and is not authorised"),
    ("s4-context-bus", "line 1", ["CP1", "CP2", "CP7"], "table", OK, ""),
    ("s5-persistence-user-state", "line 1", ["CP1"], "table", OK, ""),
    ("s7-catalyst-match", "line 1", ["CP1", "CP2"], "headings+bold", OK, ""),
    ("s7-catalyst-match", "line 2", ["CP3"], "headings+bold", OK, ""),
    ("s7-event-proximity", "line 1", ["CP1", "CP2"], "headings", OK, ""),
    ("s7-event-proximity", "line 2", ["CP3"], "headings", OK, ""),
    ("s7-indicator-condition", "line 1", ["CP1", "CP2"], "headings+bold", OK, ""),
    ("s7-indicator-condition", "line 2", ["CP3"], "headings+bold", OK, ""),
    ("s7-position-risk", "line 1", ["CP1", "CP2"], "headings+bold", OK, ""),
    ("s7-position-risk", "line 2", ["CP3"], "headings+bold", OK, ""),
    ("s7-price-level", "line 1", ["CP1", "CP2"], "spelled-out headings", OK,
     "§4 reads 'Checkpoint 1' and §4a 'Checkpoint 2' — the roster carries no CP1 token"),
    ("s7-price-level", "line 2", ["CP3"], "spelled-out headings", OK, ""),
    ("s7-regime-change", "line 1", ["CP1", "CP2"], "headings+bold", OK, ""),
    ("s7-regime-change", "line 2", ["CP3"], "headings+bold", OK, ""),
    ("s7-scan-membership-change", "line 1", ["CP1", "CP2"], "headings+bold", OK, ""),
    ("s7-scan-membership-change", "line 2", ["CP3"], "headings+bold", OK, ""),
]

_SUFFIXES = ("-pre-implementation-gate.md", "-gate.md")
_SIGNED_BLOCK = re.compile(r"^APPROVED BY:[ \t]+[A-Za-z]", re.M)


def packet_path(stem: str) -> pathlib.Path | None:
    for suf in _SUFFIXES:
        p = GATES / (stem + suf)
        if p.exists():
            return p
    return None


def signed_line_count(text: str) -> int:
    return len(_SIGNED_BLOCK.findall(text))


def drift() -> list[str]:
    """The automated half: has the DECLARATION gone stale?

    ⭐ Three questions a machine answers honestly, none of which needs it to
    understand a scope sentence:
      1. does every declared packet still exist?
      2. does each packet carry exactly as many SIGNED lines as declared — so a
         line signed tomorrow is UNDECLARED, and must be read rather than assumed?
      3. does every id this declaration says a line authorises still appear in
         its packet, so a re-numbering that drops one shows up here?
    """
    problems: list[str] = []
    declared_counts: dict[str, int] = {}
    for row in DECLARED:
        declared_counts[row[0]] = declared_counts.get(row[0], 0) + 1

    for stem, count in sorted(declared_counts.items()):
        p = packet_path(stem)
        if p is None:
            problems.append(f"{stem}: DECLARED, but no packet file exists")
            continue
        t = p.read_text(encoding="utf-8", errors="replace")
        actual = signed_line_count(t)
        if actual != count:
            problems.append(
                f"{p.name}: {actual} signed line(s) on disk, {count} declared — "
                "read the new line and declare it before building against it")
        for row in DECLARED:
            if row[0] != stem:
                continue
            for cp in row[2]:
                if cp not in t:
                    problems.append(
                        f"{p.name} {row[1]}: declares {cp}, which the packet no longer contains")

    for p in sorted(GATES.glob("*.md")):
        t = p.read_text(encoding="utf-8", errors="replace")
        if not signed_line_count(t):
            continue
        stem = p.name
        for suf in _SUFFIXES:
            if stem.endswith(suf):
                stem = stem[: -len(suf)]
                break
        if stem not in declared_counts:
            problems.append(f"{p.name}: SIGNED, but not declared here at all")
    return problems


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--self-check", action="store_true")
    a = ap.parse_args()

    if a.self_check:
        ok = True
        if len(DECLARED) < 20:
            print("  the declaration is too small to be the whole programme"); ok = False
        if not any(r[4] == UNNUMBERED for r in DECLARED):
            print("  no UNNUMBERED row — the audit would have nothing to report"); ok = False
        if not any(r[4] == OK for r in DECLARED):
            print("  no OK row — the audit cannot discriminate"); ok = False
        # CONTROL — the drift check must be able to FAIL.
        _real = DECLARED[:]
        try:
            DECLARED.append(("no-such-packet", "line 1", ["CP1"], "none", OK, "control"))
            if not any("no packet file exists" in m for m in drift()):
                print("  the drift check does not notice a packet that is not there"); ok = False
        finally:
            DECLARED[:] = _real
        live = drift()
        if live:
            print("  the drift check fails on the REAL declaration:")
            for m in live:
                print("   ", m)
            ok = False
        print("SELF-CHECK:", "PASS" if ok else "FAIL")
        return 0 if ok else 1

    bad = [r for r in DECLARED if r[4] != OK]
    w = max(len(r[0]) for r in DECLARED)
    print(f"[scope-vs-§4] {len(DECLARED)} signed line(s) across "
          f"{len({r[0] for r in DECLARED})} packets — DECLARED, read 2026-09-13\n")
    for stem, line, ids, how, verdict, note in DECLARED:
        mark = "  " if verdict == OK else "⛔"
        print(f"{mark} {verdict:<10} {stem:<{w}} {line:<8} "
              f"authorises={ids or '-'} roster={how}")
        if note:
            print(f"{'':>14}{note}")
    print()
    problems = drift()
    for m in problems:
        print("⛔ DRIFT:", m)
    if bad:
        print(f"\n⛔ {len(bad)} SIGNED LINE(S) NAME NO CHECKPOINT, across "
              f"{len({r[0] for r in bad})} packets. Each is closed by NUMBERING the "
              "packet, not by re-signing it.")
    else:
        print("[scope-vs-§4] every signed line names a checkpoint its packet defines")
    return 1 if (bad or problems) else 0


if __name__ == "__main__":
    sys.exit(main())
