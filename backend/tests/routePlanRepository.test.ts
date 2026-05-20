import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { InMemoryRoutePlanRepository } from "../src/route/routePlanRepository.js";
import { buildStarterRoutePlan } from "../src/route/routePlanner.js";

describe("route plan repository", () => {
  it("stores the latest planned route for a trip", async () => {
    const repository = new InMemoryRoutePlanRepository();
    const tripId = "trip-offline-cache";
    const routePlan = {
      ...buildStarterRoutePlan(tripId, new Date("2026-05-19T00:00:00.000Z")),
      title: "Saved route",
      destination: "Hai Phong",
    };

    assert.equal(await repository.findByTrip(tripId), null);

    await repository.save(tripId, "alice", routePlan);
    const saved = await repository.findByTrip(tripId);

    assert.equal(saved?.title, "Saved route");
    assert.equal(saved?.destination, "Hai Phong");
  });
});
