const num = (value) => (Number.isFinite(Number(value)) ? Number(value) : 0);
const ratio = (part, whole) => (whole > 0 ? part / whole : 0);
const isScoredQuestion = (question) =>
  !question.isSurvey && question.type !== "subjective_single" && question.type !== "quantitative";

/**
 * Select the configured score range containing an answer.
 * Blank and non-numeric answers do not match a range.
 */
export function scoreRangeForValue(question, answer) {
  if (answer == null || (typeof answer === "string" && answer.trim() === "")) return undefined;
  const value = Number(answer);
  if (!Number.isFinite(value)) return undefined;
  return question.scoreRanges?.find((range) =>
    value >= range.min && (range.max == null || value <= range.max));
}

/** Find the configured objective option selected by its stable id. */
export function objectiveOptionForValue(question, answer) {
  return question.objectiveOptions?.find((option) => option.id === answer);
}

/**
 * Return a non-negative finite input maximum, or undefined when it is absent/invalid.
 * Undefined lets callers omit the HTML `max` attribute rather than emit NaN.
 */
export function numericInputMaximum(value) {
  if (value === undefined || value === null || value === "") return undefined;
  const maximum = typeof value === "number" ? value : Number(value);
  return Number.isFinite(maximum) && maximum >= 0 ? maximum : undefined;
}

/**
 * Validate objective options according to the question editor's persistence contract.
 */
export function isValidObjectiveOptions(options) {
  return Array.isArray(options)
    && options.length >= 2
    && options.every((option) => option && typeof option.id === "string" && option.id.trim()
      && typeof option.label === "string" && option.label.trim()
      && Number.isFinite(option.score) && option.score >= 0 && option.score <= 99999.99)
    && new Set(options.map((option) => option.id)).size === options.length
    && new Set(options.map((option) => option.label.trim().toLocaleLowerCase())).size === options.length
    && Math.max(...options.map((option) => option.score)) > 0;
}

/** Append the next ten-value band; an open-ended final range cannot be extended. */
export function appendQuestionScoreRange(ranges) {
  const lastMaximum = ranges.at(-1)?.max;
  if (lastMaximum == null) return ranges;
  const minimum = lastMaximum + 1;
  return [...ranges, { min: minimum, max: minimum + 9, score: 1, label: "Skala baharu" }];
}

/**
 * Topic score from its questions. `maxMarks` (stored on the Topic) falls back to the sum of question maximums.
 * @param {{ id: string, maxMarks?: number | null, questions?: any[] }} topic
 * @returns {{ id: string, earned: number, max: number, percent: number }}
 */
export function topicScore(topic, answers = {}, selfAnswers = {}) {
  const questions = topic?.questions ?? [];
  const questionMax = questions.reduce((sum, question) =>
    sum + (isScoredQuestion(question) ? num(question.max) : 0), 0);
  const hasScoredQuestions = questions.some(isScoredQuestion);
  const max = hasScoredQuestions && topic?.maxMarks != null ? Math.max(num(topic.maxMarks), 0) : questionMax;
  // Zero-mark topics are survey-only: they never contribute, whatever their questions carry.
  if (max === 0) return { id: topic?.id, earned: 0, max: 0, percent: 0 };
  const rawEarned = questions.reduce((sum, question) => sum + num(fieldQuestionScore(question, answers, selfAnswers)), 0);
  // Scale to the stored Topic marks when they differ from the question total.
  const earned = questionMax > 0 ? Math.min(rawEarned / questionMax * max, max) : 0;
  return { id: topic?.id, earned, max, percent: ratio(earned, max) * 100 };
}

/**
 * Section score derived entirely from its topics; empty sections return zeros.
 * @returns {{ earned: number, max: number, percent: number, topics: ReturnType<typeof topicScore>[] }}
 */
export function sectionScore(topics, answers = {}, selfAnswers = {}) {
  const scored = (topics ?? []).map((topic) => topicScore(topic, answers, selfAnswers));
  const earned = scored.reduce((sum, item) => sum + item.earned, 0);
  const max = scored.reduce((sum, item) => sum + item.max, 0);
  return { earned, max, percent: ratio(earned, max) * 100, topics: scored };
}

/**
 * Section weightage (% of overall) derived from Topic max marks; replaces hardcoded section weights.
 * @param {Record<string, any[]>} sections section code -> topics
 * @returns {Record<string, number>}
 */
export function sectionWeights(sections) {
  const maxes = Object.entries(sections ?? {}).map(([code, topics]) => [code, sectionScore(topics).max]);
  const total = maxes.reduce((sum, [, max]) => sum + max, 0);
  return Object.fromEntries(maxes.map(([code, max]) => [code, ratio(max, total) * 100]));
}

/**
 * Derive section percentages from editor-shaped topic/question records and round to cents.
 * Missing section arrays are treated as empty, and every requested section is retained.
 */
export function deriveSectionWeights(sectionCodes, topicsBySection, questionsBySection) {
  const tree = Object.fromEntries(sectionCodes.map((code) => [
    code,
    (topicsBySection[code] ?? []).map((topic) => ({
      id: topic.id,
      maxMarks: topic.maxMarks,
      questions: (questionsBySection[code] ?? []).filter((question) => question.topicId === topic.id),
    })),
  ]));
  const raw = sectionWeights(tree);
  return Object.fromEntries(sectionCodes.map((code) => [
    code,
    Math.round((raw[code] ?? 0) * 100) / 100,
  ]));
}

/**
 * Overall percent: each section's percent weighted by its derived weightage.
 * @param {Record<string, any[]>} sections
 */
