# Compass Onboarding Interview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a Compass-led, adaptive onboarding interview that establishes a deep Trader Profile + initial discipline settings + raw Q&A archive for every new Compass account.

**Architecture:** Onboarding IS a chat conversation. Reuses 100% of the Compass Chat panel + streaming pipeline. New `onboarding_mode` flag on `j2_accounts` swaps in a Section 8 prompt directive that turns Compass from "answer questions" into "lead an interview." Four new tools (`get_onboarding_progress`, `record_onboarding_answer`, `propose_account_settings`, `complete_onboarding`). Three new entry-point endpoints. Frontend `CompassChat.jsx` morphs its empty state + header + overflow menu based on flag state.

**Tech Stack:** Python 3.12, FastAPI, SQLite, `anthropic>=0.40.0`, React + Vite + SWR, vitest + pytest.

**Spec:** `docs/superpowers/specs/2026-05-12-compass-onboarding-design.md`

---

## File Map

| Path | Action | Role |
|---|---|---|
| `api/services/journal_two/db.py` | Modify | 3 new j2_accounts columns + new `j2_onboarding_responses` table |
| `api/services/journal_two/coach_chat_tools.py` | Modify | 4 new tools (`get_onboarding_progress`, `record_onboarding_answer`, `propose_account_settings`, `complete_onboarding`) |
| `api/services/journal_two/test_coach_chat_tools.py` | Modify | New tests for the 4 tools |
| `api/services/journal_two/coach_prompts.py` | Modify | Export `COMPASS_ONBOARDING_DIRECTIVE` (Section 8 string) |
| `api/services/journal_two/coach_chat.py` | Modify | `handle_user_turn` appends Section 8 when `onboarding_mode=1`. Add `start_onboarding`, `skip_onboarding`, `redo_onboarding` entry functions |
| `api/services/journal_two/test_coach_chat.py` | Modify | Tests for the 3 entry functions + Section 8 wiring |
| `api/routers/journal_two.py` | Modify | 3 new endpoints: `/coach/chat/start_onboarding`, `/skip_onboarding`, `/redo_onboarding` |
| `app/src/pages/journal-2-0/hooks/useJ2CoachChat.js` | Modify | Add `startOnboarding`, `skipOnboarding`, `redoOnboarding` actions; derive `isOnboarding` |
| `app/src/pages/journal-2-0/components/CompassChat.jsx` | Modify | Empty-state CTA, header morph, overflow menu items, sentinel message hiding |
| `app/src/pages/journal-2-0/components/CompassChat.test.jsx` | Modify | New vitest cases for onboarding UI |

---

## Task 1: DB migration — onboarding columns + responses table

**Files:**
- Modify: `api/services/journal_two/db.py`

- [ ] **Step 1: Locate migration arrays**

`db.py` has `_J2_SCHEMA` (multi-statement string for new tables) and `_PHASE_2_ALTERS` (list of strings for column additions). New tables go in the schema string; new columns go in the alters list.

- [ ] **Step 2: Add new table to `_J2_SCHEMA`**

Append to `_J2_SCHEMA` (before the closing `"""`):

```sql

CREATE TABLE IF NOT EXISTS j2_onboarding_responses (
    id          TEXT PRIMARY KEY,
    user_id     TEXT NOT NULL,
    account_id  TEXT NOT NULL,
    session_id  TEXT NOT NULL,
    category    TEXT NOT NULL,
    question    TEXT NOT NULL,
    answer      TEXT NOT NULL,
    asked_at    TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_j2_onboarding_session
    ON j2_onboarding_responses(account_id, session_id, asked_at);
```

- [ ] **Step 3: Add 3 new column ALTERs**

Append to `_PHASE_2_ALTERS` (after the most recent entry):

```python
    # Compass Onboarding (Phase G v4) — interview state + session id
    "ALTER TABLE j2_accounts ADD COLUMN onboarded INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE j2_accounts ADD COLUMN onboarding_mode INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE j2_accounts ADD COLUMN onboarding_session_id TEXT",
```

- [ ] **Step 4: Smoke**

```bash
cd C:/Users/Patrick/uct-dashboard
python -c "
import tempfile, sqlite3, os, importlib
tmp = tempfile.NamedTemporaryFile(suffix='.db', delete=False); tmp.close()
os.environ['AUTH_DB_PATH'] = tmp.name
from api.services import auth_db; importlib.reload(auth_db); auth_db.init_db()
conn = sqlite3.connect(tmp.name); conn.row_factory = sqlite3.Row
cols = [r[1] for r in conn.execute('PRAGMA table_info(j2_accounts)').fetchall()]
print('onboarded:', 'onboarded' in cols)
print('onboarding_mode:', 'onboarding_mode' in cols)
print('onboarding_session_id:', 'onboarding_session_id' in cols)
print('table:', conn.execute(\"SELECT name FROM sqlite_master WHERE type='table' AND name='j2_onboarding_responses'\").fetchone()[0])
conn.close(); os.unlink(tmp.name)
"
```

Expected output: 4 lines all True / "j2_onboarding_responses".

- [ ] **Step 5: Full j2 suite — no regressions**

```bash
python -m pytest api/services/journal_two/ -q
```

Expected: baseline count holds (~411 passing).

- [ ] **Step 6: Commit**

```bash
git -C C:/Users/Patrick/uct-dashboard add api/services/journal_two/db.py
git -C C:/Users/Patrick/uct-dashboard commit -m "feat(j2-onboarding): db migration — onboarded/onboarding_mode/session_id + j2_onboarding_responses table"
```

---

## Task 2: Read tool + silent-action tool

**Files:**
- Modify: `api/services/journal_two/coach_chat_tools.py`
- Modify: `api/services/journal_two/test_coach_chat_tools.py`

Two simple tools land first: `get_onboarding_progress` (read) and `record_onboarding_answer` (silent action — exception to confirm rule).

- [ ] **Step 1: Append failing tests**

Append to `test_coach_chat_tools.py`:

```python
# ── Onboarding tools (read + silent action) ─────────────────────────────────


def test_get_onboarding_progress_empty_session(db_conn):
    from api.services.journal_two import coach_chat_tools as tools
    acc = _seed_account(db_conn)
    db_conn.execute(
        "UPDATE j2_accounts SET onboarding_session_id = ? WHERE id = ?",
        ("sess_1", acc["id"]),
    )
    db_conn.commit()
    result = tools.TOOLS["get_onboarding_progress"]["executor"](
        user_id="u_chat", account_id=acc["id"], args={}, conn=db_conn,
    )
    assert result["session_id"] == "sess_1"
    assert result["questions_asked"] == 0
    assert set(result["categories_remaining"]) == {
        "identity", "account", "style", "setups", "sizing",
        "strengths", "weaknesses", "psychology", "process", "goals",
    }
    assert result["categories_covered"] == []


def test_get_onboarding_progress_with_some_answers(db_conn):
    from api.services.journal_two import coach_chat_tools as tools
    acc = _seed_account(db_conn)
    db_conn.execute(
        "UPDATE j2_accounts SET onboarding_session_id = ? WHERE id = ?",
        ("sess_2", acc["id"]),
    )
    for i, cat in enumerate(["identity", "style", "style"]):
        db_conn.execute(
            """INSERT INTO j2_onboarding_responses
               (id, user_id, account_id, session_id, category, question, answer, asked_at)
               VALUES (?, 'u_chat', ?, 'sess_2', ?, ?, ?, ?)""",
            (str(uuid.uuid4()), acc["id"], cat, f"Q{i}", f"A{i}", f"2026-05-12T1{i}:00:00+00:00"),
        )
    db_conn.commit()
    result = tools.TOOLS["get_onboarding_progress"]["executor"](
        user_id="u_chat", account_id=acc["id"], args={}, conn=db_conn,
    )
    assert result["questions_asked"] == 3
    assert set(result["categories_covered"]) == {"identity", "style"}
    assert "identity" not in result["categories_remaining"]
    assert "style" not in result["categories_remaining"]


def test_record_onboarding_answer_inserts_row(db_conn):
    from api.services.journal_two import coach_chat_tools as tools
    acc = _seed_account(db_conn)
    db_conn.execute(
        "UPDATE j2_accounts SET onboarding_session_id = ? WHERE id = ?",
        ("sess_3", acc["id"]),
    )
    db_conn.commit()
    result = tools.TOOLS["record_onboarding_answer"]["executor"](
        user_id="u_chat", account_id=acc["id"],
        args={"category": "identity", "question": "Years trading?", "answer": "3 years"},
        conn=db_conn,
    )
    assert result["ok"] is True
    row = db_conn.execute(
        "SELECT category, question, answer, session_id FROM j2_onboarding_responses WHERE account_id = ?",
        (acc["id"],),
    ).fetchone()
    assert row["category"] == "identity"
    assert row["question"] == "Years trading?"
    assert row["answer"] == "3 years"
    assert row["session_id"] == "sess_3"


def test_record_onboarding_answer_rejects_unknown_category(db_conn):
    from api.services.journal_two import coach_chat_tools as tools
    acc = _seed_account(db_conn)
    db_conn.execute(
        "UPDATE j2_accounts SET onboarding_session_id = ? WHERE id = ?",
        ("sess_4", acc["id"]),
    )
    db_conn.commit()
    result = tools.TOOLS["record_onboarding_answer"]["executor"](
        user_id="u_chat", account_id=acc["id"],
        args={"category": "BAD_CAT", "question": "Q", "answer": "A"},
        conn=db_conn,
    )
    assert result["ok"] is False
    assert "category" in result.get("error", "").lower()


def test_record_onboarding_answer_marked_no_confirm_required(db_conn):
    """Silent archive write — should NOT require_confirm in the catalog."""
    from api.services.journal_two import coach_chat_tools as tools
    spec = tools.TOOLS["record_onboarding_answer"]
    assert spec["requires_confirm"] is False
```

