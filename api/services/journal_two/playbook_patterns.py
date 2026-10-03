"""My Playbook's behavioural patterns (wave 13, lane 13B): what the member wrote BEFORE losses vs
BEFORE wins, and which notes sit behind each setup.

THE TradesViz SHAPE, DETERMINISTIC ALL THE WAY DOWN (WAVE-13-PLAN §1.3). Every number here is a
count over the member's own notes and trades. No model reads a note, no model writes a number, and
no p-value is computed: a finding is "you wrote X before k of n losses and before j of m wins",
with both counts, both n, the label "Patterns, not proof", and the trades and notes it came from.

THE WORDS ARE A FIXED LIST, never mined. The member's own account taxonomy (the mistake and
emotion tags their accounts offer), falling back to the standard vocabulary in `tag_suggest.py`
when the taxonomy is empty. A note is never tokenised into "all its words" (plan: "Not: mining
all words").

WHAT "BEFORE" MEANS. A note counts for a trade when it is linked to that trade (an embed, the
`note_trade_links` reverse lookup, or the plan 13A froze for it in `j2_trade_plan_links`) AND we
can read what it said AT ENTRY: the note as it stood at the entry instant, from version history
(`plan_grading._note_state_at`, reused rather than restated). A note written after entry, or one
edited after entry with no earlier version on file, is NOT read -- we cannot know what it said
before the trade, and guessing would put words in the member's mouth.

WHICH TRADES. Every closed equity trade the member has with a Win or Loss result, newest first,
capped at `MAX_TRADES`. Broker trades are read exactly like manual ones (mirror: nothing is
filtered by source). Break-even trades are on neither side, and that is stated in the payload.

Read-only: nothing here writes a note, a trade or a table.
"""
from __future__ import annotations

import json
import re
import sqlite3
from types import MappingProxyType
from typing import Any

from api.services.journal_two import plan_grading
from api.services.journal_two.notes import extract_plain_text
from api.services.journal_two.tag_suggest import STANDARD_EMOTIONS, STANDARD_MISTAKES
from api.services.journal_two.trade_refs import trade_ref_for_row

#: The miner's minimums and caps. ONE block; `tests/test_notebook_playbook.py` pins every value.
CONSTANTS = MappingProxyType({
    # A side (wins, losses) needs at least this many trades WITH a readable before-note, or the
    # comparison is not made at all ("too few notes to compare").
    "MIN_NOTED_PER_SIDE": 5,
    # A word must appear before at least this many trades (wins + losses) to be a finding.
    "MIN_MENTIONS": 3,
    # At most this many findings are returned, strongest lean first.
    "MAX_FINDINGS": 6,
    # The newest closed trades read (a bound on the per-trade note lookups).
    "MAX_TRADES": 500,
})

CAPTION = "Patterns, not proof"

_NOTE_COLS = "id, title, body_json, properties_json, created_at, updated_at, deleted_at"


# ── the vocabulary ──────────────────────────────────────────────────────────────────────────

def _json_list(raw: Any) -> list[str]:
    try:
        v = json.loads(raw or "[]")
    except (ValueError, TypeError):
        return []
    return [str(x) for x in v if isinstance(x, str) and x.strip()] if isinstance(v, list) else []


def vocabulary(conn: sqlite3.Connection, user_id: str, account_id: str | None = None) -> dict[str, Any]:
    """The fixed word list: the account taxonomy (one account, or every account the member has),
    each list falling back to the standard vocabulary when empty. Read-only: it never creates the
    default account the way `accounts.get_account_settings(None)` would."""
    mistakes: list[str] = []
    emotions: list[str] = []
    try:
        sql = "SELECT mistake_tags, emotion_tags FROM j2_accounts WHERE user_id = ?"
        params: list[Any] = [user_id]
        if account_id:
            sql += " AND id = ?"
            params.append(account_id)
        for r in conn.execute(sql + " ORDER BY created_at ASC", params).fetchall():
            mistakes.extend(_json_list(r["mistake_tags"]))
            emotions.extend(_json_list(r["emotion_tags"]))
    except sqlite3.OperationalError:
        pass
    src_m = "account" if mistakes else "standard"
    src_e = "account" if emotions else "standard"
    mistakes = mistakes or list(STANDARD_MISTAKES)
    emotions = emotions or list(STANDARD_EMOTIONS)
    source = src_m if src_m == src_e else "mixed"
    terms: list[dict[str, str]] = []
    seen: set[str] = set()
    for kind, words in (("emotion", emotions), ("mistake", mistakes)):
        for w in words:
            norm = normalize(w)
            if norm and norm not in seen:
                seen.add(norm)
                terms.append({"term": w, "norm": norm, "kind": kind})
    return {"terms": terms, "source": source}


