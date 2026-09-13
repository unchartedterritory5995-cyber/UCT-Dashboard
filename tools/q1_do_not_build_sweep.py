#!/usr/bin/env python3
"""C-4 -- DID ANY DO-NOT-BUILD ITEM QUIETLY GAIN CODE?

Manifest SS8 records twenty-odd things this programme decided NOT to build. A
list like that is only worth the paper it is on if something checks it, and
nothing did: the check was "somebody remembers". This is the somebody.

  python tools/q1_do_not_build_sweep.py            # sweep, exit 1 on a hit
  python tools/q1_do_not_build_sweep.py --self-check   # prove it can FAIL

DERIVED FROM SS8, NEVER TYPED. The roster is parsed out of
`docs/notebook/PROGRAM-MANIFEST.md` at run time. An item added to SS8 tomorrow
with no probe here fails the sweep BY NAME -- "I do not know how to check this
one" must never read as "this one is clean". A typed roster beside the list it
describes is the defect this repo keeps re-committing (the writer-index FOUR,
the COT router's "4 routes", the setup catalog's "24").

DOCS ARE NOT SWEPT, AND THAT IS THE POINT. Every one of these items is NAMED in
the documentation on purpose -- that is what SS8 IS. The question is whether any
of them gained CODE, so the sweep reads `app/src`, `api`, `scripts` and `tools`.

A PROBE THAT MATCHES IS A QUESTION, NOT A VERDICT. Several of these names are
legitimately adjacent to code that is supposed to exist (`mergeAppends` is not
"auto-merge of conflicts"; `/sw.js` is a self-uninstalling kill switch, not a
service worker). Those live in EXEMPT below with the reason written out, so an
exemption cannot outlive the argument for it.
"""
from __future__ import annotations

import argparse
import pathlib
import re
import sys

# The operator console here is cp1252. A tool that raises UnicodeEncodeError
# while printing its own verdict reports nothing and looks like a different
# failure entirely -- exactly what made tools/flag_ledger_audit.py unrunnable
# for a month (CLAUDE.md). Output stays ASCII; this is the second line of defence.
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except (AttributeError, ValueError):
    pass

_MIDDOT = chr(183)
_EMDASH = chr(8212)

REPO = pathlib.Path(__file__).resolve().parents[1]
MANIFEST = REPO / "docs" / "notebook" / "PROGRAM-MANIFEST.md"
ROOTS = ("app/src", "api", "scripts", "tools")
# This file and its rail necessarily contain every construct the sweep looks
# for. Scanning them reports the probe table as evidence -- the instrument
# reproducing its own blind spot, and six false hits burying one real one.
SELF = {"q1_do_not_build_sweep.py", "test_do_not_build_sweep.py"}
SKIP_DIRS = {"node_modules", "dist", "__pycache__", ".git", "build", "coverage"}
CODE_SUFFIX = {".js", ".jsx", ".ts", ".tsx", ".py", ".sql", ".css", ".html"}


