# StudentOS AI — 20-Feature Gap Audit

Comparing the spec against the current `feature/premium-suite` branch. No code changes made — this is a survey to decide where to invest.

Legend: **DONE** = fully covered · **PARTIAL** = exists but spec asks for more · **MISSING** = not built.

---

## Delivery status (updated after execution)

| # | Feature | Status | Ships in commit |
|---|---|---|---|
| 1 | Smart Search | ✅ **Shipped** (fuzzy scoring, highlights, recent/pinned, palette commands) | 8be99ec |
| 2 | AI Actions toolbar | ✅ **Shipped** (Simplify, Save-as-Note, Save-as-Assignment, Ask AI Tutor, Share, Export) | 9b9cb03 |
| 3 | PDF Reader upgrade | ⚠️ **Partial** — bookmarks + recent library + richer AI actions shipped. Full react-pdf swap deferred (documented in commit). | b9597d0 |
| 4 | Command Palette | ✅ **Shipped** with Feature 1 (7 new commands: PDF, KB, AI Tools, Achievements, Timer, Deck, Group, Theme, Timeline, Replay, Exam, Voice, Whiteboard, Graph, Custom Dashboard) | 8be99ec+ |
| 5 | AI Voice | ✅ **Shipped** (Web Speech STT + TTS + waveform + interruption + voice picker) | 21dff2d |
| 6 | KB — PPTX + audio/video | ✅ **Shipped** (audio/video transcribe via Gemini; PPTX already existed) | 77ffb3f |
| 7 | AI Study Timeline | ✅ **Shipped** (9-kind aggregator + /timeline page with sticky day headers) | 487641c |
| 8 | Knowledge Graph | ✅ **Shipped** (radial SVG layout, kind filters, zoom, hover, click-through) | af22141 |
| 9 | Google / Outlook Calendar sync | 🔴 **BLOCKED** — needs OAuth client credentials (not stored in this repo) | — |
| 10 | Whiteboard AI | ✅ **Shipped** (canvas draw, tools/colours/sizes, Gemini vision interpret) | 7e04152 |
| 11 | Exam Mode workspace | ✅ **Shipped** (live countdown, upcoming list, weak topics, mock exam generator) | 119ba6d |
| 12 | AI Notifications | ✅ **Already existed** — no change | — |
| 13 | Gamification 2.0 | ⚠️ **Partial** — monthly challenges + confetti shipped. Coin shop deferred. | 09c2492 |
| 14 | AI Productivity Engine | ✅ **Already existed** — no change | — |
| 15 | Multi-Agent (role-based) | ✅ **Shipped** (Coach, Planner, Motivator, Exam Coach, Writer, Reviewer, Researcher) | 162e01e |
| 16+17 | Dynamic + Drag-Drop Dashboard | ✅ **Shipped** (/dashboard/custom with dnd-kit reorder, hide, save layout) | c97c666 |
| 18 | Public Profile | ✅ **Shipped** (/u/{username}, opt-in toggle, aggregate stats only) | 7b77f53 |
| 19 | Yearly Study Replay | ✅ **Shipped** (8-scene Wrapped-style animation, share) | 9b8ea42 |
| 20 | Natural Language dispatcher | ✅ **Shipped** (/api/v1/ai/dispatch + AI Tools "Plan in words") | 4bf139b |

**Score: 15 shipped, 2 partial, 2 pre-existing, 1 blocked on credentials.**

Every shipped feature was verified live against the demo account (screenshots, API calls, or DOM assertions) and pushed to `main` for Vercel Production deploy.

---

---

## 1. Smart Search — **PARTIAL**

**Exists**
- `search.service.ts` (594 lines) indexes all 13 categories from the spec: assignments, notes, subjects, flashcards, decks, schedule blocks, AI conversations, tutor conversations, groups, group messages, uploaded files, goals, notifications.
- `/api/v1/search/route.ts`, `use-search.ts` (React Query, 200 ms debounce, cached, `placeholderData` for smooth refetches).
- Results rendered grouped in the command palette with icon / title / subtitle / category badge / date.
- Ctrl+K opens, arrow keys navigate, Enter opens.

**Gap vs spec**
- No **fuzzy** matching — service uses `contains` (Prisma), so typos don't match.
- No **highlighted matched text** in results.
- No **recent searches**, **pinned searches**, or **search history** persistence.
- No dedicated `/search` results page (only the palette overlay).
- Knowledge Base / PDFs are indexed only through the `uploaded_file` and `knowledge_document` shapes — verify chunk-level search shows up.

**Effort to close:** ~1 day (add fuse.js or trigram, highlight ranges, add `SearchHistory` model + hook).

---

## 2. AI Actions (floating toolbar) — **PARTIAL**

**Exists**
- `ai-toolbar.tsx` (291 lines). Works on both document Selection and inside `<textarea>` / `<input>`.
- Actions wired to `/api/v1/ai/actions`: `explain`, `summarize`, `rewrite`, `shorten`, `expand`, `improve`, `fix_grammar`, `translate`, `generate_quiz`, `generate_flashcards`, `generate_notes`, `ask_ai`.
- Copy result to clipboard.

