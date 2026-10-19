"use client";

import { Plus, Trash2 } from "lucide-react";
import { FinancialQuestionField, type FinancialItem, type FinancialThreshold } from "./financial-question-field";
import { parseDynamicTableAnswer } from "../assessment-answer-format";
import type { DynamicTableAnswer, Question } from "../assessment-types";

type Phase = 1 | 2;
type Answers = Record<string, string>;
type Category = "qualitative" | "objective" | "quantitative" | "subjective" | "financial" | "dynamic_table";

type Props = {
  question: Question;
  phase: Phase;
  baselineAnswer: string;
  answers: Answers;
  financialItems: FinancialItem[];
  financialThresholds: FinancialThreshold[];
  disabled: boolean;
  onAnswerChange: (key: string, value: string) => void;
  onAnswerPatch: (changes: Answers) => void;
};

type StrategyProps = Props;
type Strategy = (props: StrategyProps) => React.ReactNode;
type ScoreInputProps = Pick<Props, "question" | "answers" | "onAnswerChange">;

const QUESTION_CATEGORIES: Record<string, Category> = {
  qualitative: "qualitative",
  qualitative_no_grade: "qualitative",
  qualitative_with_note: "qualitative",
  qualitative_note_only: "qualitative",
  qualitative_range: "qualitative",
  objective: "objective",
  dynamic_table: "dynamic_table",
  quantitative: "quantitative",
  subjective: "subjective",
  subjective_single: "subjective",
  auto_calculated_financial: "financial",
};

function NumericScoreInput({ question, answers, onAnswerChange }: ScoreInputProps) {
  return <label>Markah manual (maks. {question.max})
    <input aria-label={`Markah manual ${question.id}`} type="number" min="0" max={question.max} step="0.01"
      value={answers[question.id] ?? ""} onChange={(event) => onAnswerChange(question.id, event.target.value)} />
  </label>;
}

function ObjectiveStrategy({ question, answers, onAnswerChange }: StrategyProps) {
  const options = Array.isArray(question.objectiveOptions)
    ? question.objectiveOptions.filter((option) => option && typeof option.id === "string" && typeof option.label === "string")
    : [];
  return <div className="objective-answer-options" role="radiogroup" aria-label={`Jawapan ${question.id}`}>
    {options.map((option) => <label key={option.id} className={`objective-answer-option ${answers[question.id] === option.id ? "selected" : ""}`}>
      <input type="radio" name={`objective-${question.id}`} value={option.id} checked={answers[question.id] === option.id}
        onChange={() => onAnswerChange(question.id, option.id)} />
      <span>{option.label}</span>
    </label>)}
    {!options.length && <small className="question-field-fallback" role="status">Pilihan jawapan belum dikonfigurasikan.</small>}
  </div>;
}

function FinancialStrategy({ question, answers, financialItems, financialThresholds, phase, disabled, onAnswerChange }: StrategyProps) {
  return <FinancialQuestionField questionId={question.id}
    items={(Array.isArray(financialItems) ? financialItems : []).filter((item) => item?.questionCode === question.id)}
    thresholds={Array.isArray(financialThresholds) ? financialThresholds : []} answers={answers} readOnly={disabled}
    showSummary={phase === 2} onChange={onAnswerChange} />;
}

function DynamicTableStrategy({ question, phase, baselineAnswer, answers, onAnswerChange }: StrategyProps) {
  return phase === 1
    ? <DynamicTableField question={question} value={answers[question.id] ?? ""} editable
      onChange={(value) => onAnswerChange(question.id, value)} />
    : <div className="subjective-input">
      <div className="subjective-baseline"><strong>Jadual Fasa 1</strong>
        <DynamicTableField question={question} value={baselineAnswer} />
      </div>
      <NumericScoreInput question={question} answers={answers} onAnswerChange={onAnswerChange} />
    </div>;
}

function SubjectiveStrategy({ question, phase, baselineAnswer, answers, onAnswerChange }: StrategyProps) {
  if (question.type === "subjective_single") {
    return <label className="subjective-single-answer"><span>Jawapan</span>
      <input type="text" aria-label={`Jawapan ${question.id}`} maxLength={500}
        value={phase === 1 ? answers[question.id] ?? "" : baselineAnswer}
        readOnly={phase === 2} onChange={(event) => onAnswerChange(question.id, event.target.value)} />
    </label>;
  }
  return phase === 1
    ? <SubjectiveAnswerField questionId={question.id} value={answers[question.id] ?? ""}
      onChange={(value) => onAnswerChange(question.id, value)} />
    : <div className="subjective-input">
      <div className="subjective-baseline"><strong>Jawapan Fasa 1</strong>
        {baselineAnswer.split("\n").filter(Boolean).length
          ? <ol className="subjective-baseline-list">{baselineAnswer.split("\n").filter(Boolean).map((item, index) => <li key={index}>{item}</li>)}</ol>
          : <span>Tiada jawapan</span>}
      </div>
      <NumericScoreInput question={question} answers={answers} onAnswerChange={onAnswerChange} />
    </div>;
}

