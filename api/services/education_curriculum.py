"""TERM-091 — the curriculum LOADER and the LESSON kind in the shipped education store.

`docs/curriculum/*.json` holds The UCT Method (16 modules, lesson notes, a
five-chapter script per lesson) and its printable member toolkit. This module
loads them as TEXT lessons into `/data/education.db` — the store behind the
paid Desk (Educational Videos / Courses) — in ONE new table, `edu_lessons`.
No new database, no new tab.

WHY A NEW TABLE AND NOT A `kind` ON `edu_paths`
-----------------------------------------------
* `edu_paths.kind` carries `CHECK(kind IN ('course','track'))`. SQLite cannot
  alter a CHECK in place; widening it means rebuilding a live member table.
* `edu_path_steps` rows are VIDEO steps (`youtube_id NOT NULL`) and both of
  their writers — the admin editor's PUT and `paths-apply` — are FULL-REPLACE.
  Loaded rows living there would be wiped by the next owner save.
* A table of its own makes the reversal a single scoped statement
  (`DELETE FROM edu_lessons WHERE source = 'curriculum'`) that cannot reach
  `edu_videos`, `edu_paths` or `edu_path_steps` at all.
The ticket's "lesson kind" is kept as `edu_lessons.kind` ('lesson' | 'artifact').

IDEMPOTENCY
-----------
Every row is keyed by `lesson_key` (UNIQUE), derived from the source JSON:
`uct-method:<slug of the lesson title>` (the course JSON carries no id field;
the 79 titles are unique, asserted at build time) and
`uct-method-toolkit:<key>` for toolkit artifacts (the toolkit JSON's own `key`).
A load UPSERTS by that key, then PRUNES rows of this source whose key the
current JSON no longer produces — so a load run twice gives the same rows,
and an edited title does not leave an orphan.

A lazy one-shot load runs from the list route when the flag is on, behind the
flag file `.edu_lessons_migrate_<LOADER_VERSION>` (the `ensure_default_paths`
idiom).

REVERSAL (TIER-NONE store change)
---------------------------------
`unload()` deletes exactly the rows whose `source` is 'curriculum' and removes
the flag file. It is a delete of FIRM CONTENT this loader created, never member
data; it touches no other table. Order: unset EDU_CURRICULUM_ENABLED first (or
the next list read reloads), then `python scripts/load_edu_curriculum.py --unload`.
Re-enable: set the flag (lazy load) or run the script without `--unload`.

ATTRIBUTION (CLM-15)
--------------------
No curriculum JSON carries an attribution field. It is DERIVED at load time by
`ATTRIBUTION_RULES`: each rule names a third-party framework and the terms that
mark it. A rule's basis is recorded per hit:
  * `named_in_lesson`   — the framework's author is named in the lesson's text;
  * `named_in_source`   — the term is tied to that author BY NAME somewhere in
                           the curriculum sources (the evidence phrase is
                           searched for at load time, not assumed);
  * `signature_term`    — a coinage of that framework the sources use without
                           naming its author (e.g. "follow-through day").
A lesson with no hit carries `attribution = ''` — which means "none detected by
these rules", NEVER "UCT-original". The member payload therefore never claims
originality.

FLAG
----
`EDU_CURRICULUM_ENABLED`, read PER CALL, unset = OFF. Off, the routes answer the
FastAPI 404 body to every caller and this module never opens or creates the
table.
"""
from __future__ import annotations

import contextlib
import json
import logging
import os
import re
import time
import unicodedata
from pathlib import Path
from typing import Optional

from api.services import education_service as es

logger = logging.getLogger(__name__)

FLAG = "EDU_CURRICULUM_ENABLED"
SOURCE = "curriculum"
LOADER_VERSION = "v1"
KINDS = ("lesson", "artifact")

REPO_ROOT = Path(__file__).resolve().parents[2]
CURRICULUM_DIR = REPO_ROOT / "docs" / "curriculum"

COURSE_FILE = "uct_method_course.json"
SCRIPTS_FILE = "uct_method_scripts.json"      # chapters + the spec_verdict census
TOOLKIT_FILE = "uct_method_toolkit.json"
FOUNDATIONS_FILE = "curriculum_final_v2.json"  # attribution evidence (names authors)

VERDICTS = ("verified", "corrected", "replaced", "no_data_needed")


