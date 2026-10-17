"""Ask AI's SETUP CONTEXT block over the TSDR trader archive.

Consumer: `api/routers/ai_search.py::_grounded_system`, beside the TRADER ARCHIVE block
(archive/askai.py). Members ask "how does the team trade launch pads?", "what is a go signal?",
"does the oops reversal work in a downtrend?", "show me examples of TSDR flat-top breakouts";
the existing block keys on the question's TICKERS, this one keys on the SETUP it names.

THE GATE: WISDOM_ARCHIVE_ENABLED AND WISDOM_ARCHIVE_ASK_ENABLED, both read per call and FIRST.
Either off returns ("", []) before wisdom.db is opened, so the prompt is byte-identical. The Ask
AI routes are require_paid, which is the audience the archive's owner ruling (2026-10-15) names.

WHAT RESOLVES. A setup named in free text, by (a) the archive's own setup id, name and stored
aliases, (b) the vocabulary's `trader_archive` map (docs/wisdom/vocabulary/setup-vocabulary-v1.json:
the vocab entry's name and aliases, only for rows mapped without a mismatch and only when the
vocab id belongs to ONE archive setup, so a shared alias never picks a side), and (c) TEAM_SLANG.
Hyphens, underscores and spaces are interchangeable ("flat-top", "launchpad") and a plural matches.
Short all-caps aliases (EP, HTF, U&R) match case-sensitively, as service._alias_pattern does, and
every alias is word-bounded, so "EP" inside "STEP" or "deep" is not a hit. Bucket ids that are not
setups (other, watchlist, thesis, ...) never resolve.

WHAT THE BLOCK SAYS, bounded by MAX_BLOCK_CHARS (the archive block's own cap), each item cited:
  [SETUP · <name> · setup <id>]   the definition line (vocabulary definition when one exists,
                                  else name, aliases, family and who uses it)
  [RECORD · setup <id>]           n scored calls, 20d win rate, edge vs the same stock and the
                                  verdict: "measured edge" ONLY at |z| >= EDGE_Z on at least
                                  MIN_CONTEXT_N scored calls (team_record.verdict), else "not proven"
  [TRADERS · setup <id>]          who has an edge on this setup: from the imported playbook's
                                  per-trader cut (context.trader), each of the six traders is
                                  "measured edge" / "measured negative" under the SAME rule, else
                                  "not enough data"; display names and numbers only, never a quote
  [REGIME · QQQ <state> · ...]    only when the question names a market condition
  [LEVELS · ...]                  the level KINDS the team draws for that family (LEVEL_KINDS)
  [<trader> · <date> · <record>]  up to MAX_TEACHINGS teachings, scrubbed of prices/dates/levels
  [CALL · <trader> · <date> · <record>]  2-3 dated example calls; a price appears ONLY for a
                                  call older than provider.PRICE_AGE_SESSIONS, through
                                  provider.levels, the one place the price gate lives
  [LESSON · <trader> · <date> · <record>]  the closest LESSON posts (FTS), scrubbed, capped
Notes are run through publish.adapters.common.scrub_levels_and_dates; a record's verbatim
`quote` column is never read here.
"""
from __future__ import annotations

import functools
import logging
import re
from datetime import date
from typing import Iterable, Optional

from api.services.wisdom.core import flags

log = logging.getLogger(__name__)