- [ ] **Step 2: Confirm fail**

```bash
python -m pytest api/services/journal_two/test_coach_chat_tools.py -q
```

Expected: 5 new tests fail.

- [ ] **Step 3: Append tool implementations**

In `coach_chat_tools.py`, BEFORE the final `TOOLS.update({...})` block from Task 4 of Compass Chat, add:

```python
# ── Onboarding tools ────────────────────────────────────────────────────────


_ONBOARDING_CATEGORIES = (
    "identity", "account", "style", "setups", "sizing",
    "strengths", "weaknesses", "psychology", "process", "goals",
)


def _get_current_session_id(conn, user_id: str, account_id: str) -> str | None:
    row = conn.execute(
        "SELECT onboarding_session_id FROM j2_accounts WHERE id = ? AND user_id = ?",
        (account_id, user_id),
    ).fetchone()
    if row is None:
        return None
    return row["onboarding_session_id"]


def _exec_get_onboarding_progress(*, user_id, account_id, args, conn=None) -> dict:
    c = conn or get_connection()
    sid = _get_current_session_id(c, user_id, account_id)
    if sid is None:
        return {
            "session_id": None,
            "started_at": None,
            "questions_asked": 0,
            "categories_covered": [],
            "categories_remaining": list(_ONBOARDING_CATEGORIES),
        }
    rows = c.execute(
        """SELECT category, asked_at FROM j2_onboarding_responses
           WHERE user_id = ? AND account_id = ? AND session_id = ?
           ORDER BY asked_at ASC""",
        (user_id, account_id, sid),
    ).fetchall()
    covered: list[str] = []
    seen: set[str] = set()
    for r in rows:
        if r["category"] not in seen:
            seen.add(r["category"])
            covered.append(r["category"])
    remaining = [c for c in _ONBOARDING_CATEGORIES if c not in seen]
    started_at = rows[0]["asked_at"] if rows else None
    return {
        "session_id": sid,
        "started_at": started_at,
        "questions_asked": len(rows),
        "categories_covered": covered,
        "categories_remaining": remaining,
    }


def _exec_record_onboarding_answer(*, user_id, account_id, args, conn=None) -> dict:
    import uuid as _uuid
    category = args.get("category")
    question = (args.get("question") or "").strip()
    answer = (args.get("answer") or "").strip()
    if category not in _ONBOARDING_CATEGORIES:
        return {"ok": False, "error": f"unknown category: {category}"}
    if not question or not answer:
        return {"ok": False, "error": "question and answer required"}
    c = conn or get_connection()
    sid = _get_current_session_id(c, user_id, account_id)
    if sid is None:
        return {"ok": False, "error": "no active onboarding session"}
    c.execute(
        """INSERT INTO j2_onboarding_responses
           (id, user_id, account_id, session_id, category, question, answer, asked_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
        (str(_uuid.uuid4()), user_id, account_id, sid, category,
         question, answer, datetime.now(timezone.utc).isoformat()),
    )
    c.commit()
    return {"ok": True, "summary": f"Logged {category} answer."}
```

- [ ] **Step 4: Register the two specs in `TOOLS`**

Append to the existing `TOOLS.update({...})` block (or append a new `TOOLS.update({...})` call) in `coach_chat_tools.py`:

```python
TOOLS.update({
    "get_onboarding_progress": {
        "name": "get_onboarding_progress",
        "description": "Returns which onboarding categories have been answered in the current session and how many questions have been asked.",
        "requires_confirm": False,
        "executor": _exec_get_onboarding_progress,
        "input_schema": {"type": "object", "properties": {}},
    },
    "record_onboarding_answer": {
        "name": "record_onboarding_answer",
        "description": "Record a question + the trader's answer to the onboarding archive. Silent write — does NOT require user confirmation. Call this after each substantive answer.",
        "requires_confirm": False,
        "executor": _exec_record_onboarding_answer,
        "input_schema": {
            "type": "object",
            "properties": {
                "category": {"type": "string", "enum": list(_ONBOARDING_CATEGORIES)},
                "question": {"type": "string"},
                "answer": {"type": "string"},
            },
            "required": ["category", "question", "answer"],
        },
    },
})
```

- [ ] **Step 5: Tests, full suite, commit**

```bash
python -m pytest api/services/journal_two/test_coach_chat_tools.py -q
python -m pytest api/services/journal_two/ -q
git -C C:/Users/Patrick/uct-dashboard add api/services/journal_two/coach_chat_tools.py api/services/journal_two/test_coach_chat_tools.py
git -C C:/Users/Patrick/uct-dashboard commit -m "feat(j2-onboarding): get_onboarding_progress + record_onboarding_answer tools"
```

Expected: 32 chat-tool tests passing (27 prior + 5 new); full j2 suite green.

---

## Task 3: `propose_account_settings` + `complete_onboarding` (preview/confirm action tools)

**Files:**
- Modify: `api/services/journal_two/coach_chat_tools.py`
- Modify: `api/services/journal_two/test_coach_chat_tools.py`

Two preview/execute action tools. `propose_account_settings` inferred fields → preview card → user confirms. `complete_onboarding` writes the profile, sets onboarded=1, exits onboarding mode.

- [ ] **Step 1: Append failing tests**