def is_enabled() -> bool:
    """Read PER CALL. Unset means OFF."""
    return os.environ.get(FLAG, "0").strip().lower() in ("1", "true", "yes", "on")


_SCHEMA = """
CREATE TABLE IF NOT EXISTS edu_lessons (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  lesson_key         TEXT    NOT NULL UNIQUE,   -- stable id derived from the source JSON
  source             TEXT    NOT NULL,          -- 'curriculum' — the reversal's scope
  kind               TEXT    NOT NULL CHECK(kind IN ('lesson','artifact')),
  course             TEXT,
  module_label       TEXT,
  module_index       INTEGER,
  sort_order         INTEGER NOT NULL DEFAULT 0,
  title              TEXT    NOT NULL,
  note               TEXT,
  minutes            INTEGER,
  chapters           TEXT,                      -- JSON [{marker, spec_verdict}]
  verdicts           TEXT,                      -- JSON {verified, corrected, replaced, no_data_needed}
  body               TEXT,                      -- JSON (artifacts: tagline, sections, footer_rule)
  attribution        TEXT    NOT NULL DEFAULT '',
  attribution_detail TEXT,                      -- JSON [{framework, basis, terms}]
  source_file        TEXT    NOT NULL,
  view_count         INTEGER NOT NULL DEFAULT 0,
  loaded_at          INTEGER NOT NULL,
  updated_at         INTEGER
);
CREATE INDEX IF NOT EXISTS idx_edu_lessons_source_kind
  ON edu_lessons(source, kind, sort_order);
"""


# ── attribution ───────────────────────────────────────────────────────────────
# (framework label, [(regex, flags, term label, evidence phrase in the sources or None)])
# The evidence phrase, when given, must be found in a curriculum source file at
# load time for the hit to be recorded as `named_in_source`; otherwise the hit
# is recorded as `signature_term`. A rule is never silently dropped.
_I = re.IGNORECASE
ATTRIBUTION_RULES: tuple = (
    ("Qullamaggie (Kristjan Kullamägi)", (
        (r"qullamaggie|kullam[aä]gi", _I, "named", None),
        (r"\bepisodic pivots?\b", _I, "episodic pivot",
         "Qullamaggie's Breakout / EP / Parabolic Trio"),
        (r"\bEPs?\b", 0, "EP", "Qullamaggie's Breakout / EP / Parabolic Trio"),
        (r"\bparabolic\b", _I, "parabolic",
         "Qullamaggie's Breakout / EP / Parabolic Trio"),
    )),
    ("Stan Weinstein (stage analysis)", (
        (r"weinstein", _I, "named", None),
        (r"\bstage[- ]?[1-4]\b|\bstage analysis\b|\bfour stages\b", _I,
         "stage analysis", "Weinstein stage gestalt"),
    )),
    ("William O'Neil (CAN SLIM / IBD)", (
        (r"o['’]neil", _I, "named", None),
        (r"\bcan ?slim\b", _I, "CAN SLIM", "Weinstein × CANSLIM"),
        (r"\bmonster charts?\b|\bhistorical monsters\b", _I, "monster-chart gallery",
         "O'Neil's 100-charts gallery"),
        (r"\bfollow[- ]through days?\b|\bFTDs?\b", 0 | _I, "follow-through day", None),
        (r"\bdistribution days?\b", _I, "distribution day", None),
        (r"\bcup[- ]?(?:with|and|&)[- ]?handle\b|\bcup ?& ?handle\b", _I,
         "cup with handle", None),
    )),
    ("Mark Minervini (SEPA / VCP)", (
        (r"minervini", _I, "named", None),
        (r"\bVCP\b|\bvolatility contraction\b|\btrend template\b", _I, "VCP", None),
    )),
    ("Richard Wyckoff", (
        (r"wyckoff", _I, "named", None),
        (r"\bupthrust\b", _I, "upthrust", None),
    )),
    ("Peter Brandt", (
        (r"\bbrandt\b", _I, "named", None),
    )),
)

ATTRIBUTION_SUFFIX = ("Re-organised public material; the underlying framework "
                      "belongs to its author, not UCT.")


def _evidence_found(phrase: Optional[str], sources_text: str) -> bool:
    return bool(phrase) and phrase.lower() in sources_text.lower()


