"""The nightly UCT Relative Strength leaders post to Discord (unit 2b-07).

Engineering map docs/superpowers/plans/2026-11-06-uct-rs-phase2-engineering-map.md
section 2.9 and section 3 row 2b-07. The map's code read settled the routing:
the member alert lane (`screen_alerts` -> `alert_routing` -> `alerts.add_alert`)
is per-member in-app plus email, a private alert never reaches Discord
(`alerts.py:483`), and `alert_routing` has exactly one permitted importer
(`tests/test_alert_destination.py`). So this is a DEDICATED poster on the
`discord_index_close` shape: its own flag, its own webhook variable, its own
session marker, and no import of the alert lane. A rail in
tests/test_rs_discord_post.py reads this file's AST to keep it that way.

WHAT IT POSTS (the template the owner's delegated decisions settled on
2026-11-07, P1-P10 in docs/research/relative-strength/reviews/
2026-11-07-delegated-decisions.md; rendered sample in docs/alerts/RS-DISCORD-POST.md):
one plain-text message EVERY settled session naming the session's RS leaders
in three lists (RS new highs before price, RS new highs on a red day, rating 90
and above with the sector), the rule behind the lists, an evidence line that
carries a measured number or says plainly that none exists yet, and the
sign-off. On a session that was not a red day the red-day line says so with
SPY's own change instead of "none" (P1), so a member never reads an empty list
as "no name held up". Operator voice: no emoji, no markdown, no exclamation
marks, no mention of anyone, no hype words (the design plan section 3 voice
rules).

THE CHANNEL IS MEMBER-FACING AND THE JOB IS UNATTENDED, so everything fails
closed and silent, each gate on its own: the flag is off unless deliberately
armed (literal "1", the `rs_history_enabled` convention), a blank webhook posts
nowhere (never a fallback to another room), a session already marked is not
posted again, fewer names than the floor is no post, a post the validator
refuses is no post. A 429 is reported and never retried; a 5xx is retried once
after a pause; nothing in `post_rs_summary` raises.

THE DATA SEAM. `leaders_fn(session)` is injected and returns either the rows
(`list[dict]`) or `{"leaders": [rows], "spy_change_pct": float | None}`, the
second carrying SPY's own close-to-close change for the session so the red-day
line can state it. Unit 2b-08 wires the real reader (`api.main._rs_leaders_for`)
over the 2a-05 screener columns (`rs_new_high`, `rs_nh_before_price`,
`rs_nh_red_day`, `rs_line_above_ma`, `rs_rating_ibd`) and SPY's own
`chg_pct_1d` row. The row contract is enforced once, in `normalise_leaders`;
the mapping is split once, in `split_leaders`.

THIS MODULE REGISTERS NO JOB. The scheduler registration (04:45 ET with the
05:15 ET retry), the boot line and the admin door are unit 2b-08, in `api.main`
and `api/routers/rs_discord.py`.
"""
from __future__ import annotations

import datetime as _dt
import json
import logging
import math
import os
import pathlib
import re
import tempfile
import threading
import time

log = logging.getLogger(__name__)

#: The flag. Read PER CALL in `enabled()`; only the literal "1" arms it.
FLAG = "RS_DISCORD_POST_ENABLED"
#: The webhook variable: a row in `alert_taxonomy.channels.LEGACY_WEBHOOKS`
#: (purpose `rs_leaders`), so the census rail sees it. Blank is silence. The
#: room is #uncharted-scanners (decision P7): the owner creates the webhook
#: there, because the bot token is 403 in that channel.
WEBHOOK_ENV = "DISCORD_RS_WEBHOOK_URL"
WEBHOOK_PURPOSE = "rs_leaders"
#: Identity (decision P6): the name the estate's other automated member posts use.
USERNAME = "UCT Intelligence"
#: The session marker on the data volume (the `discord_index_close` pattern).
MARKER_FILE = "rs_discord_post.json"
#: One retry on a 5xx, after this pause (injected in tests via `sleep=`).
RETRY_PAUSE_S = 5.0
SEND_TIMEOUT_S = 15

