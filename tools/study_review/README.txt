STUDY LIBRARY REVIEW - how to use it
=====================================

WHAT IT IS
A page on your own computer that shows you the Study questions one at a time,
exactly as a member sees them, so you can mark each one Keep, Fix or Cut.
Nothing goes on the internet. Every click is written to a file on your disk
the moment you make it.

EVERY TIME YOU WANT TO REVIEW
1. Double-click "Start Library Review" on your Desktop.
2. A black window opens. LEAVE IT OPEN. It is the program that saves your work.
   After about a minute your browser opens the review page by itself.
   (If it does not, type this into your browser: http://127.0.0.1:8794/ )
3. Review (see below). Stop whenever you like.
4. When you are done: close the browser tab, then close the black window.

HOW TO REVIEW
- Pick a unit on the left (Foundations, Vocabulary, Setups). It lists what it covers.
- You see one question at a time, with the right answer already shown in green.
  Press A (or tick "Show answer") to hide the answer if you want to try it first.
- Decide, then press one key or click one button:
    K = Keep   it is good as it is. It moves to the next question by itself.
    F = Fix    something is wrong. Type what in the box underneath (plain words).
    C = Cut    remove it. Say why in the box if it helps.
  Left and right arrows move between questions without deciding.
- Filters above the question: To review (not yet decided), Fix, Cut, Length tell.
- "Sources" under a question shows the exact quote and web page it rests on.
- Next to the buttons it says "Saved to your disk". That is the proof it is safe.

WHERE YOUR WORK IS
  C:\Users\pgosz\StudyReview\verdicts\verdicts.jsonl
One line per decision. Nothing is ever overwritten: if you change your mind a
new line is added and the newest one counts.
A backup copy is made every time the program starts and after every 50 decisions:
  C:\Users\pgosz\StudyReview\verdicts\backups\
The page also keeps its own copy in the browser while the program is not answering.

WHEN YOU ARE DONE FOR THE DAY
Tell Claude: "review done, read my verdicts". Claude reads the file above, makes
the fixes in the course files, rebuilds the questions and tests them. You do not
need to send the file anywhere.

IF SOMETHING GOES WRONG
- A RED BANNER says "NOT SAVED YET": the black window was closed or crashed.
  Do NOT close the browser tab. Double-click "Start Library Review" again, wait
  for the black window to say it is running, and the page saves your waiting
  picks on its own within a few seconds. The banner disappears.
- Browser says "can't connect": the black window is not running. Double-click
  "Start Library Review" and reload the page.
- Black window says "No free port": another copy is open. Close it and retry.
- Computer restarted or crashed: nothing is lost. Start again; the page opens
  where you stopped.
- You want an extra safety copy right now: click "Download backup" at the top of
  the page. It saves a file with all your decisions to your Downloads folder.
- Anything else: send Claude the file C:\Users\pgosz\StudyReview\server.log
