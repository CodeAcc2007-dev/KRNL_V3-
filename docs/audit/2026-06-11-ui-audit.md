# KRNL V3 — Full Website Audit Report

## Current State Screenshots

````carousel
![Inbox List — Important tab showing 7 emails with single-letter avatars](/home/CodeAcc2007/.gemini/antigravity/brain/819fc243-a3cc-4f30-9641-80afe21a3eff/inbox_list.png)
<!-- slide -->
![Email Detail Screen — opens correctly when clicking an email card](/home/CodeAcc2007/.gemini/antigravity/brain/819fc243-a3cc-4f30-9641-80afe21a3eff/email_detail.png)
<!-- slide -->
![Ask KRNL — chat interface with hardcoded initial messages and live query support](/home/CodeAcc2007/.gemini/antigravity/brain/819fc243-a3cc-4f30-9641-80afe21a3eff/ask_krnl.png)
<!-- slide -->
![Opportunities tab — empty with "All caught up!" message](/home/CodeAcc2007/.gemini/antigravity/brain/819fc243-a3cc-4f30-9641-80afe21a3eff/opportunities_empty.png)
<!-- slide -->
![Deadlines calendar view](/home/CodeAcc2007/.gemini/antigravity/brain/819fc243-a3cc-4f30-9641-80afe21a3eff/deadlines_calendar.png)
<!-- slide -->
![Settings screen — account management and career tracks](/home/CodeAcc2007/.gemini/antigravity/brain/819fc243-a3cc-4f30-9641-80afe21a3eff/settings.png)
<!-- slide -->
![Academic tab — only 1 email visible](/home/CodeAcc2007/.gemini/antigravity/brain/819fc243-a3cc-4f30-9641-80afe21a3eff/academic_tab.png)
````

---

## ✅ What's Working

| Feature | Status | Notes |
|---------|--------|-------|
| Login / Auth | ✅ | Google OAuth works, session persists |
| Bottom Navigation | ✅ | All 3 tabs + center FAB work correctly |
| Inbox — Important tab | ✅ | Shows emails sorted by priority |
| Inbox — Academic tab | ✅ | Filters correctly (1 Academic email) |
| Inbox — Announcement tab | ✅ | Filters correctly |
| Email Detail Screen | ✅ | **Opens correctly** when clicking email cards. Shows AI Summary, Full Message, Tags, Back button works. |
| Deadlines — List view | ✅ | Shows deadline cards with urgency |
| Deadlines — Calendar view | ✅ | Monthly calendar with highlighted dates |
| Ask KRNL — Chat | ✅ | Input, send, typing indicator, AI responses all work |
| Ask KRNL — Citations | ✅ | Citation chips are clickable, open event detail drawer |
| Settings | ✅ | Profile, sign out, career tracks, connected accounts |
| Settings — Career tracks | ✅ | Toggle selection works (Software, Quant, etc.) |

---

## 🐛 Issues Found

### 1. Email Avatars — Only First Letter (Visual)

> [!WARNING]
> **Severity: Medium — Visual Polish**

All email card avatars are plain indigo circles with a single letter initial. This makes the inbox look monotonous and "ugly" as you noted. Every card has the same `#6366f1` background with just one letter.

**Root cause**: `InboxScreen.tsx` line 267 — avatar renders `email.display_name.charAt(0)` with a hardcoded `#6366f1` background for every email.

**Fix needed**: Generate distinct avatar colors per-email using a hash of the display name, and optionally use different icon types for categories (academic hat, megaphone for announcements, etc.).

---

### 2. Opportunities Tab — Always Empty

> [!IMPORTANT]
> **Severity: High — Functional Gap**

The "Opportunities" tab always shows "All caught up! No events found in this category." even when career tracks are selected in Settings.

**Root cause**: The filter in `InboxScreen.tsx` line 152 checks `ev.category.toLowerCase() === "opportunities"` — but none of the synced emails have `category: "Opportunities"`. The emails from the backend have categories like `Security`, `Technical`, `Academic`, `General`. No email is tagged as `Opportunities` by the AI ingestion pipeline.

