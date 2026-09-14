# S-07 — User-defined templates + a valuation scaffold

**Status:** SPEC ONLY. No product code, no tests, no git in this pass.
**Worktree measured:** `C:\Users\Patrick\uct-worktrees\notebook-s`, 2026-09-13.
**Scope:** exactly the two gaps that survived measurement of manifest row S-07 —
**(a)** no user-defined templates, **(b)** no financials/valuation scaffold.
Nothing else. The programme decides scope; this document specifies what was asked.

**House rule applied throughout:** every `file:line` citation below is quoted from the
file at the line named. A citation that could not be quoted was struck rather than
softened. Counts are derived by reading the arrays in this session, never copied.

---

## 0. Path correction (the manifest row has drifted)

The brief named `app/src/pages/journal-2-0/components/notebook/NotebookTab.jsx`.
That file does not exist. The real path is:

```
app/src/pages/journal-2-0/tabs/NotebookTab.jsx
```

The other three paths in the brief resolve as given. The *picker* does live under
`components/notebook/` — `app/src/pages/journal-2-0/components/notebook/TemplatePicker.jsx` —
which is probably where the row's path came from.

---

## 1. What ships today — measured, not retyped

### 1.1 The counts I derived in this session

I counted `app/src/pages/journal-2-0/lib/notebookTemplates.js` by reading the two exported
arrays, not by reading any prose about them.

**Templates: 9.** Every `key:` line inside `export const TEMPLATES`, in file order:

| # | line | key | family |
|---|---|---|---|
| 1 | `:38` | `daily-prep` | `rituals` (`:40`) |
| 2 | `:77` | `post-market-debrief` | `rituals` (`:79`) |
| 3 | `:110` | `weekly-plan` | `rituals` (`:112`) |
| 4 | `:147` | `weekly-review` | `rituals` (`:148`) |
| 5 | `:174` | `thesis` | `research` (`:176`) |
| 6 | `:207` | `trade-review` | `trades` (`:209`) |
| 7 | `:236` | `swing-log` | `trades` (`:238`) |
| 8 | `:261` | `earnings-play` | `trades` (`:263`) |
| 9 | `:287` | `tilt-log` | `mind` (`:289`) |

**Families: 4.** `export const FAMILIES` at `:27`, its four entries verbatim:

```
28:  { key: 'rituals', label: 'Daily & weekly rituals' },
29:  { key: 'research', label: 'Thesis & research' },
30:  { key: 'trades', label: 'Around a trade' },
31:  { key: 'mind', label: 'Mindset' },
```

**This agrees with manifest row S-07.** The row says *"`notebookTemplates.js:36` holds **9**
templates in **4** families"*, and that is what the arrays hold. I am not adding a third
count; I am reporting that the corrected row is correct.

### 1.2 Four artifacts still say "eight", and one of them is a test name

The manifest row already flagged two. There are four, and the two new ones matter more
than the two already known, because one of them is a *rail*:

| artifact | line, verbatim |
|---|---|
| source header | `notebookTemplates.js:5` — `` * Eight firm-authored, data-aware TipTap scaffolds in three families`` |
| source section marker | `notebookTemplates.js:34` — `// ── The eight templates ───────────────────────────────────────────────────────` |
| **the rail's own test name** | `notebookTemplates.test.js:33` — `it('exports exactly the eight planned templates (stable keys)', () => {` |
| **the plan of record** | `docs/superpowers/specs/2026-07-12-notebook-templates-plan.md:118` — `Lineup is therefore **8 templates**.` |

The test-name case is the instructive one: `KEYS` in that same file lists nine keys
(`notebookTemplates.test.js:11-21`) and the assertion at `:34` is
`expect(TEMPLATES.map((t) => t.key)).toEqual(KEYS)` — so the **assertion is correct and
the sentence describing it is wrong**. A green rail is currently publishing the wrong
number. S-07's first commit should fix all four strings; they are the cheapest thing in
this spec and the highest-frequency source of the next wrong count.

### 1.3 Data-aware prefill is live, and this is its whole surface

`app/src/pages/journal-2-0/lib/templateContext.js:120-136` — `assembleTemplateContext`
fetches at most three things and returns exactly seven fields:

```
122:  const [breadth, positions, gamePlan] = await Promise.all([
123:    needs.regime ? fetchJson('/api/breadth') : Promise.resolve(null),
124:    needs.positions ? fetchJson('/api/j2/positions') : Promise.resolve(null),
125:    needs.gamePlan ? findTodayGamePlan() : Promise.resolve(null),
126:  ])
```

```
128:    dateText: fmtDate(now),
129:    dateShort: fmtShort(now),
130:    weekOfText: fmtShort(mondayOf(now)),
131:    ticker: (ticker || '').trim().toUpperCase() || null,
132:    regimeLine: regimeLineFrom(breadth),
133:    positionLines: positionLinesFrom(positions),
134:    gamePlanNote: gamePlan,
```

No price. No earnings date. No fundamentals. That matches the manifest row and is the
starting point for gap (b).

Two consumers, both already routed through one path:

- `app/src/pages/journal-2-0/tabs/NotebookTab.jsx:528` — `const createFromTemplate = async (tpl, { ticker } = {}) => {`
- `app/src/pages/journal-2-0/lib/noteCreation.js:62` — `ctx = await assembleTemplateContext({ ticker, needs: tpl.needs })`

The context is assembled **client-side at create time** and its failure law is stated in
the module header, `templateContext.js:6-8`:

```
 6:  * source resolves to null (graceful blanks — a template must always produce
 7:  * a valid doc, offline included, and a free-tier 402 simply yields the
 8:  * un-filled scaffold).
```

That law governs everything proposed in §3.

### 1.4 The picker

