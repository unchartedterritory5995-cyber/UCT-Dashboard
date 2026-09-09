# Wave N — Evidence Completion: branch closure

**Branch:** `notebook-primary-platform` · **not merged** (§22 holds the whole
vertical slice together) · **awaiting merge/deploy approval.**

Wave N's premise: a captured passage was **API-CAPABLE and MEMBER-UNREACHABLE**.
Step 1 made it an attachable candidate. §3 was explicit that a candidate row
appearing proves discoverability and nothing else, so the rest of the wave had
to earn the whole chain — and it found seven live defects doing it.

---

## §21 — the closure standard, answered

| a member can… | evidence |
|---|---|
| CAPTURE external research | capture dialog, real UI, 390px and desktop |
| FIND it as an evidence candidate | picker lists it, and now **searches** it |
| UNDERSTAND source vs their annotation | two fields at capture, picker, thesis, revisit, export, and in the Ask answer |
| ATTACH it to a thesis | real click, real 200 |
| CLASSIFY supporting/opposing | stance on the edge, one live edge per (thesis, target) |
| SEE it in the thesis | `OPPOSES · cuts against the long case — Captured passage · Reuters: NVDA margins (reuters.com)` |
| REVISIT it | the captured-source view: passage, member note, domain, publisher link |
| ASK without double-counting | ONE source cited, one lineage |
| survive duplicate / lifecycle / export | §4, §10, §11 — all railed |
| use it on touch | every control ≥44px, hit-tested, announced |
| **and the real-document path stays correct** | §8: a genuine 47-page PDF, uploaded, excerpted at p.47, attached, and revisited in the viewer |

**MEMBER-REACHABLE, END-TO-END CERTIFIED.**

---

## What the wave actually found

Seven defects, every one of them live, and every one invisible to a green unit
test:

1. **The export called a web capture "p.2"** — in the one artefact that leaves
   UCT and lands in the member's permanent archive.
2. **The thesis row called it "Document excerpt"** — a fourth citation formatter
   that fell through to a literal string for a capture.
3. **Ask told the model and the member "· p.1, document_complete"** — Wave L
   wrote the right branch and no query selected the column it read, so it was
   unreachable from every real query in every scope.
4. **`add_evidence` had no duplicate guard** — the picker disabled the row, the
   API accepted a second edge, and a thesis could count one passage twice.
5. **Revisiting a capture opened a fullscreen PDF viewer over `web:<sha256>`** —
   with "Open in new tab" and "Download" of something that is not a document.
6. **A purged source left ghost evidence** — the row rendered its caption as
   though nothing had happened and clicking it 404'd in silence, while `db.py`
   had specified the degrade years earlier.
7. **The entire evidence flow was under the 44px touch tier**, attaching was
   announced to nobody, and focus was dropped on close.

Plus one the wave inherited and fixed on the way past: **Wave M's unconditional
`source_kind` select left 28 Ask tests red on this branch.**

⛔ **The single lesson.** Every one of 1, 2, 3, 5 and 6 is the same shape:
*a new object class became eligible for an existing relationship, and a consumer
kept interpreting the relationship's TYPE as the object's SEMANTICS.*
`document_excerpt` is the relational namespace. `source_kind` / `capture_type`
is the source. §18's consumer-audit rule is not a checklist item — it is the
whole wave.

---

## Rails and mutations

**Backend, Wave N suites:** 644 passed, 0 failed.
`test_evidence_capture_kind` (20) · `test_evidence_candidates` (16) ·
`test_evidence_ask_lineage` (5) · `test_evidence_export_source_truth` (13) ·
`test_evidence_duplicate_and_stance` (11) · `test_evidence_lifecycle` (18) ·
`test_sandbox_pruning` (8) — plus the Ask, capture, router and export suites
they sit beside.

**Frontend:** `src/pages/journal-2-0` — 210 files, 2,144 tests, 0 failed
(`--maxWorkers=4`, the proven resource-aware shape).

**In-package:** `api/services/journal_two` — 2,354 passed, 1 inherited red
(below).

**Mutations — every one RED as required, byte-identical restore:**

