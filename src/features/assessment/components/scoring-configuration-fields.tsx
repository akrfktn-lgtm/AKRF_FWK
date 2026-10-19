"use client";

import { Plus, Trash2 } from "lucide-react";
import type { ObjectiveOption } from "../assessment-types";

export function ObjectiveOptionsEditor({ options, onChange }: { options: ObjectiveOption[]; onChange: (options: ObjectiveOption[]) => void }) {
  const currentOptions = Array.isArray(options)
    ? options.filter((option) => option && typeof option.id === "string" && typeof option.label === "string")
    : [];
  return <div className="objective-options-editor">
    <strong>Pilihan jawapan dan markah</strong>
    {currentOptions.map((option, index) => <div className="objective-option-row" key={option.id}>
      <label>Jawapan {index + 1}<input required maxLength={300} value={option.label} onChange={(event) => onChange(currentOptions.map((item) => item.id === option.id ? { ...item, label: event.target.value } : item))} /></label>
      <label>Markah<input required type="number" min="0" max="99999.99" step="0.01" value={option.score} onChange={(event) => onChange(currentOptions.map((item) => item.id === option.id ? { ...item, score: Number(event.target.value) } : item))} /></label>
      <button className="question-delete-button" type="button" aria-label={`Padam pilihan ${index + 1}`} disabled={currentOptions.length <= 2} onClick={() => onChange(currentOptions.filter((item) => item.id !== option.id))}><Trash2 size={14} /></button>
    </div>)}
    {!currentOptions.length && <small className="question-field-fallback">Tiada pilihan yang boleh digunakan. Tambah sekurang-kurangnya dua pilihan.</small>}
    <button className="question-add-button topic-add-button" type="button" onClick={() => onChange([...currentOptions, { id: crypto.randomUUID(), label: `Pilihan ${currentOptions.length + 1}`, score: 1 }])}><Plus size={14} /> Tambah pilihan</button>
    <small>Semua pilihan diterima sebagai jawapan. Markah maksimum soalan ditetapkan daripada markah pilihan tertinggi.</small>
  </div>;
}
