"""Sunday Scans source: the PUBLISHED Substack issue only (W1 §0.4a, §2.3; CONTRACTS.md §6.3).

READ PATH. desk.db is read read-only: the roster through one SELECT on a
`mode=ro` connection to desk_store's own path, the body through
desk_store.get_post_raw. The selecting query REQUIRES `published_at > 0`, so a
draft-shaped row (published_at 0 or NULL) can never be selected
(tests/test_wisdom_sources_sunday_scans.py proves it against both shapes).

⛔ This module never imports the Substack publisher or the sunday_scan
publish/run/promo modules and never reads the saved Substack login. The only
network call is substack_bodies.fetch_body — a public, unauthenticated GET of
the post's /api/v1/posts/{slug} — used to VERIFY the stored body.

VERIFY. published_check = 'public_api_match' when the public API serves the
issue with audience == 'everyone' AND its normalised text is >= 0.98 similar to
the stored body; 'mismatch' when it answers with another audience or different
text; 'unchecked' when it could not be fetched.

ATTRIBUTION (authors.json substack_sections + the D4 ruling): a signed section
(TSDR's Weekly Outlook & Watchlist, Bracco's Breakdown & Top Ideas) is its
author's; every unsigned section (Intro, Calendar, Breadth, Index & ETFs, and
the preamble) is TSDR's with attribution_source "D4 ruling". Sub-headings inherit.

CHARTS. Every <img> becomes a provisional wisdom_chart_images row labelled by the
nearest earlier short line. No bytes are fetched and no vision runs (D13 cost
gate, W2): image_id is therefore 'url-sha256:<sha256 of the canonical original
image URL>' — see the report for the requested contract note.
"""
from __future__ import annotations

import difflib
import json
import re
import sqlite3
import time
import unicodedata
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path
from typing import Callable, Optional
from urllib.parse import unquote, urlsplit, urlunsplit

from api.services.wisdom.core import authors, ids, timeutil

STREAM = "sunday_scans"
NORMALIZER_VERSION = "sunday-scans-sections-v1"
SIMILARITY_THRESHOLD = 0.98
SERIES = "sunday scans"
VERIFY_PACE_S = 1.0
LABEL_MAX_CHARS = 60

# THE selecting query. `published_at > 0` is the publish-only check (W1 §2.3):
# NULL > 0 is NULL and 0 > 0 is false, so neither draft shape can come back.
SELECT_PUBLISHED_ISSUES_SQL = """
SELECT id, url, title, display_title, published_at, body_hash, image_count
  FROM substack_posts
 WHERE published_at > 0
   AND (LOWER(COALESCE(title, '')) LIKE '%sunday scans%'
        OR LOWER(COALESCE(display_title, '')) LIKE '%sunday scans%')
 ORDER BY published_at DESC, id DESC
"""


# ── desk.db (read-only) ──────────────────────────────────────────────────────

def _desk_db_path() -> str:
    from api.services import desk_store

    return desk_store._DB_PATH


def published_issues(limit: Optional[int] = None) -> list[dict]:
    path = Path(_desk_db_path())
    if not path.exists():
        return []
    conn = sqlite3.connect(path.resolve().as_uri() + "?mode=ro", uri=True, timeout=5.0)
    conn.row_factory = sqlite3.Row
    try:
        rows = [dict(r) for r in conn.execute(SELECT_PUBLISHED_ISSUES_SQL)]
    finally:
        conn.close()
    out, seen = [], set()
    for r in rows:
        key = canonical_post_url(r.get("url") or "") or str(r.get("id"))
        if key in seen:
            continue
        seen.add(key)
        out.append(r)
        if limit is not None and len(out) >= int(limit):
            break
    return out


def canonical_post_url(url: str) -> str:
    parts = urlsplit((url or "").strip())
    if not parts.scheme or not parts.netloc:
        return ""
    return urlunsplit(("https", parts.netloc.lower(), parts.path.rstrip("/"), "", ""))


def external_ref_for(post: dict) -> str:
    return "substack:" + (canonical_post_url(post.get("url") or "") or str(post.get("id")))


# ── HTML → blocks (pure) ─────────────────────────────────────────────────────

_TEXT_BLOCKS = frozenset({"p", "li", "blockquote", "pre", "figcaption"})
_HEADINGS = frozenset({"h1", "h2", "h3", "h4", "h5", "h6"})
_SKIP = frozenset({"script", "style", "svg", "button", "form", "noscript"})
_QUOTES = str.maketrans({"‘": "'", "’": "'", "“": '"', "”": '"', " ": " "})
_WS = re.compile(r"\s+")