# ── matching ────────────────────────────────────────────────────────────────────────────────

_SEP = re.compile(r"[\s_\-]+")


def normalize(text: str) -> str:
    """Lowercase; underscores, hyphens and runs of space become one space. `early_exit`,
    `early-exit` and `Early  exit` are one word to the miner."""
    return _SEP.sub(" ", (text or "").lower()).strip()


def mentions(norm_text: str, norm_term: str) -> bool:
    """A whole-word (or whole-phrase) match; `rushed` never matches inside `brushed`."""
    if not norm_term:
        return False
    return re.search(r"(?<![a-z0-9])" + re.escape(norm_term) + r"(?![a-z0-9])", norm_text) is not None


# ── the notes behind a trade, as they stood at entry ─────────────────────────────────────────

def _linked_note_ids(conn: sqlite3.Connection, user_id: str, trade: sqlite3.Row) -> list[str]:
    from api.services.journal_two.note_trade_links import notes_linked_to_trade
    ids: set[str] = set()
    try:
        ids.update(notes_linked_to_trade(conn, user_id, trade["id"], "equity_trade"))
    except Exception:  # noqa: BLE001 -- an unreadable link reads as "no link", never a 500
        pass
    try:
        r = conn.execute("SELECT note_id FROM j2_trade_plan_links WHERE user_id = ? AND trade_ref = ?",
                         (user_id, trade_ref_for_row(trade))).fetchone()
        if r is not None and r["note_id"]:
            ids.add(r["note_id"])
    except sqlite3.OperationalError:
        pass
    return sorted(ids)


def notes_before_trade(conn: sqlite3.Connection, user_id: str, trade: sqlite3.Row) -> list[dict[str, Any]]:
    """Every linked note whose content AT ENTRY we can read: {noteId, title, asOf, text}."""
    moment = plan_grading.entry_moment(trade["entry_date"])
    if moment is None:
        return []
    cutoff = moment["cutoff"]
    out: list[dict[str, Any]] = []
    for nid in _linked_note_ids(conn, user_id, trade):
        note = conn.execute(f"SELECT {_NOTE_COLS} FROM j2_notes WHERE id = ? AND user_id = ? AND deleted_at IS NULL",
                            (nid, user_id)).fetchone()
        if note is None:
            continue
        # NOT redundant with the post_entry check below, even though every hand-made note has
        # created_at == updated_at: notes.py's importer (`_import_date` on `n.get("createdAt")` /
        # `n.get("updatedAt")`) sets the two independently from external source metadata, so an
        # imported row can carry created_at after entry with updated_at before it. On that shape
        # `_note_state_at` alone would read the current body as a valid pre-entry state
        # (post_entry False) -- this check is what excludes it. Mutation-pinned:
        # tests/test_notebook_playbook.py::
        # test_a_notes_own_created_at_gates_it_even_when_updated_at_predates_entry
        created = plan_grading._parse_ts(note["created_at"])  # noqa: SLF001 -- the one timestamp reader
        if created is None or created > cutoff:
            continue   # written after the trade: not a "before" note
        state = plan_grading._note_state_at(conn, user_id, note, cutoff)  # noqa: SLF001 -- reused, never restated
        if state["post_entry"]:
            continue   # edited after entry and no earlier version on file: what it said before is unknown
        try:
            doc = json.loads(state["body"] or "null")
        except (ValueError, TypeError):
            doc = None
        text = " ".join(x for x in (note["title"] or "", extract_plain_text(doc if isinstance(doc, dict) else None)) if x)
        out.append({"noteId": note["id"], "title": note["title"] or "", "asOf": state["as_of"], "text": text})
    return out


# ── the miner ───────────────────────────────────────────────────────────────────────────────

def _closed_trades(conn: sqlite3.Connection, user_id: str, account_id: str | None) -> list[sqlite3.Row]:
    """Closed Win/Loss trades, newest exit first. ⛔ No filter on source: broker trades count."""
    sql = "SELECT * FROM j2_trades WHERE user_id = ? AND result IN ('Win', 'Loss')"
    params: list[Any] = [user_id]
    if account_id:
        sql += " AND account_id = ?"
        params.append(account_id)
    sql += " ORDER BY exit_date DESC, id ASC LIMIT ?"
    params.append(int(CONSTANTS["MAX_TRADES"]))
    return conn.execute(sql, params).fetchall()


