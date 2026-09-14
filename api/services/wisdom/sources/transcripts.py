"""Transcript sources: edu_videos → wisdom_sources + cue-window segments (CONTRACTS.md §6.3, W1 §4.4).

READ-ONLY on education.db, and only through education_service:
  * education_service.list_video_creative_stubs() — the lean roster (no transcript column);
  * education_service.get_video(id) — one row, on a scheduler thread only;
  * education_service.get_transcript_cues(id) — THE transcript parser. Stored
    transcripts carry two stamp shapes ('[m:ss]' and '[h:mm:ss]'); a hand regex
    manufactured 9 false zero-coverage rows once (manifest §2.1). Nothing here
    parses the stored block itself.
  * education_service.get_insights(id) — chapters, for segment paths.

PRIVACY (W1 §4.4, §0.4e): a speaker label that is not one of the four authors,
the team non-author list, or a guest named in the title/description is an
ATTENDEE, and an attendee's name is never stored — not in a segment, not in the
R2 text. raw_sha256 is the sha of the education.db transcript (change detection
only; a hash reveals no name).

Coverage = last cue start / video duration (edu_videos.duration). NULL when the
duration is unknown; incomplete = 1 below 0.98 (CONTRACTS §0 #5).
"""
from __future__ import annotations

import importlib
import importlib.util
import json
import re
import time
from datetime import datetime, timezone
from typing import Callable, Optional

from api.services.wisdom.core import authors, ids, timeutil

COVERAGE_THRESHOLD = 0.98
NORMALIZER_VERSION = "transcript-speakers-v1"
WINDOW_MAX_S = 90
WINDOW_MAX_CHARS = 1800
LABEL_MAX_LEN = 48
LABELED_FRACTION = 0.5
SETTLE_AFTER_INSIGHTS_S = 3 * 3600
PENDING_WINDOW_S = 7 * 86400

STREAMS = ("zoom_live", "workshop", "interview", "education")
_LIVE_CATEGORIES = frozenset({
    "live trading sessions", "live sessions", "evening update", "post-market recaps",
    "post market recap", "post-market recap", "thoughts on the market", "sunday scans zoom", "sharpen",
})


# ── classification (pure) ────────────────────────────────────────────────────

def stream_for(category: Optional[str], meeting_uuid: Optional[str] = None) -> str:
    c = (category or "").strip().casefold()
    if "interview" in c:
        return "interview"
    if "workshop" in c or "fireside" in c:
        return "workshop"
    if (meeting_uuid or "").strip() or c in _LIVE_CATEGORIES:
        return "zoom_live"
    return "education"


def duration_seconds(value) -> Optional[int]:
    """edu_videos.duration is free text ('1:39:46', '45:59'); an int is seconds."""
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return int(value) if value > 0 else None
    parts = str(value).strip().split(":")
    if not parts or not all(p.strip().isdigit() for p in parts) or len(parts) > 3:
        return None
    total = 0
    for p in parts:
        total = total * 60 + int(p)
    return total or None


def coverage_ratio(cues: list[dict], duration_s: Optional[int]) -> Optional[float]:
    if not duration_s or duration_s <= 0:
        return None
    if not cues:
        return 0.0
    last = max(int(c.get("t") or 0) for c in cues)
    return round(min(1.0, last / float(duration_s)), 4)


_GUEST_PATTERNS = (
    re.compile(r"\bfeat(?:uring|\.)?\s+(.+)$", re.IGNORECASE),
    re.compile(r"\bft\.?\s+(.+)$", re.IGNORECASE),
    re.compile(r"\bw/\s*(.+)$", re.IGNORECASE),
    re.compile(r"\bwith\s+(.+)$", re.IGNORECASE),
    re.compile(r"\binterview(?:ing)?\s*[:\-–—]\s*(.+)$", re.IGNORECASE),
)
_HANDLE = re.compile(r"@([A-Za-z0-9_]{2,30})")
_NAME_SPLIT = re.compile(r"\s*(?:,|&|\band\b|\bx\b|\+)\s*", re.IGNORECASE)


def _team_labels() -> set[str]:
    data = authors.load_authors()
    return {str(s.get("label") or "").strip().casefold()
            for s in data.get("non_call_speakers") or [] if s.get("label")}


def _is_team_or_author(name: str) -> bool:
    n = name.strip().casefold()
    return bool(authors.author_for_alias(name)) or n in _team_labels()