# ══════════════════════════════════════════════════════════════════════════════
# the probes
# ══════════════════════════════════════════════════════════════════════════════
# Keyed by a distinctive substring of the SS8 item, so the roster and the probes
# are joined by the manifest's own words rather than by position. Each value is
# (patterns, why-these-are-the-tell).
#
# A PROBE IS A CONSTRUCT, NOT A TOPIC WORD. "encryption" matches the broker's
# Fernet box and says nothing about client-side E2E; `crypto.subtle.encrypt` in
# the browser bundle is the thing that could only exist if someone built it.
PROBES: dict[str, tuple[tuple[str, ...], str]] = {
    "web clipper": (
        (r"\bwebClipper\b", r"\bclipWebPage\b", r"\bclipper(Endpoint|Service|Router)\b",
         r"/api/j2/clip\b"),
        "a clipper needs a named receiver; the bookmarklet carve-out has none of these",
    ),
    "plugin marketplace": (
        (r"\bpluginMarketplace\b", r"\binstallPlugin\b", r"\bplugin_registry\b",
         r"\bPLUGIN_MANIFEST\b"),
        "a marketplace needs an install path and a manifest format",
    ),
    "enterprise collaboration": (
        (r"\bfrom ['\"]yjs['\"]", r"y-websocket", r"\bsharedb\b", r"\bShareDB\b",
         r"awareness\.setLocalState", r"\bOperationalTransform\b"),
        "real-time multi-writer collaboration ships as a CRDT/OT library, never hand-rolled",
    ),
    "full-migration rollback": (
        (r"\brollbackMigration\b", r"\bundoImportBatch\b", r"\bmigration_rollback\b",
         r"/api/j2/notes/import/rollback"),
        "one-click rollback needs a route and a batch identity to undo",
    ),
    "Agents platform": (
        (r"\bagentsPlatform\b", r"\bexternalAgent\b", r"\bagent_manifest\b",
         r"/api/j2/agents\b"),
        "an external agents platform needs a registration surface",
    ),
    "Trading Journal object model inside Notebook": (
        (r"\bj2_note_trades\b", r"\bnotebookTradeObject\b", r"\bnoteTradeModel\b"),
        "a second trade object inside Notebook would need its own table or node type",
    ),
    "second AI chat surface": (
        (r"\bNotebookChat\b", r"\bnotebook_chat\b", r"\bj2_notebook_chat_messages\b",
         r"/api/j2/notebook/chat\b"),
        "a second chat surface needs its own thread store or route; Compass owns the one that exists",
    ),
    "j2_theses": (
        (r"\bj2_theses\b",),
        "the table name is the whole item",
    ),
    "citation-level inline markup": (
        (r"\bcitationMark\b", r"\binlineCitation\b", r"data-citation-range",
         r"\bcitationRange\b"),
        "inline citation markup would appear as a TipTap mark and a data attribute",
    ),
    "multi-hop knowledge graph": (
        (r"\bknowledgeGraph\b", r"\bmultiHop\b", r"\bgraphTraverse\b", r"\bj2_note_graph\b"),
        "a graph needs traversal code and an edge store",
    ),
    "foreign listings": (
        (r"\bforeignListingEntity\b", r"\bprivateCompanyEntity\b", r"\boptionSymbolEntity\b"),
        "these are ENTITY KINDS in the derived mention layer; each would be named",
    ),
    "E2E encryption": (
        (r"crypto\.subtle\.encrypt", r"\be2eEncrypt\b", r"\bclientSideEncryption\b",
         r"\bnoteEncryptionKey\b"),
        "client-side E2E means WebCrypto in the browser bundle, not the server's Fernet box",
    ),
    "two-way connector sync": (
        (r"\btwoWaySync\b", r"\bbidirectionalSync\b", r"\bpushToProvider\b",
         r"\bwrite_back_to_provider\b"),
        "two-way means a WRITE toward the provider; the connectors only read",
    ),
    "deep links back to source": (
        (r"\bsourceDeepLink\b", r"\bbackToSourceUrl\b", r"\bdeepLinkToSourceItem\b"),
        "a deep link back to a source item needs a resolver it does not have",
    ),
    "auto-merge of conflicts": (
        (r"\bautoMergeConflict\w*", r"\bautomerge\b", r"\bresolveConflictAutomatically\b",
         r"\bmergeConflictedCopies\b"),
        "auto-merging a CONFLICT is the opposite of fork-never-clobber",
    ),
    "offline destructive actions": (
        (r"queueDelete\b", r"\bofflineDelete\b", r"kind:\s*['\"]delete['\"]",
         r"\bOUTBOX_DELETE\b"),
        "a destructive action taken offline would be a queued DELETE in the outbox",
    ),
    "offline Ask": (
        (r"\bofflineAsk\b", r"\baskOffline\b", r"\blocalAskIndex\b"),
        "answering while offline needs a local index",
    ),
    "browser-side OCR": (
        (r"""from ['"]tesseract""", r"""require\(['"]tesseract""",
         r"""import\(['"]tesseract""", r"\bocrInBrowser\b",
         r"""createWorker\(\s*['"]eng"""),
        "BROWSER-side OCR is defined by WHERE it runs, so the probe is the browser "
        "IMPORT, not the word. Wave P's server-side OCR is shipped and closed in "
        "production and legitimately says `tesseract` all over api/ -- and two app-side "
        "RAILS say it too, asserting the engine name never reaches member-visible copy. "
        "A probe on the bare word reported six files, five of them the opposite of the "
        "forbidden thing.",
        ("app/src",),
    ),
    "partial local corpus": (
        (r"\blocalCorpusSearch\b", r"\bsearchLocalNotesOnly\b", r"\bofflineSearchIndex\b"),
        "presenting a partial local corpus as the whole notebook needs a local search index",
    ),
    "service worker": (
        (r"navigator\.serviceWorker\.register", r"\bworkbox\b", r"\bprecacheAndRoute\b",
         r"\bself\.addEventListener\(\s*['\"]fetch['\"]"),
        "a caching service worker registers itself and intercepts fetch",
    ),
}

