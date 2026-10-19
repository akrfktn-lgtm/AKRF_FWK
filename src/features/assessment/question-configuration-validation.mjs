import { isValidObjectiveOptions } from "../../lib/scoring.mjs";

const QUESTION_TYPES = new Set([
  "qualitative",
  "qualitative_no_grade",
  "qualitative_with_note",
  "qualitative_note_only",
  "qualitative_range",
  "objective",
  "dynamic_table",
  "quantitative",
  "subjective",
  "subjective_single",
  "auto_calculated_financial",
]);

const usesNoteField = (type) => type === "qualitative_with_note" || type === "qualitative_note_only";

export function validateQuestionConfiguration(question) {
  if (!question || typeof question !== "object") return "Konfigurasi soalan tidak sah.";
  if (!QUESTION_TYPES.has(question.type)) return "Pilih jenis soalan yang disokong.";

  const text = typeof question.text === "string" ? question.text.trim() : "";
  if (!text) return "Masukkan teks soalan.";

  if (question.type === "objective") {
    if (!Array.isArray(question.objectiveOptions) || !isValidObjectiveOptions(question.objectiveOptions)) {
      return "Soalan objektif memerlukan sekurang-kurangnya dua pilihan unik dengan label dan markah sah.";
    }
  }

  if (question.type === "quantitative") return null;

  if (usesNoteField(question.type) && !(typeof question.notePrompt === "string" && question.notePrompt.trim())) {
    return "Masukkan label sub-soalan atau nota.";
  }

  if (question.type === "dynamic_table") {
    const columns = question.tableColumns;
    if (!Array.isArray(columns) || columns.length === 0
      || columns.some((column) => typeof column !== "string" || !column.trim())) {
      return "Masukkan sekurang-kurangnya satu tajuk lajur jadual yang sah.";
    }
    if (!Number.isInteger(question.tableRows) || question.tableRows < 1 || question.tableRows > 50) {
      return "Bilangan baris jadual mesti antara 1 hingga 50.";
    }
  }

  if (question.type === "qualitative_range") {
    const ranges = question.scoreRanges;
    if (!Array.isArray(ranges) || ranges.length === 0) {
      return "Tetapkan sekurang-kurangnya satu julat nombor.";
    }
    if (ranges.some((range) => !range || typeof range !== "object")) {
      return "Tetapkan julat nombor yang sah tanpa pertindihan dan skala 1 hingga 5.";
    }
    const sorted = [...ranges].sort((first, second) => first.min - second.min);
    if (ranges.some((range) => !range
      || !Number.isInteger(range.min) || range.min < 0
      || (range.max !== null && (!Number.isInteger(range.max) || range.max < range.min))
      || !Number.isInteger(range.score) || range.score < 1 || range.score > 5
      || typeof range.label !== "string" || !range.label.trim())
      || sorted.some((range, index) => index > 0
        && (sorted[index - 1].max === null || range.min <= sorted[index - 1].max))) {
      return "Tetapkan julat nombor yang sah tanpa pertindihan dan skala 1 hingga 5.";
    }
  }

  const max = Number(question.max);
  if (!Number.isFinite(max) || max < 0 || max > 100000
    || (!question.isSurvey && question.type !== "subjective_single" && max < 1)) {
    return "Markah maksimum mesti antara 1 hingga 100000, kecuali soalan tinjauan yang ditetapkan kepada 0.";
  }
  return null;
}