#: List caps and the floor. A list longer than its cap ends in "and N more";
#: fewer distinct names than `floor` across the whole post is no post (the
#: plan's three-name floor). Decided 2026-11-07: caps 8 / 8 / 10 (P3), floor
#: three (P8); docs/alerts/RS-DISCORD-POST.md section 8.
LIMITS = {
    "before_price": 8,     # names in "RS new highs before price"
    "red_day": 8,          # names in "RS new highs on a red day"
    "rating": 10,          # names in "Rating 90 and above"
    "rating_min": 90,      # the rating list's threshold
    "floor": 3,            # fewer distinct leaders than this posts nothing
}

#: Discord's own limits (developer docs, message and embed objects).
DISCORD = {
    "content": 2000, "username": 80, "embeds": 10, "embed_total": 6000,
    "title": 256, "description": 4096, "fields": 25, "field_name": 256,
    "field_value": 1024, "footer": 2048, "author": 256,
}

RULE_LINE = (
    "Rule: an RS new high is the RS line against SPY closing at its highest level of the "
    "last 252 bars. Before price means the stock is still more than 2% below its own high. "
    "A red day is SPY closing down 0.5% or more. The rating is IBD-style, 1 to 99, ranked "
    "across every stock with a recent daily price, excluding ETFs."
)
#: The honesty sentence: printed whenever no measured evidence is supplied.
#: Never a claim without a number (design plan section 9). Approved as written
#: (decision P10).
HONESTY_LINE = (
    "Evidence: no published hit rate exists for these signals and UCT has not measured one "
    "yet. A measured number with its sample size and dates replaces this sentence once the "
    "nightly backtest reports."
)
#: Decision P9: the webhook username already says who is posting.
SIGN_OFF = "Not a recommendation."

#: The red-day threshold the RULE_LINE states and the screener's `rs_nh_red_day`
#: flag uses (`relative_strength.DEFAULT_RED_DAY_PCT`, through
#: `rs_columns.collect_one`'s defaults). Restated rather than imported so this
#: module stays free of the maths package; tests/test_rs_discord_post.py pins
#: the two equal.
RED_DAY_PCT = -0.5
RED_DAY_LABEL = "RS new highs on a red day: "

#: ONE RUN AT A TIME across every caller (the scheduled fire, the retry pass and
#: the admin door of 2b-08 all land here). The marker is written only AFTER a
#: 2xx, so two overlapping runs would both read "not posted" and both post.
_RUN_LOCK = threading.Lock()


# ── the switches, read per call ───────────────────────────────────────────────

def enabled() -> bool:
    """`RS_DISCORD_POST_ENABLED` read per call: a flip needs no restart. Only the
    literal "1" arms it; "true", "yes" and typos all mean off."""
    return os.environ.get("RS_DISCORD_POST_ENABLED", "0") == "1"


def configured_webhook() -> str:
    """The channel's webhook, read now. Blank posts NOTHING: an unset variable is
    silence, never a fallback to the admin, ops or general room."""
    return (os.environ.get(WEBHOOK_ENV, "") or "").strip()


# ── the session marker ────────────────────────────────────────────────────────

class FileMarker:
    """One post per session, remembered on the data volume so a pod restart, a
    double fire or the retry pass cannot post the same session twice.

    The marker is written only after a 2xx. The write is encode, temp file,
    `os.replace`: `open(w)` truncates before a failing write can be caught, and
    a half-written marker reads as "never posted", which double-posts. An
    unreadable marker also reads as "never posted" (the fail direction the
    retry pass needs), never a crash.

    `mark` returns True when the marker is on disk and False when the write
    failed (a full or read-only volume). A landed post whose marker could not
    be written is also remembered IN THIS PROCESS, per marker path, so a
    same-process admin call cannot post that session again; a later successful
    write hands the record back to the file. A restart forgets it, which the
    receipt's `marked=False` and its reason say at the time.

    Any object with `posted(session) -> bool` and `mark(session)` can stand in
    (the `dedup=` seam of `post_rs_summary`). Its `mark` returning False, or
    raising, reads as "not recorded"; any other return reads as recorded.
    """

    #: marker path -> the landed session its file could not record (review #32).
    _unrecorded: dict = {}
    _unrecorded_lock = threading.Lock()

    def __init__(self, path=None):
        self._path = pathlib.Path(path) if path else None

    @property
    def path(self) -> pathlib.Path:
        return self._path or pathlib.Path(os.environ.get("DATA_DIR", "/data")) / MARKER_FILE

    def last_posted(self) -> str:
        try:
            return str(json.loads(self.path.read_text(encoding="utf-8")).get("last_posted") or "")
        except Exception:  # noqa: BLE001 - unreadable reads as "not posted"
            return ""

    def posted(self, session) -> bool:
        key = str(session or "").strip()
        if not key:
            return False
        if self.last_posted() == key:
            return True
        with FileMarker._unrecorded_lock:
            return FileMarker._unrecorded.get(str(self.path)) == key

    def mark(self, session) -> bool:
        p = self.path
        try:
            p.parent.mkdir(parents=True, exist_ok=True)
            body = json.dumps({"last_posted": str(session), "marked_at": time.time()})
            fd, tmp = tempfile.mkstemp(dir=str(p.parent), prefix=".rspost", suffix=".tmp")
            try:
                with os.fdopen(fd, "w", encoding="utf-8") as fh:
                    fh.write(body)
                os.replace(tmp, p)
            except Exception:
                try:
                    os.unlink(tmp)
                except OSError:
                    pass
                raise
        except Exception as e:  # noqa: BLE001
            log.warning("[rs-post] could not record the session marker: %s", e)
            with FileMarker._unrecorded_lock:
                FileMarker._unrecorded[str(p)] = str(session or "").strip()
            return False
        with FileMarker._unrecorded_lock:
            FileMarker._unrecorded.pop(str(p), None)
        return True


