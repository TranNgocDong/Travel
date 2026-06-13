export type UserId = string;
export type CurrencyCode = string;

export interface CurrencyDefinition {
  code: CurrencyCode;
  minorUnit: number;
}

export interface FxRate {
  from: CurrencyCode;
  to: CurrencyCode;
  rate: string;
}

export interface Participant {
  id: UserId;
  displayName?: string;
}

export interface MoneyInput {
  amount: string;
  currency: CurrencyCode;
}

export type ExpenseSplit =
  | {
      type: "equal";
      userIds: UserId[];
    }
  | {
      type: "fixed";
      amounts: Array<MoneyInput & { userId: UserId }>;
    }
  | {
      type: "percentage";
      shares: Array<{ userId: UserId; percentage: string }>;
    }
  | {
      type: "share";
      shares: Array<{ userId: UserId; shares: string }>;
    };

export interface ExpenseInput {
  id: string;
  paidByUserId: UserId;
  money: MoneyInput;
  split: ExpenseSplit;
}

export interface Settlement {
  fromUserId: UserId;
  toUserId: UserId;
  amountMinor: string;
  currency: CurrencyCode;
}

export interface UserBalance {
  userId: UserId;
  balanceMinor: string;
  currency: CurrencyCode;
}

export interface SplitBillResult {
  balances: UserBalance[];
  settlements: Settlement[];
}

export class SplitBillError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "SplitBillError";
  }
}

interface ParsedDecimal {
  numerator: bigint;
  denominator: bigint;
  fractionDigits: number;
}

interface AllocationInput {
  userId: UserId;
  weight: bigint;
}

const WEIGHT_SCALE = 10_000;

export function calculateSplitBill(input: {
  participants: Participant[];
  tripCurrency: CurrencyCode;
  currencies: CurrencyDefinition[];
  fxRates: FxRate[];
  expenses: ExpenseInput[];
}): SplitBillResult {
  // Money is calculated in minor units with bigint, never with floating-point numbers.
  // This avoids rounding bugs such as 0.1 + 0.2 and keeps split-bill results exact.
  const participantIds = new Set(input.participants.map((participant) => participant.id));
  const currencyByCode = new Map(input.currencies.map((currency) => [currency.code, currency]));
  const balances = new Map<UserId, bigint>();

  assertUniqueParticipants(input.participants);
  assertCurrencyExists(currencyByCode, input.tripCurrency);

  for (const participant of input.participants) {
    balances.set(participant.id, 0n);
  }

  for (const expense of input.expenses) {
    assertKnownUser(participantIds, expense.paidByUserId, `Unknown payer "${expense.paidByUserId}"`);

    // Convert every expense into the trip currency before changing balances.
    // This keeps settlements simple even when the group records VND, USD, CNY, etc.
    const totalMinor = convertToMinorUnits({
      money: expense.money,
      targetCurrency: input.tripCurrency,
      currencies: currencyByCode,
      fxRates: input.fxRates,
    });

    if (totalMinor <= 0n) {
      throw new SplitBillError("INVALID_AMOUNT", `Expense "${expense.id}" must be greater than zero`);
    }

    // The payer is credited first because they paid money on behalf of the group.
    balances.set(expense.paidByUserId, mustGetBalance(balances, expense.paidByUserId) + totalMinor);

    const owedAmounts = calculateOwedAmounts({
      totalMinor,
      split: expense.split,
      participantIds,
      tripCurrency: input.tripCurrency,
      currencies: currencyByCode,
      fxRates: input.fxRates,
    });

    for (const owed of owedAmounts) {
      // Each participant is debited by the portion they owe.
      balances.set(owed.userId, mustGetBalance(balances, owed.userId) - owed.amountMinor);
    }
  }

  const sortedBalances = [...balances.entries()]
    .filter(([, balance]) => balance !== 0n)
    .sort(([leftUserId], [rightUserId]) => leftUserId.localeCompare(rightUserId));

  return {
    balances: sortedBalances.map(([userId, balance]) => ({
      userId,
      balanceMinor: balance.toString(),
      currency: input.tripCurrency,
    })),
    settlements: minimizeSettlements(sortedBalances, input.tripCurrency),
  };
}

