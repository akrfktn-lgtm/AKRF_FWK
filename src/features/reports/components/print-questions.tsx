"use client";

import { useState } from "react";
import { Download, Eye, FileText, Printer } from "lucide-react";
import { orderedTopicContent } from "../../../lib/assessment-structure.mjs";

type PrintQuestion = {
  id: string;
  text: string;
  type: string;
  topicId: string;
  subtopicId: string | null;
  additionalTopicId?: string | null;
  sortOrder: number;
  displayOrder: number;
  notePrompt?: string;
  tableColumns?: string[];
  tableRows?: number;
  objectiveOptions?: Array<{ id: string; label: string; score: number }>;
};
type PrintTopic = { id: string; name: string };
type PrintSubtopic = { id: string; topicId: string; name: string; sortOrder: number };
type PrintAdditionalTopic = { id: string; subtopicId: string; name: string; sortOrder: number };
type TopicContent =
  | { kind: "question"; question: PrintQuestion }
  | { kind: "subtopic"; subtopic: PrintSubtopic; content: Array<{ kind: "question"; question: PrintQuestion } | { kind: "additionalTopic"; additionalTopic: PrintAdditionalTopic; questions: PrintQuestion[] }> };
type PrintFinancialItem = { id: string; questionCode: string; label: string; kind: "income" | "expense" };

type Props = {
  sections: string[];
  sectionNames: Record<string, string>;
  questionConfig: Record<string, PrintQuestion[]>;
  topicConfig: Record<string, PrintTopic[]>;
  subtopicConfig: Record<string, PrintSubtopic[]>;
  additionalTopicConfig: Record<string, PrintAdditionalTopic[]>;
  financialItems?: PrintFinancialItem[];
};

const ALL = "__all__";
const NOTE_LINES = 2;

function NoteLines({ count = NOTE_LINES, label = "Catatan:" }: { count?: number; label?: string }) {
  return (
    <div className="pq-notes">
      <span>{label}</span>
      {Array.from({ length: count }, (_, index) => <i key={index} className="pq-line" />)}
    </div>
  );
}

function Answer({ question, financialItems }: { question: PrintQuestion; financialItems: PrintFinancialItem[] }) {
  switch (question.type) {
    case "auto_calculated_financial":
      // Descriptions and blank RM lines only: no totals, formula or score.
      return <div className="pq-financial">{financialItems.filter((item) => item.questionCode === question.id).map((item) => <div key={item.id} className="pq-financial-row"><span>{item.label}</span><span>RM ____________</span></div>)}</div>;
    case "qualitative_note_only":
    case "subjective":
      return <NoteLines count={3} label={question.notePrompt || "Catatan:"} />;
    case "quantitative":
      return <div className="pq-options">Kuantiti: <i className="pq-blank pq-blank-short" /></div>;
    case "qualitative_range":
      return <div className="pq-options"><span className="pq-scale">(1)</span><span className="pq-scale">(2)</span><span className="pq-scale">(3)</span><span className="pq-scale">(4)</span><span className="pq-scale">(5)</span></div>;
    case "objective":
      return <div className="pq-objective-options">{(question.objectiveOptions ?? []).map((option) => <span key={option.id}>[&nbsp;&nbsp;] {option.label} <strong>({option.score} markah)</strong></span>)}</div>;
    case "dynamic_table": {
      const columns = question.tableColumns?.length ? question.tableColumns : ["", "", ""];
      const rows = Math.max(question.tableRows ?? 3, 1);
      return (
        <table className="pq-table">
          <thead><tr>{columns.map((column, index) => <th key={index}>{column}</th>)}</tr></thead>
          <tbody>{Array.from({ length: rows }, (_, row) => <tr key={row}>{columns.map((_, col) => <td key={col}>&nbsp;</td>)}</tr>)}</tbody>
        </table>
      );
    }
    case "qualitative_with_note":
      return <><div className="pq-options">[&nbsp;&nbsp;] ADA &nbsp;/&nbsp; [&nbsp;&nbsp;] TIADA</div><NoteLines label={question.notePrompt || "Catatan:"} /></>;
    default:
      return <><div className="pq-options">[&nbsp;&nbsp;] ADA &nbsp;/&nbsp; [&nbsp;&nbsp;] TIADA</div><NoteLines /></>;
  }
}