def last_posted() -> str:
    """The session the default marker last recorded, "" when none (for the
    2b-08 status readback)."""
    return FileMarker().last_posted()


# ── the seam contract ─────────────────────────────────────────────────────────

ROW_KEYS = ("ticker", "name", "sector", "rating", "before_price", "red_day", "new_high", "rs_line_above")
#: The keys of the mapping form of `leaders_fn`'s result (see `split_leaders`).
SEAM_KEYS = ("leaders", "spy_change_pct")


def spy_change(value) -> float | None:
    """SPY's session change in percent as a finite float, or None. A bool, a
    blank, a non-number, NaN or infinity is None: the red-day line then says
    nothing about SPY rather than print a made-up change."""
    if value is None or isinstance(value, bool):
        return None
    try:
        v = float(value)
    except (TypeError, ValueError, OverflowError):
        return None
    return v if math.isfinite(v) else None


def split_leaders(result) -> tuple[list, float | None]:
    """`leaders_fn`'s result as `(rows, spy_change_pct)`.

    The seam accepts two shapes: the bare rows (a list, as before), which carry
    no SPY change, or the mapping `{"leaders": rows, "spy_change_pct": x}`
    the real reader returns. Anything else is no rows and no change."""
    if isinstance(result, dict):
        rows = result.get("leaders")
        return (list(rows) if isinstance(rows, (list, tuple)) else []), spy_change(result.get("spy_change_pct"))
    if isinstance(result, (list, tuple)):
        return list(result), None
    return [], None


def normalise_leaders(rows) -> list[dict]:
    """The `leaders_fn(session)` row contract, enforced once.

    Each row is a dict:
      ticker        str, required; upper-cased; a repeated ticker keeps its first row
      name          str, optional; carried, not rendered
      sector        str, optional; rendered in the rating list when present
      rating        int 1..99 or None (the IBD-style rating, `rs_rating_ibd` /
                    `rs_history.read_fields()[t]["ibd"]`); anything else is None,
                    rendered "(unrated)", never a made-up number
      new_high      bool: the RS line closed at a 252-bar high this session
      before_price  bool: that high came while price is still more than 2% below
                    its own high; read only together with `new_high`
      red_day       bool: the session was a red day for the benchmark (SPY closed
                    down 0.5% or more); read only together with `new_high`
      rs_line_above bool: the RS line is above its 21-bar average; carried, not
                    rendered (decision P5, 2026-11-07: no Mansfield word)

    Rows that are not dicts, or carry no ticker, are dropped. The result is sorted
    rating descending (unrated last), then ticker, so the lists read best-first.
    The mapping form of the seam is accepted too (its `leaders` are read).
    """
    if isinstance(rows, dict):
        rows = split_leaders(rows)[0]
    out, seen = [], set()
    for raw in rows or ():
        if not isinstance(raw, dict):
            continue
        ticker = str(raw.get("ticker") or "").strip().upper()
        if not ticker or ticker in seen:
            continue
        seen.add(ticker)
        rating = raw.get("rating")
        try:
            rating = None if rating is None or isinstance(rating, bool) else int(round(float(rating)))
        except (TypeError, ValueError, OverflowError):
            rating = None
        if rating is not None and not 1 <= rating <= 99:
            rating = None
        out.append({
            "ticker": ticker,
            "name": str(raw.get("name") or "").strip() or None,
            "sector": str(raw.get("sector") or "").strip() or None,
            "rating": rating,
            "before_price": bool(raw.get("before_price")),
            "red_day": bool(raw.get("red_day")),
            "new_high": bool(raw.get("new_high")),
            "rs_line_above": bool(raw.get("rs_line_above")),
        })
    out.sort(key=lambda r: (-(r["rating"] if r["rating"] is not None else 0), r["ticker"]))
    return out