```python
# ── propose_account_settings (preview/confirm) ──────────────────────────────


def test_propose_account_settings_preview_describes_changes(db_conn):
    from api.services.journal_two import coach_chat_tools as tools
    acc = _seed_account(db_conn)
    preview = tools.TOOLS["propose_account_settings"]["preview"](
        user_id="u_chat", account_id=acc["id"],
        args={"maxRiskPerTradePct": 1.0, "dailyLossLimitPct": 3.0,
              "aPlusSetups": ["Bull Flag"]},
        conn=db_conn,
    )
    assert "narration" in preview
    assert "1.0" in preview["narration"] or "1%" in preview["narration"]
    assert "Bull Flag" in preview["narration"]
    assert preview["elevated"] is False
    assert "confirm_label" in preview


def test_propose_account_settings_execute_writes_all_fields(db_conn):
    from api.services.journal_two import coach_chat_tools as tools
    acc = _seed_account(db_conn)
    result = tools.TOOLS["propose_account_settings"]["executor"](
        user_id="u_chat", account_id=acc["id"],
        args={"maxRiskPerTradePct": 1.0, "dailyLossLimitPct": 3.0,
              "coolingOffMinutesAfterLoss": 30,
              "aPlusSetups": ["Bull Flag", "Pullback"]},
        conn=db_conn,
    )
    assert result["ok"] is True
    row = db_conn.execute(
        "SELECT max_risk_per_trade_pct, daily_loss_limit_pct, "
        "cooling_off_minutes_after_loss, a_plus_setups "
        "FROM j2_accounts WHERE id = ?",
        (acc["id"],),
    ).fetchone()
    assert float(row["max_risk_per_trade_pct"]) == 1.0
    assert float(row["daily_loss_limit_pct"]) == 3.0
    assert int(row["cooling_off_minutes_after_loss"]) == 30
    a_plus = json.loads(row["a_plus_setups"])
    assert "Bull Flag" in a_plus
    assert "Pullback" in a_plus


def test_propose_account_settings_partial_fields_only_updates_supplied(db_conn):
    from api.services.journal_two import coach_chat_tools as tools
    acc = _seed_account(db_conn)
    # Set a baseline
    db_conn.execute(
        "UPDATE j2_accounts SET max_risk_per_trade_pct = ?, daily_loss_limit_pct = ? WHERE id = ?",
        (2.0, 5.0, acc["id"]),
    )
    db_conn.commit()
    # Only update one field
    result = tools.TOOLS["propose_account_settings"]["executor"](
        user_id="u_chat", account_id=acc["id"],
        args={"maxRiskPerTradePct": 1.0},
        conn=db_conn,
    )
    assert result["ok"] is True
    row = db_conn.execute(
        "SELECT max_risk_per_trade_pct, daily_loss_limit_pct FROM j2_accounts WHERE id = ?",
        (acc["id"],),
    ).fetchone()
    assert float(row["max_risk_per_trade_pct"]) == 1.0
    assert float(row["daily_loss_limit_pct"]) == 5.0   # unchanged


# ── complete_onboarding (preview/confirm — terminal) ────────────────────────


def test_complete_onboarding_preview_returns_profile_excerpt(db_conn):
    from api.services.journal_two import coach_chat_tools as tools
    acc = _seed_account(db_conn)
    profile = "# Trader Profile — Patrick\n\n## Identity\n3yr swing trader.\n"
    preview = tools.TOOLS["complete_onboarding"]["preview"](
        user_id="u_chat", account_id=acc["id"],
        args={"trader_profile": profile, "this_weeks_focus": "Skip Pullbacks."},
        conn=db_conn,
    )
    assert "narration" in preview
    assert "profile" in preview["narration"].lower()


def test_complete_onboarding_execute_writes_all_state(db_conn):
    from api.services.journal_two import coach_chat_tools as tools
    acc = _seed_account(db_conn)
    # Set up: account is mid-onboarding
    db_conn.execute(
        "UPDATE j2_accounts SET onboarding_mode = 1, onboarding_session_id = 'sess_x' WHERE id = ?",
        (acc["id"],),
    )
    db_conn.commit()
    profile = "# Trader Profile — Patrick\n\nDeep swing trader."
    result = tools.TOOLS["complete_onboarding"]["executor"](
        user_id="u_chat", account_id=acc["id"],
        args={"trader_profile": profile, "this_weeks_focus": "Sit on hands first 30 min."},
        conn=db_conn,
    )
    assert result["ok"] is True
    row = db_conn.execute(
        "SELECT trader_profile, onboarded, onboarding_mode FROM j2_accounts WHERE id = ?",
        (acc["id"],),
    ).fetchone()
    assert "Deep swing trader" in row["trader_profile"]
    assert int(row["onboarded"]) == 1
    assert int(row["onboarding_mode"]) == 0
    # Focus written to the active weekly_review row
    focus_row = db_conn.execute(
        "SELECT metadata FROM j2_coach_outputs WHERE user_id = ? AND output_type = 'weekly_review'",
        ("u_chat",),
    ).fetchone()
    assert focus_row is not None
    meta = json.loads(focus_row["metadata"])
    assert "Sit on hands" in (meta.get("this_weeks_focus") or "")


def test_complete_onboarding_execute_without_focus(db_conn):
    from api.services.journal_two import coach_chat_tools as tools
    acc = _seed_account(db_conn)
    db_conn.execute(
        "UPDATE j2_accounts SET onboarding_mode = 1, onboarding_session_id = 'sess_x' WHERE id = ?",
        (acc["id"],),
    )
    db_conn.commit()
    result = tools.TOOLS["complete_onboarding"]["executor"](
        user_id="u_chat", account_id=acc["id"],
        args={"trader_profile": "# Profile"},
        conn=db_conn,
    )
    assert result["ok"] is True
    row = db_conn.execute(
        "SELECT onboarded, onboarding_mode FROM j2_accounts WHERE id = ?",
        (acc["id"],),
    ).fetchone()
    assert int(row["onboarded"]) == 1
    assert int(row["onboarding_mode"]) == 0
```

- [ ] **Step 2: Confirm fail**

```bash
python -m pytest api/services/journal_two/test_coach_chat_tools.py -q
```

Expected: 6 new tests fail.

- [ ] **Step 3: Append tool implementations**

In `coach_chat_tools.py`, after the onboarding helpers from Task 2 but BEFORE the `TOOLS.update({...})` registration block, add:

```python
def _propose_account_settings_preview(*, user_id, account_id, args, conn=None) -> dict:
    pieces = []
    if "maxRiskPerTradePct" in args and args["maxRiskPerTradePct"] is not None:
        pieces.append(f"max risk per trade {args['maxRiskPerTradePct']}%")
    if "dailyLossLimitPct" in args and args["dailyLossLimitPct"] is not None:
        pieces.append(f"daily loss limit {args['dailyLossLimitPct']}%")
    if "coolingOffMinutesAfterLoss" in args and args["coolingOffMinutesAfterLoss"] is not None:
        pieces.append(f"cooling-off {args['coolingOffMinutesAfterLoss']} min after each loss")
    if args.get("aPlusSetups"):
        pieces.append("A+ setups: " + ", ".join(args["aPlusSetups"]))
    if not pieces:
        return {"narration": "No settings to update.", "contextual_warnings": [],
                "confirm_label": "Confirm", "elevated": False}
    return {
        "narration": "Set " + "; ".join(pieces) + ".",
        "contextual_warnings": [], "confirm_label": "Apply settings", "elevated": False,
    }


def _propose_account_settings_execute(*, user_id, account_id, args, conn=None) -> dict:
    c = conn or get_connection()
    field_map = {
        "maxRiskPerTradePct": "max_risk_per_trade_pct",
        "dailyLossLimitPct": "daily_loss_limit_pct",
        "coolingOffMinutesAfterLoss": "cooling_off_minutes_after_loss",
    }
    updates = []
    values: list = []
    for camel, snake in field_map.items():
        if camel in args and args[camel] is not None:
            updates.append(f"{snake} = ?")
            values.append(args[camel])
    if args.get("aPlusSetups"):
        updates.append("a_plus_setups = ?")
        values.append(json.dumps(args["aPlusSetups"]))
    if not updates:
        return {"ok": False, "error": "no fields supplied"}
    values.extend([account_id, user_id])
    c.execute(
        f"UPDATE j2_accounts SET {', '.join(updates)} WHERE id = ? AND user_id = ?",
        values,
    )
    c.commit()
    return {"ok": True, "summary": f"Updated {len(updates)} setting(s)."}


def _complete_onboarding_preview(*, user_id, account_id, args, conn=None) -> dict:
    profile = args.get("trader_profile") or ""
    focus = args.get("this_weeks_focus") or ""
    excerpt = profile[:200] + ("..." if len(profile) > 200 else "")
    bits = [f"Save your trader profile ({len(profile)} chars)."]
    if focus:
        bits.append(f"Set this week's focus to: \"{focus}\"")
    return {
        "narration": " ".join(bits),
        "contextual_warnings": [],
        "confirm_label": "Save profile",
        "elevated": False,
        "profile_excerpt": excerpt,
    }


def _complete_onboarding_execute(*, user_id, account_id, args, conn=None) -> dict:
    import uuid as _uuid
    profile = args.get("trader_profile") or ""
    focus = (args.get("this_weeks_focus") or "").strip()
    if not profile.strip():
        return {"ok": False, "error": "trader_profile is required"}
    c = conn or get_connection()
    # Write profile + finalize state
    c.execute(
        """UPDATE j2_accounts
           SET trader_profile = ?, onboarded = 1, onboarding_mode = 0
           WHERE id = ? AND user_id = ?""",
        (profile, account_id, user_id),
    )
    # Optional this_weeks_focus
    if focus:
        # Reuse set_weekly_focus's executor for consistency.
        _set_weekly_focus_execute(user_id=user_id, account_id=account_id,
                                  args={"text": focus}, conn=c)
    c.commit()
    return {"ok": True, "summary": "Onboarding complete. Profile saved."}
```

