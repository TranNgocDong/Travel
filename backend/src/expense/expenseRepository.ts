import type { ExpenseInput } from "./splitBill.js";

export interface StoredExpense extends ExpenseInput {
  title: string;
  category: string;
  createdAt: string;
}

export interface ExpenseRepository {
  listByTrip(tripId: string): Promise<StoredExpense[]>;
  add(tripId: string, expense: StoredExpense): Promise<StoredExpense>;
}

export class DuplicateExpenseIdError extends Error {
  constructor() {
    super("Expense id already belongs to another trip");
    this.name = "DuplicateExpenseIdError";
  }
}

export class InMemoryExpenseRepository implements ExpenseRepository {
  private readonly expensesByTrip = new Map<string, StoredExpense[]>();

  /**
   * Lists expenses for one trip from the in-memory store.
   */
  async listByTrip(tripId: string): Promise<StoredExpense[]> {
    return [...(this.expensesByTrip.get(tripId) ?? [])];
  }

  /**
   * Adds an expense in memory and rejects mutation-id reuse across different
   * trips.
   */
  async add(tripId: string, expense: StoredExpense): Promise<StoredExpense> {
    for (const [storedTripId, expenses] of this.expensesByTrip.entries()) {
      const existing = expenses.find((item) => item.id === expense.id);

      if (!existing) {
        continue;
      }

      if (storedTripId !== tripId) {
        throw new DuplicateExpenseIdError();
      }

      return existing;
    }

    const current = this.expensesByTrip.get(tripId) ?? [];
    this.expensesByTrip.set(tripId, [expense, ...current]);
    return expense;
  }
}
