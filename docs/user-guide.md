# LifeScribe Vault — User Guide

LifeScribe Vault helps you build a digital legacy plan: a private, encrypted record of who should step in if something happens to you, and everything they would need to actually do it — where your passwords live, which devices matter, where the important documents are, and how to reach your accounts.

Everything stays on your computer. There is no cloud account, no sync, and no company server holding your data.

---

## Getting Started

### 1. Create your vault

The first time you open the app you'll be asked where the vault should live —
the default folder is fine for most people, and you can change it later (see
[Where your vault is stored](#where-your-vault-is-stored)). Then you'll be
asked for:

- **Your name** — used to personalize the app and your Recovery Kit.
- **A master password** — at least 15 characters. A passphrase of a few unrelated words (like `correct horse battery staple`, but your own) is strong and easy to remember. Pasting from a password manager works too.

> **There is no password reset.** Your vault is encrypted with this password and nothing else. If you lose it, nobody — including the app's developers — can recover your data. Store it somewhere safe, such as your password manager or a sealed note in a location your executor knows about.

### 2. Choose what the vault should store

You'll be asked one important question during setup:

| Choice | What it means |
|---|---|
| **Locations only** (safer) | The vault records *where to find* passwords, PINs, and codes — never the passwords themselves. Your family follows the trail; the passwords stay in your password manager. |
| **Store the actual passwords & PINs** | The vault also holds real passwords, PINs, and recovery codes, encrypted with your master password. |

Click **"See what this vault covers"** under the choice to preview exactly which sections and fields each option includes before you decide.

You can change this choice later (see [Changing what the vault stores](#changing-what-the-vault-stores)) — nothing you enter is ever lost by switching.

---

## Working Through the Checklist

The sidebar shows a **guided checklist** of sections, each with a status badge, plus an overall readiness percentage. You don't need to finish anything in one sitting — every section you complete is real progress.

The sections cover:

- **Digital Executors** — who steps in, how to reach them, and what they're responsible for
- **Password Manager** — your provider, where the vault lives, and how emergency access works
- **Documents** — wills, insurance, deeds, tax records, and where they're kept
- **Device Inventory** — the phones and computers your family would need to unlock
- **Financial Accounts** — the institutions and accounts that exist, so nothing is missed
- **Subscriptions** — recurring services and what should happen to each (keep or cancel), so nothing keeps billing unnoticed
- **Online Accounts & Domains** — email, domains, and accounts that matter
- **Platform Legacy Tools** — Google Inactive Account Manager, Apple Legacy Contact, and similar
- **Backups & Storage** — where your data backups live and how to get into them

For each section you can:

- **Save** — commits your entries to the encrypted vault.
- **Mark reviewed** — refreshes the section's "up to date" status without changing anything. Sections gently flag themselves for review after a while (12 months by default).
- **Doesn't apply to me** — marks a section N/A so it counts as handled without fake entries.

Status badges are driven only by **saved** data — typing in a form doesn't change a badge until you save.

### Attaching files

Fields that accept a file (for example, a scanned document) encrypt the file into the vault when you attach it. From there you can:

- **View** — opens the file inside the app; the decrypted content stays in memory only.
- **Open externally** — decrypts to a temporary file and opens your default app. The app asks for confirmation first, because this briefly places an unencrypted copy on disk, and cleans it up afterward.
- **Replace / Remove** — takes effect when you save the section. If you change your mind before saving, nothing is lost.

### Copying sensitive values

When you copy a value from the vault, the app uses a protected copy path: the value is excluded from Windows clipboard history (Win+V) and cloud clipboard sync, and the clipboard clears itself automatically after 45 seconds — unless you've already copied something else, which is left alone.

---

## Locking, Unlocking, and Drafts

- **Lock vault** (sidebar) locks immediately. The app also **locks itself after 15 minutes of inactivity**.
- If you lock (or the auto-lock fires) with unsaved edits, they're stashed **encrypted** and restored the next time you unlock, with a banner telling you when they were set aside.
- A wrong password on the unlock screen simply fails — there is no lockout, but attempts are throttled.

---

## Recovery Kit

The Recovery Kit is a printable summary generated from what you've saved: contacts, instructions, and *locations* — it is deliberately structured so it never includes password values, even when you store passwords. It's the document your family starts from.

Save the Kit from its page in the sidebar. If you later change any information the Kit draws on, the sidebar shows a **"Kit out of date"** badge until you regenerate it.

---

## Backups

Your vault lives in one folder you control and nowhere else — **you are responsible for backups**, and the app makes that easy:

- **Create a backup** (Backup page): produces a single `.lsvbackup` file containing your entire vault and all attachments, encrypted with your master password. Store it anywhere — an external drive, a USB stick in a safe, even cloud storage — the file is useless without the password.
- **Restore a backup**: enter the password that was in effect *when the backup was made*. Before anything is replaced, the app makes a safety copy of your current vault and tells you where it is; the safety copy is cleaned up automatically after your next successful unlock.

A good habit: create a fresh backup whenever the Recovery Kit badge reminds you something changed.

---

## Where Your Vault Is Stored

During setup you choose the folder that holds your vault. The default is a
private application folder on this computer, which is right for most people.
You might choose your own folder to keep the vault on an external drive, or in
a folder you already back up.

Whatever you choose holds everything: the encrypted vault file, all encrypted
attachments, and the app's own working files such as stashed drafts and safety
copies.

### Changing the folder later

**Settings → Vault location → Move vault…**

Choosing a new folder **locks the vault**, so you'll enter your master password
again afterwards. This is deliberate: it guarantees nothing is being written
while your files are copied.

The move is careful about ordering. Your files are copied to the new folder and
checked there first; only once that succeeds does the app start using the new
location and remove the old copies. If the app closes partway through, one
complete copy always remains.

If the old copies can't be removed — usually because another program has a file
open — the app tells you so, so you can delete the old folder's contents
yourself.

If the move fails, nothing changes: your vault still lives where it did, and
the app says so.

### If the folder isn't available

If your vault is on an external drive and you open the app without it
connected, you'll see "Your vault folder can't be reached", showing the folder
it's looking for. Reconnect the drive and choose **Retry**, or use **Choose
folder** if you've moved the vault yourself.

**Nothing is deleted in this state**, and the app will not create a new empty
vault behind your back.

### Moving to a new computer

Choosing a folder that already contains a LifeScribe vault opens that vault
rather than replacing it — during setup you'll be sent to the unlock screen
instead. Restoring from a backup remains the recommended path for moving to a
new machine.

---

## Changing What the Vault Stores

You can switch between "locations only" and "store the actual passwords" at any time from **Settings** (sidebar) → **Vault options**, where this choice sits alongside the other form options — the same choice you're asked during the setup wizard. The app asks you to confirm, then rebuilds the forms for the new mode.

**Nothing you've entered is deleted.** If a field doesn't exist in the new mode (for example, a stored master password after switching to locations-only), its value moves to **Archived answers**, visible at the bottom of the section — never silently discarded. If you've customized your forms, the customizations are replaced by the standard forms for the new mode (your data is kept).

---

## Customizing Your Forms (optional)

Turn on **Form Editor** at the bottom of the sidebar to reshape the forms to your life:

- Rename fields, change their type, edit helper text, mark them required
- Add new fields, duplicate or reorder existing ones, remove ones you don't need
- Rename sections and add new ones

A few fields are **protected** because the Recovery Kit and readiness tracking depend on them — they can be renamed but not removed. If removing or retyping a field would orphan something you've already entered, the value is archived rather than lost.

---

## Privacy & Security Summary

- **Local-only.** No cloud sync, no telemetry, no remote services. The app never sends your data anywhere.
- **Strong encryption.** Your master password is stretched with Argon2id; all vault content, attachments, drafts, and backups are encrypted with XChaCha20-Poly1305.
- **No password reset.** By design. Your password is the only key.
- **Honest limits.** Text visible on your screen can be read by anyone at your screen, and manually selecting and copying rendered text bypasses the protected clipboard path. Lock the vault when you step away.

---

## Frequently Asked Questions

**Where is my data stored?**
In an encrypted database file (plus encrypted attachment files) in the folder you chose during setup — by default a private application folder on this computer. Settings → Vault location shows the exact path, and lets you change it. The files are unreadable without your master password.

**Can I keep my vault on an external drive?**
Yes. Choose that folder during setup, or move it later from Settings → Vault location. When the drive isn't connected the app says so plainly instead of starting a new vault.

**Can I move my vault to a new computer?**
Yes — create a backup, install LifeScribe Vault on the new machine, and restore the `.lsvbackup` file. Moving the vault folder is for relocating it on the *same* computer (or onto a drive attached to it), not for migrating machines.

**What happens if the app crashes while saving?**
Saves are atomic and the previous few saved versions are retained. If the newest save is ever unreadable, the app automatically recovers the most recent good one and tells you so.

**I forgot my master password. What now?**
If you have no record of it, the vault cannot be opened — that's the security model working as intended. This is why the app encourages you to keep the password somewhere your executor can eventually find.