# ── the message, pure ─────────────────────────────────────────────────────────

def session_line(session) -> str:
    """"Thursday, November 5" for a YYYY-MM-DD session (or a date); the raw text
    when it will not parse, so a bad key is visible rather than silently today."""
    try:
        d = session if isinstance(session, _dt.date) else _dt.date.fromisoformat(str(session)[:10])
        return d.strftime("%A, %B ") + str(d.day)
    except Exception:  # noqa: BLE001
        return str(session)


def _name(row: dict) -> str:
    return f"{row['ticker']} ({row['rating']})" if row["rating"] is not None else f"{row['ticker']} (unrated)"


def _joined(rows: list, cap: int) -> str:
    """"A (97), B (95), and 3 more" - the cap cuts between names, never inside one,
    and the count of what was cut is said rather than hidden."""
    if not rows:
        return "none"
    cap = max(1, int(cap))
    shown = rows[:cap]
    rest = len(rows) - len(shown)
    text = ", ".join(_name(r) for r in shown)
    return f"{text}, and {rest} more" if rest else text


def spy_change_text(pct) -> str:
    """SPY's session change as the red-day line prints it: "+0.4%", "-0.3%",
    "0.0%" ("" when unknown). One decimal, and more only when one would round a
    change that was NOT a red day onto the threshold: -0.46 printed as "-0.5%"
    would contradict the rule line, which calls -0.5% a red day."""
    v = spy_change(pct)
    if v is None:
        return ""
    dp = 1
    while dp < 4 and v > RED_DAY_PCT and float(f"{v:.{dp}f}") <= RED_DAY_PCT:
        dp += 1
    text = f"{v:+.{dp}f}%"
    return f"{0:.{dp}f}%" if float(text[:-1]) == 0 else text      # never "-0.0%"


def red_day_text(red_rows: list, cap: int, spy_change_pct=None) -> str:
    """The red-day list, or why it is empty (decision P1).

    Names flagged `red_day` are listed whatever SPY's change says: the flag is
    the screener's own judgement per name and the post never drops a name it
    was handed. With no such name, a session SPY's change shows was NOT a red
    day reads "SPY was not a red day (+0.4%)", so an empty list is never
    mistaken for "nothing held up on a down day"; a red day with no name, or a
    session whose SPY change is unknown, reads "none"."""
    if red_rows:
        return _joined(red_rows, cap)
    v = spy_change(spy_change_pct)
    if v is not None and v > RED_DAY_PCT:
        return f"SPY was not a red day ({spy_change_text(v)})"
    return "none"


def _rated_lines(rows: list, cap: int) -> list[str]:
    if not rows:
        return ["none"]
    cap = max(1, int(cap))
    lines = [_name(r) + (f" {r['sector']}" if r["sector"] else "") for r in rows[:cap]]
    rest = len(rows) - cap
    if rest > 0:
        lines.append(f"and {rest} more")
    return lines


