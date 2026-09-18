# R8 — critique pass 6 · W4 MATERIAL, third pass

> **D1 — a depth scale, instead of one blur for five depths.** Against the rebuilt bundle on
> the harness with `--backdrop`, both themes, iPhone profile.
> Frames: `scratchpad/contrast_pass3/`.

---

## The defect, and why it survived three passes

Measured on the shipped bundle:

```
.pad            blur(18px) saturate(160%)
.chip           blur(18px) saturate(160%)
.actionsButton  blur(18px) saturate(160%)
.coachMark      blur(18px) saturate(160%)
.edgeTabGrip    blur(18px) saturate(160%)
```

Five elements at five different distances from the member, wearing **one number**. Nothing in
the material said which sat in front of which, so the glass read as a *filter applied
uniformly* rather than as depth.

⚰️ **The file header is why it lasted.** It said, accurately: *"`blur(18px) saturate(160%)` is
the literal recipe §2a gives in prose — **no `--hub-blur` token exists to reference**."* That
sentence was true, and it was the excuse that kept it true: five surfaces shared a hard-coded
number because no token existed, and no token existed because nobody needed one. **A true
statement can be the thing holding a defect in place.** Corrected in the same commit.

---

## The scale, and how it was assigned

Not by taste — by how far back a surface sits and how much moving data it must suppress,
which is the table `w4-material-plan.md` D1 already specified:

| token | px | surface | why |
|---|---|---|---|
| `--hub-blur-coach` | 10 | `.coachMark` | sits on its **own dimmed ground**, in front of everything — nothing behind it needs suppressing, so heavy blur is cost with no read |
| `--hub-blur-chip` | 12 | `.chip` | a **readout, read while the thumb moves** — the one surface that must stay crisp |
| `--hub-blur-bubble` | 14 | `.bubble` | set in pass 1; the one surface that also **animates** |
| `--hub-blur-surface` | 18 | `.pad`, `.actionsButton` | the instrument's own surface and the no-drag door — the **reference depth** |
| `--hub-blur-sliver` | 24 | `.edgeTabGrip` | a **12×36px sliver** has almost no area to establish itself with, so it needs the most separation per pixel to read as a thing rather than a smudge |

⛔ **Named by ROLE, never by element.** `--hub-blur-pad` would be a second authority on "what
is the pad": the moment two elements shared a depth, the name would lie about one of them.
`--hub-blur-surface` is worn by **both** `.pad` and `.actionsButton` precisely because they
are the same depth — that is the token doing its job, not a shortcut.

⚠️ **Saturation is deliberately not scaled.** It is a colour-rendering choice for the whole
control. Varying it per surface would make the hub's pieces disagree about how saturated the
world behind them is — which reads as an inconsistency, not as depth.

---

## Verified in the artifact, per surface

⛔ Not in source. The F11 lesson is that a change can sound right and do nothing, and only the
built bundle settles it:

```
_pad_            -> --hub-blur-surface   OK
_chip_           -> --hub-blur-chip      OK
_actionsButton_  -> --hub-blur-surface   OK
_coachMark_      -> --hub-blur-coach     OK
_edgeTabGrip_    -> --hub-blur-sliver    OK
literal blur recipes surviving in any declaration: 0
```

⚠️ **Both spellings kept on all six surfaces.** Safari ships only `-webkit-backdrop-filter`,
and this control is mobile-only by construction — dropping the prefix would delete the
material on the exact browser it targets. 12 declarations = 6 surfaces × 2 spellings.

⭐ **An instrument correction, recorded because it nearly became a finding.** The first
per-surface check reported `_chip_ -> none  MISMATCH`. The chip was fine; my regex was not.
Checked directly against the bundle, `._chip_sedb2_230` carries `--hub-blur-chip`, referenced
twice. **A probe that reports a property of itself as a property of the product** — the class
this repo has recorded six times — caught before it was written down as a defect.

---

## Contrast, re-measured

| cell | graded | worst |
|---|---|---|
| dark · un-scrimmed | 3 | **11.48:1** |
| light · un-scrimmed | 3 | **5.95:1** |
| dark · scrimmed | ⛔ 0 — UNMEASURED | — |
| light · scrimmed | ⛔ 0 — UNMEASURED | — |

Unchanged within noise, and expected to be: the bubble's own blur did not move, and the
bubble is the only surface carrying a label that gets graded. The surfaces whose blur changed
carry no graded text.

---

## Where W4 ends

**Three passes, as the ruling required:**

| pass | what it fixed |
|---|---|
| 4 | the bubble becomes the material — rim glass, centre backplate, blur engaged only once settled; contrast measured from sampled pixels with a failing control |
| 5 | F13 (a shadow derived from `--bg` is a GLOW in light theme) and D3 (the specular follows the drag) |
| 6 | D1 (a depth scale instead of one blur for five depths) |

**Still open, and each is filed rather than left implicit:** D-55 (the Actions-button
collision — geometry, not material), D-56 (M1's absolute bar, unmet by the shipped build),
D-57 (disabled labels at 2.26:1 in light), D-58 (the two scrimmed cells, unmeasurable on the
harness AND on production).

⛔ **And the thing none of these passes can answer.** Every number here comes from synthetic
pointer events on an emulated profile over a synthetic backdrop. **R9 stands.** Whether this
control *feels* like one object under a real thumb, on real glass, over live data, is the
owner's tap — and it is the last step of the programme by design, not by omission.
