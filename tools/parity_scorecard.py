"""Build and verify docs/notebook/parity-scorecard.md — the Notebook's parity re-score (wave 9, lane 9B).

    python tools/parity_scorecard.py --verify [--rev REV]   # offline: re-check every cited file:line
                                                             #   at the revision the scorecard records
                                                             #   (--rev HEAD: "has the code moved since?")
    python tools/parity_scorecard.py --dry-run [--pages DIR] # build in memory, check, write nothing
    python tools/parity_scorecard.py --write   [--pages DIR] # rebuild the scorecard

WHAT IT NEEDS. Nothing over the network: this tool never fetches. It reads the gap ledger, the plan,
the committed evidence under docs/notebook/evidence/wave9-9b-8a0098029/ (browser-check JSONs, rail
logs), the wave-7 and wave-8 walk reports, and the flag ledger as it stood on master at be9ca78b6
(`git show be9ca78b6:docs/feature_flags.json` — that commit must be in the local object store). The
competitor quotes and the metadata of every page they were cut from (URL, where the text was read,
fetch time, sha256) are embedded below as data (QUOTES, SOURCES), recorded 2026-09-26 by lane 9B's
fetch pass (research ledger R12-R16).

--pages DIR re-verifies every quote verbatim against the text extracted from those fetches (one
<page id>.txt per page; Obsidian's markdown has its links rendered to their display text first).
The pages are the vendors' text and are NOT in the repo; without --pages the quotes are checked for
length only, and the tool says so. A competitor page is re-fetched by hand (ruling D-9B3), never here.

--verify is the offline half the rails run (tests/test_parity_scorecard.py): it parses the COMMITTED
scorecard and re-checks every `CODE|RULING|RECORD|MEASURE path:line "fragment"`, every WALK check id
and verdict in its report, and every TEST totals line in its log, all read through `git show REV:path`
at ONE revision; and every flag RECORD against be9ca78b6. The scorecard is a MEASUREMENT AT A COMMIT:
REV defaults to the revision its own header records ("Document written at"), so an unrelated edit
that moves a cited line later never reds it. `--rev HEAD` asks the other question, "has the code
moved since?", and a line that moved fails by name there (re-read it; never trust it). A revision
that is not in the local object store is never a pass: it fails as "unverifiable: <sha> not in this
clone" (the recorded revision and be9ca78b6 alike; a clone needs full history, e.g. fetch-depth 0).

--write refuses to write while any check fails: a quote not verbatim (with --pages), a fragment not
on its line, a walk check not PASS, a flag state that differs from master's ledger, a log without
its totals line, a verdict of AHEAD/PARITY/BEHIND against a vendor with no citation. It also refuses
unless the built text verifies at the revision its header records (HEAD): a cited input that is
edited but not committed would make that header a revision the citations are not true at.
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

DATE = '2026-09-26'
EVD = 'docs/notebook/evidence/wave9-9b-8a0098029'
LEDGER = 'docs/notebook/competitive-gap-ledger.md'
PLAN = 'docs/notebook/NOTEBOOK-10-OF-10-PLAN.md'
PB = 'docs/notebook/perf-budgets.md'
SCORECARD = 'docs/notebook/parity-scorecard.md'
FLAGS_REV = 'be9ca78b6'          # master's flag ledger the RECORD cells cite ("per record, not re-read")
INVENTORY_REV = '00742b54c'      # the plan the §B1 inventory was built from (lane 9B's starting HEAD)

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
  "evernote__release_notes",
  "Find in note now supports match case again, replacing matches with nothing, and prefilled selected text."
 ],
 "E_pdfexport": [
  "evernote__release_notes",
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
 }
}


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


def _master_flags():
    rc, out = git('show', f'{FLAGS_REV}:docs/feature_flags.json')
    if rc != 0 or not out:
        return None
    d = json.loads(out)
    return d.get('flags', d)


# ── the offline verifier ──────────────────────────────────────────────────────────────────────
_CITE = re.compile(r'(CODE|RULING|RECORD|MEASURE) `([^`]+)`:(\d+(?:-\d+)?) "(.*?)"'
                   r'(?=\s*(?:;|\(D\d+\)|\(ledger\)|—|$))')
_WALK = re.compile(r'WALK `([^`]+)`:(\w+) (\w+) — report `([^`]+)`')
_TEST = re.compile(r'TEST `([^`]+)` — run by 9B: `([^`]+)`, "([^"]+)"')
_FLAG = re.compile(r'RECORD `docs/feature_flags\.json` as on master (\w+), key (\w+): status (\w+)')
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
                    flags = _master_flags()
                    if flags is None:
                        problems.append(f'unverifiable: {FLAGS_REV} not in this clone')
                        flags = {}
                rev_, key, want = m.groups()
                got = (flags.get(key) or {}).get('status')
                counts['FLAG'] += 1
                if rev_ != FLAGS_REV[:len(rev_)] or got != want:
                    problems.append(f'flag {key}: the record says {want!r} at {rev_}, {FLAGS_REV} says {got!r}')
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
                checks = json.loads(t)['checks']
                if isinstance(checks, dict):
                    got = (checks.get(cid) or {}).get('verdict') if isinstance(checks.get(cid), dict) else checks.get(cid)
                else:
                    got = next(((c.get('verdict') or c.get('status')) for c in checks
                                if (c.get('id') or c.get('check')) == cid), None)
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
    FLAGS = _master_flags()
    if FLAGS is None:
        PROBLEMS.append(f'unverifiable: {FLAGS_REV} not in this clone (flag records cannot be checked)')
        FLAGS = {}


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
            PROBLEMS.append(f'{kind} {path}:{line} does not hold {contains!r}')
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
        f = FLAGS.get(key)
        got = (f or {}).get('status')
        if got != want:
            PROBLEMS.append(f'flag {key}: master says {got!r}, evidence says {want!r}')
        return (f'RECORD `docs/feature_flags.json` as on master be9ca78b6, key {key}: status {want} '
                f'— per record, not re-read')


    W9 = json.load(open(os.path.join(ROOT, EVD, 'browser-check.json'), encoding='utf-8'))
    W7P = 'docs/notebook/evidence/wave7-walk-8f232d21d/walk-8f232d21d.json'
    W8P = 'docs/notebook/gate-runs/wave8/walk-341bbccf3.json'
    W7 = json.load(open(os.path.join(ROOT, W7P), encoding='utf-8'))
    W8 = json.load(open(os.path.join(ROOT, W8P), encoding='utf-8'))
    W9P2 = None
    if os.path.exists(os.path.join(ROOT, EVD, 'browser-check-pass2.json')):
        W9P2 = json.load(open(os.path.join(ROOT, EVD, 'browser-check-pass2.json'), encoding='utf-8'))


    def _walk_checks(d):
        c = d['checks']
        if isinstance(c, dict):
            return {k: (v.get('verdict') if isinstance(v, dict) else v) for k, v in c.items()}
        return {x.get('id') or x.get('check'): (x.get('verdict') or x.get('status')) for x in c}


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


    # ── competitor cells ──────────────────────────────────────────────────────────────────────────
    VENDOR = {'N': 'notion', 'E': 'evernote', 'O': 'obsidian'}
    RROW = {'notion': 'R12', 'obsidian': 'R13', 'evernote': 'R14'}
    EB = ('not verified — help.evernote.com refused every fetch today (Cloudflare 403, R15) and no '
          'evernote.com page fetched today (R14) states it')
    NFN = 'not verified — no Notion help page fetched today (R12) states it'
    NFO = 'not verified — no Obsidian help page fetched today (R13) states it'
    NA = 'not verified — no competitor claim made: a UCT-internal or UCT-unique row'
    SPEED = ('not verified — a competitor\'s speed is lane 9A\'s protocol and the owner\'s run '
             '(`docs/notebook/benchmark/protocol.md`), never stated here')
    USED = OrderedDict()


    def qref(key, rid):
        pid, q = QUOTES[key]
        m = SOURCES[pid]
        USED.setdefault(key, []).append(rid)
        return f'{m["public_url"]} "{q}" ({DATE})'


    def comp_part(v, spec, rid):
        if isinstance(spec, str):
            return f'{v}: {spec}'
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


    UI_NOT = 'UI not confirmed in 9B\'s browser check on the scored tip — not scored as met.'
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
    R('G-001', ('P', 'NV', 'P'), [code(NS, 3531, 'def restore_note('), walk9('B20_more_older_rows'), walk9('B22_trash_restore')],
      {'N': ['N_restore', 'N_trash'], 'E': EB, 'O': ['O_trash']},
      'B22: deleted through the confirm dialog, found in Trash, restored, back in All notes.')
    R('G-002', ('P', 'NV', 'P'), [code(f'{NB}/NoteHistoryPanel.jsx', 17, 'Restore'), code(NS, 2979, 'def restore_note_version('),
                      walk9('B17_older_rows'), walk9('B23_version_restore')],
      {'N': ['N_version'], 'E': EB, 'O': ['O_recovery']},
      'B23: an edit made a version; History listed it and restoring it brought the original words back.')
    R('G-003', ('P', 'NV', 'NV'), [code(f'{JT}/account_purge.py', 53, '"j2_notes",')],
      {'N': ['N_delete_acct'], 'E': EB, 'O': NFO},
      'A server-side purge; no UI behaviour to confirm. PARITY is account deletion as named on each side.')
    R('G-004', ('P', 'NV', 'P'), [L('G-004', 'owner-accepted 2026-09-22')],
      {'N': ['N_encrypt'], 'E': 'not verified — evernote.com/security (R14) states encryption in transit and for '
                                'secrets, not member notes at rest', 'O': ['O_e2e']},
      'Obsidian Sync is end-to-end, a stronger property; E2E is OUT by ruling D11 (plan). PARITY is at-rest encryption as named.')
    R('G-005', 'NV', [code(f'{NB}/NoteEditorPage.jsx', 181, 'const DRAFT_KEY')],
      {'N': NFN, 'E': EB, 'O': NFO},
      'No page fetched today describes a crash-draft safety net; the draft restore itself was not driven. ' + UI_NOT)
    # Search / Retrieval
    R('G-010', 'P', [code(NS, 1339, 'exact_ticker'), walk9('B20_more_older_rows')],
      {'N': ['N_searchfilter'], 'E': ['E_search'], 'O': ['O_search']},
      'B20: a sidebar search returned the target with highlighted matches.')
    R('G-011', 'NV', [measure(PB, '299-303', 'ops still above 100 ms p95 at 50k',
                              'python tools/notebook_scale_benchmark.py --tiers 50000 --thresholds docs/notebook/perf-budgets.json --budget search --budget reads --budget tasks')],
      {'N': SPEED, 'E': SPEED, 'O': SPEED},
      'UCT\'s own 50k search budget is BREACHED (§C); competitor latency is not this lane\'s to state.')
    R('G-012', 'NA', [code(f'{NB}/FolderSidebar.jsx', 610, 'P0-2 fix')], {'N': NA, 'E': NA, 'O': NA},
      'A UCT correctness bug row.')
    R('G-013', ('P', 'NV', 'NV'), [code(NS, 1176, 'date_from'), walk9('B20_more_older_rows')],
      {'N': ['N_datefilter'], 'E': EB, 'O': NFO}, 'B20: the filter panel carries "Note created from".')
    R('G-014', ('NV', 'NV', 'P'), [code(NS, 1379, 'def _snippets_for('), walk9('B20_more_older_rows')],
      {'N': NFN, 'E': EB, 'O': ['O_snippet']}, 'B20: 4 highlighted matches in the result snippets.')
    R('G-015', ('P', 'NV', 'NV'), [code(NS, 1486, 'relevance ranking is opt-in')],
      {'N': ['N_relevance'], 'E': EB, 'O': NFO},
      'Ranking is a server behaviour (the search box asks for sort=relevance); Obsidian\'s fetched page documents a '
      'name sort by default, which says nothing about relevance, so no verdict.')
    R('G-016', 'NA', [code(NS, 2551, 'def resolve_sector_theme_symbols(')], {'N': NA, 'E': NA, 'O': NA},
      'The ticker/sector/theme entity model is UCT\'s; generic database properties are compared under G-021.')
    R('G-017', 'BE', [code(f'{JT}/note_semantic.py', 28, 'NOTEBOOK_SEMANTIC_SEARCH_ENABLED'),
                      flag('NOTEBOOK_SEMANTIC_SEARCH_ENABLED', 'dark'), walk7('W19_semantic_dark')],
      {'N': NFN, 'E': ['E_semantic'], 'O': NFO},
      'Built, dark until the embedding vendor confirms zero retention in writing (D7).', 'ZDR in writing (owner, external)')
    R('G-018', 'NA', [code(NS, 1339, 'exact_ticker')], {'N': NA, 'E': NA, 'O': NA}, 'A UCT correctness bug row.')
    # Organization
    R('G-020', 'P', [code(NS, 49, 'MAX_FOLDER_DEPTH = 6'), walk9('B21_folders_nested')],
      {'N': ['N_subpage'], 'E': ['E_mention'], 'O': ['O_folder']},
      'B21: a folder and a subfolder made in the sidebar; the server nests one under the other. PARITY is nesting as named '
      '(Notion nests pages, Evernote has notebooks and stacks, Obsidian folders).')
    R('G-021', ('P', 'NV', 'P'), [code('api/services/journal_two/note_properties.py', 499, 'SAVEABLE_VIEW_TYPES'),
                                 walk9('B09_list_views_bulk')],
      {'N': ['N_board', 'N_props'], 'E': EB, 'O': ['O_views', 'O_props']},
      'B09: list, table, board, calendar, graph, timeline and tasks modes. Formulas and rollups are OUT until demand '
      'is measured (D12) and are not cited on the competitor side.')
    R('G-022', ('P', 'NV', 'P'), [code(NS, 2233, 'def get_note_backlinks('), walk9('B09_list_views_bulk')],
      {'N': ['N_backlinks'], 'E': EB, 'O': ['O_backlinks', 'O_graph']},
      'B09 drew the graph canvas; B10 opened the backlinks neighbourhood (unlinked mentions).')
    R('G-023', ('P', 'NV', 'P'), [code(NS, 2692, 'j2_note_favorites'), walk9('B20_more_older_rows')],
      {'N': ['N_favorites'], 'E': EB, 'O': ['O_bookmarks']}, 'B20: Add to Favorites pressed; the sidebar lists it.')
    R('G-024', ('P', 'NV', 'NV'), [code(NS, 3800, 'j2_note_recents'), walk9('B20_more_older_rows')],
      {'N': ['N_favorites', 'N_switch'], 'E': EB, 'O': NFO}, 'B20: the sidebar carries Recents.')
    R('G-025', ('P', 'NV', 'P'), [code(f'{NB}/SavedViewEditor.jsx', 13, 'export default function SavedViewEditor'),
                                 walk9('B25_saved_view')],
      {'N': ['N_savedview'], 'E': EB, 'O': ['O_views']},
      'B25: a table view saved by name; on a fresh page the saved view reopened as a table.')
    R('G-026', TPL_V, [code(f'{LB}/notebookTemplates.js', 174, "key: 'thesis',")] + TPL_EV,
      {'N': ['N_dbtemplate'], 'E': ['E_templates'], 'O': ['O_templates']}, TPL_NOTE, TPL_LEVER)
    # Editor
    R('G-030', 'P', [code(f'{LB}/tiptap.js', 114, 'Table.configure'), walk9('B01_slash_menu'), walk9('B02_code_math_callout')],
      {'N': ['N_callout'], 'E': ['E_editmode'], 'O': ['O_callout', 'O_tables']},
      'B01/B02: headings, lists, tables, callouts, code and math in one editor.')
    R('G-031', ('P', 'NV', 'P'), [code('app/src/components/CommandPalette.jsx', 29, "label: 'New Note'"), walk9('B08_quick_switcher')],
      {'N': ['N_switch'], 'E': EB, 'O': ['O_palette']}, 'B08: Ctrl+K opened the palette.')
    R('G-032', ('P', 'P', 'NV'), [code(f'{NB}/NoteFindBar.jsx', 8, 'Replace all'), walk9('B20_more_older_rows')],
      {'N': ['N_find'], 'E': ['E_find'], 'O': NFO}, 'B20: Ctrl+F opened the find bar.')
    R('G-033', 'P', [code(f'{NB}/NoteLinkMenu.jsx', 2, 'triggered internal-note-link autocomplete'), walk9('B17_older_rows')],
      {'N': ['N_wikilink'], 'E': ['E_mention'], 'O': ['O_links']}, 'B17: typing [[ offered the target note.')
    R('G-034', 'NA', [code('app/src/widgets/registry.js', 267, 'journal: true'), walk9('B28_widget_insert')], {'N': NA, 'E': NA, 'O': NA},
      'UCT-unique (live market widgets in a note). B28 inserted a chart widget from the palette; its saved body carries it.')
    R('G-035', 'NV', [L('G-035', 'OPEN, DELIBERATELY'),
                      measure(PB, '398-399', 'typing per char', 'python tools/notebook_perf_harness.py --boot --sizes 1000,2000 --opens 20 --chars 60')],
      {'N': SPEED, 'E': SPEED, 'O': SPEED},
      'Open by owner ruling (the row\'s own status); typing is over 16 ms/char even at 1,000-2,000 paragraphs (§C).',
      'owner ruling on G-035 stands; the typing lever is unattributed (perf-budgets.md:401-405)')
    R('G-036', 'P', [code(f'{NB}/NoteEditorPage.jsx', 9, 'ALLOWED_ATTACHMENT_MIMES'), walk9('B29_pdf_upload_preview_search')],
      {'N': ['N_pdf'], 'E': ['E_searchimg'], 'O': ['O_attach']},
      'B29: a PDF uploaded through Attach a file became an attachment chip in the note.')
    R('G-036b', ('P', 'NV', 'P'), [code(f'{NB}/DocumentPreviewSheet.jsx', 23, 'the same fullscreen'),
                                  walk9('B29_pdf_upload_preview_search')],
      {'N': ['N_pdfembed'], 'E': EB, 'O': ['O_formats']},
      'B29: clicking the chip opened "Preview of <file>" with the page drawn on a canvas.')
    # Capture
    R('G-040', 'NA', [D(8, 'G-040: stays descoped')], {'N': NA, 'E': NA, 'O': NA},
      'Internal UCT capture coverage (widgets into the Notebook); descoped by the owner.')
    R('G-041', 'NV', [code(f'{NB}/CaptureDialog.jsx', 256, 'Your note')], {'N': NFN, 'E': EB, 'O': NFO},
      'The capture dialog was not driven, and no page fetched today states a capture-time comment. ' + UI_NOT)
    R('G-042', 'NA', [code(f'{JT}/note_trade_links.py', 68, 'def resolve_trade_ref(')], {'N': NA, 'E': NA, 'O': NA},
      'UCT-unique (trade references).')
    R('G-043', 'BO', [code('extension/manifest.json', 3, '"name": "UCT Browser Capture",'),
                      code('tools/package_extension.py', 1, 'Build the Chrome Web Store upload for UCT Browser Capture.'),
                      D(4, 'the web clipper (publish the extension already built, G-043)')],
      {'N': ['N_clipper'], 'E': ['E_clipper'], 'O': ['O_clipper']},
      'Built and packaged; the Chrome Web Store submission is the owner\'s (plan §5 item 4).', 'owner: store submission')
    R('G-044', 'BO', [code('app/public/manifest.json', 36, '"share_target": {'),
                      code('api/routers/notebook_personal_api.py', 16, 'NOTEBOOK_PERSONAL_API_ENABLED'),
                      flag('NOTEBOOK_PERSONAL_API_ENABLED', 'dark'), walk9('B18_dark_doors_answer_404'),
                      D(5, 'PWA + Apple Shortcuts over the personal API')],
      {'N': NFN, 'E': ['E_share_ext'], 'O': ['O_ios']},
      'Android share target in the manifest; the iOS Shortcuts path is built and dark (B18: its door answers 404).',
      'owner: arm NOTEBOOK_PERSONAL_API_ENABLED')
    R('G-045', 'NV', [code(f'{JT}/document_ocr_tesseract.py', 40, 'FLAG = "J2_OCR_ENABLED"'), flag('J2_OCR_ENABLED', 'armed'),
                      walk7('W14_image_ocr_document')],
      {'N': NFN, 'E': ['E_searchimg', 'E_scan'], 'O': NFO},
      'OCR of an uploaded scanned PDF was not driven on the scored tip (the wave-7 walk did, on 8f232d21d). ' + UI_NOT,
      'upload a scanned PDF and search its text in a browser pass')
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
    R('G-060', 'NA', [code(f'{JT}/db.py', 892, 'j2_fact_observations')], {'N': NA, 'E': NA, 'O': NA}, 'UCT-unique.')
    R('G-061', 'NA', [code(f'{LB}/widgetEmbedCore.js', 309, 'export function resolveEmbedRender(attrs)')], {'N': NA, 'E': NA, 'O': NA},
      'UCT-unique (plan §1: frozen as of insertion).')
    R('G-062', 'BO', [code(f'{JT}/fact_registry.py', 52, '"analyst_price_target_consensus": FactTypeDef('),
                      code(f'{JT}/fact_registry.py', 32, 'rights_class: RightsClass'),
                      record('docs/notebook/share-publish-flip-packet.md', 35, "1.3 The owner's answers")],
      {'N': NA, 'E': NA, 'O': NA}, 'Legal sign-off on estimates rights stays with the owner (plan §5 item 3).',
      'owner: legal sign-off')
    R('G-063', 'NA', [code(f'{LB}/widgetEmbedCore.js', 7, 'asOfDayOf')], {'N': NA, 'E': NA, 'O': NA}, 'A UCT correctness bug row.')
    R('G-064', 'NA', [code(f'{LB}/askInsert.js', 13, "export const ASK_INSERT_TYPE = 'askInsert'"),
                      flag('NOTEBOOK_ASK_INSERT_ON', 'armed')], {'N': NA, 'E': NA, 'O': NA},
      'UCT-unique (provenance-labelled objects). The insert needs an Ask answer, which needs a model key: not driven.')
    # Trading journal / thesis
    R('G-070', 'NA', [code(f'{NB}/LinkedNotesPanel.jsx', 13, 'export default function LinkedNotesPanel')], {'N': NA, 'E': NA, 'O': NA},
      'UCT-unique (notes linked to trades).')
    R('G-071', 'NA', [ruling(LEDGER, ledger_line('G-071'), 'replaced by G-070', 'ledger')], {'N': NA, 'E': NA, 'O': NA},
      'A rejected design, replaced by G-070.')
    R('G-072', 'NA', [code('api/services/journal_two/note_properties.py', 62, 'builtin:thesis_status')], {'N': NA, 'E': NA, 'O': NA},
      'UCT-unique built-in thesis fields; generic properties are compared under G-021.')
    R('G-073', 'NA', [code('api/services/journal_two/thesis_changelog.py', 251, 'def get_thesis_changelog(')], {'N': NA, 'E': NA, 'O': NA}, 'UCT-unique.')
    R('G-073b', 'NA', [code('api/services/journal_two/thesis_changelog.py', 215, 'def _verdict_events(')], {'N': NA, 'E': NA, 'O': NA}, 'UCT-unique.')
    R('G-074', 'NA', [code('api/services/awareness/rules.py', 127, 'def rule_thesis_stop_review(')], {'N': NA, 'E': NA, 'O': NA},
      'UCT-unique (plan §1: thesis-invalidation alerts).')
    R('G-075', 'NA', [code(f'{NB}/TickerResearchWorkspace.jsx', 62, 'export default function TickerResearchWorkspace'),
                      walk9('B17_older_rows'), walk9('B30_live_research_tab')], {'N': NA, 'E': NA, 'O': NA},
      'UCT-unique; B17 opened /journal/notebook/research/NVDA and B30 the same workspace on /research/NVDA.')
    # Collaboration / offline / mobile / extensibility
    R('G-080', ('P', 'NV', 'P'), [code(f'{JT}/note_shares.py', 64, 'def enabled() -> bool:'), flag('J2_SHARE_LINKS_ENABLED', 'armed'),
                                 record('docs/notebook/share-links-authorization-proof.md', 1, 'the authorization proof'),
                                 walk9('B13_share_publish_export'), walk8('W2_share_links')],
      {'N': ['N_share'], 'E': EB, 'O': ['O_publish']},
      'B13: a link minted in the share sheet; a signed-out stranger read the note through it.')
    R('G-081', 'D4', [D(4, 'OUT:** real-time multiplayer, comments, team workspaces (G-081)')],
      {'N': ['N_collab', 'N_comments'], 'E': EB, 'O': ['O_collab']}, 'Recorded scope, not an oversight.')
    R('G-082', 'P', [code(f'{LB}/offline/offlineFlag.js', 68, 'export const OFFLINE_DEFAULT_ON = true'),
                     record('docs/notebook/evidence/q1-gate/DECISION-2026-09-23-keep-offline.md', 1, 'KEEP offline editing ON'),
                     walk9('B16_offline_open_tab')],
      {'N': ['N_offline'], 'E': ['E_offline'], 'O': ['O_offline']},
      'PARITY is editing offline in an open tab (B16). A cold start offline is OUT by D6 and scored under G-163.')
    R('G-083', 'P', [code(f'{NB}/NoteEditorPage.jsx', 40, 'OFFLINE_VIEWING_BANNER'), walk9('B16_offline_open_tab')],
      {'N': ['N_offline'], 'E': ['E_offline_plan'], 'O': ['O_offline']},
      'B16: offline, a second note rendered from its saved copy with the banner "Viewing an earlier saved copy".')
    R('G-084', 'BO', [L('G-084', 'DUPLICATE of G-044 — tracked there')], {'N': NFN, 'E': ['E_share_ext'], 'O': ['O_ios']},
      'DUPLICATE of G-044 by controller ruling (the ledger counts it in its own DUPLICATE bucket); scored under '
      'G-044, mirrored here.', 'as G-044')
    R('G-085', 'BO', [code('api/routers/notebook_personal_api.py', 16, 'NOTEBOOK_PERSONAL_API_ENABLED'),
                      flag('NOTEBOOK_PERSONAL_API_ENABLED', 'dark'), walk9('B18_dark_doors_answer_404'), walk7('W15_personal_api')],
      {'N': ['N_api'], 'E': ['E_mcp'], 'O': ['O_uri']},
      'Built and documented (docs/notebook/personal-api.md), dark: B18 found its door answering 404.',
      'owner: arm NOTEBOOK_PERSONAL_API_ENABLED')
    R('G-086', 'D4', [D(4, 'a plugin marketplace (G-086)')], {'N': NFN, 'E': EB, 'O': ['O_plugins']},
      'Recorded scope, not an oversight.')
    # Portability / export
    R('G-090', 'P', [code(f'{JT}/notes_export.py', 2157, 'def build_export_zip('),
                     test_vt('app/src/pages/journal-2-0/lib/importer/exportFormats.roundtrip.test.js'), walk9('B09_list_views_bulk')],
      {'N': ['N_export'], 'E': ['E_emailin'], 'O': ['O_local']},
      'B09: the bulk export panel offers Markdown, web page, JSON and Word.')
    R('G-091', 'P', [code(f'{JT}/notes_export.py', 2392, 'def build_single_note_export('), walk9('B13_share_publish_export')],
      {'N': ['N_export'], 'E': ['E_pdfexport'], 'O': ['O_local']}, 'B13: the note\'s Export menu has four items.')
    R('G-092', 'NA', [code(f'{JT}/notes_export.py', 1351, 'linked_trades')], {'N': NA, 'E': NA, 'O': NA}, 'UCT-unique.')
    R('G-093', 'NA', [L('G-093', 'DONE (as scoped)')], {'N': NA, 'E': NA, 'O': NA},
      'Read-only connectors by design; the two-way-sync clause of standard #11 is scored in §B, not here.')
    R('G-094', 'NA', [code(f'{JT}/note_connectors/engine.py', 51, 'sync-conflict')], {'N': NA, 'E': NA, 'O': NA},
      'An internal robustness row.')
    # UX/UI rows (2026-09-06)
    R('G-100', 'NA', [code('app/src/pages/journal-2-0/rawErrorSurface.test.js', 41, 'const IN_SCOPE = [ROOT]'),
                      test_vt('app/src/pages/journal-2-0/rawErrorSurface.test.js')], {'N': NA, 'E': NA, 'O': NA}, 'A UCT defect row.')
    R('G-101', 'NA', [code(f'{NB}/NoteEditorPage.jsx', 2994, "Couldn't load this note."), walk9('B17_older_rows')],
      {'N': NA, 'E': NA, 'O': NA}, 'A UCT defect row; B17 read the error state for a bogus id.')
    R('G-102', ('P', 'NV', 'P'), [code('app/src/components/CommandPalette.jsx', 6, 'useJ2Favorites'), walk9('B08_quick_switcher')],
      {'N': ['N_switch'], 'E': EB, 'O': ['O_switch']}, 'B08: the app-wide palette opened the oldest note by title.')
    R('G-103', 'NA', [code(f'{NB}/NoteEditorPage.jsx', 24, 'import ConfirmModal'), walk9('B20_more_older_rows')],
      {'N': NA, 'E': NA, 'O': NA}, 'A UCT defect row; B20 read the "Delete this note?" dialog.')
    R('G-104', 'NA', [code('app/src/pages/journal-2-0/a11y/notebookContrast.test.js', 58, 'G-104: zero remain'),
                      test_vt('app/src/pages/journal-2-0/a11y/notebookContrast.test.js')], {'N': NA, 'E': NA, 'O': NA},
      'A UCT convention row.')
    R('G-105', 'NA', [code(f'{NB}/AskPanel.jsx', 321, 'aria-label="Close Ask"'), walk9('B20_more_older_rows')],
      {'N': NA, 'E': NA, 'O': NA}, 'A UCT convention row; B20 found the close control is an svg icon.')
    R('G-106', 'NA', [code('app/src/pages/journal-2-0/tabs/NotebookTab.jsx', 31, 'SkeletonLine')], {'N': NA, 'E': NA, 'O': NA},
      'A UCT convention row.')
    R('G-128', 'NA', [test_vt('app/src/pages/journal-2-0/rawErrorSurface.test.js')], {'N': NA, 'E': NA, 'O': NA}, 'A UCT defect row.')
    # Continuation / organization (Wave H)
    R('G-110', ('P', 'NV', 'NV'), [code(f'{NB}/ResearchHome.jsx', 300, 'Continue working'), walk9('B17_older_rows')],
      {'N': ['N_favorites'], 'E': EB, 'O': NFO}, 'B17: the research home shows Continue working.')
    R('G-111', 'NA', [code(f'{JT}/ticker_research.py', 200, 'def get_ticker_research_summary(')], {'N': NA, 'E': NA, 'O': NA},
      'UCT-unique (plan §1: research assembled per security).')
    R('G-112', 'NA', [code('app/src/pages/research/ResearchPage.jsx', 23, 'import TickerResearchWorkspace'), walk9('B17_older_rows'),
                      walk9('B30_live_research_tab')],
      {'N': NA, 'E': NA, 'O': NA}, 'UCT-unique; reachable from the notebook (B17) and from the live research page\'s My Research tab (B30).')
    # Documents (Waves I, J)
    R('G-113', 'NV', [code(f'{JT}/db.py', 1140, 'j2_note_document_pages_fts'), walk9('B29_pdf_upload_preview_search')],
      {'N': NFN, 'E': ['E_searchimg'], 'O': NFO},
      'B29: a word inside the uploaded PDF was found by the sidebar search, in its own "1 DOCUMENT PAGE" section naming '
      'the file and p.1. Evernote searches inside documents too, but whether its results are page-aware and sectioned is '
      'not evidenced by the fetched text, so no verdict.')
    R('G-114', 'NA', [code(f'{JT}/ticker_research.py', 140, 'def _documents_for_symbols(')], {'N': NA, 'E': NA, 'O': NA}, 'UCT-unique.')
    R('G-115', 'NA', [code(f'{JT}/db.py', 1040, 'j2_note_documents')], {'N': NA, 'E': NA, 'O': NA}, 'An internal model row.')
    R('G-116', 'NA', [code(f'{JT}/db.py', 1189, 'j2_note_excerpts')], {'N': NA, 'E': NA, 'O': NA},
      'UCT-unique (plan §1: citable, page-anchored passages). Not driven in 9B\'s browser check.')
    R('G-117', 'NA', [code(f'{JT}/db.py', 1178, 'quote_prefix')], {'N': NA, 'E': NA, 'O': NA}, 'UCT-unique.')
    R('G-118', 'NA', [code(f'{LB}/openCitation.js', 34, 'PASSAGE_GONE')], {'N': NA, 'E': NA, 'O': NA}, 'UCT-unique.')
    R('G-119', 'NA', [code(f'{JT}/db.py', 1252, 'j2_note_excerpts_fts')], {'N': NA, 'E': NA, 'O': NA}, 'UCT-unique.')
    R('G-120', 'NA', [code(f'{JT}/thesis_evidence.py', 7, 'SUPPORTS/OPPOSES')], {'N': NA, 'E': NA, 'O': NA}, 'UCT-unique.')
    R('G-121', 'NV', [code(f'{JT}/document_ocr_tesseract.py', 40, 'FLAG = "J2_OCR_ENABLED"'), flag('J2_OCR_ENABLED', 'armed'),
                      walk7('W14_image_ocr_document')], {'N': NFN, 'E': ['E_searchimg'], 'O': NFO},
      'As G-045. ' + UI_NOT)
    # Ask (Wave K)
    R('G-122', ('P', 'NV', 'NV'), [code(f'{JT}/ask_service.py', 54, '"This note"'), test_py('tests/test_ask_security.py'),
                                  walk9('B31_ask_scope_label')],
      {'N': ['N_scope'], 'E': EB, 'O': NFO},
      'B31: the Ask panel states its scope as text ("Asking: This note") before any question; Notion documents an explicit '
      'source chooser.')
    R('G-123', 'NV', [code(f'{LB}/askCitation.js', 35, "VALID_EXACT = 'valid_exact'"),
                      test_vt('app/src/pages/journal-2-0/lib/askCitation.parity.test.js')],
      {'N': ['N_cite'], 'E': EB, 'O': NFO},
      'Both cite sources; that UCT\'s citation is a verified location and Notion\'s is page-level is not evidenced by the '
      'fetched text, so no AHEAD.')
    R('G-124', 'NV', [code(f'{JT}/ask_ranking.py', 212, 'def answer_evidence('), test_py('tests/test_ask_evidence.py')],
      {'N': NFN, 'E': EB, 'O': NFO}, 'Refusal is railed; no competitor page fetched today states refusal behaviour.')
    R('G-125', 'NV', [code(f'{JT}/ask_prompt.py', 167, 'def system_prompt() -> str:'), test_py('tests/test_ask_prompt_injection.py')],
      {'N': NFN, 'E': EB, 'O': NFO}, 'Railed on the UCT side; an absence cannot be cited, so no AHEAD.')
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
    R('G-130', ('P', 'NV', 'P'), [code(f'{LB}/mathNodes.js', 2, 'math in a note'), walk9('B02_code_math_callout')],
      {'N': ['N_math'], 'E': EB, 'O': ['O_math']})
    R('G-131', ('P', 'NV', 'NV'), [code(f'{NB}/TextColorMenu.jsx', 25, "TEXT_COLOR_MENU_LABEL = 'Text color and highlight'"),
                                  walk9('B05_typing_features')],
      {'N': ['N_color'], 'E': EB, 'O': ['O_highlight']},
      'Obsidian\'s fetched syntax page evidences highlights, not text colour, so no Obsidian verdict.')
    R('G-132', 'P', [code(f'{LB}/calloutNode.js', 37, "a callout's STYLE"), walk9('B02_code_math_callout')],
      {'N': ['N_callout'], 'E': ['E_editmode'], 'O': ['O_callout']})
    R('G-133', ('P', 'NV', 'NV'), [code(f'{LB}/imageFigureNode.js', 20, 'Alignment'), walk9('B26_image_caption_align')],
      {'N': ['N_align', 'N_caption'], 'E': ['E_caption'], 'O': NFO},
      'B26: an uploaded image centred (data-align center) and captioned (a figcaption with the typed text). Evernote\'s '
      'fetched page evidences captions but not alignment, so no Evernote verdict.')
    R('G-134', ('P', 'NV', 'P'), [code(f'{NB}/TableToolbar.jsx', 71, "'addRowBefore', 'Row above'"),
                                 code(f'{LB}/tiptap.js', 114, 'resizable: false'), walk9('B03_table_toolbar')],
      {'N': ['N_tables'], 'E': ['E_editmode'], 'O': ['O_tables']},
      'B03: add/delete rows and columns and a header row; 0 resize handles, 0 sort controls. PARITY is against '
      'Notion\'s simple table (which its page says has no sorts) and Obsidian\'s row/column editing; resize and '
      'sort are misses in §C.', 'resize + sort (unbuilt)')
    R('G-135', ('P', 'NV', 'NV'), [code(f'{LB}/blockHandle.js', 6, 'a drag handle'), walk9('B04_drag_outline_stats')],
      {'N': ['N_drag'], 'E': EB, 'O': NFO})
    R('G-136', 'P', [code(f'{LB}/tableOfContentsNode.js', 94, "name: 'tableOfContents',"),
                     code(f'{NB}/NoteOutline.jsx', 34, "OUTLINE_LABEL = 'Outline'"), walk9('B04_drag_outline_stats')],
      {'N': ['N_toc'], 'E': ['E_toc'], 'O': ['O_outline']})
    R('G-137', ('P', 'NV', 'P'), [code(f'{LB}/noteStats.js', 12, 'READING TIME'), walk9('B04_drag_outline_stats')],
      {'N': ['N_wordcount'], 'E': EB, 'O': ['O_wordcount']},
      'Reading time is UCT\'s addition; not claimed as AHEAD (an absence cannot be cited).')
    R('G-138', ('NV', 'P', 'NV'), [code(f'{NB}/NoteFindBar.jsx', 8, 'Replace all'), walk9('B05_typing_features')],
      {'N': NFN, 'E': ['E_find'], 'O': NFO}, 'B05: Replace all turned every "alpha" into "gamma".')
    R('G-139', ('P', 'NV', 'NV'), [code(f'{NB}/EmojiMenu.jsx', 2, 'the emoji picker'), walk9('B05_typing_features')],
      {'N': ['N_emoji'], 'E': EB, 'O': NFO})
    R('G-140', ('P', 'P', 'NV'), [code(f'{LB}/dateMentionNode.js', 5, '@date mentions'), walk9('B05_typing_features')],
      {'N': ['N_date'], 'E': ['E_date'], 'O': NFO})
    R('G-141', ('P', 'NV', 'P'), [code(f'{LB}/webLinkNodes.js', 76, "name: 'linkPreview',"),
                                 code(f'{LB}/webEmbeds.js', 12, 'The allowlist'), walk9('B06_link_paste')],
      {'N': ['N_embed', 'N_preview'], 'E': EB, 'O': ['O_embedweb']},
      'B06 is a dispatched paste event (an engine test of the paste path, not a real clipboard).')
    R('G-142', ('P', 'NV', 'NV'), [code(f'{LB}/columnsNode.js', 6, 'side-by-side columns'), walk9('B05_typing_features')],
      {'N': ['N_columns'], 'E': EB, 'O': NFO})
    R('G-143', ('A', 'NV', 'P'), [code(f'{NB}/SlashMenu.jsx', 54, "title: 'Heading 6',"), walk9('B01_slash_menu')],
      {'N': ['N_headings'], 'E': EB, 'O': ['O_headings']},
      'Notion\'s own page documents three heading levels; UCT offers six (B01). Obsidian offers six.')
    R('G-144', 'NV', [code(f'{NB}/NoteFindBar.jsx', 152, 'editor.commands.undo()'), walk9('B07_touch_no_undo')],
      {'N': NFN, 'E': EB, 'O': NFO},
      'B07: at 390 px touch no undo or redo control exists among the page\'s buttons — a UCT miss whatever the '
      'competitors do (§C); no competitor page fetched today documents a touch undo.', 'build a touch undo/redo control')
    R('G-145', ('P', 'NV', 'P'), [code(f'{LB}/noteSwitcher.js', 2, 'find ANY note'), walk9('B08_quick_switcher')],
      {'N': ['N_switch'], 'E': EB, 'O': ['O_switch']}, 'B08: the switcher opened the OLDEST note by title.')
    R('G-146', 'NV', [code(f'{NB}/BulkActionBar.jsx', 47, 'EXPORT OFFERS EVERY FORMAT'), walk9('B09_list_views_bulk')],
      {'N': NFN, 'E': EB, 'O': NFO},
      'B09: two notes selected, the bulk export offered four formats. No competitor page fetched today documents multi-select.')
    R('G-147', ('NV', 'NV', 'P'), [code(f'{LB}/tagTree.js', 2, 'Nested tags'), walk9('B09_list_views_bulk')],
      {'N': NFN, 'E': EB, 'O': ['O_tags']}, 'B09: #inbox expanded to #to-read in the sidebar.')
    R('G-148', ('NV', 'NV', 'P'), [code(f'{NB}/UnlinkedMentions.jsx', 8, 'Unlinked mentions'), walk9('B10_unlinked_mentions')],
      {'N': NFN, 'E': EB, 'O': ['O_unlinked']})
    R('G-149', ('P', 'NV', 'NV'), [code(f'{NB}/NoteTimelineView.jsx', 2, 'the Timeline view'), walk9('B09_list_views_bulk')],
      {'N': ['N_timeline'], 'E': EB, 'O': NFO})
    R('G-150', ('P', 'NV', 'NV'), [code(f'{LB}/noteArchive.js', 2, 'archive and unarchive ONE note'), walk9('B11_organise')],
      {'N': ['N_archive'], 'E': EB, 'O': NFO}, 'B11: an archived note left the default list.')
    R('G-151', 'NV', [code(f'{LB}/lockedNote.js', 6, 'A lock prevents ACCIDENTAL'), walk9('B11_organise')],
      {'N': NFN, 'E': EB, 'O': NFO}, 'B11: a locked note\'s editor is not editable; no competitor page fetched today states a lock.')
    R('G-152', ('NV', 'NV', 'P'), [code(f'{LB}/splitView.js', 2, 'split view'), walk9('B12_split_view')],
      {'N': NFN, 'E': EB, 'O': ['O_tabs']}, 'B12: two editors mounted side by side.')
    R('G-153', 'NV', [code(f'{JT}/note_tasks.py', 414, 'def run_task_reminders('), test_py('tests/test_note_tasks.py'),
                      walk7('W11_reminders')],
      {'N': ['N_remind'], 'E': ['E_tasks'], 'O': NFO},
      'A reminder has never been observed arriving (wave-6 and wave-7 walks INCONCLUSIVE). ' + UI_NOT,
      'observe one reminder end to end')
    R('G-154', ('P', 'P', 'NV'), [code(f'{NB}/NoteTasksView.jsx', 9, 'Tasks across notes'), walk9('B09_list_views_bulk')],
      {'N': ['N_tasks'], 'E': ['E_taskview'], 'O': NFO})
    R('G-155', 'P', [code(f'{LB}/memberTemplates.js', 2, "the member's OWN templates"), walk9('B11_organise')],
      {'N': ['N_dbtemplate'], 'E': ['E_templates'], 'O': ['O_templates']}, 'B11: "Save as template" on the note.')
    R('G-156', ('NV', 'NV', 'P'), [code(f'{LB}/dailyNote.js', 2, "the member's daily note"), walk9('B11_organise')],
      {'N': NFN, 'E': EB, 'O': ['O_daily']}, 'B11: Today opened a note.')
    R('G-157', 'D10', [D(10, 'folders + links + backlinks')], {'N': ['N_subpage'], 'E': EB, 'O': NFO},
      'Recorded scope, not an oversight.')
    R('G-158', ('P', 'NV', 'NV'), [code(f'{NB}/RelationPropertyValue.jsx', 33, 'export default function RelationPropertyValue'),
                                  walk9('B27_relation_property')], {'N': ['N_relation'], 'E': EB, 'O': ['O_props']},
      'B27: a Relation property created and linked; the target note shows the source. Obsidian\'s properties page lists '
      'links among property values but does not describe a relation with a backlink, so no Obsidian verdict. Rollups '
      'and formulas are OUT (D12).')
    R('G-159', 'BO', [code(f'{NB}/NoteEditorPage.jsx', 3428, 'Scan a document with the camera'),
                      flag('NOTEBOOK_IMAGE_DOCX_DOCUMENTS_ENABLED', 'dark'), walk9('B07_touch_no_undo')],
      {'N': NFN, 'E': ['E_scan'], 'O': NFO},
      'B07: the Scan control is there at 390 px; the OCR that makes a scan searchable is dark.',
      'owner: arm NOTEBOOK_IMAGE_DOCX_DOCUMENTS_ENABLED')
    R('G-160', 'BO', [code(f'{JT}/document_extraction.py', 55, 'IMAGE_DOCX_GATE = "NOTEBOOK_IMAGE_DOCX_DOCUMENTS_ENABLED"'),
                      flag('NOTEBOOK_IMAGE_DOCX_DOCUMENTS_ENABLED', 'dark'), walk7('W14_image_ocr_document')],
      {'N': ['N_importdocx'], 'E': ['E_searchimg'], 'O': NFO},
      'Image OCR and docx text are built and dark; xlsx is not built (§C).', 'owner: arm the gate; xlsx unbuilt')
    R('G-161', 'BO', [code(f'{JT}/inbound_email.py', 12, 'NOTEBOOK_INBOUND_EMAIL_ENABLED'), flag('NOTEBOOK_INBOUND_EMAIL_ENABLED', 'dark'),
                      walk9('B18_dark_doors_answer_404'), D(13, 'provider-agnostic inbound webhook')],
      {'N': NFN, 'E': ['E_emailin'], 'O': NFO}, 'Built and dark; activation (DNS + inbound provider) is the owner\'s (D13).',
      'owner: DNS + inbound provider, then the gate')
    R('G-162', 'NV', [code(f'{LB}/dictationInsert.js', 2, 'dictated words go into the note at the caret'),
                      walk9('B01_slash_menu'), walk9('B07_touch_no_undo')],
      {'N': NFN, 'E': ['E_dictation'], 'O': NFO},
      'B01 offers Dictate and B07 found the mic; a transcription needs a model key, so none was observed. ' + UI_NOT,
      'a browser pass with a model key')
    R('G-163', 'D6', [D(6, 'Cold-start offline is out of scope')], {'N': ['N_offline'], 'E': ['E_offline'], 'O': ['O_offline']},
      'Recorded scope: the rollback story relies on no service worker (D6).')
    R('G-164', 'BO', [L('G-164', 'BLOCKED'), record('CLAUDE.md', 1028, 'Automate and App Automate are NOT on this account')],
      {'N': NA, 'E': NA, 'O': NA}, 'A release process, not a product feature; no competitor claim is made.',
      'owner: a device run per release (BrowserStack Live by hand, or Automate bought)')
    R('G-165', ('B', 'NV', 'NV'), [code(f'{JT}/writing_help.py', 48, 'ACTIONS = (SUMMARIZE, REWRITE, CONTINUE, TRANSLATE)'),
                                  flag('NOTEBOOK_WRITING_HELP_ENABLED', 'armed'), walk9('B15_writing_help'),
                                  test_vt('app/src/pages/journal-2-0/lib/writingHelp.test.js')],
      {'N': ['N_aiwrite', 'N_autofill'], 'E': ['E_aiedit'], 'O': NFO},
      'B15: Summarize, Rewrite, Continue and Translate are offered and Autofill is not; Notion documents Autofill, '
      'so BEHIND. The AI output itself was not observed (no model key), so no PARITY against Evernote.',
      'build autofill; a browser pass with a model key')
    R('G-166', 'BO', [code(f'{JT}/ask_retrieval.py', 456, 'def _document_pages('), flag('NOTEBOOK_IMAGE_DOCX_DOCUMENTS_ENABLED', 'dark')],
      {'N': NFN, 'E': ['E_searchimg'], 'O': NFO}, 'Built; image and docx documents become searchable only behind the dark gate.',
      'owner: arm NOTEBOOK_IMAGE_DOCX_DOCUMENTS_ENABLED')
    R('G-167', ('P', 'NV', 'P'), [code(f'{JT}/note_publish.py', 76, 'flag_on("NOTEBOOK_PUBLISH_ENABLED", False)'),
                                 flag('NOTEBOOK_PUBLISH_ENABLED', 'armed'), walk9('B13_share_publish_export'), walk8('W3_publish')],
      {'N': ['N_publish'], 'E': EB, 'O': ['O_publish']},
      'B13: published from the share sheet; a signed-out stranger read the published page.')
    R('G-168', 'NV', [code('.github/workflows/notebook-a11y.yml', 1, 'promotion-gate: no'), code('app/package.json', 79, '"axe-core": "4.13.0",'),
                      walk9('B19_axe_editor_and_list'), test_vt('app/src/pages/journal-2-0/a11y/axeHarness.contract.test.js')],
      {'N': NFN, 'E': EB, 'O': NFO},
      'B19: axe 4.13.0 whole page, WCAG 2.0-2.2 A/AA, no rule excluded: 0 violations on the editor and the list. The '
      'screen-reader passes are the owner\'s; no competitor accessibility page was fetched.',
      'second review (a11y-second-review-brief.md) + owner screen-reader passes')
    R('G-169', ('P', 'P', 'NV'), [code(f'{JT}/notes_export_formats.py', 1, 'a web page (HTML), lossless JSON and Word (.docx)'),
                                 test_py('tests/test_notes_export_formats.py'), walk9('B13_share_publish_export')],
      {'N': ['N_exportfmt'], 'E': ['E_emailin'], 'O': NFO},
      'PDF is the browser\'s Print (the row records it).')
    R('G-170', 'NA', [code('app/src/lib/errorBeacon.js', 856, 'export function installErrorBeacon()'),
                      code('app/src/main.jsx', 10, 'installErrorBeacon()'), code('api/routers/journal_two.py', 121, '"note_open_ms"'),
                      test_vt('app/src/lib/errorBeacon.test.js')], {'N': NA, 'E': NA, 'O': NA},
      'An operability row; standard #15 scores it.')
    R('G-171', ('P', 'NV', 'NV'), [code('app/src/pages/journal-2-0/components/notebook/onboarding/sampleNotebook.js', 1, 'The sample notebook'),
                                  flag('NOTEBOOK_ONBOARDING_ENABLED', 'armed'), walk9('B14_onboarding_help')],
      {'N': ['N_onboard'], 'E': EB, 'O': NFO},
      'B14: a fresh member got the "Welcome to your Notebook" tour and a sample-notebook offer; Notion documents '
      'onboarding that adds starter templates.')
    R('G-172', ('P', 'NV', 'P'), [code('app/src/pages/Support.jsx', 421, "id: 'notebook-getting-started',"), walk9('B14_onboarding_help')],
      {'N': ['N_help'], 'E': EB, 'O': ['O_help']},
      'Every Notion and Obsidian page cited here is itself a help article; Evernote\'s help centre refused every fetch.')

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
    C = {}  # n -> list of (clause, verdict, evidence, lever)
    C[1] = [
        ('every weekly feature exists for members', 'NOT MET',
         [walk9('B07_touch_no_undo'), walk9('B03_table_toolbar'), walk9('B15_writing_help'), walk9('B18_dark_doors_answer_404')],
         'G-144 (no touch undo), G-134 (no resize/sort), G-165 (no autofill), G-160 (xlsx unbuilt); dark gates G-017/G-127, '
         'G-044/G-085, G-159/G-160/G-166, G-161; G-043 awaits the store'),
        ('or is a recorded, deliberate "no" with a reason', 'NOT MET',
         [L('G-144', 'OPEN'), L('G-134', 'PARTIAL')],
         'G-144, G-134\'s resize/sort, G-165\'s autofill and G-160\'s xlsx carry no ruling; the recorded no\'s are G-081/G-086 '
         '(D4), G-157 (D10), G-163 (D6)'),
        ('the list is what Notion/Evernote/Obsidian users actually reach for weekly', 'NOT MEASURED — OWNER',
         [record('docs/notebook/user-study-kit.md', 1, 'the kit (Phase 7, standard #5)')],
         f'the inventory (§B1) is the plan\'s list, not a census of competitor users; the user study ({USK}) is the owner\'s'),
    ]
    C[2] = [
        ('every shipped feature does what it says on every path', 'NOT MEASURED', [walk9('B19_axe_editor_and_list')],
         '9B drove 20 checks, not every path; the wave walks are per-wave, not a census'),
        ('with a rail', 'NOT MEASURED', [record('docs/notebook/gate-runs/wave8-landing/2026-09-26T13-16-51.md', 1, 'Gate run')], 'no feature-to-rail census exists'),
        ('no dead clicks', 'NOT MEASURED', [walk9('B20_more_older_rows')], 'no dead-click sweep exists; 9B saw 0 page errors in its checks'),
        ('no known data-loss path', 'NOT MEASURED', [record(PLAN, plan_line('| 2 | **Functionality**'), 'T-12 smoke')],
         'D3\'s two fixes landed in wave 5; the 409 during plain typing (T-12 step 3) has no recorded close'),
    ]
    C[3] = [
        ('zero data-loss incidents over a 30-day window with real members', 'NOT MEASURED — OWNER',
         [record('docs/notebook/soak-30day.md', 3, 'What it is not:** a result')], f'the soak ({SOAK}) is 9C\'s kit and the owner\'s run'),
        ('every kill switch and rollback rehearsed', 'NOT MEASURED — OWNER', [record('docs/notebook/soak-30day.md', 3, 'What it is not:** a result')],
         'no rehearsal record for every switch'),
        ('offline gate KEEP on evidence', 'NOT MEASURED',
         [record('docs/notebook/evidence/q1-gate/DECISION-2026-09-23-keep-offline.md', 7, 'What the gate said')],
         'the gate\'s last verdict is REVERT (2026-09-20); KEEP is ruling D2, not a gate verdict; the next Sunday gate with the '
         'URL-recording sampler is the measurement'),
    ]
    C[4] = [
        ('budgets set', 'MET', [code('docs/notebook/perf-budgets.json', 2, '"_": "Notebook performance budgets')], ''),
        ('enforced in CI', 'NOT MET', [code('.github/workflows/notebook-budgets.yml', 1, 'promotion-gate: no — ADVISORY')],
         'the CI job is advisory; the local 50k gate is the verdict'),
        ('note open p95 < 300 ms (1,000 paragraphs)', 'MET',
         [measure(PB, 396, '74.6 ms', 'python tools/notebook_perf_harness.py --boot --sizes 1000,2000 --opens 20 --chars 60')], ''),
        ('typing < 16 ms/char up to the size cap', 'NOT MET',
         [measure(PB, '398-399', '17.6 ms', 'python tools/notebook_perf_harness.py --boot --sizes 1000,2000 --opens 20 --chars 60'),
          L('G-035', 'OPEN, DELIBERATELY')],
         'over the line at 1,000 and 2,000 paragraphs on every reading (perf-budgets.md:421); G-035 at the cap by owner ruling'),
        ('search p95 < 100 ms at 50k notes', 'NOT MET',
         [measure(PB, '299-303', 'ops still above 100 ms p95 at 50k',
                  'python tools/notebook_scale_benchmark.py --tiers 50000 --thresholds docs/notebook/perf-budgets.json --budget search')],
         'levers named at perf-budgets.md:305-317 (note_rowid in the FTS map; a maintained task index)'),
        ('Notebook JS within a byte budget', 'MET',
         [measure(f'{EVD}/notebook_perf_budgets-bytes.log', 1, 'bytes.notebook_first_open',
                  'python tools/notebook_perf_budgets.py --dist app/dist (run by 9B)')], ''),
    ]
    C[5] = [
        ('a task-based test with 5-8 traders', 'NOT MEASURED — OWNER', [record('docs/notebook/user-study-kit.md', 1, 'the kit (Phase 7, standard #5)')], USK),
        ('every core task completed unaided', 'NOT MEASURED — OWNER', [record('docs/notebook/user-study-kit.md', 1, 'the kit (Phase 7, standard #5)')], USK),
        ('SUS >= 80', 'NOT MEASURED — OWNER', [record('docs/notebook/user-study-kit.md', 1, 'the kit (Phase 7, standard #5)')], USK),
        ('no silent failures', 'NOT MEASURED', [test_vt('app/src/pages/journal-2-0/rawErrorSurface.test.js')],
         'raw error text is railed; a silent-failure census does not exist'),
    ]
    C[6] = [
        ('a design review against the three competitors signs off each surface', 'NOT MEASURED',
         [record('docs/notebook/notebook-ux-ui-competitive-ledger.md', 3, 'interaction-sequence-level comparison')], 'no sign-off record'),
        ('consistent tokens', 'MET', [test_vt('app/src/pages/journal-2-0/a11y/notebookContrast.test.js'),
                                     code('app/src/pages/journal-2-0/a11y/notebookContrast.test.js', 58, 'G-104: zero remain')], ''),
        ('no layout regressions at 390/820/1200', 'NOT MEASURED', [walk9('B07_touch_no_undo')], '9B drove 390 px once; no 820/1200 sweep'),
    ]
    C[7] = [
        ('restore rehearsed end-to-end on a schedule', 'NOT MEASURED — OWNER',
         [code('tools/authdb_restore_drill.py', 1, 'prove the newest one can be restored'), D(15, 'restore-drill tool')], 'the drill runs with production credentials (D15)'),
        ('account deletion purges backups', 'NOT MET', [D(15, 'document the backup window')],
         'by ruling D15 the backup window is documented instead of rewriting snapshots'),
        ('round-trip export verified every release', 'MET',
         [test_vt('app/src/pages/journal-2-0/lib/importer/exportFormats.roundtrip.test.js')],
         'the round-trip rail is a vitest file, so every six-shard landing gate runs it'),
    ]
    C[8] = [
        ('vendor data terms verified in writing (zero retention)', 'NOT MET',
         [record('docs/notebook/VENDOR-TERMS-2026-09-23.md', 34, 'Published terms relied on, not a signed agreement')], 'owner/external: ZDR in writing'),
        ('share-link authorization proven', 'MET',
         [record('docs/notebook/share-links-authorization-proof.md', 1, 'the authorization proof'), walk9('B13_share_publish_export'),
          test_py('tests/test_public_note_payload.py')], ''),
        ('plaintext index risk reviewed', 'MET', [L('G-004', 'owner-accepted 2026-09-22')],
         'the owner accepted infrastructure encryption as the answer (G-004)'),
        ('a security review of Notebook routes', 'NOT MEASURED', [test_py('tests/test_ask_security.py')],
         'no route-by-route review record; Ask\'s routes are railed'),
    ]
    C[9] = [
        ('axe in CI', 'NOT MEASURED', [code('.github/workflows/notebook-a11y.yml', 1, 'promotion-gate: no')],
         'the workflow is advisory until seen red once and green once in CI; no CI run is recorded'),
        ('zero violations on Notebook surfaces', 'NOT MEASURED',
         [walk9('B19_axe_editor_and_list'), test_vt('app/src/pages/journal-2-0/a11y/axeHarness.contract.test.js')],
         '0 violations on the editor and the list in a real browser; the jsdom harness excludes color-contrast; graph, sheets and dialogs not run in a browser'),
        ('a full screen-reader pass (VoiceOver + NVDA)', 'NOT MEASURED — OWNER',
         [record('docs/notebook/screen-reader-pass.md', 4, 'nothing here has been run on a real screen reader yet')], 'owner; scripts in a11y-second-review-brief.md'),
        ('keyboard-complete (incl. graph)', 'NOT MEASURED', [test_vt('app/src/pages/journal-2-0/a11y/focusFlows.test.jsx')],
         'the second reviewer\'s keyboard walk (a11y-second-review-brief.md)'),
    ]
    C[10] = [
        ('iOS + Android capture parity', 'NOT MET', [flag('NOTEBOOK_PERSONAL_API_ENABLED', 'dark'), walk9('B18_dark_doors_answer_404')],
         'the iOS path is built and dark (G-044)'),
        ('cold-start offline', 'NOT MET', [D(6, 'Cold-start offline is out of scope')], 'recorded out by D6 (G-163)'),
        ('real-device matrix green every release', 'NOT MEASURED — OWNER', [L('G-164', 'BLOCKED')], 'G-164'),
    ]
    C[11] = [
        ('import from every major tool', 'NOT MEASURED', [code('app/src/pages/journal-2-0/lib/importer/registry.js', 16, 'export const ADAPTERS = [uctAdapter, evernoteAdapter, notionAdapter, obsidianAdapter, genericAdapter]')],
         'importers exist (Notion, Obsidian, Evernote, generic files); "every major tool" has no census'),
        ('export markdown/HTML/JSON/PDF/docx', 'MET', [walk9('B13_share_publish_export'), test_py('tests/test_notes_export_formats.py')],
         'PDF is the browser\'s Print'),
        ('two-way sync where offered', 'NOT MET', [L('G-093', 'DONE (as scoped)')], 'connectors are read-only by design'),
        ('a documented API', 'NOT MET', [flag('NOTEBOOK_PERSONAL_API_ENABLED', 'dark')], 'built and documented, dark (G-085)'),
    ]
    C[12] = [
        ('grounded, cited, refusing when unsupported', 'MET',
         [test_py('tests/test_ask_evidence.py'), test_py('tests/test_ask_prompt_injection.py'),
          test_vt('app/src/pages/journal-2-0/lib/askCitation.parity.test.js')], ''),
        ('writing help with provenance', 'NOT MEASURED',
         [walk9('B15_writing_help'), test_vt('app/src/pages/journal-2-0/lib/writingHelp.test.js')],
         'the panel is live and provenance is railed; no output observed in a browser (no model key); autofill absent (G-165)'),
        ('semantic retrieval', 'NOT MET', [flag('NOTEBOOK_SEMANTIC_SEARCH_ENABLED', 'dark')], 'dark until ZDR (G-127)'),
        ('all on verified vendor terms', 'NOT MET',
         [record('docs/notebook/VENDOR-TERMS-2026-09-23.md', 34, 'Published terms relied on, not a signed agreement')], 'owner/external'),
    ]
    C[13] = [
        ('keyword + meaning search', 'NOT MET', [flag('NOTEBOOK_SEMANTIC_SEARCH_ENABLED', 'dark')], 'meaning search dark (G-127)'),
        ('one ranked result list', 'NOT MET', [code(f'{JT}/db.py', 1140, 'j2_note_document_pages_fts')],
         'notes, document pages and excerpts are sectioned apart by design (G-113, G-119)'),
        ('measured recall on a labelled set', 'NOT MEASURED', [record(PLAN, plan_line('| 13 | **Search quality**'), 'measured recall on a labelled set')],
         'no labelled recall set for the search box'),
        ('p95 < 100 ms at 50k', 'NOT MET', [measure(PB, '299-303', 'ops still above 100 ms p95 at 50k',
                                                    'python tools/notebook_scale_benchmark.py --tiers 50000 --budget search')],
         'perf-budgets.md:305-317 levers'),
    ]
    C[14] = [
        ('50k notes: all budgets from #4 hold', 'NOT MET', [measure(PB, '299-303', 'ops still above 100 ms p95 at 50k',
                                                                 'python tools/notebook_scale_benchmark.py --tiers 50000')], 'as #4'),
        ('10k attachments', 'NOT MEASURED', [code('docs/notebook/perf-budgets.json', 16, '"tier": 50000')], 'no 10k-attachment tier exists'),
        ('size-cap notes', 'NOT MET', [L('G-035', 'OPEN, DELIBERATELY')], 'G-035, owner ruling'),
        ('no super-linear curve', 'NOT MEASURED', [measure(PB, '299-303', 'ops still above 100 ms p95 at 50k',
                                                           'python tools/notebook_scale_benchmark.py --tiers 50000')],
         'no curve fit across tiers is recorded'),
    ]
    C[15] = [
        ('client + server error reporting on', 'MET',
         [code('app/src/main.jsx', 10, 'installErrorBeacon()'), code('api/routers/client_errors.py', 51, '@router.post("/api/client-errors")'),
          test_vt('app/src/lib/errorBeacon.test.js')], 'the beacon is installed unconditionally (D14)'),
        ('Notebook telemetry for every core action', 'NOT MET', [code('api/routers/journal_two.py', 121, '"note_open_ms"')],
         'seven events; no export, import or save-success event'),
        ('canaries in the repo', 'NOT MET', [code('tools/window_check.py', 1, 'A DAILY MINI-CANARY')],
         'the canary source is in the repo, but the running copy differs from it (controller\'s dispatch plan, risk R3)'),
        ('SLOs with alerts', 'NOT MET', [code('.github/workflows/notebook-budgets.yml', 1, 'promotion-gate: no')],
         'no SLO or alert is defined for save success, Ask latency or search latency'),
    ]
    C[16] = [
        ('a new member reaches a first useful note in < 2 minutes unaided', 'NOT MEASURED — OWNER',
         [record('docs/notebook/user-study-kit.md', 1, 'the kit (Phase 7, standard #5)')], USK),
        ('help centre articles', 'MET', [code('app/src/pages/Support.jsx', 421, "id: 'notebook-getting-started',"), walk9('B14_onboarding_help')], ''),
        ('sample notebook', 'MET', [flag('NOTEBOOK_ONBOARDING_ENABLED', 'armed'), walk9('B14_onboarding_help')], ''),
        ('member templates', 'MET', [walk9('B11_organise')], ''),
    ]
    for n in range(1, 17):
        if n not in C:
            PROBLEMS.append(f'standard {n} has no clauses')

    # ═══ render ═══════════════════════════════════════════════════════════════════════════════════
    rc, head = git('rev-parse', '--short=9', 'HEAD')
    rc2, app_tree = git('rev-parse', 'HEAD:app')
    rc3, api_tree = git('rev-parse', 'HEAD:api')
    _, app_diff = git('diff', '--name-only', '8a0098029', 'HEAD', '--', 'app', 'api')


    def b0_rows():
        out = []
        paths = ['docs/notebook/gate-runs/wave5-landing/2026-09-25T21-07-34.md', 'docs/notebook/gate-runs/wave5-landing/2026-09-24T21-37-17.md',
                 'docs/notebook/gate-runs/wave5-landing/2026-09-25T20-10-16.md', 'docs/notebook/gate-runs/wave5/walk-f84cb5add.json',
                 'docs/notebook/gate-runs/wave5/walk-fe6d15926.json', 'docs/notebook/gate-runs/wave6-landing/2026-09-25T23-28-08.md',
                 'docs/notebook/gate-runs/wave6/walk-787a993f5.json', 'docs/notebook/gate-runs/wave7-landing/2026-09-26T02-50-58.md',
                 W7P, 'docs/notebook/gate-runs/wave8-landing/2026-09-26T13-16-51.md', W8P]
        for p in paths:
            r, _ = git('cat-file', '-e', f'HEAD:{p}')
            out.append((f'`{p}`', f'git cat-file -e HEAD:<path>', 'exists' if r == 0 else f'MISSING (rc {r})'))
            if r != 0:
                PROBLEMS.append(f'B0 path missing {p}')
        shas = ['145478ec1', '96051c043', 'e6f418194', '2dde8fed1', '9532e67ac', 'fccff2f63', '39a71dd3c',
                '2c3ed3093', '271a078b6', 'f883e0996', 'caf6d1b9e']
        for s in shas:
            r, _ = git('merge-base', '--is-ancestor', s, 'HEAD')
            out.append((s, 'git merge-base --is-ancestor <sha> HEAD', 'ancestor (rc 0)' if r == 0 else f'NOT an ancestor (rc {r})'))
            if r != 0:
                PROBLEMS.append(f'B0 sha not ancestor {s}')
        for t, want in (('notebook-wave5-tip-2026-09-24', '145478ec1'), ('notebook-wave6-tip-2026-09-26', '96051c043'),
                        ('notebook-wave7-tip-2026-09-26', 'e6f418194'), ('notebook-wave8-tip-2026-09-26', '2dde8fed1')):
            r, sha = git('rev-parse', '--short=9', f'{t}^{{commit}}')
            ok = r == 0 and sha.startswith(want)
            out.append((t, 'git rev-parse --short=9 <tag>^{commit}', f'{sha}' + ('' if ok else ' (MISMATCH)')))
            if not ok:
                PROBLEMS.append(f'B0 tag {t} -> {sha}')
        return out


    def esc(s):
        return s.replace('|', '/')


    out = []
    w = out.append
    w('# Notebook parity scorecard — every ledger row, the 16 standards, the honest misses')
    w('')
    w(f'**Date:** {DATE} (lane 9B, wave 9). **Product scored:** the trees of tip `8a0098029` — app tree '
      f'`8a870dd38f92781e53982baa04f2758acaf133ed`, api tree `d6838d6d65f243836096f962716db688bb878caa` — the tree the '
      f'browser check was built from (`{EVD}/built-trees.txt`). **Document written at:** `{head}` (app tree `{app_tree[:9]}`, '
      f'api tree `{api_tree[:9]}`); the product files are unchanged since `8a0098029` — `git diff --name-only 8a0098029 HEAD -- app api` '
      f'lists {len([x for x in app_diff.splitlines() if x])} file(s), all tests: '
      + (', '.join(f'`{x}`' for x in app_diff.splitlines() if x) or 'none') + '.')
    w('')
    w('**What this is, and what it is not.**')
    w('- The **gap ledger** (`docs/notebook/competitive-gap-ledger.md`) is the STATUS authority (ruling D-9B4). This scorecard '
      'COMPARES only: its "ledger row" column cites the row and never restates its status. Where the two disagree, the ledger wins '
      'and this file is the one that drifted.')
    w('- It **does not supersede** the gap ledger, the research log (`docs/notebook/competitive-research-ledger.md`, whose R12–R16 '
      'record every fetch behind this file), or the performance record (`docs/notebook/perf-budgets.md`).')
    w('- It **supersedes, as the current parity comparison, and leaves untouched**: `docs/notebook/primary-notebook-readiness-scorecard.md` '
      'and `docs/notebook/notebook-ux-ui-competitive-ledger.md`. Both are older comparisons; neither was edited.')
    w('- The plan\'s §1 "Now" numbers (`docs/notebook/NOTEBOOK-10-OF-10-PLAN.md`) are **estimates**, shown beside the clause count in §B, '
      'never averaged (ruling D-9B1).')
    w('- No competitor\'s speed is stated here (lane 9A\'s protocol, `docs/notebook/benchmark/protocol.md`, and the owner\'s run), and no '
      'user-study or soak result (9C\'s kits and the owner\'s runs).')
    w('')
    w('**Verdicts (closed set):** `AHEAD` · `PARITY` · `BEHIND` · `N/A` (no competitor equivalent, or a UCT-internal row) · '
      '`OUT-OF-SCOPE (D#)` · `BLOCKED (owner|external)` · `NOT-VERIFIED`. A verdict of AHEAD, PARITY or BEHIND needs BOTH sides '
      'evidenced: a UCT behaviour confirmed (a UI behaviour in 9B\'s browser check on the scored tip), and a competitor quote from a '
      'page fetched today. An absence on a competitor\'s page is never cited, so "AHEAD" appears only where the competitor\'s own page '
      'states the limit. A capability behind a dark gate is BLOCKED, never "available".')
    w('')
    w('**UCT evidence kinds:** `CODE path:line "fragment"` read at the HEAD above; `TEST file` + a run by 9B with its log and totals '
      'line; `WALK tool:check` + report + tip; `MEASURE doc:line` + the command; `RECORD doc:line` (production state, "per record, '
      'not re-read"); `RULING doc:line` for a deliberate no. **Competitor cells:** `N:` Notion · `E:` Evernote · `O:` Obsidian, each '
      'an official URL, a quoted sentence of at most 25 words from the page fetched, and the date — or `not verified` with the reason. '
      'Every quote was checked verbatim against the fetched text before this file was written (R16).')
    w('')
    w('## §0 — B0: the evidence index, verified at the HEAD above')
    w('')
    w('| item | command | result |')
    w('|---|---|---|')
    for a, b, c in b0_rows():
        w(f'| {a} | `{b}` | {c} |')
    w('')
    w('Every path exists and every SHA is an ancestor; wave 8\'s gate manifest and walk report are present, so no STOP.')
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
        for clause, verdict, ev, lever in cl:
            w(f'| {esc(clause)} | {verdict} | {" ; ".join(esc(e) for e in ev)} | {esc(lever) or "—"} |')
        w('')

    # ── §C ──
    w('## §C — what still misses, and what owns each miss')
    w('')
    w('### Standards: every clause not MET')
    w('')
    w('| standard | clause | verdict | lever / ruling / kit |')
    w('|---|---|---|---|')
    for s in STD:
        for clause, verdict, ev, lever in C[s['n']]:
            if verdict != 'MET':
                w(f'| {s["n"]}. {s["name"]} | {esc(clause)} | {verdict} | {esc(lever) or "—"} |')
    w('')
    w('Named performance levers (`docs/notebook/perf-budgets.md`:305-317): common-term relevance search — a `note_rowid` column on '
      '`j2_notes_fts_map` maintained by the FTS triggers, and the page total from the same ranked pass; `list_tasks` — a maintained '
      'task index; typing — unattributed (`docs/notebook/perf-budgets.md`:401-405, a browser profile per plugin is the next step); '
      'G-035 at the size cap stands by owner ruling (`docs/notebook/competitive-gap-ledger.md`:88).')
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
        w(f'| {i} | {m["public_url"]} | {RROW[m["vendor"]]} | {rf} | {m["fetched_utc"]} | {m["sha256"][:16]} | '
          f'{", ".join(d["keys"])} | {rows_u} |')
    w('')
    w('Failed fetches (logged, nothing cited): `https://help.evernote.com/hc/en-us/articles/208313748` — Cloudflare challenge '
      '("Just a moment..."), HTTP 403 to curl and to WebFetch (R15); `https://evernote.com/features/note-taking` — HTTP 404 (R14).')
    w('')


    text = '\n'.join(out) + '\n'
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
