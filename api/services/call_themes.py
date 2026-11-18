"""Rising phrases across earnings calls ("what CEOs are saying").

For a calendar month of indexed earnings calls, the one-, two- and three-word phrases whose share
of CALLS rose the most against the months before it, in two lists:

  * new      near absent before (at most NEW_MAX_BASE_PCT percent of the earlier calls), ranked by
             the share of this month's calls that say it;
  * rising   said before and clearly more now (up by RISE_MIN_POINTS points AND RISE_MIN_RATIO
             times, the same test the TSRC panel uses to call one phrase "rising"; a single word
             must be RISE_MIN_RATIO_ONE_WORD times), ranked by the rise in percentage points.

WHAT IS COUNTED. Calls, never repeats: a phrase said forty times on one call counts once. A phrase
needs a floor of calls in the month (MIN_CALLS, and MIN_SHARE_PCT percent of the month's calls) and
of distinct companies (MIN_COMPANIES), so one company's own phrase cannot reach a list.

WHAT IS LEFT OUT (see `_classify`, `_blank` and `doc_keys`): the operator's turns (the queue, and
usually the safe-harbour statement), any sentence of safe-harbour or call-mechanics wording, each
call's own speaker names, numbers, dates, calendar words and seasonal expressions, greetings, and
phrases that begin or end on a filler word. Everything else that is said on every call (revenue,
margin) cannot pass the "times" test, so it never ranks.

LIKE FOR LIKE (see `base_weights`). Which industries report changes through an earnings season, so
the earlier calls are weighted to the month's own mix of industries (the stored industry map, read
only) before the two shares are compared. Without that, the lists fill with the vocabulary of
whichever industries report late. A gap must also be MIN_Z times what chance alone would produce.

WHAT IS SENT. Words with counts and up to three example tickers. No transcript text beyond the
phrase itself (three words at most), which is far less than the excerpt the call search already
shows a member.

COST AND HAND-OFF (the house pattern, api/services/scan_period.py). The scan reads every held call
two or three times, so it NEVER runs on a request:

  * `refresh_if_due()` is called at the end of the transcript index's own sweep (api/main.py
    `register_transcript_index_jobs`, web service only) and builds at most once per New York day;
  * the answer is held in this module AND written to `<DATA_DIR>/call_themes.json`, so a deploy
    reads the file instead of recomputing;
  * `get_themes()` answers at once: the held answer with its build time, or `computing` on a pod
    that holds nothing (it starts the one build), never a build on the caller's thread.

MEMORY. Calls are streamed one at a time. Pass 1 counts every phrase of the target months into a
fixed table of one-byte counters (hashed, so the table never grows); pass 2 keeps exact counts only
for phrases whose counter reached the floor; pass 3 reads the target months again for the ranked
phrases alone (which calls say each, so near-duplicates fold into one row; their most common
spelling; the companies whose call says it most).
"""
from __future__ import annotations

import json
import logging
import math
import os
import re
import threading
import time
from collections import Counter
from datetime import datetime, timezone
from typing import Any, Callable, Iterable, Optional
from zoneinfo import ZoneInfo

_log = logging.getLogger(__name__)
_ET = ZoneInfo("America/New_York")

#: Bump when the counting or the rules change: a stored answer from another version is not served.
METHOD_VERSION = 1

# ── The rules (each is sent with the answer, so the panel states them from the server) ──────────
MIN_MONTH_CALLS = 100      # a month needs this many indexed calls before it gets a list
MIN_BASE_CALLS = 100       # and the months it is compared with need this many between them
BASE_MONTHS = 3            # the calendar months before it that it is compared with
MAX_TARGET_MONTHS = 2      # lists are kept for the newest month that qualifies and the one before
MIN_CALLS = 8              # a phrase needs this many calls in the month ...
MIN_SHARE_PCT = 2.0        # ... and this share of the month's calls, whichever is more
MIN_COMPANIES = 6          # ... from this many different companies
NEW_MAX_BASE_PCT = 0.5     # "new": at most this share of the earlier calls said it
RISE_MIN_POINTS = 2.0      # "rising": up by this many percentage points ...
RISE_MIN_RATIO = 1.25      # ... and by this many times (callSearchModel.js TREND_MIN_POINTS / TREND_UP_RATIO)
RISE_MIN_RATIO_ONE_WORD = 2.0   # a single word must double: everyday words drift more than phrases do
MIN_Z = 3.0                # either list: the gap must be this many times what chance alone would produce
LIST_CAP = 30              # rows kept per list
MAX_WORDS = 3
EXAMPLES = 3               # example tickers per phrase: the companies whose call said it most
RELATED = 3                # phrases named on a row instead of listed under it
POOL_CAP = 4 * LIST_CAP    # rows ranked per list before near-duplicates are folded together
FOLD_OVERLAP = 0.7         # two phrases are one idea when this share of their calls is shared ...
FOLD_INSIDE = 0.85         # ... or when this share of one's calls also say the other, listed above it,
FOLD_LIFT = 1.5            # and that is this many times the listed one's own share of calls
ABSORB_CALLS = 0.8         # a shorter phrase gives way to a longer one holding this share of its calls ...
ABSORB_RISE = 0.75         # ... or this share of its rise

#: A stored answer older than this is still served, and one background rebuild is started (the daily
#: job should have replaced it; this covers a server where the index sweep is switched off).
STALE_REBUILD_S = 36 * 3600
#: After a failed build, how long a cold request answers `error` before another build may start.
ERROR_HOLD_S = 60.0
#: Pause between calls, so the scan never holds the interpreter against live requests.
PACE_S = 0.01
_MAX_DOC_CHARS = 600_000
_BUCKETS = 1 << 23         # one-byte counters per target month (8 MB each, two months at most)
_MASK = _BUCKETS - 1