def _is_not_a_guest(name: str) -> bool:
    """⛔ CONTRACTS §8a.2 / §8b.2 (reviewer R3, 2026-09-13). An AMBIGUOUS label is a
    label that cannot name one person — the shared Zoom host account
    ("Uncharted Territory") and the three bare given names. It is not an author, so
    `author_for_alias` answers None; before this guard `guests_from` therefore read
    "Workshop with Uncharted Territory" and MINTED `guest:uncharted-territory`, the
    exact "the resolver invented a person" defect §8b.2 was written about, for the
    third time in this programme. An ambiguous label is never a guest and never an
    author: it is `team-unresolved`, resolved per session only with cited evidence."""
    return _is_team_or_author(name) or authors.is_ambiguous_label(name)


def guests_from(title: Optional[str], description: Optional[str] = None) -> list[str]:
    """Guest names from the session title (and @handles in the description).

    Heuristic by design (W1 §4.4 "guests from title/description"); an author or a
    team member is never a guest."""
    found: list[str] = []
    head = re.split(r"\s+[—|–]\s+", (title or "").strip())[0]
    for pat in _GUEST_PATTERNS:
        m = pat.search(head)
        if not m:
            continue
        tail = re.split(r"[:(]", m.group(1))[0]
        for part in _NAME_SPLIT.split(tail):
            name = part.strip().lstrip("@").strip(" .-")
            if name and len(name) <= 40 and any(ch.isalpha() for ch in name):
                found.append(name)
        break
    for m in _HANDLE.finditer(" ".join([title or "", description or ""])):
        found.append(m.group(1))
    out, seen = [], set()
    for name in found:
        key = name.casefold()
        if key in seen or _is_not_a_guest(name):
            continue
        if key in {"the", "us", "me", "you", "him", "her", "them", "friends", "q&a"}:
            continue
        seen.add(key)
        out.append(name)
    return out


def _guest_slug(name: str) -> str:
    return "guest:" + re.sub(r"[^a-z0-9]+", "-", name.casefold()).strip("-")


def _external_speaker_fn():
    """core.speakers (stream S-B) when it exists; the skeleton's authors aliases otherwise."""
    name = "api.services.wisdom.core.speakers"
    try:
        if importlib.util.find_spec(name) is None:
            return None
        mod = importlib.import_module(name)
    except Exception:
        return None
    for attr in ("author_for_label", "resolve_speaker", "normalize_speaker"):
        fn = getattr(mod, attr, None)
        if callable(fn):
            return fn
    return None


def speaker_resolver(guests: list[str]) -> Callable[[Optional[str]], dict]:
    external = _external_speaker_fn()
    team = _team_labels()
    guest_keys = [(g, g.casefold()) for g in guests]
    display = {a["author_id"]: a.get("display_name") or a["author_id"] for a in authors.authors()}

    def resolve(label: Optional[str]) -> dict:
        if label is None:
            return {"kind": "unlabeled", "speaker_label": None, "author_id": None, "confidence": "low"}
        # ⛔⛔ CONTRACTS §8a.2, FIRST — before the alias lookup, before team, before the
        # guest match. An ambiguous label is the shared host account or a bare given
        # name: it may be an AUTHOR speaking, so it must not be dropped as an attendee
        # ("never dropped as an attendee", authors.json), and it may be somebody else,
        # so it must not become an author or a minted guest either. Both wrong answers
        # were live before this guard: with the label in the title it resolved to
        # `guest:uncharted-territory` (an invented person), without it to `attendee`
        # (the host's own words filed as anonymous). The stored label is the CONSTANT
        # `team-unresolved`, never the raw text — "Patrick" is also an attendee's name
        # and an attendee's name is never stored (W1 §0.4e).
        if authors.is_ambiguous_label(label):
            return {"kind": "team_unresolved", "speaker_label": authors.TEAM_UNRESOLVED,
                    "author_id": authors.TEAM_UNRESOLVED, "confidence": "low",
                    "ambiguous_label": str(label).strip()}
        author_id = None
        if external is not None:
            try:
                got = external(label)
                if isinstance(got, dict):
                    got = got.get("author_id")
                author_id = got if isinstance(got, str) and got in display else None
            except Exception:
                author_id = None
        if author_id is None:
            author_id = authors.author_for_alias(label)
        if author_id:
            return {"kind": "author", "speaker_label": display[author_id], "author_id": author_id,
                    "confidence": "high"}
        key = label.strip().casefold()
        if key in team:
            return {"kind": "team", "speaker_label": label.strip(), "author_id": None, "confidence": "high"}
        for g, gk in guest_keys:
            if gk and (gk in key or key in gk):
                return {"kind": "guest", "speaker_label": g, "author_id": _guest_slug(g),
                        "confidence": "medium"}
        # An attendee. The name is dropped here and never travels further.
        return {"kind": "attendee", "speaker_label": None, "author_id": None, "confidence": "low"}

    return resolve