# ══════════════════════════════════════════════════════════════════════════════
# named exemptions -- the argument, written down, beside the thing it excuses
# ══════════════════════════════════════════════════════════════════════════════
# (item key, path substring) -> why this match is not the forbidden thing.
# An exemption with no reason is a suppression; these carry theirs so a reader
# can disagree with the argument rather than only with the outcome.
EXEMPT: dict[tuple[str, str], str] = {
    ("service worker", "public/sw.js"): (
        "/sw.js is a SELF-UNINSTALLING KILL SWITCH (2026-04-26) for browsers still "
        "carrying the LEGACY cache-first worker: it deletes those caches, unregisters "
        "itself and reloads. It is what makes 'there is no service worker' true for a "
        "browser that used to have one -- removing it would resurrect the thing SS8 forbids."
    ),
    ("service worker", "app/src/main.jsx"): (
        "main.jsx:26 registers /sw.js ONLY for a browser that already has a worker "
        "registered -- the call sits inside `getRegistrations().then(regs => if "
        "(regs.length > 0))`, so a clean install registers nothing and the guard is "
        "what makes 'there is no service worker' true. Deleting it would strand every "
        "browser still carrying the legacy cache-first worker, which would then serve a "
        "STALE bundle straight through a revert -- the one failure the Wave Q1 rollback "
        "reasoning leans on being impossible. The forbidden thing is a CACHING worker; "
        "this registration exists to remove one."
    ),
}



def scope_of(key: str) -> tuple[str, ...] | None:
    """Where a probe is allowed to look, or None for the whole swept tree.

    Some SS8 items are defined by LOCATION, not by construct -- "browser-side
    OCR" is the same library as the server-side OCR that is shipped and closed.
    Narrowing by path is how the two stay distinguishable without an exemption
    list that would have to name every legitimate file forever.
    """
    entry = PROBES[key]
    return entry[2] if len(entry) > 2 else None


def parse_do_not_build() -> list[str]:
    """The SS8 roster, read from the manifest. Never a list typed here."""
    src = MANIFEST.read_text(encoding="utf-8")
    m = re.search(r"^## 8\. DO-NOT-BUILD.*?$\n(.*?)^---", src, re.S | re.M)
    if not m:
        sys.exit("could not find section 8 in the manifest -- the sweep cannot derive its roster")
    body = m.group(1)
    # !! STRIP `*` AND BACKTICKS, NEVER `_`. An underscore is markdown emphasis
    # in some dialects and part of an IDENTIFIER here: eating it turned
    # `j2_theses` into `j2theses`, which matched no probe, and the sweep
    # reported its own mangling as an uncovered item.
    body = re.sub(r"[*`]", "", body)
    body = re.sub(r"\s+", " ", body).strip()
    # SS8 separates its items with a MIDDOT. It is named by codepoint, not typed,
    # so an ASCII-safety pass over this file can never silently retune the parser --
    # which is exactly how the roster once came back as fragments of its own items.
    items = [re.sub(r"\s*\(.*?\)\s*", " ", part).strip(" ." + _MIDDOT + _EMDASH)
             for part in body.split(_MIDDOT)]
    return [i for i in items if i]


def code_files():
    for root in ROOTS:
        base = REPO / root
        if not base.exists():
            continue
        for p in base.rglob("*"):
            if not p.is_file() or p.suffix not in CODE_SUFFIX:
                continue
            if any(part in SKIP_DIRS for part in p.parts):
                continue
            if p.name in SELF:
                continue
            yield p


def key_for(item: str) -> str | None:
    low = item.lower()
    for key in PROBES:
        if key.lower() in low:
            return key
    return None


def sweep(files=None) -> tuple[list[str], list[tuple[str, str, int, str]], list[str]]:
    """→ (items with no probe, hits, items checked)."""
    roster = parse_do_not_build()
    uncovered = [i for i in roster if key_for(i) is None]
    covered = {key_for(i): i for i in roster if key_for(i)}
    hits: list[tuple[str, str, int, str]] = []
    files = list(files if files is not None else code_files())
    compiled = {k: [re.compile(p) for p in PROBES[k][0]] for k in covered}
    for p in files:
        try:
            text = p.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        try:
            rel = p.relative_to(REPO).as_posix()
        except ValueError:
            rel = p.as_posix()          # the self-check's throwaway files
        for key, pats in compiled.items():
            scope = scope_of(key)
            if scope and not any(rel.startswith(sc) for sc in scope):
                continue
            for pat in pats:
                for m in pat.finditer(text):
                    if any(k == key and frag in rel for (k, frag) in EXEMPT):
                        continue
                    line = text.count("\n", 0, m.start()) + 1
                    hits.append((key, rel, line, m.group(0)[:60]))
                    break
    return uncovered, hits, sorted(covered)