export function PrintQuestions({ sections, sectionNames, questionConfig, topicConfig, subtopicConfig, additionalTopicConfig, financialItems = [] }: Props) {
  const [selected, setSelected] = useState(sections[0] ?? ALL);
  const [previewed, setPreviewed] = useState<string | null>(null);

  const shown = previewed === ALL ? sections : previewed ? [previewed] : [];
  const selectedSections = selected === ALL ? sections : [selected];
  const questionCount = selectedSections.reduce((count, code) => count + (questionConfig[code]?.length ?? 0), 0);
  const topicCount = selectedSections.reduce((count, code) => count + (topicConfig[code]?.length ?? 0), 0);
  const subtopicCount = selectedSections.reduce((count, code) => count + (subtopicConfig[code]?.length ?? 0), 0);
  const additionalTopicCount = selectedSections.reduce((count, code) => count + (additionalTopicConfig[code]?.length ?? 0), 0);

  function print() {
    const previousTitle = document.title;
    document.title = "AKRF FELDA WILAYAH KUANTAN - Soalan";
    window.print();
    document.title = previousTitle;
  }

  function printNow() {
    setPreviewed(selected);
    // Allow the preview to render before the print dialog opens.
    setTimeout(print, 100);
  }

  return (
    <div className="pq-workspace">
      <section className="panel pq-toolbar no-print">
        <div className="pq-heading">
          <span className="form-step">RUANG KERJA</span>
          <h2>Cetak Soalan</h2>
          <p>Sediakan borang penilaian untuk dicetak atau disimpan sebagai PDF.</p>
        </div>
        <label className="field-label pq-select">
          Seksyen
          <select value={selected} onChange={(event) => { setSelected(event.target.value); setPreviewed(null); }}>
            {sections.map((code) => <option key={code} value={code}>{sectionNames[code] ?? code}</option>)}
            <option value={ALL}>Semua seksyen</option>
          </select>
        </label>
        <div className="pq-summary" aria-live="polite">
          <FileText size={19} aria-hidden="true" />
          <span><strong>{questionCount}</strong> soalan <i /> <strong>{topicCount}</strong> Topics <i /> <strong>{subtopicCount}</strong> Sub-topics <i /> <strong>{additionalTopicCount}</strong> Additional Topics</span>
        </div>
        <div className="pq-actions">
          <button type="button" className="button button-outline" onClick={() => setPreviewed(selected)}><Eye size={16} />Paparan</button>
          <button type="button" className="button button-outline" disabled={!previewed} onClick={print} title="Pilih 'Save as PDF' pada dialog cetakan"><Download size={16} />Muat Turun PDF</button>
          <button type="button" className="button button-primary" onClick={printNow}><Printer size={16} />Cetak Direct</button>
        </div>
      </section>

      <div className="pq-stage">
        {!shown.length && (
          <div className="pq-empty no-print">
            <span className="pq-empty-icon"><FileText size={25} aria-hidden="true" /></span>
            <div><h3>PAPARAN SOALAN</h3><p>Pilih seksyen di atas, kemudian tekan <strong>Paparan</strong> untuk semak susun atur sebelum mencetak.</p></div>
          </div>
        )}
        {shown.length > 0 && (
          <>
          <div className="pq-stage-heading no-print"><span>PRATONTON CETAK</span><span>{previewed === ALL ? "Semua seksyen" : sectionNames[previewed ?? ""] ?? previewed}</span></div>
          <article className="pq-paper" id="print-area">
            <header className="pq-doc-head">
              <h1>AKRF FELDA WILAYAH KUANTAN</h1>
              <div className="pq-fields">
                <div>Rancangan: <i className="pq-blank" /></div>
                <div>Blok: <i className="pq-blank" /></div>
                <div>Penilai: <i className="pq-blank" /></div>
                <div>Tarikh: <i className="pq-blank" /></div>
              </div>
            </header>

            {shown.map((code) => {
              const questions = questionConfig[code] ?? [];
              const topics = topicConfig[code] ?? [];
              const subtopics = subtopicConfig[code] ?? [];
              const additionalTopics = additionalTopicConfig[code] ?? [];
              let number = 0;
              return (
                <section key={code} className="pq-section">
                  <h2>{(sectionNames[code] ?? code).toUpperCase()}</h2>
                  {topics.map((topic) => {
                    const content = orderedTopicContent([topic], subtopics, questions, additionalTopics) as TopicContent[];
                    return (
                      <div key={topic.id} className="pq-topic">
                        <h3>{topic.name}</h3>
                        {content.map((item) => {
                          if (item.kind === "question") {
                            number += 1;
                            return (
                            <div key={item.question.id} className="pq-question">
                              <p className="pq-title">{number}. {item.question.text}</p>
                              <Answer question={item.question} financialItems={financialItems} />
                            </div>
                            );
                          }
                          return <div key={item.subtopic.id} className="pq-subtopic">
                            <h4>{item.subtopic.name}</h4>
                            {item.content.map((subtopicItem) => subtopicItem.kind === "question"
                              ? (() => {
                                number += 1;
                                return <div key={subtopicItem.question.id} className="pq-question">
                                  <p className="pq-title">{number}. {subtopicItem.question.text}</p>
                                  <Answer question={subtopicItem.question} financialItems={financialItems} />
                                </div>;
                              })()
                              : <section key={subtopicItem.additionalTopic.id} className="pq-additional-topic">
                                <h5>{subtopicItem.additionalTopic.name}</h5>
                                {subtopicItem.questions.map((question) => {
                                  number += 1;
                                  return <div key={question.id} className="pq-question">
                                    <p className="pq-title">{number}. {question.text}</p>
                                    <Answer question={question} financialItems={financialItems} />
                                  </div>;
                                })}
                              </section>)}
                          </div>;
                        })}
                      </div>
                    );
                  })}
                </section>
              );
            })}

            <footer className="pq-footer"><span className="pq-screen-page">1</span></footer>
          </article>
          </>
        )}
      </div>
    </div>
  );
}
