import test from "node:test";
import assert from "node:assert/strict";
import { createRanchExcelWorkbook, cleanWorksheetName } from "../src/lib/excel-report.mjs";

const sections = [
  { code: "ladang", name: "Ladang" },
  { code: "kampung", name: "Kampung" },
];
const questionConfig = {
  ladang: [{ id: "L1", text: "Kawasan bersih?", type: "qualitative", topicId: "ladang-1" }],
  kampung: [{ id: "K1", text: "Longkang bersih?", type: "qualitative", topicId: "kampung-1" }],
};
const blocks = [
  { ranch: "Rancangan A", block: "02", sections: { ladang: 65, kampung: 70 }, juryScores: { ladang: [60, 70] }, selfAnswers: { ladang: { L1: "5", "L1-yn": "Ya" } } },
  { ranch: "Rancangan B", block: "01", sections: { ladang: 90, kampung: 80 } },
];

test("filters blocks and sections and places summary last", () => {
  const workbook = createRanchExcelWorkbook({
    rancanganId: "Rancangan A",
    sectionIds: ["kampung"],
    sections,
    sectionNames: { ladang: "Ladang", kampung: "Kampung" },
    blocks,
    topics: { kampung: [{ id: "kampung-1", name: "Saliran" }] },
    questionConfig,
    questionScoreDetails: [],
  });

  assert.deepEqual(workbook.worksheets.map((sheet) => sheet.name), ["Blok 02", "Kesimpulan"]);
  assert.equal(workbook.getWorksheet("Blok 02").getCell("A3").value, "Kampung");
  assert.equal(workbook.getWorksheet("Kesimpulan").getCell("A3").value, "Kampung");
  assert.equal(workbook.getWorksheet("Kesimpulan").getCell("B4").value, "02");
});

test("empty section filters and ALL both include every section", () => {
  for (const sectionIds of [[], ["ALL"]]) {
    const workbook = createRanchExcelWorkbook({
      rancanganId: "Rancangan A",
      sectionIds,
      sections,
      sectionNames: {},
      blocks: [blocks[0]],
      topics: {},
      questionConfig,
      questionScoreDetails: [],
    });
    assert.equal(workbook.getWorksheet("Kesimpulan").getCell("A3").value, "Ladang");
    assert.equal(workbook.getWorksheet("Kesimpulan").getCell("A6").value, "Kampung");
  }
});

