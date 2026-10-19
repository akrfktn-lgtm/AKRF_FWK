const MONEY = /^\d{1,12}(\.\d{1,2})?$/;

export const FINANCIAL_KINDS = ["income", "expense"];

/** Blank counts as 0; returns null for anything that is not a non-negative RM amount (max 2 decimals). */
export function parseRm(value) {
  const text = String(value ?? "").trim().replace(/^RM\s*/i, "");
  if (text === "") return 0;
  return MONEY.test(text) ? Number(text) : null;
}

/** Answer key holding one child CURRENCY_RM input of a financial question. */
export function financialItemKey(questionId, itemId) {
  return `${questionId}-item-${itemId}`;
}

/**
 * Brackets are half-open: min_percent <= utilization < max_percent (null max = open-ended).
 * @param {number} percentage
 * @param {{ min: number, max: number | null, score: number }[]} thresholds
 * @returns {number | null} score 1-5, or null when no bracket matches
 */
export function scoreForUtilization(percentage, thresholds) {
  const match = [...(thresholds ?? [])]
    .sort((first, second) => second.min - first.min)
    .find((band) => percentage >= band.min && (band.max == null || percentage < band.max));
  return match ? match.score : null;
}

/**
 * @param {{ id: string, kind: "income" | "expense" }[]} items
 * @param {Record<string, string>} answers
 * @param {{ min: number, max: number | null, score: number }[]} thresholds
 * @returns {{ totalIncome: number, totalExpense: number, utilizationPercentage: number, score: number | null, invalidItemIds: string[] }}
 */
export function evaluateFinancialQuestion(questionId, items, answers, thresholds) {
  let totalIncome = 0;
  let totalExpense = 0;
  const invalidItemIds = [];
  for (const item of items ?? []) {
    const amount = parseRm(answers?.[financialItemKey(questionId, item.id)]);
    if (amount === null) { invalidItemIds.push(item.id); continue; }
    if (item.kind === "income") totalIncome += amount;
    else totalExpense += amount;
  }
  totalIncome = Math.round(totalIncome * 100) / 100;
  totalExpense = Math.round(totalExpense * 100) / 100;
  const utilizationPercentage = totalIncome > 0 ? Math.round(totalExpense / totalIncome * 10000) / 100 : 0;
  return { totalIncome, totalExpense, utilizationPercentage, score: scoreForUtilization(utilizationPercentage, thresholds), invalidItemIds };
}

/** Admin threshold validation: sorted, contiguous-or-gapped is allowed, but overlaps and bad scores are not. */
export function validateThresholds(thresholds) {
  const bands = [...(thresholds ?? [])].sort((first, second) => first.min - second.min);
  if (!bands.length) return "Tetapkan sekurang-kurangnya satu julat.";
  for (const [index, band] of bands.entries()) {
    if (!Number.isFinite(band.min) || band.min < 0) return "Peratus minimum mesti 0 atau lebih.";
    if (band.max != null && (!Number.isFinite(band.max) || band.max <= band.min)) return "Peratus maksimum mesti lebih besar daripada minimum.";
    if (!Number.isInteger(band.score) || band.score < 1 || band.score > 5) return "Skor mesti antara 1 hingga 5.";
    const next = bands[index + 1];
    if (next && (band.max == null || band.max > next.min)) return "Julat tidak boleh bertindih.";
  }
  return null;
}
