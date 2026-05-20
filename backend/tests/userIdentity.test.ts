import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { displayNameFromEmail, isValidEmail, normalizeEmail, userIdFromEmail } from "../src/auth/userIdentity.js";

describe("user identity helpers", () => {
  it("creates the same app user id for the same email spelling", () => {
    assert.equal(userIdFromEmail("DAT@example.com"), userIdFromEmail(" dat@example.com "));
    assert.match(userIdFromEmail("dat@example.com"), /^email_[a-f0-9]{24}$/);
  });

  it("normalizes and validates invited member emails", () => {
    assert.equal(normalizeEmail("  DAT@example.com "), "dat@example.com");
    assert.equal(isValidEmail("dat@example.com"), true);
    assert.equal(isValidEmail("not-an-email"), false);
  });

  it("builds a readable display name when only email is provided", () => {
    assert.equal(displayNameFromEmail("mai_linh@example.com"), "Mai Linh");
  });
});
