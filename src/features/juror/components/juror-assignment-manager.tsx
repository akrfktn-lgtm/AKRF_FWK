"use client";

import { useEffect, useMemo, useState } from "react";
import { Save, ShieldCheck } from "lucide-react";

type Section = string;
type Topic = { id: string; name: string };
type Assignment = { user_id: string; topic_id: string };
type JurorAccount = { id: string; full_name: string };

export function JurorAssignmentManager({
  topics,
  sectionNames,
  assignments,
  jurors,
  isSaving,
  onSave,
}: {
  topics: Record<Section, Topic[]>;
  sectionNames: Record<Section, string>;
  assignments: Assignment[];
  jurors: JurorAccount[];
  isSaving: boolean;
  onSave: (assignments: Assignment[]) => void;
}) {
  const [draft, setDraft] = useState<Record<string, string[]>>({});
  const [validationMessage, setValidationMessage] = useState("");
  const sectionTopics = useMemo(() => Object.entries(topics).map(([section, items]) => ({
    section,
    items,
    topicIds: items.map((topic) => topic.id),
  })), [topics]);

  useEffect(() => {
    const nextDraft: Record<string, string[]> = {};
    sectionTopics.forEach(({ section, topicIds }) => {
      const jurorsForSection = new Set(
        assignments.filter((assignment) => topicIds.includes(assignment.topic_id)).map((assignment) => assignment.user_id),
      );
      nextDraft[section] = [...jurorsForSection];
    });
    setDraft(nextDraft);
  }, [assignments, sectionTopics]);

  function toggleAssignee(section: string, userId: string, checked: boolean) {
    setDraft((current) => {
      const assignees = new Set(current[section] ?? []);
      if (checked) assignees.add(userId);
      else assignees.delete(userId);
      return { ...current, [section]: [...assignees] };
    });
  }

  function save() {
    setValidationMessage("");
    onSave(sectionTopics.flatMap(({ items, section }) => items.flatMap((topic) =>
      (draft[section] ?? []).map((user_id) => ({ user_id, topic_id: topic.id })),
    )));
  }

  return <section className="panel question-section-panel juror-assignment-panel">
    <div className="question-section-heading">
      <div><span className="form-step"><ShieldCheck size={14} /> PENGUASAAN SERVER</span><h2>Tugasan juri mengikut Seksyen</h2><p>Tugasan adalah pilihan. Seksyen tanpa juri tidak boleh dinilai dalam Fasa 2; akaun juri tanpa tugasan masih boleh melihat dashboard dan laporan tetapi tidak boleh menghantar penilaian.</p></div>
      <button className="question-save-button" type="button" onClick={save} disabled={isSaving}><Save size={15} />{isSaving ? "Menyimpan..." : "Simpan tugasan"}</button>
    </div>
    {!jurors.length && <div className="empty-state">Tiada akaun berperanan juri.</div>}
    {validationMessage && <p className="auth-message" role="alert">{validationMessage}</p>}
    <div className="table-scroll"><table className="question-config-table">
      <thead><tr><th>Seksyen</th><th>Topik dalam Seksyen</th><th>Juri ditugaskan</th></tr></thead>
      <tbody>{sectionTopics.map(({ section, items }) => <tr key={section}>
        <td>{sectionNames[section] ?? section}</td><td>{items.map((topic) => topic.name).join(", ")}</td>
        <td><div className="juror-assignee-list" style={{ display: "flex", flexWrap: "wrap", gap: "8px 16px" }}>{jurors.map((juror) => <label className="juror-assignee-choice" key={juror.id} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <input
            type="checkbox"
            style={{ width: 16, height: 16 }}
            checked={draft[section]?.includes(juror.id) ?? false}
            onChange={(event) => toggleAssignee(section, juror.id, event.target.checked)}
          />
          <span>{juror.full_name || juror.id}</span>
        </label>)}</div></td>
      </tr>)}</tbody>
    </table></div>
  </section>;
}
