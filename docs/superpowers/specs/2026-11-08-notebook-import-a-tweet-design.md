# Notebook: Import a tweet

Status: approved by the owner, who delegated all remaining decisions to the designer. Date: 2026-11-08.
Approved look and flow: `assets/2026-11-08-import-a-tweet-preview.html` (open in a browser, click through it).

## Why

When a headline, someone else's thesis, or a take on a ticker shows up on X, the member wants it inside their research without retyping it, next to their own thinking. The Notebook already saves earnings-call passages this way ("Save from a transcript"). This does the same for posts on X.

## What the owner asked for

- A button on the Notebook ticker page, beside "Save from a transcript", called **Import a tweet**.
- Pick from **any of our recent tweets**, meaning the curated feed the app already collects.
- Or **paste a link** to a post on X, and it is imported into the note.
- The owner reviewed the clickable preview and said it is "essentially exactly" what they had in mind. The preview is the reference for layout, wording and behavior.

## The experience

1. The ticker page gains an **Import a tweet** button. The note editor gains the same button in its toolbar and a `/tweet` slash command.
2. The sheet shows, top to bottom: a paste box ("Paste a link to any post on X"), filter chips (`$TICKER`, All recent, Headlines, Theses and takes), search, the post list grouped by day, and a footer.
3. Posts are checkboxes, so several can be imported at once. Each row shows avatar, name, handle, age, text with cashtags in gold, and any image.
4. A valid link shows a loading placeholder, then appears at the top under "From your link", already ticked. An invalid link shows "That doesn't look like a link to a post on X." and nothing else changes.
5. From the ticker page the footer offers **Save to**: a new note for that ticker (default) or an existing one for that ticker. From inside a note it says "Adding to <title>".
6. Nothing is saved until **Import** is pressed. The button counts ("Import 3 posts").
7. Import lands in the note as one card per post, in the order they were ticked. From the ticker page the member is taken into the note, with the cursor in the first card's **My take**. From inside a note the cards land at the cursor.
8. A post already in the open note shows "Already in this note" and cannot be ticked. A post saved in another note shows "Saved in one of your notes" and can still be imported.
9. The note appears in the ticker page's research list with no extra step, because it carries the ticker.

### The card

Avatar, display name, @handle, X logo. Full post text with cashtags highlighted. Image if the post has one. Posted date and time, and a **View on X** link. A price line. A **My take** field the member types into. A remove control on hover that removes the card from this note only.

### The price line (designer's addition, kept by the owner)

`$NVDA when posted $188.20 · Now $191.10 · +1.5% since`