FLAG_ENV = "WISDOM_ARCHIVE_ASK_ENABLED"
SOURCE_KEY = "trader_archive"
SALT_SUFFIX = "|trader_archive_setup"
KIND = "trader_archive_setup"
MAX_SETUPS = 1
MAX_TEACHINGS = 3
TEACHING_CHARS = 220
MAX_EXAMPLES = 3
MAX_LESSONS = 3
LESSON_CHARS = 220
DEFINITION_CHARS = 420
MAX_ALIASES_SHOWN = 4
HEADER = ("\n\nTRADER ARCHIVE — SETUP CONTEXT (the UCT team's dated posts in the TSDR archive about the "
          "setup this question names; cite the trader, the date and the record id in brackets, e.g. "
          "'TSDR, 2025-01-02, t123'; a RECORD line covers every archived call of the setup, win rate and "
          "edge are outcomes 20 sessions after each call, edge = versus the same stock on a random day; "
          "a TRADERS line splits the team's traders by their own record on the setup (edge, negative, or "
          "not enough data to say); "
          "LEVELS are the kinds of lines the team draws, never prices to act on; historical posts, never "
          "current market data or a recommendation): ")

#: Setup ids in the archive taxonomy that are buckets, not setups a member can ask about.
NON_SETUP_BUCKETS = frozenset({"other", "watchlist", "thesis", "position_update", "entry_unspecified",
                               "bearish_view", "breakout_other", "short_other"})

#: Team slang for setups the archive names otherwise. Applied only to a setup id the store holds.
TEAM_SLANG = {
    "launch_pad": ("launch pad", "launchpad"),
    "flat_top_breakout": ("flat top", "flat top breakout"),
    "go_signal": ("go signal",),
    "oops": ("oops reversal",),
    "undercut_reclaim": ("undercut and rally", "undercut & rally", "U&R", "undercut and reclaim"),
    "flag_htf": ("high tight flag", "HTF"),
    "ep": ("episodic pivot",),
    "peg_flag": ("power earnings gap",),
    "wedge_pop": ("wedge pop",),
    "ma_reclaim": ("remount",),
}

#: Where the team places lines, by setup family: level KINDS, never a price. Source: the
#: 2026-10-16 ledger level study (private ledger, lab/level_drawing/REPORT.md — stated stops line
#: up with the prior-day low or the 20 EMA; breakout triggers with the 10-session range high;
#: pullback entries with the 10 EMA or the prior-day low). Display guidance for the answer only.
LEVEL_KINDS = {
    "stop": "stops: the prior-day low or the 20 EMA",
    "breakout": "trigger: the 10-day range high",
    "pullback": "entry: the 10 EMA or the prior-day low",
}
LEVEL_STUDY = "level study 2026-10-16"
BREAKOUT_FAMILY = frozenset({"flat_top_breakout", "breakout_other", "launch_pad", "flag_htf", "vcp",
                             "stage1_base", "inside_day", "wedge_pop", "classical_pattern", "go_signal"})
PULLBACK_FAMILY = frozenset({"pullback_ma", "ma_reclaim", "undercut_reclaim", "gap_support", "oops",
                             "slingshot", "support_level"})

#: A market condition named in the question -> the archive's market state (setup_map.classify_market).
_REGIME_RES = (
    ("downtrend", re.compile(r"\b(?:down[\s-]?trend(?:s|ing)?|bear(?:ish)?\s+(?:market|tape)s?|corrections?"
                             r"|sell[\s-]?offs?|weak\s+(?:tape|market)|risk[\s-]?off)\b", re.I)),
    ("uptrend", re.compile(r"\b(?:up[\s-]?trend(?:s|ing)?|bull(?:ish)?\s+(?:market|tape)s?"
                           r"|strong\s+(?:tape|market)|risk[\s-]?on)\b", re.I)),
    ("mixed", re.compile(r"\b(?:choppy|chop|sideways|range[\s-]?bound|mixed\s+(?:tape|market))\b", re.I)),
)

#: Question words that carry no lesson-retrieval signal beyond the stop list service already drops.
_FILLER = frozenset("""team trade trades trading traded work works working show examples example setup setups
use used using handle play plays guys signal""".split())


def enabled() -> bool:
    """Both gates, archive first; reads only the environment."""
    return flags.archive_enabled() and flags.archive_ask_enabled()


# ── resolution ───────────────────────────────────────────────────────────────

