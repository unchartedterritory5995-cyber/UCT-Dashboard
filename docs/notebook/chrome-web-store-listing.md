# Chrome Web Store — UCT Browser Capture, ready to submit

Everything an agent can prepare is here. The owner-only part is the developer account and
the submit button, about 15 minutes. The backend the extension talks to is live in
production: `/api/j2/capture/*` has been mounted since `977c59bc3` and answers 401 without
auth, so an installed copy works on day one.

## The owner's steps

1. **Developer account (one time):** <https://chrome.google.com/webstore/devconsole>. Sign
   in with the Google account that should own the listing and pay the one-time **$5**
   registration fee.
2. **Build the upload** from this worktree: `python tools/package_extension.py`. That writes
   `.extension-build/uct-browser-capture-0.1.0.zip` (10 files, deterministic; the tool
   refuses a build pointed anywhere but production).
3. **New item → upload that zip.**
4. **Store listing tab:** paste §1 below. Screenshots: `docs/notebook/store-assets/01-save-a-passage.png`
   and `02-saved.png` (1280×800). Icon: taken from the zip.
5. **Privacy practices tab:** paste §2 below.
6. **Distribution:** choose **Unlisted** while the site is in coming-soon mode (only people
   with the link can install), then switch to **Public** at launch. Visitors can't sign up
   yet, so a public listing now would mostly collect installs that can't connect.
7. **Submit for review.** Google usually reviews within a few days. The install link then
   goes in the Notebook's capture help, and D4's "publish the extension" is done.

## 1. Store listing

- **Name:** UCT Browser Capture (from the manifest)
- **Summary:** Save a link or a selected passage from any page into your UCT Notebook, with provenance intact. (From the manifest; 97 characters.)
- **Category:** Productivity › Workflow & Planning
- **Language:** English

**Description:**

```
UCT Browser Capture is the companion to the UCT Intelligence research Notebook. While you read, select a passage (or nothing, to keep just the link), press Ctrl+Shift+Y, pick the note it belongs in, and add a line on why it matters. The quote lands in your note with its source title and link, so you can always find where it came from.

What it does
• Saves the page link, or the passage you selected, into a note you choose
• Keeps the source: page title, address, and the exact words you selected
• Lets you add a short note on why it matters
• Stays on the page, so your reading isn't interrupted

What it reads
Only the current page's address, its title, and the text you selected, and only when you open the extension. It does not read the rest of the page, your browsing history, forms, or cookies.

How it connects
You connect once with your UCT Intelligence account. The extension receives a limited capture key that can only list your recent notes and save captures into them. It never sees your password or your UCT login session. You can disconnect it from the extension, or revoke it for good in UCT Settings.

Requires a UCT Intelligence membership.
```

## 2. Privacy practices

**Single purpose:**
Save a link or a selected passage from the current web page into the user's UCT Notebook.

**Permission justifications:**

| Permission | Justification |
|---|---|
| `activeTab` | Reads the current tab's address and title, and allows the one-line selection read, only when the user opens the extension. |
| `scripting` | Injects a single function into the active tab that returns the user's current text selection. Nothing else is read from the page. |
| `storage` | Keeps the user's limited capture key on this device. |
| `identity` | Runs the one-time sign-in (`chrome.identity.launchWebAuthFlow`) that connects the extension to the user's UCT account. |
| Host `https://uctintelligence.com/*` | Sends captures to the UCT API and lists the notes the user can save into. |

**Remote code:** No. All code is in the package; the manifest CSP is `script-src 'self'`.

**Data usage — tick these:**
- **Website content** (selected text, page title, page address): sent to UCT's servers to
  save into the user's own Notebook.
- **Authentication information** (the limited capture key): stored on the device.

⚠️ Judgement call, stated so it can be revisited: the page address is saved only when the
user presses Save, so it is filed under *website content*, not *web history*. The
extension keeps no list of visited pages.

**Certify:** data is not sold to third parties, not used for unrelated purposes, and not
used to determine creditworthiness.

**Privacy policy URL:** `https://uctintelligence.com/privacy`. Its "Browser Capture
Extension" section, added in this branch, is what the store checks against, so **the
branch must be deployed before submitting**.

## How these were made

- `tools/package_extension.py`: the zip holds exactly the tracked files under `extension/`.
  Rail: `tests/test_package_extension.py` (7 tests; mutation-proved on the host-permission
  check).
- `tools/extension_store_screenshots.py`: renders the **real** popup HTML, CSS and JS with only
  the `chrome.*` APIs stubbed and the two UCT endpoints answered locally. No network, no
  production traffic, no credentials. The article behind it is sample text on
  `research.example.com`, a reserved example domain. Re-run it after any popup change.
- What the extension may *do* stays railed by AST in
  `app/src/pages/journal-2-0/lib/extensionBoundary.test.js`.
