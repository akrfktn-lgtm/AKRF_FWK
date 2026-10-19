import { orderedTopicContent } from "./assessment-structure.mjs";

export const CSV_HEADERS = ["Section", "Topic", "Sub-topic", "Additional Topic", "Soalan", "Jenis Soalan", "Markah", "Objective Options"];
const PREVIOUS_CSV_HEADERS = ["Section", "Topic", "Sub-topic", "Additional Topic", "Soalan", "Jenis Soalan", "Markah"];
const PRE_OBJECTIVE_CSV_HEADERS = ["Section", "Topic", "Sub-topic", "Soalan", "Jenis Soalan", "Markah"];
const LEGACY_CSV_HEADERS = ["Section", "Sub-Section", "Soalan", "Jenis Soalan", "Markah"];
const HEADER_KEYS = {
  section: ["section", "seksyen", "bahagian"],
  topic: ["topic", "topik", "subsection", "subsectionname"],
  subtopic: ["subtopic", "subtopik"],
  additionalTopic: ["additionaltopic", "topiktambahan", "topictambahan"],
  question: ["soalan", "question"],
  type: ["jenissoalan", "questiontype", "type"],
  marks: ["markah", "marks", "score"],
  objectiveOptions: ["objectiveoptions", "pilihanmarkah", "pilihanjawapan"],
};

const DB_TYPES = ["qualitative", "qualitative_no_grade", "qualitative_with_note", "qualitative_note_only", "qualitative_range", "objective", "dynamic_table", "quantitative", "subjective", "subjective_single"];
const TYPE_BY_CSV = {
  BOOLEAN: "qualitative_no_grade",
  SCALE_1_5: "qualitative",
  TEXT: "subjective",
  NUMBER: "quantitative",
  ...Object.fromEntries(DB_TYPES.map((type) => [type.toUpperCase(), type])),
};
const CSV_BY_TYPE = { qualitative_no_grade: "BOOLEAN", qualitative: "SCALE_1_5", subjective: "TEXT", quantitative: "NUMBER" };
const FORMULA_START = /^[=+\-@\t\r]/;
const MAX_ROWS = 2000;

// Same preset as the Konfigurasi screen; admins adjust it there after import.
const DEFAULT_SCORE_RANGES = [
  { min: 100, max: 500, score: 1, label: "Sangat lemah" },
  { min: 501, max: 1000, score: 2, label: "Lemah" },
  { min: 1001, max: 2000, score: 3, label: "Sederhana" },
  { min: 2001, max: 9999, score: 4, label: "Baik" },
  { min: 10000, max: null, score: 5, label: "Cemerlang" },
];

export function questionTypeToCsv(type) {
  return CSV_BY_TYPE[type] ?? String(type).toUpperCase();
}

export function csvToQuestionType(value) {
  return TYPE_BY_CSV[String(value).trim().toUpperCase()] ?? null;
}

function escapeCell(value, isText) {
  let text = String(value ?? "");
  if (isText && FORMULA_START.test(text)) text = `'${text}`;
  return /[",\r\n;]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function restoreCell(value) {
  return /^'[=+\-@\t\r]/.test(value) ? value.slice(1) : value;
}

export function decodeQuestionCsv(bytes) {
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (data[0] === 0xff && data[1] === 0xfe) return new TextDecoder("utf-16le").decode(data.subarray(2));
  if (data[0] === 0xfe && data[1] === 0xff) return new TextDecoder("utf-16be").decode(data.subarray(2));
  if (data[0] === 0xef && data[1] === 0xbb && data[2] === 0xbf) return new TextDecoder("utf-8").decode(data.subarray(3));
  const text = new TextDecoder("utf-8").decode(data);
  return text.includes("\ufffd") ? new TextDecoder("windows-1252").decode(data) : text;
}

function headerKey(value) {
  const normalized = value.trim().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[\s_-]+/g, "");
  return Object.entries(HEADER_KEYS).find(([, aliases]) => aliases.includes(normalized))?.[0] ?? normalized;
}

/** Builds CSV text (comma-delimited, CRLF) from export rows. */
export function buildQuestionCsv(rows) {
  const lines = [CSV_HEADERS.map((header) => escapeCell(header, false)).join(",")];
  for (const row of rows) {
    lines.push([escapeCell(row.section, true), escapeCell(row.topic, true), escapeCell(row.subtopic, true), escapeCell(row.additionalTopic, true), escapeCell(row.question, true), escapeCell(row.type, false), escapeCell(row.marks, false), escapeCell(JSON.stringify(row.objectiveOptions ?? []), true)].join(","));
  }
  return lines.join("\r\n") + "\r\n";
}

