UCT RS WALKTHROUGH VIDEO - OPERATOR STEPS
=========================================

What this makes: two short screen recordings of the UCT Relative Strength
indicator (one desktop 1920x1080, one phone 390x844), with captions and no
voice-over. They are recorded on the LOCAL SANDBOX only, never on the live site.
Nothing is published by the tool: you watch the videos, approve them, and put
them on the Desk yourself under the usual show rules.

The steps the videos follow, and every caption, live in script.json beside
this file. Change the words there, not in the code.


BEFORE THE FIRST RUN (once)
---------------------------
1. Start the sandbox, from the repo folder, in PowerShell:

       powershell -ExecutionPolicy Bypass -File scripts\hub-sandbox.ps1

   Leave that window open. It prints "URL : http://localhost:8077".

2. Open a SECOND PowerShell window and put the sandbox password in it
   (pick any password the first time; it only lives in the sandbox):

       $env:RS_WALKTHROUGH_PASSWORD = "your-sandbox-password"

   The tool reads the password from there. Never put it on the command line
   or in a file.

3. Fresh sandbox only: the account hubtest@local.dev may not exist yet. Add
   --signup to the first recording command below and the tool creates it.


CHECK THE PLAN (no browser, safe any time)
------------------------------------------
       python tools\rs_walkthrough\capture.py --dry-run

It lists every step and caption and checks script.json. Fix anything it
reports before recording.


RECORD
------
       python tools\rs_walkthrough\capture.py --base http://localhost:8077 --out C:\temp\rs-walkthrough

Optional extras:
   --viewport desktop     record only the desktop video (or: phone)
   --signup               create hubtest@local.dev on a fresh sandbox
   --integrity-log PATH   the stronger sandbox proof: the integrity log path the
                          sandbox window printed at "[pre-boot] integrity log:"

If you leave out --out, the videos go to a new folder in your temp folder
(the last lines of the output say where).


WHAT YOU GET (in the --out folder)
----------------------------------
   rs-walkthrough-desktop.webm            the recording
   rs-walkthrough-desktop.srt             the captions, timed to the recording
   rs-walkthrough-desktop-captioned.mp4   captions burned in (only when ffmpeg
                                          is installed and on the PATH)
   ... and the same three for phone.

Without ffmpeg, play the .webm with the .srt beside it (VLC picks it up), or
upload both to YouTube, which takes the .srt as the caption track.


READING THE OUTPUT
------------------
   [ok]    the step ran and its caption is in the video
   [skip]  an optional step whose screen is not built yet (the tour, the
           Rotation view, the anchor date). Not an error: the video simply
           leaves it out.
   [FAIL]  a required step could not find its button. The video stops there.
           Usually the screen changed: update that step's targets in
           script.json, run --dry-run, and record again.

For the cleanest video, record on a sandbox where UCT RS is NOT already on the
NVDA chart (a fresh -DataDir), so the "add UCT RS" step really adds it.


SAFETY - WHY IT MAY REFUSE
--------------------------
The tool stops with "REFUSED" (exit code 3) and touches nothing when:
   - the address is anything other than http://localhost:<port> or
     http://127.0.0.1:<port> (so never uctintelligence.com);
   - the server is not the hub sandbox started by scripts\hub-sandbox.ps1
     (a plain backend on that port points at the real data folder);
   - the signed-in account is not exactly the one asked for, or is any
     @uctintelligence.internal account (those belong to production);
   - --out is inside the repo or any other git folder;
   - RS_WALKTHROUGH_PASSWORD is not set.
While recording, the browser is also blocked from reaching any website other
than the sandbox (web fonts aside).
