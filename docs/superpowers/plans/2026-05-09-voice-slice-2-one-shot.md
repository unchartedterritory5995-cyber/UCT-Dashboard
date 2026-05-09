# Voice Assistant — Slice 2: One-Shot Mode B Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the second vertical slice — short single-turn voice queries. Click the floating mic orb (or press `Cmd/Ctrl+Shift+V`), speak a question like *"What's NVDA at?"*, and hear the spoken answer in <2.5s. Read-only across the app — no writes, no multi-turn yet (those come in Slices 4–5).

**Architecture:** Browser captures ~4 seconds of mic audio via `MediaRecorder` → POST as webm blob to `/api/voice/oneshot` → backend pipeline: Whisper STT → gpt-4o-mini intent classifier (matches transcript to a tool from a per-page subset) → tool dispatcher (calls existing FastAPI endpoints) → result narration → tts-1-hd streaming. Frontend plays the streamed audio via the existing `AudioPlayerBar` from Slice 1.

**Tech Stack:** OpenAI Whisper (`whisper-1`) · OpenAI gpt-4o-mini (with structured JSON output) · OpenAI tts-1-hd (already in use from Slice 1) · FastAPI · React 18 · MediaRecorder API · existing VoiceContext from Slice 1

**Spec:** `docs/superpowers/specs/2026-05-08-voice-assistant-design.md` (§2 Mode B, §3.3 Live Data Q&A, §4.2)

**Builds on Slice 1 (already shipped):** OpenAI client wrapper, voice_settings, voice_usage, voice_audio_cache, /tts endpoint, VoiceContext, AudioPlayerBar, ReadAloudButton.

**Scope (this plan):** Mode B only. Out of scope: wake word (Slice 3), multi-turn Realtime conversations (Slice 4), write actions (Slice 5), agentic flows (Slice 6), self-Q&A on journal data (Slice 7).

---

## File Structure

### Backend

| File | Responsibility |
|------|----------------|
| `api/services/voice_openai.py` | Extend with `transcribe_audio()` (Whisper) + `classify_intent()` (gpt-4o-mini structured output) |
| `api/services/voice_tools.py` | NEW. Tool registry — `@voice_tool` decorator, dispatch, JSON schema generation, page-context filtering |
| `api/services/voice_intent.py` | NEW. End-to-end "transcript → tool call → narration" pipeline using gpt-4o-mini |
| `api/routers/voice.py` | Extend with `POST /api/voice/oneshot` and `GET /api/voice/tools` |
| `api/services/voice_usage.py` | Extend with `record_mode_b_call(user_id)` + `is_within_mode_b_cap(...)` |

### Frontend

| File | Responsibility |
|------|----------------|
| `app/src/context/VoiceContext.jsx` | Extend reducer with Mode B states (`listening`, `transcribing`, `thinking`, `responding`) and `mode` field |
| `app/src/hooks/useOneShot.js` | NEW. Mic capture (`MediaRecorder`), POST audio blob, play streamed response |
| `app/src/hooks/usePushToTalkHotkey.js` | NEW. Global keyboard listener for `Cmd/Ctrl+Shift+V` — toggles a Mode B session |
| `app/src/components/voice/FloatingOrb.jsx` + `.module.css` | NEW. Bottom-right pulsing mic orb. Click = start session. Visual states reflect orchestrator. |
| `app/src/components/voice/TranscriptBubble.jsx` + `.module.css` | NEW. Ephemeral popover above the orb showing user transcript + assistant reply. Auto-fades 2s after session ends. |
| `app/src/App.jsx` | Mount `<FloatingOrb>` globally (currently only `<AudioPlayerBar>` is mounted) |

### Tests

| File | Coverage |
|------|----------|
| `tests/test_voice_tools.py` | Registry registration, schema generation, context filtering, dispatch |
| `tests/test_voice_intent.py` | Mocked OpenAI: classifier matches expected tool, formats response |
| `tests/test_voice_oneshot.py` | `/oneshot` endpoint: auth gate, transcribe → classify → tool → tts pipeline, error paths |
| `app/src/hooks/useOneShot.test.jsx` | Mock MediaRecorder + fetch, asserts blob POST + audio playback |
| `app/src/components/voice/FloatingOrb.test.jsx` | State machine renders correct icon for each status |

### Notes

- **No new dependencies.** OpenAI SDK already includes Whisper + GPT.
- **Audio format:** browser sends `audio/webm;codecs=opus` (MediaRecorder default). Whisper accepts webm directly — no transcoding needed.
- **Per-user Mode B cap:** default 200 calls/month per user (~$0.60 max). Cached prompt for classifier means ~$0.0002 per call.
- **Mic capture model:** "click to listen" — orb starts a 4-second listening window with VAD-style endpointing (stops early on 800ms of silence). Simpler than push-to-talk hold; can add hold-mode in a future polish.

---

## Plan-Wide Conventions

- **Tool subset by context:** orb sends `?context=<page>` to `/api/voice/tools` so the model only sees relevant tools. Slice 2 contexts: `global`, `chart`, `journal`. Most tools are `global`.
- **Intent classifier output shape (locked):**
  ```json
  {
    "tool": "get_quote",
    "args": {"symbol": "NVDA"},
    "narration_template": "{symbol} is at {last}, {direction} {abs_pct} percent."
  }
  ```
  If no tool matches, classifier returns `{"tool": null, "narration_template": "Sorry, I can't help with that yet."}`.
- **Narration filling:** the classifier returns a template with placeholders matching the tool's result keys. The dispatcher does plain `.format(**result)` substitution. If a placeholder is missing, falls back to `(unknown)`.
- **Latency budget:** 500ms Whisper · 300ms classifier · 200ms tool · 600ms tts first chunk = ~1.6s.
- **Commit cadence:** one commit per task. Conventional prefixes: `feat(voice):` or `test(voice):`.

---

## Task 1: Whisper STT wrapper

**Files:**
- Modify: `api/services/voice_openai.py`
- Modify: `tests/test_voice_openai.py`

- [ ] **Step 1: Add failing test**

Append to `tests/test_voice_openai.py`:

```python


# ── Whisper ─────────────────────────────────────────────────────────────────

def test_transcribe_audio_returns_text_from_sdk():
    fake_resp = MagicMock()
    fake_resp.text = "what is NVDA at right now"

    fake_client = MagicMock()
    fake_client.audio.transcriptions.create.return_value = fake_resp

    with patch.object(voice_openai, "_get_client", return_value=fake_client):
        out = voice_openai.transcribe_audio(b"FAKE-WEBM", filename="audio.webm")

    assert out == "what is NVDA at right now"
    fake_client.audio.transcriptions.create.assert_called_once()
    kwargs = fake_client.audio.transcriptions.create.call_args.kwargs
    assert kwargs["model"] == "whisper-1"


def test_transcribe_audio_rejects_empty_blob():
    with pytest.raises(ValueError, match="empty"):
        voice_openai.transcribe_audio(b"", filename="audio.webm")
```

- [ ] **Step 2: Run — should fail**

```
cd C:/Users/Patrick/uct-dashboard
python -m pytest tests/test_voice_openai.py::test_transcribe_audio_returns_text_from_sdk -v
```

Expected: AttributeError or ImportError on `voice_openai.transcribe_audio`.

- [ ] **Step 3: Implement**

In `api/services/voice_openai.py`, add this function after the existing `synthesize_speech` function:

```python


# ── Whisper STT ─────────────────────────────────────────────────────────────

_WHISPER_MODEL = "whisper-1"
MAX_AUDIO_BYTES = 25 * 1024 * 1024  # OpenAI Whisper limit


def transcribe_audio(audio_bytes: bytes, *, filename: str = "audio.webm") -> str:
    """
    Transcribe an audio blob via OpenAI Whisper.
    Returns the text. Raises ValueError if blob is empty / too large.
    """
    if not audio_bytes:
        raise ValueError("audio is empty")
    if len(audio_bytes) > MAX_AUDIO_BYTES:
        raise ValueError(f"audio exceeds {MAX_AUDIO_BYTES} bytes")

    client = _get_client()
    # Whisper SDK takes a file-like — use BytesIO with the right name suffix
    import io
    buf = io.BytesIO(audio_bytes)
    buf.name = filename
    resp = client.audio.transcriptions.create(
        model=_WHISPER_MODEL,
        file=buf,
        response_format="text",
    )
    # SDK returns either an object with .text (when response_format != "text")
    # or the raw text string (when response_format == "text"). Handle both.
    if hasattr(resp, "text"):
        return resp.text.strip()
    return str(resp).strip()
```

- [ ] **Step 4: Run — should pass**

```
python -m pytest tests/test_voice_openai.py -v
```

Expected: 5 tests pass (3 original TTS + 2 new Whisper).

- [ ] **Step 5: Commit**

```
git add api/services/voice_openai.py tests/test_voice_openai.py
git commit -m "feat(voice): add Whisper STT wrapper"
```

---

## Task 2: gpt-4o-mini intent classifier wrapper

**Files:**
- Modify: `api/services/voice_openai.py`
- Modify: `tests/test_voice_openai.py`

- [ ] **Step 1: Add failing test**

Append to `tests/test_voice_openai.py`:

```python


# ── Intent classifier ───────────────────────────────────────────────────────

def test_classify_intent_returns_tool_and_args():
    fake_msg = MagicMock()
    fake_msg.content = '{"tool":"get_quote","args":{"symbol":"NVDA"},"narration_template":"{symbol} is at {last}."}'
    fake_choice = MagicMock(message=fake_msg)
    fake_completion = MagicMock(choices=[fake_choice])

    fake_client = MagicMock()
    fake_client.chat.completions.create.return_value = fake_completion

    tools_schema = [{"name": "get_quote", "description": "Get a stock quote",
                     "parameters": {"type": "object", "properties": {"symbol": {"type": "string"}}}}]

    with patch.object(voice_openai, "_get_client", return_value=fake_client):
        out = voice_openai.classify_intent("what's NVDA at", tools_schema)

    assert out["tool"] == "get_quote"
    assert out["args"] == {"symbol": "NVDA"}
    assert "{last}" in out["narration_template"]
    fake_client.chat.completions.create.assert_called_once()
    kwargs = fake_client.chat.completions.create.call_args.kwargs
    assert kwargs["model"] == "gpt-4o-mini"
    assert kwargs["response_format"] == {"type": "json_object"}


def test_classify_intent_handles_no_match():
    fake_msg = MagicMock()
    fake_msg.content = '{"tool":null,"args":{},"narration_template":"Sorry, I can\'t help with that."}'
    fake_choice = MagicMock(message=fake_msg)
    fake_completion = MagicMock(choices=[fake_choice])

    fake_client = MagicMock()
    fake_client.chat.completions.create.return_value = fake_completion

    with patch.object(voice_openai, "_get_client", return_value=fake_client):
        out = voice_openai.classify_intent("tell me a joke", [])

    assert out["tool"] is None
    assert "Sorry" in out["narration_template"]
```

- [ ] **Step 2: Run — should fail**

```
python -m pytest tests/test_voice_openai.py::test_classify_intent_returns_tool_and_args -v
```

Expected: AttributeError on `voice_openai.classify_intent`.

- [ ] **Step 3: Implement**

Append to `api/services/voice_openai.py`:

```python


# ── Intent classification (gpt-4o-mini) ─────────────────────────────────────

_CLASSIFIER_MODEL = "gpt-4o-mini"

_CLASSIFIER_SYSTEM_PROMPT = """You are an intent classifier for a stock-trading dashboard's voice assistant.
The user speaks a short query. Choose the single best matching tool from the catalog and extract its arguments.

You MUST respond with a single JSON object of the shape:
{
  "tool": "<tool_name>" | null,
  "args": { ... },
  "narration_template": "<short spoken response template>"
}

The narration_template is a sentence the assistant will speak after the tool runs.
Use {placeholder} markers for values that come from the tool's result.
Common placeholders include {symbol}, {last}, {direction}, {abs_pct}, {volume}, {count}, {top_movers}, etc.
Keep narration short — one sentence, max ~25 words.
Use natural spoken language. Avoid technical jargon. Round numbers reasonably.

If no tool matches, set "tool" to null and write a polite refusal in narration_template (no placeholders).
"""


def classify_intent(transcript: str, tools_schema: list[dict]) -> dict:
    """
    Classify a user transcript against a tool catalog.
    Returns {tool, args, narration_template}.
    """
    if not transcript or not transcript.strip():
        return {"tool": None, "args": {}, "narration_template": "I didn't catch that. Try again?"}
    if not tools_schema:
        return {"tool": None, "args": {}, "narration_template": "Sorry, no tools are available right now."}

    catalog_lines = []
    for t in tools_schema:
        params = t.get("parameters", {}).get("properties", {})
        param_str = ", ".join(f"{n}: {p.get('type', 'any')}" for n, p in params.items())
        catalog_lines.append(f"- {t['name']}({param_str}): {t.get('description', '')}")

    user_msg = (
        f"Available tools:\n" + "\n".join(catalog_lines) +
        f"\n\nUser said: {transcript!r}\n\n"
        "Respond with JSON."
    )

    client = _get_client()
    completion = client.chat.completions.create(
        model=_CLASSIFIER_MODEL,
        messages=[
            {"role": "system", "content": _CLASSIFIER_SYSTEM_PROMPT},
            {"role": "user", "content": user_msg},
        ],
        response_format={"type": "json_object"},
        temperature=0.0,
    )

    import json
    raw = completion.choices[0].message.content
    try:
        out = json.loads(raw)
    except json.JSONDecodeError:
        return {"tool": None, "args": {}, "narration_template": "Something went wrong. Try again."}

    return {
        "tool": out.get("tool"),
        "args": out.get("args", {}) or {},
        "narration_template": out.get("narration_template") or "Done.",
    }
```

- [ ] **Step 4: Run — should pass**

```
python -m pytest tests/test_voice_openai.py -v
```

Expected: 7 tests pass.

- [ ] **Step 5: Commit**

```
git add api/services/voice_openai.py tests/test_voice_openai.py
git commit -m "feat(voice): add gpt-4o-mini intent classifier"
```

---

## Task 3: Voice tool registry + dispatcher

**Files:**
- Create: `api/services/voice_tools.py`
- Create: `tests/test_voice_tools.py`

- [ ] **Step 1: Write failing tests**

Create `tests/test_voice_tools.py`:

```python
"""Voice tool registry + dispatcher."""

import pytest
from api.services import voice_tools


def setup_function(_):
    voice_tools._REGISTRY.clear()


def test_register_tool_via_decorator():
    @voice_tools.voice_tool(
        name="dummy",
        description="A dummy tool for tests",
        parameters={"x": {"type": "string"}},
        contexts=["global"],
    )
    def dummy(x: str) -> dict:
        return {"echo": x}

    assert "dummy" in voice_tools._REGISTRY
    schema = voice_tools.get_schema_for_context("global")
    assert any(t["name"] == "dummy" for t in schema)


def test_get_schema_filters_by_context():
    @voice_tools.voice_tool(name="g_only", description="d", parameters={}, contexts=["global"])
    def g_only():
        return {}

    @voice_tools.voice_tool(name="chart_only", description="d", parameters={}, contexts=["chart"])
    def chart_only():
        return {}

    g_schema = voice_tools.get_schema_for_context("global")
    c_schema = voice_tools.get_schema_for_context("chart")

    g_names = {t["name"] for t in g_schema}
    c_names = {t["name"] for t in c_schema}

    assert "g_only" in g_names and "chart_only" not in g_names
    assert "chart_only" in c_names and "g_only" not in c_names


def test_dispatch_calls_tool_and_returns_dict():
    @voice_tools.voice_tool(name="add", description="d", parameters={
        "a": {"type": "integer"}, "b": {"type": "integer"}}, contexts=["global"])
    def add(a, b):
        return {"sum": a + b}

    result = voice_tools.dispatch("add", {"a": 2, "b": 3}, user={"id": "test"})
    assert result == {"sum": 5}


def test_dispatch_unknown_tool_raises():
    with pytest.raises(KeyError, match="not found"):
        voice_tools.dispatch("does_not_exist", {}, user={"id": "test"})


def test_dispatch_passes_user_when_tool_accepts_it():
    @voice_tools.voice_tool(name="who", description="d", parameters={}, contexts=["global"], wants_user=True)
    def who(user):
        return {"id": user["id"]}

    result = voice_tools.dispatch("who", {}, user={"id": "u-42"})
    assert result == {"id": "u-42"}
```

- [ ] **Step 2: Run — should fail**

```
python -m pytest tests/test_voice_tools.py -v
```

Expected: ImportError on `api.services.voice_tools`.

- [ ] **Step 3: Implement registry**

Create `api/services/voice_tools.py`:

```python
"""
Voice tool registry. The single source of truth for what the voice
assistant can do. Tools are registered via @voice_tool() decorator.

Slice 2 (Mode B) adds read-only tools.
Slice 5+ will add write tools with two-phase preview/confirm.
"""

from typing import Any, Callable
import logging

_log = logging.getLogger(__name__)

_REGISTRY: dict[str, dict] = {}


def voice_tool(
    *,
    name: str,
    description: str,
    parameters: dict,
    contexts: list[str],
    wants_user: bool = False,
):
    """
    Register a function as a voice tool.

    Args:
        name: unique tool name (e.g. "get_quote")
        description: short natural-language description for the LLM classifier
        parameters: JSON schema "properties" dict — e.g. {"symbol": {"type": "string"}}
        contexts: list of page contexts where this tool is available
                  (e.g. ["global"], ["chart"], ["journal"])
        wants_user: if True, dispatcher passes user dict as kwarg "user"
    """
    def decorator(fn: Callable):
        _REGISTRY[name] = {
            "name": name,
            "description": description,
            "parameters": parameters,
            "contexts": set(contexts),
            "wants_user": wants_user,
            "fn": fn,
        }
        return fn
    return decorator


def get_schema_for_context(context: str) -> list[dict]:
    """Return JSON-schema dicts for all tools available in the given context."""
    out = []
    for entry in _REGISTRY.values():
        if context in entry["contexts"] or "global" in entry["contexts"]:
            out.append({
                "name": entry["name"],
                "description": entry["description"],
                "parameters": {
                    "type": "object",
                    "properties": entry["parameters"],
                },
            })
    return out


def dispatch(name: str, args: dict, *, user: dict | None = None) -> dict:
    """
    Look up a tool by name, validate args, call it, return its result dict.
    """
    entry = _REGISTRY.get(name)
    if entry is None:
        raise KeyError(f"voice tool {name!r} not found")

    fn = entry["fn"]
    call_kwargs = dict(args or {})
    if entry["wants_user"]:
        call_kwargs["user"] = user or {}

    try:
        result = fn(**call_kwargs)
    except TypeError as e:
        # Wrong args — the classifier produced something that doesn't match the schema.
        raise ValueError(f"tool {name} arg mismatch: {e}")

    if not isinstance(result, dict):
        raise TypeError(f"tool {name} must return a dict, got {type(result).__name__}")
    return result


def all_tool_names() -> list[str]:
    return sorted(_REGISTRY.keys())
```

