"""Wave 14 lane W14-A mutation proof -- break each load-bearing guard of the first-run
welcome's capability preview, the sample promotion and the W14-D mount point, one at a time,
and show a rail goes RED.

    python tools/notebook_w14a_mutation_proof.py docs/notebook/evidence/wave14-w14a/mutation-<sha>.txt

Guards: the preview rides the checklist's gate (onboarding AND getting-started; M1, M8, M9); each line shows only when its OWN flag is
armed; "armed" means `=== true`, never truthy; the sample button points at its promotion
(aria-describedby); the promotion shows only while the sample button does; the W14-D slot is
rendered in every Home return; the preview never claims the first-run stage.

Same discipline as tools/notebook_w13f_mutation_proof.py: each mutation is applied to the
CAPTURED bytes of one file, the named rail FILES are run whole (never -k / vitest -t), a
mutation is KILLED only when the run reports at least one failed test, every restore writes
back the captured bytes -- never `git checkout` -- and is verified against the committed blob
(`git cat-file blob HEAD:<path>`, line endings normalised). An unmutated control runs green
before and after. Exit 0 only when every mutation is killed and every restore verified.
"""
import pathlib
import re
import subprocess
import sys

REPO = pathlib.Path(__file__).resolve().parents[1]
APP = REPO / "app"
OUT = pathlib.Path(sys.argv[1])
NB = "app/src/pages/journal-2-0/components/notebook"
RH = f"{NB}/ResearchHome.jsx"
CL = f"{NB}/onboarding/capabilityList.js"
CP = f"{NB}/onboarding/CapabilityPreview.jsx"

T_WELCOME = f"{NB}/ResearchHome.welcome.test.jsx"
T_LIST = f"{NB}/onboarding/capabilityList.test.js"
T_PREVIEW = f"{NB}/onboarding/CapabilityPreview.test.jsx"
CONTROL = [T_WELCOME, T_LIST, T_PREVIEW, "app/src/pages/journal-2-0/a11y/capabilityPreview.a11y.test.jsx"]

STAGE_IMPORT = "import { claimFirstRunStage } from '../../../../../components/firstRun/firstRunStage'"

# (id, what it breaks, file, [(old, new), ...], rail files)
MUTATIONS = [
    ("M1", "preview ignores its gate entirely", RH,
     [("        {welcomeExtras && (\n          <Suspense fallback={null}>",
       "        {(\n          <Suspense fallback={null}>")], [T_WELCOME]),
    ("M2", "every line shows whatever its flag says", CL,
     [("CAPABILITY_PREVIEW.filter((c) => flag(c.flag) === true)", "CAPABILITY_PREVIEW.filter(() => true)")],
     [T_LIST, T_PREVIEW, T_WELCOME]),
    ("M3", "truthy instead of === true", CL,
     [("flag(c.flag) === true)", "Boolean(flag(c.flag)))")], [T_LIST]),
    ("M4", "the sample button loses aria-describedby", RH,
     [("\n              aria-describedby={welcomeExtras ? samplePromoId : undefined}>", ">")], [T_WELCOME]),
    ("M5", "the promotion shows without the sample button", RH,
     [("<CapabilityPreview canAddSample={canAddSample}", "<CapabilityPreview canAddSample")], [T_WELCOME]),
    ("M6", "one Home return drops the W14-D slot", RH,
     [("    {reviewBox}\n    {gettingStartedSlot}\n", "    {reviewBox}\n")], [T_WELCOME]),
    ("M7", "the preview claims the first-run stage", CP,
     [("import { useId } from 'react'\n", "import { useId } from 'react'\n" + STAGE_IMPORT + "\n"),
      ("  const lines = armedCapabilities()\n", "  const lines = armedCapabilities()\n  claimFirstRunStage()\n")],
     [T_PREVIEW]),
    # Wave 14 integration ruling: the preview and the promotion ride the checklist's gate
    # (onboarding AND notebook_getting_started_enabled), so they are not live on merge.
    ("M8", "the integration gate removed (preview rides onboarding alone)", RH,
     [("  const welcomeExtras = checklistEnabled(notebookFlag)\n", "  const welcomeExtras = onboarding\n")],
     [T_WELCOME]),
    ("M9", "aria-describedby ungated (names a promotion that is not on screen)", RH,
     [("aria-describedby={welcomeExtras ? samplePromoId : undefined}>", "aria-describedby={samplePromoId}>")],
     [T_WELCOME]),
]


def run_tests(files):
    rel = [f[len("app/"):] for f in files]
    r = subprocess.run(["cmd", "/c", "npx", "vitest", "run", *rel, "--maxWorkers=2"], cwd=APP, capture_output=True,
                       text=True, encoding="utf-8", errors="replace")
    out = re.sub(r"\x1b\[[0-9;]*m", "", r.stdout + r.stderr)
    tot = [l.strip() for l in out.splitlines() if l.strip().startswith("Tests ")]
    line = tot[-1] if tot else "NO TOTALS LINE"
    failed = re.search(r"(\d+) failed", line)
    return r.returncode, line, int(failed.group(1)) if failed else 0, bool(tot)


def committed(path):
    r = subprocess.run(["git", "cat-file", "blob", f"HEAD:{path}"], cwd=REPO, capture_output=True, check=True)
    return r.stdout.replace(b"\r\n", b"\n")


def main():
    lines = []
    say = lambda s: (print(s), lines.append(s))
    sha = subprocess.run(["git", "rev-parse", "HEAD"], cwd=REPO, capture_output=True, text=True).stdout.strip()
    say(f"W14-A mutation proof at {sha}")

    rc, tot, failed, has = run_tests(CONTROL)
    say(f"CONTROL before: rc={rc} {tot}")
    ok = rc == 0 and has and failed == 0

    for mid, what, path, edits, rails in MUTATIONS:
        full = REPO / path
        raw = full.read_bytes()
        text = raw.decode("utf-8")
        nl = "\r\n" if "\r\n" in text else "\n"
        mutated = text
        setup_ok = True
        for old, new in edits:
            o, n = old.replace("\n", nl), new.replace("\n", nl)
            if mutated.count(o) != 1:
                setup_ok = False
                say(f"{mid} {what}: SETUP-FAIL anchor count {mutated.count(o)}")
                break
            mutated = mutated.replace(o, n)
        if not setup_ok:
            ok = False
            continue
        full.write_bytes(mutated.encode("utf-8"))
        try:
            rc, tot, failed, has = run_tests(rails)
        finally:
            full.write_bytes(raw)
        restored = full.read_bytes().replace(b"\r\n", b"\n") == committed(path)
        killed = has and failed > 0
        ok = ok and killed and restored
        say(f"{mid} {what}: {'KILLED' if killed else 'SURVIVED'} ({tot}); restore "
            f"{'verified' if restored else 'NOT VERIFIED'}")

    rc, tot, failed, has = run_tests(CONTROL)
    say(f"CONTROL after: rc={rc} {tot}")
    ok = ok and rc == 0 and has and failed == 0
    status = subprocess.run(["git", "status", "--porcelain", "--", "app/src"], cwd=REPO,
                            capture_output=True, text=True).stdout.strip()
    say(f"git status app/src after: {status or 'clean'}")
    ok = ok and not status
    say(f"VERDICT: {'PASS' if ok else 'FAIL'}")
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
