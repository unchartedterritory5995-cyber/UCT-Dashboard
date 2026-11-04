# Provenance review list: rows matching a looser definitional cue (review #751, note 2)

For the provenance / rights review (owner decision 2026-11-03, points 2-3). **Counts and kb_ids only; no content.**

- Snapshot: the real Brain Pack snapshot used for the #751 counts (2,837 servable non-dated rows before the refinement;
  71 withheld by the reviewed cue; 309 served and flagged `commentary_only`).
- Provenance review (2026-11-04, counts only): all 122 come from one admitted source (`trader_archive`, team-owned
  under the source policy), 5 distinct traders, no blank trader; categories MACRO 43 (dated), SETUP 60, RULE 17,
  PSYCHOLOGY 2. Rights clearance: 0 of the 122 have a `cleared_rows` entry, so none is verified as UCT's own wording
  rather than a restatement of a third-party (excluded) setup definition.
- Decision (owner directive relayed by AUDIT, 2026-11-04): uncertain entries are WITHHELD, never admitted on a
  commentary label. The index's definitional cue is now this looser cue (an excluded template name/alias, then within
  80 characters, crossing sentence ends, one of is|are|means|defined|definition|rule(s)|entry|stop|criteria|trigger|
  pivot|buy point|setup), so all 122 are withheld together with the original 71 (index SCHEMA 4).
- A row returns only through a complete, well-formed `cleared_rows` entry (provenance_ref, rights_review_ref,
  approved_by, approved_on, kb_id). Real snapshot after the change: 122/122 withheld, 71/71 still withheld, 0 rows
  matching either cue served; non-dated: 150 withheld by the mention rule, 230 served flagged as commentary.

- 2026-11-04 later (delta review): every row that NAMES an excluded setup is now withheld by default
  (policy `excluded_setup_mentions.mode = "withhold"`), so these 122 stay withheld whatever the cue. A clearance must
  also carry the reviewed text's `content_sha`.

kb_ids (122):

10761, 10810, 10840, 10877, 10881, 10925, 10943, 10944, 10998, 11028, 11034, 11040, 11048, 11091, 11095,
11171, 11182, 11223, 11232, 11267, 11289, 11317, 11381, 11390, 11408, 11428, 11442, 11681, 11724, 11770,
11800, 11837, 11901, 11917, 11988, 12013, 12095, 12109, 12152, 12159, 12228, 12262, 12290, 12327, 12337,
12355, 12385, 12397, 12440, 12473, 12477, 12484, 12520, 12535, 12545, 12584, 12620, 12621, 12663, 12751,
12756, 12762, 12874, 12958, 13037, 13042, 13120, 13281, 13285, 13287, 13378, 13408, 13514, 13526, 13558,
13567, 13574, 13586, 13692, 13716, 13724, 13729, 13730, 13731, 13926, 14069, 14162, 14353, 14571, 14592,
14612, 14619, 14639, 14861, 15162, 15217, 15234, 15267, 15416, 15453, 15459, 15483, 15488, 15489, 15577,
15580, 15604, 15630, 15641, 15646, 15656, 15659, 15662, 15668, 15672, 15690, 15709, 15726, 15772, 15794,
15801, 15844
