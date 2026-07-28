# THE DESK — Courses: project handoff

Read this first if you are taking this over. It states where the project
stands, what to do next in order, and what will break if you touch it wrong.
Everything referenced lives in this directory or in the product.

---

## 1. What this is

THE DESK is the members' content hub inside the UCT Intelligence dashboard
(~200 paying members). It has five sections: **Videos · Courses · Articles ·
Posts · Team**. This project rebuilt the first two.

- **Videos** — the 290-video library, organized into 4 chronological *shows*
  and 8 *library topics*, with tag filters and full-transcript search. At the
  bottom sits **Learning Paths**: curated sequences of videos that already
  exist.
- **Courses** — a separate section for *course programs*: structured
  curricula whose lessons are recorded specifically for the course. Two exist,
  both unpublished drafts.

The distinction is the `kind` column on `edu_paths`: `track` renders under
Videos → Learning Paths, `course` renders in the Courses tab.

---

## 2. Current state (as of 2026-07-27)

### Live to members
| Learning Path | Lessons |
|---|---|
| Risk & Sizing: The Money Engine | 18 |
| The Mental Game | 19 |
| Market Reading | 21 |
| Setups Mastery | 35 |
| Options & Flow | 15 |
| Masterclass Interviews | 15 |

The six *previous* paths (`foundations`, `risk`, `reading-market`,
`setups-playbook`, `options-flow`, `mental-game-s1`) are **disabled, not
deleted** — re-enabling them is an instant rollback.

### Draft, admin-only (the Courses tab)
| Course | Lessons | To record | Scripted |
|---|---|---|---|
| **UCT Foundations** | 60 | 19 | 19/19 (110 chapters) |
| **The UCT Method** | 79 | 79 | 79/79 (395 chapters) |

Both carry, **inside the app**: a Presenter's Brief, a 40-term glossary, the
7 printable member handouts, the phased recording order, per-module prep
sheets, and — on every lesson — a five-chapter recording script with speaker
notes, on-screen directions, and a worked chart example.

Members cannot see any of this. The server strips `script` and `dossier` from
`GET /api/education/paths` for anyone who is not an admin.

---

## 3. What to do next, in order

### Step 1 — the owner's two decisions (BLOCKING for ~10 lessons)
1. **The setup-catalog count.** The materials deliberately never state a
   number ("the firm's setup catalog"). The course teaches 26 named setups
   while the methodology doc says 24. Trim two or accept 26 — then the two
   Parabolic lessons either merge or stay.
2. **The regime band thresholds.** Which 0-150 scores separate GREEN / YELLOW
   / ORANGE. Two lessons state these on camera; until decided, the presenter
   reads today's band off the live dashboard instead of naming cutoffs.

Nothing else is blocked. Everything below can start today.

### Step 2 — record Phase 1 (~21 lessons)
See `uct_method_recording_plan.md`. Phase 1 is the set of lessons that serve
**both** courses. When Phase 1 plus the four family flagships are done,
**UCT Foundations is complete and can be published to members** — months
before The UCT Method finishes.

Per session: open the course in the Courses tab, open the lesson, read its
Recording script (5 chapters). The module's prep sheet (dossier section 7)
lists every chart to pull, product surface to open, and card to print.

### Step 3 — publish a recorded lesson
Recording → it posts to the Desk automatically (the Zoom → YouTube → Desk
pipeline handles this). Then: open the course → **Edit** → find the planned
row → type the new video's title in its **Attach video** box → pick it →
**Save**. The slot becomes a real lesson.

### Step 4 — publish a course to members
In the course editor, switch the course from draft to enabled. Do this only
when enough lessons are attached that the syllabus reads as a real course.

---

## 4. What will break if you get it wrong

- **`paths-apply` is FULL-REPLACE by slug.** `POST /api/education/paths-apply`
  deletes and reinserts a course's entire step list. Never re-run an apply
  script against a course someone has edited in the product without first
  dumping current state (`railway ssh --service web`, read `edu_path_steps`)
  and echoing it into the payload.
- **`enabled` and `dossier` are TRI-STATE.** Omit them and the stored value is
  preserved. Send `enabled: true` by accident and you publish a draft course —
  19 "to record" placeholders straight to every member.
- **The admin editor PUTs the whole step list.** Anything not carried through
  the draft is destroyed on Save. `script` is carried deliberately; a test
  pins it. If you add a new per-step field, carry it too.
- **The curriculum converter is one-shot.** `tools/desk_curriculum_to_paths.py`
  refuses to re-run behind a stamp file, because re-running would wipe every
  edit made in the product. Do not `--force` it casually.
- **Never invent market examples.** Every chart example was verified against
  real historical bars: 29 were right, 138 needed corrections, 9 described
  patterns that did not exist in the data. Prices are stated **split-adjusted**
  (NVDA/SMCI/NFLX have each split 10:1 since). Any new example gets the same
  treatment before it ships.
- **Never state a setup count or a fixed dial threshold on camera** until
  step 1 is decided.

---

## 5. Where things live

| What | Where |
|---|---|
| Course sources (the authoring truth) | `docs/curriculum/*.json` — see `README.md` |
| The recording bible | `docs/curriculum/uct_method_scripts.json` |
| Product code — courses | `app/src/pages/desk/CoursesSection.jsx`, `PathView.jsx` |
| Product code — library + learning paths | `app/src/pages/desk/VideosSection.jsx` |
| Backend | `api/services/education_service.py`, `api/routers/education.py` |
| Tests | `tests/test_education_paths*.py`, `app/src/pages/desk/*.test.jsx` |
| Database | `/data/education.db` on the Railway web service |
| Rollback point | `/data/education.pre-taxonomy-20260726.db` |

Shareable read-only copies (for anyone without admin access):
- Recording companion — https://claude.ai/code/artifact/f0ef85dd-833b-400e-a3d0-218f4a66071c
- Member toolkit — https://claude.ai/code/artifact/765a883b-f30f-49d1-8e6f-6eed1a3eed45
- Project summary — https://claude.ai/code/artifact/f6406752-3e12-4a06-a2c0-523fa06f27c8

---

## 6. Known open work (none blocking)

- Two lessons were designed but not added, to stay under an 80-lesson ceiling:
  "A Full Cycle Through the Dial" (M3) and a practical "Trading Business:
  accounts and taxes" (M16).
- Product features worth building once recording is underway: module drip and
  completion badges, persisted drill scores (so the capstone's "choose your
  two" reads real data), a capstone submission flow, and auto-injecting each
  lesson's five chapter markers into its video when it posts.
- UCT Foundations is expected to retire (or become a free fast-track funnel)
  once The UCT Method is fully recorded — an intentional decision, not a bug.
