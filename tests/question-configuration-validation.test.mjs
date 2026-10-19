import test from "node:test";
import assert from "node:assert/strict";
import { validateQuestionConfiguration } from "../src/features/assessment/question-configuration-validation.mjs";

const base = { id: "Q1", text: "Soalan ujian", type: "qualitative", max: 10 };

test("accepts valid type-specific question configuration", () => {
  assert.equal(validateQuestionConfiguration(base), null);
  assert.equal(validateQuestionConfiguration({
    ...base,
    type: "objective",
    objectiveOptions: [
      { id: "yes", label: "Ya", score: 1 },
      { id: "no", label: "Tidak", score: 0 },
    ],
  }), null);
  assert.equal(validateQuestionConfiguration({
    ...base,
    type: "dynamic_table",
    tableColumns: ["Item", "Jumlah"],
    tableRows: 4,
  }), null);
  assert.equal(validateQuestionConfiguration({
    ...base,
    type: "qualitative_with_note",
    notePrompt: "Catatan",
  }), null);
});

test("rejects missing or unsupported question configuration safely", () => {
  assert.match(validateQuestionConfiguration(null), /tidak sah/i);
  assert.match(validateQuestionConfiguration({ ...base, type: "unrecognized" }), /disokong/i);
  assert.match(validateQuestionConfiguration({ ...base, text: " " }), /teks soalan/i);
  assert.match(validateQuestionConfiguration({ ...base, type: "qualitative_note_only" }), /label sub-soalan/i);
  assert.match(validateQuestionConfiguration({ ...base, type: "objective", objectiveOptions: [null, {}] }), /pilihan unik/i);
  assert.match(validateQuestionConfiguration({ ...base, type: "dynamic_table", tableColumns: ["  "], tableRows: 2 }), /tajuk lajur/i);
  assert.match(validateQuestionConfiguration({ ...base, type: "dynamic_table", tableColumns: ["Item"], tableRows: 51 }), /baris jadual/i);
});

test("rejects overlapping range scales and invalid score maximums", () => {
  assert.match(validateQuestionConfiguration({
    ...base,
    type: "qualitative_range",
    scoreRanges: [
      { min: 0, max: 10, score: 2, label: "Rendah" },
      { min: 10, max: null, score: 4, label: "Tinggi" },
    ],
  }), /tanpa pertindihan/i);
  assert.match(validateQuestionConfiguration({ ...base, max: 0 }), /markah maksimum/i);
});

test("allows survey and no-score question configurations", () => {
  assert.equal(validateQuestionConfiguration({ ...base, max: 0, isSurvey: true }), null);
  assert.equal(validateQuestionConfiguration({ ...base, type: "subjective_single", max: 1 }), null);
  assert.equal(validateQuestionConfiguration({ ...base, type: "quantitative", max: 0, isSurvey: true }), null);
});
