import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { InMemoryTripRepository } from "../src/trips/tripRepository.js";

describe("trip repository", () => {
  it("lists and links trips by user", async () => {
    const repository = new InMemoryTripRepository();

    assert.equal((await repository.listForUser("alice")).length, 0);
    assert.equal((await repository.listForUser("new-user")).length, 0);

    const trip = await repository.create({
      id: "weekend-ride",
      title: "Weekend Ride",
      currency: "VND",
    });
    await repository.linkUser(trip.id, "new-user", "owner");

    const trips = await repository.listForUser("new-user");
    assert.equal(trips.length, 1);
    assert.equal(trips[0]?.title, "Weekend Ride");
    assert.equal(trips[0]?.role, "owner");
    assert.equal(trips[0]?.status, "active");

    await repository.unlinkUser(trip.id, "new-user");
    assert.equal((await repository.listForUser("new-user")).length, 0);
  });

  it("updates lifecycle status and deletes trips", async () => {
    const repository = new InMemoryTripRepository();
    const trip = await repository.create({
      id: "finished-ride",
      title: "Finished Ride",
      currency: "VND",
    });
    await repository.linkUser(trip.id, "owner", "owner");

    const completed = await repository.updateStatus(trip.id, "completed");
    assert.equal(completed?.status, "completed");
    assert.ok(completed?.completedAt);
    assert.equal(completed?.archivedAt, null);

    const archived = await repository.updateStatus(trip.id, "archived");
    assert.equal(archived?.status, "archived");
    assert.ok(archived?.completedAt);
    assert.ok(archived?.archivedAt);

    await repository.delete(trip.id);
    assert.equal(await repository.findById(trip.id), null);
    assert.equal((await repository.listForUser("owner")).length, 0);
  });
});