function QuantitativeStrategy({ question, phase, answers, onAnswerChange }: StrategyProps) {
  return <div className="quantitative-inputs">
    <label>{phase === 1 ? "Jumlah tersedia" : "Angka disahkan"}
      <input aria-label={`${phase === 1 ? "Jumlah tersedia" : "Angka disahkan"} ${question.id}`}
        type="number" min="0" step="1" value={answers[question.id] ?? ""}
        onChange={(event) => onAnswerChange(question.id, event.target.value)} placeholder="0" />
    </label>
    <small>Rujukan sahaja · tidak dinilai</small>
  </div>;
}

function QualitativeStrategy({ question, answers, onAnswerChange, onAnswerPatch }: StrategyProps) {
  const selectedAnswer = answers[`${question.id}-yn`];
  const rangeQuestion = question.type === "qualitative_range";
  const graded = question.type === "qualitative" || question.type === "qualitative_with_note";
  const selectedRange = rangeQuestion && Array.isArray(question.scoreRanges)
    ? question.scoreRanges.find((range) => {
      if (!range || !Number.isFinite(range.min)) return false;
      const value = Number(answers[question.id]);
      return Number.isFinite(value) && value >= range.min && (range.max == null || value <= range.max);
    })
    : undefined;

  return <div className="grading-control">
    <div className="yes-no-control">
      <button type="button" className={selectedAnswer === "Ya" ? "answer-active" : ""}
        onClick={() => onAnswerPatch({ [`${question.id}-yn`]: "Ya", [question.id]: "" })}>Ya</button>
      <button type="button" className={selectedAnswer === "Tidak" ? "answer-active" : ""}
        onClick={() => onAnswerPatch({ [`${question.id}-yn`]: "Tidak", [question.id]: "0" })}>Tidak</button>
    </div>
    {graded && selectedAnswer === "Ya" && <select aria-label="Pilih gred" className="grade-select"
      value={answers[question.id] ?? ""} onChange={(event) => onAnswerChange(question.id, event.target.value)}>
      <option value="">Gred</option>{[1, 2, 3, 4, 5].map((grade) => <option key={grade} value={grade}>Gred {grade}</option>)}
    </select>}
    {rangeQuestion && selectedAnswer === "Ya" && <label className="range-count-input">Jumlah pengikut / suka
      <input type="number" min={question.scoreRanges?.[0]?.min ?? 1} step="1"
        aria-label={`Jumlah pengikut atau suka ${question.id}`} value={answers[question.id] ?? ""}
        onChange={(event) => onAnswerChange(question.id, event.target.value)} />
    </label>}
    {rangeQuestion && selectedAnswer === "Ya" && selectedRange
      && <small className="range-score-hint">Skala {selectedRange.score} / 5 · {selectedRange.label}</small>}
  </div>;
}

const STRATEGIES: Record<Category, Strategy> = {
  qualitative: QualitativeStrategy,
  objective: ObjectiveStrategy,
  quantitative: QuantitativeStrategy,
  subjective: SubjectiveStrategy,
  financial: FinancialStrategy,
  dynamic_table: DynamicTableStrategy,
};

function noteLabel(question: Question) {
  return typeof question.notePrompt === "string" && question.notePrompt.trim()
    ? question.notePrompt.trim()
    : "Nota";
}

