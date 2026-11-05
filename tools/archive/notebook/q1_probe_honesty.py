"""2.1(b) — IS THE PROBE HONEST? Plant a known loss and a known success; it must say so.

⛔⛔ R-HON, owner ruling 2026-09-15: this runs FIRST in a window and is not skippable.
Until it passes, every RED reading in the F5 matrix carries the label "probe unverified"
in the doc AND in the matrix — because every one of those RED verdicts rests on
`sentenceInQueuedEntry`, and nothing has ever shown that field reporting correctly
against a KNOWN answer.

⭐ IT DRIVES THE REAL PROBE. `QUEUED_JS` is imported from `tools/q1_f5_matrix.py`, never
restated here. A copy would agree with itself and say nothing about the instrument that
produced the readings (R-05 — this programme has committed that twice in one week).

THE TWO CASES, and the second is the one that matters:
  SUCCESS  an outbox entry whose patch CARRIES the sentence, record already CLEAN
           -> sentenceInQueuedEntry MUST be True
  LOSS     an outbox entry whose patch does NOT carry it, record already CLEAN
           -> sentenceInQueuedEntry MUST be False
A probe that answered True to everything would pass the first case alone. The LOSS case
is what makes the SUCCESS case mean anything.

⛔ AND BOTH PLANT A **CLEAN** RECORD ON PURPOSE. The question 2.1(b) asks is whether the
probe reads the surviving ENTRY's patch **after the record has been cleaned, from
IndexedDB** — not whether it can see a sentence that is still sitting in the durable
record. So both cases assert `sentenceInDurableCopy is False` as well: if the probe were
reading the record instead of the entry, the SUCCESS case would go False and be caught.

⛔⛔ IT NEVER TOUCHES MEMBER DATA. Everything is planted in a throwaway database named for
a synthetic account (`PROBE_ACCT`), created and deleted by this tool. The real
`uct_notebook_<member>` store is never opened, never written, never deleted.
"""
from __future__ import annotations

import argparse
import json
import os
import pathlib
import sys

REPO = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / "tools"))

#: ⛔ A synthetic account, so the store this creates cannot collide with a member's.
PROBE_ACCT = "probe-honesty-2-1-b"
PROBE_NOTE = "probe-note-1"
SENTENCE = "F5-MATRIX probe honesty sentence"

#: Plant one case into a throwaway IndexedDB shaped like the product's.
#: ⛔ The stores and key paths mirror `notebookDb.js`; if the product's schema moves, this
#: fails loudly at plant time rather than quietly measuring the wrong thing.
PLANT_JS = """async ({acct, noteId, sentence, carries}) => {
  await new Promise((res) => { const d = indexedDB.deleteDatabase('uct_notebook_' + acct);
                               d.onsuccess = d.onerror = d.onblocked = () => res(); });
  const db = await new Promise((res, rej) => {
    const r = indexedDB.open('uct_notebook_' + acct, 1);
    r.onupgradeneeded = () => {
      const d = r.result;
      if (!d.objectStoreNames.contains('notes'))   d.createObjectStore('notes',   {keyPath: 'noteId'});
      if (!d.objectStoreNames.contains('outbox'))  d.createObjectStore('outbox',  {keyPath: 'mutationId'});
      if (!d.objectStoreNames.contains('conflicts')) d.createObjectStore('conflicts', {keyPath: 'id'});
      if (!d.objectStoreNames.contains('meta'))    d.createObjectStore('meta',    {keyPath: 'k'});
    };
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
  const put = (store, value) => new Promise((res, rej) => {
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).put(value);
    tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error);
  });
  // ⛔ THE RECORD IS CLEAN AND CARRIES NO SENTENCE — that is the whole point. The probe
  // must find the words (or not) in the ENTRY, with the durable copy already reconciled.
  await put('notes',  {noteId, dirty: 0, bodyJson: {type: 'doc', content: [
                        {type: 'paragraph', content: [{type: 'text', text: 'server copy only'}]}]}});
  await put('outbox', {mutationId: 'mut-probe-1', noteId, kind: 'patch',
                       baseUpdatedAt: '2026-09-17T00:00:00.000Z',
                       patch: {bodyJson: {type: 'doc', content: [
                         {type: 'paragraph', content: [{type: 'text',
                           text: carries ? sentence : 'the member typed nothing we kept'}]}]}}});
  db.close();
  return true;
}"""

