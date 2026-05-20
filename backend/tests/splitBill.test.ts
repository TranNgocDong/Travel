import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { calculateSplitBill, SplitBillError, type CurrencyDefinition, type Participant } from "../src/expense/splitBill.js";

const participants: Participant[] = [
  { id: "alice", displayName: "Alice" },
  { id: "bao", displayName: "Bao" },
  { id: "chi", displayName: "Chi" },
  { id: "duy", displayName: "Duy" },
];

const currencies: CurrencyDefinition[] = [
  { code: "VND", minorUnit: 0 },
  { code: "USD", minorUnit: 2 },
  { code: "CNY", minorUnit: 2 },
];

describe("calculateSplitBill", () => {
  it("splits a VND expense equally and minimizes settlements", () => {
    const result = calculateSplitBill({
      participants,
      currencies,
      tripCurrency: "VND",
      fxRates: [],
      expenses: [
        {
          id: "hotel-1",
          paidByUserId: "alice",
          money: { amount: "1000000", currency: "VND" },
          split: { type: "equal", userIds: ["alice", "bao", "chi", "duy"] },
        },
      ],
    });

    assert.deepEqual(result.balances, [
      { userId: "alice", balanceMinor: "750000", currency: "VND" },
      { userId: "bao", balanceMinor: "-250000", currency: "VND" },
      { userId: "chi", balanceMinor: "-250000", currency: "VND" },
      { userId: "duy", balanceMinor: "-250000", currency: "VND" },
    ]);

    assert.deepEqual(result.settlements, [
      { fromUserId: "bao", toUserId: "alice", amountMinor: "250000", currency: "VND" },
      { fromUserId: "chi", toUserId: "alice", amountMinor: "250000", currency: "VND" },
      { fromUserId: "duy", toUserId: "alice", amountMinor: "250000", currency: "VND" },
    ]);
  });

  it("converts multiple currencies into the trip currency before settling", () => {
    const result = calculateSplitBill({
      participants: participants.slice(0, 2),
      currencies,
      tripCurrency: "VND",
      fxRates: [
        { from: "USD", to: "VND", rate: "25000" },
        { from: "CNY", to: "VND", rate: "3500" },
      ],
      expenses: [
        {
          id: "fuel-usd",
          paidByUserId: "alice",
          money: { amount: "100.00", currency: "USD" },
          split: { type: "equal", userIds: ["alice", "bao"] },
        },
        {
          id: "food-cny",
          paidByUserId: "bao",
          money: { amount: "200.00", currency: "CNY" },
          split: { type: "equal", userIds: ["alice", "bao"] },
        },
      ],
    });

    assert.deepEqual(result.balances, [
      { userId: "alice", balanceMinor: "900000", currency: "VND" },
      { userId: "bao", balanceMinor: "-900000", currency: "VND" },
    ]);

    assert.deepEqual(result.settlements, [
      { fromUserId: "bao", toUserId: "alice", amountMinor: "900000", currency: "VND" },
    ]);
  });

  it("supports percentage splits", () => {
    const result = calculateSplitBill({
      participants: participants.slice(0, 2),
      currencies,
      tripCurrency: "VND",
      fxRates: [],
      expenses: [
        {
          id: "repair",
          paidByUserId: "alice",
          money: { amount: "1000", currency: "VND" },
          split: {
            type: "percentage",
            shares: [
              { userId: "alice", percentage: "70" },
              { userId: "bao", percentage: "30" },
            ],
          },
        },
      ],
    });

    assert.deepEqual(result.balances, [
      { userId: "alice", balanceMinor: "300", currency: "VND" },
      { userId: "bao", balanceMinor: "-300", currency: "VND" },
    ]);
  });

  it("handles rounding without losing money", () => {
    const result = calculateSplitBill({
      participants: participants.slice(0, 3),
      currencies,
      tripCurrency: "VND",
      fxRates: [],
      expenses: [
        {
          id: "snack",
          paidByUserId: "alice",
          money: { amount: "100", currency: "VND" },
          split: {
            type: "share",
            shares: [
              { userId: "alice", shares: "1" },
              { userId: "bao", shares: "1" },
              { userId: "chi", shares: "1" },
            ],
          },
        },
      ],
    });

    assert.deepEqual(result.balances, [
      { userId: "alice", balanceMinor: "66", currency: "VND" },
      { userId: "bao", balanceMinor: "-33", currency: "VND" },
      { userId: "chi", balanceMinor: "-33", currency: "VND" },
    ]);
  });

  it("rejects fixed splits that do not add up to the expense total", () => {
    assert.throws(
      () =>
        calculateSplitBill({
          participants: participants.slice(0, 2),
          currencies,
          tripCurrency: "VND",
          fxRates: [],
          expenses: [
            {
              id: "hotel",
              paidByUserId: "alice",
              money: { amount: "1000", currency: "VND" },
              split: {
                type: "fixed",
                amounts: [
                  { userId: "alice", amount: "400", currency: "VND" },
                  { userId: "bao", amount: "500", currency: "VND" },
                ],
              },
            },
          ],
        }),
      (error: unknown) => error instanceof SplitBillError && error.code === "FIXED_SPLIT_MISMATCH",
    );
  });

  it("rejects expenses for users outside the trip", () => {
    assert.throws(
      () =>
        calculateSplitBill({
          participants: participants.slice(0, 2),
          currencies,
          tripCurrency: "VND",
          fxRates: [],
          expenses: [
            {
              id: "unknown",
              paidByUserId: "not-in-trip",
              money: { amount: "1000", currency: "VND" },
              split: { type: "equal", userIds: ["alice", "bao"] },
            },
          ],
        }),
      (error: unknown) => error instanceof SplitBillError && error.code === "UNKNOWN_USER",
    );
  });
});