`app/src/pages/journal-2-0/components/notebook/TemplatePicker.jsx:7` —
`import { FAMILIES, templatesByFamily } from '../../lib/notebookTemplates'` — then a
"Blank note" card first (`:14-22`), one `<section>` per family (`:24`
`{FAMILIES.map((fam) => (`), and a trailing pointer card to My Playbook (`:45-55`).
The grid inside a family is `:28` — `{templatesByFamily(fam.key).map((tpl) => (`.

`onPick` takes a template object or `null`; `NotebookTab.jsx:546` —
`const handlePick = (tplOrNull) =>` — maps `null` to a blank note.

### 1.5 `containsTableNode` guards a retired constraint (confirmed, unchanged by this spec)

`notebookTemplates.js:13-14` says StarterKit has no table extension. It does now:
`app/src/pages/journal-2-0/lib/tiptap.js:11` —
`import { Table, TableRow, TableHeader, TableCell } from '@tiptap/extension-table'` — and
`tiptap.js:56` — `Table.configure({ resizable: false }), TableRow, TableHeader, TableCell,`.

I re-confirmed this because §3's valuation scaffold is the first template that would
*want* a table. **This spec still does not use one** — see §3.2 and Non-Goal N-6. Removing
the guard is not in S-07's scope; the guard is simply no longer load-bearing and the
scaffold must not be designed around it either way.

---

## 2. Gap (a) — user-defined templates

### 2.1 What does not exist, measured

- No write path. `TEMPLATES` is a module constant; `getTemplate` (`:329-331`) and
  `templatesByFamily` (`:334-336`) only read it.
- **No link from a note back to the template it came from.** `grep -rn "template_id\|templateKey\|template_key" api/services/journal_two/ api/routers/journal_two.py` returns
  nothing, and the `j2_notes` schema (`api/services/journal_two/db.py:378-410`) has no such
  column. A template's output is *copied* into `body_json` at create time
  (`noteCreation.js:69` — `bodyJson: tpl.build(ctx),`) and nothing points back.
  **This is the single most important fact in §2.5.**
- The one coupling that does survive creation is the **tag**. `daily-prep` writes
  `tags: ['game-plan']` (`notebookTemplates.js:43`) and `templateContext.js:101` reads it
  back: `const data = await fetchJson('/api/j2/notes?tag=game-plan&sort=created')`.

### 2.2 Where a user template should live

Three candidate stores exist in this repo. Two of them have already been rejected in
writing for content of exactly this shape.

**Candidate 1 — `user_preferences` (the `watchlist_templates` idiom).**
The precedent is real and close: `app/src/pages/watchlist/watchlistTemplates.js:13` —
`export const WATCHLIST_TEMPLATES_KEY = 'watchlist_templates'` — a per-user array of named
blobs in one preference row, with `saveTemplate`/`removeTemplate` (`:49`, `:68`).
`chart_templates` does the same and caps itself client-side
(`app/src/components/chart/ChartSettingsModal.jsx:34` — `const MAX_TEMPLATES = 40`).

It is refused here, and the refusal is not mine — it is already recorded twice:

`api/services/user_definitions.py:25-30`:
```
25: WHY NOT `user_preferences` — ALSO MEASURED
27: `user_preferences` has NO SIZE LIMIT and NO DELETE ROUTE. A store for content a
28: user can author in a loop needs both, and inheriting neither is how a table
29: becomes unbounded quietly. This store names its caps (`MAX_DEFINITION_BYTES`,
30: `MAX_DEFINITIONS_PER_USER`) and ships a delete.
```

`api/services/journal_two/db.py:859-861`, deciding the same question for the capture inbox:
```
859: -- into notes while writing after the close. A row is one staged widgetEmbed
860: -- (params + search line + optional archived image); placing it into a note
861: -- consumes the row. A TABLE, not a preference — prefs have no delete route
```

There is a second, sharper reason. `POST /api/auth/preferences` replaces the whole value
(`api/routers/auth.py:2131-2135`), and the key space is now an allow-list
(`_PREFERENCE_KEYS`, `auth.py:1973-2021`). A new key means editing that dict **and** keeping
`tests/test_preference_key_validation.py` green — a rail that re-derives the key set from
`app/src/**`. That is workable, but the store still has no per-row delete and no server-side
size bound, and a user template is a TipTap document, which is the largest thing a member
can author.

**Candidate 2 — a new `j2_` table (RECOMMENDED).**
The shape already exists and is user-scoped, named, soft-deleted and ordered:
`db.py:843-853`, `j2_note_saved_views` — `id · user_id · name · view_type · spec_json ·
sort_order · created_at · updated_at · deleted_at` (`:852` — `    deleted_at  TEXT`), with
`:855` — `    ON j2_note_saved_views(user_id, deleted_at, sort_order);`.
Its CRUD is four routes in one router block
(`api/routers/journal_two.py:2049`, `:2054`, `:2065`, `:2078`).

**Candidate 3 — its own SQLite file, the `user_definitions.py` shape.** Correct for
something that other rows *pin by id and version*. A notebook template is not pinned by
anything (§2.1: nothing points back), so append-only versioning buys nothing here and
costs a new DB file, a new `_WRITE_LOCK`, and a new entry in the `/data` path census
(`conftest.shared_data_root_census()`). Rejected as over-built **for this row**, not as
wrong in general.

**Recommendation: a new table, `j2_note_templates`, modelled on `j2_note_saved_views`.**

```sql
CREATE TABLE IF NOT EXISTS j2_note_templates (
    id          TEXT PRIMARY KEY,       -- uuid4 hex
    user_id     TEXT NOT NULL,
    key         TEXT NOT NULL,          -- 'u_<12 hex>'; the deep-link identity, see §2.4
    label       TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    when_text   TEXT NOT NULL DEFAULT '',
    family      TEXT NOT NULL DEFAULT 'mine',
    tags_json   TEXT NOT NULL DEFAULT '[]',
    body_json   TEXT NOT NULL,          -- the frozen TipTap doc
    title_text  TEXT NOT NULL DEFAULT '',
    sort_order  INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL,
    deleted_at  TEXT
);
CREATE INDEX IF NOT EXISTS idx_j2_note_templates_user
    ON j2_note_templates(user_id, deleted_at, sort_order);
CREATE UNIQUE INDEX IF NOT EXISTS idx_j2_note_templates_key
    ON j2_note_templates(user_id, key);
```

