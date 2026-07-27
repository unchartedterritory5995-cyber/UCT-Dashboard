# UCT Curriculum — source of truth

The course program behind THE DESK → **Courses**. These files are the
authored source; the product database (`edu_paths` / `edu_path_steps`) holds
only what members see, and the published artifacts are rendered views of what
is here. Kept in git because this is months of authoring work that otherwise
lived on one machine inside a gitignored scratch directory.

| File | What it is |
|---|---|
| `uct_method_course.json` | **The UCT Method** outline — 16 modules / 79 lessons, each with its teaching note and target minutes. The syllabus applied to prod as a draft course. |
| `uct_method_chapters.json` | The 5 chapter markers per lesson (395 total) — these become each video's real chapter markers when it posts. |
| `uct_method_scripts.json` | **The recording bible.** Per chapter: `marker`, `beat`, `speaker_notes` (~56k words total), `on_screen`, `example_spec`, and `spec_verdict`. |
| `uct_method_toolkit.json` | The 7 printable member artifacts (LOOP card, Monday exposure plan, R-ledger, placement diagnostic, five-field card, sizing gate + answer key, playbook template + defense rubric). |
| `uct_method_presenter_brief.json` | Onboarding for a presenter who did not design the course: the system on one page, product-surface map, production conventions, pre-flight checklist, 40-term glossary. |
| `uct_method_recording_plan.md` | Phased recording order. Phase 1 = the ~21 dual-use spine lessons, which also complete UCT Foundations. |
| `curriculum_final_v2.json` | **UCT Foundations** — the 60-lesson hybrid course (41 library videos + 19 gap recordings) and the six topic tracks. |
| `curriculum_dossier.md` | The pedagogy research + firm methodology the curriculum was built from. **Its CORRECTIONS appendix at the bottom overrides earlier lines** (MA stack is 9/20/50/200; the marble drill is a 6+ streak; EPs trail the 10/20-day; the Module 5 sizing gate's 100% bar is a deliberate exception).|

## Rules for editing

- **Record-once contract.** ~21 UCT Method lessons double as UCT Foundations gap
  recordings; those slots are tagged `RECORD ONCE —` in the product. Record the
  Method version and reuse the video (or a `start_seconds` clip) in Foundations.
  Never record the same lesson twice.
- **Two owner decisions are open**: the setup-catalog count and the 0-150
  regime band thresholds. Materials deliberately state neither — do not add a
  setup count or fixed dial cutoffs anywhere.
- **`uct_method_chapters.json` embeds copies of each lesson `note`.** After
  editing notes in `uct_method_course.json`, re-sync them.
- **Chart examples are data-verified** against real historical bars and stated
  **split-adjusted** (NVDA/SMCI/NFLX all split 10:1 since). `spec_verdict`
  records what happened per example: `verified` (29), `corrected` (138),
  `replaced` (9 — the claimed pattern did not exist in the data),
  `no_data_needed` (5). Any NEW example must be checked against real bars
  before it ships; see the `lesson_llm_market_examples_need_data_grounding`
  note in user memory for why.
- Applying to production goes through `POST /api/education/paths-apply`. That
  rail is **full-replace by slug** and its `enabled` field is **tri-state** —
  omit it to preserve a course's published/draft state.
