"""R93, session 23 (2026-09-18) — a LOCAL-ONLY prompt variant, under its OWN extractor_version.

⛔⛔ NEVER IMPORTED BY THE PAID PATH. This module exists so a local-model quality question
("does explicit verbatim-copy emphasis + few-shot help on top of schema-constrained decoding?")
can be tested WITHOUT touching prompt.py — that file's hash is pinned in production's accepted
gate row (wx-v0-fc47bc97); changing it would shut the paid extractor and invalidate every prior
gate comparison. This module only READS from prompt.py (system_prompt, api_schema, user_message,
record_fields) — it builds on top, never mutates the shared module or its file.

WHAT IS DIFFERENT FROM prompt.py, and why each change is additive, not a rewrite:
1. `quote` moved FIRST in the schema's `properties`/`required` order (a copy of api_schema(),
   never the original dict — see _reorder_quote_first). JSON-schema-to-grammar conversion
   generally walks `properties` in declaration order, so this asks the constrained decoder to
   commit to the anchoring span before any other field.
2. An explicit instruction appended AFTER the shared rules text: copy `quote` verbatim from the
   segment, or omit the record. This does not replace a single word of prompt.system_prompt()'s
   own text.
3. Two few-shot example turns (user segment -> assistant JSON), inserted before the real
   segment's user message. THE EXAMPLE CONTENT ITSELF LIVES IN data/wisdom/ (gitignored,
   quote-bearing) and is loaded at runtime, never embedded as a literal string here — this file
   is committed to a public repo and states rules, exactly like prompt.py's own header promises
   for itself.

VERSIONING. `extractor_version_v2()` hashes the v2 system text + the few-shot file's bytes +
the reordered schema + a version tag — so a different few-shot set, or the file going missing,
produces a DIFFERENT version rather than silently reconciling against a prior run's numbers.
"""
from __future__ import annotations

import copy
import hashlib
import json
import pathlib
from typing import Optional

from api.services.wisdom.extract import prompt

FEWSHOT_FILE = prompt.REPO_ROOT / "data" / "wisdom" / "local-prompt-v2-fewshot.json"

VERBATIM_INSTRUCTION = (
    "\nCRITICAL — QUOTE FIELD (session-23 local addendum, not part of the base rules above):\n"
    "`quote` must be copied EXACTLY, character-for-character, from the segment text shown to "
    "you — the same casing, the same punctuation, the same whitespace. Do not paraphrase, "
    "summarize, correct, or shorten it. If you cannot find an exact verbatim span in THIS "
    "segment that supports a record, do not emit that record at all — omit it rather than "
    "invent or approximate a quote.\n"
)


def _reorder_quote_first(schema: dict) -> dict:
    """A COPY of api_schema() with `quote` moved first in the RECORD object's properties and
    required list. Never mutates the object prompt.py's own callers hold.

    ⛔⛔ `quote` lives NESTED at properties.records.items.properties.quote — the top level is
    the segment wrapper (`segment_id`, `records`), never `quote` itself. A first version of
    this function reordered the TOP level, found no `quote` key there, and silently did
    nothing — a vacuous mutation that reported success by never having anything to fail.
    Caught by asserting the schema's OWN first properties key after the call, not by reading
    this function's return value and assuming it worked."""
    out = copy.deepcopy(schema)
    items = out.get("properties", {}).get("records", {}).get("items")
    if not isinstance(items, dict):
        return out
    props = items.get("properties")
    if isinstance(props, dict) and "quote" in props:
        reordered = {"quote": props["quote"]}
        reordered.update({k: v for k, v in props.items() if k != "quote"})
        items["properties"] = reordered
    req = items.get("required")
    if isinstance(req, list) and "quote" in req:
        items["required"] = ["quote"] + [r for r in req if r != "quote"]
    return out


def system_prompt_v2() -> str:
    return prompt.system_prompt() + VERBATIM_INSTRUCTION


def _load_fewshot() -> list[dict]:
    if not FEWSHOT_FILE.exists():
        return []
    return json.loads(FEWSHOT_FILE.read_text(encoding="utf-8"))


def _fewshot_messages() -> list[dict]:
    """Renders each stored exemplar as a user/assistant turn pair, using the SAME
    user_message() shape the real segment gets — the model sees an identical envelope in the
    example as in the real question, differing only in content."""
    out = []
    for ex in _load_fewshot():
        segment = {"segment_id": ex["segment_id"], "text": ex["segment_text"], "kind": "example"}
        user_text = prompt.user_message(segment, ex.get("source") or {})
        target = ex["target"]
        assistant_obj = {"segment_id": ex["segment_id"],
                         "records": [{"record_type": target["record_type"],
                                      "quote": target["quote"],
                                      "ticker": target.get("ticker")}]}
        out.append({"role": "user", "content": user_text})
        out.append({"role": "assistant", "content": json.dumps(assistant_obj, ensure_ascii=True)})
    return out


def extractor_version_v2() -> str:
    from api.services.wisdom.extract import config, local_backend

    fewshot_bytes = FEWSHOT_FILE.read_bytes() if FEWSHOT_FILE.exists() else b""
    schema_text = json.dumps(_reorder_quote_first(prompt.api_schema()), sort_keys=True)
    digest = hashlib.sha256(
        "\n\x1e\n".join([system_prompt_v2(), schema_text]).encode("utf-8") + b"\x1e" + fewshot_bytes
    ).hexdigest()
    if not config.is_local():
        raise RuntimeError("local_prompt_v2 is a LOCAL-ONLY variant; refusing under a paid backend")
    slug = local_backend.local_model().lower()
    import re
    slug = re.sub("[^a-z0-9]+", "-", slug).strip("-")[:20]
    return f"wx-local-v2-{slug}-{digest[:8]}"


def build_params_v2(segment: dict, source: dict, *, model: str, effort: str,
                    max_tokens: int = prompt.MAX_TOKENS) -> dict:
    """Same shape as prompt.build_params(), with: v2 system text, few-shot turns inserted
    before the real question, and the quote-first schema. Every other field (model, effort,
    max_tokens, transport shape) is identical."""
    messages = _fewshot_messages() + [{"role": "user", "content": prompt.user_message(segment, source)}]
    return {
        "model": model,
        "max_tokens": int(max_tokens),
        "system": [{"type": "text", "text": system_prompt_v2(), "cache_control": {"type": "ephemeral"}}],
        "messages": messages,
        "output_config": {"format": {"type": "json_schema", "schema": _reorder_quote_first(prompt.api_schema())},
                          "effort": effort},
    }