RULES = {
    "min_month_calls": MIN_MONTH_CALLS, "min_base_calls": MIN_BASE_CALLS, "base_months": BASE_MONTHS,
    "min_calls": MIN_CALLS, "min_share_pct": MIN_SHARE_PCT, "min_companies": MIN_COMPANIES,
    "new_max_base_pct": NEW_MAX_BASE_PCT, "rise_min_points": RISE_MIN_POINTS,
    "rise_min_ratio": RISE_MIN_RATIO, "rise_min_ratio_one_word": RISE_MIN_RATIO_ONE_WORD, "min_z": MIN_Z,
    "list_cap": LIST_CAP, "max_words": MAX_WORDS,
}

# ── Words ────────────────────────────────────────────────────────────────────────────────────────
# Three classes. A STOP word never begins or ends a phrase and is never a phrase by itself; only the
# few joining words in _JOIN may sit in the middle of one ("cost of capital", "book to bill"). A BREAK
# word ends the run of words: no phrase holds it or spans it (numbers, dates, calendar words,
# greetings, the mechanics of the call). A stop PAIR is stock safe-harbour or call wording: no phrase
# holds the pair.

_STOP = frozenset("""
a about above across after again against all almost along already also although always am among an and
another any anybody anyone anything are aren around as at back be became because become been before
being below between both but by can cannot could couldn did didn do does doesn doing don done down
during each either else enough even ever every everybody everyone everything few for from further get
gets getting go goes going gone got had hadn has hasn have haven having he her here hers herself him
himself his how however i if in into is isn it its itself just least less let like ll many may maybe
me might mine more most much must my myself neither never no nobody none nor not nothing now of off
often on once one only onto or other others our ours ourselves out over own per perhaps quite rather
re really s same shall she should shouldn since so some somebody someone something sometimes still
such t than that the their theirs them themselves then there these they this those though through
throughout thus to too toward towards under until up upon us ve very was wasn we were weren what
whatever when where whether which while who whom whose why will with within without won would
wouldn yet you your yours yourself yourselves
actually basically certainly clearly definitely obviously generally essentially frankly honestly
particularly probably especially simply mostly largely fairly pretty truly indeed overall
able ask asked asking believe believes bit comes come coming came couple different continue
continues continued continuing expect expects expected feel feels felt give gives given gave good
great guess happy help helps helping hope keep keeps kind know knows known look looks looked looking
lot lots made make makes making mean means mentioned mention nice okay ok part plan planned put
remain remains said say says saying see seeing seen seem seems sort sure take takes taking taken
talk talked talking tell think thinking thought took try trying understand want wanted wants way
ways well went yeah yes thing things point points number numbers level levels terms piece pieces
side sides course example instance fact case cases sense question regard regards respect behalf
guys guy folks everybody team teams color commentary comment comments update updates detail details
bit little big bigger biggest large larger largest small smaller smallest high higher highest low
lower lowest strong stronger strongest weak weaker better best worse worst new old early late long
short similar total full whole entire several various multiple additional further time right
change changes changed changing become becomes becoming became begin began beginning include includes
including included use using need needs needed
""".split())

_BREAK = frozenset("""
quarter quarterly year yearly annual annually fiscal month monthly week weekly day daily today
yesterday tomorrow tonight morning afternoon evening night january february march april june july
august september october november december jan feb apr jun jul aug sep sept oct nov dec monday
tuesday wednesday thursday friday saturday sunday first second third fourth half ytd yoy qoq
sequential sequentially seasonal seasonally seasonality season holiday christmas thanksgiving easter
halloween summer winter autumn calendar ago prior previous last next upcoming recent recently
earlier later million billion trillion thousand hundred percent percentage bps basis
two three four five six seven eight nine ten eleven twelve dozen double triple
thank thanks welcome hello hi hey congrats congratulation appreciate appreciated please sorry
operator moderator call webcast replay slide presentation remark prepared transcript conference
participant listener dial queue mute unmute gaap nongaap reconciliation
""".split())

_STOP_PAIRS = frozenset((
    "forward looking", "looking statement", "safe harbor", "safe harbour", "differ materially", "actual result",
    "press release", "earnings release", "news release", "investor relation", "earnings call", "risk factor",
    "sec filing", "annual report", "private security", "security litigation", "litigation reform", "reform act",
    "cautionary statement", "undue reliance", "security law", "exchange commission", "historical fact",
    "future event", "future performance", "financial measure", "comparable measure", "supplemental material",
    "follow up", "go ahead", "open line", "closing comment", "opening comment", "management team",
    "chief executive", "executive officer", "chief financial", "financial officer", "vice president",
))

_JOIN = frozenset(("of", "to", "in", "for", "on", "per"))

#: Words that end in "s" and are not a plural, so they keep it ("news" is not "new").
_NO_FOLD = frozenset("""
news sales earnings series species analytics logistics economics electronics robotics diagnostics
therapeutics genetics politics physics mathematics dynamics metrics optics semantics genomics
overseas gas plus lens texas vegas dallas reuters canvas atlas bias alias las los mrs yes has was
does goes its as is us this thus always perhaps towards besides whereas sometimes headquarters
means lbs
""".split())

