# UCT Notebook on iPhone — two Shortcuts, built by hand

Two Shortcuts that put things into your UCT Notebook without opening UCT:

1. **Append to today's note** — say something; it is added to today's daily
   note.
2. **Save to UCT** — share a web page, a link or selected text from any app;
   it becomes a new note in your `Inbox` folder.

Both use the **personal API** ([`personal-api.md`](personal-api.md)). There is
no file to download: a signed `.shortcut` file can only be produced on an Apple
device, so each Shortcut is built step by step below. It takes about five
minutes each.

> **Status (wave 7, 2026-09-25):** the personal API is built and DARK
> (`NOTEBOOK_PERSONAL_API_ENABLED`). Until it is switched on, **Settings →
> Personal API** does not appear and every request answers `404`.
> ⚠️ Not yet walked on a physical iPhone. The action names below are the
> standard Shortcuts actions; what a Shortcut shows for a refusal (§4) is
> **not measured** on a device.

---

## 1. Make a token (once)

1. In UCT, open **Settings → Personal API**.
2. Name the token — for example *iPhone Shortcuts* — and tap **Make a token**.
3. Tap **Copy**. The token is shown **once**; if you lose it, revoke it and
   make another.

You will paste this token into each Shortcut **one time**, in a *Text* action
at the top. After that the Shortcut carries it. Anyone who can open your
Shortcuts can read it, so keep your phone locked; if the phone is lost, revoke
the token in **Settings → Personal API** and it stops working immediately.

> **Never share these Shortcuts.** Sharing a Shortcut (an iCloud link, AirDrop,
> *Add to Home Screen* for someone else) sends the token inside it, and the
> token lets whoever has it write to your Notebook for up to a year. If you
> did share one, revoke that token in **Settings → Personal API**, make a new
> one, and paste the new one into your own copy.

---

## 2. Shortcut: "Append to today's note"

Open the **Shortcuts** app → **+** (new Shortcut) → name it *Append to today's
note*. Add these actions in order:

1. **Text** — paste your token into it. Rename the action's output (tap it) to
   `UCT token`.
2. **Dictate Text** — set *Stop Listening* to **After Pause**. (Swap this for
   **Ask for Input** → *Text* if you would rather type.)
3. **Get Contents of URL**
   - URL: `https://uctintelligence.com/api/j2/personal/daily/append`
   - Tap **Show More**:
     - Method: **POST**
     - Headers → **Add new header**:
       - Key `Authorization`, Value: type `Bearer ` (with the space), then
         insert the **UCT token** variable.
     - Request Body: **JSON** → **Add new field** → *Text*:
       - Key `markdown`, Value: the **Dictated Text** variable.
4. **Get Dictionary Value** — Get **Value** for key `detail` in **Contents of
   URL**.
5. **If** — *Dictionary Value* **has any value**
   - **Show Result** — *Dictionary Value* (this is UCT's sentence saying what
     went wrong — see §4)
   - **Otherwise**
   - **Show Notification** — `Added to today's note.`
   - **End If**

Try it: run the Shortcut, say *"NVDA reclaimed VWAP on volume"*, then open
today's note in UCT.

- "Today" is UCT's **Eastern-time** day, not your phone's. Late evening on the
  West Coast is already tomorrow in New York.
- If today's note does not exist yet, this makes it (with your daily template,
  if you chose one in the Notebook). Two runs at the same moment still make one
  note.