def self_check() -> int:
    """* A SWEEP NOBODY HAS SEEN FIRE IS NOT A SWEEP. Plant one of each shape in
    a throwaway file and prove the scanner reports it, then prove the clean twin
    is not reported -- a checker that flags both measures nothing."""
    import tempfile
    ok = True

    def case(name, passed):
        nonlocal ok
        ok = ok and passed
        print(f"  {'ok  ' if passed else 'FAIL'} {name}")

    roster = parse_do_not_build()
    case(f"the roster is DERIVED from the manifest ({len(roster)} items)", len(roster) >= 15)
    case("every SS8 item has a probe",
         all(key_for(i) for i in roster))
    missing = [i for i in roster if not key_for(i)]
    if missing:
        for i in missing:
            print(f"       no probe for: {i}")

    with tempfile.TemporaryDirectory() as d:
        planted = pathlib.Path(d) / "planted.js"
        planted.write_text(
            "export const t = 'j2_theses';\n"
            "navigator.serviceWorker.register('/x.js');\n"
            "crypto.subtle.encrypt(alg, key, data);\n", encoding="utf-8")
        clean = pathlib.Path(d) / "clean.js"
        # THE CLEAN TWIN CARRIES THE ADJACENT-BUT-ALLOWED CONSTRUCTS, not prose.
        # Its first version put the forbidden NAMES in a comment and asserted they
        # would not be reported -- and the sweep reported them, correctly. A bare
        # `j2_theses` in a CODE file IS the question this tool exists to ask; a
        # scanner that skipped it because it sat after `//` would miss a table
        # created in a commented-out migration. The control's job is to prove the
        # LEGITIMATE neighbours stay quiet, not to make the scanner read English.
        clean.write_text(
            "export const merged = await mergeAppends(db, entry, nodes, at, snap);\n"
            "import { encryptForBroker } from './crypto_box';\n"
            "const ocr = await fetch('/api/j2/notes/' + id + '/ocr');\n"
            "export function settleNoteWrite(noteId, res) { return record(noteId, res) }\n",
            encoding="utf-8")
        _, hits, _ = sweep([planted])
        keys = {h[0] for h in hits}
        case("a planted j2_theses reference is reported", "j2_theses" in keys)
        case("a planted service-worker registration is reported", "service worker" in keys)
        case("a planted WebCrypto encrypt is reported", "E2E encryption" in keys)
        _, clean_hits, _ = sweep([clean])
        # !! THE PAIR IS THE POINT. `mergeAppends` is Q1 fix 3 -- the classified
        # APPEND_ONLY merge of the server's OWN appended blocks onto the member's
        # queued body. It is not "auto-merge of conflicts", which forks. A sweep
        # that cannot tell those apart would demand deleting the fix.
        case("the legitimate mergeAppends call is NOT reported",
             not [h for h in clean_hits if h[0] == "auto-merge of conflicts"])
        case("the allowed neighbours (server-side OCR, the broker Fernet box, "
             "settleNoteWrite, mergeAppends) are NOT reported", not clean_hits)
        for h in clean_hits:
            print(f"       false positive: {h}")

    # SCOPE IS A CLAIM AND HAS TO BE TESTED BOTH WAYS. "browser-side OCR" is the
    # same library as the server-side OCR this product ships, so the probe is
    # scoped to app/src -- and a scope that excluded everything would pass every
    # assertion above by finding nothing.
    ocr_scope = scope_of("browser-side OCR")
    case("the browser-OCR probe is scoped to the client tree", ocr_scope == ("app/src",))
    case("an unscoped probe reports None rather than an empty tuple",
         scope_of("j2_theses") is None)

    print("self-check:", "PASS" if ok else "FAIL")
    return 0 if ok else 1


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--self-check", action="store_true")
    ap.add_argument("--quiet", action="store_true")
    args = ap.parse_args()
    if args.self_check:
        return self_check()

    uncovered, hits, checked = sweep()
    print(f"DO-NOT-BUILD sweep -- {len(checked)} item(s) checked across {', '.join(ROOTS)}")

    if uncovered:
        print("\n!! SS8 CARRIES AN ITEM THIS SWEEP CANNOT CHECK -- add a probe, do not ignore it:")
        for i in uncovered:
            print(f"   - {i}")

    if hits:
        print(f"\n>> {len(hits)} MATCH(ES) -- a DO-NOT-BUILD item may have gained code:")
        for key, rel, line, frag in sorted(hits):
            print(f"   {key}: {rel}:{line}  `{frag}`")
        print("\n   Each is a QUESTION. If a match is legitimate, add it to EXEMPT with the "
              "argument written out -- never by narrowing the probe until it goes quiet.")
    elif not args.quiet:
        print("\nOK no DO-NOT-BUILD item has gained code in the swept trees.")

    return 1 if (hits or uncovered) else 0


if __name__ == "__main__":
    raise SystemExit(main())
