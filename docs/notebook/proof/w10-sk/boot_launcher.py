"""Lane SK proof launcher: simulate an operator shell that HOLDS model keys, count every
model-provider host this process tries to resolve, then run the real sandbox launcher
unchanged.

Why a sentinel and not the real key: the proof is that the launcher blanks what the operator
environment carries. A sentinel stands in for that value; if the blanking failed, the app
would try to reach the provider with it (a counted attempt, and a 401 at worst, never a
billed call). The real key is never read or needed.

Why getaddrinfo: every SDK request (anthropic, openai, httpx to perplexity) resolves its host
through socket.getaddrinfo first, so a hook there counts ATTEMPTS at the network layer
instead of trusting the app's own log lines. A CONTROL line proves the hook prints.
"""
import os
import runpy
import socket
import sys

REAL = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                    "..", "..", "..", "..", "scripts", "hub_sandbox_boot.py")
REAL = os.path.normpath(REAL)
WATCH = ("anthropic", "openai", "perplexity")
SENTINEL = "sk-w10sk-sentinel-not-a-real-key"
KEYS = ("ANTHROPIC_API_KEY", "WISDOM_ANTHROPIC_API_KEY", "OPENAI_API_KEY", "PERPLEXITY_API_KEY")

_real_getaddrinfo = socket.getaddrinfo


def _watched_getaddrinfo(host, *args, **kwargs):
    h = host.decode() if isinstance(host, bytes) else str(host)
    if any(w in h.lower() for w in WATCH):
        print(f"[w10sk-net] MODEL-HOST getaddrinfo {h}", flush=True)
    return _real_getaddrinfo(host, *args, **kwargs)


socket.getaddrinfo = _watched_getaddrinfo

# CONTROL: the hook must be able to print. `.invalid` never resolves (RFC 2606), so this
# reaches no provider; it only proves a watched name is seen.
try:
    socket.getaddrinfo("control.anthropic.invalid", 443)
except OSError:
    pass
print("[w10sk-net] CONTROL above: the hook printed for a watched name (expected exactly 1)",
      flush=True)

for k in KEYS:
    os.environ[k] = SENTINEL
print(f"[w10sk] operator env simulated: {len(KEYS)} model keys set to a sentinel", flush=True)

sys.argv[0] = REAL
runpy.run_path(REAL, run_name="__main__")
