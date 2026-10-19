"use client";

import { useState } from "react";
import { Download, LoaderCircle, ShieldCheck, Upload } from "lucide-react";
import { supabase } from "../../../lib/supabase";
import { buildExportRows, buildQuestionCsv, CSV_HEADERS, decodeQuestionCsv, planQuestionImport } from "../../../lib/question-csv.mjs";

type SectionOption = { code: string; name: string };
type Props = {
  sections: SectionOption[];
  onNotice: (message: string) => void;
  onImported: () => void;
};

const MAX_FILE_BYTES = 2 * 1024 * 1024;

async function loadSectionData() {
  const [topics, subtopics, additionalTopics, questions] = await Promise.all([
    supabase!.from("topics").select("id, section_code, name, sort_order, max_marks").eq("active", true).order("sort_order"),
    supabase!.from("subtopics").select("id, topic_id, name, sort_order").eq("active", true).order("sort_order"),
    supabase!.from("additional_topics").select("id, subtopic_id, name, sort_order").eq("active", true).order("sort_order"),
    supabase!.from("questions").select("code, section, topic_id, subtopic_id, additional_topic_id, topic_name, prompt, question_type, max_score, is_survey, is_locked, note_prompt, score_ranges, scoring_parent_code, scoring_direction, percentage_thresholds, objective_options, table_instruction, table_columns, sort_order, display_order, active").eq("active", true).order("sort_order"),
  ]);
  const error = topics.error ?? subtopics.error ?? additionalTopics.error ?? questions.error;
  if (error) throw new Error(error.message);
  return { topics: topics.data ?? [], subtopics: subtopics.data ?? [], additionalTopics: additionalTopics.data ?? [], questions: questions.data ?? [] };
}

export function QuestionConfigManager({ sections, onNotice, onImported }: Props) {
  const [sectionCode, setSectionCode] = useState(sections[0]?.code ?? "");
  const [busy, setBusy] = useState<"" | "export" | "import">("");
  const [errors, setErrors] = useState<string[]>([]);
  const section = sections.find((item) => item.code === sectionCode);

  async function downloadCsv() {
    if (!supabase || !section) return;
    setBusy("export");
    try {
      const data = await loadSectionData();
      const topics = data.topics.filter((item) => item.section_code === section.code);
      const subtopics = data.subtopics.filter((item) => topics.some((topic) => topic.id === item.topic_id));
      const additionalTopics = data.additionalTopics.filter((item) => subtopics.some((subtopic) => subtopic.id === item.subtopic_id));
      const rows = buildExportRows(section, topics, data.questions, subtopics, additionalTopics);
      const blob = new Blob(["\uFEFF", buildQuestionCsv(rows)], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `soalan-${section.code.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.csv`;
      link.click();
      URL.revokeObjectURL(url);
      onNotice(rows.length ? `${rows.length} soalan dieksport.` : "Templat kosong dimuat turun (tiada soalan dalam seksyen ini).");
    } catch (error) {
      onNotice(`Gagal eksport: ${error instanceof Error ? error.message : "ralat tidak diketahui"}`);
    } finally {
      setBusy("");
    }
  }

  async function importCsv(file: File | undefined) {
    if (!supabase || !section || !file) return;
    setErrors([]);
    if (!/\.csv$/i.test(file.name)) { setErrors(["Hanya fail .csv dibenarkan."]); return; }
    if (file.size > MAX_FILE_BYTES) { setErrors(["Saiz fail melebihi 2 MB."]); return; }
    setBusy("import");
    try {
      const [text, data, sectionResult, versionBefore] = await Promise.all([
        file.arrayBuffer().then((buffer) => decodeQuestionCsv(new Uint8Array(buffer))),
        loadSectionData(),
        supabase.from("sections").select("code, name").eq("active", true),
        supabase.rpc("get_assessment_configuration_version"),
      ]);
      if (sectionResult.error) throw new Error(sectionResult.error.message);
      if (versionBefore.error) throw new Error(versionBefore.error.message);
      const plan = planQuestionImport(text, { sections: sectionResult.data ?? [], topics: data.topics, subtopics: data.subtopics, additionalTopics: data.additionalTopics, questions: data.questions }, section.code);
      if (plan.errors.length || !plan.topicRows || !plan.subtopicRows || !plan.additionalTopicRows || !plan.questionRows) { setErrors(plan.errors); return; }
      const versionAfter = await supabase.rpc("get_assessment_configuration_version");
      if (versionAfter.error) throw new Error(versionAfter.error.message);
      if (versionBefore.data !== versionAfter.data) {
        throw new Error("Konfigurasi telah berubah ketika fail import disediakan. Muat semula dan cuba lagi.");
      }
      const { error } = await supabase!.rpc("import_question_configuration", {
        p_expected_version: versionBefore.data,
        p_topics: plan.topicRows,
        p_subtopics: plan.subtopicRows,
        p_additional_topics: plan.additionalTopicRows,
        p_questions: plan.questionRows,
      });
      if (error) throw new Error(error.message);
      onNotice(`Import berjaya: ${plan.created} soalan dicipta, ${plan.updated} dikemas kini.`);
      onImported();
    } catch (error) {
      setErrors([`Gagal import: ${error instanceof Error ? error.message : "ralat tidak diketahui"}`]);
    } finally {
      setBusy("");
    }
  }

  return <section className="panel question-section-panel">
    <div className="question-section-heading"><div><span className="form-step"><ShieldCheck size={14} /> ADMIN</span><h2>Konfigurasi Soalan</h2><p>Muat turun atau muat naik soalan secara pukal (.csv) mengikut seksyen.</p></div></div>
    <label className="field-label">Seksyen
      <select value={sectionCode} onChange={(event) => { setSectionCode(event.target.value); setErrors([]); }} disabled={!!busy}>
        {sections.map((item) => <option key={item.code} value={item.code}>{item.name}</option>)}
      </select>
    </label>
    <p className="question-csv-hint">Lajur: {CSV_HEADERS.join(" | ")}. Sub-topic dan Additional Topic ialah pilihan. Untuk OBJECTIVE, isi Objective Options dengan JSON array berisi id, label dan score. Markah 0 ialah soalan tinjauan bukan objektif.</p>
    <div className="new-question-actions">
      <button className="button button-outline" type="button" onClick={downloadCsv} disabled={!section || !!busy}>{busy === "export" ? <LoaderCircle className="question-spinner" size={16} /> : <Download size={16} />} Muat turun templat / eksport soalan (.csv)</button>
      <label className="button button-primary" aria-disabled={!section || !!busy}>{busy === "import" ? <LoaderCircle className="question-spinner" size={16} /> : <Upload size={16} />} Muat naik / import soalan (.csv)
        <input type="file" accept=".csv,text/csv" hidden disabled={!section || !!busy} onChange={(event) => { const input = event.target; void importCsv(input.files?.[0]).finally(() => { input.value = ""; }); }} />
      </label>
    </div>
    {errors.length > 0 && <div className="alert-box alert-warning" role="alert"><ShieldCheck size={18} /><div><strong>{errors.length} ralat ditemui. Tiada data disimpan.</strong><ul>{errors.slice(0, 50).map((message, index) => <li key={index}>{message}</li>)}</ul>{errors.length > 50 && <span>...dan {errors.length - 50} lagi.</span>}</div></div>}
  </section>;
}