| # | mutation | expected red |
|---|---|---|
| 1 | `capture_columns` always projects nothing | `test_note_scope` |
| 2 | the corpus row projection drops the capture kind | `test_corpus_scope` |
| 3 | the schema check is skipped (Wave M's unconditional select) | `test_a_healthy_anchor_earns_an_exact_citation` |
| 4 | `is_web_capture` ignores `capture_type` | `test_capture_type_alone_answers` |
| 5 | `is_web_capture` ignores `source_kind` | `test_source_kind_alone_answers` |
| 6 | `coverage_for_row` loses its web floor | `test_a_source_kind_only_web_row_does_not_claim_completeness` |
| 7 | `passage_label` loses its web branch | `test_note_scope` |
| 8 | the excerpt API forgets the kind | `test_a_web_capture_reports_its_kind_and_canonical_url` |
| 9 | the duplicate guard looks at removed edges | `test_and_the_SERVER_refuses_the_same_mutation` |
| 10 | the duplicate guard widens past one thesis | `test_the_same_passage_on_a_DIFFERENT_thesis` |
| 11 | `targetAvailable` always true | `test_a_PURGED_target_reports_unavailable` |
| 12 | the export front matter drops `passage` | `test_the_front_matter_actually_writes_them` |
| 13 | the export drops the member's annotation | `test_the_member_note_travels_SEPARATELY` |
| 14 | the export hardcodes complete coverage | `test_coverage_says_we_hold_one_passage` |
| 15 | the picker's search affordance is removed | `a FULL page says so` |
| 16 | the attach announcement is emptied | `announces the attach politely` |
| 17 | the sandbox pruner ignores the TTL | `test_it_leaves_a_RECENT_one_alone` |
| 18 | the sandbox pruner never removes | `test_it_removes_a_sandbox_older_than_the_ttl` |
| 19 | the touch tier is disabled | the mobile audit's 44px findings |

⚠️ **Mutation 19's harness re-run after restore was flaky** (two rebuilds and
two browser runs inside one mutation cycle). The mutation itself went RED as
required, and the restored tree was verified green by a separate run of the
same command. Recorded rather than smoothed over.

---

## Instruments that were wrong before they were right

⛔ **Four measurement failures in one wave**, each of which would have produced
a confident false finding. They are commented where they happened, because the
next harness will make the same mistakes.

1. **`localhost` cost 2,050ms per request.** The first performance run reported
   ~2050ms for a capture, a picker open, a search returning **zero rows**, and a
   write — all within 30ms of each other. An operation that returns nothing
   cannot cost what one returning fifty rows costs: **an invariant measurement
   is a broken instrument.** `/api/health` measured 2040ms via `localhost` and
   1.8ms via `127.0.0.1`. The harness now calibrates on `/api/health` every run
   and refuses to publish product numbers when that floor is large.
2. **`elementFromPoint` off-screen returns null**, which the mobile probe read
   as "occluded". An instrument that cannot tell *off-screen* from *covered*
   reports the more alarming of the two.
3. **A full-page screenshot scrolls the page under mobile emulation**, so
   `getBoundingClientRect` and `elementFromPoint` stopped agreeing and the probe
   accused the caption field and the attach button of being covered by a `DIV`
   that was underneath them. The scroll now happens inside the same JS turn as
   the two reads.
4. **The 9.3s cinematic intro really was covering the app** at 800ms after load.
   True, and about the intro, not the picker. A hit test is only as honest as
   the state it runs in.

Plus two in the E2E: a case-sensitive probe against a CSS-uppercased stance
pill, and `[role="dialog"].first` addressing whichever dialog the DOM happened
to put first.

---

## ⚠️ The machine was out of disk

Not a product defect, but it cost this wave an hour and it will cost the next
one the same. **Every pytest session mints two sandbox directories under TEMP
and nothing ever removed them**, while the product WARMS them — bars caches,
ticker metadata, ~20 SQLite databases, roughly 200 MB a session. Measured
2026-09-08: **5,209 directories, 13.14 GB, system drive at ZERO bytes free.**

It did not present as a full disk. It presented as `notes_quota` refusing every
attachment upload with HTTP 400 — **twelve red tests that read exactly like a
defect in the attachment path.**

