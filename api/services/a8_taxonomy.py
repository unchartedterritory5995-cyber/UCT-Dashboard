"""A8 — the ONE authority for the News & Catalyst vocabularies (TERM-075 / FB-A8-01).

Three populations used to live apart, each declaring its own words:

* **catalyst tags** (ledger K8) — `catalyst/tagging.py` returned the four tags as
  inline literals, `catalyst/selection.py` restated them twice, the tile and three
  pages restated them in JS, and S7's `alert_taxonomy/catalyst_match.py` carries a
  fourth copy under a comment claiming agreement nobody wired;
* **themes** (ledger H9) — `themes_taxonomy.json`, located by five hand-built paths;
* **cashtags** (ledger M5) — one grammar copied byte-for-byte into the tweet
  ingest and the catalyst engine's RSS pass.

⛔ THIS MODULE HOLDS NO VOCABULARY. It READS `app/src/lib/taxonomy/a8Taxonomy.json`
— the file the frontend imports too — so Python and JS cannot drift (the
`api/services/ast_lint.py` ↔ `closedTable.json` precedent; the runtime image
copies the whole repository, so the file is present in production).

⛔ ONE VOCABULARY, NEVER ONE SCORE (PROD-C6). Nothing here weights or ranks. A
policy table keyed by a vocabulary stays with its owner and passes through
`keyed_by`, which refuses a key set that is not exactly the vocabulary.

⭐ It also owns the primary-vs-mentioned bit: `resolve_primary()` decides whether
a ticker is a story's SUBJECT or only MENTIONED. `tweet_store` stores the bit
additively (`tweet_tickers.is_primary`, DEFAULT 1 = today's behaviour for every
existing row) and honours it only while `A8_PRIMARY_MENTION_ENABLED` is on.

Rails: `tests/test_a8_taxonomy.py` (Python, by AST) and
`app/src/lib/taxonomy/a8Taxonomy.rail.test.js` (JS, by AST) fail BY NAME on a
restated copy anywhere in product source.
"""
from __future__ import annotations

import json
import os
import re
from pathlib import Path
from types import MappingProxyType, SimpleNamespace
from typing import Iterable, Mapping, Optional

_REPO_ROOT = Path(__file__).resolve().parents[2]
AUTHORITY_PATH = _REPO_ROOT / "app" / "src" / "lib" / "taxonomy" / "a8Taxonomy.json"


def _load(path: Path = AUTHORITY_PATH) -> dict:
    """Read and validate the authority. Raises (at import) on a malformed file —
    a vocabulary that cannot be read must not be replaced by a guessed one."""
    doc = json.loads(Path(path).read_text(encoding="utf-8"))
    tags = doc["catalyst_tags"]
    precedence = list(tags["precedence"])
    display = list(tags["display_order"])
    if len(set(precedence)) != len(precedence) or not precedence:
        raise ValueError("a8Taxonomy.json: catalyst_tags.precedence is empty or repeats a tag")
    if sorted(display) != sorted(precedence):
        raise ValueError("a8Taxonomy.json: catalyst_tags.display_order is not a permutation "
                         "of catalyst_tags.precedence")
    for t in precedence:
        if not t.isidentifier():
            raise ValueError(f"a8Taxonomy.json: catalyst tag {t!r} cannot be a member name")
    hunter = doc["hunter_catalyst_types"]
    if hunter["fallback"] not in hunter["members"]:
        raise ValueError("a8Taxonomy.json: hunter_catalyst_types.fallback is not a member")
    re.compile(doc["cashtag"]["pattern"])
    return doc


_DOC = _load()

# ── catalyst tags (K8) ───────────────────────────────────────────────────────
#: The order `assign_tag()` tests them in — Earnings wins, then Catalyst, ...
CATALYST_TAG_PRECEDENCE: tuple = tuple(_DOC["catalyst_tags"]["precedence"])
#: The order the tile renders its chips in and selection fills its quotas in.
CATALYST_TAG_DISPLAY_ORDER: tuple = tuple(_DOC["catalyst_tags"]["display_order"])
#: Membership — the closed set.
CATALYST_TAGS: frozenset = frozenset(CATALYST_TAG_PRECEDENCE)
#: Named members: `CATALYST_TAG.GAPPER == "Gapper"`. Derived, never typed.
CATALYST_TAG = SimpleNamespace(**{t.upper(): t for t in CATALYST_TAG_PRECEDENCE})

