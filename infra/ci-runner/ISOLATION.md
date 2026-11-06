# Runner isolation: threat model and proofs

Results below are from a real container on the owner's PC (WSL2 distro `uct-ci`, Docker Engine 29.9.3), through
`launcher.py`'s own flags. No runner was registered, so nothing here proves behaviour with GitHub in the loop.

## What each machine may do

| | Owner's PC | VPS (labels `uct-vps-gate`, `uct-vps`) |
|---|---|---|
| Machine | Shared with Claude sessions and owner `gh` credentials | Separate x64 machine (not bought yet) |
| May decide a merge | **Never** | Only as the Actions job's own conclusion at the exact SHA |
| Runs | Local advisory runs through `launcher.py local`. Registers no runner, holds no token, reports nothing to GitHub | `uct-vps-gate`: gate heavy jobs only. `uct-vps`: dispatch and nightly |

The launcher enforces part of this: `serve` refuses WSL, non-x86_64, and a host holding `~/.config/gh`,
`~/.claude`, `~/.git-credentials` or an SSH private key.

## Threats

| Threat | Control | Proof | Result |
|---|---|---|---|
| Job reads the host's files | No `-v`/`--mount`; distro has automount off | Probe: host paths, mount types | PASS |
| Job launches a Windows binary | `interop=false`, **and** the `WSLInterop` binfmt entry removed at boot | Probe: PE file does not hang | PASS, see note 1 |
| Job steals credentials | None in image or container; API keys blanked | Probe: paths, keys, env | PASS |
| Job controls Docker | No socket, no CLI | Probe | PASS |
| Job becomes root | UID 1001, all caps dropped, no-new-privileges, seccomp, no setuid files, no real sudo | Probe | PASS |
| Job reaches the host, LAN or metadata | `egress-firewall.sh` | Listener test with positive control | PASS, see note 2 |
| Job reaches a sibling job | `enable_icc=false` | Listener in a sibling container | PASS |
| Job poisons the next job | Fresh container each job, `--rm`, no volumes | Marker files | PASS: 0 of 3 seen |
| Job exhausts the machine | CPU, memory, swap and pids limits | Over-limit workload | PASS, see below |
| Token leaks through argv, inspect or layers | JIT config on stdin only | Random value searched for | PASS: 0 hits |
| A job fills the disk | The launcher reads each container's writable size every 30 s and kills it past 40 GiB, or if the host falls under `min_free_gib`. A polled kill, not a quota: a fast writer overshoots by one poll | Real fill test past a 2 GiB bound | PASS: killed, exit 137, disk returned |

Note 1: `interop=false` alone is not enough. With it set, a PE file still went to `/init` and **hung** instead of being
refused, and a real `.exe` probe did the same. No process started on Windows, but a hang is not a refusal. The
`uct-ci-no-interop` unit removes the handler at boot, and a PE file now gets an ordinary exec failure.

Note 2: the positive control matters. A listener on the distro was REACHED from Docker's default bridge and BLOCKED from
`uct-ci`, so the block is the firewall's doing, not an absent service.

## Limits, measured

| Limit | Test | Result |
|---|---|---|
| Memory 2 GiB | Allocate 6 GiB | Killed, exit 137 |
| Pids 512 | Start 2000 sleepers | `fork: Resource temporarily unavailable` |
| CPU 4 | 8 spinners for 5 s | 20 CPU-seconds of 40 possible, throttled |

## What this does not protect against

1. **The runner's own credential.** A job shares the listener's UID, so it can read the JIT config from
   `/proc/<listener>/environ` or the runner's files. It is valid for that one runner and job, and dies with the container.
2. **A hostile job within its own run.** It can read `GITHUB_TOKEN` and the checkout, exactly as on a hosted runner.
3. **Anyone who controls the host.** On the PC, any process running as the Windows user can run
   `wsl -d uct-ci -u root`, so it can swap the image or edit results. This is why the PC is advisory only.
4. **A rogue runner claiming `uct-vps`. This one affects the gate.** Labels are chosen by whoever registers. GitHub
   documents `generate-jitconfig` as accepting a classic token with `repo` scope and admin access, and the `gh` token on
   this PC has that scope today. So a worker on this PC could register a machine labelled `uct-vps-gate`, take gate jobs
   and report success. No label rule stops that, and runner groups are not available on a user-owned repo. Nothing in
   this kit can detect it, since runner names are also caller-chosen. Not tested, deliberately. **The fix is the token
   change in OWNER-SETUP.md, which AUDIT has put first in the order.** Until then, no VPS result may decide a merge.
5. **Container escape.** The kernel is shared. On the PC that kernel is WSL's, on the VPS the host's.

## Running the proofs

```sh
IMG=$(cat /srv/uct/image-id)
python3 /srv/uct/kit/launcher.py local --image "$IMG" --cpus 4 --memory-gib 10 -- \
  bash -c 'PROBE_EXPECT_CPUS=4 PROBE_EXPECT_MEM_GIB=10 uct-ci-isolation-probe' </dev/null
```

Pass `</dev/null`: `docker run -i` otherwise takes the calling script's stdin. Exit 0 means every claim held. The
negative control must fail, and did (9 failures), which proves the probe can say no:

```sh
docker run --rm --user 0 --network bridge -v /:/hostfs:ro "$IMG" uct-ci-isolation-probe
```
