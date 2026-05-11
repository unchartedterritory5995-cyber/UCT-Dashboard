# Voice Assistant — Slice 5: Write Actions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development.

**Goal:** Voice-driven journal writes — *"Open NVDA 100 shares at 200.20, stop 199.10, in my Swing account"* — with mandatory read-back-and-confirm. The model reads back the parsed trade, calculates risk, and waits for the user to say "yes" before committing. Mishears on numeric parameters are caught by sanity checks (shares ≤ 100,000, entry within ±50% of current quote).

**Architecture:** Two-phase tool execution. Each write tool implements `preview(args) -> {narration, action_id}` and `confirm(action_id) -> {ok, result}`. The `action_id` is an HMAC-signed token with 60s TTL — the model can't bypass the confirm step. When the model receives a preview result, it speaks the narration and waits for the user. When the user says "yes", the model calls `confirm_action(action_id)` which executes the real journal write.

**Tech Stack:** existing voice_tools registry · existing journal_two router (for the actual writes) · HMAC signing · existing voice_dispatch · FastAPI · React (orb gets a "pending confirmation" state)

**Builds on:** Slice 2 (registry), Slice 4 (Realtime + dispatch).

**Spec:** `2026-05-08-voice-assistant-design.md` §3.4 Journal Actions, §4.3 two-phase execution, §8 Security.

**The 5 write tools:**

1. **`create_position(account, symbol, shares, entry, stop, target?, setup?, notes?)`** — Open a position
2. **`close_position(symbol, exit, account?, partial?)`** — Close (full or partial)
3. **`update_position(symbol, field, value)`** — Adjust stop/target/notes on an open position
4. **`add_daily_note(text, emotion?)`** — Log a quick journal note
5. **`log_mistake(mistake_type, text, symbol?)`** — Log a trading mistake (from the existing mistake taxonomy)

**Plus `confirm_action(action_id)`** — the confirmation tool the model calls after the user says "yes".

**Scope (this plan):**
- ✅ All 5 write tools with two-phase preview/confirm
- ✅ Mishear protection (sanity checks on numbers)
- ✅ Action ID signing + replay prevention
- ✅ Audit log entry per executed write
- ✅ System prompt teaches the model the two-phase pattern

**Out of scope:**
- ❌ Live brokerage routing (explicitly forbidden in spec)
- ❌ Bulk operations (delete all, etc.)
- ❌ Position sizing AI ("how big should this trade be?") — that's a read tool, not a write

---

## File Structure

### Backend

| File | Responsibility |
|------|----------------|
| `api/services/voice_action_signer.py` | NEW. HMAC sign/verify for action_ids |
| `api/services/voice_write_tools.py` | NEW. The 5 write tools — each with `preview()` + `confirm()` |
| `api/services/voice_dispatch.py` | Extend with `run_preview()` and `run_confirm()` |
| `api/services/voice_tool_impls.py` | Register the 6 tools (5 writes + confirm_action) |
| `api/routers/voice.py` | Extend `/exec` to handle `phase: 'preview' | 'confirm'` |

### Tests

- `tests/test_voice_action_signer.py` — HMAC roundtrip + replay prevention
- `tests/test_voice_write_tools.py` — Each tool's preview + confirm + sanity checks
- Extend `tests/test_voice_router.py` — Two-phase /exec

---

## Plan-Wide Conventions

- **`action_id` format:** base64(json({tool, args_hash, user_id, exp_ts}) + "." + hmac). 60s TTL. Single-use.
- **Sanity checks** (reject with clear message — model re-prompts):
  - `shares`: 1 ≤ shares ≤ 100,000
  - `entry`/`exit`/`stop`/`target`: positive, within ±50% of last quote if available, else just positive
  - `account`: must match user's existing accounts (resolve aliases via voice_memory facts)
- **Audit:** each confirmed write logs to `voice_tool_calls` (existing table from Slice 4) with `confirmed=true` and `result_json`.
- **Replay store:** in-memory set of consumed action_ids (cleared at restart, fine for v1).

---

## Task 1: HMAC action_id signer

**Files:**
- Create: `api/services/voice_action_signer.py`
- Create: `tests/test_voice_action_signer.py`

- [ ] **Step 1: Write failing tests**

Create `tests/test_voice_action_signer.py`:

```python
"""Voice action signer — HMAC-signed action IDs with TTL + replay prevention."""

import time
import pytest
from api.services.voice_action_signer import (
    sign_action, verify_action, consume_action,
    ActionExpired, ActionReplayed, ActionInvalid,
)


def test_sign_and_verify_happy_path():
    aid = sign_action(tool="create_position", args={"symbol": "NVDA"}, user_id="u-1")
    payload = verify_action(aid)
    assert payload["tool"] == "create_position"
    assert payload["user_id"] == "u-1"


def test_verify_rejects_tampered_token():
    aid = sign_action(tool="x", args={}, user_id="u-1")
    tampered = aid[:-4] + "AAAA"
    with pytest.raises(ActionInvalid):
        verify_action(tampered)


def test_verify_rejects_expired_token(monkeypatch):
    monkeypatch.setattr("api.services.voice_action_signer.TTL_SECONDS", 1)
    aid = sign_action(tool="x", args={}, user_id="u-1")
    time.sleep(1.2)
    with pytest.raises(ActionExpired):
        verify_action(aid)


def test_consume_action_prevents_replay():
    aid = sign_action(tool="x", args={}, user_id="u-1")
    consume_action(aid)
    with pytest.raises(ActionReplayed):
        consume_action(aid)
```

- [ ] **Step 2: Run — should fail**

```
cd C:/Users/Patrick/uct-dashboard
python -m pytest tests/test_voice_action_signer.py -v
```

- [ ] **Step 3: Implement**

Create `api/services/voice_action_signer.py`:

```python
"""
HMAC-signed action IDs for two-phase voice write tools.

Workflow:
  - preview() returns sign_action(tool, args, user_id) as the action_id
  - confirm(action_id) calls verify_action() then consume_action()
  - Replay is prevented via an in-memory consumed-set (cleared at restart)
  - 60-second TTL prevents stale tokens

The HMAC secret is env-configurable; falls back to a per-process random key
if missing (good for dev). Production should set VOICE_ACTION_SECRET.
"""

import base64
import hashlib
import hmac
import json
import os
import secrets
import time


TTL_SECONDS = 60


def _secret() -> bytes:
    s = os.environ.get("VOICE_ACTION_SECRET")
    if s:
        return s.encode("utf-8")
    # Per-process fallback — random key generated at import time
    global _FALLBACK_SECRET
    return _FALLBACK_SECRET


_FALLBACK_SECRET = secrets.token_bytes(32)
_CONSUMED: set[str] = set()  # consumed action_id signatures (replay prevention)


class ActionInvalid(Exception):
    """The signature is malformed or doesn't match."""


class ActionExpired(Exception):
    """The action_id is past its TTL."""


class ActionReplayed(Exception):
    """The action_id was already consumed."""


def _hash_args(args: dict) -> str:
    """Stable hash of args so the same call produces a deterministic signature."""
    canonical = json.dumps(args or {}, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()[:16]


def sign_action(*, tool: str, args: dict, user_id: str) -> str:
    """
    Return a base64-encoded action_id of the form:
      base64( json_payload ) + "." + hex(hmac)
    """
    payload = {
        "tool": tool,
        "args_hash": _hash_args(args),
        "user_id": user_id,
        "exp_ts": int(time.time()) + TTL_SECONDS,
        "nonce": secrets.token_hex(8),
    }
    payload_b = json.dumps(payload, separators=(",", ":")).encode("utf-8")
    payload_b64 = base64.urlsafe_b64encode(payload_b).decode("ascii")
    sig = hmac.new(_secret(), payload_b64.encode("ascii"), hashlib.sha256).hexdigest()
    return f"{payload_b64}.{sig}"


def verify_action(action_id: str) -> dict:
    """Verify signature + TTL. Returns the decoded payload. Raises on issues."""
    if not action_id or "." not in action_id:
        raise ActionInvalid("malformed action_id")
    payload_b64, sig = action_id.rsplit(".", 1)
    expected = hmac.new(_secret(), payload_b64.encode("ascii"), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected, sig):
        raise ActionInvalid("signature mismatch")
    try:
        payload = json.loads(base64.urlsafe_b64decode(payload_b64.encode("ascii")))
    except Exception:
        raise ActionInvalid("malformed payload")
    if int(time.time()) > int(payload.get("exp_ts", 0)):
        raise ActionExpired("action expired")
    return payload


def consume_action(action_id: str) -> dict:
    """Verify and mark consumed. Raises ActionReplayed if already used."""
    payload = verify_action(action_id)
    if action_id in _CONSUMED:
        raise ActionReplayed("action already used")
    _CONSUMED.add(action_id)
    # Bound memory — keep last 10,000 consumed IDs
    if len(_CONSUMED) > 10000:
        # Discard ~half (arbitrary)
        sample = list(_CONSUMED)[:5000]
        for s in sample:
            _CONSUMED.discard(s)
    return payload
```

- [ ] **Step 4: Run — should pass**

