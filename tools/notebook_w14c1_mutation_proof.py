"""W14-C1 mutation proof (docs/notebook/wave14-w14-c1.md, "Mutation proof").

Usage:  python tools/notebook_w14c1_mutation_proof.py <name> | --all | --control

Each mutation applies ONE textual change, runs the named rails, and restores the file.
The restore is verified against the COMMITTED blob (`git cat-file blob HEAD:<path>`), not
only against this run's own capture: a capture proves the bytes match what was captured,
not that what was captured was the original. Evidence: one short summary per mutation in
docs/notebook/evidence/wave14-w14-c1/ (the verdict lines and the failing test names only).
"""
import hashlib
import pathlib
import re
import subprocess
import sys

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
ROOT = pathlib.Path(__file__).resolve().parents[1]
OE = "app/src/pages/journal-2-0/components/notebook/onboarding/"
NB = "app/src/pages/journal-2-0/components/notebook/"
ENGINE = OE + "GenericTourEngine.jsx"
C1 = OE + "GenericTourEngine.c1.test.jsx"
ENG = OE + "GenericTourEngine.test.jsx"
START = OE + "tourStart.test.js"
REACH = OE + "tourReachability.test.jsx"
GATE_T = OE + "RegistryToursGate.test.jsx"
LAYOUT_T = "app/src/components/Layout.registryTours.test.jsx"
EXPL_T = NB + "ResurfaceVersionSheet.explainer.test.jsx"

