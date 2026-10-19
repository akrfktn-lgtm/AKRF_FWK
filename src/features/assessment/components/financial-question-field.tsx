"use client";

import { evaluateFinancialQuestion, financialItemKey } from "../../../lib/financial.mjs";

export type FinancialItem = { id: string; questionCode: string; label: string; kind: "income" | "expense" };
export type FinancialThreshold = { id: string; min: number; max: number | null; score: number };

const rm = (value: number) => `RM ${new Intl.NumberFormat("ms-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value)}`;

type Props = {
  questionId: string;
  items: FinancialItem[];
  thresholds: FinancialThreshold[];
  answers: Record<string, string>;
  readOnly?: boolean;
  showSummary?: boolean;
  onChange: (key: string, value: string) => void;
};

export function FinancialQuestionField({ questionId, items, thresholds, answers, readOnly = false, showSummary = false, onChange }: Props) {
  const result = evaluateFinancialQuestion(questionId, items, answers, thresholds);
  const groups = [{ kind: "income" as const, title: "Pendapatan" }, { kind: "expense" as const, title: "Perbelanjaan" }];

  if (!items.length) return <small className="financial-empty">Tiada item kewangan ditetapkan. Minta admin tambah item di Konfigurasi.</small>;

  return <div className="financial-field">
    {groups.map((group) => {
      const groupItems = items.filter((item) => item.kind === group.kind);
      if (!groupItems.length) return null;
      return <fieldset className="financial-group" key={group.kind}>
        <legend>{group.title}</legend>
        {groupItems.map((item) => {
          const key = financialItemKey(questionId, item.id);
          const invalid = result.invalidItemIds.includes(item.id);
          return <label className="financial-row" key={item.id}>
            <span>{item.label}</span>
            <span className="financial-input">RM<input type="text" inputMode="decimal" aria-label={`${item.label} (RM)`} aria-invalid={invalid} disabled={readOnly} value={answers[key] ?? ""} placeholder="0.00" onChange={(event) => onChange(key, event.target.value)} /></span>
          </label>;
        })}
      </fieldset>;
    })}
    {showSummary && <div className="financial-summary" aria-live="polite">
      <div><span>Jumlah pendapatan</span><strong>{rm(result.totalIncome)}</strong></div>
      <div><span>Jumlah perbelanjaan</span><strong>{rm(result.totalExpense)}</strong></div>
      <div><span>Penggunaan</span><strong>{result.utilizationPercentage.toFixed(2)}%</strong></div>
    </div>}
    {result.invalidItemIds.length > 0 && <small className="financial-error" role="alert">Masukkan jumlah RM yang sah (tidak negatif, maksimum 2 tempat perpuluhan).</small>}
  </div>;
}
