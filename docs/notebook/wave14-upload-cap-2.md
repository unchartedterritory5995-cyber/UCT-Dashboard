# Wave 14, cap 2: the Journal upload doors and the three JSON readers

Branch `feat/notebook-w14-cap2`, from `9004bd8dac`. Closes the open items of
`docs/notebook/wave14-upload-cap.md` with the same helper, `api/services/request_body_cap.py`.
No copy of the helper was made and the helper itself is unchanged.

## What was wrong

| door | before |
|---|---|
| `POST /api/j2/trades/{trade_id}/attachments` | `UploadFile = File(...)` declared before `user`. FastAPI parses a `File(...)` parameter in full before any dependency runs, so before the session check too; the service then did `await upload.read()` and checked 5 MB |
| `POST /api/j2/calendar/day/{date}/attachments` | same, 5 MB |
| `POST /api/j2/trades/import/preview` | same, then `parse_csv` checked 10 MB on the bytes already in memory |
| `POST /api/j2/trades/import/preview-mapped` | same, and **no size check at all**: the whole upload went to `decode_bytes` |
| `_read_json` in `notebook_entry_context` (8 KB), `notebook_plan_grades` (16 KB), `notebook_template_gallery` (256 KB) | `await request.body()`, then the length check. A chunked or no-length body was buffered whole first |

## The change

- The four Journal doors take their file through `body_cap.capped_upload`, declared AFTER
  `user: dict = Depends(get_current_user)`, so an anonymous caller reads nothing (measured:
  0 body bytes pulled on a 401). The three dependencies sit at the top of
  `api/routers/journal_two.py`, next to a comment saying why. The `request_body_cap` import
  moved there from mid-file (where the note doors had added it), so it is bound once.
- The three `_read_json` readers call `body_cap.read_capped_body(request, MAX_BODY_BYTES,
  TOO_LARGE_SENTENCE)`. Auth before read was already the order (each body dependency depends on
  the session or paid dependency, behind the router-level gate); a test now holds it.
- Each route keeps its message, and the service owns it as one constant read per request:
  `trade_attachments.IMAGE_TOO_BIG_SENTENCE` and `calendar.IMAGE_TOO_BIG_SENTENCE`
  ("Image must be < 5 MB"), `csv_import.too_big_sentence()` ("File exceeds 10 MB limit",
  derived from `MAX_BYTES`), and `TOO_LARGE_SENTENCE = "Request too large"` per JSON router.
  The services' own checks now use the same constant, so the two can never disagree.
- `preview-mapped` now has the 10 MB cap `preview` always had.

Behaviour a member could see: an image over 5 MB or a CSV over 10 MB answers **413** where it
answered 400, with the same sentence. `TradeScreenshots.jsx` and `DayAttachments.jsx` read
`detail` whatever the status; `ImportCsvModal.jsx` shows its own sentence on any non-2xx.

## Tests

`tests/test_notebook_upload_cap_2.py` -- 57 tests, written before the change (first run against
the old code: `22 failed, 13 passed, 21 errors`). It imports the instrument from
`tests/test_notebook_upload_cap.py` rather than copying it: the hand-rolled ASGI `receive` that
hands the body over chunk by chunk from a generator and counts what the app pulled. `Drive`
gained a `method` argument (default `POST`) for the `PUT` and `PATCH` doors.

Per Journal door (4 doors, parametrized): chunked with no Content-Length just over the cap (413,
the route's own sentence, nothing written under the attachment root, every spooled temp file
closed and gone from disk), far over (stopped within one chunk of the cap), at the cap (accepted),
a lying Content-Length (413, stopped at the cap), a declared length over the cap (413, 0 bytes
read), an ordinary request through the test client, and no session (401, 0 bytes read). The
image doors run at their real 5 MiB caps; the CSV doors move `csv_import.MAX_BYTES` to 256 KiB,
which the route reads per request, and the at-cap body is a real parseable CSV.

