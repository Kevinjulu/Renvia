import assert from "node:assert/strict";
import test from "node:test";
import { daysUntil, invitationToPrompt } from "./invitationPrompt.ts";

test("prompts the newest invitation the user hasn't set aside", () => {
  const invitations = [
    { id: "old", invitedAt: "2026-10-01T00:00:00Z" },
    { id: "new", invitedAt: "2026-10-10T00:00:00Z" },
  ];
  assert.equal(invitationToPrompt(invitations, [])?.id, "new");
  assert.equal(invitationToPrompt(invitations, ["new"])?.id, "old");
  assert.equal(invitationToPrompt(invitations, ["new", "old"]), null);
});

test("counts days left, never below zero", () => {
  const now = Date.parse("2026-10-15T00:00:00Z");
  assert.equal(daysUntil("2026-10-17T12:00:00Z", now), 3);
  assert.equal(daysUntil("2026-10-01T00:00:00Z", now), 0);
});