#: Not a word for this purpose: a number (with a unit or an ordinal ending), or a quarter / fiscal label.
_NUMBERISH = re.compile(r"^(?:\d+(?:st|nd|rd|th|k|m|b|bn|mm|x|s|bps|q|h)?|q[1-4]|[1-4]q\d*|fy\d*|cy\d*|h[12]|[12]h\d*)$")
# A word, or one character that ends a run of words. Apostrophes and hyphens are neither: "long-term"
# reads as two words in a row, the way the call search's own index reads it.
_TOKEN = re.compile(r"[a-z0-9]+|[^a-z0-9\s'’\-]")
_YM = re.compile(r"^\d{4}-(?:0[1-9]|1[0-2])$")
#: Fixed expressions that come round with the calendar: no phrase holds one or spans one.
_SEASONAL = re.compile(
    r"\b(?:black friday|cyber monday|cyber week|prime day|back to school|(?:lunar |chinese )?new year(?:'s)?|labor day"
    r"|memorial day|independence day|fourth of july|super bowl|golden week|singles'? day|valentine'?s day"
    r"|mother'?s day|father'?s day|presidents'? day|spring break|tax season|hurricane season|flu season|open enrollment)\b")

#: A sentence holding one of these is safe-harbour or call-mechanics wording: the whole sentence is not counted.
_BOILER = re.compile(
    r"forward[- ]looking|differ materially|safe harbou?r|risk factors|sec filings|filings with the sec|undue reliance"
    r"|securities litigation|cautionary statement|press release|earnings release|news release|investor relations"
    r"|listen[- ]only|question[- ]and[- ]answer session|this concludes|now disconnect|turn the call|hand the call"
    r"|open the line|opening remarks|closing remarks")
_SENTENCE_END = ".?!\n"


def _blank(low: str) -> str:
    """Lower-cased text with every seasonal expression and every boilerplate sentence replaced by full
    stops, one for one, so the text keeps its length (a later slice of the original still lines up)."""
    low = _SEASONAL.sub(lambda m: "." * len(m.group()), low)
    if _BOILER.search(low) is None:
        return low
    out, pos = [], 0
    for m in _BOILER.finditer(low):
        if m.start() < pos:
            continue                                         # inside a sentence already blanked
        a = max(pos, 1 + max(low.rfind(ch, pos, m.start()) for ch in _SENTENCE_END))
        ends = [i for i in (low.find(ch, m.end()) for ch in _SENTENCE_END) if i >= 0]
        b = min(ends) if ends else len(low)
        out.append(low[pos:a])
        out.append("." * (b - a))
        pos = b
    out.append(low[pos:])
    return "".join(out)


# A speaker turn begins at the start of a line, "Name Name: text" (the same line-anchored shape as
# fmp_transcripts._SPEAKER_LINE_RE: letters only in a name, so "Q3: revenue" is never a speaker).
_SPEAKER_LINE = re.compile(
    r"(?:\A|\n)[ \t]*([A-Z][A-Za-z.\-'’]*(?:[ ,]+[A-Z&][A-Za-z.\-'’&]*){0,5})[ \t]*:[ \t]+")
#: Turns by these speakers are not counted: the queue, and usually the safe-harbour statement.
_SKIP_SPEAKERS = frozenset(("operator", "moderator", "conference operator", "coordinator"))
#: Words of a speaker label that is not a person ("Unidentified Company Representative"): never taken as a name.
_LABEL_WORDS = frozenset(("unidentified", "unknown", "analyst", "speaker", "company", "representative", "participant",
                          "executive", "corporate", "management", "attendee", "investor", "shareholder", "and"))
_MIN_TURNS = 3


def _fold(tok: str) -> str:
    """A plain plural as its singular, so "tariffs" and "tariff" are one phrase. Deliberately light:
    a wrong fold only fails to merge two spellings (the listed spelling is the most common one)."""
    if len(tok) <= 3 or tok in _NO_FOLD or not tok.endswith("s"):
        return tok
    if tok.endswith("ies") and len(tok) > 4:
        return tok[:-3] + "y"
    if tok.endswith(("ss", "us", "is")):
        return tok
    return tok[:-1]


def _classify(tok: str):
    """A token as `(folded word, is_stop)`, or None when it ends the run of words (a BREAK word, a
    number, a quarter label)."""
    if _NUMBERISH.match(tok):
        return None
    word = _fold(tok)
    if tok in _BREAK or word in _BREAK:
        return None
    return (word, len(word) < 2 or tok in _STOP or word in _STOP)


def split_turns(text: str) -> tuple[list[str], set[str]]:
    """A call's text as the turns to count, and the words of its speakers' names.

    The operator's turns are left out. With fewer than three speaker labels the text is taken whole
    (a provider row with no line breaks), and no name is known."""
    marks = list(_SPEAKER_LINE.finditer(text))
    if len(marks) < _MIN_TURNS:
        return [text], set()
    turns: list[str] = []
    names: set[str] = set()
    if marks[0].start() > 0:
        turns.append(text[:marks[0].start()])
    for i, m in enumerate(marks):
        speaker = " ".join(m.group(1).split()).strip(" .,").lower()
        end = marks[i + 1].start() if i + 1 < len(marks) else len(text)
        if speaker in _SKIP_SPEAKERS:
            continue
        for w in re.findall(r"[a-z]+", speaker):
            if len(w) >= 2 and w not in _LABEL_WORDS:
                names.add(w)
        turns.append(text[m.end():end])
    return turns, names


