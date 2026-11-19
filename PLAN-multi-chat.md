# Plan: Multi-Chat, Message Editing & Regeneration

> Current state: single ephemeral `ChatSession` in React state, no persistence, no editing, no branching.

---

## Decision Log

| # | Decision | Choice | Rationale |
|---|---|---|---|
| D1 | Persistence layer | SQLite (Rust, same `sheep.db`) | Already there; zero new deps |
| D2 | Branch strategy | Linear editing only (no tree branching) | Branching adds UI complexity that isn't needed yet; can add later |
| D3 | Auto-title chats | First user message, truncated to 60 chars | Simple and correct; no extra LLM call |
| D4 | Edit scope | User messages only (re-submit from that point) | Assistant messages are model output; editing them is confusing |
| D5 | Regenerate | Discard last assistant message, re-run same context | Standard ChatGPT-style UX |
| D6 | Chat list location | Left drawer panel inside the Chat tab (not a new sidebar tab) | Keeps the nav rail clean; chat management lives where chat lives |
| D7 | API surface | REST endpoints on existing Axum server (`/api/chats/…`) | Consistent with auth API; Tauri and browser both reach it |
| D8 | Soft delete | Yes — `deleted_at` column instead of hard DELETE | Easy to restore, audit trail |

---

## Database Schema (Rust `db.rs`)

Two new tables — added in `Db::new()` migration block:

```sql
CREATE TABLE IF NOT EXISTS chats (
    id          TEXT PRIMARY KEY,       -- UUID v4
    user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title       TEXT NOT NULL DEFAULT 'New Conversation',
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL,
    deleted_at  TEXT                    -- NULL = active
);

CREATE TABLE IF NOT EXISTS messages (
    id          TEXT PRIMARY KEY,       -- UUID v4
    chat_id     TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
    role        TEXT NOT NULL,          -- 'user' | 'assistant' | 'system'
    content     TEXT NOT NULL,
    created_at  TEXT NOT NULL,
    edited_at   TEXT,                   -- NULL = never edited
    position    INTEGER NOT NULL        -- ordinal, 0-indexed, for ordering
);

CREATE INDEX IF NOT EXISTS idx_chats_user    ON chats(user_id, deleted_at, updated_at);
CREATE INDEX IF NOT EXISTS idx_messages_chat ON messages(chat_id, position);
```

**Key invariants (enforced in Rust):**
- A user can only read/write their own chats — `WHERE user_id = ?` on every query.
- No cross-user access, even for admin/owner.
- `position` is reassigned after a truncation (edit removes all messages after the edited one).

---

## REST API (`web_server.rs`)

All routes under `/api/chats` require a valid session token (same middleware as `/api/auth/me`).

| Method | Path | Body | Response | Notes |
|--------|------|------|----------|-------|
| `GET` | `/api/chats` | — | `[ChatSummary]` | Active chats for session's user, newest first |
| `POST` | `/api/chats` | `{title?}` | `Chat` | Create new empty chat |
| `GET` | `/api/chats/:id` | — | `Chat + messages` | Verify ownership |
| `PATCH` | `/api/chats/:id` | `{title}` | `Chat` | Rename |
| `DELETE` | `/api/chats/:id` | — | `204` | Soft delete (`deleted_at = now`) |
| `GET` | `/api/chats/:id/messages` | — | `[Message]` | Ordered by `position` |
| `POST` | `/api/chats/:id/messages` | `{role, content}` | `Message` | Append message |
| `PATCH` | `/api/chats/:id/messages/:mid` | `{content}` | `Message` | Edit + truncate everything after |
| `DELETE` | `/api/chats/:id/messages/:mid` | — | `204` | Delete message + all after (for regenerate) |

> [!NOTE] `PATCH /messages/:mid` sets `edited_at = now`, then deletes all messages with `position > edited_message.position`. This is the edit-and-resubmit flow.

---

## Frontend Architecture

### Layout Change: Chat Panel Splits in Two

```
┌──────────────────────────────────────────────────────────┐
│  Sidebar (64px icon rail — UNCHANGED)                    │
├──────────┬───────────────────────────────────────────────┤
│ Chat     │                                               │
│ History  │          Active Conversation                  │
│ Panel    │          (message thread + composer)          │
│ (220px)  │                                               │
│          │                                               │
│ [+ New]  │                                               │
│ ──────── │                                               │
│ chat 1   │                                               │
│ chat 2 ● │                                               │
│ chat 3   │                                               │
└──────────┴───────────────────────────────────────────────┘
```

- The existing `Sidebar` (icon rail) doesn't change.
- The `ChatTab` grows a left panel: `ChatHistoryPanel` (220 px) + `ConversationView` (flex-1).
- On narrow viewports the history panel collapses behind a toggle button (hamburger).

### New / Changed Components

| Component | File | Role |
|---|---|---|
| `ChatHistoryPanel` | `components/ChatHistoryPanel.tsx` | List of chats, new chat button, rename, delete |
| `ConversationView` | `components/ConversationView.tsx` | Message thread (extracted from current `ChatTab`) |
| `MessageBubble` | `components/MessageBubble.tsx` | Single message with edit / regenerate controls |
| `ChatTab` | `components/ChatTab.tsx` | **Refactored** — now just the shell holding the two panels |