- Add it to your Home Screen, Action Button or Siri ("Hey Siri, append to
  today's note") from the Shortcut's details.

---

## 3. Shortcut: "Save to UCT" (from the Share Sheet)

New Shortcut → name it *Save to UCT* → open its details (ⓘ) and turn on **Show
in Share Sheet**. At the top, set *Receive* to **Safari web pages, URLs and
Text** from **Share Sheet**; if there is no input, **Ask For** *Text*.

1. **Text** — paste your token. Rename the output `UCT token`.
2. **Get Details of Safari Web Page** — *Name* of **Shortcut Input**. Rename
   the output `Page title`.
3. **Get URLs from Input** — from **Shortcut Input**. Rename the output
   `Page URL`.
4. **Text** — build the note's body:

   ```
   [Page title](Page URL)

   Shortcut Input
   ```

   (insert the three variables where named). Rename the output `Note body`.
5. **Get Contents of URL**
   - URL: `https://uctintelligence.com/api/j2/personal/notes`
   - Method **POST**; header `Authorization` = `Bearer ` + **UCT token**
     (as above).
   - Request Body **JSON**, three *Text* fields:
     - `title` → **Page title**
     - `markdown` → **Note body**
     - `folder` → `Inbox`
6. **Get Dictionary Value** — key `detail` in **Contents of URL**.
7. **If** *Dictionary Value* **has any value** → **Show Result** *Dictionary
   Value*; **Otherwise** → **Show Notification** `Saved to your UCT Inbox.` →
   **End If**.

Sharing plain text (not a web page) leaves *Page title* and *Page URL* empty:
the note's body is then just the shared text, and the note is saved untitled —
add an **Ask for Input** before step 5 and send its answer as `title` if you
want a title every time.

The `Inbox` folder is made the first time; use any path you like, such as
`Inbox/Reading` — missing folders are created.

---

## 4. What UCT's answers mean

Every refusal comes back as `{"detail": "<sentence>"}`; the two Shortcuts above
show that sentence.

| Status | You see | What to do |
|---|---|---|
| 401 | *Your UCT token is missing, expired or revoked. Make a new one in UCT Settings → Personal API and paste it into your Shortcut.* | The token was revoked, is over a year old, or was pasted wrongly (check the `Bearer ` prefix and its space). Make a new one. |
| 403 | *This token isn't allowed to do that. Use a Personal API token from UCT Settings.* | You pasted a different kind of UCT credential. |
| 404 | *That note wasn't found. It may have been deleted, or the note id is wrong.* | Only for appending to a specific note: check the id. A bare `Not Found` means the personal API is switched off. |
| 413 | *That text is over the 200 KB limit. Send it in smaller pieces.* | Very long dictation or a whole article — split it. |
| 423 | *This note is locked — unlock it in the Notebook first* | Unlock the note in UCT, then run the Shortcut again. |
| 429 | *Too many requests with this token. Wait a minute and try again.* | More than 30 runs in a minute with one token. |
| 503 | *UCT is busy saving other changes. Wait a few seconds and try again.* | Run the Shortcut again in a few seconds. Nothing was added. |
| 400 | a sentence naming the field | Usually an empty dictation — nothing to add. |

**If today's note is open in a browser tab on your computer** when the Shortcut
adds to it: switch away from that tab and back (or reload it) before you type
there again, and the tab picks the new text up, with your cursor where you left
it. A tab that stays in front, with its window focused, while the Shortcut runs
does not see the addition, so your next keystroke there saves a conflict copy of
the note instead; typing the tab had not saved yet always goes to a conflict
copy. Nothing is lost either way; you reconcile the two in the Notebook. (The
full rule, with its one exception, is in `personal-api.md` §4.)

---

## 5. Photos and scans

These Shortcuts send **text**. They do not upload pictures, and an image link
in the text is saved as the words `[image: …]` — UCT never downloads it.

To put a photo or a scanned page into a note, add it in the Notebook itself
(the image button, or **Scan** on a phone once it ships). Two things to know:

- **HEIC is not accepted.** The Notebook takes PNG, JPEG, GIF and WebP images.
  An iPhone's default camera format is HEIC; picking a photo through a web
  page's photo picker normally hands the browser a JPEG, but that conversion is
  iOS's and was **not measured** in wave 7. If an upload is refused, set
  *Settings → Camera → Formats* to **Most Compatible**.
- **Searchable text from images** (OCR) is a separate, also-dark feature
  (`NOTEBOOK_IMAGE_DOCX_DOCUMENTS_ENABLED`): when it is on, the words in an
  uploaded image become searchable in the Notebook.
