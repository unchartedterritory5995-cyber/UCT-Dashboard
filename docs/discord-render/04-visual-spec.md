# 04 — Visual spec: what a member SEES when the path is not at house quality

Inputs: `03-architecture.md` (the mechanism), `01-failure-forensics.md` (what actually broke).
This file owns the **member-facing surface** of degradation — the badge, the footer, the stand-in —
and nothing else. Where a number appears here it is a pointer to the constant that owns it.

⛔⛔ **THE RULE THE WHOLE FILE EXISTS FOR: A DEGRADED ARTIFACT ALWAYS CARRIES ITS LABEL (S8).**
C-06 measured **3 unlabelled stand-ins**, 2 of which never healed — a member was handed a
lower-quality chart and told nothing, so they read it as the product. An unlabelled stand-in is
worse than a failure message: a failure is honest and a silent substitution is not.

⛔⛔ **AND THE BADGE MUST BE RARE, OR IT IS FURNITURE.** The opposite failure is just as real: the
first freshness design used a fixed age budget, which would have drawn a STALE badge on every chart
all weekend (§3.8b). A badge that shows when nothing is wrong teaches everyone to ignore it, and
then it is not there on the day it matters. **Every rule below has to answer "how often does this
appear when the system is healthy?" and the answer has to be "almost never".**

---

## 1. The three things that can be off, and they are independent

| | What it means | Where it comes from | Member sees |
|---|---|---|---|
| **Vintage** | the DATA is behind the session it should be at | `freshness.Envelope.stale` (§3.8b) | the STALE badge + `as_of` in the footer |
| **Quality** | the picture is not the house render | the renderer adapter failed; a stand-in was drawn | the stand-in label |
| **Provenance** | the answer did not come from the usual source | `Result.provider` / `degraded_reasons` (`cached`, `in_process`) | a footer clause |

⛔ **They do not collapse into one "degraded" flag.** A fresh stand-in and a stale house chart are
different products with different remedies, and a member acting on one is not making the same
mistake as a member acting on the other. The old path had a single "something went wrong" and it is
why C-08 and C-06 both took two weeks to name.

## 2. The STALE badge

- **Drawn when** `Result.stale is True` — never on `None`. ⛔ **Unknown vintage draws NOTHING.** An
  absent badge means "we have nothing to tell you"; a badge saying "fresh" that nobody measured is
  the failure this rule exists to prevent, and `stale=None` is deliberately not `False` (§3.8b).
- **Text:** `Envelope.badge` — `⚠ data as of {as_of_et} ET (stale)`. One owner; the message content,
  the house page (`?stale=`) and the stand-in all read that, never a second copy of the sentence.
- **Never on a closed market unless the session is genuinely missed.** The session rule, not an age.

## 3. The stand-in

- Drawn only when the renderer adapter returns a failure (`renderer_unavailable`, `deadline`).
- **Always labelled**, in the message content, not only in the image — an image label is invisible
  to a screen reader and to anyone who has images off.
- The label names the *class*, not the exception: `contract.FAILURE_CLASSES` is the one table.

## 4. The footer

One line, and it only appears when it has something to say. Order: vintage · provenance · id.

    {as_of_et} ET · {provenance clause, only when not the usual source} · id {corr_id}

- **Vintage, never the wall clock** (§3.10) — the same closed-market input must render the same
  pixels, which it cannot do if the footer carries "now".
- **`id {corr_id}` is always present on a degraded or failed delivery** and is what a member quotes;
  it is the join to the durable jobs row.

## 5. Status

🚧 **Skeleton, written 2026-09-13 with P2.1 so the copy has one home before there are three.**
The rules above are settled (they are the direct consequences of §3.8b, S8 and C-06). What is NOT
yet written here, and is P2.6's: the exact stand-in copy per class, the `/flow` degraded card, and
the goldens that pin them. ⛔ Do not add a fourth place that decides what a member reads — if a new
surface needs a sentence, it comes from `contract.FAILURE_CLASSES` or `Envelope.badge`.
