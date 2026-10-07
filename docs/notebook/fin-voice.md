# Finish program, lane VOICE: a dead read-aloud request, and every body read bounded and ordered

Branch `feat/notebook-fin-voice`, from `72715e8001`. Three items from the lane brief, plus two
the controller added: security review finding I-5, and a 500 on the voice cost door.

## 1. "Read me the morning briefing" played nothing

### What was wrong

In a voice session a member can ask to have the morning or the closing briefing read aloud. The
model calls the `read_aloud` tool, the server answers "Reading morning briefing." and tells the
client which content to fetch and speak. For the two briefings the client fetched the text like
this (`app/src/hooks/useRealtimeSession.js:132` and `:149` at `72715e8001`):

    POST /api/voice/oneshot
    Content-Type: application/json
    {"transcript": "give me the morning briefing"}

and read `narration` from a JSON reply.

`POST /api/voice/oneshot` is the microphone door. It takes a multipart form with an `audio`
recording, transcribes it, runs a tool, and answers with an MP3 stream. It has done that since the
day it was added (`3e8ca24c5c`, 2026-05-09). The caller was written two days later (`64f66fa29e`)
against a shape the route never had. So the request was refused from the first day:

    422 {"detail":[{"type":"missing","loc":["body","audio"],"msg":"Field required","input":null}]}

The client treats a refused fetch as empty text, and the read-aloud player returns without a word
when the text is empty. The member heard "Reading morning briefing." and then silence.

**The client was the wrong side.** Both halves of its request were wrong, the body and the reply
it expected. Even a route that accepted the JSON would have answered with audio, and the client
wanted text to hand to its own player.

### Is it live in production

Yes. `origin/master` holds the same two calls. There is no flag on this path. It is reachable by
any member with voice access (a paid plan, an admin, or an account in its trial) who is in a live
voice session and asks for a briefing to be read aloud, when the model answers with the
`read_aloud` tool. No data is at risk: the request is refused and nothing is written.

### What changed

- The two briefings are voice tools (`morning_briefing`, `closing_briefing`). A read-aloud plan is
  only ever built inside a live session. So the plan now runs the tool through the tool door,
  `POST /api/voice/exec {session_id, tool, args}`, and reads `result.narration`. No server change.
- The plans moved out of the hook into `app/src/hooks/readAloudPlans.js`. That module imports
  nothing, so a test can run it without React.

### How it is pinned

`tests/test_voice_client_request_shapes.py`, 14 tests. Against the old code: `8 failed, 6 passed`.

Neither side is restated in the test.

- **The client side is parsed.** `tests/support/client_fetch_census.cjs` reads the parse tree of
  every file under `app/src` and reports each request the app builds for `/api/voice/*`: method,
  path, Content-Type, and the JSON keys or the form field names. 58 calls in 25 files.
- **The server side is read from the route.** Its pydantic body model, or the field names held by
  its `request_body_cap` dependency.
- A request and a route that disagree fail by file and line, in either direction: a key the model
  does not declare, a required field the client does not always send, JSON sent to a form door.
- **The briefing path runs end to end.** The client module builds its request in Node. The real
  route answers it through the test client. The client module reads the answer. The spoken text
  must be the sentence the briefing service returned.

Mutation proof, each applied as text and restored from the captured bytes, `git status` clean after:

| mutation | result |
|---|---|
| control | 14 passed |
| client reads `j.narration` (the old read path) | 4 failed, 10 passed |
| client names a tool that does not exist | 2 failed, 12 passed |
| client back on the microphone door | 6 failed, 8 passed |
| server renames `ExecRequest.tool` | 8 failed, 6 passed |
| server: transcribe reads its file from `file` | 3 failed, 11 passed |
| client drops `session_id` from the body | 4 failed, 10 passed |
| control, after | 14 passed |

### Left as found

- `POST /api/voice/oneshot` now has no caller under `app/src`. It was not removed. Removing a
  mounted route is a separate decision.
- A read-aloud whose text comes back empty still ends in silence, for every kind of content, not
  only the briefings. The assistant has already said "Reading ...". That is how the player has
  always behaved (`app/src/hooks/useReadAloud.js:50`).

## 2. Every request body in the Notebook and Journal family: bounded, and read in order

### The two defects

**A body read with no bound.** `await request.json()`, or a FastAPI body parameter, holds the whole
body in memory before any size is measured.

**A body read in the wrong order.** FastAPI reads the body for a declared body parameter
(`body: Model`, `payload: dict`) before it runs any dependency. That is before a router's dark-flag
gate and before the session check. Two things follow:

1. An anonymous caller can make the process buffer a body of any size.
2. A route behind a dark flag answers 422 to malformed JSON, where every other request to it
   answers 404. So an outsider can tell the feature is in the build. This is security review
   finding I-5, and it was confirmed here before any change: `POST /api/j2/thesis-chips` with the
   body `{`, no cookie, flag off, answered `422 json_invalid`.

### What the census found

The census is `tests/support/body_census.py`. It reads the route objects of the real app for the
order FastAPI solves dependencies in, and the parse tree of every function on that chain for the
reads. It follows the request object into any helper it is handed to. A comment or a docstring is
not a call, so prose can neither satisfy nor fail it.

Before this lane, of 408 routes in the family, 129 read a body:

| how the body was read | routes | bounded | in order |
|---|---|---|---|
| a FastAPI body parameter | 93 | no | no |
| `await request.json()` | 1 (the SnapTrade webhook) | no | n/a, no session |
| `request_body_cap` (wave 14) | 22 | yes | yes |
| a streaming loop with a running total | 13 | yes | yes |

The 93: 67 in `journal_two.py`, 12 in `voice.py`, 4 in `broker_sync.py`, 4 in `note_sync.py`, 2 in
`capture_auth.py`, and the four of I-5 (`notebook_thesis_chips.py`, two in
`notebook_research_capture.py`, `notebook_onboarding.py`).

### The fix: one more function in the existing helper

`request_body_cap.capped_json(annotation, max_bytes, sentence, *, after=None)` is a dependency that
stands in for a declared JSON body parameter:

    def route(payload: dict = Depends(_json(dict)), user: dict = Depends(get_current_user)): ...

- It reads the body through `read_capped_body`, so the cap is enforced while the body is read. A
  declared length over the cap is refused before one byte is read.
- It depends on `after`, the route's own session dependency. FastAPI therefore runs the session
  check first, whatever order the parameters are written in, and runs it once: the route's own
  `Depends(...)` reuses the same answer. A router-level gate runs before both.
- It validates against the annotation and keeps the status and the error shape FastAPI gave: 422
  `json_invalid` for broken JSON, 422 `missing` for an absent required body, pydantic's own errors
  under `("body", ...)`, and the same Content-Type rule. 18 request shapes are compared against a
  declared parameter side by side in the test.
- Each router has a small `_json(...)` wrapper that names its limit and its sentence.

Every one of the 93 routes now takes its body this way. The parameter keeps its name and its type.
In three routes it moved one place to the right, because a parameter with a default cannot come
before one without (`create_position`, `update_note_endpoint`, `session_end_post`). Nothing in the
repo calls those three by position. The webhook reads through `read_capped_body`.

