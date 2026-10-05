# Wave 14 — the upload cap is enforced WHILE the body is read

Branch `feat/notebook-w14-voice`, from `c55d73ae69`. Closes the upload-size half of the
`NOTEBOOK_VOICE_NOTES_ENABLED` hold (census row for `POST /api/j2/voice-notes/jobs` in
`security-review-notebook-routes.md`) and finding **S-3** (note image / hero / attachment).
**The flag is NOT armed.** What still holds it is the OpenAI zero-retention letter (row 8a),
which is the owner's.

## The gap

Every notebook upload door checked size AFTER the body was read:

| door | what it did before |
|---|---|
| `POST /api/j2/voice-notes/jobs` | refused a DECLARED `Content-Length` over 91 MiB, but a chunked body, or one with no length, or one whose length lied, was parsed by `request.form()` IN FULL — spooled to a temp file — before the service's 90 MiB read cap ran |
| `POST /api/j2/notes/{id}/images`, `/hero` | `UploadFile = File(...)`: FastAPI parses that parameter in full **before any dependency runs**, so before the session check too; then `await upload.read()` held it in memory; THEN the 5 MiB check |
| `POST /api/j2/notes/{id}/attachments` | same, 25 MiB |
| personal API `_json_body` (`/api/j2/personal/...` note doors) | `await request.body()`, then the length check |

## The fix — one helper

`api/services/request_body_cap.py`. No per-route copies.

- `_arm(request, limit, sentence)` refuses a declared `Content-Length` over the limit before
  a byte is read (a malformed one is a 400), then swaps the request's ASGI `receive` for a
  counting one. The pull that passes the limit raises `BodyTooLarge` **before that chunk is
  handed to the parser**, so nothing past the cap is ever spooled.
- `BodyTooLarge` subclasses Starlette's `MultiPartException` on purpose: the multipart parser
  closes every temp file it opened only when that exception type escapes its read loop.
  Starlette then words it as a 400; the helper reads its own `tripped` flag and answers 413
  with the route's sentence.
- `read_capped_body(request, limit, sentence)` — for the personal API's JSON body.
- `read_capped_form(request, limit, sentence, max_files, max_fields)` — for voice notes.
- `capped_upload(field, max_bytes, sentence)` — a yield dependency that stands in for
  `UploadFile = File(...)`: body capped at the file cap + `FRAMING_SLACK` (64 KiB), the file
  part then held to its exact cap, the form closed when the request ends. It is declared
  AFTER the route's `user` dependency, so an anonymous caller reads nothing (measured: 0 body
  bytes pulled on a 401).
- Limits and sentences are passed as callables read per request: the service constant stays
  the one authority (`vn.MAX_UPLOAD_BYTES`, `notes._MAX_IMAGE_BYTES`, `notes._MAX_FILE_BYTES`,
  `notes.IMAGE_TOO_BIG_SENTENCE`, `notes.FILE_TOO_BIG_SENTENCE`). No work at import.

Two behaviour changes a member could see, both deliberate:

1. An image over 5 MB or a file over 25 MB now answers **413** with the same sentence it
   used to answer as a 400. The editor reads `detail` either way.
2. The voice route's form is now closed when the request ends (it was left to the garbage
   collector before; the at-the-cap test found it).

## Routes checked and NOT changed

| route | why |
|---|---|
| email-in `POST /api/j2/inbound-email` | already streams with a running total (`_read_capped`, fix round 1 M-3) |
| AI actions, chart alerts, shares, writing help | already stream with a running total |
| entry context, plan grades, template gallery `_read_json` | `await request.body()` then a length check, 8–256 KB JSON. Same pattern, but JSON writes, not uploads (S-2 family). One-line conversion to `read_capped_body` each; left as an open item |
| journal `/trades/{id}/attachments`, `/calendar/day/{date}/attachments`, `/trades/import/preview`, `/preview-mapped` | Journal, not Notebook, routes with the same `File(...)` pattern. `capped_upload` fits each as a one-line change; left as an open item |
| image / docx import, OCR | ride the note attachment door above (`_hand_off_to_documents`), so they are covered |

## Tests

`tests/test_notebook_upload_cap.py` — 38 tests. Requests go through a hand-rolled ASGI
`receive` that hands the body over chunk by chunk from a **generator** and counts what the
app pulled (a test client buffers the whole body first, so it cannot show "capped while
read"). Per door: chunked just over the cap (413, nothing persisted, every spooled temp
file closed and gone from disk), far over (stopped within one chunk of the cap), at the cap
(accepted), a lying `Content-Length`, a declared length over the cap (0 bytes read), an
ordinary upload, and no session / free plan (0 bytes read). The voice tests move
`vn.MAX_UPLOAD_BYTES` to 2 MiB so the suite never streams 90 MiB; the note doors run at
their real 5 / 25 MiB caps.

Mutation proof (`api/services/request_body_cap.py`, each applied as text, restored by
writing back the captured bytes, sha `b5aab0b5…585b` verified after each):

| mutation | result |
|---|---|
| M1 the counting receive never trips (streaming cap removed) | 11 failed, 27 passed |
| M2 `BodyTooLarge` no longer a `MultiPartException` | 8 failed, 30 passed |
| M3 the declared-length refusal removed | 5 failed, 33 passed |
| control, unmutated | 38 passed |

## Scoped run (25 files, the notebook route tests plus the census rails)

`2 failed, 1385 passed in 1382.84s` on a box at 100% CPU with ~1.9 GB available. Both reds
are pre-existing and outside this diff:

- `test_user_definitions_auth.py::test_require_paid_is_defined_PER_ROUTER_...` — two
  routers share one 402 sentence (81 distinct of 83); this branch changes no 402 sentence.
- `test_ai_doors_census.py::test_every_module_that_calls_a_model_...` —
  `api/services/screener/nl_compile.py` has no Door row; this branch does not touch it.

`tests/test_no_shadowed_definitions.py` and `tests/test_notebook_feature_rail_census.py`
(whole-repo sweeps) hit the 300 s per-test timeout under that load; run on their own with a
1200 s timeout: `16 passed, 6 warnings in 503.34s`.

## Open items

- The Journal `File(...)` routes and the three small JSON `_read_json` readers listed above.
- The voice-notes flag stays dark: the OpenAI zero-retention letter (row 8a) is the owner's.