- [ ] **Step 4: Register the two specs**

Extend the `TOOLS.update({...})` block (or add another `TOOLS.update`):

```python
TOOLS.update({
    "propose_account_settings": {
        "name": "propose_account_settings",
        "description": "Propose initial discipline settings (max risk, daily loss limit, cooling-off, A+ setups) inferred from interview answers. Trader sees a preview card; one Confirm applies all supplied fields atomically.",
        "requires_confirm": True,
        "executor": _propose_account_settings_execute,
        "preview": _propose_account_settings_preview,
        "input_schema": {
            "type": "object",
            "properties": {
                "maxRiskPerTradePct": {"type": "number"},
                "dailyLossLimitPct": {"type": "number"},
                "coolingOffMinutesAfterLoss": {"type": "integer"},
                "aPlusSetups": {"type": "array", "items": {"type": "string"}},
            },
        },
    },
    "complete_onboarding": {
        "name": "complete_onboarding",
        "description": "Finalize the onboarding interview. Writes the trader_profile markdown, sets onboarded=1, exits onboarding_mode, optionally seeds this_weeks_focus.",
        "requires_confirm": True,
        "executor": _complete_onboarding_execute,
        "preview": _complete_onboarding_preview,
        "input_schema": {
            "type": "object",
            "properties": {
                "trader_profile": {"type": "string"},
                "this_weeks_focus": {"type": "string"},
            },
            "required": ["trader_profile"],
        },
    },
})
```

- [ ] **Step 5: Tests, full suite, commit**

```bash
python -m pytest api/services/journal_two/test_coach_chat_tools.py -q
python -m pytest api/services/journal_two/ -q
git -C C:/Users/Patrick/uct-dashboard add api/services/journal_two/coach_chat_tools.py api/services/journal_two/test_coach_chat_tools.py
git -C C:/Users/Patrick/uct-dashboard commit -m "feat(j2-onboarding): propose_account_settings + complete_onboarding tools"
```

Expected: 38 chat-tool tests passing (32 + 6).

---

## Task 4: Section 8 prompt + orchestrator wiring

**Files:**
- Modify: `api/services/journal_two/coach_prompts.py`
- Modify: `api/services/journal_two/coach_chat.py`
- Modify: `api/services/journal_two/test_coach_chat.py`

- [ ] **Step 1: Append `COMPASS_ONBOARDING_DIRECTIVE` to coach_prompts.py**

Add as a new module-level constant at the bottom of `coach_prompts.py`:

```python
# ── COMPASS_ONBOARDING_DIRECTIVE ────────────────────────────────────────────
#
# Appended to COMPASS_SYSTEM_PROMPT by the chat orchestrator ONLY when
# the account's onboarding_mode flag is set. Activates the interview
# behavior described in §7 of the Compass Onboarding spec.

COMPASS_ONBOARDING_DIRECTIVE = """\
## 8. Onboarding interview mode

You're conducting a structured onboarding interview. The trader clicked
"Start interview" to give you the context you need to coach them well.

### Your job

Conduct a thoughtful 10-minute interview covering 10 categories:
1. Identity + Why
2. Account + Life Context
3. Style + Time Frame
4. Setups they actually trade
5. Sizing + Risk Rules
6. Strengths — what they do well
7. Weaknesses — known leaks
8. Psychology + Triggers
9. Process + Routine
10. Goals + what they want from Compass

For EACH category, you must log at least one answer via `record_onboarding_answer`.

### How to interview

- **Lead. Don't wait.** You're driving. Pick one question, ask it cleanly, listen, decide what to ask next.
- **Pick order adaptively.** Start with whatever feels natural (often identity → context → style). Don't follow the numbered list mechanically.
- **Dig deeper when something hints at depth.** If the trader names a setup, ask what their perfect version looks like. If they name a weakness, ask when it shows up. If they give a vague answer, ask for specifics.
- **Move on when a category is covered.** Don't grind. Substantive one-paragraph answer ≥ checklist completion.
- **Track progress.** Call `get_onboarding_progress` at the start of each turn so you know what's covered and what's left.

### When the trader answers

Call `record_onboarding_answer(category, question, answer)` BEFORE asking the next question. Silent write — the trader doesn't see this tool call.

### When you infer a setting

If the trader's answer reveals a clear discipline rule — "I risk 1% per trade" or "Bull Flags are my A+" — pause the interview and call `propose_account_settings` with the inferred field(s). The trader gets a confirm card. Either way, continue the interview after.

### Off-topic redirect

If the trader asks an off-topic question mid-interview, gently redirect: "Let's finish the interview first — then we can dig into anything. So: [restate last question]"

Exception: if the trader gets genuinely frustrated and says "skip this" or "I want to chat now," pause gracefully: "Got it. I've saved what we have. Hit 'Resume interview' in the menu when you want to finish. For now — what's on your mind?"

You should NOT call read tools (list_recent_trades, get_aggregates, analyze_*, etc.) during the interview. Those are for post-onboarding chat.

### Termination

Call `complete_onboarding(...)` when:
- All 10 categories have at least one logged answer
- Strengths, weaknesses, and a this-week goal are all explicitly covered
- You've shown the trader a draft profile and they've accepted (or iterated on it). Show the draft FIRST, in a regular chat message, with the question "Anything to change before I save this?"

### Tone

Warm but professional. Curious, not nosy. You're meeting a serious trader, not running a survey. They've earned the right to be heard.
"""
```

- [ ] **Step 2: Wire orchestrator to append directive when onboarding_mode=1**

Open `coach_chat.py`. In `handle_user_turn`, find the line that sets `system_prompt`:

```python
            system_prompt = coach_prompts.COMPASS_SYSTEM_PROMPT
```

Replace with:

```python
            row = _conn.execute(
                "SELECT onboarding_mode FROM j2_accounts WHERE id = ? AND user_id = ?",
                (account_id, user_id),
            ).fetchone()
            onboarding = bool(row and row["onboarding_mode"])
            system_prompt = coach_prompts.COMPASS_SYSTEM_PROMPT
            if onboarding:
                system_prompt += "\n\n" + coach_prompts.COMPASS_ONBOARDING_DIRECTIVE
```

Same treatment for `confirm_pending_action` and `cancel_pending_action` (each builds `system_prompt` before re-streaming). Find each one's `system_prompt=coach_prompts.COMPASS_SYSTEM_PROMPT` reference and wrap with the same conditional.

- [ ] **Step 3: Append test**

```python
def test_handle_user_turn_appends_section_8_when_onboarding_mode(db_conn):
    from api.services.journal_two import coach_chat
    acc = _seed_account(db_conn)
    db_conn.execute(
        "UPDATE j2_accounts SET onboarding_mode = 1 WHERE id = ?", (acc["id"],),
    )
    db_conn.commit()
    client = FakeChatClient(stream_scripts=[
        [{"type": "text", "text": "Hi. Let's start."}, {"type": "message_stop"}],
    ])
    list(coach_chat.handle_user_turn(
        user_id="u_chat", account_id=acc["id"],
        user_message="hello", client=client, conn=db_conn,
    ))
    # The system prompt sent to the model should contain Section 8 text.
    assert client.calls, "No model call recorded"
    sp = client.calls[-1]["system_prompt"]
    assert "Onboarding interview mode" in sp


def test_handle_user_turn_does_not_append_section_8_when_not_onboarding(db_conn):
    from api.services.journal_two import coach_chat
    acc = _seed_account(db_conn)
    client = FakeChatClient(stream_scripts=[
        [{"type": "text", "text": "Hi."}, {"type": "message_stop"}],
    ])
    list(coach_chat.handle_user_turn(
        user_id="u_chat", account_id=acc["id"],
        user_message="hello", client=client, conn=db_conn,
    ))
    sp = client.calls[-1]["system_prompt"]
    assert "Onboarding interview mode" not in sp
```

