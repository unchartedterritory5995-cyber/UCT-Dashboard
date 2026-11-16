"""Setup criteria cards: load and validate docs/study/setups/criteria/NN-slug.json.

The contract is docs/study/setups/CRITERIA_PROGRAMME.md (deliverable 1 and its schema). This module enforces the
MECHANICAL half: the shape, the ids, the sources, the house rules, the voice. Whether a criterion is TRUE of the
setup is the dossier's and then the owner's call; nothing here can make a wrong rule right.

What `validate_card` checks, one line each:

  * the top-level keys the schema names are all present;
  * `setup` is `NN-slug`, the file (when given) is named after it, and the `dossier` path exists;
  * `entry_trigger` is one of the four house triggers or OTHER;
  * the five card fields (context, pattern, trigger, stop, failure_mode) are present and under 60 words each;
  * every criterion has an id `<prefix>.<snake>` (one prefix per card, no duplicates), a field, a statement, a basis
    and a status, each from the lists below;
  * a `measure` (a dict with `what` and `op`) whenever the statement carries a digit;
  * `sources` exist in the dossier's section 11 (`S1`-style ids) and are required unless the basis is `house rule`,
    `UCT` or `my proposal`;
  * a `house_rule` id is required when the basis is `house rule`, and any `house_rule` given must exist in
    docs/study/sizing_rule.md section 9;
  * `glossary` ids exist in docs/study/setups/GLOSSARY.md, checked only when that file exists;
  * `owner_question` is a register id `D-NNN` (checked against docs/study/setups/DECISIONS.md only when that file
    exists) or a placeholder `Q-NN-n` from the dossier's section 10; a `pending-owner` criterion must carry one;
  * `options` entries carry a value and a basis, and `recommended` is one of the option values;
  * `grade_cue` and `gate` are booleans when given;
  * at least two lookalikes, each naming another setup (`NN-slug`, not this card) that has a dossier, with a tell and
    a criterion id from this card;
  * at least three question seeds of at least three different kinds, each on a criterion id from this card;
  * grading has non-empty a_plus, b_minus and no_trade lists; invalidations and mistakes are non-empty; short_mirror
    says whether one exists; management names the trims and the trail;
  * every criterion's `owner_question` is listed in `owner_decisions`;
  * `examples.failures` and `examples.near_misses` each hold at least MIN_EXAMPLES entries, every entry a dict with
    ticker, date (YYYY-MM-DD, or YYYY-MM with a note in brackets for an owner's trade dated by week), criterion (an id
    on this card, or "none" for a loss that broke no rule) and why; `examples.sheets` names the failures and near_misses
    sheets;
  * no em-dash anywhere in the file, and never "the firm" (VOICE.md; OWNER_PRINCIPLES rule 11).

Id regexes (documented here because the other registers are written by other hands):
  * dossier source ids: a table row that starts `| S<n> |` inside the dossier's `## 11.` section;
  * house rule ids: a bullet `- <Letter><n>.` inside sizing_rule.md's `## 9.` section (A1 ... F69);
  * glossary ids: a `### <id>` heading, or an inline `**id:** <id>` marker;
  * decision ids: any `D-` followed by exactly three digits.

Run from the repo root: `python -m scripts.study.criteria_lib` validates every card and prints the errors.
"""
from __future__ import annotations

import json
import pathlib
import re
import sys
from typing import Optional

REPO = pathlib.Path(__file__).resolve().parents[2]
CRITERIA_REL = pathlib.Path("docs") / "study" / "setups" / "criteria"
RESEARCH_REL = pathlib.Path("docs") / "study" / "setups" / "research"
GLOSSARY_REL = pathlib.Path("docs") / "study" / "setups" / "GLOSSARY.md"
DECISIONS_REL = pathlib.Path("docs") / "study" / "setups" / "DECISIONS.md"
SIZING_RULE_REL = pathlib.Path("docs") / "study" / "sizing_rule.md"
CRITERIA_DIR = REPO / CRITERIA_REL

TOP_KEYS = ("setup", "name", "unit", "direction", "timeframe", "dossier", "as_of", "card", "entry_trigger",
            "criteria", "grading", "lookalikes", "invalidations", "mistakes", "short_mirror", "best_conditions",
            "management", "examples", "question_seeds", "owner_decisions", "conflicts")
