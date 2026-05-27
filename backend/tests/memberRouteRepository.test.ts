import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { InMemoryMemberRouteRepository } from "../src/route/memberRouteRepository.js";
import { buildStarterRoutePlan } from "../src/route/routePlanner.js";

describe("member route repository", () => {
  it("stores one latest personal route per member and sorts newest first", async () => {
    const repository = new InMemoryMemberRouteRepository();
    const tripId = "trip-member-routes";

    const aliceRoute = await repository.save({
      id: "member_route_alice_1",
      tripId,
      userId: "alice",
      displayName: "Alice",
      routePlan: {
        ...buildStarterRoutePlan(tripId, new Date("2026-05-19T00:00:00.000Z")),
        title: "Tuyến của Alice",
        destination: "Sa Pa",
      },
    });

    await repository.save({
      id: "member_route_bob_1",
      tripId,
      userId: "bob",
      displayName: "Bob",
      routePlan: {
        ...buildStarterRoutePlan(tripId, new Date("2026-05-19T00:00:00.000Z")),
        title: "Tuyến của Bob",
        destination: "Ha Giang",
      },
    });

    const aliceUpdated = await repository.save({
      id: "member_route_alice_2",
      tripId,
      userId: "alice",
      displayName: "Alice",
      routePlan: {
        ...buildStarterRoutePlan(tripId, new Date("2026-05-19T00:00:00.000Z")),
        title: "Tuyến mới của Alice",
        destination: "Cao Bang",
      },
    });

    const routes = await repository.listByTrip(tripId);

    assert.equal(routes.length, 2);
    assert.equal(routes[0]?.id, aliceUpdated.id);
    assert.equal(routes[0]?.routePlan.destination, "Cao Bang");
    assert.equal(routes.some((route) => route.id === aliceRoute.id), false);
  });

  it("finds and removes only routes from the selected trip", async () => {
    const repository = new InMemoryMemberRouteRepository();
    const routePlan = buildStarterRoutePlan("trip-a", new Date("2026-05-19T00:00:00.000Z"));

    await repository.save({
      id: "member_route_shared",
      tripId: "trip-a",
      userId: "alice",
      displayName: "Alice",
      routePlan,
    });

    assert.equal(await repository.findById("trip-b", "member_route_shared"), null);
    assert.notEqual(await repository.findById("trip-a", "member_route_shared"), null);

    await repository.remove("trip-b", "member_route_shared");
    assert.notEqual(await repository.findById("trip-a", "member_route_shared"), null);

    await repository.remove("trip-a", "member_route_shared");
    assert.equal(await repository.findById("trip-a", "member_route_shared"), null);
  });
});
