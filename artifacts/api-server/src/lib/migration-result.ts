/** Drizzle can return zero after a failed noninteractive prompt. Fail closed. */
export function schemaPushSucceeded(output: string): boolean {
  const plain = output.replace(/\u001b\[[0-9;]*[A-Za-z]/g, "");
  return /Changes applied|No changes detected/i.test(plain) && !/\bError:/.test(plain);
}