CARD_FIELDS = ("context", "pattern", "trigger", "stop", "failure_mode")
MAX_CARD_FIELD_WORDS = 60
ENTRY_TRIGGERS = ("BASE BREAKOUT", "PREV DAY HIGH BREAK", "PREV LOW RECLAIM", "RED TO GREEN", "OTHER")
FIELDS = ("context", "pattern", "trigger", "stop", "management", "invalidation")
BASES = ("originator", "source consensus", "UCT", "house rule", "my proposal", "measured")
NO_SOURCE_BASES = ("house rule", "UCT", "my proposal")
STATUSES = ("settled", "proposed", "pending-owner")
SEED_KINDS = ("recall", "spot", "discriminate", "scenario", "grade", "numeric")
MIN_LOOKALIKES = 2
MIN_SEEDS = 3
MIN_SEED_KINDS = 3
MANAGEMENT_KEYS = ("trim_1", "trim_2", "trail", "breakeven")
MIN_EXAMPLES = 4
EXAMPLE_DATE = re.compile(r"^\d{4}-\d{2}(-\d{2}|\s*\(.+\))$")
EM_DASH = "—"
OUR_NAME = re.compile(r"\bthe firm('s)?\b", re.I)

SETUP_ID = re.compile(r"^\d{2}-[a-z0-9]+(-[a-z0-9]+)*$")
CRITERION_ID = re.compile(r"^([a-z][a-z0-9]*)\.([a-z][a-z0-9_]*)$")
DECISION_ID = re.compile(r"^D-\d{3}$")
PLACEHOLDER_QUESTION = re.compile(r"^Q-\d{2}-\d+$")
SOURCE_ROW = re.compile(r"^\|\s*(S\d+)\s*\|", re.M)
HOUSE_RULE_BULLET = re.compile(r"^- ([A-G]\d{1,2})\.", re.M)
GLOSSARY_HEADING = re.compile(r"^###\s+`?([A-Za-z0-9_.-]+)`?\s*$", re.M)
GLOSSARY_MARKER = re.compile(r"\*\*id:\*\*\s*`?([A-Za-z0-9_.-]+)`?")
DECISION_MENTION = re.compile(r"\bD-\d{3}\b")
HAS_DIGIT = re.compile(r"\d")


# ── files ─────────────────────────────────────────────────────────────────────────────────────────────────────────

def card_files(root: pathlib.Path = CRITERIA_DIR) -> list[pathlib.Path]:
    """Every criteria card on disk, sorted."""
    return sorted(root.glob("*.json")) if root.is_dir() else []


def load_card(path: pathlib.Path) -> dict:
    return json.loads(pathlib.Path(path).read_text(encoding="utf-8"))


def _section(text: str, number: int) -> str:
    """The body of `## <number>. ...` up to the next `## ` heading (empty when the heading is missing)."""
    m = re.search(rf"^## {number}\. [^\n]*\n", text, re.M)
    if not m:
        return ""
    rest = text[m.end():]
    nxt = re.search(r"^## ", rest, re.M)
    return rest[: nxt.start()] if nxt else rest


SOURCE_NUM_ROW = re.compile(r"^\|\s*(\d+)\s*\|", re.M)
SOURCE_NUM_ITEM = re.compile(r"^\s*(\d+)\.\s", re.M)
SOURCE_MARK = re.compile(r"(?:\*\*|\[|^|\s)(S\d+)(?:\*\*|\]|[.:)])", re.M)


def dossier_source_ids(dossier_path: pathlib.Path) -> Optional[set[str]]:
    """`S<n>` ids from the dossier's section 11, or None when the dossier is missing.

    The 44 dossiers number their sources four ways, so the reader accepts all of them, in this order:
      1. explicit ids: `| S1 |` rows or `**S1**` / `[S1]` / `S1.` / `S1:` markers;
      2. numbered rows `| 1 |` (read as S1);
      3. numbered list items `1. ` at the start of a line (read as S1);
      4. when the section numbers nothing, the position: S<n> is the n-th source in reading order, counting
         every table body row (a `|` line that is not a header or a `|---|` rule) and every top-level bullet.
    A card cites a source by the id this reader gives it.
    """
    if not dossier_path.is_file():
        return None
    body = _section(dossier_path.read_text(encoding="utf-8"), 11)
    ids = set(SOURCE_ROW.findall(body)) | set(SOURCE_MARK.findall(body))
    ids |= {f"S{n}" for n in SOURCE_NUM_ROW.findall(body)}
    ids |= {f"S{n}" for n in SOURCE_NUM_ITEM.findall(body)}
    if ids:
        return ids
    count = 0
    prev_blank = True
    for line in body.splitlines():
        stripped = line.strip()
        if stripped.startswith("|"):
            is_rule = re.fullmatch(r"\|[\s:|-]*\|", stripped) is not None
            is_header = prev_blank or (count == 0 and not is_rule and "---" not in stripped and False)
            # a table's first row after a blank line or a heading is its header; the `|---|` line is a rule
            if not is_rule and not is_header:
                count += 1
            prev_blank = False
            continue
        if re.match(r"^[-*]\s+\S", line):
            count += 1
        prev_blank = stripped == "" or stripped.startswith("#") or stripped.startswith("**")
    return {f"S{n}" for n in range(1, count + 1)}


