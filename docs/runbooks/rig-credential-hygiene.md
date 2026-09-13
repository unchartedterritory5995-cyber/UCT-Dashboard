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
3. **Rotate the credential**, and remember that on this app **changing a password does not
   invalidate sessions** — `admin/reset-password` only writes `password_hash`. Kill the
   sessions explicitly: log in with the new value, then
   `POST /api/auth/sessions/revoke-others`, which deletes every session but the caller's.
   Re-run it; a second call returning `revoked: 0` is the proof that none survive.
4. **Verify the leaked token is dead** — one read-only request, expect `401`. That is the
   only permitted use of a leaked token.
5. **Delete the artifacts**, then `--scan` to confirm, then record it in `DECISIONS.md`.

⚠️ **`setx` does not reach a running agent.** It writes `HKCU\Environment`, but a process
already running — and every shell it spawns — inherited its environment before that write.
After rotating, a rig launched from the same session still presents the **old** password and
fails to authenticate. Read the value from the registry at run time, or restart the agent.
This is the same trap as reading a call site instead of the wire: verify what the *process*
received, not what the command said.

⚠️ **A leaked token also survives in the conversation transcript**, which you cannot delete.
Deleting the log files is necessary and not sufficient — rotation is what actually closes it.
