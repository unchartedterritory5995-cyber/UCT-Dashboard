# Plain-English end-to-end evaluation: credentials and how to run it

The runner is `tools/converse_eval.py`. The design it implements is
`docs/indicators/E2E-EVAL-DESIGN-2026-11-02.md` (Indicators docs branch).

**The offline run costs nothing and needs no key.** Only a live run reaches the model,
and **a live run needs a separate owner spend approval, every time.** Having a key on
the machine is not that approval.

## 1. The offline run (no key, $0)

Run it from the repo root with the repo venv. System Python cannot run it, because the
sandbox census (`conftest.py`) needs pytest:

```powershell
C:\UCT\agent\.venv\Scripts\python.exe tools\converse_eval.py
```

What happens:

- A scripted model answers from `tests/fixtures/authoring/converse_eval_scripted.json`.
- Every model key in the process is blanked before any product code is imported.
- The runner prints a `VERDICT:` line last. Exit code 0 means PASS.

Useful options:

- `--corpus <path>` adds the 32-phrase corpus. Offline, only its refused phrases run;
  the rest need the live model. The corpus file is
  `tests/fixtures/authoring/plain_english_chart_door.json` on
  `feat/indicators-plain-english`.
- `--only <case id>` runs one case. `--only corpus` runs only the corpus.
- `--work <dir>` sets the scratch root. The default is a new folder under the system
  temp directory. It is refused inside `C:\data`.

## 2. Setting up a key for a live run (the owner does this, in their own terminal)

1. **Create a dedicated key** in the Anthropic console, used for nothing else.
2. **Give it its own spend limit** in the console, at or below the approved cap
   (proposed: $40). The console limit is the backstop if everything else fails.
3. **Open a terminal yourself**: a new PowerShell window from the Start menu.
   - ⛔ **Not in a Claude Code chat**, and **not through a `!` command** in Claude
     Code. Both put the key in the session transcript.
   - ⛔ Never paste the key into a chat, a file in the repo, a commit or a log.
4. In that terminal, set the key for your user account:

   ```powershell
   setx ANTHROPIC_API_KEY "<the dedicated key>"
   ```

   `setx` affects only terminals opened **after** it runs. Close this window and open
   a new one for the run.
5. **Check that the key is present without printing it.** In the new terminal:

   ```powershell
   python -c "import os;print(bool(os.environ.get('ANTHROPIC_API_KEY')))"
   ```

   It prints `True` or `False`, and never the key itself.

## 3. The live run (only after a separate owner spend approval)

```powershell
C:\UCT\agent\.venv\Scripts\python.exe tools\converse_eval.py --live --spend-authorized --max-usd 40
```

- **Repeats.** Each case runs 3 times by default; `--repeats N` changes that.
- **Corpus.** Add `--corpus <path>` to include the 32-phrase corpus.

The runner refuses to start (exit code 2) and constructs no client unless **all three**
of these hold:

1. `--spend-authorized` is given.
2. `--max-usd` is a finite amount above 0.
3. `ANTHROPIC_API_KEY` is set and not blank.

### How the cap works

- **The ledger.** Spend is recorded by the product's own `cost_guard` in the
  sandbox's ledger, not production's.
- **The cap.** The run's cap is passed to the product's own per-member cap.
- **The check.** The runner checks the ledger before every turn. It stops with exit
  code 3 and a `VERDICT: STOPPED` line when the ledger reaches the cap.
- **Overshoot.** A turn already in flight can finish. The cap can therefore be
  exceeded by at most one turn: about $0.25, or two calls if a repair is needed.
- **The console limit.** The spend limit set in step 2 is the outer bound.

### What a live run needs

- **Data.** It needs no other paid service. The bars are synthetic, made inside the
  runner, and no market data is fetched.
- **Scope.** It runs entirely in a sandbox directory.
  - It never touches production.
  - It never reads or writes `C:\data`.
  - It is never started through `railway run`.

### Outputs

The run writes to `<work>/out/<run-id>/`:

| File | Contents |
|---|---|
| `records.jsonl` | Written first, one line per turn. |
| `grading.md` and `grading.json` | The grading. |
| `ledger.json` | The spend ledger. |

The key never appears in any of them: it is never written, and is redacted as a
safety net.

## 4. Remove the key afterwards

1. **Remove it from your user environment**, in a terminal you open yourself:

   ```powershell
   [Environment]::SetEnvironmentVariable("ANTHROPIC_API_KEY", $null, "User")
   ```

2. **Close every terminal** that was opened while the key was set, because each one
   still holds the key.
3. **Confirm it is gone.** In a new terminal, the presence check from section 2 should
   now print `False`.
4. **Revoke the key** in the Anthropic console. It was dedicated to this run, so
   nothing else depends on it.
