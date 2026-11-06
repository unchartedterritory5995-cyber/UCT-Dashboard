# Owner setup

Do nothing here until AUDIT and the Program Lead say so. **Do the token change first.** AUDIT's order is: token change,
secret-scan fix, queue rewrite, routing, VPS, 10 shadow gates, switch.

## Do this first: take admin away from this PC's GitHub login

**Why.** The `gh` login on this PC is a classic token with `repo` scope, so every session here has admin on the repository. It
can register a machine as the VPS, read and change settings, and push workflow files. Claude sessions run as you.

**"Owner only" is not enforced today.** Everything is one GitHub account, so anything called owner-only, including the manual
fallback, is a rule people follow, not something GitHub stops. This change narrows what sessions can do. It does not create a second identity.

### 1. Create the new token

github.com > Settings > Developer settings > Fine-grained tokens > Generate new token:
- Resource owner: your account. Expiry: 90 days.
- Repository access: only `UCT-Dashboard`, plus any other repository sessions must push to (check `morning-wire` and `uct-intelligence`).
- Repository permissions:

| Permission | Access |
|---|---|
| Contents | Read and write |
| Pull requests | Read and write |
| Actions | Read and write |
| Metadata | Read-only (added automatically) |
| Administration, Secrets, Variables, **Workflows** | **No access** |

With no Workflows permission, a push that changes `.github/workflows/` is refused. **Workflow PRs then get pushed by you**, from
the admin route below. Actions write is what lets sessions dispatch the named set, and it also lets them dispatch the fallback.

### 2. Keep admin somewhere else

Do admin work in the **GitHub website**, signed in as you: runners, secrets, variables, settings. For the rare command-line
need, including pushing a workflow PR, keep a separate admin token out of this Windows account: a password manager, used from
another machine. **Do not store it in `gh`, git or a file on this PC.** A session running as you can read anything you can.

### 3. Clear what is stored

In PowerShell. These sign out `gh` and remove git's saved GitHub login:

```powershell
gh auth logout --hostname github.com
cmdkey /list | Select-String github
cmdkey /delete:git:https://github.com
cmdkey /delete:LegacyGeneric:target=git:https://github.com
git config --global --get-all credential.helper
```

Run a `cmdkey /delete` for each name the list shows; one that does not exist just errors. Then check nothing else holds a token.
Only the names print here:

```powershell
Get-ChildItem Env: | Where-Object { $_.Name -match '^(GH_TOKEN|GITHUB_TOKEN|GITHUB_PAT)$' } | Select-Object Name
Test-Path "$HOME\.git-credentials"
Test-Path "$HOME\.netrc"
```

The `Name` list must be empty and both lines `False`. Remove anything that is not.

### 4. Log in with the new token

This prompts with the value hidden, and nothing is written to history:

```powershell
$s = Read-Host -AsSecureString 'token'
[System.Net.NetworkCredential]::new('', $s).Password | gh auth login --hostname github.com --with-token
Remove-Variable s
gh auth setup-git
```

### 5. Prove it, including what must fail

Normal work must succeed. Each prints `200`-style data, not an error:

```powershell
$R = 'unchartedterritory5995-cyber/UCT-Dashboard'
gh api "repos/$R/actions/runs?per_page=1" --jq .total_count
gh api "repos/$R/pulls?per_page=1" --jq length
git ls-remote origin HEAD
```

**The negative test.** Each of these must print `HTTP 403`:

```powershell
gh api "repos/$R/actions/runners" 2>&1 | Select-String 'HTTP 4'
gh api -X POST "repos/$R/actions/runners/generate-jitconfig" -f name=negative-test -F runner_group_id=1 -f "labels[]=negative-test" 2>&1 | Select-String 'HTTP 4'
```

**If either returns data instead, the token still has admin. Stop.** If `generate-jitconfig` printed a config, it created a real
runner registration: delete `negative-test` at repo > Settings > Actions > Runners, then go back to step 3.