def _phrase_pattern(phrase: str, *, from_id: bool = False) -> Optional[re.Pattern]:
    p = " ".join(str(phrase or "").replace("_", " ").replace("-", " ").split())
    if len(p) < 2:
        return None
    if from_id and p.isalpha() and len(p) <= 3:
        p = p.upper()                                    # 'ep' -> 'EP': an acronym, matched as one
    case_sensitive = len(p) <= 4 and p == p.upper() and any(c.isalpha() for c in p)
    body = r"[\s\-_]*".join(re.escape(t) for t in p.split(" "))
    return re.compile(r"(?<![A-Za-z0-9])" + body + r"(?:'?s|es)?(?![A-Za-z0-9])", 0 if case_sensitive else re.I)


def _name_phrases(name: Optional[str]) -> list:
    n = str(name or "")
    out = [n.split("/")[0].split("(")[0]]
    out += re.findall(r"\(([^()]{2,40})\)", n)
    return [x.strip() for x in out if x.strip()]


@functools.lru_cache(maxsize=1)
def _vocab_phrases() -> dict:
    """archive setup id -> phrases from the vocabulary (name + aliases), exact maps only."""
    from api.services.wisdom.core import vocab

    doc = vocab.load_vocabulary()
    entries = {e["vocab_id"]: e for e in doc.get("entries") or []}
    ambiguous = {str(a).lower() for a in doc.get("ambiguous_aliases") or []}
    rows = doc["maps"]["trader_archive"]["rows"]
    owners: dict = {}
    for r in rows:
        if r.get("vocab_id"):
            owners.setdefault(r["vocab_id"], set()).add(r["external_name"])
    out: dict = {}
    for r in rows:
        e = entries.get(r.get("vocab_id"))
        if not e or r.get("mismatch") or len(owners[r["vocab_id"]]) != 1:
            continue
        phrases = _name_phrases(e.get("name")) + [a for a in e.get("aliases") or [] if a.lower() not in ambiguous]
        out[r["external_name"]] = tuple(phrases)
    return out


def clear_cache() -> None:
    _vocab_phrases.cache_clear()


def _vocab_entry(setup_id: str) -> Optional[dict]:
    from api.services.wisdom.core import vocab

    doc = vocab.load_vocabulary()
    row = next((r for r in doc["maps"]["trader_archive"]["rows"] if r["external_name"] == setup_id), None)
    if not row or not row.get("vocab_id") or row.get("mismatch"):    # an approximate map names something else
        return None
    return next((e for e in doc.get("entries") or [] if e["vocab_id"] == row["vocab_id"]), None)


def _phrases_for(conn) -> list:
    """[(setup_id, pattern)] for every setup the store holds, buckets excluded."""
    import json

    vocab_extra = _vocab_phrases()
    out = []
    for sid, name, aliases_json in conn.execute("SELECT setup_id, name, aliases_json FROM wisdom_archive_setups"):
        if sid in NON_SETUP_BUCKETS:
            continue
        try:
            aliases = json.loads(aliases_json or "[]")
        except ValueError:
            aliases = []
        p = _phrase_pattern(sid, from_id=True)
        if p is not None:
            out.append((sid, p))
        for phrase in [*_name_phrases(name), *aliases, *vocab_extra.get(sid, ()), *TEAM_SLANG.get(sid, ())]:
            p = _phrase_pattern(phrase)
            if p is not None:
                out.append((sid, p))
    return out


def resolve_setups(conn, text: Optional[str], *, limit: int = MAX_SETUPS) -> list:
    """Archive setup ids the text names, longest match first; overlapping matches keep the longest
    ("oops reversal" is one setup, not oops plus a reversal bucket). [] when nothing resolves."""
    t = str(text or "")
    if not t.strip():
        return []
    from api.services.wisdom.publish.adapters import common

    if not common.table_exists(conn, "wisdom_archive_setups"):
        return []
    hits = []
    for sid, pattern in _phrases_for(conn):
        for m in pattern.finditer(t):
            hits.append((m.end() - m.start(), m.start(), m.end(), sid))
    hits.sort(key=lambda h: (-h[0], h[1], h[3]))
    taken: list = []
    found: list = []
    for length, start, end, sid in hits:
        if sid in found or any(start < e and s < end for s, e in taken):
            continue
        taken.append((start, end))
        found.append(sid)
    return found[:max(1, limit)]