On the seven plan-gated routes of `broker_sync.py` and `note_sync.py` the plan gate parameter now
comes before the body parameter. FastAPI solves a route's dependencies in the order its parameters
are written, so a member without a plan is refused (403) before the body is read or validated.
There `after` is the session, not the plan gate, so the gate stays in one place per route.
`tests/test_exposed_routes_gated.py` removes it from that one place and expects the route to open.

**For whoever strengthens a route's auth dependency later** (session to paid): pass the new
dependency as `after=` to that route's `_json(...)`, or write the auth parameter before the body
parameter. Otherwise a member without a plan who sends a bad body gets a 422 before the 402. The
handler never runs either way.

What a caller can notice:

- A request with no session and a bad body now answers 401 where it answered 422.
- A dark route answers its 404 whatever it is sent.
- A body over its limit answers 413 with a sentence.

### The limits

No new number was invented where a service already had one. Each limit is read per request from
the constant that governs the door.

| router | doors | limit | from |
|---|---|---|---|
| `journal_two` | every JSON door but two | 2.25 MB | `2 * notes.MAX_BODY_JSON_BYTES + 256 KiB`. The largest thing an editor sends is a note save. The service holds a note body to 1 MB, and a save can carry it twice (the document and its text) |
| `journal_two` | `POST /trades/import/confirm` | 40 MiB | `4 * csv_import.MAX_BYTES`. The rows the preview parsed out of a CSV the preview door held to 10 MiB. As JSON a row is a few times its CSV line |
| `journal_two` | `POST /notes/import/confirm` | 32 MiB | `NOTE_IMPORT_JSON_MAX_BYTES`, by name (round 3). The importer sends a large import as several requests of at most 24 MiB and 200 notes each |
| `voice` | most doors | 64 KiB | a sentence or a setting |
| `voice` | `/tts`, `/tts/prepare` | 259 KiB | `4 * MAX_TTS_CHARS + 64 KiB` |
| `voice` | `/vision/describe` | 6.7 MiB | `VISION_MAX_BYTES * 4 / 3 + 64 KiB`, a base64 image the upload door holds to 5 MiB |
| `voice` | `/documents/ingest-text` | 10 MiB | `DOCUMENT_MAX_BYTES + 64 KiB`, what the document upload door takes |
| `broker_sync` | four JSON doors | 64 KiB | ids and short strings (the share doors' limit) |
| `broker_sync` | `/webhook` | 1 MiB | SnapTrade's event envelope |
| `note_sync` | four JSON doors | 64 KiB | a token or a capability URL |
| `capture_auth` | two doors | 16 KiB | a redirect URI, a client id, a code |
| `notebook_thesis_chips` | one | 64 KiB | at most 300 tickers |
| `notebook_research_capture` | two | 485 KiB | `8 * transcript_capture.MAX_TURN_CHARS + 16 KiB` |
| `notebook_onboarding` | tours | 8 KiB | one state word and one step id (the entry-context limit) |

### The rail

Two files, 44 tests. Before the routes were changed: `5 failed, 36 passed` (then one file of 41).
After: `44 passed`.

- `tests/test_notebook_body_order.py` (31): the helper against the parameter it replaces, every
  gated route, and the dark-route tests. This is the I-5 file.
- `tests/test_notebook_body_census.py` (13): the whole family, and the controls.

- **No unbounded read.** Fails by route name when one appears. The declared-exception list is empty.
- **Order.** Gate, then session, then body, for every route in the family.
- **No session is a named decision.** Nine doors read a body with no session (a signature, a
  bearer token, a one-time code). A tenth fails by name.
- **The family cannot be dodged.** A route under `/api/j2` in a module the rail has not heard of
  fails by name.
- **Controls.** A synthetic app proves the rail sees a raw `request.json()`, an unbounded
  streaming loop, a read made inside a helper the request was passed to, and a declared body
  parameter. A route whose docstring, comment and string literal each name a body read, and which
  reads nothing, comes back with no reads.
- **Dark routes.** For every body-taking route whose gate refuses, an anonymous request that is
  empty, well formed, malformed, not an object, or 8 MiB answers the same status and the same
  bytes, with no body byte read. The status equals the status of an unknown path under the same
  prefix sent the same bodies.

Mutation proof over both files, each applied as text and restored from the captured bytes, `git
status` clean after:

| mutation | result |
|---|---|
| control | 44 passed |
| thesis chips back to a declared body parameter | 6 failed, 38 passed |
| a journal door back to a declared body parameter (`PUT /settings`) | 2 failed, 42 passed |
| the broker webhook back to `request.json()` | 1 failed, 43 passed |
| helper: `capped_json` ignores `after` | 6 failed, 38 passed |
| helper: `capped_json` reads the body with no cap | 3 failed, 41 passed |
| helper: any Content-Type is parsed as JSON | 1 failed, 43 passed |
| the tours door reads its body before the session | 3 failed, 41 passed |
| census reader blind to a declared body parameter | 2 failed, 42 passed |
| census reader blind to raw request reads | 6 failed, 38 passed |
| a plan-gated route puts its body before the plan gate | 1 failed, 43 passed |
| control, after | 44 passed |

### The census table

Generated from the code (the command is in the test file's docstring). One row per body read.
"Order" is the order the route actually runs in.

129 body reads. 116 go through `request_body_cap`, 13 are a streaming loop with a running total, none is unbounded.

| method | path | router | body read | bounded by | size | gate | session | order |
|---|---|---|---|---|---|---|---|---|
| PUT | `/api/j2/broker/accounts/{broker_account_id}` | broker_sync | capped_json | `request_body_cap` (capped_json) | 64 KiB | no | get_current_user | session, body |
| POST | `/api/j2/broker/connect` | broker_sync | capped_json | `request_body_cap` (capped_json) | 64 KiB | no | get_current_user | session, body |
| DELETE | `/api/j2/broker/connections` | broker_sync | capped_json | `request_body_cap` (capped_json) | 64 KiB | no | get_current_user | session, body |
| POST | `/api/j2/broker/dup-flags/{flag_id}` | broker_sync | capped_json | `request_body_cap` (capped_json) | 64 KiB | no | get_current_user | session, body |
| POST | `/api/j2/broker/webhook` | broker_sync | read_capped_body | `request_body_cap` (read_capped_body) | 1 MiB | no | SnapTrade signature over the body | body |
| POST | `/api/j2/capture/authorize` | capture_auth | capped_json | `request_body_cap` (capped_json) | 16 KiB | no | get_current_user | session, body |
| POST | `/api/j2/capture/token` | capture_auth | capped_json | `request_body_cap` (capped_json) | 16 KiB | no | one-time authorisation code in the body | body |
| POST | `/api/j2/accounts` | journal_two | capped_json | `request_body_cap` (capped_json) | 2.2 MiB | no | get_current_user | session, body |
| PUT | `/api/j2/accounts/{account_id}` | journal_two | capped_json | `request_body_cap` (capped_json) | 2.2 MiB | no | get_current_user | session, body |
| POST | `/api/j2/accounts/{account_id}/coach/chat/cancel` | journal_two | capped_json | `request_body_cap` (capped_json) | 2.2 MiB | no | get_current_user | session, body |
| POST | `/api/j2/accounts/{account_id}/coach/chat/confirm` | journal_two | capped_json | `request_body_cap` (capped_json) | 2.2 MiB | no | get_current_user | session, body |
| POST | `/api/j2/accounts/{account_id}/coach/chat/forget` | journal_two | capped_json | `request_body_cap` (capped_json) | 2.2 MiB | no | get_current_user | session, body |
| POST | `/api/j2/accounts/{account_id}/coach/chat/stream` | journal_two | capped_json | `request_body_cap` (capped_json) | 2.2 MiB | no | get_current_user | session, body |
| POST | `/api/j2/accounts/{account_id}/coach/eod-recaps/generate` | journal_two | capped_json | `request_body_cap` (capped_json) | 2.2 MiB | no | get_current_user | session, body |
| POST | `/api/j2/accounts/{account_id}/coach/eod-recaps/{recap_id}/feedback` | journal_two | capped_json | `request_body_cap` (capped_json) | 2.2 MiB | no | get_current_user | session, body |
| POST | `/api/j2/accounts/{account_id}/coach/pre-trade-verdict` | journal_two | capped_json | `request_body_cap` (capped_json) | 2.2 MiB | no | get_current_user | session, body |
| PUT | `/api/j2/accounts/{account_id}/coach/profile` | journal_two | capped_json | `request_body_cap` (capped_json) | 2.2 MiB | no | get_current_user | session, body |
| POST | `/api/j2/accounts/{account_id}/coach/trade-reviews/generate` | journal_two | capped_json | `request_body_cap` (capped_json) | 2.2 MiB | no | get_current_user | session, body |
| POST | `/api/j2/accounts/{account_id}/coach/trade-reviews/{review_id}/feedback` | journal_two | capped_json | `request_body_cap` (capped_json) | 2.2 MiB | no | get_current_user | session, body |
| POST | `/api/j2/accounts/{account_id}/coach/weekly-reviews/generate` | journal_two | capped_json | `request_body_cap` (capped_json) | 2.2 MiB | no | get_current_user | session, body |
| POST | `/api/j2/accounts/{account_id}/coach/weekly-reviews/{review_id}/feedback` | journal_two | capped_json | `request_body_cap` (capped_json) | 2.2 MiB | no | get_current_user | session, body |
| PUT | `/api/j2/accounts/{account_id}/goals` | journal_two | capped_json | `request_body_cap` (capped_json) | 2.2 MiB | no | get_current_user | session, body |
| POST | `/api/j2/accounts/{account_id}/rules` | journal_two | capped_json | `request_body_cap` (capped_json) | 2.2 MiB | no | get_current_user | session, body |
| PUT | `/api/j2/accounts/{account_id}/settings` | journal_two | capped_json | `request_body_cap` (capped_json) | 2.2 MiB | no | get_current_user | session, body |
| POST | `/api/j2/ask/stream` | journal_two | capped_json | `request_body_cap` (capped_json) | 2.2 MiB | no | get_current_user | session, body |
| POST | `/api/j2/calendar/day/{date}/attachments` | journal_two | capped_multipart('file') | `request_body_cap` (capped_multipart('file')) | 5 MiB | no | get_current_user | session, body |
| PUT | `/api/j2/calendar/day/{date}/notes` | journal_two | capped_json | `request_body_cap` (capped_json) | 2.2 MiB | no | get_current_user | session, body |
| POST | `/api/j2/capture` | journal_two | capped_json | `request_body_cap` (capped_json) | 2.2 MiB | no | capture token or session (its own dependency) | body |
| PATCH | `/api/j2/excerpts/{excerpt_id}` | journal_two | capped_json | `request_body_cap` (capped_json) | 2.2 MiB | no | get_current_user | session, body |
| PUT | `/api/j2/facts/{fact_id}` | journal_two | capped_json | `request_body_cap` (capped_json) | 2.2 MiB | no | get_current_user | session, body |
| POST | `/api/j2/inbox` | journal_two | capped_json | `request_body_cap` (capped_json) | 2.2 MiB | no | get_current_user | session, body |
| POST | `/api/j2/note-folders` | journal_two | capped_json | `request_body_cap` (capped_json) | 2.2 MiB | no | get_current_user | session, body |
| PUT | `/api/j2/note-folders/{folder_id}` | journal_two | capped_json | `request_body_cap` (capped_json) | 2.2 MiB | no | get_current_user | session, body |
| POST | `/api/j2/note-templates` | journal_two | capped_json | `request_body_cap` (capped_json) | 2.2 MiB | no | get_current_user | session, body |
| PATCH | `/api/j2/note-templates/{template_id}` | journal_two | capped_json | `request_body_cap` (capped_json) | 2.2 MiB | no | get_current_user | session, body |
| POST | `/api/j2/notes` | journal_two | capped_json | `request_body_cap` (capped_json) | 2.2 MiB | no | get_current_user | session, body |
| POST | `/api/j2/notes/batch` | journal_two | capped_json | `request_body_cap` (capped_json) | 2.2 MiB | no | get_current_user | session, body |
| POST | `/api/j2/notes/batch/export` | journal_two | capped_json | `request_body_cap` (capped_json) | 2.2 MiB | no | get_current_user | session, body |
| POST | `/api/j2/notes/daily` | journal_two | capped_json | `request_body_cap` (capped_json) | 2.2 MiB | no | get_current_user | session, body |
| POST | `/api/j2/notes/enrichment/scan` | journal_two | capped_json | `request_body_cap` (capped_json) | 2.2 MiB | no | get_current_user | session, body |
| POST | `/api/j2/notes/import/check` | journal_two | capped_json | `request_body_cap` (capped_json) | 2.2 MiB | no | get_current_user | session, body |
| POST | `/api/j2/notes/import/confirm` | journal_two | capped_json | `request_body_cap` (capped_json) | 32 MiB | no | get_current_user | session, body |
| PUT | `/api/j2/notes/{note_id}` | journal_two | capped_json | `request_body_cap` (capped_json) | 2.2 MiB | no | get_current_user | session, body |
| PATCH | `/api/j2/notes/{note_id}/archive` | journal_two | capped_json | `request_body_cap` (capped_json) | 2.2 MiB | no | get_current_user | session, body |
| POST | `/api/j2/notes/{note_id}/ask/stream` | journal_two | capped_json | `request_body_cap` (capped_json) | 2.2 MiB | no | get_current_user | session, body |
| POST | `/api/j2/notes/{note_id}/attachments` | journal_two | capped_multipart('file') | `request_body_cap` (capped_multipart('file')) | 25 MiB | no | get_current_user | session, body |
| POST | `/api/j2/notes/{note_id}/embeds` | journal_two | capped_json | `request_body_cap` (capped_json) | 2.2 MiB | no | get_current_user | session, body |
| POST | `/api/j2/notes/{note_id}/evidence` | journal_two | capped_json | `request_body_cap` (capped_json) | 2.2 MiB | no | get_current_user | session, body |
| POST | `/api/j2/notes/{note_id}/excerpts` | journal_two | capped_json | `request_body_cap` (capped_json) | 2.2 MiB | no | get_current_user | session, body |
| POST | `/api/j2/notes/{note_id}/facts` | journal_two | capped_json | `request_body_cap` (capped_json) | 2.2 MiB | no | get_current_user | session, body |
| POST | `/api/j2/notes/{note_id}/hero` | journal_two | capped_multipart('file') | `request_body_cap` (capped_multipart('file')) | 5 MiB | no | get_current_user | session, body |
| POST | `/api/j2/notes/{note_id}/images` | journal_two | capped_multipart('file') | `request_body_cap` (capped_multipart('file')) | 5 MiB | no | get_current_user | session, body |
| PATCH | `/api/j2/notes/{note_id}/lock` | journal_two | capped_json | `request_body_cap` (capped_json) | 2.2 MiB | no | get_current_user | session, body |
| POST | `/api/j2/notes/{note_id}/reviews` | journal_two | capped_json | `request_body_cap` (capped_json) | 2.2 MiB | no | get_current_user | session, body |
| PATCH | `/api/j2/notes/{note_id}/tags` | journal_two | capped_json | `request_body_cap` (capped_json) | 2.2 MiB | no | get_current_user | session, body |
| POST | `/api/j2/notes/{note_id}/versions/{version_id}/restore` | journal_two | capped_json | `request_body_cap` (capped_json) | 2.2 MiB | no | get_current_user | session, body |
| POST | `/api/j2/options` | journal_two | capped_json | `request_body_cap` (capped_json) | 2.2 MiB | no | get_current_user | session, body |
| POST | `/api/j2/options/mark-expired-batch` | journal_two | capped_json | `request_body_cap` (capped_json) | 2.2 MiB | no | get_current_user | session, body |
| PUT | `/api/j2/options/{strategy_id}` | journal_two | capped_json | `request_body_cap` (capped_json) | 2.2 MiB | no | get_current_user | session, body |
| POST | `/api/j2/options/{strategy_id}/close` | journal_two | capped_json | `request_body_cap` (capped_json) | 2.2 MiB | no | get_current_user | session, body |
| POST | `/api/j2/positions` | journal_two | capped_json | `request_body_cap` (capped_json) | 2.2 MiB | no | get_current_user | session, body |
| PUT | `/api/j2/positions/{position_id}` | journal_two | capped_json | `request_body_cap` (capped_json) | 2.2 MiB | no | get_current_user | session, body |
| POST | `/api/j2/positions/{position_id}/close` | journal_two | capped_json | `request_body_cap` (capped_json) | 2.2 MiB | no | get_current_user | session, body |
| POST | `/api/j2/property-defs` | journal_two | capped_json | `request_body_cap` (capped_json) | 2.2 MiB | no | get_current_user | session, body |
| PUT | `/api/j2/property-defs/{property_id}` | journal_two | capped_json | `request_body_cap` (capped_json) | 2.2 MiB | no | get_current_user | session, body |
| PATCH | `/api/j2/reviews/{review_id}` | journal_two | capped_json | `request_body_cap` (capped_json) | 2.2 MiB | no | get_current_user | session, body |
| POST | `/api/j2/reviews/{review_id}/complete` | journal_two | capped_json | `request_body_cap` (capped_json) | 2.2 MiB | no | get_current_user | session, body |
| POST | `/api/j2/saved-views` | journal_two | capped_json | `request_body_cap` (capped_json) | 2.2 MiB | no | get_current_user | session, body |
| PUT | `/api/j2/saved-views/{view_id}` | journal_two | capped_json | `request_body_cap` (capped_json) | 2.2 MiB | no | get_current_user | session, body |
| PUT | `/api/j2/settings` | journal_two | capped_json | `request_body_cap` (capped_json) | 2.2 MiB | no | get_current_user | session, body |
| POST | `/api/j2/telemetry` | journal_two | capped_json | `request_body_cap` (capped_json) | 2.2 MiB | no | get_current_user | session, body |
| DELETE | `/api/j2/trades` | journal_two | capped_json | `request_body_cap` (capped_json) | 2.2 MiB | no | get_current_user | session, body |
| POST | `/api/j2/trades` | journal_two | capped_json | `request_body_cap` (capped_json) | 2.2 MiB | no | get_current_user | session, body |
| POST | `/api/j2/trades/import/confirm` | journal_two | capped_json | `request_body_cap` (capped_json) | 40 MiB | no | get_current_user | session, body |
| POST | `/api/j2/trades/import/preview` | journal_two | capped_multipart('file') | `request_body_cap` (capped_multipart('file')) | 10 MiB | no | get_current_user | session, body |
| POST | `/api/j2/trades/import/preview-mapped` | journal_two | capped_multipart('file') | `request_body_cap` (capped_multipart('file')) | 10 MiB | no | get_current_user | session, body |
| PATCH | `/api/j2/trades/{trade_id}` | journal_two | capped_json | `request_body_cap` (capped_json) | 2.2 MiB | no | get_current_user | session, body |
| PUT | `/api/j2/trades/{trade_id}/adherence` | journal_two | capped_json | `request_body_cap` (capped_json) | 2.2 MiB | no | get_current_user | session, body |
| POST | `/api/j2/trades/{trade_id}/attachments` | journal_two | capped_multipart('file') | `request_body_cap` (capped_multipart('file')) | 5 MiB | no | get_current_user | session, body |
| POST | `/api/j2/trust/orphans/reattach` | journal_two | capped_json | `request_body_cap` (capped_json) | 2.2 MiB | no | get_current_user | session, body |
| PUT | `/api/j2/unified-coach` | journal_two | capped_json | `request_body_cap` (capped_json) | 2.2 MiB | no | get_current_user | session, body |
| POST | `/api/j2/notes/connectors/obsidian/ingest` | note_sync | request.stream() | running total in `_read_bounded_body` | `limit` | no | Obsidian plugin bearer token | body |
| POST | `/api/j2/notes/connectors/obsidian/redeem` | note_sync | capped_json | `request_body_cap` (capped_json) | 64 KiB | no | one-time pairing code in the body | body |
| PUT | `/api/j2/notes/connectors/sources/{source_id}` | note_sync | capped_json | `request_body_cap` (capped_json) | 64 KiB | no | get_current_user | session, body |
| POST | `/api/j2/notes/connectors/{provider}/connect` | note_sync | capped_json | `request_body_cap` (capped_json) | 64 KiB | no | get_current_user | session, body |
| POST | `/api/j2/notes/connectors/{provider}/sources` | note_sync | capped_json | `request_body_cap` (capped_json) | 64 KiB | no | get_current_user | session, body |
| POST | `/api/j2/ai-actions/plan` | notebook_ai_actions | request.stream() | running total in `_read_json` | 256 KiB | yes | get_current_user | gate, session, body |
| POST | `/api/j2/ai-actions/{set_id}/apply` | notebook_ai_actions | request.stream() | running total in `_read_json` | 256 KiB | yes | get_current_user | gate, session, body |
| POST | `/api/j2/ai-actions/{set_id}/undo` | notebook_ai_actions | request.stream() | running total in `_read_json` | 256 KiB | yes | get_current_user | gate, session, body |
| POST | `/api/j2/chart-plan/alerts` | notebook_chart_alerts | request.stream() | running total in `_read_json` | 256 KiB | yes | get_current_user | gate, session, body |
| POST | `/api/j2/chart-plan/size` | notebook_chart_alerts | request.stream() | running total in `_read_json` | 256 KiB | yes | get_current_user | gate, session, body |
| PUT | `/api/j2/entry-context/why` | notebook_entry_context | read_capped_body | `request_body_cap` (read_capped_body) | 8 KiB | yes | get_current_user | gate, session, body |
| POST | `/api/j2/inbound-email` | notebook_inbound_email | request.stream() | running total in `_read_capped` | 36 MiB | yes | provider signature over the raw body | gate, body |
| PUT | `/api/j2/onboarding/tours/{tour_id}` | notebook_onboarding | capped_json | `request_body_cap` (capped_json) | 8 KiB | yes | get_current_user | gate, session, body |
| POST | `/api/j2/personal/daily/append` | notebook_personal_api | read_capped_body | `request_body_cap` (read_capped_body) | 216 KiB | yes | personal API bearer token | gate, body |
| POST | `/api/j2/personal/notes` | notebook_personal_api | read_capped_body | `request_body_cap` (read_capped_body) | 216 KiB | yes | personal API bearer token | gate, body |
| POST | `/api/j2/personal/notes/{note_id}/append` | notebook_personal_api | read_capped_body | `request_body_cap` (read_capped_body) | 216 KiB | yes | personal API bearer token | gate, body |
| POST | `/api/j2/personal/tokens` | notebook_personal_api | read_capped_body | `request_body_cap` (read_capped_body) | 216 KiB | yes | get_current_user | gate, session, body |
| POST | `/api/j2/plan-grades/trades/{trade_id}/relink` | notebook_plan_grades | read_capped_body | `request_body_cap` (read_capped_body) | 16000 B | yes | get_current_user | gate, session, body |
| POST | `/api/j2/publish/folders/{folder_id}` | notebook_publish | request.stream() | running total in `read_expiry` | 64 KiB | yes | get_current_user | gate, session, body |
| POST | `/api/j2/publish/notes/{note_id}` | notebook_publish | request.stream() | running total in `read_expiry` | 64 KiB | yes | get_current_user | gate, session, body |
| PATCH | `/api/j2/publish/{slug}` | notebook_publish | request.stream() | running total in `read_expiry` | 64 KiB | yes | get_current_user | gate, session, body |
| POST | `/api/j2/research-capture/passed-setups` | notebook_research_capture | capped_json | `request_body_cap` (capped_json) | 496384 B | yes | get_current_user | gate, session, body |
| POST | `/api/j2/research-capture/transcripts/save` | notebook_research_capture | capped_json | `request_body_cap` (capped_json) | 496384 B | yes | get_current_user | gate, session, body |
| POST | `/api/j2/notes/{note_id}/share` | notebook_shares | request.stream() | running total in `read_expiry` | 64 KiB | yes | get_current_user | gate, session, body |
| POST | `/api/j2/template-gallery` | notebook_template_gallery | read_capped_body | `request_body_cap` (read_capped_body) | 250 KiB | yes | get_current_user | gate, session, body |
| PATCH | `/api/j2/template-gallery/admin/items/{gallery_id}` | notebook_template_gallery | read_capped_body | `request_body_cap` (read_capped_body) | 250 KiB | yes | get_current_user | gate, session, body |
| PATCH | `/api/j2/template-gallery/admin/reports/{report_id}` | notebook_template_gallery | read_capped_body | `request_body_cap` (read_capped_body) | 250 KiB | yes | get_current_user | gate, session, body |
| POST | `/api/j2/template-gallery/{gallery_id}/report` | notebook_template_gallery | read_capped_body | `request_body_cap` (read_capped_body) | 250 KiB | yes | get_current_user | gate, session, body |
| POST | `/api/j2/thesis-chips` | notebook_thesis_chips | capped_json | `request_body_cap` (capped_json) | 64 KiB | yes | get_current_user | gate, session, body |
| POST | `/api/j2/voice-notes/jobs` | notebook_voice_notes | read_capped_form | `request_body_cap` (read_capped_form) | `limit + body_cap.FRAMING_SLACK` | yes | get_current_user | gate, session, body |
| POST | `/api/j2/notes/{note_id}/writing-help/autofill` | notebook_writing_help | request.stream() | running total in `_read_payload` | 1 MiB | yes | get_current_user | gate, session, body |
| POST | `/api/j2/notes/{note_id}/writing-help/stream` | notebook_writing_help | request.stream() | running total in `_read_payload` | 1 MiB | yes | get_current_user | gate, session, body |
| POST | `/api/voice/documents/ingest-text` | voice | capped_json | `request_body_cap` (capped_json) | 10304 KiB | no | get_current_user | session, body |
| POST | `/api/voice/documents/upload` | voice | capped_multipart('file') | `request_body_cap` (capped_multipart('file')) | 10 MiB | no | get_current_user | session, body |
| POST | `/api/voice/exec` | voice | capped_json | `request_body_cap` (capped_json) | 64 KiB | no | get_current_user | session, body |
| POST | `/api/voice/explain` | voice | capped_json | `request_body_cap` (capped_json) | 64 KiB | no | get_current_user | session, body |
| POST | `/api/voice/feedback` | voice | capped_json | `request_body_cap` (capped_json) | 64 KiB | no | get_current_user | session, body |
| POST | `/api/voice/memory/facts` | voice | capped_json | `request_body_cap` (capped_json) | 64 KiB | no | get_current_user | session, body |
| POST | `/api/voice/oneshot` | voice | capped_multipart('audio') | `request_body_cap` (capped_multipart('audio')) | 25 MiB | no | get_current_user | session, body |
| POST | `/api/voice/session/end` | voice | capped_json | `request_body_cap` (capped_json) | 64 KiB | no | get_current_user | session, body |
| POST | `/api/voice/session_token` | voice | capped_json | `request_body_cap` (capped_json) | 64 KiB | no | get_current_user | session, body |
| PUT | `/api/voice/settings` | voice | capped_json | `request_body_cap` (capped_json) | 64 KiB | no | get_current_user | session, body |
| POST | `/api/voice/transcribe` | voice | capped_multipart('audio') | `request_body_cap` (capped_multipart('audio')) | 25 MiB | no | get_current_user | session, body |
| POST | `/api/voice/transcript` | voice | capped_json | `request_body_cap` (capped_json) | 64 KiB | no | get_current_user | session, body |
| POST | `/api/voice/tts` | voice | capped_json | `request_body_cap` (capped_json) | 265536 B | no | get_current_user | session, body |
| POST | `/api/voice/tts/prepare` | voice | capped_json | `request_body_cap` (capped_json) | 265536 B | no | get_current_user | session, body |
| POST | `/api/voice/vision/describe` | voice | capped_json | `request_body_cap` (capped_json) | 6.7 MiB | no | get_current_user | session, body |
| POST | `/api/voice/vision/upload` | voice | capped_multipart('image') | `request_body_cap` (capped_multipart('image')) | 5 MiB | no | get_current_user | session, body |

### Out of scope, listed and not touched

Routers outside the Notebook and Journal family that read a request body. The lane brief said not
to change them.

250 body reads across the 79 rows below: 226 declared body parameters, 17 raw reads with no bound, 5 through `request_body_cap` (wave 14), 2 streaming loops. Each is bounded only by the edge today. `main` is `api/main.py`.

| router | how the body is read | routes |
|---|---|---|
| `admin_chart_health` | declared body parameter | 3 |
| `admin_patterns` | declared body parameter | 1 |
| `admin_twitter` | declared body parameter | 2 |
| `ai_search` | declared body parameter | 7 |
| `alert_outbound` | declared body parameter | 3 |
| `alert_taxonomy` | declared body parameter | 1 |
| `alert_tester` | declared body parameter | 1 |
| `artifact_versions` | declared body parameter | 2 |
| `auth` | declared body parameter | 36 |
| `auth` | request_body_cap | 1 |
| `avatar` | request_body_cap | 1 |
| `backtest` | declared body parameter | 1 |
| `bars` | declared body parameter | 2 |
| `breadth_monitor` | raw read, no bound | 4 |
| `calendar` | declared body parameter | 1 |
| `catalysts` | declared body parameter | 3 |
| `charts_layouts` | declared body parameter | 2 |
| `client_errors` | streaming loop with a running total | 1 |
| `community` | declared body parameter | 26 |
| `community` | request_body_cap | 1 |
| `cot` | declared body parameter | 1 |
| `csv_ingest` | declared body parameter | 4 |
| `darkpool_router` | declared body parameter | 2 |
| `data_exports` | declared body parameter | 1 |
| `desk` | declared body parameter | 4 |
| `desk` | request_body_cap | 1 |
| `desk_zoom_webhook` | raw read, no bound | 4 |
| `discord_interactions` | raw read, no bound | 1 |
| `discord_watchlist` | declared body parameter | 3 |
| `earnings_intel` | declared body parameter | 1 |
| `education` | declared body parameter | 13 |
| `flow_explain` | declared body parameter | 2 |
| `flow_router` | raw read, no bound | 2 |
| `hub_planned_trades` | declared body parameter | 1 |
| `hub_reports` | declared body parameter | 1 |
| `inbound_alerts` | streaming loop with a running total | 1 |
| `indicator_alerts` | declared body parameter | 2 |
| `indicator_telemetry` | declared body parameter | 1 |
| `indicator_vision` | request_body_cap | 1 |
| `landing_analytics` | declared body parameter | 1 |
| `live_massive_router` | declared body parameter | 1 |
| `live_massive_router` | raw read, no bound | 3 |
| `liveflow_router` | declared body parameter | 2 |
| `main` | raw read, no bound | 2 |
| `modelbook` | declared body parameter | 12 |
| `news_depth` | declared body parameter | 1 |
| `notable_flow_router` | declared body parameter | 3 |
| `oi_snapshot_router` | declared body parameter | 2 |
| `options_analytics` | declared body parameter | 1 |
| `options_chain` | declared body parameter | 1 |
| `patterns` | declared body parameter | 3 |
| `push` | declared body parameter | 3 |
| `research` | declared body parameter | 3 |
| `scan_run` | declared body parameter | 1 |
| `scatter` | declared body parameter | 1 |
| `schwab_router` | declared body parameter | 3 |
| `screen_promote` | declared body parameter | 3 |
| `screener` | declared body parameter | 6 |
| `screener_nl` | declared body parameter | 1 |
| `services.wisdom.publish.adapters.routes` | declared body parameter | 1 |
| `terminal_grammar` | declared body parameter | 2 |
| `theme_sets` | declared body parameter | 2 |
| `ticker_tags` | declared body parameter | 3 |
| `top_flow_router` | declared body parameter | 1 |
| `tracings` | declared body parameter | 1 |
| `user_definitions` | declared body parameter | 3 |
| `user_playbook` | declared body parameter | 8 |
| `waitlist` | declared body parameter | 2 |
| `watchlist_alerts` | declared body parameter | 2 |
| `watchlist_router` | declared body parameter | 1 |
| `watchlists` | declared body parameter | 15 |
| `web_push` | declared body parameter | 2 |
| `webhooks` | raw read, no bound | 1 |
| `what_else_open` | declared body parameter | 2 |
| `wire_feedback` | declared body parameter | 1 |
| `wisdom_extract` | declared body parameter | 1 |
| `wisdom_publish` | declared body parameter | 1 |
| `wisdom_sources` | declared body parameter | 1 |
| `workspace_doc` | declared body parameter | 2 |

## 3. A 413 has to say something

For each capped door, the client caller and what a member sees when the door answers 413.

| door | client | what the member sees | verdict |
|---|---|---|---|
| `POST /notes/{id}/images` | `NoteEditorPage.jsx:1764` through `tiptap.js:237` | the server's sentence, in a toast ("Couldn't upload x.png. Image must be < 5 MB. Your note is unchanged.") | fine |
| `POST /notes/{id}/attachments` | `NoteEditorPage.jsx:1965` through `tiptap.js:257` | the server's sentence, in a toast | fine |
| `POST /notes/{id}/hero` | `HeroImagePicker.jsx:27` | checks 5 MB before sending and says "Image must be < 5 MB." A refusal from the server shows "Couldn't upload that image. Your note is unchanged." | fine |
| the two above, during an import | `lib/importer/commit.js:245` | **was** "Upload failed (HTTP 413)" in the import summary. **Now** the server's sentence | **fixed here** |
| `POST /notes/import/confirm` | `lib/importer/commit.js:312` | "Batch N failed (HTTP 413: sentence)" | fine |
| `POST /voice-notes/jobs` | `lib/voiceNote.js:63` | the server's sentence | fine |
| `PUT /notes/{id}` and the other JSON doors | `hooks/useJ2Notes.js:228` | the server's sentence, through `friendlySaveError` | fine |
| `POST /trades/{id}/attachments` | `TradeScreenshots.jsx:54` | the server's sentence | fine |
| `POST /calendar/day/{date}/attachments` | `DayAttachments.jsx:82` | **was** "Couldn't upload this image. Nothing was added, try again." **Now** "Image must be < 5 MB. Nothing was added." | **fixed in round 2** |
| `POST /trades/import/preview`, `/preview-mapped`, `/confirm` | `ImportCsvModal.jsx:64`, `:92`, `:143` | **was** "Couldn't read this file. Nothing was imported, try again." **Now** "File exceeds 10 MB limit. Nothing was imported." | **fixed in round 2** |
| `POST /notes/{id}/hero` from a new position | `GlobalAddPositionProvider.jsx:174` | nothing. The failure goes to the console and the note opens with no image | gap, silent by design, listed |
| `POST /notes/{id}/images` for a widget snapshot | `WidgetEmbedView.jsx:491` through `embedArchive.js:74` | nothing. A background save, retried in the next session | gap, silent by design, listed |
| `POST /api/voice/vision/upload` | `VisionAttachButton.jsx:48` | **was** the raw reply as text: `{"detail":"image too large (max 5MB)"}`. **Now** the sentence | **fixed here** |
| `POST /api/voice/documents/upload` | `VoiceDocumentsPanel.jsx:49` | the server's sentence | fine |
| `POST /api/voice/transcribe` | `VoiceInputButton.jsx:250` | the server's sentence when the surface holds the recording. Otherwise it falls back to the browser's own speech recognition, and says nothing if the browser has none | gap, listed |
| `POST /api/voice/transcribe` | `hub/voiceNote.js` | "Could not transcribe that recording. Try again." | fine |
| `POST /api/voice/tts`, `/tts/prepare` | `useReadAloud.js:71` and five small callers | "Read Aloud failed. Please try again." | fine |

Two are fixed, each with a test that was red first: the importer's media upload (the one Notebook
gap that was a one-line message; `commit.test.js`), and the voice chart image button, which is this
lane's own router (`VisionAttachButton.test.jsx`).

## 4. `GET /api/voice/cost` answered 500 on every database

Added by the controller from a real-browser walk: `no such column: seconds_used` at
`api/services/voice_cost_service.py:95`.

### What was wrong

The cost query was added on 2026-05-12 (`f3611f6999`). It asked `voice_usage_monthly` for
`seconds_used`, ordered by `month_key`. The table was created four days earlier (`13d77734af`) with
`mode_a_seconds` and `year_month`. No schema and no migration has ever held the other two names
(`auth_db.py` has no match for either; `git log -S seconds_used` finds only the commit that added
the query). So this is not a migration that only ran on old databases, and not a rename. The query
was wrong from its first day, and the door answered 500 on new and old databases alike.

### Is it live in production

Yes. `origin/master` has the same query and the same schema. No flag.

### Who calls it and what the member sees

The Voice Telemetry tile in Settings (`app/src/components/voice/VoiceTelemetryPanel.jsx:49`). It
skipped the cost block when the request failed. So a member saw the tile without its cost figures
and with no message. Nothing else broke.

### What changed

- The query reads `mode_a_seconds` from this calendar month's `year_month` row. The month key
  comes from the usage writer (`voice_usage._current_year_month`), not a second format. The old
  query also took the newest row whatever its month.
- No schema change. Both columns are in `CREATE TABLE` and on every database.
- The door fails soft. If usage cannot be read it answers 200 with `available: false`, a sentence,
  and every figure null. Null, not zero: a zero would read as "you have used nothing". The cause
  goes to the log, not to the member.
- The tile shows the sentence in place of the figures.

### Tests

`tests/test_voice_cost_summary.py`, 13 tests. Before: `12 failed, 1 passed`. Each runs on a
database built from nothing and on one whose usage table has its 2026-05-08 shape (before the
`mode_d_seconds` migration): the summary reads; seconds the writer records reach it; last month's
are not counted; every SQL statement in the service is prepared against the real schema, so an
unknown column fails by name; the door answers 200; a broken read is a handled 200 with no
database error text. `VoiceTelemetryPanel.cost.test.jsx`: 2 tests, one red before.

## Scoped run

Backend, by named files only. 147 files in 10 chunks: every test file that names `/api/j2` or
`/api/voice`, every one that imports a changed router or the cap helper, the journal service
suites that call route functions directly, and the gate and paywall rails.

`3 failed, 4155 passed` across the ten totals lines. The three reds are in files this branch does
not touch and assert on things it does not change:

- `test_notebook_bridges_pin_the_root.py`: `tools/notebook_w11b_scale.py:69` sets an environment
  variable by hand.
- `test_notebook_trade_canvas.py`: the flag ledger says `armed` where the test expects `dark`.
- `test_user_definitions_auth.py`: three routers share one 402 sentence (81 distinct of 83). This
  branch adds no 402 sentence.

Run on their own after the last edits: `tests/test_notebook_body_census.py` `13 passed`,
`tests/test_voice_cost_summary.py` `13 passed`, `tests/test_voice_client_request_shapes.py`
`14 passed`.

Frontend, by named files, two workers: `VisionAttachButton.test.jsx`,
`VoiceTelemetryPanel.cost.test.jsx`, `VoiceTelemetryPanel.rewardCatalog.test.jsx`,
`importer/commit.test.js`, `useReadAloud.test.jsx`, `chartBus.test.jsx`, `FloatingOrb.test.jsx`,
`CompassAssistButton.test.jsx`: all passed. `components/screener/reachable.test.js` has one red, a
parking note past its own expiry date, which is a date check and not this branch.

The full vitest suite and the six-shard gate were not run. The brief said not to.

Round 2, after the helper fix, the import cap and the two Journal clients:

- the four rail files (`test_voice_client_request_shapes.py`, `test_notebook_body_order.py`,
  `test_notebook_body_census.py`, `test_voice_cost_summary.py`): `81 passed`.
- the differential, on the committed tree: `93 routes, 2811 requests: 2640 same, 171 intended,
  0 REGRESSIONS`.
- 44 named backend files in 3 chunks (the upload cap suites, the gate and route census rails, the
  importer suites, the direct-call journal suites, broker and note sync, the skill whitelist and
  doc gate): `375 passed`, `397 passed`, `608 passed`. No failures.
- vitest, named files: `ImportCsvModal.test.jsx` and `DayAttachments.test.jsx`, `21 passed`.

Round 3, after the chunked import, the 32 MiB cap and the docs restore:

- the four rail files: `86 passed`.
- the differential, on the committed tree: `93 routes, 2811 requests: 2640 same, 171 intended,
  0 REGRESSIONS`.
- the full wide run again, 148 named files in 10 chunks (round 1's 147 list plus the lane's newer
  files): `3 failed, 4226 passed`. The same three reds as round 1, in files this branch does not
  touch.
- vitest, named files, two workers: the importer, the wizard and its boundary test, the CSV modal,
  day attachments, the two voice components and read-aloud: `8 files, 96 passed`. The three rails
  that read the importer's commit module (`notebookSchema.rail`, `doorEnumeration`,
  `doorFamilies.settle`): `68 passed`.

