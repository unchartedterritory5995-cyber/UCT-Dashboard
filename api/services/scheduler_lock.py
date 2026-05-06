"""Cross-process advisory lock for APScheduler.

Multiple uvicorn workers in a single container would each start their own
scheduler and double-fire every cron job. This lock ensures exactly one
worker runs the scheduler. The first worker to call acquire_scheduler_lock()
wins; calls from other workers in the same container return False.

Linux/Mac (Railway prod) uses fcntl.flock for atomic, OS-level non-blocking
acquisition. The lock is released automatically when the holding process
exits — fcntl flocks are tied to the FD, and the kernel cleans them up on
process termination, so no atexit hook or signal handler is needed.

Windows (dev only — Railway runs Linux) has no fcntl. The lock degrades to
a no-op that always grants, which is correct because no one runs --workers >1
on Windows.

CRITICAL: the lock FD is held at module scope so it survives until process
exit. Closing it (or releasing the underlying flock) drops the lock. Do not
close from caller code.
"""
import logging
import os

_logger = logging.getLogger(__name__)

_DEFAULT_LOCK_PATH = "/tmp/uct_scheduler.lock"

try:
    import fcntl  # type: ignore[import-not-found]
    _HAS_FCNTL = True
except ImportError:
    _HAS_FCNTL = False

# Module-level state. _lock_fd is the OS file descriptor on Linux/Mac;
# None on Windows where there is no real lock. _granted is the in-process
# "we own the conceptual lock" flag — True on either platform once acquire
# succeeds. Never close _lock_fd from caller code — closing releases the
# OS-level flock.
_lock_fd = None  # type: ignore[var-annotated]
_granted = False


def acquire_scheduler_lock(path: str | None = None) -> bool:
    """Try to acquire the scheduler lock.

    Returns True iff this process now owns the lock. Returns False if
    another process in the same container holds it (i.e. another uvicorn
    worker won the race).

    On Windows always returns True — multi-worker is not used in dev, and
    fcntl is unavailable, so there is nothing meaningful to coordinate.

    Idempotent within a single process: calling twice returns True both
    times. The lock auto-releases on process exit.
    """
    global _lock_fd, _granted
    if _granted:
        return True
    if not _HAS_FCNTL:
        _logger.info("[scheduler-lock] fcntl unavailable — granting (dev mode)")
        _granted = True
        return True
    lock_path = path or _DEFAULT_LOCK_PATH
    fd = None
    try:
        fd = open(lock_path, "w")
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        _lock_fd = fd
        _granted = True
        # Record the owning PID so an operator can correlate the lock
        # holder with logs. Best-effort — failure to write is non-fatal.
        try:
            fd.write(f"{os.getpid()}\n")
            fd.flush()
        except OSError:
            pass
        _logger.info(f"[scheduler-lock] acquired lock at {lock_path} (pid={os.getpid()})")
        return True
    except (IOError, OSError) as e:
        _logger.info(
            f"[scheduler-lock] lock at {lock_path} held by another worker "
            f"(pid={os.getpid()}): {e}"
        )
        if fd is not None:
            try:
                fd.close()
            except Exception:
                pass
        return False


def release_scheduler_lock() -> None:
    """Explicitly release the lock. NOT needed in production — process exit
    releases the flock automatically. Exposed for tests that need to reset
    state between cases."""
    global _lock_fd, _granted
    if _lock_fd is not None:
        if _HAS_FCNTL:
            try:
                fcntl.flock(_lock_fd, fcntl.LOCK_UN)
            except Exception:
                pass
        try:
            _lock_fd.close()
        except Exception:
            pass
        _lock_fd = None
    _granted = False


def is_held() -> bool:
    """True if this process currently holds the lock. Test/diagnostics only."""
    return _granted
