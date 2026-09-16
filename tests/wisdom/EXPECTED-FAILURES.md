---
id: WISDOM-EXPECTED-FAILURES
title: Tests that are RED before a Wisdom session starts, and are not a Wisdom session's to fix
owner: whoever owns the path in the "owned by" column — never the Wisdom programme
---

# Expected failures on a Wisdom scoped run

⛔⛔ **This file is a BASELINE, not a permission slip.** Every entry names a test that was already
red before the Wisdom programme touched anything, in a path a Wisdom session is forbidden to edit.
It exists so a scoped run can read **0 failed** and a genuinely new red is visible the moment it
appears — not so red tests can accumulate quietly.

⭐ **The entries are `xfail(strict=True)`.** If one of these tests starts PASSING, the run FAILS
and this file must be updated. A non-strict xfail would let a fixed test sit here forever, and the
baseline would rot into a list of things nobody has checked since.

⚠️ **They apply only when a Wisdom scoped run collects them** — `tests/conftest.py` applies the
marks only if the same session also collected at least one `test_wisdom_*` file. The Discord
render programme running its own suite sees these tests exactly as it always has, red and
unmarked. A baseline that silenced someone else's failures in their own runs would be a defect,
not a courtesy.

---

## Entries

### 1–2. `mutation_harness_flipgate.py` anchor checks

| | |
|---|---|
| **test ids** | `tests/test_mutation_harness_anchors.py::test_every_mutation_anchor_still_matches_exactly_once[mutation_harness_flipgate.py]`<br>`tests/test_mutation_harness_anchors.py::test_a_not_applied_mutation_fails_the_harness_rather_than_printing[mutation_harness_flipgate.py]` |
| **subject under test** | `docs/discord-render/instruments/mutation_harness_flipgate.py` |
| **owned by** | **The Discord render hardening programme.** ⛔ `docs/discord-render/` is an off-limits path under hard rule §0.4i — *"Read through their APIs; never edit."* |
| **first seen** | 2026-09-14 (Wisdom session 4) |
| **introducing commits** | `a78adcd97` (the harness) · `56e9d3aec` (the anchor test) |

**The failing assertion, one line each:**

1. `anchor_check` extracts **zero controls** from the harness — *"that is a failed read"*. The test
   refuses to treat an empty extraction as agreement, which is correct: nothing to check and
   everything checked are the same green otherwise.
2. The harness has **no recognised path from a NOT-APPLIED mutation to a non-zero exit**. The test
   knows three idioms (a `bad` list admitting any non-RED verdict; an `ok_all` flag cleared on a
   bad match count; an `ok` flag cleared on a bad match count) and this harness matches none of
   them, so a mutation proof that never happened would print and the run would still pass.

**Established as pre-existing, three ways** (Wisdom session 4, not assumed):

- the Wisdom merge that surfaced them touched neither the harness nor the test — its diff is
  frontend-only;
- both introducing commits are **ancestors of `b4c9bc3fa`**, the Wisdom branch tip before that
  merge;
- running the file alone at that tip reproduces both.

⛔ **Not diagnosed further, and deliberately so.** The failing assertions above are read off the
test output; the harness itself was not opened beyond them. Diagnosing a bug in another
programme's instrument from inside a Wisdom session is exactly the boundary §0.4i draws.

**The note to carry to the Discord render programme** is in the session-5 report under Step 6c.
