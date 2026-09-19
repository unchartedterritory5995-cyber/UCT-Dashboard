# CI Chart-Parity Regression Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire `tools/chart_parity.py`'s existing determinism self-check into a report-only
GitHub Actions workflow, so every push/PR touching the chart-rendering engine automatically
re-runs it — no manual invocation required to catch a regression in a built-in indicator's
legacy-vs-engine rendering.

**Architecture:** One new workflow file, `.github/workflows/pine-chart-parity.yml`. It starts a
bare `vite dev` server (no backend, no login — confirmed in `chart_parity.py`'s own docstring),
waits for it to answer, then runs `chart_parity.py --same-build` across its existing 53-case
list and uploads the resulting report+images as a workflow artifact. `continue-on-error: true`
at the job level keeps it report-only, mirroring `.github/workflows/full-suite-report.yml`'s own
established precedent exactly.

**Tech Stack:** GitHub Actions (`ubuntu-latest`), Node 20 + Vite (frontend), Python 3.12 +
Playwright + Pillow (the harness itself, already a repo dependency).

**Spec:** `docs/superpowers/specs/universal-indicator-ecosystem/RENDERING_PARITY_VERIFICATION_PROGRAM.md`
— this plan implements §4.2's per-push piece only. The nightly `c0_visual_journey.py` piece is a
separate plan.

## ⚠️ Correction to the spec's assumption — read before implementing

The spec's §3 evidence describes `chart_parity.py` as testing "against the existing corpus,"
implying it covers the community Pine scripts in `c0_oos_fixtures/` etc. **That is not what it
does today.** Read directly from the tool and `tools/chart_parity_cases.json` (53 cases):

- `chart_parity.py`'s actual, stated purpose (its own module docstring) is **Phase B's
  built-in-indicator migration gate** — proving a migrated built-in (RSI, Bollinger Bands, MACD,
  VWAP, Stochastic, ATR, SAR, Ichimoku, MFI, CCI, Williams %R, ADX, OBV, Donchian) renders
  pixel-identically in the new engine vs. the legacy implementation.
- Of the 53 cases, 51 are built-in-migration cases. Exactly 2 (`ast_user_formula_sma20`,
  `ast_user_formula_multiplot_rsi`) touch arbitrary user-authored formulas, and one of those two
  is itself still a `placeholder`.
- **None of the 53 cases reference any script from `c0_oos_fixtures/`, `c0_parity_fixtures/`,
  or `c3a_parity_fixtures/`.** Wiring this tool into CI as-is gives real, valuable coverage of
  built-in-indicator migrations — it does NOT give coverage of the community-script corpus the
  primitive-coverage-matrix plan is auditing.

This plan proceeds with the tool AS IT EXISTS TODAY (Task 1-3 below), because that coverage is
real and worth having continuously. **Extending `chart_parity_cases.json` with corpus-derived
cases (using the existing `instancesB` / `ast_user_formula_*` pattern) is valuable, separate
follow-on work, not done here** — it is a case-authoring task with its own scope, not a CI-wiring
task, and folding it in here would silently under-deliver on both.

## Global Constraints

- New workflow files MUST carry `# promotion-gate: no` as the first line, or
  `tools/promotion_gate.py` refuses every promotion repo-wide (this has happened once before,
  to `full-suite-report.yml` — see that file's own header).
- The job MUST set `continue-on-error: true` — this is what keeps a report-only check from
  blocking anything; removing it is a deliberate, separate decision this plan does not make.
- `chart_parity.py --base-a` defaults to `http://localhost:5173` — the workflow starts exactly
  that, via `npm run dev` (`app/package.json:7` — `"dev": "vite"`), and must not point it
  anywhere else.
- No backend, no login, no database — `chart_parity.py`'s hermetic `?fixedbars=` mode needs
  none of them (its own docstring: "hermetic mode needs no backend").

---

### Task 1: Add the report-only workflow file

**Files:**
- Create: `.github/workflows/pine-chart-parity.yml`
- Test: manual `workflow_dispatch` run (Task 3) — this is infrastructure, not unit-testable code,
  so its "test" is a real, observed run rather than a pytest/vitest file.

**Interfaces:**
- Consumes: `tools/chart_parity.py` (existing, unmodified), `tools/chart_parity_cases.json`
  (existing, unmodified), `app/package.json`'s `dev` script (existing, unmodified).
- Produces: a GitHub Actions check named `pine chart parity (report-only)`, and a
  `chart-parity-report` artifact on every run, for Task 3 (and any future consumer) to read.

- [ ] **Step 1: Create the workflow file with the exact content below**

```yaml
# promotion-gate: no — REPORT-ONLY. This job runs with `continue-on-error: true` and
# publishes a workflow artifact; it never blocks a push or a promotion. Mirrors
# .github/workflows/full-suite-report.yml's own established precedent for a new check:
# observe before it can block. See that file's own header for the incident this marker
# prevents (a workflow shipped without it once froze every production promotion repo-wide).
#
# SCOPE: this checks chart_parity.py's existing 53-case built-in-indicator migration
# suite (legacy vs. engine rendering). It does NOT cover the community Pine-script corpus
# (c0_oos_fixtures/ etc.) — see the correction note in
# docs/superpowers/plans/2026-09-19-ci-chart-parity-regression.md before assuming otherwise.

name: pine chart parity (report-only)

on:
  push:
    branches: [master]
    paths:
      - 'app/src/components/chart/engine/**'
      - 'tools/chart_parity.py'
      - 'tools/chart_parity_cases.json'
      - '.github/workflows/pine-chart-parity.yml'
  pull_request:
    branches: [master]
    paths:
      - 'app/src/components/chart/engine/**'
      - 'tools/chart_parity.py'
      - 'tools/chart_parity_cases.json'
  workflow_dispatch:

concurrency:
  group: pine-chart-parity-${{ github.ref }}
  cancel-in-progress: true

permissions:
  contents: read

jobs:
  chart-parity:
    name: chart_parity.py --same-build (53 cases)
    runs-on: ubuntu-latest
    continue-on-error: true
    timeout-minutes: 20
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: npm
          cache-dependency-path: app/package-lock.json

      - name: Install frontend deps
        working-directory: app
        run: npm ci

      - uses: actions/setup-python@v5
        with:
          python-version: '3.12'

      - name: Install Python deps (harness + Playwright)
        run: |
          python -m pip install --quiet -r requirements.txt
          python -m playwright install --with-deps chromium

      - name: Start vite dev server
        working-directory: app
        run: nohup npm run dev -- --port 5173 > ../vite.log 2>&1 &

      - name: Wait for the dev server to answer
        run: |
          for i in $(seq 1 30); do
            if curl -sf http://localhost:5173 > /dev/null; then
              echo "vite dev server is up after ${i}s"
              exit 0
            fi
            sleep 1
          done
          echo "::error::vite dev server never answered on :5173"
          cat vite.log
          exit 1

      - name: Run chart_parity.py --same-build
        id: parity
        run: |
          set +e
          python tools/chart_parity.py --base-a http://localhost:5173 --same-build \
            2>&1 | tee chart_parity_run.log
          RC=${PIPESTATUS[0]}
          echo "rc=$RC" >> "$GITHUB_OUTPUT"
          exit 0

      # A run without its own completion line is not a run — same rule this repo
      # applies to vitest/pytest in full-suite-report.yml, applied here to a
      # different harness's own printed line.
      - name: Assert the run actually completed
        if: always()
        run: |
          grep -E "case\(s\), [0-9]+ failure\(s\)" chart_parity_run.log || {
            echo "::error::chart_parity.py produced no completion line — the run was killed or never finished, this is NOT a clean result"
            exit 1
          }

      - name: Report the verdict
        if: always()
        run: |
          echo "chart_parity.py exit code: ${{ steps.parity.outputs.rc }}"
          if [ "${{ steps.parity.outputs.rc }}" != "0" ]; then
            echo "::error::chart_parity.py reported failures — see the uploaded report for which case(s)"
          fi
          {
            echo "## pine chart parity"
            echo
            tail -60 chart_parity_run.log
          } >> "$GITHUB_STEP_SUMMARY"

      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: chart-parity-report
          path: |
            chart_parity_run.log
            tools/chart_parity_out/
          retention-days: 14
```

- [ ] **Step 2: Verify the promotion-gate marker is readable by the real tool**

Run: `python tools/promotion_gate.py --check .github/workflows/pine-chart-parity.yml`
(if `promotion_gate.py` does not expose a single-file check flag, instead run its normal
classification path and confirm the new file is read as `no`/report-only rather than
`UNCLASSIFIED` — read the tool's own `--help` first to use whichever form it supports; do not
guess a flag name.)
Expected: the file classifies as `no` (report-only), not `UNCLASSIFIED`.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/pine-chart-parity.yml
git commit -m "ci: run chart_parity.py's built-in-indicator migration suite on every relevant push (report-only)"
```

---

### Task 2: Local dry run before trusting CI

Running this on a real GitHub Actions runner cannot be done from this environment, so prove the
exact command sequence works locally first — a workflow YAML that has never been executed
locally either is two unverified things stacked, not one.

**Files:**
- None created — this task runs the same commands Task 1's workflow will run, on this machine.

- [ ] **Step 1: Start the dev server locally**

```bash
cd app && npm run dev
```

Expected: Vite reports it is serving on `http://localhost:5173`.

- [ ] **Step 2: In a second terminal, run the exact harness command the workflow uses**

```bash
python tools/chart_parity.py --base-a http://localhost:5173 --same-build
```

Expected: exit code 0, and a line matching `NN case(s), 0 failure(s)` (all 53 cases should be
internally consistent against themselves — this is a same-build determinism check, so a
non-zero failure count here means something is already broken and must be understood before
Task 1's workflow is trusted, not wired around).

- [ ] **Step 3: Prove the gate can actually fail (the workflow's `--perturb-b` self-test, run manually once)**

```bash
python tools/chart_parity.py --base-a http://localhost:5173 --same-build \
    --cases rsi_only \
    --perturb-b '{"indicators": {"rsi": {"color": "#7b68ef"}}}'
```

Expected: exit code 1, `rsi_only` reported as `FAIL`. This is not part of the CI workflow itself
— it is proof, once, on this machine, that the harness this workflow calls is capable of
reporting red, so a green CI run means something.

---

### Task 3: Manual `workflow_dispatch` verification run

The spec requires "a manual workflow_dispatch verification run before anything depends on it."
This cannot be automated from this session — GitHub Actions runs require a real push to GitHub.

- [ ] **Step 1: Push the branch carrying Task 1's commit**

```bash
git push origin <branch-name>
```

- [ ] **Step 2: In the GitHub UI, go to Actions → "pine chart parity (report-only)" → "Run workflow" → select the branch → Run workflow**

- [ ] **Step 3: Confirm the run completes and produces the expected artifact**

Check for: the job shows green (or, if `continue-on-error` masks a real failure, check the
step-level outcome, not just the job conclusion) within ~20 minutes; a `chart-parity-report`
artifact is attached to the run; the step summary shows the same `NN case(s), 0 failure(s)`
line observed locally in Task 2 Step 2.

- [ ] **Step 4: Record the verified run**

Add one line to this plan file (or a short note in the PR description) naming the run URL and
its result, so a future reader can confirm this workflow has actually been seen to execute
successfully at least once — per this repo's own "a workflow nobody has seen fire is not a
working workflow" standard.

---

## Self-review notes

- **Spec coverage**: §4.2's per-push piece is fully covered (Tasks 1-3). The nightly
  `c0_visual_journey.py` piece and OD1 are explicitly out of scope for this plan (separate plan).
- **Placeholder scan**: no TBD/TODO; the one open item (Task 1 Step 2's exact `promotion_gate.py`
  invocation) is written as "check its `--help` first" rather than guessing a flag name that may
  not exist — that is a real instruction, not a placeholder.
- **Type/name consistency**: `chart-parity-report` artifact name, `pine-chart-parity.yml` file
  name, and `chart_parity_run.log`/`tools/chart_parity_out/` paths are used identically across
  Task 1 and Task 3.
- **Deviation from the spec, flagged plainly**: the spec's evidence section describes this tool
  as covering "the corpus." It does not, today. This plan implements what the tool actually does
  (built-in-indicator migration regression) and documents the gap rather than silently building
  something the tool can't yet deliver or silently expanding scope to add corpus cases under a
  CI-wiring task.
