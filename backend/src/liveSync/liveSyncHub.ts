export type LiveSyncEventType =
  | "expense_created"
  | "member_changed"
  | "route_plan_updated"
  | "message_created"
  | "map_marker_changed"
  | "location_updated"
  | "location_stopped"
  | "presence_joined"
  | "presence_left";

export interface LiveSyncEvent {
  id: string;
  tripId: string;
  type: LiveSyncEventType;
  actorUserId: string;
  actorDisplayName?: string;
  createdAt: string;
}

export interface LiveSyncClient {
  id: string;
  tripId: string;
  userId: string;
  displayName: string;
  connectedAt: string;
  send(event: LiveSyncEvent): void;
}

export interface LiveSyncPresence {
  userId: string;
  displayName: string;
  onlineSince: string;
  connectionCount: number;
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

  hasUser(tripId: string, userId: string): boolean {
    for (const client of this.clientsByTrip.get(tripId)?.values() ?? []) {
      if (client.userId === userId) {
        return true;
      }
    }

    return false;
  }

  listPresence(tripId: string): LiveSyncPresence[] {
    const presenceByUser = new Map<string, LiveSyncPresence>();

    for (const client of this.clientsByTrip.get(tripId)?.values() ?? []) {
      const current = presenceByUser.get(client.userId);

      if (!current) {
        presenceByUser.set(client.userId, {
          userId: client.userId,
          displayName: client.displayName,
          onlineSince: client.connectedAt,
          connectionCount: 1,
        });
        continue;
      }

      current.connectionCount += 1;

      if (Date.parse(client.connectedAt) < Date.parse(current.onlineSince)) {
        current.onlineSince = client.connectedAt;
      }
    }

    return [...presenceByUser.values()].sort((left, right) => Date.parse(left.onlineSince) - Date.parse(right.onlineSince));
  }
}