/** RFC 4180 parser; comma, semicolon, and tab delimiters are detected from the header line. */
export function parseCsv(text) {
  const source = text.replace(/^\uFEFF/, "");
  const firstLine = source.split(/\r?\n/, 1)[0] ?? "";
  const delimiters = [",", ";", "\t"];
  const delimiter = delimiters.reduce((best, candidate) =>
    firstLine.split(candidate).length > firstLine.split(best).length ? candidate : best, ",");
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (quoted) {
      if (char === '"' && source[index + 1] === '"') { cell += '"'; index += 1; }
      else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"' && cell === "") quoted = true;
    else if (char === delimiter) { row.push(cell); cell = ""; }
    else if (char === "\n" || char === "\r") {
      if (char === "\r" && source[index + 1] === "\n") index += 1;
      row.push(cell); rows.push(row); row = []; cell = "";
    } else cell += char;
  }
  if (quoted) throw new Error("Fail CSV tidak sah: tanda petikan tidak ditutup.");
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((items) => items.some((item) => item.trim() !== ""));
}

function slug(value) {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function nextNumber(values, prefix) {
  return values.reduce((highest, value) => {
    if (!value.startsWith(prefix)) return highest;
    const number = Number(value.slice(prefix.length));
    return Number.isInteger(number) ? Math.max(highest, number) : highest;
  }, 0) + 1;
}

/**
 * Validates CSV text against current data and returns the rows to write.
 * existing: { sections: [{code,name}], topics: [{id,section_code,name,sort_order}], questions: [full question rows] }
 * sectionFilter: optional section code; rows from any other section are rejected.
 * Markah is the question maximum score; 0 resets that question to a zero-mark survey. New topics
 * created from all-zero rows also receive max_marks 0; existing Topic weighting is retained.
 * QUALITATIVE_RANGE questions without ranges receive the preset ranges.
 */
export function planQuestionImport(text, existing, sectionFilter) {
  const errors = [];
  let table;
  try { table = parseCsv(text); } catch (error) { return { errors: [error.message] }; }
  if (!table.length) return { errors: ["Fail CSV kosong."] };
  const header = table[0].map(headerKey);
  const current = header.length === CSV_HEADERS.length
    && header.every((item, index) => item === ["section", "topic", "subtopic", "additionalTopic", "question", "type", "marks", "objectiveOptions"][index]);
  const previous = header.length === PREVIOUS_CSV_HEADERS.length
    && header.every((item, index) => item === ["section", "topic", "subtopic", "additionalTopic", "question", "type", "marks"][index]);
  const preObjective = header.length === PRE_OBJECTIVE_CSV_HEADERS.length
    && header.every((item, index) => item === ["section", "topic", "subtopic", "question", "type", "marks"][index]);
  const legacy = header.length === LEGACY_CSV_HEADERS.length
    && header.every((item, index) => item === ["section", "topic", "question", "type", "marks"][index]);
  if (!current && !previous && !preObjective && !legacy) {
    return { errors: [`Pengepala lajur mesti tepat: ${CSV_HEADERS.join(" | ")} (format terdahulu: ${PRE_OBJECTIVE_CSV_HEADERS.join(" | ")}, ${PREVIOUS_CSV_HEADERS.join(" | ")} atau ${LEGACY_CSV_HEADERS.join(" | ")}).`] };
  }
  const dataRows = table.slice(1);
  if (!dataRows.length) return { errors: ["Fail CSV tiada baris soalan."] };
  if (dataRows.length > MAX_ROWS) return { errors: [`Maksimum ${MAX_ROWS} baris bagi satu muat naik.`] };

  const sectionByKey = new Map();
  existing.sections.forEach((section) => { sectionByKey.set(section.code.toLowerCase(), section); sectionByKey.set(section.name.toLowerCase(), section); });
  const topics = existing.topics.map((item) => ({ ...item }));
  const subtopics = (existing.subtopics ?? []).map((item) => ({ ...item }));
  const additionalTopics = (existing.additionalTopics ?? []).map((item) => ({ ...item }));
  const newTopics = [];
  const newSubtopics = [];
  const newAdditionalTopics = [];
  const questions = existing.questions.map((item) => ({ ...item }));
  const questionRows = new Map();
  const seen = new Set();
  const rowsByTopic = new Map();

  dataRows.forEach((cells, offset) => {
    const rowNumber = offset + 2;
    const fail = (message) => errors.push(`Baris ${rowNumber}: ${message}`);
    const expectedLength = current ? CSV_HEADERS.length : previous ? PREVIOUS_CSV_HEADERS.length : preObjective ? PRE_OBJECTIVE_CSV_HEADERS.length : LEGACY_CSV_HEADERS.length;
    if (cells.length !== expectedLength) return fail(`bilangan lajur mesti ${expectedLength}.`);
    const [sectionText, topicText, subtopicText, additionalTopicText, questionText, typeText, marksText, objectiveOptionsText] = current
      ? cells.map((item, index) => (index < 5 || index === 7 ? restoreCell(item.trim()) : item.trim()))
      : previous
        ? [cells[0], cells[1], cells[2], cells[3], cells[4], cells[5], cells[6], ""].map((item, index) => (index < 5 ? restoreCell(item.trim()) : item.trim()))
        : preObjective
          ? [cells[0], cells[1], cells[2], "", cells[3], cells[4], cells[5], ""].map((item, index) => (index < 5 ? restoreCell(item.trim()) : item.trim()))
          : [cells[0], cells[1], "", "", cells[2], cells[3], cells[4], ""].map((item, index) => (index < 5 ? restoreCell(item.trim()) : item.trim()));
    const missing = [
      [sectionText, "Section"],
      [topicText, "Topic"],
      [questionText, "Soalan"],
      [typeText, "Jenis Soalan"],
      [marksText, "Markah"],
    ].filter(([value]) => !value.trim()).map(([, label]) => label);
    if (missing.length) return fail(`medan wajib kosong (${missing.join(", ")}).`);

    const section = sectionByKey.get(sectionText.toLowerCase());
    if (!section) return fail(`Section "${sectionText}" tidak wujud.`);
    if (sectionFilter && section.code !== sectionFilter) return fail(`Section "${sectionText}" tidak sepadan dengan section yang dipilih.`);
    const type = csvToQuestionType(typeText);
    if (!type) return fail(`Jenis Soalan "${typeText}" tidak sah.`);
    if (!/^\d+(\.\d{1,2})?$/.test(marksText.replace(",", "."))) return fail(`Markah "${marksText}" mesti nombor bukan negatif.`);
    const marks = Number(marksText.replace(",", "."));
    if (marks > 100000) return fail("Markah melebihi 100000.");
    if (questionText.length > 2000) return fail("Soalan terlalu panjang (maksimum 2000 aksara).");
    let objectiveOptions = [];
    if (type === "objective") {
      try { objectiveOptions = JSON.parse(objectiveOptionsText); } catch { return fail("Objective Options mesti JSON yang mengandungi pilihan dan markah."); }
      if (!Array.isArray(objectiveOptions) || objectiveOptions.length < 2
        || objectiveOptions.some((option) => !option || typeof option.id !== "string" || !option.id.trim()
          || typeof option.label !== "string" || !option.label.trim() || option.label.length > 300
          || !Number.isFinite(option.score) || option.score < 0 || option.score > 99999.99)
        || new Set(objectiveOptions.map((option) => option.id)).size !== objectiveOptions.length
        || new Set(objectiveOptions.map((option) => option.label.trim().toLocaleLowerCase())).size !== objectiveOptions.length
        || Math.max(...objectiveOptions.map((option) => option.score)) !== marks) {
        return fail("Pilihan objektif mesti mempunyai sekurang-kurangnya dua label/ID unik, markah sah dan markah tertinggi sama dengan Markah.");
      }
    }

    const topicKey = topicText.toLowerCase();
    let topic = topics.find((item) => item.section_code === section.code && (item.id.toLowerCase() === topicKey || item.name.toLowerCase() === topicKey));
    if (!topic) {
      const prefix = `${slug(section.code) || "seksyen"}-`;
      topic = { id: `${prefix}${nextNumber(topics.map((item) => item.id), prefix)}`, section_code: section.code, name: topicText, max_marks: null, sort_order: topics.filter((item) => item.section_code === section.code).length + 1, isNew: true };
      topics.push(topic);
      newTopics.push(topic);
    }

    let subtopic = null;
    if (subtopicText) {
      subtopic = subtopics.find((item) => item.topic_id === topic.id && (item.id.toLowerCase() === subtopicText.toLowerCase() || item.name.toLowerCase() === subtopicText.toLowerCase()));
      if (!subtopic) {
        const prefix = `${topic.id}-subtopic-`;
        const contentOrder = Math.max(0,
          ...subtopics.filter((item) => item.topic_id === topic.id).map((item) => item.sort_order ?? 0),
          ...questions.filter((item) => item.topic_id === topic.id && !item.subtopic_id).map((item) => item.display_order ?? 0));
        subtopic = {
          id: `${prefix}${nextNumber(subtopics.map((item) => item.id), prefix)}`,
          topic_id: topic.id,
          name: subtopicText,
          sort_order: contentOrder + 1,
          isNew: true,
        };
        subtopics.push(subtopic);
        newSubtopics.push(subtopic);
      }
    }

    if (additionalTopicText && !subtopic) return fail("Additional Topic memerlukan Sub-topic.");
    let additionalTopic = null;
    if (additionalTopicText) {
      additionalTopic = additionalTopics.find((item) => item.subtopic_id === subtopic.id
        && (item.id.toLowerCase() === additionalTopicText.toLowerCase() || item.name.toLowerCase() === additionalTopicText.toLowerCase()));
      if (!additionalTopic) {
        const prefix = `${subtopic.id}-additional-`;
        const contentOrder = Math.max(0,
          ...additionalTopics.filter((item) => item.subtopic_id === subtopic.id).map((item) => item.sort_order ?? 0),
          ...questions.filter((item) => item.subtopic_id === subtopic.id && !item.additional_topic_id).map((item) => item.sort_order ?? 0));
        additionalTopic = {
          id: `${prefix}${nextNumber(additionalTopics.map((item) => item.id), prefix)}`,
          subtopic_id: subtopic.id,
          name: additionalTopicText,
          sort_order: contentOrder + 1,
          isNew: true,
        };
        additionalTopics.push(additionalTopic);
        newAdditionalTopics.push(additionalTopic);
      }
    }

    const duplicateKey = `${topic.id}\u0000${subtopic?.id ?? ""}\u0000${additionalTopic?.id ?? ""}\u0000${questionText.toLowerCase()}`;
    if (seen.has(duplicateKey)) return fail("soalan duplikat dalam fail yang sama.");
    seen.add(duplicateKey);

    const bucket = rowsByTopic.get(topic.id) ?? [];
    bucket.push(type === "subjective_single" || type === "quantitative" ? 0 : marks);
    rowsByTopic.set(topic.id, bucket);

    let question = questions.find((item) => item.section === section.code
      && item.topic_id === topic.id
      && (item.subtopic_id ?? null) === (subtopic?.id ?? null)
      && (item.additional_topic_id ?? null) === (additionalTopic?.id ?? null)
      && item.prompt.trim().toLowerCase() === questionText.toLowerCase());
    const isNew = !question;
    if (isNew) {
      const prefix = `${section.code}-Q`;
      const sectionQuestions = questions.filter((item) => item.section === section.code);
      question = {
        code: `${prefix}${nextNumber(questions.map((item) => item.code), prefix)}`,
        section: section.code, topic_id: topic.id, subtopic_id: subtopic?.id ?? null, additional_topic_id: additionalTopic?.id ?? null, topic_name: topic.name, prompt: questionText,
        question_type: type, max_score: type === "quantitative" ? 0 : marks > 0 ? marks : type === "subjective_single" ? 1 : 0,
        is_survey: type === "quantitative" || marks === 0 && type !== "subjective_single", is_locked: false,
        total_count: null, objective_options: objectiveOptions,
        scoring_parent_code: null, scoring_direction: null, percentage_thresholds: [],
        note_prompt: "", score_ranges: [], table_instruction: "", table_columns: ["Maklumat"],
        sort_order: sectionQuestions.reduce((highest, item) => Math.max(highest, item.sort_order ?? 0), 0) + 1,
        display_order: Math.max(0,
          ...questions.filter((item) => item.topic_id === topic.id && !item.subtopic_id).map((item) => item.display_order ?? 0),
          ...subtopics.filter((item) => item.topic_id === topic.id).map((item) => item.sort_order ?? 0)) + 1,
        active: true,
      };
      questions.push(question);
    } else {
      question = { ...question, subtopic_id: subtopic?.id ?? null, additional_topic_id: additionalTopic?.id ?? null, question_type: type, max_score: type === "quantitative" ? 0 : marks > 0 ? marks : type === "subjective_single" ? 1 : 0, is_survey: type === "quantitative" || marks === 0 && type !== "subjective_single", objective_options: type === "objective" ? objectiveOptions : [], active: true };
      questions[questions.findIndex((item) => item.code === question.code)] = question;
    }
    if (type === "quantitative") {
      question.total_count = null;
      question.note_prompt = "";
      question.scoring_parent_code = null;
      question.scoring_direction = null;
      question.percentage_thresholds = [];
    }
    else {
      question.total_count = null;
      question.scoring_parent_code = null;
      question.scoring_direction = null;
      question.percentage_thresholds = [];
    }
    if ((type === "qualitative_with_note" || type === "qualitative_note_only") && !question.note_prompt) question.note_prompt = "Nota tambahan";
    if (type === "qualitative_range" && !question.score_ranges?.length) {
      question.score_ranges = DEFAULT_SCORE_RANGES.map((range) => ({ ...range }));
    }
    questionRows.set(question.code, { ...question, isNew });
  });

  if (errors.length) return { errors };
  newTopics.forEach((topic) => {
    const marks = rowsByTopic.get(topic.id) ?? [];
    topic.max_marks = marks.length && marks.every((value) => value === 0) ? 0 : null;
  });
  const rows = [...questionRows.values()];
  return {
    errors,
    topicRows: newTopics.map((topic) => {
      const row = { ...topic };
      delete row.isNew;
      return { ...row, active: true };
    }),
    subtopicRows: newSubtopics.map((subtopic) => {
      const row = { ...subtopic };
      delete row.isNew;
      return { ...row, active: true };
    }),
    additionalTopicRows: newAdditionalTopics.map((additionalTopic) => {
      const row = { ...additionalTopic };
      delete row.isNew;
      return { ...row, active: true };
    }),
    questionRows: rows.map((item) => {
      const row = { ...item };
      delete row.isNew;
      return row;
    }),
    created: rows.filter((item) => item.isNew).length,
    updated: rows.filter((item) => !item.isNew).length,
  };
}

/** Maps stored data to export rows for one section. */
export function buildExportRows(section, topics, questions, subtopics = [], additionalTopics = []) {
  const byTopic = new Map(topics.map((item) => [item.id, item]));
  const sortedTopics = topics.slice().sort((first, second) => (first.sort_order ?? 0) - (second.sort_order ?? 0));
  const sectionQuestions = questions.filter((item) => item.section === section.code && byTopic.has(item.topic_id));
  const ordered = orderedTopicContent(
    sortedTopics,
    subtopics.map((item) => ({ ...item, topicId: item.topic_id, sortOrder: item.sort_order })),
    sectionQuestions.map((item) => ({
      ...item,
      topicId: item.topic_id,
      subtopicId: item.subtopic_id,
      additionalTopicId: item.additional_topic_id,
      sortOrder: item.sort_order,
      displayOrder: item.display_order,
    })),
    additionalTopics.map((item) => ({ ...item, subtopicId: item.subtopic_id, sortOrder: item.sort_order })),
  );
  const rows = ordered.flatMap((item) => item.kind === "question"
    ? [{ question: item.question, subtopic: null, additionalTopic: null }]
    : item.content.flatMap((content) => content.kind === "question"
      ? [{ question: content.question, subtopic: item.subtopic, additionalTopic: null }]
      : content.questions.map((question) => ({ question, subtopic: item.subtopic, additionalTopic: content.additionalTopic }))));
  return rows.map(({ question, subtopic, additionalTopic }) => ({
    section: section.name,
    topic: byTopic.get(question.topic_id).name,
    subtopic: subtopic?.name ?? "",
    additionalTopic: additionalTopic?.name ?? "",
    question: question.prompt,
    type: questionTypeToCsv(question.question_type),
    marks: question.is_survey || question.question_type === "subjective_single" || question.question_type === "quantitative" || (question.question_type !== "objective" && byTopic.get(question.topic_id).max_marks != null && Number(byTopic.get(question.topic_id).max_marks) === 0) ? 0 : Number(question.max_score),
    objectiveOptions: question.objective_options ?? [],
  }));
}