MUTS = {
    # (c) dynamic steps
    "Mc1-next-decides-at-once": (ENGINE,
        "    setMoving(true)\n    const began = Date.now()\n",
        "    { const later = presentFrom(steps, target, 1); if (later >= 0) goTo(later); else close(TOUR_STATES.done); return }\n"
        "    setMoving(true)\n    const began = Date.now()\n",
        [C1, ENG]),
    "Mc2-waitFor-ignored": (ENGINE,
        "    if (!step?.waitFor || moving) return undefined\n",
        "    return undefined\n",
        [C1]),
    # (d) start detection
    "Md1-screen-params-ignored": (OE + "tourStart.js",
        "  for (const k of SCREEN_PARAMS) if (here.has(k) && !u.searchParams.has(k)) return false\n",
        "",
        [START, C1]),
    # (e) sheets and focus
    "Me1-escape-propagates": (ENGINE,
        "        e.stopPropagation()                          // the sheet beneath stays open\n",
        "",
        [C1]),
    "Me2-tour-always-topmost": (OE + "tourLayers.js",
        "  if (!card) return false\n",
        "  if (card) return true\n",
        [C1]),
    "Me3-modal-over-sheets": (ENGINE,
        "  const modal = !passive && phase === 'open' && !host && !step?.waitFor\n",
        "  const modal = !passive && phase === 'open' && !step?.waitFor\n",
        [C1]),
    "Me4-card-portaled-to-body": (ENGINE,
        "  return createPortal(modal ? <div className={styles.layer}>{card}</div> : card, host || document.body)\n",
        "  return createPortal(modal ? <div className={styles.layer}>{card}</div> : card, document.body)\n",
        [C1]),
    # (a) one mount in the shell
    "Ma1-shell-mount-removed": ("app/src/components/Layout.jsx",
        "          <RegistryToursGate tours={OTHER_TOURS} />\n",
        "",
        [LAYOUT_T]),
    "Ma2-flag-off-request-held": (OE + "RegistryToursGate.jsx",
        "    useEffect(() => { if (wantedId && !allowed) setWantedId(null) }, [wantedId, allowed])\n",
        "",
        [GATE_T]),
    # (b) in-note / trade starts
    "Mb1-sample-note-ignored": (OE + "tourStart.js",
        "    if (note.startsWith('sample:')) id = await sampleNoteId(fetchImpl, note.slice('sample:'.length))\n",
        "",
        [START, C1, REACH]),
    "Mb2-trade-start-ignored": (OE + "tourStart.js",
        "    if (kind === 'trade') {\n",
        "    if (kind === 'trade') { return { stay: true } }\n    if (false) {\n",
        [START, REACH]),
    # (f) the passive explainer
    "Mf1-trigger-removed": (NB + "ResurfaceVersionSheet.jsx",
        "  useEffect(() => { if (shown) openRegistryTour(RESURFACE_EXPLAINER_ID) }, [shown])\n",
        "",
        [EXPL_T, REACH]),
    # controller ruling: the wave-14 switch on every registry tour, and `requires`
    "Mr1-wave-switch-dropped": (OE + "tourRegistry.js",
        "  if (!checklistEnabled(flag)) return false\n",
        "",
        [OE + "tourEligibility.test.js", OE + "tourEligibility.realRegistry.test.js", OE + "TourOfferGate.test.jsx", OE + "tourRegistry.test.js"]),
    "Mr2-requires-ignored": (OE + "tourRegistry.js",
        "  return (entry.requires || []).every((f) => flag(f) === true)\n",
        "  return true\n",
        [OE + "tours/b3Research.test.jsx", OE + "tourRegistry.test.js", OE + "tourEligibility.test.js"]),
    "Mr3-walkthroughs-ungated": ("app/src/pages/Support.jsx",
        "  if (!checklistEnabled(notebookFlag)) return null\n",
        "",
        ["app/src/pages/Support.notebook.test.jsx"]),
    # controller ruling: the sample's examples obey the wave-14 switch, server side
    "Ms1-examples-ignore-switch": ("api/services/journal_two/sample_notebook.py",
        "        wave14 = wave14_switch_on()\n",
        "        wave14 = True\n",
        ["tests/test_sample_notebook_switch.py"]),
    "Ms2-switch-reads-one-flag": ("api/services/notebook_flags.py",
        "    return all(flag_on(name, NOTEBOOK_FLAGS[name]) for name in WAVE14_SWITCH)\n",
        "    return flag_on(WAVE14_SWITCH[0], NOTEBOOK_FLAGS[WAVE14_SWITCH[0]])\n",
        ["tests/test_sample_notebook_switch.py"]),
    # W14-Q1 finding S6: the offer is spent only on a tour that opened
    "Mo1-gate-says-every-tour-opened": (OE + "RegistryToursGate.jsx",
        "      if (id) announceRegistryTourClosed(id, info?.opened === true)\n",
        "      if (id) announceRegistryTourClosed(id, true)\n",
        [OE + "TourOfferGate.test.jsx"]),
    "Mo2-the-click-spends-the-offer": (OE + "TourOfferGate.jsx",
        "        setPendingId(entryId)\n",
        "        writeOfferSession({ id: entryId, answered: true }); setSession({ id: entryId, answered: true })\n",
        [OE + "TourOfferGate.test.jsx"]),
    "Mo3-template-gallery-without-a-start": (OE + "tours/b1Core.js",
        "    start: '/journal/notebook?view=all',\n    load: steps(() => import('./b1TemplateGallery.steps')),\n",
        "    load: steps(() => import('./b1TemplateGallery.steps')),\n",
        [OE + "tourRegistry.test.js", OE + "tours/b1Core.test.jsx"]),
    "Mf2-explainer-ignores-seen-state": (ENGINE,
        "      if (readToursPref(prefs?.[TOURS_PREF])[entry.id]) { onCloseRef.current(); return }\n",
        "",
        [C1, EXPL_T]),
}


def run(files):
    if all(f.startswith("tests/") for f in files):
        r = subprocess.run([sys.executable, "-m", "pytest", *files, "-q", "-p", "no:warnings", "-p", "no:cacheprovider"],
                           cwd=ROOT, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=900)
        return r.returncode, r.stdout + r.stderr
    rel = [f[len("app/"):] for f in files]
    cmd = "npx vitest run " + " ".join(rel) + " --maxWorkers=2"
    r = subprocess.run(cmd, cwd=ROOT / "app", shell=True, capture_output=True, text=True,
                       encoding="utf-8", errors="replace", timeout=900)
    out = re.sub(r"\x1b\[[0-9;]*m", "", r.stdout + r.stderr)
    return r.returncode, out


