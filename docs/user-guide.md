# LifeScribe Vault — User Guide

LifeScribe Vault helps you build a digital legacy plan: a private, encrypted record of who should step in if something happens to you, and everything they would need to actually do it — where your passwords live, which devices matter, where the important documents are, and how to reach your accounts.

Everything stays on your computer. There is no cloud account, no sync, and no company server holding your data.

---

## Getting Started

### Create your vault

Setting up takes one screen. You'll be asked for:

- **Where the vault should live** — the default folder is fine for most people, and you can change it later (see [Where your vault is stored](#where-your-vault-is-stored)). If the folder you pick already holds a LifeScribe vault, the app opens that one instead of replacing it, and sends you to the unlock screen.
- **Your name** — used to personalize the app and your Recovery Kit.
- **A master password** — at least 15 characters, typed twice. A passphrase of a few unrelated words (like `correct horse battery staple`, but your own) is strong and easy to remember. Pasting from a password manager works too.
- **An acknowledgment** — you tick a box confirming you understand the password can't be recovered. That's the only way past this screen.

> **There is no password reset.** Your vault is encrypted with this password and nothing else. If you lose it, nobody — including the app's developers — can recover your data. Store it somewhere safe, such as your password manager or a sealed note in a location your executor knows about.

That's the whole setup. There's no question about what kind of information the
vault should hold — every section and field is available from the start, and
you decide what to fill in.

---

## Working Through the Checklist

The sidebar shows a **guided checklist** of sections, each with a status badge, plus an overall readiness percentage. You don't need to finish anything in one sitting — every section you complete is real progress.

The sections cover:

- **Digital Executors** — who steps in, how to reach them, and what they're responsible for
- **Password Manager** — your provider, where the vault lives, and how emergency access works
- **Documents** — wills, insurance, deeds, tax records, and where they're kept
- **Devices** — the phones and computers your family would need to unlock
- **Financial Accounts** — the institutions and accounts that exist, so nothing is missed
- **Subscriptions** — recurring services and what should happen to each (keep or cancel), so nothing keeps billing unnoticed
- **Online Accounts** — email, domains, and accounts that matter
- **Platform Legacy Tools** — Google Inactive Account Manager, Apple Legacy Contact, and similar
- **Backups & Storage** — where your data backups live and how to get into them

For each section you can:

- **Save** — commits your entries to the encrypted vault.
- **Mark reviewed** — refreshes the section's "up to date" status without changing anything. Sections gently flag themselves for review after a while (12 months by default).
- **Doesn't apply to me** — marks a section N/A so it counts as handled without fake entries.

Status badges are driven only by **saved** data — typing in a form doesn't change a badge until you save.

### Passwords, PINs, and what you decide to store

Most fields ask *where* something is kept — which password manager you use,
where a document lives, how to reach an account. A few fields go further and
can hold the secret itself:

- **Password Manager → Master password**
- **Devices → PIN or passcode**
- **Documents → Attached copy**, which stores an actual scanned file in the vault alongside the "Digital location" that says where the original lives

These fields are always there and always optional. Filling one in puts that
password, PIN, or file inside your encrypted vault. Leaving it blank is what
keeps it out — there is no separate setting, and nothing else to switch on or
off. It's a per-field decision you make each time, and you can clear a field
later if you change your mind.

Whichever way you go, the master password and the device PIN are **never
printed in the Recovery Kit** — see below.

### Fields that link to another entry

Some fields ask you to pick something you've already entered elsewhere rather
than retype it. "Backups & Storage → Device" lists the devices from your Device
list; "Subscriptions → Payment method" lists your financial accounts.

- **Rename once, updated everywhere.** The link remembers *which* entry you
  picked, not the words on screen. Rename a device and every backup pointing at
  it follows automatically.
- **Two entries can share a name.** Two cards both called "Chase" stay distinct
  — the app tracks them separately even though they read alike.
- **You can't delete something still in use.** If you try to remove a device
  that a backup points at, the app tells you what's using it instead of deleting
  it and leaving a broken link. Clear or repoint those entries first, then
  delete.
- **A link that can't be found still shows.** If an entry goes missing, the
  field says so rather than quietly emptying itself, so you can fix it
  deliberately.

Where a linked field appears on the Recovery Kit, it prints the readable name of
the entry it points at — never an internal id, and never a password or PIN.

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

The Recovery Kit is a printable summary generated from what you've saved: contacts, instructions, and *locations*. It's the document your family starts from.

Because the Kit is meant to be printed and left somewhere findable, it will
never print the **master password** you may have saved for your password
manager, or a device's **PIN or passcode** — those two are blocked outright, so
they stay in the encrypted vault and off the page. This holds even if you've
reshaped your forms with the Form Editor.

Where a document has an attached copy, the Kit lists the **file name** so your
family knows the copy is in the vault, not the file's contents.

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