## Round 2: proof that the conversion changed nothing a client can see

The conversion is always on for every Journal and Notebook write door, so it was proved against
the old code before landing.

### The differential

`python tests/support/run_body_differential.py --work <scratch dir>`. Table and raw answers:
`docs/notebook/evidence/fin-voice/differential/` (`README.md`, `cases.json`, `old.json`, `new.json`).

- The route list is derived from the census: every route that takes its body through
  `capped_json`. 93 routes.
- The old side is `72715e8001`, extracted with `git archive` into the scratch directory. Nothing
  was checked out.
- Both sides get the same 2,811 requests, with the same kind of signed-in paid session, each on a
  temporary database its own conftest pins. The requests are built from each route's own
  annotation: a valid body (full and minimal), each required field missing, each field `null`, a
  wrong type for each field, each optional field omitted and `null`, each key renamed between
  camelCase and snake_case, the field name in place of an alias, an empty nested model, an unknown
  extra field, an empty body (with and without a Content-Type, and whitespace), five non-object
  JSON bodies, five malformed bodies (one not UTF-8), and eight Content-Types.
- Each handler is replaced by one that answers the parsed body. So no model, broker or database
  call happens, and what is compared is the layer that changed. For an accepted body the parsed
  value itself is compared: for a model, its fields after defaults and which fields were set.