def _candidate_label(text: str) -> tuple[Optional[str], str]:
    head, sep, tail = (text or "").partition(": ")
    head = head.strip()
    if (sep and 1 <= len(head) <= LABEL_MAX_LEN and any(ch.isalpha() for ch in head)
            and head.count(" ") <= 5 and not head.casefold().startswith(("http", "www"))):
        return head, tail.strip()
    return None, (text or "").strip()


def split_speakers(cues: list[dict]) -> list[dict]:
    """[{t, label, text}]. Labels are honoured only when the transcript is labeled
    throughout (Zoom labels every cue or none), so 'Note: ...' in an unlabeled
    transcript is text, not a speaker."""
    parsed = [(int(c.get("t") or 0),) + _candidate_label(str(c.get("text") or "")) for c in cues]
    labeled = bool(parsed) and sum(1 for p in parsed if p[1]) / len(parsed) >= LABELED_FRACTION
    out = []
    for t, label, tail in parsed:
        if labeled and label:
            out.append({"t": t, "label": label, "text": tail})
        else:
            out.append({"t": t, "label": None,
                        "text": (f"{label}: {tail}" if label and not labeled else tail).strip()})
    return out


def build_segments(cues: list[dict], chapters: list[dict], resolve: Callable) -> tuple[list[dict], str]:
    """Speaker/chapter/size-bounded cue windows plus the privacy-normalised text."""
    items = sorted(split_speakers(cues), key=lambda c: c["t"])
    chaps = sorted(({"t": int(c.get("t") or 0), "title": str(c.get("title") or "").strip()}
                    for c in (chapters or []) if isinstance(c, dict)), key=lambda c: c["t"])

    def chapter_at(t: int) -> Optional[str]:
        title = None
        for c in chaps:
            if c["t"] <= t:
                title = c["title"] or title
            else:
                break
        return title

    lines: list[str] = []
    char = 0
    windows: list[dict] = []
    cur: Optional[dict] = None
    for item in items:
        who = resolve(item["label"])
        # The raw ambiguous label separates two unresolved speakers into two windows.
        # It is a WINDOW KEY only — never stored, never written to the R2 text.
        key = (who["kind"], who["author_id"], who["speaker_label"], who.get("ambiguous_label"))
        chapter = chapter_at(item["t"])
        spoken = {"author": who["speaker_label"], "team": who["speaker_label"],
                  "guest": who["speaker_label"], "attendee": "Attendee",
                  "team_unresolved": authors.TEAM_UNRESOLVED}.get(who["kind"])
        line = f"[{_stamp(item['t'])}] " + (f"{spoken}: " if spoken else "") + item["text"]
        if cur is not None and (key != cur["key"] or item["t"] - cur["t_start_s"] >= WINDOW_MAX_S
                                or cur["chars"] + len(item["text"]) > WINDOW_MAX_CHARS
                                or chapter != cur["chapter"]):
            windows.append(cur)
            cur = None
        if cur is None:
            cur = {"key": key, "who": who, "chapter": chapter, "t_start_s": item["t"],
                   "t_last": item["t"], "texts": [], "chars": 0, "char_start": char}
        cur["texts"].append(item["text"])
        cur["chars"] += len(item["text"]) + 1
        cur["t_last"] = item["t"]
        lines.append(line)
        char += len(line) + 1
        cur["char_end"] = char - 1
    if cur is not None:
        windows.append(cur)

    segments = []
    for i, w in enumerate(windows):
        nxt = windows[i + 1]["t_start_s"] if i + 1 < len(windows) else w["t_last"]
        segments.append({
            "ordinal": i, "kind": "cue_window", "path": w["chapter"],
            "t_start_s": float(w["t_start_s"]), "t_end_s": float(max(nxt, w["t_last"])),
            "char_start": w["char_start"], "char_end": w["char_end"],
            "speaker_label": w["who"]["speaker_label"], "author_id": w["who"]["author_id"],
            "speaker_confidence": w["who"]["confidence"],
            "text": " ".join(t for t in w["texts"] if t).strip(),
        })
    return segments, "\n".join(lines)


