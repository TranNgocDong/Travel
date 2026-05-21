import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { InMemoryTripMapMarkerRepository } from "../src/mapMarkers/tripMapMarkerRepository.js";

describe("trip map marker repository", () => {
  it("stores shared markers by trip and sorts newest first", async () => {
    const repository = new InMemoryTripMapMarkerRepository();

    await repository.create({
      id: "marker-old",
      tripId: "trip-1",
      userId: "user-1",
      displayName: "User One",
      label: "Cay xang",
      kind: "fuel",
      latitude: 10.77,
      longitude: 106.7,
      createdAt: new Date("2026-05-20T10:00:00.000Z"),
    });
    await repository.create({
      id: "marker-new",
      tripId: "trip-1",
      userId: "user-2",
      displayName: "User Two",
      label: "Diem gap",
      kind: "meetup",
      latitude: 10.78,
      longitude: 106.71,
      createdAt: new Date("2026-05-20T10:05:00.000Z"),
    });
    await repository.create({
      id: "marker-other-trip",
      tripId: "trip-2",
      userId: "user-1",
      displayName: "User One",
      label: "Canh bao",
      kind: "warning",
      latitude: 11,
      longitude: 107,
    });

    const markers = await repository.listByTrip("trip-1");
    assert.deepEqual(
      markers.map((marker) => marker.id),
      ["marker-new", "marker-old"],
    );
    assert.equal(markers[0]?.kind, "meetup");
    assert.equal((await repository.listByTrip("trip-2")).length, 1);
  });

  it("finds and removes markers inside the selected trip", async () => {
    const repository = new InMemoryTripMapMarkerRepository();

    await repository.create({
      id: "marker-1",
      tripId: "trip-1",
      userId: "user-1",
      displayName: "User One",
      label: "Ping",
      kind: "ping",
      latitude: 10,
      longitude: 106,
    });

    assert.equal((await repository.findById("trip-1", "marker-1"))?.label, "Ping");
    assert.equal(await repository.findById("trip-2", "marker-1"), null);

    await repository.remove("trip-1", "marker-1");
    assert.equal(await repository.findById("trip-1", "marker-1"), null);
  });
});