def normalize_text(text: str) -> str:
    return _WS.sub(" ", unicodedata.normalize("NFKC", text or "").translate(_QUOTES)).strip()


class _Blocks(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.events: list[tuple] = []
        self._buf: list[str] = []
        self._kind: Optional[str] = None
        self._skip = 0

    def _flush(self):
        # A <br> inside a block is a LINE: the chart label ("SPY (Daily)") and the
        # commentary after it share one <p> and must stay separate lines.
        if self._kind:
            for piece in "".join(self._buf).split("\n"):
                text = normalize_text(piece)
                if text:
                    self.events.append((self._kind, text))
        self._buf, self._kind = [], None

    def handle_starttag(self, tag, attrs):
        if tag in _SKIP:
            self._skip += 1
            return
        if self._skip:
            return
        if tag in _HEADINGS or tag in _TEXT_BLOCKS:
            self._flush()
            self._kind = tag if tag in _HEADINGS else "text"
        elif tag == "br":
            self._buf.append("\n")
        elif tag == "img":
            a = dict(attrs)
            original = None
            try:
                original = (json.loads(a.get("data-attrs") or "{}") or {}).get("src")
            except (ValueError, TypeError):
                original = None
            self.events.append(("img", {"src": a.get("src") or "", "original": original,
                                        "width": a.get("width"), "height": a.get("height")}))

    def handle_endtag(self, tag):
        if tag in _SKIP:
            self._skip = max(0, self._skip - 1)
            return
        if self._skip:
            return
        if tag in _HEADINGS or tag in _TEXT_BLOCKS:
            self._flush()

    def handle_data(self, data):
        if self._skip:
            return
        if self._kind is None:
            if not data.strip():
                return
            self._kind = "text"
        self._buf.append(data)

    def close(self):
        super().close()
        self._flush()


def blocks(raw_html: str) -> list[tuple]:
    p = _Blocks()
    p.feed(raw_html or "")
    p.close()
    return p.events


def html_to_text(raw_html: str) -> str:
    return "\n".join(e[1] for e in blocks(raw_html) if e[0] != "img")


# ── attribution ──────────────────────────────────────────────────────────────

def _norm_heading(text: str) -> str:
    t = normalize_text(text).casefold().replace("&", " and ")
    return _WS.sub(" ", re.sub(r"[^a-z0-9' ]+", " ", t)).strip()


def known_sections() -> list[dict]:
    out = []
    for a in authors.authors():
        aliases = {_norm_heading(x) for x in [a["author_id"], a.get("display_name") or ""]
                   + list(a.get("aliases") or []) if x}
        for name in a.get("substack_sections") or []:
            norm = _norm_heading(name)
            signed = any(norm.startswith(f"{al}'s ") for al in aliases if al)
            out.append({"name": name, "norm": norm, "author_id": a["author_id"], "signed": signed})
    # Longest first so "Earnings and Economic Calendar for the Week" beats a shorter prefix.
    return sorted(out, key=lambda s: -len(s["norm"]))


def _match_section(heading: str, sections: list[dict]) -> Optional[dict]:
    norm = _norm_heading(heading)
    for s in sections:
        if norm == s["norm"] or norm.startswith(s["norm"] + " ") or norm.startswith(s["norm"]):
            return s
    return None


_LABEL = re.compile(r"^\$?([A-Z]{1,5}(?:[.\-][A-Z]{1,2})?)\b[^()]{0,20}\(([^()]{1,40})\)")


def label_parts(label: Optional[str]) -> tuple[Optional[str], Optional[str]]:
    m = _LABEL.match((label or "").strip())
    if not m:
        return None, None
    return m.group(1), m.group(2).strip().lower()


def canonical_image_url(src: str, original: Optional[str] = None) -> str:
    if original and original.startswith("http"):
        return original
    src = src or ""
    marker = src.rfind("/https%3A%2F%2F")
    if marker != -1:
        return unquote(src[marker + 1:])
    return src


def parse_issue(raw_html: str) -> dict:
    """{text, segments, images}. Pure: the same HTML always yields the same output."""
    sections = known_sections()
    segments: list[dict] = []
    images: list[dict] = []
    lines: list[str] = []
    char = 0
    current_top: Optional[dict] = None
    cur = {"path": "Preamble", "lines": [], "char_start": 0, "attr": None, "label": None}

    def attribution(match_rule: str) -> dict:
        if current_top is None:
            return {"author_id": "tsdr", "attribution_source": "D4 ruling", "rule": match_rule,
                    "section_title": None}
        return {"author_id": current_top["author_id"],
                "attribution_source": "signed section" if current_top["signed"] else "D4 ruling",
                "rule": match_rule, "section_title": current_top["name"]}

    cur["attr"] = attribution("unsigned_preamble")

    def close():
        nonlocal cur
        text = "\n".join(cur["lines"]).strip()
        if text:
            segments.append({
                "ordinal": len(segments), "kind": "section", "path": cur["path"],
                "char_start": cur["char_start"], "char_end": max(cur["char_start"], char - 1),
                "speaker_label": cur["attr"]["section_title"], "author_id": cur["attr"]["author_id"],
                "speaker_confidence": "high" if cur["attr"]["attribution_source"] == "signed section" else "medium",
                "text": text, "attribution": cur["attr"],
            })

    for kind, payload in blocks(raw_html):
        if kind == "img":
            # The author's prose sits BETWEEN the label and the chart (manifest §2.3),
            # and a short prose line must not steal the label: a line shaped like a
            # chart label ("SPY (Daily)") wins; otherwise the nearest short line.
            images.append({
                "segment_ordinal": len(segments), "label_text": cur.get("chart_label") or cur["label"],
                "public_url": canonical_image_url(payload.get("src"), payload.get("original")),
                "width": int(payload["width"]) if str(payload.get("width") or "").isdigit() else None,
                "height": int(payload["height"]) if str(payload.get("height") or "").isdigit() else None,
            })
            continue
        if kind in _HEADINGS:
            close()
            match = _match_section(payload, sections)
            if match is not None:
                current_top = match
                path, rule = match["name"], ("signed_section" if match["signed"] else "d4_named_section")
            elif current_top is not None:
                path, rule = f"{current_top['name']} > {payload}", "inherits_section"
            else:
                path, rule = payload, "unsigned_preamble"
            short = payload if len(payload) <= LABEL_MAX_CHARS else None
            cur = {"path": path, "lines": [], "char_start": char, "attr": attribution(rule), "label": short,
                   "chart_label": short if short and label_parts(short)[0] else None}
            line = payload
        else:
            line = payload
            if len(payload) <= LABEL_MAX_CHARS:
                cur["label"] = payload
                if label_parts(payload)[0]:
                    cur["chart_label"] = payload
        cur["lines"].append(line)
        lines.append(line)
        char += len(line) + 1
    close()
    # An image's segment is the one open when it appeared (the section it sits in).
    for img in images:
        img["segment_ordinal"] = min(img["segment_ordinal"], max(0, len(segments) - 1))
    return {"text": "\n".join(lines), "segments": segments, "images": images}


def similarity(a: str, b: str) -> float:
    """Character-weighted share of matching lines. 1.0 for identical texts."""
    la, lb = (a or "").split("\n"), (b or "").split("\n")
    total = max(len(a or ""), len(b or ""))
    if total == 0:
        return 1.0
    sm = difflib.SequenceMatcher(None, la, lb, autojunk=False)
    matched = sum(len("\n".join(la[i:i + n])) for i, _j, n in sm.get_matching_blocks() if n)
    return round(min(1.0, matched / total), 4)


# ── ingest ───────────────────────────────────────────────────────────────────

def _et_from_epoch(value) -> Optional[str]:
    try:
        return timeutil.iso_et(datetime.fromtimestamp(int(value), tz=timezone.utc))
    except (TypeError, ValueError, OSError, OverflowError):
        return None


def _latest_check(conn, lineage: str, raw_sha256: Optional[str] = None) -> str:
    """The public-URL verdict that belongs to THESE bytes, else 'unchecked'.

    ⛔ Reviewer R6, 2026-09-13. `published_check` used to be the newest verdict for the
    lineage, whatever body earned it. An owner edit after the Sunday verification then
    produced a v2 the public API had never been compared against, carrying
    'public_api_match' — a verification claim about bytes nobody checked
    (lesson_a_comment_claiming_agreement_is_not_agreement). A verdict is pinned to the
    `stored_sha256` it was measured on; a different sha is 'unchecked' until re-verified."""
    row = conn.execute(
        "SELECT result, stored_sha256 FROM wisdom_sunday_scans_checks WHERE lineage_id = ? "
        "ORDER BY checked_at DESC LIMIT 1",
        (lineage,),
    ).fetchone()
    if row is None:
        return "unchecked"
    if raw_sha256 is not None and row["stored_sha256"] != raw_sha256:
        return "unchecked"
    return row["result"]


def ingest_issue(post: dict, *, dry_run: bool = False, r2_module=None) -> dict:
    from api.services import desk_store
    from api.services.wisdom.core import store
    from api.services.wisdom.sources import common

    external_ref = external_ref_for(post)
    raw = desk_store.get_post_raw(str(post["id"]))
    if not raw:
        return {"post_id": post["id"], "action": "no_body"}
    raw_sha = ids.sha256_text(raw)
    lineage = common.lineage_id(STREAM, external_ref)
    with store.read() as conn:
        plan = common.plan_version(conn, STREAM, external_ref, raw_sha)
        check = _latest_check(conn, lineage, raw_sha)
    if plan["action"] in ("unchanged", "reverted"):
        return {"post_id": post["id"], "action": plan["action"]}
    version = plan["version"]
    source_id = common.source_id_for(STREAM, external_ref, version)
    parsed = parse_issue(raw)
    result = {"post_id": post["id"], "action": plan["action"], "version": version, "source_id": source_id,
              "segments": len(parsed["segments"]), "images": len(parsed["images"])}
    if dry_run:
        result["action"] = f"would_{plan['action']}"
        return result
    put = common.put_raw_text(STREAM, external_ref, version, parsed["text"], r2_module=r2_module)
    now_iso = common.now_iso()
    with store.write() as conn:
        again = common.plan_version(conn, STREAM, external_ref, raw_sha)
        if again["action"] != plan["action"] or again.get("version") != version:
            result["action"] = "raced"
            return result
        common.insert_source(conn, {
            "source_id": source_id, "stream": STREAM, "external_ref": external_ref, "version": version,
            "supersedes_source_id": plan["supersedes"],
            "home_pointer": f"desk.db substack_posts.id={post['id']}",
            "published_at_et": _et_from_epoch(post.get("published_at")),
            "title": post.get("display_title") or post.get("title"), "show": "Sunday Scans",
            "host_author_id": "tsdr", "raw_r2_key": put["key"], "raw_sha256": raw_sha,
            "media_pointer": canonical_post_url(post.get("url") or "") or None,
            "coverage_ratio": None, "incomplete": 0, "published_check": check, "ingested_at": now_iso,
        })
        common.insert_segments(conn, source_id, version, parsed["segments"], NORMALIZER_VERSION)
        for seg in parsed["segments"]:
            a = seg["attribution"]
            conn.execute(
                "INSERT OR IGNORE INTO wisdom_source_attributions "
                "(segment_id, source_id, author_id, attribution_source, rule, section_title) "
                "VALUES (?, ?, ?, ?, ?, ?)",
                (common.segment_id_for(source_id, version, seg["ordinal"]), source_id, a["author_id"],
                 a["attribution_source"], a["rule"], a["section_title"]),
            )
        images_written = 0
        for img in parsed["images"]:
            if not img["public_url"]:
                continue
            ticker, timeframe = label_parts(img["label_text"])
            seg_id = (common.segment_id_for(source_id, version, img["segment_ordinal"])
                      if parsed["segments"] else None)
            before = conn.total_changes
            conn.execute(
                """INSERT OR IGNORE INTO wisdom_chart_images
                     (image_id, source_id, segment_id, origin, public_url, r2_key, width, height,
                      label_text, label_ticker, label_timeframe, status, created_at)
                   VALUES (?, ?, ?, 'sunday_scans', ?, NULL, ?, ?, ?, ?, ?, 'provisional', ?)""",
                ("url-sha256:" + ids.sha256_text(img["public_url"]), source_id, seg_id, img["public_url"],
                 img["width"], img["height"], img["label_text"], ticker, timeframe, now_iso),
            )
            images_written += conn.total_changes - before
        result["images_written"] = images_written
    return result


def ingest_all(*, limit: int = 100, dry_run: bool = False, r2_module=None,
               log: Callable[[str], None] = None) -> dict:
    counts: dict[str, int] = {}
    errors: list[dict] = []
    written = 0
    issues = published_issues(limit=limit)
    for post in issues:
        try:
            out = ingest_issue(post, dry_run=dry_run, r2_module=r2_module)
        except Exception as exc:  # noqa: BLE001 — one issue never stops the walk
            errors.append({"post_id": post.get("id"), "error": f"{type(exc).__name__}: {str(exc)[:200]}"})
            continue
        counts[out["action"]] = counts.get(out["action"], 0) + 1
        if out["action"] in ("new", "changed"):
            written += 1
            if log:
                log(f"sunday scans {post.get('id')} {out['action']} v{out['version']} "
                    f"segments={out['segments']} images={out['images']}")
    return {"issues": len(issues), "written": written, "actions": counts, "errors": errors,
            "dry_run": dry_run}


# ── verify ───────────────────────────────────────────────────────────────────

def verify_issue(post: dict, *, fetch_body: Callable[[str], Optional[dict]] = None,
                 dry_run: bool = False) -> dict:
    from api.services import desk_store
    from api.services.wisdom.core import store
    from api.services.wisdom.sources import common

    if fetch_body is None:
        from api.services import substack_bodies

        fetch_body = substack_bodies.fetch_body
    url = post.get("url") or ""
    external_ref = external_ref_for(post)
    lineage = common.lineage_id(STREAM, external_ref)
    stored = desk_store.get_post_raw(str(post["id"])) or ""
    stored_text = html_to_text(stored)
    out = {"post_id": post.get("id"), "url": canonical_post_url(url), "result": "unchecked",
           "audience": None, "similarity": None, "reason": None,
           "stored_sha256": ids.sha256_text(stored) if stored else None, "public_sha256": None}
    fetched = None
    try:
        fetched = fetch_body(url)
    except Exception as exc:  # noqa: BLE001
        out["reason"] = f"fetch raised {type(exc).__name__}"
    if not stored:
        out["reason"] = "no stored body"
    elif fetched is None:
        out["reason"] = out["reason"] or "public API refused or unreachable"
    else:
        out["audience"] = (fetched.get("audience") or "").strip().lower() or None
        public_raw = fetched.get("raw") or ""
        out["public_sha256"] = ids.sha256_text(public_raw)
        out["similarity"] = similarity(stored_text, html_to_text(public_raw))
        if out["audience"] != "everyone":
            out["result"], out["reason"] = "mismatch", f"audience is {out['audience']!r}, not 'everyone'"
        elif out["similarity"] >= SIMILARITY_THRESHOLD:
            out["result"] = "public_api_match"
        else:
            out["result"], out["reason"] = "mismatch", f"similarity {out['similarity']} < {SIMILARITY_THRESHOLD}"
    if dry_run:
        return out
    checked_at = common.now_iso()
    with store.write() as conn:
        conn.execute(
            """INSERT OR IGNORE INTO wisdom_sunday_scans_checks
                 (check_id, lineage_id, url, checked_at, result, audience, similarity,
                  stored_sha256, public_sha256, reason)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (ids.sha24(lineage, checked_at, time.time_ns()), lineage, out["url"] or url, checked_at,
             out["result"], out["audience"], out["similarity"], out["stored_sha256"],
             out["public_sha256"], out["reason"]),
        )
        conn.execute(
            """UPDATE wisdom_sources SET published_check = ?
               WHERE stream = ? AND external_ref = ?
                 AND version = (SELECT MAX(version) FROM wisdom_sources WHERE stream = ? AND external_ref = ?)""",
            (out["result"], STREAM, external_ref, STREAM, external_ref),
        )
    return out


def verify_recent(limit: int = 2, *, fetch_body=None, dry_run: bool = False, pace_s: float = VERIFY_PACE_S,
                  progress: Callable[[dict], None] = None) -> dict:
    results = []
    for i, post in enumerate(published_issues(limit=max(1, int(limit)))):
        if i and pace_s:
            time.sleep(pace_s)
        res = verify_issue(post, fetch_body=fetch_body, dry_run=dry_run)
        results.append(res)
        if progress:
            progress(res)
    tally: dict[str, int] = {}
    for r in results:
        tally[r["result"]] = tally.get(r["result"], 0) + 1
    return {"checked": len(results), "results": tally,
            "issues": [{k: r[k] for k in ("post_id", "url", "result", "audience", "similarity", "reason")}
                       for r in results]}
