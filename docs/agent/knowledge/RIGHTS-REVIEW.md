# Per-row rights review for withheld knowledge rows (Track C safeguard a)

Status: 2026-11-04, branch `agent/kn/rights-review`. Brain (`UCT_AGENT_KNOWLEDGE`) stays OFF. Shipped policy:
`cleared_rows` is empty and `excluded_setup_mentions.mode` is `withhold`, so the 430 rows that name an excluded setup
stay withheld. Nothing here re-admits anything by itself.

## Why
An admitted knowledge row that names an excluded setup (a third-party or unresolved template) is withheld. It may be
served only after a person reviews **that row's** provenance and rights. A commentary label never makes restricted
content permissible, and there is no bulk re-admission.

## The workflow (one row at a time)
1. `python tools/kn_rights_review.py status`: counts only. It shows the admitted rows naming excluded setups, how
   many are withheld now, cleared rows whose text still matches, and cleared rows whose text has changed.
2. `python tools/kn_rights_review.py worksheet --kb-id N --out <path OUTSIDE the repo>` writes ONE row's worksheet:
   its source, trader, category, title, why it is withheld, its full text, the `content_sha` of that text, and a
   blank decision. The tool refuses a path inside the repository and never overwrites a file, because the worksheet
   holds the row's text and must not be committed.
3. The reviewer fills `decision`:
   - `clear: true` only if UCT may serve this exact text;
   - `provenance_ref` and `rights_review_ref`: the reviewer's own record for THIS row;
   - `approved_by`: a name;
   - `approved_on`: `YYYY-MM-DD`, not in the future.
4. `validate <worksheet>` lists every problem:
   - the decision is incomplete;
   - the text changed since the worksheet was made (its sha differs);
   - the row's source is not admitted (clearing a row never admits its source);
   - the row is gone from the index.
5. `emit <worksheets>` prints the `cleared_rows` entries (a dry run). `emit ... --apply` writes them into the policy
   file and bumps `policy_version`. Any change to the shipped `policy.json` still goes through review and the owner,
   like every policy change.

## Authorization (review #793, owner 2026-11-04)
- **Server-held key:** `UCT_KN_RIGHTS_KEY` (at least 32 characters) lives only in the server environment, never in
  the repository. Applying a clearance and signing a bulk approval both need it. Every audit record and every bulk
  approval carries an HMAC-SHA256 signature under that key, so someone who can edit `policy.json` or the audit log but
  does not hold the key cannot forge a clearance, an approval or a record.
- **Runtime check:** a knowledge read serves a cleared row only when `rights.authorized()` holds for it:
  - its policy entry is backed by a validly signed audit record for that row and that exact text;
  - the log ends at the `audit_head` the policy recorded;
  - the number of cleared rows is within the cap.

  A hand-edited `policy.json` therefore serves nothing extra. Without the key on the server, nothing is cleared and
  no cleared row is served.
- **Limits:**
  - at most **20 rows per UTC day**, counted from the signed log;
  - at most **25 cleared rows** in total, unless a **signed** `bulk_clearance_approval` raises it, never above
    **200** (`BULK_MAX`). An approval that is unsigned, edited after signing, signed with another key, or above
    the bound counts as nothing.
- **The limits survive log tampering:** the policy records the log's head, so a trimmed, deleted, rotated or replaced
  log no longer matches. `apply` then refuses, and the rows that log backed stop being served. Wiping the policy's
  clearances, the head and the log all together only un-clears everything.
- **Concurrency:** `apply` holds an exclusive lock file beside the policy for its whole read-check-write.
- **Owner signing:** `python tools/kn_rights_review.py sign-bulk --by NAME --on YYYY-MM-DD --max-rows N --reason TEXT`,
  run where the key is set. It prints the approval to put in the policy, which then goes through PR review.

## What the tool cannot do
**The tool cannot verify that a person actually reviewed a row.** It checks that the worksheet is complete and the
text unchanged, and records who applied it. Whether the provenance and rights review really happened is process, and
the owner signs. The key controls who can apply, not whether a review was honest. PR review of every policy change
remains the human gate.

## Guards per run
- **No bulk re-admission:** at most 10 rows per run, one row per worksheet, no duplicate `kb_id`, and every row carries
  its OWN `rights_review_ref` (a reference shared across rows is refused). Validation is all-or-nothing: one invalid
  worksheet emits nothing.
- **Bound to the reviewed text:** the entry stores the `content_sha` the index computed for the reviewed text. The
  knowledge read serves a cleared row only while the current sha matches, so an edited row loses its clearance
  automatically (`status` reports `cleared_text_changed`).
- `apply` replaces an older entry for the same row and touches no other policy key except `cleared_rows`,
  `policy_version` and `audit_head`.

## Tests
`tests/test_uct_agent_kn_rights.py` (fixture pack only, pinned clock):
- withheld before review, then served only after a complete review;
- changed text loses the clearance;
- every incomplete-decision case, and a source that is not admitted;
- the bulk guards, and all-or-nothing validation;
- forged worksheets;
- replacement of an older entry;
- CLI: a worksheet path inside the repository is refused, an existing file is never overwritten, `status` prints
  counts only, and `emit` is a dry run without `--apply`;
- the shipped policy clears nothing.
- the cumulative guards: the daily cap across runs and its UTC-day reset, the policy cap and an owner-signed bulk approval
  (an incomplete one does not count), `--by` required, the hash-chained audit log, and an edited log blocking every
  later apply.
- authorization: no key means nothing cleared or served (a short key counts as none); an approval with any name, edited after signing, signed with another key or above the bound counts as nothing; a hand-edited clearance is never served and blocks apply; trimming, deleting or rotating the log never resets the daily cap; concurrent applies (8 threads) never exceed the cap and keep the chain; the policy cap holds on later days.