def derive_attribution(text: str, sources_text: str) -> tuple[str, list[dict]]:
    """Return (attribution sentence, detail list) for one lesson's full text.
    `sources_text` is the concatenated curriculum source JSON, searched for each
    rule's evidence phrase. Empty sentence = no rule fired (NOT "original")."""
    detail: list[dict] = []
    for framework, rules in ATTRIBUTION_RULES:
        terms: list[str] = []
        bases: set[str] = set()
        for pattern, flags, label, evidence in rules:
            if not re.search(pattern, text or "", flags):
                continue
            if label == "named":
                bases.add("named_in_lesson")
                continue
            terms.append(label)
            bases.add("named_in_source" if _evidence_found(evidence, sources_text)
                      else "signature_term")
        if bases:
            basis = ("named_in_lesson" if "named_in_lesson" in bases
                     else "named_in_source" if "named_in_source" in bases
                     else "signature_term")
            detail.append({"framework": framework, "basis": basis, "terms": terms})
    if not detail:
        return "", []
    parts = [d["framework"] + (f" — {', '.join(d['terms'])}" if d["terms"] else "")
             for d in detail]
    return ("Draws on third-party frameworks: " + "; ".join(parts) + ". "
            + ATTRIBUTION_SUFFIX), detail


# ── build (pure: JSON → rows) ────────────────────────────────────────────────

def _slug(s: str) -> str:
    s = unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")


def _load_json(d: Path, name: str):
    with open(d / name, encoding="utf-8") as f:
        return json.load(f)


def _text_of(obj) -> str:
    if isinstance(obj, dict):
        return " ".join(_text_of(v) for v in obj.values())
    if isinstance(obj, list):
        return " ".join(_text_of(v) for v in obj)
    return obj if isinstance(obj, str) else ""


def build_rows(curriculum_dir: Optional[Path] = None) -> list[dict]:
    """Every row the loader would write, derived from the source JSON. Raises
    ValueError if the sources disagree (course vs scripts alignment, duplicate
    keys) — a load must never write a half-understood curriculum."""
    d = Path(curriculum_dir or CURRICULUM_DIR)
    course = _load_json(d, COURSE_FILE)
    scripts = _load_json(d, SCRIPTS_FILE)
    toolkit = _load_json(d, TOOLKIT_FILE)
    sources_text = "\n".join(
        (d / n).read_text(encoding="utf-8")
        for n in (FOUNDATIONS_FILE, COURSE_FILE, SCRIPTS_FILE, TOOLKIT_FILE)
        if (d / n).exists())
    course_name = course.get("name") or "The UCT Method"

    cmods, smods = course.get("modules") or [], scripts.get("modules") or []
    if len(cmods) != len(smods):
        raise ValueError(f"course has {len(cmods)} modules, scripts has {len(smods)}")
    rows: list[dict] = []
    order = 0
    for mi, (cm, sm) in enumerate(zip(cmods, smods)):
        if cm.get("label") != sm.get("label"):
            raise ValueError(f"module {mi} label mismatch: {cm.get('label')!r} vs {sm.get('label')!r}")
        cl, sl = cm.get("lessons") or [], sm.get("lessons") or []
        if len(cl) != len(sl):
            raise ValueError(f"module {mi} lesson count mismatch: {len(cl)} vs {len(sl)}")
        for les, sles in zip(cl, sl):
            if les.get("title") != sles.get("title"):
                raise ValueError(f"lesson title mismatch in module {mi}: {les.get('title')!r}")
            chapters = sles.get("chapters") or []
            verdicts = {v: 0 for v in VERDICTS}
            for ch in chapters:
                v = ch.get("spec_verdict")
                if v:
                    verdicts[v] = verdicts.get(v, 0) + 1
            text = " ".join([les.get("title") or "", les.get("note") or "",
                             _text_of(chapters)])
            attribution, detail = derive_attribution(text, sources_text)
            rows.append({
                "lesson_key": f"uct-method:{_slug(les['title'])}",
                "kind": "lesson",
                "course": course_name,
                "module_label": cm.get("label"),
                "module_index": mi,
                "sort_order": order,
                "title": les["title"],
                "note": les.get("note"),
                "minutes": les.get("minutes"),
                "chapters": [{"marker": ch.get("marker"),
                              "spec_verdict": ch.get("spec_verdict")} for ch in chapters],
                "verdicts": verdicts,
                "body": None,
                "attribution": attribution,
                "attribution_detail": detail,
                "source_file": f"docs/curriculum/{COURSE_FILE}",
            })
            order += 1
    for art in toolkit or []:
        body = {"tagline": art.get("tagline"), "sections": art.get("sections") or [],
                "footer_rule": art.get("footer_rule")}
        attribution, detail = derive_attribution(
            " ".join([art.get("title") or "", _text_of(body)]), sources_text)
        rows.append({
            "lesson_key": f"uct-method-toolkit:{art['key']}",
            "kind": "artifact",
            "course": course_name,
            "module_label": "Toolkit",
            "module_index": None,
            "sort_order": order,
            "title": art.get("title") or art["key"],
            "note": art.get("tagline"),
            "minutes": None,
            "chapters": [],
            "verdicts": None,
            "body": body,
            "attribution": attribution,
            "attribution_detail": detail,
            "source_file": f"docs/curriculum/{TOOLKIT_FILE}",
        })
        order += 1
    keys = [r["lesson_key"] for r in rows]
    dupes = sorted({k for k in keys if keys.count(k) > 1})
    if dupes:
        raise ValueError(f"duplicate lesson keys derived from the source: {dupes}")
    return rows