### Message Bubble Hover Controls

```
User message:
  ┌──────────────────────────────────────┐
  │  message text                   ✏️  │   ← pencil appears on hover
  └──────────────────────────────────────┘

Assistant message (last only):
  ┌──────────────────────────────────────┐
  │  🤖  message text                   │
  │       ↻ Regenerate                  │   ← regenerate button under last response
  └──────────────────────────────────────┘
```

- **Edit (user messages):** Click pencil → inline `<textarea>` replaces the bubble → Save / Cancel buttons → on Save: `PATCH /api/chats/:id/messages/:mid` (truncates after), then immediately calls `handleSendMessage` to trigger regeneration with the new context.
- **Regenerate (last assistant only):** Click ↻ → `DELETE /api/chats/:id/messages/:lastAssistantId` (removes last assistant msg) → calls `handleSendMessage` with the unchanged preceding context.

### State Shape (`App.tsx`)

```typescript
// Replaces the current single `currentChat` state
const [chats, setChats] = useState<ChatSession[]>([]);
const [activeChatId, setActiveChatId] = useState<string | null>(null);
const activeChat = chats.find(c => c.id === activeChatId) ?? null;
```

Chat loading flow on login:
1. `GET /api/chats` → populate `chats`
2. If result is empty → auto-create one chat and set it active
3. Else → set `activeChatId` to first chat's id

### `api/chatClient.ts` (new file)

Thin HTTP wrapper (same pattern as `authClient.ts`):
```typescript
export const chatClient = {
  listChats(): Promise<ChatSummary[]>
  createChat(title?: string): Promise<Chat>
  getChat(id: string): Promise<ChatWithMessages>
  renameChat(id: string, title: string): Promise<Chat>
  deleteChat(id: string): Promise<void>
  getMessages(chatId: string): Promise<Message[]>
  appendMessage(chatId: string, role: string, content: string): Promise<Message>
  editMessage(chatId: string, msgId: string, content: string): Promise<Message>
  deleteMessage(chatId: string, msgId: string): Promise<void>
}
```

---

## Implementation Order

### Phase 1 — Backend foundation (Rust)
1. `db.rs`: add `chats` + `messages` tables, indexes, helper methods (`create_chat`, `list_chats`, `get_chat`, `rename_chat`, `soft_delete_chat`, `append_message`, `edit_message_and_truncate`, `delete_message_and_truncate`, `get_messages`)
2. `web_server.rs`: add `/api/chats` router with all 8 endpoints, session-token auth middleware applied to all

### Phase 2 — Frontend client + state
3. `ui/src/api/chatClient.ts`: HTTP wrapper
4. `ui/src/types.ts`: add `Chat`, `ChatSummary`, `Message` types (rename existing `ChatSession` / `ChatMessage` to match)
5. `App.tsx`: replace single `currentChat` with `chats[]` + `activeChatId`; load chats on login; wire `handleSendMessage` to persist user+assistant messages after each exchange

### Phase 3 — Chat history UI
6. `ChatHistoryPanel.tsx`: list, new chat button, rename (inline edit on double-click), delete (with confirm)
7. Refactor `ChatTab.tsx` → split into `ChatHistoryPanel` + `ConversationView`

### Phase 4 — Editing & Regeneration
8. `MessageBubble.tsx`: hover-reveal edit pencil (user messages), regenerate button (last assistant only)
9. Wire edit → `chatClient.editMessage` → truncate state → re-run `handleSendMessage`
10. Wire regenerate → `chatClient.deleteMessage` → rebuild history → re-run `handleSendMessage`

### Phase 5 — Polish
11. Auto-title: on first user message, `PATCH /api/chats/:id` with title = first 60 chars
12. Scroll-to-bottom on new message (use `useRef` + `scrollIntoView`)
13. Keyboard shortcuts: `Ctrl+N` = new chat, `Enter` = send, `Escape` = cancel edit
14. Update `CHANGELOG.md`, `AGENTS.md`, `PLAN-native-ui.md`

---

## Open Questions for You

| # | Question | Options |
|---|---|---|
| Q1 | Should chat history be **persistent across sessions** (default yes, stored in SQLite) or ephemeral (cleared on logout)? | **Persistent** / Ephemeral |
| Q2 | When you **edit a user message**, should the app auto-submit immediately, or wait for you to click Send? | **Auto-submit** / Manual Send |
| Q3 | Should **deleted chats** be truly gone or recoverable (Trash)? | **Gone immediately** (soft-delete silently) / Trash bin UI |
| Q4 | Do you want **markdown rendering** in assistant messages (bold, code blocks, lists) now, or plain text first? | **Markdown now** (add `react-markdown`) / Plain text first |
| Q5 | Chat list limit — cap at some number (e.g. 100) with pagination, or just load all? | **Load all** (fine until thousands of chats) / Paginate |

> [!IMPORTANT] The answers to Q1 and Q4 affect Phase 1 scope. Q4 adds ~1 extra dependency (`react-markdown` + `remark-gfm`).

---

## What Doesn't Change

- Auth, slot management, all existing tabs — untouched
- Hard user isolation: every DB query filters by `user_id` from the session token
- The Python engine surface — still just `/v1/chat/completions` SSE
- The dark aesthetic — `MessageBubble` follows the same `neutral-900 / indigo-600` palette
