# Rig credential hygiene

> **Credentials and session cookies never appear in logs, scratchpads, commit messages, or
> tool output. If one leaks, report immediately, stop using that session, and rotate the
> credential.**

That is the whole rule. The rest of this file is how to obey it and what to do when it is
broken, because it has been broken once and the way it broke was not obvious.

## The incident this encodes — 2026-09-13

`tools/breadth_widget_ab.py` crashed during teardown: the Breadth widget keeps polling, and
a request still in flight when the Playwright context closes raises inside the route
handler. The traceback was printed.

**A Playwright error embeds the request headers of the call that failed, and one of those
headers is `Cookie:`.** A live `MEMBER_SMOKE` session token went into a run log and into the
agent's own tool output. Nothing in the harness was logging credentials on purpose; the
harness was logging an *error*, and the error was carrying one.

⛔ **So the rule is not "don't log secrets". It is "don't print raw exceptions".** Anyone
obeying the first phrasing would have written exactly the code that leaked.

## Obeying it

- **Never print a raw Playwright or HTTP exception.** Use `tools/secret_scrub.brief(exc)` —
  type plus first line, scrubbed, no call log.
- **Anything else headed for a log, a file, or a tool result goes through `scrub()` first.**
  It redacts `Cookie` / `Set-Cookie` / `Authorization`, and any field whose name contains
  `token`, `secret`, `password`, `api_key`, `session` or `auth` — prefixes included.
- **One scrubber, not one per rig.** `tools/secret_scrub.py` is the only copy; import it.
  Three scrubbers means only one of them ever gets the next fix
  (`lesson_a_guard_repeated_is_a_guard_unproved`).
- **Rig output lives only under a gitignored path** — for the breadth rigs that is
  `docs/breadth/screenshots/` and `docs/breadth/measurements/` (see that directory's
  `.gitignore`; this repo is PUBLIC). Delete run logs at teardown, including on exceptions
  — a `finally`, not the happy path.
- **Scan before you walk away:**

      python tools/secret_scrub.py --self-check          # proves the scanner can fail
      python tools/secret_scrub.py --scan <dir> [...]    # exit 1 on any finding

  It reports `kind: path:line` and **never the matched value**, so the scan output is itself
  safe to paste.

## If one leaks

1. **Say so immediately.** Do not finish the task first.
2. **Stop using that session.** Do not keep driving a rig with a token you have published.
3. **Rotate the credential.** ✅ **Since `bd68c4147` (2026-09-14) every password-writing path
   revokes sessions**: admin reset and the forgot-password link revoke ALL; a self-service
   change keeps only the calling device. So a rotation now closes the sessions by itself.
   ⚰️ This step used to read *"changing a password does not invalidate sessions"*, and that
   was true and load-bearing — it is the defect D-038 found and D-039 shipped the fix for.
   **Still verify rather than assume:** `POST /api/auth/sessions/revoke-others` and check a
   second call returns `revoked: 0`, which is the proof that none survive.
4. **Verify the leaked token is dead** — one read-only request, expect `401`. That is the
   only permitted use of a leaked token.
5. **Delete the artifacts**, then `--scan` to confirm, then record it in `DECISIONS.md`.

6. **Re-point the rig at the new value** — see *After rotating* below; `setx` alone does not
   reach a session that is already running.

⚠️ **A leaked token also survives in the conversation transcript**, which you cannot delete.
Deleting the log files is necessary and not sufficient — rotation is what actually closes it.

## After rotating: `setx` does not reach a running agent

`setx` writes `HKCU\Environment`. A process that is **already running** — and every shell it spawns — inherited its
environment before that write, so a rotated credential is invisible to the session that rotated it. The rig then
presents the **old** password and fails to authenticate, which looks like a broken rotation and is not one.

Either restart the agent, or read the value from the registry at spawn time:

```python
import os, subprocess, sys, winreg
with winreg.OpenKey(winreg.HKEY_CURRENT_USER, "Environment") as k:
    val, _ = winreg.QueryValueEx(k, "MEMBER_SMOKE_PASSWORD")
env = dict(os.environ); env["MEMBER_SMOKE_PASSWORD"] = val
subprocess.run([sys.executable, *sys.argv[1:]], env=env)      # print NAMES only, never values
```

⭐ Same rule as reading the wire instead of the call site: **verify what the PROCESS received, not what the command
said.** The rotation succeeded and every later run would still have presented the dead password.

## The hooks

`core.hooksPath` points every worktree at `uct-dashboard/.git/hooks`. Two are installed:

- **`pre-commit`** — refuses to stage a credential-shaped value. Catching it here means it never enters history at
  all, so no rewrite is needed.
- **`pre-push`** — scans exactly the commits the push would publish, for **every** destination, then runs the existing
  master-only Railway 502 guard. ⛔ **A pushed secret is public even if you delete it afterwards** — this repo is
  public, so rotate first and rewrite second, never the reverse.

Both locate `tools/secret_scrub.py` from the pushing worktree. If it is absent, `pre-push` prints a **visible warning
saying the scan did not run** and allows the push — it must not block worktrees that legitimately do not have the file
yet, and a silent skip would read as a pass (`lesson_a_rails_important_half_can_be_opt_in`). That branch disappears
once the file is on master.

Both hooks read git's ref lines from stdin, which git sends **once**, so `pre-push` captures it up front and replays
it to each check via a heredoc — a `while read` in a pipeline runs in a subshell and its variables never escape.

## Known rig traps (all measured 2026-09-13 on the `/charts` A/B)