def doc_keys(text: str, memo: Optional[dict] = None, want: Optional[frozenset] = None) -> list:
    """Every phrase of one call, with repeats.

    A phrase is one to three words in a row inside one clause (punctuation ends the run), with no
    BREAK word, number, seasonal expression or speaker name in it, not beginning or ending on a STOP
    word, and holding no stop pair. A sentence of safe-harbour or call-mechanics wording is skipped whole. Words are lower-cased and plain plurals folded, so the KEY is the folded phrase.

    Without `want`: a list of keys. With `want` (a set of keys): a list of `(key, as said)` for
    those keys only, where "as said" keeps the call's own spelling, and its capitals when a word
    has one past its first letter (AI, OpenAI); a plain leading capital is lowered."""
    if memo is None:
        memo = {}
    out: list = []
    turns, names = split_turns(text[:_MAX_DOC_CHARS])
    surface = want is not None
    for turn in turns:
        run: list = []      # (word, is_stop, token as said)
        low = _blank(turn.lower())
        if surface and len(low) == len(turn):
            toks = [(m.group(), turn[m.start():m.end()]) for m in _TOKEN.finditer(low)]
            toks = [(t, o if o[1:] != t[1:] else t) for t, o in toks]
        else:
            toks = [(t, t) for t in _TOKEN.findall(low)]
        for tok, as_said in toks + [(".", ".")]:
            info = None
            if tok[0].isalnum() and tok not in names:
                info = memo.get(tok, 0)
                if info == 0:
                    info = memo[tok] = _classify(tok)
            if info is not None:
                run.append((info[0], info[1], as_said))
                continue
            n = len(run)
            if not n:
                continue
            for i in range(n):
                w1, s1, t1 = run[i]
                if s1:
                    continue
                if not surface:
                    out.append(w1)
                elif w1 in want:
                    out.append((w1, t1))
                if i + 1 >= n:
                    continue
                w2, s2, t2 = run[i + 1]
                k2 = w1 + " " + w2
                bad12 = k2 in _STOP_PAIRS
                if not s2 and not bad12:
                    if not surface:
                        out.append(k2)
                    elif k2 in want:
                        out.append((k2, t1 + " " + t2))
                if i + 2 >= n or bad12 or (s2 and w2 not in _JOIN):
                    continue
                w3, s3, t3 = run[i + 2]
                if s3 or (w2 + " " + w3) in _STOP_PAIRS:
                    continue
                k3 = k2 + " " + w3
                if not surface:
                    out.append(k3)
                elif k3 in want:
                    out.append((k3, t1 + " " + t2 + " " + t3))
            run = []
    return out


# ── Months ───────────────────────────────────────────────────────────────────────────────────────

def _prev_month(ym: str) -> str:
    y, m = int(ym[:4]), int(ym[5:7])
    return f"{y - 1}-12" if m == 1 else f"{y}-{m - 1:02d}"


def plan_months(calls_by_month: dict) -> list[dict]:
    """Pure: which months get a list, newest first: `[{month, calls, base_months, base_calls}]`.

    A month qualifies with MIN_MONTH_CALLS calls of its own and MIN_BASE_CALLS calls between the
    BASE_MONTHS calendar months before it (those that hold any). At most MAX_TARGET_MONTHS."""
    out = []
    for ym in sorted((m for m in calls_by_month if _YM.match(str(m))), reverse=True):
        n = int(calls_by_month[ym] or 0)
        if n < MIN_MONTH_CALLS:
            continue
        base, cur = [], ym
        for _ in range(BASE_MONTHS):
            cur = _prev_month(cur)
            if int(calls_by_month.get(cur) or 0) > 0:
                base.append(cur)
        base_calls = sum(int(calls_by_month[b]) for b in base)
        if base_calls < MIN_BASE_CALLS:
            continue
        out.append({"month": ym, "calls": n, "base_months": sorted(base), "base_calls": base_calls})
        if len(out) >= MAX_TARGET_MONTHS:
            break
    return out


def floor_calls(month_calls: int) -> int:
    """The calls a phrase needs in a month of `month_calls` calls."""
    return max(MIN_CALLS, int(math.ceil(MIN_SHARE_PCT / 100.0 * month_calls)))


# ── Like for like: the earlier calls, weighted to this month's mix of industries ────────────────────
# Which companies report changes through an earnings season (banks early, retailers and small
# biotech late), so a plain comparison of two months mostly lists the vocabulary of whichever
# industries report late. Each earlier call is therefore given a weight, so that the earlier months
# count as if they had held THIS month's mix: a call's stratum is its industry when both sides hold
# STRATUM_MIN calls of it, else its sector on the same test, else "the rest". The month's own share is
# never weighted. With no industry map every call is in "the rest" and the weights are all 1.

STRATUM_MIN = 8            # calls a stratum needs on each side before it is compared within itself
WEIGHT_MAX = 10.0          # one earlier call never counts as more than this many


def _groups_for(symbols: Iterable[str]) -> dict:
    """{SYMBOL: {"sector", "industry"}} from the stored industry map (read only, no provider call);
    {} when it cannot be read. Used for weighting only, never shown."""
    try:
        from api.services import industry_map
        return industry_map.peek_groups(sorted(set(symbols)))
    except Exception as exc:  # noqa: BLE001 - without the map the comparison is plain, and says so
        _log.warning("[call-themes] industry map unreadable: %s", exc)
        return {}


