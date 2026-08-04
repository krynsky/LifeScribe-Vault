/**
 * Attachment reference bookkeeping.
 *
 * Attachment ciphertext files must never be deleted while any SAVED snapshot
 * still references them (the "user data is never silently dropped" law applies
 * to attached files too). The lifecycle is therefore:
 *
 * - UI actions (remove / replace / record delete) only edit refs in working
 *   values — the file stays on disk.
 * - After a save COMMITS, `droppedAttachmentIds` diffs the previous saved
 *   values against the new ones; only then are the dropped files deleted.
 * - Files never referenced by a committed save (attach-then-discard, crash)
 *   are removed by the unlock-time orphan sweep.
 */

import type { SectionValues, VaultValues } from "./valuesStore";

/** Every attachment id referenced by active records or archived answers. */
export function collectAttachmentIds(sections: Iterable<SectionValues>): string[] {
  const ids: string[] = [];
  for (const sectionValues of sections) {
    for (const record of sectionValues.records) {
      for (const att of record.attachments ?? []) {
        ids.push(att.id);
      }
    }
    for (const answer of sectionValues.archivedAnswers) {
      if (answer.attachment) {
        ids.push(answer.attachment.id);
      }
    }
  }
  return ids;
}

/**
 * Attachment ids referenced by `before` but no longer by `after` — safe to
 * delete once `after` has been committed as the new saved snapshot.
 */
export function droppedAttachmentIds(before: VaultValues, after: VaultValues): string[] {
  const kept = new Set(collectAttachmentIds(Object.values(after)));
  const dropped = new Set<string>();
  for (const id of collectAttachmentIds(Object.values(before))) {
    if (!kept.has(id)) {
      dropped.add(id);
    }
  }
  return [...dropped];
}