**The trade-off, stated plainly.** The preference store is roughly a day of work and
follows a shipped idiom the member already benefits from on two other surfaces; the table
is roughly three days and needs a migration, four routes, a service and a client hook.
What the extra two days buy is a **per-row delete**, a **server-side size cap** and a
**server-side count cap** on the one artifact in the Notebook that a member can author in a
loop and that can legitimately be hundreds of kilobytes. `user_definitions.py:25-30` and
`db.py:859-861` are two independent prior rulings that this is the right side of that
trade for content of this shape, and I found no ruling on the other side.

**Caps — named here because the closest j2 precedent does NOT name them.**
`create_saved_view` (`api/services/journal_two/note_properties.py:464-497`) validates a
non-empty name and a `view_type` in `("list", "table")` and imposes no count or byte cap.
Do not inherit that omission. Derive the body cap from the note body cap that already
exists — `api/services/journal_two/notes.py:44` — `MAX_BODY_JSON_BYTES = 1_000_000  # 1MB`.

- `MAX_TEMPLATE_BODY_BYTES = 256 * 1024` — a template is a *scaffold*, not a finished
  note; a quarter of the note cap is generous and still bounded. The point is that there
  IS one.
- `MAX_TEMPLATES_PER_USER = 50` — the same number `user_definitions.MAX_DEFINITIONS_PER_USER`
  uses for the other user-authored artifact in this app; consistency beats a fresh guess.
- `label` ≤ 60 chars (matches `watchlistTemplates.js:50` — `const clean = (name || '').trim().slice(0, 60)`).

### 2.3 CRUD surface

Five routes on the existing `journal_two` router, alongside `/saved-views`:

| method | path | body / result |
|---|---|---|
| `GET` | `/api/j2/note-templates` | `{ templates: [...] }`, live rows only, `sort_order` then `created_at` |
| `POST` | `/api/j2/note-templates` | `{ label, description?, when?, tags?, bodyJson, titleText? }` → `{ template }`; server mints `id` and `key` |
| `PUT` | `/api/j2/note-templates/{id}` | partial update of the same fields → `{ template }`; 404 if not this user's |
| `DELETE` | `/api/j2/note-templates/{id}` | soft delete (stamp `deleted_at`) → `{ ok: true }` |
| `POST` | `/api/j2/notes/{note_id}/save-as-template` | freeze this note's current `body_json` into a new template → `{ template }` |

Auth: `Depends(get_current_user)`, matching every other `/saved-views` route
(`journal_two.py:2050`, `:2055`, `:2066`, `:2079`). **Not** `require_paid` — the built-in
templates are not gated, and gating the member's own version of a free feature is a
different product decision that this row was not asked to make. Flag it to the programme
rather than deciding it silently (see §6, U-1).

`save-as-template` is the primary creation door, because it needs no editor: the member
writes the note they want, then saves its shape. It stores the **rendered** body — the
member's note has already had `{ctx}` substituted into text, so there is no expression
language to design and no template DSL to maintain. See Non-Goal N-2.

**The one server-side rule that is not obvious:** a saved body must be validated through
the *same* path a note body is, or a template becomes a way to store a body the editor
cannot open. Reuse the note validator that raises at
`api/services/journal_two/notes.py:434-435`:
```
434:    if len(serialized.encode("utf-8")) > MAX_BODY_JSON_BYTES:
435:        raise NoteValidationError("body_json too large (>1MB)")
```
(with the tighter template cap), and reject a non-`doc` root outright.

### 2.4 Coexistence with the nine built-ins in the picker

**Decision: a template is a `{key, label, when, description, family, tags, needs, defaultTitle, build}`
object wherever the picker looks, whoever authored it.** A user template is adapted into that
shape at the boundary and nowhere else. This is forced, not chosen — three call sites
already consume that shape and two of them are outside the Notebook:

- `TemplatePicker.jsx:28-39` reads `tpl.key / .when / .label / .description`.
- `noteCreation.js:66-72` reads `tpl.defaultTitle(ctx) / .build(ctx) / .tags / .properties`.
- `app/src/hub/sections/notebookSection.js:33` — `import { TEMPLATES } from '../../pages/journal-2-0/lib/notebookTemplates'`,
  and `registry.js:561` records the standing rule: `// ⚠️ THE OPTIONS ARE DERIVED FROM `lib/notebookTemplates.js`, NEVER TYPED HERE — see`.

Concretely:

1. **A new module** `lib/userTemplates.js` exports `adaptUserTemplate(row)` returning that
   object, with `build: () => row.bodyJson` (a deep clone per call — the built-ins return a
   fresh doc every time, and a shared object would let one edit leak into the next note) and
   `defaultTitle: (ctx) => substituteTitle(row.titleText, ctx)`.
2. **`needs` is always `{}`** for a user template in v1. A frozen body has no `{ctx}`
   placeholders in it, so fetching regime/positions/game-plan for it would be three
   round-trips that change nothing. Title substitution needs only `dateShort`/`weekOfText`/
   `ticker`, which `assembleTemplateContext` computes with no network at all
   (`templateContext.js:128-131`).
3. **The picker gains one family**, rendered **after** the four built-in families and before
   the My Playbook pointer card: `{ key: 'mine', label: 'My templates' }`. It renders only
   when the member has at least one, and each card carries edit/delete affordances the
   built-in cards do not.