def regime_named(text: Optional[str]) -> Optional[str]:
    for state, pattern in _REGIME_RES:
        if pattern.search(text or ""):
            return state
    return None


def trader_named(text: Optional[str]) -> Optional[str]:
    """The team author a question names ("examples of TSDR flat-tops"), or None."""
    from api.services.wisdom.publish.adapters import common

    for aid in common.team_author_ids():
        name = common.speaker(aid)
        if name and name != "Unknown" and re.search(
                r"(?<![A-Za-z0-9])" + re.escape(name) + r"(?:'?s)?(?![A-Za-z0-9])", text or "", re.I):
            return aid
    return None


# ── lines ────────────────────────────────────────────────────────────────────

def _num(v) -> Optional[float]:
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _pct(v) -> Optional[str]:
    x = _num(v)
    if x is None:
        return None
    x *= 100
    return f"{'+' if x > 0 else ''}{x:.1f}%"


def _scrub(text: Optional[str], n: int) -> str:
    from api.services.wisdom.publish.adapters import common

    return common.clip(common.scrub_levels_and_dates(text), n)


def _speaker(author_id) -> str:
    from api.services.wisdom.archive.askai import _speaker as speak

    return speak(author_id)


def _stat_bits(st: dict) -> str:
    from api.services.wisdom.archive import team_record

    bits = [f"n {int(st.get('n_scored') or 0)} scored calls"]
    win = _num(st.get("win20"))
    if win is not None:
        bits.append(f"20d win rate {win * 100:.0f}%")
    med = _pct(st.get("med_edge20"))
    if med:
        bits.append(f"median vs same stock {med}")
    edge = _num(st.get("mean_edgeR"))
    if edge is not None:
        bits.append(f"edge R {edge:+.2f}")
    bits.append(team_record.verdict(st))
    return ", ".join(bits)


def definition_line(pb: dict) -> str:
    sid = pb.get("setup_id")
    entry = _vocab_entry(sid) or {}
    text = f"[SETUP · {pb.get('name') or sid} · setup {sid}] "
    definition = pb.get("definition") or entry.get("definition")
    if definition:
        text += _scrub(definition, DEFINITION_CHARS) + "; "
    names = [a for a in (pb.get("aliases") or []) if a][:MAX_ALIASES_SHOWN]
    if entry.get("name") and entry["name"] not in names:
        names.insert(0, entry["name"])
    if names:
        text += "also called " + ", ".join(names[:MAX_ALIASES_SHOWN]) + "; "
    if pb.get("family"):
        text += f"family {pb['family']}; "
    users = [_speaker(a) for a in pb.get("used_by") or []]
    if users:
        text += "traded by " + ", ".join(users)
    return _clip(text.rstrip("; "), DEFINITION_CHARS)


def record_line(pb: dict) -> str:
    st = ((pb.get("stats") or {}).get("all")) or {}
    sid = pb.get("setup_id")
    if not st.get("n_scored"):
        return f"[RECORD · setup {sid}] no scored calls in the archive"
    return f"[RECORD · setup {sid}] all archived calls: " + _stat_bits(st)


def _team_display() -> dict:
    """normalised key -> author id, for the six team authors (their id and their display name)."""
    from api.services.wisdom.publish.adapters import common

    out = {}
    for aid in common.team_author_ids():
        for k in (aid, common.speaker(aid)):
            norm = re.sub(r"[^a-z0-9]", "", str(k or "").lower())
            if norm and norm != "unknown":
                out[norm] = aid
    return out


