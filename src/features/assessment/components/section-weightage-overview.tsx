"use client";

import { ShieldCheck, type LucideIcon } from "lucide-react";
import { deriveSectionWeights } from "../../../lib/scoring.mjs";

type Topic = { id: string; name: string; maxMarks?: number | null };
type Question = { topicId: string; max: number; isSurvey?: boolean; type: string };
type Props = {
  sectionCodes: string[];
  sectionNames: Record<string, string>;
  sectionIcons: Record<string, string>;
  topicDraft: Record<string, Topic[]>;
  questionDraft: Record<string, Question[]>;
  getSectionIcon: (code: string, iconCode?: string) => LucideIcon;
};

function topicMarks(topic: Topic, questions: Question[]) {
  const topicQuestions = questions.filter((question) => question.topicId === topic.id);
  const hasScoredQuestions = topicQuestions.some((question) =>
    !question.isSurvey && question.type !== "subjective_single" && question.type !== "quantitative");
  const calculatedMarks = topicQuestions.reduce((sum, question) =>
    sum + (question.isSurvey || question.type === "subjective_single" || question.type === "quantitative" ? 0 : Number(question.max) || 0), 0);
  return hasScoredQuestions ? topic.maxMarks ?? calculatedMarks : 0;
}

export function SectionWeightageOverview({
  sectionCodes,
  sectionNames,
  sectionIcons,
  topicDraft,
  questionDraft,
  getSectionIcon,
}: Props) {
  const derivedWeights = deriveSectionWeights(sectionCodes, topicDraft, questionDraft) as Record<string, number>;
  const totalWeight = sectionCodes.reduce((sum, section) => sum + derivedWeights[section], 0);

  return <div className="question-config-page section-weightage-page">
    <header className="question-config-header">
      <div><span className="eyebrow"><span className="eyebrow-line" /> RINGKASAN PEMBERAT</span><h1>Pemberat Seksyen &amp; Soalan</h1><p>Pecahan pemberat dikira secara automatik berdasarkan markah Topik.</p></div>
      <span className="admin-badge"><ShieldCheck size={15} /> DEV / ADMIN</span>
    </header>
    <section className="weight-overview" aria-labelledby="section-weight-overview-title">
      <div className="weight-overview-heading"><div><h2 id="section-weight-overview-title">Pemberat seksyen</h2><p>Tinjauan dan soalan kuantitatif rujukan tidak menambah pemberat.</p></div><div className={`weight-total-indicator ${Math.abs(totalWeight - 100) < 0.001 ? "is-valid" : "is-invalid"}`}><strong>{totalWeight.toFixed(2)}%</strong><span>Automatik</span></div></div>
      <div className="weight-overview-grid">{sectionCodes.map((section, index) => { const Icon = getSectionIcon(section, sectionIcons[section]); return <div className={`weight-overview-card weight-card-${index}`} key={section}><span className="weight-card-icon"><Icon size={17} /></span><span className="weight-card-name">{sectionNames[section] ?? section}</span><span className="weight-input-wrap"><input aria-label={`Pemberat ${sectionNames[section] ?? section}`} type="number" readOnly title="Dikira daripada markah Topik" value={derivedWeights[section]} /><span>%</span></span></div>; })}</div>
    </section>
    <section className="section-breakdown" aria-labelledby="section-breakdown-title">
      <div className="section-breakdown-heading"><div><h2 id="section-breakdown-title">Pecahan seksyen dan topik</h2><p>Jumlah soalan dan markah maksimum mengikut setiap Topik.</p></div></div>
      <div className="section-breakdown-grid">{sectionCodes.map((section, index) => {
        const Icon = getSectionIcon(section, sectionIcons[section]);
        const topics = topicDraft[section] ?? [];
        const questions = questionDraft[section] ?? [];
        const totalMarks = topics.reduce((sum, topic) => sum + topicMarks(topic, questions), 0);
        return <article className="section-breakdown-card" key={section}>
          <header><span className={`weight-icon weight-${index}`}><Icon size={17} /></span><div><h3>{sectionNames[section] ?? section}</h3><p>{questions.length} soalan · {totalMarks} markah maksimum</p></div><strong>{derivedWeights[section]}%</strong></header>
          <ul>{topics.map((topic) => {
            const topicQuestions = questions.filter((question) => question.topicId === topic.id);
            return <li key={topic.id}><span>{topic.name}</span><small>{topicQuestions.length} soalan</small><strong>{topicMarks(topic, questions)} markah</strong></li>;
          })}{!topics.length && <li className="section-breakdown-empty">Tiada topik ditetapkan.</li>}</ul>
        </article>;
      })}</div>
    </section>
  </div>;
}