function calculateOwedAmounts(input: {
  totalMinor: bigint;
  split: ExpenseSplit;
  participantIds: Set<UserId>;
  tripCurrency: CurrencyCode;
  currencies: Map<CurrencyCode, CurrencyDefinition>;
  fxRates: FxRate[];
}): Array<{ userId: UserId; amountMinor: bigint }> {
  // Split modes are normalized into the same output shape:
  // a list of user ids and exact minor-unit amounts owed for this expense.
  switch (input.split.type) {
    case "equal": {
      assertNonEmpty(input.split.userIds, "Equal split must include at least one user");
      for (const userId of input.split.userIds) {
        assertKnownUser(input.participantIds, userId, `Unknown split user "${userId}"`);
      }

      return allocateByWeights(
        input.totalMinor,
        input.split.userIds.map((userId) => ({ userId, weight: 1n })),
      );
    }

    case "percentage": {
      assertNonEmpty(input.split.shares, "Percentage split must include at least one user");
      const weights = input.split.shares.map((share) => {
        assertKnownUser(input.participantIds, share.userId, `Unknown split user "${share.userId}"`);
        return {
          userId: share.userId,
          weight: parseDecimalWeight(share.percentage, "percentage"),
        };
      });

      const expectedTotal = BigInt(100 * WEIGHT_SCALE);
      const actualTotal = weights.reduce((sum, item) => sum + item.weight, 0n);

      if (actualTotal !== expectedTotal) {
        throw new SplitBillError("INVALID_PERCENTAGE_TOTAL", "Percentage split must add up to 100");
      }

      return allocateByWeights(input.totalMinor, weights);
    }

    case "share": {
      assertNonEmpty(input.split.shares, "Share split must include at least one user");
      const weights = input.split.shares.map((share) => {
        assertKnownUser(input.participantIds, share.userId, `Unknown split user "${share.userId}"`);
        return {
          userId: share.userId,
          weight: parseDecimalWeight(share.shares, "share"),
        };
      });

      return allocateByWeights(input.totalMinor, weights);
    }

    case "fixed": {
      assertNonEmpty(input.split.amounts, "Fixed split must include at least one user");
      const owedAmounts = input.split.amounts.map((fixedAmount) => {
        assertKnownUser(input.participantIds, fixedAmount.userId, `Unknown split user "${fixedAmount.userId}"`);
        return {
          userId: fixedAmount.userId,
          amountMinor: convertToMinorUnits({
            money: fixedAmount,
            targetCurrency: input.tripCurrency,
            currencies: input.currencies,
            fxRates: input.fxRates,
          }),
        };
      });

      const owedTotal = owedAmounts.reduce((sum, item) => sum + item.amountMinor, 0n);

      if (owedTotal !== input.totalMinor) {
        throw new SplitBillError("FIXED_SPLIT_MISMATCH", "Fixed split total must equal the expense total");
      }

      return owedAmounts;
    }
  }
}

function allocateByWeights(totalMinor: bigint, allocations: AllocationInput[]): Array<{ userId: UserId; amountMinor: bigint }> {
  const duplicateUserId = findDuplicate(allocations.map((allocation) => allocation.userId));

  if (duplicateUserId) {
    throw new SplitBillError("DUPLICATE_SPLIT_USER", `User "${duplicateUserId}" appears more than once in the split`);
  }

  const totalWeight = allocations.reduce((sum, allocation) => sum + allocation.weight, 0n);

  if (totalWeight <= 0n) {
    throw new SplitBillError("INVALID_SPLIT_WEIGHT", "Split weight total must be greater than zero");
  }

  // First divide by weight using integer division.
  // Remainders are tracked so leftover cents can be assigned deterministically.
  const provisional = allocations.map((allocation) => {
    const numerator = totalMinor * allocation.weight;
    return {
      userId: allocation.userId,
      amountMinor: numerator / totalWeight,
      remainder: numerator % totalWeight,
    };
  });

  let missingMinor = totalMinor - provisional.reduce((sum, item) => sum + item.amountMinor, 0n);
  const remainderOrder = [...provisional].sort((left, right) => {
    if (left.remainder === right.remainder) {
      return left.userId.localeCompare(right.userId);
    }

    return left.remainder > right.remainder ? -1 : 1;
  });

  // Distribute any missing minor units to the largest remainders.
  // userId tie-breakers make the result stable across runs.
  for (const item of remainderOrder) {
    if (missingMinor === 0n) {
      break;
    }

    item.amountMinor += 1n;
    missingMinor -= 1n;
  }

  return provisional
    .map((item) => ({ userId: item.userId, amountMinor: item.amountMinor }))
    .sort((left, right) => left.userId.localeCompare(right.userId));
}