def trader_cuts(pb: dict) -> dict:
    """{'edge': [(author_id, stats)], 'negative': [...], 'not_enough_data': [author_id]} from the
    playbook's per-trader cut. Keys that are not one of the team's authors are dropped."""
    from api.services.wisdom.archive import team_record

    edge_z, min_n = team_record._thresholds()
    team = _team_display()
    out: dict = {"edge": [], "negative": [], "not_enough_data": []}
    cuts = ((pb.get("context") or {}).get("trader")) or {}
    for key in sorted(cuts):
        aid = team.get(re.sub(r"[^a-z0-9]", "", str(key).lower()))
        st = cuts.get(key) or {}
        if not aid or not int(st.get("n_scored") or 0):
            continue
        z, n = _num(st.get("edgeR_z")), int(st.get("n_scored") or 0)
        if z is not None and abs(z) >= edge_z and n >= min_n:
            out["edge" if z > 0 else "negative"].append((aid, st))
        else:
            out["not_enough_data"].append(aid)
    return out


def traders_line(pb: dict) -> str:
    """Who has an edge on this setup, or "" when the playbook carries no per-trader cut."""
    cuts = trader_cuts(pb)
    if not any(cuts.values()):
        return ""

    def item(aid, st):
        bits = [f"n {int(st.get('n_scored') or 0)}"]
        edge = _num(st.get("mean_edgeR"))
        if edge is not None:
            bits.append(f"edge R {edge:+.2f}")
        z = _num(st.get("edgeR_z"))
        if z is not None:
            bits.append(f"z {z:.1f}")
        return f"{_speaker(aid)} ({', '.join(bits)})"

    parts = [f"measured edge: {'; '.join(item(a, s) for a, s in cuts['edge']) or 'none'}",
             f"measured negative: {'; '.join(item(a, s) for a, s in cuts['negative']) or 'none'}"]
    if cuts["not_enough_data"]:
        parts.append("not enough data: " + ", ".join(_speaker(a) for a in cuts["not_enough_data"]))
    return f"[TRADERS · setup {pb.get('setup_id')}] who has an edge on this setup: " + "; ".join(parts)


def regime_line(pb: dict, state: str) -> str:
    cut = ((pb.get("context") or {}).get("market") or {}).get(state)
    head = f"[REGIME · QQQ {state} · setup {pb.get('setup_id')}] "
    rule = " (the archive's rule: QQQ close vs its 50- and 200-day averages)"
    if not cut or not cut.get("n_scored"):
        return head + f"no scored calls of this setup in a QQQ {state}" + rule
    return head + f"calls posted in a QQQ {state}: " + _stat_bits(cut) + rule


def family_kind(pb: dict) -> Optional[str]:
    sid = pb.get("setup_id")
    fam = str(pb.get("family") or "").lower()
    if sid in BREAKOUT_FAMILY or "breakout" in fam:
        return "breakout"
    if sid in PULLBACK_FAMILY or "pullback" in fam:
        return "pullback"
    return None


def levels_line(pb: dict) -> str:
    kinds = [LEVEL_KINDS["stop"]]
    fam = family_kind(pb)
    if fam:
        kinds.append(LEVEL_KINDS[fam])
    return f"[LEVELS · {LEVEL_STUDY}] where the team draws lines for this setup: " + "; ".join(kinds)


def teaching_lines(pb: dict) -> list:
    out = []
    for t in (pb.get("teachings") or [])[:MAX_TEACHINGS]:
        note = _scrub(t.get("note"), TEACHING_CHARS)
        if not note or not t.get("record_id"):
            continue
        who = _speaker(t.get("author_id"))
        out.append((f"[TEACHING · {who} · {t.get('date') or 'undated'} · {t['record_id']}] {note}",
                    {"record_id": t["record_id"], "trader": who, "date": t.get("date"),
                     "setup": pb.get("setup_id"), "kind": f"{KIND}_teaching", "flag_env": FLAG_ENV}))
    return out


