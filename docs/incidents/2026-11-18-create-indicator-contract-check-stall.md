# 2026-11-18 — one Create Indicator answer stalled the web pod for about eight minutes

**Impact:** from about 10:36Z to 10:44Z the web pod was slow for every request (answers that take
one second took 10 to 30), and it was then restarted. One test account was locked out of Create
Indicator for the whole time. There were no members yet; the account was the builders' synthetic
one, running a live check. Any member could have caused it, with an ordinary request.

**Cause, in one sentence:** the door checked the assistant's answer against the patch contract in
a way whose cost multiplied by about six for every level of nesting whenever one piece of a formula
was invalid.

## What a person saw

- They asked for an indicator ("Add the Fractal Adaptive Moving Average"). The window said
  "Working…" and never answered.
- Every later request from the same account, for about eight minutes, was answered: "the UCT Agent
  is still working on your previous request". There is one assistant call in flight per member, and
  the stuck turn held it.
- Other pages were sluggish. One request got a 502 while the pod restarted.

## Timeline (UTC, from the pod's own log and the live check's record)

| When | What |
|---|---|
| 10:31 | The pod starts serving a new build. Nothing in that build caused this. |
| 10:36 | Request 2 of a live check: "Add the Fractal Adaptive Moving Average". The assistant answers with a deep formula in which one piece is not allowed by the contract. The door starts checking it. |
| 10:38 | The pod's own health probe starts reporting one worker thread at 92 to 95% of a processor, and the event loop stalling for 4.3 s, then 6.4 s. |
| 10:38 to 10:44 | Thirteen more requests from the same account are each answered "still working on your previous request". They take up to 34 s to come back, for an answer that makes no assistant call. |
| 10:44:40 | The process is restarted (no deployment did it). The stuck turn dies with it. |
| 10:46 | Serving normally. |
| 11:19 | The live check is stopped by hand so that it cannot do it again. |

## The cause

The door validates the assistant's answer against the patch contract with a JSON Schema library.
In the contract a formula node is `oneOf` eight kinds, and six of those kinds hold child nodes.

When a node is VALID, the library stops at the first kind that fits. When a node FAILS, it collects
every kind's errors in full: it descends into the children under each of the six kinds, and does so
again at every enclosing level. One invalid piece at depth *d* costs about 6^*d*.

Measured on a developer machine, one function name that does not exist, at the bottom of a chain:

| depth of the invalid piece | time to check, before | after |
|---|---|---|
| 3 | 0.3 s | 3 ms |
| 4 | 2.0 s | 3 ms |
| 5 | 13 s | 3 ms |
| 6 | 87 s | 3 ms |
| 7 | about 10 minutes | 4 ms |
| 60 | never | 20 ms |

The check holds Python's interpreter lock while it runs, so the whole pod slows down, not one
request. A valid formula never paid this cost at any depth, which is why no test had met it. The
library's named indicators go 12 levels deep, so a deep answer is ordinary; a deep answer with one
wrong piece is all it took.

The defect was older than the work being checked that day. The live check found it because it sent
57 unusual requests in a row.

## The fix, and the mistake made while fixing it

**#1838** made the check linear: the answer is checked with formulas left out, and each formula
node is checked once with its children left out. A formula is valid exactly when every node in it
is, so the verdict is the same as the full contract's.

**#1838 had a defect of its own.** It found formulas by the property names the contract holds one
under (`tree`, `when`). A colour rule also has a `when`, and there it is a plain word. The new
check validated the word "up" as a formula and refused a valid answer. The door's own truth file
caught this on the remote test lane. Two things let it reach master anyway: the fix was pushed
without that file having been run against it locally, and it was merged on the pull request's
checks, which do not run that file. The master gate run for it was cancelled as soon as the lane
result was read, so it was **never promoted and production never served it**.

**#1841** corrected it. There are no property names in the check: every formula root is checked by
the contract as whatever the contract says it is, and only what sits inside a node is checked node
by node. The whole door suite (36 files, 1,489 tests) was run locally before the push.

## What holds it now

- `tests/test_contract_check_is_linear.py`. The linear check says exactly what the full contract
  says, error for error and word for word: on every scripted answer in the repo, on every case in
  the patch engine's shared fixture, on 144 broken formulas, on a colour state's condition, and on
  a colour rule whose `when` is a word, a number, a list or a node. A broken piece 60 levels down
  is found in under two seconds. The incident itself is a test: a deep bad answer, twice; the
  member is refused at once and their next request is not "still working".
- Two guards were added afterwards for the things nothing bounded
  (`tests/test_turn_guards.py`):
  - **The size of an answer.** An answer whose formula holds more than 300 nodes or nests more
    than 48 levels is refused by name before anything examines it. The largest formula anywhere in
    the library, the evaluation set and the live answers on file is 70 nodes and 12 levels.
  - **The length of a turn.** A turn has a wall-clock ceiling of 90 seconds. When it passes, the
    member reads "That took too long on our side and nothing was changed. Try again.", their slot
    is freed, and the turn is counted as an internal error in the weekly report. Of 314 live turns
    that called the assistant, the slowest took 31.5 seconds.
- The browser's own reader of the contract was timed on the same inputs. It is not exposed: it
  treats a formula as opaque (under 1 ms at any depth) and the browser's engine refuses the bad
  piece in under 1 ms at any depth.

## Confirmed on the live pod

At 12:39Z, on the pod serving `d009487b15` (#1841), with the builders' test account, through the
product's own route. Nothing was saved.

| step | result |
|---|---|
| A request carrying a patch 7 levels deep with one invalid piece at the bottom | answered in 5.0 s (about ten minutes before the fix) |
| The same account's next request, sent straight after | answered in 0.06 s with the door's own question; not "still working" |
| A valid colour rule ("colour it green while it rises") | built in 4.5 s, and the patch holds a colour rule |

The first step is the incident's own trigger, sent on purpose. The script that sends it refuses to
run unless the pod reports a commit that contains the fix.

## What was found while looking

Listing every test file that touches the door against what the remote lanes had run showed that
30 of 67 were in no list. Running them found one test that had been failing on master since the
morning: it guards the chart lexicon, the named-indicator library had changed the rule it checks on
purpose, and nothing ran the file. The door's lanes now run one generated list, so a new test file
joins by itself.

## What we learned

- **A check that is fast on every valid input can still be unbounded on an invalid one.** Tests
  feed validators valid things and shallow invalid things. The cost that mattered was on a deep
  invalid thing.
- **One slot per member needs a time limit of its own.** Without it, anything that makes a turn
  slow becomes a lockout.
- **A fix to the door is run against the door's own truth file before it is pushed**, and a pull
  request is merged on its remote lane AND its checks, never on the checks alone. The checks do not
  run every file the lane runs.
- **Do not find things by their name when the contract can tell you what they are.** Two
  properties shared the name `when`.
