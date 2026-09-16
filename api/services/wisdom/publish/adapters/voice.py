"""Voice adapter: the TSDR Desk title style guide draft, and the corpus preview (D18/D19).

Flag `WISDOM_VOICE_PROFILE_ENABLED`.

- The CORPUS FILE for the Morning Wire voice profile is written PC-side by
  `tools/wisdom/publish_voice_corpus.py` (to %LOCALAPPDATA%\\uct\\wisdom, never a repo). It is
  not a morning-wire commit: `data/voice/*.json` are git-tracked there and the next 6:35 AM
  wire consumes them, so the rebuild stays with the MW owner on approval (D19). This module
  only previews how many TSDR documents that export would carry.
- The STYLE GUIDE is derived from the owner's OWN titles: Sunday Scans issue titles and the
  titles of sessions he hosted. Titles in the Desk's creative form "{Hook} | {type} — {date}"
  are excluded — those hooks are composed by `desk_creative` (LIVE since 2026-08-19), not by
  him, and a guide learned from them would teach the model its own voice back. Every figure
  carries its n. Draft only; nothing selects a register file (that selector belongs to the
  Desk owner, `desk_creative.py`).
"""
from __future__ import annotations

import re
import statistics
from collections import Counter

from api.services.wisdom.core import flags

CONSUMER = "voice"
FLAG_ENV = "WISDOM_VOICE_PROFILE_ENABLED"
KIND_STYLE = "desk_title_style"
CREATIVE_SEPARATOR = " | "
_TICKER_RE = re.compile(r"\$[A-Z]{1,5}\b|\b[A-Z]{2,5}\b")
_NOT_TICKERS = frozenset({"UCT", "TSDR", "ET", "AM", "PM", "EOD", "USA", "AI", "IPO", "EMA", "SMA", "RS", "VCP"})


def owner_titles(conn) -> tuple[list[dict], int]:
    rows = conn.execute(
        "SELECT source_id, stream, title FROM wisdom_sources WHERE title IS NOT NULL AND TRIM(title) <> '' "
        "AND (stream = 'sunday_scans' OR (host_author_id = 'tsdr' AND stream IN ('zoom_live', 'workshop', "
        "'interview', 'education'))) "
        "AND NOT EXISTS (SELECT 1 FROM wisdom_sources newer WHERE newer.supersedes_source_id = wisdom_sources.source_id) "
        "ORDER BY source_id").fetchall()
    keep = [dict(r) for r in rows if CREATIVE_SEPARATOR not in r["title"]]
    return keep, len(rows) - len(keep)


def title_style_guide(conn) -> dict:
    titles, excluded = owner_titles(conn)
    n = len(titles)
    if not n:
        return {"n_titles": 0, "excluded_creative_titles": excluded, "rules": [], "examples": []}
    words = [len(t["title"].split()) for t in titles]

    def share(pred) -> dict:
        k = sum(1 for t in titles if pred(t["title"]))
        return {"k": k, "n": n}

    def sentence_case(title: str) -> bool:
        rest = [w for w in title.split()[1:] if w[:1].isalpha()]
        return bool(rest) and sum(1 for w in rest if w[:1].islower()) >= len(rest) / 2

    openers = Counter(t["title"].split()[0].strip(",.:!?").lower() for t in titles if t["title"].split())
    stats = {
        "median_words": statistics.median(words), "max_words": max(words),
        "sentence_case": share(sentence_case),
        "exclamation": share(lambda s: "!" in s), "question": share(lambda s: "?" in s),
        "colon": share(lambda s: ":" in s), "em_dash": share(lambda s: "—" in s),
        "names_a_ticker": share(lambda s: any(m.lstrip("$") not in _NOT_TICKERS for m in _TICKER_RE.findall(s))),
    }
    rules = [f"Aim for about {stats['median_words']:g} words (his titles: median {stats['median_words']:g}, "
             f"max {stats['max_words']}, n={n})."]
    sc = stats["sentence_case"]
    rules.append(f"{'Sentence' if sc['k'] * 2 >= n else 'Title'} case: {sc['k']}/{n} of his titles are sentence case.")
    for key, what in (("names_a_ticker", "name a ticker"), ("exclamation", "use '!'"), ("question", "ask a question")):
        rules.append(f"{stats[key]['k']}/{n} {what}.")
    return {
        "n_titles": n, "excluded_creative_titles": excluded, "stats": stats,
        "top_openers": [{"word": w, "k": c, "n": n} for w, c in openers.most_common(5)],
        "rules": rules,
        "examples": [{"title": t["title"], "stream": t["stream"], "locator": f"wisdom:{t['source_id']}#title@title"}
                     for t in titles[:10]],
    }


def daily(ctx) -> dict:
    from api.services.wisdom.core import store
    from api.services.wisdom.publish.adapters import common, voicefmt

    flag_on = flags.voice_profile_enabled()
    with store.read() as conn:
        guide = title_style_guide(conn)
        corpus_docs = len(voicefmt.corpus_documents(conn))
    out = {"flag_on": flag_on, "style_titles": guide["n_titles"], "corpus_documents": corpus_docs}
    if getattr(ctx, "dry_run", False):
        return {**out, "dry_run": True}
    result = None
    with store.write() as conn:
        if flag_on and guide["n_titles"]:
            result = common.upsert_draft(
                conn, kind=KIND_STYLE, subject_ref="desk_title_style:tsdr",
                title=f"TSDR Desk title style guide (from {guide['n_titles']} of his own titles)",
                payload=guide, citations=[e["locator"] for e in guide["examples"]], provisional=True)
        common.log_publish(conn, CONSUMER, f"summary:titles={guide['n_titles']}:corpus_docs={corpus_docs}",
                           "export" if flag_on else "would_publish", FLAG_ENV, flag_on)
    return {**out, "style_draft": result}