def _author_calls(conn, setup_id: str, author_id: str, n: int) -> list:
    """A trader's newest calls of one setup, WITHOUT level columns (prices go through provider.levels)."""
    import json

    rows = []
    for r in conn.execute(
            "SELECT call_id, record_id, author_id, ticker, direction, posted, outcome_json FROM wisdom_archive_calls "
            "WHERE setup = ? COLLATE NOCASE AND author_id = ? ORDER BY posted DESC, call_id DESC LIMIT ?",
            (setup_id, author_id, int(n))):
        try:
            o = json.loads(r["outcome_json"] or "{}")
        except ValueError:
            o = {}
        rows.append({"call_id": r["call_id"], "record_id": r["record_id"], "author_id": r["author_id"],
                     "ticker": r["ticker"], "direction": r["direction"], "posted": r["posted"],
                     "r20": (o or {}).get("r20")})
    return rows


def pick_examples(conn, pb: dict, author_id: Optional[str] = None) -> list:
    """Two winners and a failure (honest), a named trader's own first; at most MAX_EXAMPLES."""
    winners, failures = list(pb.get("winners") or []), list(pb.get("failures") or [])
    if author_id:
        winners = [e for e in winners if e.get("author_id") == author_id]
        failures = [e for e in failures if e.get("author_id") == author_id]
    picked = winners[:2] + failures[:1]
    rest = winners[2:] + failures[1:]
    while len(picked) < MAX_EXAMPLES and rest:
        picked.append(rest.pop(0))
    if author_id and len(picked) < 2:
        have = {e.get("call_id") for e in picked}
        picked += [e for e in _author_calls(conn, pb["setup_id"], author_id, MAX_EXAMPLES)
                   if e["call_id"] not in have][:MAX_EXAMPLES - len(picked)]
    seen, out = set(), []
    for e in picked:
        if e.get("call_id") and e["call_id"] not in seen:
            seen.add(e["call_id"])
            out.append(e)
    return out[:MAX_EXAMPLES]


def example_lines(conn, pb: dict, author_id: Optional[str] = None, *, today: Optional[date] = None) -> list:
    from api.services.wisdom.archive import provider

    examples = pick_examples(conn, pb, author_id)
    gated = provider.levels(conn, [e["call_id"] for e in examples], today=today)
    out = []
    for e in examples:
        who = _speaker(e.get("author_id"))
        day = str(e.get("posted") or "")[:10] or "undated"
        r20 = _pct(e.get("r20"))
        text = (f"[CALL · {who} · {day} · {e.get('record_id')}] {e.get('ticker')} "
                f"{e.get('direction') or ''}".rstrip())
        text += f", r20 {r20}" if r20 else ", outcome not yet scored"
        lv = gated.get(e["call_id"])
        if lv:
            text += " (stated levels: " + ", ".join(f"{k} {p:.2f}" for k, p in lv) + ")"
        out.append((text, {"record_id": e.get("record_id"), "call_id": e["call_id"], "trader": who, "date": day,
                           "ticker": e.get("ticker"), "setup": pb.get("setup_id"),
                           "outcome": {"r20": e.get("r20")}, "kind": f"{KIND}_example", "flag_env": FLAG_ENV}))
    return out


