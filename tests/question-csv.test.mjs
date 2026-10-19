import test from "node:test";
import assert from "node:assert/strict";
import { buildExportRows, buildQuestionCsv, decodeQuestionCsv, parseCsv, planQuestionImport } from "../src/lib/question-csv.mjs";

const existing = {
  sections: [{ code: "Ladang", name: "Ladang" }],
  topics: [{ id: "ladang-1", section_code: "Ladang", name: "Pengurusan tanaman", sort_order: 1, max_marks: 0 }],
  questions: [{ code: "L1", section: "Ladang", topic_id: "ladang-1", topic_name: "Pengurusan tanaman", prompt: "Soalan lama", question_type: "qualitative", max_score: 10, total_count: null, note_prompt: "", score_ranges: [], table_instruction: "", table_columns: ["Maklumat"], sort_order: 1, active: true }],
};
const header = "Section,Topic,Sub-topic,Additional Topic,Soalan,Jenis Soalan,Markah\r\n";
const objectiveOptions = [{ id: "a", label: "Pilihan A", score: 2 }, { id: "b", label: "Pilihan B", score: 5 }];

test("imports new and existing questions", () => {
  const plan = planQuestionImport(`${header}Ladang,Pengurusan tanaman,,,Soalan lama,BOOLEAN,0\r\nLadang,Baharu,,,"Soalan, baharu",NUMBER,5\r\n`, existing, "Ladang");
  assert.deepEqual(plan.errors, []);
  assert.equal(plan.created, 1);
  assert.equal(plan.updated, 1);
  const updated = plan.questionRows.find((row) => row.code === "L1");
  assert.equal(updated.question_type, "qualitative_no_grade");
  assert.equal(updated.max_score, 0);
  assert.equal(updated.is_survey, true);
  assert.equal(plan.topicRows[0].id, "ladang-2");
  const importedQuantitative = plan.questionRows.find((row) => row.code === "Ladang-Q1");
  assert.equal(importedQuantitative.total_count, null);
  assert.equal(importedQuantitative.max_score, 0);
  assert.equal(importedQuantitative.is_survey, true);
  assert.equal(importedQuantitative.scoring_parent_code, null);
});

test("reports row-level errors", () => {
  const plan = planQuestionImport(`${header}Ladang,A,,,Q,BAD,1\r\nLadang,A,,,Q2,TEXT,-1\r\nX,A,,,Q3,TEXT,1\r\nLadang,A,,,,TEXT,1\r\n`, existing, "Ladang");
  assert.equal(plan.errors.length, 4);
  assert.match(plan.errors[0], /^Baris 2: Jenis Soalan/);
});

test("rejects wrong headers and round-trips export", () => {
  assert.equal(planQuestionImport("A,B\r\n1,2\r\n", existing).errors.length, 1);
  const csv = buildQuestionCsv(buildExportRows(existing.sections[0], existing.topics, existing.questions));
  assert.deepEqual(parseCsv(csv)[1], ["Ladang", "Pengurusan tanaman", "", "", "Soalan lama", "SCALE_1_5", "0", "[]"]);
  assert.deepEqual(planQuestionImport(csv, existing, "Ladang").errors, []);
});

test("imports and exports objective answer options with individual marks", () => {
  const objectiveCsv = `Section,Topic,Sub-topic,Additional Topic,Soalan,Jenis Soalan,Markah,Objective Options\r\nLadang,Pengurusan tanaman,,,Pilihan penanaman,OBJECTIVE,5,"${JSON.stringify(objectiveOptions).replaceAll('"', '""')}"\r\n`;
  const objectiveExisting = existing;
  const plan = planQuestionImport(objectiveCsv, objectiveExisting, "Ladang");
  assert.deepEqual(plan.errors, []);
  assert.equal(plan.questionRows[0].question_type, "objective");
  assert.equal(plan.questionRows[0].max_score, 5);
  assert.deepEqual(plan.questionRows[0].objective_options, objectiveOptions);
  const csv = buildQuestionCsv(buildExportRows(objectiveExisting.sections[0], objectiveExisting.topics, plan.questionRows));
  assert.deepEqual(planQuestionImport(csv, objectiveExisting, "Ladang").errors, []);
  assert.match(csv, /Pilihan A/);
});

test("imports and exports single-answer subjective questions as non-scoring", () => {
  const csv = `${header}Ladang,Pengurusan tanaman,,,Nama pengurus,SUBJECTIVE_SINGLE,0\r\n`;
  const plan = planQuestionImport(csv, existing, "Ladang");
  assert.deepEqual(plan.errors, []);
  assert.equal(plan.questionRows[0].question_type, "subjective_single");
  const exported = buildQuestionCsv(buildExportRows(existing.sections[0], existing.topics, plan.questionRows));
  assert.deepEqual(parseCsv(exported)[1], ["Ladang", "Pengurusan tanaman", "", "", "Nama pengurus", "SUBJECTIVE_SINGLE", "0", "[]"]);
});