def _one_evidence(ev) -> str | None:
    """One measured sentence, or None when any number is missing or unusable.
    Contract: {signal?, n, hit_rate_pct, horizon_bars, start, end, outcome?,
    hit_rate_low_pct?, hit_rate_high_pct?, split_unchecked?, survivorship?,
    survivorship_corrected?} (`rs_evidence_pull.evidence_for`'s field names).

    ⭐ ONE AUTHORITY FOR THE WORDS (2026-11-07): the likely range, the
    unchecked-split note and the survivorship caveat are the chart card's own
    pieces (`rs_evidence_pull.likely_range_phrase`, `split_unchecked_phrase`,
    `survivorship_sentence`), so the post never states a hit rate the card
    states with a range, or leaves out a disclosure the card carries. Each
    prints only when the dict carries it."""
    from api.services import rs_evidence_pull as ep
    if not isinstance(ev, dict):
        return None
    try:
        n = int(ev["n"])
        hit = float(ev["hit_rate_pct"])
        horizon = int(ev["horizon_bars"])
        start = _dt.date.fromisoformat(str(ev["start"]))
        end = _dt.date.fromisoformat(str(ev["end"]))
    except (KeyError, TypeError, ValueError):
        return None
    if n <= 0 or hit != hit or not 0.0 <= hit <= 100.0 or horizon <= 0 or end < start:
        return None
    signal = str(ev.get("signal") or "").strip() or "RS new highs"
    outcome = str(ev.get("outcome") or "").strip() or f"closed higher {horizon} bars later"
    band = ep.likely_range_phrase(ev.get("hit_rate_low_pct"), ev.get("hit_rate_high_pct"))
    text = f"{n:,} {signal} from {start.isoformat()} to {end.isoformat()}; {hit:.1f}%{band} {outcome}."
    splits = ep.split_unchecked_phrase(ev.get("split_unchecked"))
    if splits:
        text += f" {splits}"
    if ev.get("survivorship_corrected") is False:
        text += f" {ep.survivorship_sentence(ev.get('survivorship'))}"
    return text


def evidence_line(evidence) -> str:
    """The evidence line: measured sentences when `evidence` (a dict or a list of
    dicts) carries complete numbers, otherwise the honesty sentence. Never a
    claim without a number."""
    items = evidence if isinstance(evidence, (list, tuple)) else ([evidence] if evidence else [])
    parts = [s for s in (_one_evidence(ev) for ev in items) if s]
    return "Evidence: " + " ".join(parts) if parts else HONESTY_LINE


def build_post(leaders, *, session, evidence=None, limits=LIMITS, spy_change_pct=None) -> dict:
    """The message body for one session, pure: `{username, content, allowed_mentions}`
    in the `discord_index_close` shape (plain text, every mention disabled).

    `leaders` is what `leaders_fn(session)` returned, either shape (see
    `split_leaders`, `normalise_leaders`); `spy_change_pct` is SPY's session
    change in percent, and defaults to the one the mapping carries (see
    `red_day_text`); `evidence` is the nightly backtest's measured numbers or
    None (see `evidence_line`); `limits` overrides `LIMITS` key by key.
    """
    lim = {**LIMITS, **(limits or {})}
    raw, carried = split_leaders(leaders)
    spy = spy_change(spy_change_pct) if spy_change_pct is not None else carried
    rows = normalise_leaders(raw)
    before = [r for r in rows if r["new_high"] and r["before_price"]]
    red = [r for r in rows if r["new_high"] and r["red_day"]]
    rated = [r for r in rows if r["rating"] is not None and r["rating"] >= int(lim["rating_min"])]
    lines = [f"UCT RS leaders for {session_line(session)}.", ""]
    lines.append("RS new highs before price: " + _joined(before, lim["before_price"]))
    lines.append(RED_DAY_LABEL + red_day_text(red, lim["red_day"], spy))
    lines.append(f"Rating {int(lim['rating_min'])} and above, with sector:")
    lines.extend(_rated_lines(rated, lim["rating"]))
    lines.append("")
    lines.append(RULE_LINE)
    lines.append(evidence_line(evidence))
    lines.append(SIGN_OFF)
    return {"username": USERNAME, "content": "\n".join(lines), "allowed_mentions": {"parse": []}}


# ── the validator ─────────────────────────────────────────────────────────────

# Wider than discord_close_note's range on purpose: it also catches the
# miscellaneous symbols block (stars, check marks, arrows), the variation
# selector and the joiner that make a plain character render as an emoji.
_EMOJI_RE = re.compile("[\U0001F000-\U0001FAFF☀-➿⬀-⯿️‍]")
_SHORTCODE_RE = re.compile(r":[a-z][a-z0-9_+-]+:")
_MASS_MENTION_RE = re.compile(r"@(everyone|here)\b")
_MENTION_RE = re.compile(r"<(?:@[!&]?|#)\d+>")
_TAG_RE = re.compile(r"</?[a-zA-Z][^<>]*>")
_MARKDOWN_INLINE = ("**", "__", "`", "~~", "||")
_MARKDOWN_LINE_RE = re.compile(r"^\s*(?:#{1,3}\s|>\s?|[-*+]\s|\d+\.\s)")
_DASHES = ("—", "–")          # the owner's standing rule: no em or en dashes
#: The design plan's banned vocabulary plus the two verbs the voice never uses.
BANNED_WORDS = ("guarantee", "elite", "powerful", "unlock alpha", "institutional accumulation",
                "leading indicator", "crystal ball", "buy", "sell")