- **Which ticker:** the note's ticker if the post mentions it, otherwise the first cashtag in the post. No cashtag means no price line.
- **Price when posted (designer's call):** the close of the most recent intraday bar at or before the post time, extended hours included, because premarket headlines are the point. It is read once at import and stored, and never changes afterward.
- **Label says what it is:** "when posted" during the regular session, "premarket" or "after hours" for extended prints.
- **Maximum age (designer's call):** the bar must be at most 30 minutes older than the post. Otherwise (overnight, weekends, thin names, old links with no intraday data) use the most recent regular-session close before the post and label it "close on Oct 14".
- **No trustworthy price:** omit the line entirely. Never estimate. Same if a split since the post cannot be adjusted for, because a false -90% is worse than no number.
- **Now:** the latest price, extended hours included, read when the note opens from the shared ticker snapshot. No polling.

## Goals and non-goals

Goals: import from the feed or a link, one or several at a time, into a new or existing note, with attribution, the member's own words, and the price context.

Non-goals for this version: a member's personal X following or connecting X accounts (the owner's "follows list" is the curated feed), whole threads (the single linked post only), a chart with pins per post (only the price line), and drag-and-drop.

Anti-goals: an imported post leaking into the app's public feed; the import step sending the member's link or note content anywhere beyond the single post lookup; a confident price that is wrong; a vendor glitch wiping saved posts.

## How it fits the existing code (designer's calls unless marked)

Read the code at `origin/master` and treat this section as a starting map, not a spec of function signatures.

**Feed.** Reuse `GET /api/tweets/ticker/{sym}?hours=168` and `GET /api/tweets/feed?hours=168&limit=200`. The window is 7 days because the store keeps tweets 7 days (`TWEET_RETENTION_DAYS`). Respect `VITE_TWITTER_UI_ENABLED`.

**Headlines and Theses chips.** The store has no such classification. Add a per-account news-or-commentary setting on `twitter_accounts`, editable in `TwitterAccountsPanel`, defaulting to commentary. Headlines are posts from news accounts. No AI classification.

**Pasted link.** New server route under the research-capture router. It extracts only the numeric status id from an `x.com` or `twitter.com` `/status/` URL, and never fetches the URL the member supplied. It checks `tweets.db` first, otherwise looks the id up through TwitterAPI.io's `GET /twitter/tweets?tweet_ids=` (already used by `find_deleted_tweet_ids`) and normalizes with `_normalize_tweet`. Link-fetched posts are **not** written to `tweets.db`, because that would put them in everyone's feed. Rate-limit per member. Distinct messages for: not found or deleted or protected; the service unavailable.

**Save.** The client sends post ids, not text. The server re-reads each post from the store or the vendor before saving, the same trust boundary as `transcript_capture.save_passage`.

**Storage.** Reuse the excerpt model rather than adding a node type: one `j2_note_documents` row with `capture_type='web_passage'` as transcripts use, identified by `x:<tweet_id>`, one page holding the text, one `j2_note_excerpts` row whose `annotation` is **My take**. This gets search, Ask citations and thesis evidence for free, and the existing `documentExcerpt` node needs no schema bump. Post identity and author, post time, permalink, image references and the price fields need a home alongside the document (the builder chooses the column or companion table). Read the "what each row means" header of `web_capture_store.py` and keep its semantics, including that entity association is never inferred from the member's prose.

**Card.** `ExcerptView` renders a dedicated tweet card when the excerpt's source is an X post. My take saves through the existing annotation update.

**Inserting.** Follow `TranscriptDoors` and `TranscriptInsertHost`: at the cursor inside a note, append through the existing server path from the ticker page.

**Images.** `pbs.twimg.com` URLs are not durable. Copy images into the member's note attachments at import, through the guarded media path used by the connectors. If a copy fails, import the post without the image and say so.

**Flag and access.** New `notebook_tweet_import_enabled`, delivered like `notebook_transcript_capture_enabled`, `require_paid` on writes. Roll out admin first, then everyone.

**Sharing (designer's call: keep the existing ruling).** Share links and published pages are both anonymous, and `public_note_payload.py` already reduces every `documentExcerpt` to its "not shown on public pages" placeholder under owner ruling D-B4 / L3. Tweet cards inherit that unchanged in both modes: no post text, image, avatar, My take or price line on any public page, and no new way to serve member attachments anonymously. Add a test that proves a tweet card takes that path.

**Accessibility and mobile.** Use the shared `Sheet`, the Notebook's roving focus and 44px touch rules, matching `SaveTranscriptPassage`.

## Constraint to respect: X's terms

The app already treats tweet storage as restricted. `tweet_cleanup.py` deletes stored tweets after 7 days and removes any tweet deleted on X within 24 hours, citing X's Developer Agreement. `docs/terminal-research/02-data-providers/provider-ledger.md` also records display requirements (username, avatar, logo, timestamped link), which the card meets. A saved card outlives the 7-day window, so the feature needs an explicit rule.

The ledger also rates keeping tweet text as restricted, with a question for counsel still open. The rule below lowers that risk and does not remove it. The owner delegated these two decisions to the designer on 2026-11-08 and accepted the designer's picks.

## Decided: when a post disappears from X

Saved cards follow X's rule. A card is not exempt because it lives in a member's note.

- A nightly job checks every distinct saved post id through `find_deleted_tweet_ids`. One lookup per post id, shared across members, so cost grows with distinct posts (vendor price noted in `twitterapi_io.py`: $0.15 per 1,000 tweets returned).
- When a post is confirmed gone, remove its text and copied images everywhere they are held: page text, `captured_text`, full-text search rows, the meaning-search index and the attachment files. The excerpt model deliberately has no update path for source text, so this needs one narrow, purpose-built removal path.
- The card stays. It keeps the author name, handle, posted time, link, price line and My take, and says "This post is no longer on X."
- Never remove on a single miss. The lookup signals "gone" by omitting an id, so a vendor glitch looks the same as a deletion. A post is gone only when two checks at least 10 minutes apart both miss it. If one pass would remove more than 20% of the ids it checked (and at least 20), remove nothing and alert the owner.
- If the check cannot run, nothing changes and the next night tries again, the same posture as `_run_deletion_sync`.

## Decided: AI features may read saved posts

Saved post text is treated like the rest of the member's note: Ask can cite it and meaning search can index it. It is never used for training anything, and a removed post leaves those indexes too. The voice assistant's research tools already read the same tweet store. The ledger rates AI use of tweet content as unknown, so this is an accepted risk.

## Left to the builder

Exact component and route names, the storage shape for post metadata, how often the price "Now" is cached, skeleton and empty-state details consistent with the preview.

## Done means

A real browser, signed in, on real data: the button opens the sheet, a real feed post and a real pasted link both import, the card shows the real author, text, image, price at post and move since, My take persists after reload, the note appears on the ticker page, and `/tweet` inserts at the cursor. The price at post is checked against the chart for that minute with extended hours on, not just displayed.
