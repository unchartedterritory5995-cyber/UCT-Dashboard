# Publishing checklist — UCT Notebook Sync

Everything in this file is a **command or value to copy**, in order. The
narrative version (why each step exists) is `README.md`'s "What the owner
must do to publish it" section — read that first if anything here is
unclear. Every claim about Obsidian's *current* process below was fetched
from Obsidian's own docs on **2026-09-04**, with the exact URL and quote
noted — Obsidian's own pages are the authority if they've since changed;
re-check them before submitting, especially if this file is more than a few
months old.

This can ONLY be run by the owner: it needs a GitHub account with the
authority to create a new public repository and a GitHub Release, and an
Obsidian account to sign in at community.obsidian.md. Nothing here can be
done from inside this monorepo or by an agent.

---

## 0. One-time decisions (fill these in before Step 1)

| Value | Suggested | Notes |
|---|---|---|
| New repo name | `obsidian-uct-notebook-sync` | Matches `manifest.json`'s `id` (`uct-notebook-sync`), prefixed `obsidian-` per common convention. Not a hard Obsidian requirement — pick anything, but keep it stable once chosen (Step 3's directory listing points at this repo). |
| GitHub owner/org | `<your-github-username>` | Whoever creates the repo in Step 1. |
| Initial version tag | `0.1.0` | Must exactly equal `manifest.json`'s current `"version"` field. Bump both together for every future release — never tag without also bumping `manifest.json`. |

---

## 1. Create the new repository and move the code

```bash
# From this monorepo, copy the plugin directory's CONTENTS (not the
# directory itself) into a fresh folder that will become the new repo root.
mkdir ../obsidian-uct-notebook-sync
cp -r obsidian-plugin/. ../obsidian-uct-notebook-sync/
cd ../obsidian-uct-notebook-sync

# Drop what should never be copied verbatim — both are regenerated below.
rm -rf node_modules main.js

git init
git add -A
git commit -m "Initial import: UCT Notebook Sync Obsidian plugin"
```

Then on GitHub: create a new **public** repository named
`obsidian-uct-notebook-sync` (or your Step 0 choice) under your account, and
push:

```bash
git remote add origin https://github.com/<your-github-username>/obsidian-uct-notebook-sync.git
git branch -M main
git push -u origin main
```

## 2. Rebuild and re-verify in the new repo (trust nothing carried over blind)

```bash
npm install
npm run build   # tsc -noEmit -skipLibCheck && esbuild production bundle -> main.js
npm test        # vitest run — expect "5 passed (5)" test files, "50 passed (50)" tests
```

If either fails in the new repo but passed here, something about the move
broke a relative path or a dependency version — fix it before continuing.
Do not publish a release built from a state that hasn't passed both of these
in the destination repo.

## 3. Cut the GitHub Release

`manifest.json`'s `"version"` (currently `0.1.0`) is the source of truth for
the tag. If you're bumping the version for this release, edit
`manifest.json` **and** `versions.json` (add a `"<new version>": "<minAppVersion
at time of release>"` entry — never overwrite or remove the existing
`"0.1.0": "1.5.0"` entry) before tagging.

```bash
git tag 0.1.0
git push origin 0.1.0
```

On GitHub, turn that tag into a **Release** (Releases → Draft a new release →
pick the `0.1.0` tag). Title and body text are free-form. Attach these
**three files as binary release assets** — Obsidian's installer fetches them
directly from the release, never from the repo's source tree
(confirmed at <https://docs.obsidian.md/Plugins/Releasing/Submit+your+plugin>,
fetched 2026-09-04, which lists exactly these three, `styles.css` "optional"
— this plugin now ships one):

- `main.js` (from Step 2's build — the bundled, minified production output)
- `manifest.json`
- `styles.css`

## 4. Submit to the community directory

As of **2026-09-04** this is a **self-service developer dashboard**, not a
pull request against a JSON file in Obsidian's repo — that changed earlier
in 2026 (see <https://obsidian.md/blog/future-of-plugins/>, fetched
2026-09-04: "Sign into the Community site to access the new developer
dashboard," "Connect your GitHub account," "Choose a repo to submit,"
automated review with results "typically within a few minutes," and — once
approved — the plugin is "available to search and download in the app
within 24 hours"). The blog post also says the *old* GitHub-PR path still
works for pushing **new versions of an already-listed plugin**, but initial
submission is via the dashboard.

1. Go to **<https://community.obsidian.md>** and sign in with your Obsidian
   account.
2. Link your GitHub account to your profile (one-time).
3. Choose the `obsidian-uct-notebook-sync` repo from Step 1 and submit it —
   the dashboard walks you through this; per the docs it verifies
   `README.md`, `LICENSE`, and `manifest.json` are present at the repo root
   (all three are — this plugin already has them) and that the `id`
   (`uct-notebook-sync`) is unique and doesn't contain the string
   `obsidian` (confirmed, per <https://docs.obsidian.md/Plugins/Releasing/Submit+your+plugin>,
   fetched 2026-09-04: "The `id` must be unique across all published plugins
   and can't contain `obsidian`" — ours doesn't).
4. If automated review flags something, the dashboard shows what and why —
   fix it, bump `manifest.json`'s version, cut a new Release (Step 3), and
   the dashboard picks up the new version.

### The directory-listing fields, for reference

Obsidian's dashboard collects this data through its own UI now rather than a
hand-edited JSON file, but it is the same shape the classic
`community-plugins.json` entries use (fetched from
`raw.githubusercontent.com/obsidianmd/obsidian-releases/master/community-plugins.json`,
2026-09-04) — useful to have on hand if the dashboard asks you to confirm or
paste these, or if you ever need the legacy PR-based path as a fallback:

```json
{
  "id": "uct-notebook-sync",
  "name": "UCT Notebook Sync",
  "author": "UCT Intelligence",
  "description": "One-way sync of this vault's markdown notes into your UCT Intelligence Notebook (Journal 2.0).",
  "repo": "<your-github-username>/obsidian-uct-notebook-sync"
}
```

Every field except `repo` already matches `manifest.json` verbatim — fill in
`repo` with wherever Step 1 actually landed.

## 5. After it's approved and installable

Once the plugin is genuinely reachable by a member — live in the in-app
community directory, or at minimum installable via BRAT or a manual
`.obsidian/plugins/` copy of the Step 3 release assets — arm
`NOTE_SYNC_OBSIDIAN_ENABLED` on the server. See `docs/feature_flags.json`'s
entry for the exact three-part arming condition (that file is outside this
directory's ownership — read it, don't edit it from here). Do not arm the
flag before this step; the dashboard's connect modal already tells members
to install a plugin named "Obsidian," and that promise isn't true until this
step is done.
