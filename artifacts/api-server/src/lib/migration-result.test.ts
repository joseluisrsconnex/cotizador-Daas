import { describe, expect, it } from "vitest";
import { schemaPushSucceeded } from "./migration-result";

describe("deployment schema push confirmation", () => {
  it("accepts explicitly applied schema changes", () => {
    expect(schemaPushSucceeded("[✓] Changes applied")).toBe(true);
  });
  it("accepts an unchanged existing schema with ANSI colors", () => {
    expect(schemaPushSucceeded("\u001b[32m[i] No changes detected\u001b[0m")).toBe(true);
  });
  it("rejects the non-TTY prompt error even when the process exits zero", () => {
    expect(schemaPushSucceeded("Warning Found data-loss statements\nError: Interactive prompts require a TTY terminal")).toBe(false);
    expect(schemaPushSucceeded("[✓] Changes applied\nError: connection closed")).toBe(false);
  });
  it("rejects ambiguous, empty or unfinished output", () => {
    expect(schemaPushSucceeded("")).toBe(false);
    expect(schemaPushSucceeded("[✓] Pulling schema from database...")).toBe(false);
  });
});