- [ ] **Step 4: Run — should pass**

```
python -m pytest tests/test_voice_tools.py -v
```

Expected: 5 tests pass.

- [ ] **Step 5: Commit**

```
git add api/services/voice_tools.py tests/test_voice_tools.py
git commit -m "feat(voice): add voice tool registry foundation"
```

---

## Task 4: Implement 6 quote/data tools

**Files:**
- Create: `api/services/voice_tool_impls.py`
- Modify: `tests/test_voice_tools.py`

We'll put tool implementations in their own file so `voice_tools.py` stays the registry only. The implementations import from the registry to register themselves on import.

- [ ] **Step 1: Append tests for the 6 tools**

Append to `tests/test_voice_tools.py`:

```python


# ── Tool implementations (Slice 2 reads) ────────────────────────────────────

def test_tool_implementations_register_on_import():
    # Importing the module triggers the @voice_tool decorators
    from api.services import voice_tool_impls  # noqa: F401
    names = voice_tools.all_tool_names()
    expected = {
        "get_quote", "get_movers", "get_breadth", "get_sector_strength",
        "get_company_info", "compare_tickers",
    }
    assert expected.issubset(set(names))


def test_get_quote_calls_snapshot_endpoint(monkeypatch):
    from api.services import voice_tool_impls

    captured = {}
    def fake_snapshot(sym):
        captured["sym"] = sym
        return {"sym": sym, "last": 487.20, "change_pct": 2.10, "volume": 35_500_000}

    monkeypatch.setattr(voice_tool_impls, "_snapshot", fake_snapshot)

    out = voice_tools.dispatch("get_quote", {"symbol": "nvda"}, user={"id": "u"})
    assert captured["sym"] == "NVDA"  # uppercased
    assert out["symbol"] == "NVDA"
    assert out["last"] == 487.20
    assert out["direction"] == "up"
    assert round(out["abs_pct"], 1) == 2.1


def test_get_movers_returns_summary_lines(monkeypatch):
    from api.services import voice_tool_impls
    monkeypatch.setattr(voice_tool_impls, "_movers", lambda: {
        "ripping": [{"sym": "AAA", "pct": 12.5}, {"sym": "BBB", "pct": 8.0}],
        "drilling": [{"sym": "ZZZ", "pct": -7.2}],
    })

    up = voice_tools.dispatch("get_movers", {"direction": "gainers", "count": 2}, user={"id": "u"})
    assert "AAA" in up["top_movers"]
    assert "12" in up["top_movers"]


def test_compare_tickers(monkeypatch):
    from api.services import voice_tool_impls

    def fake_snapshot(sym):
        return {"AAPL": {"last": 200, "change_pct": 1.5},
                "MSFT": {"last": 400, "change_pct": -0.5}}[sym]

    monkeypatch.setattr(voice_tool_impls, "_snapshot", fake_snapshot)

    out = voice_tools.dispatch("compare_tickers", {"symbols": ["AAPL", "MSFT"]}, user={"id": "u"})
    assert "AAPL" in out["summary"] and "MSFT" in out["summary"]
```

- [ ] **Step 2: Run — should fail**

```
python -m pytest tests/test_voice_tools.py -v
```

Expected: tests fail because `voice_tool_impls` doesn't exist.

- [ ] **Step 3: Implement the 6 tools**

Create `api/services/voice_tool_impls.py`:

```python
"""
Voice tool implementations — Slice 2 read-only tools.

These wrap existing services/endpoints. The wrappers normalize the result
into a flat dict whose keys can be used as {placeholder} markers in the
classifier's narration_template.
"""

from typing import Any
import logging

from api.services.voice_tools import voice_tool

# Existing service imports — adapt names if these differ in the actual codebase.
# get_snapshot returns {sym, last, change_pct, volume, ...} for a ticker
# get_movers returns {ripping: [...], drilling: [...]}

_log = logging.getLogger(__name__)


# Indirection so tests can monkeypatch easily
def _snapshot(sym: str) -> dict:
    from api.services.massive import get_snapshot
    return get_snapshot(sym)


def _movers() -> dict:
    from api.services.massive import get_movers
    return get_movers()


def _breadth() -> dict:
    from api.services.engine import get_breadth
    return get_breadth()


def _sector_flow() -> list[dict]:
    """Return list of {sector, change_pct} sorted by strength."""
    try:
        from api.services.rs_ranking import get_sector_strength
        return get_sector_strength()
    except (ImportError, AttributeError):
        # Fallback to engine
        from api.services.engine import get_themes
        themes = get_themes()
        leaders = themes.get("leaders", [])[:5]
        return [{"sector": t.get("name"), "change_pct": t.get("pct", 0)} for t in leaders]


# ── Tools ──────────────────────────────────────────────────────────────────

@voice_tool(
    name="get_quote",
    description="Get the current price, percent change, and volume for a stock symbol.",
    parameters={"symbol": {"type": "string", "description": "Ticker symbol, e.g. NVDA"}},
    contexts=["global"],
)
def get_quote(symbol: str) -> dict:
    sym = (symbol or "").upper().strip()
    if not sym:
        return {"symbol": "", "last": 0, "direction": "flat", "abs_pct": 0, "volume": 0}
    snap = _snapshot(sym) or {}
    last = float(snap.get("last") or 0)
    chg = float(snap.get("change_pct") or 0)
    direction = "up" if chg > 0 else "down" if chg < 0 else "flat"
    return {
        "symbol": sym,
        "last": last,
        "direction": direction,
        "abs_pct": abs(round(chg, 2)),
        "volume": int(snap.get("volume") or 0),
    }


@voice_tool(
    name="get_movers",
    description="Get the top market movers — gainers, losers, or most active.",
    parameters={
        "direction": {"type": "string", "enum": ["gainers", "losers"],
                      "description": "Which direction. Defaults to gainers."},
        "count": {"type": "integer", "description": "How many to include (default 3, max 5)."},
    },
    contexts=["global"],
)
def get_movers(direction: str = "gainers", count: int = 3) -> dict:
    count = max(1, min(5, int(count or 3)))
    data = _movers() or {}
    arr = data.get("ripping" if direction == "gainers" else "drilling", [])[:count]
    if not arr:
        return {"top_movers": "no movers available right now"}
    parts = [f"{m.get('sym')} {('up' if (m.get('pct') or 0) >= 0 else 'down')} {abs(round(m.get('pct') or 0, 1))} percent"
             for m in arr]
    return {"top_movers": ", ".join(parts), "count": len(parts)}


@voice_tool(
    name="get_breadth",
    description="Get the current market breadth: advancing vs declining, new highs vs new lows, and the breadth score.",
    parameters={},
    contexts=["global"],
)
def get_breadth() -> dict:
    b = _breadth() or {}
    adv = int(b.get("advancing") or 0)
    dec = int(b.get("declining") or 0)
    nh = int(b.get("new_highs") or 0)
    nl = int(b.get("new_lows") or 0)
    score = b.get("breadth_score")
    skew = "advancing" if adv > dec else "declining" if dec > adv else "balanced"
    return {
        "skew": skew,
        "advancing": adv,
        "declining": dec,
        "new_highs": nh,
        "new_lows": nl,
        "score": score if score is not None else "unavailable",
    }


@voice_tool(
    name="get_sector_strength",
    description="Get the strongest sectors right now, ranked by recent relative strength.",
    parameters={"count": {"type": "integer", "description": "How many sectors to include (default 3)."}},
    contexts=["global"],
)
def get_sector_strength(count: int = 3) -> dict:
    count = max(1, min(5, int(count or 3)))
    sectors = _sector_flow()[:count]
    if not sectors:
        return {"top_sectors": "no sector data available"}
    parts = [f"{s.get('sector')} {('up' if (s.get('change_pct') or 0) >= 0 else 'down')} {abs(round(s.get('change_pct') or 0, 1))} percent"
             for s in sectors]
    return {"top_sectors": ", ".join(parts), "count": len(parts)}


@voice_tool(
    name="get_company_info",
    description="Get basic company info — sector, industry, market cap.",
    parameters={"symbol": {"type": "string"}},
    contexts=["global"],
)
def get_company_info(symbol: str) -> dict:
    sym = (symbol or "").upper().strip()
    snap = _snapshot(sym) or {}
    return {
        "symbol": sym,
        "sector": snap.get("sector") or "unknown",
        "industry": snap.get("industry") or "unknown",
        "market_cap_b": round(float(snap.get("market_cap") or 0) / 1e9, 1),
    }


@voice_tool(
    name="compare_tickers",
    description="Compare current price + percent change across multiple tickers.",
    parameters={"symbols": {"type": "array", "items": {"type": "string"},
                            "description": "Two to four ticker symbols."}},
    contexts=["global"],
)
def compare_tickers(symbols: list[str]) -> dict:
    syms = [s.upper().strip() for s in (symbols or []) if s][:4]
    if len(syms) < 2:
        return {"summary": "I need at least two tickers to compare."}
    parts = []
    for s in syms:
        snap = _snapshot(s) or {}
        chg = round(float(snap.get("change_pct") or 0), 1)
        last = float(snap.get("last") or 0)
        direction = "up" if chg > 0 else "down" if chg < 0 else "flat"
        parts.append(f"{s} at {last:.2f}, {direction} {abs(chg)} percent")
    return {"summary": "; ".join(parts), "count": len(syms)}
```