4. **Key namespace.** Built-in keys are stable API — `notebookTemplates.js:19-20`:
   ```
   19:  * Keys are STABLE API: trade-review / weekly-plan / daily-prep predate this
   20:  * catalog (P5-B3) and are deep-linkable via /journal/notebook?new=<key>.
   ```
   User keys are therefore minted `u_<12 hex>` — the same namespace shape and the same
   reasoning as `api/services/user_definitions.py:189` — `DEF_ID_PREFIX = "u_"`. A
   built-in key can never collide with `u_`, so `getTemplate(key)` can resolve built-ins
   first and user templates second with no ambiguity, and a member cannot shadow
   `daily-prep`.
5. **`getTemplate` must stay synchronous** — `NotebookTab.jsx:569` uses it inside a
   `useEffect` with no await: `const tpl = newKey === 'blank' ? null : getTemplate(newKey)`.
   So the user templates are loaded by a SWR hook into NotebookTab and the deep-link effect
   resolves against the loaded list, rather than `getTemplate` growing an async branch.
   A deep link that arrives before the list has loaded must **wait**, not fall through —
   see §2.5, because today it falls through silently.
6. **The hub's fan is derived and must stay derived.** `notebookSection.js:118` —
   `export function templateOptions(templates = TEMPLATES) {` — already takes the list as a
   parameter. Pass the merged list in; do not add a second list. `hub/notebookTemplatesPicker.test.jsx:262`
   asserts `const expected = TEMPLATES.map((t) => [t.key, t.label])`, so that rail must be
   updated in the same commit to derive from the merged list or to scope itself explicitly
   to built-ins.

### 2.5 Deleting a template must not break a note made from it

**It already cannot, and the reason is structural.** §2.1: nothing on a note points at a
template. `noteCreation.js:69` copies `tpl.build(ctx)` into the create request and the
server stores it in `j2_notes.body_json`. The note is a snapshot from the moment it is
created; the template could be deleted one second later with no effect on it. **Do not add
a `template_id` column to `j2_notes`** — that would manufacture the very dependency this
requirement asks us to avoid. That is the whole answer to the requirement, and it is a
property of the schema rather than of anyone's good behaviour.

Three second-order breakages are real, and each needs a decision:

**(i) A dead deep link is currently a SILENT NO-OP.** `NotebookTab.jsx:577-578`:
```
577:    if (tpl) createFromTemplate(tpl, { ticker })
578:    else if (newKey === 'blank') {
```
An unknown `?new=<key>` matches neither branch: the params are stripped at `:571-576` and
nothing happens — no note, no message. (`:571` opens the strip, `:576` closes it:
`    }, { replace: true })`.) Today that is nearly unreachable because built-in
keys never disappear. A deletable key makes it reachable, and it will land on a member who
bookmarked a deep link or pinned one to a shortcut.

> **Required with the delete, in the same commit:** an unresolved `?new=<key>` opens a
> **blank note** and shows the existing action banner — "That template no longer exists, so
> this is a blank note." `NotebookTab.jsx` already has the banner — `:596`:
> `        <div className={styles.actionError} role="alert">{actionError}</div>`. This is the same rule as
> *a dismissable control needs a recovery path in the same commit*: a silent no-op is the
> failure mode that looks like nothing happened.
>
> ⚠️ It must also not fire while the list is still loading — "not loaded yet" and "deleted"
> are different facts and must not render identically (§2.4 item 5).