- Compared: the status, the 422 error list (`type`, `loc`, `msg`, `ctx`), and the parsed value.

**Result: 2,640 identical, 171 intended, 0 regressions.**

It found one real regression first, and it is fixed (`65665ba837`). On the 21 routes whose body is
a pydantic model, a JSON array, string, number or boolean, or a body with a non-JSON Content-Type,
answered 422 with error type `model_type` where the old code answered `model_attributes_type`
(the `msg` differed too). 168 requests. FastAPI validates a body field with `from_attributes`;
`capped_json` now does the same. The helper's side-by-side test gained those six request shapes
and now compares `msg` as well.

The 171 intended differences, all of two kinds:

| kind | requests | old | new |
|---|---|---|---|
| no session, malformed body | 78 | 422 | 401 (answered before the body is read) |
| a declared length over the cap | 93 | the route's usual answer | 413 |

The other 108 anonymous requests are identical on both sides (a valid body with no session was
always 401; the nine doors with no session answer the same either way).

Defaults, aliases, optional fields and nested models: the model routes are the 21 in `voice.py`,
`broker_sync.py`, `note_sync.py` and `notebook_onboarding.py`. None of their models declares an
alias or a nested model, so those two groups ran on key renames only (57 requests, identical).
Defaults and optional fields: 76 requests, identical, including which fields count as set.