Fixed in-repo: `conftest` prunes its own stale sandboxes (24h TTL, so a
concurrent session is never touched) and pins `NOTE_IMPORT_RESERVE_BYTES` — the
quota guard's own documented override — because the reserve is derived as a
percentage of the VOLUME, sized for Railway's 78 GB attachment volume, and
under pytest the attachment root sits on a 499 GB system drive. Production sets
nothing and resolves byte-identically. `tests/test_sandbox_pruning.py` rails
both halves, including the control that the real derivation still answers when
the override is removed.

⚠️ **The owner should know the drive is still tight** — 13.5 GB free of 499 GB
after this reclaim, and nothing in this repo is responsible for the rest.

---

## Residuals — stated, not smoothed

1. 🔴 **Inherited red, proven pre-existing:**
   `api/services/journal_two/test_obsidian_parity_fixtures.py::test_regeneration_is_byte_identical_to_the_committed_fixtures`.
   Seven committed Obsidian parity fixtures are stale relative to the current
   provider pre-pass. **Proof it is not Wave N's:** no commit in this wave
   touches `note_connectors/`, the fixtures, or that test, and the failure
   reproduces byte-identically with `conftest.py` restored to its pre-Wave-N
   version. The test names its own fix
   (`python -m api.services.journal_two.note_connectors.convert.obsidian_parity_fixtures_gen`);
   left alone per the standing "do not fix unrelated Notebook reds" instruction.
2. **Ask's coverage line did not render** in the flagship run
   (`ask-coverage` empty). Not a claim this wave made and not asserted — noted
   because it is the surface that tells a member the corpus boundary, and it is
   worth a look in a later wave.
3. **The per-item `coverage` value still has no downstream consumer.** It is
   now correct everywhere (`selected_passage_only` for a capture) and nothing
   reads it but the export. Declared plumbing awaiting a consumer — say so
   rather than counting it as a shipped feature.
4. **Stance change is remove-then-add**, not an in-place update. Two clicks and
   two changelog events. Defensible and now pinned (§5 asked for the existing
   behaviour, not a new one) — but if members change their minds often, an
   in-place stance toggle is the obvious follow-up.
5. **The picker's cap line says "showing your 50 most recent"** rather than
   "50 of 137". The endpoint does not return a total and inventing one would be
   worse; a `total` field is a small, honest follow-up.
6. **§16 rows about competitors' AI source-counting say NOT ASSESSED** and must
   keep saying it until somebody measures them.

---

## G-080 and the standing gates — untouched

- `J2_SHARE_LINKS_ENABLED=0`. **Nothing in this wave touches note sharing**,
  public share links, or their authorization. Inbound capture is not outbound
  sharing.
- **No semantic/embedding work.** No external embedding call, no ZDR gate
  change, no semantic env flag.
- **No cross-tenant anything.** Every new query is tenant-scoped inside the SQL,
  and the duplicate guard deliberately runs AFTER the ownership check so it can
  never become an existence oracle for another member's evidence
  (`test_another_members_thesis_is_unaffected`).
- **No raw private note content in logs.** Nothing added logs a passage.
- **Account deletion clears evidence, excerpts, documents and notes**
  (`TestAccountPurge`).
- **No real member research was touched.** Everything ran against the
  fail-closed sandbox. ⚠️ One exception, found and repaired: an early ad-hoc
  probe ran `python` OUTSIDE pytest and therefore outside the conftest
  redirect, writing one note, one document and one excerpt into the live
  `C:\data\auth.db` under user `u-probe`. Those rows were deleted the same
  minute and the tables verified empty. **The repo's tripwire only guards
  pytest — a bare `python` run reaches the live files**, exactly as CLAUDE.md
  warns. Every probe after that ran `import conftest` first.

---

## Artefacts

- `tools/wave_n_e2e.py` — the 14-step journey + §4 + §8, real UI, screenshots
- `tools/wave_n_perf.py` — §12/§15, calibrated, 240-capture corpus
- `tools/wave_n_mobile_a11y.py` — §13/§14, 390×844 coarse pointer, hit-tested
- `docs/notebook/wave-n-target-type-audit.md` — §1 + §6 + §17
- `docs/notebook/wave-n-differentiation.md` — §16, evidence-tiered

---

## What is being asked for

**Merge and deploy approval for the whole Wave N slice** (commits `cd78148ab`
through `8b3ae8753` on `notebook-primary-platform`).

⛔ **Wave O is NOT started and will not be** (§23).