function minimizeSettlements(balances: Array<[UserId, bigint]>, currency: CurrencyCode): Settlement[] {
  // Positive balances are people who should receive money.
  // Negative balances are people who should pay money.
  const creditors = balances
    .filter(([, balance]) => balance > 0n)
    .map(([userId, balance]) => ({ userId, amountMinor: balance }))
    .sort(sortByAmountDescThenUserId);

  const debtors = balances
    .filter(([, balance]) => balance < 0n)
    .map(([userId, balance]) => ({ userId, amountMinor: -balance }))
    .sort(sortByAmountDescThenUserId);

  const settlements: Settlement[] = [];
  let debtorIndex = 0;
  let creditorIndex = 0;

  // Greedy matching minimizes the number of payments enough for group trips:
  // the largest debtor pays the largest creditor until one side is settled.
  while (debtorIndex < debtors.length && creditorIndex < creditors.length) {
    const debtor = debtors[debtorIndex];
    const creditor = creditors[creditorIndex];

    if (!debtor || !creditor) {
      break;
    }

    const amountMinor = debtor.amountMinor < creditor.amountMinor ? debtor.amountMinor : creditor.amountMinor;

    if (amountMinor > 0n) {
      settlements.push({
        fromUserId: debtor.userId,
        toUserId: creditor.userId,
        amountMinor: amountMinor.toString(),
        currency,
      });
    }

    debtor.amountMinor -= amountMinor;
    creditor.amountMinor -= amountMinor;

    if (debtor.amountMinor === 0n) {
      debtorIndex += 1;
    }

    if (creditor.amountMinor === 0n) {
      creditorIndex += 1;
    }
  }

  return settlements;
}

function convertToMinorUnits(input: {
  money: MoneyInput;
  targetCurrency: CurrencyCode;
  currencies: Map<CurrencyCode, CurrencyDefinition>;
  fxRates: FxRate[];
}): bigint {
  const sourceCurrency = assertCurrencyExists(input.currencies, input.money.currency);
  const targetCurrency = assertCurrencyExists(input.currencies, input.targetCurrency);
  const moneyDecimal = parseDecimal(input.money.amount, sourceCurrency.minorUnit, "money amount");

  if (sourceCurrency.code === targetCurrency.code) {
    return decimalToMinorUnits(moneyDecimal, targetCurrency.minorUnit);
  }

  // FX conversion is performed with rational decimal pieces, then rounded half-up
  // once at the final target minor unit.
  const fxRate = findFxRate(input.fxRates, sourceCurrency.code, targetCurrency.code);
  const rateDecimal = parseDecimal(fxRate.rate, 12, "FX rate");
  const numerator = moneyDecimal.numerator * rateDecimal.numerator * 10n ** BigInt(targetCurrency.minorUnit);
  const denominator = moneyDecimal.denominator * rateDecimal.denominator;

  return divideAndRoundHalfUp(numerator, denominator);
}

function decimalToMinorUnits(decimal: ParsedDecimal, minorUnit: number): bigint {
  const numerator = decimal.numerator * 10n ** BigInt(minorUnit);
  return divideAndRoundHalfUp(numerator, decimal.denominator);
}

function parseDecimal(value: string, maxFractionDigits: number, label: string): ParsedDecimal {
  // Strict decimal parsing avoids accepting scientific notation, negative values, or locale commas.
  // That makes money validation predictable across browsers and regions.
  if (!/^(0|[1-9]\d*)(\.\d+)?$/.test(value)) {
    throw new SplitBillError("INVALID_DECIMAL", `Invalid ${label}: "${value}"`);
  }

  const [integerPart = "0", fractionPart = ""] = value.split(".");

  if (fractionPart.length > maxFractionDigits) {
    throw new SplitBillError(
      "TOO_MANY_DECIMALS",
      `${label} "${value}" has more than ${maxFractionDigits} decimal places`,
    );
  }

  const denominator = 10n ** BigInt(fractionPart.length);
  const numerator = BigInt(`${integerPart}${fractionPart || ""}`);

  return {
    numerator,
    denominator,
    fractionDigits: fractionPart.length,
  };
}