### OpenAPI and the skill doc

- `app.openapi()` described a request body for all 93 routes before and for **none of the 93**
  now. A dependency does not appear in the schema as a body. The routes themselves are all still
  listed.
- Who reads it: only the admin-only doc pages (`/openapi.json`, `/docs`, `/redoc`, served by
  `api/open_reads_gate.py`). The app is built with `openapi_url=None`.
- `docs/api/skill.md` and `docs/api/member-api-whitelist.json` are generated by
  `api/services/skill_whitelist.py`, which does not read request bodies.
  `tests/test_skill_whitelist.py` and `tests/test_open_reads_gate.py`: `49 passed`. No drift.
- Restored in round 3, on the owner's ruling. See below.

### The dark 404's bytes

- `notebook_onboarding.py` words its own gate 404, and it is already byte-identical to FastAPI's.
  Pinned: with the gate off, the tours door answers the exact bytes an unknown path answers.
- `notebook_thesis_chips.py` and `notebook_research_capture.py` raise
  `public_note_payload.not_found()`. So do 9 other routers (11 files call it). Its body is
  `{"detail":"Not found"}` against FastAPI's `{"detail":"Not Found"}`, and it adds its own
  headers. That is only in `public_note_payload.py`. A test pins that every dark 404 that differs
  comes from that helper, so a router that words its own different 404 fails by name.