- [ ] **Step 4: Run tests, full suite, commit**

```bash
python -m pytest api/services/journal_two/test_coach_chat.py -q
python -m pytest api/services/journal_two/ -q
git -C C:/Users/Patrick/uct-dashboard add api/services/journal_two/coach_prompts.py api/services/journal_two/coach_chat.py api/services/journal_two/test_coach_chat.py
git -C C:/Users/Patrick/uct-dashboard commit -m "feat(j2-onboarding): Section 8 onboarding directive + orchestrator wiring"
```

Expected: 18 coach-chat tests passing (16 + 2).

---

## Task 5: Entry-point functions + 3 endpoints

**Files:**
- Modify: `api/services/journal_two/coach_chat.py`
- Modify: `api/services/journal_two/test_coach_chat.py`
- Modify: `api/routers/journal_two.py`

- [ ] **Step 1: Append entry-point tests**

```python
def test_start_onboarding_assigns_session_and_sets_mode(db_conn):
    from api.services.journal_two import coach_chat
    acc = _seed_account(db_conn)
    client = FakeChatClient(stream_scripts=[
        [{"type": "text", "text": "Welcome. Let's begin."}, {"type": "message_stop"}],
    ])
    events = list(coach_chat.start_onboarding(
        user_id="u_chat", account_id=acc["id"],
        client=client, conn=db_conn,
    ))
    row = db_conn.execute(
        "SELECT onboarding_mode, onboarding_session_id, onboarded FROM j2_accounts WHERE id = ?",
        (acc["id"],),
    ).fetchone()
    assert int(row["onboarding_mode"]) == 1
    assert row["onboarding_session_id"] is not None
    assert int(row["onboarded"]) == 0
    # Sentinel user message was inserted
    user_rows = db_conn.execute(
        "SELECT content FROM j2_chat_messages WHERE user_id = ? AND role = 'user'",
        ("u_chat",),
    ).fetchall()
    assert any("BEGIN_ONBOARDING_INTERVIEW" in (r["content"] or "") for r in user_rows)


def test_start_onboarding_rejects_when_already_onboarded(db_conn):
    from api.services.journal_two import coach_chat
    acc = _seed_account(db_conn)
    db_conn.execute(
        "UPDATE j2_accounts SET onboarded = 1 WHERE id = ?", (acc["id"],),
    )
    db_conn.commit()
    client = FakeChatClient(stream_scripts=[])
    events = list(coach_chat.start_onboarding(
        user_id="u_chat", account_id=acc["id"],
        client=client, conn=db_conn,
    ))
    types = [e.get("type") for e in events]
    assert "error" in types


def test_start_onboarding_resume_reuses_existing_session(db_conn):
    from api.services.journal_two import coach_chat
    acc = _seed_account(db_conn)
    db_conn.execute(
        """UPDATE j2_accounts
           SET onboarding_mode = 1, onboarding_session_id = 'existing_sess'
           WHERE id = ?""",
        (acc["id"],),
    )
    db_conn.commit()
    client = FakeChatClient(stream_scripts=[
        [{"type": "text", "text": "Welcome back. Picking up."}, {"type": "message_stop"}],
    ])
    list(coach_chat.start_onboarding(
        user_id="u_chat", account_id=acc["id"],
        client=client, conn=db_conn,
    ))
    row = db_conn.execute(
        "SELECT onboarding_session_id FROM j2_accounts WHERE id = ?",
        (acc["id"],),
    ).fetchone()
    assert row["onboarding_session_id"] == "existing_sess"


def test_skip_onboarding_marks_onboarded_silent(db_conn):
    from api.services.journal_two import coach_chat
    acc = _seed_account(db_conn)
    result = coach_chat.skip_onboarding(
        user_id="u_chat", account_id=acc["id"], conn=db_conn,
    )
    assert result["ok"] is True
    row = db_conn.execute(
        "SELECT onboarded, onboarding_mode FROM j2_accounts WHERE id = ?",
        (acc["id"],),
    ).fetchone()
    assert int(row["onboarded"]) == 1
    assert int(row["onboarding_mode"]) == 0
    # No chat row created
    n = db_conn.execute(
        "SELECT COUNT(*) AS n FROM j2_chat_messages WHERE user_id = ?", ("u_chat",),
    ).fetchone()["n"]
    assert n == 0


def test_redo_onboarding_preserves_prior_responses(db_conn):
    from api.services.journal_two import coach_chat
    import uuid as _uuid
    acc = _seed_account(db_conn)
    # Seed: onboarded, with prior session's responses
    old_sid = "old_sess"
    db_conn.execute(
        "UPDATE j2_accounts SET onboarded = 1, onboarding_session_id = ? WHERE id = ?",
        (old_sid, acc["id"]),
    )
    db_conn.execute(
        """INSERT INTO j2_onboarding_responses
           (id, user_id, account_id, session_id, category, question, answer, asked_at)
           VALUES (?, 'u_chat', ?, ?, 'identity', 'Q', 'A', '2026-05-12T10:00:00+00:00')""",
        (str(_uuid.uuid4()), acc["id"], old_sid),
    )
    db_conn.commit()

    client = FakeChatClient(stream_scripts=[
        [{"type": "text", "text": "Fresh start. Let's go."}, {"type": "message_stop"}],
    ])
    list(coach_chat.redo_onboarding(
        user_id="u_chat", account_id=acc["id"],
        client=client, conn=db_conn,
    ))
    # Old responses still present
    old_count = db_conn.execute(
        "SELECT COUNT(*) AS n FROM j2_onboarding_responses WHERE session_id = ?",
        (old_sid,),
    ).fetchone()["n"]
    assert old_count == 1
    # New session_id assigned
    row = db_conn.execute(
        "SELECT onboarding_session_id, onboarded, onboarding_mode FROM j2_accounts WHERE id = ?",
        (acc["id"],),
    ).fetchone()
    assert row["onboarding_session_id"] != old_sid
    assert int(row["onboarded"]) == 0
    assert int(row["onboarding_mode"]) == 1
```

- [ ] **Step 2: Confirm fail**

```bash
python -m pytest api/services/journal_two/test_coach_chat.py -q
```

Expected: 5 new tests fail.

- [ ] **Step 3: Append entry-point functions**

Append to `coach_chat.py`:

```python
# ── Onboarding entry points (Phase G v4) ─────────────────────────────────────


_ONBOARDING_SENTINEL = "[BEGIN_ONBOARDING_INTERVIEW]"


def start_onboarding(
    *,
    user_id: str,
    account_id: str,
    client=None,
    conn=None,
):
    """Begin (or resume) the onboarding interview. Generator yields chat events."""
    import uuid as _uuid

    _conn, _close = _get_conn(conn)
    try:
        row = _conn.execute(
            "SELECT onboarded, onboarding_mode, onboarding_session_id FROM j2_accounts WHERE id = ? AND user_id = ?",
            (account_id, user_id),
        ).fetchone()
        if row is None:
            yield {"type": "error", "code": "no_account", "message": "Account not found."}
            return
        if int(row["onboarded"] or 0):
            yield {"type": "error", "code": "already_onboarded",
                   "message": "Already onboarded. Use redo_onboarding to start fresh."}
            return

        # If already mid-onboarding, reuse session. Otherwise begin a new one.
        if int(row["onboarding_mode"] or 0) and row["onboarding_session_id"]:
            pass  # resume
        else:
            new_sid = str(_uuid.uuid4())
            _conn.execute(
                """UPDATE j2_accounts
                   SET onboarding_mode = 1, onboarding_session_id = ?
                   WHERE id = ? AND user_id = ?""",
                (new_sid, account_id, user_id),
            )
            _conn.commit()

        # Persist a sentinel user message that triggers Compass's interview opener.
        append_message(
            user_id=user_id, account_id=account_id,
            role="user", content=_ONBOARDING_SENTINEL, conn=_conn,
        )

        # Stream Compass's response via the standard turn handler.
        # NOTE: handle_user_turn also persists ANOTHER user message — that's
        # acceptable here because we pass a no-op message. To avoid the
        # duplicate persistence, call handle_user_turn with a special
        # already-persisted flag — simpler: skip the user_message arg by
        # passing an empty string and rely on the sentinel already being
        # in history. But handle_user_turn always persists. So instead,
        # we directly call the streaming core inline.

        from api.services.journal_two import coach_chat_tools as cct
        from api.services.journal_two import coach_prompts

        # Build system prompt (onboarding_mode is now 1)
        system_prompt = coach_prompts.COMPASS_SYSTEM_PROMPT + "\n\n" + coach_prompts.COMPASS_ONBOARDING_DIRECTIVE
        active_client = client or AnthropicChatClient()
        tools_param = _build_anthropic_tools_param()
        messages = _reconstruct_messages(user_id=user_id, account_id=account_id, conn=_conn)
        assistant_text = ""
        tool_uses: list[dict] = []
        with active_client.start_stream(
            system_prompt=system_prompt, messages=messages, tools=tools_param,
        ) as stream:
            for ev in stream:
                etype = ev.get("type") if isinstance(ev, dict) else getattr(ev, "type", None)
                if etype == "text":
                    text = ev.get("text") if isinstance(ev, dict) else getattr(ev, "text", "")
                    assistant_text += text
                    yield {"type": "token", "text": text}
                elif etype == "tool_use":
                    tu = {
                        "id": ev.get("id") if isinstance(ev, dict) else getattr(ev, "id", None),
                        "name": ev.get("name") if isinstance(ev, dict) else getattr(ev, "name", None),
                        "args": (ev.get("input") if isinstance(ev, dict)
                                 else getattr(ev, "input", {})) or {},
                    }
                    tool_uses.append(tu)
        # Persist Compass's opener
        tool_calls_json = [{"id": tu["id"], "name": tu["name"], "args": tu["args"], "status": "pending"} for tu in tool_uses] or None
        asst_id = append_message(
            user_id=user_id, account_id=account_id,
            role="assistant", content=assistant_text or None,
            tool_calls=tool_calls_json, conn=_conn,
        )
        # If Compass already invoked tools in the opener, dispatch them.
        for tu in tool_uses:
            spec = cct.TOOLS.get(tu["name"])
            if spec is None:
                continue
            if spec["requires_confirm"]:
                preview = spec["preview"](
                    user_id=user_id, account_id=account_id, args=tu["args"], conn=_conn,
                )
                _mark_tool_call_status(_conn, asst_id, tu["id"], "pending_confirm")
                yield {"type": "tool_call_pending", "tool_call_id": tu["id"],
                       "name": tu["name"], "args": tu["args"],
                       "preview": preview, "message_id": asst_id}
            else:
                try:
                    result = spec["executor"](
                        user_id=user_id, account_id=account_id, args=tu["args"], conn=_conn,
                    )
                except Exception as e:  # noqa: BLE001
                    result = {"error": str(e)}
                yield {"type": "tool_call", "name": tu["name"], "args": tu["args"],
                       "summary": _summarize_tool_result(tu["name"], result)}
                append_message(
                    user_id=user_id, account_id=account_id,
                    role="tool",
                    tool_results=[{"tool_call_id": tu["id"], "result": result}],
                    parent_id=asst_id, conn=_conn,
                )
                _mark_tool_call_status(_conn, asst_id, tu["id"], "confirmed")
        yield {"type": "complete", "message_id": asst_id}
    finally:
        if _close:
            _conn.close()


def skip_onboarding(*, user_id: str, account_id: str, conn=None) -> dict:
    """Mark the account as onboarded with no profile. Returns sync dict (no SSE)."""
    _conn, _close = _get_conn(conn)
    try:
        _conn.execute(
            "UPDATE j2_accounts SET onboarded = 1, onboarding_mode = 0 WHERE id = ? AND user_id = ?",
            (account_id, user_id),
        )
        _conn.commit()
        return {"ok": True, "summary": "Onboarding skipped."}
    finally:
        if _close:
            _conn.close()


def redo_onboarding(
    *,
    user_id: str,
    account_id: str,
    client=None,
    conn=None,
):
    """Restart the interview with a new session_id. Old responses preserved."""
    import uuid as _uuid

    _conn, _close = _get_conn(conn)
    try:
        row = _conn.execute(
            "SELECT onboarded FROM j2_accounts WHERE id = ? AND user_id = ?",
            (account_id, user_id),
        ).fetchone()
        if row is None:
            yield {"type": "error", "code": "no_account", "message": "Account not found."}
            return
        # Allow redo even if not yet onboarded (just resets state).
        new_sid = str(_uuid.uuid4())
        _conn.execute(
            """UPDATE j2_accounts
               SET onboarded = 0, onboarding_mode = 1, onboarding_session_id = ?
               WHERE id = ? AND user_id = ?""",
            (new_sid, account_id, user_id),
        )
        _conn.commit()
    finally:
        if _close:
            _conn.close()

    # Then delegate to start_onboarding for the actual streaming.
    for event in start_onboarding(
        user_id=user_id, account_id=account_id, client=client, conn=conn,
    ):
        yield event
```

- [ ] **Step 4: Register the 3 endpoints in `api/routers/journal_two.py`**

After the existing chat endpoints, append:

```python
@router.post("/accounts/{account_id}/coach/chat/start_onboarding")
def chat_start_onboarding(
    account_id: str,
    user: dict = Depends(get_current_user),
):
    settings_check = accounts_service.get_account_settings(user["id"], account_id)
    if settings_check is None:
        raise HTTPException(status_code=404, detail="Account not found")
    if not settings_check.get("compassEnabled", True):
        raise HTTPException(status_code=403, detail="Compass is disabled for this account")

    def _gen():
        for event in coach_chat_service.start_onboarding(
            user_id=user["id"], account_id=account_id,
        ):
            yield _sse_format(event)
    return StreamingResponse(_gen(), media_type="text/event-stream")


@router.post("/accounts/{account_id}/coach/chat/skip_onboarding")
def chat_skip_onboarding(
    account_id: str,
    user: dict = Depends(get_current_user),
):
    return coach_chat_service.skip_onboarding(user_id=user["id"], account_id=account_id)


@router.post("/accounts/{account_id}/coach/chat/redo_onboarding")
def chat_redo_onboarding(
    account_id: str,
    user: dict = Depends(get_current_user),
):
    settings_check = accounts_service.get_account_settings(user["id"], account_id)
    if settings_check is None:
        raise HTTPException(status_code=404, detail="Account not found")
    if not settings_check.get("compassEnabled", True):
        raise HTTPException(status_code=403, detail="Compass is disabled for this account")

    def _gen():
        for event in coach_chat_service.redo_onboarding(
            user_id=user["id"], account_id=account_id,
        ):
            yield _sse_format(event)
    return StreamingResponse(_gen(), media_type="text/event-stream")
```

- [ ] **Step 5: Tests, route smoke, full suite, commit**

```bash
python -m pytest api/services/journal_two/test_coach_chat.py -q
python -c "from fastapi.testclient import TestClient; from api.main import app; routes = sorted([r.path for r in app.routes if 'onboarding' in r.path]); print(routes)"
python -m pytest api/services/journal_two/ -q
git -C C:/Users/Patrick/uct-dashboard add api/services/journal_two/coach_chat.py api/services/journal_two/test_coach_chat.py api/routers/journal_two.py
git -C C:/Users/Patrick/uct-dashboard commit -m "feat(j2-onboarding): start/skip/redo endpoint functions + 3 chat routes"
```

Expected: 23 coach-chat tests passing (18 + 5); 3 new routes register.

---

## Task 6: Frontend hook additions

**Files:**
- Modify: `app/src/pages/journal-2-0/hooks/useJ2CoachChat.js`

- [ ] **Step 1: Add 3 new actions + derived `isOnboarding` flag**

Open `useJ2CoachChat.js`. Inside the hook body, after the existing `forgetAll` definition, add:

