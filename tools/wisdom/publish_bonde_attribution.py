"""Re-attribute the "Bonde"-credited Brain KB rows by evidence (D18). READ-ONLY.

The ENGINE KB credits hundreds of rows to "Bonde"; the manifest measured most of them as
Sunday Scans content that is not his. This tool proposes an attribution for every such row
from EVIDENCE ONLY, and writes a plan. It never writes the KB: deactivation happens through
`tools/wisdom/publish_kb_sync.py --legacy-plan <plan> --apply-legacy-plan --commit`, after the
owner has reviewed the plan, and only with the Brain KB flag on.

EVIDENCE, strongest first (the first rule that fires decides)
  1. discord_channel_owner — the row came from a Discord intake of an in-scope channel whose
     owner is fixed in docs/wisdom/discord-sources.json (authorship verified per channel by
     measured author ids, docs/wisdom/authors.json).
  2. substack_section_signature — a UCT Sunday Scans row whose title or first line IS a
     section heading owned by an author in authors.json. A possessive heading ("Bracco's
     Breakdown & Top Ideas") is a signature; an unsigned section heading (Intro, Market
     Breadth Data, Index & ETFs) is credited to TSDR with attribution_source "D4 ruling".
  2b. substack_section_text — with --intake (the local Sunday Scans intake file the row was
     distilled from), the row's words overlap ONE section of one issue by at least
     SECTION_MIN_SHARE of its content words, beating every other author's best section by
     SECTION_MARGIN. The section's owner comes from the same authors.json headings as rule 2
     (an issue's opening text is its INTRO; a possessive "<Author>'s ..." line signs the
     section under it). Below either bar the rule does not fire.
  3. sample_text_authorship — with --wisdom-db, the row's text overlaps an attributed Wisdom
     segment by at least SAMPLE_MIN_OVERLAP of its 8-word shingles.
  4. source_names_stockbee — a row NOT from a UCT issue whose source names Stockbee / Pradeep
     Bonde: genuinely his; kept as external attribution.
  5. otherwise unknown — attribution "unknown", proposed for archive, never presented as anyone's.
     (A UCT Sunday Scans row that merely cites Stockbee is still unknown: citing him is not
     authorship evidence either way.)

Output: counts on stdout; with --out, a JSON plan of ids, proposals and content hashes — never
row text. The KB is opened with sqlite `mode=ro`. Nothing here imports the `api` package; the
author files are read through api/services/wisdom/core/authors.py loaded BY PATH (stdlib only).
"""
from __future__ import annotations

import argparse
import collections
import hashlib
import importlib.util
import json
import pathlib
import re
import sqlite3
import sys
from typing import Optional

REPO = pathlib.Path(__file__).resolve().parents[2]
TRADER_LIKE = "%bonde%"
UCT_SCANS_SOURCE_PREFIX = "intake:substack_unchartedterritory_sunday_scans"
_UCT_REF_RE = re.compile(r"uncharted\s*territory|unchartedterritory", re.I)
_STOCKBEE_RE = re.compile(r"stock\s*bee|pradeep\s+bonde", re.I)
_DISCORD_SOURCE_RE = re.compile(r"^intake:discord_([a-z0-9_]+)", re.I)
_DISCORD_REF_RE = re.compile(r"^discord:#([a-z0-9_\-]+)", re.I)
_WORD_RE = re.compile(r"[a-z0-9$']+")
SHINGLE = 8
SAMPLE_MIN_OVERLAP = 0.6
SECTION_MIN_SHARE = 0.6
SECTION_MARGIN = 0.15
_ISSUE_SPLIT_RE = re.compile(r"\n=== \[SUNDAY SCAN\][^\n]*\n")
_CONTENT_WORD_RE = re.compile(r"[a-z0-9$]+")
_STOPWORDS = frozenset(
    "the a an and or of to in on for with is are was were be been it its this that at as by from we our you "
    "your i my me he his they them their not but if so than then there here have has had do does did can "
    "could will would just very more most into over under out up down about after before".split())


