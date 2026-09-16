# D-09 PREFLIGHT DELTA — the C-09 member-priority render gate

**Written 2026-09-15, D-07 Part 4.5. This is a DELTA on the D-07 preflight, not a
replacement — everything D-07 checked still applies. It records only what is
different because the subject is the gate branch rather than the hardening branch.**

- Branch: `feat/member-priority-render-gate` @ **`c54066415`** (pushed 2026-09-15).
- Merge base: `2e6cb50bb`. **151 commits behind master** (`8578d375d`) — master
  absorbed the D-07 hardening merge while this branch sat.
- ⛔ **NOT MERGED, and not mergeable today.** Blocked on R5 (owner confirmation of
  the V1 behaviour change) and on the four items in §3.

---

## 1 · Does it conflict with the OI-36 branch? — MEASURED, not assumed

The directive asks whether D-08 (`fix/oi-36-buzz-defer-first`) and D-09 collide,
because both touch `buzz_image` / the router. **They overlap in two files and
conflict in neither.**

Measured with `git merge-tree --write-tree`, each branch against its own merge-base
(⛔ **not** `master..branch` — both branches are behind master, so that form reports
master's own commits as if they were the branch's, and the first attempt at this
analysis produced a 190-file overlap that was almost entirely master):

| merge | result |
|---|---|
| master + **OI-36** | ✅ **rc=0, clean.** D-08 needs no rebase. |
| master + **gate** | ❌ CONFLICT — `tests/test_discord_render_fail_hooks.py` |
| **post-D-08 master + gate** (the R6 order) | ❌ same single conflict; `api/routers/discord_interactions.py` and `tests/test_buzz_command.py` **auto-merge** |

**The two branches' own file sets overlap in exactly two files** —
`api/routers/discord_interactions.py` and `tests/test_buzz_command.py` — and git
auto-merges both. ⭐ **The conflict is not between the two branches at all**; it is
between the gate branch and *master*, in a file neither D-08 nor D-09 is really
about.

### Order under R6

**D-08 first, then D-09** — which is the order R6 already prescribes, and the
measurement gives it an independent reason: D-08 merges clean today, D-09 cannot
merge today regardless. Sequencing them the other way would block the clean one
behind the blocked one for no gain.

---

## 2 · The one conflict, and its resolution

`tests/test_discord_render_fail_hooks.py`, one function, edited on both sides for
**different and complementary reasons**:

- **master** (`3adc0d168`, the D-07 preflight) renamed
  `test_busy_is_queue_full_through_the_hook_and_unchanged_without` →
  `test_busy_is_DEADLINE_...`, changed the assertion from `queue_full` to
  `deadline`, and added a non-vacuity check that `queue_full` is still a reachable
  class. That test had been RED since D-04.
- **the gate branch** swapped the stub `threading.BoundedSemaphore(1)` →
  `RenderGate(1)` and added the import, because after C-09 `produce_chart` passes
  `cls=` unconditionally and a plain semaphore raises `TypeError`.

⭐ **The resolution is a UNION, not a choice.** Take master's name, docstring,
assertion and non-vacuity case; take the gate's import and `RenderGate(1)` stub.
Both are required: without master's half the test asserts the defect, without the
gate's half it raises `TypeError` on a class it cannot accept.

⛔ Do not resolve this by taking either side wholesale. "Take master" silently
reverts the C-09 stub and the test fails for a new reason; "take the branch"
re-lands the `queue_full` assertion this programme just spent a preflight removing.

---

## 3 · What is RED on the gate branch right now

Roster **derived**, not remembered — an AST walk over `tests/` for every file
importing a module this branch changes (`discord_interactions`, `buzz_image`,
`render_gate`, `routers/discord_interactions`, `discord_buzz_digest`) → **20
files**. ⭐ The remembered 6-file roster is what let two reds survive three
preflights in D-04→D-07; it is not used again.

```
20 files · 3 failed, 444 passed, 27.37s
```