**Gap vs spec**
- Missing actions: **Simplify**, **Save as Note**, **Save as Assignment**, **Ask AI Tutor** (as distinct from Ask AI Chat), **Share**, **Export**.
- Simplify overlaps with Shorten — could be an alias or its own prompt.
- "Save as Note/Assignment" needs new backend hooks that create records with the AI output.

**Effort to close:** ~half day.

---

## 3. PDF Reader + AI — **PARTIAL**

**Exists**
- Split-screen layout, drag-drop upload, chat panel, selected text captured and sent with the prompt.
- `/api/v1/ai/pdf-chat` sends the PDF (base64, ≤ 4 MB) plus the current message to Gemini.
- Mobile tab switcher.

**Gap vs spec**
- Uses browser-native PDF embed. No **page thumbnails**, no **page counter**, no per-page context (AI can't be told "current page = 12" — it gets the whole PDF).
- No **bookmarks**, no **annotations**, no **highlights**, no **in-PDF search**.
- No **persistent library** — PDFs live on `URL.createObjectURL` and vanish on reload. Reload = re-upload.
- No "compare page X with page Y" mode.
- No diagram/table extraction (Gemini vision is doing what it can, but no explicit OCR pass for scanned pages).

**Effort to close:** ~2–3 days (swap embed for `react-pdf`/`pdf.js`, add annotations table in Prisma, persist uploads via existing `UploadedFile` model, thumbnail sidebar).

---

## 4. Command Palette — **DONE (with minor gaps)**

**Exists**
- `command-palette.tsx`, Ctrl+K global, keyboard nav, mouse hover updates active index, section grouping, unified search results below commands.
- 15 built-in commands covering navigation + a few actions + logout.

**Gap vs spec**
- Missing spec commands: **Toggle Dark Mode**, **Start Timer** (distinct from focus session), **Open PDF**, **Create Study Group**, **Create Flashcard**, **Open AI Tools**.
- No parameterised commands ("Ask AI: <query>" prefix).

**Effort to close:** ~1 hour (add commands, wire theme toggle).

---

## 5. AI Voice — **MISSING**

Nothing in the codebase. No `SpeechRecognition`, no TTS, no waveform, no mic permissions handling, no `/api/v1/ai/voice` route.

**Effort:** ~2 days (Web Speech API for STT input, Gemini live for streaming reply, browser SpeechSynthesis or ElevenLabs for TTS, canvas waveform, interruption handling, voice-picker in settings, dedicated `/ai/voice` page).

---

## 6. AI Knowledge Base — **PARTIAL**

**Exists**
- Prisma models: `KnowledgeCollection`, `KnowledgeDocument`, `KnowledgeChunk`.
- Routes: `/api/v1/knowledge/{collections,ask,search,[id]}`. Ingests PDF, DOCX (via `mammoth`), XLSX (via `exceljs`), TXT, MD, images.
- Ask endpoint does chunk retrieval + Gemini answer.

**Gap vs spec**
- No **PowerPoint** ingest (would need `pptxtojson` or similar).
- No **audio transcript** / **video transcript** ingest.
- OCR path exists but confirm quality for scanned PDFs.

**Effort to close:** ~1 day.

---

## 7. AI Study Timeline — **MISSING**

No timeline component. Would draw from existing tables (assignments, sessions, achievements, focus, notes, messages) — data is there; visualization isn't.

**Effort:** ~1 day (single `/timeline` page, aggregator endpoint, framer-motion timeline).

---

## 8. Knowledge Graph — **MISSING**

No graph library installed (no `reactflow`, `d3`, `cytoscape`, `vis-network`). No edge-relationship data model between concepts.

**Effort:** ~2–3 days (pick reactflow, add `ConceptNode` + `ConceptEdge` models, AI extraction pass over notes/files to build the graph, interactive canvas with zoom/drag/filter).

---

## 9. Google & Outlook Calendar — **MISSING**

`oauth.service.ts` exists but is for login. No calendar sync, no `googleapis`/MS Graph client, no `CalendarIntegration` model, no webhook receiver.

**Effort:** ~3 days (OAuth scopes for Google Calendar + MS Graph, initial pull, delta sync, write-back for schedule blocks, retry/backoff, settings UI).

---

## 10. Whiteboard AI — **MISSING**

No drawing library (`excalidraw`, `tldraw`, `perfect-freehand`), no canvas page. Would need vision pass on the drawing to hand it to Gemini.

**Effort:** ~2 days (tldraw or excalidraw embed, save/load per user, "AI: interpret this drawing" action feeding image bytes to Gemini vision).

---

## 11. AI Exam Mode — **PARTIAL**

`/api/v1/ai/exam/route.ts` exists (probably one-shot generation). No dedicated `/exam` workspace page, no countdown UI, no confidence tracking, no revision timeline, no mock-exam persistence.

**Effort:** ~2 days.

---

## 12. AI Notifications — **DONE**

`ai-notification.service.ts` + `Notification` model + `notification-bell.tsx` + read/read-all routes. Generated by Gemini. Verify content quality matches the spec's tone ("You can finish Calculus today in 40 minutes.")

---

## 13. Gamification 2.0 — **PARTIAL**

**Exists**
- `User` has `currentStreak`, `longestStreak`, `totalXp`, `coins`, `level` (confirmed lines 175–179 of schema).
- Models: `Achievement`, `UserAchievement`, `DailyMission`, `WeeklyChallenge`.
- `gamification.service.ts` + `/api/v1/gamification`, `/api/v1/gamification/leaderboard`.

**Gap vs spec**
- No **shop** to spend coins.
- No **monthly missions** (only daily + weekly).
- No **season pass**.
- No **rare achievement** tier / rarity flag.
- No confetti/animation on unlock (verify UI).

**Effort to close:** ~1–2 days.

---

## 14. AI Productivity Engine — **DONE**

`ai-prediction.service.ts` + `/api/v1/ai/predict` + `grade-prediction-panel.tsx` + `use-prediction.ts`. Verify it produces all seven predictions the spec lists (GPA, risk, burnout, weak subjects, best study time, estimated exam score, recommended schedule, productivity score, confidence score).

---

## 15. Multi AI Agents — **PARTIAL**

**Exists**
- `Tutor` model with own conversation, messages, progress, insights, recommendations, files, sessions.
- `tutor-catalog.ts` seeds subject-based tutors (Mathematics, Physics, …).
- Each tutor has its own emoji, accent colour, tagline, topic list — meets "own avatar / own color / own persona".

**Gap vs spec**
- The catalog is **subject-based** (Math, Physics, Chemistry, …), not **role-based** (Tutor, Planner, Coach, Researcher, Writer, Reviewer, Exam Coach, Motivator).
- Could either extend `tutor-catalog.ts` with role templates or add a separate `Agent` model — need a product call.

**Effort to close:** ~1 day if extending existing tutor infra.

---

## 16. Dynamic AI Dashboard — **PARTIAL**

Dashboard is smart (AI brief card, progress ring, priority queue, streak, weak subjects surfaced via prediction service) but the **widget set is fixed**. Every user sees the same layout — only the *data* varies. Spec asks for widget selection that changes based on activity.

**Effort to close:** couples with Feature 17 (drag/drop) — do them together.

---

## 17. Drag & Drop Dashboard — **MISSING**

No `react-grid-layout` / `dnd-kit` / `react-dnd`. No per-user layout persistence.

**Effort:** ~1.5 days (dnd-kit + `DashboardLayout` JSON on `UserSettings`, resize handles, order persistence).

---

## 18. Public Profile — **MISSING**

No `/u/[username]` route, no public read endpoint that redacts private data. Would need username field on User (verify), privacy toggles.

**Effort:** ~1 day.

---

## 19. Yearly Study Replay — **MISSING**

No "wrapped"-style animated recap. Data exists (DailyStat, StudySession, achievements).

**Effort:** ~1.5 days (aggregator endpoint, framer-motion scene sequence, share-image via `og-image`).

---

## 20. Natural Language Commands — **PARTIAL**

`planner.service.ts` + `planner-dialog.tsx` exist. AI chat + AI tools page exist. What's missing is a single **NL router**: parse "Study calculus tomorrow from 7pm" → simultaneously create schedule block + reminder + focus session + notification.

**Effort:** ~1 day (dedicated `/api/v1/ai/dispatch` route with Gemini function-calling / structured output → orchestrated multi-write).

---

## Rough sizing

| Bucket | Features | Est. days |
|---|---|---|
| **Small polish on existing** (Features 1, 2, 4, 6, 13 gaps) | 5 | ~4 days total |
| **Medium new features** (7, 11, 15, 18, 19, 20) | 6 | ~9 days |
| **Large new features** (3 upgrade, 5, 8, 9, 10, 17+16) | 6 | ~13 days |
| **Already done** (12, 14) | 2 | 0 |

Total honest estimate for full spec: **~4 weeks of focused work** if built to the quality bar in your CLAUDE guidance (frontend + backend + Prisma + validation + tests + browser verification per feature).

---

## Recommended next moves

Rather than serial 1→20, cluster by risk/reuse:

1. **Polish sweep** (1 day) — Search fuzzy+highlight+recent, missing Command Palette entries, missing AI Toolbar actions (Simplify / Save-as-Note / Save-as-Assignment). Zero new deps, no schema changes, all extends existing services. Low risk, high visible value.
2. **PDF Reader upgrade** (2–3 days) — swap to react-pdf, persist uploads to existing `UploadedFile` model, add annotations + bookmarks. Highest user-visible payoff.
3. **Then pick one big new feature at a time** — my order: Voice, Whiteboard, Knowledge Graph, Calendar sync. Each in its own branch, verified in the browser before merge.

Ask me to start on any single item and I'll build it fully — backend + frontend + tests + browser verification + commit — before touching the next.