_BANNED_RES = tuple((w, re.compile(r"\b" + re.escape(w) + r"\b", re.IGNORECASE)) for w in BANNED_WORDS)


def _text_problems(text: str, label: str) -> list[str]:
    out = []
    if not text:
        return out
    for m in _MASS_MENTION_RE.finditer(text):
        out.append(f"{label}: mass mention @{m.group(1)}")
    if _MENTION_RE.search(text):
        out.append(f"{label}: user, role or channel mention")
    if "@" in text and not out:
        out.append(f"{label}: contains @")
    if _EMOJI_RE.search(text) or _SHORTCODE_RE.search(text):
        out.append(f"{label}: emoji")
    if _TAG_RE.search(text):
        out.append(f"{label}: markup")
    if any(tok in text for tok in _MARKDOWN_INLINE):
        out.append(f"{label}: markdown")
    if any(_MARKDOWN_LINE_RE.match(line) for line in text.splitlines()):
        out.append(f"{label}: markdown list, quote or heading")
    if "!" in text:
        out.append(f"{label}: exclamation mark")
    if any(d in text for d in _DASHES):
        out.append(f"{label}: em or en dash")
    for word, rx in _BANNED_RES:
        if rx.search(text):
            out.append(f"{label}: banned word '{word}'")
    return out


def _too_long(value, cap: int, label: str, problems: list) -> int:
    if value is None:
        return 0
    if not isinstance(value, str):
        problems.append(f"{label} is not a string")
        return 0
    if len(value) > cap:
        problems.append(f"{label} is {len(value)} chars; Discord allows {cap}")
    return len(value)


def validate_post(post) -> list[str]:
    """Every reason this post must not go out, precisely; `[]` means it may.

    Discord's limits (2000 content chars, 10 embeds, 6000 embed chars, 256
    title, 4096 description, 25 fields of 256/1024, 2048 footer, 256 author,
    80 username), every mention disabled, and the house voice: no emoji, no
    markup or markdown, no exclamation marks, no em or en dashes, none of the
    plan's banned words.
    """
    if not isinstance(post, dict):
        return ["post is not a dict"]
    problems: list[str] = []
    content = post.get("content")
    if content is not None and not isinstance(content, str):
        problems.append("content is not a string")
        content = ""
    content = content or ""
    embeds = post.get("embeds")
    if embeds is None:
        embeds = []
    elif not isinstance(embeds, list):
        problems.append("embeds is not a list")
        embeds = []
    if not content.strip() and not embeds:
        problems.append("empty post")
    if len(content) > DISCORD["content"]:
        problems.append(f"content is {len(content)} chars; Discord allows {DISCORD['content']}")
    problems += _text_problems(content, "content")
    if post.get("allowed_mentions") != {"parse": []}:
        problems.append('allowed_mentions must be {"parse": []}: every mention disabled')
    username = post.get("username")
    if not isinstance(username, str) or not username.strip():
        problems.append("username missing")
    else:
        _too_long(username, DISCORD["username"], "username", problems)
        problems += _text_problems(username, "username")
    if len(embeds) > DISCORD["embeds"]:
        problems.append(f"{len(embeds)} embeds; Discord allows {DISCORD['embeds']}")
    total = 0
    for i, e in enumerate(embeds):
        if not isinstance(e, dict):
            problems.append(f"embed {i} is not a dict")
            continue
        for key, cap in (("title", DISCORD["title"]), ("description", DISCORD["description"])):
            total += _too_long(e.get(key), cap, f"embed {i} {key}", problems)
            if isinstance(e.get(key), str):
                problems += _text_problems(e[key], f"embed {i} {key}")
        fields = e.get("fields") or []
        if not isinstance(fields, list):
            problems.append(f"embed {i} fields is not a list")
            fields = []
        if len(fields) > DISCORD["fields"]:
            problems.append(f"embed {i} has {len(fields)} fields; Discord allows {DISCORD['fields']}")
        for j, f in enumerate(fields):
            if not isinstance(f, dict):
                problems.append(f"embed {i} field {j} is not a dict")
                continue
            total += _too_long(f.get("name"), DISCORD["field_name"], f"embed {i} field {j} name", problems)
            total += _too_long(f.get("value"), DISCORD["field_value"], f"embed {i} field {j} value", problems)
            for key in ("name", "value"):
                if isinstance(f.get(key), str):
                    problems += _text_problems(f[key], f"embed {i} field {j} {key}")
        footer = e.get("footer") or {}
        if isinstance(footer, dict):
            total += _too_long(footer.get("text"), DISCORD["footer"], f"embed {i} footer", problems)
        author = e.get("author") or {}
        if isinstance(author, dict):
            total += _too_long(author.get("name"), DISCORD["author"], f"embed {i} author", problems)
    if total > DISCORD["embed_total"]:
        problems.append(f"embeds total {total} chars; Discord allows {DISCORD['embed_total']}")
    return problems