Per JSON reader (3 readers): the same no-length, far-over, at-cap, lying-length, declared-over
and ordinary cases through an echo route calling the real `_read_json`, plus empty and
non-object bodies keeping their answers. The real write doors (`PUT /entry-context/why`,
`POST /plan-grades/trades/{id}/relink`, `POST /template-gallery`, `POST
/template-gallery/{id}/report`) with their gates on and no session: 401, 0 bytes read.

Source rails use the AST, not a text search, so a comment cannot satisfy or fail them: no
parameter default in `journal_two.py` is a `File(...)` call, no reader calls `.body()`, and each
calls `read_capped_body`. A non-vacuity test proves both probes find the construct when it is there.

Mutation proof (`tests/test_notebook_upload_cap_2.py` + `tests/test_notebook_upload_cap.py`, 95
tests). Each mutation applied as text, restored by writing back the captured bytes and verified
against both the capture and the committed blob (CRLF-normalised), `git status` clean after:

| mutation | result |
|---|---|
| control, unmutated | 95 passed |
| M1 the trade door back to `File(...)` declared before `user` | 6 failed, 89 passed |
| M2 the CSV cap reads a 20 MB copy, not `csv_import.MAX_BYTES` | 9 failed, 86 passed |
| M3 the entry-context reader back to `request.body()` then a length check | 4 failed, 91 passed |
| M4 helper: the counting receive never trips | 28 failed, 67 passed |
| M5 helper: the declared-length refusal removed | 12 failed, 83 passed |
| control, after | 95 passed |

## Scoped run

16 files: both cap suites, the route security census, the entry-context, plan-grading and
template-gallery suites, the inline-image parity rail, the journal service suites for trade
attachments, CSV import and presets, calendar, trade detail, attachment sweeps and orphans, and
the user-definitions auth rail:

`2 failed, 428 passed in 157.50s`. Both reds predate this branch (each checked at `9004bd8dac`):

- `test_user_definitions_auth.py::test_require_paid_is_defined_PER_ROUTER_...` -- three screener
  routers share one 402 sentence (81 distinct of 83). This branch changes no 402 sentence.
- `test_notebook_route_security_census.py::test_every_notebook_route_on_the_real_app_is_classified_and_agrees`
  -- `PUT /api/j2/onboarding/tours/{tour_id}` (`notebook_onboarding.record_tour_state`) exists at
  `9004bd8dac` with no census row. That row belongs to the onboarding lane.

`tests/test_no_shadowed_definitions.py` on its own: `11 passed in 29.37s`.

## Open items

- **Found, not fixed: the CSV column mapper's mapping never reaches the server.**
  `preview-mapped` declares `mapping: str = ""`, which FastAPI reads as a QUERY parameter
  (`route.dependant.query_params == ['mapping']`, both before and after this change), while
  `ImportCsvModal.jsx` sends `mapping` as a FORM field. So the route parses with an empty
  mapping. The fix (read `mapping` from the capped form) is a behaviour change for the import
  wizard and wants its own test against the client.
- Other `api/routers` doors with the same whole-body-then-check shape, outside the Notebook and
  Journal and left for their owners: `auth.py` ticket attachments, `avatar.py`, `community.py`
  images (bounded read, but the part is spooled whole first), `desk.py` team photo (admin),
  `indicator_vision.py` candidates (the bounded read follows a full spool), and `voice.py`
  vision upload, document upload and the two audio routes, which have no size cap at all. Each
  declares `File(...)` before its auth dependency. `capped_upload` fits the single-file ones
  directly; `indicator_vision` and `voice.py` also take `Form` fields, which `capped_upload`
  does not return, so they need a small helper extension first.
- JSON-body readers left as they are: `breadth_monitor.py` (`request.json()` behind the push
  secret, and `/api/breadth/industries` behind `require_paid`), `broker_sync.py`'s signed
  webhook, and the signed webhooks in `desk_zoom_webhook.py`, `discord_interactions.py` and
  `webhooks.py`, which need the raw body for the signature. Each is bounded by the edge today.
