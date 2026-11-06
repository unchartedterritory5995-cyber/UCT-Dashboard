# Owner setup

Do nothing here until AUDIT and the Program Lead say so. Steps 1-3 are for the PC, which stays advisory only and is
optional. Steps 4-7 are for the VPS, which is what the cost plan depends on.

## Already done on the PC, nothing to do

WSL 3.0.3 with distro `uct-ci`, Docker Engine 29.9.3, automount and interop off, egress firewall, image built. Check:

```powershell
wsl -d uct-ci -u root -- bash -c "docker version --format '{{.Server.Version}}'; ls /mnt/c | wc -l; systemctl is-enabled docker uct-ci-firewall uct-ci-no-interop"
```

Expect a version, `0`, and `enabled` three times. Virtualization check, if it ever stops working:

```powershell
(Get-CimInstance Win32_ComputerSystem).HypervisorPresent
wsl --status
```

`HypervisorPresent` must be `True`. Task Manager > Performance > CPU must show `Virtualization: Enabled`. If it does
not, enable Intel VT-x in the BIOS. `VirtualizationFirmwareEnabled` reads `False` whenever a hypervisor is already
running, so do not use that field.

## PC (optional, advisory only)

### 1. Limit WSL

Copy `infra/ci-runner/wslconfig.proposed` to `C:\Users\blake\.wslconfig`, then run `wsl --shutdown`. Stop anything
running in WSL first. Verify: `wsl -d uct-ci -u root -- nproc` prints `10`.

### 2. Create the PC's token

github.com > Settings > Developer settings > Fine-grained tokens > Generate new token:
- Resource owner: your account. Repository access: only `UCT-Dashboard`. Expiry: 90 days.
- Repository permissions: `Administration: Read and write`. Nothing else.

Enter it where nothing records it. This prompts, and the value is never echoed:

```powershell
wsl -d uct-ci -u root
```
```sh
mkdir -p ~/.config/uct-ci; read -rs T; printf '%s' "$T" > ~/.config/uct-ci/github-token; unset T; chmod 600 ~/.config/uct-ci/github-token; exit
```

Limit: any process running as you can read this file. That is why the PC is advisory only.

### 3. Start the PC's runners (only after AUDIT approves registering a runner)

```powershell
wsl -d uct-ci -u root
```
```sh
printf 'UCT_CI_LANE=advisory-pc\nUCT_CI_IMAGE=%s\nUCT_CI_SLOTS=2\n' "$(cat /srv/uct/image-id)" > /etc/uct-ci/runner.env
cp /srv/uct/kit/uct-ci-runner.service /etc/systemd/system/
systemctl daemon-reload; systemctl enable --now uct-ci-runner; exit
```

Verify at github.com > repo > Settings > Actions > Runners: 2 idle runners labelled `uct-pc`. Then set the variable
`UCT_PC_ADVISORY` to `on`.

## VPS (what the cost plan needs)

### 4. Get a machine

Separate x64 machine, not ARM. Size it from `VALIDATION-PLAN.md`, 'Sizing'. Owner admin only. No `gh` login, no Claude
session, no SSH key for any other system, and no worker given access. Ubuntu 24.04 is fine: jobs run in the image.

### 5. Install Docker and the kit

Log in as an owner-only admin. Docker from its official repo: https://docs.docker.com/engine/install/ubuntu/. Then copy
`infra/ci-runner/` to `/srv/uct/kit` and run:

```sh
chmod +x /srv/uct/kit/*.sh
cd /srv/uct/kit && docker build -t uct-ci-runner:build .
docker image inspect uct-ci-runner:build --format '{{.Id}}' | tee /srv/uct/image-id
./egress-firewall.sh
cp uct-ci-firewall.service /etc/systemd/system/; systemctl daemon-reload; systemctl enable uct-ci-firewall
```

Check the firewall's list against the VPS provider's private ranges and metadata address.

### 6. Create the VPS's token, and the read token

Repeat step 2 on the VPS with a **new** token, never the PC's. It must not leave the VPS.

Create a second fine-grained token, `Administration: Read-only`, same repository, 90 days. Add it at repo > Settings >
Secrets and variables > Actions as `CI_RUNNER_READ_TOKEN`. This is a new repository secret, read only by the hosted
`runner-watchdog` job. AUDIT must approve it.

Verify the VPS token before going further. It must print `200`. GitHub's docs name only the classic `repo` scope for
these endpoints, so if a fine-grained token prints anything else, stop and tell AUDIT. The header goes over stdin, so
the token is never in `curl`'s argv:

```sh
printf 'header = "Authorization: Bearer %s"\n' "$(cat ~/.config/uct-ci/github-token)" | curl -s -K - -o /dev/null -w '%{http_code}\n' https://api.github.com/repos/unchartedterritory5995-cyber/UCT-Dashboard/actions/runners
```

The first `runner-watchdog` run proves the read token: a wrong permission fails the gate with the API's error.

### 7. Start the VPS's runners (only after AUDIT approves)

As step 3, with `UCT_CI_LANE=gate-vps` and the slot count from 'Sizing'. Verify the runners show `uct-vps`. Start-up
refuses WSL, ARM and a host with owner credentials, and says why.

## Rotation and updates

- Tokens expire at 90 days. An expired token stops new runners and the watchdog fails the gate, loudly.
- GitHub stops serving jobs to runners more than about 30 days old, and auto-update is not safe here. Rebuild monthly.
  Bump the pins in `Dockerfile`, build, record the new ID in `runner.env`, restart. AUDIT reviews every image change.
- If `ubuntu-latest` moves, change the base to match. Read a real job log, not the README.

## Undo

```powershell
wsl --unregister uct-ci
```

This deletes the distro, Docker and everything in it. Then remove the runners at repo > Settings > Actions > Runners
and revoke the tokens.