def house_rule_ids(repo_root: pathlib.Path = REPO) -> set[str]:
    """Rule ids (A1 ... F69) from sizing_rule.md section 9, the account rulebook."""
    path = repo_root / SIZING_RULE_REL
    if not path.is_file():
        return set()
    return set(HOUSE_RULE_BULLET.findall(_section(path.read_text(encoding="utf-8"), 9)))


def glossary_ids(path: pathlib.Path) -> Optional[set[str]]:
    """Glossary ids, or None when GLOSSARY.md does not exist (the check is then skipped)."""
    if not path.is_file():
        return None
    text = path.read_text(encoding="utf-8")
    return set(GLOSSARY_HEADING.findall(text)) | set(GLOSSARY_MARKER.findall(text))


def decision_ids(path: pathlib.Path) -> Optional[set[str]]:
    """Decision ids `D-NNN`, or None when DECISIONS.md does not exist (the check is then skipped)."""
    if not path.is_file():
        return None
    return set(DECISION_MENTION.findall(path.read_text(encoding="utf-8")))


def _words(text: str) -> int:
    return len(re.findall(r"\S+", text or ""))


# ── validation ────────────────────────────────────────────────────────────────────────────────────────────────────

def validate_card(card: dict, repo_root: pathlib.Path = REPO, *, path: Optional[pathlib.Path] = None) -> list[str]:
    """Every mechanical problem in one card (empty = clean). See the module docstring for the rules."""
    out: list[str] = []
    if not isinstance(card, dict):
        return ["card is not a JSON object"]
    for k in TOP_KEYS:
        if k not in card:
            out.append(f"missing {k}")
    if out:
        return out

    setup = str(card.get("setup") or "")
    if not SETUP_ID.fullmatch(setup):
        out.append(f"setup {setup!r} must look like 01-flat-base")
    if path is not None and pathlib.Path(path).stem != setup:
        out.append(f"file must be named {setup}.json")
    dossier_path = repo_root / str(card.get("dossier") or "")
    source_ids = dossier_source_ids(dossier_path)
    if source_ids is None:
        out.append(f"dossier not found: {card.get('dossier')}")
        source_ids = set()
    if card.get("entry_trigger") not in ENTRY_TRIGGERS:
        out.append(f"entry_trigger must be one of {ENTRY_TRIGGERS}")
    if card.get("direction") not in ("long", "short"):
        out.append("direction must be long or short")
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", str(card.get("as_of") or "")):
        out.append("as_of must be YYYY-MM-DD")

    # the five-field card
    five = card.get("card") or {}
    for f in CARD_FIELDS:
        text = five.get(f) if isinstance(five, dict) else None
        if not isinstance(text, str) or not text.strip():
            out.append(f"card.{f} missing")
        elif _words(text) > MAX_CARD_FIELD_WORDS:
            out.append(f"card.{f} is {_words(text)} words (max {MAX_CARD_FIELD_WORDS})")

    # criteria
    rules = house_rule_ids(repo_root)
    gloss = glossary_ids(repo_root / GLOSSARY_REL)
    decisions = decision_ids(repo_root / DECISIONS_REL)
    ids: set[str] = set()
    prefixes: set[str] = set()
    asked: set[str] = set()
    criteria = card.get("criteria")
    if not isinstance(criteria, list) or not criteria:
        out.append("criteria must be a non-empty list")
        criteria = []
    for c in criteria:
        cid = str(c.get("id") or "")
        label = cid or "<no id>"
        m = CRITERION_ID.fullmatch(cid)
        if not m:
            out.append(f"{label}: id must be <prefix>.<snake>")
        else:
            prefixes.add(m.group(1))
        if cid in ids:
            out.append(f"{label}: duplicate id")
        ids.add(cid)
        if c.get("field") not in FIELDS:
            out.append(f"{label}: field must be one of {FIELDS}")
        statement = c.get("statement")
        if not isinstance(statement, str) or not statement.strip():
            out.append(f"{label}: statement missing")
            statement = ""
        basis = c.get("basis")
        if basis not in BASES:
            out.append(f"{label}: basis must be one of {BASES}")
        status = c.get("status")
        if status not in STATUSES:
            out.append(f"{label}: status must be one of {STATUSES}")
        measure = c.get("measure")
        if HAS_DIGIT.search(statement):
            if not isinstance(measure, dict) or not measure.get("what") or not measure.get("op"):
                out.append(f"{label}: statement carries a number but has no measure (what, op)")
        elif measure is not None and (not isinstance(measure, dict) or not measure.get("what")):
            out.append(f"{label}: measure must be a dict with what and op")
        srcs = c.get("sources") or []
        if not isinstance(srcs, list):
            out.append(f"{label}: sources must be a list")
            srcs = []
        if not srcs and basis not in NO_SOURCE_BASES:
            out.append(f"{label}: basis {basis!r} needs at least one source")
        for s in srcs:
            if s not in source_ids:
                out.append(f"{label}: source {s!r} is not in the dossier's section 11")
        hr = c.get("house_rule")
        if basis == "house rule" and not hr:
            out.append(f"{label}: basis is house rule but no house_rule id")
        if hr and hr not in rules:
            out.append(f"{label}: house_rule {hr!r} is not in sizing_rule.md section 9")
        g = c.get("glossary")
        if g and gloss is not None and g not in gloss:
            out.append(f"{label}: glossary id {g!r} is not in GLOSSARY.md")
        oq = c.get("owner_question")
        if status == "pending-owner" and not oq:
            out.append(f"{label}: pending-owner needs an owner_question")
        if oq:
            asked.add(oq)
            if DECISION_ID.fullmatch(oq):
                if decisions is not None and oq not in decisions:
                    out.append(f"{label}: owner_question {oq!r} is not in DECISIONS.md")
            elif not PLACEHOLDER_QUESTION.fullmatch(oq):
                out.append(f"{label}: owner_question {oq!r} must be D-NNN or a Q-NN-n placeholder")
        opts = c.get("options")
        if opts is not None:
            if not isinstance(opts, list):
                out.append(f"{label}: options must be a list")
                opts = []
            values = []
            for o in opts:
                if not isinstance(o, dict) or "value" not in o or not o.get("basis"):
                    out.append(f"{label}: every option needs a value and a basis")
                else:
                    values.append(o["value"])
            if opts and "recommended" in c and c["recommended"] not in values:
                out.append(f"{label}: recommended {c['recommended']!r} is not one of the options")
        for flag in ("gate", "grade_cue"):
            if flag in c and not isinstance(c[flag], bool):
                out.append(f"{label}: {flag} must be true or false")
    if len(prefixes) > 1:
        out.append(f"criteria use more than one id prefix: {sorted(prefixes)}")

    # grading
    grading = card.get("grading") or {}
    for k in ("a_plus", "b_minus", "no_trade"):
        if not isinstance(grading.get(k), list) or not grading.get(k):
            out.append(f"grading.{k} must be a non-empty list")

    # lookalikes
    looks = card.get("lookalikes")
    if not isinstance(looks, list) or len(looks) < MIN_LOOKALIKES:
        out.append(f"need at least {MIN_LOOKALIKES} lookalikes")
        looks = looks if isinstance(looks, list) else []
    research = repo_root / RESEARCH_REL
    for la in looks:
        other = str(la.get("setup") or "")
        if not SETUP_ID.fullmatch(other) or other == setup:
            out.append(f"lookalike {other!r} must name another setup (NN-slug)")
        elif research.is_dir() and not (research / f"{other}.md").is_file():
            out.append(f"lookalike {other!r} has no dossier in research/")
        if not str(la.get("tell") or "").strip():
            out.append(f"lookalike {other!r}: tell missing")
        if la.get("criterion") not in ids:
            out.append(f"lookalike {other!r}: criterion {la.get('criterion')!r} is not in this card")

    # question seeds
    seeds = card.get("question_seeds")
    if not isinstance(seeds, list) or len(seeds) < MIN_SEEDS:
        out.append(f"need at least {MIN_SEEDS} question seeds")
        seeds = seeds if isinstance(seeds, list) else []
    kinds = set()
    for i, s in enumerate(seeds):
        if s.get("kind") not in SEED_KINDS:
            out.append(f"seed {i}: kind must be one of {SEED_KINDS}")
        kinds.add(s.get("kind"))
        if s.get("criterion") not in ids:
            out.append(f"seed {i}: criterion {s.get('criterion')!r} is not in this card")
        if not str(s.get("seed") or "").strip():
            out.append(f"seed {i}: seed text missing")
    if len(kinds & set(SEED_KINDS)) < MIN_SEED_KINDS:
        out.append(f"question seeds cover {len(kinds & set(SEED_KINDS))} kinds (need {MIN_SEED_KINDS})")

    # the rest of the shape
    for k in ("invalidations", "mistakes"):
        if not isinstance(card.get(k), list) or not card.get(k):
            out.append(f"{k} must be a non-empty list")
    sm = card.get("short_mirror") or {}
    if not isinstance(sm.get("exists"), bool):
        out.append("short_mirror.exists must be true or false")
    mgmt = card.get("management") or {}
    for k in MANAGEMENT_KEYS:
        if not str(mgmt.get(k) or "").strip():
            out.append(f"management.{k} missing")
    od = card.get("owner_decisions")
    if not isinstance(od, list):
        out.append("owner_decisions must be a list")
        od = []
    for oq in sorted(asked):
        if oq not in od:
            out.append(f"owner_question {oq} is not listed in owner_decisions")

    # the recognition examples: losses traded by the rules and near-misses that fail exactly one rule
    ex = card.get("examples")
    if not isinstance(ex, dict):
        out.append("examples must be an object")
    else:
        for key in ("failures", "near_misses"):
            rows = ex.get(key)
            if not isinstance(rows, list) or len(rows) < MIN_EXAMPLES:
                out.append(f"examples.{key} needs at least {MIN_EXAMPLES} entries")
                rows = rows if isinstance(rows, list) else []
            for i, e in enumerate(rows):
                if not isinstance(e, dict):
                    out.append(f"examples.{key}[{i}] must be an object")
                    continue
                for need in ("ticker", "date", "criterion", "why"):
                    if not e.get(need):
                        out.append(f"examples.{key}[{i}] ({e.get('ticker', '?')}): missing {need}")
                if e.get("date") and not EXAMPLE_DATE.match(str(e["date"])):
                    out.append(f"examples.{key}[{i}] ({e.get('ticker', '?')}): date must be YYYY-MM-DD")
                crit_id = e.get("criterion")
                if crit_id and crit_id != "none" and crit_id not in ids:
                    out.append(f"examples.{key}[{i}] ({e.get('ticker', '?')}): criterion '{crit_id}' is not on this card")
        sheets = ex.get("sheets")
        if not isinstance(sheets, dict) or not sheets.get("failures") or not sheets.get("near_misses"):
            out.append("examples.sheets must name the failures and near_misses sheets")

    # voice, over the whole file
    blob = json.dumps(card, ensure_ascii=False)
    if EM_DASH in blob:
        out.append("em-dash found (VOICE.md: a comma, a period, or keep talking)")
    if OUR_NAME.search(blob):
        out.append("never 'the firm' (OWNER_PRINCIPLES rule 11)")
    return out


def validate_file(path: pathlib.Path, repo_root: pathlib.Path = REPO) -> list[str]:
    """Load and validate one card file; a parse failure is one error."""
    path = pathlib.Path(path)
    try:
        card = load_card(path)
    except (OSError, ValueError) as e:
        return [f"cannot read {path.name}: {e}"]
    return validate_card(card, repo_root, path=path)


def main(argv: Optional[list[str]] = None) -> int:
    files = [pathlib.Path(a) for a in (argv or [])] or card_files()
    if not files:
        print(f"no cards under {CRITERIA_DIR}")
        return 1
    bad = 0
    for p in files:
        probs = validate_file(p)
        if probs:
            bad += 1
            print(f"{p.name}: {len(probs)} problem(s)")
            for m in probs:
                print(f"  - {m}")
        else:
            print(f"{p.name}: ok")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
