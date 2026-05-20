import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { LiveSyncHub, type LiveSyncEvent } from "../src/liveSync/liveSyncHub.js";

describe("LiveSyncHub", () => {
  it("publishes trip events only to subscribed trip clients", () => {
    const hub = new LiveSyncHub();
    const tripEvents: LiveSyncEvent[] = [];
    const otherTripEvents: LiveSyncEvent[] = [];

    const removeTripClient = hub.add({
      id: "client-1",
      tripId: "trip-1",
      userId: "user-1",
      send: (event) => tripEvents.push(event),
    });
    hub.add({
      id: "client-2",
      tripId: "trip-2",
      userId: "user-2",
      send: (event) => otherTripEvents.push(event),
    });

    assert.equal(hub.count("trip-1"), 1);

    const event = hub.publish({
      tripId: "trip-1",
      actorUserId: "user-1",
      type: "expense_created",
    });

    assert.equal(tripEvents.length, 1);
    assert.equal(tripEvents[0]?.id, event.id);
    assert.equal(otherTripEvents.length, 0);

    removeTripClient();
    assert.equal(hub.count("trip-1"), 0);
  });
});
