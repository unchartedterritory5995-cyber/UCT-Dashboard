# Share privacy (2026-11-13): source disclosure, no author id, no client-written author

Branch `fix/pine-share-privacy`. Coordinator rulings (owner delegated): shared runtime documents
carry their Pine source (DECIDED: the runtime lane cannot run without it, and members import
TradingView scripts), so the share must say so. Share answers must not carry the author's member
id. The server must never accept a client-supplied `origin.author_id`.

## 1. The disclosure

- `user_definitions.shares_source(definition)` is the one test: `runtime_definitions.is_runtime`.
  An `ast` document never carries its script, because `resolve_share` strips the run-read parts.
- Every share answer carries `includesSource`:
  - `POST /{id}/share` (the mint);
  - `GET /{id}/share`, **also when no link exists yet** (`{"token": null, "includesSource": true}`),
    so the panel can say it before the press;
  - `POST /{id}/list` (publishing mints a link);
  - the preview `GET /shared/{token}`.
- `SharePanel.jsx` shows `SHARE_SOURCE_SENTENCE` ("Sharing this script shares its Pine source code
  with anyone who has the link.") from the server's flag. It appears beside Create a share link,
  while a link is live, and beside Publish to the library. The panel never infers it from the
  document's shape.
- The strict xfail `test_OPEN_a_runtime_document_share_still_carries_its_script` is now a normal
  rail, `test_a_runtime_document_share_carries_its_script_AND_says_so`. It asserts (a) the source is
  carried and (b) `includesSource` is true.

## 2. No author id in anything a member receives

**Before:**
- The preview (`GET /shared/{token}`) returned `author_id` (the author's member id).
- An installed copy stored `origin.author_id`, and every read of that copy served it: the list,
  `GET /{id}`, history, the install answer, and any later share of the copy. A re-share therefore
  handed the ORIGINAL author's id to a third member.

**Now:**
- `resolve_share` returns no `author_id`. Only `install_share` asks for it (`_with_author=True`),
  to record lineage server-side.
- `served_definition` / `served_row` remove `origin.author_id`. They run at every router door that
  hands out a stored definition (list, `GET /{id}`, history, preview) and on the install answer.
- The stored document keeps the lineage. It is what `user_definitions_erasure.purge_user` scrubs
  and what the engine-verdict carry (`_carry_from`) reads, so nothing server-side lost it.
- No public display handle exists for definitions (the library deliberately names no author), so
  none was invented.

## 3. The server decides `origin.author_id`

`save()` runs `_server_origin_author` before anything reads the document:
- An ordinary save takes the author from the caller's own stored predecessor at that id. An edit
  keeps what the store holds, and a scrubbed `None` stays `None`.
- `install_share` and `fork` hand the value in from server-side reads.
- A client value is never used. A new definition cannot claim an author.

Effects:
- The erasure edge is closed. After `purge_user`, an Undo in a tab left open re-PUTs the old
  document, author id and all, and the stored copy still names nobody.
- A served copy sent back unchanged is still a byte-identical no-op re-save (the server re-adds
  the stored value).
- `tombstone_sweep` case 3 now covers only a save whose predecessor read raced the purge. Its test
  simulates that race explicitly.

## Rails

- `tests/test_share_privacy.py` (11):
  - the disclosure: before a link, at the mint, on publish, on the preview, false for a formula,
    and false for a row the caller cannot see;
  - a probe of EVERY router route as the viewer, with the copy, its fork and the author's id: the
    author's member id appears in no answer, and a CONTROL shows the stored row would carry it;
  - the install answer and the preview carry no author id;
  - a re-share hands on neither member's id;
  - the Undo-after-erasure case, a forged id, a new definition claiming an author, and the no-op
    re-save.
- `tests/test_share_strips_run_reads.py`: the former xfail.
- `SharePanel.test.jsx` (+2): the line shows before a link is created (no POST yet) and stays once
  the link is live; it is absent for a formula.
- Updated, not weakened:
  - `test_definition_sharing` and `test_definition_library`: `author_id` is absent from share
    answers and present server-side;
  - `test_pine_runtime_shared_stamp`: the preview's key set;
  - `test_user_definitions_erasure`: the next author is recorded server-side;
  - `test_tombstone_sweep`: the sweep's race case is now simulated;
  - two JS mocks no longer send `author_id`, which the producer no longer emits.

## Mutants

Listed with results in the PR body (all KILLED; each file restored from a saved copy and its blob
checked equal to HEAD).

## Pre-existing reds (not this change)

These fail identically on `origin/master` `bac37a2c1f` (checked by detaching to it):
- `tests/test_user_definitions_auth.py::test_require_paid_is_defined_PER_ROUTER_and_this_task_invented_no_shared_one`:
  duplicate paywall sentences across routers.
- `tests/test_definition_concierge.py`: 5 tests, budget-vs-linter ordering.