def lesson_lines(conn, query: str, names: Iterable[str], *, exclude: Iterable[str] = (),
                 limit: int = MAX_LESSONS) -> list:
    """The closest LESSON posts through the provider's FTS (team authors only), scrubbed and capped."""
    from api.services.wisdom.archive import provider, service

    skip = set(exclude)
    words = [w for w in service._WORD.findall(query or "")
             if w.lower() not in service._STOP and w.lower() not in _FILLER]
    hits: list = []
    for q in (" ".join(names), " ".join(words)):
        if len(hits) >= limit or not q.strip():
            continue
        for h in provider.search(conn, q, limit=limit * 2, types=("LESSON",)):
            if h["record_id"] not in skip and all(h["record_id"] != x["record_id"] for x in hits):
                hits.append(h)
    hits = hits[:limit]
    if not hits:
        return []
    ids = [h["record_id"] for h in hits]
    notes = {r["record_id"]: r["note"] for r in conn.execute(
        f"SELECT record_id, note FROM wisdom_archive_records WHERE record_id IN ({','.join('?' * len(ids))})", ids)}
    out = []
    for h in hits:
        note = _scrub(notes.get(h["record_id"]), LESSON_CHARS)
        if not note:
            continue
        who = _speaker(h.get("author_id"))
        out.append((f"[LESSON · {who} · {h.get('stated_date') or 'undated'} · {h['record_id']}] {note}",
                    {"record_id": h["record_id"], "trader": who, "date": h.get("stated_date"),
                     "kind": f"{KIND}_lesson", "flag_env": FLAG_ENV}))
    return out


def _clip(text: str, n: int) -> str:
    return text if len(text) <= n else text[:n - 1].rstrip() + "…"


# ── the block ────────────────────────────────────────────────────────────────

def _assemble(items: list) -> tuple[str, list]:
    """Items in priority order; each whole line fits the budget or is dropped (never cut mid-cite)."""
    from api.services.wisdom.archive import askai

    parts, cites, used = [], [], len(HEADER)
    for line, cite in items:
        if not line or used + len(line) + 3 > askai.MAX_BLOCK_CHARS:
            continue
        parts.append(line)
        used += len(line) + 3
        if cite:
            cites.append(cite)
    if not parts:
        return "", []
    return HEADER + " | ".join(parts), cites


def setup_block(query: Optional[str], *, question_type: Optional[str] = None,
                today: Optional[date] = None) -> tuple[str, list]:
    """(block text, citations) or ("", []). Never raises."""
    try:
        if not enabled():                                # both gates first: off touches no store
            return "", []
        from api.services.wisdom.archive import service
        from api.services.wisdom.core import store

        q = str(query or "")[:600]
        items: list = []
        with store.read() as conn:
            for sid in resolve_setups(conn, q):
                pb = service.playbook(conn, sid)
                if pb is None:
                    continue
                cite = {"setup": sid, "name": pb.get("name"), "kind": KIND, "flag_env": FLAG_ENV}
                items.append((definition_line(pb), cite))
                items.append((record_line(pb), {**cite, "kind": f"{KIND}_record",
                                                "stats": ((pb.get("stats") or {}).get("all")) or {}}))
                tl = traders_line(pb)
                if tl:
                    cuts = trader_cuts(pb)
                    items.append((tl, {**cite, "kind": f"{KIND}_traders",
                                       "traders": {k: [a if isinstance(a, str) else a[0] for a in v]
                                                   for k, v in cuts.items()}}))
                state = regime_named(q)
                if state:
                    items.append((regime_line(pb, state), {**cite, "kind": f"{KIND}_regime", "regime": state}))
                items.append((levels_line(pb), {**cite, "kind": f"{KIND}_levels", "source": LEVEL_STUDY}))
                teachings = teaching_lines(pb)
                items.extend(teachings)
                items.extend(example_lines(conn, pb, trader_named(q), today=today))
                names = [pb.get("name") or "", *(_vocab_phrases().get(sid, ())[:1])]
                items.extend(lesson_lines(conn, q, [" ".join(n.split("/")[0].split()) for n in names],
                                          exclude=[c["record_id"] for _, c in teachings]))
            if not items and question_type == "concept-education":
                items.extend(lesson_lines(conn, q, []))
        return _assemble(items)
    except Exception:
        log.exception("[wisdom] Ask-AI archive setup block failed; answering without it")
        return "", []