def base_weights(target_syms: list, base_syms: list, groups: dict) -> tuple[list, float]:
    """Pure: one weight per earlier call (in `base_syms` order), summing to their count, and the
    percent of this month's calls that were matched to their own industry or sector."""
    n_t, n_b = len(target_syms), len(base_syms)
    if not n_t or not n_b:
        return [1.0] * n_b, 0.0

    def tag(sym, field):
        v = (groups.get(sym) or {}).get(field)
        return str(v).strip() if v and str(v).strip() else None

    def thick(field, t_list, b_list):
        t, b = Counter(tag(x, field) for x in t_list), Counter(tag(x, field) for x in b_list)
        return {g for g in t if g and t[g] >= STRATUM_MIN and b[g] >= STRATUM_MIN}

    by_industry = thick("industry", target_syms, base_syms)
    left_t = [x for x in target_syms if tag(x, "industry") not in by_industry]
    left_b = [x for x in base_syms if tag(x, "industry") not in by_industry]
    by_sector = thick("sector", left_t, left_b)

    def stratum(sym):
        g = tag(sym, "industry")
        if g in by_industry:
            return ("industry", g)
        g = tag(sym, "sector")
        return ("sector", g) if g in by_sector else ("rest", "")

    t_n, b_n = Counter(stratum(x) for x in target_syms), Counter(stratum(x) for x in base_syms)
    raw = [min(WEIGHT_MAX, (t_n[stratum(x)] / n_t) / (b_n[stratum(x)] / n_b)) for x in base_syms]
    total = sum(raw)
    if total <= 0:                      # no earlier call shares a stratum with this month: compare plainly
        return [1.0] * n_b, 0.0
    matched = sum(n for s, n in t_n.items() if s[0] != "rest") * 100.0 / n_t
    return [w * n_b / total for w in raw], round(matched, 1)


# ── Ranking (pure) ───────────────────────────────────────────────────────────────────────────────

def _within(short: str, long: str) -> bool:
    """Is `short` a run of whole words inside `long`?"""
    return short != long and f" {short} " in f" {long} "


def _parts(key: str) -> list[str]:
    """Every shorter run of whole words inside a phrase."""
    w = key.split(" ")
    return [" ".join(w[i:j]) for i in range(len(w)) for j in range(i + 1, len(w) + 1) if j - i < len(w)]


def rank_month(counts: Iterable, month_calls: int, base_calls: int, cap: int = LIST_CAP,
               base_effective: Optional[float] = None) -> dict:
    """Pure: the two lists for one month.

    `counts` yields `(key, calls, companies, earlier_calls_saying_it, the same weighted)`. Returns
    `{"new": [...], "rising": [...], "qualified": {"new": n, "rising": n}}`, each row
    `{key, words, calls, pct, companies, base_calls, base_pct, base_raw_pct, rise, ratio, related}`,
    at most `cap` rows a list, best first. `base_pct` is the like-for-like earlier share (the weighted
    count over the earlier calls) and is what the rules and the order use; `base_raw_pct` is the plain
    one. `ratio` is None when the earlier share is nil.

    Either list also needs the gap between the two shares to be MIN_Z times its own standard error
    (two shares compared, `month_calls` against `base_effective`: the earlier calls' effective count
    once weighted, their plain count when not given). Thousands of phrases are tested, so a gap that
    chance produces one time in a hundred would fill the lists with noise in a thin month.

    One idea is listed once. A shorter phrase gives way to a longer one that holds it when the longer
    one has ABSORB_CALLS of its calls or ABSORB_RISE of its rise ("shutdown" to "government shutdown",
    "pricing" to "pricing power"); after that, a longer phrase that holds a phrase already listed above
    it is not a row of its own: it is named on that row (`related`, the first RELATED, best first)."""
    need = floor_calls(month_calls)
    n_eff = float(base_effective or base_calls)
    pool: dict[str, dict] = {}
    for key, calls, companies, base, weighted in counts:
        if calls < need or companies < MIN_COMPANIES:
            continue
        pct = calls * 100.0 / month_calls
        base_pct = weighted * 100.0 / base_calls
        row = {"key": key, "words": key.count(" ") + 1, "calls": int(calls), "pct": round(pct, 1),
               "companies": int(companies), "base_calls": int(base), "base_pct": round(base_pct, 1),
               "base_raw_pct": round(base * 100.0 / base_calls, 1), "rise": round(pct - base_pct, 1),
               "ratio": round(pct / base_pct, 1) if base_pct >= 0.05 else None, "_rise": pct - base_pct}
        pooled = (calls + base_pct / 100.0 * n_eff) / (month_calls + n_eff)
        se = math.sqrt(max(pooled * (1.0 - pooled) * (1.0 / month_calls + 1.0 / n_eff), 1e-12))
        if (pct - base_pct) / 100.0 < MIN_Z * se:
            continue
        if base_pct <= NEW_MAX_BASE_PCT:
            row["list"] = "new"
        elif pct - base_pct >= RISE_MIN_POINTS and pct >= base_pct * (RISE_MIN_RATIO if " " in key else RISE_MIN_RATIO_ONE_WORD):
            row["list"] = "rising"
        else:
            continue
        pool[key] = row

    # a shorter phrase gives way to the longer one that explains it
    absorbed = set()
    for key, row in pool.items():
        for part in _parts(key):
            short = pool.get(part)
            if short is not None and (row["calls"] >= ABSORB_CALLS * short["calls"]
                                      or row["_rise"] >= ABSORB_RISE * short["_rise"]):
                absorbed.add(part)
    out = {"new": [], "rising": [], "qualified": {"new": 0, "rising": 0}}
    order = {"new": lambda r: (-r["calls"], r["words"], r["key"]),
             "rising": lambda r: (-r["_rise"], -r["calls"], r["words"], r["key"])}
    kept_all: list[dict] = []
    for name in ("new", "rising"):
        rows = sorted((r for k, r in pool.items() if r["list"] == name and k not in absorbed), key=order[name])
        kept = []
        for r in rows:
            head = next((k for k in kept_all if _within(k["key"], r["key"])), None)
            if head is not None:
                if len(head["related"]) < RELATED:
                    head["related"].append(r["key"])
                continue
            r["related"] = []
            kept.append(r)
            kept_all.append(r)
        out["qualified"][name] = len(kept)
        out[name] = [{k: v for k, v in r.items() if k not in ("list", "_rise")} for r in kept[:cap]]
    return out


