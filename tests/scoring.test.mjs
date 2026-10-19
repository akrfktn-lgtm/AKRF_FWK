import test from "node:test";
import assert from "node:assert/strict";
import {
  appendQuestionScoreRange,
  calculateScore,
  deriveSectionWeights,
  fieldQuestionScore,
  isValidObjectiveOptions,
  numericInputMaximum,
  objectiveOptionForValue,
  overallScore,
  scoreRangeForValue,
  sectionScore,
  sectionWeights,
  topicScore,
} from "../src/lib/scoring.mjs";

test("chained percentage scoring supports higher-is-better tiers", () => {
  const question = {
    id: "workers",
    max: 10,
    parentQuestionId: "total-workers",
    direction: "higher-is-better",
    percentageThresholds: [
      { min: 80, max: null, score: 100 },
      { min: 50, max: 79.99, score: 50 },
    ],
  };
  assert.equal(calculateScore(question, "80", { "total-workers": "100" }), 10);
  assert.equal(calculateScore(question, "60", { "total-workers": "100" }), 5);
  assert.equal(calculateScore(question, "49", { "total-workers": "100" }), 0);
});

test("chained percentage scoring supports lower-is-better tiers", () => {
  const question = {
    id: "affected-land",
    max: 10,
    parentQuestionId: "total-land",
    direction: "lower-is-better",
    percentageThresholds: [
      { min: 0, max: 10, score: 100 },
      { min: 10, max: 20, score: 50 },
      { min: 20, max: null, score: 0 },
    ],
  };
  assert.equal(calculateScore(question, "10", { "total-land": "100" }), 10);
  assert.equal(calculateScore(question, "10.5", { "total-land": "100" }), 5);
  assert.equal(calculateScore(question, "15", { "total-land": "100" }), 5);
  assert.equal(calculateScore(question, "21", { "total-land": "100" }), 0);
});

test("chained percentage scoring supports proportional grading and safe denominators", () => {
  const higher = { id: "workers", max: 10, parentQuestionId: "total", direction: "higher-is-better" };
  const lower = { ...higher, direction: "lower-is-better" };
  assert.equal(calculateScore(higher, "20", { total: "80" }), 2.5);
  assert.equal(calculateScore(lower, "20", { total: "80" }), 7.5);
  assert.equal(calculateScore(higher, "150", { total: "100" }), 10);
  assert.equal(calculateScore(higher, "10", { total: "0" }), 0);
  assert.equal(calculateScore(higher, "10", { total: "" }), 0);
  assert.equal(calculateScore(higher, "10", {}), 0);
  assert.equal(calculateScore(lower, "-10", { total: "100" }), 0);
  assert.equal(calculateScore(higher, "", { total: "100" }), 0);
  assert.throws(() => calculateScore({ ...higher, direction: undefined }, "10", { total: "100" }), TypeError);
});

test("quantitative question answers are retained but never scored", () => {
  const question = {
    id: "Q-chain",
    type: "quantitative",
    max: 10,
    parentQuestionId: "Q-survey",
    direction: "higher-is-better",
  };
  assert.equal(fieldQuestionScore(question, { "Q-chain": "40" }, { "Q-survey": "80" }), 0);
  assert.equal(fieldQuestionScore({ id: "Q3", type: "quantitative", max: 15, total: 100 }, { Q3: "40" }, { "Q3-target": "80" }), 0);
});

test("qualitative grading awards the selected fraction of maximum marks", () => {
  assert.equal(fieldQuestionScore({ id: "Q1", type: "qualitative", max: 10 }, { "Q1-yn": "Ya", Q1: "4" }, {}), 8);
  assert.equal(fieldQuestionScore({ id: "Q1", type: "qualitative", max: 10 }, { "Q1-yn": "Tidak" }, {}), 0);
});

test("qualitative without grading awards full marks only for Ya", () => {
  assert.equal(fieldQuestionScore({ id: "Q2", type: "qualitative_no_grade", max: 12 }, { "Q2-yn": "Ya" }, {}), 12);
  assert.equal(fieldQuestionScore({ id: "Q2", type: "qualitative_no_grade", max: 12 }, { "Q2-yn": "Tidak" }, {}), 0);
});

test("qualitative with note retains graded qualitative scoring", () => {
  assert.equal(fieldQuestionScore({ id: "Q5", type: "qualitative_with_note", max: 10 }, { "Q5-yn": "Ya", Q5: "4", "Q5-note": "Healthy" }, {}), 8);
});

