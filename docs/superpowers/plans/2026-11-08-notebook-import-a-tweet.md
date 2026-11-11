# Notebook: Import a tweet Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Members import posts from the curated feed or a pasted X link into a Notebook note as attributed cards with My take and a price-at-post line.

**Architecture:** A saved post is an ordinary cited excerpt (`j2_note_documents` + page + `j2_note_excerpts` + `documentExcerpt` node), written the way `transcript_capture.save_passage` writes one. A new sidecar table holds what an excerpt cannot: author, permalink, images, price. `ExcerptView` draws a tweet card when the sidecar is present. A nightly job removes the words of posts that left X.

**Tech Stack:** FastAPI, SQLite (auth.db), React, TipTap, SWR, vitest, pytest.

**Spec:** `docs/superpowers/specs/2026-11-08-notebook-import-a-tweet-design.md`. Layout, wording and behavior reference: `docs/superpowers/specs/assets/2026-11-08-import-a-tweet-preview.html`.

## Global Constraints

- Flag: env `NOTEBOOK_TWEET_IMPORT_ENABLED`, added to `NOTEBOOK_FLAGS` in `api/routers/auth.py` with default `False`, payload key `notebook_tweet_import_enabled`. Every new route answers 404 while it is off, read per request.
- Every write route is paid-gated with the module's `require_paid`. Bodies use the module's `_json`.
- Link-fetched posts are NEVER written to `tweets.db`.
- The server only ever fetches a tweet by its numeric id. It never fetches the member's URL.
- Save takes post ids and re-reads the post server-side. It never stores client-supplied text.
- At most 20 posts per import.
- No new dependencies. No new TipTap node type, so no `notebook_schema.py` entry.
- Icons via `UIcon` (add an `xLogo` glyph). No emoji. Sheet via `components/mobile` `Sheet`, 44px touch targets at the touch tier.
- Every note write on the client calls `settleNoteWrite`.
- Bash: scoped pytest only, never `pytest tests/` unscoped. Edit files with the Edit tool only, never `sed`, never `git stash`. One test or build process at a time. Search only inside this worktree.
- Repo is public: no real member data, keys or vendor dumps in fixtures. Use invented handles.

## Review Focus

1. Two imports of the same post into one note (double click, or the post already placed then removed): one excerpt, placed once.
2. A vendor outage during the nightly check: nothing is removed.
3. A post with no cashtag, or a ticker with no bars: the card imports with no price line and no error.
4. A note that is locked or trashed at save time: a clear refusal, no half-written rows.
5. A post removed from X when the member's My take holds text: the take survives and stays searchable, the post's words do not.

---

### Task 1: Account kind (news or commentary)

**Files:**
- Modify: `api/services/tweet_store.py`, `api/routers/admin_twitter.py`, `app/src/components/admin/TwitterAccountsPanel.jsx`
- Test: `tests/test_tweet_store.py`

**Interfaces:**
- Produces: `tweet_store.set_account_content_kind(handle: str, kind: str) -> None`; `list_accounts()` rows carry `content_kind` (`'news'` or `'commentary'`, default `'commentary'`).

