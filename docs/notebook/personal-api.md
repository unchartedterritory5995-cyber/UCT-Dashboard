# The Notebook personal API

Add to your UCT Notebook from anywhere that can send an HTTP request — an iOS
Shortcut, a script, a note-taking app's "send to" action. Three things, and
nothing else:

| What | Request |
|---|---|
| Create a note | `POST /api/j2/personal/notes` |
| Add to the end of a note | `POST /api/j2/personal/notes/{note_id}/append` |
| Add to today's daily note (making it if needed) | `POST /api/j2/personal/daily/append` |

A token can **write** these three things. It cannot read your notes, see your
trades, list your folders, or sign in as you.

> **Status (wave 7, 2026-09-25): built and DARK.** The whole surface is behind
> `NOTEBOOK_PERSONAL_API_ENABLED`. Unset (the default) means every route below
> answers `404` and no token can be made. See `docs/feature_flags.json`.
> iOS Shortcuts, step by step: [`ios-shortcuts.md`](ios-shortcuts.md).

---

## 1. Make a token

1. Open **Settings → Personal API** in UCT.
2. Give the token a name you will recognise later (for example *iPhone
   Shortcuts*) and choose **Make a token**.
3. **Copy it now.** The token is shown exactly once. UCT keeps only a one-way
   fingerprint of it, so nobody — including UCT — can show it to you again. If
   you lose it, revoke it and make a new one.

Things to know about a token:

- **It lasts 365 days**, counted from when you made it. Using it does not
  extend it. After a year it stops working and you make a new one.
- **You can have up to 20 active tokens.** One per device or per Shortcut is a
  good habit: you can then revoke one without breaking the others.
- **Making a token needs a paid plan.** Seeing and revoking your tokens does
  not — if your plan lapses you can still find and revoke every token you made.
- **Treat it like a password.** Anyone holding it can add notes to your
  Notebook until you revoke it.

### Scopes

Every personal token carries exactly these two scopes, and never any other:

| Scope | Allows |
|---|---|
| `notebook:notes:create` | `POST /notes` |
| `notebook:notes:append` | `POST /notes/{id}/append` and `POST /daily/append` |

These scopes share nothing with the UCT Browser Capture extension's
connection: a Browser Capture connection is refused here (`403`), and a
personal token is refused by every Browser Capture route (`403`). Each has its
own card in Settings.

### Revoking

**Settings → Personal API → Revoke** on the token's row. It stops working on
its very next request, everywhere. Revoking one token signs nobody out and
touches no other token or device.

---

## 2. Requests

Send the token as a bearer header and a JSON body:

```
Authorization: Bearer <your token>
Content-Type: application/json
```

In the examples below, put your token in an environment variable first so it
does not land in your shell history:

```sh
export UCT_TOKEN='uctpat_…'
```

### Create a note

```sh
curl -X POST https://uctintelligence.com/api/j2/personal/notes \
  -H "Authorization: Bearer $UCT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"title": "Trade idea", "markdown": "Buy **NVDA** on the retest of the 21-day.\n\n- stop under the low\n- size 0.5R", "folder": "Inbox/Ideas", "tags": ["setups"]}'
```

| Field | Required | Meaning |
|---|---|---|
| `title` | one of `title` / `markdown` | the note's title (up to 300 characters) |
| `markdown` | one of `title` / `markdown` | the note's body, as Markdown (see §3) |
| `folder` | no | a folder PATH such as `Inbox/Ideas`; missing folders are made for you. Up to 6 levels. Empty means the Notebook's top level |
| `tags` | no | a list of tags, up to 30 |

Answer:

```json
{"note": {"id": "4c1f…", "title": "Trade idea",
          "url": "https://uctintelligence.com/journal/notebook?note=4c1f…"}}
```

### Add to the end of a note

```sh
curl -X POST https://uctintelligence.com/api/j2/personal/notes/4c1f…/append \
  -H "Authorization: Bearer $UCT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"markdown": "Update: held the 21-day, added."}'
```

The note id is the `id` from a create answer, or the `note=` part of the note's
address in your browser. The text is added **after** everything already in the
note. Answer: the same `{"note": {...}}` shape.

### Add to today's daily note