test("qualitative note only retains Yes/No scoring", () => {
  assert.equal(fieldQuestionScore({ id: "Q6", type: "qualitative_note_only", max: 12 }, { "Q6-yn": "Ya", "Q6-note": "Present" }, {}), 12);
  assert.equal(fieldQuestionScore({ id: "Q6", type: "qualitative_note_only", max: 12 }, { "Q6-yn": "Tidak", "Q6-note": "Missing" }, {}), 0);
});

test("range qualitative scoring maps numeric input to the configured scale after Ya", () => {
  const question = { id: "Q7", type: "qualitative_range", max: 10, scoreRanges: [
    { min: 100, max: 500, score: 1, label: "Sangat lemah" },
    { min: 501, max: 1000, score: 2, label: "Lemah" },
    { min: 1001, max: 2000, score: 3, label: "Sederhana" },
    { min: 2001, max: 9999, score: 4, label: "Baik" },
    { min: 10000, max: null, score: 5, label: "Cemerlang" },
  ] };
  assert.equal(fieldQuestionScore(question, { "Q7-yn": "Ya", Q7: "100" }, {}), 2);
  assert.equal(fieldQuestionScore(question, { "Q7-yn": "Ya", Q7: "500" }, {}), 2);
  assert.equal(fieldQuestionScore(question, { "Q7-yn": "Ya", Q7: "501" }, {}), 4);
  assert.equal(fieldQuestionScore(question, { "Q7-yn": "Ya", Q7: "1000" }, {}), 4);
  assert.equal(fieldQuestionScore(question, { "Q7-yn": "Ya", Q7: "1001" }, {}), 6);
  assert.equal(fieldQuestionScore(question, { "Q7-yn": "Ya", Q7: "2000" }, {}), 6);
  assert.equal(fieldQuestionScore(question, { "Q7-yn": "Ya", Q7: "2001" }, {}), 8);
  assert.equal(fieldQuestionScore(question, { "Q7-yn": "Ya", Q7: "9999" }, {}), 8);
  assert.equal(fieldQuestionScore(question, { "Q7-yn": "Ya", Q7: "10000" }, {}), 10);
  assert.equal(fieldQuestionScore(question, { "Q7-yn": "Ya", Q7: "99" }, {}), 0);
  assert.equal(fieldQuestionScore(question, { "Q7-yn": "Tidak", Q7: "600" }, {}), 0);
});

test("objective scoring awards the selected option's configured marks", () => {
  const question = { id: "Q9", type: "objective", max: 10, objectiveOptions: [
    { id: "a", label: "Pilihan A", score: 3 },
    { id: "b", label: "Pilihan B", score: 10 },
    { id: "c", label: "Pilihan C", score: 6.5 },
  ] };
  assert.equal(fieldQuestionScore(question, { Q9: "a" }, {}), 3);
  assert.equal(fieldQuestionScore(question, { Q9: "b" }, {}), 10);
  assert.equal(fieldQuestionScore(question, { Q9: "c" }, {}), 6.5);
  assert.equal(fieldQuestionScore(question, { Q9: "unknown" }, {}), 0);
});

test("subjective scores are capped at the configured maximum", () => {
  assert.equal(fieldQuestionScore({ id: "Q4", type: "subjective", max: 8 }, { Q4: "6.5" }, {}), 6.5);
  assert.equal(fieldQuestionScore({ id: "Q4", type: "subjective", max: 8 }, { Q4: "11" }, {}), 8);
});

test("dynamic table answers use manual phase two scoring", () => {
  assert.equal(fieldQuestionScore({ id: "Q8", type: "dynamic_table", max: 10 }, { Q8: "{\"columns\":[\"Item\"],\"rows\":[[\"Trees\"]]}" }, {}), 0);
  assert.equal(fieldQuestionScore({ id: "Q8", type: "dynamic_table", max: 10 }, { Q8: "7" }, {}), 7);
  assert.equal(fieldQuestionScore({ id: "Q8", type: "dynamic_table", max: 10 }, { Q8: "12" }, {}), 10);
});