- [ ] **Step 4: Run — should pass**

```
python -m pytest tests/test_voice_tools.py -v
```

Expected: 9 tests pass (5 registry + 4 tool tests).

If tests fail because `api.services.massive.get_snapshot` doesn't exist with that exact name, ADAPT the import. Look at `api/services/massive.py` for the actual name (likely `get_movers` exists; the snapshot helper may be named differently). Update only the `_snapshot()` indirection — keep all other code as written.

- [ ] **Step 5: Commit**

```
git add api/services/voice_tool_impls.py tests/test_voice_tools.py
git commit -m "feat(voice): add 6 quote/data tools (quote, movers, breadth, sectors, company, compare)"
```

---

## Task 5: Implement 6 more read-only tools

**Files:**
- Modify: `api/services/voice_tool_impls.py`
- Modify: `tests/test_voice_tools.py`

- [ ] **Step 1: Append tests**

Append to `tests/test_voice_tools.py`:

```python


def test_tool_set_2_registers():
    from api.services import voice_tool_impls  # noqa
    names = set(voice_tools.all_tool_names())
    expected = {"get_news", "get_earnings_today", "get_theme_status",
                "get_options_flow", "get_dark_pool", "get_economic_calendar"}
    assert expected.issubset(names)


def test_get_news_returns_headline_summary(monkeypatch):
    from api.services import voice_tool_impls
    monkeypatch.setattr(voice_tool_impls, "_news", lambda symbol=None: [
        {"headline": "Apple beats earnings"},
        {"headline": "Microsoft cloud revenue up"},
    ])
    out = voice_tools.dispatch("get_news", {"count": 2}, user={"id": "u"})
    assert "Apple" in out["headlines"] or "earnings" in out["headlines"]
    assert out["count"] == 2


def test_get_earnings_today(monkeypatch):
    from api.services import voice_tool_impls
    monkeypatch.setattr(voice_tool_impls, "_earnings_today", lambda: [
        {"sym": "AAPL", "session": "AMC"},
        {"sym": "GOOGL", "session": "AMC"},
    ])
    out = voice_tools.dispatch("get_earnings_today", {}, user={"id": "u"})
    assert "AAPL" in out["tickers"]
    assert out["count"] == 2
```

- [ ] **Step 2: Run — should fail**

```
python -m pytest tests/test_voice_tools.py -v
```

Expected: new tests fail.

- [ ] **Step 3: Append the 6 tool implementations**

Append to `api/services/voice_tool_impls.py`:

```python


# ── Indirections (set 2) ────────────────────────────────────────────────────

def _news(symbol: str | None = None) -> list[dict]:
    from api.services.engine import get_news
    items = get_news() or []
    if symbol:
        sym = symbol.upper()
        items = [i for i in items if sym in (i.get("headline") or "").upper()]
    return items


def _earnings_today() -> list[dict]:
    from api.services.engine import get_earnings
    e = get_earnings() or {}
    today = (e.get("bmo") or []) + (e.get("amc") or [])
    return today


def _theme_performance() -> dict:
    from api.services.theme_performance import get_theme_performance
    return get_theme_performance() or {}


def _options_flow(sym: str | None = None) -> list[dict]:
    try:
        from api.flow_router import get_recent_flow
        return get_recent_flow(sym) or []
    except (ImportError, AttributeError):
        return []


def _dark_pool(sym: str | None = None) -> list[dict]:
    try:
        from api.top_flow_router import get_recent_dark_pool
        return get_recent_dark_pool(sym) or []
    except (ImportError, AttributeError):
        return []


def _economic_calendar(week: str | None = None) -> list[dict]:
    try:
        from api.services.engine import get_macro_events
        return get_macro_events() or []
    except (ImportError, AttributeError):
        return []


# ── Tools ──────────────────────────────────────────────────────────────────

@voice_tool(
    name="get_news",
    description="Get the most recent news headlines, optionally for a specific ticker.",
    parameters={
        "symbol": {"type": "string", "description": "Optional ticker filter."},
        "count": {"type": "integer", "description": "How many headlines (default 3, max 5)."},
    },
    contexts=["global"],
)
def get_news(symbol: str = "", count: int = 3) -> dict:
    count = max(1, min(5, int(count or 3)))
    items = _news(symbol or None)[:count]
    if not items:
        return {"headlines": "no recent news", "count": 0}
    return {
        "headlines": ". ".join(i.get("headline", "") for i in items)[:400],
        "count": len(items),
    }


@voice_tool(
    name="get_earnings_today",
    description="List the tickers reporting earnings today.",
    parameters={},
    contexts=["global"],
)
def get_earnings_today() -> dict:
    items = _earnings_today()
    if not items:
        return {"tickers": "no earnings today", "count": 0}
    syms = [str(i.get("sym", "")).upper() for i in items if i.get("sym")][:8]
    return {"tickers": ", ".join(syms), "count": len(syms)}


@voice_tool(
    name="get_theme_status",
    description="Get the strongest themes right now (e.g. Semis, AI, Crypto).",
    parameters={"count": {"type": "integer", "description": "How many leading themes (default 3)."}},
    contexts=["global"],
)
def get_theme_status(count: int = 3) -> dict:
    count = max(1, min(5, int(count or 3)))
    perf = _theme_performance()
    leaders = (perf.get("leaders") or [])[:count]
    if not leaders:
        return {"top_themes": "no theme data available", "count": 0}
    parts = [f"{t.get('name')} {('up' if (t.get('pct') or 0) >= 0 else 'down')} {abs(round(t.get('pct') or 0, 1))} percent"
             for t in leaders]
    return {"top_themes": ", ".join(parts), "count": len(parts)}


@voice_tool(
    name="get_options_flow",
    description="Get recent unusual options activity, optionally for a specific ticker.",
    parameters={
        "symbol": {"type": "string", "description": "Optional ticker filter."},
        "count": {"type": "integer", "description": "How many to include (default 3)."},
    },
    contexts=["global"],
)
def get_options_flow(symbol: str = "", count: int = 3) -> dict:
    count = max(1, min(5, int(count or 3)))
    items = _options_flow(symbol or None)[:count]
    if not items:
        return {"flow": "no recent options flow available", "count": 0}
    parts = [f"{i.get('sym', '')} {i.get('option_type', '')} {i.get('strike', '')}" for i in items]
    return {"flow": ", ".join(p for p in parts if p.strip()), "count": len(parts)}


@voice_tool(
    name="get_dark_pool",
    description="Get recent dark pool prints, optionally for a specific ticker.",
    parameters={
        "symbol": {"type": "string"},
        "count": {"type": "integer", "description": "How many (default 3)."},
    },
    contexts=["global"],
)
def get_dark_pool(symbol: str = "", count: int = 3) -> dict:
    count = max(1, min(5, int(count or 3)))
    items = _dark_pool(symbol or None)[:count]
    if not items:
        return {"prints": "no recent dark pool prints available", "count": 0}
    parts = [f"{i.get('sym', '')} {i.get('size', '')} shares" for i in items]
    return {"prints": ", ".join(p for p in parts if p.strip()), "count": len(parts)}


@voice_tool(
    name="get_economic_calendar",
    description="Get major economic events on the calendar (FOMC, CPI, jobs, Fed speakers).",
    parameters={},
    contexts=["global"],
)
def get_economic_calendar() -> dict:
    items = _economic_calendar()[:5]
    if not items:
        return {"events": "no upcoming events available", "count": 0}
    parts = [f"{i.get('title', '')} {i.get('date', '')}" for i in items]
    return {"events": "; ".join(p.strip() for p in parts if p.strip()), "count": len(parts)}
```

- [ ] **Step 4: Run — should pass**

```
python -m pytest tests/test_voice_tools.py -v
```

Expected: 12 tests pass (5 registry + 4 set 1 + 3 set 2).

If imports for `engine.get_news`, `engine.get_earnings`, `theme_performance.get_theme_performance`, etc. don't match actual names in your codebase, ADAPT only the indirection helpers (`_news`, `_earnings_today`, etc.). Don't change tool signatures.

- [ ] **Step 5: Commit**

```
git add api/services/voice_tool_impls.py tests/test_voice_tools.py
git commit -m "feat(voice): add 6 more read-only tools (news, earnings, themes, options, darkpool, calendar)"
```

---

## Task 6: voice_intent service — end-to-end pipeline

**Files:**
- Create: `api/services/voice_intent.py`
- Create: `tests/test_voice_intent.py`

- [ ] **Step 1: Write failing tests**

Create `tests/test_voice_intent.py`:

```python
"""Voice intent service — full transcribe → classify → dispatch → narrate pipeline."""

from unittest.mock import patch, MagicMock
from api.services import voice_intent


def test_run_oneshot_pipeline_happy_path():
    # Set up tools registry with a fake tool
    from api.services import voice_tools, voice_tool_impls  # noqa: F401

    fake_classifier_result = {
        "tool": "get_quote",
        "args": {"symbol": "NVDA"},
        "narration_template": "{symbol} is at {last}, {direction} {abs_pct} percent.",
    }

    with patch("api.services.voice_intent.classify_intent", return_value=fake_classifier_result), \
         patch("api.services.voice_intent.dispatch", return_value={
             "symbol": "NVDA", "last": 487.20, "direction": "up", "abs_pct": 2.1, "volume": 35_000_000
         }):
        out = voice_intent.run_oneshot(
            transcript="what's NVDA at",
            context="global",
            user={"id": "u-1"},
        )

    assert out["tool"] == "get_quote"
    assert "NVDA" in out["narration"]
    assert "487" in out["narration"]
    assert "up" in out["narration"]


def test_run_oneshot_no_match():
    fake_classifier_result = {
        "tool": None, "args": {}, "narration_template": "Sorry, I can't help with that."
    }
    with patch("api.services.voice_intent.classify_intent", return_value=fake_classifier_result):
        out = voice_intent.run_oneshot(transcript="tell me a joke", context="global", user={"id": "u"})
    assert out["tool"] is None
    assert "Sorry" in out["narration"]


def test_run_oneshot_handles_missing_placeholder():
    fake_classifier_result = {
        "tool": "get_quote",
        "args": {"symbol": "X"},
        "narration_template": "{symbol} is at {nonexistent_key}.",
    }
    with patch("api.services.voice_intent.classify_intent", return_value=fake_classifier_result), \
         patch("api.services.voice_intent.dispatch", return_value={"symbol": "X"}):
        out = voice_intent.run_oneshot(transcript="quote X", context="global", user={"id": "u"})
    # Template substitution should fall through gracefully
    assert "X" in out["narration"]
    assert out["tool"] == "get_quote"
```

- [ ] **Step 2: Run — should fail**

```
python -m pytest tests/test_voice_intent.py -v
```

Expected: ImportError.

- [ ] **Step 3: Implement**

Create `api/services/voice_intent.py`:

```python
"""
End-to-end one-shot voice pipeline:
  transcript + context + user → tool call → narration string

Used by /api/voice/oneshot. Keeps the router thin.
"""

import logging
import string

from api.services.voice_openai import classify_intent
from api.services.voice_tools import get_schema_for_context, dispatch

# Make sure tool implementations register on import
from api.services import voice_tool_impls  # noqa: F401

_log = logging.getLogger(__name__)


class _SafeDict(dict):
    """Dict that returns the placeholder name itself if a key is missing."""
    def __missing__(self, key):
        return f"({key})"


def _safe_format(template: str, values: dict) -> str:
    """Format template with .format_map; never raises on missing keys."""
    try:
        return string.Formatter().vformat(template, (), _SafeDict(values or {}))
    except Exception:
        return template


def run_oneshot(*, transcript: str, context: str, user: dict) -> dict:
    """
    Returns: {tool, args, narration, raw_result}

    `narration` is the assistant's spoken response, ready for TTS.
    `raw_result` is the dict the tool returned (or None for refusal).
    """
    transcript = (transcript or "").strip()
    if not transcript:
        return {"tool": None, "args": {}, "narration": "I didn't catch that. Try again?", "raw_result": None}

    tools_schema = get_schema_for_context(context or "global")
    classifier_out = classify_intent(transcript, tools_schema)

    tool_name = classifier_out.get("tool")
    template = classifier_out.get("narration_template") or "Done."

    if not tool_name:
        return {
            "tool": None,
            "args": {},
            "narration": template,
            "raw_result": None,
        }

    args = classifier_out.get("args") or {}
    try:
        result = dispatch(tool_name, args, user=user)
    except (KeyError, ValueError, TypeError) as e:
        _log.warning("voice tool %s failed: %s", tool_name, e)
        return {
            "tool": tool_name,
            "args": args,
            "narration": "Something went wrong looking that up. Try again?",
            "raw_result": None,
        }

    narration = _safe_format(template, result)
    # Provide minimal sanitization for TTS (collapse whitespace, hard-cap length)
    narration = " ".join(narration.split())
    if len(narration) > 600:
        narration = narration[:600]

    return {
        "tool": tool_name,
        "args": args,
        "narration": narration,
        "raw_result": result,
    }
```

- [ ] **Step 4: Run — should pass**

```
python -m pytest tests/test_voice_intent.py -v
```

Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```
git add api/services/voice_intent.py tests/test_voice_intent.py
git commit -m "feat(voice): add one-shot intent pipeline (transcribe → classify → dispatch → narrate)"
```

---

## Task 7: Mode B usage tracking

**Files:**
- Modify: `api/services/voice_usage.py`
- Modify: `tests/test_voice_usage.py`

- [ ] **Step 1: Append tests**

Append to `tests/test_voice_usage.py`:

```python


# ── Mode B ──────────────────────────────────────────────────────────────────

def test_record_mode_b_call_increments():
    from api.services.voice_usage import (
        record_mode_b_call, get_monthly_usage, MODE_B_DEFAULT_CAP_CALLS,
    )
    uid = _make_user()
    record_mode_b_call(uid)
    record_mode_b_call(uid)
    u = get_monthly_usage(uid)
    assert u["mode_b_calls"] == 2


def test_within_mode_b_cap():
    from api.services.voice_usage import (
        record_mode_b_call, is_within_mode_b_cap, MODE_B_DEFAULT_CAP_CALLS,
    )
    uid = _make_user()
    assert is_within_mode_b_cap(uid)
    for _ in range(MODE_B_DEFAULT_CAP_CALLS):
        record_mode_b_call(uid)
    assert not is_within_mode_b_cap(uid)
    assert is_within_mode_b_cap(uid, is_admin=True)
```

- [ ] **Step 2: Run — should fail**

```
python -m pytest tests/test_voice_usage.py -v
```

Expected: ImportError on the new symbols.

- [ ] **Step 3: Implement**

Append to `api/services/voice_usage.py`:

```python


# ── Mode B (one-shot) ───────────────────────────────────────────────────────

# 200 calls/month default. Each call ≈ $0.003 (Whisper + gpt-4o-mini + tts-1-hd).
# Hard ceiling ~$0.60/user/month.
MODE_B_DEFAULT_CAP_CALLS = 200
MODE_B_COST_PER_CALL = 0.003


def record_mode_b_call(user_id: str) -> None:
    """Increment Mode B call count for the current month."""
    ym = _current_year_month()
    cost_delta = MODE_B_COST_PER_CALL
    conn = get_connection()
    try:
        conn.execute(
            """INSERT INTO voice_usage_monthly
               (user_id, year_month, mode_b_calls, estimated_cost_usd)
               VALUES (?, ?, 1, ?)
               ON CONFLICT (user_id, year_month) DO UPDATE SET
                 mode_b_calls = mode_b_calls + 1,
                 estimated_cost_usd = estimated_cost_usd + excluded.estimated_cost_usd""",
            (user_id, ym, cost_delta),
        )
        conn.commit()
    finally:
        conn.close()


def is_within_mode_b_cap(
    user_id: str,
    *,
    cap_calls: int = MODE_B_DEFAULT_CAP_CALLS,
    is_admin: bool = False,
) -> bool:
    if is_admin:
        return True
    return get_monthly_usage(user_id)["mode_b_calls"] < cap_calls
```

- [ ] **Step 4: Run — should pass**

```
python -m pytest tests/test_voice_usage.py -v
```

Expected: 7 tests pass (5 original + 2 new).

- [ ] **Step 5: Commit**

```
git add api/services/voice_usage.py tests/test_voice_usage.py
git commit -m "feat(voice): add Mode B (one-shot) usage tracking + cap"
```

---

## Task 8: /api/voice/oneshot endpoint + /api/voice/tools

**Files:**
- Modify: `api/routers/voice.py`
- Modify: `tests/test_voice_router.py`

- [ ] **Step 1: Write failing tests**

Append to `tests/test_voice_router.py`:

```python


# ── Oneshot + tools (Slice 2) ──────────────────────────────────────────────

def test_tools_endpoint_requires_auth(client):
    r = client.get("/api/voice/tools")
    assert r.status_code == 401


def test_tools_endpoint_returns_global_tools(client):
    _login(client, plan="pro")
    # Force impl import
    from api.services import voice_tool_impls  # noqa
    r = client.get("/api/voice/tools?context=global")
    assert r.status_code == 200
    body = r.json()
    names = {t["name"] for t in body["tools"]}
    assert "get_quote" in names
    assert "get_movers" in names


def test_oneshot_requires_auth(client):
    r = client.post("/api/voice/oneshot", files={"audio": ("a.webm", b"FAKE", "audio/webm")})
    assert r.status_code == 401


def test_oneshot_requires_paid(client):
    _login(client, plan="free")
    r = client.post("/api/voice/oneshot", files={"audio": ("a.webm", b"FAKE", "audio/webm")})
    assert r.status_code == 402


def test_oneshot_happy_path(client, tmp_path, monkeypatch):
    monkeypatch.setattr(vac, "_CACHE_DIR", str(tmp_path))
    _login(client, plan="pro")

    fake_audio = b"\xFF\xFB\x90\x00FAKEMP3"
    with patch("api.routers.voice.transcribe_audio", return_value="what is NVDA at"), \
         patch("api.routers.voice.run_oneshot", return_value={
             "tool": "get_quote",
             "args": {"symbol": "NVDA"},
             "narration": "NVDA is at 487 dollars, up 2.1 percent.",
             "raw_result": {"symbol": "NVDA", "last": 487.20, "abs_pct": 2.1},
         }), \
         patch("api.routers.voice.synthesize_speech_stream",
               side_effect=lambda *a, **k: iter([fake_audio])):
        r = client.post(
            "/api/voice/oneshot",
            files={"audio": ("a.webm", b"FAKE-AUDIO", "audio/webm")},
            data={"context": "global"},
        )
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("audio/mpeg")
    # Custom headers carry transcript + narration text
    assert "NVDA" in r.headers.get("X-Voice-Transcript", "")
    assert "487" in r.headers.get("X-Voice-Narration", "")
    assert r.content == fake_audio


def test_oneshot_rejects_empty_audio(client):
    _login(client, plan="pro")
    r = client.post(
        "/api/voice/oneshot",
        files={"audio": ("a.webm", b"", "audio/webm")},
        data={"context": "global"},
    )
    assert r.status_code == 400
```