test("supports optional sub-topics and legacy subsection CSV headers", () => {
  const csv = `${header}Ladang,Pengurusan tanaman,TENAGA KERJA,,Soalan baharu,BOOLEAN,0\r\n`;
  const plan = planQuestionImport(csv, existing, "Ladang");
  assert.deepEqual(plan.errors, []);
  assert.equal(plan.subtopicRows[0].name, "TENAGA KERJA");
  assert.equal(plan.questionRows[0].topic_id, "ladang-1");
  assert.equal(plan.questionRows[0].subtopic_id, plan.subtopicRows[0].id);
  assert.equal(plan.questionRows[0].additional_topic_id, null);

  const legacy = planQuestionImport("Section,Sub-Section,Soalan,Jenis Soalan,Markah\r\nLadang,Pengurusan tanaman,Soalan lama,BOOLEAN,0\r\n", existing, "Ladang");
  assert.deepEqual(legacy.errors, []);
  assert.equal(legacy.questionRows[0].subtopic_id, null);
  assert.equal(legacy.questionRows[0].additional_topic_id, null);
});

test("imports optional Additional Topics nested under a Sub-topic and keeps old CSV layouts readable", () => {
  const plan = planQuestionImport(`${header}Ladang,Pengurusan tanaman,TENAGA KERJA,Kakitangan,Soalan berkumpulan,BOOLEAN,0\r\n`, existing, "Ladang");
  assert.deepEqual(plan.errors, []);
  assert.equal(plan.additionalTopicRows[0].name, "Kakitangan");
  assert.equal(plan.additionalTopicRows[0].subtopic_id, plan.subtopicRows[0].id);
  assert.equal(plan.questionRows[0].additional_topic_id, plan.additionalTopicRows[0].id);

  const previous = planQuestionImport("Section,Topic,Sub-topic,Soalan,Jenis Soalan,Markah\r\nLadang,Pengurusan tanaman,,Soalan lama,BOOLEAN,0\r\n", existing, "Ladang");
  assert.deepEqual(previous.errors, []);
  assert.equal(previous.questionRows[0].additional_topic_id, null);
});

test("imports localized headers and Excel tab-delimited UTF-16 files", () => {
  const utf16Csv = "\ufeffBahagian\tTopik\tSub-topik\tTopik Tambahan\tSoalan\tJenis Soalan\tMarkah\r\nLadang\tPengurusan tanaman\t\t\tSoalan baharu\tBOOLEAN\t0\r\n";
  const bytes = new Uint8Array(utf16Csv.length * 2 + 2);
  bytes[0] = 0xff;
  bytes[1] = 0xfe;
  for (let index = 0; index < utf16Csv.length; index += 1) {
    const code = utf16Csv.charCodeAt(index);
    bytes[index * 2 + 2] = code & 0xff;
    bytes[index * 2 + 3] = code >> 8;
  }
  const plan = planQuestionImport(decodeQuestionCsv(bytes), existing, "Ladang");
  assert.deepEqual(plan.errors, []);
  assert.equal(plan.questionRows[0].question_type, "qualitative_no_grade");
});

test("exports direct, sub-topic, and Additional Topic questions in their mixed display order", () => {
  const topicQuestions = [
    { ...existing.questions[0], display_order: 1 },
    { ...existing.questions[0], code: "L2", prompt: "Soalan dalam kumpulan", subtopic_id: "st-1", sort_order: 1, display_order: 1 },
    { ...existing.questions[0], code: "L3", prompt: "Soalan selepas kumpulan", sort_order: 3, display_order: 3 },
    { ...existing.questions[0], code: "L4", prompt: "Soalan tambahan", subtopic_id: "st-1", additional_topic_id: "at-1", sort_order: 1, display_order: 1 },
  ];
  const rows = buildExportRows(existing.sections[0], existing.topics, topicQuestions, [
    { id: "st-1", topic_id: "ladang-1", name: "TENAGA KERJA", sort_order: 2 },
  ], [
    { id: "at-1", subtopic_id: "st-1", name: "Kakitangan", sort_order: 2 },
  ]);
  assert.deepEqual(rows.map((row) => [row.question, row.subtopic, row.additionalTopic]), [
    ["Soalan lama", "", ""],
    ["Soalan dalam kumpulan", "TENAGA KERJA", ""],
    ["Soalan tambahan", "TENAGA KERJA", "Kakitangan"],
    ["Soalan selepas kumpulan", "", ""],
  ]);
});
