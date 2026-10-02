"""Wave 11 lane 11A -- a voice note's AI-written summary keeps its provenance
label everywhere the note is read: the editor (AskInsertView) and the exports
(Markdown and Word share `notes_export._ask_insert_head_parts`).

  * The label words are ONE fact in two files: AskInsertView's
    AI_SUMMARY_ACTION_LABELS and notes_export's _AI_SUMMARY_ACTION_LABELS,
    pinned equal here by parsing the client source.
  * The export says "Compass · Voice note summary · <model>" and introduces the
    block's `question` as the SOURCE, never as something the member asked.
  * Writing help's own label map is untouched (its rail pins it to the four
    writing-help actions).
"""
from __future__ import annotations

import pathlib
import re

REPO = pathlib.Path(__file__).resolve().parents[1]


def _insert(attrs):
    return {"type": "askInsert", "attrs": attrs,
            "content": [{"type": "paragraph", "content": [{"type": "text", "text": "Body."}]}]}


def test_the_summary_label_is_one_fact_in_the_editor_and_the_export():
    from api.services.journal_two import notes_export
    src = (REPO / "app/src/pages/journal-2-0/components/notebook/AskInsertView.jsx").read_text(encoding="utf-8")
    block = src[src.index("AI_SUMMARY_ACTION_LABELS = Object.freeze({"):]
    block = block[:block.index("})")]
    js = dict(re.findall(r"(\w+): '([^']+)'", block))
    assert js == notes_export._AI_SUMMARY_ACTION_LABELS == {"voice_summary": "Voice note summary"}
    # The client's action constant is the key, not a second spelling of it.
    lib = (REPO / "app/src/pages/journal-2-0/lib/voiceNote.js").read_text(encoding="utf-8")
    assert "export const VOICE_SUMMARY_ACTION = 'voice_summary'" in lib


def test_the_export_labels_a_voice_summary_as_AI_written_with_its_source():
    from api.services.journal_two import notes_export
    md = notes_export._block(_insert({
        "insertedAt": "2026-10-01T13:41:00Z", "scope": None,
        "question": "Recording", "action": "voice_summary", "model": "claude-sonnet-5"}))
    assert md.split("\n")[0] == (
        "> **Compass · Voice note summary · claude-sonnet-5** · 2026-10-01 · Source: Recording")
    assert "> Body." in md


def test_writing_help_labels_are_unchanged():
    from api.services.journal_two import notes_export
    md = notes_export._block(_insert({
        "insertedAt": "2026-09-25T13:41:00Z", "scope": "selection",
        "question": "Rewrite — shorter", "action": "rewrite", "model": "claude-sonnet-5"}))
    assert md.split("\n")[0] == (
        "> **Compass · Rewrite · claude-sonnet-5** · 2026-09-25 · Asked: Rewrite — shorter")
    assert "voice_summary" not in notes_export._WRITING_HELP_ACTION_LABELS


def test_the_locked_sentence_the_client_shows_is_the_servers():
    from api.services.journal_two import notes as notes_service
    lib = (REPO / "app/src/pages/journal-2-0/lib/voiceNote.js").read_text(encoding="utf-8")
    m = re.search(r"export const VOICE_NOTE_LOCKED_SENTENCE = '([^']+)'", lib)
    assert m and m.group(1) == notes_service.LOCKED_APPEND_SENTENCE
