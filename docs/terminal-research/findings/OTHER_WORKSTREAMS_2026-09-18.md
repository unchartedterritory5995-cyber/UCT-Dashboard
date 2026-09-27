# OTHER_WORKSTREAMS_2026-09-18 — NEW entries not attributable to this programme

⚠️ **DERIVED by `tools/ci_inventory.py --baseline previous-valid-master --attribute`
(E CP38).** Filed per R-OTHERS: NEW entries attributed to something other than this
programme's own commits are recorded here, never fixed here.

## Run #42 (35340953181) vs its correctly-derived predecessor, run #41 (35339867599)

This is the run the original "41 NEW" finding was measured against (using the OLD
fixed baseline, `35008710335`). Re-measured under the rolling-baseline design against
its true immediate predecessor:

**22 NEW · 0 NEW-OURS · 0 NEW-OTHERS · 22 UNATTRIBUTED.**

Every one of the 22 traces to **no commit at all** in the run #41→#42 range that
touches its test file or an import of it:

```
tests/test_mutation_harness_anchors.py   (multiple test_a_not_applied_mutation_*,
                                           test_every_mutation_arm_* cases)
tests/test_gate_box_lock.py
tests/test_gitattributes_eol.py
tests/test_secret_scrub.py
tests/test_audit_sandbox_env.py
tests/test_breadth_restore.py
tests/test_discord_render_*.py
tests/test_bars_server_include_today.py
tests/test_e2e_sandbox_guard.py
tests/test_flow_classification.py
tests/test_shared_data_root_guard.py
```

**Reading: these are UNATTRIBUTABLE-TO-RANGE, not "caused by another workstream's
commit in this window."** They pre-date the run #41→#42 range entirely. F-CI-46's
missing-PyYAML collection defect (fixed by E CP36, the only real code change in this
narrow range) was aborting whole CI shards — so these tests were never even
COLLECTED before E CP36 landed, let alone run. The moment collection was fixed, they
ran for the first time against master and reported their pre-existing state. Nobody's
commit "broke" them in this window; the window's own fix simply made them visible.

**Neither NEW-OURS nor NEW-OTHERS applies here** — there is no commit to attribute to
any workstream, ours or otherwise, because none exists in range. This is the honest
output of `attribute_change`'s design: it reports UNATTRIBUTED with the evidence of
absence (the range and path checked) rather than guessing a cause.

## Current state: already moot

Re-measured against the current master tip, run #50 (676d44dd0, 2026-09-18), using
its correctly-derived predecessor run #49 (cd3c92923):

**0 NEW · 0 NEW-OURS · 0 NEW-OTHERS · 0 UNATTRIBUTED — verdict NO_NEW_FAILURES.**

Whatever state those 22 (and whatever else the original 41-count against the old
fixed baseline was counting) settled into, it has resolved through eight subsequent
master runs' worth of ordinary work from whichever workstreams own those test files —
none of which are this programme's 50 merged units, none of which this session
touched. **No further action from this programme.** This file exists as the
retrospective record R-OTHERS asks for, not as an open item.