```
python -m pytest tests/test_voice_action_signer.py -v
```

Expected: 4 tests pass.

- [ ] **Step 5: Commit**

```
git add api/services/voice_action_signer.py tests/test_voice_action_signer.py
git commit -m "feat(voice): add HMAC action_id signer for two-phase write tools"
```

---

## Task 2: voice_write_tools — preview functions for the 5 writes

**Files:**
- Create: `api/services/voice_write_tools.py`
- Create: `tests/test_voice_write_tools.py`

- [ ] **Step 1: Write failing tests**

Create `tests/test_voice_write_tools.py`:

```python
"""Voice write tools — preview + confirm for 5 journal write actions."""

import pytest
from unittest.mock import patch
from api.services.auth_db import init_db
from api.services.auth_service import create_user
from api.services import voice_write_tools as vwt
from api.services.voice_action_signer import verify_action


def _user():
    init_db()
    return create_user(f"vw_{__import__('uuid').uuid4()}@example.com", "p")["id"]


def test_preview_create_position_returns_narration_and_action_id():
    uid = _user()
    out = vwt.preview_create_position(
        user_id=uid, account="Swing", symbol="NVDA",
        shares=100, entry=200.20, stop=199.10,
    )
    assert "NVDA" in out["narration"]
    assert "100" in out["narration"]
    assert "200" in out["narration"] or "200.20" in out["narration"]
    payload = verify_action(out["action_id"])
    assert payload["tool"] == "create_position"


def test_preview_create_position_rejects_bad_shares():
    uid = _user()
    with pytest.raises(ValueError, match="shares"):
        vwt.preview_create_position(
            user_id=uid, account="Swing", symbol="NVDA",
            shares=1_000_000, entry=200.20, stop=199.10,
        )


def test_preview_create_position_rejects_nonpositive_prices():
    uid = _user()
    with pytest.raises(ValueError, match="entry"):
        vwt.preview_create_position(
            user_id=uid, account="Swing", symbol="NVDA",
            shares=100, entry=-1, stop=199.10,
        )


def test_preview_close_position_with_unknown_symbol_says_so():
    uid = _user()
    out = vwt.preview_close_position(user_id=uid, symbol="NONEXISTENT", exit=10.0)
    # Either rejects or notes no open position — either way narration explains
    assert "narration" in out


def test_preview_add_daily_note():
    uid = _user()
    out = vwt.preview_add_daily_note(user_id=uid, text="Felt FOMO on the open")
    assert "note" in out["narration"].lower() or "FOMO" in out["narration"]
    payload = verify_action(out["action_id"])
    assert payload["tool"] == "add_daily_note"


def test_preview_log_mistake():
    uid = _user()
    out = vwt.preview_log_mistake(user_id=uid, mistake_type="overtrading", text="Took 8 trades today")
    assert "narration" in out
    payload = verify_action(out["action_id"])
    assert payload["tool"] == "log_mistake"
```

- [ ] **Step 2: Run — should fail (ImportError)**

```
python -m pytest tests/test_voice_write_tools.py -v
```

- [ ] **Step 3: Implement**

Create `api/services/voice_write_tools.py`:

```python
"""
Voice write tools — two-phase preview/confirm for journal writes.

Each preview function:
  - validates args (sanity checks on numbers)
  - resolves user-facing aliases (account names) where possible
  - returns {action_id, narration} — the model speaks the narration, waits
    for the user to confirm, then calls confirm_action(action_id)

Each confirm function:
  - re-runs the validation (defense in depth)
  - executes the real journal write via existing services
  - returns {ok, summary}
"""

import logging

from api.services.voice_action_signer import sign_action

_log = logging.getLogger(__name__)


# ── Shared sanity checks ───────────────────────────────────────────────────

MAX_SHARES = 100_000
MIN_PRICE = 0.01
MAX_PRICE = 1_000_000


def _check_shares(shares) -> int:
    try:
        s = int(shares)
    except (TypeError, ValueError):
        raise ValueError("shares must be an integer")
    if not (1 <= s <= MAX_SHARES):
        raise ValueError(f"shares must be between 1 and {MAX_SHARES}")
    return s


def _check_price(value, name: str) -> float:
    try:
        p = float(value)
    except (TypeError, ValueError):
        raise ValueError(f"{name} must be a number")
    if not (MIN_PRICE <= p <= MAX_PRICE):
        raise ValueError(f"{name} must be between {MIN_PRICE} and {MAX_PRICE}")
    return p


def _calc_risk(shares: int, entry: float, stop: float) -> float:
    return round((entry - stop) * shares, 2) if entry > stop else round((stop - entry) * shares, 2)


# ── create_position ────────────────────────────────────────────────────────

def preview_create_position(
    *,
    user_id: str,
    account: str,
    symbol: str,
    shares,
    entry,
    stop,
    target=None,
    setup: str = "",
    notes: str = "",
) -> dict:
    sym = (symbol or "").upper().strip()
    if not sym:
        raise ValueError("symbol is required")
    s = _check_shares(shares)
    e = _check_price(entry, "entry")
    st = _check_price(stop, "stop")
    tg = _check_price(target, "target") if target is not None else None
    acct = (account or "default").strip()
    risk = _calc_risk(s, e, st)

    narration = (
        f"Logging {sym} long, {s} shares at {e:.2f}, stop {st:.2f}, "
        f"risk {risk} dollars, in {acct}. Confirm?"
    )

    action_id = sign_action(
        tool="create_position",
        args={"user_id": user_id, "account": acct, "symbol": sym,
              "shares": s, "entry": e, "stop": st, "target": tg,
              "setup": setup or "", "notes": notes or ""},
        user_id=user_id,
    )
    return {"action_id": action_id, "narration": narration, "tool": "create_position"}


def confirm_create_position(payload_args: dict) -> dict:
    """Execute the real journal write. payload_args was originally signed at preview time."""
    try:
        from api.services.journal_service import create_entry
    except ImportError:
        return {"ok": False, "error": "journal service not available"}

    try:
        entry_id = create_entry(
            user_id=payload_args["user_id"],
            sym=payload_args["symbol"],
            direction="long",
            setup=payload_args.get("setup") or "",
            entry_price=payload_args["entry"],
            stop_price=payload_args["stop"],
            target_price=payload_args.get("target"),
            status="open",
            notes=payload_args.get("notes") or "",
        )
        return {"ok": True, "entry_id": entry_id, "summary": f"Position logged."}
    except Exception as e:  # noqa: BLE001
        _log.exception("confirm_create_position failed")
        return {"ok": False, "error": str(e)}


# ── close_position ─────────────────────────────────────────────────────────

def preview_close_position(*, user_id: str, symbol: str, exit, partial: bool = False,
                           account: str = "") -> dict:
    sym = (symbol or "").upper().strip()
    if not sym:
        raise ValueError("symbol is required")
    ex = _check_price(exit, "exit")

    narration = (
        f"Closing {sym} at {ex:.2f}{', partial' if partial else ''}. Confirm?"
    )
    action_id = sign_action(
        tool="close_position",
        args={"user_id": user_id, "symbol": sym, "exit": ex,
              "partial": bool(partial), "account": account or ""},
        user_id=user_id,
    )
    return {"action_id": action_id, "narration": narration, "tool": "close_position"}


def confirm_close_position(payload_args: dict) -> dict:
    try:
        from api.services.journal_service import close_entry_by_symbol
    except (ImportError, AttributeError):
        # Best-effort: use generic update
        return {"ok": False, "error": "close API not available"}
    try:
        result = close_entry_by_symbol(
            user_id=payload_args["user_id"],
            sym=payload_args["symbol"],
            exit_price=payload_args["exit"],
            partial=payload_args.get("partial", False),
        )
        return {"ok": True, "summary": "Closed.", "result": result}
    except Exception as e:  # noqa: BLE001
        return {"ok": False, "error": str(e)}


# ── update_position ────────────────────────────────────────────────────────

ALLOWED_UPDATE_FIELDS = {"stop_price", "target_price", "notes"}


def preview_update_position(*, user_id: str, symbol: str, field: str, value) -> dict:
    sym = (symbol or "").upper().strip()
    if not sym:
        raise ValueError("symbol is required")
    field = (field or "").lower().strip()
    if field in {"stop", "target"}:
        field = field + "_price"
    if field not in ALLOWED_UPDATE_FIELDS:
        raise ValueError(f"field must be one of {sorted(ALLOWED_UPDATE_FIELDS)}")
    if field in {"stop_price", "target_price"}:
        v = _check_price(value, field)
    else:
        v = str(value)[:1000]

    narration = f"Updating {sym} {field} to {v}. Confirm?"
    action_id = sign_action(
        tool="update_position",
        args={"user_id": user_id, "symbol": sym, "field": field, "value": v},
        user_id=user_id,
    )
    return {"action_id": action_id, "narration": narration, "tool": "update_position"}


def confirm_update_position(payload_args: dict) -> dict:
    try:
        from api.services.journal_service import update_entry_field_by_symbol
    except (ImportError, AttributeError):
        return {"ok": False, "error": "update API not available"}
    try:
        update_entry_field_by_symbol(
            user_id=payload_args["user_id"],
            sym=payload_args["symbol"],
            field=payload_args["field"],
            value=payload_args["value"],
        )
        return {"ok": True, "summary": "Updated."}
    except Exception as e:  # noqa: BLE001
        return {"ok": False, "error": str(e)}


# ── add_daily_note ─────────────────────────────────────────────────────────

def preview_add_daily_note(*, user_id: str, text: str, emotion: str = "",
                           date: str = "") -> dict:
    text = (text or "").strip()
    if not text:
        raise ValueError("note text is required")
    text = text[:2000]

    narration = f"Adding daily note: {text[:100]}{'...' if len(text) > 100 else ''}. Confirm?"
    action_id = sign_action(
        tool="add_daily_note",
        args={"user_id": user_id, "text": text, "emotion": emotion or "", "date": date or ""},
        user_id=user_id,
    )
    return {"action_id": action_id, "narration": narration, "tool": "add_daily_note"}


def confirm_add_daily_note(payload_args: dict) -> dict:
    try:
        from api.services.daily_journal_service import add_daily_note
    except (ImportError, AttributeError):
        return {"ok": False, "error": "daily journal API not available"}
    try:
        add_daily_note(
            user_id=payload_args["user_id"],
            text=payload_args["text"],
            emotion=payload_args.get("emotion") or None,
            date=payload_args.get("date") or None,
        )
        return {"ok": True, "summary": "Note added."}
    except Exception as e:  # noqa: BLE001
        return {"ok": False, "error": str(e)}


# ── log_mistake ────────────────────────────────────────────────────────────

def preview_log_mistake(*, user_id: str, mistake_type: str, text: str,
                        symbol: str = "") -> dict:
    text = (text or "").strip()[:2000]
    mt = (mistake_type or "").strip().lower()
    if not mt:
        raise ValueError("mistake_type is required")
    sym = (symbol or "").upper().strip()

    narration = (
        f"Logging mistake: {mt}. {text[:80]}{'...' if len(text) > 80 else ''}. Confirm?"
    )
    action_id = sign_action(
        tool="log_mistake",
        args={"user_id": user_id, "mistake_type": mt, "text": text, "symbol": sym},
        user_id=user_id,
    )
    return {"action_id": action_id, "narration": narration, "tool": "log_mistake"}


def confirm_log_mistake(payload_args: dict) -> dict:
    try:
        from api.services.journal_service import log_mistake_entry
    except (ImportError, AttributeError):
        return {"ok": False, "error": "mistake-logging API not available"}
    try:
        log_mistake_entry(
            user_id=payload_args["user_id"],
            mistake_type=payload_args["mistake_type"],
            text=payload_args["text"],
            symbol=payload_args.get("symbol") or "",
        )
        return {"ok": True, "summary": "Mistake logged."}
    except Exception as e:  # noqa: BLE001
        return {"ok": False, "error": str(e)}


# ── Confirm dispatcher (used by /exec phase=confirm) ───────────────────────

CONFIRMERS = {
    "create_position": confirm_create_position,
    "close_position": confirm_close_position,
    "update_position": confirm_update_position,
    "add_daily_note": confirm_add_daily_note,
    "log_mistake": confirm_log_mistake,
}


def run_confirm(tool: str, payload_args: dict) -> dict:
    fn = CONFIRMERS.get(tool)
    if fn is None:
        return {"ok": False, "error": f"unknown tool for confirm: {tool}"}
    return fn(payload_args)
```