- [ ] **Step 1: Write failing tests** `test_content_kind_defaults_to_commentary`, `test_set_content_kind_round_trips`, `test_set_content_kind_rejects_unknown_value` (`ValueError`).
- [ ] **Step 2: Run** `python -m pytest tests/test_tweet_store.py -q -k content_kind`. Expected: FAIL.
- [ ] **Step 3: Implement.** Add the column with the same guarded `ALTER TABLE` idiom as `is_official`. Accept `content_kind` in `PATCH /twitter-accounts/{handle}` beside `is_official`. Add a News toggle beside the Official toggle in the panel.
- [ ] **Step 4: Run tests.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(tweets): mark curated accounts as news or commentary`.

### Task 2: Reading posts (feed shape and link lookup)

**Files:**
- Create: `api/services/journal_two/tweet_capture.py`
- Modify: `api/services/twitterapi_io.py`, `api/routers/auth.py`, `api/routers/notebook_research_capture.py`, `api/main.py`
- Test: `tests/test_notebook_tweet_capture.py`

**Interfaces:**
- Produces in `twitterapi_io`: `get_tweets_by_ids(tweet_ids: Iterable[str]) -> list[dict]`, normalized by `_normalize_tweet`. Extract one private request helper that `find_deleted_tweet_ids` also uses. Do not change its behavior.
- Produces in `tweet_capture`:
  - `class TweetCaptureError(Exception)` with `.status` (default 400)
  - `enabled() -> bool`
  - `parse_status_id(url: str) -> str | None`
  - `recent(symbol: str | None, scope: str) -> list[dict]`, scope `'ticker'` (168 hours, `tweets_for_ticker`) or `'all'` (`feed(hours=168, limit=200)`)
  - `resolve_link(url: str) -> dict`
- Post shape (camelCase, no `raw_json`): `{id, name, handle, avatarUrl, text, postedAt, url, tickers, media, kind}`. `avatarUrl` comes from a `pbs.twimg.com/profile_images/` regex over `raw_json`, else `None`. `kind` comes from the author's `content_kind`, `'commentary'` for unknown authors.
- Routes on new `tweets_router` (prefix `/api/j2/research-capture/tweets`): `GET /recent?symbol=&scope=` and `POST /resolve` with body `{url}`. `/resolve` uses `public.enforce_rate` as `notes_media_fetch_endpoint` does, scope `notebook-tweet-resolve`, 30/minute, keyed `member:<id>`. Record that scope in the single-process list in `CLAUDE.md`.

- [ ] **Step 1: Write failing tests.**

```python
@pytest.mark.parametrize("url,want", [
    ("https://x.com/a_b/status/123", "123"),
    ("https://twitter.com/a_b/status/123?s=20", "123"),
    ("https://mobile.twitter.com/a_b/status/123/photo/1", "123"),
    ("x.com/a_b/status/123", "123"),
    ("https://x.com.evil.test/a/status/123", None),
    ("https://x.com/a_b", None),
    ("not a link", None),
])
def test_parse_status_id(url, want):
    assert tweet_capture.parse_status_id(url) == want
```

Also: `test_resolve_prefers_the_store_and_makes_no_vendor_call`; `test_resolve_vendor_hit_is_not_written_to_tweets_db`; `test_resolve_missing_post_is_404_with_sentence` ("That post could not be found. It may be deleted or private."); `test_resolve_vendor_error_is_503_with_sentence` ("X is not answering right now. Try again in a moment."); `test_recent_shape_has_no_raw_json`; `test_routes_404_when_flag_off`.

- [ ] **Step 2: Run** `python -m pytest tests/test_notebook_tweet_capture.py -q`. Expected: FAIL.
- [ ] **Step 3: Implement.** The host must be exactly `x.com` or `twitter.com`, optionally `www.` or `mobile.`. Mount `tweets_router` in `main.py` beside `passed_router`.
- [ ] **Step 4: Run tests.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(notebook): read recent posts and resolve a pasted X link`.

### Task 3: Price at post

**Files:**
- Create: `api/services/journal_two/tweet_price.py`
- Test: `tests/test_notebook_tweet_price.py`

**Interfaces:**
- Produces:
  - `@dataclass(frozen=True) PricePoint(symbol: str, price: float, label: str, session_date: str | None)`, label one of `'posted' | 'premarket' | 'after_hours' | 'close'`
  - `choose_symbol(note_ticker: str | None, tickers: list[str], text: str) -> str | None`
  - `price_at_post(symbol: str, posted_at: int) -> PricePoint | None`
  - `still_comparable(symbol: str, posted_at: int, price: float) -> bool`

Rules: try tf `"1"`, then `"5"`. Read `bars_sqlite.get_bars_before(symbol, tf, 1, posted_at - tf_seconds)` so the bar has fully closed by the post. Accept it only if it is no more than 1800 seconds older than the post. Otherwise read the most recent `"D"` bar whose session closed before the post and return label `'close'` with its date. Intraday `ts` is unix seconds, daily `ts` is `YYYYMMDD`. Label from the bar's ET time on `America/New_York`: 09:30-16:00 `posted`, 04:00-09:30 `premarket`, 16:00-20:00 `after_hours`. On a local miss for a post under 60 days old, one fetch through a seam `_fetch_bars(symbol, tf, count)` that wraps `api.routers.bars.serve_bars` and parses its JSON. Any exception returns `None`.

`still_comparable` compares `price` with that session's daily close. More than 40% apart means a split happened: `False`. No daily bar: `True`.

