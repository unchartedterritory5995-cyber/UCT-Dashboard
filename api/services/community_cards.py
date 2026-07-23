# api/services/community_cards.py
"""Server-authoritative builder for chat rich-card payloads (`messages.card_json`).

SECURITY (a P0 from the hardening review): the client POSTs a REFERENCE only — never
the card body. The server constructs every field here so that:
  • a trade card is rebuilt from the sharer's OWN j2_trades row through the redaction
    omit-list — `shares`/`pnlDollar`/`pnlDollarNet` can NEVER reach the permanent
    broadcast, even from a crafted request;
  • chart/flow cards are whitelisted to known scalar keys;
  • every URL is forced same-origin-relative (no external/`javascript:` deep links).

Returns a JSON-serializable dict, or raises ValueError (→ 400 in the router).
"""
import re

_SNAPSHOT_RE = re.compile(r"^/api/community/images/[^/]+/[a-f0-9]{32}\.webp$")
_TF_OK = {"1", "5", "15", "30", "60", "D", "W", "M"}


def _ticker(v):
    t = str(v or "").upper().strip()[:8]
    if not re.match(r"^[A-Z0-9.\-]{1,8}$", t):
        raise ValueError("bad-ticker")
    return t


def _rel_url(v):
    """Accept only a same-origin, absolute-path URL (a single leading '/'). Rejects
    protocol-relative ('//host'), backslashes, control chars, and javascript: schemes."""
    s = str(v or "")
    if not s.startswith("/") or s.startswith("//"):
        raise ValueError("off-origin-url")
    if "\\" in s or "javascript:" in s.lower() or any(ord(c) < 0x20 for c in s):
        raise ValueError("off-origin-url")
    return s[:2000]


def _num(v):
    try:
        return round(float(v), 4)
    except (TypeError, ValueError):
        return None


def _str(v, n=64):
    return (str(v)[:n]) if v is not None else None


def _clean_text(v, n):
    """Multi-line free text for an AI card: drop control chars (keep newlines),
    trim, truncate. Unlike other cards the content is the user's OWN visible
    answer text (no server-side redaction to enforce), just sanitized + bounded."""
    s = "".join(c for c in str(v or "") if c == "\n" or ord(c) >= 0x20).strip()
    return s[:n] if s else None


def build_card(kind: str, ref: dict, *, user_id: str, load_trade) -> dict:
    """Build a card_json dict from a client reference.

    `load_trade(user_id, trade_id)` is injected (journal_two.trades.get_trade_detail)
    so this module stays free of a hard j2 import.
    """
    ref = ref or {}
    if kind == "trade":
        trade_id = ref.get("tradeId")
        if not trade_id:
            raise ValueError("tradeId required")
        t = load_trade(user_id, str(trade_id))
        if not t:
            raise ValueError("trade not found")
        # WHITELIST — scale-independent fields only. Absolute-size / dollar fields
        # (shares, pnlDollar, pnlDollarNet, originalShares) are NEVER copied.
        return {
            "kind": "trade",
            "tradeRef": _str(t.get("tradeRef") or t.get("id"), 64),
            "symbol": _ticker(t.get("symbol")),
            "side": _str(t.get("side"), 8),
            "result": _str(t.get("result"), 8),
            "setup": _str(t.get("setup"), 48),
            "rMultiple": _num(t.get("rMultiple")),
            "pnlPercent": _num(t.get("pnlPercent")),
            "entryPrice": _num(t.get("entryPrice")),
            "exitPrice": _num(t.get("exitPrice")),
            "entryDate": _str(t.get("entryDate"), 32),
            "exitDate": _str(t.get("exitDate"), 32),
            "holdDays": _num(t.get("holdDays")),
        }

    if kind == "chart":
        tf = str(ref.get("tf") or "D")
        if tf not in _TF_OK:
            tf = "D"
        card = {
            "kind": "chart",
            "ticker": _ticker(ref.get("ticker")),
            "tf": tf,
            "postPrice": _num(ref.get("postPrice")),
        }
        if ref.get("stateUrl"):
            card["stateUrl"] = _rel_url(ref["stateUrl"])
        if ref.get("snapshotUrl"):
            s = str(ref["snapshotUrl"])
            if not _SNAPSHOT_RE.match(s):
                raise ValueError("bad-snapshot-url")
            card["snapshotUrl"] = s
        w, h = _num(ref.get("w")), _num(ref.get("h"))
        if w and h:
            card["w"], card["h"] = int(w), int(h)
        return card

    if kind == "flow":
        cp = str(ref.get("cp") or "").upper()[:1]
        if cp not in ("C", "P"):
            cp = ""
        return {
            "kind": "flow",
            "ticker": _ticker(ref.get("ticker")),
            "cp": cp,
            "strike": _num(ref.get("strike")),
            "exp": _str(ref.get("exp"), 16),
            "premium": _num(ref.get("premium")),
            "grade": _str(ref.get("grade"), 4),
            "dir": _str(ref.get("dir"), 8),
            "postPrice": _num(ref.get("postPrice")),
        }

    if kind == "idea":
        side = str(ref.get("side") or "").upper()
        if side not in ("LONG", "SHORT"):
            raise ValueError("idea side must be long|short")
        entry, stop, target = _num(ref.get("entry")), _num(ref.get("stop")), _num(ref.get("target"))
        if not all(v is not None and v > 0 for v in (entry, stop, target)):
            raise ValueError("idea needs entry/stop/target prices")
        risk = abs(entry - stop)
        rr = round(abs(target - entry) / risk, 2) if risk > 0 else None
        return {
            "kind": "idea",
            "ticker": _ticker(ref.get("ticker")),
            "side": side,
            "entry": entry, "stop": stop, "target": target,
            "rr": rr,
            "note": _str(ref.get("note"), 160),
        }

    if kind == "poll":
        question = _str(ref.get("question"), 200)
        if not question:
            raise ValueError("poll needs a question")
        opts = ref.get("options") or []
        if not isinstance(opts, list) or not (2 <= len(opts) <= 5):
            raise ValueError("poll needs 2-5 options")
        return {
            "kind": "poll",
            "question": question,
            "options": [{"key": f"o{i}", "label": _str(o, 60) or f"Option {i + 1}"}
                        for i, o in enumerate(opts[:5])],
        }

    if kind == "ai":
        # Share an AI Search answer to the floor. The client sends the question +
        # a plain-text answer teaser it already displayed; server sanitizes + caps.
        # SECURITY: a personal AI answer (position/P&L grounded) must never become
        # a community card, regardless of what the client sends — refuse it the
        # same way every other malformed/disallowed input in this function is
        # refused (raise ValueError -> 400 in the router), never a silent pass-through.
        if ref.get("personal"):
            raise ValueError("personal AI answers cannot be shared to community")
        q = _clean_text(ref.get("q"), 200)
        a = _clean_text(ref.get("a"), 900)
        if not (q and a):
            raise ValueError("ai card needs q + a")
        card = {"kind": "ai", "q": q, "a": a}
        raw = ref.get("tickers")
        if isinstance(raw, list):
            syms = []
            for t in raw[:6]:
                try:
                    syms.append(_ticker(t))
                except ValueError:
                    pass
            if syms:
                card["tickers"] = syms
        return card

    raise ValueError("unknown card kind")