def fold_together(lists: dict, said_in: dict, month_calls: int, cap: int = LIST_CAP) -> dict:
    """Pure: phrases said by the same calls are one idea, listed once.

    `said_in` maps a key to the set of this month's calls that say it, as an int with one bit per
    call. Going down each list, a phrase is named on a row already kept (`related`) instead of being
    a row when either
      * the two share FOLD_OVERLAP of their calls (shared calls over all calls of either): two halves
        of a sentence many companies repeat, a name and its longer form; or
      * FOLD_INSIDE of its calls also say the kept phrase, and that is FOLD_LIFT times the kept
        phrase's own share of the month's calls: a word that travels with a theme ("exemption" with
        "tariff"). The lift test keeps a phrase from folding into one that most calls say anyway.
    Returns the same shape as `rank_month`, cut to `cap` rows a list."""
    out = {"new": [], "rising": [], "qualified": dict(lists.get("qualified") or {})}
    kept_all: list[dict] = []
    for name in ("new", "rising"):
        for r in lists.get(name) or []:
            mine = said_in.get(r["key"], 0)
            head = None
            if mine:
                for k in kept_all:
                    theirs = said_in.get(k["key"], 0)
                    both = (mine & theirs).bit_count()
                    if not both:
                        continue
                    inside = both / mine.bit_count()
                    if (both >= FOLD_OVERLAP * (mine | theirs).bit_count()
                            or (inside >= FOLD_INSIDE and inside >= FOLD_LIFT * theirs.bit_count() / month_calls)):
                        head = k
                        break
            if head is not None:
                for extra in [r["key"], *r["related"]]:
                    if len(head["related"]) < RELATED and extra not in head["related"]:
                        head["related"].append(extra)
                out["qualified"][name] = max(0, int(out["qualified"].get(name, 0)) - 1)
                continue
            row = {**r, "related": list(r["related"])}
            kept_all.append(row)
            if len(out[name]) < cap:
                out[name].append(row)
    return out


# ── The scan ─────────────────────────────────────────────────────────────────────────────────────

def _index_rows() -> list[tuple]:
    """`(rowid, symbol, 'YYYY-MM', day)` for every held call with a usable date."""
    from api.services import transcript_index as ix
    ix.init_db()
    with ix._conn() as c:
        rows = c.execute("SELECT rowid, symbol, call_date FROM transcript_fts WHERE call_date != ''").fetchall()
    out = []
    for r in rows:
        day = str(r["call_date"] or "")[:10]
        ym = day[:7]
        sym = str(r["symbol"] or "").strip().upper()
        if sym and _YM.match(ym):
            out.append((int(r["rowid"]), sym, ym, day))
    return out


def _read_text(rowid: int) -> str:
    from api.services import transcript_index as ix
    with ix._conn() as c:
        row = c.execute("SELECT content FROM transcript_fts WHERE rowid = ?", (rowid,)).fetchone()
    return (row["content"] if row else "") or ""


