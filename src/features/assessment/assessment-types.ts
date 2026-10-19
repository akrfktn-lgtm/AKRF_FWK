export type Section = string;

export type QuestionType =
  | "qualitative"
  | "qualitative_no_grade"
  | "qualitative_with_note"
  | "qualitative_note_only"
  | "qualitative_range"
  | "objective"
  | "dynamic_table"
  | "quantitative"
  | "subjective"
  | "subjective_single"
  | "auto_calculated_financial";

export type QuestionScoreRange = { min: number; max: number | null; score: number; label: string };
export type PercentageThreshold = { min: number; max: number | null; score: number };
export type ObjectiveOption = { id: string; label: string; score: number };

export type Question = {
  id: string;
  text: string;
  type: QuestionType;
  max: number;
  isSurvey?: boolean;
  isLocked?: boolean;
  topicId: string;
  subtopicId: string | null;
  additionalTopicId?: string | null;
  sortOrder: number;
  displayOrder: number;
  total?: number;
  notePrompt?: string;
  scoreRanges?: QuestionScoreRange[];
  objectiveOptions?: ObjectiveOption[];
  tableInstruction?: string;
  tableColumns?: string[];
  tableRows?: number;
  scoringParentCode?: string;
  scoringDirection?: "higher-is-better" | "lower-is-better";
  percentageThresholds?: PercentageThreshold[];
};

export type Topic = { id: string; name: string; maxMarks?: number | null; blockBased: boolean };
export type Subtopic = { id: string; topicId: string; name: string; sortOrder: number };
export type AdditionalTopic = { id: string; subtopicId: string; name: string; sortOrder: number };
export type DynamicTableAnswer = { columns: string[]; rows: string[][] };