def speaker_resolution(cues: list[dict], resolve: Callable) -> Optional[str]:
    """The §8a.2 evidence log for `wisdom_sources.speaker_resolution_json`, or None.

    ⛔ The column has existed in wisdom-db-v0.sql since the ruling and NOBODY WROTE IT
    (reviewer R4b). It is what makes "resolved with cited evidence" auditable rather
    than asserted: one entry per ambiguous label the session actually contains, what it
    resolved to, and the evidence considered. This build cites NO per-session evidence,
    so every entry is `team-unresolved` with an empty `evidence` list — which is the
    honest record, and the thing an attribution-queue reader can act on."""
    seen: dict[str, int] = {}
    for item in split_speakers(cues):
        who = resolve(item["label"])
        if who["kind"] != "team_unresolved":
            continue
        label = who.get("ambiguous_label") or str(item["label"] or "")
        seen[label] = seen.get(label, 0) + 1
    if not seen:
        return None
    return json.dumps({
        "rule": "CONTRACTS §8a.2",
        "labels": [{"label": label, "cues": n, "resolved_to": authors.TEAM_UNRESOLVED,
                    "evidence": [], "reason": "no per-session evidence is cited by this ingest; "
                                              "MENTION only, attribution queue"}
                   for label, n in sorted(seen.items())],
    }, ensure_ascii=False, sort_keys=True)


def _stamp(sec: int) -> str:
    from api.services.wisdom.sources.common import hhmmss

    return hhmmss(sec)


def host_author_from_title(title: Optional[str]) -> Optional[str]:
    words = re.findall(r"[A-Za-z0-9_()]+(?:'s)?", title or "")
    hits = set()
    for w in words:
        base = w[:-2] if w.lower().endswith("'s") else w
        who = authors.author_for_alias(base)
        if who:
            hits.add(who)
    return next(iter(hits)) if len(hits) == 1 else None


def is_settled(row: dict, now_s: Optional[int] = None) -> bool:
    """A live session is ingested only once the Desk pipeline is done with it:
    insights stored 3 h ago AND (Zoom cleaned up OR its 7-day pending window closed)."""
    if not (row.get("meeting_uuid") or "").strip():
        return True
    now_s = int(now_s if now_s is not None else time.time())
    insights_at = row.get("insights_at")
    if not insights_at or now_s - int(insights_at) < SETTLE_AFTER_INSIGHTS_S:
        return False
    created = int(row.get("created_at") or now_s)
    return bool(row.get("zoom_cleaned")) or now_s - created >= PENDING_WINDOW_S


def _et_from_epoch(value) -> Optional[str]:
    try:
        return timeutil.iso_et(datetime.fromtimestamp(int(value), tz=timezone.utc))
    except (TypeError, ValueError, OSError, OverflowError):
        return None


def _et_from_iso(value) -> Optional[str]:
    if not value:
        return None
    try:
        return timeutil.iso_et(datetime.fromisoformat(str(value).replace("Z", "+00:00")))
    except ValueError:
        return None


# ── ingest ───────────────────────────────────────────────────────────────────

