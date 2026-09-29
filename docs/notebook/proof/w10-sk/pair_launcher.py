"""Lane SK matched-pair launcher (fix round 1, item I1).

Both boots of the pair run THIS file, which then runs the real
scripts/hub_sandbox_boot.py unchanged. The only difference between them is
W10SK_MODE:

  control  -- appends --allow-model-keys: the operator's (sentinel) keys pass
              through, so the warm reaches the Anthropic call sites. This is the
              POSITIVE CONTROL: it must print MODEL-HOST lines, or the instrument
              cannot see a model call and a zero in the blanked boot means nothing.
  blanked  -- no opt-in: the launcher's policy blanks the keys.

In BOTH modes the getaddrinfo hook COUNTS every anthropic/openai/perplexity
lookup and then RAISES socket.gaierror, so nothing leaves this box and nothing
can be billed -- the sentinel is never sent anywhere. A CONTROL line at start
proves the hook prints.
"""
import os
import runpy
import socket
import sys

REAL = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                     "..", "..", "..", "..", "scripts", "hub_sandbox_boot.py"))
WATCH = ("anthropic", "openai", "perplexity")
SENTINEL = "sk-w10sk-sentinel-not-a-real-key"
KEYS = ("ANTHROPIC_API_KEY", "WISDOM_ANTHROPIC_API_KEY", "OPENAI_API_KEY",
        "PERPLEXITY_API_KEY", "ANTHROPIC_AUTH_TOKEN")
MODE = os.environ.get("W10SK_MODE", "")
if MODE not in ("control", "blanked"):
    raise SystemExit(f"W10SK_MODE must be control or blanked, got {MODE!r}")

_real_getaddrinfo = socket.getaddrinfo
_count = [0]


def _watched_getaddrinfo(host, *args, **kwargs):
    h = host.decode() if isinstance(host, bytes) else str(host)
    if any(w in h.lower() for w in WATCH):
        _count[0] += 1
        print(f"[w10sk-net] MODEL-HOST getaddrinfo {h} (#{_count[0]}, refused locally)",
              flush=True)
        raise socket.gaierror(socket.EAI_NONAME, f"w10sk: model host {h} refused locally")
    return _real_getaddrinfo(host, *args, **kwargs)


socket.getaddrinfo = _watched_getaddrinfo

try:
    socket.getaddrinfo("control.anthropic.invalid", 443)
except OSError:
    pass
print("[w10sk-net] CONTROL above: the hook printed for a watched name (expected exactly 1)",
      flush=True)

for k in KEYS:
    os.environ[k] = SENTINEL
print(f"[w10sk] mode={MODE}; operator env simulated: {len(KEYS)} model credentials "
      "set to a sentinel", flush=True)

sys.argv[0] = REAL
if MODE == "control":
    sys.argv.append("--allow-model-keys")
runpy.run_path(REAL, run_name="__main__")