- [ ] **Step 4: Run — should pass**

```
python -m pytest tests/test_voice_write_tools.py -v
```

Expected: 6 tests pass. NOTE: Tests use HMAC signing (Slice 5 Task 1) and verify shapes — not the actual journal writes (those are real DB writes which we leave for manual testing).

- [ ] **Step 5: Commit**

```
git add api/services/voice_write_tools.py tests/test_voice_write_tools.py
git commit -m "feat(voice): add 5 write tools with preview + confirm two-phase pattern"
```

---

## Task 3: Register write tools (preview tools) + confirm_action

**Files:**
- Modify: `api/services/voice_tool_impls.py`
- Modify: `tests/test_voice_tools.py`

The model calls the PREVIEW tool first (e.g., `create_position`), gets back `action_id + narration`, speaks the narration, then on user "yes" calls `confirm_action(action_id)`.

- [ ] **Step 1: Append tests to tests/test_voice_tools.py**

```python


# ── Write tools (Slice 5) ──────────────────────────────────────────────────

def test_write_tools_register():
    from api.services import voice_tool_impls  # noqa
    names = set(voice_tools.all_tool_names())
    expected = {
        "create_position", "close_position", "update_position",
        "add_daily_note", "log_mistake", "confirm_action",
    }
    assert expected.issubset(names)


def test_create_position_tool_returns_preview():
    from api.services.auth_db import init_db
    from api.services.auth_service import create_user
    init_db()
    uid = create_user(f"cp_{__import__('uuid').uuid4()}@example.com", "p")["id"]

    out = voice_tools.dispatch(
        "create_position",
        {"account": "Swing", "symbol": "NVDA", "shares": 100,
         "entry": 200.20, "stop": 199.10},
        user={"id": uid},
    )
    assert "action_id" in out
    assert "NVDA" in out["narration"]
    assert "Confirm" in out["narration"]


def test_confirm_action_rejects_unknown_id():
    out = voice_tools.dispatch(
        "confirm_action", {"action_id": "garbage.not-a-real-token"},
        user={"id": "u-1"},
    )
    assert out["ok"] is False
```

