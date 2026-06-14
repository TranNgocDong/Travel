import type { Pool } from "pg";

import { DuplicateExpenseIdError, type ExpenseRepository, type StoredExpense } from "./expenseRepository.js";
import type { ExpenseSplit } from "./splitBill.js";

interface ExpenseRow {
  id: string;
  title: string;
  category: string;
  paid_by_user_id: string;
  amount: string;
  currency_code: string;
  split: ExpenseSplit;
  created_at: Date;
}

export class PostgresExpenseRepository implements ExpenseRepository {
  constructor(private readonly pool: Pool) {}

  /**
   * Lists persisted expenses for a trip, newest first.
   */
  async listByTrip(tripId: string): Promise<StoredExpense[]> {
    const result = await this.pool.query<ExpenseRow>(
      `
        SELECT id, title, category, paid_by_user_id, amount, currency_code, split, created_at
        FROM expenses
        WHERE trip_id = $1
        ORDER BY created_at DESC
      `,
      [tripId],
    );

    return result.rows.map(rowToExpense);
  }

  /**
   * Persists an expense idempotently using the client mutation id as the primary
   * key.
   */
  async add(tripId: string, expense: StoredExpense): Promise<StoredExpense> {
    // Expense ids are clientMutationIds when the browser retries offline expenses.
    // ON CONFLICT makes repeated submissions idempotent for the same trip, but rejects the same id on another trip.
    const result = await this.pool.query<ExpenseRow>(
      `
        INSERT INTO expenses (id, trip_id, title, category, paid_by_user_id, amount, currency_code, split, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now())
        ON CONFLICT (id) DO UPDATE
        SET id = expenses.id
        WHERE expenses.trip_id = EXCLUDED.trip_id
        RETURNING id, title, category, paid_by_user_id, amount, currency_code, split, created_at
      `,
      [
        expense.id,
        tripId,
        expense.title,
        expense.category,
        expense.paidByUserId,
        expense.money.amount,
        expense.money.currency,
        JSON.stringify(expense.split),
      ],
    );

    const row = result.rows[0];

    if (!row) {
      // The id already exists for a different trip, so treating it as a duplicate avoids cross-trip data leaks.
      throw new DuplicateExpenseIdError();
    }

    return rowToExpense(row);
  }
}

/**
 * Converts a Postgres expense row into the API/domain shape.
 */
function rowToExpense(row: ExpenseRow): StoredExpense {
  // Convert database column names and numeric strings into the API shape expected by the frontend.
  // Amount stays a string to avoid floating-point rounding issues in money calculations.
  return {
    id: row.id,
    title: row.title,
    category: row.category,
    paidByUserId: row.paid_by_user_id,
    money: {
      amount: trimNumeric(row.amount),
      currency: row.currency_code,
    },
    split: row.split,
    createdAt: new Intl.DateTimeFormat("vi-VN", {
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "Asia/Saigon",
    }).format(row.created_at),
  };
}

/**
 * Removes unnecessary trailing decimal zeros from Postgres numeric strings.
 */
function trimNumeric(value: string): string {
  return value.includes(".") ? value.replace(/\.?0+$/, "") : value;
}