# ── store ─────────────────────────────────────────────────────────────────────

def _flag_file() -> str:
    return os.path.join(os.path.dirname(es._DB_PATH) or ".",
                        f".edu_lessons_migrate_{LOADER_VERSION}")


def _table_exists(c) -> bool:
    return c.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='edu_lessons'"
                     ).fetchone() is not None


def load(curriculum_dir: Optional[Path] = None) -> dict:
    """Upsert every derived row by `lesson_key`, prune this source's rows the
    JSON no longer produces. One transaction under `_WRITE_LOCK`. Returns and
    LOGS the counts (the loaded count is measured from the table afterwards,
    never typed)."""
    rows = build_rows(curriculum_dir)
    now = int(time.time())
    inserted = updated = 0
    with es._WRITE_LOCK, contextlib.closing(es._connect()) as c:
        c.executescript(_SCHEMA)
        for r in rows:
            args = {
                **r,
                "source": SOURCE,
                "chapters": json.dumps(r["chapters"], ensure_ascii=False),
                "verdicts": None if r["verdicts"] is None else json.dumps(r["verdicts"]),
                "body": None if r["body"] is None else json.dumps(r["body"], ensure_ascii=False),
                "attribution_detail": json.dumps(r["attribution_detail"], ensure_ascii=False),
                "now": now,
            }
            exists = c.execute("SELECT 1 FROM edu_lessons WHERE lesson_key = ?",
                               (r["lesson_key"],)).fetchone() is not None
            c.execute(
                """INSERT INTO edu_lessons
                   (lesson_key, source, kind, course, module_label, module_index, sort_order,
                    title, note, minutes, chapters, verdicts, body, attribution,
                    attribution_detail, source_file, loaded_at, updated_at)
                   VALUES (:lesson_key, :source, :kind, :course, :module_label, :module_index,
                           :sort_order, :title, :note, :minutes, :chapters, :verdicts, :body,
                           :attribution, :attribution_detail, :source_file, :now, :now)
                   ON CONFLICT(lesson_key) DO UPDATE SET
                     source=excluded.source, kind=excluded.kind, course=excluded.course,
                     module_label=excluded.module_label, module_index=excluded.module_index,
                     sort_order=excluded.sort_order, title=excluded.title, note=excluded.note,
                     minutes=excluded.minutes, chapters=excluded.chapters,
                     verdicts=excluded.verdicts, body=excluded.body,
                     attribution=excluded.attribution,
                     attribution_detail=excluded.attribution_detail,
                     source_file=excluded.source_file, updated_at=excluded.updated_at""",
                args,
            )
            if exists:
                updated += 1
            else:
                inserted += 1
        keys = [r["lesson_key"] for r in rows]
        marks = ",".join("?" * len(keys))
        pruned = c.execute(
            f"DELETE FROM edu_lessons WHERE source = ? AND lesson_key NOT IN ({marks})",
            [SOURCE, *keys]).rowcount if keys else 0
        c.commit()
        counts = {k: n for k, n in c.execute(
            "SELECT kind, COUNT(*) FROM edu_lessons WHERE source = ? GROUP BY kind",
            (SOURCE,)).fetchall()}
    result = {
        "loaded": sum(counts.values()),
        "lessons": counts.get("lesson", 0),
        "artifacts": counts.get("artifact", 0),
        "inserted": inserted,
        "updated": updated,
        "pruned": pruned,
        "attributed": sum(1 for r in rows if r["attribution"]),
    }
    logger.info("[edu-curriculum] load %s", result)
    return result


