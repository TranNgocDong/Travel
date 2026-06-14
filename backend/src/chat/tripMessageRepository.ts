import type { Pool } from "pg";

export interface TripMessage {
  id: string;
  tripId: string;
  userId: string;
  displayName: string;
  body: string;
  createdAt: string;
}

export interface CreateTripMessageInput {
  id: string;
  tripId: string;
  userId: string;
  displayName: string;
  body: string;
  createdAt?: Date;
}

export interface TripMessageRepository {
  listByTrip(tripId: string, limit?: number): Promise<TripMessage[]>;
  create(input: CreateTripMessageInput): Promise<TripMessage>;
}

export class InMemoryTripMessageRepository implements TripMessageRepository {
  private readonly messagesByTrip = new Map<string, TripMessage[]>();

  /**
   * Returns the latest in-memory chat messages for a trip.
   */
  async listByTrip(tripId: string, limit = 50): Promise<TripMessage[]> {
    const messages = this.messagesByTrip.get(tripId) ?? [];
    return messages.slice(Math.max(0, messages.length - limit));
  }

  /**
   * Appends a chat message in memory for local/demo runs.
   */
  async create(input: CreateTripMessageInput): Promise<TripMessage> {
    const message: TripMessage = {
      id: input.id,
      tripId: input.tripId,
      userId: input.userId,
      displayName: input.displayName,
      body: input.body,
      createdAt: (input.createdAt ?? new Date()).toISOString(),
    };
    const current = this.messagesByTrip.get(input.tripId) ?? [];
    this.messagesByTrip.set(input.tripId, [...current, message]);
    return message;
  }
}

export class PostgresTripMessageRepository implements TripMessageRepository {
  constructor(private readonly pool: Pool) {}

  /**
   * Loads recent chat messages in chronological order for the room window.
   */
  async listByTrip(tripId: string, limit = 50): Promise<TripMessage[]> {
    const safeLimit = Math.max(1, Math.min(100, Math.trunc(limit)));
    const result = await this.pool.query<MessageRow>(
      `
        SELECT id, trip_id, user_id, display_name, body, created_at
        FROM (
          SELECT id, trip_id, user_id, display_name, body, created_at
          FROM trip_messages
          WHERE trip_id = $1
          ORDER BY created_at DESC, id DESC
          LIMIT $2
        ) recent
        ORDER BY created_at ASC, id ASC
      `,
      [tripId, safeLimit],
    );

    return result.rows.map(rowToMessage);
  }

  /**
   * Persists a chat message to PostgreSQL.
   */
  async create(input: CreateTripMessageInput): Promise<TripMessage> {
    const result = await this.pool.query<MessageRow>(
      `
        INSERT INTO trip_messages (id, trip_id, user_id, display_name, body, created_at)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING id, trip_id, user_id, display_name, body, created_at
      `,
      [input.id, input.tripId, input.userId, input.displayName, input.body, input.createdAt ?? new Date()],
    );

    return rowToMessage(result.rows[0]!);
  }
}

interface MessageRow {
  id: string;
  trip_id: string;
  user_id: string;
  display_name: string;
  body: string;
  created_at: Date | string;
}

/**
 * Converts a PostgreSQL message row into the API chat model.
 */
function rowToMessage(row: MessageRow): TripMessage {
  return {
    id: row.id,
    tripId: row.trip_id,
    userId: row.user_id,
    displayName: row.display_name,
    body: row.body,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : new Date(row.created_at).toISOString(),
  };
}
