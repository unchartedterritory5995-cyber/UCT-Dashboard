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

## Guards
- **No bulk re-admission:** at most 10 rows per run, one row per worksheet, no duplicate `kb_id`, and every row
  carries its OWN `rights_review_ref` (a reference shared across rows is refused). Validation is all-or-nothing: one
  invalid worksheet emits nothing.
- **Bound to the reviewed text:** the entry stores the `content_sha` the index computed for the reviewed text. The
  knowledge read serves a cleared row only while the current sha matches, so an edited row loses its clearance
  automatically, and `status` reports it under `cleared_text_changed`.
- `apply` replaces an older entry for the same row and touches no other policy key (`excluded_setup_mentions.mode`
  stays as it is).

## Tests
`tests/test_uct_agent_kn_rights.py` (20 tests, fixture pack only):
- withheld before review, then served only after a complete review;
- changed text loses the clearance;
- every incomplete-decision case, and a source that is not admitted;
- the bulk guards, and all-or-nothing validation;
- forged worksheets;
- replacement of an older entry;
- CLI: a worksheet path inside the repository is refused, an existing file is never overwritten, `status` prints
  counts only, and `emit` is a dry run without `--apply`;
- the shipped policy clears nothing.