def ingest_video(video_id: int, *, dry_run: bool = False, r2_module=None,
                 now_s: Optional[int] = None) -> dict:
    from api.services import education_service
    from api.services.wisdom.core import store
    from api.services.wisdom.sources import common

    vid = int(video_id)
    v = education_service.get_video(vid)
    if not v:
        return {"id": vid, "action": "missing"}
    if not (v.get("transcript") or "").strip():
        return {"id": vid, "action": "no_transcript"}
    if not is_settled(v, now_s):
        return {"id": vid, "action": "not_settled"}
    cues = education_service.get_transcript_cues(vid)
    if not cues:
        return {"id": vid, "action": "no_cues"}
    raw_sha = ids.sha256_text(v["transcript"])
    stream = stream_for(v.get("category"), v.get("meeting_uuid"))
    external_ref = f"edu_videos:{vid}"
    with store.read() as conn:
        plan = common.plan_version(conn, stream, external_ref, raw_sha)
    if plan["action"] in ("unchanged", "reverted"):
        return {"id": vid, "action": plan["action"], "stream": stream}
    version = plan["version"]
    source_id = common.source_id_for(stream, external_ref, version)
    guests = guests_from(v.get("title"), v.get("description"))
    chapters = (education_service.get_insights(vid) or {}).get("chapters") or []
    resolve = speaker_resolver(guests)
    segments, text = build_segments(cues, chapters, resolve)
    resolution_json = speaker_resolution(cues, resolve)
    duration = duration_seconds(v.get("duration"))
    coverage = coverage_ratio(cues, duration)
    incomplete = 1 if coverage is not None and coverage < COVERAGE_THRESHOLD else 0
    result = {"id": vid, "action": plan["action"], "stream": stream, "version": version,
              "source_id": source_id, "segments": len(segments), "coverage_ratio": coverage,
              "incomplete": incomplete, "guests": len(guests),
              "ambiguous_labels": len(json.loads(resolution_json)["labels"]) if resolution_json else 0}
    if dry_run:
        result["action"] = f"would_{plan['action']}"
        return result
    put = common.put_raw_text(stream, external_ref, version, text, r2_module=r2_module)
    with store.write() as conn:
        again = common.plan_version(conn, stream, external_ref, raw_sha)
        if again["action"] != plan["action"] or again.get("version") != version:
            result["action"] = "raced"
            return result
        common.insert_source(conn, {
            "source_id": source_id, "stream": stream, "external_ref": external_ref, "version": version,
            "supersedes_source_id": plan["supersedes"],
            "home_pointer": f"education.db edu_videos.id={vid}",
            "published_at_et": _et_from_epoch(v.get("created_at")),
            "recording_started_at_et": _et_from_iso(v.get("media_started_at")),
            "title": v.get("title"), "show": v.get("category"),
            "host_author_id": host_author_from_title(v.get("title")),
            "guest_names_json": json.dumps(guests, ensure_ascii=False),
            "raw_r2_key": put["key"], "raw_sha256": raw_sha, "media_pointer": v.get("youtube_id"),
            "coverage_ratio": coverage, "incomplete": incomplete,
            "speaker_resolution_json": resolution_json,
        })
        result["segments_written"] = common.insert_segments(conn, source_id, version, segments,
                                                            NORMALIZER_VERSION)
    return result


def ingest_new(*, limit: int = 500, dry_run: bool = False, r2_module=None,
               log: Callable[[str], None] = None, now_s: Optional[int] = None) -> dict:
    """Walk the edu_videos roster newest-first; ingest what is new or changed."""
    from api.services import education_service

    counts: dict[str, int] = {}
    errors: list[dict] = []
    written = 0
    examined = 0
    for stub in education_service.list_video_creative_stubs():
        if examined >= int(limit):
            break
        examined += 1
        try:
            out = ingest_video(int(stub["id"]), dry_run=dry_run, r2_module=r2_module, now_s=now_s)
        except Exception as exc:  # noqa: BLE001 — one bad video never stops the walk
            errors.append({"id": stub.get("id"), "error": f"{type(exc).__name__}: {str(exc)[:200]}"})
            continue
        counts[out["action"]] = counts.get(out["action"], 0) + 1
        if out["action"] in ("new", "changed"):
            written += 1
            if log:
                log(f"transcript {out['id']} {out['action']} v{out['version']} "
                    f"coverage={out['coverage_ratio']} segments={out['segments']}")
    return {"examined": examined, "written": written, "actions": counts, "errors": errors,
            "dry_run": dry_run}


def transcript_coverage(conn) -> dict:
    """Latest version of every transcript source: counts by stream + the incomplete list."""
    marks = ", ".join("?" for _ in STREAMS)
    rows = [dict(r) for r in conn.execute(
        f"""SELECT s.source_id, s.stream, s.external_ref, s.version, s.title, s.coverage_ratio,
                   s.incomplete, s.media_pointer
            FROM wisdom_sources s
            JOIN (SELECT stream, external_ref, MAX(version) AS v FROM wisdom_sources
                  WHERE stream IN ({marks}) GROUP BY stream, external_ref) latest
              ON latest.stream = s.stream AND latest.external_ref = s.external_ref AND latest.v = s.version
            ORDER BY s.coverage_ratio IS NULL, s.coverage_ratio ASC""",
        STREAMS)]
    by_stream = {s: {"sources": 0, "incomplete": 0, "unmeasurable": 0} for s in STREAMS}
    for r in rows:
        b = by_stream[r["stream"]]
        b["sources"] += 1
        b["incomplete"] += int(r["incomplete"] or 0)
        b["unmeasurable"] += 1 if r["coverage_ratio"] is None else 0
    return {
        "threshold": COVERAGE_THRESHOLD,
        "sources": len(rows),
        "incomplete_total": sum(b["incomplete"] for b in by_stream.values()),
        "unmeasurable_total": sum(b["unmeasurable"] for b in by_stream.values()),
        "by_stream": by_stream,
        "incomplete": [r for r in rows if r["incomplete"]],
    }
