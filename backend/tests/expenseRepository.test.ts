import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { DuplicateExpenseIdError, InMemoryExpenseRepository, type StoredExpense } from "../src/expense/expenseRepository.js";

describe("expense repository", () => {
  it("returns the existing expense when the same id is retried for the same trip", async () => {
    const repository = new InMemoryExpenseRepository();
    const expense = createExpense("offline-expense-1");

    await repository.add("trip-a", expense);
    const retried = await repository.add("trip-a", {
      ...expense,
      title: "Retried title should not replace original",
    });

    assert.equal(retried.title, "Offline fuel");
    assert.equal((await repository.listByTrip("trip-a")).length, 1);
  });

  it("rejects an expense id that belongs to another trip", async () => {
    const repository = new InMemoryExpenseRepository();
    const expense = createExpense("offline-expense-2");

    await repository.add("trip-a", expense);

    await assert.rejects(() => repository.add("trip-b", expense), DuplicateExpenseIdError);
  });
});

function createExpense(id: string): StoredExpense {
  return {
    id,
    title: "Offline fuel",
    category: "fuel",
    paidByUserId: "alice",
    money: {
      amount: "100000",
      currency: "VND",
    },
    split: {
      type: "equal",
      userIds: ["alice"],
    },
    createdAt: "Offline",
  };
}