## Round 3: the import in pieces, and the docs restored

### The note import

The round 2 cap (about 533 MB) refused nothing the product used to accept and protected nothing:
one process serves every member, and a body that size held in memory is an outage. Round 3 removes
the choice between the two harms.

What the client did before. It already sent the confirm step in batches of 200 notes, one after
another, with one progress step per note and one summary at the end
(`app/src/pages/journal-2-0/lib/importer/commit.js`, called from the wizard). It split by count
only. So 200 long notes could be one request of 200 MB.

Is confirm safe to split or to retry. Yes. `notes.import_confirm` matches each note by its
`importKey` (the member, the key, not deleted). A note sent again is `skipped` when its content is
the same and `updated` when it differs. It is never created twice. A retry duplicates nothing.

What changed.

- **Client.** `lib/importer/confirmBatches.js` (new, imports nothing) plans the requests from each
  note's own serialised size. A request holds at most 24 MiB and at most 200 notes. They are sent
  one after another. Progress is still one step per note. The summary still totals created,
  updated, skipped and failed across every request.
- **A note too large for any request** is never sent. It is named in the summary: "This note is
  too large to import (N MB). Split it into smaller notes and import again." No legal note is
  that large, since the service holds a body to 1 MB. A note the service finds too long comes
  back named with the service's own sentence, and its neighbours are stored.