def _load_authors():
    path = REPO / "api" / "services" / "wisdom" / "core" / "authors.py"
    spec = importlib.util.spec_from_file_location("wisdom_authors_standalone", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


authors = _load_authors()


def section_headings() -> list[tuple[str, str, str]]:
    """(heading, author_id, attribution_source) from authors.json, longest first."""
    out = []
    for a in authors.authors():
        names = [a["author_id"], a.get("display_name") or "", *(a.get("aliases") or [])]
        for heading in a.get("substack_sections") or []:
            signed = any(n and f"{n.lower()}'s" in heading.lower() for n in names)
            out.append((heading, a["author_id"], "signed section" if signed else "D4 ruling"))
    return sorted(out, key=lambda h: -len(h[0]))


def discord_channel_owners() -> dict:
    owners = {}
    for c in authors.in_scope_channels():
        if c.get("owner_author"):
            owners[str(c.get("key") or "").lower()] = c["owner_author"]
            owners[str(c.get("name") or "").lower()] = c["owner_author"]
    return owners


def _shingles(text: str) -> set:
    words = _WORD_RE.findall((text or "").lower())
    return {hash(" ".join(words[i:i + SHINGLE])) for i in range(max(0, len(words) - SHINGLE + 1))}


def load_sample_index(wisdom_db: str) -> dict:
    """{author_id: shingle set} from attributed Wisdom segments (read-only)."""
    uri = f"file:{pathlib.Path(wisdom_db).resolve().as_posix()}?mode=ro"
    conn = sqlite3.connect(uri, uri=True, timeout=30)
    index: dict = collections.defaultdict(set)
    try:
        for author_id, text in conn.execute("SELECT author_id, text FROM wisdom_segments WHERE author_id IS NOT NULL"):
            if not str(author_id).startswith("guest:"):
                index[author_id] |= _shingles(text)
    finally:
        conn.close()
    return dict(index)


def _norm_line(line: str) -> str:
    return line.replace("\u2019", "'").strip().lower()


def _content_words(text: str) -> set:
    return {w for w in _CONTENT_WORD_RE.findall((text or "").lower()) if len(w) > 2 and w not in _STOPWORDS}


def load_intake_index(paths, headings: list) -> list:
    """[(author_id, heading, attribution_source, content-word set)] for every section of every
    Sunday Scans issue in the given local intake files (read-only, never stored)."""
    heads = sorted(((_norm_line(h), a, src) for h, a, src in headings), key=lambda h: -len(h[0]))
    intro = next(((h, a, src) for h, a, src in heads if h == "intro"), None)
    signers = []
    for a in authors.authors():
        for n in [a["author_id"], a.get("display_name") or "", *(a.get("aliases") or [])]:
            n = n.strip().lower()
            if n and " " not in n and "(" not in n:
                signers.append((re.compile(rf"^{re.escape(n)}'s\s"), a["author_id"]))
    out = []
    for path in paths:
        text = pathlib.Path(path).read_text(encoding="utf-8", errors="replace")
        for issue in _ISSUE_SPLIT_RE.split(text)[1:]:
            current = intro or ("intro", None, "no INTRO heading")
            buf: list = []
            for line in issue.splitlines():
                n = _norm_line(line)
                hit = None
                if len(n) < 120:
                    for h, a, src in heads:
                        if n == h or n.startswith(h) or (h.endswith("s") and n.startswith(h[:-1] + " ")):
                            hit = (h, a, src)
                            break
                    if hit is None and len(n) < 60:
                        for pat, a in signers:
                            if pat.match(n):
                                hit = (n, a, "signed section")
                                break
                if hit:
                    if buf and current[1]:
                        out.append((current[1], current[0], current[2], _content_words(" ".join(buf))))
                    current, buf = hit, []
                else:
                    buf.append(line)
            if buf and current[1]:
                out.append((current[1], current[0], current[2], _content_words(" ".join(buf))))
    return out


def section_text_author(content_words: set, index: list) -> Optional[tuple]:
    """(author_id, heading, attribution_source, share) when one author's section clearly wins."""
    if not content_words or not index:
        return None
    best_by_author: dict = {}
    for author_id, heading, src, words in index:
        share = len(content_words & words) / len(content_words)
        if share > best_by_author.get(author_id, (0.0,))[0]:
            best_by_author[author_id] = (share, heading, src)
    ranked = sorted(best_by_author.items(), key=lambda kv: -kv[1][0])
    top_author, (top, heading, src) = ranked[0]
    runner = ranked[1][1][0] if len(ranked) > 1 else 0.0
    if top >= SECTION_MIN_SHARE and top - runner >= SECTION_MARGIN:
        return top_author, heading, src, top
    return None


def classify(row: dict, *, headings: list, channel_owners: dict, sample_index: Optional[dict] = None,
             intake_index: Optional[list] = None) -> dict:
    source, ref = row.get("source") or "", row.get("source_ref") or ""
    title, content = row.get("title") or "", row.get("content") or ""
    uct_issue = source.lower().startswith(UCT_SCANS_SOURCE_PREFIX) or bool(_UCT_REF_RE.search(ref))
    base = {"kb_id": row["id"], "current_trader": row.get("trader"), "category": row.get("category"),
            "source": source, "content_sha256": hashlib.sha256(content.encode("utf-8")).hexdigest(), "notes": []}

    def decided(author_id, evidence, attribution_source, action="reattribute"):
        return {**base, "proposed_author": author_id, "evidence": evidence,
                "attribution_source": attribution_source, "action": action}

    m = _DISCORD_SOURCE_RE.match(source) or _DISCORD_REF_RE.match(ref)
    if m and channel_owners.get(m.group(1).lower()):
        return decided(channel_owners[m.group(1).lower()], "discord_channel_owner", "discord-sources.json")
    if uct_issue:
        first_line = content.strip().splitlines()[0] if content.strip() else ""
        for heading, author_id, attribution in headings:
            pattern = re.compile(rf"^\s*{re.escape(heading)}\s*[:\-—]?\s*$", re.I)
            if pattern.match(title) or pattern.match(first_line) or heading.lower() in title.lower():
                return decided(author_id, "substack_section_signature", attribution)
    if uct_issue and intake_index:
        hit = section_text_author(_content_words(f"{title} {content} {row.get('tags') or ''}"), intake_index)
        if hit:
            author_id, heading, src, share = hit
            out = decided(author_id, "substack_section_text", src)
            out["notes"].append(f"section '{heading}', content-word share {share:.2f}")
            return out
    if sample_index:
        row_shingles = _shingles(content)
        if row_shingles:
            best = max(((len(row_shingles & s) / len(row_shingles), a) for a, s in sample_index.items()),
                       default=(0.0, None))
            if best[1] and best[0] >= SAMPLE_MIN_OVERLAP:
                return decided(best[1], "sample_text_authorship", f"overlap {best[0]:.2f}")
    if not uct_issue and _STOCKBEE_RE.search(f"{ref} {title} {content}"):
        return decided("bonde_external", "source_names_stockbee", "source reference", action="retain_external")
    out = decided("unknown", "none", "no evidence", action="archive_unknown")
    if uct_issue and _STOCKBEE_RE.search(f"{title} {content}"):
        out["notes"].append("cites Stockbee inside a UCT issue: not authorship evidence")
    return out


def attribute(db_path: str, *, wisdom_db: Optional[str] = None, trader_like: str = TRADER_LIKE,
              intake=()) -> dict:
    uri = f"file:{pathlib.Path(db_path).resolve().as_posix()}?mode=ro"
    conn = sqlite3.connect(uri, uri=True, timeout=30)
    conn.row_factory = sqlite3.Row
    try:
        rows = [dict(r) for r in conn.execute(
            "SELECT id, category, title, content, tags, trader, source, source_ref, active FROM knowledge_base "
            "WHERE LOWER(trader) LIKE ? ORDER BY id", (trader_like.lower(),))]
    finally:
        conn.close()
    headings, owners = section_headings(), discord_channel_owners()
    sample = load_sample_index(wisdom_db) if wisdom_db else None
    intake_index = load_intake_index(intake, headings) if intake else None
    proposals = [classify(r, headings=headings, channel_owners=owners, sample_index=sample,
                          intake_index=intake_index) for r in rows]
    counts = collections.Counter(p["proposed_author"] for p in proposals)
    by_evidence = collections.Counter(f"{p['evidence']}->{p['proposed_author']}" for p in proposals)
    groups: dict = collections.defaultdict(list)
    for p in proposals:
        groups[(p["evidence"], p["proposed_author"])].append(p["kb_id"])
    return {
        "rows": len(rows), "active_rows": sum(1 for r in rows if r["active"]),
        "counts": dict(counts), "by_evidence": dict(by_evidence), "sample_text_checked": bool(sample),
        "intake_sections_checked": len(intake_index or []),
        "proposals": proposals,
        "legacy_plan": {"deactivate_ids": [p["kb_id"] for p in proposals if p["action"] == "archive_unknown"],
                        "reattribute": [{"kb_id": p["kb_id"], "author_id": p["proposed_author"],
                                         "evidence": p["evidence"], "content_sha256": p["content_sha256"]}
                                        for p in proposals if p["action"] == "reattribute"]},
        "review_items": [{
            "tab": "attribution",
            "subject_ref": f"engine_kb:bonde_attribution:{evidence}:{author}",
            "summary": f"{len(ids)} KB row(s) credited to Bonde -> {author} (evidence: {evidence})",
            "old": {"trader": "Bonde", "count": len(ids)}, "new": {"author": author, "kb_ids_sample": ids[:100]},
            "evidence": {"rule": evidence},
            "recommendation": ("archive; never present as anyone's" if author == "unknown"
                               else "keep as external" if author == "bonde_external"
                               else "superseded by signed Wisdom rows; archive after the D18 swap"),
        } for (evidence, author), ids in sorted(groups.items())],
    }


def main(argv: Optional[list] = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--db", required=True, help="ENGINE KB sqlite path (opened read-only)")
    ap.add_argument("--wisdom-db", help="optional wisdom.db copy for sample-text authorship (read-only)")
    ap.add_argument("--intake", action="append", default=[],
                    help="a local Sunday Scans intake .txt the rows were distilled from (repeatable; read-only)")
    ap.add_argument("--out", help="write the JSON plan here (outside the repository)")
    args = ap.parse_args(argv)
    plan = attribute(args.db, wisdom_db=args.wisdom_db, intake=args.intake)
    if args.out:
        out = pathlib.Path(args.out).resolve()
        if out == REPO or REPO in out.parents:
            print("REFUSED: the plan must not be written inside the (public) repository", file=sys.stderr)
            return 3
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(json.dumps(plan, indent=2), encoding="utf-8")
    print(json.dumps({k: plan[k] for k in ("rows", "active_rows", "counts", "by_evidence", "sample_text_checked",
                                            "intake_sections_checked")},
                     indent=2))
    print(f"proposed archive (unknown): {len(plan['legacy_plan']['deactivate_ids'])}; "
          f"re-attributions: {len(plan['legacy_plan']['reattribute'])}; review items: {len(plan['review_items'])}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