**(ii) The tag outlives the template.** A user template that writes
`tags: ['game-plan']` makes its notes eligible for `templateContext.js:101`'s
`fetchJson('/api/j2/notes?tag=game-plan&sort=created')` — which is what the
`post-market-debrief` template quotes back. Deleting the template does not and should not
un-tag the notes. State this in the UI copy on the delete confirmation ("Notes already
created from this template are unaffected") so the member is not left guessing.

**(iii) Soft delete, not hard.** `deleted_at`, matching `j2_note_saved_views` (`db.py:853`).
It costs one column and makes an accidental delete recoverable by an operator without a
database restore. It also means the unique index on `(user_id, key)` must tolerate a
tombstoned row holding a key — either include `deleted_at` in the index or mint a fresh key
on re-create. **Pick one explicitly**; a partial index here is the kind of thing that ships
working and fails on the first member who deletes and re-saves under the same name.

---

## 3. Gap (b) — the valuation scaffold

### 3.1 What the two affected templates hold today

`thesis` (`notebookTemplates.js:174-205`) has six headings — Bull case, Bear case, Key
assumptions, Catalysts, Risks, What would prove me wrong — and **no revenue, margin or
multiple anywhere**. I read the whole `build` at `:189-204`; the words do not appear.

`earnings-play`'s "The report" bullets, `notebookTemplates.js:273-277` verbatim:
```
273:        bullets([
274:          'Date / before or after the bell: —',
275:          'Expected move: —',
276:          'Last four quarters (beat / miss / reaction): —',
277:        ]),
```
Three static em dashes. Every one of them is a number this app already computes (§3.3).

### 3.2 Sections the scaffold needs

A new **`valuation`** template in the existing `research` family, key `valuation`
(a built-in, so a plain stable key, not `u_`), plus a `Financials` block appended to
`thesis`. Headings only — **no table nodes** (Non-Goal N-6), for the same reason the
current templates use headings + bullets: a scaffold the member edits in prose is easier to
fill in than a grid, and the table question is a separate decision the programme has not
made.

| § | heading | content |
|---|---|---|
| V1 | **Where it trades now** | price · market cap · 52-week range · distance from the 50/200-day |
| V2 | **The multiple** | trailing and forward P/E · EV/Sales · EV/EBITDA · P/B · PEG |
| V3 | **Growth** | revenue growth % · earnings growth % · the last reported quarter's YoY |
| V4 | **Margins** | gross · operating · net · the direction of net margin over recent quarters |
| V5 | **Balance sheet** | cash · debt · debt/equity · current ratio · free cash flow |
| V6 | **The next report** | date · consensus EPS/revenue · expected move · last four quarters |
| V7 | **What has to be true** | *member-authored.* The forecast the multiple implies. |
| V8 | **What I would pay** | *member-authored.* A price, and the reasoning. |
| V9 | **What would prove me wrong** | *member-authored.* Mirrors `thesis:202-203`, deliberately. |

V1–V6 are prefillable. **V7–V9 are the point of the template and must never be
machine-written** — a scaffold that fills in the member's own thesis is a scaffold nobody
reads.

### 3.3 What can be prefilled, and from exactly where

Every endpoint below was located in this worktree and is mounted in `api/main.py`
(`:7990`, `:8140`, `:8217`, `:8221`, `:8222`).

---

**A. `GET /api/fundamentals-full/{ticker}`** — `api/routers/fundamentals.py:432-443`.
Returns `get_fundamentals(sym)` verbatim (`:443`).
**UNGATED**, and deliberately so — `:437-438`:
```
437:     Profile dock. No auth (public reference data, same bucket as the compact
438:     endpoint); `get_fundamentals` caches internally so repeat views never re-hit
```

Fields it supplies, read off `api/services/fundamentals.py:142-218`:

| scaffold § | field | line |
|---|---|---|
| V1 | `price` | `:192` — `"price": _round(info.get("currentPrice") or info.get("regularMarketPrice")),` |
| V1 | `market_cap` (formatted `"$1.23T"`) | `:149` |
| V1 | `fifty_two_week_high` / `_low` | `:193` / `:194` |
| V1 | `fifty_day_avg` / `two_hundred_day_avg` | `:195` / `:196` |
| V2 | `pe_trailing` / `pe_forward` | `:151` / `:152` |
| V2 | `peg` / `ps` / `pb` | `:153` / `:154` / `:155` |
| V2 | `ev_to_revenue` / `ev_to_ebitda` | `:156` / `:157` |
| V3 | `revenue_growth_pct` | `:165` — `"revenue_growth_pct": _round_pct(info.get("revenueGrowth")),` |
| V3 | `earnings_growth_pct` | `:166` |
| V4 | `gross_margin_pct` / `operating_margin_pct` / `profit_margin_pct` | `:159` / `:160` / `:161` |
| V5 | `total_revenue` / `ebitda` / `free_cash_flow` | `:168` / `:169` / `:170` |
| V5 | `total_cash` / `total_debt` / `debt_to_equity` / `current_ratio` | `:171`–`:174` |
| V6 | `next_earnings` (ISO `YYYY-MM-DD`) | `:205` — `"next_earnings": _next_earnings_iso(info),` |
| header | `name` / `sector` / `industry` | `:144` / `:145` / `:146` |

⚠️ **Unit traps that must be respected at the template boundary.** `market_cap`,
`total_revenue`, `ebitda`, `free_cash_flow`, `total_cash`, `total_debt` are **already
formatted strings** from `_fmt_billions` (`fundamentals.py:24-35`) — do not re-format them.
`dividend_yield_pct` carries a documented yfinance semantics change (`:176-179`) and is not
used by this scaffold. `debt_to_equity` is passed through `_round`, not `_round_pct`, and
yfinance reports it as a percentage-style number for many names — **render the label as
"Debt/equity (as reported)" rather than inventing a unit**, or leave it out. I could not
settle its unit from the source in this session (§6, U-4).

---

**B. `GET /api/earnings-intel/{ticker}`** — `api/routers/fundamentals.py:459-484`,
serving `api/services/earnings_intel.py:711` — `def get_earnings(ticker: str) -> dict:`.
**UNGATED, and that is a recorded product decision** — `fundamentals.py:471-472`:
```
471:     ⚠️ Deliberately UNGATED, and that is a product decision rather than an
472:     oversight (2026-09-07): every member sees the same Earnings research, so no
```

Payload keys, `earnings_intel.py:525-553`:
`ticker · quarters · estimates · annual · summary · reaction · next_report_date · meta`.

| scaffold § | field | line |
|---|---|---|
| V6 | `summary.next_report_date` | `:638` — `"next_report_date": (dated or {}).get("report_date"),` |
| V6 | `summary.next_report_label` (e.g. fiscal "FY2027 Q1") | `:639` |
| V6 | `summary.next_eps_estimate` | `:640` — `"next_eps_estimate": (dated or nearest or {}).get("eps_estimate"),` |
| V6 | `summary.next_revenue_estimate` | `:641` |
| V6 | `summary.double_beat_streak` | `:634` — `"double_beat_streak": streak or None,` |
| V4 | `summary.net_margin_pct` | `:642` |
| V4 | `summary.net_margin_series` (only when ≥6 points) | `:645` — `"net_margin_series": series if len(series) >= 6 else None,` |
| V3 | `quarters[].eps_yoy_pct` / `rev_yoy_pct` | `:436` / `:437` |
| V6 | `quarters[].eps_beat` / `rev_beat` / `double_beat` | `:466` / `:467` / `:468-469` |
| V6 | `quarters[].label` | `:427` |

⚠️ `double_beat` is deliberately tri-state — `:468-469`:
```
468:        q["double_beat"] = (None if (q["eps_beat"] is None or q["rev_beat"] is None)
469:                            else bool(q["eps_beat"] and q["rev_beat"]))
```
`None` means "not scored", **not** "miss" (`:467` carries that comment). A scaffold that
renders `None` as "miss" would print a false statement into a member's research note. Render
`None` as an em dash — the same em dash the template already uses for absent data.

---

**C. The earnings-day reaction** — `api/services/earnings_reaction.py:161-207`, folded into
**B**'s payload at `earnings_intel.py:520` — `        reaction = _er.reaction_for(sym, quarters)`.
This is the third clause of `earnings-play:276`'s "beat / miss / **reaction**".

`reaction_for` returns (`earnings_reaction.py:203-207`):
```
203:     return {
204:         "events": events,
205:         "avg_abs_move_pct": round(sum(abs(m) for m in moves) / len(moves), 2),
206:         "n_quarters": len(moves),
207:     }
```
Each event (`:191-197`): `quarter · report_date · reaction_pct · eps_actual · eps_estimate`,
**newest last** (`:199` — `events.reverse()`). Definition, from the module header `:7-8`:
"the CLOSE-TO-CLOSE move of the session that first traded the result". Label it that way in
the note; do not call it a gap.

⚠️ A quarter that cannot be computed keeps its slot as `reaction_pct: null` (`:194`) —
`:27-29` explains that dropping it would re-pair every older quarter with a newer quarter's
move. **Preserve the nulls when rendering**; do not filter them out to make the bullet list
tidier.

---

**D. `GET /api/research/expected-move/{sym}`** — `api/routers/expected_move.py:39-88`.
**PAID** — `:42`:
```
42:                    user=Depends(require_paid)):
```
and the gate is stated at `:33-35` (`402`, "Expected-move research requires a paid plan").

Payload `{live, live_outcome, history, history_since, grade}` (`:78-88`). The number
`earnings-play:275`'s "Expected move" wants is `live.pct`, from
`api/services/implied_move.py:299-307`:
```
299:     move = {
300:         "pct": dollar / spot * 100,
301:         "dollar": dollar,
```

⚠️ **This is the one prefill source in the scaffold that is behind a paywall**, so it is the
one that must degrade most carefully. `templateContext.js:6-8` already states the law: a
402 yields the un-filled scaffold. A free member must get the em-dash prompt back —
**identical to today's behaviour**, which is exactly why this is safe to add.

⚠️ `live` can also be `null` on a *paid* account with a valid answer of "we cannot price
this", and the endpoint distinguishes the cases in `live_outcome` (`:80-84`). The template
must not render "0%" or "unavailable" for a refusal it did not read. If `live` is null,
print the em dash.

---

**E. Live price — `GET /api/live-prices?tickers=SYM`** — `api/routers/live_prices.py:555-557`,
no `Depends` on the handler and no router-level dependency (`live_prices.py:28` —
`router = APIRouter()`; `api/main.py:8140` — `app.include_router(live_prices_router.router)`).
Returns per-ticker `{price, change_pct, change, volume, observed_at, ...}` (`:560-565`).

**Recommendation: do not use it for the scaffold.** `/api/fundamentals-full`'s `price`
(`fundamentals.py:192`) is one field of a call the scaffold already makes. A second price
source in the same note would be a second authority over one value and the two would
disagree intraday by construction — `get_fundamentals` caches 30 min
(`fundamentals.py:21` — `_CACHE_TTL = 1800  # 30 min`). One price, one source, stamped with
the time the note was created. Named here because it is the obvious thing to reach for.

---

**Not available — the "before or after the bell" half of `earnings-play:274`.**
`_next_earnings_iso` (`fundamentals.py:52-71`) returns a **date only** — `:69`:
`return datetime.fromtimestamp(min(cands), tz=timezone.utc).strftime("%Y-%m-%d")`.
`summary.next_report_date` (`earnings_intel.py:638`) is likewise a date. The BMO/AMC
session lives on the calendar's own rows, and I did not establish a per-ticker endpoint
that returns it. **This stays a member-authored prompt** until someone names and quotes one
(§6, U-3). An endpoint I cannot name and quote is not available.

### 3.4 Summary — prefillable vs member-authored

| § | prefilled? | from |
|---|---|---|
| V1 Where it trades now | **yes** | A (ungated) |
| V2 The multiple | **yes** | A (ungated) |
| V3 Growth | **yes** | A + B (both ungated) |
| V4 Margins | **yes** | A + B (both ungated) |
| V5 Balance sheet | **yes** | A (ungated) |
| V6 The next report — date, consensus, last four quarters, reaction | **yes** | A + B + C (all ungated) |
| V6 The next report — **expected move** | **paid only** | D; em dash for free members |
| V6 The next report — **BMO/AMC** | **no** | nothing located; member-authored |
| V7 What has to be true | **never** | member |
| V8 What I would pay | **never** | member |
| V9 What would prove me wrong | **never** | member |

### 3.5 How it reaches `templateContext`

Three new `needs` flags, each opt-in per template exactly as the three existing ones are
(`templateContext.js:122-126`), so no existing template pays for a fetch it does not read:

| flag | fetch | new ctx fields |
|---|---|---|
| `needs.fundamentals` | `/api/fundamentals-full/${ticker}` | `fundamentals` (the raw dict, or `null`) |
| `needs.earnings` | `/api/earnings-intel/${ticker}` | `earnings` (`{summary, quarters, reaction}` slice, or `null`) |
| `needs.expectedMove` | `/api/research/expected-move/${ticker}` | `expectedMove` (`{pct, expiry}`, or `null`) |

All three go through the existing `fetchJson` (`:18-30`), which already returns `null` on a
non-2xx (`:23` — `if (!r.ok) return null`) and aborts at `const TIMEOUT_MS = 2500` (`:16`).
That is what makes the 402 path free.

**All three must be gated on a ticker.** `assembleTemplateContext` normalizes it at `:131`
(`ticker: (ticker || '').trim().toUpperCase() || null`); with no ticker, all three resolve to
`null` and the scaffold renders as prompts. That is the correct behaviour for a member who
opens the valuation template from the picker with nothing charted.

**Rendering law, inherited verbatim from the existing templates.** `daily-prep` is the
pattern (`notebookTemplates.js:56-58`):
```
56:        ...(ctx.positionLines && ctx.positionLines.length
57:          ? [h(2, 'Open positions'), bullets(ctx.positionLines)]
58:          : []),
```
A present value renders the section; an absent one renders **the prompt**, never an empty
heading and never a fabricated zero. `notebookTemplates.test.js:151` already rails exactly
this shape for `daily-prep`, and the valuation template must be railed the same way.

---

## 4. Rails — and the mutation that reddens each one

This programme's standard is that a rail must be able to fail. Each row names a mutation
that must turn it red; a rail whose mutation does not redden it is not finished.

### Gap (a)

| # | rail | reddened by |
|---|---|---|
| R-1 | **The count is derived, never typed.** Extend `notebookTemplates.test.js` so the count assertion reads `KEYS.length` and the *test name* interpolates it — no literal "eight"/"nine" anywhere in the file. | Add a tenth template without adding its key to `KEYS`. Control: a discriminator asserting `KEYS.length > 1` so a `KEYS` accidentally emptied cannot pass by iterating zero times. |
| R-2 | **A user template satisfies the same contract as a built-in.** Run `notebookTemplates.test.js`'s "every template is fully described for the picker" loop (`:37-50`) over `adaptUserTemplate(row)` for a fixture row. | Drop `when` from `adaptUserTemplate` — the picker renders `tpl.when` at `TemplatePicker.jsx:36` and would render `undefined`. |
| R-3 | **`build()` returns a fresh doc each call.** `expect(t.build(ctx)).not.toBe(t.build(ctx))` for an adapted user template, plus a mutation of the first result not appearing in the second. | Make `adaptUserTemplate` return `build: () => row.bodyJson` without the clone. |
| R-4 | **A built-in key can never be shadowed.** Assert every key in `TEMPLATES` fails `/^u_[0-9a-f]{12}$/`, and that `getTemplate` resolves a built-in even when a user row claims the same key. | Let the server accept a member-supplied `key`. |
| R-5 | **A deleted template's deep link opens a blank note with a banner — it never no-ops.** Render `NotebookTab` with `?new=u_deadbeefdead`, wait for the templates hook to settle, assert a note was created AND assert the **rendered text** of the banner. | Revert to the current `if (tpl) … else if (newKey === 'blank')` (`NotebookTab.jsx:577-578`). ⛔ Assert rendered DOM text, not state — this repo shipped two toast defects where every structural assertion stayed green. |
| R-6 | **Loading is not deletion.** Same render, but with the hook still pending: assert **no** banner and **no** note created. | Make the deep-link effect treat "list empty" as "unknown key". This is the rail that keeps R-5 from firing on every cold load. |
| R-7 | **Deleting a template does not touch the notes made from it.** Backend: create from a template, soft-delete it, re-read the note, assert `body_json` byte-identical. | Add a `template_id` FK with `ON DELETE CASCADE`. |
| R-8 | **The caps exist and fire.** `MAX_TEMPLATE_BODY_BYTES` + 1 bytes → 400; `MAX_TEMPLATES_PER_USER` + 1 → 400. | Delete either check. Control: the at-limit case must still succeed, or the rail passes for a store that refuses everything. |
| R-9 | **The hub's fan stays derived.** `hub/notebookTemplatesPicker.test.jsx:262` must derive from whatever list the section is handed, and must include a user template when one is present. | Type a roster into `notebookSection.js`. (The file already warns against this at `registry.js:561`.) |
| R-10 | **`POST /api/j2/note-templates` is a new hub-reachable write or it is not — declare it.** `hub/writePaths.test.js`'s manifest and `hub/writePathsTransitive.test.js` (`:434-453`) must be re-run and updated in the same commit. | Ship the route and leave the manifest alone — `writePathsTransitive.test.js:446-453` already reads the catalog looking for exactly this class of change. |
| R-11 | *(only if the programme overrules §2.2 and uses `user_preferences`)* The new key is in `_PREFERENCE_KEYS` (`auth.py:1973`). | Add the client key without the server row; `tests/test_preference_key_validation.py` re-derives the set from `app/src/**` and fails by name. |

### Gap (b)

| # | rail | reddened by |
|---|---|---|
| R-12 | **A bare context still produces a valid doc.** `getTemplate('valuation').build({})` returns a valid TipTap doc and contains none of the data headings. This is `notebookTemplates.test.js:151`'s existing shape applied to the new template. | Render V2 unconditionally with `ctx.fundamentals.pe_forward` — a `TypeError` on `{}`. |
| R-13 | **A paid-only absence degrades to the prompt, not to a number.** Build with `expectedMove: null` and assert the doc still contains the em-dash "Expected move" prompt and contains no `%`. | Render `` `Expected move: ${ctx.expectedMove?.pct ?? 0}%` `` — a fabricated zero. |
| R-14 | **`double_beat: null` renders as an em dash, never "miss".** Fixture with a `null` quarter; assert the rendered text contains neither "miss" nor "Miss" for that row. | Render `q.double_beat ? 'beat' : 'miss'`. (`earnings_intel.py:467` states the invariant: "None (not scored) is NOT a miss".) |
| R-15 | **A null reaction keeps its slot.** Fixture where `events[1].reaction_pct === null`; assert the rendered bullet count equals `events.length` and the pairing of quarter→move is unchanged. | Filter the nulls out before rendering — the off-by-one `earnings_reaction.py:27-29` describes. |
| R-16 | **`needs` gates the fetches.** Spy on `fetch`; `assembleTemplateContext({ticker:'NVDA', needs:{}})` makes **zero** calls; `needs:{fundamentals:true}` makes exactly one, to `/api/fundamentals-full/NVDA`. | Fetch unconditionally. Control: the `needs:{fundamentals:true}` case must assert a non-zero call count, or a broken spy passes both halves. |
| R-17 | **No ticker, no fetch.** `assembleTemplateContext({needs:{fundamentals:true, earnings:true, expectedMove:true}})` with no ticker makes zero calls and returns all three fields `null`. | Drop the ticker guard — the URL becomes `/api/fundamentals-full/` and 404s once per note. |
| R-18 | **Formatted strings are not re-formatted.** Fixture `market_cap: "$1.23T"`; assert the doc contains `$1.23T` exactly and does not contain `$1.23T.00` or `NaN`. | Pass `ctx.fundamentals.market_cap` through a numeric formatter. |
| R-19 | **The endpoints named in this spec still exist, derived from the route table.** A backend test that reads `app.routes` and asserts the four paths are present with the gating this spec claims: `/api/fundamentals-full/{ticker}` and `/api/earnings-intel/{ticker}` ungated, `/api/research/expected-move/{sym}` paid. | Move `/api/earnings-intel` behind `require_paid` — the scaffold silently becomes a paid feature for every free member. Control: assert the route count is non-zero first, or an app that mounted nothing passes by iterating zero times. |

---

## 5. Non-goals

- **N-1 — No third, fourth or fifth gap.** The other two S-07 claims (a research template;
  data-aware prefill) were measured false and are out of scope. Do not "improve" `thesis`
  beyond appending the Financials block in §3.2.
- **N-2 — No template expression language.** A user template stores a rendered TipTap doc.
  No `{{ticker}}`, no conditionals, no loops. The only substitution is in the **title**
  (`ticker`, `dateShort`, `weekOfText`), because `defaultTitle` is already a function
  (`notebookTemplates.js:45` and every sibling).
- **N-3 — No sharing, publishing or importing of templates between members.** One member,
  their own templates.
- **N-4 — No editing of the nine built-ins, and no "duplicate this built-in to edit it".**
  Built-in keys are stable API (`notebookTemplates.js:19-20`) and a member-editable copy of
  a shipped template is a second authority over what "Daily Game Plan" means.
- **N-5 — No new family taxonomy.** Exactly one family is added, `mine`, and it exists
  solely to group the member's own. The four built-in families are untouched.
- **N-6 — No table nodes in the valuation scaffold**, and no removal of
  `containsTableNode`. §1.5 establishes the guard is stale; retiring it is a separate
  decision and this row does not need it.
- **N-7 — No server-side rendering of template bodies.** The context is assembled
  client-side today (`templateContext.js:3-4`) and stays there. Moving it server-side would
  put `/api/fundamentals-full` fan-out on the single shared web pod event loop.
- **N-8 — No valuation *verdict*.** The scaffold prints facts and prompts. It never says
  cheap, expensive, or fairly valued. V7–V9 are the member's.
- **N-9 — No new provider, no new API key, no new paid tier.** Everything in §3.3 is an
  endpoint this app already serves.
- **N-10 — No `template_id` column on `j2_notes`.** §2.5. This is a non-goal, not an
  oversight.

---

## 6. UNKNOWN — what I could not determine

- **U-1 — Should user templates be paid-gated?** I recommend `get_current_user` in §2.3 by
  analogy with `/saved-views`, but `api/routers/user_definitions.py:24-25` records the
  opposite ruling for the other user-authored artifact in this app: `⚠️ EVERYTHING HERE IS PAID (owner ruling). There is no free read: a definition` /
  `list is user content on a premium surface, and a "just the list" exemption is the`.
  Two shipped precedents disagree. **The programme must rule.** This is
  the biggest open question in the spec.
- **U-2 — Which store the programme wants.** §2.2 recommends a table and quotes two prior
  rulings for it, but the preference store is materially cheaper and has two shipped
  Notebook-adjacent precedents. I have stated the trade-off; I have not been given
  authority to spend the two extra days.
- **U-3 — A per-ticker BMO/AMC ("before or after the bell") source.** `earnings-play:274`
  asks for it. `_next_earnings_iso` (`fundamentals.py:52-71`) and
  `summary.next_report_date` (`earnings_intel.py:638`) are both date-only. The calendar
  carries a session/`hour` concept, but I did not locate and quote an endpoint that returns
  it for one ticker, so I am not claiming one. Until someone can quote it, that bullet stays
  a prompt.
- **U-4 — The unit of `debt_to_equity`.** `fundamentals.py:173` passes yfinance's
  `debtToEquity` through `_round`, not `_round_pct`. yfinance has reported this field both
  as a ratio and as a percentage across versions and I did not verify which this install
  returns (verifying would require a live yfinance call, which is out of scope for a spec
  pass). Label it "as reported" or omit it; do not print "×" or "%" on an unverified unit.
- **U-5 — Whether `net_margin_series` is dense enough to be worth a section.** It is `None`
  unless there are ≥6 points (`earnings_intel.py:645`). I have not measured the share of
  tickers that clear that bar, so V4's "direction of net margin" may be blank for a large
  fraction of names. Measure before promising it in copy.
- **U-6 — Real-world latency of the three new fetches.** `TIMEOUT_MS = 2500`
  (`templateContext.js:16`) is per-fetch and the three run in `Promise.all`, so the worst
  case is bounded at ~2.5 s — but a *cold* `/api/fundamentals-full` goes to the bounded
  yfinance pool and a cold `/api/earnings-intel` does a full `_build` (`earnings_intel.py:737`).
  Whether the common case lands inside 2.5 s is a runtime property I cannot read from the
  source, and if it does not, the template silently renders as prompts for a member who
  expected data. **Measure on a cold ticker before shipping**, and consider whether a
  first-render-then-fill pattern is needed.
- **U-7 — Whether any Wave S sibling row already plans to touch `templateContext.js`.** I
  read row S-07 and the two summary rows that mention it. I did not audit every other Wave S
  row for a collision on this file.
- **U-8 — The soft-delete/unique-key interaction** in §2.5(iii) is stated as a choice, not
  a decision, because I could not find a precedent: `j2_note_saved_views` (`db.py:843-856`)
  has `deleted_at` but no unique key at all, so it never had to answer this.

---

## 7. Suggested order of work

1. Fix the four "eight" strings (§1.2) and make R-1 derive the count. One commit, no
   behaviour change, removes the artifact most likely to produce the next wrong count.
2. Gap (b) first. It touches three files (`templateContext.js`, `notebookTemplates.js`,
   `notebookTemplates.test.js`), adds no schema, no routes and no migration, and delivers
   the valuation scaffold — the half of S-07 with a member-visible outcome on day one.
3. Gap (a) after a ruling on U-1 and U-2. It is the larger build and it is blocked on two
   decisions this document is not entitled to make.
