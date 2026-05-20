import type { CurrencyDefinition, FxRate } from "./splitBill.js";

export const supportedCurrencies: CurrencyDefinition[] = [
  { code: "VND", minorUnit: 0 },
  { code: "USD", minorUnit: 2 },
  { code: "CNY", minorUnit: 2 },
  { code: "LAK", minorUnit: 0 },
];

export const defaultFxRates: FxRate[] = [
  { from: "USD", to: "VND", rate: "25400" },
  { from: "CNY", to: "VND", rate: "3520" },
  { from: "LAK", to: "VND", rate: "1.15" },
];
