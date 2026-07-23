/**
 * Derives a select option's stored machine `value` from the human-readable
 * text a creator types. Creators only enter the display text; the value is a
 * slug generated here so option values stay URL/serialization-safe and stable
 * without any manual entry.
 *
 * Pure, deterministic data helpers — no React, no side effects.
 */

const DIACRITICS = /[̀-ͯ]/g;
const NON_ALNUM = /[^a-z0-9]+/g;
const EDGE_HYPHENS = /^-+|-+$/g;

/**
 * Slugify display text into a lowercase, hyphen-separated ASCII token:
 * accents folded, non-alphanumerics collapsed to single hyphens, ends trimmed.
 * Falls back to "option" when nothing usable remains (e.g. "!!!") so the value
 * is never empty (packValidation requires a non-empty option value).
 */
export function slugifyOptionValue(label: string): string {
  const slug = label
    .normalize("NFKD")
    .replace(DIACRITICS, "")
    .toLowerCase()
    .replace(NON_ALNUM, "-")
    .replace(EDGE_HYPHENS, "");
  return slug || "option";
}

/**
 * Slugify `label`, then ensure the result is unique against `existing` values
 * by appending `-2`, `-3`, … on collision. Case/punctuation variants that
 * slugify identically therefore never overwrite each other.
 */
export function uniqueOptionValue(label: string, existing: Iterable<string>): string {
  const taken = new Set(existing);
  const base = slugifyOptionValue(label);
  if (!taken.has(base)) {
    return base;
  }
  let suffix = 2;
  while (taken.has(`${base}-${suffix}`)) {
    suffix += 1;
  }
  return `${base}-${suffix}`;
}