def _citation(trade: sqlite3.Row, notes: list[dict[str, Any]]) -> dict[str, Any]:
    return {"tradeId": trade["id"], "tradeRef": trade_ref_for_row(trade), "symbol": trade["symbol"],
            "result": trade["result"], "exitDate": trade["exit_date"],
            "notes": [{"noteId": n["noteId"], "title": n["title"], "asOf": n["asOf"]} for n in notes]}


def behaviour_patterns(conn: sqlite3.Connection, user_id: str, account_id: str | None = None) -> dict[str, Any]:
    """"What you wrote before losses vs wins": both counts, both n, every finding cited."""
    vocab = vocabulary(conn, user_id, account_id)
    trades = _closed_trades(conn, user_id, account_id)
    noted: dict[str, list[tuple[sqlite3.Row, list[dict[str, Any]], str]]] = {"Win": [], "Loss": []}
    for t in trades:
        notes = notes_before_trade(conn, user_id, t)
        if notes:
            norm = normalize(" ".join(n["text"] for n in notes))
            noted[t["result"]].append((t, notes, norm))

    n_wins, n_losses = len(noted["Win"]), len(noted["Loss"])
    base = {
        "caption": CAPTION,
        "constants": dict(CONSTANTS),
        "vocabulary": {"source": vocab["source"], "terms": [x["term"] for x in vocab["terms"]]},
        "tradesRead": len(trades),
        "noted": {"wins": n_wins, "losses": n_losses},
        "excludes": "Break-even trades, and notes written or edited after entry, are not read.",
    }
    floor = CONSTANTS["MIN_NOTED_PER_SIDE"]
    if n_wins < floor or n_losses < floor:
        return {**base, "status": "too_few_notes", "findings": [],
                "message": (f"Patterns need at least {floor} wins and {floor} losses with a note written "
                            f"before the trade. You have {n_wins} and {n_losses}.")}

    findings: list[dict[str, Any]] = []
    for term in vocab["terms"]:
        hit_w = [(t, notes) for t, notes, norm in noted["Win"] if mentions(norm, term["norm"])]
        hit_l = [(t, notes) for t, notes, norm in noted["Loss"] if mentions(norm, term["norm"])]
        total = len(hit_w) + len(hit_l)
        if total < CONSTANTS["MIN_MENTIONS"]:
            continue
        rate_l, rate_w = len(hit_l) / n_losses, len(hit_w) / n_wins
        if rate_l == rate_w:
            continue
        cited = [_citation(t, [n for n in notes if mentions(normalize(n["text"]), term["norm"])])
                 for t, notes in hit_l + hit_w]
        findings.append({
            "term": term["term"], "kind": term["kind"],
            "leans": "losses" if rate_l > rate_w else "wins",
            "losses": {"k": len(hit_l), "n": n_losses},
            "wins": {"k": len(hit_w), "n": n_wins},
            "citations": cited,
            "_order": (-abs(rate_l - rate_w), -total, term["norm"]),
        })
    findings.sort(key=lambda f: f["_order"])
    for f in findings:
        f.pop("_order")
    return {**base, "status": "ok", "findings": findings[: CONSTANTS["MAX_FINDINGS"]]}


# ── "From your notes": the notes behind each setup ───────────────────────────────────────────

def notes_by_setup(conn: sqlite3.Connection, user_id: str, setups: list[dict[str, Any]]) -> dict[str, list[dict[str, Any]]]:
    """For each setup record carrying `trades` (playbook_stats `with_trades=True`), the notes linked
    to any of its trades: {noteId, title, tradeCount}. A link list, not a statistic."""
    out: dict[str, list[dict[str, Any]]] = {}
    for rec in setups:
        counts: dict[str, int] = {}
        for tr in rec.get("trades") or []:
            row = conn.execute("SELECT * FROM j2_trades WHERE user_id = ? AND id = ?", (user_id, tr["id"])).fetchone()
            if row is None:
                continue
            for nid in _linked_note_ids(conn, user_id, row):
                counts[nid] = counts.get(nid, 0) + 1
        notes = []
        for nid, c in counts.items():
            r = conn.execute("SELECT title FROM j2_notes WHERE id = ? AND user_id = ? AND deleted_at IS NULL",
                             (nid, user_id)).fetchone()
            if r is not None:
                notes.append({"noteId": nid, "title": r["title"] or "", "tradeCount": c})
        notes.sort(key=lambda n: (-n["tradeCount"], n["title"].lower(), n["noteId"]))
        out[rec["setup"]] = notes
    return out