function parseDecimalWeight(value: string, label: string): bigint {
  const decimal = parseDecimal(value, 4, label);
  const numerator = decimal.numerator * BigInt(WEIGHT_SCALE);
  return divideExactly(numerator, decimal.denominator, `${label} "${value}" cannot be represented with 4 decimals`);
}

function divideAndRoundHalfUp(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= 0n) {
    throw new SplitBillError("INVALID_DENOMINATOR", "Denominator must be greater than zero");
  }

  return (numerator * 2n + denominator) / (denominator * 2n);
}

function divideExactly(numerator: bigint, denominator: bigint, message: string): bigint {
  if (denominator <= 0n) {
    throw new SplitBillError("INVALID_DENOMINATOR", "Denominator must be greater than zero");
  }

  if (numerator % denominator !== 0n) {
    throw new SplitBillError("INVALID_DECIMAL_SCALE", message);
  }

  return numerator / denominator;
}

function findFxRate(fxRates: FxRate[], from: CurrencyCode, to: CurrencyCode): FxRate {
  const direct = fxRates.find((rate) => rate.from === from && rate.to === to);

  if (direct) {
    return direct;
  }

  const reverse = fxRates.find((rate) => rate.from === to && rate.to === from);

  if (!reverse) {
    throw new SplitBillError("MISSING_FX_RATE", `Missing FX rate from ${from} to ${to}`);
  }

  return {
    from,
    to,
    rate: invertDecimal(reverse.rate),
  };
}

function invertDecimal(value: string): string {
  const decimal = parseDecimal(value, 12, "FX rate");

  if (decimal.numerator === 0n) {
    throw new SplitBillError("INVALID_FX_RATE", "FX rate cannot be zero");
  }

  const scale = 10n ** 12n;
  const numerator = decimal.denominator * scale;
  const inverted = divideAndRoundHalfUp(numerator, decimal.numerator);
  const integerPart = inverted / scale;
  const fractionPart = (inverted % scale).toString().padStart(12, "0").replace(/0+$/, "");

  return fractionPart ? `${integerPart}.${fractionPart}` : integerPart.toString();
}

function assertUniqueParticipants(participants: Participant[]): void {
  assertNonEmpty(participants, "At least one participant is required");

  const duplicateUserId = findDuplicate(participants.map((participant) => participant.id));

  if (duplicateUserId) {
    throw new SplitBillError("DUPLICATE_PARTICIPANT", `Duplicate participant "${duplicateUserId}"`);
  }
}

function assertKnownUser(participantIds: Set<UserId>, userId: UserId, message: string): void {
  if (!participantIds.has(userId)) {
    throw new SplitBillError("UNKNOWN_USER", message);
  }
}

function assertCurrencyExists(currencies: Map<CurrencyCode, CurrencyDefinition>, code: CurrencyCode): CurrencyDefinition {
  const currency = currencies.get(code);

  if (!currency) {
    throw new SplitBillError("UNKNOWN_CURRENCY", `Unknown currency "${code}"`);
  }

  if (!Number.isInteger(currency.minorUnit) || currency.minorUnit < 0 || currency.minorUnit > 12) {
    throw new SplitBillError("INVALID_CURRENCY", `Invalid minor unit for currency "${code}"`);
  }

  return currency;
}

function assertNonEmpty<T>(items: T[], message: string): void {
  if (items.length === 0) {
    throw new SplitBillError("EMPTY_LIST", message);
  }
}

function findDuplicate(items: string[]): string | null {
  const seen = new Set<string>();

  for (const item of items) {
    if (seen.has(item)) {
      return item;
    }

    seen.add(item);
  }

  return null;
}

function mustGetBalance(balances: Map<UserId, bigint>, userId: UserId): bigint {
  const balance = balances.get(userId);

  if (balance === undefined) {
    throw new SplitBillError("UNKNOWN_USER", `Unknown balance user "${userId}"`);
  }

  return balance;
}

function sortByAmountDescThenUserId(
  left: { userId: UserId; amountMinor: bigint },
  right: { userId: UserId; amountMinor: bigint },
): number {
  if (left.amountMinor === right.amountMinor) {
    return left.userId.localeCompare(right.userId);
  }

  return left.amountMinor > right.amountMinor ? -1 : 1;
}
