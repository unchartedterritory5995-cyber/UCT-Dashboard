"""
Hallucination audit — Polish P7.

After a session ends, examine assistant turns for numeric claims (prices,
percentages, share counts) and check whether the cited values match what
the tools actually returned in the same session. Mismatches are written
to a new voice_hallucinations table and surfaced in telemetry.

This is NOT real-time — it's a forensic pass that runs after session end
so it can't add latency. The model never sees the audit; only the
human-facing telemetry does.

Detection strategy (deliberately conservative — only flags strong
mismatches; we never claim a turn is "hallucinated" without high evidence):

  1. Extract from each tool_call's result every (number, unit) tuple.
     E.g. {"close": 200.5, "change_pct": 2.3} → {(200.5, "$"), (2.3, "%")}
  2. Extract from each assistant turn every numeric mention.
     E.g. "NVDA at $200, up 2.3%" → {(200, "$"), (2.3, "%")}
  3. For each assistant number, check if a tool-result number within
     5% relative tolerance exists. If not, flag as a possible hallucination.

False-positive guard: we ALWAYS allow numbers that appear in the user's
own utterance (he asked about $200, model parroting it isn't hallucination)
and round-tripped values (regime confidences, percentages from regime).
"""

import json
import logging
import re
from typing import Any

from api.services.auth_db import get_connection

_log = logging.getLogger(__name__)

# Init schema lazily — we add the table here so this module is self-contained
_SCHEMA_INITED = False