def build(*, rows: Optional[list] = None, read_text: Optional[Callable[[int], str]] = None,
          groups: Optional[dict] = None, now: Optional[datetime] = None, pace: Optional[float] = None) -> dict:
    """Read the held calls and work out every list. Slow: never call it on a request."""
    started = time.time()
    # by month, then company: pass 2 counts a company once a month by that order
    rows = sorted(_index_rows() if rows is None else rows, key=lambda t: (t[2], t[1], t[0]))
    read_text = read_text or _read_text
    pace = PACE_S if pace is None else pace
    now = now or datetime.now(timezone.utc)

    by_month = Counter(r[2] for r in rows)
    days = sorted(r[3] for r in rows)
    payload: dict[str, Any] = {
        "version": METHOD_VERSION,
        "built_at": now.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "built_day": now.astimezone(_ET).date().isoformat(),
        "corpus": {"calls": len(rows), "oldest": days[0] if days else None, "newest": days[-1] if days else None,
                   "months": [{"month": m, "calls": by_month[m]} for m in sorted(by_month)]},
        "rules": dict(RULES), "months": [], "lists": {},
    }
    targets = plan_months(by_month)
    if not targets:
        payload["seconds"] = round(time.time() - started, 1)
        return payload

    n_t = len(targets)
    target_at = {t["month"]: i for i, t in enumerate(targets)}
    in_window = {t["month"] for t in targets} | {b for t in targets for b in t["base_months"]}
    rows = [r for r in rows if r[2] in in_window]
    if groups is None:
        groups = _groups_for(r[1] for r in rows)
    # each earlier call's weight for each target month (None: not one of its earlier calls)
    weight = [[None] * n_t for _ in rows]
    for ti, t in enumerate(targets):
        base_at = [i for i, r in enumerate(rows) if r[2] in t["base_months"]]
        ws, t["matched_pct"] = base_weights([r[1] for r in rows if r[2] == t["month"]], [rows[i][1] for i in base_at], groups)
        t["base_effective"] = sum(ws) ** 2 / sum(w * w for w in ws)     # Kish: what the weighting leaves of them
        for i, w in zip(base_at, ws):
            weight[i][ti] = w
    memo: dict = {}

    def nap():
        if pace:
            time.sleep(pace)

    # pass 1: every phrase of the target months into fixed one-byte counters
    counters = [bytearray(_BUCKETS) for _ in targets]
    for rowid, _sym, ym, _day in rows:
        ti = target_at.get(ym)
        if ti is None:
            continue
        ctr = counters[ti]
        for key in set(doc_keys(read_text(rowid), memo)):
            h = hash(key) & _MASK
            if ctr[h] < 255:
                ctr[h] += 1
        nap()
    flags = 0
    for ti, t in enumerate(targets):
        need = min(255, floor_calls(t["calls"]))
        table = bytes(1 if v >= need else 0 for v in range(256))
        flags |= int.from_bytes(counters[ti].translate(table), "little")
    counters = []
    cand = flags.to_bytes(_BUCKETS, "little")
    del flags

    # pass 2: exact counts, for the phrases whose counter reached the floor only.
    # entry, four slots a target month: [calls, companies, earlier calls saying it, the same weighted] ... + the
    # last (month, company) counted
    exact: dict[str, list] = {}
    tag, last_pair = 0, None
    for at, (rowid, sym, ym, _day) in enumerate(rows):
        if (ym, sym) != last_pair:
            last_pair, tag = (ym, sym), tag + 1
        ti = target_at.get(ym)
        ws = weight[at]
        for key in set(doc_keys(read_text(rowid), memo)):
            if not cand[hash(key) & _MASK]:
                continue
            e = exact.get(key)
            if e is None:
                e = exact[key] = [0, 0, 0, 0.0] * n_t + [0]
            if ti is not None:
                e[4 * ti] += 1
                if e[-1] != tag:
                    e[-1] = tag
                    e[4 * ti + 1] += 1
            for bi in range(n_t):
                w = ws[bi]
                if w is not None:
                    e[4 * bi + 2] += 1
                    e[4 * bi + 3] += w
        nap()
    del cand

    ranked = {}
    for ti, t in enumerate(targets):
        ranked[t["month"]] = rank_month(
            ((k, e[4 * ti], e[4 * ti + 1], e[4 * ti + 2], e[4 * ti + 3]) for k, e in exact.items()),
            t["calls"], t["base_calls"], cap=POOL_CAP, base_effective=t["base_effective"])
    exact = {}

    # pass 3: the ranked phrases only: which calls say each (near-duplicates fold together), how each is most
    # often spelled, and the companies whose call says it most
    for t in targets:
        pool = ranked[t["month"]]
        pooled = [r for name in ("new", "rising") for r in pool[name]]
        want = frozenset([r["key"] for r in pooled] + [k for r in pooled for k in r["related"]])
        said: dict[str, Counter] = {k: Counter() for k in want}
        top: dict[str, Counter] = {k: Counter() for k in want}
        said_in: dict[str, int] = {k: 0 for k in want}
        companies = set()
        bit = 1
        for rowid, sym, ym, _day in rows:
            if ym != t["month"]:
                continue
            companies.add(sym)
            if want:
                seen: Counter = Counter()
                for key, as_said in doc_keys(read_text(rowid), memo, want):
                    seen[key] += 1
                    said[key][as_said] += 1
                for key, n in seen.items():
                    said_in[key] |= bit
                    if n > top[key][sym]:
                        top[key][sym] = n
            bit <<= 1
            nap()
        lists = fold_together(pool, said_in, t["calls"])

        def spelled(key: str, said=said) -> str:
            best = sorted(said[key].items(), key=lambda kv: (-kv[1], kv[0]))
            return best[0][0] if best else key

        for r in [r for name in ("new", "rising") for r in lists[name]]:
            key = r.pop("key")
            r["phrase"] = spelled(key)
            r["related"] = [spelled(k) for k in r["related"]]
            r["examples"] = [s for s, _n in sorted(top[key].items(), key=lambda kv: (-kv[1], kv[0]))[:EXAMPLES]]
        payload["lists"][t["month"]] = {
            "month": t["month"], "calls": t["calls"], "companies": len(companies),
            "baseline": {"months": t["base_months"], "calls": t["base_calls"], "matched_pct": t["matched_pct"]},
            "floor": {"calls": floor_calls(t["calls"]), "companies": MIN_COMPANIES},
            "new": lists["new"], "rising": lists["rising"], "qualified": lists["qualified"],
        }
        payload["months"].append(t["month"])
    payload["seconds"] = round(time.time() - started, 1)
    return payload


# ── The held answer ──────────────────────────────────────────────────────────────────────────────

_lock = threading.Lock()
_held: Optional[dict] = None
_file_read = False                      # the stored file is read once per process
_inflight: Optional[threading.Event] = None
_failed_at = 0.0
_last: dict = {}                        # what the last build did, for debug_state()


def _path() -> str:
    return os.path.join(os.environ.get("DATA_DIR", "/data"), "call_themes.json")


def _usable(payload) -> bool:
    return (isinstance(payload, dict) and payload.get("version") == METHOD_VERSION
            and isinstance(payload.get("lists"), dict) and isinstance(payload.get("months"), list)
            and isinstance(payload.get("corpus"), dict) and bool(payload.get("built_at")))


