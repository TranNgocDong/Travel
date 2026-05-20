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

    await repository.unlinkUser(trip.id, "new-user");
    assert.equal((await repository.listForUser("new-user")).length, 0);
  });
});
