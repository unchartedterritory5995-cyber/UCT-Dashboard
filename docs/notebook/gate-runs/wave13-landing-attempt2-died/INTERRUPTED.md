# Wave-13 landing gate, attempt 2 -- DIED (not a verdict)

Tree 6b22f441f9, `--shards 6 --max-workers 2`, started 11:31 CT in a PowerShell window launched
from the controller's session. Shards 1-2 completed (logs here). At ~11:48 the whole window ended:
its transcript stops with no GATE EXIT line, so the process tree was killed, not the gate failing
(box memory had fallen to ~224 MB earlier). Windows launched from a Claude Code session appear
to share its low-memory reap. Next attempt is started by the owner from his own terminal.