- [ ] **Step 1: Write failing tests**, seeding bars through a monkeypatched `get_bars_before`:
  - `test_regular_session_label_posted`
  - `test_bar_must_close_before_the_post` (the 5-minute bar containing the post is not used)
  - `test_premarket_label`, `test_after_hours_label`
  - `test_stale_bar_falls_back_to_close` (bar 31 minutes old)
  - `test_saturday_post_is_friday_close` with `label == 'close'` and `session_date` the Friday
  - `test_no_bars_returns_none`
  - `test_choose_symbol_prefers_note_ticker_when_mentioned`
  - `test_choose_symbol_first_cashtag_in_text_order`
  - `test_choose_symbol_none_without_cashtag`
  - `test_still_comparable_false_after_split`
- [ ] **Step 2: Run** `python -m pytest tests/test_notebook_tweet_price.py -q`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run tests.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(notebook): price at post for imported tweets`.

### Task 4: Saving posts into a note

**Files:**
- Modify: `api/services/journal_two/db.py`, `api/services/journal_two/tweet_capture.py`, `api/services/journal_two/note_excerpts.py`, `api/services/journal_two/media_policy.py`, `api/routers/notebook_research_capture.py`
- Test: `tests/test_notebook_tweet_capture.py`, `tests/test_public_note_payload.py`

**Interfaces:**
- Consumes: Task 2 reads, Task 3 price.
- Produces:
  - Table `j2_note_tweet_captures(document_id TEXT PRIMARY KEY, user_id, note_id, tweet_id, author_handle, author_name, avatar_url, permalink, posted_at INTEGER, media_json TEXT NOT NULL DEFAULT '[]', price_symbol, price_at_post REAL, price_label, price_session_date, gone_first_missed_at TEXT, removed_at TEXT, created_at TEXT NOT NULL)`, an index on `tweet_id`, and an AFTER DELETE trigger on `j2_note_documents`.
  - `tweet_capture.save(user_id: str, note_id: str, tweet_ids: list[str]) -> dict` returning `{excerpts: [...], note: {id, updatedAt}, warnings: [str]}`.
  - Route `POST /save` with body `{noteId, tweetIds}`.
  - Excerpt reads carry `tweet: {tweetId, name, handle, avatarUrl, url, postedAt, media, price: {symbol, price, label, sessionDate} | None, removed: bool}` when a sidecar row exists, and no `tweet` key otherwise. `price` is `None` when `still_comparable` is false.
  - `media_policy.delete_stored_media(user_id: str, note_id: str, url: str) -> bool`, the inverse of `store_media`.

Storage: follow `transcript_capture.save_passage`. Document identity `x:<tweet_id>`, name `@handle on X`, `source_kind='web'`, `source_url` the permalink, `capture_type='web_passage'`, page 1 with origin `web_passage`, excerpt covering the whole text, sanitized with `web_capture.sanitize_text`. Same `BEGIN IMMEDIATE`, tenant check, re-place-if-removed dedupe and `_undo` handling. Each post has its own transaction. A failure on one post stops the import and reports what was saved.

Images: after the post's transaction commits, copy up to 4 `pbs.twimg.com` images with `fetch_content_url` over `media_http_client`, then `normalize_media` and `store_media` under `MediaBudget.for_member`, and write the stored URLs to `media_json`. A failed copy adds the warning "An image from @handle could not be copied." and the post stays saved.

- [ ] **Step 1: Write failing tests:**
  - `test_save_creates_excerpt_node_and_sidecar`
  - `test_save_never_uses_client_text`
  - `test_save_twice_is_one_excerpt_placed_once`
  - `test_save_replaces_node_after_member_removed_it`
  - `test_save_to_locked_note_is_423_and_leaves_no_rows`
  - `test_save_to_other_members_note_is_404`
  - `test_save_over_20_is_400`
  - `test_save_without_cashtag_has_no_price`
  - `test_image_copy_failure_warns_and_keeps_post`
  - `test_excerpt_read_carries_tweet_fields`
  - `test_excerpt_read_without_sidecar_has_no_tweet_key`
  - `test_excerpt_read_hides_price_after_split`
  - in `tests/test_public_note_payload.py`: `test_tweet_excerpt_is_reduced_on_share_and_publish`, asserting no post text, handle or price appears in either mode.
- [ ] **Step 2: Run** `python -m pytest tests/test_notebook_tweet_capture.py tests/test_public_note_payload.py -q`. Expected: the new tests FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run tests.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(notebook): save imported tweets as cited excerpts`.

### Task 5: Removing posts that left X

