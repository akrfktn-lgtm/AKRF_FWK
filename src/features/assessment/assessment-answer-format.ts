import { objectiveOptionForValue, scoreRangeForValue } from "../../lib/scoring.mjs";
import type { DynamicTableAnswer, Question } from "./assessment-types";

function usesNoteField(type: Question["type"]) {
  return type === "qualitative_with_note" || type === "qualitative_note_only";
}

export function parseDynamicTableAnswer(value: string | undefined, question: Question): DynamicTableAnswer {
  const configuredColumns = Array.isArray(question?.tableColumns)
    ? question.tableColumns.filter((column): column is string => typeof column === "string" && column.trim().length > 0)
    : [];
  const safeColumns = configuredColumns.length ? configuredColumns : ["Maklumat"];
  const configuredRows = Number(question?.tableRows);
  const rowCount = Number.isFinite(configuredRows)
    ? Math.min(Math.max(Math.trunc(configuredRows) || 2, 1), 50)
    : 2;
  const columns = ["No.", ...safeColumns];
  const blankRows = () => Array.from({ length: rowCount }, () => safeColumns.map(() => ""));
  if (!value) return { columns, rows: blankRows() };
  try {
    const parsed = JSON.parse(value) as Partial<DynamicTableAnswer>;
    if (!Array.isArray(parsed.rows) || !parsed.rows.every(Array.isArray)) throw new Error("Invalid table answer");
    const saved = parsed.rows;
    return { columns, rows: Array.from({ length: rowCount }, (_, rowIndex) =>
      safeColumns.map((__, index) => String(saved[rowIndex]?.[index] ?? ""))) };
  } catch {
    return { columns, rows: blankRows() };
  }
}

function financialAnswerLabel(question: Question, answers: Record<string, string>) {
  const income = answers[`${question.id}-income`];
  if (income === undefined) return "—";
  return `Perbelanjaan RM ${answers[`${question.id}-expense`] ?? "0"} / Pendapatan RM ${income} · ${answers[`${question.id}-utilization`] ?? "0"}% · Skor ${answers[question.id] ?? "—"}/5`;
}

function answerWithNote(question: Question, answers: Record<string, string>, answer: string) {
  const note = answers[`${question.id}-note`]?.trim();
  return usesNoteField(question.type) && note
    ? `${answer} · ${question.notePrompt?.trim() || "Nota"}: ${note}`
    : answer;
}

export function selfAnswerLabel(question: Question, answers: Record<string, string>) {
  if (question.type === "auto_calculated_financial") return financialAnswerLabel(question, answers);
  if (question.type === "objective") {
    const option = objectiveOptionForValue(question, answers[question.id]);
    return option ? `${option.label} · ${option.score} markah` : "—";
  }
  if (question.type === "dynamic_table") {
    const table = parseDynamicTableAnswer(answers[question.id], question);
    return table.rows.map((row, index) => `${index + 1}. ${row.filter(Boolean).join(" · ")}`).filter((row) => row !== `${row.split(".")[0]}. `).join(" / ") || "—";
  }
  if (question.type === "subjective_single") return answers[question.id]?.trim() || "—";
  if (question.type === "subjective") return answers[question.id]?.split("\n").filter(Boolean).join(" · ") ?? "—";
  if (question.type === "quantitative") {
    return answers[question.id] ?? "—";
  }
  const yesNo = answers[`${question.id}-yn`] ?? answers[question.id];
  if (question.type === "qualitative_range") {
    if (yesNo === "Tidak") return "Tidak";
    const range = scoreRangeForValue(question, answers[question.id]);
    if (!range) return yesNo === "Ya" ? "Ya · —" : "—";
    const interval = range.max == null ? `${range.min}+` : `${range.min}–${range.max}`;
    return `Ya · ${answers[question.id]} (${interval}) · Skala ${range.score} ${range.label}`;
  }
  if (question.type === "qualitative_no_grade" || question.type === "qualitative_note_only") {
    return answerWithNote(question, answers, yesNo ?? "—");
  }
  if (yesNo === "Tidak") return answerWithNote(question, answers, "Tidak");
  if (yesNo === "Ya") return answerWithNote(question, answers, `Ya · Gred ${answers[question.id] ?? "—"}`);
  return "—";
}

export function juryAnswerLabel(question: Question, answers: Record<string, string> | null, baseline: Record<string, string>) {
  if (!answers) return "—";
  if (question.type === "auto_calculated_financial") return financialAnswerLabel(question, answers);
  if (question.type === "objective") {
    const option = objectiveOptionForValue(question, answers[question.id]);
    return option ? `${option.label} · ${option.score} markah` : "—";
  }
  if (question.type === "dynamic_table") return selfAnswerLabel(question, baseline);
  if (question.type === "subjective_single") return baseline[question.id]?.trim() || "—";
  if (question.type === "subjective") {
    return baseline[question.id]?.split("\n").filter(Boolean).join(" · ") ?? "—";
  }
  if (question.type === "quantitative") {
    return answers[question.id] ?? "—";
  }
  if (question.type === "qualitative_range") {
    if (answers[`${question.id}-yn`] === "Tidak") return "Tidak";
    const range = scoreRangeForValue(question, answers[question.id]);
    const interval = range?.max == null ? `${range?.min ?? "—"}+` : `${range.min}–${range.max}`;
    return range ? `Ya · ${answers[question.id]} (${interval}) · Skala ${range.score} ${range.label}` : "Ya · —";
  }
  if (question.type === "qualitative_no_grade" || question.type === "qualitative_note_only") {
    return answerWithNote(question, answers, answers[`${question.id}-yn`] ?? "—");
  }
  if (answers[`${question.id}-yn`] === "Tidak") return answerWithNote(question, answers, "Tidak");
  if (answers[`${question.id}-yn`] === "Ya") return answerWithNote(question, answers, `Ya · Gred ${answers[question.id] ?? "—"}`);
  return "—";
}