export function QuestionFieldDispatcher(props: Props) {
  if (!props.question || typeof props.question !== "object") {
    return <div className="question-field-fallback" role="status">Konfigurasi soalan tidak tersedia.</div>;
  }
  const safeProps = {
    ...props,
    answers: props.answers && typeof props.answers === "object" ? props.answers : {},
    baselineAnswer: typeof props.baselineAnswer === "string" ? props.baselineAnswer : "",
    financialItems: Array.isArray(props.financialItems) ? props.financialItems : [],
    financialThresholds: Array.isArray(props.financialThresholds) ? props.financialThresholds : [],
  };
  const category = Object.prototype.hasOwnProperty.call(QUESTION_CATEGORIES, safeProps.question.type)
    ? QUESTION_CATEGORIES[safeProps.question.type]
    : undefined;
  const StrategyComponent = category ? STRATEGIES[category] : undefined;
  if (!StrategyComponent) {
    return <div className="question-field-fallback" role="status">
      Jenis soalan ini tidak disokong. Hubungi pentadbir untuk menyemak konfigurasi.
    </div>;
  }
  if (safeProps.phase === 2 && safeProps.question.isSurvey) {
    return safeProps.question.type === "quantitative"
      ? <label className="survey-answer-display"><strong>Angka Fasa 1 · Baca sahaja</strong>
        <input aria-label={`Angka Fasa 1 ${safeProps.question.id}`} type="number" value={safeProps.baselineAnswer} disabled />
        <small>Rujukan sahaja · tidak dinilai</small>
      </label>
      : <label className="survey-answer-display"><strong>Jawapan Fasa 1 · Baca sahaja</strong>
        <textarea aria-label={`Jawapan Fasa 1 ${safeProps.question.id}`} disabled value={safeProps.baselineAnswer}
          placeholder="Tiada jawapan Fasa 1 direkodkan." rows={2} />
      </label>;
  }

  return <>
    <StrategyComponent {...safeProps} />
    {(safeProps.question.type === "qualitative_with_note" || safeProps.question.type === "qualitative_note_only")
      && <label className="subjective-input qualitative-note-input">
        <span>{noteLabel(safeProps.question)} (pilihan)</span>
        <textarea aria-label={`${noteLabel(safeProps.question)} pilihan ${safeProps.question.id}`}
          rows={3} maxLength={5000} value={safeProps.answers[`${safeProps.question.id}-note`] ?? ""}
          onChange={(event) => safeProps.onAnswerChange(`${safeProps.question.id}-note`, event.target.value)} />
      </label>}
  </>;
}

function DynamicTableField({ question, value, editable = false, onChange }: {
  question: Question;
  value: string;
  editable?: boolean;
  onChange?: (value: string) => void;
}) {
  const table = parseDynamicTableAnswer(value, question);
  const updateTable = (nextTable: DynamicTableAnswer) => onChange?.(JSON.stringify(nextTable));
  return <div className="dynamic-table-field">
    {question.tableInstruction?.trim() && <p>{question.tableInstruction}</p>}
    <div className="table-scroll"><table className="dynamic-answer-table"><thead><tr><th>No.</th>
      {table.columns.slice(1).map((column, index) => <th key={index}>{column}</th>)}
    </tr></thead><tbody>{table.rows.map((row, rowIndex) => <tr key={rowIndex}><td>{rowIndex + 1}</td>
      {table.columns.slice(1).map((column, columnIndex) => <td key={columnIndex}>
        <input aria-label={`Baris ${rowIndex + 1}, ${column}`} value={row[columnIndex] ?? ""}
          readOnly={!editable} onChange={(event) => updateTable({ ...table, rows: table.rows.map((cells, index) =>
            index === rowIndex ? cells.map((cell, cellIndex) => cellIndex === columnIndex ? event.target.value : cell) : cells) })} />
      </td>)}
    </tr>)}</tbody></table></div>
  </div>;
}

function SubjectiveAnswerField({ questionId, value, onChange }: {
  questionId: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const rows = value ? value.split("\n") : [""];
  const updateRows = (nextRows: string[]) => onChange(nextRows.join("\n"));
  return <div className="subjective-answer-list">
    {rows.map((row, index) => <div className="subjective-answer-row" key={index}>
      <span className="subjective-answer-index">{index + 1}</span>
      <input aria-label={`Jawapan ${index + 1} ${questionId}`} placeholder={`Jawapan ${index + 1}`} value={row}
        onChange={(event) => updateRows(rows.map((current, currentIndex) => currentIndex === index ? event.target.value : current))} />
      {rows.length > 1 && <button type="button" className="question-delete-button" aria-label={`Padam jawapan ${index + 1}`}
        onClick={() => updateRows(rows.filter((_, currentIndex) => currentIndex !== index))}><Trash2 size={14} /></button>}
    </div>)}
    <button type="button" className="question-add-button topic-add-button" onClick={() => updateRows([...rows, ""])}>
      <Plus size={14} /> Tambah jawapan
    </button>
  </div>;
}