# ── the post ──────────────────────────────────────────────────────────────────

def _default_send(url: str, body: dict) -> int:
    """The real transport: one JSON POST to the webhook, the HTTP status back."""
    import requests
    r = requests.post(url, json=body, timeout=SEND_TIMEOUT_S)
    return int(r.status_code)


def _status_of(result) -> int:
    if isinstance(result, bool):
        return 204 if result else 0
    if isinstance(result, int):
        return result
    try:
        return int(getattr(result, "status_code"))
    except Exception:  # noqa: BLE001
        return 0


def _deliver(url: str, post: dict, send, sleep) -> tuple[bool, str, int]:
    """(landed, reason, attempts). A 2xx lands. A 429 is "rate-limited" and is
    NEVER retried here (Discord's retry-after is honoured by the next scheduled
    pass, not a tight loop). A 5xx is retried exactly once after RETRY_PAUSE_S.
    Any other status, or a transport error, is reported once: a timeout may
    mean Discord accepted the post, and a second send would double-post."""
    send = send or _default_send
    sleep = sleep or time.sleep
    attempts = 0
    for attempt in (1, 2):
        attempts = attempt
        try:
            status = _status_of(send(url, post))
        except Exception as e:  # noqa: BLE001
            log.warning("[rs-post] send raised: %s", e)
            return False, f"send failed: {type(e).__name__}", attempts
        if 200 <= status < 300:
            return True, "posted", attempts
        if status == 429:
            log.warning("[rs-post] rate-limited by Discord; not retrying")
            return False, "rate-limited", attempts
        if 500 <= status < 600 and attempt == 1:
            log.warning("[rs-post] http %s; one retry after %.0fs", status, RETRY_PAUSE_S)
            sleep(RETRY_PAUSE_S)
            continue
        return False, f"http {status}" + (" after one retry" if attempt == 2 else ""), attempts
    return False, "unreachable", attempts


def post_rs_summary(session, *, leaders_fn, webhook_url=None, send=None, dedup=None,
                    sleep=None, evidence_fn=None, limits=LIMITS,
                    force: bool = False, dry_run: bool = False) -> dict:
    """Post the session's RS leaders once. Returns a receipt and NEVER raises:
    `{posted: bool, reason: str, session, chars, leaders, spy_change_pct,
    attempts, marked, dry_run}` (`chars` is the content length, `leaders` the
    count of usable rows, `spy_change_pct` SPY's session change as the reader
    gave it or None, `marked` whether the session marker was recorded after a
    landed post).

    session      the settled session, YYYY-MM-DD (the snapshot's date)
    leaders_fn   `leaders_fn(session)` -> the rows, or `{"leaders": rows,
                 "spy_change_pct": x}` (see `split_leaders`, `normalise_leaders`)
    webhook_url  the destination; None reads `configured_webhook()`; blank is
                 the reason "no webhook configured", never a fallback
    send         `send(url, body) -> int | response` (default: `requests.post`)
    dedup        an object with `posted(session)` / `mark(session)`
                 (default: `FileMarker()` on DATA_DIR)
    sleep        the pause before the one 5xx retry (default `time.sleep`)
    evidence_fn  `evidence_fn(session) -> dict | list | None`, the nightly
                 backtest's measured numbers; a failure prints the honesty line
    force        the owner's deliberate one-off: skips the flag, the marker and
                 the floor, never the webhook or the validator
    dry_run      build and validate, post nothing, return the content

    Reasons, in gate order: "a run is already in flight", "not enabled",
    "no webhook configured", "already posted for this session",
    "leaders_fn failed: <Error>", "no leaders for this session",
    "below the floor: N names, floor is F", "refused by the validator: ...",
    "dry run", then the transport's "rate-limited", "http NNN",
    "http NNN after one retry", "send failed: <Error>", or "posted". A landed
    post whose marker could not be written keeps `posted: True`, sets
    `marked: False` and reads "posted; the session marker was not recorded"
    (plus ": <Error>" when an injected dedup raised).
    """
    session = str(session or "").strip()
    receipt = {"posted": False, "reason": "", "session": session, "chars": 0, "leaders": 0,
               "spy_change_pct": None, "attempts": 0, "marked": False, "dry_run": bool(dry_run)}
    if not _RUN_LOCK.acquire(blocking=False):
        receipt["reason"] = "a run is already in flight"
        return receipt
    try:
        return _post_locked(receipt, session, leaders_fn=leaders_fn, webhook_url=webhook_url,
                            send=send, dedup=dedup, sleep=sleep, evidence_fn=evidence_fn,
                            limits=limits, force=force, dry_run=dry_run)
    except Exception as e:  # noqa: BLE001 - an unattended poster never raises
        log.exception("[rs-post] unexpected failure")
        receipt["reason"] = f"failed: {type(e).__name__}"
        return receipt
    finally:
        _RUN_LOCK.release()