- **Server.** `NOTE_IMPORT_JSON_MAX_BYTES = 32 MiB`, by name. The 413 says: "That batch of notes is
  too large for one request (32 MB at most). Send the notes in smaller batches."

One thing I did not do as asked. The brief said to stop cleanly when one request fails. The
importer already had a ruling the other way (session audit A2): a failed batch does not stop the
run, because stopping left every later note without an attempt on every re-run. I kept that. The
failed batch is named in a sentence that says its notes were not imported and that a second run
will not duplicate anything, and the rest of the import carries on. Say if you want it to stop.

Tests.

- `commit.test.js`, six added, five red first. A large import arrives as several requests, each
  under the limit, with the right totals and per-note progress. It also splits by count. 40 MB of
  1 MB notes never produces a request over 24 MiB. A note too large to send is named with its
  sentence. A note the server finds too long is named with the server's sentence. A request that
  fails mid-import reports what landed, and a second run creates only the missing notes.
- `ImportWizard.test.jsx`, two added: the rendered summary shows the server's per-note sentence
  and the failed-batch sentence. These passed on first run. The wizard already rendered both.
- `tests/test_notebook_body_census.py`, five in place of round 2's two, three red first. The cap
  is 32 MiB by name. The client's two limits, read by running its module in Node, sit under the
  server's. The client's planner drives the real door with the batch limit moved to 5 and the cap
  to 2.5 MB: the whole batch in one request is a 413 and stores nothing; the planned requests are
  all accepted and create 5 notes; sent again they skip 5 and add none. Notes regrouped into
  different batches on a second run do not duplicate. A single oversized note is refused with its
  own sentence.

