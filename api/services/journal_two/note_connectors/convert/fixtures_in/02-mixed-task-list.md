Mixed checkbox and plain items inside one markdown list — the source's own
adjacency, not a hand-split list. `mddoc.py` must split this into sibling
`taskList` / `bulletList` / `taskList` runs since TipTap's schema forbids a
`listItem` inside a `taskList` (or vice versa).

- [x] Ship the schema rail
- [ ] Write the report
- plain reminder one
- plain reminder two
- [x] Circle back with the owner