def _post_locked(receipt, session, *, leaders_fn, webhook_url, send, dedup, sleep,
                 evidence_fn, limits, force, dry_run) -> dict:
    if not session:
        receipt["reason"] = "no session"
        return receipt
    if not force and not enabled():
        receipt["reason"] = "not enabled"
        return receipt
    url = (configured_webhook() if webhook_url is None else str(webhook_url or "")).strip()
    if not url and not dry_run:
        receipt["reason"] = "no webhook configured"
        return receipt
    marker = dedup if dedup is not None else FileMarker()
    if not force and marker.posted(session):
        receipt["reason"] = "already posted for this session"
        return receipt
    try:
        raw, spy = split_leaders(leaders_fn(session))
        rows = normalise_leaders(raw)
    except Exception as e:  # noqa: BLE001
        log.warning("[rs-post] leaders_fn failed: %s", e)
        receipt["reason"] = f"leaders_fn failed: {type(e).__name__}"
        return receipt
    receipt["leaders"] = len(rows)
    receipt["spy_change_pct"] = spy
    if not rows:
        receipt["reason"] = "no leaders for this session"
        return receipt
    floor = int({**LIMITS, **(limits or {})}["floor"])
    if not force and len(rows) < floor:
        receipt["reason"] = f"below the floor: {len(rows)} names, floor is {floor}"
        return receipt
    evidence = None
    if evidence_fn is not None:
        try:
            evidence = evidence_fn(session)
        except Exception as e:  # noqa: BLE001
            log.warning("[rs-post] evidence_fn failed (%s); printing the honesty line", e)
    post = build_post(rows, session=session, evidence=evidence, limits=limits, spy_change_pct=spy)
    receipt["chars"] = len(post["content"])
    problems = validate_post(post)
    if problems:
        receipt["reason"] = "refused by the validator: " + "; ".join(problems)
        return receipt
    if dry_run:
        receipt["reason"] = "dry run"
        receipt["content"] = post["content"]
        return receipt
    landed, reason, attempts = _deliver(url, post, send, sleep)
    receipt["attempts"] = attempts
    receipt["reason"] = reason
    if landed:
        # The post is OUT before the marker is written, so `posted` is set first:
        # a marker that cannot be written must never read back as "nothing was
        # sent" (`FileMarker.mark` never raises; an injected `dedup` might).
        receipt["posted"] = True
        error = ""
        try:
            recorded = marker.mark(session)
        except Exception as e:  # noqa: BLE001
            log.warning("[rs-post] the post landed but the marker was not recorded: %s", e)
            recorded, error = False, type(e).__name__
        # Only an explicit False (or a raise) is "not recorded": a seam whose
        # mark() returns None, like the admin door's test-room `_NoMark`, keeps
        # reading as marked (review #32, 2026-11-07).
        receipt["marked"] = recorded is not False
        if not receipt["marked"]:
            receipt["reason"] = "posted; the session marker was not recorded" + (
                f": {error}" if error else "")
    return receipt