DROP_JS = """async ({acct}) => {
  await new Promise((res) => { const d = indexedDB.deleteDatabase('uct_notebook_' + acct);
                               d.onsuccess = d.onerror = d.onblocked = () => res(); });
  return true;
}"""


def _evidence_dir() -> pathlib.Path:
    """⛔ R-RAW. The runner hands us a directory; if it did not, we make our own rather
    than skipping the write — a probe whose raw output depends on its caller is a probe
    that will one day run with nothing preserved."""
    d = os.environ.get("UCT_EVIDENCE_DIR")
    p = pathlib.Path(d) if d else (REPO / "docs" / "notebook" / "evidence"
                                   / "manual-probe-honesty")
    p.mkdir(parents=True, exist_ok=True)
    return p


def judge(success: dict, loss: dict) -> tuple[bool, list[str]]:
    """Pure, so the verdict can be tested without a browser."""
    fails = []
    if success.get("sentenceInQueuedEntry") is not True:
        fails.append("SUCCESS case: the probe did NOT see a sentence that IS in the entry "
                     f"(sentenceInQueuedEntry={success.get('sentenceInQueuedEntry')!r}) — "
                     "every GREEN reading it has produced is unsafe")
    if loss.get("sentenceInQueuedEntry") is not False:
        fails.append("LOSS case: the probe reported a sentence that is NOT in the entry "
                     f"(sentenceInQueuedEntry={loss.get('sentenceInQueuedEntry')!r}) — "
                     "it answers yes to everything and every RED reading is unsafe")
    # ⛔ THE 2.1(b) QUESTION ITSELF: read from the ENTRY, after the record is CLEAN.
    for name, got in (("SUCCESS", success), ("LOSS", loss)):
        if got.get("sentenceInDurableCopy") is not False:
            fails.append(f"{name} case: the durable record carried the sentence "
                         "— the plant is wrong, so nothing here tests the entry path")
        if got.get("dirty") not in (False, 0):
            fails.append(f"{name} case: the record was not CLEAN (dirty={got.get('dirty')!r}); "
                         "2.1(b) asks about a probe reading AFTER reconciliation")
        if not got.get("queuedForThisNote"):
            fails.append(f"{name} case: no queued entry was visible to the probe at all "
                         "— it measured nothing, which is not the same as measuring False")
    return (not fails), fails


