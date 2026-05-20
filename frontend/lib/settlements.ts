export type CurrencyCode = "VND" | "USD" | "CNY";

export type Member = {
  id: string;
  name: string;
  initials: string;
};

export type SplitMode = "equal" | "percent" | "share";

export type Expense = {
  id: string;
  title: string;
  category: string;
  payerId: string;
  amount: number;
  currency: CurrencyCode;
  splitMode: SplitMode;
  participantIds: string[];
  splitValues: Record<string, number>;
  createdAt: string;
};

export type Settlement = {
  fromId: string;
  toId: string;
  amountVnd: number;
};

export type Balance = {
  memberId: string;
  amountVnd: number;
};

export const currencyRatesToVnd: Record<CurrencyCode, number> = {
  VND: 1,
  USD: 25000,
  CNY: 3500,
};

export function toVnd(amount: number, currency: CurrencyCode): number {
  return Math.round(amount * currencyRatesToVnd[currency]);
}

export function formatMoney(amount: number, currency: CurrencyCode = "VND"): string {
  return new Intl.NumberFormat("vi-VN", {
    style: "currency",
    currency,
    maximumFractionDigits: currency === "VND" ? 0 : 2,
  }).format(amount);
}

export function calculateBalances(members: Member[], expenses: Expense[]): Balance[] {
  const balances = new Map(members.map((member) => [member.id, 0]));

  for (const expense of expenses) {
    const totalVnd = toVnd(expense.amount, expense.currency);
    balances.set(expense.payerId, (balances.get(expense.payerId) ?? 0) + totalVnd);

    const owedAmounts = calculateOwedAmounts(expense, totalVnd);

    for (const [memberId, owedVnd] of Object.entries(owedAmounts)) {
      balances.set(memberId, (balances.get(memberId) ?? 0) - owedVnd);
    }
  }

  return [...balances.entries()]
    .map(([memberId, amountVnd]) => ({ memberId, amountVnd }))
    .filter((balance) => balance.amountVnd !== 0)
    .sort((left, right) => right.amountVnd - left.amountVnd);
}

export function calculateSettlements(balances: Balance[]): Settlement[] {
  const creditors = balances
    .filter((balance) => balance.amountVnd > 0)
    .map((balance) => ({ ...balance }))
    .sort((left, right) => right.amountVnd - left.amountVnd);

  const debtors = balances
    .filter((balance) => balance.amountVnd < 0)
    .map((balance) => ({ ...balance, amountVnd: Math.abs(balance.amountVnd) }))
    .sort((left, right) => right.amountVnd - left.amountVnd);

  const settlements: Settlement[] = [];
  let debtorIndex = 0;
  let creditorIndex = 0;

  while (debtorIndex < debtors.length && creditorIndex < creditors.length) {
    const debtor = debtors[debtorIndex];
    const creditor = creditors[creditorIndex];

    if (!debtor || !creditor) {
      break;
    }

    const amountVnd = Math.min(debtor.amountVnd, creditor.amountVnd);

    if (amountVnd > 0) {
      settlements.push({
        fromId: debtor.memberId,
        toId: creditor.memberId,
        amountVnd,
      });
    }

    debtor.amountVnd -= amountVnd;
    creditor.amountVnd -= amountVnd;

    if (debtor.amountVnd === 0) {
      debtorIndex += 1;
    }

    if (creditor.amountVnd === 0) {
      creditorIndex += 1;
    }
  }

  return settlements;
}

function calculateOwedAmounts(expense: Expense, totalVnd: number): Record<string, number> {
  if (expense.participantIds.length === 0) {
    return {};
  }

  if (expense.splitMode === "equal") {
    return allocateByWeights(totalVnd, expense.participantIds.map((id) => [id, 1]));
  }

  if (expense.splitMode === "percent") {
    return allocateByWeights(
      totalVnd,
      expense.participantIds.map((id) => [id, Math.max(0, expense.splitValues[id] ?? 0)]),
    );
  }

  const shareEntries = expense.participantIds.map((id) => [id, Math.max(0, expense.splitValues[id] ?? 0)] as const);
  const shareTotal = shareEntries.reduce((sum, [, amount]) => sum + amount, 0);

  if (shareTotal <= 0) {
    return allocateByWeights(totalVnd, expense.participantIds.map((id) => [id, 1]));
  }

  return allocateByWeights(totalVnd, shareEntries);
}

function allocateByWeights(total: number, weights: ReadonlyArray<readonly [string, number]>): Record<string, number> {
  const weightTotal = weights.reduce((sum, [, weight]) => sum + weight, 0);

  if (weightTotal <= 0) {
    return {};
  }

  const provisional = weights.map(([id, weight]) => {
    const raw = (total * weight) / weightTotal;
    const amount = Math.floor(raw);

    return {
      id,
      amount,
      remainder: raw - amount,
    };
  });

  let missing = total - provisional.reduce((sum, item) => sum + item.amount, 0);

  for (const item of [...provisional].sort((left, right) => right.remainder - left.remainder)) {
    if (missing <= 0) {
      break;
    }

    item.amount += 1;
    missing -= 1;
  }

  return Object.fromEntries(provisional.map((item) => [item.id, item.amount]));
}