**Files:**
- Create: `api/services/journal_two/tweet_capture_sync.py`
- Modify: `api/main.py`
- Test: `tests/test_notebook_tweet_capture_sync.py`

**Interfaces:**
- Consumes: `twitterapi_io.find_deleted_tweet_ids`, `media_policy.delete_stored_media`, the Task 4 table.
- Produces: `run_sweep() -> dict`, `run_confirm() -> dict`, `remove_post(conn, tweet_id: str) -> int`.

`run_sweep` checks every distinct `tweet_id` with `removed_at IS NULL`, clears `gone_first_missed_at` on those that resolve, and stamps it on those that do not. If the misses exceed 20% of those checked and number at least 20, it clears the stamps it made, logs at ERROR, sends the owner alert, and removes nothing. `run_confirm` re-checks only stamped ids at least 10 minutes old. A confirmed miss calls `remove_post`.

`remove_post`: delete the page row (its trigger clears page search), then `UPDATE j2_note_excerpts SET captured_text='', annotation=annotation` so the `AFTER UPDATE OF annotation` trigger rewrites the search row with only the member's words. Delete the copied images, set `media_json='[]'`, set `removed_at`. The sidecar's author, link, time and price stay.

Any `TwitterApiError` makes the pass a no-op. Register both jobs beside `tweet_cleanup_daily` at 03:10 and 03:25 ET, `max_instances=1`, each returning early while the flag is off.

- [ ] **Step 1: Write failing tests:**
  - `test_single_miss_removes_nothing`
  - `test_confirm_needs_ten_minutes`
  - `test_two_misses_remove_text_keep_take_and_author`
  - `test_removed_text_not_searchable_take_still_searchable` (query `j2_note_excerpts_fts` and `j2_note_document_pages_fts`)
  - `test_post_that_resolves_again_clears_the_mark`
  - `test_bulk_miss_removes_nothing_and_alerts`
  - `test_vendor_error_changes_nothing`
  - `test_one_lookup_per_distinct_tweet_across_members`
- [ ] **Step 2: Run** `python -m pytest tests/test_notebook_tweet_capture_sync.py -q`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run tests.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(notebook): remove saved tweets that left X`.

### Task 6: The import sheet and its doors

**Files:**
- Create: `app/src/pages/journal-2-0/lib/tweetImport.js`, `components/notebook/ImportTweetSheet.jsx`, `ImportTweetSheet.module.css`, `TweetDoors.jsx`, `ImportTweetSheet.test.jsx` (all under `app/src/pages/journal-2-0/`)
- Modify: `components/notebook/SlashMenu.jsx`, `NoteEditorPage.jsx`, `TickerResearchWorkspace.jsx`, `a11y/notebookSurfaces.js`, `app/src/components/ui/UIcon.jsx`
- Test: `ImportTweetSheet.test.jsx`

**Interfaces:**
- Consumes: routes from Tasks 2 and 4.
- Produces in `tweetImport.js`: `TWEET_IMPORT_FLAG`, `TWEET_EVENT = 'uct-notebook:tweet-import'`, `tweetImportEnabled()`, `fetchRecent({symbol, scope})`, `resolveLink(url)`, `saveTweets({noteId, tweetIds})`, `groupByDay(posts)`, `setPendingFocus(excerptId)`, `consumePendingFocus(excerptId) -> boolean`.
- Produces in `TweetDoors.jsx`: `ImportTweetButton({symbol, notes, onSaved, onOpenNote, disabled})`, `TweetInsertHost({editor, noteId, ticker})`. Both lazy-load the sheet through `lazyChunk`, like `TranscriptDoors`.
- Sheet props match `SaveTranscriptPassage`: `{open, onClose, symbol, notes, fixedNoteId, onSaved, onOpenNote}`.

Behavior and copy come from the preview: paste box "Paste a link to any post on X", chips `$TICKER` / All recent / Headlines / Theses and takes, search, day groups, checkbox rows, "From your link" at the top already ticked, "Already in this note" disabled, "Saved in one of your notes", footer Save to, or "Adding to <title>", "Nothing saved until you import", "Import N posts". Invalid link: "That doesn't look like a link to a post on X." New note title `<SYM>: what people are saying`, created through `createNoteViaApi` with the ticker.

`/tweet` slash item: title "Tweet", keywords `['tweet','twitter','x','post','import']`, available `tweetImportEnabled`, dispatching `TWEET_EVENT` on the editor's DOM root. Add an "Import a tweet" button to the editor toolbar dispatching the same event. From the host, insert nodes at `editor.state.selection.to` in the order ticked, skipping ids already in the doc.

- [ ] **Step 1: Write failing tests:**
  - `door renders nothing while the flag is off`
  - `ticking two posts and importing sends both ids in tick order`
  - `a valid link appears ticked under From your link`
  - `an invalid link shows the sentence and changes nothing`
  - `a post already in the note cannot be ticked`
  - `Import is disabled with nothing ticked`
  - `a server refusal shows its detail and keeps the selection`
  - `a warning from the server is shown after import`
  - `Headlines shows only news-account posts`
- [ ] **Step 2: Run** `cd app && npx vitest run src/pages/journal-2-0/components/notebook/ImportTweetSheet.test.jsx`. Expected: FAIL.
- [ ] **Step 3: Implement.** Call `settleNoteWrite(noteId, out)` after save, then `setPendingFocus` for the first excerpt.
- [ ] **Step 4: Run the test file, plus** `npx vitest run src/pages/journal-2-0/a11y/ariaCoverage.test.js`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(notebook): Import a tweet sheet, button and /tweet`.

