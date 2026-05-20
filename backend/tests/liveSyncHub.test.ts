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
      displayName: "User One",
      connectedAt: "2026-05-20T10:00:00.000Z",
      send: (event) => tripEvents.push(event),
    });
    hub.add({
      id: "client-2",
      tripId: "trip-2",
      userId: "user-2",
      displayName: "User Two",
      connectedAt: "2026-05-20T10:00:00.000Z",
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

  it("deduplicates online presence by user", () => {
    const hub = new LiveSyncHub();
    const send = () => undefined;

    const removeFirst = hub.add({
      id: "client-1",
      tripId: "trip-1",
      userId: "user-1",
      displayName: "User One",
      connectedAt: "2026-05-20T10:00:00.000Z",
      send,
    });
    hub.add({
      id: "client-2",
      tripId: "trip-1",
      userId: "user-1",
      displayName: "User One",
      connectedAt: "2026-05-20T10:01:00.000Z",
      send,
    });

    assert.equal(hub.hasUser("trip-1", "user-1"), true);
    assert.deepEqual(hub.listPresence("trip-1"), [
      {
        userId: "user-1",
        displayName: "User One",
        onlineSince: "2026-05-20T10:00:00.000Z",
        connectionCount: 2,
      },
    ]);

    removeFirst();
    assert.equal(hub.hasUser("trip-1", "user-1"), true);
    assert.equal(hub.listPresence("trip-1")[0]?.connectionCount, 1);
  });
});