# ── the Catalyst Hunter's closed catalyst_type set ───────────────────────────
#: Declared order — the order the hunter's prompt lists them in.
HUNTER_CATALYST_TYPE_ORDER: tuple = tuple(_DOC["hunter_catalyst_types"]["members"])
HUNTER_CATALYST_TYPES: frozenset = frozenset(HUNTER_CATALYST_TYPE_ORDER)
HUNTER_CATALYST_TYPE_FALLBACK: str = _DOC["hunter_catalyst_types"]["fallback"]

# ── cashtags (M5) ────────────────────────────────────────────────────────────
CASHTAG_PATTERN: str = _DOC["cashtag"]["pattern"]
CASHTAG_RE = re.compile(CASHTAG_PATTERN)
CASHTAG_EXCLUDED: frozenset = frozenset(_DOC["cashtag"]["excluded"])


def cashtags(text: Optional[str]) -> set:
    """M5's extraction: every cashtag in `text` (matched on the UPPER-CASED text),
    minus the excluded forex codes. Empty/None text → empty set."""
    if not text:
        return set()
    return {t for t in CASHTAG_RE.findall(text.upper()) if t not in CASHTAG_EXCLUDED}


# ── themes (H9) ──────────────────────────────────────────────────────────────
THEMES_TAXONOMY_FILENAME: str = _DOC["themes"]["taxonomy_file"]

#: Where the owner's taxonomy file is looked for, in order: the repo root, a
#: sibling `morning-wire` checkout (local dev), and Railway's `/app`. The strings
#: are built exactly as `theme_db` built them, so a resolved path is the same text.
THEMES_TAXONOMY_CANDIDATES: tuple = (
    os.path.join(os.path.dirname(__file__), "..", "..", THEMES_TAXONOMY_FILENAME),
    os.path.join(os.path.dirname(__file__), "..", "..", "..", "morning-wire", THEMES_TAXONOMY_FILENAME),
    "/app/" + THEMES_TAXONOMY_FILENAME,
)


def themes_taxonomy_path() -> Optional[str]:
    """The absolute path of the first candidate that exists, or None."""
    for p in THEMES_TAXONOMY_CANDIDATES:
        resolved = os.path.abspath(p)
        if os.path.exists(resolved):
            return resolved
    return None


# ── the vocabularies the rails police ────────────────────────────────────────
VOCABULARIES: Mapping[str, frozenset] = MappingProxyType({
    "catalyst_tags": CATALYST_TAGS,
    "hunter_catalyst_types": HUNTER_CATALYST_TYPES,
})


def keyed_by(vocabulary: Iterable[str], table: dict) -> dict:
    """Return `table` unchanged after proving its keys are EXACTLY `vocabulary`.

    For a policy table that belongs to its owner (a quota, a bonus, a style) but
    is keyed by an A8 vocabulary. A missing or extra key raises at import, naming
    both — the rail recognises a literal wrapped in this call as checked, and any
    other literal holding the vocabulary as a restated copy. Order is preserved:
    a caller whose iteration order matters keeps it.
    """
    want = frozenset(vocabulary)
    have = frozenset(table)
    if have != want:
        raise ValueError(
            "keyed_by: table keys differ from the A8 vocabulary — "
            f"missing {sorted(want - have)}, extra {sorted(have - want)}"
        )
    return table


# ── primary vs mentioned ─────────────────────────────────────────────────────
PRIMARY_RULE: str = _DOC["primary_vs_mentioned"]["rule"]


def primary_mention_enabled() -> bool:
    """Whether readers honour the primary-vs-mentioned bit. Read PER CALL, never
    cached: unsetting the flag takes effect on the next read. Default OFF, and off
    is byte-identical to the behaviour before the bit existed."""
    return os.environ.get("A8_PRIMARY_MENTION_ENABLED", "0").strip().lower() in ("1", "true", "yes", "on")


def resolve_primary(text: Optional[str], tickers: Iterable[str]) -> dict:
    """{ticker: True if it is the story's SUBJECT, False if only MENTIONED}.

    Rule `lead_cashtag_v1`: one ticker → it is the subject. Several → the ticker
    whose cashtag appears first in the text is the subject; every other ticker is
    a mention. If none of the tickers can be located in the text, every ticker
    stays primary — exactly today's behaviour, never a guess. Total: never raises
    on a string or None.
    """
    order = [t for t in dict.fromkeys(tickers or []) if t]
    if not order:
        return {}
    if len(order) == 1:
        return {order[0]: True}
    wanted = set(order)
    first_at: dict = {}
    for m in CASHTAG_RE.finditer((text or "").upper()):
        sym = m.group(1)
        if sym in wanted and sym not in first_at:
            first_at[sym] = m.start()
    if not first_at:
        return {t: True for t in order}
    lead = min(first_at, key=first_at.__getitem__)
    return {t: t == lead for t in order}