Then revoke the old token. For a `gh` login: github.com > Settings > Applications > Authorized OAuth Apps > GitHub CLI > Revoke.

**Note**: this also ends admin for every session here. Anything relying on it, such as reading repo settings or `gh auth status`
scopes, will start to fail. Those failures are the change working.

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

## PC (optional)

The PC never registers a runner and needs no token. The only owner step is limiting WSL: copy
`infra/ci-runner/wslconfig.proposed` to `.wslconfig` in your Windows user folder, then run `wsl --shutdown`. Stop anything running in
WSL first. Verify: `wsl -d uct-ci -u root -- nproc` prints `10`.

## VPS (what the cost plan needs)

### 1. Get a machine

Separate x64 machine, not ARM. Size it from `VALIDATION-PLAN.md`, 'Sizing'. Owner admin only. No `gh` login, no Claude
session, no SSH key for any other system, and no worker given access. Ubuntu 24.04 is fine: jobs run in the image.

### 2. Install Docker and the kit

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

### 3. Create the VPS's token

github.com > Settings > Developer settings > Fine-grained tokens > Generate new token:
- Resource owner: your account. Repository access: only `UCT-Dashboard`. Expiry: 90 days.
- Repository permissions: `Administration: Read and write`. Nothing else. Create this from the website, and never keep a copy on the PC.

On the VPS, enter it where nothing records it. This prompts, and the value is never echoed. It must not leave the VPS:

```sh
mkdir -p ~/.config/uct-ci; read -rs T; printf '%s' "$T" > ~/.config/uct-ci/github-token; unset T; chmod 600 ~/.config/uct-ci/github-token
```

Verify the VPS token before going further. It must print `200`. GitHub's docs name only the classic `repo` scope for
these endpoints, so if a fine-grained token prints anything else, stop and tell AUDIT. The header goes over stdin, so
the token is never in `curl`'s argv:

```sh
printf 'header = "Authorization: Bearer %s"\n' "$(cat ~/.config/uct-ci/github-token)" | curl -s -K - -o /dev/null -w '%{http_code}\n' https://api.github.com/repos/unchartedterritory5995-cyber/UCT-Dashboard/actions/runners
```

No other token is needed: `ci-queue-watch` uses the workflow's own `GITHUB_TOKEN`.

### 4. Start the VPS's runners (only after AUDIT approves)

Two lanes, one service each, so gate capacity stays reserved:

```sh
mkdir -p /etc/uct-ci
printf 'UCT_CI_IMAGE=%s\nUCT_CI_SLOTS=3\n' "$(cat /srv/uct/image-id)" > /etc/uct-ci/gate-vps.env
printf 'UCT_CI_IMAGE=%s\nUCT_CI_SLOTS=1\n' "$(cat /srv/uct/image-id)" > /etc/uct-ci/shared-vps.env
cp /srv/uct/kit/uct-ci-runner@.service /etc/systemd/system/
systemctl daemon-reload; systemctl enable --now uct-ci-runner@gate-vps uct-ci-runner@shared-vps
```

Set the slot counts from `VALIDATION-PLAN.md`, 'Sizing'. Verify at github.com > repo > Settings > Actions > Runners: 3 idle
runners labelled `uct-vps-gate` and 1 labelled `uct-vps`. Start-up refuses WSL, ARM and a host with owner credentials, and says why.

## Rotation and updates

- Tokens expire at 90 days. An expired token stops new runners, and the gate goes red, loudly.
- GitHub stops serving jobs to runners more than about 30 days old, and auto-update is not safe here. Rebuild monthly.
  Bump the pins in `Dockerfile`, build, record the new ID in `runner.env`, restart. AUDIT reviews every image change.
- If `ubuntu-latest` moves, change the base to match. Read a real job log, not the README.

## Undo

```powershell
wsl --unregister uct-ci
```

This deletes the distro, Docker and everything in it. Then remove the runners at repo > Settings > Actions > Runners
and revoke the tokens.