def _current() -> Optional[dict]:
    """The held answer: this module's copy, else the stored file (read once)."""
    global _held, _file_read
    with _lock:
        if _held is not None or _file_read:
            return _held
        _file_read = True
        try:
            with open(_path(), "r", encoding="utf-8") as f:
                payload = json.load(f)
        except FileNotFoundError:
            return None
        except Exception as exc:  # noqa: BLE001 - a damaged file is the same as none: rebuild
            _log.warning("[call-themes] stored answer unreadable: %s", exc)
            return None
        if _usable(payload):
            _held = payload
        return _held


def _save(payload: dict) -> None:
    path = _path()
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    tmp = f"{path}.tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(payload, f, separators=(",", ":"))
    os.replace(tmp, path)


def _build_bg(done: threading.Event, why: str) -> None:
    global _held, _inflight, _failed_at, _file_read
    note = {"started": time.time(), "finished": None, "seconds": None, "outcome": "running", "why": why}
    _last.clear()
    _last.update(note)
    try:
        payload = build()
        with _lock:
            _held, _file_read = payload, True
        _last["outcome"] = f"ok: {len(payload['months'])} month(s), {payload['corpus']['calls']} calls"
        try:
            _save(payload)
        except Exception as exc:  # noqa: BLE001 - the answer is still held in the module
            _last["outcome"] += f"; not stored ({type(exc).__name__})"
            _log.warning("[call-themes] could not store the answer: %s", exc)
    except Exception as exc:  # noqa: BLE001 - a failed build must not read as "computing" for ever
        _failed_at = time.time()
        _last["outcome"] = f"failed: {type(exc).__name__}"
        _log.warning("[call-themes] build failed: %s", exc)
    finally:
        _last["finished"] = time.time()
        _last["seconds"] = round(_last["finished"] - _last["started"], 1)
        _log.info("[call-themes] build (%s) %s in %.1fs", why, _last["outcome"], _last["seconds"])
        with _lock:
            _inflight = None
        done.set()


def _kick(why: str) -> bool:
    """Start the one background build unless one is running. True when this call started it."""
    global _inflight
    with _lock:
        if _inflight is not None:
            return False
        done = _inflight = threading.Event()
    threading.Thread(target=_build_bg, args=(done, why), daemon=True, name="call-themes-build").start()
    return True


def _today_et(now: Optional[datetime] = None) -> str:
    return (now or datetime.now(timezone.utc)).astimezone(_ET).date().isoformat()


def refresh_if_due(now: Optional[datetime] = None) -> bool:
    """The daily job: called after the transcript index's own sweep. Builds when nothing is held,
    when the held answer was built on an earlier New York day, or when it holds no list yet (a thin
    index is cheap to read again). True when a build was started."""
    held = _current()
    if held is not None and held.get("built_day") == _today_et(now) and held.get("months"):
        return False
    return _kick("daily")


def _age_s(held: dict) -> Optional[float]:
    try:
        built = datetime.strptime(held["built_at"], "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
    except Exception:  # noqa: BLE001
        return None
    return (datetime.now(timezone.utc) - built).total_seconds()


def get_themes(month: Optional[str] = None) -> dict:
    """The lists for one month (the newest that has one unless `month` is given). Answers at once:

      ok         {month, months, calls, companies, baseline, floor, new, rising, qualified, built_at, corpus, rules}
      computing  nothing is held on this server yet; the one build has been started, ask again
      empty      the call index holds no calls (a gap on our side, not a finding)
      thin       the index holds calls, but no month has enough of them to compare yet
      no_month   there is no list for the month asked for (`months` says which exist)
      error      the build failed moments ago; a later read starts another
    """
    held = _current()
    if held is None:
        if _failed_at and time.time() - _failed_at < ERROR_HOLD_S:
            return {"status": "error"}
        _kick("cold")
        return {"status": "computing"}
    age = _age_s(held)
    refreshing = bool(age is None or age > STALE_REBUILD_S) and (_kick("stale") or _inflight is not None)
    return _answer_of(held, month, refreshing)


def _answer_of(held: dict, month: Optional[str], refreshing: bool) -> dict:
    """The answer for one month out of a held payload (`get_themes` and `held_themes` share it)."""
    common = {"months": list(held["months"]), "built_at": held["built_at"], "corpus": held["corpus"],
              "rules": held.get("rules") or dict(RULES), "refreshing": refreshing}
    if not held["months"]:
        return {"status": "thin" if held["corpus"].get("calls") else "empty", **common}
    ym = month or held["months"][0]
    one = held["lists"].get(ym)
    if one is None:
        return {"status": "no_month", "month": ym, **common}
    return {"status": "ok", **one, **common}


def held_themes(month: Optional[str] = None) -> Optional[dict]:
    """READ ONLY: the answer `get_themes` gives from what this server already HOLDS (this module's
    copy, else the stored file, read once), or None when it holds nothing. It NEVER starts a build,
    cold or stale, so a caller that must not cause work (the Agent's `earnings.callThemes` kind,
    inside a turn) reads through here and never through `get_themes`. `refreshing` is true only
    when a build someone else started is running; an old answer is told by `built_at`."""
    held = _current()
    if held is None:
        return None
    return _answer_of(held, month, _inflight is not None)


def debug_state() -> dict:
    """What is held and what the last build did (no log line says this otherwise)."""
    held = _held
    return {"held": bool(held), "built_at": (held or {}).get("built_at"), "months": (held or {}).get("months"),
            "building": _inflight is not None, "last_build": dict(_last), "path": _path()}


def _reset_for_tests() -> None:
    global _held, _file_read, _inflight, _failed_at
    with _lock:
        _held, _file_read, _inflight, _failed_at = None, False, None, 0.0
    _last.clear()
