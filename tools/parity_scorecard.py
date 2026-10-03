"""Build and verify docs/notebook/parity-scorecard.md — the Notebook's parity re-score (wave 9 lane
9B's tool; re-scored after wave 10 by follow-up F3, 2026-09-28).

    python tools/parity_scorecard.py --verify [--rev REV]   # offline: re-check every cited file:line
                                                             #   at the revision the scorecard records
                                                             #   (--rev HEAD: "has the code moved since?")
    python tools/parity_scorecard.py --dry-run [--pages DIR] # build in memory, check, write nothing
    python tools/parity_scorecard.py --write   [--pages DIR] # rebuild the scorecard

WHAT IT NEEDS. Nothing over the network: this tool never fetches. It reads the gap ledger, the plan,
the committed evidence of waves 5-10 (wave 9's browser check under
docs/notebook/evidence/wave9-9b-8a0098029/, the wave-7 and wave-8 walk reports, wave 10's L1a walk,
10C/10D evidence, 10E's docs/notebook/proof/ and the follow-up lanes' records), and the flag ledger
`docs/feature_flags.json` AT THE REVISION THE SCORECARD RECORDS (wave 10, F3: it read master's copy
at be9ca78b6 before; a flag armed since then made every such cell wrong). The competitor quotes and
the metadata of every page they were cut from (URL, where the text was read, fetch time, sha256)
are embedded below as data (QUOTES, SOURCES), recorded 2026-09-26 by lane 9B's fetch pass (research
ledger R12-R16) and 10E-1's Evernote fold, and 2026-10-02 by wave 12 lane 12C's fetch pass (R18).

--pages DIR re-verifies every quote verbatim against the text extracted from those fetches (one
<page id>.txt per page; Obsidian's markdown has its links rendered to their display text first).
The pages are the vendors' text and are NOT in the repo; without --pages the quotes are checked for
length only, and the tool says so. A competitor page is re-fetched by hand (ruling D-9B3), never here.

--verify is the offline half the rails run (tests/test_parity_scorecard.py): it parses the COMMITTED
scorecard and re-checks every `CODE|RULING|RECORD|MEASURE path:line "fragment"`, every WALK check id
and verdict in its report, every TEST totals line in its log, and every flag RECORD, all read through
`git show REV:path` at ONE revision (a flag RECORD must also name the revision the scorecard records).
The scorecard is a MEASUREMENT AT A COMMIT:
REV defaults to the revision its own header records ("Document written at"), so an unrelated edit
that moves a cited line later never reds it. `--rev HEAD` asks the other question, "has the code
moved since?", and a line that moved fails by name there (re-read it; never trust it). A revision
that is not in the local object store is never a pass: it fails as "unverifiable: <sha> not in this
clone" (a clone needs full history, e.g. fetch-depth 0).

--write refuses to write while any check fails: a quote not verbatim (with --pages), a fragment not
on its line, a walk check whose verdict is not the one cited, a flag state that differs from the
ledger at HEAD, a log without its totals line, a verdict of AHEAD/PARITY/BEHIND against a vendor with
no citation, an evidence-index (§0) property that does not hold. It also refuses unless the built
text verifies at the revision its header records (HEAD): a cited input that is edited but not
committed would make that header a revision the citations are not true at.

§0, THE EVIDENCE INDEX (redesigned in wave 10, F3; tightened in F3 fix round 1). Wave 9 checked
"every wave-tip SHA is an ancestor of HEAD". Waves 5-10 land on master as SQUASH merges (one parent),
so a wave's head is never an ancestor of master and that check could only pass on the wave's own
branch. It did, however, prove the one thing the index is for: the code a walk measured SHIPPED. The
redesign keeps that property through the squash:
  (1) pinned -- each wave's SQUASHED head is pinned by a tag (refs/tags only) resolving to the
      recorded SHA. Waves 5 and 7's `-tip-` tags are not the heads their PRs squashed (#186 squashed
      d251cbb98, #196 bba8bcb4d; each squash's tree equals that head's tree), so new `-tip2-` tags pin
      the squashed heads and the old tags are left where they are;
  (2) landed -- the wave's squash is an ancestor of HEAD;
  (5) tied -- the squash CARRIES the head: its tree is the head merged onto the squash's parent,
      `git merge-tree --write-tree <squash>^ <head>` == `<squash>^{tree}` (F3 fix round 3: a squash onto
      a master that moved is a 3-way merge, so a file both sides touched holds the merge, not the head's
      blob); non-vacuous: a head that changed nothing against merge-base(head, squash^) fails.
      Wave 10's L1c has no squash yet: its tag is created at the final L1c tip; while that head is in
      HEAD's own history it is its own landing, and after the squash the tool finds the earliest
      commit of HEAD's history (topological order) that carries the head by that rule;
  (3) unchanged -- every cited evidence file's blob at its wave's landing equals its blob at HEAD;
  (4) reachable -- every tree a browser check or walk measured is an ancestor of the tag of the
      declared wave it was on, and that wave passed (1), (2) and (5). A ref that is not HEAD or a
      declared wave tag -- a bare SHA, or a tag of a branch that never landed -- is refused.
Every evidence path and walked tree the built scorecard cites must be a row here (`cited_b0_gaps`), so a
new citation cannot escape the index. `evidence_index()` checks all five; tests/test_parity_scorecard.py
shows each failing on a planted defect.
"""
from __future__ import annotations

import json
import os
import re
import subprocess
import sys
from collections import Counter, OrderedDict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'tools'))
import gap_ledger_summary as GLS  # noqa: E402

DATE = '2026-10-03'              # this re-score (wave 13, lane 13SC; before it, wave 12 lane 12C phase 2, and wave 10's RS/QR re-scores)
FETCH_DATE = '2026-09-26'        # R12-R17's fetch day; since lane 12C (R18) a cell prints its own page's fetch date
EVD = 'docs/notebook/evidence/wave9-9b-8a0098029'
LEDGER = 'docs/notebook/competitive-gap-ledger.md'
PLAN = 'docs/notebook/NOTEBOOK-10-OF-10-PLAN.md'
PB = 'docs/notebook/perf-budgets.md'
SCORECARD = 'docs/notebook/parity-scorecard.md'
FLAGS = 'docs/feature_flags.json'  # read at the revision the scorecard records (never a fixed older one)
INVENTORY_REV = '00742b54c'      # the plan the §B1 inventory was built from (lane 9B's starting HEAD)

# ── wave 10's evidence (every path is committed; the tips named are the trees each run measured) ──
W10_WALK = 'docs/notebook/gate-runs/wave10/walk-L1a-14310c206.json'   # the L1a landing walk (10B rows)
W10_WALK_TOOL = 'tools/notebook_wave10b_walk.py'
G62_WALK = 'docs/notebook/gate-runs/g62/walk-4d2a4edfa-run3.json'   # lane G62's consensus walk, run 3
G62_WALK_TOOL = 'tools/notebook_g62_consensus_walk.py'
PROOF = 'docs/notebook/proof'                                          # 10E-1 + the follow-up lanes
KBD_F4 = 'docs/notebook/evidence/a11y-f4-keyboard-2026-09-27/walk-all.json'   # the keyboard re-walk (F4)
KBD_TOOL = 'docs/notebook/evidence/a11y-second-review-2026-09-27/keyboard_walk.py'
W10C = 'docs/notebook/evidence/wave10-10c'
W10D = 'docs/notebook/evidence/wave10-10d'

# ── the quote bank: key -> (page id, verbatim quote <= 25 words), cut 2026-09-26 ──
QUOTES = {
 "N_code": [
  "notion__code_blocks",
  "We support syntax highlighting for a number of programming languages."
 ],
 "N_math": [
  "notion__math_equations",
  "On any Notion page, you can display beautifully formatted, comprehensible mathematical characters, expressions and equations."
 ],
 "N_color": [
  "notion__customize_and_style_your_content",
  "Spice up your text by turning it a color or giving it a color highlight."
 ],
 "N_callout": [
  "notion__customize_and_style_your_content",
  "Callout blocks are useful for highlighting specific text or breaking it out from the rest of a document."
 ],
 "N_align": [
  "notion__images_files_and_media",
  "Choose to align left, center, or right."
 ],
 "N_caption": [
  "notion__images_files_and_media",
  "To give your media block a caption:"
 ],
 "N_pdf": [
  "notion__images_files_and_media",
  "At any place on your page, create a file block that will prompt you to Upload a file from your computer"
 ],
 "N_tables": [
  "notion__tables",
  "You can also create simple tables if you want to display plain text visually without database functionalities (such as filters, sorts, and specific property values)."
 ],
 "N_drag": [
  "notion__writing_and_editing_basics",
  "Click and drag to move a block."
 ],
 "N_columns": [
  "notion__columns_headings_and_dividers",
  "You can create as many columns as you want across the width of a page."
 ],
 "N_headings": [
  "notion__columns_headings_and_dividers",
  "You can add more structure to your pages with three levels of headings."
 ],
 "N_toc": [
  "notion__keyboard_shortcuts",
  "/toc creates a Table of Contents block."
 ],
 "N_wordcount": [
  "notion__keyboard_shortcuts",
  "Once you have blocks selected, the menu that appears shows the word count and the character count for your selection."
 ],
 "N_find": [
  "notion__keyboard_shortcuts",
  "Use cmd/ctrl + F to search inside a page."
 ],
 "N_switch": [
  "notion__keyboard_shortcuts",
  "Use cmd/ctrl + P or cmd/ctrl + K to open search or jump to a recently viewed page."
 ],
 "N_emoji": [
  "notion__keyboard_shortcuts",
  "/emoji brings up the emoji picker"
 ],
 "N_date": [
  "notion__keyboard_shortcuts",
  "Mention a date: Type @ and a date in any format"
 ],
 "N_remind": [
  "notion__reminders",
  "Notion can help remind you or other people about what’s important."
 ],
 "N_embed": [
  "notion__embed_and_connect_other_apps",
  "You can embed virtually any online content within Notion pages"
 ],
 "N_preview": [
  "notion__link_previews",
  "Link previews allow you to see live, synced visualizations of links directly in Notion."
 ],
 "N_backlinks": [
  "notion__create_links_and_backlinks",
  "Backlinks show you all the pages that link to the page you’re currently on."
 ],
 "N_linkat": [
  "notion__create_links_and_backlinks",
  "Notion makes it easy to link to all kinds of content in and outside of your workspace."
 ],
 "N_trash": [
  "notion__duplicate_delete_and_restore_content",
  "By default, pages will remain in Trash for 30 days before they are permanently deleted from Trash."
 ],
 "N_version": [
  "notion__duplicate_delete_and_restore_content",
  "Version history gives more detail about what changed on a page or database."
 ],
 "N_archive": [
  "notion__archive_pages",
  "Notion lets you archive pages instead of deleting them."
 ],
 "N_relation": [
  "notion__relations_and_rollups",
  "Notion's relation property is designed to help you express useful relationships between items in different databases."
 ],
 "N_timeline": [
  "notion__timelines",
  "Notion's timeline is a type of database that keeps you on task and on track."
 ],
 "N_board": [
  "notion__boards",
  "Boards are helpful for showing items in a database as they move through stages of a process, or grouped by property."
 ],
 "N_props": [
  "notion__database_properties",
  "Database properties add all kinds of context to your database items, like due dates, task owners, relevant URLs, last edited timestamps, and more."
 ],
 "N_dbtemplate": [
  "notion__database_templates",
  "database templates let you define and replicate certain page structures with one click."
 ],
 "N_offline": [
  "notion__use_pages_offline",
  "All workspace members on all plans can use pages offline."
 ],
 "N_publish": [
  "notion__public_pages_and_web_publishing",
  "Publish an unlimited number of pages to the web."
 ],
 "N_share": [
  "notion__sharing_and_permissions",
  "Copy the page’s link to share it with others."
 ],
 "N_export": [
  "notion__export_your_content",
  "You can export a Notion page, database, or entire workspace at any time."
 ],
 "N_exportfmt": [
  "notion__export_your_content",
  "Need to share your content in PDF, CSV, or HTML format?"
 ],
 "N_import": [
  "notion__import_data_into_notion",
  "You can also import data from a number of apps like Confluence, Asana, Evernote, and Trello."
 ],
 "N_importdocx": [
  "notion__import_data_into_notion",
  "You can import several files in one go for PDFs, HTML, Markdown, Word (.docx), and plain text (.txt)."
 ],
 "N_clipper": [
  "notion__web_clipper",
  "Our desktop Web Clipper is a browser extension available for Chrome and Safari."
 ],
 "N_api": [
  "notion__create_integrations_with_the_notion_api",
  "With Notion's API, you'll be able to create custom internal connections."
 ],
 "N_encrypt": [
  "notion__security_and_privacy",
  "Encryption at rest: Customer data is encrypted at rest using AES-256."
 ],
 "N_aiwrite": [
  "notion__notion_ai_faqs",
  "Make edits to the page, like adding a summary or translating the page’s content."
 ],
 "N_research": [
  "notion__research_mode",
  "Once you enter your query, Notion AI will show you the sources that it’s using to gather insights and generate a report."
 ],
 "N_scope": [
  "notion__research_mode",
  "Use the All sources menu to choose specific sources for Research Mode to look at."
 ],
 "N_cite": [
  "notion__enterprise_search",
  "it'll always cite its sources so you can go back to the source."
 ],
 "N_tasks": [
  "notion__tasks_and_dependencies",
  "Want to see and manage all of your tasks in one place?"
 ],
 "N_subpage": [
  "notion__create_a_subpage",
  "Here, we'll show you how to create a page within another page, which we call a subpage."
 ],
 "N_favorites": [
  "notion__navigate_with_the_sidebar",
  "Your Home tab is organized in sections, including Upcoming events, Recents, Favorites"
 ],
 "N_collab": [
  "notion__collaborate_with_people",
  "You can edit the same page at the same time with an unlimited number of people."
 ],
 "N_comments": [
  "notion__comments_mentions_and_reminders",
  "@-mention colleagues to refer to them or bring them into the conversation."
 ],
 "N_transcribe": [
  "notion__ai_meeting_notes",
  "Notion AI transcribes your meeting and identifies key points and action items that you can share with your entire team."
 ],
 "N_searchfilter": [
  "notion__search",
  "This will open up a full page with search results, which you can filter by source, title, author, and more."
 ],
 "N_delete_acct": [
  "notion__delete_your_account",
  "Here's how to delete your Notion account."
 ],
 "O_code": [
  "obsidian__Editing_and_formatting_Basic_formatting_syntax_md",
  "You can add syntax highlighting to a code block, by adding a language code after the first set of backticks."
 ],
 "O_math": [
  "obsidian__Editing_and_formatting_Advanced_formatting_syntax_md",
  "You can add math expressions to your notes using MathJax and the LaTeX notation."
 ],
 "O_headings": [
  "obsidian__Editing_and_formatting_Basic_formatting_syntax_md",
  "To create a heading, add up to six # symbols before your heading text."
 ],
 "O_tables": [
  "obsidian__Editing_and_formatting_Advanced_formatting_syntax_md",
  "In Live Preview, you can right-click a table to add or delete columns and rows."
 ],
 "O_callout": [
  "obsidian__Editing_and_formatting_Callouts_md",
  "The type identifier determines how the callout looks and feels."
 ],
 "O_wordcount": [
  "obsidian__Plugins_Word_count_md",
  "Word count is a core plugin that displays the number of words and characters of the active note."
 ],
 "O_outline": [
  "obsidian__Plugins_Outline_md",
  "Outline is a core plugin that lists the headings in the active note."
 ],
 "O_switch": [
  "obsidian__Plugins_Quick_switcher_md",
  "Quick switcher is a core plugin that lets you search and open notes using only your keyboard."
 ],
 "O_search": [
  "obsidian__Plugins_Search_md",
  "Search is a core plugin that helps you find data in your Obsidian vault by using search terms and operators to narrow down results."
 ],
 "O_palette": [
  "obsidian__Plugins_Command_palette_md",
  "The Command palette plugin lets you run any command directly from your keyboard."
 ],
 "O_backlinks": [
  "obsidian__Plugins_Backlinks_md",
  "A backlink for a note is a link from another note to that note."
 ],
 "O_graph": [
  "obsidian__Plugins_Graph_view_md",
  "Graph view is a core plugin that lets you visualize the relationships between the notes in your vault."
 ],
 "O_daily": [
  "obsidian__Plugins_Daily_notes_md",
  "Daily notes is a core plugin that opens a note based on today's date, or creates it if it doesn't exist."
 ],
 "O_templates": [
  "obsidian__Plugins_Templates_md",
  "Templates is a core plugin that lets you insert pre-defined snippets of text into your active note."
 ],
 "O_bookmarks": [
  "obsidian__Plugins_Bookmarks_md",
  "Bookmarks is a core plugin that lets you quickly access items that you use often."
 ],
 "O_recovery": [
  "obsidian__Plugins_File_recovery_md",
  "Snapshots capture the full content of your files, not just changes, allowing you to restore any previous version."
 ],
 "O_slash": [
  "obsidian__Plugins_Slash_commands_md",
  "Slash commands is a core plugin that lets you perform commands in the editor by typing a forward slash (/)"
 ],
 "O_audio": [
  "obsidian__Plugins_Audio_recorder_md",
  "Audio recorder is a core plugin that lets you record and save audio in an Obsidian note."
 ],
 "O_preview": [
  "obsidian__Plugins_Page_preview_md",
  "Page preview is a core plugin that lets you preview a page when you hover the cursor over an internal link"
 ],
 "O_embedweb": [
  "obsidian__Editing_and_formatting_Embed_web_pages_md",
  "Learn how to use the iframe HTML element to embed web pages in your notes."
 ],
 "O_tags": [
  "obsidian__Editing_and_formatting_Tags_md",
  "Nested tags define tag hierarchies that make it easier to find and filter related tags."
 ],
 "O_props": [
  "obsidian__Editing_and_formatting_Properties_md",
  "Properties contain structured data such as text, links, dates, checkboxes, and numbers."
 ],
 "O_bases": [
  "obsidian__Bases_Introduction_to_Bases_md",
  "Bases is a core plugin that lets you create database-like views of your notes."
 ],
 "O_views": [
  "obsidian__Bases_Views_md",
  "A base can contain several views, and each view can have a unique configuration to display, sort, and filter files."
 ],
 "O_kanban": [
  "obsidian__Bases_Layouts_Kanban_view_md",
  "Kanban is a type of view you can use in Bases."
 ],
 "O_tabs": [
  "obsidian__User_interface_Tabs_md",
  "You can also arrange tabs to create custom layouts that persist until the next time you open the app."
 ],
 "O_attach": [
  "obsidian__Editing_and_formatting_Attachments_md",
  "You can import Accepted file formats, or attachments, to your vault, such as images, audio files, or PDFs."
 ],
 "O_formats": [
  "obsidian__Files_and_folders_Accepted_file_formats_md",
  "Many file types — including images, audio, video, and PDFs — can be embedded directly into your notes."
 ],
 "O_local": [
  "obsidian__Files_and_folders_How_Obsidian_stores_data_md",
  "Obsidian stores your notes as Markdown-formatted plain text files in a vault."
 ],
 "O_offline": [
  "obsidian__Getting_started_Import_notes_md",
  "You have total control over your data, which means you can use Obsidian offline and switch to another app easily if you ever need to."
 ],
 "O_publish": [
  "obsidian__Obsidian_Publish_Introduction_to_Obsidian_Publish_md",
  "Obsidian Publish is a cloud-based hosting service that lets you publish your notes as a wiki, knowledge base, documentation, or digital garden."
 ],
 "O_clipper": [
  "obsidian__Obsidian_Web_Clipper_Introduction_to_Obsidian_Web_Clipper_md",
  "Obsidian Web Clipper is a free browser extension that lets you highlight pages and save web content to your vault."
 ],
 "O_import": [
  "obsidian__Import_notes_Import_from_Evernote_md",
  "Obsidian lets you easily migrate your notes from Evernote using the Importer plugin."
 ],
 "O_plugins": [
  "obsidian__Extending_Obsidian_Community_plugins_md",
  "Community plugins run third-party code on your behalf that could potentially do harm."
 ],
 "O_uri": [
  "obsidian__Extending_Obsidian_Obsidian_URI_md",
  "Obsidian URI is a custom URI protocol supported by Obsidian that lets you trigger various actions, such as opening a note or creating a note."
 ],
 "O_ios": [
  "obsidian__Obsidian_Obsidian_for_iOS_and_iPadOS_md",
  "Obsidian integrates with Apple's Shortcuts app, allowing you to create powerful automations."
 ],
 "O_collab": [
  "obsidian__Obsidian_Sync_Collaborate_on_a_shared_vault_md",
  "With Obsidian Sync you can collaborate on a shared vault with your team."
 ],
 "O_e2e": [
  "obsidian__Obsidian_Sync_Security_and_privacy_md",
  "This guarantees that no one — not even the Obsidian team — can access your notes."
 ],
 "O_links": [
  "obsidian__Linking_notes_and_files_Internal_links_md",
  "By linking notes, you can create a network of knowledge."
 ],
 "N_restore": [
  "notion__duplicate_delete_and_restore_content",
  "From there, you can restore the page or permanently delete it from the trash."
 ],
 "N_datefilter": [
  "notion__search",
  "Shows content that was created or edited within a chosen date range."
 ],
 "N_relevance": [
  "notion__search",
  "Best Matches (default): Shows the most relevant results."
 ],
 "N_wikilink": [
  "notion__create_links_and_backlinks",
  "Type [[ , then start entering the name of the page you want to link."
 ],
 "N_autofill": [
  "notion__autofill",
  "Basic Autofill is best for simple fills, like summaries, tagging, and translation."
 ],
 "N_pdfembed": [
  "notion__images_files_and_media",
  "or use an Embed link to embed a file on your page like a PDF."
 ],
 "N_savedview": [
  "notion__views_filters_and_sorts",
  "You can choose to Save for everyone if you want the filter to be applied for everyone in the database view."
 ],
 "N_onboard": [
  "notion__start_with_a_template",
  "These are selected for you based on what you tell us during onboarding."
 ],
 "N_help": [
  "notion__code_blocks",
  "Notion Help – Notion Help Center"
 ],
 "O_trash": [
  "obsidian__Files_and_folders_Manage_notes_md",
  "You can send deleted files to a .trash folder in your vault."
 ],
 "O_folder": [
  "obsidian__Files_and_folders_Manage_notes_md",
  "You can rename a note or folder without opening it"
 ],
 "O_snippet": [
  "obsidian__Plugins_Search_md",
  "Expands the search result to show more text around the match."
 ],
 "O_highlight": [
  "obsidian__Editing_and_formatting_Basic_formatting_syntax_md",
  "Bold, italics, highlights"
 ],
 "O_unlinked": [
  "obsidian__Plugins_Backlinks_md",
  "Unlinked mentions are backlinks to any unlinked occurrence of the name of the active note."
 ],
 "O_help": [
  "obsidian__Home_md",
  "Welcome to the official Obsidian Help site, where you can find tips and guides on how to use Obsidian."
 ],
 "E_tasks": [
  "evernote__tasks",
  "Get the right thing done at the right time by setting due dates, recurrences, and reminders."
 ],
 "E_taskview": [
  "evernote__tasks",
  "View your tasks by assignment, note, or due date, and use filters to see only what you need."
 ],
 "E_clipper": [
  "evernote__web_clipper",
  "Clip web pages, articles, or PDFs and save them in Evernote."
 ],
 "E_offline": [
  "evernote__sync",
  "With offline access, your notes are always with you—even if you’re nowhere near a Wi-Fi or mobile data signal."
 ],
 "E_searchimg": [
  "evernote__features",
  "Look inside images and documents, and save search terms for quicker access."
 ],
 "E_scan": [
  "evernote__document_scanning",
  "Snap a photo with your phone and never lose another name, phone number, or email address."
 ],
 "E_templates": [
  "evernote__templates",
  "Create the perfect template for your needs and start using it."
 ],
 "E_mcp": [
  "evernote__mcp",
  "The Evernote MCP server lets Claude, ChatGPT, and any MCP-compatible client read, search, and create notes — with your permission."
 ],
 "E_share_ext": [
  "evernote__whats_new",
  "Use the Share Extension on your phone to easily save websites, images, and more to Evernote from anywhere on your device."
 ],
 "E_toc": [
  "evernote__whats_new",
  "In a long note with headers, start scrolling to reveal the table of contents icon on the right."
 ],
 "E_caption": [
  "evernote__whats_new",
  "Add an image caption in a single action, so visuals and photos are easier to find and quicker to scan at a glance."
 ],
 "E_date": [
  "evernote__whats_new",
  "Type \"@\" anywhere in a note to drop in an exact or relevant date that updates automatically."
 ],
 "E_dictation": [
  "evernote__whats_new",
  "Open the Insert or / slash command menu and select Dictation to turn your voice into editable and actionable text as you talk."
 ],
 "E_editmode": [
  "evernote__whats_new",
  "Try using it to create callout blocks, Mermaid diagrams, tables, and more."
 ],
 "E_smart": [
  "evernote__whats_new",
  "Try asking a question or describing the topic instead."
 ],
 "E_mention": [
  "evernote__whats_new",
  "Use @ to mention notebooks, stacks, and spaces directly from a note, so related content is easier to connect and access."
 ],
 "E_find": [
  "evernote__release_notes_11_35_6",
  "Find in note now supports match case again, replacing matches with nothing, and prefilled selected text."
 ],
 "E_pdfexport": [
  "evernote__release_notes_11_35_6",
  "You can now use Page break to force a new page when exporting to PDF"
 ],
 "E_emailin": [
  "evernote__compare_plans",
  "Email content into Evernote, export notes and notebooks as PDFs"
 ],
 "E_semantic": [
  "evernote__compare_plans",
  "Semantic Search Find related notes based on their content."
 ],
 "E_aiedit": [
  "evernote__compare_plans",
  "AI Edit Use AI to write, summarize, tidy, and translate your notes"
 ],
 "E_assistant": [
  "evernote__compare_plans",
  "AI Assistant Search, organize, and enrich your notes from a chat."
 ],
 "E_offline_plan": [
  "evernote__compare_plans",
  "Offline notes Access your notes from anywhere"
 ],
 "E_encrypt": [
  "evernote__compare_plans",
  "In-note encryption (Mac & Windows)"
 ],
 "E_search": [
  "evernote__compare_plans",
  "Advanced search Find anything in your account with Boolean, geographic, and filtered searches"
 ],
 "E_tags": [
  "evernote__compare_plans",
  "Advanced organization Add tags and reminders to notes"
 ],
 "E_trash": [
  "evernote_help__208313438",
  "When you delete a note, it's moved to the trash"
 ],
 "E_version": [
  "evernote_help__208313858",
  "Note history allows you to view and restore older versions of a note."
 ],
 "E_delete_acct": [
  "evernote_help__360056549574",
  "all of your data will be deleted from Evernote"
 ],
 "E_offline": [
  "evernote_help__209005917",
  "Any changes you make during your time offline will be synced"
 ],
 "E_datefilter": [
  "evernote_help__208313828",
  "Searches for notes created on or after the date specified."
 ],
 "E_snippet": [
  "evernote_help__209005647",
  "that match is highlighted both in the note list"
 ],
 "E_meaning": [
  "evernote_help__45706285591955",
  "helps you find information by meaning, not just by exact keywords"
 ],
 "E_pin": [
  "evernote_help__46319409880211",
  "pin notes to a notebook, to Home, and add them to shortcuts"
 ],
 "E_savedsearch": [
  "evernote_help__209005267",
  "Saved searches are synced across all your devices"
 ],
 # ── wave 12, lane 12C phase 1 (2026-10-02): cut from the R18 fetch pass, each checked verbatim against the
 # text extracted from that fetch (the R12-R14 extraction) before it was entered ──
 "E_atrest": [
  "evernote__security",
  "The users’ data that we store in the Google Cloud Platform is protected using Google’s built-in encryption-at-rest features."
 ],
 "E_backlinks": [
  "evernote_hc__360022954093",
  "You can also insert links to other notes in your Evernote account, and quickly navigate from one to another using backlinks."
 ],
 "E_color": [
  "evernote_hc__360022954093",
  "Highlight important sections with bold, italics, underline, or text colors and highlighters."
 ],
 "E_recents": [
  "evernote_hc__360040282613",
  "Before you begin typing, the search modal displays a well-structured view consisting of: Recent searches Saved searches Recent notes"
 ],
 "E_pdfpreview": [
  "evernote_hc__209005587",
  "To preview the PDF without leaving your note, select the chevron on the attachment card to expand it."
 ],
 "E_publiclink": [
  "evernote_hc__34377080881939",
  "Anyone can view the note in the Lite editor without creating an Evernote account or logging in."
 ],
 "E_math": [
  "evernote_hc__35610214032531",
  "You can add math formulas with LaTeX syntax on Web, Desktop and mobile."
 ],
 "E_tables": [
  "evernote__release_notes_11_36_4",
  "sort and filter rows by column values, toggle a header row, customize borders, and distribute columns evenly (rolling out gradually)"
 ],
 "E_drag": [
  "evernote_hc__36617500119315",
  "You can now drag paragraphs and move them around within your note."
 ],
 "E_wordcount": [
  "evernote_hc__35615740098835",
  "you will see various details about the note, including its size , word count , and character count"
 ],
 "E_emoji": [
  "evernote_hc__50066095106835",
  "The emoji picker provides a visual way to find and insert emojis as you type."
 ],
 "E_headings": [
  "evernote_hc__39988842532627",
  "for each text style (Normal text, Large header H1, Medium header H2, Small header H3, Extra small header H4)."
 ],
 "E_undo": [
  "evernote_hc__16280830963091",
  "You can click or tap the Undo button in the editing toolbar to reverse the last change or edit made to the note."
 ],
 "E_bulkmove": [
  "evernote_hc__115006310828",
  "In order to save time, move multiple notes at once between notebooks by using Evernote on a desktop computer."
 ],
 "E_nestedtags": [
  "evernote_hc__4412905761299",
  "A main tag can have one or more sub-tags."
 ],
 "E_lock": [
  "evernote_hc__360053951213",
  "If you want to lock a note and open it in a read-only mode until you're ready to edit it"
 ],
 "E_daily": [
  "evernote_hc__32780525935763",
  "The Daily notes feature helps you effortlessly capture your ideas and tasks, with a new note created for you each day."
 ],
 "E_help": [
  "evernote_hc__home",
  "Evernote Help & Learning"
 ],
 "E_aiscope": [
  "evernote_hc__46319409880211",
  "When you ask a question, the assistant automatically determines what information to use as context"
 ],
 "E_aimention": [
  "evernote_hc__46319409880211",
  "When you want the AI Assistant to recognize specific notes, notebooks, or tags, make sure to use @ -mentions"
 ],
 "E_aicite": [
  "evernote_hc__46319409880211",
  "Replies include which notes were used to generate them."
 ],
 "E_aifallback": [
  "evernote_hc__46319409880211",
  "If your request can’t be answered using your notes, the assistant may suggest using its built-in knowledge or searching the web."
 ],
 "E_clipcomment": [
  "evernote_hc__209125877",
  "add a tag, or add a comment, you can do that easily right before you clip!"
 ],
 "N_lock": [
  "notion__collaborate_within_a_workspace",
  "You can lock a page so that no one can make changes to the page’s content unless they explicitly turn the lock off"
 ],
 "N_bulkedit": [
  "notion__tables__w12c",
  "You can select multiple rows in order to edit their properties."
 ],
 "N_injection": [
  "notion__custom_agents_security_features",
  "While Notion maintains security controls that help protect against prompt injection"
 ],
 "N_noocr": [
  "notion__import_data_into_notion__w12c",
  "Scanned or image-only PDFs won’t be reliably searchable unless OCR is run first."
 ],
 "O_recents": [
  "obsidian__Plugins_Quick_switcher_md__w12c",
  "If the search term is empty, the Quick switcher shows the most recent notes."
 ],
 "O_multiselect": [
  "obsidian__Plugins_File_explorer_md",
  "you can select multiple individual files and drag them to another folder."
 ],
 "O_filterstmt": [
  "obsidian__Bases_Bases_syntax_md",
  "A filter statement is a line which evaluates to truthy or falsey when applied to a note."
 ],
 "O_datearith": [
  "obsidian__Bases_Bases_syntax_md",
  "returns true if the file was modified within the last week."
 ],
 # ── wave 12, lane 12C phase 2 (2026-10-02): the two controller rulings that needed a page quoted (G-015, G-135) ──
 "O_sortlist1": [
  "obsidian__Plugins_Search_md__w12c",
  "The following options are available: - File name (A to Z) - File name (Z to A)"
 ],
 "O_sortlist2": [
  "obsidian__Plugins_Search_md__w12c",
  "Modified time (new to old) - Modified time (old to new) - Created time (new to old) - Created time (old to new)"
 ],
 "O_outlinedrag": [
  "obsidian__Plugins_Outline_md__w12c",
  "To rearrange sections in the note, click and drag the heading within the outline."
 ]
}

# ── the pages those quotes come from (manifest of the fetch pass, research ledger R12-R14) ──
SOURCES = {
 "evernote__compare_plans": {
  "vendor": "evernote",
  "public_url": "https://evernote.com/compare-plans",
  "read_from": "https://evernote.com/compare-plans",
  "status": 200,
  "sha256": "1b00c7dd7d7d0410a6d2d2a700fd3419c567a9d10baa938bf7629bf8e44258a1",
  "fetched_utc": "2026-09-26T19:22:35Z"
 },
 "evernote__document_scanning": {
  "vendor": "evernote",
  "public_url": "https://evernote.com/features/document-scanning",
  "read_from": "https://evernote.com/features/document-scanning",
  "status": 200,
  "sha256": "37500071c376045508e017e69ad19f0a44c0b5ab756600217f84d1ac4b9e53f3",
  "fetched_utc": "2026-09-26T19:22:39Z"
 },
 "evernote__features": {
  "vendor": "evernote",
  "public_url": "https://evernote.com/features",
  "read_from": "https://evernote.com/features",
  "status": 200,
  "sha256": "56590469f87ccc3cb3932dddbf0380e52aa9385461755dc1f79e8dd459a40300",
  "fetched_utc": "2026-09-26T19:22:35Z"
 },
 "evernote__mcp": {
  "vendor": "evernote",
  "public_url": "https://evernote.com/mcp",
  "read_from": "https://evernote.com/mcp",
  "status": 200,
  "sha256": "b62b442a128f84b22dd6ed651f683ee65bf195a46d829c74fa5aa713b2938397",
  "fetched_utc": "2026-09-26T19:22:46Z"
 },
 "evernote__release_notes": {
  "vendor": "evernote",
  "public_url": "https://evernote.com/release-notes",
  "read_from": "https://evernote.com/release-notes",
  "status": 200,
  "sha256": "8a9a2a6173dbf22ceac42ae7a605e0afc95bd314c27c5213ddad3cee68e9bd9b",
  "fetched_utc": "2026-09-26T19:22:40Z"
 },
 "evernote__sync": {
  "vendor": "evernote",
  "public_url": "https://evernote.com/features/sync",
  "read_from": "https://evernote.com/features/notes-app",
  "status": 200,
  "sha256": "922c381bb80156d03f301f946c0e94ec78476a0dd62fa2937ad5b22784c24813",
  "fetched_utc": "2026-09-26T19:22:39Z"
 },
 "evernote__tasks": {
  "vendor": "evernote",
  "public_url": "https://evernote.com/features/tasks",
  "read_from": "https://evernote.com/features/tasks",
  "status": 200,
  "sha256": "bd0e835c1f3d787bc78ce767bc597490ed93d07b27c361ad83ecdc3600ad80aa",
  "fetched_utc": "2026-09-26T19:22:37Z"
 },
 "evernote__templates": {
  "vendor": "evernote",
  "public_url": "https://evernote.com/templates",
  "read_from": "https://evernote.com/templates",
  "status": 200,
  "sha256": "66de73357e4530f0383ee7f2d7b0972a7e08a96b3027cdd39ab055288c0775db",
  "fetched_utc": "2026-09-26T19:22:43Z"
 },
 "evernote__web_clipper": {
  "vendor": "evernote",
  "public_url": "https://evernote.com/features/web-clipper",
  "read_from": "https://evernote.com/features/webclipper",
  "status": 200,
  "sha256": "015a18097f2405d8332799fd881b6dc0b71c1297525dbd7944aafc4f3db2c069",
  "fetched_utc": "2026-09-26T19:22:38Z"
 },
 "evernote__whats_new": {
  "vendor": "evernote",
  "public_url": "https://evernote.com/whats-new",
  "read_from": "https://evernote.com/whats-new",
  "status": 200,
  "sha256": "5b514df2546e0361c4ae138b256129a415e0051d64c45033bf25be09aef5c84a",
  "fetched_utc": "2026-09-26T19:22:41Z"
 },
 "notion__ai_meeting_notes": {
  "vendor": "notion",
  "public_url": "https://www.notion.com/help/ai-meeting-notes",
  "read_from": "https://www.notion.com/help/ai-meeting-notes",
  "status": 200,
  "sha256": "bedca12fa5f5896419911e22db158b93e992584719e7abc79950506707b4cef9",
  "fetched_utc": "2026-09-26T19:21:49Z"
 },
 "notion__archive_pages": {
  "vendor": "notion",
  "public_url": "https://www.notion.com/help/archive-pages",
  "read_from": "https://www.notion.com/help/archive-pages",
  "status": 200,
  "sha256": "eb182f24a07659d4ee6ca676d5302f27509f3699fe2ca16c6fd618b4d01668e7",
  "fetched_utc": "2026-09-26T19:21:24Z"
 },
 "notion__autofill": {
  "vendor": "notion",
  "public_url": "https://www.notion.com/help/autofill",
  "read_from": "https://www.notion.com/help/autofill",
  "status": 200,
  "sha256": "46227010e47b7a85c5df96e5178745c5ef72809caf2ec61111182e1f3315a7bd",
  "fetched_utc": "2026-09-26T19:21:44Z"
 },
 "notion__boards": {
  "vendor": "notion",
  "public_url": "https://www.notion.com/help/boards",
  "read_from": "https://www.notion.com/help/boards",
  "status": 200,
  "sha256": "0cb2b3422e81783d0624fa2ec9e1a422a83486a5adc69e94f8052df6e442b7d5",
  "fetched_utc": "2026-09-26T19:21:28Z"
 },
 "notion__code_blocks": {
  "vendor": "notion",
  "public_url": "https://www.notion.com/help/code-blocks",
  "read_from": "https://www.notion.com/help/code-blocks",
  "status": 200,
  "sha256": "494993041cb207ed5ad4258630d432043283324dfd432eef232e16897f61b498",
  "fetched_utc": "2026-09-26T19:21:11Z"
 },
 "notion__collaborate_with_people": {
  "vendor": "notion",
  "public_url": "https://www.notion.com/help/collaborate-with-people",
  "read_from": "https://www.notion.com/help/collaborate-with-people",
  "status": 200,
  "sha256": "a74bb654bb336aea1e2253a5d59daef21be0b9176a9c41b6604926f812487483",
  "fetched_utc": "2026-09-26T19:21:50Z"
 },
 "notion__columns_headings_and_dividers": {
  "vendor": "notion",
  "public_url": "https://www.notion.com/help/columns-headings-and-dividers",
  "read_from": "https://www.notion.com/help/columns-headings-and-dividers",
  "status": 200,
  "sha256": "3f0bd43dc1946df676c7d31dd3e789efe2b60ae07448c489401c9e21c3aae78b",
  "fetched_utc": "2026-09-26T19:21:14Z"
 },
 "notion__comments_mentions_and_reminders": {
  "vendor": "notion",
  "public_url": "https://www.notion.com/help/comments-mentions-and-reminders",
  "read_from": "https://www.notion.com/help/comments-mentions-and-reminders",
  "status": 200,
  "sha256": "e29ee854d708731ed1dd21c6054c80b5047f69e1a800448d2f5501fc5820d666",
  "fetched_utc": "2026-09-26T19:21:18Z"
 },
 "notion__create_a_subpage": {
  "vendor": "notion",
  "public_url": "https://www.notion.com/help/create-a-subpage",
  "read_from": "https://www.notion.com/help/create-a-subpage",
  "status": 200,
  "sha256": "5b2f1716433a6d2ae0c62f4c8ad836319dad5efa17e65635a4266b2be9881941",
  "fetched_utc": "2026-09-26T19:21:47Z"
 },
 "notion__create_integrations_with_the_notion_api": {
  "vendor": "notion",
  "public_url": "https://www.notion.com/help/create-integrations-with-the-notion-api",
  "read_from": "https://www.notion.com/help/create-integrations-with-the-notion-api",
  "status": 200,
  "sha256": "8e2674b67a6807e4f2cc13dd60947849a7579c458440ff4e7e99a666e095f5ae",
  "fetched_utc": "2026-09-26T19:21:41Z"
 },
 "notion__create_links_and_backlinks": {
  "vendor": "notion",
  "public_url": "https://www.notion.com/help/create-links-and-backlinks",
  "read_from": "https://www.notion.com/help/create-links-and-backlinks",
  "status": 200,
  "sha256": "df003154481ad2262be8542da7f4952e318ae4af444895c95a8fe76a3b153d7f",
  "fetched_utc": "2026-09-26T19:21:22Z"
 },
 "notion__customize_and_style_your_content": {
  "vendor": "notion",
  "public_url": "https://www.notion.com/help/customize-and-style-your-content",
  "read_from": "https://www.notion.com/help/customize-and-style-your-content",
  "status": 200,
  "sha256": "da62e927d2b354d58a4fbd32a9543726484ef4ff67285203a67e61de36e55feb",
  "fetched_utc": "2026-09-26T19:21:12Z"
 },
 "notion__database_properties": {
  "vendor": "notion",
  "public_url": "https://www.notion.com/help/database-properties",
  "read_from": "https://www.notion.com/help/database-properties",
  "status": 200,
  "sha256": "7a00f2a653d7ab8470bdfe80cb204c4b2ef3cc7eaba9712bf52cb06fe97b8be0",
  "fetched_utc": "2026-09-26T19:21:29Z"
 },
 "notion__database_templates": {
  "vendor": "notion",
  "public_url": "https://www.notion.com/help/database-templates",
  "read_from": "https://www.notion.com/help/database-templates",
  "status": 200,
  "sha256": "946de4dc10d46d5aec7bf939ff07b6062cfe9b909bd9e5c886f7910b63443cd9",
  "fetched_utc": "2026-09-26T19:21:32Z"
 },
 "notion__delete_your_account": {
  "vendor": "notion",
  "public_url": "https://www.notion.com/help/delete-your-account",
  "read_from": "https://www.notion.com/help/delete-your-account",
  "status": 200,
  "sha256": "1082a3d089e0ec4e02521df0ada3ba2e7da8a00942ce841cad976fa5b7ebe3d9",
  "fetched_utc": "2026-09-26T19:21:54Z"
 },
 "notion__duplicate_delete_and_restore_content": {
  "vendor": "notion",
  "public_url": "https://www.notion.com/help/duplicate-delete-and-restore-content",
  "read_from": "https://www.notion.com/help/duplicate-delete-and-restore-content",
  "status": 200,
  "sha256": "11713d99eef0d1723edc5c49b8e9ca25d56c706dd41e8aa1ddabcefd345f6a8e",
  "fetched_utc": "2026-09-26T19:21:22Z"
 },
 "notion__embed_and_connect_other_apps": {
  "vendor": "notion",
  "public_url": "https://www.notion.com/help/embed-and-connect-other-apps",
  "read_from": "https://www.notion.com/help/embed-and-connect-other-apps",
  "status": 200,
  "sha256": "9b40b1f1d8baed398b7b1cfca5a6829bac368c4731654fc3b68361e41f672a35",
  "fetched_utc": "2026-09-26T19:21:20Z"
 },
 "notion__enterprise_search": {
  "vendor": "notion",
  "public_url": "https://www.notion.com/help/enterprise-search",
  "read_from": "https://www.notion.com/help/enterprise-search",
  "status": 200,
  "sha256": "dc1c59c5cce4d315ddbbb3acd70b49957f164c92a86a760281f8a7bafcdb4f3e",
  "fetched_utc": "2026-09-26T19:21:56Z"
 },
 "notion__export_your_content": {
  "vendor": "notion",
  "public_url": "https://www.notion.com/help/export-your-content",
  "read_from": "https://www.notion.com/help/export-your-content",
  "status": 200,
  "sha256": "938cdbf6b980b60c466490e8a9d36cd049aa69373cb56708f0e2a48cf7a29ed7",
  "fetched_utc": "2026-09-26T19:21:37Z"
 },
 "notion__images_files_and_media": {
  "vendor": "notion",
  "public_url": "https://www.notion.com/help/images-files-and-media",
  "read_from": "https://www.notion.com/help/images-files-and-media",
  "status": 200,
  "sha256": "4bbb5118e4a88409211f957e74f02a6f8bfd6f139ddaab70b075bd7b0add403d",
  "fetched_utc": "2026-09-26T19:21:15Z"
 },
 "notion__import_data_into_notion": {
  "vendor": "notion",
  "public_url": "https://www.notion.com/help/import-data-into-notion",
  "read_from": "https://www.notion.com/help/import-data-into-notion",
  "status": 200,
  "sha256": "561e5b7091d7cef8e8e3ca1dc4c2fbb4582a1eb8dbce4b837f833f95032741f7",
  "fetched_utc": "2026-09-26T19:21:38Z"
 },
 "notion__keyboard_shortcuts": {
  "vendor": "notion",
  "public_url": "https://www.notion.com/help/keyboard-shortcuts",
  "read_from": "https://www.notion.com/help/keyboard-shortcuts",
  "status": 200,
  "sha256": "2490a50643d68a2010ca7113b9d81559726edcc9cac53011773842ca17308742",
  "fetched_utc": "2026-09-26T19:21:16Z"
 },
 "notion__link_previews": {
  "vendor": "notion",
  "public_url": "https://www.notion.com/help/link-previews",
  "read_from": "https://www.notion.com/help/link-previews",
  "status": 200,
  "sha256": "74f1fdcc8a4a12d62369d76c556ef4cddec3c566a4d76a09d65ef299a4794ef3",
  "fetched_utc": "2026-09-26T19:21:19Z"
 },
 "notion__math_equations": {
  "vendor": "notion",
  "public_url": "https://www.notion.com/help/math-equations",
  "read_from": "https://www.notion.com/help/math-equations",
  "status": 200,
  "sha256": "da9899844354d0a24a09233a42a2f749887561c3b8bf149f2d9e2576b79c40d3",
  "fetched_utc": "2026-09-26T19:21:12Z"
 },
 "notion__navigate_with_the_sidebar": {
  "vendor": "notion",
  "public_url": "https://www.notion.com/help/navigate-with-the-sidebar",
  "read_from": "https://www.notion.com/help/navigate-with-the-sidebar",
  "status": 200,
  "sha256": "921dea3c0aaf7a2049c63e37098b8839ab5b2bf6323c3e030513f71a2e337b33",
  "fetched_utc": "2026-09-26T19:21:47Z"
 },
 "notion__notion_ai_faqs": {
  "vendor": "notion",
  "public_url": "https://www.notion.com/help/notion-ai-faqs",
  "read_from": "https://www.notion.com/help/notion-ai-faqs",
  "status": 200,
  "sha256": "56f762d23a0239b47d97e3a8528a1fbe637b9ee7b9ceafe831fa57d548b5216a",
  "fetched_utc": "2026-09-26T19:21:42Z"
 },
 "notion__public_pages_and_web_publishing": {
  "vendor": "notion",
  "public_url": "https://www.notion.com/help/public-pages-and-web-publishing",
  "read_from": "https://www.notion.com/help/public-pages-and-web-publishing",
  "status": 200,
  "sha256": "9f98feb35295df3e6703311d68f0fa3b033dd03c83702350f82b20dd12cbc7e4",
  "fetched_utc": "2026-09-26T19:21:36Z"
 },
 "notion__relations_and_rollups": {
  "vendor": "notion",
  "public_url": "https://www.notion.com/help/relations-and-rollups",
  "read_from": "https://www.notion.com/help/relations-and-rollups",
  "status": 200,
  "sha256": "08f462a6d904cc516a5884ef59b170c9c53edd9a8e166b25f0bc4c210b987024",
  "fetched_utc": "2026-09-26T19:21:25Z"
 },
 "notion__reminders": {
  "vendor": "notion",
  "public_url": "https://www.notion.com/help/reminders",
  "read_from": "https://www.notion.com/help/reminders",
  "status": 200,
  "sha256": "835e7f6af07c4e0e30b98d6c23f8557f7c370880c01803d06348a555f9e0b68d",
  "fetched_utc": "2026-09-26T19:21:19Z"
 },
 "notion__research_mode": {
  "vendor": "notion",
  "public_url": "https://www.notion.com/help/research-mode",
  "read_from": "https://www.notion.com/help/research-mode",
  "status": 200,
  "sha256": "fc12015d58031ed13e299db34aa07f8cc99f8df7c5f7c50cc6b7f03ec00a1c47",
  "fetched_utc": "2026-09-26T19:21:42Z"
 },
 "notion__search": {
  "vendor": "notion",
  "public_url": "https://www.notion.com/help/search",
  "read_from": "https://www.notion.com/help/search",
  "status": 200,
  "sha256": "f16df490f0ba0969c12a66375accd03e73d4fd2492138a6551da8c45ed3a00b6",
  "fetched_utc": "2026-09-26T19:21:20Z"
 },
 "notion__security_and_privacy": {
  "vendor": "notion",
  "public_url": "https://www.notion.com/help/security-and-privacy",
  "read_from": "https://www.notion.com/help/security-and-privacy",
  "status": 200,
  "sha256": "ebff8b4c456c7f6cf6b8fcee3d2effacf0905e8dd9ba1a3f0dc381a58c5543a3",
  "fetched_utc": "2026-09-26T19:21:41Z"
 },
 "notion__sharing_and_permissions": {
  "vendor": "notion",
  "public_url": "https://www.notion.com/help/sharing-and-permissions",
  "read_from": "https://www.notion.com/help/sharing-and-permissions",
  "status": 200,
  "sha256": "a4d19bd79c78d639b60316bf14be30bd08fbee419485527d4884baf90791a74e",
  "fetched_utc": "2026-09-26T19:21:37Z"
 },
 "notion__start_with_a_template": {
  "vendor": "notion",
  "public_url": "https://www.notion.com/help/start-with-a-template",
  "read_from": "https://www.notion.com/help/start-with-a-template",
  "status": 200,
  "sha256": "319e44cac4939f5aaf173c8fd3434e3f3db4a1192779227a0cef254f6169f9d7",
  "fetched_utc": "2026-09-26T19:21:33Z"
 },
 "notion__tables": {
  "vendor": "notion",
  "public_url": "https://www.notion.com/help/tables",
  "read_from": "https://www.notion.com/help/tables",
  "status": 200,
  "sha256": "5379d37206deb7b92c868f4e8e4ca322a5c6564f8781c92f0aa8c9edc9e409a2",
  "fetched_utc": "2026-09-26T19:21:16Z"
 },
 "notion__tasks_and_dependencies": {
  "vendor": "notion",
  "public_url": "https://www.notion.com/help/tasks-and-dependencies",
  "read_from": "https://www.notion.com/help/tasks-and-dependencies",
  "status": 200,
  "sha256": "0db09e46ff639ea24017e96b3a6cb855514e29b10ad130c59a97d2667c83098d",
  "fetched_utc": "2026-09-26T19:21:45Z"
 },
 "notion__timelines": {
  "vendor": "notion",
  "public_url": "https://www.notion.com/help/timelines",
  "read_from": "https://www.notion.com/help/timelines",
  "status": 200,
  "sha256": "a9b0d98e8411ebcfdb2860c2545afa1639b954f30a44e952f970de9df3f81f81",
  "fetched_utc": "2026-09-26T19:21:27Z"
 },
 "notion__use_pages_offline": {
  "vendor": "notion",
  "public_url": "https://www.notion.com/help/use-pages-offline",
  "read_from": "https://www.notion.com/help/use-pages-offline",
  "status": 200,
  "sha256": "fa77f3cb07ac241437058d7cc12fd0ed8164f601cb7184872df921253457e1cf",
  "fetched_utc": "2026-09-26T19:21:34Z"
 },
 "notion__views_filters_and_sorts": {
  "vendor": "notion",
  "public_url": "https://www.notion.com/help/views-filters-and-sorts",
  "read_from": "https://www.notion.com/help/views-filters-and-sorts",
  "status": 200,
  "sha256": "717e94df101b771830c76f53408173c49bfc302a8e4b3b1cf156fa410657a472",
  "fetched_utc": "2026-09-26T19:21:29Z"
 },
 "notion__web_clipper": {
  "vendor": "notion",
  "public_url": "https://www.notion.com/help/web-clipper",
  "read_from": "https://www.notion.com/help/web-clipper",
  "status": 200,
  "sha256": "230c6d9f23215eef730eea1ee0a0837f808681053582a01010f40dce3e1c6602",
  "fetched_utc": "2026-09-26T19:21:40Z"
 },
 "notion__writing_and_editing_basics": {
  "vendor": "notion",
  "public_url": "https://www.notion.com/help/writing-and-editing-basics",
  "read_from": "https://www.notion.com/help/writing-and-editing-basics",
  "status": 200,
  "sha256": "e714c84bc8e9bbc2a5caea826030eb574ee4e94ba938f9134f35d266357c8abe",
  "fetched_utc": "2026-09-26T19:21:14Z"
 },
 "obsidian__Bases_Introduction_to_Bases_md": {
  "vendor": "obsidian",
  "public_url": "https://obsidian.md/help/bases",
  "read_from": "https://publish-01.obsidian.md/access/f786db9fac45774fa4f0d8112e232d67/Bases/Introduction%20to%20Bases.md",
  "status": 200,
  "sha256": "e6da456c090f943781198012497ab179bb95928c051aa1748eebd56cb591953f",
  "fetched_utc": "2026-09-26T19:22:18Z"
 },
 "obsidian__Bases_Layouts_Kanban_view_md": {
  "vendor": "obsidian",
  "public_url": "https://obsidian.md/help/bases/views/kanban",
  "read_from": "https://publish-01.obsidian.md/access/f786db9fac45774fa4f0d8112e232d67/Bases/Layouts/Kanban%20view.md",
  "status": 200,
  "sha256": "434e830347a27790b138eed90ed0f7976bfa03d244574dd42e34609ce9b96707",
  "fetched_utc": "2026-09-26T19:22:22Z"
 },
 "obsidian__Bases_Views_md": {
  "vendor": "obsidian",
  "public_url": "https://obsidian.md/help/bases/views",
  "read_from": "https://publish-01.obsidian.md/access/f786db9fac45774fa4f0d8112e232d67/Bases/Views.md",
  "status": 200,
  "sha256": "1e00fbf9cd2ca1f46dd9e7ed821dcb008bc517c2bb9f92a8590e7b2121a65f16",
  "fetched_utc": "2026-09-26T19:22:20Z"
 },
 "obsidian__Editing_and_formatting_Advanced_formatting_syntax_md": {
  "vendor": "obsidian",
  "public_url": "https://obsidian.md/help/advanced-syntax",
  "read_from": "https://publish-01.obsidian.md/access/f786db9fac45774fa4f0d8112e232d67/Editing%20and%20formatting/Advanced%20formatting%20syntax.md",
  "status": 200,
  "sha256": "15ed1c714c0e8a4dd48ac05ce53df787d1eda241c78d8b27a091f142cbe26307",
  "fetched_utc": "2026-09-26T19:21:59Z"
 },
 "obsidian__Editing_and_formatting_Attachments_md": {
  "vendor": "obsidian",
  "public_url": "https://obsidian.md/help/attachments",
  "read_from": "https://publish-01.obsidian.md/access/f786db9fac45774fa4f0d8112e232d67/Editing%20and%20formatting/Attachments.md",
  "status": 200,
  "sha256": "7e3ec7096b7f7a4c4c523cc93b1d8de1a98c15141e862a243098387b8f112493",
  "fetched_utc": "2026-09-26T19:22:02Z"
 },
 "obsidian__Editing_and_formatting_Basic_formatting_syntax_md": {
  "vendor": "obsidian",
  "public_url": "https://obsidian.md/help/syntax",
  "read_from": "https://publish-01.obsidian.md/access/f786db9fac45774fa4f0d8112e232d67/Editing%20and%20formatting/Basic%20formatting%20syntax.md",
  "status": 200,
  "sha256": "739a3740a782d4a8979d8f90745bf0a0e2a64daab865c6db0d8ef8060dabfd64",
  "fetched_utc": "2026-09-26T19:21:59Z"
 },
 "obsidian__Editing_and_formatting_Callouts_md": {
  "vendor": "obsidian",
  "public_url": "https://obsidian.md/help/callouts",
  "read_from": "https://publish-01.obsidian.md/access/f786db9fac45774fa4f0d8112e232d67/Editing%20and%20formatting/Callouts.md",
  "status": 200,
  "sha256": "5d12e34b9fb68c6b7ad0ea39d80fb11267b0406cd204f61d4c00f2d5dea9bab6",
  "fetched_utc": "2026-09-26T19:22:00Z"
 },
 "obsidian__Editing_and_formatting_Embed_web_pages_md": {
  "vendor": "obsidian",
  "public_url": "https://obsidian.md/help/embed-web-pages",
  "read_from": "https://publish-01.obsidian.md/access/f786db9fac45774fa4f0d8112e232d67/Editing%20and%20formatting/Embed%20web%20pages.md",
  "status": 200,
  "sha256": "7d862f9af80d45a2e50e161b1bd47580f8caae68306e2202623abd0c65235f1e",
  "fetched_utc": "2026-09-26T19:22:01Z"
 },
 "obsidian__Editing_and_formatting_Properties_md": {
  "vendor": "obsidian",
  "public_url": "https://obsidian.md/help/properties",
  "read_from": "https://publish-01.obsidian.md/access/f786db9fac45774fa4f0d8112e232d67/Editing%20and%20formatting/Properties.md",
  "status": 200,
  "sha256": "bd81f389b54d3d2c596465078c80f9c5769566aacdb4a83ee5d8b5ed882f5cf3",
  "fetched_utc": "2026-09-26T19:22:01Z"
 },
 "obsidian__Editing_and_formatting_Tags_md": {
  "vendor": "obsidian",
  "public_url": "https://obsidian.md/help/tags",
  "read_from": "https://publish-01.obsidian.md/access/f786db9fac45774fa4f0d8112e232d67/Editing%20and%20formatting/Tags.md",
  "status": 200,
  "sha256": "20214764032cb166d6e13cc39605b654d691f5a17ad70437d6df81e28fc149dc",
  "fetched_utc": "2026-09-26T19:22:00Z"
 },
 "obsidian__Extending_Obsidian_Community_plugins_md": {
  "vendor": "obsidian",
  "public_url": "https://obsidian.md/help/community-plugins",
  "read_from": "https://publish-01.obsidian.md/access/f786db9fac45774fa4f0d8112e232d67/Extending%20Obsidian/Community%20plugins.md",
  "status": 200,
  "sha256": "7093086daa5a14a814307b113f435eff2a80e90e836a728fec681e33c236e9a1",
  "fetched_utc": "2026-09-26T19:22:29Z"
 },
 "obsidian__Extending_Obsidian_Obsidian_URI_md": {
  "vendor": "obsidian",
  "public_url": "https://obsidian.md/help/uri",
  "read_from": "https://publish-01.obsidian.md/access/f786db9fac45774fa4f0d8112e232d67/Extending%20Obsidian/Obsidian%20URI.md",
  "status": 200,
  "sha256": "d401a97319322d3d3abf993dc18ab859c127060a54927b01a901781addecd5c1",
  "fetched_utc": "2026-09-26T19:22:30Z"
 },
 "obsidian__Files_and_folders_Accepted_file_formats_md": {
  "vendor": "obsidian",
  "public_url": "https://obsidian.md/help/file-formats",
  "read_from": "https://publish-01.obsidian.md/access/f786db9fac45774fa4f0d8112e232d67/Files%20and%20folders/Accepted%20file%20formats.md",
  "status": 200,
  "sha256": "95ede78937600de68ad15ade8cf5044f05261eac9f72187c2880f6a7c71b517e",
  "fetched_utc": "2026-09-26T19:22:03Z"
 },
 "obsidian__Files_and_folders_How_Obsidian_stores_data_md": {
  "vendor": "obsidian",
  "public_url": "https://obsidian.md/help/data-storage",
  "read_from": "https://publish-01.obsidian.md/access/f786db9fac45774fa4f0d8112e232d67/Files%20and%20folders/How%20Obsidian%20stores%20data.md",
  "status": 200,
  "sha256": "add03088da7be4ab2fd364918c17b006d646eafedffada5440db83217f6942e6",
  "fetched_utc": "2026-09-26T19:22:04Z"
 },
 "obsidian__Files_and_folders_Manage_notes_md": {
  "vendor": "obsidian",
  "public_url": "https://obsidian.md/help/manage-notes",
  "read_from": "https://publish-01.obsidian.md/access/f786db9fac45774fa4f0d8112e232d67/Files%20and%20folders/Manage%20notes.md",
  "status": 200,
  "sha256": "fdbf9ceee5331ed554824e807b22b8b106d0790d83871d706b52f9c90487dead",
  "fetched_utc": "2026-09-26T19:22:04Z"
 },
 "obsidian__Getting_started_Import_notes_md": {
  "vendor": "obsidian",
  "public_url": "https://obsidian.md/help/import",
  "read_from": "https://publish-01.obsidian.md/access/f786db9fac45774fa4f0d8112e232d67/Getting%20started/Import%20notes.md",
  "status": 200,
  "sha256": "b8d724d7d92ced225ce1ece0ab6f83b0d66b5446fb085fb474f7ae1193cf7a8d",
  "fetched_utc": "2026-09-26T19:22:28Z"
 },
 "obsidian__Home_md": {
  "vendor": "obsidian",
  "public_url": "https://obsidian.md/help//",
  "read_from": "https://publish-01.obsidian.md/access/f786db9fac45774fa4f0d8112e232d67/Home.md",
  "status": 200,
  "sha256": "406152da3e87c25a3d6037a4d0cc6046ed63fed6488b08d5c72e2a0de70977dc",
  "fetched_utc": "2026-09-26T19:22:33Z"
 },
 "obsidian__Import_notes_Import_from_Evernote_md": {
  "vendor": "obsidian",
  "public_url": "https://obsidian.md/help/import/evernote",
  "read_from": "https://publish-01.obsidian.md/access/f786db9fac45774fa4f0d8112e232d67/Import%20notes/Import%20from%20Evernote.md",
  "status": 200,
  "sha256": "8a3159ceb559edb89f617dfed742b1e426e93dd66919af93b7c19587eb16f3c9",
  "fetched_utc": "2026-09-26T19:22:29Z"
 },
 "obsidian__Linking_notes_and_files_Internal_links_md": {
  "vendor": "obsidian",
  "public_url": "https://obsidian.md/help/links",
  "read_from": "https://publish-01.obsidian.md/access/f786db9fac45774fa4f0d8112e232d67/Linking%20notes%20and%20files/Internal%20links.md",
  "status": 200,
  "sha256": "a143a6c1e2aea49d2e9a443da319a3a0e086f41512978dadb73a294c977a3b0f",
  "fetched_utc": "2026-09-26T19:22:05Z"
 },
 "obsidian__Obsidian_Obsidian_for_iOS_and_iPadOS_md": {
  "vendor": "obsidian",
  "public_url": "https://obsidian.md/help/ios",
  "read_from": "https://publish-01.obsidian.md/access/f786db9fac45774fa4f0d8112e232d67/Obsidian/Obsidian%20for%20iOS%20and%20iPadOS.md",
  "status": 200,
  "sha256": "dd7de3865ebc42958b473b0ccbd736f6f991719ce17f164e40f9dac854afb9d4",
  "fetched_utc": "2026-09-26T19:22:31Z"
 },
 "obsidian__Obsidian_Publish_Introduction_to_Obsidian_Publish_md": {
  "vendor": "obsidian",
  "public_url": "https://obsidian.md/help/publish",
  "read_from": "https://publish-01.obsidian.md/access/f786db9fac45774fa4f0d8112e232d67/Obsidian%20Publish/Introduction%20to%20Obsidian%20Publish.md",
  "status": 200,
  "sha256": "0cdb8768b1cd6d92030b77efbe60e9057afde09f82c4959bbd3f81795e59124d",
  "fetched_utc": "2026-09-26T19:22:26Z"
 },
 "obsidian__Obsidian_Sync_Collaborate_on_a_shared_vault_md": {
  "vendor": "obsidian",
  "public_url": "https://obsidian.md/help/sync/collaborate",
  "read_from": "https://publish-01.obsidian.md/access/f786db9fac45774fa4f0d8112e232d67/Obsidian%20Sync/Collaborate%20on%20a%20shared%20vault.md",
  "status": 200,
  "sha256": "05cb5c9f2e99b8767f7824acd63bbe09322e2ac41da3ebe8052772a622b19068",
  "fetched_utc": "2026-09-26T19:22:17Z"
 },
 "obsidian__Obsidian_Sync_Security_and_privacy_md": {
  "vendor": "obsidian",
  "public_url": "https://obsidian.md/help/sync/security",
  "read_from": "https://publish-01.obsidian.md/access/f786db9fac45774fa4f0d8112e232d67/Obsidian%20Sync/Security%20and%20privacy.md",
  "status": 200,
  "sha256": "a3d3cc16006f10769793ee512f4f4ec0cc26dfa39dd9e3cdfd9a7e692c194337",
  "fetched_utc": "2026-09-26T19:22:17Z"
 },
 "obsidian__Obsidian_Web_Clipper_Introduction_to_Obsidian_Web_Clipper_md": {
  "vendor": "obsidian",
  "public_url": "https://obsidian.md/help/web-clipper",
  "read_from": "https://publish-01.obsidian.md/access/f786db9fac45774fa4f0d8112e232d67/Obsidian%20Web%20Clipper/Introduction%20to%20Obsidian%20Web%20Clipper.md",
  "status": 200,
  "sha256": "3dcc88bf04f3b270ffdd132226627f988e2fd476a19c5c1c0c74ef7c99b541a4",
  "fetched_utc": "2026-09-26T19:22:27Z"
 },
 "obsidian__Plugins_Audio_recorder_md": {
  "vendor": "obsidian",
  "public_url": "https://obsidian.md/help/plugins/audio-recorder",
  "read_from": "https://publish-01.obsidian.md/access/f786db9fac45774fa4f0d8112e232d67/Plugins/Audio%20recorder.md",
  "status": 200,
  "sha256": "087745839d9ff5c1d24d29f7cc8e7473b24b8d718f834f0263d6f9b4d5178191",
  "fetched_utc": "2026-09-26T19:22:13Z"
 },
 "obsidian__Plugins_Backlinks_md": {
  "vendor": "obsidian",
  "public_url": "https://obsidian.md/help/plugins/backlinks",
  "read_from": "https://publish-01.obsidian.md/access/f786db9fac45774fa4f0d8112e232d67/Plugins/Backlinks.md",
  "status": 200,
  "sha256": "d6f71bc20352f1af0338cad780095d0c32c65af6bfffd0065f315b3a8685d928",
  "fetched_utc": "2026-09-26T19:22:08Z"
 },
 "obsidian__Plugins_Bookmarks_md": {
  "vendor": "obsidian",
  "public_url": "https://obsidian.md/help/plugins/bookmarks",
  "read_from": "https://publish-01.obsidian.md/access/f786db9fac45774fa4f0d8112e232d67/Plugins/Bookmarks.md",
  "status": 200,
  "sha256": "230e8848ab27b4c8af1c710319f53f83940c601d7e6b2e71b27241ca4f729da6",
  "fetched_utc": "2026-09-26T19:22:11Z"
 },
 "obsidian__Plugins_Command_palette_md": {
  "vendor": "obsidian",
  "public_url": "https://obsidian.md/help/plugins/command-palette",
  "read_from": "https://publish-01.obsidian.md/access/f786db9fac45774fa4f0d8112e232d67/Plugins/Command%20palette.md",
  "status": 200,
  "sha256": "1593fa2b69849a36208a16dd0b36b7f4b79c4c137368cdf9ecc537339b78a385",
  "fetched_utc": "2026-09-26T19:22:08Z"
 },
 "obsidian__Plugins_Daily_notes_md": {
  "vendor": "obsidian",
  "public_url": "https://obsidian.md/help/plugins/daily-notes",
  "read_from": "https://publish-01.obsidian.md/access/f786db9fac45774fa4f0d8112e232d67/Plugins/Daily%20notes.md",
  "status": 200,
  "sha256": "776472f0c26adcc0c7556b4a7f3b7e3440720b48b724689a0282985fede4c2b8",
  "fetched_utc": "2026-09-26T19:22:09Z"
 },
 "obsidian__Plugins_File_recovery_md": {
  "vendor": "obsidian",
  "public_url": "https://obsidian.md/help/plugins/file-recovery",
  "read_from": "https://publish-01.obsidian.md/access/f786db9fac45774fa4f0d8112e232d67/Plugins/File%20recovery.md",
  "status": 200,
  "sha256": "57ae93fa2bd4d0729663d61367a3c7a3fa9c424fa275166f579b081d6d1aeefd",
  "fetched_utc": "2026-09-26T19:22:11Z"
 },
 "obsidian__Plugins_Graph_view_md": {
  "vendor": "obsidian",
  "public_url": "https://obsidian.md/help/plugins/graph",
  "read_from": "https://publish-01.obsidian.md/access/f786db9fac45774fa4f0d8112e232d67/Plugins/Graph%20view.md",
  "status": 200,
  "sha256": "4dc8b65df8d67062a71ba56b91a39a97850b141e5b2cb8c851089030d431f61b",
  "fetched_utc": "2026-09-26T19:22:09Z"
 },
 "obsidian__Plugins_Outline_md": {
  "vendor": "obsidian",
  "public_url": "https://obsidian.md/help/plugins/outline",
  "read_from": "https://publish-01.obsidian.md/access/f786db9fac45774fa4f0d8112e232d67/Plugins/Outline.md",
  "status": 200,
  "sha256": "ac779b3ebc6ad8861a4fc2fb420daf1ca1232d9121b39e104b81454e235919bd",
  "fetched_utc": "2026-09-26T19:22:06Z"
 },
 "obsidian__Plugins_Page_preview_md": {
  "vendor": "obsidian",
  "public_url": "https://obsidian.md/help/plugins/page-preview",
  "read_from": "https://publish-01.obsidian.md/access/f786db9fac45774fa4f0d8112e232d67/Plugins/Page%20preview.md",
  "status": 200,
  "sha256": "06e580bf7034d979e414ae5d9079a8a00a2854bdc33f8ca779657602786d0c27",
  "fetched_utc": "2026-09-26T19:22:14Z"
 },
 "obsidian__Plugins_Quick_switcher_md": {
  "vendor": "obsidian",
  "public_url": "https://obsidian.md/help/plugins/quick-switcher",
  "read_from": "https://publish-01.obsidian.md/access/f786db9fac45774fa4f0d8112e232d67/Plugins/Quick%20switcher.md",
  "status": 200,
  "sha256": "114f299e96fe1bae5d6b75175ee45bad4002e1ebd966a7389a3ca188bfca493b",
  "fetched_utc": "2026-09-26T19:22:07Z"
 },
 "obsidian__Plugins_Search_md": {
  "vendor": "obsidian",
  "public_url": "https://obsidian.md/help/plugins/search",
  "read_from": "https://publish-01.obsidian.md/access/f786db9fac45774fa4f0d8112e232d67/Plugins/Search.md",
  "status": 200,
  "sha256": "5a797fdbe551de35f662a64a02d0a275ebb9a65750b1a6f776860cf5c5e4b7f3",
  "fetched_utc": "2026-09-26T19:22:07Z"
 },
 "obsidian__Plugins_Slash_commands_md": {
  "vendor": "obsidian",
  "public_url": "https://obsidian.md/help/plugins/slash-commands",
  "read_from": "https://publish-01.obsidian.md/access/f786db9fac45774fa4f0d8112e232d67/Plugins/Slash%20commands.md",
  "status": 200,
  "sha256": "d429b6c6846eca55bfc1b3d07788fdce20a32c682f8cbf7cc6292d341119ae44",
  "fetched_utc": "2026-09-26T19:22:12Z"
 },
 "obsidian__Plugins_Templates_md": {
  "vendor": "obsidian",
  "public_url": "https://obsidian.md/help/plugins/templates",
  "read_from": "https://publish-01.obsidian.md/access/f786db9fac45774fa4f0d8112e232d67/Plugins/Templates.md",
  "status": 200,
  "sha256": "abf70b302301e49448c47f4a770d4d466d0946e5dfacb66b36fbd0aed0efbb65",
  "fetched_utc": "2026-09-26T19:22:10Z"
 },
 "obsidian__Plugins_Word_count_md": {
  "vendor": "obsidian",
  "public_url": "https://obsidian.md/help/plugins/word-count",
  "read_from": "https://publish-01.obsidian.md/access/f786db9fac45774fa4f0d8112e232d67/Plugins/Word%20count.md",
  "status": 200,
  "sha256": "f3f352fabf15b2b8b07b9f980d8d3ffeaa12465b0c0cee52c8a3abee17896122",
  "fetched_utc": "2026-09-26T19:22:06Z"
 },
 "obsidian__User_interface_Tabs_md": {
  "vendor": "obsidian",
  "public_url": "https://obsidian.md/help/tabs",
  "read_from": "https://publish-01.obsidian.md/access/f786db9fac45774fa4f0d8112e232d67/User%20interface/Tabs.md",
  "status": 200,
  "sha256": "1b79b32f48a04ade5aa04e9eb515a6ae45afa7f61d70eda9704c9ff6cb6a8fe5",
  "fetched_utc": "2026-09-26T19:22:23Z"
 },
 "evernote_help__208313438": {
  "vendor": "evernote",
  "kind": "browser-read",
  "public_url": "https://help.evernote.com/hc/en-us/articles/208313438-Restore-a-note-from-the-trash",
  "read_from": "help.evernote.com Zendesk article JSON, read in a real Chrome (controller)",
  "rrow": "R17",
  "sha256": None,
  "fetched_utc": "2026-09-26"
 },
 "evernote_help__208313858": {
  "vendor": "evernote",
  "kind": "browser-read",
  "public_url": "https://help.evernote.com/hc/en-us/articles/208313858-Use-note-history-to-view-and-restore-older-versions-of-a-note",
  "read_from": "help.evernote.com Zendesk article JSON, real Chrome",
  "rrow": "R17",
  "sha256": None,
  "fetched_utc": "2026-09-26"
 },
 "evernote_help__360056549574": {
  "vendor": "evernote",
  "kind": "browser-read",
  "public_url": "https://help.evernote.com/hc/en-us/articles/360056549574-Permanently-close-your-Evernote-account",
  "read_from": "help.evernote.com Zendesk article JSON, real Chrome",
  "rrow": "R17",
  "sha256": None,
  "fetched_utc": "2026-09-26"
 },
 "evernote_help__209005917": {
  "vendor": "evernote",
  "kind": "browser-read",
  "public_url": "https://help.evernote.com/hc/en-us/articles/209005917-Access-notes-offline",
  "read_from": "help.evernote.com Zendesk article JSON, real Chrome",
  "rrow": "R17",
  "sha256": None,
  "fetched_utc": "2026-09-26"
 },
 "evernote_help__208313828": {
  "vendor": "evernote",
  "kind": "browser-read",
  "public_url": "https://help.evernote.com/hc/en-us/articles/208313828-Use-advanced-search-syntax",
  "read_from": "help.evernote.com Zendesk article JSON, real Chrome",
  "rrow": "R17",
  "sha256": None,
  "fetched_utc": "2026-09-26"
 },
 "evernote_help__209005647": {
  "vendor": "evernote",
  "kind": "browser-read",
  "public_url": "https://help.evernote.com/hc/en-us/articles/209005647-Find-what-you-need",
  "read_from": "help.evernote.com Zendesk article JSON, real Chrome",
  "rrow": "R17",
  "sha256": None,
  "fetched_utc": "2026-09-26"
 },
 "evernote_help__45706285591955": {
  "vendor": "evernote",
  "kind": "browser-read",
  "public_url": "https://help.evernote.com/hc/en-us/articles/45706285591955-Semantic-search",
  "read_from": "help.evernote.com Zendesk article JSON, real Chrome",
  "rrow": "R17",
  "sha256": None,
  "fetched_utc": "2026-09-26"
 },
 "evernote_help__46319409880211": {
  "vendor": "evernote",
  "kind": "browser-read",
  "public_url": "https://help.evernote.com/hc/en-us/articles/46319409880211-AI-Assistant",
  "read_from": "help.evernote.com Zendesk article JSON, real Chrome",
  "rrow": "R17",
  "sha256": None,
  "fetched_utc": "2026-09-26"
 },
 "evernote_help__209005267": {
  "vendor": "evernote",
  "kind": "browser-read",
  "public_url": "https://help.evernote.com/hc/en-us/articles/209005267-Saved-searches",
  "read_from": "help.evernote.com Zendesk article JSON, real Chrome",
  "rrow": "R17",
  "sha256": None,
  "fetched_utc": "2026-09-26"
 },
 # ── wave 12, lane 12C phase 1: the R18 fetch pass (2026-10-02, scripted HTTP GET; help.evernote.com articles read
 # through the help centre's own article JSON, which answered 200 where R15's page fetch met a challenge) ──
 "evernote__release_notes_11_35_6": {
  "vendor": "evernote",
  "public_url": "https://evernote.com/release-notes/11.35.6",
  "read_from": "https://evernote.com/release-notes/11.35.6",
  "status": 200,
  "sha256": "f24708e6980f088986b2abcffbfe08e3eff88e5aaa0cc704da0540168744ef42",
  "fetched_utc": "2026-10-02T16:34:15Z",
  "rrow": "R18"
 },
 "evernote__release_notes_11_36_4": {
  "vendor": "evernote",
  "public_url": "https://evernote.com/release-notes/11.36.4",
  "read_from": "https://evernote.com/release-notes/11.36.4",
  "status": 200,
  "sha256": "03c2bf28c2f6167095301017994c3e9ae5d23d98badaca82cfe9c2ab88918923",
  "fetched_utc": "2026-10-02T16:34:14Z",
  "rrow": "R18"
 },
 "evernote__security": {
  "vendor": "evernote",
  "public_url": "https://evernote.com/security",
  "read_from": "https://evernote.com/security",
  "status": 200,
  "sha256": "0f7317dd894ed3b9d6293cb32f262b4f65c40a26632eca3ac5456d66ad9f2c31",
  "fetched_utc": "2026-10-02T16:34:13Z",
  "rrow": "R18"
 },
 "evernote_hc__115006310828": {
  "vendor": "evernote",
  "public_url": "https://help.evernote.com/hc/en-us/articles/115006310828-How-to-work-with-separate-individual-and-team-accounts",
  "read_from": "https://help.evernote.com/api/v2/help_center/en-us/articles/115006310828.json",
  "status": 200,
  "sha256": "fcfba439888494ac3a362324de01293763fc5e82893c250b855ccabad98ec5d7",
  "fetched_utc": "2026-10-02T16:34:09Z",
  "rrow": "R18"
 },
 "evernote_hc__16280830963091": {
  "vendor": "evernote",
  "public_url": "https://help.evernote.com/hc/en-us/articles/16280830963091-AI-Note-Cleanup-Overview",
  "read_from": "https://help.evernote.com/api/v2/help_center/en-us/articles/16280830963091.json",
  "status": 200,
  "sha256": "33e09abb7ff31168fa7d784a41c93727cdb01eb6cef325615e65c819077aa0fd",
  "fetched_utc": "2026-10-02T16:34:08Z",
  "rrow": "R18"
 },
 "evernote_hc__209005587": {
  "vendor": "evernote",
  "public_url": "https://help.evernote.com/hc/en-us/articles/209005587-Annotate-images-and-PDFs",
  "read_from": "https://help.evernote.com/api/v2/help_center/en-us/articles/209005587.json",
  "status": 200,
  "sha256": "39e8f5efc51915df99f468d06bd202267e6f1ec9844ae846212a044ad0c0e6fe",
  "fetched_utc": "2026-10-02T16:34:04Z",
  "rrow": "R18"
 },
 "evernote_hc__209125877": {
  "vendor": "evernote",
  "public_url": "https://help.evernote.com/hc/en-us/articles/209125877-Evernote-Web-Clipper-Quick-Start-Guide",
  "read_from": "https://help.evernote.com/api/v2/help_center/en-us/articles/209125877.json",
  "status": 200,
  "sha256": "cd55348de8ed0a2a68f2644d63d2a6a23d0c7f771db70a0e243bd35c0184fd80",
  "fetched_utc": "2026-10-02T16:34:12Z",
  "rrow": "R18"
 },
 "evernote_hc__32780525935763": {
  "vendor": "evernote",
  "public_url": "https://help.evernote.com/hc/en-us/articles/32780525935763-Daily-notes",
  "read_from": "https://help.evernote.com/api/v2/help_center/en-us/articles/32780525935763.json",
  "status": 200,
  "sha256": "c08b499bf4d597c8a508ea58317bd2dc5425e96c724e9017161510b17684bf2a",
  "fetched_utc": "2026-10-02T16:34:11Z",
  "rrow": "R18"
 },
 "evernote_hc__34377080881939": {
  "vendor": "evernote",
  "public_url": "https://help.evernote.com/hc/en-us/articles/34377080881939-Share-notes",
  "read_from": "https://help.evernote.com/api/v2/help_center/en-us/articles/34377080881939.json",
  "status": 200,
  "sha256": "a613360e151c5d7e8a1f17cfe71228d46aea9dcab3cee8add987c5a02f83dd81",
  "fetched_utc": "2026-10-02T16:34:04Z",
  "rrow": "R18"
 },
 "evernote_hc__35610214032531": {
  "vendor": "evernote",
  "public_url": "https://help.evernote.com/hc/en-us/articles/35610214032531-Add-a-math-formula-with-LaTeX-syntax",
  "read_from": "https://help.evernote.com/api/v2/help_center/en-us/articles/35610214032531.json",
  "status": 200,
  "sha256": "d107b79039a6b2768611875aa7bef28c54c4b84b6fe60a74e2633dc560baa922",
  "fetched_utc": "2026-10-02T16:34:05Z",
  "rrow": "R18"
 },
 "evernote_hc__35615740098835": {
  "vendor": "evernote",
  "public_url": "https://help.evernote.com/hc/en-us/articles/35615740098835-How-to-check-the-size-of-a-note",
  "read_from": "https://help.evernote.com/api/v2/help_center/en-us/articles/35615740098835.json",
  "status": 200,
  "sha256": "73d1251a2145884b2b4974538970ad848187fbedf4533cee5c76a301d70d9acf",
  "fetched_utc": "2026-10-02T16:34:06Z",
  "rrow": "R18"
 },
 "evernote_hc__360022954093": {
  "vendor": "evernote",
  "public_url": "https://help.evernote.com/hc/en-us/articles/360022954093-Note-editor-and-editing-toolbar-overview",
  "read_from": "https://help.evernote.com/api/v2/help_center/en-us/articles/360022954093.json",
  "status": 200,
  "sha256": "0be7111245fcb7c5b4f574c3ddcfc75aefc8a7119608a98cb0de14afae3b765e",
  "fetched_utc": "2026-10-02T16:34:02Z",
  "rrow": "R18"
 },
 "evernote_hc__360040282613": {
  "vendor": "evernote",
  "public_url": "https://help.evernote.com/hc/en-us/articles/360040282613-Search-overview",
  "read_from": "https://help.evernote.com/api/v2/help_center/en-us/articles/360040282613.json",
  "status": 200,
  "sha256": "067fd4060689292c4b6942a8f096dd70c42f1f8c7489df06cab5279ec136af54",
  "fetched_utc": "2026-10-02T16:34:03Z",
  "rrow": "R18"
 },
 "evernote_hc__360053951213": {
  "vendor": "evernote",
  "public_url": "https://help.evernote.com/hc/en-us/articles/360053951213-Enable-edit-protection",
  "read_from": "https://help.evernote.com/api/v2/help_center/en-us/articles/360053951213.json",
  "status": 200,
  "sha256": "89efbf594c38f54502a85b9f8944fa4f6c5fe52378e8082b1e335fed460ba31b",
  "fetched_utc": "2026-10-02T16:34:10Z",
  "rrow": "R18"
 },
 "evernote_hc__36617500119315": {
  "vendor": "evernote",
  "public_url": "https://help.evernote.com/hc/en-us/articles/36617500119315-Draggable-paragraphs-and-collapsible-sections",
  "read_from": "https://help.evernote.com/api/v2/help_center/en-us/articles/36617500119315.json",
  "status": 200,
  "sha256": "149740ea1bdff3ff0595ce07e8dad91b9c152c554865b575e28b73a3bbee098f",
  "fetched_utc": "2026-10-02T16:34:06Z",
  "rrow": "R18"
 },
 "evernote_hc__39988842532627": {
  "vendor": "evernote",
  "public_url": "https://help.evernote.com/hc/en-us/articles/39988842532627-Default-font-settings",
  "read_from": "https://help.evernote.com/api/v2/help_center/en-us/articles/39988842532627.json",
  "status": 200,
  "sha256": "bb0481367481cb6be0280b2cfdae603d7f81058db01cb50a5f5e17ed6fff9dc8",
  "fetched_utc": "2026-10-02T16:34:08Z",
  "rrow": "R18"
 },
 "evernote_hc__4412905761299": {
  "vendor": "evernote",
  "public_url": "https://help.evernote.com/hc/en-us/articles/4412905761299-Nested-tags",
  "read_from": "https://help.evernote.com/api/v2/help_center/en-us/articles/4412905761299.json",
  "status": 200,
  "sha256": "4590f3635d8c4137e068df20244016d79cac64a6d38d497bb760251a641be505",
  "fetched_utc": "2026-10-02T16:34:09Z",
  "rrow": "R18"
 },
 "evernote_hc__46319409880211": {
  "vendor": "evernote",
  "public_url": "https://help.evernote.com/hc/en-us/articles/46319409880211-AI-Assistant",
  "read_from": "https://help.evernote.com/api/v2/help_center/en-us/articles/46319409880211.json",
  "status": 200,
  "sha256": "08e668d7e31c1b214a4641c7dcfd1db0c23cd38f25f5a1c8e9c0fff5ac22eb2f",
  "fetched_utc": "2026-10-02T16:34:11Z",
  "rrow": "R18"
 },
 "evernote_hc__50066095106835": {
  "vendor": "evernote",
  "public_url": "https://help.evernote.com/hc/en-us/articles/50066095106835-Emoji-shortcodes",
  "read_from": "https://help.evernote.com/api/v2/help_center/en-us/articles/50066095106835.json",
  "status": 200,
  "sha256": "aa36e354dd4a62ca53bec936af06602b248ceec882671cbadd18b6238bb3f0b7",
  "fetched_utc": "2026-10-02T16:34:07Z",
  "rrow": "R18"
 },
 "evernote_hc__home": {
  "vendor": "evernote",
  "public_url": "https://help.evernote.com/hc/en-us",
  "read_from": "https://help.evernote.com/hc/en-us",
  "status": 200,
  "sha256": "a5b7c773f663c9d90f7533d1e4456e85a6d02f875720f8d9c2d7348bda9d1ec6",
  "fetched_utc": "2026-10-02T16:34:16Z",
  "rrow": "R18"
 },
 "notion__collaborate_within_a_workspace": {
  "vendor": "notion",
  "public_url": "https://www.notion.com/help/collaborate-within-a-workspace",
  "read_from": "https://www.notion.com/help/collaborate-within-a-workspace",
  "status": 200,
  "sha256": "0e2aef6c44389f73dd75a4b2caf9cb6d20b08a4a976454bc203476d9a821be92",
  "fetched_utc": "2026-10-02T16:34:16Z",
  "rrow": "R18"
 },
 "notion__custom_agents_security_features": {
  "vendor": "notion",
  "public_url": "https://www.notion.com/help/custom-agents-security-features",
  "read_from": "https://www.notion.com/help/custom-agents-security-features",
  "status": 200,
  "sha256": "3d569e86736816affa5f1ea7d1883640d9839d75af74ec07b854baf1a5ab102f",
  "fetched_utc": "2026-10-02T16:34:17Z",
  "rrow": "R18"
 },
 "notion__import_data_into_notion__w12c": {
  "vendor": "notion",
  "public_url": "https://www.notion.com/help/import-data-into-notion",
  "read_from": "https://www.notion.com/help/import-data-into-notion",
  "status": 200,
  "sha256": "4b6f62d1eaa55c33914ddbdc2cb30d38fb035b83cad9af69984a531dde6ac771",
  "fetched_utc": "2026-10-02T16:34:18Z",
  "rrow": "R18"
 },
 "notion__tables__w12c": {
  "vendor": "notion",
  "public_url": "https://www.notion.com/help/tables",
  "read_from": "https://www.notion.com/help/tables",
  "status": 200,
  "sha256": "894b661f414cbf40e516c55a728720562baa260cc4d1d9be1d82fd8a7cc96c47",
  "fetched_utc": "2026-10-02T16:34:17Z",
  "rrow": "R18"
 },
 "obsidian__Bases_Bases_syntax_md": {
  "vendor": "obsidian",
  "public_url": "https://obsidian.md/help/bases/syntax",
  "read_from": "https://publish-01.obsidian.md/access/f786db9fac45774fa4f0d8112e232d67/Bases/Bases%20syntax.md",
  "status": 200,
  "sha256": "7fabd5f8fc3dadc45cdac2cac687016e9fdd9bc5e97f6879ef6beb4d26aac8e7",
  "fetched_utc": "2026-10-02T16:34:20Z",
  "rrow": "R18"
 },
 "obsidian__Plugins_Search_md__w12c": {
  "vendor": "obsidian",
  "public_url": "https://obsidian.md/help/plugins/search",
  "read_from": "https://publish-01.obsidian.md/access/f786db9fac45774fa4f0d8112e232d67/Plugins/Search.md",
  "status": 200,
  "sha256": "5a797fdbe551de35f662a64a02d0a275ebb9a65750b1a6f776860cf5c5e4b7f3",
  "fetched_utc": "2026-10-02T18:39:40Z",
  "rrow": "R18"
 },
 "obsidian__Plugins_Outline_md__w12c": {
  "vendor": "obsidian",
  "public_url": "https://obsidian.md/help/plugins/outline",
  "read_from": "https://publish-01.obsidian.md/access/f786db9fac45774fa4f0d8112e232d67/Plugins/Outline.md",
  "status": 200,
  "sha256": "ac779b3ebc6ad8861a4fc2fb420daf1ca1232d9121b39e104b81454e235919bd",
  "fetched_utc": "2026-10-02T18:39:40Z",
  "rrow": "R18"
 },
 "obsidian__Plugins_File_explorer_md": {
  "vendor": "obsidian",
  "public_url": "https://obsidian.md/help/plugins/file-explorer",
  "read_from": "https://publish-01.obsidian.md/access/f786db9fac45774fa4f0d8112e232d67/Plugins/File%20explorer.md",
  "status": 200,
  "sha256": "f3b6a4c8fe9667009bab0059b298d786ee500bf324c621446e494893f8b7619f",
  "fetched_utc": "2026-10-02T16:34:19Z",
  "rrow": "R18"
 },
 "obsidian__Plugins_Quick_switcher_md__w12c": {
  "vendor": "obsidian",
  "public_url": "https://obsidian.md/help/plugins/quick-switcher",
  "read_from": "https://publish-01.obsidian.md/access/f786db9fac45774fa4f0d8112e232d67/Plugins/Quick%20switcher.md",
  "status": 200,
  "sha256": "114f299e96fe1bae5d6b75175ee45bad4002e1ebd966a7389a3ca188bfca493b",
  "fetched_utc": "2026-10-02T16:34:19Z",
  "rrow": "R18"
 }
}

# ── wave 10: the Evernote help-centre evidence 9B could not fetch (Cloudflare, R15), read in a
# real browser by the controller on 2026-09-26 and committed verbatim. Nine rows carry a
# verbatim quote (cited through QUOTES above, kind "browser-read"); forty carry only the
# reader's paraphrase (quote null), which is a PARAPHRASE cell: labelled, never a quote, and
# never evidence for AHEAD, PARITY or BEHIND (checked in build(); railed in
# tests/test_parity_scorecard_evernote_fold.py).
EVERNOTE_EVIDENCE = 'docs/notebook/proof/evernote-evidence-2026-09-26.jsonl'


def evernote_evidence():
    with open(os.path.join(ROOT, EVERNOTE_EVIDENCE), encoding='utf-8') as fh:
        return [json.loads(l) for l in fh if l.strip()]


def browser_read_problems(quotes=None, sources=None, evidence=None):
    """A browser-read quote must be, character for character, the non-null `quote` the
    committed evidence file records for that URL -- so a paraphrase (quote null) can never
    be entered into QUOTES, and a quote edited after the fact is caught."""
    quotes = QUOTES if quotes is None else quotes
    sources = SOURCES if sources is None else sources
    evidence = evernote_evidence() if evidence is None else evidence
    by_url = {}
    for r in evidence:
        by_url.setdefault(r['url'], []).append(r)
    bad = []
    for key, (pid, q) in quotes.items():
        src = sources.get(pid) or {}
        if src.get('kind') != 'browser-read':
            continue
        recs = by_url.get(src.get('public_url'), [])
        if not recs:
            bad.append((key, 'no evidence row for ' + str(src.get('public_url'))))
        elif not any(r.get('quote') and r['quote'] == q for r in recs):
            bad.append((key, 'not the verbatim quote the evidence file records (a paraphrase is never a quote)'))
    return bad


def paraphrase_superseded(cited, quotes=None, sources=None):
    """Wave 12, lane 12C: True when a row's Evernote cell cites only verbatim quotes cut from FETCHED pages (an HTTP
    200 with a sha256 of the bytes, never a browser read), so the R17 paraphrase for that row is no longer shown.
    A string cell, an empty list, or any browser-read quote leaves the paraphrase rule exactly as wave 10 wrote it."""
    quotes = QUOTES if quotes is None else quotes
    sources = SOURCES if sources is None else sources
    if not isinstance(cited, list) or not cited:
        return False
    for k in cited:
        src = sources.get(quotes[k][0]) or {}
        if src.get('kind') == 'browser-read' or src.get('status') != 200 or not src.get('sha256'):
            return False
    return True


def git(*a):
    r = subprocess.run(['git', '-C', ROOT, *a], capture_output=True, text=True, encoding='utf-8', errors='replace')
    return r.returncode, r.stdout.strip()


def _norm(s):
    return re.sub(r'\s+', ' ', s.replace('\u00a0', ' ')).strip()


def _render_obsidian(md):
    md = re.sub(r'\[\[[^\]|]*\|([^\]]*)\]\]', r'\1', md)
    md = re.sub(r'\[\[([^\]]*)\]\]', r'\1', md)
    md = re.sub(r'\[([^\]]*)\]\([^)]*\)', r'\1', md)
    md = md.replace('**', '').replace('`', '')
    md = re.sub(r'(?<![A-Za-z0-9])_([^_\n]+)_(?![A-Za-z0-9])', r'\1', md)
    return md


def verify_quotes(pages_dir=None):
    """Every quote: its page is in SOURCES with HTTP 200, it is <= 25 words, and (with pages_dir)
    it appears verbatim in that page's extracted text."""
    bad = []
    for key, (pid, quote) in QUOTES.items():
        src = SOURCES.get(pid)
        if src is not None and src.get('kind') == 'browser-read':
            if len(quote.split()) > 25:
                bad.append((key, f'{len(quote.split())} words'))
            continue   # checked against the committed evidence file by browser_read_problems()
        if src is None or src.get('status') != 200:
            bad.append((key, f'page {pid} not a 200 fetch'))
            continue
        if len(quote.split()) > 25:
            bad.append((key, f'{len(quote.split())} words'))
        if pages_dir:
            p = os.path.join(pages_dir, pid + '.txt')
            if not os.path.exists(p):
                bad.append((key, f'no fetched text {p}'))
                continue
            t = open(p, encoding='utf-8').read()
            if pid.startswith('obsidian__'):
                t = _render_obsidian(t)
            if _norm(quote) not in _norm(t):
                bad.append((key, 'quote not in the fetched text'))
    return bad


def _flags_of(text):
    """The flag ledger's `flags` map from its JSON text (None when there is no text)."""
    if not text:
        return None
    d = json.loads(text)
    return d.get('flags', d)


def _flags_now():
    """The flag ledger in the working tree -- what --write records, and (because --write refuses an
    uncommitted cited input) what HEAD holds when it does."""
    with open(os.path.join(ROOT, FLAGS), encoding='utf-8') as fh:
        return _flags_of(fh.read())


# ── the offline verifier ──────────────────────────────────────────────────────────────────────
_CITE = re.compile(r'(CODE|RULING|RECORD|MEASURE) `([^`]+)`:(\d+(?:-\d+)?) "(.*?)"'
                   r'(?=\s*(?:;|\(D\d+\)|\(ledger\)|—|$))')
_WALK = re.compile(r'WALK `([^`]+)`:([\w.-]+) (\w+) — report `([^`]+)`')   # a check id may carry a dot (12D)
_TEST = re.compile(r'TEST `([^`]+)` — run by (?:9B|F3): `([^`]+)`, "([^"]+)"')
_FLAG = re.compile(r'RECORD `docs/feature_flags\.json` at (\w+), key (\w+): status (\w+)')


def walk_verdicts(d):
    """{check id: verdict} of a walk report: its `checks` (a dict, or a list of {id|check, verdict|
    status}) or, for a step-by-step walk (the keyboard walks), its `steps` list."""
    c = d.get('checks')
    if c is None:
        c = d.get('steps')
    if c is None:
        c = d.get('rows', [])   # wave 12 (12D): a walk whose report lists {id, verdict} rows
    if isinstance(c, dict):
        return {k: (v.get('verdict') if isinstance(v, dict) else v) for k, v in c.items()}
    return {(x.get('id') or x.get('check')): (x.get('verdict') or x.get('status')) for x in c}
_WRITTEN_AT = re.compile(r'\*\*Document written at:\*\* `([0-9a-f]{7,40})`')


def recorded_rev(text):
    """The revision the scorecard's own header records as "Document written at" (None if it records none)."""
    m = _WRITTEN_AT.search(text)
    return m.group(1) if m else None


def in_clone(rev):
    """True when `rev` names a commit in the local object store (a shallow clone may not have it)."""
    return subprocess.run(['git', '-C', ROOT, 'cat-file', '-e', f'{rev}^{{commit}}'],
                          capture_output=True).returncode == 0


class _Reader:
    """File text at one revision (`git show REV:path`, once per file). Never the working tree."""

    def __init__(self, rev):
        self.rev = rev
        self.cache = {}

    def text(self, path):
        if path not in self.cache:
            r = subprocess.run(['git', '-C', ROOT, 'show', f'{self.rev}:{path}'], capture_output=True)
            self.cache[path] = r.stdout.decode('utf-8', 'replace').replace('\r\n', '\n') if r.returncode == 0 else None
        return self.cache[path]

    def lines(self, path):
        t = self.text(path)
        return None if t is None else t.split('\n')


def _cells_of(text):
    """Every table cell and list item of the scorecard that can carry evidence."""
    out = []
    for l in text.replace('\r\n', '\n').split('\n'):
        if l.startswith('|') and not l.startswith('|---'):
            out.extend(GLS.split_cells(l))
        elif l.startswith('- **G-'):
            out.append(l)
    return out


def verify(text=None, rev=None):
    """Re-check every citation the scorecard makes, at ONE revision. Returns (counts, problems).

    `rev` defaults to the revision the scorecard's header records ("Document written at"): the
    scorecard is a measurement at that commit, so later edits elsewhere never red it. Pass
    rev='HEAD' to ask whether the code has moved since. A revision the local object store does not
    hold is never a pass: the only problem returned is "unverifiable: <sha> not in this clone".
    """
    if text is None:
        text = open(os.path.join(ROOT, SCORECARD), 'rb').read().decode('utf-8')
    if rev is None:
        rev = recorded_rev(text)
        if rev is None:
            return Counter(), ['unverifiable: the scorecard records no "Document written at" revision']
    if not in_clone(rev):
        return Counter(), [f'unverifiable: {rev} not in this clone']
    rd = _Reader(rev)
    problems, counts = [], Counter()
    flags = None
    written = recorded_rev(text) or ''
    seen = set()
    for cell in _cells_of(text):
        for item in cell.split(' ; '):
            item = item.strip()
            if item in seen:
                continue
            seen.add(item)
            m = _FLAG.match(item)
            if m:
                if flags is None:
                    flags = _flags_of(rd.text(FLAGS))
                    if flags is None:
                        problems.append(f'flag records: {FLAGS} does not exist at {rev}')
                        flags = {}
                rev_, key, want = m.groups()
                got = (flags.get(key) or {}).get('status')
                counts['FLAG'] += 1
                if not written or not (written.startswith(rev_) or rev_.startswith(written)):
                    problems.append(f'flag {key}: the record names revision {rev_}, the scorecard was '
                                    f'written at {written or "no recorded revision"}')
                if got != want:
                    problems.append(f'flag {key}: the record says {want!r}, {FLAGS} at {rev} says {got!r}')
                continue
            for mm in _CITE.finditer(item):
                kind, path, span, frag = mm.groups()
                L = rd.lines(path)
                counts[kind] += 1
                if L is None:
                    problems.append(f'{kind} {path}:{span}: the file does not exist at {rev}')
                    continue
                if '-' in span:
                    a, b = (int(x) for x in span.split('-'))
                else:
                    a = b = int(span)
                if a < 1 or b > len(L):
                    problems.append(f'{kind} {path}:{span}: out of range ({len(L)} lines)')
                    continue
                joined = ' '.join(L[a - 1:b])
                if frag not in joined:
                    problems.append(f'{kind} {path}:{span} no longer holds "{frag[:80]}"')
            for mm in _WALK.finditer(item):
                tool, cid, verdict, report = mm.groups()
                counts['WALK'] += 1
                t = rd.text(report)
                if t is None:
                    problems.append(f'WALK report {report} missing at {rev}')
                    continue
                got = walk_verdicts(json.loads(t)).get(cid)
                if got != verdict:
                    problems.append(f'WALK {cid}: the scorecard says {verdict}, {report} says {got}')
            for mm in _TEST.finditer(item):
                fname, log, totals = mm.groups()
                counts['TEST'] += 1
                t = rd.text(log)
                if t is None:
                    problems.append(f'TEST log {log} missing at {rev}')
                    continue
                if _norm(totals) not in _norm(t):
                    problems.append(f'TEST {log}: totals line "{totals}" not in the log')
                if fname.replace('app/', '', 1) not in t:
                    problems.append(f'TEST {log}: {fname} is not in the log')
    return counts, problems


# ── §0, the evidence index (redesigned in wave 10, F3; tightened in F3 fix round 1) ────────────────
# (wave, the tag that pins the head that was SQUASHED, that head, the wave's squash on master).
# ⚰️ Fix round 1 (review I-1): waves 5 and 7 recorded their `-tip-` tags, which are NOT the heads the
# PRs squashed -- #186 squashed d251cbb98 and #196 squashed bba8bcb4d (each squash's tree equals that
# head's tree, measured). The old tags are left where they are; the `-tip2-` tags below were created
# at the squashed heads. Wave 10's L1c has no squash yet: its tag is created by the controller at the
# final L1c tip immediately before the squash, so its head and squash are resolved at run time (None).
L1C_TAG = 'notebook-wave10-L1c-tip2-2026-09-28'  # tip2: the landing tree changed after tip-2026-09-28 was pushed (marker #11 dropped + master merged); pushed tags are never moved
# Lane RS (this re-score, 2026-09-29): a new wave entry, same shape as L1c's (tip and squash both
# None -- nothing has squashed this lane yet). It carries every citation this lane adds that L1c's
# entry cannot (L2/L4/AX's evidence, the quiet-slot readings, the rollback rehearsals, the copied-in
# soak/restore records): none of that existed at L1C_TAG's commit, so tying it to 'wave 10 L1c' would
# fail the "unchanged since the landing" tie. The RS tag is created at THIS lane's own final commit,
# after every evidence file below is committed -- never before, or the tie is vacuous.
RS_TAG = 'notebook-wave10-RS-2026-09-29'
# ⛔ Lane RS2 (2026-09-29): RS_TAG resolves (2d74f25e3), but that commit is on the SEPARATE, still
# un-landed `feat/notebook-w10-rs` branch -- not an ancestor of THIS tree's HEAD. Whoever wrote wave
# 10 L5's squash (0812b5ec3, PR #252, "parity re-score 32/61") copied RS's evidence files and this
# tool's RS-era state into master WITHOUT preserving a provable git ancestry to RS_TAG's commit, so
# `evidence_index` has been unable to verify 'wave 10 RS' on every tree descended from L5 since before
# this lane started (verified: the same single failure, same cause, on the pristine pre-RS2 tree).
# Not this lane's evidence to re-derive or re-litigate -- the files are already committed, unchanged,
# reachable from HEAD since 0812b5ec3 (`git log --follow` on each path below confirms it). RS2_TIP2_TAG
# re-anchors the SAME wave to a tag THIS tree can prove, without touching a byte of the evidence itself
# or any clause's verdict. If lane RS's own branch later lands for real, its landing should replace this
# with a proper squash-tied entry; this is a stopgap so `--write` can run on this tree in the meantime.
RS2_TIP2_TAG = 'notebook-wave10-RS-tip2-2026-09-29'
# Lane RS2 (this re-score, 2026-09-29): a second new wave entry, same shape as RS's own -- RS's branch
# never landed on this tree (its tag is not an ancestor of HEAD here), so RS2 cannot tie evidence to
# 'wave 10 RS' on THIS branch. RS2 carries: L6's own landing record (PR #253, already an ancestor of
# HEAD -- classification.md + its pytest log) and the corrected production writing-help run
# (wh-2026-09-29b, cherry-picked from notebook-w10-wh at 152fbb062). Neither existed at any earlier
# registered wave's landing. The RS2 tag is created at THIS lane's own final commit, after every
# evidence file below is committed.
RS2_TAG = 'notebook-wave10-RS2-2026-09-29'
# Lane SC (2026-09-30): a new wave entry, same shape as L1c's and RS/RS2's (tip and squash both
# None). L11's proof walk (tip 52deeb767 = L10 + DR-F + LK + FX2 + WK4 + FX3 + WK5, raw evidence
# committed first at a962839da (R-RAW), its README written at 67074722e) postdates L1C_TAG's own
# commit -- L1C_TAG carries neither WK4, FX3 nor WK5 -- so this evidence cannot be tied to
# 'wave 10 L1c' (its landing commit would not contain these paths). The SC tag is created at THIS
# lane's own final commit, after every evidence file below is committed -- never before, or the
# tie is vacuous.
SC_TAG = 'notebook-wave10-SC-2026-09-30'
# Lane SC2 (2026-09-30): a second new wave entry, same shape as SC's own (tip and squash both
# None). The L12 dead-click full sweep + targeted re-run (0100a3032 / 6cbf0618e, raw evidence
# committed first at 3d95c76fc / 589b0ddf9, R-RAW) and the un-scoped L3 layout re-confirm
# (fe01bdb14, raw evidence committed first at e50f2a1ba, R-RAW) all postdate SC_TAG's own commit,
# so none of it can be tied to 'wave 10 SC'. The SC2 tag is created at THIS lane's own final
# commit, after every evidence file below is committed -- never before, or the tie is vacuous.
SC2_TAG = 'notebook-wave10-SC2-2026-09-30'
# Integrator L13 (2026-09-30): a third wave entry, same shape. L12's closing commits rewrote
# docs/notebook/proof/l12-READINGS.md AFTER SC2_TAG was cut (the 2c / 6c MET readings under D23
# and the final walk's reading), so its blob at SC2_TAG is no longer its blob at HEAD and the file
# cannot stay tied to 'wave 10 SC2'. A pushed tag is never moved, so the file moves to SC3, whose
# tag is created at L13's own final commit, after the file is final -- never before.
SC3_TAG = 'notebook-wave10-SC3-2026-09-30'
# Integrator L13 (2026-09-30): lane G62's real-browser walk (run 3 at 4d2a4edfa, 8/8 PASS) is
# committed after SC3_TAG, so it needs its own wave. The tag is cut at the commit that registers
# it here, after the report is final.
L13A_TAG = 'notebook-wave10-L13a-2026-09-30'
# Integrator L14 (2026-09-30): the PR heads of L12 (#258) and L13 (#259), tagged after both merged, so
# the waves above can be tied to the squashes that landed them (see B0_WAVES).
L12_TIP_TAG = 'notebook-wave10-L12-tip-2026-09-30'
L13_TIP_TAG = 'notebook-wave10-L13-tip-2026-09-30'
# Quiet re-score QR (2026-10-02): the controller's quiet-box readings for 14d (the per-call curve,
# curve-d22-q2, measured at 93c4bed77 on feat/notebook-w10-pc3) and 4d (TY8's six interleaved busy-time
# runs, on feat/notebook-w10-ty8). Neither branch has landed, so the evidence was cherry-picked here and
# this is a new wave of the same shape as SC/SC2/SC3/L13a (tip and squash both None). The tag is cut at
# the commit that registers it here, after every evidence file below is committed -- never before.
QR_TAG = 'notebook-wave10-QR-2026-10-02'
QR_TIP_TAG = 'notebook-wave10-QR-tip-2026-10-02'   # PR #264's head f09727453, tagged by the integrator
# Wave 12, lane 12C phase 2 (2026-10-02): the re-score on the wave-12 landing branch. It cites evidence that has
# not landed on master (12D's sandbox walk, 12B's template walk) and 4d's tie-break run A4, whose README section
# landed on master in #265 after QR's squash. Same shape as SC/SC2/SC3/L13a/QR (tip and squash both None): the
# tag is cut at the commit that registers it here, after every evidence file below is committed -- never before.
W12C2_TAG = 'notebook-wave12-C2-2026-10-02'
# Lane 13SC (2026-10-03, the wave-13 records lane): registers wave 13 as landed on this tree, same shape
# as L1c/SC/SC2/SC3/L13a/QR/W12C2 (tip and squash both None; the tag is cut at THIS lane's own final
# commit, after every change below is committed -- never before, or the tie is vacuous). This wave adds
# NO row to B0_EVIDENCE: every wave-13 lane doc (docs/notebook/wave13-13{b,c2,d,e1,e2,f,g1,g2,h2,h3,i1,
# i2,j,q,q2,q3}.md) was read against this scorecard's two tracked axes -- the gap ledger (Notion/Evernote/
# Obsidian, section A) and the 16 standards (section B, from NOTEBOOK-10-OF-10-PLAN) -- and none cites a
# gap-ledger row (a grep for "G-0[0-9][0-9]" across every wave-13 doc hits only unrelated internal tags --
# G-064's askInsert node, G-074's pre-existing awareness rule, G-116..G-120's citable-excerpt pipeline) and
# none names Notion, Evernote, Obsidian or a trader-journal competitor as a comparison. Every wave-13
# capability (plan grading, entry context, earnings prep, the chart-drawn plan, the technical fingerprint,
# the visual playbook, My Playbook, thesis chips, transcript capture, passed setups, the active setups
# board, find similar, review drafts, note resurfacing) targets the SEPARATE trader-journal/charting-
# platform bar in docs/notebook/WAVE-13-PLAN.md section 1.3, which this file carries no row for. So no
# clause and no gap-ledger row moves this pass; the tag exists so a future lane that DOES move one can
# cite 'wave 13' the way 12C2 cites 'wave 12 C2'.
WAVE13SC_TAG = 'notebook-wave13-landing-2026-10-03'
B0_WAVES = (
    ('wave 5', 'notebook-wave5-tip2-2026-09-25', 'd251cbb98', '2c3ed3093'),
    ('wave 6', 'notebook-wave6-tip-2026-09-26', '96051c043', '271a078b6'),
    ('wave 7', 'notebook-wave7-tip2-2026-09-26', 'bba8bcb4d', 'f883e0996'),
    ('wave 8', 'notebook-wave8-tip-2026-09-26', '2dde8fed1', 'caf6d1b9e'),
    ('wave 9', 'notebook-wave9-tip-2026-09-26', 'e7c196f38', '1c4b0bf74'),
    ('wave 10 L1a', 'notebook-wave10-L1a-tip2-2026-09-26', '6777b3335', '4f708a0d2'),
    ('wave 10 L1b', 'notebook-wave10-L1b-tip-2026-09-27', '7748c3691', 'd9e887ca0'),
    ('wave 10 L1c', L1C_TAG, None, None),
    # Integrator, 2026-09-29: both RS waves tied to their REAL squashes. RS's evidence reached master
    # inside L5 (#252, head a01573e66 -> squash 0812b5ec3) and RS2's inside L8 (#255, head 0bb2f1c33 ->
    # squash 6f563c158). The self-referential stopgap tags above could never be proven once the
    # branches were squashed (the RS2 lane's own note asked for exactly this replacement).
    ('wave 10 RS', 'notebook-wave10-L5-tip-2026-09-29', 'a01573e66', '0812b5ec3'),
    ('wave 10 RS2', 'notebook-wave10-L8-tip-2026-09-29', '0bb2f1c33', '6f563c158'),
    # Integrator L14, 2026-09-30: the four re-score waves tied to their REAL squashes, the same
    # replacement RS/RS2 got. SC and SC2's evidence reached master inside L12 (#258, head 6cdfc41e6 ->
    # squash 599cd44f1); SC3 and L13a's inside L13 (#259, head 5af134095 -> squash a680b0d40). With tip
    # and squash both None a wave is proved only while its tagged commit is an ancestor of HEAD, which
    # stopped being true on master the moment each branch was squashed. SC_TAG..L13A_TAG stay defined
    # above as the record of where each lane cut its tag; pushed tags are never moved.
    ('wave 10 SC', L12_TIP_TAG, '6cdfc41e6', '599cd44f1'),
    ('wave 10 SC2', L12_TIP_TAG, '6cdfc41e6', '599cd44f1'),
    ('wave 10 SC3', L13_TIP_TAG, '5af134095', 'a680b0d40'),
    ('wave 10 L13a', L13_TIP_TAG, '5af134095', 'a680b0d40'),
    # Lane 12C phase 2 (2026-10-02): QR tied to its REAL squash, as RS/SC/L13 were. QR_TAG (2ac47cae1) is an
    # ancestor of PR #264's head, not the head it squashed; the integrator's tag below pins that head.
    ('wave 10 QR', QR_TIP_TAG, 'f09727453', '88e68c94e'),
    ('wave 12 C2', W12C2_TAG, None, None),
    ('wave 13', WAVE13SC_TAG, None, None),
)
# (an evidence file this scorecard cites, the wave that landed it -- its squash SHA, or the wave's name).
# ⛔ Hand-typed on purpose: WHICH squash landed a file is a fact about history that the scorecard's cells
# do not carry, so it cannot be derived from them without making property 3 true by definition. What IS
# derived is the other direction: `cited_b0_gaps()` reads every evidence path and walked tree out of the
# built scorecard and refuses one this list does not name (review M-6).
B0_EVIDENCE = (
    ('docs/notebook/evidence/q1-gate/DECISION-2026-09-23-keep-offline.md', '2c3ed3093'),
    ('docs/notebook/gate-runs/wave5-landing/2026-09-24T21-37-17.md', '2c3ed3093'),
    ('docs/notebook/gate-runs/wave5-landing/2026-09-25T20-10-16.md', '2c3ed3093'),
    ('docs/notebook/gate-runs/wave5-landing/2026-09-25T21-07-34.md', '2c3ed3093'),
    ('docs/notebook/gate-runs/wave5/walk-f84cb5add.json', '2c3ed3093'),
    ('docs/notebook/gate-runs/wave5/walk-fe6d15926.json', '2c3ed3093'),
    ('docs/notebook/gate-runs/wave6-landing/2026-09-25T23-28-08.md', '271a078b6'),
    ('docs/notebook/gate-runs/wave6/walk-787a993f5.json', '271a078b6'),
    ('docs/notebook/gate-runs/wave7-landing/2026-09-26T02-50-58.md', 'f883e0996'),
    ('docs/notebook/evidence/wave7-walk-8f232d21d/walk-8f232d21d.json', 'f883e0996'),
    ('docs/notebook/gate-runs/wave8-landing/2026-09-26T13-16-51.md', 'caf6d1b9e'),
    ('docs/notebook/gate-runs/wave8/walk-341bbccf3.json', 'caf6d1b9e'),
    ('docs/notebook/evidence/wave9-9b-8a0098029/browser-check.json', '1c4b0bf74'),
    ('docs/notebook/evidence/wave9-9b-8a0098029/browser-check-pass2.json', '1c4b0bf74'),
    ('docs/notebook/evidence/wave9-9b-8a0098029/rails-pytest-rA.log', '1c4b0bf74'),
    ('docs/notebook/evidence/wave9-9b-8a0098029/rails-vitest.log', '1c4b0bf74'),
    ('docs/notebook/evidence/wave9-9b-8a0098029/rails-vitest-a11y.log', '1c4b0bf74'),
    ('docs/notebook/evidence/wave9-9b-8a0098029/notebook_perf_budgets-bytes.log', '1c4b0bf74'),
    # F3 fix round 3 (review R12-M5): the walk instruments and integrity records the cells cite beside their runs
    ('docs/notebook/evidence/wave9-9b-8a0098029/browser_check_9b.py', '1c4b0bf74'),
    ('docs/notebook/evidence/wave9-9b-8a0098029/browser_check_9b_pass2.py', '1c4b0bf74'),
    ('docs/notebook/evidence/wave9-9b-8a0098029/sandbox-integrity-2026-09-26T14-58-03.md', '1c4b0bf74'),
    ('docs/notebook/evidence/wave9-9b-8a0098029/sandbox-integrity-2026-09-26T15-30-24.md', '1c4b0bf74'),
    (W10_WALK, '4f708a0d2'),
    (f'{W10C}/burst-probe-raw.json', '4f708a0d2'),
    (f'{W10C}/f5-results-run3-tag-applied.md', '4f708a0d2'),
    (f'{W10D}/personal-api-walk-20260927T043218Z.json', 'd9e887ca0'),
    (f'{W10D}/browser-check-20260927T050752Z.json', 'd9e887ca0'),
    (f'{PROOF}/README.md', 'wave 10 L1c'),
    (f'{PROOF}/walk-fd7d1f42d/run.json', 'wave 10 L1c'),
    (f'{PROOF}/walk-fd7d1f42d/census.json', 'wave 10 L1c'),
    (f'{PROOF}/f5-after-aa2417c2c/run.json', 'wave 10 L1c'),
    (f'{PROOF}/f5-after-aa2417c2c/axe.json', 'wave 10 L1c'),
    (f'{PROOF}/rail-census-fd7d1f42d.json', 'wave 10 L1c'),
    (f'{PROOF}/f6-switcher-body/perf/fr1-50k.log', 'wave 10 L1c'),
    (f'{PROOF}/f6-switcher-body/perf/fr1-curve.log', 'wave 10 L1c'),
    (KBD_F4, 'wave 10 L1c'),
    ('docs/notebook/evidence/wave10-f3/pytest-f3-rails.log', 'wave 10 L1c'),
    ('docs/notebook/evidence/wave10-f3/vitest-f3-telemetry-rails.log', 'wave 10 L1c'),
    ('docs/notebook/evidence/wave10-f3/vitest-f3-telemetry-rails-r2.log', 'wave 10 L1c'),
    ('docs/notebook/evidence/wave10-f3/vitest-f3-telemetry-rails-r3.log', 'wave 10 L1c'),
    ('docs/notebook/evidence/a11y-second-review-2026-09-27/keyboard_walk.py', 'wave 10 L1c'),   # R12-M5
    (f'{PROOF}/evernote-evidence-2026-09-26.jsonl', 'wave 10 L1c'),                            # R12-M5
    # Lane RS (2026-09-29): AX's readings at 2fb102c74 (9a, 9d), the controller's quiet-slot command 1
    # and curve (4b/13d/14a/14b, 14d), the copied-in Sunday KEEP verdict and hand-run restore drill
    # (3c, 7a), lane R1's and R1b's rollback rehearsals (3b), and the L2/L4-era layout proof runs
    # (6c). None of these existed at any earlier wave's landing, so all tie to 'wave 10 RS'.
    (f'{PROOF}/ax-2fb102c74/README.md', 'wave 10 RS'),
    (f'{PROOF}/quiet-slot-2026-09-29/qs-50k.log', 'wave 10 RS'),
    (f'{PROOF}/quiet-slot-2026-09-29/load.txt', 'wave 10 RS'),
    (f'{PROOF}/quiet-slot-2026-09-29/tree.txt', 'wave 10 RS'),
    (f'{PROOF}/quiet-slot-2026-09-29/qs-curve.log', 'wave 10 RS'),
    (f'{PROOF}/quiet-slot-2026-09-29/qs-curve2.log', 'wave 10 RS'),
    ('docs/notebook/evidence/evidence-gate-soak-only-2026-09-28-KEEP.md', 'wave 10 RS'),
    ('docs/notebook/evidence/evidence-restore-drill-2026-09-28-hand-PASS.md', 'wave 10 RS'),
    ('docs/notebook/evidence/rollback-rehearsal-2026-09-28/sandbox-results.md', 'wave 10 RS'),
    ('docs/notebook/evidence/rollback-rehearsal-2026-09-28/fr2-rail.log', 'wave 10 RS'),
    ('docs/notebook/evidence/rollback-rehearsal-2026-09-29/sandbox-results.md', 'wave 10 RS'),
    ('docs/notebook/evidence/rollback-rehearsal-2026-09-29/final-rail.log', 'wave 10 RS'),
    ('docs/notebook/evidence/rollback-rehearsal-2026-09-29/objects.log', 'wave 10 RS'),
    (f'{PROOF}/l3-layout-0e72ad573/r2-after/run.json', 'wave 10 RS'),
    (f'{PROOF}/d3p-raw/after-r2/run.json', 'wave 10 RS'),
    (f'{PROOF}/d5-after-round1-fix/probe.json', 'wave 10 RS'),
    # Lane RS2 (2026-09-29): L6's own landing (PR #253, 7b) and the corrected production writing-help
    # run (12a). Neither existed at any earlier registered wave's landing, so both tie to 'wave 10 RS2'.
    ('docs/notebook/gate-runs/wave10-L6/classification.md', 'wave 10 RS2'),
    ('docs/notebook/gate-runs/wave10-L6/pytest-l6.log', 'wave 10 RS2'),
    (f'{PROOF}/wh-2026-09-29b/README.md', 'wave 10 RS2'),
    # Lane SC (2026-09-30): the L11 proof walk's own committed artifacts -- the five-sweep R-RAW
    # evidence (a962839da) plus its reading (67074722e). None of these existed at any earlier
    # registered wave's landing (L1C_TAG predates WK4/FX3/WK5), so all tie to 'wave 10 SC'.
    (f'{PROOF}/l11-52deeb767/README.md', 'wave 10 SC'),
    (f'{PROOF}/l11-52deeb767/run.json', 'wave 10 SC'),
    (f'{PROOF}/l11-52deeb767/integrity.md', 'wave 10 SC'),
    (f'{PROOF}/l11-52deeb767/census.json', 'wave 10 SC'),
    (f'{PROOF}/l11-52deeb767/axe.json', 'wave 10 SC'),
    (f'{PROOF}/l11-52deeb767/silent.json', 'wave 10 SC'),
    (f'{PROOF}/l11-52deeb767/deadclick.json', 'wave 10 SC'),
    # Lane SC2 (2026-09-30): the L12 dead-click full sweep + targeted re-run's own committed
    # artifacts, the un-scoped L3 layout re-confirm's run-meta.json, and the reading of all three.
    # None of these existed at any earlier registered wave's landing (SC_TAG predates them), so all
    # tie to 'wave 10 SC2'.
    (f'{PROOF}/l12-READINGS.md', 'wave 10 SC3'),  # re-tied by L13: see SC3_TAG
    (f'{PROOF}/l12dc-0100a3032/run.json', 'wave 10 SC2'),
    (f'{PROOF}/l12dc2-6cbf0618e/run.json', 'wave 10 SC2'),
    (f'{PROOF}/l12dc2-6cbf0618e/deadclick.json', 'wave 10 SC2'),
    (f'{PROOF}/l3-reconfirm-fe01bdb14/run-meta.json', 'wave 10 SC2'),
    ('docs/notebook/gate-runs/g62/walk-4d2a4edfa-run3.json', 'wave 10 L13a'),  # lane G62's walk
    # Quiet re-score QR (2026-10-02): 14d's quiet per-call curve and 4d's quiet TY8 A/B.
    ('docs/notebook/gate-runs/wave10-PC/curve-d22-q2.log', 'wave 10 QR'),
    ('docs/notebook/gate-runs/wave10-PC/curve-d22-q2.json', 'wave 10 QR'),
    ('docs/notebook/gate-runs/wave10-PC/curve-d22-q2-box.txt', 'wave 10 QR'),
    ('docs/notebook/gate-runs/wave10-PC/README-quiet.md', 'wave 10 QR'),
    ('docs/notebook/perf-runs/ty8/README.md', 'wave 12 C2'),   # #265 appended the A4 reading after QR landed
    ('docs/notebook/perf-runs/ty8/ab/A1.json', 'wave 10 QR'),
    ('docs/notebook/perf-runs/ty8/ab/A2.json', 'wave 10 QR'),
    ('docs/notebook/perf-runs/ty8/ab/A3.json', 'wave 10 QR'),
    ('docs/notebook/perf-runs/ty8/ab/B1.json', 'wave 10 QR'),
    ('docs/notebook/perf-runs/ty8/ab/B2.json', 'wave 10 QR'),
    ('docs/notebook/perf-runs/ty8/ab/B3.json', 'wave 10 QR'),
    # Wave 12, lane 12C phase 2: 4d's tie-break run A4 (#265), 12D's sandbox walk, 12B's template walk.
    ('docs/notebook/perf-runs/ty8/ab/A4.json', 'wave 12 C2'),
    ('docs/notebook/evidence/w12d/sandbox-1ad04a0383/walk.json', 'wave 12 C2'),
    ('docs/notebook/evidence/wave12-12b/walk-5.json', 'wave 12 C2'),
)
# (a tree a browser check or walk measured, the ref it must be reachable from: HEAD, or the tag of the
# declared wave whose branch it was on -- a squash leaves no other path to it). Fix round 1 (review I-3):
# no row names HEAD any more, because every one of these trees is left behind by a squash; each names
# the earliest declared wave tag it is an ancestor of.
B0_TIPS = (
    ('787a993f5', 'notebook-wave6-tip-2026-09-26'),    # the wave-6 walk
    ('8f232d21d', 'notebook-wave7-tip2-2026-09-26'),   # the wave-7 walk
    ('341bbccf3', 'notebook-wave8-tip-2026-09-26'),    # the wave-8 walk
    ('8a0098029', 'notebook-wave9-tip-2026-09-26'),    # wave 9's browser check (9B)
    ('9532e67ac', 'notebook-wave9-tip-2026-09-26'),    # 9D: the folder Publish glyph
    ('fccff2f63', 'notebook-wave9-tip-2026-09-26'),    # 9D/D1: Export selected, four formats
    ('39a71dd3c', 'notebook-wave9-tip-2026-09-26'),    # 9D/D2: Publish on every folder row
    ('14310c206', 'notebook-wave10-L1a-tip2-2026-09-26'),  # the L1a walk
    ('fd7d1f42d', 'notebook-wave10-L1b-tip-2026-09-27'),   # 10E-1's proof walk
    ('aa2417c2c', L1C_TAG),                            # F5's after-run (axe, geometry)
    ('0555889ef', L1C_TAG),                            # F4's keyboard re-walk
    ('7ee21a7fc', L1C_TAG),                            # F6's recall baseline
    ('4d2a4edfa', L13_TIP_TAG),                        # lane G62's consensus walk, run 3
    ('1ad04a0383', W12C2_TAG),                         # 12D's sandbox walk (G-003, G-045)
)
_PATHSPEC_CHUNK = 40   # paths per `git log` call when looking for a squash (a Windows command line is finite)


def _tag_commit(tag):
    """The commit a TAG resolves to, or ''. Only refs/tags/ is consulted, so a bare SHA is never a tag."""
    rc, sha = git('rev-parse', '--verify', '--quiet', f'refs/tags/{tag}^{{commit}}')
    return sha if rc == 0 else ''


def _tie(tip, landing):
    """Property 5: (changed, differing). `changed` is the files `tip` changed against merge-base(tip, landing^)
    -- empty means the tie would compare nothing, which the caller refuses as vacuous. `differing` is empty
    exactly when `landing` carries `tip`: its tree is `tip` merged onto its parent,
    `git merge-tree --write-tree <landing>^ <tip>` == `<landing>^{tree}` (F3 fix round 3, review R12-I1).
    Merge-aware, because a GitHub squash onto a master that moved is a 3-way merge: a file both sides touched
    holds the MERGE, not the head's blob, and the old per-file blob comparison refused that ordinary squash.
    `--no-renames` everywhere a file list is read (R12-M1): with rename detection a rename lists only the new
    name, so a landing that kept the old file passed. When the trees differ, `differing` names the files
    (conflicted ones on a conflict), never an empty set."""
    rc, base = git('merge-base', tip, f'{landing}^')
    if rc != 0:
        return set(), {'(no merge base)'}
    changed = {x for x in git('diff', '--no-renames', '--name-only', base, tip)[1].splitlines() if x}
    rc, out = git('merge-tree', '--write-tree', '--name-only', '--no-messages', f'{landing}^', tip)
    lines = out.splitlines()
    if rc not in (0, 1) or not lines:
        return changed, {f'(git merge-tree failed: {out[:80]!r})'}
    if rc == 1:   # conflict: the head does not even merge onto the squash's parent
        return changed, {f'(conflict) {x}' for x in lines[1:] if x} or {'(conflict)'}
    rc2, want = git('rev-parse', '--verify', '--quiet', f'{landing}^{{tree}}')
    if rc2 != 0:
        return changed, {'(no tree at the landing)'}
    if lines[0] == want:
        return changed, set()
    differ = {x for x in git('diff', '--no-renames', '--name-only', lines[0], want)[1].splitlines() if x}
    return changed, differ or {'(trees differ)'}


def _find_squash(tip, head):
    """For a wave whose squash is not recorded yet (L1c): the EARLIEST commit of HEAD's history (topological
    order, oldest first) that carries `tip` by `_tie`'s rule (its tree is `tip` merged onto its parent), among
    the commits that touch a file `tip` changed. None when none does.
    Not the first-parent line: measured on origin/master, wave 9's squash 1c4b0bf74 is not on it (a later
    merge took master's first parent through another branch), so a first-parent walk misses a real squash."""
    rc, base = git('merge-base', tip, head)
    if rc != 0:
        return None
    changed = sorted(x for x in git('diff', '--no-renames', '--name-only', base, tip)[1].splitlines() if x)
    if not changed:
        return None
    order = [x for x in git('rev-list', '--topo-order', '--reverse', f'{base}..{head}')[1].splitlines() if x]
    touched = set()
    for i in range(0, len(changed), _PATHSPEC_CHUNK):
        out = git('log', '--full-history', '--format=%H', f'{base}..{head}', '--', *changed[i:i + _PATHSPEC_CHUNK])[1]
        touched.update(x for x in out.splitlines() if x)
    for c in order:
        if c in touched and not _tie(tip, c)[1]:
            return c
    return None


def evidence_index(head='HEAD', waves=None, evidence=None, tips=None):
    """§0: (rows, problems). rows are (item, command, result) for the table; problems are the rows
    whose property does not hold. The five properties are in the module docstring."""
    waves = B0_WAVES if waves is None else waves
    evidence = B0_EVIDENCE if evidence is None else evidence
    tips = B0_TIPS if tips is None else tips
    rows, problems = [], []

    def ok(*a):
        return git(*a)[0] == 0

    landing_of = {}     # wave name AND recorded squash -> the commit that landed it (None: did not land)
    tag_ok = {}         # declared wave tag -> (its commit, whether its wave landed and is tied)
    for wave, tag, tip, landing in waves:
        sha = _tag_commit(tag)
        pinned = bool(sha) and (tip is None or sha.startswith(tip)) and (tip is None or ok('cat-file', '-e', f'{tip}^{{commit}}'))
        want = tip or 'the commit it was created at'
        rows.append((f'{wave}: tag `{tag}`', 'git rev-parse --verify refs/tags/<tag>^{commit}',
                     f'{sha[:9]} ({"the recorded head" if tip else "created at the final L1c tip"})' if pinned
                     else f'{sha[:9] or "no such tag"} -- NOT {want}'))
        if not pinned and tip is None:
            problems.append(f'B0 {wave}: tag {tag} does not resolve (it is created at the final L1c tip, before the squash)')
        elif not pinned:
            problems.append(f'B0 {wave}: tag {tag} does not resolve to the recorded head {tip} ({sha[:9] or "missing"})')
        head_c = tip or sha[:9]
        land, tied = None, False
        if landing is not None:
            landed = ok('merge-base', '--is-ancestor', landing, head)
            rows.append((f'{wave}: squash `{landing}`', f'git merge-base --is-ancestor <squash> {head}',
                         'landed (an ancestor)' if landed else 'NOT an ancestor'))
            if not landed:
                problems.append(f'B0 {wave}: its squash {landing} is not an ancestor of {head}')
            else:
                land = landing
        elif sha and ok('merge-base', '--is-ancestor', sha, head):
            land = sha
            rows.append((f'{wave}: landing', f'git merge-base --is-ancestor <tag> {head}',
                         'the tagged head is itself in this tree\'s history (not squashed yet)'))
        elif sha:
            land = _find_squash(sha, head)
            rows.append((f'{wave}: landing', f'earliest commit of {head} carrying the tag\'s files',
                         f'squash {land[:9]}' if land else 'NOT FOUND'))
            if not land:
                problems.append(f'B0 {wave}: no commit of {head} carries the files {tag} changed')
        else:
            rows.append((f'{wave}: landing', 'needs the tag', 'unknown (no tag)'))
        if land and land == sha and landing is None:
            tied = True
            rows.append((f'{wave}: head tied to its landing', 'the landing IS the tagged head', 'tied'))
        elif land and head_c and pinned:
            changed, bad = _tie(head_c, land)
            tied = bool(changed) and not bad
            rows.append((f'{wave}: head tied to its landing',
                         'git merge-tree --write-tree <squash>^ <head> == <squash>^{tree} (the head changed files)',
                         f'the squash is the head merged onto its parent; the head changed {len(changed)} files' if tied else
                         ('VACUOUS: the head changed no file' if not changed else
                          f'NOT the head merged onto its parent: {len(bad)} file(s) differ: ' + ', '.join(sorted(bad)[:4]))))
            if not changed:
                problems.append(f'B0 {wave}: the tie is vacuous -- {head_c} changed no file against its squash\'s parent')
            elif bad:
                problems.append(f'B0 {wave}: its squash {land[:9]} is not the head {head_c} merged onto its parent -- '
                                f'{len(bad)} file(s) differ: ' + ', '.join(sorted(bad)[:4]))
        landing_of[wave] = land if tied else None
        if landing is not None:
            landing_of[landing] = land if tied else None
        tag_ok[tag] = (sha, tied)
    for path, lref in evidence:
        here = git('rev-parse', f'{head}:{path}')
        if here[0] != 0:
            rows.append((f'`{path}`', f'git rev-parse {head}:<path>', 'MISSING'))
            problems.append(f'B0 evidence missing at {head}: {path}')
            continue
        if lref not in landing_of:
            rows.append((f'`{path}`', 'the wave that landed it', f'{lref} is no wave or wave squash listed above'))
            problems.append(f'B0 evidence {path}: {lref} is not a listed wave squash (or wave name)')
            continue
        land = landing_of[lref]
        if not land:
            rows.append((f'`{path}`', 'the wave that landed it', f'{lref} did not land (see above)'))
            problems.append(f'B0 evidence {path}: its wave {lref} did not land on {head}')
            continue
        then = git('rev-parse', f'{land}:{path}')
        same = then[0] == 0 and then[1] == here[1]
        rows.append((f'`{path}`', f'git rev-parse <landing>:<path> vs {head}:<path>',
                     f'unchanged since {land[:9]}' if same else f'CHANGED since {land[:9]} (or absent there)'))
        if not same:
            problems.append(f'B0 evidence {path}: its blob at {land[:9]} is not its blob at {head}')
    for sha, frm in tips:
        if frm == 'HEAD':
            reach = ok('merge-base', '--is-ancestor', sha, head)
            rows.append((sha, f'git merge-base --is-ancestor <tree> {head}', 'reachable' if reach else 'NOT reachable'))
            if not reach:
                problems.append(f'B0 tip {sha} is not reachable from HEAD')
            continue
        if frm not in tag_ok:
            rows.append((sha, f'the ref `{frm}`', 'REFUSED: not HEAD and not a declared wave tag'))
            problems.append(f'B0 tip {sha}: {frm} is not HEAD or a declared wave tag')
            continue
        tcommit, tied = tag_ok[frm]
        if not tcommit or not tied:
            rows.append((sha, f'the ref `{frm}`', 'REFUSED: its wave did not land on this tree'))
            problems.append(f'B0 tip {sha}: the wave of {frm} did not land on {head}')
            continue
        reach = ok('merge-base', '--is-ancestor', sha, tcommit)
        rows.append((sha, f'git merge-base --is-ancestor <tree> {frm}', 'reachable' if reach else 'NOT reachable'))
        if not reach:
            problems.append(f'B0 tip {sha} is not reachable from {frm}')
    return rows, problems


_B0_WALK_TIP = re.compile(r'WALK `[^`]+`:[\w.-]+ \w+ — report `([^`]+)`, (?:product trees of )?tip ([0-9a-f]{7,40})')
_B0_PATH = re.compile(r'`(docs/notebook/(?:evidence|gate-runs|proof)/[^`]+)`')


def cited_b0_paths(text):
    """Every backticked evidence path the scorecard cites OUTSIDE §0 (§0 is the index itself), in any form --
    a CODE/RULING/RECORD/MEASURE citation, a walk report, a walk instrument, an integrity record, a quote's
    evidence file (F3 fix round 3, review R12-M5: the kind-list regex this replaces saw 20 of the 26)."""
    NL = chr(10)
    start = text.find('## §0')
    if start >= 0:
        end = text.find(NL + '## ', start + 5)
        text = text[:start] + (text[end:] if end >= 0 else '')
    return sorted(set(_B0_PATH.findall(text)))


def cited_b0_gaps(text, evidence=None, tips=None):
    """Review M-6: every evidence file and every walked tree the scorecard CITES must be one §0 checks.
    Returns the names of the ones it does not (an empty list is the pass)."""
    evidence = B0_EVIDENCE if evidence is None else evidence
    tips = B0_TIPS if tips is None else tips
    listed = {p for p, _ in evidence}
    listed_tips = {t for t, _ in tips}
    gaps = []
    for p in cited_b0_paths(text):
        if p not in listed:
            gaps.append(f'evidence {p} is cited but §0 does not check it')
    for _, t in sorted(set(_B0_WALK_TIP.findall(text))):
        if not any(t.startswith(x) or x.startswith(t) for x in listed_tips):
            gaps.append(f'walked tree {t} is cited but §0 does not check it')
    return gaps


# F3 fix round 2 (controller ruling 2): clause 15b is DERIVED, never typed. Every event R-16's core actions
# map to (`CORE_ACTION_EVENTS`, read from the source each build) must have a call-site rail here, and the rail
# must ASSERT it (F3 fix round 3, review R12-M2): a test that is not skipped, in executable code, whose
# expect(...) chain the event's name reaches (tools/telemetry_rail_asserts.mjs, an acorn AST -- a comment is not
# a node), and that test, by its full title, must show a green tick in F3's telemetry log. An event with more than
# one door may name one rail per door (a tuple); every one of them must hold. save_success names two: the
# editor's (T1/T3/T9) and the outbox drain's (T8, `useOutboxDrain.js:302`).
_TNB = 'app/src/pages/journal-2-0/components/notebook'
TELEMETRY_RAILS = {
    'note_open_ms': f'{_TNB}/NoteEditorPage.wave6.test.jsx',
    'save_success': (f'{_TNB}/NoteEditorPage.telemetry.test.jsx',
                     'app/src/pages/journal-2-0/lib/offline/useOutboxDrain.test.jsx'),
    'save_failed': f'{_TNB}/NoteEditorPage.telemetry.test.jsx',
    'capture_used': f'{_TNB}/NoteEditorPage.excerpts.test.jsx',
    'switcher_used': 'app/src/components/CommandPalette.test.jsx',
    'search_used': f'{_TNB}/FolderSidebar.test.jsx',
    'bulk_used': 'app/src/pages/journal-2-0/tabs/NotebookTab.bulk.test.jsx',
    'ask_used': f'{_TNB}/AskPanel.telemetry.test.jsx',
    'export_used': f'{_TNB}/NoteExportControls.test.jsx',
    'share_used': f'{_TNB}/NoteShareControls.test.jsx',
    'publish_used': f'{_TNB}/NoteShareControls.test.jsx',
    'import_used': f'{_TNB}/import/ImportWizard.test.jsx',
    'writing_help_used': f'{_TNB}/NoteEditorPage.writingHelp.test.jsx',
    'dictation_used': f'{_TNB}/NoteEditorPage.dictation.test.jsx',
}


def _js_frozen_object(src, name):
    """The body of `export const <name> = Object.freeze({ ... })` in a JS source, or None."""
    m = re.search(r'export const ' + re.escape(name) + r' = Object\.freeze\(\{(.*?)\n\}\)', src.replace('\r\n', '\n'), re.S)
    return m.group(1) if m else None


_JS_ENTRY = re.compile(r"""\s*(?://[^\n]*\n\s*)*(?:'([^']*)'|"([^"]*)"|([A-Za-z_$][\w$]*))\s*:\s*\[([^\]]*)\]\s*,?""")


def core_action_table(src):
    """`CORE_ACTION_EVENTS` read from the JS source: {core action: [event, ...]}. Every element must be a string
    literal or a `NOTEBOOK_EVENTS.<KEY>` reference that the same file's NOTEBOOK_EVENTS resolves; anything else,
    an action with no event, or text the parser does not consume raises ValueError -- an event is never
    silently dropped from the derivation (F3 fix round 3, review R12-M3)."""
    body = _js_frozen_object(src, 'CORE_ACTION_EVENTS')
    if body is None:
        raise ValueError('CORE_ACTION_EVENTS: no `export const CORE_ACTION_EVENTS = Object.freeze({...})` in the source')
    consts = {}
    ne = _js_frozen_object(src, 'NOTEBOOK_EVENTS')
    for k, v in re.findall(r"([A-Z_][A-Z0-9_]*)\s*:\s*'([^']*)'", ne or ''):
        consts[k] = v
    table, pos = {}, 0
    while True:
        m = _JS_ENTRY.match(body, pos)
        if not m:
            break
        key = next(g for g in m.groups()[:3] if g is not None)
        events = []
        for el in (x.strip() for x in m.group(4).split(',')):
            if not el:
                continue
            lit = re.fullmatch(r"'([^']*)'", el) or re.fullmatch(r'"([^"]*)"', el)
            ref = re.fullmatch(r'NOTEBOOK_EVENTS\.([A-Z_][A-Z0-9_]*)', el)
            if lit:
                events.append(lit.group(1))
            elif ref and ref.group(1) in consts:
                events.append(consts[ref.group(1)])
            else:
                raise ValueError(f'CORE_ACTION_EVENTS[{key!r}]: element {el!r} is not a string literal or a '
                                 'NOTEBOOK_EVENTS.<KEY> this file defines')
        if not events:
            raise ValueError(f'CORE_ACTION_EVENTS[{key!r}]: maps to no event')
        table[key] = events
        pos = m.end()
    rest = re.sub(r'//[^\n]*', '', body[pos:]).strip()
    if rest:
        raise ValueError(f'CORE_ACTION_EVENTS: could not read {rest[:60]!r}')
    if not table:
        raise ValueError('CORE_ACTION_EVENTS: no entries read')
    return table


def core_action_events(src):
    """The distinct event names `CORE_ACTION_EVENTS` maps R-16's core actions to, read from the JS source.
    Raises ValueError (via core_action_table) rather than return a shortened list."""
    return sorted({e for evs in core_action_table(src).values() for e in evs})


RAIL_ASSERTS_TOOL = 'tools/telemetry_rail_asserts.mjs'


def rail_assertions(sources, events):
    """{path: {'error': str|None, 'tests': [{'titles', 'line', 'skipped', 'asserts'}]}} for each rail source, from
    the acorn walk in tools/telemetry_rail_asserts.mjs. Raises RuntimeError when node cannot run it or answers for
    a different set of files: an unreadable rail must never read as a rail that asserts nothing, or as one that
    asserts everything."""
    if not sources:
        return {}
    try:
        r = subprocess.run(['node', os.path.join(ROOT, RAIL_ASSERTS_TOOL)], cwd=ROOT, capture_output=True, text=True,
                           encoding='utf-8', errors='replace', timeout=300,
                           input=json.dumps({'events': sorted(events), 'files': sources}))
    except (OSError, subprocess.SubprocessError) as e:
        raise RuntimeError(f'{RAIL_ASSERTS_TOOL} did not run: {e}') from e
    if r.returncode != 0:
        raise RuntimeError(f'{RAIL_ASSERTS_TOOL} exited {r.returncode}: {r.stderr.strip()[:300]}')
    out = json.loads(r.stdout or '{}')
    if set(out) != set(sources):
        raise RuntimeError(f'{RAIL_ASSERTS_TOOL} answered for {sorted(out)}, not {sorted(sources)}')
    return out


def _rails_of(rails, ev):
    v = rails.get(ev)
    return () if not v else ((v,) if isinstance(v, str) else tuple(v))


def _ran_green(log_text, path, titles):
    """The test `path > titles...` shows a green tick in the vitest log (verbose reporter: one line per test)."""
    want = ' '.join(['\u2713', path.replace('app/', '', 1), '>', ' > '.join(titles)])
    for line in log_text.splitlines():
        line = line.strip()
        if line == want or (line.startswith(want + ' ') and re.fullmatch(r' \d+(?:\.\d+)?m?s', line[len(want):])):
            return True
    return False


def telemetry_rail_gaps(events, rails, read, log_text, asserts=None, where=None):
    """Every core-action event, and the reason it is not railed (an empty list is the pass). `read(path)` returns a
    rail's source, or None if the file is missing; `log_text` is the vitest log the rails ran in; `asserts` is
    rail_assertions (injectable for tests). No events at all is itself a gap: an empty list read from a moved
    table must not pass. `where`, when given, is filled with {event: ['<rail>:<line>', ...]}: the tests that
    assert it and ran green -- the citation."""
    if not events:
        return ['CORE_ACTION_EVENTS: no events read from the source']
    asserts = rail_assertions if asserts is None else asserts
    files = sorted({f for ev in events for f in _rails_of(rails, ev)})
    sources = {f: read(f) for f in files}
    parsed = asserts({f: src for f, src in sources.items() if src is not None}, events)
    gaps = []
    for ev in events:
        fs = _rails_of(rails, ev)
        if not fs:
            gaps.append(f'{ev}: no call-site rail is named for it')
            continue
        for f in fs:
            if sources[f] is None:
                gaps.append(f'{ev}: {f} does not exist')
                continue
            info = parsed.get(f) or {'error': 'no answer for this file', 'tests': []}
            if info.get('error'):
                gaps.append(f'{ev}: {f} could not be parsed ({info["error"][:80]})')
                continue
            hits = [t for t in info['tests'] if ev in t['asserts'] and not t['skipped']]
            if not hits:
                gaps.append(f'{ev}: {f} has no test that asserts it (a comment, a skipped test, or a name that '
                            f'never reaches an expect(...) does not count)')
                continue
            green = [t for t in hits if t['titles'] and _ran_green(log_text, f, t['titles'])]
            if not green:
                gaps.append(f'{ev}: no test of {f} that asserts it ran green in the telemetry log')
            elif where is not None:
                where.setdefault(ev, []).extend(f'{f}:{t["line"]}' for t in green)
    return gaps


_PLAN_AT = {}


def plan_at(rev, n):
    """Line n of the plan as it stood at `rev` (the §B1 inventory cites the plan it was built from)."""
    if rev not in _PLAN_AT:
        rc, out = git('show', f'{rev}:{PLAN}')
        _PLAN_AT[rev] = out.replace('\r\n', '\n').split('\n') if rc == 0 else []
    L = _PLAN_AT[rev]
    return L[n - 1] if 1 <= n <= len(L) else ''


# ── the builder ───────────────────────────────────────────────────────────────────────────────
def build(pages_dir=None):
    """Build the scorecard text. Returns (text, problems, summary); writes nothing."""
    PROBLEMS = []
    FLAGS_NOW = _flags_now() or {}
    HEAD_SHORT = subprocess.run(['git', '-C', ROOT, 'rev-parse', '--short=9', 'HEAD'], capture_output=True,
                                text=True).stdout.strip()


    def git(*a):
        r = subprocess.run(['git', '-C', ROOT, *a], capture_output=True, text=True, encoding='utf-8', errors='replace')
        return r.returncode, r.stdout.strip()


    def lines_of(path):
        return open(os.path.join(ROOT, path), encoding='utf-8', errors='replace').read().replace('\r\n', '\n').split('\n')


    _CACHE = {}


    def line_text(path, n):
        if path not in _CACHE:
            _CACHE[path] = lines_of(path)
        L = _CACHE[path]
        if n < 1 or n > len(L):
            PROBLEMS.append(f'{path}:{n} out of range ({len(L)} lines)')
            return ''
        return L[n - 1]


    def frag_of(line, contains):
        """A substring of `line` (<=110 chars) holding `contains`, free of backticks and pipes."""
        if contains not in line:
            return None
        segs = re.split(r'[`|]', line)
        seg = next((s for s in segs if contains in s), None)
        if seg is None:  # `contains` straddles a backtick or pipe
            return None
        seg = seg.strip().lstrip('*#/ ').strip()
        if len(seg) > 110:
            i = seg.find(contains)
            a = max(0, i - 30)
            seg = seg[a:a + 110].strip()
        return seg


    def cite(kind, path, line, contains, tail=''):
        if isinstance(line, str) and '-' in line:
            a, b = (int(x) for x in line.split('-'))
            joined = ' '.join(line_text(path, n) for n in range(a, b + 1))
            fr = frag_of(joined, contains)
        else:
            fr = frag_of(line_text(path, int(line)), contains)
        if fr is None:
            # A hint for whoever re-points it, never an automatic move: a fragment that moved must be
            # re-read at its new line before the citation is trusted (the scorecard is a measurement).
            if path not in _CACHE:
                _CACHE[path] = lines_of(path)
            hits = [i for i, l in enumerate(_CACHE[path], 1) if contains in l]
            hint = f' (it is on line {hits[0]})' if len(hits) == 1 else (
                f' (it is on {len(hits)} lines: {hits[:6]})' if hits else ' (it is on no line)')
            PROBLEMS.append(f'{kind} {path}:{line} does not hold {contains!r}{hint}')
            fr = contains
        s = f'{kind} `{path}`:{line} "{fr}"'
        return s + (f' {tail}' if tail else '')


    def code(path, line, contains):
        return cite('CODE', path, line, contains)


    def ruling(path, line, contains, tag):
        return cite('RULING', path, line, contains, f'({tag})')


    def record(path, line, contains):
        return cite('RECORD', path, line, contains, '— per record, not re-read')


    def measure(path, line, contains, cmd):
        return cite('MEASURE', path, line, contains, f'— command: {cmd}')


    def flag(key, want):
        f = FLAGS_NOW.get(key)
        got = (f or {}).get('status')
        if got != want:
            PROBLEMS.append(f'flag {key}: the ledger at HEAD says {got!r}, the scorecard says {want!r}')
        return (f'RECORD `docs/feature_flags.json` at {HEAD_SHORT}, key {key}: status {want} '
                f'— per record, not re-read')


    W9 = json.load(open(os.path.join(ROOT, EVD, 'browser-check.json'), encoding='utf-8'))
    W7P = 'docs/notebook/evidence/wave7-walk-8f232d21d/walk-8f232d21d.json'
    W8P = 'docs/notebook/gate-runs/wave8/walk-341bbccf3.json'
    W7 = json.load(open(os.path.join(ROOT, W7P), encoding='utf-8'))
    W8 = json.load(open(os.path.join(ROOT, W8P), encoding='utf-8'))
    W9P2 = None
    if os.path.exists(os.path.join(ROOT, EVD, 'browser-check-pass2.json')):
        W9P2 = json.load(open(os.path.join(ROOT, EVD, 'browser-check-pass2.json'), encoding='utf-8'))


    _walk_checks = walk_verdicts
    _REPORTS = {}

    def walk_at(tool, report, tip, cid, want='PASS'):
        """A WALK cell for any committed walk report: the cited verdict must be the report's own
        (a FAIL or INCONCLUSIVE row is cited as what it is, never as a pass)."""
        if report not in _REPORTS:
            with open(os.path.join(ROOT, report), encoding='utf-8') as fh:
                _REPORTS[report] = walk_verdicts(json.load(fh))
        got = _REPORTS[report].get(cid)
        if got != want:
            PROBLEMS.append(f'walk {report} {cid}: the report says {got!r}, the scorecard says {want!r}')
        return f'WALK `{tool}`:{cid} {got} — report `{report}`, tip {tip}'

    def walk10(cid, want='PASS'):
        return walk_at(W10_WALK_TOOL, W10_WALK, '14310c206', cid, want)

    # Wave 12, lane 12D: the sandbox walk (account deletion, scanned PDF then search), tree 1ad04a0383.
    W12D_WALK = 'docs/notebook/evidence/w12d/sandbox-1ad04a0383/walk.json'

    def walk12d(cid, want='PASS'):
        return walk_at('tools/notebook_w12d_walk.py', W12D_WALK, '1ad04a0383', cid, want)

    def kbd(cid, want):
        return walk_at(KBD_TOOL, KBD_F4, '0555889ef', cid, want)


    def walk9(cid):
        got = _walk_checks(W9).get(cid)
        report, tool = 'browser-check.json', 'browser_check_9b.py'
        if got is None and W9P2 is not None:
            got = _walk_checks(W9P2).get(cid)
            report, tool = 'browser-check-pass2.json', 'browser_check_9b_pass2.py'
        if got != 'PASS':
            PROBLEMS.append(f'9B browser check {cid}: {got}')
        return (f'WALK `{EVD}/{tool}`:{cid} {got} — report `{EVD}/{report}`, product trees of tip '
                f'8a0098029')


    def walk7(cid):
        got = _walk_checks(W7).get(cid)
        if got is None:
            PROBLEMS.append(f'wave-7 walk {cid} missing')
        return f'WALK `tools/notebook_wave7_walk.py`:{cid} {got} — report `{W7P}`, tip 8f232d21d'


    def walk8(cid):
        got = _walk_checks(W8).get(cid)
        if got is None:
            PROBLEMS.append(f'wave-8 walk {cid} missing')
        return f'WALK `tools/notebook_wave8_walk.py`:{cid} {got} — report `{W8P}`, tip 341bbccf3'


    PY_LOG = f'{EVD}/rails-pytest-rA.log'
    PY_TOT = '515 passed, 15856 warnings in 22.21s'
    VT_LOG = f'{EVD}/rails-vitest.log'
    VT_TOT = 'Tests 455 passed (455)'
    AX_LOG = f'{EVD}/rails-vitest-a11y.log'
    AX_TOT = 'Test Files 16 passed (16)'


    def _check_log(log, needle_totals, needle_file):
        t = open(os.path.join(ROOT, log), encoding='utf-8', errors='replace').read()
        norm = re.sub(r'\s+', ' ', t)
        if re.sub(r'\s+', ' ', needle_totals) not in norm:
            PROBLEMS.append(f'{log}: totals {needle_totals!r} not found')
        if needle_file not in t:
            PROBLEMS.append(f'{log}: {needle_file} not in the log')


    def test_py(fname):
        _check_log(PY_LOG, PY_TOT, fname)
        return f'TEST `{fname}` — run by 9B: `{PY_LOG}`, "{PY_TOT}"'


    def test_vt(fname):
        short = fname.replace('app/', '', 1)
        log, tot = (AX_LOG, AX_TOT) if ('/a11y/' in fname or 'errorBeacon' in fname) else (VT_LOG, VT_TOT)
        _check_log(log, tot, short)
        return f'TEST `{fname}` — run by 9B: `{log}`, "{tot}"'


    # Wave 10, F3: the rails this re-score leans on, run once by F3 (scoped pytest, -rA so every node id
    # is in the log) and committed before the scorecard was written. The totals line is READ from the
    # log (its last "N passed" line) and refused if it names any failure or error.
    F3_LOG = 'docs/notebook/evidence/wave10-f3/pytest-f3-rails.log'
    _f3_text = open(os.path.join(ROOT, F3_LOG), encoding='utf-8', errors='replace').read()
    _f3_tot = [l.strip().strip('=').strip() for l in _f3_text.splitlines() if re.search(r'\d+ passed', l)]
    F3_TOT = _f3_tot[-1] if _f3_tot else ''
    if not F3_TOT or re.search(r'failed|error', F3_TOT):
        PROBLEMS.append(f'{F3_LOG}: no clean totals line ({F3_TOT!r})')


    def test_f3(fname):
        _check_log(F3_LOG, F3_TOT, fname)
        return f'TEST `{fname}` — run by F3: `{F3_LOG}`, "{F3_TOT}"'


    # Wave 10, lane AD/L6 (PR #253): the archive-restore rail's own run, committed at the L6 landing
    # (docs/notebook/gate-runs/wave10-L6/pytest-l6.log) before this re-score. Totals read, never typed.
    L6_LOG = 'docs/notebook/gate-runs/wave10-L6/pytest-l6.log'
    _l6_text = open(os.path.join(ROOT, L6_LOG), encoding='utf-8', errors='replace').read()
    _l6_tot = [l.strip() for l in _l6_text.splitlines() if re.search(r'\d+ passed', l)]
    L6_TOT = _l6_tot[-1] if _l6_tot else ''
    if not L6_TOT or re.search(r'failed|error', L6_TOT):
        PROBLEMS.append(f'{L6_LOG}: no clean totals line ({L6_TOT!r})')


    def test_l6(fname):
        _check_log(L6_LOG, L6_TOT, fname)
        return f'TEST `{fname}` — run by L6: `{L6_LOG}`, "{L6_TOT}"'


    # F3 fix round 1 (review I-5): the telemetry wiring rails, run once by F3 on this tree (scoped vitest,
    # verbose, no colour codes) and committed before the scorecard was written; totals read, never typed.
    F3VT_LOG = 'docs/notebook/evidence/wave10-f3/vitest-f3-telemetry-rails-r3.log'  # fix round 3: + the outbox door's rail (T8)
    _f3vt_text = open(os.path.join(ROOT, F3VT_LOG), encoding='utf-8', errors='replace').read()
    _f3vt_tot = [re.sub(r'\s+', ' ', l.strip()) for l in _f3vt_text.splitlines() if re.match(r'\s*Tests\s+\d+ passed', l)]
    F3VT_TOT = _f3vt_tot[-1] if _f3vt_tot else ''
    if not F3VT_TOT or re.search(r'failed|error', F3VT_TOT):
        PROBLEMS.append(f'{F3VT_LOG}: no clean totals line ({F3VT_TOT!r})')


    def test_f3vt(fname):
        _check_log(F3VT_LOG, F3VT_TOT, fname.replace('app/', '', 1))
        return f'TEST `{fname}` — run by F3: `{F3VT_LOG}`, "{F3VT_TOT}"'


    def plan_line(prefix):
        for i, l in enumerate(lines_of(PLAN), 1):
            if l.startswith(prefix):
                return i
        PROBLEMS.append(f'plan has no line starting {prefix!r}')
        return 0


    def D(n, contains):
        return ruling(PLAN, plan_line(f'| D{n} |'), contains, f'D{n}')


    # ── the ledger, parsed ────────────────────────────────────────────────────────────────────────
    LTEXT = open(os.path.join(ROOT, LEDGER), 'rb').read().decode('utf-8')
    LROWS = GLS.parse(LTEXT)
    LLINES = LTEXT.replace('\r\n', '\n').split('\n')


    def ledger_line(rid):
        return next(r.line for r in LROWS if r.rid == rid)


    def capability(rid):
        cells = GLS.split_cells(LLINES[ledger_line(rid) - 1])
        cap = cells[1]
        if cap == rid and len(cells) > 2:  # a Capability cell repeating the ID (G-040's until fix round 1)
            cap = cells[2].split(' (was:')[0]
        cap = cap.replace('`', "'").replace('|', '/')
        return cap


    def L(rid, contains):
        return record(LEDGER, ledger_line(rid), contains)


    # ── wave 10's evidence cells, reused across §A and §B (each a verified citation) ─────────────────
    PAPI = f'{W10D}/personal-api-walk-20260927T043218Z.json'
    PAPI_CMD = ('python tools/notebook_personal_api_walk.py (run by lane 10D in production as the synthetic '
                'member bench@)')
    PAPI_READBACK = measure(PAPI, '48-49', 'read it back as the member: both texts, in order', PAPI_CMD)
    PAPI_REVOKED = measure(PAPI, '65-66', 'the revoked token is refused on its next request', PAPI_CMD)
    QUIET_SLOT = record(PB, '775-776', 'are taken by the controller in a held quiet slot')
    # Quiet re-score QR (2026-10-02): 14d's quiet per-call curve and 4d's quiet TY8 A/B.
    QR_CURVE = 'docs/notebook/gate-runs/wave10-PC/curve-d22-q2.log'
    QR_BOX = 'docs/notebook/gate-runs/wave10-PC/curve-d22-q2-box.txt'
    QR_README = 'docs/notebook/gate-runs/wave10-PC/README-quiet.md'
    QR_CURVE_CMD = ('python tools/notebook_scale_benchmark.py --curve --thresholds docs/notebook/perf-budgets.json '
                    '(the controller, quiet box, 2026-10-02 05:47 CT, tree 93c4bed77)')
    TY8R = 'docs/notebook/perf-runs/ty8/README.md'
    TY8A = [f'docs/notebook/perf-runs/ty8/ab/A{i}.json' for i in (1, 2, 3)]
    TY8_CMD = ('python tools/notebook_perf_harness.py --boot --busy --sizes 1,1000,2000 --opens 20 --chars 60 '
               '(TY8 A/B, quiet box, 2026-10-02 05:08-05:32 CT)')
    TY8_A4_CMD = ('python tools/notebook_perf_harness.py --boot --busy --sizes 1,1000,2000 --opens 20 --chars 60 '
                  '(tie-break run A4, build A, quiet box, 2026-10-02 09:07-09:10 CT, #265)')
    PROOF_CMD = 'python tools/notebook_proof_walk.py --boot (10E-1 instrument; F5 re-ran it)'
    AXE_AFTER = measure(f'{PROOF}/f5-after-aa2417c2c/run.json', '15-18', '"findings": 0', PROOF_CMD)
    PR = f'{PROOF}/README.md'


    # ── lane RS (2026-09-29): the quiet-slot readings, shared across 4b/13d/14a/14b ──────────────────
    QS = f'{PROOF}/quiet-slot-2026-09-29'
    QS_CMD = ('python tools/notebook_scale_benchmark.py --tiers 50000 --attachments 10000 --thresholds '
              'docs/notebook/perf-budgets.json (the controller\'s quiet slot, 2026-09-29 07:04 CT)')
    QS_VERDICT = measure(f'{QS}/qs-50k.log', 44, 'VERDICT: PASS', QS_CMD)
    QS_TREE = record(f'{QS}/tree.txt', 1, '2fb102c74')
    QS_LOAD = record(f'{QS}/load.txt', '1-5', 'foreign_test_procs=0')
    QS_EV = [QS_VERDICT, QS_TREE, QS_LOAD]
    PC_CAVEAT = (
        'a clean quiet-slot reading (0 foreign test processes sampled every 20 s throughout the run, command 1, '
        'tree 2fb102c74) passed every budgeted op at 50,000 notes with 10,000 attachments -- search, reads, tasks '
        'and attachments all under their p95 lines. Read: one genuinely clean reading meets the clause as written, '
        'because the quiet-slot protocol exists precisely to exclude the background-load noise a loaded box adds; '
        'it is not a replication count. CAVEAT: lane PC (branch feat/notebook-w10-pc @ 844a3c957, file '
        'gate-runs/wave10-PC/cmd1-after.log and README.md there; not merged into this tree, read but not '
        'independently re-verified here) re-ran the identical command at 08:27 CT under '
        'market-hours load (load sampled only at the run\'s start and end) and read the relevance-common search op '
        'at 142.5 ms p95 -- a BREACH against the 100 ms budget -- versus this run\'s 71.98 ms on the SAME op and '
        'unchanged code: a 2x swing. That op sits close to its budget with little headroom under contention; the '
        'loaded reading is recorded as a caveat, not as grounds to override a valid clean reading.'
    )
    # Lane RS: AX's re-measurement at 2fb102c74 (9a's template-gallery axe; 9d's keyboard re-walk).
    AX = f'{PROOF}/ax-2fb102c74/README.md'
    AX_9A_REFUSED = record(AX, 18, '9a has NO re-measurement at')
    AX_9A_GALLERY = record(AX, 62, '9a for the template gallery only')
    AX_9D_SUMMARY = record(AX, 133, 'every FAIL the scorecard cites')
    AX_9D_S218 = record(AX, 119, 'FAILs, and the probe explains it as a timing artefact')
    # Lane RS: the rollback rehearsals (3b) -- R1 (2026-09-28) stepping back through every wave boundary,
    # R1b (2026-09-29) re-confirming tip/L2/L1a/wave7 after L2 landed.
    RB28 = 'docs/notebook/evidence/rollback-rehearsal-2026-09-28'
    RB29 = 'docs/notebook/evidence/rollback-rehearsal-2026-09-29'
    RB_WAVE8 = record(f'{RB28}/sandbox-results.md', 19, 'step 9: revert caf6d1b9e (wave 8 #198)')
    RB_WAVE7 = record(f'{RB28}/sandbox-results.md', 21, 'step 11: revert f883e0996 (wave 7 #196)')
    RB_WAVE6 = record(f'{RB28}/sandbox-results.md', 22, 'step 12: revert 271a078b6 (wave 6 #193)')
    RB_WAVE5 = record(f'{RB29}/objects.log', 16, 'wave-5 rows gone: True')
    RB_R1_RAIL = record(f'{RB28}/fr2-rail.log', 6, '34 passed')
    RB_R1B_WAVE7 = record(f'{RB29}/sandbox-results.md', 8, 's-wave7')
    RB_R1B_RAIL = record(f'{RB29}/final-rail.log', 6, '21 passed')
    # Lane RS: 3c (the Sunday KEEP verdict) and 7a (the hand-run restore drill).
    KEEP_MD = 'docs/notebook/evidence/evidence-gate-soak-only-2026-09-28-KEEP.md'
    KEEP_VERDICT = record(KEEP_MD, 3, 'VERDICT: **KEEP**')
    KEEP_ROWS = record(KEEP_MD, 6, '22 (1 skipped)')
    KEEP_SKIP = record(KEEP_MD, 7, 'UNOBSERVED, not clean')
    KEEP_DNB = record(KEEP_MD, 11, 'do-not-build: CLEAN')
    RESTORE_MD = 'docs/notebook/evidence/evidence-restore-drill-2026-09-28-hand-PASS.md'
    RESTORE_INTEGRITY = record(RESTORE_MD, 6, 'integrity_check: ok')
    RESTORE_TOMBSTONES = record(RESTORE_MD, 16, 'replayed: 0')
    RESTORE_ATTACH = record(RESTORE_MD, 26, 'every sha256 matches')
    # Lane RS: 6c, the L2/L4-era layout proofs -- L3's joystick occlusion sweep, D3P's control census,
    # D5's board scroll-fade cue after its round-1 fix.
    L3R2 = f'{PROOF}/l3-layout-0e72ad573/r2-after/run.json'
    L3_TIP = record(L3R2, 2, '"tip": "a2016db20"')
    L3_LEADS = record(L3R2, '44299-44301', '"CONFIRMED": 8')
    L3_FINDING = record(L3R2, 22960, '"control": "Joystick, Notebook"')
    D3PR2 = f'{PROOF}/d3p-raw/after-r2/run.json'
    D3P_TIP = record(D3PR2, 2, '"tip": "after-r2:c226c163c"')
    D3P_LEADS = record(D3PR2, '184537-184539', '"CONFIRMED": 32')
    D5R1 = f'{PROOF}/d5-after-round1-fix/probe.json'
    D5_CUE = record(D5R1, 16, '"cue_attr": "true"')
    D5_OVERFLOW = record(D5R1, 22, '"overflowing": true')

    # Lane SC (2026-09-30): the L11 proof walk (10E-1's five-sweep instrument, tip 52deeb767 = L10 +
    # DR-F + LK + FX2 + WK4 + FX3 + WK5). Raw evidence committed first at a962839da (R-RAW); its
    # reading at 67074722e. All five sweeps' controls are VALID (`run.json` `sweep_status`).
    L11 = f'{PROOF}/l11-52deeb767'
    L11_CMD = 'python tools/notebook_proof_walk.py --boot (lane WK5/L11, tip 52deeb767)'
    L11_README = f'{L11}/README.md'
    L11_INTEGRITY = record(f'{L11}/integrity.md', 11, 'db files')
    # 9a: axe -- 123/123 MEASURED, 0 violations, control VALID in every theme.
    L11_AXE_RUN = measure(f'{L11}/run.json', '22-24', '"findings": 0', L11_CMD)
    L11_AXE_COUNT = record(L11_README, 20, '123/123 runs MEASURED')
    L11_AXE_CONTROL = measure(f'{L11}/axe.json', '2597-2598', 'contrast_found', L11_CMD)
    # 2b (the L11 README's own label; the content is the PATH census -- WORKS/N-A/NOT-DRIVEN/BROKEN/
    # NO-DOOR -- the same walk `docs/notebook/proof/README.md`'s own "2a" section reads; the letter
    # drifted between lanes, the clause it feeds ("every shipped feature does what it says on every
    # path") did not).
    L11_CENSUS_VERDICTS = record(L11_README, 24, 'WORKS 113, N/A 30, NOT-DRIVEN 22')
    L11_CENSUS_G171 = measure(f'{L11}/census.json', '893-895', '"verdict": "WORKS"', L11_CMD)
    L11_CENSUS_G155 = measure(f'{L11}/census.json', '568-570', '"verdict": "WORKS"', L11_CMD)
    # 5d: silent -- 72/72 reads SENTENCE, writes 24 SENTENCE + 4 EXEMPT, 0 SILENT.
    L11_SILENT_READS = record(L11_README, 31, '72/72 SENTENCE')
    L11_SILENT_WRITES = record(L11_README, 32, '24 SENTENCE and 4 EXEMPT')
    L11_SILENT_TRASH = measure(f'{L11}/silent.json', '2243-2258', 'trash-note', L11_CMD)
    # 6c: geometry -- control VALID, 129/129 cells; the findings are an INVENTORY (raw occluded/tap/
    # overflow counts), never a verdict on their own (README's own words).
    L11_GEOM_RUN = measure(f'{L11}/run.json', '16-18', '"findings": 2437', L11_CMD)
    L11_GEOM_BREAKDOWN = record(L11_README, 38, 'occluded 2110, tap 273, overflow 54')
    L11_GEOM_TABLE = record(L11_README, 14, '2278')
    # 2c: dead clicks -- control VALID (the first ever valid reading), 30/39 MEASURED, 9 TIMEOUT
    # (budget, not a hang), 3 DEAD.
    L11_DEAD_RUN = measure(f'{L11}/run.json', '34-36', '"findings": 1', L11_CMD)
    L11_DEAD_FIRST_VALID = record(L11_README, 43, 'the first real measurement since WK3')
    L11_DEAD_SURFACES = record(L11_README, 44, '30 MEASURED, 9 TIMEOUT')
    L11_DEAD_TABLE = measure(f'{L11}/deadclick.json', 8285, '"verdict": "DEAD"', L11_CMD)
    L11_DEAD_CAL = measure(f'{L11}/deadclick.json', 15148, '"verdict": "DEAD"', L11_CMD)
    L11_DEAD_TL = measure(f'{L11}/deadclick.json', 17733, '"verdict": "DEAD"', L11_CMD)
    L11_TIMEOUT_BUDGET = record(L11_README, 47, 'TIMEOUTs are budget, not hangs')
    # 6a: design sign-off -- DR-R's re-review + DR-F's D-7/D-8/D-9 closure + the controller's
    # delegated countersign (D21).
    DR2 = 'docs/notebook/design-review-2.md'
    DR2_D7_CLOSED = record(DR2, 329, 'the WATCHING column and its card are now on the first')
    DR2_D8_CLOSED = record(DR2, 341, 'search-sidebar 6->0, timeline 8->0')
    DR2_D9_CLOSED = record(DR2, 351, 'today\'s (Sep 30 ET)')
    DR2_COUNTERSIGN = record(DR2, 385, 'every item this review lists is now closed with evidence')
    DR2_SIGNED = record(DR2, 389, 'Countersigned, all seven surfaces')
    DR2_RESIDUAL = record(DR2, 393, 'link-suggestion popup race against autosave')

    # Lane SC2 (2026-09-30): new evidence for two clauses lane SC left NOT MET -- the L12 dead-click
    # full sweep (0100a3032, R-RAW at 3d95c76fc) plus its targeted re-run of the 2 surfaces it could
    # not finish (6cbf0618e, R-RAW at 589b0ddf9), and the un-scoped L3 layout re-confirm (fe01bdb14,
    # R-RAW at e50f2a1ba, ruling D23 applied in its classifier). The reading of all three is
    # docs/notebook/proof/l12-READINGS.md, committed after every raw file it cites. None of this
    # existed at any earlier registered wave's landing, so it ties to a new un-landed wave
    # ('wave 10 SC2', same tip=None/landing=None shape as 'wave 10 SC' -- the tag is created at this
    # lane's own final commit, after every evidence file below is committed).
    L12R = f'{PROOF}/l12-READINGS.md'
    L12DC1 = f'{PROOF}/l12dc-0100a3032'
    L12DC1_CMD = ('python tools/notebook_proof_walk.py --sweeps deadclick --boot (lane L12, tip '
                  '0100a3032, full sweep, R-RAW at 3d95c76fc)')
    L12DC2 = f'{PROOF}/l12dc2-6cbf0618e'
    L12DC2_CMD = ('python tools/notebook_proof_walk.py --sweeps deadclick --surface-deadline 900 --boot '
                  '(lane L12, tip 6cbf0618e, targeted re-run of the 2 unfinished surfaces, R-RAW at '
                  '589b0ddf9)')
    # 2c: dead clicks -- full sweep (39 surfaces: 37 MEASURED, 1 TIMEOUT, 1 ERROR, 0 real DEAD; the 2
    # DEAD verdicts in the raw file are the planted dead controls, which must read DEAD for the
    # control to be VALID) plus a targeted re-run of the 2 unfinished surfaces (both MEASURED).
    # Together: 39/39 measured, 0 DEAD.
    L12DC_FULL_RUN = measure(f'{L12DC1}/run.json', 12, '"findings": 0', L12DC1_CMD)
    L12DC_FULL_SURFACES = record(L12R, 9, '39: 37 MEASURED, 1 TIMEOUT, 1 ERROR')
    L12DC_FULL_DEAD = record(L12R, 32, '0 DEAD')
    L12DC_TARGETED_RUN = measure(f'{L12DC2}/run.json', 12, '"findings": 0', L12DC2_CMD)
    L12DC_TARGETED_TEMPLATES = measure(f'{L12DC2}/deadclick.json', 2579, '"LIVE": 59', L12DC2_CMD)
    L12DC_TARGETED_FIRSTRUN = measure(f'{L12DC2}/deadclick.json', 132, '"OCCLUDED": 5', L12DC2_CMD)
    L12DC_INTEGRITY = record(L12R, 40, 'CLEAN at all four checkpoints in both runs')
    # 6c: layout -- the L3 instrument's un-scoped re-confirm (every surface, 390/820/1200, orb+hub
    # passes, hint-seen and coach-pending both states), ruling D23's SAME-COMPONENT reclass applied
    # to the raw rows (unchanged) rather than hidden: 0 CONFIRMED remain on this run.
    L3RC = f'{PROOF}/l3-reconfirm-fe01bdb14'
    L3RC_VALID = record(f'{L3RC}/run-meta.json', 119, '"controls_valid": true')
    L3RC_ERRORS = record(f'{L3RC}/run-meta.json', 682, '"errors": []')
    L3RC_CLEARED = record(f'{L3RC}/run-meta.json', 23714, '"CLEARED": 398')
    L3RC_SAME = record(f'{L3RC}/run-meta.json', 23715, '"SAME-COMPONENT": 88')
    L3RC_POPUP = record(f'{L3RC}/run-meta.json', 23716, '"under-open-popup": 36')
    L3RC_RULING_TAG = record(f'{L3RC}/run-meta.json', 20716, '"ruling": "D23"')
    L3RC_CONFIRMED = record(L12R, 53, 'CONFIRMED')
    L3RC_READING = record(L12R, 51, 'the hub knob beneath its own pad')


    # ── competitor cells ──────────────────────────────────────────────────────────────────────────
    VENDOR = {'N': 'notion', 'E': 'evernote', 'O': 'obsidian'}
    RROW = {'notion': 'R12', 'obsidian': 'R13', 'evernote': 'R14'}
    EB = ('not verified — help.evernote.com refused every fetch today (Cloudflare 403, R15) and no '
          'evernote.com page fetched today (R14) states it')
    NFN = 'not verified — no Notion help page fetched today (R12) states it'
    NFO = 'not verified — no Obsidian help page fetched today (R13) states it'
    NA = 'not verified — no competitor claim made: a UCT-internal or UCT-unique row'
    R18 = ' (R18, wave 12 lane 12C, 2026-10-02)'   # the lane-12C fetch pass, named in a cell's note
    SPEED = ('not verified — a competitor\'s speed is lane 9A\'s protocol and the owner\'s run '
             '(`docs/notebook/benchmark/protocol.md`), never stated here')
    USED = OrderedDict()


    def qref(key, rid):
        pid, q = QUOTES[key]
        m = SOURCES[pid]
        USED.setdefault(key, []).append(rid)
        # Wave 12, lane 12C: the date is the page's OWN fetch date (R12-R17's pages read 2026-09-26, R18's
        # 2026-10-02), never one constant for every cell.
        return f'{m["public_url"]} "{q}" ({m["fetched_utc"][:10]})'


    PARA_WORD = {'HAS': 'has it', 'PARTIAL': 'has part of it', 'LACKS': 'lacks it',
                 'NO-VERDICT': 'no verdict', 'N/A': 'not applicable'}


    def comp_part(v, spec, rid):
        if isinstance(spec, str):
            return f'{v}: {spec}'
        if isinstance(spec, dict) and 'para' in spec:
            ev = spec['para']
            return (f'{v}: not verified (PARAPHRASE, never a quote) — {ev["url"]} read {ev["fetched"]} in a real '
                    f'browser; the reader\'s summary, not Evernote\'s words: {PARA_WORD.get(ev["verdict"], ev["verdict"])} '
                    f'({ev.get("paraphrase") or ev.get("note") or "no note"}) [R17 evidence `{EVERNOTE_EVIDENCE}`]')
        return f'{v}: ' + '; '.join(qref(k, rid) for k in spec)


    VMAP = {'P': 'PARITY', 'A': 'AHEAD', 'B': 'BEHIND', 'NA': 'N/A', 'NV': 'NOT-VERIFIED',
            'BO': 'BLOCKED (owner)', 'BE': 'BLOCKED (external)'}


    def vword(v):
        if v in VMAP:
            return VMAP[v]
        m = re.fullmatch(r'D(\d+)', v)
        if m:
            return f'OUT-OF-SCOPE (D{m.group(1)})'
        raise ValueError(v)


    UI_NOT = 'UI not confirmed in any browser walk (wave 9\'s check or a wave-10 walk) — not scored as met.'
    ROWS = OrderedDict()


    def R(rid, v, uct, comp, note='', lever=''):
        if isinstance(v, str):
            v = (v, v, v)
        ROWS[rid] = dict(v=[vword(x) for x in v], uct=uct, comp=comp, note=note, lever=lever)


    # ═══ §A data: one entry per ledger row ═════════════════════════════════════════════════════════
    NS = 'api/services/journal_two/notes.py'
    NB = 'app/src/pages/journal-2-0/components/notebook'
    LB = 'app/src/pages/journal-2-0/lib'
    JT = 'api/services/journal_two'

    # Trust / Recovery
    _p2 = _walk_checks(W9P2) if W9P2 else {}
    if _p2.get('B24_template_picker') == 'PASS':
        TPL_V, TPL_EV, TPL_NOTE, TPL_LEVER = 'P', [walk9('B24_template_picker')], \
            'B24: Templates opened the picker; Long/Short Thesis made a note with the template\'s headings.', ''
    else:
        TPL_V, TPL_EV, TPL_NOTE, TPL_LEVER = 'NV', [], 'The built-in template picker was not confirmed in the browser. ' + UI_NOT, \
            'open Templates in a browser pass'
    R('G-001', ('P', 'P', 'P'), [code(NS, 4120, 'def restore_note('), walk9('B20_more_older_rows'), walk9('B22_trash_restore')],
      {'N': ['N_restore', 'N_trash'], 'E': ['E_trash'], 'O': ['O_trash']},
      'B22: deleted through the confirm dialog, found in Trash, restored, back in All notes.')
    R('G-002', ('P', 'P', 'P'), [code(f'{NB}/NoteHistoryPanel.jsx', 18, 'Restore'), code(NS, 3474, 'def restore_note_version('),
                      walk9('B17_older_rows'), walk9('B23_version_restore')],
      {'N': ['N_version'], 'E': ['E_version'], 'O': ['O_recovery']},
      'B23: an edit made a version; History listed it and restoring it brought the original words back.')
    R('G-003', ('P', 'P', 'NV'), [code(f'{JT}/account_purge.py', 53, '"j2_notes",'),
                                 walk12d('G-003.D1_signup_through_the_form'), walk12d('G-003.D2_note_with_attachment'),
                                 walk12d('G-003.D3_member_requests_deletion'),
                                 walk12d('G-003.D4_owner_deletes_on_the_admin_page'),
                                 walk12d('G-003.D5_data_gone_tombstone_kept')],
      {'N': ['N_delete_acct'], 'E': ['E_delete_acct'], 'O': NFO},
      'Wave 12 (12D) walked it on a sandbox (tree 1ad04a0383, integrity CLEAN at every checkpoint): a member signed up '
      'through the form, wrote a note with an attachment and requested deletion; the owner deleted the account on the '
      'admin page; sign-in then failed, the user row, every j2 row (9 before, 0 after across 72 j2 tables) and the '
      'attachment directory were gone, and the tombstone was kept on and off site. The UCT side is now a walk, not a code '
      'reading, so the Notion and Evernote quotes (both: deleting the account deletes its data) give PARITY. UCT\'s '
      'deletion runs through the owner after a member request; PARITY is the purge as named.')
    R('G-004', ('P', 'P', 'P'), [L('G-004', 'owner-accepted 2026-09-22')],
      {'N': ['N_encrypt'], 'E': ['E_atrest'], 'O': ['O_e2e']},
      'Obsidian Sync is end-to-end, a stronger property; E2E is OUT by ruling D11 (plan). PARITY is at-rest encryption as named. '
      'Evernote: its security page, re-fetched' + R18 + ', states infrastructure encryption at rest for the data it stores '
      '(wave 9 read it as in transit and for secrets only).')
    R('G-005', 'NV', [code(f'{NB}/NoteEditorPage.jsx', 226, 'const DRAFT_KEY')],
      {'N': NFN, 'E': ['E_offline'], 'O': NFO},
      'No page fetched today describes a crash-draft safety net; the draft restore itself was not driven. ' + UI_NOT)
    # Search / Retrieval
    R('G-010', 'P', [code(NS, 1481, 'exact_ticker'), walk9('B20_more_older_rows')],
      {'N': ['N_searchfilter'], 'E': ['E_search'], 'O': ['O_search']},
      'B20: a sidebar search returned the target with highlighted matches.')
    R('G-011', 'NV', [measure(PB, '299-303', 'ops still above 100 ms p95 at 50k',
                              'python tools/notebook_scale_benchmark.py --tiers 50000 --thresholds docs/notebook/perf-budgets.json --budget search --budget reads --budget tasks'),
                      QUIET_SLOT],
      {'N': SPEED, 'E': SPEED, 'O': SPEED},
      'Wave 9 measured UCT\'s own 50k search budget BREACHED; wave 10 (10A) built every named lever, and its '
      'quiet-box verdict waits on the controller\'s quiet slot (§C); competitor latency is not this file\'s to state.')
    R('G-012', 'NA', [code(f'{NB}/FolderSidebar.jsx', 620, 'P0-2 fix')], {'N': NA, 'E': NA, 'O': NA},
      'A UCT correctness bug row.')
    R('G-013', ('P', 'P', 'P'), [code(NS, 1523, 'date_from'), walk9('B20_more_older_rows')],
      {'N': ['N_datefilter'], 'E': ['E_datefilter'], 'O': ['O_filterstmt', 'O_datearith']},
      'B20: the filter panel carries "Note created from". Obsidian: a Bases filter is a statement over a note, and its own '
      'date-arithmetic example selects files modified within the last week' + R18 + '.')
    R('G-014', ('NV', 'P', 'P'), [code(NS, 1696, 'def _snippets_for('), walk9('B20_more_older_rows')],
      {'N': NFN, 'E': ['E_snippet'], 'O': ['O_snippet']}, 'B20: 4 highlighted matches in the result snippets.')
    R('G-015', ('P', 'NV', 'A'), [code(NS, 1854, 'relevance ranking is opt-in')],
      {'N': ['N_relevance'], 'E': ['E_meaning'], 'O': ['O_sortlist1', 'O_sortlist2']},
      'Ranking is a server behaviour (the search box asks for sort=relevance). Obsidian AHEAD by controller ruling (12C '
      'phase 2): its search page lists every result sort order it offers -- file name, modified time, created time -- '
      'and relevance is not among them (R18), the limit stated on its own page. Evernote NOT-VERIFIED (F3 fix round 1, '
      'review I-6): its only quote is the Semantic search article (search by meaning), the committed evidence line '
      'itself says a relevance-vs-recency sort is not evidenced by that page, and UCT\'s meaning search is BLOCKED '
      '(G-017, G-127).')
    R('G-016', 'NA', [code(NS, 3046, 'def resolve_sector_theme_symbols(')], {'N': NA, 'E': NA, 'O': NA},
      'The ticker/sector/theme entity model is UCT\'s; generic database properties are compared under G-021.')
    R('G-017', 'BE', [code(f'{JT}/note_semantic.py', 28, 'NOTEBOOK_SEMANTIC_SEARCH_ENABLED'),
                      flag('NOTEBOOK_SEMANTIC_SEARCH_ENABLED', 'dark'), walk7('W19_semantic_dark')],
      {'N': NFN, 'E': ['E_semantic'], 'O': NFO},
      'Built, dark until the embedding vendor confirms zero retention in writing (D7).', 'ZDR in writing (owner, external)')
    R('G-018', 'NA', [code(NS, 1481, 'exact_ticker')], {'N': NA, 'E': NA, 'O': NA}, 'A UCT correctness bug row.')
    # Organization
    R('G-020', 'P', [code(NS, 51, 'MAX_FOLDER_DEPTH = 6'), walk9('B21_folders_nested')],
      {'N': ['N_subpage'], 'E': ['E_mention'], 'O': ['O_folder']},
      'B21: a folder and a subfolder made in the sidebar; the server nests one under the other. PARITY is nesting as named '
      '(Notion nests pages, Evernote has notebooks and stacks, Obsidian folders).')
    R('G-021', ('P', 'NV', 'P'), [code('api/services/journal_two/note_properties.py', 565, 'SAVEABLE_VIEW_TYPES'),
                                 walk9('B09_list_views_bulk')],
      {'N': ['N_board', 'N_props'], 'E': EB, 'O': ['O_views', 'O_props']},
      'B09: list, table, board, calendar, graph, timeline and tasks modes. Formulas and rollups are OUT until demand '
      'is measured (D12) and are not cited on the competitor side.')
    R('G-022', ('P', 'P', 'P'), [code(NS, 2728, 'def get_note_backlinks('), walk9('B09_list_views_bulk')],
      {'N': ['N_backlinks'], 'E': ['E_backlinks'], 'O': ['O_backlinks', 'O_graph']},
      'B09 drew the graph canvas; B10 opened the backlinks neighbourhood (unlinked mentions). PARITY is backlinks as '
      'Notion and Evernote name them; only Obsidian also documents a graph.')
    R('G-023', ('P', 'P', 'P'), [code(NS, 3187, 'j2_note_favorites'), walk9('B20_more_older_rows')],
      {'N': ['N_favorites'], 'E': ['E_pin'], 'O': ['O_bookmarks']}, 'B20: Add to Favorites pressed; the sidebar lists it.')
    R('G-024', ('P', 'P', 'P'), [code(NS, 4394, 'j2_note_recents'), walk9('B20_more_older_rows')],
      {'N': ['N_favorites', 'N_switch'], 'E': ['E_recents'], 'O': ['O_recents']},
      'B20: the sidebar carries Recents. Evernote lists recent notes in its search view; Obsidian\'s Quick switcher lists '
      'them on an empty search' + R18 + '.')
    R('G-025', ('P', 'P', 'P'), [code(f'{NB}/SavedViewEditor.jsx', 13, 'export default function SavedViewEditor'),
                                 walk9('B25_saved_view')],
      {'N': ['N_savedview'], 'E': ['E_savedsearch'], 'O': ['O_views']},
      'B25: a table view saved by name; on a fresh page the saved view reopened as a table.')
    R('G-026', TPL_V, [code(f'{LB}/notebookTemplates.js', 565, "key: 'thesis',")] + TPL_EV +
      [record('docs/notebook/evidence/wave12-12b/walk-5.json', 16, 'the gallery renders the catalog (keys read from the page)'),
       record('docs/notebook/evidence/wave12-12b/walk-5.json', 31, 'every wave-12 new or deepened template is in the gallery')],
      {'N': ['N_dbtemplate'], 'E': ['E_templates'], 'O': ['O_templates']},
      TPL_NOTE + ' Wave 12 (12B) deepened the built-in library: its sandbox walk 5 read 32 templates in the gallery, '
      'opened every new and deepened one in the editor at 1200 and 390 px with no schema refusal, and 220 of 222 rows '
      'passed; the 2 FAILs are a finding probe (Enter on the trade-review walkthrough chevron moved the body instead of '
      'opening the toggle), recorded as a finding, not a template defect.', TPL_LEVER)
    # Editor
    R('G-030', 'P', [code(f'{LB}/tiptap.js', 129, 'Table.configure'), walk9('B01_slash_menu'), walk9('B02_code_math_callout')],
      {'N': ['N_callout'], 'E': ['E_editmode'], 'O': ['O_callout', 'O_tables']},
      'B01/B02: headings, lists, tables, callouts, code and math in one editor.')
    R('G-031', ('P', 'NV', 'P'), [code('app/src/components/CommandPalette.jsx', 35, "label: 'New Note'"), walk9('B08_quick_switcher')],
      {'N': ['N_switch'], 'E': EB, 'O': ['O_palette']}, 'B08: Ctrl+K opened the palette.')
    R('G-032', ('P', 'P', 'NV'), [code(f'{NB}/NoteFindBar.jsx', 8, 'Replace all'), walk9('B20_more_older_rows')],
      {'N': ['N_find'], 'E': ['E_find'], 'O': NFO}, 'B20: Ctrl+F opened the find bar.')
    R('G-033', 'P', [code(f'{NB}/NoteLinkMenu.jsx', 2, 'triggered internal-note-link autocomplete'), walk9('B17_older_rows')],
      {'N': ['N_wikilink'], 'E': ['E_mention'], 'O': ['O_links']}, 'B17: typing [[ offered the target note.')
    R('G-034', 'NA', [code('app/src/widgets/registry.js', 296, 'journal: true'), walk9('B28_widget_insert')], {'N': NA, 'E': NA, 'O': NA},
      'UCT-unique (live market widgets in a note). B28 inserted a chart widget from the palette; its saved body carries it.')
    R('G-035', 'NV', [L('G-035', 'OPEN, DELIBERATELY'),
                      measure(PB, '401-402', 'typing per char', 'python tools/notebook_perf_harness.py --boot --sizes 1000,2000 --opens 20 --chars 60')],
      {'N': SPEED, 'E': SPEED, 'O': SPEED},
      'Open by owner ruling (the row\'s own status). Wave 10 (10A) attributed typing in a real browser and fixed two '
      'causes; the loaded p95 sits at the 16 ms line at 1,000-2,000 paragraphs and no quiet reading exists (§C).',
      'owner ruling on G-035 stands at the cap; below it, the controller\'s quiet slot (and F1, in flight)')
    R('G-036', 'P', [code(f'{NB}/NoteEditorPage.jsx', 9, 'ALLOWED_ATTACHMENT_MIMES'), walk9('B29_pdf_upload_preview_search')],
      {'N': ['N_pdf'], 'E': ['E_searchimg'], 'O': ['O_attach']},
      'B29: a PDF uploaded through Attach a file became an attachment chip in the note.')
    R('G-036b', ('P', 'P', 'P'), [code(f'{NB}/DocumentPreviewSheet.jsx', 23, 'the same fullscreen'),
                                  walk9('B29_pdf_upload_preview_search')],
      {'N': ['N_pdfembed'], 'E': ['E_pdfpreview'], 'O': ['O_formats']},
      'B29: clicking the chip opened "Preview of <file>" with the page drawn on a canvas.')
    # Capture
    R('G-040', 'NA', [D(8, 'G-040: stays descoped')], {'N': NA, 'E': NA, 'O': NA},
      'Internal UCT capture coverage (widgets into the Notebook); descoped by the owner.')
    R('G-041', 'NV', [code(f'{NB}/CaptureDialog.jsx', 256, 'Your note')], {'N': NFN, 'E': ['E_clipcomment'], 'O': NFO},
      'The capture dialog was not driven, so no verdict against any competitor; Evernote\'s Web Clipper guide states a '
      'comment added before the clip' + R18 + '. ' + UI_NOT,
      'drive the capture dialog in a browser pass (UCT side); N: a page that states it (next R-row); O: a page that '
      'states it (next R-row)')
    R('G-042', 'NA', [code(f'{JT}/note_trade_links.py', 68, 'def resolve_trade_ref(')], {'N': NA, 'E': NA, 'O': NA},
      'UCT-unique (trade references).')
    R('G-043', 'BO', [code('extension/manifest.json', 3, '"name": "UCT Browser Capture",'),
                      code('tools/package_extension.py', 1, 'Build the Chrome Web Store upload for UCT Browser Capture.'),
                      D(4, 'the web clipper (publish the extension already built, G-043)')],
      {'N': ['N_clipper'], 'E': ['E_clipper'], 'O': ['O_clipper']},
      'Built and packaged; the Chrome Web Store submission is the owner\'s (plan §5 item 4).', 'owner: store submission')
    R('G-044', 'NV', [code('app/public/manifest.json', 36, '"share_target": {'),
                      code('api/routers/notebook_personal_api.py', 16, 'NOTEBOOK_PERSONAL_API_ENABLED'),
                      flag('NOTEBOOK_PERSONAL_API_ENABLED', 'armed'), PAPI_READBACK,
                      D(5, 'PWA + Apple Shortcuts over the personal API'), L('G-044', 'has not been run on an iPhone')],
      {'N': NFN, 'E': ['E_share_ext'], 'O': ['O_ios']},
      'Android share target in the manifest. The iOS path (Shortcuts over the personal API) is no longer behind a dark '
      'gate: the API is armed and walked in production as bench@ (10D), but no Shortcut has run on an iPhone, so the '
      'member-facing iOS capture is unconfirmed.',
      'owner: run the iOS Shortcut on an iPhone (docs/notebook/ios-shortcuts.md)')
    R('G-045', ('A', 'P', 'NV'), [code(f'{JT}/document_ocr_tesseract.py', 40, 'FLAG = "J2_OCR_ENABLED"'),
                                 flag('J2_OCR_ENABLED', 'armed'), walk7('W14_image_ocr_document'),
                                 walk12d('G-045.S1_fixture_is_a_scan'), walk12d('G-045.S2_ocr_read_the_page'),
                                 walk12d('G-045.S3_search_finds_image_word')],
      {'N': ['N_noocr'], 'E': ['E_searchimg', 'E_scan'], 'O': NFO},
      'Wave 12 (12D) walked it on a sandbox (tree 1ad04a0383, Tesseract present): a one-page PDF with no extractable '
      'text was attached in the editor, OCR read the page, and the sidebar search found a word that exists only in the '
      'image ("1 DOCUMENT PAGE", scanned text, opening the scan\'s note); a nonsense control word found nothing. Notion '
      'AHEAD: its import page states a scanned PDF is not reliably searchable until OCR is run, the limit on its own page. '
      'Evernote PARITY: it searches text inside images and scanned documents.')
    # AI
    R('G-050', 'NV', [code('api/services/note_ask.py', 13, 'Every Ask scope now builds prompts'),
                      test_py('tests/test_note_ask_prompt_boundary.py'), walk9('B20_more_older_rows')],
      {'N': ['N_aiwrite'], 'E': ['E_assistant'], 'O': NFO},
      'B20 opened the Ask panel; the sandbox has no model key, so no answer was observed. ' + UI_NOT,
      'a browser pass with a model key')
    R('G-051', 'NV', [code(f'{JT}/ask_service.py', 9, 'Everything scope-specific lives in'), test_py('tests/test_ask_evidence.py')],
      {'N': ['N_research', 'N_cite'], 'E': ['E_assistant'], 'O': NFO},
      'No model key in the sandbox: an Ask Notebook answer was not observed. ' + UI_NOT, 'a browser pass with a model key')
    R('G-052', 'BE', [L('G-052', 'EXPERIMENT, BLOCKED')], {'N': NA, 'E': NA, 'O': NA},
      'Blocked on vendor data rights (legal, external); the ledger records no competitor equivalent (not re-fetched).',
      'vendor redistribution terms (external)')
    R('G-053', 'NA', [code(f'{JT}/coach_chat_tools.py', 1848, 'search_my_notes'), flag('COMPASS_NOTES_TOOL_ENABLED', 'armed'),
                      walk7('W20_compass_notes_tool_dark')], {'N': NA, 'E': NA, 'O': NA},
      'An internal architecture row (Compass reads notes through the Ask retrieval).')
    # Temporal correctness / provenance
    R('G-060', 'NA', [code(f'{JT}/db.py', 954, 'j2_fact_observations')], {'N': NA, 'E': NA, 'O': NA}, 'UCT-unique.')
    R('G-061', 'NA', [code(f'{LB}/widgetEmbedCore.js', 384, 'export function resolveEmbedRender(attrs)')], {'N': NA, 'E': NA, 'O': NA},
      'UCT-unique (plan §1: frozen as of insertion).')
    R('G-062', 'NA', [code(f'{JT}/fact_registry.py', 69, '"analyst_price_target_consensus": FactTypeDef('),
                      code(f'{JT}/fact_registry.py', 41, 'rights_class: RightsClass'),
                      record('docs/notebook/VENDOR-TERMS-2026-09-23.md', 91, 'Analyst-consensus storage (G-062): UNBLOCKED'),
                      walk_at(G62_WALK_TOOL, G62_WALK, '4d2a4edfa', 'G5_slash_command_door'),
                      walk_at(G62_WALK_TOOL, G62_WALK, '4d2a4edfa', 'G6_tickerpopup_door')],
      {'N': NA, 'E': NA, 'O': NA},
      'UCT-unique. Legal sign-off landed (owner, 2026-09-25): FMP licensing approved directly, so the '
      'conditional fact type is ACTIVE; both member doors (the /consensus slash command and the '
      'TickerPopup button) walked PASS in a real browser, G3 on live FMP data.')
    R('G-063', 'NA', [code(f'{LB}/widgetEmbedCore.js', 7, 'asOfDayOf')], {'N': NA, 'E': NA, 'O': NA}, 'A UCT correctness bug row.')
    R('G-064', 'NA', [code(f'{LB}/askInsert.js', 13, "export const ASK_INSERT_TYPE = 'askInsert'"),
                      flag('NOTEBOOK_ASK_INSERT_ON', 'armed')], {'N': NA, 'E': NA, 'O': NA},
      'UCT-unique (provenance-labelled objects). The insert needs an Ask answer, which needs a model key: not driven.')
    # Trading journal / thesis
    R('G-070', 'NA', [code(f'{NB}/LinkedNotesPanel.jsx', 13, 'export default function LinkedNotesPanel')], {'N': NA, 'E': NA, 'O': NA},
      'UCT-unique (notes linked to trades).')
    R('G-071', 'NA', [ruling(LEDGER, ledger_line('G-071'), 'replaced by G-070', 'ledger')], {'N': NA, 'E': NA, 'O': NA},
      'A rejected design, replaced by G-070.')
    R('G-072', 'NA', [code('api/services/journal_two/note_properties.py', 79, 'builtin:thesis_status')], {'N': NA, 'E': NA, 'O': NA},
      'UCT-unique built-in thesis fields; generic properties are compared under G-021.')
    R('G-073', 'NA', [code('api/services/journal_two/thesis_changelog.py', 251, 'def get_thesis_changelog(')], {'N': NA, 'E': NA, 'O': NA}, 'UCT-unique.')
    R('G-073b', 'NA', [code('api/services/journal_two/thesis_changelog.py', 215, 'def _verdict_events(')], {'N': NA, 'E': NA, 'O': NA}, 'UCT-unique.')
    R('G-074', 'NA', [code('api/services/awareness/rules.py', 127, 'def rule_thesis_stop_review(')], {'N': NA, 'E': NA, 'O': NA},
      'UCT-unique (plan §1: thesis-invalidation alerts).')
    R('G-075', 'NA', [code(f'{NB}/TickerResearchWorkspace.jsx', 66, 'export default function TickerResearchWorkspace'),
                      walk9('B17_older_rows'), walk9('B30_live_research_tab')], {'N': NA, 'E': NA, 'O': NA},
      'UCT-unique; B17 opened /journal/notebook/research/NVDA and B30 the same workspace on /research/NVDA.')
    # Collaboration / offline / mobile / extensibility
    R('G-080', ('P', 'P', 'P'), [code(f'{JT}/note_shares.py', 64, 'def enabled() -> bool:'), flag('J2_SHARE_LINKS_ENABLED', 'armed'),
                                 record('docs/notebook/share-links-authorization-proof.md', 1, 'the authorization proof'),
                                 walk9('B13_share_publish_export'), walk8('W2_share_links')],
      {'N': ['N_share'], 'E': ['E_publiclink'], 'O': ['O_publish']},
      'B13: a link minted in the share sheet; a signed-out stranger read the note through it.')
    R('G-081', 'D4', [D(4, 'OUT:** real-time multiplayer, comments, team workspaces (G-081)')],
      {'N': ['N_collab', 'N_comments'], 'E': EB, 'O': ['O_collab']}, 'Recorded scope, not an oversight.')
    R('G-082', 'P', [code(f'{LB}/offline/offlineFlag.js', 68, 'export const OFFLINE_DEFAULT_ON = true'),
                     record('docs/notebook/evidence/q1-gate/DECISION-2026-09-23-keep-offline.md', 1, 'KEEP offline editing ON'),
                     walk9('B16_offline_open_tab')],
      {'N': ['N_offline'], 'E': ['E_offline'], 'O': ['O_offline']},
      'PARITY is editing offline in an open tab (B16). A cold start offline is OUT by D6 and scored under G-163.')
    R('G-083', 'P', [code(f'{NB}/NoteEditorPage.jsx', 48, 'OFFLINE_VIEWING_BANNER'), walk9('B16_offline_open_tab')],
      {'N': ['N_offline'], 'E': ['E_offline_plan'], 'O': ['O_offline']},
      'B16: offline, a second note rendered from its saved copy with the banner "Viewing an earlier saved copy".')
    R('G-084', 'NV', [L('G-084', 'DUPLICATE of G-044 — tracked there')], {'N': NFN, 'E': ['E_share_ext'], 'O': ['O_ios']},
      'DUPLICATE of G-044 by controller ruling (the ledger counts it in its own DUPLICATE bucket); scored under '
      'G-044, mirrored here.', 'as G-044')
    R('G-085', ('P', 'NV', 'NV'), [code('api/routers/notebook_personal_api.py', 16, 'NOTEBOOK_PERSONAL_API_ENABLED'),
                                  flag('NOTEBOOK_PERSONAL_API_ENABLED', 'armed'), PAPI_READBACK, PAPI_REVOKED,
                                  walk7('W15_personal_api')],
      {'N': ['N_api'], 'E': ['E_mcp'], 'O': ['O_uri']},
      'Armed and documented (docs/notebook/personal-api.md); 10D walked it in production as bench@: mint, create, '
      'append, read back, revoke. PARITY is a documented API a member can call, as Notion names it. Evernote\'s cited '
      'door is an MCP server for AI clients and Obsidian\'s a local URI scheme: different mechanisms, so no verdict.')
    R('G-086', 'D4', [D(4, 'a plugin marketplace (G-086)')], {'N': NFN, 'E': EB, 'O': ['O_plugins']},
      'Recorded scope, not an oversight.')
    # Portability / export
    R('G-090', 'P', [code(f'{JT}/notes_export.py', 2207, 'def build_export_zip('),
                     test_vt('app/src/pages/journal-2-0/lib/importer/exportFormats.roundtrip.test.js'), walk9('B09_list_views_bulk')],
      {'N': ['N_export'], 'E': ['E_emailin'], 'O': ['O_local']},
      'B09: the bulk export panel offers Markdown, web page, JSON and Word.')
    R('G-091', 'P', [code(f'{JT}/notes_export.py', 2442, 'def build_single_note_export('), walk9('B13_share_publish_export')],
      {'N': ['N_export'], 'E': ['E_pdfexport'], 'O': ['O_local']}, 'B13: the note\'s Export menu has four items.')
    R('G-092', 'NA', [code(f'{JT}/notes_export.py', 1401, 'linked_trades')], {'N': NA, 'E': NA, 'O': NA}, 'UCT-unique.')
    R('G-093', 'NA', [L('G-093', 'DONE (as scoped)')], {'N': NA, 'E': NA, 'O': NA},
      'Read-only connectors by design; the two-way-sync clause of standard #11 is scored in §B, not here.')
    R('G-094', 'NA', [code(f'{JT}/note_connectors/engine.py', 51, 'sync-conflict')], {'N': NA, 'E': NA, 'O': NA},
      'An internal robustness row.')
    # UX/UI rows (2026-09-06)
    R('G-100', 'NA', [code('app/src/pages/journal-2-0/rawErrorSurface.test.js', 41, 'const IN_SCOPE = [ROOT]'),
                      test_vt('app/src/pages/journal-2-0/rawErrorSurface.test.js')], {'N': NA, 'E': NA, 'O': NA}, 'A UCT defect row.')
    R('G-101', 'NA', [code(f'{NB}/NoteEditorPage.jsx', 3777, "Couldn't load this note."), walk9('B17_older_rows')],
      {'N': NA, 'E': NA, 'O': NA}, 'A UCT defect row; B17 read the error state for a bogus id.')
    R('G-102', ('P', 'NV', 'P'), [code('app/src/components/CommandPalette.jsx', 7, 'useJ2Favorites'), walk9('B08_quick_switcher')],
      {'N': ['N_switch'], 'E': EB, 'O': ['O_switch']}, 'B08: the app-wide palette opened the oldest note by title.')
    R('G-103', 'NA', [code(f'{NB}/NoteEditorPage.jsx', 31, 'import ConfirmModal'), walk9('B20_more_older_rows')],
      {'N': NA, 'E': NA, 'O': NA}, 'A UCT defect row; B20 read the "Delete this note?" dialog.')
    R('G-104', 'NA', [code('app/src/pages/journal-2-0/a11y/notebookContrast.test.js', 76, 'G-104: zero remain'),
                      test_vt('app/src/pages/journal-2-0/a11y/notebookContrast.test.js')], {'N': NA, 'E': NA, 'O': NA},
      'A UCT convention row.')
    R('G-105', 'NA', [code(f'{NB}/AskPanel.jsx', 331, 'aria-label="Close Ask"'), walk9('B20_more_older_rows')],
      {'N': NA, 'E': NA, 'O': NA}, 'A UCT convention row; B20 found the close control is an svg icon.')
    R('G-106', 'NA', [code('app/src/pages/journal-2-0/tabs/NotebookTab.jsx', 37, 'SkeletonLine')], {'N': NA, 'E': NA, 'O': NA},
      'A UCT convention row.')
    R('G-128', 'NA', [test_vt('app/src/pages/journal-2-0/rawErrorSurface.test.js')], {'N': NA, 'E': NA, 'O': NA}, 'A UCT defect row.')
    # Continuation / organization (Wave H)
    R('G-110', ('P', 'NV', 'NV'), [code(f'{NB}/ResearchHome.jsx', 451, 'Continue working'), walk9('B17_older_rows')],
      {'N': ['N_favorites'], 'E': EB, 'O': NFO}, 'B17: the research home shows Continue working.')
    R('G-111', 'NA', [code(f'{JT}/ticker_research.py', 200, 'def get_ticker_research_summary(')], {'N': NA, 'E': NA, 'O': NA},
      'UCT-unique (plan §1: research assembled per security).')
    R('G-112', 'NA', [code('app/src/pages/research/ResearchPage.jsx', 28, 'import TickerResearchWorkspace'), walk9('B17_older_rows'),
                      walk9('B30_live_research_tab')],
      {'N': NA, 'E': NA, 'O': NA}, 'UCT-unique; reachable from the notebook (B17) and from the live research page\'s My Research tab (B30).')
    # Documents (Waves I, J)
    R('G-113', 'NV', [code(f'{JT}/db.py', 1202, 'j2_note_document_pages_fts'), walk9('B29_pdf_upload_preview_search'),
                      code(f'{LB}/bestMatches.js', 28, 'export const RRF_K = 60'), walk10('B4_best_matches')],
      {'N': NFN, 'E': ['E_searchimg'], 'O': NFO},
      'B29: a word inside the uploaded PDF was found by the sidebar search, in its own "1 DOCUMENT PAGE" section naming '
      'the file and p.1; since wave 10 a "Best matches" group fuses the top rows of every section above them (L1a B4). '
      'Evernote searches inside documents too, but whether its results are page-aware and sectioned is not evidenced '
      'by the fetched text, so no verdict.')
    R('G-114', 'NA', [code(f'{JT}/ticker_research.py', 140, 'def _documents_for_symbols(')], {'N': NA, 'E': NA, 'O': NA}, 'UCT-unique.')
    R('G-115', 'NA', [code(f'{JT}/db.py', 1102, 'j2_note_documents')], {'N': NA, 'E': NA, 'O': NA}, 'An internal model row.')
    R('G-116', 'NA', [code(f'{JT}/db.py', 1251, 'j2_note_excerpts')], {'N': NA, 'E': NA, 'O': NA},
      'UCT-unique (plan §1: citable, page-anchored passages). Not driven in 9B\'s browser check.')
    R('G-117', 'NA', [code(f'{JT}/db.py', 1240, 'quote_prefix')], {'N': NA, 'E': NA, 'O': NA}, 'UCT-unique.')
    R('G-118', 'NA', [code(f'{LB}/openCitation.js', 34, 'PASSAGE_GONE')], {'N': NA, 'E': NA, 'O': NA}, 'UCT-unique.')
    R('G-119', 'NA', [code(f'{JT}/db.py', 1314, 'j2_note_excerpts_fts'), walk10('B4_best_matches')], {'N': NA, 'E': NA, 'O': NA},
      'UCT-unique; the Evidence section is one of the four a "Best matches" group fuses above the sections (wave 10).')
    R('G-120', 'NA', [code(f'{JT}/thesis_evidence.py', 7, 'SUPPORTS/OPPOSES')], {'N': NA, 'E': NA, 'O': NA}, 'UCT-unique.')
    R('G-121', ('A', 'P', 'NV'), [code(f'{JT}/document_ocr_tesseract.py', 40, 'FLAG = "J2_OCR_ENABLED"'),
                                 flag('J2_OCR_ENABLED', 'armed'), walk7('W14_image_ocr_document'),
                                 walk12d('G-045.S2_ocr_read_the_page'), walk12d('G-045.S3_search_finds_image_word')],
      {'N': ['N_noocr'], 'E': ['E_searchimg'], 'O': NFO},
      'As G-045: 12D\'s sandbox walk read a scanned page by OCR and found its image-only word in search. Notion\'s '
      'import page states a scanned PDF is not reliably searchable until OCR is run' + R18 + ', so AHEAD.')
    # Ask (Wave K)
    R('G-122', ('P', 'P', 'NV'), [code(f'{JT}/ask_service.py', 54, '"This note"'), test_py('tests/test_ask_security.py'),
                                  walk9('B31_ask_scope_label')],
      {'N': ['N_scope'], 'E': ['E_aiscope', 'E_aimention'], 'O': NFO},
      'B31: the Ask panel states its scope as text ("Asking: This note") before any question; Notion documents an explicit '
      'source chooser. Evernote\'s AI Assistant page' + R18 + ' states both an assistant that picks its own context and '
      '@-mentions that name the notes to use; PARITY by controller ruling (12C phase 2): @-mention scoping is an '
      'explicit, member-visible scope.')
    R('G-123', 'NV', [code(f'{LB}/askCitation.js', 35, "VALID_EXACT = 'valid_exact'"),
                      test_vt('app/src/pages/journal-2-0/lib/askCitation.parity.test.js')],
      {'N': ['N_cite'], 'E': ['E_aicite'], 'O': NFO},
      'Both cite sources; that UCT\'s citation is a verified location and Notion\'s is page-level is not evidenced by the '
      'fetched text, so no AHEAD. Evernote\'s replies name the notes used' + R18 + ' (note-level), the same gap.',
      'O: a page that states it (next R-row); N and E: a page that states where inside a source a citation points')
    R('G-124', 'NV', [code(f'{JT}/ask_ranking.py', 212, 'def answer_evidence('), test_py('tests/test_ask_evidence.py')],
      {'N': NFN, 'E': ['E_aifallback'], 'O': NFO},
      'Refusal is railed. Evernote\'s page' + R18 + ' says that when the notes cannot answer, the assistant may suggest its '
      'built-in knowledge or a web search: whether that is a refusal is not stated, so no Evernote verdict.',
      'N: a page that states it (next R-row); O: a page that states it (next R-row); E: a ruling on whether a suggested '
      'fallback is a refusal')
    R('G-125', ('P', 'NV', 'NV'), [code(f'{JT}/ask_prompt.py', 167, 'def system_prompt() -> str:'),
                                  test_py('tests/test_ask_prompt_injection.py')],
      {'N': ['N_injection'], 'E': EB, 'O': NFO},
      'Railed on the UCT side; an absence cannot be cited, so no AHEAD. Notion states security controls that help protect '
      'against prompt injection' + R18 + ': PARITY is a stated protection as named, not a guarantee on either side.')
    R('G-126', 'NA', [code('api/services/note_ask.py', 13, 'tests/test_note_ask_prompt_boundary.py'), test_py('tests/test_ask_security.py')],
      {'N': NA, 'E': NA, 'O': NA}, 'A UCT defect row.')
    R('G-127', 'BE', [code(f'{JT}/note_semantic.py', 186, 'def provider_mode() -> str:'),
                      flag('NOTEBOOK_SEMANTIC_SEARCH_ENABLED', 'dark'),
                      record('docs/notebook/VENDOR-TERMS-2026-09-23.md', 93, 'Meaning search stays dark until OpenAI confirms zero retention in writing')],
      {'N': NFN, 'E': ['E_semantic'], 'O': NFO}, 'Built, dark until zero retention is confirmed in writing (D7).',
      'ZDR in writing (owner, external)')
    # ── Phase 1–5 inventory rows (G-129 …) ──
    R('G-129', ('P', 'NV', 'P'), [code(f'{LB}/codeBlockNode.js', 2, 'syntax highlighting'), walk9('B02_code_math_callout')],
      {'N': ['N_code'], 'E': EB, 'O': ['O_code']})
    R('G-130', ('P', 'P', 'P'), [code(f'{LB}/mathNodes.js', 2, 'math in a note'), walk9('B02_code_math_callout')],
      {'N': ['N_math'], 'E': ['E_math'], 'O': ['O_math']})
    R('G-131', ('P', 'P', 'NV'), [code(f'{NB}/TextColorMenu.jsx', 25, "TEXT_COLOR_MENU_LABEL = 'Text color and highlight'"),
                                  walk9('B05_typing_features')],
      {'N': ['N_color'], 'E': ['E_color'], 'O': ['O_highlight']},
      'Obsidian\'s fetched syntax page evidences highlights, not text colour, so no Obsidian verdict.')
    R('G-132', 'P', [code(f'{LB}/calloutNode.js', 37, "a callout's STYLE"), walk9('B02_code_math_callout')],
      {'N': ['N_callout'], 'E': ['E_editmode'], 'O': ['O_callout']})
    R('G-133', ('P', 'NV', 'NV'), [code(f'{LB}/imageFigureNode.js', 20, 'Alignment'), walk9('B26_image_caption_align')],
      {'N': ['N_align', 'N_caption'], 'E': ['E_caption'], 'O': NFO},
      'B26: an uploaded image centred (data-align center) and captioned (a figcaption with the typed text). Evernote\'s '
      'fetched page evidences captions but not alignment, so no Evernote verdict.')
    R('G-134', ('P', 'P', 'P'), [code(f'{NB}/TableToolbar.jsx', 103, "'addRowBefore', 'Row above'"),
                                 code(f'{LB}/tiptap.js', 129, 'resizable: true'),
                                 code(f'{NB}/TableToolbar.jsx', 301, 'Sort A→Z'), walk9('B03_table_toolbar'),
                                 walk10('B2_table_sort_resize_reload')],
      {'N': ['N_tables'], 'E': ['E_tables'], 'O': ['O_tables']},
      'B03 (wave 9): add/delete rows and columns and a header row. Wave 10 (10B) added resize and sort; L1a\'s B2 '
      'sorted a column (header pinned, one undo step), dragged a column wider and read both back after a reload. '
      'PARITY is against Notion\'s simple table (which its page says has no sorts), Obsidian\'s row/column editing and '
      'Evernote\'s 11.36.4 release note (sort, header row, column widths; rolling out gradually)' + R18 + '.')
    R('G-135', ('P', 'P', 'P'), [code(f'{LB}/blockHandle.js', 6, 'a drag handle'), walk9('B04_drag_outline_stats')],
      {'N': ['N_drag'], 'E': ['E_drag'], 'O': ['O_outlinedrag']},
      'Obsidian PARITY by controller ruling (12C phase 2): its Outline reorders a note\'s sections by dragging their '
      'headings (R18).')
    R('G-136', 'P', [code(f'{LB}/tableOfContentsNode.js', 94, "name: 'tableOfContents',"),
                     code(f'{NB}/NoteOutline.jsx', 43, "OUTLINE_LABEL = 'Outline'"), walk9('B04_drag_outline_stats')],
      {'N': ['N_toc'], 'E': ['E_toc'], 'O': ['O_outline']})
    R('G-137', ('P', 'P', 'P'), [code(f'{LB}/noteStats.js', 12, 'READING TIME'), walk9('B04_drag_outline_stats')],
      {'N': ['N_wordcount'], 'E': ['E_wordcount'], 'O': ['O_wordcount']},
      'Reading time is UCT\'s addition; not claimed as AHEAD (an absence cannot be cited).')
    R('G-138', ('NV', 'P', 'NV'), [code(f'{NB}/NoteFindBar.jsx', 8, 'Replace all'), walk9('B05_typing_features')],
      {'N': NFN, 'E': ['E_find'], 'O': NFO}, 'B05: Replace all turned every "alpha" into "gamma".')
    R('G-139', ('P', 'P', 'NV'), [code(f'{NB}/EmojiMenu.jsx', 2, 'the emoji picker'), walk9('B05_typing_features')],
      {'N': ['N_emoji'], 'E': ['E_emoji'], 'O': NFO})
    R('G-140', ('P', 'P', 'NV'), [code(f'{LB}/dateMentionNode.js', 5, '@date mentions'), walk9('B05_typing_features')],
      {'N': ['N_date'], 'E': ['E_date'], 'O': NFO})
    R('G-141', ('P', 'NV', 'P'), [code(f'{LB}/webLinkNodes.js', 76, "name: 'linkPreview',"),
                                 code(f'{LB}/webEmbeds.js', 12, 'The allowlist'), walk9('B06_link_paste')],
      {'N': ['N_embed', 'N_preview'], 'E': EB, 'O': ['O_embedweb']},
      'B06 is a dispatched paste event (an engine test of the paste path, not a real clipboard).')
    R('G-142', ('P', 'NV', 'NV'), [code(f'{LB}/columnsNode.js', 6, 'side-by-side columns'), walk9('B05_typing_features')],
      {'N': ['N_columns'], 'E': EB, 'O': NFO})
    R('G-143', ('A', 'A', 'P'), [code(f'{NB}/SlashMenu.jsx', 58, "title: 'Heading 6',"), walk9('B01_slash_menu')],
      {'N': ['N_headings'], 'E': ['E_headings'], 'O': ['O_headings']},
      'Notion\'s own page documents three heading levels; UCT offers six (B01). Obsidian offers six. Evernote\'s own '
      'list of its text styles stops at H4' + R18 + ', the limit stated on its page, so AHEAD as for Notion.')
    R('G-144', ('NV', 'P', 'NV'), [code(f'{NB}/NoteEditorPage.jsx', 248, 'export function canRunHistory(editor, cmd)'),
                      walk10('B1_touch_undo_redo'), walk10('B10_touch_undo_reachable_after_60_lines')],
      {'N': NFN, 'E': ['E_undo'], 'O': NFO},
      'Built in wave 10 (10B): L1a\'s B1 typed, tapped Undo and Redo at 390 px with touch emulation (not a device); '
      'B10 reached Undo after 60 lines. Evernote states an Undo button in its editing toolbar that is clicked or '
      'tapped' + R18 + '; no Notion or Obsidian page fetched states a touch undo.')
    R('G-145', ('P', 'NV', 'P'), [code(f'{LB}/noteSwitcher.js', 2, 'find ANY note'), walk9('B08_quick_switcher')],
      {'N': ['N_switch'], 'E': EB, 'O': ['O_switch']}, 'B08: the switcher opened the OLDEST note by title.')
    R('G-146', ('P', 'P', 'P'), [code(f'{NB}/BulkActionBar.jsx', 47, 'EXPORT OFFERS EVERY FORMAT'), walk9('B09_list_views_bulk')],
      {'N': ['N_bulkedit'], 'E': ['E_bulkmove'], 'O': ['O_multiselect']},
      'B09: two notes selected, the bulk export offered four formats. Each competitor\'s page' + R18 + ' states a '
      'multi-select with an action on it (Notion: edit properties; Evernote: move between notebooks; Obsidian: drag to a '
      'folder). PARITY is multi-select with an action, as named.')
    R('G-147', ('NV', 'P', 'P'), [code(f'{LB}/tagTree.js', 2, 'Nested tags'), walk9('B09_list_views_bulk')],
      {'N': NFN, 'E': ['E_nestedtags'], 'O': ['O_tags']}, 'B09: #inbox expanded to #to-read in the sidebar.')
    R('G-148', ('NV', 'NV', 'P'), [code(f'{NB}/UnlinkedMentions.jsx', 9, 'Unlinked mentions'), walk9('B10_unlinked_mentions')],
      {'N': NFN, 'E': EB, 'O': ['O_unlinked']})
    R('G-149', ('P', 'NV', 'NV'), [code(f'{NB}/NoteTimelineView.jsx', 2, 'the Timeline view'), walk9('B09_list_views_bulk')],
      {'N': ['N_timeline'], 'E': EB, 'O': NFO})
    R('G-150', ('P', 'NV', 'NV'), [code(f'{LB}/noteArchive.js', 2, 'archive and unarchive ONE note'), walk9('B11_organise')],
      {'N': ['N_archive'], 'E': EB, 'O': NFO}, 'B11: an archived note left the default list.')
    R('G-151', ('P', 'P', 'NV'), [code(f'{LB}/lockedNote.js', 6, 'A lock prevents ACCIDENTAL'), walk9('B11_organise')],
      {'N': ['N_lock'], 'E': ['E_lock'], 'O': NFO},
      'B11: a locked note\'s editor is not editable. Notion locks a page; Evernote\'s edit protection (mobile) opens a '
      'note read-only' + R18 + '. No Obsidian page fetched states a lock.')
    R('G-152', ('NV', 'NV', 'P'), [code(f'{LB}/splitView.js', 2, 'split view'), walk9('B12_split_view')],
      {'N': NFN, 'E': EB, 'O': ['O_tabs']}, 'B12: two editors mounted side by side.')
    R('G-153', 'NV', [code(f'{JT}/note_tasks.py', 439, 'def run_task_reminders('), test_py('tests/test_note_tasks.py'),
                      walk7('W11_reminders')],
      {'N': ['N_remind'], 'E': ['E_tasks'], 'O': NFO},
      'A reminder has never been observed arriving (wave-6 and wave-7 walks INCONCLUSIVE). ' + UI_NOT,
      'observe one reminder end to end')
    R('G-154', ('P', 'P', 'NV'), [code(f'{NB}/NoteTasksView.jsx', 9, 'Tasks across notes'), walk9('B09_list_views_bulk')],
      {'N': ['N_tasks'], 'E': ['E_taskview'], 'O': NFO})
    R('G-155', 'P', [code(f'{LB}/memberTemplates.js', 2, "the member's OWN templates"), walk9('B11_organise')],
      {'N': ['N_dbtemplate'], 'E': ['E_templates'], 'O': ['O_templates']}, 'B11: "Save as template" on the note.')
    R('G-156', ('NV', 'P', 'P'), [code(f'{LB}/dailyNote.js', 2, "the member's daily note"), walk9('B11_organise')],
      {'N': NFN, 'E': ['E_daily'], 'O': ['O_daily']}, 'B11: Today opened a note.')
    R('G-157', 'D10', [D(10, 'folders + links + backlinks')], {'N': ['N_subpage'], 'E': EB, 'O': NFO},
      'Recorded scope, not an oversight.')
    R('G-158', ('P', 'NV', 'NV'), [code(f'{NB}/RelationPropertyValue.jsx', 33, 'export default function RelationPropertyValue'),
                                  walk9('B27_relation_property')], {'N': ['N_relation'], 'E': EB, 'O': ['O_props']},
      'B27: a Relation property created and linked; the target note shows the source. Obsidian\'s properties page lists '
      'links among property values but does not describe a relation with a backlink, so no Obsidian verdict. Rollups '
      'and formulas are OUT (D12).')
    R('G-159', 'NV', [code(f'{NB}/NoteEditorPage.jsx', 4351, 'Scan a document with the camera'),
                      flag('NOTEBOOK_IMAGE_DOCX_DOCUMENTS_ENABLED', 'armed'), walk9('B07_touch_no_undo'),
                      walk7('W14_image_ocr_document')],
      {'N': NFN, 'E': ['E_scan'], 'O': NFO},
      'B07: the Scan control is there at 390 px; the OCR that makes a photo searchable is now armed (W14 walked image '
      'OCR on a sandbox). The scan-to-search chain has never run on a device, so no comparative verdict.',
      'a real-device scan, then search its words (G-164)')
    R('G-160', ('NV', 'P', 'NV'), [code(f'{JT}/document_extraction.py', 56, 'IMAGE_DOCX_GATE = "NOTEBOOK_IMAGE_DOCX_DOCUMENTS_ENABLED"'),
                                  flag('NOTEBOOK_IMAGE_DOCX_DOCUMENTS_ENABLED', 'armed'), walk7('W14_image_ocr_document'),
                                  walk10('B3_xlsx_cell_found')],
      {'N': ['N_importdocx'], 'E': ['E_searchimg'], 'O': NFO},
      'Armed since 2026-09-26; W14 made an image\'s words searchable and L1a\'s B3 found a word inside an .xlsx cell '
      '(both on sandboxes with the gate set). PARITY with Evernote\'s "look inside images and documents"; Notion\'s cited '
      'page is about importing a .docx as a page, a different act, so no Notion verdict.')
    R('G-161', ('NV', 'P', 'NV'), [code(f'{JT}/inbound_email.py', 12, 'NOTEBOOK_INBOUND_EMAIL_ENABLED'),
                                  flag('NOTEBOOK_INBOUND_EMAIL_ENABLED', 'armed'), walk7('W16_email_in'),
                                  record(FLAGS, 1202, 'Walked 2026-09-27 as bench@'), D(13, 'provider-agnostic inbound webhook')],
      {'N': NFN, 'E': ['E_emailin'], 'O': NFO},
      'Armed 2026-09-27 and walked by hand as bench@ (a Gmail message with a PDF became a note with its attachment); '
      'W16 walked the door on a sandbox in wave 7. PARITY with Evernote\'s email-in as named.')
    R('G-162', 'NV', [code(f'{LB}/dictationInsert.js', 2, 'dictated words go into the note at the caret'),
                      walk9('B01_slash_menu'), walk9('B07_touch_no_undo')],
      {'N': NFN, 'E': ['E_dictation'], 'O': NFO},
      'B01 offers Dictate and B07 found the mic; a transcription needs a model key, so none was observed. ' + UI_NOT,
      'a browser pass with a model key')
    R('G-163', 'D6', [D(6, 'Cold-start offline is out of scope')], {'N': ['N_offline'], 'E': ['E_offline'], 'O': ['O_offline']},
      'Recorded scope: the rollback story relies on no service worker (D6).')
    R('G-164', 'BO', [L('G-164', 'BLOCKED'), record('CLAUDE.md', 1085, 'Automate and App Automate are NOT on this account')],
      {'N': NA, 'E': NA, 'O': NA}, 'A release process, not a product feature; no competitor claim is made.',
      'owner: a device run per release (BrowserStack Live by hand, or Automate bought)')
    R('G-165', 'NV', [code(f'{JT}/writing_help.py', 48, 'ACTIONS = (SUMMARIZE, REWRITE, CONTINUE, TRANSLATE)'),
                      code(f'{JT}/property_autofill.py', 45, 'AUTOFILL_TYPES = ("text", "number", "select"'),
                      flag('NOTEBOOK_WRITING_HELP_ENABLED', 'armed'), walk9('B15_writing_help'),
                      walk10('B7_autofill_no_key', 'INCONCLUSIVE'),
                      test_vt('app/src/pages/journal-2-0/lib/writingHelp.test.js')],
      {'N': ['N_aiwrite', 'N_autofill'], 'E': ['E_aiedit'], 'O': NFO},
      'Wave 9 read BEHIND Notion because Autofill was absent; wave 10 (10B) built a narrow autofill (suggest values '
      'for the member\'s empty properties, each accepted by hand). No sandbox holds a model key, so no writing-help or '
      'autofill OUTPUT has been observed (B7 INCONCLUSIVE by construction): no comparative verdict either way.',
      'a browser pass with a model key')
    R('G-166', 'NV', [code(f'{JT}/ask_retrieval.py', 456, 'def _document_pages('), flag('NOTEBOOK_IMAGE_DOCX_DOCUMENTS_ENABLED', 'armed')],
      {'N': NFN, 'E': ['E_searchimg'], 'O': NFO},
      'Image, .docx and .xlsx documents are searchable now the gate is armed (G-160); an Ask answer drawn from one '
      'needs a model key and was never observed. ' + UI_NOT, 'a browser pass with a model key')
    R('G-167', ('P', 'NV', 'P'), [code(f'{JT}/note_publish.py', 76, 'flag_on("NOTEBOOK_PUBLISH_ENABLED", False)'),
                                 flag('NOTEBOOK_PUBLISH_ENABLED', 'armed'), walk9('B13_share_publish_export'), walk8('W3_publish')],
      {'N': ['N_publish'], 'E': EB, 'O': ['O_publish']},
      'B13: published from the share sheet; a signed-out stranger read the published page.')
    R('G-168', 'NV', [code('.github/workflows/notebook-a11y.yml', 1, 'promotion-gate: yes'), code('app/package.json', 80, '"axe-core": "4.13.0",'),
                      walk9('B19_axe_editor_and_list'), AXE_AFTER, kbd('S2-23', 'FAIL'),
                      test_vt('app/src/pages/journal-2-0/a11y/axeHarness.contract.test.js')],
      {'N': NFN, 'E': EB, 'O': NFO},
      'Real-browser axe: 123 of 123 runs PASS over 43 surfaces x 3 themes after F5; the a11y workflow gates promotion; '
      'the independent keyboard review ran (10E-2) and F4 fixed its MAJORs, with 7 walk steps still FAIL. The '
      'screen-reader passes are the owner\'s; no competitor accessibility page was fetched.',
      'owner screen-reader passes; the remaining keyboard FAIL rows (§B standard #9)')
    R('G-169', ('P', 'P', 'NV'), [code(f'{JT}/notes_export_formats.py', 1, 'a web page (HTML), lossless JSON and Word (.docx)'),
                                 test_py('tests/test_notes_export_formats.py'), walk9('B13_share_publish_export')],
      {'N': ['N_exportfmt'], 'E': ['E_emailin'], 'O': NFO},
      'PDF is the browser\'s Print (the row records it).')
    R('G-170', 'NA', [code('app/src/lib/errorBeacon.js', 856, 'export function installErrorBeacon()'),
                      code('app/src/main.jsx', 10, 'installErrorBeacon()'),
                      code(f'{LB}/notebookTelemetry.js', 59, 'export const CORE_ACTION_EVENTS = Object.freeze({'),
                      code(f'{JT}/notebook_slo.py', 128, 'SAVE_SUCCESS_OBJECTIVE = 0.995'),
                      test_vt('app/src/lib/errorBeacon.test.js')], {'N': NA, 'E': NA, 'O': NA},
      'An operability row; standard #15 scores it (wave 10, 10D: the core-action events and the SLOs).')
    R('G-171', ('P', 'NV', 'NV'), [code('app/src/pages/journal-2-0/components/notebook/onboarding/sampleNotebook.js', 1, 'The sample notebook'),
                                  flag('NOTEBOOK_ONBOARDING_ENABLED', 'armed'), walk9('B14_onboarding_help')],
      {'N': ['N_onboard'], 'E': EB, 'O': NFO},
      'B14: a fresh member got the "Welcome to your Notebook" tour and a sample-notebook offer; Notion documents '
      'onboarding that adds starter templates.')
    R('G-172', ('P', 'P', 'P'), [code('app/src/pages/Support.jsx', 422, "id: 'notebook-getting-started',"), walk9('B14_onboarding_help')],
      {'N': ['N_help'], 'E': ['E_help'], 'O': ['O_help']},
      'Every Notion and Obsidian page cited here is itself a help article; Evernote\'s help centre answered R18\'s fetch '
      '(2026-10-02) where it refused R15\'s.')

    # ── wave 10: fold the Evernote evidence (EVERNOTE_EVIDENCE) ──
    EVN = evernote_evidence()
    SUPERSEDED = []   # wave 12, lane 12C: paraphrases a fetched verbatim quote now stands in for
    for ev in EVN:
        row = ROWS.get(ev['g'])
        if row is None:
            PROBLEMS.append(f'Evernote evidence names {ev["g"]}, which is not a scored row')
            continue
        if ev.get('quote'):
            cited = row['comp']['E']
            if isinstance(cited, str) or not any(SOURCES[QUOTES[k][0]].get('public_url') == ev['url'] for k in cited):
                PROBLEMS.append(f'{ev["g"]}: the evidence carries a verbatim quote the row does not cite')
            continue
        if paraphrase_superseded(row['comp']['E']):
            # A verbatim quote from a FETCHED page (R18) supersedes the reader's paraphrase: the paraphrase is
            # kept in the committed evidence file, never shown beside a quote, and never evidence either way.
            SUPERSEDED.append(ev['g'])
            continue
        if row['comp']['E'] != EB:
            PROBLEMS.append(f'{ev["g"]}: a paraphrase would replace a cell that is not the unfetched-Evernote cell')
            continue
        row['comp']['E'] = {'para': ev}
    for bq in browser_read_problems():
        PROBLEMS.append(f'browser-read quote {bq[0]}: {bq[1]}')

    # ── checks over §A ──
    lids = [r.rid for r in LROWS]
    if list(ROWS) != lids:
        missing = [i for i in lids if i not in ROWS]
        extra = [i for i in ROWS if i not in lids]
        order = [i for i in lids if i in ROWS] != [i for i in ROWS if i in lids]
        PROBLEMS.append(f'row set/order: missing {missing} extra {extra} order-differs {order}')
    for rid, r in ROWS.items():
        for idx, vk in enumerate('NEO'):
            if r['v'][idx] in ('PARITY', 'AHEAD', 'BEHIND') and isinstance(r['comp'][vk], str):
                PROBLEMS.append(f'{rid}: {r["v"][idx]} vs {vk} with no citation')
            if r['v'][idx] in ('PARITY', 'AHEAD', 'BEHIND') and isinstance(r['comp'][vk], dict):
                PROBLEMS.append(f'{rid}: {r["v"][idx]} vs {vk} on a paraphrase (a paraphrase is never evidence for a verdict)')
    bad_q = verify_quotes(pages_dir)
    if bad_q:
        PROBLEMS.append(f'quotes: {bad_q}')


    # ═══ §B: the 16 standards ═════════════════════════════════════════════════════════════════════
    def std_rows():
        out = []
        for i, l in enumerate(lines_of(PLAN), 1):
            m = re.match(r'^\| (\d+) \| \*\*(.+?)\*\*(.*?) \| ([\d.]+)[^|]* \| (.+?) \| (.+?) \|$', l)
            if m and 1 <= int(m.group(1)) <= 16:
                out.append(dict(n=int(m.group(1)), name=m.group(2), sub=m.group(3).strip(), now=m.group(4),
                                means=m.group(5), gaps=m.group(6), line=i))
        return out


    STD = std_rows()
    if [s['n'] for s in STD] != list(range(1, 17)):
        PROBLEMS.append(f'plan standards parsed {[s["n"] for s in STD]}')
    USK = '`docs/notebook/user-study-kit.md`'
    SOAK = '`docs/notebook/soak-30day.md`'
    # n -> list of (clause, verdict, evidence, lever, group). Wave 10, F3: `group` sorts every clause not MET
    # into the three lists §C opens with -- 'owner' (only the owner can close it), 'quiet' (waits on the
    # controller's quiet slot for a timing verdict), 'build' (build or measurement work an agent or the
    # controller can do); None for a MET clause.
    OWNER, QUIET, BUILD = 'owner', 'quiet', 'build'
    NMO = 'NOT MEASURED — OWNER'
    NMQ = 'NOT MEASURED — QUIET SLOT'
    PR_CMD = 'python tools/notebook_proof_walk.py --boot (10E-1)'
    F4_CMD = 'the 10E-2 keyboard walk, re-run by F4 on its tip'
    C = {}
    C[1] = [
        ('every weekly feature exists for members', 'NOT MET',
         [walk10('B1_touch_undo_redo'), walk10('B2_table_sort_resize_reload'), walk10('B3_xlsx_cell_found'),
          flag('NOTEBOOK_PERSONAL_API_ENABLED', 'armed'), flag('NOTEBOOK_INBOUND_EMAIL_ENABLED', 'armed'),
          flag('NOTEBOOK_SEMANTIC_SEARCH_ENABLED', 'dark'), L('G-043', 'Chrome Web Store submission remains')],
         'wave 10 built G-144 / G-134 / G-165 / G-160 and armed the personal API, image/docx documents and email-in; '
         'still not reaching members: meaning search (G-017 / G-127, dark until zero retention is confirmed in '
         'writing) and the browser extension (G-043, the Chrome Web Store submission)', OWNER),
        ('or is a recorded, deliberate "no" with a reason', 'NOT MET',
         [L('G-144', 'Undo and Redo buttons on the touch tier'), L('G-134', 'column resize (a stored width'),
          L('G-165', 'the narrow autofill'), D(7, 'Semantic search is built'),
          D(4, 'the web clipper (publish the extension already built, G-043)'),
          L('G-043', 'only the Chrome Web Store submission remains'), D(6, 'Cold-start offline is out of scope'),
          D(10, 'folders + links + backlinks')],
         'read literally (controller ruling, F3 fix round 1): a feature that does not reach members must be a recorded '
         'NO. Wave 9\'s four unruled misses (G-144, G-134\'s resize/sort, G-165\'s autofill, G-160\'s xlsx) are built, '
         'and D6 (G-163), D10 (G-157) and D4\'s OUT list (G-081/G-086) are real no\'s. But D4 puts the web clipper IN '
         '(G-043: built, not shipped; the Chrome Web Store submission is the owner\'s) and D7 keeps meaning search IN '
         '(built, dark until zero retention is in writing): neither is a "no", and neither reaches members. Levers: ship '
         'the web clipper (store submission = owner); arm meaning search once zero retention is in writing (owner)', OWNER),
        ('the list is what Notion/Evernote/Obsidian users actually reach for weekly', NMO,
         [record('docs/notebook/user-study-kit.md', 1, 'the kit (Phase 7, standard #5)')],
         f'the inventory (§B1) is the plan\'s list, not a census of competitor users; the user study\'s screener '
         f'question ({USK}) is the owner\'s', OWNER),
    ]
    C[2] = [
        ('every shipped feature does what it says on every path', 'MET',
         [L11_CENSUS_VERDICTS, L11_CENSUS_G171, L11_CENSUS_G155,
          record(PR, '31-32', 'WORKS 110, N/A 30, NOT-DRIVEN 22, BROKEN 2, NO-DOOR 1')],
         'lane SC\'s re-run of 10E-1\'s path census on the L11 tree (52deeb767): WORKS 113, N/A 30, NOT-DRIVEN 22, '
         '**NO-DOOR 0, BROKEN 0** -- the two prior anomalies this clause was withheld on are gone. G-171 (first-run '
         'tour + sample notebook) now WORKS on desktop, touch AND keyboard (the probe-race fix `4f31a9075` FX2 '
         'diagnosed); G-160 (OCR/docx) and G-131 (text colour) also read WORKS on all three doors, re-verified '
         'directly against census.json. The 22 NOT-DRIVEN cells are unchanged in kind (no model key, camera, '
         'microphone or connector accounts in a sandbox) and are exclusions by the instrument\'s own design, not '
         'failures -- every DRIVEN cell does what it says', None),
        ('with a rail', 'MET',
         [record(PR, '54-57', 'RAILED 41, NOT-SHIPPED 11'), test_f3('tests/test_notebook_feature_rail_census.py')],
         'the feature->rail census over the §B1 inventory, re-run by F3 on this tree after the ledger moves: every '
         'shipped row has a test that imports its code (G-085 needed its implementing file named in the ledger to be '
         'located; it was)', None),
        ('no dead clicks', 'MET',
         [L12DC_FULL_RUN, L12DC_FULL_SURFACES, L12DC_FULL_DEAD, L12DC_TARGETED_RUN, L12DC_TARGETED_TEMPLATES,
          L12DC_TARGETED_FIRSTRUN, L12DC_INTEGRITY],
         'lane L12 closed the two gaps lane SC\'s reading left: a full sweep at 0100a3032 (39 surfaces: 37 '
         'MEASURED, 1 TIMEOUT -- nb-templates, the flat 360s ceiling after 59 of 60 enumerated controls, none DEAD; '
         '1 ERROR -- nb-first-run-clicks, the walk\'s own setup login timing out before any click; 0 real DEAD, the '
         'only 2 DEAD verdicts in the raw file are the planted dead controls proving the control VALID), then a '
         'targeted re-run of exactly those two surfaces at 6cbf0618e with `--surface-deadline 900`: nb-templates '
         'reads LIVE 59 + CURRENT-NO-OP 1, nb-first-run-clicks reads OCCLUDED 5 (the first-run tour dialog covers '
         'the page by design -- the same reading L11 got on the surfaces it could reach). Together the two runs '
         'cover all 39 surface x mode cells, every one MEASURED, 0 DEAD. The three DEAD rows L11 found are gone by '
         'independent fixes, not by this instrument: nb-table\'s `UPDATED` sort header got a server-side toggle '
         '(FX4) and the calendar/timeline `Today` buttons are marked `aria-current` (FX4), so both read '
         'CURRENT-NO-OP now. Sandbox CLEAN at all four checkpoints in both runs. The clause reads literally "no '
         'dead clicks"; the full 39/39 measured cell now reads exactly that', None),
        ('no known data-loss path', 'MET',
         [code('app/src/pages/journal-2-0/lib/offline/doorEnumeration.test.js', 752, 'NO door is a loss'),
          code(f'{JT}/notes.py', 858, 'MAX_BODY_DEPTH = 97'), test_f3('tests/test_notes_cas_is_atomic.py'),
          record(f'{W10C}/f5-results-run3-tag-applied.md', 30, 'unsettled 409s: **0** · conflicted copies: **0**')],
         '10C\'s write-door census classifies every derived door loss / fork / none and fails on any loss: none '
         'today; the T-12 409 is a benign compare-and-set that settles (0 unsettled, 0 conflicted copies, the '
         'sentence present after reload); the one loss found (a body too deep to serve back) is refused at every '
         'body door; every compare-and-set read takes BEGIN IMMEDIATE (the rail\'s control lost words without it). '
         'Forks (a conflicted copy) are not losses', None),
    ]
    C[3] = [
        ('zero data-loss incidents over a 30-day window with real members', NMO,
         [record('docs/notebook/soak-30day.md', 3, 'What it is not:** a result')],
         f'the soak ({SOAK}) is 9C\'s kit and the owner\'s run: 30 calendar days and an organic cohort', OWNER),
        ('every kill switch and rollback rehearsed', 'MET',
         [record('docs/notebook/rehearsal-2026-09-26.md', 12, '9 boots'),
          record('docs/notebook/rehearsal-2026-09-26.md', 15, 'PASS both ways, 2026-09-27'),
          RB_WAVE8, RB_WAVE7, RB_WAVE6, RB_WAVE5, RB_R1_RAIL, RB_R1B_WAVE7, RB_R1B_RAIL],
         'the seven per-request Notebook switches are rehearsed on a sandbox (9/9 PASS) and in production (OFF '
         '14:20:39Z, restored 14:32:53Z, 2026-09-27). The rollback is now rehearsed at every wave boundary on a '
         'sandbox -- R-11\'s own design (\'rollback Procedure A on a sandbox, never a production revert\'), not a '
         'production drill: lane R1 (2026-09-28) stepped back through L1c #228, #225, L1b #224, L1a #205, wave 9 '
         '#202/#201, wave 8 #198, 9C soak #197, wave 7 #196 and wave 6 #193, every boot CLEAN integrity (the wave-6 '
         'boundary\'s schema-guard rail read 1 failed on the first pass and 17/17 pytest + 15/15 vitest clean on the '
         'repeat, round 2\'s rail: 34 passed). Lane R1b (2026-09-29) re-confirmed tip/L2/L1a/wave7 CLEAN after L2 '
         'landed (21 passed), and its object-level census checked wave 5 by a targeted paywall-row test (TERM-089 '
         'rows kept, wave-5 rows gone, against a control at the tip where they are present). This supersedes the stale '
         'wave5-rollback.md:9 citation, "for WAVE 9 ONLY" -- confirmed stale by R1 review note M7', None),
        ('offline gate KEEP on evidence', 'MET',
         [record('docs/notebook/evidence/q1-gate/DECISION-2026-09-23-keep-offline.md', 7, 'What the gate said'),
          KEEP_VERDICT, KEEP_ROWS, KEEP_SKIP, KEEP_DNB],
         'the gate\'s last recorded verdict was REVERT (2026-09-20; KEEP itself is ruling D2, not a gate verdict), '
         'and the previous reading here found no Sunday verdict on the soak-only log in the repo. One now exists: '
         'KEEP at 2026-09-28 14:34 ET, computed from 22 of 23 heartbeat rows (1 skipped interval, recorded as '
         'UNOBSERVED, not read as clean), all four triggers PASS, the do-not-build sweep CLEAN across 20 items', None),
    ]
    C[4] = [
        ('budgets set', 'MET', [code('docs/notebook/perf-budgets.json', 2, '"_": "Notebook performance budgets')], '', None),
        ('enforced in CI', 'MET',
         [code('.github/workflows/notebook-bytes.yml', 1, 'promotion-gate: yes'),
          code('.github/workflows/notebook-latency.yml', 1, 'promotion-gate: yes'),
          record(PB, 585, 'Its first 20 runs: 20 green, no flap.')],
         'wave 10 ruling R-10: the byte budget gates promotion, and a latency check read as ratios to an in-run '
         'calibration op was promoted after it was seen red once and green once, then ran 20 of 20 green; the local '
         '50k gate stays the verdict on absolute p95s (the clause below)', None),
        ('note open p95 < 300 ms (1,000 paragraphs)', 'MET',
         [measure(PB, 399, '74.6 ms', 'python tools/notebook_perf_harness.py --boot --sizes 1000,2000 --opens 20 --chars 60')], '', None),
        ('typing < 16 ms/char up to the size cap', 'NOT MET',
         [measure(PB, '401-402', '17.6 ms', 'python tools/notebook_perf_harness.py --boot --sizes 1000,2000 --opens 20 --chars 60'),
          record(PB, 644, 'Clause 4d is not closed'), QUIET_SLOT, L('G-035', 'OPEN, DELIBERATELY'),
          code('app/src/pages/journal-2-0/components/notebook/NoteEditorPage.jsx', 407,
               'export function toolbarStateReducer(prev, editor)'),
          code('app/src/pages/journal-2-0/lib/stepInsertsNodeType.js', 39,
               'export function stepsIntroduceNodeType(tr, name)'),
          D(24, 'The 16 ms line is read on the main-thread BUSY time per keystroke (p95)'),
          measure(TY8A[0], 565, '"p95_ms": 10.6', TY8_CMD), measure(TY8A[1], 565, '"p95_ms": 10.93', TY8_CMD),
          measure(TY8A[2], 565, '"p95_ms": 10.15', TY8_CMD),
          record(TY8R, 153, 'Lock FREE and load QUIET at both ends of every run'),
          record(TY8R, 180, '17.12 ms on the same harness): not established'),
          record(PB, 995, '4d, typing: still NOT MET, because two quiet readings of the same code disagree'),
          measure('docs/notebook/perf-runs/ty8/ab/A4.json', 565, '"p95_ms": 15.67', TY8_A4_CMD),
          record(TY8R, 209, '7.7 / 14.42 / 15.67 ms'),
          record(TY8R, 217, 'A4 does not cleanly break')],
         'wave 12, 12C phase 2 (2026-10-02): the tie-break run A4 (#265, build A, lock FREE and load QUIET at both ends) '
         'read 15.67 ms at 2,000 paragraphs -- under the line by 0.33 ms -- but every A4 row is 1.5-2x slower than A3 on '
         'the same build while the lock tool marked the box QUIET, so it sits within run-to-run drift of the line and does '
         'not break the tie with L15 q1 (17.12 ms). NOT MET stands; the 16 ms line is unchanged. '
         'Quiet re-score QR (2026-10-02): the owed quiet-box busy reading now exists and does not settle the clause. '
         'Six interleaved runs of TY8\'s A/B (perf-runs/ty8/ab, 05:08-05:32 CT), each lock FREE and load QUIET at '
         'both ends; A is the editor code this tree ships (`git diff fefbc2bf6 HEAD -- app/src/pages/journal-2-0` is '
         'empty) and B adds TY8\'s `memoStringifyBody.js` change, which is not on this tree. All 18 busy p95 cells are '
         'under 16 ms: at 2,000 paragraphs A reads 10.60 / 10.93 / 10.15 ms and B 9.89 / 12.18 / 11.66 ms. But L15\'s q1 '
         'run (2026-10-01 19:28, perf-runs/ty-l15-quiet, on the #263 branch, not this tree) was also QUIET at both '
         'ends by the same lock tool, on the same editor code, and read 19.56 ms at 1,000 paragraphs and 17.12 ms at '
         '2,000. Two quiet readings of one build disagree and nothing measured explains it (unmarked background load is '
         'a hypothesis, not a measurement), and D24 says which row binds, not how to resolve two clean readings that '
         'disagree. So the verdict stays NOT MET until another quiet hour agrees with one side; the 16 ms line is '
         'unchanged. Before this re-score the cell read: '
         'below the cap: waiting on the controller\'s quiet slot (10A\'s typing A/B; its loaded p95 sits at the line, '
         'and F1 is in flight, unmeasured); at the cap: G-035 stays open by owner ruling. Lane TY (e1999ca5f, '
         '15ab6b886, on this tree) built two more levers since the 17.6 ms reading above: a `useReducer` bailout '
         'so a keystroke that touches no toolbar-visible state (bold/italic/heading/list/undo/redo/...) no longer '
         're-renders NoteEditorPage\'s whole ~4,000-line subtree just to keep the formatting toolbar in sync, and '
         'two ProseMirror plugins (the code-block highlighter, the Ask-citation staleness decorator) that used to '
         'walk the WHOLE document on every keystroke now short-circuit via `stepsIntroduceNodeType` once a note '
         'has never held the node type each one cares about. Built and test-green (928 passed per the lane\'s own '
         'run), NOT measured: no quiet-box A/B has read what either lever does to the 16 ms/char number. This does '
         'not move the verdict -- the owed quiet-slot reading stays owed', QUIET),
        ('search p95 < 100 ms at 50k notes', 'MET',
         [measure(PB, '299-303', 'ops still above 100 ms p95 at 50k',
                  'python tools/notebook_scale_benchmark.py --tiers 50000 --thresholds docs/notebook/perf-budgets.json --budget search'),
          record(PB, 658, 'every notes op under its line'),
          measure(f'{PROOF}/f6-switcher-body/perf/fr1-50k.log', 40, 'VERDICT: PASS',
                  'python tools/notebook_scale_benchmark.py --tiers 50000 (F6, fix round 1)'), *QS_EV],
         'wave 9\'s breach was measured before 10A\'s levers; W3 and F6\'s runs both read PASS but did not hold a '
         'quiet box for their whole run. Lane RS\'s quiet-slot command 1 does: ' + PC_CAVEAT, None),
        ('Notebook JS within a byte budget', 'MET',
         [measure(f'{EVD}/notebook_perf_budgets-bytes.log', 1, 'bytes.notebook_first_open',
                  'python tools/notebook_perf_budgets.py --dist app/dist (run by 9B)'),
          code('.github/workflows/notebook-bytes.yml', 1, 'promotion-gate: yes')],
         'and gated in CI since wave 10', None),
    ]
    C[5] = [
        ('a task-based test with 5-8 traders', NMO, [record('docs/notebook/user-study-kit.md', 1, 'the kit (Phase 7, standard #5)')], USK, OWNER),
        ('every core task completed unaided', NMO, [record('docs/notebook/user-study-kit.md', 1, 'the kit (Phase 7, standard #5)')], USK, OWNER),
        ('SUS >= 80', NMO, [record('docs/notebook/user-study-kit.md', 1, 'the kit (Phase 7, standard #5)')], USK, OWNER),
        ('no silent failures', 'MET',
         [L11_SILENT_READS, L11_SILENT_WRITES, L11_SILENT_TRASH,
          code('app/src/pages/journal-2-0/a11y/loadFailedConsumers.test.js', 66,
               "describe('every endpoint the walk found SILENT is said by its consumer, through the one element'"),
          code('app/src/pages/journal-2-0/a11y/silentFailures.test.jsx', 43, "describe('a failed WRITE is said, and stays said'"),
          code('tools/notebook_proof_walk.py', 210, 'SILENT_EXEMPT = {')],
         'the MEASURED reading this clause was owed now exists (lane WK5/L11, 52deeb767, control VALID -- the '
         'planted swallow/honest consumers both read as they must, forced-500 and forced-offline): 72 of 72 reads '
         'SENTENCE, 28 writes (24 SENTENCE + 4 EXEMPT), **0 SILENT**. trash-note (`DELETE /api/j2/notes/{id}`), '
         'SILENT in WK4, now reads SENTENCE under both failure kinds (FX3 `3b3ea1b8a`); save-template reads SENTENCE '
         'on both its endpoints. Every endpoint the sweep can drive says so on failure, matching what the code-level '
         'rail already railed per endpoint (F7)', None),
    ]
    C[6] = [
        ('a design review against the three competitors signs off each surface', 'MET',
         [D(21, 'may countersign design-review-2\'s surfaces it accepts'),
          DR2_D7_CLOSED, DR2_D8_CLOSED, DR2_D9_CLOSED, DR2_COUNTERSIGN, DR2_SIGNED, DR2_RESIDUAL],
         'the first review (10E-2, `docs/notebook/design-review.md`) did not sign off (D-1..D-6 named). The RE-review '
         '(lane DR-R, `docs/notebook/design-review-2.md`) re-derived D-1..D-6 fresh rather than assuming them closed '
         'and found all six CLOSED, but named three NEW gaps (D-7 phone view-switch layout, D-8 target floors on six '
         'surfaces, D-9 timeline default position) and withheld sign-off pending them. DR-F closed all three with '
         'before/after evidence and mutation-proved rails (`targets_lt_24` 6/7/3/12/6/8 -> 0 at 1200 across list/'
         'table/board/templates/search/timeline; the board\'s WATCHING column on-screen at 390; the timeline axis '
         'scrolled to today), and independently confirmed the two rows DR-R could not (a real graph edge, a '
         'populated tasks list) were instrument gaps, not product defects. Every item design-review-2.md\'s own '
         'closure bar names (D-1..D-9) is now closed with evidence. Ruling D21 lets the controller countersign what '
         'it accepts under the owner\'s 2026-09-29 delegation, recorded as "controller, owner-delegated 2026-09-29" '
         '(never the owner\'s own signature) -- lane SC countersigned all seven surfaces on that basis. One separate, '
         'real, unfixed defect surfaced doing this (the `[[` link-suggestion popup racing the editor\'s own '
         'autosave) is NOT covered: it is not one of this review\'s own named findings and belongs to standard #2 '
         '(Functionality), not this clause -- named rather than hidden', None),
        ('consistent tokens', 'MET', [test_vt('app/src/pages/journal-2-0/a11y/notebookContrast.test.js'),
                                     code('app/src/pages/journal-2-0/a11y/notebookContrast.test.js', 76, 'G-104: zero remain')], '', None),
        ('no layout regressions at 390/820/1200', 'MET',
         [L11_GEOM_RUN, L11_GEOM_BREAKDOWN, L11_GEOM_TABLE, record(PR, '80-81', 'control VALID'),
          record(PR, '109-110', 'Leads that need a screenshot before they count'),
          L3_TIP, L3_LEADS, L3_FINDING, D3P_TIP, D3P_LEADS, D5_CUE, D5_OVERFLOW,
          D(23, 'It is reported in its own status, SAME-COMPONENT, never dropped and never counted as '
                'CONFIRMED'),
          L3RC_VALID, L3RC_ERRORS, L3RC_CLEARED, L3RC_SAME, L3RC_POPUP, L3RC_RULING_TAG, L3RC_CONFIRMED],
         'history, kept honest: 10E-1\'s sweep found overlays and a page wider than a phone; F5 closed every '
         'CONFIRMED finding and F4 moved the skip link off the tab strip. Two later, driven sweeps then reported '
         'real CONFIRMED occlusions at 390: L3 (tip a2016db20) found **8 CONFIRMED**, D3P (after-r2, tip '
         'c226c163c) found **32 CONFIRMED**, both entirely the same thing -- the editor\'s own "Joystick, '
         'Notebook" hub knob occluded by the hub across scroll states -- and this clause stood NOT MET on those '
         'counts through lane SC\'s own re-score. **Ruling D23** (controller, owner-delegated 2026-09-30) is why '
         'they now read SAME-COMPONENT rather than CONFIRMED: an occlusion whose occluder is the control\'s own '
         'component\'s designed hit surface (the instrument\'s `sameHub` flag -- the hub knob is deliberately '
         '`pointer-events: none`, so its own pad is the real, documented hit surface) is not a layout regression '
         'for this clause; it is reported in its own status, never dropped and never counted as CONFIRMED, and a '
         'DIFFERENT element at the same geometry still counts CONFIRMED. Applied to the L3/D3P instrument\'s own '
         'raw rows (unchanged; each reclassified row stamped `ruling: "D23"`), both runs\' CONFIRMED counts move '
         'to SAME-COMPONENT and 0 remain CONFIRMED on either. Lane L12\'s un-scoped re-confirm (fe01bdb14, every '
         'surface, 390/820/1200, orb+hub passes, hint-seen and coach-pending both states) independently '
         'corroborates this at full coverage rather than re-reading those same rows: `controls_valid: true`, '
         '`errors: []`, named leads CLEARED 398 + SAME-COMPONENT 88 (the same hub-knob-under-its-pad class D23 '
         'names) + under-open-popup 36 (a menu open over the page by intent), **0 CONFIRMED**. D5\'s board '
         'scroll-fade cue remains a genuine improvement (CSS mask-image cue present, column overflow correctly '
         'detected at 1200/820/390 with 0 page errors). Lane WK5/L11\'s own raw geometry sweep (52deeb767, '
         'control VALID, 129/129 cells, 2437 findings) is an INVENTORY of raw occluded/tap/overflow counts, not a '
         'CONFIRMED-vs-leaded classification, and does not by itself move this clause. A confirmed, reproduced '
         'occlusion at 390 that is not the control\'s own component is what the clause asks about; none remains', None),
    ]
    C[7] = [
        ('restore rehearsed end-to-end on a schedule', 'NOT MET',
         [code('tools/authdb_restore_drill.py', 591, 'SCHEDULE_TASK = "UCT-AuthDB-Restore-Drill"'), D(15, 'restore-drill tool'),
          RESTORE_INTEGRITY, RESTORE_TOMBSTONES, RESTORE_ATTACH],
         'the drill now checks attachments and replays tombstones, and its weekly task is staged. The hand re-run '
         'this cell used to owe now reads a full PASS: integrity_check ok, 0 tombstones outstanding after replay, '
         '25 of 337 attachments sampled with every sha256 matching. That closes the earlier INCONCLUSIVE-by-design '
         'first run (the tarball predated the manifest) and proves the mechanism works end-to-end -- but a PASS run '
         'by hand is not a PASS triggered BY the schedule, and the clause reads literally "on a schedule". The '
         'staged weekly task has not yet produced an unattended PASS. Owed: observe its next scheduled fire', BUILD),
        ('account deletion purges backups', 'MET',
         [record('docs/account-deletion-manifest.md', 197, 'The deletion writes a TOMBSTONE, as its FIRST write'),
          record('docs/account-deletion-manifest.md', 233, 'CLOSED, wave 10 lane AD'),
          code('tools/authdb_restore_drill.py', 620, 'ap.add_argument("--archive"'),
          record('docs/notebook/gate-runs/wave10-L6/classification.md', 13, 'Landing: PASS'),
          test_f3('tests/test_account_tombstones.py'), test_l6('tests/test_authdb_archive_restore.py')],
         'wave 10 lane AD (PR #253, landed L6) closed the one exception this cell used to carry: '
         'authdb/archive/ objects are kept forever by design (never pruned), and `authdb_restore_drill.py '
         '--archive` now drills that lineage through the SAME tombstone-replay code a regular restore uses '
         '(`tombstone_check()` -> `account_tombstones.replay_on_db`/`.replay_on_attachment_tree`), lifting only '
         'the freshness-age check -- never the replay. `tests/test_authdb_archive_restore.py` drills a seeded '
         'archive snapshot end-to-end (member deleted after the snapshot, `--archive --write-restored` refuses '
         'to bring them back) and is mutation-proved fail-closed two ways (replay call skipped, tombstone read '
         'erroring); both it and the regular-restore rail pass on the L6 landing tree (126 passed). A deletion '
         'now purges (or is replayed out of) every backup lineage this repo has, regular and archive alike', None),
        ('round-trip export verified every release', 'MET',
         [test_vt('app/src/pages/journal-2-0/lib/importer/exportFormats.roundtrip.test.js')],
         'the round-trip rail is a vitest file, so every six-shard landing gate runs it', None),
    ]
    C[8] = [
        ('vendor data terms verified in writing (zero retention)', 'NOT MET',
         [record('docs/notebook/VENDOR-TERMS-2026-09-23.md', 34, 'Published terms relied on, not a signed agreement')],
         'owner/external: zero retention in writing', OWNER),
        ('share-link authorization proven', 'MET',
         [record('docs/notebook/share-links-authorization-proof.md', 1, 'the authorization proof'), walk9('B13_share_publish_export'),
          test_py('tests/test_public_note_payload.py')], '', None),
        ('plaintext index risk reviewed', 'MET', [L('G-004', 'owner-accepted 2026-09-22')],
         'the owner accepted infrastructure encryption as the answer (G-004)', None),
        ('a security review of Notebook routes', 'MET',
         [record('docs/notebook/security-review-notebook-routes.md', 5, 'Every Notebook route mounted on the real app is classified'),
          record('docs/notebook/security-review-notebook-routes.md', 39, '0 leaks'),
          record('docs/notebook/security-review-notebook-routes.md', 50, 'No major finding.'),
          test_f3('tests/test_notebook_route_security_census.py')],
         'an independent session (10E-2) classified all 150 method+path pairs off the real app and probed across two '
         'members: 94 foreign reads, 0 leaks; 149 anonymous calls, none 2xx; seven minor findings filed, none major', None),
    ]
    C[9] = [
        ('axe in CI', 'MET',
         [code('.github/workflows/notebook-a11y.yml', 1, 'promotion-gate: yes'),
          code('.github/workflows/notebook-a11y.yml', 4, 'actions/runs/36294366772'),
          code('.github/workflows/notebook-a11y.yml', 8, 'actions/runs/36294512061')],
         'seen red once and green once (ruling D-A2), then promoted: a red refuses production promotion', None),
        ('zero violations on Notebook surfaces', 'MET',
         [L11_AXE_RUN, L11_AXE_COUNT, L11_AXE_CONTROL, AXE_AFTER, AX_9A_REFUSED, AX_9A_GALLERY],
         'lane SC re-ran 10E-1\'s own instrument (the thing AX was refused permission to run) at 52deeb767 -- L11, the '
         'tree this re-score is cut from plus two docs commits, so no product file changed after the reading. 123 of '
         '123 runs MEASURED, 0 violations, across all three themes; the control found the planted low-contrast text '
         'and nameless button in every theme (axe.json). This supersedes both the stale aa2417c2c reading (43 '
         'non-test files had changed since) and AX\'s narrower template-gallery-only substitute -- the full-surface '
         'reading this clause asks for now exists on the landed tree', None),
        ('a full screen-reader pass (VoiceOver + NVDA)', NMO,
         [record('docs/notebook/screen-reader-pass.md', 4, 'nothing here has been run on a real screen reader yet')],
         'owner; scripts in a11y-second-review-brief.md', OWNER),
        ('keyboard-complete (incl. graph)', 'MET',
         [kbd('S2-23', 'FAIL'), kbd('S2-26', 'FAIL'), kbd('S2-27', 'FAIL'), kbd('S2-13', 'FAIL'), kbd('S1-31', 'PASS'),
          kbd('S2-28', 'PASS'), AX_9D_SUMMARY, AX_9D_S218],
         'F4\'s re-walk (cited above, at 0555889ef) still FAILed S2-23/26/27, S2-13/14 and S6-02 x2. Lane AX re-ran '
         'the walk at 2fb102c74 with two instruments (10E-2\'s unmodified copy, and K2\'s route through "More note '
         'actions"): every one of those FAILs now PASSes -- the Outline/Export/Open-beside disclosures take focus '
         'and trap Tab correctly, the [[ link and @date keyboard inserts both PASS with their controls, and the '
         '820px targets read 0 under 24px. The graph rows (S3-01/02/04/05) PASS in both instruments; S3-03 stays '
         'OBSERVED (no pass/fail line). Residual: S2-18 (move a block by Alt+Shift+Arrow) FAILs on the K2 route, and '
         'a probe (routes A-E) explains it as a timing artefact, not a Notebook defect -- pressing Ctrl+Home then '
         'Alt+Shift+ArrowDown back-to-back (route D, as the walk does) moves the wrong block because '
         'prosemirror-view learns of the native caret move only via an async selectionchange; the same two keys with '
         'a 50ms gap (route E) moves the right one. A person cannot press two keys within one browser task; a script '
         'can. It is library behaviour, not Notebook code, and it does not recur in the unmodified walk on the same '
         'tree', None),
    ]
    C[10] = [
        ('iOS + Android capture parity', NMO,
         [flag('NOTEBOOK_PERSONAL_API_ENABLED', 'armed'), PAPI_READBACK, L('G-044', 'has not been run on an iPhone')],
         'Android\'s share target is live; the iOS path (Shortcuts over the personal API) is armed and the API walked '
         'in production, but no Shortcut has run on an iPhone: the owner\'s device pass (G-044)', OWNER),
        ('cold-start offline', 'NOT MET', [D(6, 'Cold-start offline is out of scope'), D(19, 'OUT, a permanent recorded no')],
         'recorded out by D6 (G-163) and confirmed by D19, a permanent recorded no (controller, owner-delegated '
         '2026-09-29): a caching service worker could serve a stale bundle straight through a rollback, and open-tab '
         'offline durability is already live and is the durability that matters. The scorecard reads this clause as '
         'a recorded no and never scores it MET', OWNER),
        ('real-device matrix green every release', NMO, [L('G-164', 'BLOCKED')], 'G-164: the owner on BrowserStack Live per landing', OWNER),
    ]
    C[11] = [
        ('import from every major tool', 'MET',
         [code('app/src/pages/journal-2-0/lib/importer/census.js', 6, "R-18's list, verbatim and in its order"),
          code('app/src/pages/journal-2-0/lib/importer/registry.js', 24, 'export const ADAPTERS = ['),
          walk10('B5_import_google_keep'), walk10('B5_import_logseq'), walk10('B5_import_onenote_docx')],
         'the ten-tool list of wave 10 ruling R-18 (Notion, Evernote, Obsidian, OneNote, Apple Notes, Google Keep, '
         'Bear, Roam, Logseq, Joplin): each maps to a registered adapter with a fixture railed through the whole '
         'import path; three driven in a browser. The fixtures are built from each vendor\'s documented format, not '
         'captured from real accounts', None),
        ('export markdown/HTML/JSON/PDF/docx', 'MET', [walk9('B13_share_publish_export'), test_py('tests/test_notes_export_formats.py')],
         'PDF is the browser\'s Print', None),
        ('two-way sync where offered', 'NOT MET', [L('G-093', 'DONE (as scoped)'), D(18, 'OUT, a permanent recorded no')],
         'connectors are read-only by design (wave 10 ruling R-6) and D18 makes it a permanent recorded no '
         '(controller, owner-delegated 2026-09-29): writing back into a member\'s Notion, Dropbox or OneDrive could '
         'overwrite their data in a system we cannot roll back. The scorecard keeps the clause\'s own text and reads '
         'it as a recorded no, never MET', OWNER),
        ('a documented API', 'MET',
         [flag('NOTEBOOK_PERSONAL_API_ENABLED', 'armed'), record('docs/notebook/personal-api.md', 1, 'The Notebook personal API'),
          PAPI_READBACK, PAPI_REVOKED],
         'documented and armed; walked in production as bench@ (G-085)', None),
    ]
    C[12] = [
        ('grounded, cited, refusing when unsupported', 'MET',
         [test_py('tests/test_ask_evidence.py'), test_py('tests/test_ask_prompt_injection.py'),
          test_vt('app/src/pages/journal-2-0/lib/askCitation.parity.test.js')], '', None),
        ('writing help with provenance', 'MET',
         [record(f'{PROOF}/wh-2026-09-29b/README.md', 8, 'a member'),
          record(f'{PROOF}/wh-2026-09-29b/README.md', 14, 'Rewrite shorter" returned 148 characters'),
          record(f'{PROOF}/wh-2026-09-29b/README.md', 16, 'Written with Compass writing help: Rewrite'),
          record(f'{PROOF}/wh-2026-09-29b/README.md', 19, 'output, provenance and insert-on-accept were all observed on production'),
          test_vt('app/src/pages/journal-2-0/lib/writingHelp.test.js'), test_f3('tests/test_property_autofill.py')],
         'the owed pass landed: run b, as `bench@uctintelligence.internal` (a member, not admin), on production '
         'after the vendor credit was restored -- "Rewrite shorter" returned real output, the inserted block '
         'carried both the visible provenance label and an aria-label naming the model and action, and Accept '
         'inserted it into the note (`document_changed_by_accept: true`). The probe process itself exited 1 on a '
         'cleanup read-back race (one read 1.5s after delete, fixed in the same lane by polling the note by id); '
         'an independent read-back found the test note gone (404 direct, absent live, present in trash) -- the '
         'product path, not the probe bug, is what this clause reads on. The earlier run (wh-2026-09-29/) found '
         'the vendor credit exhausted and observed no output; this run is what closed it', None),
        ('semantic retrieval', 'NOT MET', [flag('NOTEBOOK_SEMANTIC_SEARCH_ENABLED', 'dark')], 'dark until zero retention in writing (G-127)', OWNER),
        ('all on verified vendor terms', 'NOT MET',
         [record('docs/notebook/VENDOR-TERMS-2026-09-23.md', 34, 'Published terms relied on, not a signed agreement')], 'owner/external', OWNER),
    ]
    C[13] = [
        ('keyword + meaning search', 'NOT MET', [flag('NOTEBOOK_SEMANTIC_SEARCH_ENABLED', 'dark')], 'meaning search dark (G-127)', OWNER),
        ('one ranked result list', 'MET',
         [code(f'{LB}/bestMatches.js', 28, 'export const RRF_K = 60'), walk10('B4_best_matches')],
         'wave 10 ruling R-5: a "Best matches" group fuses the top results of every section (notes, document pages, '
         'saved excerpts, thesis reviews) into one kind-labelled ranked list above them; the sections stay below', None),
        ('measured recall on a labelled set', 'MET',
         [measure('docs/notebook/search-recall-set.json', '1431-1433', '"recall_at_10": 0.8837',
                  'python -m pytest tests/test_notebook_search_recall.py'),
          measure('docs/notebook/search-recall-set.json', '1435-1437', '"recall_at_10": 0.9302',
                  'python -m pytest tests/test_notebook_search_recall.py'),
          test_f3('tests/test_notebook_search_recall.py')],
         'a labelled set (100 notes, 43 queries): the search box 0.8837 recall@10; the switcher 0.4147 before F6 and '
         '0.9302 after (its body half); the rail holds both at their baseline and plants a ranker regression that '
         'must fall below it', None),
        ('p95 < 100 ms at 50k', 'MET',
         [measure(PB, '299-303', 'ops still above 100 ms p95 at 50k', 'python tools/notebook_scale_benchmark.py --tiers 50000 --budget search'),
          *QS_EV],
         'the same reading as standard #4\'s search clause. ' + PC_CAVEAT, None),
    ]
    C[14] = [
        ('50k notes: all budgets from #4 hold', 'MET',
         [measure(PB, '299-303', 'ops still above 100 ms p95 at 50k', 'python tools/notebook_scale_benchmark.py --tiers 50000'),
          *QS_EV],
         'lane RS\'s quiet-slot command 1 (2026-09-29 07:04 CT, tree 2fb102c74) read PASS on every budgeted op at '
         '50,000 notes, with 0 foreign test processes sampled every 20 s throughout. ' + PC_CAVEAT, None),
        ('10k attachments', 'MET',
         [code('docs/notebook/perf-budgets.json', 113, '"attachments": 10000'), *QS_EV],
         'the same quiet-slot run seeded 10,000 attachments (30,000 pages) alongside the 50,000 notes and read every '
         'attachment op under its p95 line in the same PASS. ' + PC_CAVEAT, None),
        ('size-cap notes', 'NOT MET', [L('G-035', 'OPEN, DELIBERATELY'), D(20, 'No hard cap')],
         'G-035, owner ruling, confirmed by D20 (controller, owner-delegated 2026-09-29): no hard cap; the typing '
         'budget binds up to 2,000 paragraphs and beyond it the slowdown is a documented limit, not a defect -- '
         'virtualizing the editor for the top few percent of note sizes is a large change against a budget that is '
         'already measured and enforced below the cap', OWNER),
        ('no super-linear curve', 'MET',
         [measure(QR_CURVE, 211, 'VERDICT: PASS -- curve: every op\'s slope <= 1.1 (connection=per-call)', QR_CURVE_CMD),
          measure(QR_CURVE, 12, 'connection model: per-call (default, D22 clause 14d', QR_CURVE_CMD),
          record(QR_BOX, 3, 'load: QUIET'), record(QR_BOX, 6, 'load: QUIET'),
          record(QR_README, 46, 'Clause 14d (the curve) is met on a quiet box under the gating model'),
          record(PB, 988, '14d, the curve: the owed quiet re-read exists'),
          record(PB, 675, "W7's curve BREACHED 9 ops"),
          measure(f'{PROOF}/f6-switcher-body/perf/fr1-curve.log', 177, 'VERDICT: BUDGET BREACH',
                  'python tools/notebook_scale_benchmark.py --curve (F6, fix round 1)'),
          measure(f'{QS}/qs-curve.log', 178, 'VERDICT: BUDGET BREACH',
                  'python tools/notebook_scale_benchmark.py --curve (quiet slot, 2026-09-29 07:06 CT)'),
          measure(f'{QS}/qs-curve2.log', 178, 'VERDICT: BUDGET BREACH',
                  'python tools/notebook_scale_benchmark.py --curve (repeat, 2026-09-29 07:09 CT)'),
          D(22, 'measures the connection model production uses'),
          code('tools/notebook_scale_benchmark.py', 943, 'if args.curve and not connection_explicit:'),
          code('tools/notebook_scale_benchmark.py', 944,
               'primary_connection, diagnostic_connection = "per-call", "shared"'),
          record(PB, 899, 'ruling D22'), record(PB, 915, 'owed before the scorecard cites 14d as MET')],
         'quiet re-score QR (2026-10-02): the re-read this cell said was owed exists. A bare `--curve` (the per-call '
         'model, ruling D22) on a box lock FREE and load QUIET at both ends (05:47-05:50 CT) read VERDICT PASS: every '
         'op\'s fit at or under 1.1 and every last segment at or under 1.3. It was measured at `93c4bed77` '
         '(feat/notebook-w10-pc3, not merged); `git diff` of that tree against this one is empty for the '
         'notes services (api/services/journal_two), `api/services/auth_db.py` and the benchmark tool, so it measures this tree\'s '
         'notes reads. The shared model ran beside it as the diagnostic and recorded 5 breaches (count_notes fit 1.119 '
         'and last segment 2.531, folder_note_counts last segment 2.024, get_symbol_backlinks 1.121, list_tasks '
         '1.159), not gating under D22; a per-call PASS says the product does not grow super-linearly as a member '
         'experiences it, not that the queries are free of page-cache effects (perf-budgets.md, "The per-call '
         'reading"). The bounds are unchanged. What the cell said before this re-score, kept for the record: '
         'the curve and its bounds are built (10A); every reading taken so far BREACHes (count_notes, folder '
         'counts, backlinks, list_tasks bending between 10k and 25k), including lane RS\'s two quiet-slot repeats. '
         'Lane PC diagnosed the cause: the benchmark holds one long-lived SQLite connection with SQLite\'s default '
         '2 MB page cache against a ~490 MB database at 50k notes, and the super-linear shape is that cache '
         'spilling, not an algorithm -- with a page cache sized for the database or with mmap, every op is linear '
         'or better. Production does not use the benchmark\'s connection model: api/services/auth_db.get_connection '
         'opens a fresh connection per call (no pool, no cache_size), which PC measured sub-linear (fit 0.32-0.65) '
         'on the same ops. This text used to say PC\'s branch "is not merged here"; that is stale -- PC landed via '
         'L5 (0812b5ec3, PR #252, an ancestor of HEAD) and ruling D22 (controller, owner-delegated 2026-09-30) has '
         'since sharpened PC\'s own 2026-09-29 ruling into a structural default: a bare `--curve` now measures '
         'production\'s per-call connection model, and only that reading gates the verdict; the shared (bench) '
         'model that produced every BREACH cited above runs automatically beside it as a reported diagnostic '
         '(`report["curve_diagnostic"]`), its breach recorded and never hidden, never gating. This is implemented '
         'on this tree, not just ruled: an explicit `--connection` is still honored exactly as asked, and the '
         'per-call default fires only for a bare `--curve`. The verdict stays NOT MET: D22 changes what future '
         'curve readings measure by default, it does not itself constitute one. A quiet-box reading of the '
         'per-call model does not exist yet on this tree -- perf-budgets.md says so in the same words this row '
         'now does ("that re-read is owed before the scorecard cites 14d as MET") -- and none is invented here. '
         'The bounds in perf-budgets.json are unchanged', None),
    ]
    try:
        TELEM_EVENTS = core_action_events(open(os.path.join(ROOT, f'{LB}/notebookTelemetry.js'), encoding='utf-8').read())
    except ValueError as e:     # an event the parser cannot read is a refusal, never a shorter list (R12-M3)
        PROBLEMS.append(f'15b: {e}')
        TELEM_EVENTS = []

    def _read_rail(p):
        fp = os.path.join(ROOT, p)
        return open(fp, encoding='utf-8', errors='replace').read() if os.path.isfile(fp) else None

    TELEM_WHERE = {}
    try:
        TELEM_GAPS = telemetry_rail_gaps(TELEM_EVENTS, TELEMETRY_RAILS, _read_rail, _f3vt_text, where=TELEM_WHERE)
    except RuntimeError as e:   # the AST walk could not run: refuse, never read 15b as met or as not met
        PROBLEMS.append(f'15b: {e}')
        TELEM_GAPS = [str(e)]
    TELEM_FILES = sorted({f for e in TELEM_EVENTS for f in _rails_of(TELEMETRY_RAILS, e)})
    C[15] = [
        ('client + server error reporting on', 'MET',
         [code('app/src/main.jsx', 10, 'installErrorBeacon()'), code('api/routers/client_errors.py', 54, '@router.post("/api/client-errors")'),
          test_vt('app/src/lib/errorBeacon.test.js')], 'the beacon is installed unconditionally (D14)', None),
        ('Notebook telemetry for every core action', 'NOT MET' if TELEM_GAPS else 'MET',
         [code(f'{LB}/notebookTelemetry.js', 59, 'export const CORE_ACTION_EVENTS = Object.freeze({'),
          test_f3vt('app/src/pages/journal-2-0/lib/notebookTelemetry.test.js'),
          *[test_f3vt(f) for f in TELEM_FILES if ('✓ ' + f.replace('app/', '', 1)) in _f3vt_text],
          code(f'{NB}/AskPanel.jsx', 235, 'trackNotebookEvent(NOTEBOOK_EVENTS.ASK_USED'),
          code(f'{LB}/offline/useOutboxDrain.js', 302, 'trackNotebookEvent(NOTEBOOK_EVENTS.SAVE_SUCCESS'),
          measure(f'{W10D}/browser-check-20260927T050752Z.json', '193-199', '"export_used": 1', 'python tools/notebook_w10d_browser_check.py (10D, sandbox)')],
         (f"R-16's core actions (study tasks T1-T10 plus export, import, save_success, share, publish, writing help, "
          f'dictation) map, in CORE_ACTION_EVENTS, to {len(TELEM_EVENTS)} allow-listed events with closed-enum schemas '
          f'(constant references resolved, never dropped). Derived, not typed (F3 fix rounds 2 and 3): every event must '
          f'have a call-site rail, and the rail must ASSERT it -- a test that is not skipped, whose expect(...) chain the '
          f'event reaches in executable code (an acorn walk, `tools/telemetry_rail_asserts.mjs`; a comment never '
          f"counts) -- and that test must show a green tick in F3's telemetry log. save_success is railed at both of "
          f"its doors: the editor's and the outbox drain's (T8, `useOutboxDrain.js:302`). ask_used (T7) was the one "
          f'gap in round 1; AskPanel.telemetry.test.jsx rails it (one ask_used per answered ask, none without an ask, none '
          f'on a failed or empty answer, one more on an insert). Asserting tests: '
          + '; '.join(e + ' ' + ', '.join(os.path.basename(x) for x in TELEM_WHERE[e][:2]) for e in sorted(TELEM_WHERE))
          + ". 10D's browser check drove only some doors (save, writing help, dictation, export, share + publish, "
          f'switcher, search, import) and is cited as a corroborating count, not as the proof. Residual, stated: the '
          f'derivation is per event plus the T8 door; an event with further doors (export from the export dialog and '
          f'the selection, publish from a folder, writing help from a property) is railed at one door each. '
          + ('Every event is railed.' if not TELEM_GAPS else
             'Not railed: ' + '; '.join(TELEM_GAPS) + '. Lever: a call-site rail for each')),
         None if not TELEM_GAPS else BUILD),
        ('canaries in the repo', 'MET',
         [record('docs/notebook/soak-30day.md', 34, 'The out-of-repo copies refreshed and'),
          test_f3('tests/test_nb_observe.py')],
         'the running copies of nb_observe, nb_gate, window_check and nb_soak are compared with the repo\'s by a rail '
         '(CR-stripped content); F3 ran it on this tree and it passed -- wave 9\'s "the running copy differs" no '
         'longer holds', None),
        ('SLOs with alerts', 'MET',
         [code(f'{JT}/notebook_slo.py', 128, 'SAVE_SUCCESS_OBJECTIVE = 0.995'), code('api/main.py', 8362, 'id="notebook_slo_check"'),
          test_f3('tests/test_notebook_slo.py')],
         'save success >= 99.5 % pages (Discord); Ask and search p95 go to a daily digest, never paged (ruling R-15); '
         'registered on the scheduler every 15 minutes', None),
    ]
    C[16] = [
        ('a new member reaches a first useful note in < 2 minutes unaided', NMO,
         [record('docs/notebook/user-study-kit.md', 1, 'the kit (Phase 7, standard #5)')], USK, OWNER),
        ('help centre articles', 'MET', [code('app/src/pages/Support.jsx', 422, "id: 'notebook-getting-started',"), walk9('B14_onboarding_help')], '', None),
        ('sample notebook', 'MET', [flag('NOTEBOOK_ONBOARDING_ENABLED', 'armed'), walk9('B14_onboarding_help')], '', None),
        ('member templates', 'MET', [walk9('B11_organise')], '', None),
    ]
    for n in range(1, 17):
        if n not in C:
            PROBLEMS.append(f'standard {n} has no clauses')

    # ═══ render ═══════════════════════════════════════════════════════════════════════════════════
    rc, head = git('rev-parse', '--short=9', 'HEAD')
    rc2, app_tree = git('rev-parse', 'HEAD:app')
    rc3, api_tree = git('rev-parse', 'HEAD:api')
    L1C = '13f9b0a87'   # the wave-10 L1c landing tree this re-score was cut from (every follow-up lane merged)
    _, app_diff = git('diff', '--name-only', L1C, 'HEAD', '--', 'app', 'api')
    B0_ROWS, B0_PROBLEMS = evidence_index('HEAD')
    PROBLEMS.extend(B0_PROBLEMS)


    def esc(s):
        return s.replace('|', '/')


    out = []
    w = out.append
    w('# Notebook parity scorecard — every ledger row, the 16 standards, the honest misses')
    w('')
    w(f'**Date:** {DATE} (re-scored by wave 13 lane 13SC on the wave-13 landing tree, after wave 12 lane 12C phase 2 on the '
      f'wave-12 landing branch, the wave-10 re-score, follow-up F3 on 2026-09-28 and lane RS on the controller\'s quiet-slot; '
      f'the tool and method are wave 9 lane 9B\'s). **Product '
      f'scored:** this tree — app tree `{app_tree[:9]}`, api tree `{api_tree[:9]}` — which is the wave-10 L1c landing '
      f'tree `{L1C}` (master `4bba30b73` + #225 + 10E-1 + 10E-2 + the follow-up lanes F2, F4, F5, F6 and F7) plus this '
      f're-score\'s own documents and tool: `git diff --name-only {L1C} HEAD -- app api` lists '
      f'{len([x for x in app_diff.splitlines() if x])} file(s)'
      + (': ' + ', '.join(f'`{x}`' for x in app_diff.splitlines() if x) if app_diff.strip() else '') +
      f'. **Document written at:** `{head}`.')
    w('')
    w('**No browser ran on this tree.** The re-score ran no sandbox and no browser (a six-shard gate was due on this '
      'box). Every `WALK` cell names the tree its run measured -- wave 9\'s browser check (`8a0098029`), the wave-7 and '
      'wave-8 walks, wave 10\'s L1a walk (`14310c206`), 10E-1\'s proof walk (`fd7d1f42d`), F5\'s after-run '
      '(`aa2417c2c`), F4\'s keyboard re-walk (`0555889ef`) -- and §0 proves each of those trees reachable from this '
      'one. A later change to a measured surface is named in the cell\'s notes; nothing measured on an older tree is '
      'presented as measured here.')
    w('')
    w('**What this is, and what it is not.**')
    w('- The **gap ledger** (`docs/notebook/competitive-gap-ledger.md`) is the STATUS authority (ruling D-9B4). This scorecard '
      'COMPARES only: its "ledger row" column cites the row and never restates its status. Where the two disagree, the ledger wins '
      'and this file is the one that drifted.')
    w('- It **does not supersede** the gap ledger, the research log (`docs/notebook/competitive-research-ledger.md`, whose R12–R18 '
      'record every fetch behind this file), or the performance record (`docs/notebook/perf-budgets.md`).')
    w('- It **supersedes, as the current parity comparison, and leaves untouched**: `docs/notebook/primary-notebook-readiness-scorecard.md` '
      'and `docs/notebook/notebook-ux-ui-competitive-ledger.md`. Both are older comparisons; neither was edited.')
    w('- The plan\'s §1 "Now" numbers (`docs/notebook/NOTEBOOK-10-OF-10-PLAN.md`) are **estimates**, shown beside the clause count in §B, '
      'never averaged (ruling D-9B1).')
    w('- **Wave 12, lane 12C (2026-10-02)**: phase 1 added competitor citations from a new fetch pass (research ledger R18) and '
      'moved the cells those quotes decide; phase 2 re-scored on the wave-12 landing branch -- 12D\'s sandbox walk (G-003, G-045, '
      'G-121), 12B\'s template walk (G-026), 4d\'s tie-break run A4, and three controller rulings (G-015 O, G-122 E, G-135 O).')
    w('- No competitor\'s speed is stated here (lane 9A\'s protocol, `docs/notebook/benchmark/protocol.md`, and the owner\'s run), and no '
      'user-study or soak result (9C\'s kits and the owner\'s runs).')
    w('- **Wave 13 (lane 13SC, 2026-10-03)**: added the wave-13 landing tag to §0 so a future lane can cite wave-13 evidence, and read '
      'every wave-13 lane doc (13A through 13J plus 13Q) against this scorecard\'s two tracked axes. None cites a gap-ledger row or '
      'names Notion, Evernote or Obsidian -- wave 13 targets the separate trader-journal/charting-platform bar in '
      '`docs/notebook/WAVE-13-PLAN.md` section 1.3, which this file carries no row for. **No clause or gap-ledger row moves this pass**; '
      'the counts below are unchanged from the wave-12 re-score.')
    w('')
    w('**Verdicts (closed set):** `AHEAD` · `PARITY` · `BEHIND` · `N/A` (no competitor equivalent, or a UCT-internal row) · '
      '`OUT-OF-SCOPE (D#)` · `BLOCKED (owner|external)` · `NOT-VERIFIED`. A verdict of AHEAD, PARITY or BEHIND needs BOTH sides '
      'evidenced: a UCT behaviour confirmed (a browser or API walk at a named tree, never a code reading alone), and a competitor '
      'quote from a page fetched on the date it cites. An absence on a competitor\'s page is never cited, so "AHEAD" appears only '
      'where the competitor\'s own page states the limit. A capability behind a dark gate is BLOCKED, never "available". **Clause '
      'verdicts** (§B): `MET` · `NOT MET` · `NOT MEASURED` · `NOT MEASURED — OWNER` (only the owner can take the reading) · '
      '`NOT MEASURED — QUIET SLOT` (a timing verdict that waits on the controller\'s held quiet slot).')
    w('')
    w('**UCT evidence kinds:** `CODE path:line "fragment"` read at the revision above; `TEST file` + a run (by 9B, or by F3 on this '
      'tree) with its log and totals line; `WALK tool:check VERDICT` + report + tree; `MEASURE doc:line` + the command; `RECORD '
      'doc:line` (a record, "per record, not re-read"; a flag record names the revision the ledger was read at); `RULING doc:line` '
      'for a deliberate no. **Competitor cells:** `N:` Notion · `E:` Evernote · `O:` Obsidian, each an official URL, a quoted '
      'sentence of at most 25 words from the page fetched, and the fetch date — or `not verified` with the reason. Every quote was '
      'checked verbatim against the fetched text before it was entered (R16; Evernote\'s browser reads against the committed '
      'evidence file; R18\'s against the text of its own fetch). The date beside a quote is the date its page was fetched.')
    w('')
    w('## §0 — B0: the evidence index, verified at the revision above')
    w('')
    w('Waves 5-10 land on master as squash merges, so a wave\'s head is never an ancestor of master; wave 9\'s "every tip '
      'SHA is an ancestor" could hold only on a wave\'s own branch. What the index proves instead: (1) each wave\'s '
      'SQUASHED head is pinned by a tag and resolves to the recorded SHA (waves 5 and 7 by new `-tip2-` tags: their '
      '`-tip-` tags are not the heads the PRs squashed, and are left where they are); (2) each wave\'s squash is an '
      'ancestor of this tree; (5) the squash carries the head: its tree is the head merged onto the squash\'s parent '
      '(`git merge-tree --write-tree <squash>^ <head>` equals `<squash>^{tree}`, so a squash onto a master that moved '
      'still ties; L1c, not squashed yet, has its tagged head in this tree\'s own history; after its squash the tool finds '
      'the earliest commit of this tree\'s history that carries it); (3) every cited evidence file is byte-identical here to the file '
      'its landing carried; and (4) every tree a browser or walk measured is an ancestor of its declared wave\'s tag, '
      'and that wave landed; a ref that is not a declared wave tag (a bare SHA, an undeclared tag) is refused. Every '
      'evidence file and walked tree the cells below cite is one of these rows, or `--write` refuses.')
    w('')
    w('| item | command | result |')
    w('|---|---|---|')
    for a, b, c in B0_ROWS:
        w(f'| {a} | `{b}` | {c} |')
    w('')
    w('Every property holds.' if not B0_PROBLEMS else f'{len(B0_PROBLEMS)} propert(ies) do NOT hold (see the rows above).')
    w('')
    # ── B1 inventory ──
    INV = [
        ('Phase 1', 72, 'Syntax highlighting (lowlight)', 'G-129'), ('Phase 1', 72, 'Math, inline + block (KaTeX)', 'G-130'),
        ('Phase 1', 72, 'Text colour + highlight', 'G-131'), ('Phase 1', 72, 'Callout icon and colour picker', 'G-132'),
        ('Phase 1', 73, 'Image captions + alignment', 'G-133'), ('Phase 1', 73, 'Table UI (add/delete rows and columns, header row, resize, sort)', 'G-134'),
        ('Phase 1', 74, 'Drag handles and block reordering', 'G-135'), ('Phase 1', 74, 'Table of contents / outline', 'G-136'),
        ('Phase 1', 75, 'Word count + reading time', 'G-137'), ('Phase 1', 75, 'Find and replace', 'G-138'),
        ('Phase 1', 75, 'Emoji picker', 'G-139'), ('Phase 1', 75, '@date mentions', 'G-140'),
        ('Phase 1', 76, 'Web embeds + link bookmarks', 'G-141'), ('Phase 1', 77, 'Multi-column layout', 'G-142'),
        ('Phase 1', 77, 'Heading levels H4–H6', 'G-143'), ('Phase 1', 77, 'An undo/redo control on touch', 'G-144'),
        ('Phase 2', 82, 'Quick switcher over all notes', 'G-145'), ('Phase 2', 82, 'Bulk operations', 'G-146'),
        ('Phase 2', 83, 'Nested tags', 'G-147'), ('Phase 2', 83, 'Unlinked mentions', 'G-148'),
        ('Phase 2', 83, 'Timeline view', 'G-149'), ('Phase 2', 83, 'Archive state', 'G-150'),
        ('Phase 2', 83, 'Note lock (read-only)', 'G-151'), ('Phase 2', 84, 'Split view', 'G-152'),
        ('Phase 2', 84, 'Reminders with notifications', 'G-153'), ('Phase 2', 85, 'A tasks view across notes', 'G-154'),
        ('Phase 2', 85, 'Member-made templates', 'G-155'), ('Phase 2', 86, 'A real daily note', 'G-156'),
        ('Phase 2', 86, 'A decision on pages-inside-pages vs folders', 'G-157'), ('Phase 2', 87, 'Lightweight relations', 'G-158'),
        ('Phase 3', 91, 'Publish the browser extension', 'G-043'), ('Phase 3', 91, 'An iOS capture path', 'G-044'),
        ('Phase 3', 92, 'Camera scan with OCR', 'G-159'), ('Phase 3', 93, 'OCR for images; text from docx/xlsx', 'G-160'),
        ('Phase 3', 93, 'Email-to-notebook', 'G-161'), ('Phase 3', 94, 'Dictation in the note editor', 'G-162'),
        ('Phase 3', 94, 'Cold-start offline', 'G-163'), ('Phase 3', 95, 'A real-device matrix every release', 'G-164'),
        ('Phase 4', 98, 'Writing help (summarize, rewrite, continue, translate, autofill)', 'G-165'),
        ('Phase 4', 99, 'Semantic retrieval (G-127)', 'G-127'), ('Phase 4', 100, "G-064's insert on", 'G-064'),
        ('Phase 4', 100, 'AI over attachments beyond PDFs', 'G-166'),
        ('Phase 5', 103, 'Share links on', 'G-080'), ('Phase 5', 103, 'Publish-to-web for a note or folder', 'G-167'),
        ('Phase 5', 104, 'Comments on shared notes', 'G-081'), ('Phase 5', 104, 'Real-time co-editing and team workspaces', 'G-081'),
        ('§1 #1', 23, 'Tables are insert-only', 'G-134'), ('§1 #1', 23, 'Callout icon fixed at 💡', 'G-132'),
        ('§1 #1', 23, 'Images have no caption/alignment', 'G-133'), ('§1 #1', 23, 'Flat tags', 'G-147'),
        ('§1 #1', 23, 'No reminders', 'G-153'), ('§1 #1', 23, 'No tasks view', 'G-154'),
        ('§1 #5', 27, 'Dictation missing in the editor', 'G-162'), ('§1 #6', 28, '24 Notebook components carry no aria', 'G-168'),
        ('§1 #8', 30, 'Share links built but off', 'G-080'), ('§1 #9', 31, 'No axe tooling; graph has no keyboard movement', 'G-168'),
        ('§1 #10', 32, 'iOS share path absent', 'G-044'), ('§1 #10', 32, 'No cold-start offline', 'G-163'),
        ('§1 #10', 32, 'Device testing is manual', 'G-164'), ('§1 #11', 33, 'Export is markdown zip + single note + PNG/print only', 'G-169'),
        ('§1 #11', 33, 'Sync connectors read-only', 'G-093'), ('§1 #11', 33, 'No public API/webhooks', 'G-085'),
        ('§1 #12', 34, 'No summarize/rewrite/continue/translate', 'G-165'), ('§1 #12', 34, 'Semantic search off', 'G-127'),
        ('§1 #12', 34, 'G-064 insert built but dark', 'G-064'), ('§1 #13', 35, 'Non-PDF attachments unsearched', 'G-166'),
        ('§1 #15', 37, 'No frontend error reporting; telemetry gaps', 'G-170'), ('§1 #16', 38, 'No Notebook help articles', 'G-172'),
        ('§1 #16', 38, 'Member-made templates not built', 'G-155'), ('§1 #16', 38, 'First-run: tour + sample notebook', 'G-171'),
    ]
    for src, ln, item, rid in INV:
        if rid not in ROWS:
            PROBLEMS.append(f'inventory maps to unknown row {rid}')
        t = plan_at(INVENTORY_REV, ln) + ' ' + plan_at(INVENTORY_REV, ln + 1)
        key = item.split()[0].strip('@').lower()
        if key[:4] not in t.lower():
            PROBLEMS.append(f'inventory item {item!r} not visible on plan line {ln}')
    NON_CAP = [
        ('§1 #2', 24, 'F5P-1, the append-merge finding, the 409 in T-12', '§B standard #2 (no known data-loss path)'),
        ('§1 #3', 25, 'The Wave Q1 REVERT verdict; no restore rehearsed', '§B standards #3, #7'),
        ('§1 #4', 26, 'No budget; 71 ms/char at the cap; bundle size untracked', '§B standard #4 (and G-035)'),
        ('§1 #5', 27, 'No user testing; 0 organic members', '§B standard #5'),
        ('§1 #6', 28, 'No design review', '§B standard #6'),
        ('§1 #7', 29, 'Restore never rehearsed; deletion does not reach backups', '§B standard #7'),
        ('§1 #8', 30, 'Vendor terms unverified; FTS index plaintext', '§B standard #8 (and G-004)'),
        ('§1 #14', 36, 'Super-linear folder counts, backlinks, search at 50k', '§B standard #14'),
        ('§1 #16', 38, '0 organic members to learn from', '§B standard #16'),
    ]
    w('## §B1 — the weekly-feature inventory, each item to exactly one ledger row')
    w('')
    w(f'Built from the plan item by item (`{PLAN}` Phase 1 :71-78, Phase 2 :81-88, Phase 3 :90-95, Phase 4 :97-100, Phase 5 '
      ':102-106, §1 biggest gaps :23-38). An item that names a PROPERTY of the product rather than a capability maps to a '
      'standard in §B, listed after the table.')
    w('')
    w(f'| source | plan line (at {INVENTORY_REV}) | item | ledger row |')
    w('|---|---|---|---|')
    for src, ln, item, rid in INV:
        w(f'| {src} | `{PLAN}`:{ln} | {esc(item)} | {rid} |')
    w('')
    w('Items that are properties, not capabilities (scored as standards):')
    w('')
    w(f'| source | plan line (at {INVENTORY_REV}) | item | where scored |')
    w('|---|---|---|---|')
    for src, ln, item, where in NON_CAP:
        w(f'| {src} | `{PLAN}`:{ln} | {esc(item)} | {where} |')
    w('')

    # ── §A ──
    cnt = {v: Counter() for v in 'NEO'}
    for r in ROWS.values():
        for i, vk in enumerate('NEO'):
            cnt[vk][r['v'][i]] += 1
    w('## §A — every gap-ledger row against Notion, Evernote and Obsidian')
    w('')
    w('Row set parsed from the ledger (`tools/gap_ledger_summary.py`\'s parser), in ledger order; '
      f'**{len(ROWS)} rows**. Verdict counts:')
    w('')
    w('| verdict | vs Notion | vs Evernote | vs Obsidian |')
    w('|---|---:|---:|---:|')
    allv = ['AHEAD', 'PARITY', 'BEHIND', 'N/A', 'NOT-VERIFIED', 'BLOCKED (owner)', 'BLOCKED (external)'] + sorted(
        {v for c in cnt.values() for v in c if v.startswith('OUT-OF-SCOPE')})
    for v in allv:
        w(f'| {v} | {cnt["N"][v]} | {cnt["E"][v]} | {cnt["O"][v]} |')
    w('')
    w('| ID | capability | ledger row | vs Notion | vs Evernote | vs Obsidian | UCT evidence | competitor evidence | notes |')
    w('|---|---|---|---|---|---|---|---|---|')
    for rid, r in ROWS.items():
        uct = ' ; '.join(esc(e) for e in r['uct'])
        comp = ' · '.join(esc(comp_part(vk, r['comp'][vk], rid)) for vk in 'NEO')
        w(f'| {rid} | {esc(capability(rid))} | `{LEDGER}`:{ledger_line(rid)} | {r["v"][0]} | {r["v"][1]} | {r["v"][2]} | '
          f'{uct} | {comp} | {esc(r["note"])} |')
    w('')

    # ── §B ──
    w('## §B — the 16 standards, clause by clause')
    w('')
    met_all = []
    w('| # | standard | plan "Now" (estimate) | clauses met k/n | at bar (10 only when every clause is MET) |')
    w('|---|---|---:|---:|---|')
    for s in STD:
        cl = C[s['n']]
        k = sum(1 for c in cl if c[1] == 'MET')
        n = len(cl)
        atbar = k == n
        met_all.append(atbar)
        w(f'| {s["n"]} | {s["name"]} | {s["now"]} | {k}/{n} | {"10" if atbar else "not at bar"} |')
    w('')
    N_AT_BAR = sum(met_all)
    w(f'**{N_AT_BAR} of 16 standards at bar.** (Ruling D-9B1: a standard reads 10 only when every clause is MET; the plan\'s '
      '"Now" column is an estimate and is never averaged into this line.)')
    w('')
    for s in STD:
        cl = C[s['n']]
        k = sum(1 for c in cl if c[1] == 'MET')
        w(f'### {s["n"]}. {s["name"]} — clauses met {k}/{len(cl)}; plan "Now" {s["now"]} (estimate)')
        w('')
        w(f'10/10 means (`{PLAN}`:{s["line"]}): "{s["means"]}"')
        w('')
        w('| clause | verdict | evidence | lever / owner |')
        w('|---|---|---|---|')
        for clause, verdict, ev, lever, _group in cl:
            w(f'| {esc(clause)} | {verdict} | {" ; ".join(esc(e) for e in ev)} | {esc(lever) or "—"} |')
        w('')

    # ── §C ──
    w('## §C — what still misses, and what owns each miss')
    w('')
    GROUP_NAME = {OWNER: 'Owner-only (only the owner can take the step or the reading)',
                  QUIET: 'Quiet-slot (a timing verdict the controller takes in a held quiet slot)',
                  BUILD: 'Build work (an agent or the controller can do it)'}
    w('### What 10/10 still needs')
    w('')
    w(f'**{N_AT_BAR} of 16 standards at bar.** Every clause not MET appears below exactly once, under whoever can close it, '
      'with its lever. The quiet-slot commands are `docs/notebook/perf-budgets.md` §7 (10A\'s three, run from PowerShell on a box '
      'that holds quiet for the whole run).')
    w('')
    for g in (OWNER, QUIET, BUILD):
        items = [(s_, c) for s_ in STD for c in C[s_['n']] if c[1] != 'MET' and c[4] == g]
        w(f'**{GROUP_NAME[g]}** — {len(items)}')
        w('')
        for s_, (clause, verdict, ev, lever, _g) in items:
            w(f'- #{s_["n"]} {s_["name"]}: {clause} ({verdict}) — {lever}')
        w('')
    for s_ in STD:
        for c in C[s_['n']]:
            if (c[1] == 'MET') != (c[4] is None):
                PROBLEMS.append(f'standard {s_["n"]} clause {c[0]!r}: verdict {c[1]} but group {c[4]!r} '
                                '(a MET clause has no group; every other clause has exactly one)')
    w('### Standards: every clause not MET')
    w('')
    w('| standard | clause | verdict | lever / ruling / kit |')
    w('|---|---|---|---|')
    for s in STD:
        for clause, verdict, ev, lever, _group in C[s['n']]:
            if verdict != 'MET':
                w(f'| {s["n"]}. {s["name"]} | {esc(clause)} | {verdict} | {esc(lever) or "—"} |')
    w('')
    w('Named performance levers: the wave-9 set (`docs/notebook/perf-budgets.md`:305-317, the integer hop into the FTS map and '
      'a maintained task index) is BUILT by 10A (§7); what remains is the quiet-box verdict and typing below the cap (the toolbar\'s '
      'whole-page re-render, §7 "Typing"; two quiet readings of the same build disagree, perf-budgets.md "Quiet '
      're-reads"). The curve\'s bend between 10k and 25k notes is now only the shared-model diagnostic: the per-call '
      'curve read PASS on a quiet box (2026-10-02, clause 14d). G-035 at the size cap stands by owner ruling '
      '(`docs/notebook/competitive-gap-ledger.md`:88).')
    w('')
    w('### Rows: every BEHIND, NOT-VERIFIED or BLOCKED verdict')
    w('')
    for rid, r in ROWS.items():
        vs = r['v']
        if any(v in ('BEHIND', 'NOT-VERIFIED') or v.startswith('BLOCKED') for v in vs):
            own = r['lever']
            if not own:
                reasons = []
                for i, vk in enumerate('NEO'):
                    if vs[i] == 'NOT-VERIFIED' and isinstance(r['comp'][vk], str):
                        reasons.append(f'{vk}: a page that states it (next R-row)')
                    elif vs[i] == 'NOT-VERIFIED' and isinstance(r['comp'][vk], dict):
                        reasons.append(f'{vk}: a verbatim sentence from the page the paraphrase summarises')
                own = '; '.join(reasons) or 'a browser pass or a competitor fetch (see notes in §A)'
            w(f'- **{rid}** {esc(capability(rid))} — {" / ".join(vs)} — {esc(own)}')
    w('')

    # ── §D browser check summary ──
    w('## §D — the browser check behind the WALK cells')
    w('')
    w(f'`{EVD}/browser_check_9b.py` drove Playwright Chromium against a census-pinned sandbox booted from a `git archive` export of '
      f'`8a0098029` (built `app/dist`; production\'s armed Notebook gates set in the sandbox environment only; no model key). Integrity '
      f'checkpoints pre-boot, +15 s, +120 s and shutdown all CLEAN (`{EVD}/sandbox-integrity-2026-09-26T14-58-03.md`). Result: '
      f'{W9["summary"]}, {len(W9["pageerrors"])} page errors.')
    if W9P2 is not None:
        w(f'A second pass, `{EVD}/browser_check_9b_pass2.py`, drove the rows the first did not, on a fresh sandbox of the '
          f'same export (integrity pre-boot, +15 s, +120 s and shutdown all CLEAN, '
          f'`{EVD}/sandbox-integrity-2026-09-26T15-30-24.md`): {W9P2["summary"]}, {len(W9P2["pageerrors"])} page errors '
          f'(`{EVD}/browser-check-pass2.json`).')
    w('')
    w('| check | rows | verdict |')
    w('|---|---|---|')
    for d in [W9] + ([W9P2] if W9P2 else []):
        for cid, c in d['checks'].items():
            w(f'| {cid} | {", ".join(c.get("rows", []))} | {c.get("verdict")} |')
    w('')
    # Wave 10: the walks the new WALK cells cite, each read from its committed report (never typed here).
    with open(os.path.join(ROOT, W10_WALK), encoding='utf-8') as fh:
        L1A = json.load(fh)
    w(f'**Wave 10, the L1a landing walk** (`{W10_WALK_TOOL}`, report `{W10_WALK}`, tree `{L1A.get("tip")}`): the 10B '
      f'feature rows in real Chromium on a census-pinned sandbox (no model key). First line of the record: '
      f'{esc(str(L1A.get("first_line") or "none recorded"))[:220]}')
    w('')
    w('| check | verdict |')
    w('|---|---|')
    for cid, v in walk_verdicts(L1A).items():
        w(f'| {cid} | {v} |')
    w('')
    with open(os.path.join(ROOT, KBD_F4), encoding='utf-8') as fh:
        KB = json.load(fh)
    kb = Counter(walk_verdicts(KB).values())
    w(f'**Wave 10, the keyboard re-walk** (10E-2\'s `{KBD_TOOL}` re-run by F4, report `{KBD_F4}`, tree '
      f'`{KB["meta"].get("tip")}`): ' + ', '.join(f'{k} {v}' for k, v in sorted(kb.items())) + '; the FAIL steps are '
      + ', '.join(sorted(k for k, v in walk_verdicts(KB).items() if v == 'FAIL')) + ' (§B standard #9).')
    w('')

    # ── citations index ──
    w('## Citations index (for the 10% re-fetch control, ruling D-9B3)')
    w('')
    w('Every competitor URL cited in §A, the R-row that fetched it, where the text was read from, the fetch time and the sha256 '
      'of the bytes fetched. Obsidian\'s help site renders its pages client-side from Obsidian\'s own publish host, so its text was '
      'read from that host (the "read from" column); the public URL is what §A cites.')
    w('')
    w('| # | public URL | R-row | read from | fetched (UTC) | sha256 (first 16) | quote keys | rows |')
    w('|---:|---|---|---|---|---|---|---|')
    by_url = OrderedDict()
    for key, rids in USED.items():
        pid = QUOTES[key][0]
        by_url.setdefault(pid, {'keys': [], 'rows': []})
        by_url[pid]['keys'].append(key)
        by_url[pid]['rows'].extend(rids)
    for i, (pid, d) in enumerate(by_url.items(), 1):
        m = SOURCES[pid]
        rf = m['read_from'] if m['read_from'] != m['public_url'] else 'same'
        rows_u = ', '.join(OrderedDict.fromkeys(d['rows']))
        sha = m['sha256'][:16] if m.get('sha256') else 'not recorded (read in a real browser)'
        w(f'| {i} | {m["public_url"]} | {m.get("rrow") or RROW[m["vendor"]]} | {rf} | {m["fetched_utc"]} | {sha} | '
          f'{", ".join(d["keys"])} | {rows_u} |')
    w('')
    w('Failed fetches (logged, nothing cited): `https://help.evernote.com/hc/en-us/articles/208313748` — Cloudflare challenge '
      '("Just a moment..."), HTTP 403 to curl and to WebFetch (R15); `https://evernote.com/features/note-taking` — HTTP 404 (R14). '
      'R18 (2026-10-02) read help.evernote.com articles through the help centre\'s own article JSON, HTTP 200 each, and moved '
      'two quotes R14 cut from `https://evernote.com/release-notes` (which now shows a later release) to that release\'s own '
      'page, `https://evernote.com/release-notes/11.35.6`, where both are verbatim today.')
    if SUPERSEDED:
        w('')
        w('Evernote paraphrases (R17) now stood in for by a fetched verbatim quote (R18), kept in the committed evidence file and '
          'shown nowhere: ' + ', '.join(SUPERSEDED) + '.')
    w('')


    text = '\n'.join(out) + '\n'
    PROBLEMS.extend(f'B0 {g}' for g in cited_b0_gaps(text))
    summary = {'rows': len(ROWS), 'quote_keys_used': len(USED), 'at_bar': N_AT_BAR,
               'clauses': {n: f"{sum(1 for c in C[n] if c[1] == 'MET')}/{len(C[n])}" for n in C},
               'quotes_verbatim_checked': bool(pages_dir)}
    return text, PROBLEMS, summary


def main(argv=None):
    import argparse
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument('--verify', action='store_true')
    g.add_argument('--dry-run', action='store_true')
    g.add_argument('--write', action='store_true')
    ap.add_argument('--rev', default=None,
                    help='--verify at this revision instead of the one the scorecard records (e.g. HEAD)')
    ap.add_argument('--pages', default=None, help='the fetched page texts, to re-verify every quote verbatim')
    a = ap.parse_args(argv)
    try:
        sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    except (AttributeError, ValueError):
        pass
    if a.verify:
        text = open(os.path.join(ROOT, SCORECARD), 'rb').read().decode('utf-8')
        counts, problems = verify(text, rev=a.rev)
        where = a.rev or f'{recorded_rev(text)} (the revision the scorecard records)'
        print(f'checked against {where}: ' + ', '.join(f'{k} {v}' for k, v in sorted(counts.items())))
        for p in problems:
            print('  FAIL', p)
        print('VERIFY:', 'PASS' if not problems else f'FAIL ({len(problems)})')
        return 0 if not problems else 1
    text, problems, summary = build(a.pages)
    if not a.pages:
        print('quotes checked for length only (no --pages): the verbatim check needs the fetched page texts')
    if problems:
        print('REFUSING TO WRITE —', len(problems), 'problem(s):')
        for p in problems:
            print('  -', p)
        return 1
    if a.dry_run:
        print('dry run OK:', summary)
        return 0
    at = recorded_rev(text)
    _, held = verify(text, rev=at)
    if held:
        print(f'REFUSING TO WRITE — the built scorecard does not hold at the revision it records ({at}); '
              'commit its cited inputs first:')
        for p in held:
            print('  -', p)
        return 1
    dst = os.path.join(ROOT, SCORECARD)
    with open(dst, 'wb') as fh:
        fh.write(text.encode('utf-8'))
    print('wrote', SCORECARD, len(text), 'chars:', summary)
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