A real 500-note, 500 MB import was not sent. The largest legal import is simulated with small
counts and lowered limits.

### The API docs

`request_body_cap.document_json_bodies(app)` puts the request body back for every converted route,
from each dependency's own annotation. It wraps `app.openapi`. Only when the schema is first asked
for does it write each route's `openapi_extra`, a field FastAPI reads while generating the schema
and nowhere else. Nothing is built at import, and no request is handled differently. One call in
`api/main.py`, beside `install_docs`.

Tests in `tests/test_notebook_body_order.py`: every converted route (the list is derived from the
route objects) has a JSON request body schema again, with a model's own properties and required
list. That was red at 93 routes missing. Generating the docs leaves every route's dependency order
unchanged. `docs/api/skill.md` and the member whitelist are byte-for-byte unchanged:
`tests/test_skill_whitelist.py` and `tests/test_open_reads_gate.py` pass.

The schemas are written inline. The old ones pointed at named entries under `components`. The
content is the same; the shape of the document differs.

## Open decisions

1. **Settled in round 3.** The note import door is capped at 32 MiB and the client sends in pieces.
2. **Settled in round 2.** The two Journal clients show the server's reason.
3. **Settled in round 2.** `POST /api/voice/oneshot` stays.
4. **Accepted as is by the controller.** The dark 404's wording and headers are in
   `api/services/journal_two/public_note_payload.py`. Recorded, not changed.
5. **Settled in round 3.** The 93 routes show a request body in the admin API docs again.
7. **New.** The importer continues past a failed confirm request (audit A2) where the round 3
   brief asked it to stop. Keep, or change.
6. `GlobalAddPositionProvider.jsx:174` and `WidgetEmbedView.jsx:491` still fail silently on a
   refused image, by design.