def unload() -> int:
    """THE REVERSAL: delete exactly the rows this loader owns (`source =
    'curriculum'`) and the migrate flag file. Touches no other table. Returns
    the number of rows deleted (0 when the table was never created)."""
    deleted = 0
    with es._WRITE_LOCK, contextlib.closing(es._connect()) as c:
        if _table_exists(c):
            deleted = c.execute("DELETE FROM edu_lessons WHERE source = ?",
                                (SOURCE,)).rowcount
            c.commit()
    with contextlib.suppress(FileNotFoundError):
        os.remove(_flag_file())
    logger.info("[edu-curriculum] unload deleted=%d", deleted)
    return deleted


def ensure_loaded_once() -> None:
    """Lazy one-shot load behind `.edu_lessons_migrate_<v>` (the
    `ensure_default_paths` idiom). Does nothing while the flag is off. Never
    raises — a failed load leaves no flag file, so the next read retries."""
    if not is_enabled():
        return
    flag = _flag_file()
    try:
        if os.path.exists(flag):
            return
        load()
        with open(flag, "w") as f:
            f.write(LOADER_VERSION)
    except Exception:
        logger.exception("[edu-curriculum] lazy load failed")


# ── reads ─────────────────────────────────────────────────────────────────────

#: OWNER RULING 2026-09-29: members see NO third-party credit line on any lesson. The loader
#: still derives and STORES `attribution` / `attribution_detail` (an internal record, so the
#: ruling can be reversed by flipping this constant without re-deriving anything), but no read
#: path returns them. `tests/test_education_curriculum.py` rails both halves.
SHOW_THIRD_PARTY_CREDIT = False
_CREDIT_FIELDS = ("attribution", "attribution_detail")


def _row_out(r) -> dict:
    d = dict(r)
    if not SHOW_THIRD_PARTY_CREDIT:
        for k in _CREDIT_FIELDS:
            d.pop(k, None)
    for k in ("chapters", "attribution_detail"):
        if k not in d:
            continue
        try:
            d[k] = json.loads(d[k]) if d.get(k) else []
        except Exception:
            d[k] = []
    for k in ("verdicts", "body"):
        try:
            d[k] = json.loads(d[k]) if d.get(k) else None
        except Exception:
            d[k] = None
    return d


def list_lessons() -> list[dict]:
    """Every loaded row, lessons then artifacts in source order. [] when the
    table does not exist yet."""
    with contextlib.closing(es._connect()) as c:
        if not _table_exists(c):
            return []
        rows = c.execute(
            "SELECT * FROM edu_lessons WHERE source = ? "
            "ORDER BY CASE kind WHEN 'lesson' THEN 0 ELSE 1 END, sort_order, id",
            (SOURCE,)).fetchall()
        return [_row_out(r) for r in rows]


def census(rows: list[dict]) -> dict:
    """The spec_verdict census over the loaded lessons — computed from the
    rows at request time, never a constant."""
    out = {v: 0 for v in VERDICTS}
    for r in rows:
        for v, n in (r.get("verdicts") or {}).items():
            out[v] = out.get(v, 0) + int(n or 0)
    out["total"] = sum(out[v] for v in out)
    return out


def get_lesson(lesson_key: str, record_view: bool = True) -> Optional[dict]:
    """One loaded row by key; increments its `view_count` when `record_view`."""
    with contextlib.closing(es._connect()) as c:
        if not _table_exists(c):
            return None
        row = c.execute("SELECT * FROM edu_lessons WHERE lesson_key = ? AND source = ?",
                        (lesson_key, SOURCE)).fetchone()
    if row is None:
        return None
    if record_view:
        with es._WRITE_LOCK, contextlib.closing(es._connect()) as c:
            c.execute("UPDATE edu_lessons SET view_count = view_count + 1 WHERE lesson_key = ?",
                      (lesson_key,))
            c.commit()
            row = c.execute("SELECT * FROM edu_lessons WHERE lesson_key = ?",
                            (lesson_key,)).fetchone()
    return _row_out(row)