test("worksheet names are cleaned, limited, and made unique", () => {
  const usedNames = new Set();
  const first = cleanWorksheetName("Blok/01:*[Ladang]".repeat(3), usedNames);
  const second = cleanWorksheetName(first, usedNames);

  assert.ok(first.length <= 31);
  assert.ok(!/[\\/*?:\[\]]/.test(first));
  assert.notEqual(first, second);
});

test("places direct and sub-topic questions in mixed order in block reports", () => {
  const workbook = createRanchExcelWorkbook({
    rancanganId: "Rancangan A",
    sectionIds: ["ladang"],
    sections,
    sectionNames: {},
    blocks: [blocks[0]],
    topics: { ladang: [{ id: "ladang-1", name: "Pengurusan ladang" }] },
    subtopics: { ladang: [{ id: "st-1", topicId: "ladang-1", name: "Tenaga kerja", sortOrder: 2 }] },
    questionConfig: {
      ladang: [
        { id: "L1", text: "Soalan langsung", type: "qualitative", topicId: "ladang-1", displayOrder: 1 },
        { id: "L2", text: "Soalan sub-topik", type: "qualitative", topicId: "ladang-1", subtopicId: "st-1", sortOrder: 1, displayOrder: 1 },
      ],
    },
    questionScoreDetails: [],
  });

  const worksheet = workbook.getWorksheet("Blok 02");
  assert.equal(worksheet.getCell("C2").value, "TOPIC / SUB-TOPIC");
  assert.equal(worksheet.getCell("B4").value, "Pengurusan ladang");
  assert.equal(worksheet.getCell("B5").value, "Soalan langsung");
  assert.equal(worksheet.getCell("B6").value, "Tenaga kerja");
  assert.equal(worksheet.getCell("B7").value, "Soalan sub-topik");
});

test("prints Additional Topic headings and their questions under the parent Sub-topic", () => {
  const workbook = createRanchExcelWorkbook({
    rancanganId: "Rancangan A",
    sectionIds: ["ladang"],
    sections,
    sectionNames: {},
    blocks: [blocks[0]],
    topics: { ladang: [{ id: "ladang-1", name: "Pengurusan ladang" }] },
    subtopics: { ladang: [{ id: "st-1", topicId: "ladang-1", name: "Tenaga kerja", sortOrder: 1 }] },
    additionalTopics: { ladang: [{ id: "at-1", subtopicId: "st-1", name: "Kakitangan", sortOrder: 2 }] },
    questionConfig: {
      ladang: [
        { id: "L2", text: "Soalan sub-topik", type: "qualitative", topicId: "ladang-1", subtopicId: "st-1", sortOrder: 1 },
        { id: "L3", text: "Soalan Additional Topic", type: "qualitative", topicId: "ladang-1", subtopicId: "st-1", additionalTopicId: "at-1", sortOrder: 1 },
      ],
    },
    questionScoreDetails: [],
  });

  const worksheet = workbook.getWorksheet("Blok 02");
  assert.equal(worksheet.getCell("B5").value, "Tenaga kerja");
  assert.equal(worksheet.getCell("B6").value, "Soalan sub-topik");
  assert.equal(worksheet.getCell("B7").value, "Kakitangan");
  assert.equal(worksheet.getCell("B8").value, "Soalan Additional Topic");
  assert.equal(worksheet.getCell("C8").value, "Kakitangan");
});

test("reports every assigned juror response with the average question score", () => {
  const workbook = createRanchExcelWorkbook({
    rancanganId: "Rancangan A",
    sectionIds: ["ladang"],
    sections,
    sectionNames: {},
    blocks: [{
      ...blocks[0],
      juryAnswers: { ladang: [ { L1: "4", "L1-yn": "Ya" }, { L1: "2", "L1-yn": "Ya" }, { L1: "5", "L1-yn": "Ya" } ] },
    }],
    topics: { ladang: [{ id: "ladang-1", name: "Pengurusan ladang" }] },
    questionConfig,
    jurorAssignments: [
      { user_id: "juror-1", topic_id: "ladang-1", assessor_slot: 1 },
      { user_id: "juror-2", topic_id: "ladang-1", assessor_slot: 2 },
      { user_id: "juror-3", topic_id: "ladang-1", assessor_slot: 3 },
    ],
    jurors: [
      { id: "juror-1", full_name: "Juri Satu" },
      { id: "juror-2", full_name: "Juri Dua" },
      { id: "juror-3", full_name: "Juri Tiga" },
    ],
    questionScoreDetails: [
      { ranch_name: "Rancangan A", block_number: "02", question_code: "L1", phase: 2, assessor_slot: 1, score_percent: 80 },
      { ranch_name: "Rancangan A", block_number: "02", question_code: "L1", phase: 2, assessor_slot: 2, score_percent: 40 },
      { ranch_name: "Rancangan A", block_number: "02", question_code: "L1", phase: 2, assessor_slot: 3, score_percent: 100 },
    ],
  });

  const worksheet = workbook.getWorksheet("Blok 02");
  assert.match(worksheet.getCell("E5").value, /Juri Satu: Ya/);
  assert.match(worksheet.getCell("E5").value, /Juri Tiga: Ya/);
  assert.equal(worksheet.getCell("F5").value, 220 / 3);
});

test("labels the selected objective option in the exported baseline answer", () => {
  const workbook = createRanchExcelWorkbook({
    rancanganId: "Rancangan A",
    sectionIds: ["ladang"],
    sections,
    sectionNames: {},
    blocks: [{ ranch: "Rancangan A", block: "02", sections: {}, selfAnswers: { ladang: { O1: "option-b" } } }],
    topics: { ladang: [{ id: "ladang-1", name: "Pengurusan ladang" }] },
    questionConfig: {
      ladang: [{
        id: "O1", text: "Pilih tahap", type: "objective", topicId: "ladang-1",
        objectiveOptions: [{ id: "option-a", label: "Tahap A", score: 2 }, { id: "option-b", label: "Tahap B", score: 5 }],
      }],
    },
    questionScoreDetails: [],
  });

  assert.equal(workbook.getWorksheet("Blok 02").getCell("D5").value, "Tahap B · 5 markah");
});

test("exports quantitative reference answers without a total denominator", () => {
  const workbook = createRanchExcelWorkbook({
    rancanganId: "Rancangan A",
    sectionIds: ["ladang"],
    sections,
    sectionNames: {},
    blocks: [{
      ranch: "Rancangan A",
      block: "02",
      sections: {},
      selfAnswers: { ladang: { Q1: "25", "Q1-target": "100" } },
    }],
    topics: { ladang: [{ id: "ladang-1", name: "Pengurusan ladang" }] },
    questionConfig: {
      ladang: [{ id: "Q1", text: "Angka untuk rujukan", type: "quantitative", topicId: "ladang-1" }],
    },
    questionScoreDetails: [],
  });

  assert.equal(workbook.getWorksheet("Blok 02").getCell("D5").value, "25");
});