```js
  const startOnboarding = useCallback(() => {
    if (!accountId) return
    return consumeStream(
      `/api/j2/accounts/${accountId}/coach/chat/start_onboarding`,
      {},
    )
  }, [accountId, consumeStream])

  const skipOnboarding = useCallback(async () => {
    if (!accountId) return
    await fetch(`/api/j2/accounts/${accountId}/coach/chat/skip_onboarding`, {
      method: 'POST', credentials: 'include',
    })
    await refreshStatus()
    await refreshMessages()
  }, [accountId, refreshStatus, refreshMessages])

  const redoOnboarding = useCallback(() => {
    if (!accountId) return
    return consumeStream(
      `/api/j2/accounts/${accountId}/coach/chat/redo_onboarding`,
      {},
    )
  }, [accountId, consumeStream])
```

In the return statement, expose them + a derived `isOnboarding` flag based on the status response. First, modify the `/status` endpoint server-side response to include these flags — but for v1, the status endpoint doesn't return them yet. Add them now:

Actually, the simpler path: query the account settings via a separate SWR endpoint OR add to status. Cleanest: extend the status response to include `onboarded` and `onboarding_mode` fields. Edit `api/services/journal_two/coach_chat.py`'s `get_chat_status`:

```python
def get_chat_status(*, user_id: str, account_id: str, conn=None) -> dict:
    enabled = os.environ.get("COMPASS_CHAT_ENABLED", "true").lower() != "false"
    rate = get_rate_limit_info(user_id=user_id, account_id=account_id, conn=conn)
    _conn, _close = _get_conn(conn)
    try:
        count_row = _conn.execute(
            "SELECT COUNT(*) AS n FROM j2_chat_messages WHERE user_id = ? AND account_id = ? AND forgotten = 0",
            (user_id, account_id),
        ).fetchone()
        acc_row = _conn.execute(
            "SELECT onboarded, onboarding_mode FROM j2_accounts WHERE id = ? AND user_id = ?",
            (account_id, user_id),
        ).fetchone()
        return {
            "enabled": enabled,
            "rate_limit_remaining": rate["remaining"],
            "conversation_message_count": count_row["n"],
            "onboarded": bool(acc_row and int(acc_row["onboarded"] or 0)),
            "onboarding_mode": bool(acc_row and int(acc_row["onboarding_mode"] or 0)),
        }
    finally:
        if _close:
            _conn.close()
```

Then in the hook's return:

```js
  return {
    messages: messagesData?.messages ?? [],
    status: status ?? { enabled: true, rate_limit_remaining: 200, conversation_message_count: 0, onboarded: false, onboarding_mode: false },
    isLoading,
    error: error || streamError,
    isStreaming,
    streamingTokens,
    pendingAction,
    isOnboarding: !!status?.onboarding_mode,
    needsOnboarding: status?.onboarded === false && status?.onboarding_mode === false,
    send,
    confirm,
    cancel,
    forget,
    forgetAll,
    startOnboarding,
    skipOnboarding,
    redoOnboarding,
    refresh: refreshMessages,
  }
```

- [ ] **Step 2: Add status-response test** in `test_coach_chat.py`

```python
def test_get_chat_status_returns_onboarding_flags(db_conn):
    from api.services.journal_two import coach_chat
    acc = _seed_account(db_conn)
    db_conn.execute(
        "UPDATE j2_accounts SET onboarded = 1, onboarding_mode = 0 WHERE id = ?",
        (acc["id"],),
    )
    db_conn.commit()
    status = coach_chat.get_chat_status(
        user_id="u_chat", account_id=acc["id"], conn=db_conn,
    )
    assert status["onboarded"] is True
    assert status["onboarding_mode"] is False
```

- [ ] **Step 3: Run, build, commit**

```bash
python -m pytest api/services/journal_two/test_coach_chat.py -q
cd C:/Users/Patrick/uct-dashboard/app && npm run build
git -C C:/Users/Patrick/uct-dashboard add api/services/journal_two/coach_chat.py api/services/journal_two/test_coach_chat.py app/src/pages/journal-2-0/hooks/useJ2CoachChat.js
git -C C:/Users/Patrick/uct-dashboard commit -m "feat(j2-onboarding): hook + status response surface onboarding flags + actions"
```

---

## Task 7: CompassChat panel updates + tests

**Files:**
- Modify: `app/src/pages/journal-2-0/components/CompassChat.jsx`
- Modify: `app/src/pages/journal-2-0/components/CompassChat.test.jsx`

- [ ] **Step 1: Append failing tests**

```jsx
  it('renders Start Onboarding CTA when needsOnboarding is true', () => {
    useJ2CoachChat.mockReturnValue(_hookReturn({
      status: { enabled: true, rate_limit_remaining: 200, conversation_message_count: 0,
                onboarded: false, onboarding_mode: false },
      isOnboarding: false,
      needsOnboarding: true,
    }))
    render(<CompassChat accountId="acc1" />)
    expect(screen.getByRole('button', { name: /Start onboarding/i })).toBeInTheDocument()
  })

  it('clicking Start Onboarding calls startOnboarding', async () => {
    const startOnboarding = vi.fn()
    useJ2CoachChat.mockReturnValue(_hookReturn({
      status: { enabled: true, rate_limit_remaining: 200, conversation_message_count: 0,
                onboarded: false, onboarding_mode: false },
      needsOnboarding: true,
      startOnboarding,
    }))
    const user = userEvent.setup()
    render(<CompassChat accountId="acc1" />)
    await user.click(screen.getByRole('button', { name: /Start onboarding/i }))
    expect(startOnboarding).toHaveBeenCalled()
  })

  it('renders onboarding progress header when isOnboarding is true', () => {
    useJ2CoachChat.mockReturnValue(_hookReturn({
      isOnboarding: true,
      messages: [
        { id: 'm1', role: 'assistant', content: 'Question 1?' },
      ],
    }))
    render(<CompassChat accountId="acc1" />)
    expect(screen.getByText(/Onboarding interview/i)).toBeInTheDocument()
  })

  it('hides BEGIN_ONBOARDING_INTERVIEW sentinel messages', () => {
    useJ2CoachChat.mockReturnValue(_hookReturn({
      messages: [
        { id: 'm0', role: 'user', content: '[BEGIN_ONBOARDING_INTERVIEW]' },
        { id: 'm1', role: 'assistant', content: 'Welcome!' },
      ],
    }))
    render(<CompassChat accountId="acc1" />)
    expect(screen.queryByText(/BEGIN_ONBOARDING_INTERVIEW/)).not.toBeInTheDocument()
    expect(screen.getByText(/Welcome!/)).toBeInTheDocument()
  })
```

- [ ] **Step 2: Confirm fail**

```bash
cd C:/Users/Patrick/uct-dashboard/app
npx vitest run src/pages/journal-2-0/components/CompassChat.test.jsx
```

Expected: 4 new tests fail.

- [ ] **Step 3: Update `CompassChat.jsx`**

In the destructuring near the top of the component, add `isOnboarding`, `needsOnboarding`, `startOnboarding`, `skipOnboarding`, `redoOnboarding`:

```jsx
  const {
    messages, status, isStreaming, streamingTokens, pendingAction,
    error, send, confirm, cancel, forgetAll,
    isOnboarding, needsOnboarding,
    startOnboarding, skipOnboarding, redoOnboarding,
  } = useJ2CoachChat(accountId)
```

Filter sentinel messages out of the rendered list. Modify the `messages.map(...)` block:

```jsx
        {messages
          .filter((m) => m.content !== '[BEGIN_ONBOARDING_INTERVIEW]')
          .map((m) => (
            <ChatMessage key={m.id} message={m} toolResults={toolResults} />
          ))}
```

Replace the empty-state block with a conditional that renders the onboarding CTA when `needsOnboarding`:

