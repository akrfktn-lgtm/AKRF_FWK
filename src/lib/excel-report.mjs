import ExcelJS from "exceljs";
import { orderedTopicContent } from "./assessment-structure.mjs";

const COLUMN_HEADERS = [
  "KOD ITEM",
  "PENERANGAN",
  "TOPIC / SUB-TOPIC",
  "JAWAPAN FASA 1",
  "JAWAPAN JURI",
  "PURATA MARKAH JURI (%)",
  "MARKAH SEKSYEN (%)",
];

export function cleanWorksheetName(value, usedNames = new Set()) {
  const base = String(value || "Laporan")
    .replace(/[\\/*?:\[\]]/g, " ")
    .replace(/^'+|'+$/g, "")
    .trim()
    .slice(0, 31) || "Laporan";
  let name = base;
  let suffix = 2;
  while ([...usedNames].some((usedName) => usedName.toLowerCase() === name.toLowerCase())) {
    const ending = ` (${suffix})`;
    name = `${base.slice(0, 31 - ending.length)}${ending}`;
    suffix += 1;
  }
  usedNames.add(name);
  return name;
}

function selectedSections(sectionIds, sections) {
  if (!sectionIds?.length || sectionIds.includes("ALL")) return sections;
  const selected = new Set(sectionIds);
  return sections.filter((section) => selected.has(section.code));
}

function answerLabel(question, answers) {
  if (!answers) return "—";
  if (question.type === "objective") {
    const option = question.objectiveOptions?.find((item) => item.id === answers[question.id]);
    return option ? `${option.label} · ${option.score} markah` : "—";
  }
  if (question.type === "dynamic_table") {
    try {
      const table = JSON.parse(answers[question.id] || "{}");
      return Array.isArray(table.rows)
        ? table.rows.map((row) => Array.isArray(row) ? row.filter(Boolean).join(" · ") : "").filter(Boolean).join(" / ") || "—"
        : "—";
    } catch {
      return answers[question.id] || "—";
    }
  }
  if (question.type === "subjective") return answers[question.id]?.split("\n").filter(Boolean).join(" · ") || "—";
  if (question.type === "quantitative") {
    return answers[question.id] ?? "—";
  }
  const yesNo = answers[`${question.id}-yn`] ?? answers[question.id];
  let answer = yesNo || "—";
  if (yesNo === "Ya" && ["qualitative", "qualitative_with_note"].includes(question.type)) {
    answer = `Ya · Gred ${answers[question.id] || "—"}`;
  } else if (yesNo === "Ya" && question.type === "qualitative_range") {
    const value = Number(answers[question.id]);
    const range = question.scoreRanges?.find((item) => value >= item.min && (item.max == null || value <= item.max));
    answer = `Ya · ${answers[question.id] || "—"}${range ? ` · Skala ${range.score} ${range.label}` : ""}`;
  }
  const note = answers[`${question.id}-note`]?.trim();
  return note ? `${answer} · ${question.notePrompt?.trim() || "Nota"}: ${note}` : answer;
}

function hasResponse(question, answers) {
  return Boolean(answers && [question.id, `${question.id}-yn`, `${question.id}-note`]
    .some((key) => String(answers[key] ?? "").trim()));
}

function questionScores(scores, ranch, block, questionId) {
  const scoresForQuestion = scores.filter((score) => score.ranch_name === ranch
    && score.block_number === block && score.question_code === questionId
    && score.phase === 2 && score.score_percent != null).map((score) => Number(score.score_percent));
  return scoresForQuestion.length
    ? scoresForQuestion.reduce((sum, score) => sum + score, 0) / scoresForQuestion.length
    : null;
}

function styleSectionRow(row) {
  row.height = 22;
  row.eachCell({ includeEmpty: true }, (cell) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF3D714E" } };
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.alignment = { vertical: "middle" };
  });
}

function createBlockSheet(workbook, block, sections, sectionNames, topics, subtopics, additionalTopics, questionConfig, questionScoreDetails, jurorAssignments, jurors) {
  const worksheet = workbook.addWorksheet(cleanWorksheetName(`Blok ${block.block}`, new Set(workbook.worksheets.map((sheet) => sheet.name))));
  worksheet.columns = [
    { width: 17 }, { width: 42 }, { width: 24 }, { width: 32 }, { width: 50 },
    { width: 22 }, { width: 19 },
  ];
  worksheet.addRow([`RANCANGAN: ${block.ranch}`, `BLOK: ${block.block}`]);
  if (sections.some((section) => section.code === "Masjid")) {
    const mosque = block.selfAnswers?.Masjid ?? {};
    worksheet.getCell("C1").value = `MASJID: ${block.mosqueName || mosque["mosque-name"] || "—"}`;
    worksheet.getCell("D1").value = `PENGERUSI MASJID: ${mosque["mosque-chairman"] || "—"}`;
    worksheet.getCell("E1").value = `IMAM: ${mosque["mosque-imam"] || "—"}`;
  }
  worksheet.getRow(1).font = { bold: true, size: 14, color: { argb: "FF294737" } };
  worksheet.addRow(COLUMN_HEADERS).eachCell((cell) => {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF294737" } };
    cell.alignment = { vertical: "middle", wrapText: true };
  });
  worksheet.getRow(2).height = 30;

  sections.forEach((section) => {
    const questions = questionConfig[section.code] ?? [];
    const sectionName = sectionNames[section.code] ?? section.name ?? section.code;
    const sectionRow = worksheet.addRow([sectionName, ...Array(6).fill(null)]);
    styleSectionRow(sectionRow);
    const sectionTopics = [...(topics[section.code] ?? [])];
    for (const question of questions) {
      if (!sectionTopics.some((topic) => topic.id === question.topicId)) {
        sectionTopics.push({ id: question.topicId, name: question.topicName ?? question.topicId });
      }
    }
    for (const topic of sectionTopics) {
      const topicRow = worksheet.addRow(["", topic.name, ...Array(5).fill(null)]);
      topicRow.font = { bold: true, color: { argb: "FF355D40" } };
      topicRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE8F0E8" } };
      const content = orderedTopicContent([topic], subtopics[section.code] ?? [], questions, additionalTopics[section.code] ?? []);
      function addQuestionRow(question, contentName) {
        const baseline = block.selfAnswers?.[section.code] ?? {};
        const juryResponses = jurorAssignments.filter((assignment) => assignment.topic_id === question.topicId).map((assignment) => {
          const name = jurors.find((juror) => juror.id === assignment.user_id)?.full_name || assignment.user_id;
          const answer = block.juryAnswers?.[section.code]?.[assignment.assessor_slot - 1];
          return answer ? `${name}: ${answerLabel(question, answer)}` : null;
        }).filter(Boolean);
        const juryAverageScore = questionScores(questionScoreDetails, block.ranch, block.block, question.id);
        worksheet.addRow([
          question.id,
          question.text,
          contentName,
          answerLabel(question, baseline),
          juryResponses.join("\n") || "—",
          juryAverageScore,
          null,
        ]);
      }
      for (const item of content) {
        if (item.kind === "question") {
          addQuestionRow(item.question, topic.name);
          continue;
        }
        const subtopicRow = worksheet.addRow(["", item.subtopic.name, ...Array(5).fill(null)]);
        subtopicRow.font = { bold: true, color: { argb: "FF355D40" } };
        subtopicRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF3F6F3" } };
        for (const subtopicItem of item.content) {
          if (subtopicItem.kind === "question") {
            addQuestionRow(subtopicItem.question, item.subtopic.name);
            continue;
          }
          const additionalTopicRow = worksheet.addRow(["", subtopicItem.additionalTopic.name, ...Array(5).fill(null)]);
          additionalTopicRow.font = { bold: true, color: { argb: "FF355D40" } };
          additionalTopicRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF8FAF8" } };
          subtopicItem.questions.forEach((question) => addQuestionRow(question, subtopicItem.additionalTopic.name));
        }
      }
      if (!content.length) worksheet.addRow(["", "Tiada soalan untuk Topic ini."]);
    }
    if (!sectionTopics.length) worksheet.addRow(["", "Tiada data atau soalan untuk seksyen ini."]);
    worksheet.addRow(["JUMLAH / MARKAH", sectionName, "", "", "", block.sections?.[section.code] ?? null, null]).font = { bold: true };
  });
  worksheet.views = [{ state: "frozen", ySplit: 2 }];
  return worksheet;
}

function createSummarySheet(workbook, blocks, sections, sectionNames, questionConfig, jurorAssignments) {
  const worksheet = workbook.addWorksheet("Kesimpulan");
  worksheet.columns = [
    { width: 25 }, { width: 18 }, { width: 22 }, { width: 24 }, { width: 25 },
  ];
  worksheet.addRow(["KESIMPULAN LAPORAN RANCANGAN"]);
  worksheet.getRow(1).font = { bold: true, size: 14, color: { argb: "FF294737" } };
  worksheet.addRow(["SEKSYEN", "BLOK", "RESPON FASA 1", "RESPON JURI", "PURATA SKOR JURI (%)"]);
  worksheet.getRow(2).eachCell((cell) => {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF294737" } };
    cell.alignment = { vertical: "middle", wrapText: true };
  });
  worksheet.getRow(2).height = 34;

  for (const section of sections) {
    const sectionName = sectionNames[section.code] ?? section.name ?? section.code;
    styleSectionRow(worksheet.addRow([sectionName, ...Array(8).fill(null)]));
    let selfCount = 0;
    let sectionMarks = 0;
    let jurorResponseCount = 0;
    for (const block of blocks) {
      const questions = questionConfig[section.code] ?? [];
      const baseline = block.selfAnswers?.[section.code] ?? {};
      const baselineCount = questions.filter((question) => hasResponse(question, baseline)).length;
      const currentJurorAssignments = jurorAssignments.filter((assignment) => questions.some((question) => question.topicId === assignment.topic_id));
      const blockJurorResponseCount = questions.reduce((sum, question) => sum + currentJurorAssignments
        .filter((assignment) => assignment.topic_id === question.topicId)
        .filter((assignment) => hasResponse(question, block.juryAnswers?.[section.code]?.[assignment.assessor_slot - 1] ?? null)).length, 0);
      const sectionScore = block.sections?.[section.code] ?? null;
      selfCount += baselineCount;
      jurorResponseCount += blockJurorResponseCount;
      sectionMarks += Number(sectionScore ?? 0);
      worksheet.addRow([sectionName, block.block, baselineCount, blockJurorResponseCount, sectionScore]);
    }
    worksheet.addRow(["JUMLAH / MARKAH", "", selfCount, jurorResponseCount, sectionMarks]).font = { bold: true };
  }
  worksheet.views = [{ state: "frozen", ySplit: 2 }];
  return worksheet;
}

export function createRanchExcelWorkbook({ rancanganId, sectionIds, sections, sectionNames, blocks, topics, subtopics = {}, additionalTopics = {}, questionConfig, questionScoreDetails, jurorAssignments = [], jurors = [] }) {
  const filteredSections = selectedSections(sectionIds, sections);
  const filteredBlocks = blocks
    .filter((block) => block.ranch === rancanganId)
    .slice()
    .sort((first, second) => first.block.localeCompare(second.block));
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "AKRF FELDA Wilayah Kuantan";
  workbook.created = new Date();
  for (const block of filteredBlocks) {
    createBlockSheet(workbook, block, filteredSections, sectionNames, topics, subtopics, additionalTopics, questionConfig, questionScoreDetails, jurorAssignments, jurors);
  }
  createSummarySheet(workbook, filteredBlocks, filteredSections, sectionNames, questionConfig, jurorAssignments);
  return workbook;
}

export async function downloadRanchExcelReport(options) {
  const workbook = createRanchExcelWorkbook(options);
  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `Laporan-${String(options.rancanganId).replace(/[^a-z0-9-_]+/gi, "-")}.xlsx`;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}