def run(profile: str | None) -> int:
    import window_check as wc  # noqa: PLC0415
    from playwright.sync_api import sync_playwright  # noqa: PLC0415
    from q1_f5_matrix import QUEUED_JS  # noqa: PLC0415  ⛔ the REAL probe, imported

    ev = _evidence_dir()
    # ⛔ ALWAYS EXPLICIT. resolve_profile(None) points at the CURRENT worktree, which does
    # not hold the rig — and a missing profile is a SIGNED-OUT profile, not a new one.
    wc.use_profile(wc.resolve_profile(profile))
    if not pathlib.Path(wc.PROFILE).exists():
        print(f"⇒ INCONCLUSIVE  no rig profile at {wc.PROFILE} — nothing was measured")
        return 0

    proc, endpoint, ver = wc.spawn_rig()
    if ver is None:
        print("⇒ INCONCLUSIVE  the rig browser never answered on CDP — nothing was measured")
        return 0

    raw = {"acct": PROBE_ACCT, "note": PROBE_NOTE, "sentence": SENTENCE, "cases": {}}
    try:
        with sync_playwright() as pw:
            b = pw.chromium.connect_over_cdp(endpoint)
            ctx = b.contexts[0]
            page = ctx.pages[0] if ctx.pages else ctx.new_page()
            page.goto("https://uctintelligence.com/api/health", wait_until="domcontentloaded")

            for name, carries in (("success", True), ("loss", False)):
                page.evaluate(PLANT_JS, {"acct": PROBE_ACCT, "noteId": PROBE_NOTE,
                                         "sentence": SENTENCE, "carries": carries})
                got = page.evaluate(QUEUED_JS, {"acct": PROBE_ACCT, "noteId": PROBE_NOTE,
                                                "sentence": SENTENCE})
                raw["cases"][name] = got
            page.evaluate(DROP_JS, {"acct": PROBE_ACCT})
            b.close()
    finally:
        try:
            wc.teardown(proc)
        except Exception:  # noqa: BLE001
            import subprocess
            subprocess.run(["powershell", "-NoProfile", "-Command",
                            "Get-CimInstance Win32_Process -Filter \"Name='chrome.exe'\" | "
                            "Where-Object { $_.CommandLine -like '*canary-chrome-profile-persistent*' } "
                            "| ForEach-Object { Stop-Process -Id $_.ProcessId -Force "
                            "-ErrorAction SilentlyContinue }"], capture_output=True)

    # ⛔⛔ R-RAW: the raw readings hit disk BEFORE the verdict is computed.
    (ev / "probe_honesty_raw.json").write_text(json.dumps(raw, indent=2), encoding="utf-8",
                                               newline=chr(10))
    print(f"  raw -> {ev / 'probe_honesty_raw.json'}")

    if len(raw["cases"]) != 2:
        print("⇒ INCONCLUSIVE  one or both cases never produced a reading — nothing was measured")
        return 0

    ok, fails = judge(raw["cases"]["success"], raw["cases"]["loss"])
    for f in fails:
        print("  ⛔", f)
    print(f"  SUCCESS case sentenceInQueuedEntry="
          f"{raw['cases']['success'].get('sentenceInQueuedEntry')!r} (want True)")
    print(f"  LOSS    case sentenceInQueuedEntry="
          f"{raw['cases']['loss'].get('sentenceInQueuedEntry')!r} (want False)")
    print("⇒ " + ("PASS  2.1(b): the probe reports a planted loss and a planted success "
                  "correctly, reading the ENTRY with the record already clean"
                  if ok else
                  "⛔ FAIL  2.1(b): the probe is NOT honest — every reading that rests on "
                  "sentenceInQueuedEntry is unsafe until this passes"))
    return 0 if ok else 1


def self_check() -> int:
    """⛔ Prove the VERDICT can fail, without a browser. `judge` is pure for this reason."""
    clean = {"sentenceInDurableCopy": False, "dirty": 0, "queuedForThisNote": 1}
    good_s = {**clean, "sentenceInQueuedEntry": True}
    good_l = {**clean, "sentenceInQueuedEntry": False}
    cases = [
        ((good_s, good_l), True, "an honest probe passes"),
        ((good_s, {**clean, "sentenceInQueuedEntry": True}), False,
         "a probe that says YES to everything must FAIL the loss case"),
        (({**clean, "sentenceInQueuedEntry": False}, good_l), False,
         "a probe that says NO to everything must FAIL the success case"),
        (({**good_s, "sentenceInDurableCopy": True}, good_l), False,
         "a plant whose RECORD carries the sentence tests the wrong path"),
        (({**good_s, "dirty": 1}, good_l), False,
         "a record that is still DIRTY is not the 2.1(b) question"),
        (({**good_s, "queuedForThisNote": 0}, good_l), False,
         "no queued entry visible ⇒ measured nothing, which is not False"),
    ]
    bad = []
    for (s, l), want, why in cases:
        got, _ = judge(s, l)
        if got is not want:
            bad.append(f"{why}: judge returned {got}")
    for b in bad:
        print("  ⛔", b)
    print("self-check:", "PASS — the verdict distinguishes an honest probe from four ways of "
          "being wrong" if not bad else "FAIL")
    return 1 if bad else 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--profile", default=None)
    ap.add_argument("--self-check", action="store_true")
    a = ap.parse_args()
    return self_check() if a.self_check else run(a.profile)


if __name__ == "__main__":
    raise SystemExit(main())
