import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { InMemoryTripAuditRepository } from "../src/audit/tripAuditRepository.js";

describe("trip audit repository", () => {
  it("lists audit events only for the selected trip newest first", async () => {
    const repository = new InMemoryTripAuditRepository();

    await repository.create({
      id: "audit-1",
      tripId: "trip-a",
      actorUserId: "owner",
      actorDisplayName: "Owner",
      action: "member_added",
      targetUserId: "member-1",
      metadata: { role: "viewer" },
    });
    await repository.create({
      id: "audit-2",
      tripId: "trip-b",
      actorUserId: "owner",
      actorDisplayName: "Owner",
      action: "trip_created",
    });
    await repository.create({
      id: "audit-3",
      tripId: "trip-a",
      actorUserId: "owner",
      actorDisplayName: "Owner",
      action: "member_removed",
      targetUserId: "member-1",
    });

    const events = await repository.listByTrip("trip-a");

    assert.deepEqual(
      events.map((event) => event.id),
      ["audit-3", "audit-1"],
    );
  });

  it("clamps audit list limits", async () => {
    const repository = new InMemoryTripAuditRepository();

    await repository.create({
      id: "audit-1",
      tripId: "trip-a",
      actorUserId: "owner",
      actorDisplayName: "Owner",
      action: "trip_created",
    });
    await repository.create({
      id: "audit-2",
      tripId: "trip-a",
      actorUserId: "owner",
      actorDisplayName: "Owner",
      action: "trip_status_changed",
    });

    assert.equal((await repository.listByTrip("trip-a", 1)).length, 1);
    assert.equal((await repository.listByTrip("trip-a", -100)).length, 1);
  });
});