**Fix needed**: Either:
- (a) Improve the AI categorization prompt to actually tag opportunity/career emails as `"Opportunities"`, or
- (b) Show a meaningful empty state with an explanation instead of generic "All caught up"

---

### 3. No "Load More" Button — Fixed Email Count

> [!IMPORTANT]
> **Severity: High — Missing Feature**

The inbox loads all events at once from `/api/v1/events` with no pagination. There is no "Load More" button to fetch additional emails. If the user only has 7 emails synced, that's all they see — no way to trigger fetching more.

**Root cause**: 
- Backend `events.py` `GET /events` fetches ALL events with no `limit`/`offset` params
- Frontend `InboxScreen.tsx` makes a single fetch and renders everything
- No pagination or "load more" mechanism exists

**Fix needed**: 
- Add `limit` and `offset` query params to the backend `/events` endpoint
- Add a "Load More" button at the bottom of the inbox list
- Optionally trigger a manual re-sync to pull more emails from IMAP

---

### 4. Ask KRNL — Hardcoded Initial Messages

> [!WARNING]
> **Severity: Low — Polish**

The Ask KRNL screen always starts with 2 hardcoded mock messages (the "What academic deadlines do I have this week?" Q&A). This is misleading since it shows fake citations referencing event IDs 1 and 2 that may not exist.

**Root cause**: `AskKrnlScreen.tsx` line 23-39 — `initialMessages` array is hardcoded.

**Fix needed**: Start with an empty chat or a welcome message from KRNL, not fake Q&A.

---

### 5. Hamburger Menu Button (☰) — Does Nothing

> [!WARNING]
> **Severity: Low — Dead Button**

The hamburger menu icon in the top-left of the Inbox header (`InboxScreen.tsx` line 167) has no `onClick` handler. It renders as a styled button but does nothing when clicked.

**Fix needed**: Either wire it to a sidebar/drawer, or remove it to avoid confusion.

---

### 6. Duplicate Events in Feed

> [!WARNING]
> **Severity: Medium — Data Quality**

Two "IPR Open House Session" entries appear as separate cards with identical content (same title, same deadline Jun 16, same category Technical). This is a backend deduplication issue from the ingestion pipeline.

**Root cause**: The IMAP sync likely ingested the same email twice. No dedup check in `sync_task.py`.

**Fix needed**: Add a deduplication check in the ingestion pipeline (by `message_id` or subject+sender hash).

---

### 7. Email Card Text Truncation — Too Aggressive

> [!WARNING]
> **Severity: Low — Visual**

Email titles like "Drone Engineering Training &..." and "IPR Open House Session: Pat..." are heavily truncated. The summary snippets are also cut off mid-word ("Students who have not been allotte...").

**Fix needed**: Allow 2-line titles or expand the card height to show more context.

---

### 8. "Academic" Tab Not Visible Without Scrolling

> [!WARNING]
> **Severity: Low — UX**

The filter pills row shows "Important", "Opportunities", "Announcement" — but "Academic" is cut off by the right edge. Users need to scroll horizontally to see it.

**Fix needed**: The filter pills overflow is set to scroll but there's no visual indicator (scroll hint arrow or fade gradient) that more tabs exist.

---

## Summary Prioritization

| Priority | Issue | Effort |
|----------|-------|--------|
| 🔴 High | #3 — No "Load More" / Pagination | Medium |
| 🔴 High | #2 — Opportunities tab always empty | Medium |
| 🟡 Medium | #1 — Monotonous single-letter avatars | Low |
| 🟡 Medium | #6 — Duplicate events | Medium (backend) |
| 🟢 Low | #4 — Hardcoded Ask KRNL messages | Low |
| 🟢 Low | #5 — Dead hamburger button | Trivial |
| 🟢 Low | #7 — Aggressive text truncation | Low |
| 🟢 Low | #8 — Hidden "Academic" tab | Low |