### Task 7: The tweet card

**Files:**
- Create: `components/notebook/TweetCard.jsx`, `TweetCard.module.css`, `TweetCard.test.jsx` (under `app/src/pages/journal-2-0/`)
- Modify: `components/notebook/ExcerptView.jsx`, `lib/tweetImport.js`
- Test: `TweetCard.test.jsx`, the existing `ExcerptView` tests

**Interfaces:**
- Consumes: `excerpt.tweet` from Task 4, `consumePendingFocus` from Task 6, `GET /api/snapshot/{ticker}`, `PATCH /api/j2/excerpts/{id}`.
- Produces: `TweetCard({excerpt, deleteNode, noteId})`; `priceLineParts(price, nowPrice) -> {thenText, nowText, pctText, tone} | null` in `tweetImport.js`.

Labels for `thenText`: `posted` "$NVDA when posted $188.20", `premarket` "$NVDA premarket $188.20", `after_hours` "$NVDA after hours $188.20", `close` "$NVDA close on Oct 14 $188.20". Now is `ext_price` when present, else `close`, read through SWR with no refresh interval. If it is missing, show only `thenText`. Removed posts show "This post is no longer on X." in place of the text and images, and keep everything else. My take saves on blur, then refreshes `useNoteExcerpts`. The whole card stays `contentEditable={false}`, with the take as its own text field. Avatars fall back to initials when the image fails.

- [ ] **Step 1: Write failing tests:**
  - `shows author, handle, text, time and View on X`
  - `price line for each label`
  - `no price line when price is null`
  - `then-only when Now is missing`
  - `up and down tone`
  - `removed post hides words and images, keeps take`
  - `My take saves on blur`
  - `pending focus lands in My take`
  - `avatar falls back to initials on error`
  - in the ExcerptView tests: `an excerpt without tweet renders the existing card` and `an excerpt with tweet renders TweetCard`
- [ ] **Step 2: Run** `cd app && npx vitest run src/pages/journal-2-0/components/notebook/TweetCard.test.jsx`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npx vitest run src/pages/journal-2-0/components/notebook/TweetCard.test.jsx src/pages/journal-2-0/components/notebook/ExcerptView`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(notebook): tweet card with My take and price line`.

### Task 8: Whole flow in a real browser

**Files:**
- Create: `tools/tweet_import_smoke.py`

- [ ] **Step 1:** Build `app` and start a local backend with the sandbox settings in `CLAUDE.md` (the "Mobile audit harness" section), `NOTEBOOK_TWEET_IMPORT_ENABLED=1`, a temp `DATA_DIR`, and a seeded `tweets.db` of invented posts. Link lookup is answered by a local stub base URL through `TWITTERAPI_IO_BASE_URL`.
- [ ] **Step 2:** Drive the flow with Playwright: open a ticker page, tick two posts, import, type a take, reload, confirm the take persisted, return to the ticker page and see the note, then `/tweet` inside the note and confirm the card lands at the cursor. Paste a link. Check at 390, 820 and 1200 wide with no horizontal overflow.
- [ ] **Step 3:** Run with the flag unset and confirm the button, slash item and routes are absent.
- [ ] **Step 4: Commit** `test(notebook): browser smoke for Import a tweet`.