| # | red | cause | fixed by |
|---|---|---|---|
| 1 | `test_busy_is_queue_full_through_the_hook_and_unchanged_without` | stale — master fixed it in `3adc0d168` | the rebase + §2 union |
| 2 | `test_queue_full_is_an_immediate_honest_refusal_with_a_retry_button` | stale — master's `FakeRuntime` gained `record_refusal_reach` | the rebase |
| 3 | `test_the_buzz_render_sends_the_id_and_scrubs_the_error_body` | ⛔ **NOT stale — the gate branch's own defect** | a one-line fix, below |

### Red 3 is real, and it was nearly misfiled as staleness

`TypeError: _render_uncached() missing 1 required keyword-only argument: 'cls'`.

It is a genuine break introduced by this branch, established rather than assumed:
master **passes this file 8/8**, and master has touched neither
`tests/test_discord_render_correlation.py` nor `api/services/buzz_image.py` since
this branch's merge-base. ⭐ Two of three reds being stale is exactly the condition
under which the third gets waved through with them.

---

## 4 · ⭐ NO PRODUCTION CALLER IS BROKEN — swept, not assumed

R5 requires that "all seven paths carry a real class". An AST sweep of every call
site of the four class-gated functions across `api/`, `services/`, `tools/`,
`tests/`:

| call site | carries `cls`? | verdict |
|---|---|---|
| `api/services/discord_interactions.py:1373 / :1646 / :1897` — `produce_chart` | ✅ | the three member paths |
| `api/services/buzz_image.py:231` — `_render_uncached` | ✅ | the production board render |
| `api/main.py:838` — `warm_hot_charts` | — | ✅ **correct by construction** |
| `tools/discord_render_bench.py:376` — `_render_uncached()` | ❌ | ⛔ **broken — a tool, not production** |
| `tests/test_discord_render_correlation.py:160` | ❌ | red 3 above |

⛔ **`warm_hot_charts` taking no `cls` is the design, not an oversight**, and the
distinction matters because a sweep that flags it would send the next reader to
"fix" the one thing that must not change. Its signature has **no `cls` parameter**
(kwonly = `bars_fn, render_fn, house_fn, quote_fn, limit, deadline_s`); it sets
`cls=BACKGROUND` itself at `discord_interactions.py:1652`. That is precisely what
makes the C-09 real-path race meaningful — nothing in the harness tells the warm
cycle which class it is, so relabelling that internal call site is the mutation
that proves the path is real.

**So the member-facing blast radius of the three reds is zero.** Two are stale
tests; the third is a test; the only other offender is a bench tool. Nothing a
member touches calls these functions without a class.

---

## 5 · The D-09 preflight checklist — delta only

Everything in the D-07 preflight still applies. **Additionally, and in this order:**

1. **Rebase `feat/member-priority-render-gate` onto `8578d375d`.** 151 behind and a
   real file overlap with master ⇒ this is over the rebase threshold on both
   clauses of the standing rule, so it is a rebase, not a merge.
2. **Resolve `tests/test_discord_render_fail_hooks.py` as the §2 UNION.** Verify by
   reading the resolved file for all four properties: the `_DEADLINE_` name, the
   `deadline` assertion, the non-vacuity case, and `RenderGate(1)`.
3. **Fix red 3** — `tests/test_discord_render_correlation.py:160` passes
   `cls=MEMBER` (it is exercising the member-facing board render).
4. **Fix `tools/discord_render_bench.py:376`** in the same commit. ⛔ Not "later":
   a bench that raises `TypeError` is how a load measurement gets quietly skipped,
   and this programme's load numbers come from that family of tools.
5. **Re-run the derived 20-file roster** and read the totals line. Expect
   `447 passed`.
6. **Re-run the real-path races** (`c09_real_path_races.py`) *on the rebased tip* —
   the existing 50/50 result was measured pre-rebase, and a rebase over 151 commits
   is not a no-op for a concurrency result.
7. **Re-derive the roster** after the rebase. A rebase can change which files import
   what; a roster derived before it is a roster for a different tree.

## 6 · What D-09 is still BLOCKED on, beyond the above

- ⛔ **R5 — owner confirmation.** The gate changes V1 behaviour for every
  `/chart`, `/charts` and warm cycle, not only V2. §7.3 and §6.3 of the owner pack
  carry the decision and its cost; it is not this session's to make.
- ⛔ **R6 — one merge per session.** D-08 is next. D-09 is the session after.
