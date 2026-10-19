import assert from "node:assert/strict";
import test from "node:test";
import { evaluateFinancialQuestion, parseRm, scoreForUtilization, validateThresholds } from "../src/lib/financial.mjs";

const thresholds = [
  { min: 0, max: 50, score: 5 },
  { min: 50, max: 70, score: 4 },
  { min: 70, max: 100, score: 2 },
  { min: 100, max: null, score: 1 },
];
const items = [
  { id: "a", kind: "income" },
  { id: "b", kind: "income" },
  { id: "c", kind: "expense" },
];

test("parseRm accepts blank and RM amounts, rejects negatives", () => {
  assert.equal(parseRm(""), 0);
  assert.equal(parseRm("RM 12.50"), 12.5);
  assert.equal(parseRm("-1"), null);
  assert.equal(parseRm("1.234"), null);
});

test("sums income and expense and maps utilization to a score", () => {
  const result = evaluateFinancialQuestion("Q", items, { "Q-item-a": "600", "Q-item-b": "400", "Q-item-c": "500" }, thresholds);
  assert.deepEqual([result.totalIncome, result.totalExpense, result.utilizationPercentage, result.score], [1000, 500, 50, 4]);
});

test("zero income gives 0% utilization", () => {
  const result = evaluateFinancialQuestion("Q", items, { "Q-item-c": "500" }, thresholds);
  assert.equal(result.utilizationPercentage, 0);
  assert.equal(result.score, 5);
});

test("flags invalid amounts", () => {
  assert.deepEqual(evaluateFinancialQuestion("Q", items, { "Q-item-a": "abc" }, thresholds).invalidItemIds, ["a"]);
});

test("bracket boundaries are min-inclusive, max-exclusive; open-ended top band", () => {
  assert.equal(scoreForUtilization(70, thresholds), 2);
  assert.equal(scoreForUtilization(150, thresholds), 1);
});

test("validateThresholds rejects overlaps", () => {
  assert.equal(validateThresholds(thresholds), null);
  assert.ok(validateThresholds([{ min: 0, max: 60, score: 5 }, { min: 50, max: null, score: 1 }]));
});
