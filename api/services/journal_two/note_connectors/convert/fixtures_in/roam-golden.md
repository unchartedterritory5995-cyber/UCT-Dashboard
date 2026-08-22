A Roam page after `roam_text.convert_roam_markdown` has already run — the
provider's own pre-pass output, not raw Roam wiki syntax. Exercises the
node/mark shapes a synced Roam page actually produces: a task item with a
resolved import-link, a nested bullet (block-ref already inlined as plain
text), a heading block, an image placeholder from a mirrored Firebase URL,
literal `==highlight==` text (no highlight mark in the schema yet — see
`roam_text.py`), a flattened page-attribute line, and a code-protected
`[[...]]` that survived the wiki-link pass untouched.

- [ ] Review [Setup Library](import-link://roam:my-graph/page-2-uid) before open
  - See Key Levels for details
## Key Levels

- Chart: ![](https://firebasestorage.googleapis.com/v0/b/x/o/img.png?alt=media)
- ==Important== note here
- Status: In Progress
- Use `[[not a link]]` as an example
