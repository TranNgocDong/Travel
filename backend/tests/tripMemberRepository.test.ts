import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { InMemoryTripMemberRepository } from "../src/trips/tripMemberRepository.js";

describe("trip member repository", () => {
  it("soft-removes members so expense history can still identify them", async () => {
    const repository = new InMemoryTripMemberRepository();
    await repository.add("trip-1", {
      userId: "alice",
      displayName: "Alice",
      role: "editor",
      active: true,
      removedAt: null,
    });

    await repository.remove("trip-1", "alice");

    const members = await repository.listByTrip("trip-1");
    assert.equal(members.length, 1);
    assert.equal(members[0]?.active, false);
    assert.equal(members[0]?.displayName, "Alice");
    assert.ok(members[0]?.removedAt);
  });

  it("reactivates a removed member when they are invited again", async () => {
    const repository = new InMemoryTripMemberRepository();
    await repository.add("trip-1", {
      userId: "alice",
      displayName: "Alice",
      role: "viewer",
      active: true,
      removedAt: null,
    });
    await repository.remove("trip-1", "alice");

    const reactivated = await repository.add("trip-1", {
      userId: "alice",
      displayName: "Alice Again",
      role: "editor",
      active: true,
      removedAt: null,
    });

    assert.equal(reactivated.active, true);
    assert.equal(reactivated.removedAt, null);
    assert.equal(reactivated.displayName, "Alice Again");
    assert.equal(reactivated.role, "editor");
    assert.equal((await repository.listByTrip("trip-1")).length, 1);
  });
});
