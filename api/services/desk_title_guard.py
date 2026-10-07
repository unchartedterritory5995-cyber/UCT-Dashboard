"""Title guard for Desk session uploads: fold known typos, accept known show
names, spell-check anything else, and refuse to publish raw text that fails.

WHY THIS EXISTS. `desk_daily_session._route` used to pass an unmatched Zoom
webinar name through VERBATIM as the YouTube title, the Desk shelf and the
thumbnail eyebrow. That is how "LIVE TRAIDNG" reached a public title and a
public thumbnail. A YouTube title is final at insert for the viewer who sees it
first, so the guard sits BEFORE the upload, and its failure direction is a
boring generic title plus an ops alert, never the raw text.

Three layers, cheapest first:
  1. typo fold: `tools.wisdom.category_norm.normalize_category` (the ONE
     authority that already knows `LIVE TRAIDNG`), then a conservative
     close-match against the known-show allowlist;
  2. allowlist: a name equal (casefold) to a known show passes, in the
     allowlist's spelling;
  3. dictionary: every word of an unknown name must be a known word, a number,
     or a ticker-shaped ALL-CAPS token (1-5 chars). Extend without a deploy via
     DESK_TITLE_EXTRA_WORDS / DESK_KNOWN_SHOWS (comma-separated).
"""
from __future__ import annotations

import difflib
import os
import re

# Canonical show names. The routed sections in desk_daily_session._RULES /
# _HOST_AWARE are added at call time by the caller (derived, not restated);
# these are the shelves that exist without a routing rule.
_STATIC_KNOWN_SHOWS = (
    "Sharpen Your Trading Skills",
    "Interviews",
)

# Small, deliberately boring vocabulary: the words Desk show names are made of,
# plus function words and the hosts/guests already seen on the channel. A miss
# costs a generic title and an ops alert, never a bad public title.
_WORDS = frozenset("""
a an and at by for from in of on the to with w vs v ft feat featuring plus or
about after before into over under up down out our your my we you it its this that
some all any more most just inside outside ahead behind
briefing briefings brief briefs bulletin roundup wrap wrapup
live trading trade trades trader traders session sessions daily day days market markets
mkt thoughts thought post pre premarket postmarket afterhours recap recaps sunday monday
tuesday wednesday thursday friday saturday weekend weekly week month monthly quarter
quarterly year yearly scan scans scanning scanner evening morning midday afternoon night
update updates workshop workshops fireside chat chats interview interviews qa ama special
edition part bonus open close opening closing bell options option flow futures earnings
breadth setup setups strategy strategies stock stocks swing momentum technical analysis
risk management mindset psychology mental game sharpen skills skill review reviews preview
watchlist watchlists idea ideas plan plans lesson lessons class classes masterclass webinar
talk talks guest guests panel deep dive dives intro introduction basics basic advanced
beginner beginners hour hours office power chart charts reading tape level levels hot
topic topics current new brand show shows episode replay hangout stream livestream community
member members mentor mentorship desk uncharted territory uct relative strength sector
sectors rotation macro economy fed fomc cpi jobs report reports outlook game plan
trend trends trending leaders leader leadership growth value small large cap caps index
indexes indices etf etfs crypto bitcoin gold oil bonds rates volatility vix q a
edge playbook process journal journaling questions answers tips tricks building build
how what why when where who which best top common mistakes lessons learned live
zen bracco stockbee manrav blake chartmaster buckethead tsdr
""".split())

_TOKEN = re.compile(r"[A-Za-z0-9']+")
_TICKERISH = re.compile(r"^[A-Z0-9]{1,5}$")
_CLOSE_CUTOFF = 0.88


def _csv(raw: str | None) -> list[str]:
    # Callers read os.environ.get("<LITERAL>") themselves, so the flag ledger's
    # AST scan can see each name (a name passed through a helper is invisible).
    return [" ".join(p.split()) for p in (raw or "").split(",") if p.strip()]


def known_shows(extra=()) -> list[str]:
    """Allowlist: caller-derived routed sections + static shelves + env extras."""
    seen: dict[str, str] = {}
    for name in (*extra, *_STATIC_KNOWN_SHOWS, *_csv(os.environ.get("DESK_KNOWN_SHOWS"))):
        name = " ".join(str(name or "").split())
        if name and name.casefold() not in seen:
            seen[name.casefold()] = name
    return list(seen.values())


def _words() -> frozenset:
    extra = {w.casefold() for p in _csv(os.environ.get("DESK_TITLE_EXTRA_WORDS")) for w in p.split()}
    return _WORDS | extra if extra else _WORDS


def _category_fold(name: str) -> str:
    """The typo fold the Wisdom catalog already owns. Fail-soft: if the tools
    package is not importable the dictionary layer still catches the typo."""
    try:
        from tools.wisdom.category_norm import normalize_category
        return normalize_category(name) or name
    except Exception:  # noqa: BLE001
        return name


def fold(name: str, shows=()) -> str | None:
    """A known spelling for `name`, or None when it is not a known show.
    Order: Wisdom's alias fold, exact (casefold) allowlist hit, close match."""
    name = " ".join(str(name or "").split())
    if not name:
        return None
    allow = known_shows(shows)
    by_cf = {s.casefold(): s for s in allow}
    folded = _category_fold(name)
    if folded.casefold() != name.casefold():
        return by_cf.get(folded.casefold(), folded)
    if name.casefold() in by_cf:
        return by_cf[name.casefold()]
    hit = difflib.get_close_matches(name.casefold(), list(by_cf), n=1, cutoff=_CLOSE_CUTOFF)
    return by_cf[hit[0]] if hit else None


def misspelled(text: str, *, proper_nouns_ok: bool = False) -> list[str]:
    """Words of `text` the dictionary does not know. Allowed without lookup:
    numbers, ticker-shaped ALL-CAPS tokens (1-5 chars, digits allowed), and,
    with proper_nouns_ok, Capitalized tokens (a guest's name after "with")."""
    words = _words()
    bad = []
    for tok in _TOKEN.findall(str(text or "")):
        core = tok.strip("'")
        if core.lower().endswith("'s"):
            core = core[:-2]
        if not core or core.isdigit() or _TICKERISH.match(core):
            continue
        if proper_nouns_ok and core[:1].isupper() and not core.isupper():
            continue
        cf = core.casefold()
        if cf in words or (cf.endswith("s") and cf[:-1] in words):
            continue
        bad.append(tok)
    return bad
