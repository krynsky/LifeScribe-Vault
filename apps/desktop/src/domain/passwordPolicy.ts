export const MIN_MASTER_PASSWORD_LENGTH = 15;
export const MASTER_PASSWORD_LENGTH_MESSAGE =
  `Use a master password with at least ${MIN_MASTER_PASSWORD_LENGTH} characters — a few unrelated words work well.`;

export function masterPasswordLengthError(password: string): string | null {
  let length = 0;
  for (const character of password) {
    length += Math.min(character.length, 1);
    if (length >= MIN_MASTER_PASSWORD_LENGTH) return null;
  }
  return MASTER_PASSWORD_LENGTH_MESSAGE;
}
