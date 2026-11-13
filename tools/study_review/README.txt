STUDY LIBRARY REVIEW
====================

TO REVIEW
1. Double-click "Start Library Review" on your Desktop.
2. A black window opens. Leave it open. After about a minute your browser opens.
   (If it does not: type  http://127.0.0.1:8794/  into the browser.)
3. You see ONE question at a time, with the right answer already marked in green.
   Press one of three buttons:
        Good as is     (or press Enter)    it is fine. Goes to the next one.
        Change it      (or press C)        something is wrong. Type what, in plain words.
        Remove it      (or press X)        it should go. Say why if you like.
   Back and Skip are small links under the buttons.
4. Part 1 is the 100 questions Claude changed on its own (it fixed answers that gave
   themselves away by length, and reworded near-copies). Each shows what Claude
   changed. Read the new version and press Good as is, or Change it / Remove it.
   11 near-copies were cut; the list is in the repo: docs/study/library/FIRST_PASS_FIXES_2026-11-11.md
   Part 2 is every question in order. It picks up where you stopped.
5. Stop whenever you like: close the browser tab, then the black window.
   Next time it opens at the first question you have not decided.

THE MENU (top right)
   Jump to a unit, switch between Part 1 and Part 2, see "My changes and removals",
   download an extra backup copy.

WHERE YOUR WORK IS
   C:\Users\pgosz\StudyReview\verdicts\verdicts.jsonl     (saved the moment you click)
   C:\Users\pgosz\StudyReview\verdicts\backups\           (automatic copies)
The top right of the page says "Saved ✓" after every decision.

WHEN YOU ARE DONE
   Tell Claude: "review done". Claude reads your file and makes the changes.

IF SOMETHING GOES WRONG
   RED BANNER "NOT SAVED YET": the black window was closed. Keep the browser tab
   open, double-click Start Library Review again. The waiting decisions save
   themselves and the banner goes away.
   "Can't connect": the black window is not running. Double-click Start Library Review.
   Anything else: send Claude  C:\Users\pgosz\StudyReview\server.log