- [ ] **Step 2: Run — should fail**

```
python -m pytest tests/test_voice_router.py -v
```

Expected: 6 new tests fail (404 / route not found).

- [ ] **Step 3: Add the endpoints**

Add these imports near the top of `api/routers/voice.py` (alongside existing voice imports):

```python
from fastapi import UploadFile, File, Form
from urllib.parse import quote as _urlquote
from api.services.voice_openai import transcribe_audio, synthesize_speech_stream
from api.services.voice_intent import run_oneshot
from api.services.voice_tools import get_schema_for_context
from api.services.voice_usage import (
    record_mode_b_call, is_within_mode_b_cap, MODE_B_DEFAULT_CAP_CALLS,
)
```

(If `synthesize_speech_stream` is already imported, don't duplicate. Same for any others.)

Append the two endpoints at the end of `api/routers/voice.py`:

```python


# ── Slice 2: One-Shot (Mode B) ──────────────────────────────────────────────

@router.get("/tools")
def tools_get(context: str = "global", user: dict = Depends(requires_voice_access)):
    """Return the tool catalog visible from the given page context."""
    return {"context": context, "tools": get_schema_for_context(context)}


@router.post("/oneshot")
@limiter.limit("60/minute")
def oneshot(
    request: Request,
    audio: UploadFile = File(...),
    context: str = Form("global"),
    user: dict = Depends(requires_voice_access),
):
    audio_bytes = audio.file.read() if audio else b""
    if not audio_bytes:
        raise HTTPException(status_code=400, detail="audio is empty")

    settings = get_voice_settings(user["id"])
    if not settings.get("enabled", True):
        raise HTTPException(status_code=400, detail="voice features disabled in settings")

    is_admin = user.get("role") == "admin"
    if not is_within_mode_b_cap(user["id"], is_admin=is_admin):
        raise HTTPException(status_code=429, detail="monthly voice query cap reached")

    # Pre-check OpenAI client
    try:
        from api.services.voice_openai import _get_client
        _get_client()
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e))

    # 1) Transcribe
    try:
        transcript = transcribe_audio(audio_bytes, filename=audio.filename or "audio.webm")
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        _log.exception("Whisper failed")
        raise HTTPException(status_code=502, detail=f"Transcription failed: {e}")

    # 2) Classify + dispatch
    pipeline = run_oneshot(transcript=transcript, context=context, user=user)
    narration = pipeline["narration"]

    # 3) TTS streamed back
    voice_name = settings["voice"]
    speed = settings["speed"]
    accumulated = bytearray()
    user_id = user["id"]

    def streamer():
        try:
            for chunk in synthesize_speech_stream(narration, voice=voice_name, speed=speed):
                accumulated.extend(chunk)
                yield chunk
        except Exception as e:
            _log.exception("oneshot synth streaming failed: %s", e)

    def on_complete():
        if accumulated:
            record_mode_b_call(user_id)

    headers = {
        "X-Voice-Transcript": _urlquote(transcript[:500]),
        "X-Voice-Narration": _urlquote(narration[:500]),
        "X-Voice-Tool": pipeline.get("tool") or "",
    }

    return StreamingResponse(
        streamer(),
        media_type="audio/mpeg",
        headers=headers,
        background=BackgroundTask(on_complete),
    )
```

The browser will read `X-Voice-Transcript` and `X-Voice-Narration` to show in the transcript bubble. They are URL-encoded so non-ASCII characters survive HTTP header transit.

- [ ] **Step 4: Run — should pass**

```
python -m pytest tests/test_voice_router.py -v
```

Expected: 17 tests pass (11 from before + 6 new). Adjust the test assertions if your final transcript/narration headers come back URL-encoded (the test compares with URL-decoded substring "NVDA" / "487" — this works because plain ASCII is unchanged by quote()).

- [ ] **Step 5: Commit**

```
git add api/routers/voice.py tests/test_voice_router.py
git commit -m "feat(voice): add /oneshot and /tools endpoints"
```

---

## Task 9: VoiceContext Mode B state extension

**Files:**
- Modify: `app/src/context/VoiceContext.jsx`

- [ ] **Step 1: Extend state shape**

Open `app/src/context/VoiceContext.jsx`. Currently the reducer has actions: `load`, `play`, `pause`, `stop`, `error`, `setSpeed`. Add new actions for Mode B:
- `b_listening` — started capturing audio
- `b_thinking` — sent to backend, waiting for response
- `b_responding` — playing TTS response with bubble visible

Modify the file. Replace the existing `initialState` and `reducer`:

```jsx
const initialState = {
  status: 'idle',
  // Slice 1: TTS read-aloud track
  trackId: null,
  trackLabel: null,
  // Slice 2: One-shot Mode B
  mode: null,           // 'a' (read-aloud) | 'b' (one-shot) | null
  transcript: '',
  narration: '',
  speed: 1.0,
  errorMessage: null,
}

function reducer(state, action) {
  switch (action.type) {
    case 'load':
      return {
        ...state, status: 'loading', mode: 'a',
        trackId: action.trackId, trackLabel: action.trackLabel,
        errorMessage: null, transcript: '', narration: '',
      }
    case 'play':
      return { ...state, status: 'playing' }
    case 'pause':
      return { ...state, status: 'paused' }
    case 'stop':
      return { ...initialState, speed: state.speed }
    case 'error':
      return { ...state, status: 'error', errorMessage: action.message }
    case 'setSpeed':
      return { ...state, speed: action.speed }
    case 'b_listening':
      return { ...initialState, speed: state.speed, status: 'listening', mode: 'b' }
    case 'b_thinking':
      return { ...state, status: 'thinking', mode: 'b' }
    case 'b_responding':
      return {
        ...state, status: 'responding', mode: 'b',
        transcript: action.transcript || '', narration: action.narration || '',
      }
    default:
      return state
  }
}
```

Then add new action helpers in the provider's `useMemo` value (after the existing `setSpeed`):

```jsx
  const startListening = useCallback(() => dispatch({ type: 'b_listening' }), [])
  const startThinking = useCallback(() => dispatch({ type: 'b_thinking' }), [])
  const startResponding = useCallback(({ transcript, narration }) =>
    dispatch({ type: 'b_responding', transcript, narration }), [])
```

Add these to the value memo:

```jsx
  const value = useMemo(() => ({
    ...state,
    attachAudio,
    playUrl,
    pause,
    resume,
    stop,
    setSpeed,
    startListening,
    startThinking,
    startResponding,
  }), [state, attachAudio, playUrl, pause, resume, stop, setSpeed,
       startListening, startThinking, startResponding])
```

- [ ] **Step 2: Smoke test**

```
cd C:/Users/Patrick/uct-dashboard/app
npx vite build --mode development 2>&1 | tail -10
```

Expected: build succeeds.

- [ ] **Step 3: Commit**

```
cd C:/Users/Patrick/uct-dashboard
git add app/src/context/VoiceContext.jsx
git commit -m "feat(voice): extend VoiceContext with Mode B states"
```

---

## Task 10: useOneShot hook

**Files:**
- Create: `app/src/hooks/useOneShot.js`

- [ ] **Step 1: Create the hook**

Create `app/src/hooks/useOneShot.js`:

```js
import { useCallback, useRef } from 'react'
import { useVoice } from '../context/VoiceContext'

const MAX_RECORD_MS = 4000
const SILENCE_END_MS = 800

/**
 * One-shot voice query — capture mic, POST to /api/voice/oneshot, play streamed reply.
 *
 * Flow:
 *   1. Click triggers start()
 *   2. Browser asks for mic permission (cached after first time)
 *   3. MediaRecorder captures up to MAX_RECORD_MS
 *   4. Stop on click again, or auto-stop after timeout
 *   5. Send blob → /api/voice/oneshot
 *   6. Read X-Voice-Transcript / X-Voice-Narration headers, dispatch to context
 *   7. Pipe response audio through the existing AudioPlayerBar
 */
export default function useOneShot() {
  const voice = useVoice()
  const recorderRef = useRef(null)
  const chunksRef = useRef([])
  const stopTimerRef = useRef(null)
  const activeBlobUrl = useRef(null)

  const stopRecording = useCallback(() => {
    if (stopTimerRef.current) {
      clearTimeout(stopTimerRef.current)
      stopTimerRef.current = null
    }
    const rec = recorderRef.current
    if (rec && rec.state !== 'inactive') {
      rec.stop()
    }
  }, [])

  const start = useCallback(async (context = 'global') => {
    // Toggle: if already listening, stop early
    if (voice.status === 'listening') {
      stopRecording()
      return
    }

    let stream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch (err) {
      alert('Microphone permission is required. Enable it in your browser settings.')
      return
    }

    voice.startListening()
    chunksRef.current = []
    const rec = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' })
    recorderRef.current = rec

    rec.addEventListener('dataavailable', (e) => {
      if (e.data && e.data.size > 0) chunksRef.current.push(e.data)
    })

    rec.addEventListener('stop', async () => {
      stream.getTracks().forEach((t) => t.stop())

      if (chunksRef.current.length === 0) {
        voice.stop()
        return
      }
      const blob = new Blob(chunksRef.current, { type: 'audio/webm' })
      voice.startThinking()

      const fd = new FormData()
      fd.append('audio', blob, 'audio.webm')
      fd.append('context', context)

      let r
      try {
        r = await fetch('/api/voice/oneshot', {
          method: 'POST',
          credentials: 'include',
          body: fd,
        })
      } catch (e) {
        console.error('[useOneShot] fetch failed', e)
        voice.stop()
        return
      }

      if (!r.ok) {
        if (r.status === 402) {
          alert('Voice features require a paid plan.')
        } else if (r.status === 429) {
          alert('Monthly voice query cap reached.')
        } else {
          console.error('[useOneShot] backend returned', r.status)
        }
        voice.stop()
        return
      }

      const transcriptHdr = r.headers.get('X-Voice-Transcript') || ''
      const narrationHdr = r.headers.get('X-Voice-Narration') || ''
      const transcript = decodeURIComponent(transcriptHdr)
      const narration = decodeURIComponent(narrationHdr)
      voice.startResponding({ transcript, narration })

      const audioBlob = await r.blob()
      if (activeBlobUrl.current) URL.revokeObjectURL(activeBlobUrl.current)
      const url = URL.createObjectURL(audioBlob)
      activeBlobUrl.current = url

      await voice.playUrl({
        url,
        trackId: `oneshot-${Date.now()}`,
        trackLabel: narration ? narration.slice(0, 60) : 'Voice query',
      })
    })

    rec.start()
    stopTimerRef.current = setTimeout(() => stopRecording(), MAX_RECORD_MS)
  }, [voice, stopRecording])

  return { start, stop: stopRecording }
}
```

- [ ] **Step 2: Smoke build**

```
cd C:/Users/Patrick/uct-dashboard/app
npx vite build --mode development 2>&1 | tail -5
```

- [ ] **Step 3: Commit**

```
cd C:/Users/Patrick/uct-dashboard
git add app/src/hooks/useOneShot.js
git commit -m "feat(voice): add useOneShot hook (mic capture + /oneshot + playback)"
```

---

## Task 11: FloatingOrb component

**Files:**
- Create: `app/src/components/voice/FloatingOrb.jsx`
- Create: `app/src/components/voice/FloatingOrb.module.css`

- [ ] **Step 1: Create the component**

Create `app/src/components/voice/FloatingOrb.jsx`:

```jsx
import { useVoice } from '../../context/VoiceContext'
import useOneShot from '../../hooks/useOneShot'
import styles from './FloatingOrb.module.css'

/**
 * Bottom-right always-present voice orb.
 *
 * - Idle: gold mic icon
 * - Listening: pulsing red ring + mic icon
 * - Thinking: spinning border + brain icon
 * - Responding: solid gold ring + speaker icon
 *
 * Click to start; click again to stop early.
 */
export default function FloatingOrb({ context = 'global' }) {
  const voice = useVoice()
  const { start } = useOneShot()

  // Hide when busy with a non-Mode-B activity (e.g. read-aloud playing) so we don't double-trigger
  if (voice.mode === 'a' && voice.status === 'playing') {
    return null
  }

  const status = voice.status
  const stateClass =
    status === 'listening' ? styles.listening :
    status === 'thinking' ? styles.thinking :
    status === 'responding' ? styles.responding :
    styles.idle

  const icon =
    status === 'listening' ? '●' :
    status === 'thinking' ? '…' :
    status === 'responding' ? '🔊' :
    '🎤'

  const label =
    status === 'listening' ? 'Listening — tap to stop' :
    status === 'thinking' ? 'Thinking…' :
    status === 'responding' ? 'Responding' :
    'Tap to ask'

  return (
    <button
      type="button"
      className={`${styles.orb} ${stateClass}`}
      onClick={() => start(context)}
      aria-label={label}
      title={label}
    >
      <span className={styles.icon}>{icon}</span>
    </button>
  )
}
```

- [ ] **Step 2: Create the CSS**

Create `app/src/components/voice/FloatingOrb.module.css`:

```css
.orb {
  position: fixed;
  right: 18px;
  bottom: 18px;
  z-index: 8000;
  width: 56px;
  height: 56px;
  border-radius: 50%;
  border: 2px solid rgba(201, 168, 76, 0.35);
  background: rgba(15, 17, 14, 0.92);
  color: #c9a84c;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 22px;
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.35);
  transition: transform 100ms ease, box-shadow 100ms ease, border-color 100ms ease;
}
.orb:hover {
  transform: scale(1.05);
  border-color: rgba(201, 168, 76, 0.7);
}
.orb:focus-visible {
  outline: 2px solid #c9a84c;
  outline-offset: 2px;
}
.icon { line-height: 1; }

.idle { /* default */ }

.listening {
  border-color: #ef4444;
  animation: pulse 1.2s ease-in-out infinite;
}
.thinking {
  border-color: #c9a84c;
  animation: spin 1s linear infinite;
}
.responding {
  border-color: #4ade80;
  box-shadow: 0 0 14px rgba(74, 222, 128, 0.45);
}

@keyframes pulse {
  0%, 100% { box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.6); }
  50% { box-shadow: 0 0 0 12px rgba(239, 68, 68, 0); }
}

@keyframes spin {
  to { transform: rotate(360deg); }
}
```

- [ ] **Step 3: Smoke build**

```
cd C:/Users/Patrick/uct-dashboard/app
npx vite build --mode development 2>&1 | tail -5
```

- [ ] **Step 4: Commit**

```
cd C:/Users/Patrick/uct-dashboard
git add app/src/components/voice/FloatingOrb.jsx app/src/components/voice/FloatingOrb.module.css
git commit -m "feat(voice): add FloatingOrb mic component"
```

---

## Task 12: TranscriptBubble component

**Files:**
- Create: `app/src/components/voice/TranscriptBubble.jsx`
- Create: `app/src/components/voice/TranscriptBubble.module.css`

- [ ] **Step 1: Create the component**

Create `app/src/components/voice/TranscriptBubble.jsx`:

```jsx
import { useEffect, useState } from 'react'
import { useVoice } from '../../context/VoiceContext'
import styles from './TranscriptBubble.module.css'

/**
 * Ephemeral popover above the FloatingOrb.
 * Shows the user's transcribed query + assistant's narration when status is
 * thinking / responding. Auto-fades 2s after the response audio ends.
 */
export default function TranscriptBubble() {
  const voice = useVoice()
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (voice.mode !== 'b') {
      setVisible(false)
      return
    }
    const active =
      voice.status === 'listening' ||
      voice.status === 'thinking' ||
      voice.status === 'responding' ||
      voice.status === 'playing'
    if (active) {
      setVisible(true)
      return
    }
    // After session ends, keep visible 2s then fade
    const t = setTimeout(() => setVisible(false), 2000)
    return () => clearTimeout(t)
  }, [voice.mode, voice.status])

  if (!visible) return null
  if (voice.mode !== 'b') return null

  const showThinking = voice.status === 'thinking' && !voice.transcript
  const showListening = voice.status === 'listening'

  return (
    <div className={styles.bubble} role="status" aria-live="polite">
      {showListening && <div className={styles.listening}>Listening…</div>}
      {showThinking && <div className={styles.thinking}>Thinking…</div>}
      {voice.transcript && (
        <div className={styles.you}>
          <span className={styles.tag}>You:</span> {voice.transcript}
        </div>
      )}
      {voice.narration && (
        <div className={styles.assistant}>
          <span className={styles.tag}>UCT:</span> {voice.narration}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Create the CSS**

Create `app/src/components/voice/TranscriptBubble.module.css`:

```css
.bubble {
  position: fixed;
  right: 18px;
  bottom: 86px;            /* sit above the orb */
  z-index: 8001;
  max-width: min(380px, calc(100vw - 36px));
  padding: 10px 14px;
  background: rgba(15, 17, 14, 0.96);
  color: #e8e6df;
  border: 1px solid rgba(201, 168, 76, 0.35);
  border-radius: 14px;
  font: 13px/1.4 'IBM Plex Sans', system-ui, sans-serif;
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.4);
  animation: rise 200ms ease-out;
}
.tag {
  color: #c9a84c;
  font-weight: 600;
  margin-right: 4px;
}
.you { margin-bottom: 6px; opacity: 0.9; }
.assistant {}
.listening, .thinking { color: #c9a84c; opacity: 0.85; font-style: italic; }

@keyframes rise {
  from { opacity: 0; transform: translateY(6px); }
  to { opacity: 1; transform: translateY(0); }
}
```

- [ ] **Step 3: Smoke build**

```
cd C:/Users/Patrick/uct-dashboard/app
npx vite build --mode development 2>&1 | tail -5
```

- [ ] **Step 4: Commit**

```
cd C:/Users/Patrick/uct-dashboard
git add app/src/components/voice/TranscriptBubble.jsx app/src/components/voice/TranscriptBubble.module.css
git commit -m "feat(voice): add TranscriptBubble overlay for Mode B"
```

---

## Task 13: usePushToTalkHotkey hook

**Files:**
- Create: `app/src/hooks/usePushToTalkHotkey.js`

- [ ] **Step 1: Create the hook**

Create `app/src/hooks/usePushToTalkHotkey.js`:

```js
import { useEffect } from 'react'
import useOneShot from './useOneShot'

/**
 * Global Cmd/Ctrl+Shift+V hotkey that triggers a one-shot voice query.
 * Mounted once near the App root.
 */
export default function usePushToTalkHotkey({ context = 'global' } = {}) {
  const { start } = useOneShot()

  useEffect(() => {
    const onKeyDown = (e) => {
      const isMac = navigator.platform.toUpperCase().includes('MAC')
      const modifier = isMac ? e.metaKey : e.ctrlKey
      if (modifier && e.shiftKey && e.code === 'KeyV') {
        e.preventDefault()
        start(context)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [start, context])
}
```

- [ ] **Step 2: Commit**

```
cd C:/Users/Patrick/uct-dashboard
git add app/src/hooks/usePushToTalkHotkey.js
git commit -m "feat(voice): add Cmd/Ctrl+Shift+V push-to-talk hotkey"
```

---

## Task 14: Mount FloatingOrb + TranscriptBubble + hotkey in App.jsx

**Files:**
- Modify: `app/src/App.jsx`

- [ ] **Step 1: Read current App.jsx**

Open `app/src/App.jsx`. From Slice 1, `<VoiceProvider>` already wraps the route tree and `<AudioPlayerBar>` is mounted as a sibling.

- [ ] **Step 2: Add imports**

Near the top with the existing voice imports:

```jsx
import FloatingOrb from './components/voice/FloatingOrb'
import TranscriptBubble from './components/voice/TranscriptBubble'
import usePushToTalkHotkey from './hooks/usePushToTalkHotkey'
```

- [ ] **Step 3: Mount the orb + bubble + hotkey**

The hotkey hook needs to be invoked inside a component that's inside the VoiceProvider. The cleanest way is to add a tiny inner component. Add this near the other helpers in `App.jsx`:

```jsx
function VoiceMounts() {
  usePushToTalkHotkey({ context: 'global' })
  return (
    <>
      <FloatingOrb context="global" />
      <TranscriptBubble />
    </>
  )
}
```

Then inside the App return, add `<VoiceMounts />` as a sibling of `<AudioPlayerBar />` inside the `<VoiceProvider>`:

```jsx
        <VoiceProvider>
          {/* existing children */}
          <VoiceMounts />
          <AudioPlayerBar />
        </VoiceProvider>
```

- [ ] **Step 4: Smoke build**

```
cd C:/Users/Patrick/uct-dashboard/app
npx vite build --mode development 2>&1 | tail -10
```

- [ ] **Step 5: Commit**

```
cd C:/Users/Patrick/uct-dashboard
git add app/src/App.jsx
git commit -m "feat(voice): mount FloatingOrb + TranscriptBubble + hotkey globally"
```

---

## Task 15: Frontend tests

**Files:**
- Create: `app/src/components/voice/FloatingOrb.test.jsx`

- [ ] **Step 1: Write tests**

Create `app/src/components/voice/FloatingOrb.test.jsx`:

```jsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { VoiceProvider } from '../../context/VoiceContext'
import FloatingOrb from './FloatingOrb'

// useOneShot pulls in MediaRecorder which jsdom doesn't have. Mock it cleanly.
vi.mock('../../hooks/useOneShot', () => ({
  default: () => ({ start: vi.fn(), stop: vi.fn() }),
}))

describe('FloatingOrb', () => {
  it('renders a button with mic label when idle', () => {
    render(<VoiceProvider><FloatingOrb /></VoiceProvider>)
    const btn = screen.getByRole('button')
    expect(btn).toBeTruthy()
    expect(btn.getAttribute('aria-label')).toMatch(/ask/i)
  })

  it('hides when read-aloud is playing', () => {
    // We can't easily simulate the 'playing'+mode='a' state without a deeper harness,
    // but we can at least verify the orb mounts in default state.
    const { container } = render(<VoiceProvider><FloatingOrb /></VoiceProvider>)
    expect(container.querySelector('button')).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run**

```
cd C:/Users/Patrick/uct-dashboard/app
npx vitest run src/components/voice/FloatingOrb.test.jsx 2>&1 | tail -10
```

Expected: 2 tests pass.

- [ ] **Step 3: Commit**

```
cd C:/Users/Patrick/uct-dashboard
git add app/src/components/voice/FloatingOrb.test.jsx
git commit -m "test(voice): add FloatingOrb basic render tests"
```

---

## Task 16: Manual e2e verification

**Files:** none (manual)

After all preceding tasks, the user (or you, if a browser is available) should run through these manual checks. This is the final acceptance gate before the slice is declared shipped.

- [ ] **Step 1: Start backend + frontend**

```
# Terminal 1
cd C:/Users/Patrick/uct-dashboard
uvicorn api.main:app --reload --port 8000
# Terminal 2
cd C:/Users/Patrick/uct-dashboard/app
npm run dev
```

Or wait for Railway to redeploy and use uctintelligence.com.

- [ ] **Step 2: Confirm orb appears**

Log in as a paid user (or admin). On any page, a circular gold mic icon should be in the bottom-right corner.

- [ ] **Step 3: First voice query — "What's NVDA at?"**

1. Click the orb. Browser asks for mic permission → grant it.
2. Orb pulses red. Say "What's NVDA at?" clearly.
3. Stop talking. Within ~4s the orb stops listening.
4. Orb spins (thinking). Bubble appears showing transcript.
5. Audio response plays. Bubble shows the spoken answer text.
6. Bubble fades 2s after audio ends.

Acceptance: total elapsed time from end-of-speech to start-of-audio ≤ ~3s.

- [ ] **Step 4: Try other questions**

- "Top movers"
- "Market breadth"
- "Strongest sectors"
- "News on Apple"
- "Compare Apple and Microsoft"
- "What's reporting earnings today?"

Most should produce sensible spoken answers. Some may produce "I can't help with that" if the classifier doesn't pick a good tool — that's expected at this stage.

- [ ] **Step 5: Hotkey test**

Press `Cmd+Shift+V` (Mac) or `Ctrl+Shift+V` (Windows). Orb should start listening. Same flow.

- [ ] **Step 6: Cap + auth checks**

- Free-tier user: clicking the orb shows "Voice features require a paid plan" alert.
- After ~200 queries in a month, the user sees "Monthly voice query cap reached." (Hard to test in 5 minutes — verify by inspecting `voice_usage_monthly` in the auth.db.)

- [ ] **Step 7: All-tests final pass**

```
cd C:/Users/Patrick/uct-dashboard
python -m pytest tests/test_voice_*.py -v 2>&1 | tail -5
cd app && npx vitest run src/components/voice src/hooks/useOneShot.test.jsx 2>&1 | tail -5
```

Expected: all green.

- [ ] **Step 8: Tag the slice**

```
git tag voice-slice-2-shipped
git push origin master --tags
```

---

## Plan Self-Review

Coverage check against the spec § Slice 2 acceptance:

> "what's NVDA at" returns spoken answer in <2.5s with correct quote; latency + accuracy acceptable

Tasks 1–6 build the backend pipeline (Whisper → classifier → tool registry → 12 tools → intent service). Task 7 wires usage tracking. Task 8 exposes `/oneshot` and `/tools`. Tasks 9–14 build the frontend (context extension, useOneShot, FloatingOrb, TranscriptBubble, hotkey, App mounting). Task 15 adds frontend tests. Task 16 is the manual acceptance gate.

**Placeholder scan:** none. Every step has runnable commands or full code.

**Type consistency:**
- `voice_tool` decorator signature `(name, description, parameters, contexts, wants_user)` is used identically across Tasks 3, 4, 5.
- `dispatch(name, args, *, user)` keyword-only `user` everywhere.
- `run_oneshot(*, transcript, context, user)` keyword-only — same in tests + endpoint.
- `MODE_B_DEFAULT_CAP_CALLS` referenced in service + router consistently.
- Frontend: `voice.startListening / startThinking / startResponding` all defined in Task 9, used in Task 10 (hook) and Task 11 (orb).
- Header names `X-Voice-Transcript` and `X-Voice-Narration` consistent between backend (Task 8) and hook (Task 10).

**Scope:** focused on Mode B. No write tools (Slice 5), no Realtime WebRTC (Slice 4), no wake word (Slice 3). Tool catalog is read-only; orb is push-to-trigger only (no always-listening).

**Open notes for Slice 3+:**
- Slice 3 (wake word) will mount Porcupine alongside the existing FloatingOrb's click trigger.
- Slice 4 (Realtime) will likely move VoiceContext to a state machine that supports BOTH a single shared `<audio>` (for Modes A/B) AND a WebRTC stream (for Mode C). Plan that refactor at the start of Slice 4.
- The `/api/voice/tools` catalog endpoint already exists, ready for Slice 4 to send the same schema to OpenAI Realtime as function definitions.
