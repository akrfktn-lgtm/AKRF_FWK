"use client";

import { useEffect, useState } from "react";
import { LoaderCircle, Plus, Save, ShieldCheck, Trash2 } from "lucide-react";
import { supabase } from "../../../lib/supabase";
import { validateThresholds } from "../../../lib/financial.mjs";
import type { FinancialItem, FinancialThreshold } from "../../assessment/components/financial-question-field";

type Draft = { min: string; max: string; score: string };

const toDraft = (thresholds: FinancialThreshold[]): Draft[] =>
  thresholds.map((band) => ({ min: String(band.min), max: band.max == null ? "" : String(band.max), score: String(band.score) }));

type ItemsProps = {
  questionCode: string;
  expectedVersion: number;
  persisted: boolean;
  items: FinancialItem[];
  onNotice: (message: string) => void;
  onChanged: () => void;
};

export function FinancialItemsEditor({ questionCode, expectedVersion, persisted, items, onNotice, onChanged }: ItemsProps) {
  const [label, setLabel] = useState("");
  const [kind, setKind] = useState<"income" | "expense">("income");
  const [busy, setBusy] = useState(false);
  const shown = items.filter((item) => item.questionCode === questionCode);

  async function addItem() {
    if (!supabase || !label.trim()) return;
    setBusy(true);
    try {
      const { error } = await supabase.rpc("manage_financial_line_item", {
        p_action: "add",
        p_expected_version: expectedVersion,
        p_question_code: questionCode,
        p_label: label.trim(),
        p_kind: kind,
      });
      if (error) throw new Error(error.message);
      setLabel("");
      onChanged();
    } catch (error) {
      onNotice(`Gagal tambah item: ${error instanceof Error ? error.message : "ralat tidak diketahui"}`);
    } finally {
      setBusy(false);
    }
  }

  async function removeItem(id: string) {
    if (!supabase) return;
    setBusy(true);
    try {
      const { error } = await supabase.rpc("manage_financial_line_item", {
        p_action: "archive",
        p_expected_version: expectedVersion,
        p_question_code: questionCode,
        p_id: id,
      });
      if (error) throw new Error(error.message);
      onChanged();
    } catch (error) {
      onNotice(`Gagal padam item: ${error instanceof Error ? error.message : "ralat tidak diketahui"}`);
    } finally {
      setBusy(false);
    }
  }

  return <div className="financial-items-editor">
    <strong>Item pendapatan &amp; perbelanjaan (RM)</strong>
    {!persisted && <small className="field-hint">Klik &quot;Simpan Semua Perubahan&quot; dahulu, kemudian tambah item.</small>}
    {persisted && <>
      <ul className="financial-item-list">
        {shown.map((item) => <li key={item.id}><span>{item.label}</span><em>{item.kind === "income" ? "Pendapatan" : "Perbelanjaan"}</em><button className="question-delete-button" type="button" aria-label={`Padam ${item.label}`} disabled={busy} onClick={() => removeItem(item.id)}><Trash2 size={14} /></button></li>)}
        {!shown.length && <li className="question-empty-state">Belum ada item.</li>}
      </ul>
      <div className="financial-item-add">
        <input aria-label={`Label item ${questionCode}`} value={label} maxLength={200} placeholder="Contoh: Kutipan Jumaat" onChange={(event) => setLabel(event.target.value)} />
        <select aria-label={`Jenis item ${questionCode}`} value={kind} onChange={(event) => setKind(event.target.value as "income" | "expense")}><option value="income">Pendapatan</option><option value="expense">Perbelanjaan</option></select>
        <button className="question-add-button topic-add-button" type="button" disabled={busy || !label.trim()} onClick={addItem}><Plus size={14} /> Tambah</button>
      </div>
    </>}
  </div>;
}

type ThresholdProps = {
  thresholds: FinancialThreshold[];
  expectedVersion: number;
  onNotice: (message: string) => void;
  onChanged: () => void;
};

export function FinancialConfigManager({ thresholds, expectedVersion, onNotice, onChanged }: ThresholdProps) {
  const [draft, setDraft] = useState<Draft[]>(() => toDraft(thresholds));
  const [busy, setBusy] = useState(false);

  useEffect(() => { setDraft(toDraft(thresholds)); }, [thresholds]);

  function update(index: number, changes: Partial<Draft>) {
    setDraft((current) => current.map((band, position) => position === index ? { ...band, ...changes } : band));
  }

  async function saveThresholds() {
    if (!supabase) return;
    if (draft.some((band) => !band.min.trim() || !band.score.trim()
      || (band.max.trim() !== "" && !Number.isFinite(Number(band.max))))) {
      onNotice("Isi nilai minimum dan skor bagi setiap julat. Maksimum boleh dibiarkan kosong.");
      return;
    }
    const bands = draft.map((band) => ({ min: Number(band.min), max: band.max.trim() === "" ? null : Number(band.max), score: Number(band.score) }));
    const problem = validateThresholds(bands);
    if (problem) { onNotice(problem); return; }
    setBusy(true);
    try {
      const { error } = await supabase.rpc("save_financial_score_thresholds", {
        p_thresholds: bands,
        p_expected_version: expectedVersion,
      });
      if (error) throw new Error(error.message);
      onNotice("Julat skor kewangan disimpan.");
      onChanged();
    } catch (error) {
      onNotice(`Gagal simpan julat kewangan: ${error instanceof Error ? error.message : "ralat tidak diketahui"}`);
    } finally {
      setBusy(false);
    }
  }

  return <section className="panel question-section-panel financial-config">
    <div className="question-section-heading"><div><span className="form-step"><ShieldCheck size={14} /> ADMIN</span><h2>Julat Skor Kewangan</h2><p>Peratus penggunaan (perbelanjaan ÷ pendapatan) kepada skor 1–5. Minimum termasuk, maksimum tidak termasuk.</p></div></div>
    <div className="financial-threshold-list">
      {draft.map((band, index) => <div className="question-range-row" key={index}>
        <label>Min %<input type="number" min="0" step="0.01" value={band.min} onChange={(event) => update(index, { min: event.target.value })} /></label>
        <label>Max %<input type="number" min="0" step="0.01" value={band.max} placeholder="Tiada had" onChange={(event) => update(index, { max: event.target.value })} /></label>
        <label>Skor<input type="number" min="1" max="5" step="1" value={band.score} onChange={(event) => update(index, { score: event.target.value })} /></label>
        <button className="question-delete-button" type="button" aria-label={`Padam julat ${index + 1}`} onClick={() => setDraft((current) => current.filter((_, position) => position !== index))}><Trash2 size={14} /></button>
      </div>)}
    </div>
    <div className="new-question-actions">
      <button className="button button-outline" type="button" onClick={() => setDraft((current) => [...current, { min: String(Number(current.at(-1)?.max) || 0), max: "", score: "1" }])}><Plus size={14} /> Tambah julat</button>
      <button className="button button-primary" type="button" disabled={busy} onClick={saveThresholds}>{busy ? <LoaderCircle className="question-spinner" size={16} /> : <Save size={16} />} Simpan julat</button>
    </div>
  </section>;
}