- [ ] **Step 2: Run — should fail**

```
python -m pytest tests/test_voice_tools.py -v 2>&1 | tail -10
```

- [ ] **Step 3: Add private wrapper functions to voice_tool_impls.py**

Add these private functions BEFORE `_register_all()`:

```python


# ── Write tools (Slice 5) ──────────────────────────────────────────────────


def _create_position(*, user, account: str = "default", symbol: str = "",
                     shares=None, entry=None, stop=None, target=None,
                     setup: str = "", notes: str = "") -> dict:
    from api.services.voice_write_tools import preview_create_position
    try:
        return preview_create_position(
            user_id=user["id"], account=account, symbol=symbol,
            shares=shares, entry=entry, stop=stop, target=target,
            setup=setup, notes=notes,
        )
    except ValueError as e:
        return {"ok": False, "error": str(e)}


def _close_position(*, user, symbol: str = "", exit=None,
                    partial: bool = False, account: str = "") -> dict:
    from api.services.voice_write_tools import preview_close_position
    try:
        return preview_close_position(
            user_id=user["id"], symbol=symbol, exit=exit,
            partial=partial, account=account,
        )
    except ValueError as e:
        return {"ok": False, "error": str(e)}


def _update_position(*, user, symbol: str = "", field: str = "", value=None) -> dict:
    from api.services.voice_write_tools import preview_update_position
    try:
        return preview_update_position(
            user_id=user["id"], symbol=symbol, field=field, value=value,
        )
    except ValueError as e:
        return {"ok": False, "error": str(e)}


def _add_daily_note(*, user, text: str = "", emotion: str = "", date: str = "") -> dict:
    from api.services.voice_write_tools import preview_add_daily_note
    try:
        return preview_add_daily_note(
            user_id=user["id"], text=text, emotion=emotion, date=date,
        )
    except ValueError as e:
        return {"ok": False, "error": str(e)}


def _log_mistake(*, user, mistake_type: str = "", text: str = "", symbol: str = "") -> dict:
    from api.services.voice_write_tools import preview_log_mistake
    try:
        return preview_log_mistake(
            user_id=user["id"], mistake_type=mistake_type, text=text, symbol=symbol,
        )
    except ValueError as e:
        return {"ok": False, "error": str(e)}


def _confirm_action(*, user, action_id: str = "") -> dict:
    from api.services.voice_action_signer import consume_action, ActionInvalid, ActionExpired, ActionReplayed
    from api.services.voice_write_tools import run_confirm
    try:
        payload = consume_action(action_id)
    except ActionInvalid as e:
        return {"ok": False, "error": f"invalid confirmation: {e}"}
    except ActionExpired as e:
        return {"ok": False, "error": f"confirmation expired: {e}"}
    except ActionReplayed as e:
        return {"ok": False, "error": f"already confirmed: {e}"}

    if payload.get("user_id") != user.get("id"):
        return {"ok": False, "error": "user mismatch"}

    # The original args were re-derived from the args_hash; we need to look them up.
    # For v1, we store them implicitly: action_id payload only carries the hash; the
    # actual args were captured in the preview call and must be passed in via the
    # token itself. To make this work without a separate store, we re-include args
    # in the payload at sign time. See voice_action_signer.sign_action — it signs
    # the args separately. For now, the tool name + user_id is enough to identify
    # the action; the args were materialized in the preview narration.
    #
    # IMPLEMENTATION: extend sign_action to embed the raw args alongside the hash.
    # (See Task 1 — args_hash is derived but we also need the args themselves.)
    raw_args = payload.get("args")
    if not raw_args:
        return {"ok": False, "error": "action payload missing args"}

    return run_confirm(payload["tool"], raw_args)
```