test("unknown and malformed questions do not produce scores or exceptions", () => {
  assert.equal(fieldQuestionScore({ id: "Q-unknown", type: "future-question", max: 10 }, { "Q-unknown": "5" }, {}), 0);
  assert.equal(fieldQuestionScore({ id: "Q-manual", type: "subjective", max: 10 }, { "Q-manual": "not-a-number" }, {}), 0);
  assert.equal(fieldQuestionScore({ id: "Q-grade", type: "qualitative", max: 10 }, { "Q-grade-yn": "Ya", "Q-grade": "invalid" }, {}), 0);
  assert.equal(fieldQuestionScore(null, {}, {}), 0);
});
test("section scores are summed from topics and weights are derived", () => {
  const q = (id, max) => ({ id, type: "qualitative_no_grade", max });
  const sections = {
    A: [{ id: "a1", questions: [q("Q1", 10), q("Q2", 10)] }, { id: "a2", maxMarks: 20, questions: [q("Q3", 10)] }],
    B: [{ id: "b1", questions: [q("Q4", 20)] }, { id: "b2", questions: [] }],
    C: [],
  };
  const answers = { "Q1-yn": "Ya", "Q2-yn": "Ya", "Q4-yn": "Tidak" };
  assert.equal(topicScore(sections.A[0], answers).earned, 20);
  assert.equal(topicScore(sections.A[1], answers).max, 20);
  assert.equal(sectionScore(sections.A, answers).percent, 50);
  assert.deepEqual(sectionWeights(sections), { A: 66.66666666666666, B: 33.33333333333333, C: 0 });
  assert.equal(sectionScore(sections.C).percent, 0);
  assert.equal(topicScore(sections.B[1]).percent, 0);
  assert.ok(Math.abs(overallScore(sections, answers) - 100 / 3) < 1e-9);
  assert.equal(overallScore({}), 0);
});

test("zero-mark topics contribute nothing to section score or weight", () => {
  const q = { id: "S1", type: "qualitative_no_grade", max: 5 };
  const survey = { id: "s", maxMarks: 0, questions: [q] };
  const graded = { id: "g", maxMarks: 10, questions: [{ id: "G1", type: "qualitative_no_grade", max: 1 }] };
  const answers = { "S1-yn": "Ya", "G1-yn": "Ya" };
  assert.deepEqual(topicScore(survey, answers), { id: "s", earned: 0, max: 0, percent: 0 });
  const result = sectionScore([survey, graded], answers);
  assert.equal(result.earned, 10);
  assert.equal(result.max, 10);
  assert.deepEqual(sectionWeights({ A: [survey], B: [graded] }), { A: 0, B: 100 });
});

test("quantitative reference questions do not add marks or weight", () => {
  const reference = { id: "quant", maxMarks: 40, questions: [{ id: "Q1", type: "quantitative", max: 10 }] };
  const scored = { id: "graded", maxMarks: 10, questions: [{ id: "Q2", type: "qualitative_no_grade", max: 10 }] };
  assert.deepEqual(topicScore(reference, { Q1: "1000" }), { id: "quant", earned: 0, max: 0, percent: 0 });
  assert.deepEqual(sectionWeights({ A: [reference], B: [scored] }), { A: 0, B: 100 });
});

test("editor section weights round derived percentages and keep empty sections", () => {
  const weights = deriveSectionWeights(
    ["Ladang", "Masjid"],
    { Ladang: [{ id: "t1", maxMarks: 30 }], Masjid: [] },
    { Ladang: [{ topicId: "t1", max: 10 }] },
  );
  assert.deepEqual(weights, { Ladang: 100, Masjid: 0 });
});

test("scoring editor helpers handle missing and invalid values safely", () => {
  assert.equal(numericInputMaximum(undefined), undefined);
  assert.equal(numericInputMaximum(""), undefined);
  assert.equal(numericInputMaximum("not-a-number"), undefined);
  assert.equal(numericInputMaximum(-1), undefined);
  assert.equal(numericInputMaximum("12"), 12);
  assert.equal(scoreRangeForValue({ scoreRanges: [{ min: 1, max: 5, score: 2 }] }, ""), undefined);
  assert.equal(scoreRangeForValue({ scoreRanges: [{ min: 1, max: 5, score: 2 }] }, "3")?.score, 2);
  assert.equal(objectiveOptionForValue({ objectiveOptions: [{ id: "yes", label: "Ya", score: 1 }] }, "yes")?.score, 1);
  assert.equal(isValidObjectiveOptions([
    { id: "a", label: "A", score: 0 },
    { id: "b", label: "B", score: 1 },
  ]), true);
  assert.equal(isValidObjectiveOptions([
    { id: "a", label: "Ya", score: 1 },
    { id: "b", label: "ya", score: 2 },
  ]), false);
});

test("adding a score range appends the next ten values or preserves an open-ended range", () => {
  assert.deepEqual(
    appendQuestionScoreRange([{ min: 1, max: 5, score: 1, label: "Low" }]),
    [
      { min: 1, max: 5, score: 1, label: "Low" },
      { min: 6, max: 15, score: 1, label: "Skala baharu" },
    ],
  );
  const openRange = [{ min: 6, max: null, score: 5, label: "High" }];
  assert.equal(appendQuestionScoreRange(openRange), openRange);
});
