import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { InMemoryTripMemberLocationRepository } from "../src/locations/memberLocationRepository.js";

describe("member location repository", () => {
  it("keeps only the latest active location for each member", async () => {
    const repository = new InMemoryTripMemberLocationRepository();
    const now = new Date("2026-05-20T10:00:00.000Z");

    await repository.upsert(
      {
        tripId: "trip-1",
        userId: "alice",
        latitude: 21.0278,
        longitude: 105.8342,
        accuracyMeters: 15,
        ttlSeconds: 60,
      },
      now,
    );
    await repository.upsert(
      {
        tripId: "trip-1",
        userId: "alice",
        latitude: 21.028,
        longitude: 105.835,
        ttlSeconds: 60,
      },
      new Date("2026-05-20T10:00:10.000Z"),
    );

    const active = await repository.listActiveByTrip("trip-1", new Date("2026-05-20T10:00:20.000Z"));

    assert.equal(active.length, 1);
    assert.equal(active[0]?.userId, "alice");
    assert.equal(active[0]?.latitude, 21.028);
  });

  it("prunes expired shared locations", async () => {
    const repository = new InMemoryTripMemberLocationRepository();

    await repository.upsert(
      {
        tripId: "trip-1",
        userId: "alice",
        latitude: 21.0278,
        longitude: 105.8342,
        ttlSeconds: 5,
      },
      new Date("2026-05-20T10:00:00.000Z"),
    );

    const active = await repository.listActiveByTrip("trip-1", new Date("2026-05-20T10:00:06.000Z"));
    assert.equal(active.length, 0);
  });
});