export function overallScore(sections, answers = {}, selfAnswers = {}) {
  const weights = sectionWeights(sections);
  return Object.entries(sections ?? {}).reduce(
    (sum, [code, topics]) => sum + sectionScore(topics, answers, selfAnswers).percent * weights[code] / 100, 0);
}

/**
 * Scores a chained question using its percentage of the configured parent value.
 *
 * `percentageThresholds` entries use inclusive `min`/`max` percentage bounds and
 * a `score` from 0 to 100 representing the percentage of `question.max` awarded.
 * Without thresholds, scoring is proportional to the directional percentage.
 *
 * @param {{ id: string, max: number, parentQuestionId?: string, scoringParentCode?: string, direction?: "higher-is-better" | "lower-is-better", scoringDirection?: "higher-is-better" | "lower-is-better", percentageThresholds?: { min?: number, max?: number | null, score: number }[] }} question
 * @param {unknown} currentValue
 * @param {Record<string, unknown>} allValues
 * @returns {number}
 */
export function calculateScore(question, currentValue, allValues = {}) {
  const direction = question.direction ?? question.scoringDirection;
  const parentQuestionId = question.parentQuestionId ?? question.scoringParentCode;
  if (direction !== "higher-is-better" && direction !== "lower-is-better") {
    throw new TypeError(`Unsupported scoring direction for question ${question.id}.`);
  }

  const parseValue = (value) => {
    if (value == null || (typeof value === "string" && value.trim() === "")) return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  };
  const numerator = parseValue(currentValue);
  const denominator = parseValue(allValues?.[parentQuestionId]);
  const max = num(question.max);
  if (numerator == null || numerator < 0 || denominator == null || denominator <= 0 || max <= 0) return 0;

  const percentage = numerator / denominator * 100;
  if (!Number.isFinite(percentage)) return 0;
  if (Array.isArray(question.percentageThresholds) && question.percentageThresholds.length > 0) {
    const threshold = question.percentageThresholds.find((item) =>
      percentage >= (item.min ?? 0) && (item.max == null || percentage <= item.max));
    if (!threshold || !Number.isFinite(Number(threshold.score))) return 0;
    return Math.min(Math.max(Number(threshold.score), 0), 100) / 100 * max;
  }

  const directionalPercentage = direction === "higher-is-better"
    ? percentage
    : 100 - percentage;
  return Math.min(Math.max(directionalPercentage, 0), 100) / 100 * max;
}

/**
 * @param {{ id: string, type: "qualitative" | "qualitative_no_grade" | "qualitative_with_note" | "qualitative_note_only" | "qualitative_range" | "objective" | "dynamic_table" | "quantitative" | "subjective" | "subjective_single", max: number, total?: number, parentQuestionId?: string, scoringParentCode?: string, direction?: "higher-is-better" | "lower-is-better", scoringDirection?: "higher-is-better" | "lower-is-better", percentageThresholds?: { min?: number, max?: number | null, score: number }[], scoreRanges?: { min: number, max: number | null, score: number, label: string }[], objectiveOptions?: { id: string, label: string, score: number }[] }} question
 * @param {Record<string, string>} answers
 * @param {Record<string, string>} selfAnswers
 */
export function fieldQuestionScore(question, answers, selfAnswers) {
  if (!question || typeof question !== "object" || !question.id || !answers || typeof answers !== "object") return 0;
  const response = answers[question.id];
  if (question.type === "quantitative" || question.isSurvey || question.type === "subjective_single") return 0;
  if (question.parentQuestionId || question.scoringParentCode) {
    return calculateScore(question, response, { ...(selfAnswers ?? {}), ...answers });
  }

  const isManualScore = (value) => {
    if (typeof value === "string" && value.trim().startsWith("{")) return 0;
    if (value == null || value === "") return 0;
    const score = Number(value);
    const maximum = num(question.max);
    return Number.isFinite(score) ? Math.min(Math.max(score, 0), Math.max(maximum, 0)) : 0;
  };
  const scoreQualitative = () => {
    if (answers[`${question.id}-yn`] !== "Ya") return 0;
    const grade = Number(response ?? 0);
    return Number.isFinite(grade)
      ? Math.min(Math.max(grade, 0), 5) / 5 * Math.max(num(question.max), 0)
      : 0;
  };
  const scoreByType = {
    objective: () => {
      if (!Array.isArray(question.objectiveOptions)) return 0;
      const score = question.objectiveOptions.find((option) => option?.id === response)?.score;
      return Number.isFinite(score) && score >= 0 ? score : 0;
    },
    subjective: () => isManualScore(response),
    dynamic_table: () => isManualScore(response),
    qualitative_range: () => {
      if (answers[`${question.id}-yn`] !== "Ya" || response == null || response === "") return 0;
      const value = Number(response);
      if (!Number.isFinite(value) || !Array.isArray(question.scoreRanges)) return 0;
      const range = question.scoreRanges.find((item) => item
        && value >= item.min && (item.max == null || value <= item.max));
      return range ? Math.min(Math.max(num(range.score), 0), 5) / 5 * Math.max(num(question.max), 0) : 0;
    },
    qualitative_no_grade: () => answers[`${question.id}-yn`] === "Ya" ? Math.max(num(question.max), 0) : 0,
    qualitative_note_only: () => answers[`${question.id}-yn`] === "Ya" ? Math.max(num(question.max), 0) : 0,
    qualitative: scoreQualitative,
    qualitative_with_note: scoreQualitative,
  };
  const strategy = Object.prototype.hasOwnProperty.call(scoreByType, question.type)
    ? scoreByType[question.type]
    : undefined;
  return strategy?.() ?? 0;
}