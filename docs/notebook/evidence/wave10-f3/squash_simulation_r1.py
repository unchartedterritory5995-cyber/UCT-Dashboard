"""F3 fix round 1 (review I-3): does §0 hold on master AFTER L1c is squash-landed, given the L1c tag?

Recipe (objects only; no ref, branch or index is written -- the three commits are unreferenced and
garbage-collectable):
  S  = git commit-tree <L1c tag>^{tree} -p 4bba30b73              # the squash of the tagged head onto master
  S2 = a commit on S that edits docs/notebook/parity-scorecard.md  # a later master commit touching an L1c file
       (built with a temporary GIT_INDEX_FILE: read-tree S, update-index one blob, write-tree)
  S3 = an empty commit on S2
Then evidence_index(head) at S and at S3 must hold, and at master 4bba30b73 (no L1c landing) must refuse.

    python docs/notebook/evidence/wave10-f3/squash_simulation_r1.py S S3
"""
import sys

sys.path.insert(0, 'tools')
import parity_scorecard as P  # noqa: E402

S, S3 = sys.argv[1], sys.argv[2]
for name, h in (('squash S', S), ('later master S3', S3), ('control: master 4bba30b73', '4bba30b73')):
    rows, probs = P.evidence_index(h)
    print(f'{name} ({h[:9]}): {len(probs)} problem(s)')
    for r in rows:
        if r[0].startswith('wave 10 L1c'):
            print('   ', ' | '.join(r))
    for p in probs[:3]:
        print('    PROBLEM:', p)
