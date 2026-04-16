# Chat with Vault

LifeScribe Vault can answer questions using your own notes. Every
answer cites exactly which notes it came from.

## First-time setup

1. Import some notes with the `/import` page.
2. Open **Settings** → set a **Default chat model**. Pick LM Studio
   if it's running locally, or GitHub Models if you've added a PAT.
3. Open **Chat**.

## How retrieval works

Your notes are indexed locally at `.lifescribe/fts.db` inside the
vault folder. The index is updated automatically after every import
and after every chat turn. You can rebuild it from **Settings → Chat
index → Rebuild index** if you hand-edit a lot of notes.

If no notes match your question, the assistant will say so rather
than making something up. That's deliberate — "Chat with Vault"
means grounded-in-your-notes, always.

## Citations

Answers include `[1]`, `[2]` markers that link to the cited notes.
Red markers like `[7⚠]` mean the model produced a citation that
didn't match any of the retrieved sources — treat those claims with
scepticism.

## Privacy

When the privacy master-switch is on, the chat page will only allow
sending if you've picked a local provider (LM Studio). If you pick
a remote provider and privacy is on, the send button is disabled
until you either switch providers or turn privacy off.

Chat transcripts are stored in your vault at `70_chats/` as regular
markdown files. They're part of the vault — searchable, citable,
editable.