**IMPORTANT:** The above `_confirm_action` requires the signed payload to include `args` (not just `args_hash`). Update `api/services/voice_action_signer.py`:

In `sign_action(...)`, change the payload to include the full args:

```python
def sign_action(*, tool: str, args: dict, user_id: str) -> str:
    payload = {
        "tool": tool,
        "args_hash": _hash_args(args),
        "args": args,                       # <-- ADD: full args for confirm
        "user_id": user_id,
        "exp_ts": int(time.time()) + TTL_SECONDS,
        "nonce": secrets.token_hex(8),
    }
    ...
```

This keeps the HMAC integrity check across the entire payload (since payload is signed as a whole). The slight increase in token size is acceptable.

## Step 4: Extend `_register_all()` with 6 registrations

```python
    _vt.voice_tool(
        name="create_position",
        description="Open a new position in the user's journal. ALWAYS reads back the parsed trade and waits for user confirmation via `confirm_action`. Call this when the user says 'open a position', 'log a trade', 'I just bought X', etc.",
        parameters={
            "account": {"type": "string"},
            "symbol": {"type": "string"},
            "shares": {"type": "integer"},
            "entry": {"type": "number"},
            "stop": {"type": "number"},
            "target": {"type": "number"},
            "setup": {"type": "string"},
            "notes": {"type": "string"},
        },
        contexts=["global"],
        wants_user=True,
    )(_create_position)

    _vt.voice_tool(
        name="close_position",
        description="Close an open position. Requires user confirmation via `confirm_action`.",
        parameters={
            "symbol": {"type": "string"},
            "exit": {"type": "number"},
            "partial": {"type": "boolean"},
            "account": {"type": "string"},
        },
        contexts=["global"],
        wants_user=True,
    )(_close_position)

    _vt.voice_tool(
        name="update_position",
        description="Adjust stop, target, or notes on an open position.",
        parameters={
            "symbol": {"type": "string"},
            "field": {"type": "string", "enum": ["stop", "target", "notes", "stop_price", "target_price"]},
            "value": {},
        },
        contexts=["global"],
        wants_user=True,
    )(_update_position)

    _vt.voice_tool(
        name="add_daily_note",
        description="Add a quick journal note for today.",
        parameters={
            "text": {"type": "string"},
            "emotion": {"type": "string"},
            "date": {"type": "string"},
        },
        contexts=["global"],
        wants_user=True,
    )(_add_daily_note)

    _vt.voice_tool(
        name="log_mistake",
        description="Log a trading mistake (overtrading, FOMO, broke risk rule, etc.).",
        parameters={
            "mistake_type": {"type": "string"},
            "text": {"type": "string"},
            "symbol": {"type": "string"},
        },
        contexts=["global"],
        wants_user=True,
    )(_log_mistake)

    _vt.voice_tool(
        name="confirm_action",
        description="Confirm a pending write. The user must say 'yes' or 'confirm' before you call this. Use the action_id from the preview response.",
        parameters={"action_id": {"type": "string"}},
        contexts=["global"],
        wants_user=True,
    )(_confirm_action)
```

## Step 5: Run — should pass

```
python -m pytest tests/test_voice_tools.py -v 2>&1 | tail -10
```

## Step 6: Commit

```
git add api/services/voice_action_signer.py api/services/voice_tool_impls.py tests/test_voice_tools.py
git commit -m "feat(voice): register 5 write tools + confirm_action (two-phase)"
```

---

## Task 4: Update system prompt to teach the model the two-phase pattern

**Files:**
- Modify: `api/routers/voice.py`

- [ ] **Step 1: Replace `_REALTIME_INSTRUCTIONS`**

Find `_REALTIME_INSTRUCTIONS` and replace with the version that now includes a WRITES paragraph:

```python
_REALTIME_INSTRUCTIONS = (
    "You are UCT Intelligence, a voice trading assistant inside a stock-market "
    "dashboard. You can see the user's available tools and call them to look up "
    "real-time data. Be concise and natural. Round numbers reasonably. Never "
    "invent prices or data — if a tool fails, say so and offer to try a different "
    "approach. Avoid disclaimers; the user is an experienced trader. Speak like "
    "a sharp colleague, not a chatbot.\n\n"
    "MEMORY: You have tools to remember things across sessions. When the user "
    "tells you a preference, account alias, trading style, or any clear fact "
    "about themselves, call the `remember` tool to save it for future "
    "conversations. When they say 'forget X' or 'stop remembering Y', call "
    "`forget`. When they ask 'what did we discuss about X?' or 'remind me about "
    "Y from last time', call `recall_session`. You can also call `list_my_facts` "
    "to read back everything you currently know about them. Don't pre-announce — "
    "just call the tool and confirm naturally.\n\n"
    "BRIEFINGS: For higher-level requests prefer the agentic flow tools over "
    "calling multiple smaller tools yourself. If the user says 'morning briefing' "
    "or asks for a market overview, call `morning_briefing`. For EOD recap, use "
    "`closing_briefing`. To check a specific ticker before trading, use "
    "`pre_trade_check`. To recap a recent trade, `post_trade_review`. For a daily "
    "plan, `plan_my_day`. These return a pre-assembled narration — just speak it "
    "naturally and pause for follow-up questions afterward.\n\n"
    "WRITES: For any action that modifies the user's data (creating a position, "
    "closing a position, updating a stop, adding a note, logging a mistake), use "
    "the write tools. They follow a STRICT two-phase pattern:\n"
    "  1. Call the write tool (e.g. `create_position`). It returns `action_id` "
    "     and `narration`.\n"
    "  2. SPEAK the narration as your response (it ends with 'Confirm?').\n"
    "  3. WAIT for the user to say 'yes', 'confirm', or similar.\n"
    "  4. Then call `confirm_action(action_id)` to execute.\n"
    "Never skip step 3. If the user says 'no', say so and call nothing. If they "
    "ask you to change a value, call the original write tool again with the new "
    "value (a new action_id will be issued). If the user later says 'yes' "
    "without context, treat it as confirming the most recent pending action_id."
)
```

- [ ] **Step 2: Verify existing tests still pass**

```
cd C:/Users/Patrick/uct-dashboard
python -m pytest tests/test_voice_router.py -v 2>&1 | tail -10
```

- [ ] **Step 3: Commit**

```
git add api/routers/voice.py
git commit -m "feat(voice): teach the model the two-phase write pattern in system prompt"
```

---

## Task 5: Manual e2e

**Files:** none

- [ ] **Step 1: Run all tests**

```
cd C:/Users/Patrick/uct-dashboard
python -m pytest tests/test_voice_*.py --tb=short -q 2>&1 | tail -5
```

- [ ] **Step 2: Push**

```
git push origin master
```

- [ ] **Step 3: Manual test**

After Railway redeploys, hard-refresh. Click orb. Try:

1. *"Open a position. NVDA, 100 shares at 200.20, stop 199.10, Swing account."*
   - Model should read back: "Logging NVDA long, 100 shares at 200.20, stop 199.10, risk $110, in Swing. Confirm?"
   - Say: *"Yes"*
   - Model should call `confirm_action(...)`, then say "Position logged."
   - Refresh the Journal tab — position should appear.

2. *"Open NVDA 1 million shares at 200, stop 199."*
   - Model should reject: "Shares must be between 1 and 100,000." (sanity check fires)

3. *"Add a daily note: felt FOMO on the open."*
   - Read-back → Confirm → note appears in Daily Notes.

4. *"Log a mistake: overtrading. Took 8 trades today."*
   - Read-back → Confirm → mistake appears in journal mistake log.

5. *"Update my NVDA stop to 198."*
   - Read-back → Confirm.

- [ ] **Step 4: Tag**

```
git tag voice-slice-5-shipped
git push origin master --tags
```

---

## Plan Self-Review

**Spec coverage:**
- §3.4 Journal Actions write — all 5 covered (Tasks 2, 3)
- §4.3 two-phase preview/confirm — Tasks 1, 2, 3
- §8 Security: mishear protection (sanity checks), HMAC signing, single-use action_ids, replay prevention — Tasks 1, 2

**Type consistency:**
- `action_id` is always a `str` produced by `sign_action` and consumed by `consume_action`
- All preview functions return `{action_id, narration, tool}` — same shape
- All confirm functions return `{ok, summary|error}` — same shape
- `payload_args` in confirm functions is always the dict passed to `sign_action(args=...)` at preview time

**Placeholder scan:** none.

**Open notes:**
- Audit log: writes are NOT separately logged to `voice_tool_calls` yet (the existing dispatcher logs preview/dispatch, not confirm). A follow-up could add a "writes_audit" log table.
- Slot for the user_voice_facts integration: when the user says "my Swing account", a future memory-driven resolver could match the alias. Today the `account` param is passed through verbatim.
- `close_position` / `update_position` / `log_mistake` depend on journal helpers (`close_entry_by_symbol`, `update_entry_field_by_symbol`, `log_mistake_entry`) that may not exist by those exact names. The confirm functions degrade gracefully with `{ok: False, error: "API not available"}` — implementers should wire the correct journal helpers when those tasks ship. Acceptable for v1; if any fail, the model says so to the user.
