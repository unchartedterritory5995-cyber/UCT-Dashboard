# SIGNING SESSION — the runbook

**37 units are waiting on a signature.** Two commands do the whole thing. Both are now
**resumable**, which they were not this morning (K CP5) — so an interruption costs a
re-run, not a manifest edit.

⛔ **Read the table `sign_all` prints before it writes anything.** That table, not this
file, is the thing you are approving.

---

## The four commands, in this order

```
cd C:\Users\Patrick\uct-worktrees\terminal-research

python tools/sign_all.py  --manifest tools/sign_manifest.txt --dry-run     # 1  read it
python tools/sign_all.py  --manifest tools/sign_manifest.txt               # 2  sign
python tools/merge_all.py --manifest tools/sign_manifest.txt --dry-run     # 3  read it
python tools/merge_all.py --manifest tools/sign_manifest.txt               # 4  merge
```

**Exit codes:** `0` done · `1` a failure · `2` REFUSED, nothing written · `3` a packet
that can never be signed as it stands.

⛔ **Step 4 stops before `s2-accelerator-chord` on purpose.** It is the one
member-visible unit: Ctrl/Cmd/Alt+Shift+F stops flagging tickers on three screens (plain
Shift+F is unchanged). It goes only with `--include-member-visible`, as a separate
decision.

## If it stops — the resume

**Re-run the same command.** Nothing else.

- `sign_all` verifies each already-signed row (the manifest's value must be on the
  packet **and** re-derive from it), prints `SIGNED-ALREADY`, and skips it.
- `merge_all` asks **master** — `git merge-base --is-ancestor <commit> origin/master` —
  and skips units already on it. Not the manifest, not a local branch, not a state file.
- ⛔ **One exception that needs a hand:** a *failed* cherry-pick leaves the code worktree
  mid-pick. The tool now says so and names the fix:
  `git -C C:\Users\Patrick\uct-worktrees\s7-price-level cherry-pick --abort`.

## What to expect while it runs

| | |
|---|---|
| units signed | **37** |
| units that push to master | **31** (6 are docs-worktree only and never push) |
| per pushing unit | build **~140–190 s** + settle **150 s** ≈ **5–5.6 min** |
| **total, empty queue** | **2 h 30 m – 3 h 00 m** |
| the Layer-0 guard refusing at least once | **expect it** — 8+ web deployments landed from other sessions in one 2.5 h window on 2026-09-15 |

The guard is the right behaviour, not a fault: it refuses while the last `web` deployment
is not SUCCESS or is younger than 150 s. **It cannot hang** — `main()` calls
`latest_deployment()` once and `decide()` once and returns; there is no wait loop. It
applies to **`refs/heads/master` and `main` only**, so pushing the docs branch is never
gated by it. And it does not care what is in your diff: a docs-only commit still builds
the web service (measured — `a4e845fe7`, a docs commit, reached SUCCESS ~186 s after
`createdAt`), so "no runtime change" buys no exemption and should not be given one.

## ⚠️ Two things to decide before you sign

1. **`SCOPE APPROVED:` will be BLANK on all 37 blocks.** `sign_gate.sign()` accepts a
   `scope` argument and never writes it — measured by AST, with `by`/`on` as the positive
   control. The scope text lands in an untracked `.scopes/*.txt` beside the repo and
   influences nothing. Three signed blocks in the tree already look like this.
   **Not fixed here on purpose:** writing the scope changes the packet's bytes, and the
   bytes are what the 37 manifest fingerprints pin — so the fix re-fingerprints the whole
   manifest in one commit. That is your call, not a tool's.
2. **If the ~3 hours is too long, the only lever bends a rule.** Batching N consecutive
   units into one push turns 31 builds into 31/N; at N=4 the session is ~45 minutes. It
   bends *"ONE UNIT AT A TIME, AND IT WAITS"* — the rule written after 2026-09-12, when
   two merges four minutes apart marked the first deploy REMOVED mid-flight and
   `/api/health` served 502 for ~45 s. What you lose is the revert granularity: a bad
   batch reverts as a batch. **The cheaper answer is two sittings** — the tools are
   resumable now, and that costs no rule at all.

---

## The idempotency controls, as run (2026-09-15)

```
CONTROL A — the resume: two fixture packets, already signed, same command again
  1  probe-signed.md    E CP24   SIGNED-ALREADY
  2  probe-control.md   E CP23   SIGNED-ALREADY
  [sign-all] 2 already signed (verified, will be skipped) · 0 to sign · 0 refusing
  [sign-all] NOTHING TO DO — every row is already signed. This is the resume case,
             and it is a success, not a refusal.
  exit=0

CONTROL B — the interruption: row 1 signed, row 2 fresh
  1  probe-signed.md    E CP24   SIGNED-ALREADY
  2  probe-control.md   E CP23   ok
  [sign-all] 1 already signed (verified, will be skipped) · 1 to sign · 0 refusing
    probe-signed.md    SIGNED-ALREADY (c9904433a)
    probe-control.md   SIGNED
  exit=0

CONTROL C — it can still refuse: a packet edited AFTER signing
  1  probe-signed.md    E CP24   SIGNED-DRIFTED
       want c9904433a
       got  13255ffe3
       signed with the right value, which no longer re-derives — the packet was
       EDITED AFTER SIGNING.
  ⛔ STOPPED at 1 row(s). NOTHING WAS WRITTEN …
  exit=2

CONTROL D — it can still refuse: the manifest naming a different value
  1  probe-signed.md    E CP24   SIGNED-ELSEWHERE
       want deadbeef1
       got  c9904433a
       the packet is signed, but not with the value this manifest names — a
       different approval is on it.
  exit=2

merge_all — reading MASTER, both directions, in a throwaway repo
  git merge-base --is-ancestor <merged commit>   origin/master  ->  exit 0   skip it
  git merge-base --is-ancestor <unmerged commit> origin/master  ->  exit 1   still to do

merge_all — the deploy wait, against the live list with no deploy of ours in it
  rows returned: 20   statuses: {'SUCCESS': 1, 'REMOVED': 19}
  OLD predicate  '"SUCCESS"' in out      ->  True     (this is why it never blocked)
  NEW row lookup for our commit hash     ->  None     (keeps polling)
```

**Before this session both controls A and B ended the same way:**

```
⛔ no UNSIGNED `APPROVED AT SHA:` line (every block already carries a fingerprint).
exit=1          ...raised in PASS 1, at row 1, before any row was classified.
```

## Validators, last run 2026-09-15

```
sign_gate --self-check   PASS   exit 0
sign_gate --read-check   PASS   exit 0
merge_all --self-check   PASS   exit 0
sign_all  --dry-run      37 rows, 37 ok, 0 refusing, exit 0
merge_all --dry-run      37 units, 29 constraints, 0 already merged, exit 0
```