def summary(out):
    keep = [l.strip() for l in out.splitlines()
            if l.strip().startswith(("Test Files", "Tests ", "×", "FAIL ", "FAILED "))
            or re.search(r"^\d+ (passed|failed)", l.strip()) or re.search(r" (passed|failed)( |,|$).* in [0-9.]+s", l)]
    return "\n".join(dict.fromkeys(keep))


def blob_sha(rel):
    data = subprocess.run(["git", "cat-file", "blob", f"HEAD:{rel}"], cwd=ROOT, capture_output=True, check=True).stdout
    return hashlib.sha256(data).hexdigest()


def mutate(name):
    rel, old, new, files = MUTS[name]
    p = ROOT / rel
    orig = p.read_bytes()
    text = orig.decode("utf-8")
    # the anchor is matched with LF endings; a CRLF working file is matched as stored
    crlf = "\r\n" in text
    o, n = (old.replace("\n", "\r\n"), new.replace("\n", "\r\n")) if crlf else (old, new)
    assert text.count(o) == 1, f"{name}: anchor found {text.count(o)} times in {rel}"
    p.write_bytes(text.replace(o, n).encode("utf-8"))
    try:
        code, out = run(files)
    finally:
        p.write_bytes(orig)
    restored = hashlib.sha256(p.read_bytes()).hexdigest()
    committed = hashlib.sha256(orig).hexdigest()
    head = blob_sha(rel)
    # the working file may carry CRLF where the blob is LF (autocrlf); compare normalised too
    norm = lambda b: hashlib.sha256(b.replace(b"\r\n", b"\n")).hexdigest()
    head_bytes = subprocess.run(["git", "cat-file", "blob", f"HEAD:{rel}"], cwd=ROOT, capture_output=True, check=True).stdout
    assert restored == committed, f"{name}: RESTORE FAILED (capture)"
    assert norm(p.read_bytes()) == norm(head_bytes), f"{name}: RESTORE does not match HEAD:{rel}"
    verdict = "KILLED" if code != 0 else "SURVIVED"
    body = f"== {name}  ({rel})\nverdict: {verdict} (vitest exit {code})\nrestored: matches HEAD:{rel} (blob {head[:12]})\n{summary(out)}\n"
    ev = ROOT / "docs/notebook/evidence/wave14-w14-c1"
    ev.mkdir(parents=True, exist_ok=True)
    (ev / f"{name}.txt").write_text(body, encoding="utf-8")
    print(body)
    return verdict


def control():
    files = sorted({f for (_, _, _, fs) in MUTS.values() for f in fs})
    code, out = run(files)
    body = f"== CONTROL (no mutation)\nvitest exit {code}\n{summary(out)}\n"
    ev = ROOT / "docs/notebook/evidence/wave14-w14-c1"
    ev.mkdir(parents=True, exist_ok=True)
    (ev / "CONTROL.txt").write_text(body, encoding="utf-8")
    print(body)
    return code


if __name__ == "__main__":
    arg = sys.argv[1] if len(sys.argv) > 1 else "--all"
    if arg == "--control":
        sys.exit(control())
    names = list(MUTS) if arg == "--all" else [arg]
    if arg == "--all" and control() != 0:
        print("CONTROL is red: a mutation proof over red rails proves nothing. Stopping.")
        sys.exit(2)
    results = {n: mutate(n) for n in names}
    survived = [n for n, v in results.items() if v != "KILLED"]
    print("VERDICT:", "PASS -- every mutation killed" if not survived else f"FAIL -- survived: {survived}")
    sys.exit(1 if survived else 0)