Four ways this harness produced a confident wrong answer before it produced a right one. Each is a class, not a bug.

| Trap | What it looked like | The rule |
|---|---|---|
| **The intro overlay** | `innerText` readiness said "rendered" while the ~9.3 s cinematic intro covered the whole viewport, the widget behind it. Text compared IDENTICAL, **100 % of pixels differed**. | **Present is not showing.** Gate readiness on the intro being gone; click Skip. The pixel count was the only thing that noticed. |
| **The wrong organ** | The readiness probe waited for a `<canvas>` and timed out four times over a perfectly rendered widget — this heatmap is DOM tiles; the treemap canvas is a different view. | Ask the **product's own question** (`lesson_did_it_render_needs_the_products_own_answer`). A detector that cannot see a working product reports INCONCLUSIVE forever. |
| **Animated chrome** | A full-page pixel diff of an unchanged page differs by ~2,200 scattered pixels at 1280 — the gold `UIcon` shimmer and the voice orb animate. | Make **text** the verdict and pixels supporting. Text is what a registry controls and is immune to animation. |
| **Page chrome drifting** | Whole-page text reported a one-line difference: `9+`, the Community unread badge, which arrived between captures. | **Scope to the subtree under test.** Any long-lived chrome eventually differs between two runs minutes apart, and a verdict that reds on somebody else's notification stops being read. |

⚠️ And one that is not the harness: an **edge 502 in 0.2 s** (an immediate refusal, not a timeout) while `/api/health`
read 200 with a rising uptime. Health is a proxy; it was green over a login path that was not. Retry **5xx only**,
record the attempt count, and never retry a 4xx — that is a real refusal.

## Test fixtures: `.internal`, never `.invalid`

The smoke account's domain is `.internal` for a reason that reaches past this runbook: `EmailStr`'s validator
**refuses special-use domains by name**, so `*.invalid` and `*.example` are rejected at the schema boundary while
`.internal` (RFC 8375) passes. A fixture using them fails only where a request crosses Pydantic — so service-level
tests pass and the one endpoint test fails, which reads as a flaky sixth test rather than a wrong fixture. The rule
and the incident are in `docs/breadth/gates.md` ("Never commit on red").

## The three caller classes

Production verification covers **anonymous / free / paid**. Carrying a gap in one of them means
a gate can be wrong for exactly the class nobody drives.

| class | account | credentials |
|---|---|---|
| anonymous | — | no cookie |
| **free** | `free-smoke@uctintelligence.internal` | `FREE_SMOKE_EMAIL` / `FREE_SMOKE_PASSWORD` |
| paid | the member-smoke account | `MEMBER_SMOKE_EMAIL` / `MEMBER_SMOKE_PASSWORD` |
| admin | `smoke@uctintelligence.internal` | `SMOKE_EMAIL` / `SMOKE_PASSWORD` |

Free-smoke was created 2026-09-14 by the same path as the other synthetic accounts — the app's own
`create_user` **in the web pod**, because `COMING_SOON_MODE=1` refuses `POST /api/auth/signup`. No new
mechanism, no raw SQL against `users`. It carries **no** comped subscription, which is what makes it free.

⭐ **The password was generated on the operator's machine and set over HTTPS afterwards**, via
`POST /api/auth/admin/reset-password` — the pod created the account with a throwaway value that never
left it. A credential passed as a `railway ssh` argument is visible in the pod's process table for the
life of the call; an HTTPS body is not.

⛔ Same standing rules as the other smoke accounts: it must hold **no** real position, note, watchlist
entry or alert, and anything a run creates, that run removes. Credentials live in the operator's
environment via `setx`, never in the repo, a log, a commit, or on Railway — no service reads them.

**Verified at creation:** login 200 (plan free) · `/api/breadth-monitor` → **402** · dark
`/api/breadth-monitor/series` → **404**.

⚠️ The pod write took a `VACUUM INTO` backup first (`/data/backups/auth-2026-09-14-pre-free-smoke.db`,
`quick_check: ok`, 28 users) and fingerprinted the users table either side: **28 → 29, exactly one id
added, none removed**. A count rising by one is compatible with one row added and another silently
rewritten; a set difference is not.

## The standard for ANY write to a production user table

The free-smoke account (2026-09-14) and the smoke account before it (2026-09-12) used the
same sequence. It is the standard now rather than two coincidences:

1. **`VACUUM INTO` a backup FIRST — never a file copy.** A plain copy of a WAL database
   omits whatever is still in the `-wal` sidecar, so it looks complete and silently lags
   the source. Verify `quick_check: ok` on the copy before proceeding.
2. **Fingerprint the table before and after, and assert the SET DIFFERENCE.** ⛔ Not the
   count: a count rising by one is compatible with one row added and another silently
   rewritten; a set difference is not. Record `ids_added` and `ids_removed`, and expect
   `ids_removed` to be empty.
3. **Go through the app's own service functions** — the exact ones the product calls — never
   raw SQL against `users` or `subscriptions`, so the row has the shape the rest of the app
   already reads.
4. **Generate the password on the operator's machine and set it over HTTPS afterwards.** A
   credential passed as a `railway ssh` argument is visible in the pod's process table for
   the life of the call; an HTTPS body is not.
5. ⚠️ **Record where the backup is, and remember what it does not cover.**
   `/data/backups/` is on the SAME volume as the database it backs up: it covers a logical
   mistake — a bad write, a wrong `UPDATE`, a migration that did more than it meant to —
   and nothing at all about losing the volume.