```sh
curl -X POST https://uctintelligence.com/api/j2/personal/daily/append \
  -H "Authorization: Bearer $UCT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"markdown": "10:42 — NVDA reclaimed VWAP on volume."}'
```

Answer:

```json
{"note": {"id": "…", "title": "2026-09-25 · Friday", "url": "…"},
 "created": false, "day": "2026-09-25"}
```

- **"Today" is UCT's Eastern-time day**, decided by the server — not your
  phone's clock or time zone. At 11 pm in California it is already tomorrow in
  New York, and the entry goes to tomorrow's note.
- **If today's note does not exist yet it is made**, in your `Daily` folder,
  from the daily template you picked in the Notebook (if any). `created` says
  whether this request made it.
- **There is only ever one daily note per day**, even when two Shortcuts fire
  at the same instant on a fresh day: both entries land in the same note, and
  neither is lost.

---

## 3. What Markdown turns into

The body is converted by the same server-side converter the Notebook's importer
uses. Headings, **bold**, *italic*, ~~strikethrough~~, links, bulleted and
numbered lists, task lists (`- [ ]`), tables, quotes and code blocks all come
through as their Notebook equivalents.

Two limits, stated so they do not surprise you:

- **Headings stop at level 3.** `####` and deeper arrive as a level-3 heading.
- **Images are not fetched.** UCT never downloads anything a request points at.
  An image in your Markdown (`![chart](https://…/nvda.png)`) becomes the text
  `[image: https://…/nvda.png]` in the note, so you can see what was there. To
  put a picture in a note, add it in the Notebook.

---

## 4. Locked notes and open tabs

**A locked note refuses the append** with `423` and the sentence *"This note is
locked — unlock it in the Notebook first"*. Nothing is changed: not the text,
not the note's last-edited time. Unlock it in the Notebook and send again.

**If the note is open in a tab with unsaved words at the moment the append
lands, that tab keeps its words as a conflict copy.** Nothing is lost — your
typing and the appended text both survive — but you will have two versions of
that note to reconcile. The simplest way to avoid it is not to append to a note
you are in the middle of typing into. (Wave 7 known limit, ruling D-G1(b); a
merge that removes it is planned for wave 8.)

Every append is written as one atomic step that re-checks the note it read, so
an append can never overwrite a change that landed a moment earlier.

---

## 5. Limits and answers

- **200 KB of Markdown per request** (measured in UTF-8 bytes).
- **30 requests a minute per token.** A second token has its own minute.

Every refusal is JSON of the form `{"detail": "<a sentence>"}`, written to be
shown to you as-is (an iOS Shortcut's *Show Result* displays it):

| Status | When | What to do |
|---|---|---|
| `400` | the body is not JSON, or a field is the wrong kind, or there is nothing to add | fix the request; the sentence names the field |
| `401` | the token is missing, mistyped, expired or revoked | make a new token in Settings and paste it in |
| `403` | the token is not a personal-API token (for example a Browser Capture connection) | use a token from **Settings → Personal API** |
| `404` | the note does not exist, is in the trash, or is not yours — or the personal API is switched off | check the note id |
| `409` | the note changed at the exact moment the append was written | send it again |
| `413` | the Markdown is over 200 KB | send it in smaller pieces |
| `423` | the note is locked | unlock it in the Notebook |
| `429` | more than 30 requests in a minute with this token | wait a minute |
| `503` | the database was busy with other writes for longer than 3 seconds; nothing was written (the answer carries `Retry-After: 5`) | send it again in a few seconds |

---

## 6. For operators

- Gate: `NOTEBOOK_PERSONAL_API_ENABLED` (`1`/`true`/`yes`/`on` = on), read on
  every request; a flip needs no restart. Off, every route — token management
  included — answers `404` with the same body as a route that does not exist.
- Code: `api/routers/notebook_personal_api.py` (routes),
  `api/services/journal_two/note_personal_api.py` (conversion and writes),
  `api/services/journal_two/capture_auth.py::mint_personal_token` (tokens —
  `client_type = "personal_api"` rows in `j2_capture_tokens`, digest only).
- Rails: `tests/test_notebook_personal_api.py`.
- ⚠️ The per-token rate limit is in-process state on the shared
  `api/limiter.py` Limiter; a second web process would double it.