```jsx
        {!hasContent && needsOnboarding && (
          <div style={{ textAlign: 'center', padding: '24px 8px', color: 'var(--text-muted)' }}>
            <div style={{ fontSize: 32, marginBottom: 6 }}>🧭</div>
            <div style={{ fontSize: 14, marginBottom: 4 }}>
              <strong style={{ color: 'var(--text-bright)' }}>Welcome to Compass.</strong>
            </div>
            <div style={{ fontSize: 12, marginBottom: 14, lineHeight: 1.6 }}>
              Before we start coaching, I'd like to interview you for a few minutes<br/>
              so I can be useful to you.
            </div>
            <button
              type="button"
              onClick={() => startOnboarding && startOnboarding()}
              style={{
                padding: '10px 18px', fontSize: 13, fontWeight: 600,
                background: 'var(--ut-gold, #c9a84c)', color: '#000',
                border: 'none', borderRadius: 6, cursor: 'pointer',
              }}
            >
              🧭 Start onboarding interview
            </button>
            <div style={{ marginTop: 12 }}>
              <button
                type="button"
                onClick={() => skipOnboarding && skipOnboarding()}
                style={{
                  fontSize: 11, color: 'var(--text-muted)', background: 'none',
                  border: 'none', cursor: 'pointer', textDecoration: 'underline',
                }}
              >
                Skip and start chatting →
              </button>
            </div>
          </div>
        )}

        {!hasContent && !needsOnboarding && (
          /* existing empty state with the 4 suggested prompts — unchanged */
          <div style={{ textAlign: 'center', padding: '24px 8px', color: 'var(--text-muted)' }}>
            <div style={{ fontSize: 24, marginBottom: 6 }}>🧭</div>
            <div style={{ fontSize: 13, marginBottom: 4 }}>
              <strong style={{ color: 'var(--text-bright)' }}>Compass is here.</strong>
            </div>
            <div style={{ fontSize: 12, marginBottom: 12 }}>
              Ask me anything about your trading.
            </div>
            <div style={{
              display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
              gap: 6, maxWidth: 700, margin: '0 auto',
            }}>
              {SUGGESTED_PROMPTS.map((p) => (
                <button
                  key={p} type="button"
                  onClick={() => onSubmit(p)}
                  style={{
                    padding: '8px 12px', fontSize: 12, textAlign: 'left',
                    background: 'rgba(201,168,76,0.06)',
                    border: '1px solid rgba(201,168,76,0.3)',
                    borderRadius: 4, color: 'var(--text-bright)', cursor: 'pointer',
                  }}
                >{p}</button>
              ))}
            </div>
          </div>
        )}
```

In the header, change the title text when `isOnboarding`:

```jsx
        <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--ut-gold, #c9a84c)' }}>
          {isOnboarding ? '🧭 Onboarding interview' : '🧭 Talk to Compass'}
        </div>
```

In the overflow menu, add "Redo onboarding" when `onboarded=true`:

```jsx
          {showMenu && (
            <div style={{
              position: 'absolute', right: 0, top: '100%', zIndex: 5,
              background: 'var(--bg-base, #1a1a1a)',
              border: '1px solid var(--border)', borderRadius: 6,
              minWidth: 200, padding: 4,
            }}>
              <button
                type="button"
                onClick={() => { setShowMenu(false); forgetAll() }}
                style={menuItemStyle}
              >Clear conversation</button>
              {status?.onboarded && !isOnboarding && (
                <button
                  type="button"
                  onClick={() => {
                    if (confirm('This starts a fresh interview. Your existing profile stays unless you complete the new one. Continue?')) {
                      setShowMenu(false); redoOnboarding && redoOnboarding()
                    }
                  }}
                  style={menuItemStyle}
                >Redo onboarding</button>
              )}
            </div>
          )}
```

Extract the menu button style to avoid repetition:

```jsx
const menuItemStyle = {
  display: 'block', width: '100%', textAlign: 'left',
  padding: '8px 12px', fontSize: 12,
  background: 'transparent', border: 'none',
  color: 'var(--text-bright)', cursor: 'pointer',
}
```

Caveat on the `confirm()` call: that name shadows the `confirm` function destructured from the hook. Rename the menu's confirmation prompt to use `window.confirm(...)` explicitly so there's no clash:

```jsx
onClick={() => {
  if (window.confirm('This starts a fresh interview. Your existing profile stays unless you complete the new one. Continue?')) {
    setShowMenu(false)
    redoOnboarding && redoOnboarding()
  }
}}
```

- [ ] **Step 4: Tests + build**

```bash
npx vitest run src/pages/journal-2-0/components/CompassChat.test.jsx
npm run build
```

Expected: 10 vitest passing (6 + 4); build succeeds.

- [ ] **Step 5: Commit**

```bash
git -C C:/Users/Patrick/uct-dashboard add app/src/pages/journal-2-0/components/CompassChat.jsx app/src/pages/journal-2-0/components/CompassChat.test.jsx
git -C C:/Users/Patrick/uct-dashboard commit -m "feat(j2-onboarding): CompassChat panel — start CTA, onboarding header, sentinel filter, redo menu item"
```

---

## Task 8: End-to-end smoke + push

- [ ] **Step 1: Full backend suite**

```bash
cd C:/Users/Patrick/uct-dashboard
python -m pytest api/services/journal_two/ -q
```

Expected: ~420+ passing.

- [ ] **Step 2: Full j2 frontend tests**

```bash
cd app
npx vitest run src/pages/journal-2-0/
```

Expected: ~211+ passing.

- [ ] **Step 3: Route check**

```bash
python -c "from fastapi.testclient import TestClient; from api.main import app; routes = sorted([r.path for r in app.routes if 'onboarding' in r.path]); print('\n'.join(routes))"
```

Expected: 3 routes — `start_onboarding`, `skip_onboarding`, `redo_onboarding`.

- [ ] **Step 4: Manual smoke (only if ANTHROPIC_API_KEY is set locally)**

1. Run dev servers (`uvicorn` + `npm run dev`).
2. Open `/journal` → Compass tab. Fresh account → see "Start onboarding interview" CTA.
3. Click Start → Compass introduces itself + asks first question. Tool chip appears (`get_onboarding_progress` shows 0 covered).
4. Answer 3-5 questions. `record_onboarding_answer` chip appears after each.
5. Drop a specific number ("I risk 1%") → preview card appears mid-chat.
6. Refresh tab mid-interview → on reload, status shows `onboarding_mode=true`, opening Compass tab resumes (Compass picks up because session_id persists; `get_onboarding_progress` reports what's been covered).
7. Type "skip this for now" → Compass gracefully pauses.
8. Reopen, complete remaining categories. Compass shows draft profile. Accept → `complete_onboarding` confirmation card. Confirm → profile saved.
9. Verify in DB: `j2_accounts.trader_profile` populated; `onboarded=1`; `onboarding_mode=0`; `j2_onboarding_responses` has 10+ rows.
10. Overflow menu now shows "Redo onboarding". Click → new session_id, old rows preserved.

- [ ] **Step 5: Push**

```bash
git -C C:/Users/Patrick/uct-dashboard push origin master
```

Railway redeploys. Onboarding live.

---

## Self-Review Checklist

- **Spec coverage:** §1-2 covered by Task 1+5; §3 architecture by Task 4+5; §4 data model by Task 1; §5 categories encoded in Task 4's Section 8 prompt; §6 tools by Tasks 2+3; §7 prompt by Task 4; §8 orchestrator wiring by Task 4; §9 endpoints by Task 5; §10 frontend by Tasks 6+7; §11 safety enforced across Tasks 4-7; §13 test plan executed across all tasks; §14 file map matches.
- **Placeholder scan:** No TBD/TODO. Every step has concrete code.
- **Type consistency:** `start_onboarding`, `skip_onboarding`, `redo_onboarding`, `get_onboarding_progress`, `record_onboarding_answer`, `propose_account_settings`, `complete_onboarding` — function/tool names are stable across tasks. SSE event types `{token, tool_call, tool_call_pending, complete, error}` match Compass Chat's existing contract. Sentinel string `[BEGIN_ONBOARDING_INTERVIEW]` used consistently in backend and frontend.
- **Security:** All endpoints scoped by `Depends(get_current_user)`. `compassEnabled` gate on stream endpoints. Direct SQL queries scoped by `user_id AND account_id`.
- **Idempotency:** `start_onboarding` reuses existing session if already in mode. `skip_onboarding` is idempotent (multiple calls produce same state). `redo_onboarding` always assigns new session_id.