def _ensure_schema() -> None:
    global _SCHEMA_INITED
    if _SCHEMA_INITED:
        return
    conn = get_connection()
    try:
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS voice_hallucinations (
                id              INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id         TEXT NOT NULL REFERENCES users(id),
                session_id      INTEGER REFERENCES voice_sessions(id) ON DELETE CASCADE,
                turn_text       TEXT NOT NULL,
                suspect_number  REAL NOT NULL,
                suspect_unit    TEXT,
                evidence        TEXT,
                confidence      REAL DEFAULT 0.5,
                created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
            CREATE INDEX IF NOT EXISTS idx_voice_hallucinations_user
                ON voice_hallucinations(user_id, created_at DESC);
        """)
        conn.commit()
    finally:
        conn.close()
    _SCHEMA_INITED = True


_NUM_RE = re.compile(
    r"(?<![A-Za-z])"
    r"\$?(\-?\d+(?:,\d{3})*(?:\.\d+)?)"
    r"\s*(%|\$|pts?|points?|cents?)?"
)


def _extract_numbers(text: str) -> list[tuple[float, str]]:
    """Pull every (number, unit) tuple from text. Unit normalized to '%'
    for percent, '$' for dollar, '' otherwise."""
    if not text:
        return []
    out: list[tuple[float, str]] = []
    for m in _NUM_RE.finditer(text or ""):
        raw = m.group(1).replace(",", "")
        try:
            n = float(raw)
        except ValueError:
            continue
        # Skip non-meaningful tiny / huge integers that are usually IDs
        if abs(n) > 1e9:
            continue
        unit = (m.group(2) or "").strip().lower()
        if unit in ("%",):
            unit = "%"
        elif unit in ("$",) or "$" in m.group(0):
            unit = "$"
        elif unit in ("pt", "pts", "point", "points"):
            unit = "pt"
        elif unit in ("cent", "cents"):
            unit = "¢"
        else:
            unit = ""
        out.append((n, unit))
    return out


def _extract_tool_numbers(tool_calls: list[dict]) -> set[tuple[float, str]]:
    """Recursively walk every tool_call result dict and pull leaf numbers
    plus their inferred unit from the key name."""
    out: set[tuple[float, str]] = set()

    def _walk(node: Any, key_hint: str = "") -> None:
        if isinstance(node, dict):
            for k, v in node.items():
                _walk(v, key_hint=k)
        elif isinstance(node, list):
            for item in node:
                _walk(item, key_hint=key_hint)
        elif isinstance(node, (int, float)):
            if abs(node) > 1e9:
                return
            unit = ""
            k_lower = (key_hint or "").lower()
            if "pct" in k_lower or "percent" in k_lower or "rate" in k_lower or "ratio" in k_lower:
                unit = "%"
                # Some pct fields are 0-1 fractions, others 0-100. Add both.
                out.add((float(node), unit))
                if 0 < node < 1:
                    out.add((float(node) * 100, unit))
                return
            if "price" in k_lower or "close" in k_lower or "open" in k_lower or \
               "high" in k_lower or "low" in k_lower or "target" in k_lower or \
               "stop" in k_lower or "entry" in k_lower or "balance" in k_lower or \
               "size" in k_lower or "risk" in k_lower or "nav" in k_lower:
                unit = "$"
            out.add((float(node), unit))

    for tc in tool_calls or []:
        result = tc.get("result") if isinstance(tc, dict) else None
        if result is None:
            # voice_tool_calls table stores args+ok but not the full result;
            # we only have the args. Walk args as a weaker signal.
            args = tc.get("args") if isinstance(tc, dict) else None
            _walk(args)
            continue
        _walk(result)
    return out


def _close_enough(claim: tuple[float, str], evidence: set[tuple[float, str]],
                   tol_pct: float = 0.05) -> bool:
    """True if any evidence number is within tol_pct of the claim, with
    matching or unspecified unit."""
    c_val, c_unit = claim
    for e_val, e_unit in evidence:
        # Allow unit mismatch only if either side is unspecified
        if c_unit and e_unit and c_unit != e_unit:
            continue
        if e_val == 0:
            if c_val == 0:
                return True
            continue
        if abs(c_val - e_val) / max(abs(e_val), 1e-9) <= tol_pct:
            return True
        # Also accept exact integer match (years, counts)
        if c_val == int(c_val) and e_val == int(e_val) and int(c_val) == int(e_val):
            return True
    return False


def audit_session(session_id: int, user_id: str) -> dict:
    """
    Audit one session. Returns {turns_examined, suspect_count, flagged}.
    Writes any flagged claims to voice_hallucinations.
    """
    _ensure_schema()

    conn = get_connection()
    try:
        transcripts = conn.execute(
            """SELECT role, text, timestamp FROM voice_transcripts
                WHERE session_id = ?
                ORDER BY timestamp ASC, id ASC""",
            (session_id,),
        ).fetchall()
        # result_json may not exist on older DBs — guard with try
        try:
            tool_rows = conn.execute(
                """SELECT tool_name, args_json, result_json, ok FROM voice_tool_calls
                    WHERE session_id = ?""",
                (session_id,),
            ).fetchall()
        except Exception:
            tool_rows = conn.execute(
                """SELECT tool_name, args_json, ok FROM voice_tool_calls
                    WHERE session_id = ?""",
                (session_id,),
            ).fetchall()
    finally:
        conn.close()

    if not transcripts:
        return {"turns_examined": 0, "suspect_count": 0, "flagged": []}

    # Build evidence pool: tool results (strong), tool args (weak), user
    # utterances (always allow-listed since the user said it themselves)
    tool_calls = []
    for r in tool_rows:
        try:
            args = json.loads(r["args_json"]) if r["args_json"] else None
        except (json.JSONDecodeError, TypeError):
            args = None
        result_data = None
        # result_json may not be available on older rows
        try:
            if "result_json" in r.keys() and r["result_json"]:
                result_data = json.loads(r["result_json"])
        except (json.JSONDecodeError, TypeError, IndexError):
            result_data = None
        tool_calls.append({"args": args, "result": result_data})
    tool_numbers = _extract_tool_numbers(tool_calls)

    user_numbers: set[tuple[float, str]] = set()
    for t in transcripts:
        if t["role"] == "user":
            for pair in _extract_numbers(t["text"]):
                user_numbers.add(pair)
    evidence = tool_numbers | user_numbers

    flagged: list[dict] = []
    turns_examined = 0
    for t in transcripts:
        if t["role"] != "assistant":
            continue
        turns_examined += 1
        for claim in _extract_numbers(t["text"]):
            # Skip integers ≤ 12 (almost always counts, days, or ranks)
            if claim[0] == int(claim[0]) and abs(claim[0]) <= 12:
                continue
            if _close_enough(claim, evidence):
                continue
            flagged.append({
                "turn_text": t["text"][:300],
                "suspect_number": claim[0],
                "suspect_unit": claim[1],
            })

    # Persist
    if flagged:
        conn = get_connection()
        try:
            for f in flagged:
                conn.execute(
                    """INSERT INTO voice_hallucinations
                          (user_id, session_id, turn_text, suspect_number,
                           suspect_unit, evidence, confidence)
                         VALUES (?, ?, ?, ?, ?, ?, ?)""",
                    (user_id, session_id, f["turn_text"], f["suspect_number"],
                     f["suspect_unit"], f"{len(evidence)} tool numbers checked",
                     0.6),
                )
            conn.commit()
        finally:
            conn.close()

    return {
        "turns_examined": turns_examined,
        "suspect_count": len(flagged),
        "flagged": flagged,
    }


def list_recent_flags(user_id: str, *, limit: int = 50) -> list[dict]:
    _ensure_schema()
    conn = get_connection()
    try:
        rows = conn.execute(
            """SELECT id, session_id, turn_text, suspect_number, suspect_unit,
                       evidence, confidence, created_at
                  FROM voice_hallucinations
                 WHERE user_id = ?
                 ORDER BY created_at DESC
                 LIMIT ?""",
            (user_id, max(1, min(200, int(limit)))),
        ).fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()
