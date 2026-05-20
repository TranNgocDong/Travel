export type LiveSyncEventType = "expense_created" | "member_changed" | "route_plan_updated" | "location_updated" | "location_stopped";

export interface LiveSyncEvent {
  id: string;
  tripId: string;
  type: LiveSyncEventType;
  actorUserId: string;
  createdAt: string;
}

export interface LiveSyncClient {
  id: string;
  tripId: string;
  userId: string;
  send(event: LiveSyncEvent): void;
}

export class LiveSyncHub {
  private readonly clientsByTrip = new Map<string, Map<string, LiveSyncClient>>();

  add(client: LiveSyncClient): () => void {
    const clients = this.clientsByTrip.get(client.tripId) ?? new Map<string, LiveSyncClient>();
    clients.set(client.id, client);
    this.clientsByTrip.set(client.tripId, clients);

    return () => {
      clients.delete(client.id);

      if (!clients.size) {
        this.clientsByTrip.delete(client.tripId);
      }
    };
  }

  publish(input: Omit<LiveSyncEvent, "id" | "createdAt">): LiveSyncEvent {
    const event: LiveSyncEvent = {
      ...input,
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      createdAt: new Date().toISOString(),
    };

    for (const client of this.clientsByTrip.get(input.tripId)?.values() ?? []) {
      client.send(event);
    }

    return event;
  }

  count(tripId: string): number {
    return this.clientsByTrip.get(tripId)?.size ?? 0;
  }
}
