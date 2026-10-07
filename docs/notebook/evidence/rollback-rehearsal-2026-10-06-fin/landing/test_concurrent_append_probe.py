"""Lane ROLLBACK, 2026-10-07. Is the append door losing writes, or was the rail blind?

A discriminating probe, independent of tests/test_notes_cas_is_atomic.py and of any SQL text:
N threads fire at ONE note at once through the real service functions, each on its own
connection to one temporary WAL database (production's mode). 24 appends (8 per append door,
each with its own marker) and 8 editor saves that all hold the SAME baseline.

Counted afterwards, from the STORED body:
  * landed    an append that returned a note and whose marker is in the stored body
  * lost      an append that returned a note and whose marker is NOT in the stored body
  * duplicate a marker stored more than once
  * editor    how many of the 8 same-baseline saves were told "saved" (at most one may be), and
              whether that one's words are still there

A lost or duplicated append, or two acknowledged same-baseline saves, is a product defect.
Run from the repository root on any tree (it names nothing newer than wave 10):

    python -m pytest docs/notebook/evidence/rollback-rehearsal-2026-10-06-fin/landing/test_concurrent_append_probe.py -q -s
"""
from __future__ import annotations

import json
import sqlite3
import threading

from api.services.journal_two import notes as svc
from api.services.journal_two.db import ensure_schema

USER = "u-probe"
ROUNDS = 5
PER_DOOR = 8
EDITORS = 8


def _open(path):
    c = sqlite3.connect(path, timeout=30)
    c.row_factory = sqlite3.Row
    return c


def _doc(text):
    return {"type": "doc", "content": [{"type": "paragraph", "content": [{"type": "text", "text": text}]}]}


def _one_round(path: str, rnd: int) -> dict:
    c = _open(path)
    note = svc.create_note(USER, {"title": f"probe {rnd}", "bodyJson": _doc("seed words")}, conn=c)
    c.close()
    nid, base = note["id"], note["updatedAt"]
    start = threading.Barrier(PER_DOOR * 3 + EDITORS)
    results: list[tuple[str, str, str]] = []          # (kind, marker, outcome)
    guard = threading.Lock()

    def worker(kind: str, marker: str):
        conn = _open(path)
        try:
            start.wait(30)
            if kind == "embed":
                out = svc.append_widget_embed(USER, nid, {"widgetId": marker}, conn=conn)
            elif kind == "fact":
                out = svc.append_financial_fact(USER, nid, marker, conn=conn)
            elif kind == "excerpt":
                out = svc.append_document_excerpt(USER, nid, marker, conn=conn)
            else:
                out = svc.update_note(USER, nid, {"bodyJson": _doc(marker)}, conn=conn,
                                      expected_updated_at=base)
            outcome = "acknowledged" if out is not None else "none"
        except svc.NoteConflictError:
            outcome = "refused-409"
        except Exception as e:  # noqa: BLE001 -- counted and printed, never swallowed
            outcome = f"error {type(e).__name__}: {e}"
        finally:
            conn.close()
        with guard:
            results.append((kind, marker, outcome))

    threads = []
    for kind in ("embed", "fact", "excerpt"):
        threads += [threading.Thread(target=worker, args=(kind, f"{kind}-r{rnd}-n{i}-marker")) for i in range(PER_DOOR)]
    threads += [threading.Thread(target=worker, args=("editor", f"EDITOR-r{rnd}-n{i}-WORDS")) for i in range(EDITORS)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(120)
    assert not any(t.is_alive() for t in threads), "a writer never finished"

    c = _open(path)
    body = c.execute("SELECT body_json FROM j2_notes WHERE id = ?", (nid,)).fetchone()["body_json"]
    c.close()
    json.loads(body)                                   # the stored body is still one valid document
    appends = [r for r in results if r[0] != "editor"]
    editors = [r for r in results if r[0] == "editor"]
    ack_editors = [m for _k, m, o in editors if o == "acknowledged"]
    return {
        "appends_fired": len(appends),
        "appends_acknowledged": sum(1 for *_x, o in appends if o == "acknowledged"),
        "appends_landed": sum(1 for _k, m, o in appends if o == "acknowledged" and body.count(m) >= 1),
        "appends_LOST": sorted(m for _k, m, o in appends if o == "acknowledged" and body.count(m) == 0),
        "appends_DUPLICATED": sorted(m for _k, m, _o in appends if body.count(m) > 1),
        "appends_stored_but_not_acknowledged": sorted(m for _k, m, o in appends if o != "acknowledged" and m in body),
        "editors_fired": len(editors),
        "editors_acknowledged": len(ack_editors),
        "editors_refused_409": sum(1 for *_x, o in editors if o == "refused-409"),
        "acknowledged_editor_words_LOST": [m for m in ack_editors if m not in body],
        "errors": sorted({o for *_x, o in results if o.startswith("error") or o == "none"}),
    }


def test_concurrent_appends_and_same_baseline_saves_on_one_note(tmp_path):
    path = str(tmp_path / "probe.db")
    c = _open(path)
    c.execute("PRAGMA journal_mode=WAL")
    ensure_schema(c)
    c.commit()
    c.close()
    total = {"appends_fired": 0, "appends_acknowledged": 0, "appends_landed": 0, "editors_fired": 0,
             "editors_acknowledged": 0, "editors_refused_409": 0}
    bad: list[str] = []
    for rnd in range(ROUNDS):
        r = _one_round(path, rnd)
        print("CONCURRENT-PROBE round", rnd, json.dumps(r))
        for k in total:
            total[k] += r[k]
        for k in ("appends_LOST", "appends_DUPLICATED", "appends_stored_but_not_acknowledged",
                  "acknowledged_editor_words_LOST", "errors"):
            if r[k]:
                bad.append(f"round {rnd} {k}: {r[k]}")
        if r["editors_acknowledged"] > 1:
            bad.append(f"round {rnd}: {r['editors_acknowledged']} same-baseline saves were all told 'saved'")
    print("CONCURRENT-PROBE TOTAL", json.dumps(total))
    assert total["appends_fired"] == ROUNDS * PER_DOOR * 3 and total["editors_fired"] == ROUNDS * EDITORS
    assert total["appends_acknowledged"] > 0, "non-vacuity: no append was ever acknowledged"
    assert not bad, bad
    assert total["appends_landed"] == total["appends_acknowledged"] == total["appends_fired"]
