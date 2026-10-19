"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import type { User } from "@supabase/supabase-js";
import Image from "next/image";
import {
  Activity, ArrowRight, ArrowUpRight, Bell, Blocks, BookOpenCheck, Building2, CalendarDays,
  Check, CheckCircle2, ChevronDown, ChevronRight, CircleHelp, ClipboardCheck, Clock3,
  Droplets, FileText, Filter, Heart, Home, Landmark, LayoutDashboard, Leaf, LoaderCircle, LogOut, MapPin, Menu,
  Plus, Printer, Save, Search, Settings, Shield, ShieldCheck, Sprout, Star, Sun, Trash2, TreePine, Trophy, Users, Wrench, X,
} from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../../components/ui/tabs";
import { QuestionConfigManager } from "../../admin/components/question-config-manager";
import { RoleManagement } from "../../admin/components/role-management";
import { PrintQuestions } from "../../reports/components/print-questions";
import { JurorAssignmentManager } from "../../juror/components/juror-assignment-manager";
import { SectionWeightageOverview } from "./section-weightage-overview";
import { ObjectiveOptionsEditor } from "./scoring-configuration-fields";
import { QuestionFieldDispatcher } from "./question-field-dispatcher";
import { normalizeProfileRole, supabase, type ProfileRole } from "../../../lib/supabase";
import { canAssessPhaseOne, canAssessPhaseTwo, canManageSystem, canReopenSubmissions, canUnlockQuestions } from "../../../lib/permissions";
import { isPhaseComplete, isSubmissionLocked } from "../../../lib/assessment-workflow.mjs";
import { orderedTopicContent } from "../../../lib/assessment-structure.mjs";
import { appendQuestionScoreRange, deriveSectionWeights, objectiveOptionForValue, scoreRangeForValue } from "../../../lib/scoring.mjs";
import { validateQuestionConfiguration } from "../question-configuration-validation.mjs";
import { evaluateFinancialQuestion } from "../../../lib/financial.mjs";
import type { FinancialItem, FinancialThreshold } from "./financial-question-field";
import { FinancialConfigManager, FinancialItemsEditor } from "../../admin/components/financial-config-manager";
import { loadAssessmentWorkspace, loadFinancialSettings } from "../services/workspace-queries";
import { juryAnswerLabel, parseDynamicTableAnswer, selfAnswerLabel } from "../assessment-answer-format";
import type { AdditionalTopic, ObjectiveOption, Question, QuestionScoreRange, Section, Subtopic, Topic } from "../assessment-types";

type Screen = "dashboard" | "assessment" | "ranking" | "reports" | "settings" | "print-questions";
type Phase = 1 | 2;
type Role = ProfileRole;
type RecordRow = {
  id: string;
  ranch: string;
  block: string;
  recorderName?: string;
  phase1: boolean;
  phase2: boolean;
  sections: Record<Section, number>;
  selfSectionScores?: Record<Section, number>;
  phaseScores?: Partial<Record<Phase, number>>;
  selfSections?: Section[];
  selfTopics?: Partial<Record<Section, string[]>>;
  selfAnswers?: Partial<Record<Section, Record<string, string>>>;
  juryScores?: Partial<Record<Section, [number | null, number | null]>>;
  juryTopics?: Partial<Record<Section, string[][]>>;
  juryAnswers?: Partial<Record<Section, Array<Record<string, string> | null>>>;
  updated: string;
};
const DEFAULT_MEDIA_SOCIAL_SCORE_RANGES: QuestionScoreRange[] = [
  { min: 100, max: 500, score: 1, label: "Sangat lemah" },
  { min: 501, max: 1000, score: 2, label: "Lemah" },
  { min: 1001, max: 2000, score: 3, label: "Sederhana" },
  { min: 2001, max: 9999, score: 4, label: "Baik" },
  { min: 10000, max: null, score: 5, label: "Cemerlang" },
];
type SectionCatalogItem = { code: Section; name: string; weight: number; sort_order: number; guidance_note: string; icon_code: string };
function usesNoteField(type: Question["type"]) {
  return type === "qualitative_with_note" || type === "qualitative_note_only";
}
type OrderedSubtopicContent = { kind: "question"; question: Question } | { kind: "additionalTopic"; questions: Question[] };
type RanchRanking = {
  ranch: string;
  blocks: RecordRow[];
  sections: Record<Section, number>;
  totalScore: number;
  phase2Blocks: number;
  provisional: boolean;
  rank: number;
  blockCount: number;
};
type RanchPhaseScore = {
  phase: 0 | Phase;
  ranch_name: string;
  block_count: number;
  ladang_score: number;
  kampung_score: number;
  masjid_score: number;
  keceriaan_score: number;
  overall_score: number;
  section_scores?: Record<Section, number>;
  phase2_block_count: number;
  ranking_position: number;
};
type PhaseBlockScore = {
  phase: Phase;
  ranch_name: string;
  block_number: string;
  section_code: Section;
  section_score: number | null;
  jury_1_score: number | null;
  jury_2_score: number | null;
};
type PhaseBlockTotal = {
  phase: Phase;
  ranch_name: string;
  block_number: string;
  overall_score: number;
};
type RegionalScore = { phase: 0 | Phase; average_score: number | null; block_count: number };
type QuestionScoreDetail = { phase: Phase; ranch_name: string; block_number: string; question_code: string; assessor_slot: number; score_percent: number | null };

const DEFAULT_SECTIONS: Section[] = ["Ladang", "Kampung", "Masjid", "Keceriaan"];
const SECTION_ICONS: Record<string, typeof Activity> = { Ladang: Sprout, Kampung: Home, Masjid: Landmark, Keceriaan: Activity };
const SECTION_ICON_OPTIONS: { code: string; label: string; icon: typeof Activity }[] = [
  { code: "activity", label: "Aktiviti", icon: Activity },
  { code: "sprout", label: "Tumbuhan", icon: Sprout },
  { code: "tree", label: "Pokok", icon: TreePine },
  { code: "leaf", label: "Daun", icon: Leaf },
  { code: "home", label: "Rumah", icon: Home },
  { code: "building", label: "Bangunan", icon: Building2 },
  { code: "landmark", label: "Mercu tanda", icon: Landmark },
  { code: "users", label: "Komuniti", icon: Users },
  { code: "droplets", label: "Air", icon: Droplets },
  { code: "sun", label: "Matahari", icon: Sun },
  { code: "heart", label: "Kesihatan", icon: Heart },
  { code: "shield", label: "Keselamatan", icon: Shield },
  { code: "star", label: "Keceriaan", icon: Star },
  { code: "wrench", label: "Penyelenggaraan", icon: Wrench },
];
function getSectionIcon(code: string, iconCode?: string) {
  return SECTION_ICON_OPTIONS.find((option) => option.code === iconCode)?.icon ?? SECTION_ICONS[code] ?? Activity;
}
const DEFAULT_TOPICS: Record<string, Topic[]> = Object.fromEntries(Object.entries({
  Ladang: [{ id: "ladang-1", name: "Pengurusan tanaman" }, { id: "ladang-2", name: "Infrastruktur ladang" }, { id: "ladang-3", name: "Produktiviti" }, { id: "ladang-4", name: "Keselamatan" }],
  Kampung: [{ id: "kampung-1", name: "Kebersihan persekitaran" }, { id: "kampung-2", name: "Kemudahan awam" }, { id: "kampung-3", name: "Saliran" }, { id: "kampung-4", name: "Komuniti" }],
  Masjid: [{ id: "masjid-1", name: "Kebersihan masjid" }, { id: "masjid-2", name: "Pengimarahan" }, { id: "masjid-3", name: "Kehadiran jemaah" }, { id: "masjid-4", name: "Pengurusan masjid" }],
  Keceriaan: [{ id: "keceriaan-1", name: "Identiti rancangan" }, { id: "keceriaan-2", name: "Landskap" }, { id: "keceriaan-3", name: "Pencahayaan" }, { id: "keceriaan-4", name: "Penyelenggaraan" }],
}).map(([code, items]) => [code, items.map((item) => ({
  ...item,
  maxMarks: 0,
  blockBased: code !== "Masjid" && code !== "Keceriaan",
}))]));
const DEFAULT_QUESTIONS: Record<string, Question[]> = {
  Ladang: [
    { id: "L1", text: "Kawasan tanaman diurus dengan kemas dan bebas daripada rumpai berlebihan", type: "qualitative", max: 10, topicId: "ladang-1", subtopicId: null, sortOrder: 1, displayOrder: 1 },
    { id: "L2", text: "Jalan ladang berada dalam keadaan baik dan selamat dilalui", type: "qualitative", max: 10, topicId: "ladang-2", subtopicId: null, sortOrder: 2, displayOrder: 1 },
    { id: "L3", text: "Pokok sawit yang telah matang", type: "quantitative", max: 15, topicId: "ladang-3", subtopicId: null, sortOrder: 3, displayOrder: 1, total: 100 },
  ],
  Kampung: [
    { id: "K1", text: "Persekitaran rumah dan halaman penduduk bersih serta terurus", type: "qualitative", max: 10, topicId: "kampung-1", subtopicId: null, sortOrder: 1, displayOrder: 1 },
    { id: "K2", text: "Kemudahan awam diselenggara dan boleh digunakan", type: "qualitative", max: 10, topicId: "kampung-2", subtopicId: null, sortOrder: 2, displayOrder: 1 },
    { id: "K3", text: "Rumah dengan sistem saliran yang berfungsi", type: "quantitative", max: 15, topicId: "kampung-3", subtopicId: null, sortOrder: 3, displayOrder: 1, total: 50 },
  ],
  Masjid: [
    { id: "M1", text: "Ruang solat, tempat wuduk dan tandas berada dalam keadaan bersih", type: "qualitative", max: 15, topicId: "masjid-1", subtopicId: null, sortOrder: 1, displayOrder: 1 },
    { id: "M2", text: "Program pengimarahan masjid dilaksanakan secara berkala", type: "qualitative", max: 10, topicId: "masjid-2", subtopicId: null, sortOrder: 2, displayOrder: 1 },
    { id: "M3", text: "Jemaah yang hadir untuk solat Subuh pada hari penilaian", type: "quantitative", max: 10, topicId: "masjid-3", subtopicId: null, sortOrder: 3, displayOrder: 1, total: 100 },
  ],
  Keceriaan: [
    { id: "C1", text: "Pintu masuk rancangan mempunyai identiti dan landskap yang menarik", type: "qualitative", max: 15, topicId: "keceriaan-1", subtopicId: null, sortOrder: 1, displayOrder: 1 },
    { id: "C2", text: "Laluan utama dihiasi dengan tanaman yang diselenggara", type: "qualitative", max: 10, topicId: "keceriaan-2", subtopicId: null, sortOrder: 2, displayOrder: 1 },
    { id: "C3", text: "Lampu jalan yang berfungsi di kawasan kampung", type: "quantitative", max: 10, topicId: "keceriaan-3", subtopicId: null, sortOrder: 3, displayOrder: 1, total: 50 },
  ],
};
const DEFAULT_WEIGHTS: Record<string, number> = { Ladang: 30, Kampung: 30, Masjid: 20, Keceriaan: 20 };
function cloneQuestions(source: Record<Section, Question[]>): Record<Section, Question[]> {
  return Object.fromEntries(Object.keys(source).map((section) => [section, source[section].map((question) => ({ ...question }))])) as Record<Section, Question[]>;
}

function cloneTopics(source: Record<Section, Topic[]>): Record<Section, Topic[]> {
  return Object.fromEntries(Object.keys(source).map((section) => [section, source[section].map((topic) => ({ ...topic }))])) as Record<Section, Topic[]>;
}

function cloneSubtopics(source: Record<Section, Subtopic[]>): Record<Section, Subtopic[]> {
  return Object.fromEntries(Object.keys(source).map((section) => [section, source[section].map((subtopic) => ({ ...subtopic }))])) as Record<Section, Subtopic[]>;
}

function cloneAdditionalTopics(source: Record<Section, AdditionalTopic[]>): Record<Section, AdditionalTopic[]> {
  return Object.fromEntries(Object.keys(source).map((section) => [section, source[section].map((additionalTopic) => ({ ...additionalTopic }))])) as Record<Section, AdditionalTopic[]>;
}

function groupQuestionsByTopic(questions: Question[], topics: Topic[], subtopics: Subtopic[] = [], additionalTopics: AdditionalTopic[] = []) {
  return orderedTopicContent(topics, subtopics, questions, additionalTopics).flatMap((item) => item.kind === "question"
    ? [item.question]
    : item.content.flatMap((content: OrderedSubtopicContent) => content.kind === "question" ? [content.question] : content.questions));
}

function formatPercent(value: number | null | undefined) {
  if (value == null || !Number.isFinite(Number(value))) return "—";
  return `${new Intl.NumberFormat("ms-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(value))}%`;
}

function ranchRankingsFromSql(scoreRows: RanchPhaseScore[], rows: RecordRow[], phase: 0 | Phase): RanchRanking[] {
  return scoreRows.filter((score) => score.phase === phase).map((score) => {
    const blocks = rows.filter((row) => row.ranch === score.ranch_name
      && (phase === 0 ? row.phaseScores?.[1] != null : row.phaseScores?.[phase] != null))
      .map((row) => phase === 1 || (phase === 0 && row.phaseScores?.[2] == null)
        ? { ...row, sections: row.selfSectionScores ?? row.sections }
        : row);
    const phase2Blocks = Number(score.phase2_block_count);
    return {
      ranch: score.ranch_name,
      blocks,
      sections: score.section_scores ?? {
        Ladang: Number(score.ladang_score), Kampung: Number(score.kampung_score),
        Masjid: Number(score.masjid_score), Keceriaan: Number(score.keceriaan_score),
      },
      totalScore: Number(score.overall_score),
      phase2Blocks,
      provisional: phase !== 2 && phase2Blocks < Number(score.block_count),
      rank: Number(score.ranking_position),
      blockCount: Number(score.block_count),
    };
  }).sort((first, second) => first.rank - second.rank);
}

function makeRowId(ranch: string, block: string) {
  return `${ranch.toLowerCase().replaceAll(" ", "-")}-${block.toLowerCase()}`;
}

const getGreeting = () => {
  const hour = new Date().getHours();

  if (hour >= 5 && hour < 12) {
    return "Selamat Pagi";
  } else if (hour >= 12 && hour < 15) {
    return "Selamat Tengah Hari";
  } else if (hour >= 15 && hour < 19) {
    return "Selamat Petang";
  } else {
    return "Selamat Malam";
  }
};

type StoredAnswer = {
  user_id: string;
  question_code: string;
  ranch_name: string;
  block_number: string;
  phase: Phase;
  assessor_slot: number;
  recorder_name: string;
  response: Record<string, string>;
  submitted_at: string;
};
type AssessmentSubmission = {
  id: string;
  user_id: string;
  ranch_name: string;
  block_number: string;
  phase: Phase;
  assessor_slot: number;
  topic_id: string;
  status: "submitted" | "reopened";
  revision: number;
  configuration_version: number;
};
type JurorAssignment = { user_id: string; topic_id: string; assessor_slot: number };
type JurorAccount = { id: string; full_name: string };
type SubmissionEvent = { id: string; submission_id: string; actor_id: string; event_type: "submitted" | "reopened"; reason: string; snapshot: Record<string, unknown>; created_at: string };

function recordsFromStoredAnswers(storedAnswers: StoredAnswer[], questionConfig: Record<Section, Question[]>): RecordRow[] {
  const questionById = new Map(Object.values(questionConfig).flat().map((question) => [question.id, question]));
  const records = new Map<string, RecordRow>();
  for (const saved of storedAnswers) {
    const question = questionById.get(saved.question_code);
    if (!question) continue;
    const section = Object.keys(questionConfig).find((item) => questionConfig[item].some((entry) => entry.id === question.id));
    if (!section) continue;
    const id = makeRowId(saved.ranch_name, saved.block_number);
    const row: RecordRow = records.get(id) ?? {
      id,
      ranch: saved.ranch_name,
      block: saved.block_number,
      phase1: false,
      phase2: false,
      sections: Object.fromEntries(Object.keys(questionConfig).map((item) => [item, 0])),
      selfAnswers: {},
      selfTopics: {},
      juryAnswers: {},
      juryTopics: {},
      juryScores: {},
      recorderName: "",
      updated: "Baru sahaja",
    };
    if (saved.phase === 1) {
      row.recorderName = saved.recorder_name;
      row.phase1 = true;
      row.selfAnswers = {
        ...row.selfAnswers,
        [section]: {
          ...row.selfAnswers?.[section],
          ...saved.response,
        },
      };
    } else {
      const slotIndex = saved.assessor_slot - 1;
      const slots = row.juryAnswers?.[section] ?? [];
      slots[slotIndex] = { ...slots[slotIndex], ...saved.response };
      row.juryAnswers = { ...row.juryAnswers, [section]: slots };
      const completed = row.juryTopics?.[section] ?? [];
      completed[slotIndex] ??= [];
      if (!completed[slotIndex].includes(question.topicId)) completed[slotIndex].push(question.topicId);
      row.juryTopics = { ...row.juryTopics, [section]: completed };
    }
    if (saved.phase === 1) {
      const completed = row.selfTopics?.[section] ?? [];
      if (!completed.includes(question.topicId)) completed.push(question.topicId);
      row.selfTopics = { ...row.selfTopics, [section]: completed };
    }
    records.set(id, row);
  }

  return [...records.values()];
}

export function AssessmentWorkspace({ user }: { user: User }) {
  const [sectionCatalog, setSectionCatalog] = useState<SectionCatalogItem[]>(DEFAULT_SECTIONS.map((code, index) => ({ code, name: code, weight: DEFAULT_WEIGHTS[code], sort_order: index + 1, guidance_note: "", icon_code: "" })));
  const SECTIONS = sectionCatalog.map((item) => item.code);
  const sectionNames = Object.fromEntries(sectionCatalog.map((item) => [item.code, item.name])) as Record<Section, string>;
  const [selectedSection, setSection] = useState<Section>("Ladang");
  const section = SECTIONS.includes(selectedSection) ? selectedSection : SECTIONS[0] ?? selectedSection;
  const isMosqueSection = section.trim().toLocaleLowerCase() === "masjid"
    || sectionNames[section]?.trim().toLocaleLowerCase() === "masjid";
  const [requestedScreen, setScreen] = useState<Screen>("dashboard");
  const [phase, setPhase] = useState<Phase>(1);
  const [role, setRole] = useState<Role>("rancangan");
  const screen: Screen = role === "rancangan" && requestedScreen !== "print-questions" ? "assessment" : requestedScreen;
  const [profileName, setProfileName] = useState(user.email ?? "User");
  const [greeting, setGreeting] = useState("");
  const [ranch, setRanch] = useState("");
  const [reportPhase, setReportPhase] = useState<Phase>(1);
  const [rankingPhase, setRankingPhase] = useState<Phase>(1);
  const [reportRanch, setReportRanch] = useState("");
  const [excelRanch, setExcelRanch] = useState("");
  const [isExportingExcel, setIsExportingExcel] = useState(false);
  const [block, setBlock] = useState("01");
  const [selectedTopicId, setSelectedTopicId] = useState(DEFAULT_TOPICS.Ladang[0].id);
  const [activeJuror, setActiveJuror] = useState(1);
  const [rows, setRows] = useState<RecordRow[]>([]);
  const [ranchPhaseScores, setRanchPhaseScores] = useState<RanchPhaseScore[]>([]);
  const [regionalScores, setRegionalScores] = useState<RegionalScore[]>([]);
  const [questionScoreDetails, setQuestionScoreDetails] = useState<QuestionScoreDetail[]>([]);
  const [submissions, setSubmissions] = useState<AssessmentSubmission[]>([]);
  const [jurorAssignments, setJurorAssignments] = useState<JurorAssignment[]>([]);
  const [jurors, setJurors] = useState<JurorAccount[]>([]);
  const [isSavingJurorAssignments, setIsSavingJurorAssignments] = useState(false);
  const [submissionEvents, setSubmissionEvents] = useState<SubmissionEvent[]>([]);
  const [reopenReason, setReopenReason] = useState("");
  const [isSubmittingAssessment, setIsSubmittingAssessment] = useState(false);
  const [isReopeningSubmission, setIsReopeningSubmission] = useState(false);
  const [workspaceRefreshKey, setWorkspaceRefreshKey] = useState(0);
  const [ranches, setRanches] = useState<{ name: string; manager: string; mosqueName: string }[]>([]);
  const [weights, setWeights] = useState<Record<Section, number>>(DEFAULT_WEIGHTS);
  const [sectionGuidanceDraft, setSectionGuidanceDraft] = useState<Record<Section, string>>({ Ladang: "", Kampung: "", Masjid: "", Keceriaan: "" });
  const [topicConfig, setTopicConfig] = useState<Record<Section, Topic[]>>(() => cloneTopics(DEFAULT_TOPICS));
  const [topicDraft, setTopicDraft] = useState<Record<Section, Topic[]>>(() => cloneTopics(DEFAULT_TOPICS));
  const [subtopicConfig, setSubtopicConfig] = useState<Record<Section, Subtopic[]>>(() => Object.fromEntries(DEFAULT_SECTIONS.map((item) => [item, []])));
  const [subtopicDraft, setSubtopicDraft] = useState<Record<Section, Subtopic[]>>(() => Object.fromEntries(DEFAULT_SECTIONS.map((item) => [item, []])));
  const [additionalTopicConfig, setAdditionalTopicConfig] = useState<Record<Section, AdditionalTopic[]>>(() => Object.fromEntries(DEFAULT_SECTIONS.map((item) => [item, []])));
  const [additionalTopicDraft, setAdditionalTopicDraft] = useState<Record<Section, AdditionalTopic[]>>(() => Object.fromEntries(DEFAULT_SECTIONS.map((item) => [item, []])));
  const [questionConfig, setQuestionConfig] = useState<Record<Section, Question[]>>(DEFAULT_QUESTIONS);
  const [questionDraft, setQuestionDraft] = useState<Record<Section, Question[]>>(() => cloneQuestions(DEFAULT_QUESTIONS));
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const [configurationVersion, setConfigurationVersion] = useState(0);
  const [isDeletingAllSections, setIsDeletingAllSections] = useState(false);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState("");
  const [query, setQuery] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [financialItems, setFinancialItems] = useState<FinancialItem[]>([]);
  const [financialThresholds, setFinancialThresholds] = useState<FinancialThreshold[]>([]);

  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;
    void loadFinancialSettings(supabase).then(([itemResult, thresholdResult]) => {
      if (cancelled) return;
      if (itemResult.error || thresholdResult.error) {
        setNotice(`Could not load financial settings: ${(itemResult.error ?? thresholdResult.error)!.message}`);
        return;
      }
      setFinancialItems(itemResult.data.map((item) => ({ id: item.id, questionCode: item.question_code, label: item.label, kind: item.kind as FinancialItem["kind"] })));
      setFinancialThresholds(thresholdResult.data.map((band) => ({ id: band.id, min: Number(band.min_percent), max: band.max_percent == null ? null : Number(band.max_percent), score: Number(band.score) })));
    });
    return () => { cancelled = true; };
  }, [user, workspaceRefreshKey]);
  useEffect(() => {
    const updateGreeting = () => setGreeting(getGreeting());
    updateGreeting();
    const timer = window.setInterval(updateGreeting, 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;
    async function loadWorkspace() {
      const [profileResult, ranchResult, sectionResult, topicResult, subtopicResult, additionalTopicResult, questionResult, answerResult, submissionResult, assignmentResult, scoreResult, phaseBlockScoreResult, ranchScoreResult, blockTotalResult, regionalScoreResult, questionScoreResult, auditResult, jurorResult, configurationVersionBefore, configurationVersionAfter] = await loadAssessmentWorkspace(supabase!, user.id);
      if (cancelled) return;
      if (configurationVersionBefore.error || configurationVersionAfter.error
        || configurationVersionBefore.data !== configurationVersionAfter.data) {
        setConfigurationVersion(0);
        setNotice(configurationVersionBefore.error?.message ?? configurationVersionAfter.error?.message
          ?? "Konfigurasi berubah semasa dimuatkan. Muat semula sebelum menyimpan perubahan.");
      } else {
        setConfigurationVersion(Number(configurationVersionAfter.data));
      }
      if (profileResult.data) {
        setProfileName(profileResult.data.full_name || user.email || "User");
        const normalizedRole = normalizeProfileRole(profileResult.data.role);
        if (normalizedRole) setRole(normalizedRole);
      }
      if (jurorResult.error) {
        if (normalizeProfileRole(profileResult.data?.role) === "developer") setNotice(`Could not load juror accounts: ${jurorResult.error.message}`);
      } else {
        setJurors(jurorResult.data as JurorAccount[]);
      }
      if (sectionResult.error) {
        setNotice(`Could not load section settings: ${sectionResult.error.message}`);
      }
      const loadedSectionRows: SectionCatalogItem[] = sectionResult.data?.map((item) => ({ code: item.code, name: item.name, weight: Number(item.weight), sort_order: item.sort_order, guidance_note: item.guidance_note ?? "", icon_code: item.icon_code ?? "" })) ?? [];
      const loadedSections = loadedSectionRows.map((item) => item.code);
      setSection((current) => loadedSections.includes(current) ? current : loadedSections[0] ?? "");
      setSectionCatalog(loadedSectionRows);
      const loadedWeights = Object.fromEntries(loadedSectionRows.map((item) => [item.code, item.weight])) as Record<Section, number>;
      setWeights(loadedWeights);
      setSectionGuidanceDraft(Object.fromEntries(loadedSectionRows.map((item) => [item.code, item.guidance_note])) as Record<Section, string>);
      const loadedTopics = Object.fromEntries(loadedSections.map((item) => [item, [] as Topic[]])) as Record<Section, Topic[]>;
      if (topicResult.error) {
        setNotice(`Could not load topics: ${topicResult.error.message}. Jalankan supabase/app-schema.sql untuk mengaktifkan tetapan blok pada Topik.`);
      } else {
        topicResult.data.forEach((item) => {
          if (loadedSections.includes(item.section_code)) {
            loadedTopics[item.section_code].push({ id: item.id, name: item.name, maxMarks: item.max_marks == null ? 0 : Number(item.max_marks), blockBased: item.block_based });
          }
        });
      }
      loadedSections.forEach((item) => {
        if (!loadedTopics[item].length) loadedTopics[item] = (DEFAULT_TOPICS[item] ?? []).map((topic) => ({ ...topic }));
      });
      setTopicConfig(loadedTopics);
      setTopicDraft(cloneTopics(loadedTopics));
      const topicSection = new Map(Object.entries(loadedTopics).flatMap(([sectionCode, items]) => items.map((topic) => [topic.id, sectionCode] as const)));
      const loadedSubtopics = Object.fromEntries(loadedSections.map((item) => [item, [] as Subtopic[]])) as Record<Section, Subtopic[]>;
      if (subtopicResult.error) {
        setNotice(`Could not load subtopics: ${subtopicResult.error.message}`);
      } else {
        subtopicResult.data.forEach((item) => {
          const sectionCode = topicSection.get(item.topic_id);
          if (sectionCode) loadedSubtopics[sectionCode].push({ id: item.id, topicId: item.topic_id, name: item.name, sortOrder: item.sort_order });
        });
      }
      setSubtopicConfig(loadedSubtopics);
      setSubtopicDraft(cloneSubtopics(loadedSubtopics));
      const subtopicSection = new Map(Object.entries(loadedSubtopics).flatMap(([sectionCode, items]) => items.map((subtopic) => [subtopic.id, sectionCode] as const)));
      const loadedAdditionalTopics = Object.fromEntries(loadedSections.map((item) => [item, [] as AdditionalTopic[]])) as Record<Section, AdditionalTopic[]>;
      if (additionalTopicResult.error) {
        setNotice(`Could not load additional topics: ${additionalTopicResult.error.message}`);
      } else {
        additionalTopicResult.data.forEach((item) => {
          const sectionCode = subtopicSection.get(item.subtopic_id);
          if (sectionCode) loadedAdditionalTopics[sectionCode].push({ id: item.id, subtopicId: item.subtopic_id, name: item.name, sortOrder: item.sort_order });
        });
      }
      setAdditionalTopicConfig(loadedAdditionalTopics);
      setAdditionalTopicDraft(cloneAdditionalTopics(loadedAdditionalTopics));
      if (ranchResult.error) {
        setNotice(`Could not load ranches: ${ranchResult.error.message}`);
      } else {
        const loadedRanches = ranchResult.data.map((item) => ({
          name: item.name,
          manager: item.manager_name,
          mosqueName: item.mosque_name ?? "",
        }));
        setRanches(loadedRanches);
        setRanch((current) => loadedRanches.some((item) => item.name === current) ? current : loadedRanches[0]?.name ?? "");
      }
      if (questionResult.error) {
        setNotice(`Could not load questions: ${questionResult.error.message}`);
        return;
      }
      const loadedQuestions = Object.fromEntries(loadedSections.map((item) => [item, [] as Question[]])) as Record<Section, Question[]>;
      questionResult.data.forEach((question) => {
        if (!loadedSections.includes(question.section)) return;
        loadedQuestions[question.section].push({
          id: question.code,
          text: question.prompt,
          type: question.question_type as Question["type"],
          max: Number(question.max_score),
          isSurvey: question.is_survey,
          isLocked: question.is_locked,
          topicId: question.topic_id,
          subtopicId: question.subtopic_id,
          additionalTopicId: question.additional_topic_id,
          sortOrder: question.sort_order,
          displayOrder: question.display_order,
          notePrompt: question.note_prompt ?? "",
          scoreRanges: question.score_ranges ?? [],
          objectiveOptions: question.objective_options ?? [],
          tableInstruction: question.table_instruction ?? "",
          tableColumns: question.table_columns ?? ["Maklumat"],
          tableRows: question.table_rows ?? 2,
          scoringParentCode: question.scoring_parent_code ?? "",
          scoringDirection: question.scoring_direction ?? undefined,
          percentageThresholds: question.percentage_thresholds ?? [],
        });
      });
      setQuestionConfig(loadedQuestions);
      setQuestionDraft(cloneQuestions(loadedQuestions));
      if (answerResult.error) {
        setNotice(`Could not load saved answers: ${answerResult.error.message}`);
        return;
      }
      const workflowError = submissionResult.error ?? assignmentResult.error ?? scoreResult.error
        ?? phaseBlockScoreResult.error ?? ranchScoreResult.error ?? blockTotalResult.error ?? regionalScoreResult.error
        ?? questionScoreResult.error ?? auditResult.error;
      if (workflowError) {
        setNotice(`Could not load assessment workflow: ${workflowError.message}`);
        return;
      }
      setSubmissions(submissionResult.data as AssessmentSubmission[]);
      setJurorAssignments(assignmentResult.data as JurorAssignment[]);
      setRanchPhaseScores(ranchScoreResult.data as RanchPhaseScore[]);
      setRegionalScores(regionalScoreResult.data as RegionalScore[]);
      setQuestionScoreDetails(questionScoreResult.data as QuestionScoreDetail[]);
      setSubmissionEvents(auditResult.data as SubmissionEvent[]);
      const loadedRows = recordsFromStoredAnswers(answerResult.data as StoredAnswer[], loadedQuestions);
      const loadedSubmissions = submissionResult.data as AssessmentSubmission[];
      const loadedAssignments = assignmentResult.data as JurorAssignment[];
      const requiredIds = [...new Set(Object.values(loadedQuestions).flat().map((question) => question.topicId))];
      loadedRows.forEach((row) => {
        row.phase1 = isPhaseComplete(row.ranch, row.block, 1, requiredIds, loadedSubmissions, loadedAssignments);
        row.phase2 = isPhaseComplete(row.ranch, row.block, 2, requiredIds, loadedSubmissions, loadedAssignments);
      });
      (phaseBlockScoreResult.data as PhaseBlockScore[]).forEach((score) => {
        const row = loadedRows.find((item) => item.ranch === score.ranch_name && item.block === score.block_number);
        if (!row) return;
        if (score.phase === 1) {
          row.selfSectionScores = { ...Object.fromEntries(loadedSections.map((item) => [item, 0])), ...row.selfSectionScores, [score.section_code]: Number(score.section_score ?? 0) };
        } else {
          row.sections[score.section_code] = Number(score.section_score ?? 0);
          row.juryScores = { ...row.juryScores, [score.section_code]: [score.jury_1_score == null ? null : Number(score.jury_1_score), score.jury_2_score == null ? null : Number(score.jury_2_score)] };
        }
      });
      (blockTotalResult.data as PhaseBlockTotal[]).forEach((score) => {
        const row = loadedRows.find((item) => item.ranch === score.ranch_name && item.block === score.block_number);
        if (row) row.phaseScores = { ...row.phaseScores, [score.phase]: Number(score.overall_score) };
      });
      for (const score of scoreResult.data ?? []) {
        const row = loadedRows.find((item) => item.ranch === score.ranch_name && item.block === score.block_number);
        if (!row || !loadedSections.includes(score.section_code)) continue;
        row.sections[score.section_code as Section] = Number(score.section_score);
        row.juryScores = {
          ...row.juryScores,
          [score.section_code as Section]: [score.jury_1_score == null ? null : Number(score.jury_1_score), score.jury_2_score == null ? null : Number(score.jury_2_score)],
        };
      }
      setRows(loadedRows);
    }
    void loadWorkspace();
    return () => { cancelled = true; };
  }, [user, workspaceRefreshKey]);

  const RANCHES = ranches;
  const hasPhaseTwoRole = canAssessPhaseTwo(role);
  const canManage = canManageSystem(role);
  const topics = topicConfig;
  const sectionGuidanceNote = sectionCatalog.find((item) => item.code === section)?.guidance_note ?? "";
  const sectionIcon = (code: Section) => getSectionIcon(code, sectionCatalog.find((item) => item.code === code)?.icon_code);
  const ALL_QUESTIONS = Object.fromEntries(SECTIONS.map((item) => [item, groupQuestionsByTopic(questionConfig[item], topicConfig[item], subtopicConfig[item], additionalTopicConfig[item])])) as Record<Section, Question[]>;
  const requiredTopicIds = [...new Set(Object.values(questionConfig).flat().map((question) => question.topicId))];
  const availableTopics = phase === 2 && (role === "juri" || role === "super_user")
    ? (topics[section] ?? []).filter((topic) => jurorAssignments.some((assignment) => assignment.user_id === user.id && assignment.topic_id === topic.id))
    : topics[section] ?? [];
  const selectedTopic = availableTopics.find((topic) => topic.id === selectedTopicId) ?? availableTopics[0];
  const selectedTopicAssignments = selectedTopic
    ? jurorAssignments.filter((assignment) => assignment.topic_id === selectedTopic.id)
    : [];
  const adminTopicSlots = [...new Set([
    ...selectedTopicAssignments.map((assignment) => assignment.assessor_slot),
    ...submissions.filter((submission) => submission.phase === 2 && submission.topic_id === selectedTopic?.id)
      .map((submission) => submission.assessor_slot),
  ])].sort((first, second) => first - second);
  const adminSlotOptions = adminTopicSlots.map((slot) => {
    const assignment = selectedTopicAssignments.find((item) => item.assessor_slot === slot);
    const submission = submissions.find((item) => item.phase === 2 && item.topic_id === selectedTopic?.id && item.assessor_slot === slot);
    const juror = jurors.find((item) => item.id === (assignment?.user_id ?? submission?.user_id));
    return { slot, label: juror?.full_name || juror?.id || `Rekod terdahulu ${slot}` };
  });
  const assignedSlot = selectedTopic
    ? selectedTopicAssignments.find((assignment) => assignment.user_id === user.id)?.assessor_slot
    : undefined;
  const submissionSlot = phase === 2 ? role === "juri" || role === "super_user" ? assignedSlot ?? activeJuror : activeJuror : 1;
  const assessmentBlock = selectedTopic && !selectedTopic.blockBased
    ? rows.filter((row) => row.ranch === ranch).sort((first, second) => first.block.localeCompare(second.block))[0]?.block ?? block
    : block;
  const topicSubmissions = selectedTopic
    ? submissions.filter((submission) => submission.ranch_name === ranch
      && submission.phase === phase && submission.assessor_slot === submissionSlot
      && submission.topic_id === selectedTopic.id)
    : [];
  const currentSubmission = selectedTopic?.blockBased
    ? topicSubmissions.find((submission) => submission.block_number === assessmentBlock)
    : topicSubmissions.find((submission) => submission.status === "submitted") ?? topicSubmissions[0];
  const locked = Boolean(selectedTopic && (selectedTopic.blockBased
    ? isSubmissionLocked(ranch, assessmentBlock, phase, submissionSlot, selectedTopic.id, submissions)
    : currentSubmission?.status === "submitted"));
  const QUESTIONS = Object.fromEntries(SECTIONS.map((item) => [
    item,
    item === section && selectedTopic
      ? ALL_QUESTIONS[item].filter((question) => question.topicId === selectedTopic.id)
      : ALL_QUESTIONS[item],
  ])) as Record<Section, Question[]>;
  const selectedRanch = RANCHES.find((item) => item.name === ranch);
  const selectedRow = rows.find((item) => item.id === makeRowId(ranch, assessmentBlock));
  const eligible = Boolean(selectedRow && isPhaseComplete(ranch, assessmentBlock, 1, requiredTopicIds, submissions, jurorAssignments));
  const availablePhaseTwoBlocks = rows.filter((row) => row.ranch === ranch
    && isPhaseComplete(row.ranch, row.block, 1, requiredTopicIds, submissions, jurorAssignments))
    .sort((first, second) => first.block.localeCompare(second.block));

  useEffect(() => {
    if (phase !== 2) return;
    if ((role === "juri" || role === "super_user") && assignedSlot) setActiveJuror(assignedSlot);
    if (role === "developer" && adminTopicSlots.length && !adminTopicSlots.includes(activeJuror)) {
      setActiveJuror(adminTopicSlots[0]);
    }
    if (!availablePhaseTwoBlocks.some((row) => row.block === block)) {
      setBlock(availablePhaseTwoBlocks[0]?.block ?? "");
    }
  }, [activeJuror, adminTopicSlots, assignedSlot, availablePhaseTwoBlocks, block, phase, role]);

  useEffect(() => {
    if (selectedTopic && selectedTopic.id !== selectedTopicId) {
      setSelectedTopicId(selectedTopic.id);
    }
    const record = rows.find((row) => row.id === makeRowId(ranch, assessmentBlock));
    const savedAnswers = phase === 1
      ? record?.selfAnswers?.[section]
      : record?.juryAnswers?.[section]?.[activeJuror - 1];
    const sectionQuestions = questionConfig[section] ?? [];
    const questionIds = new Set(sectionQuestions
      .filter((question) => question.topicId === selectedTopic?.id)
      .map((question) => question.id));
    const filteredAnswers = Object.fromEntries(Object.entries(savedAnswers ?? {}).filter(([key]) => {
      const questionId = key.includes("-item-") ? key.slice(0, key.indexOf("-item-")) : key.endsWith("-target") ? key.slice(0, -7) : key.endsWith("-note") ? key.slice(0, -5) : key.endsWith("-yn") ? key.slice(0, -3) : key;
      const isQuantitativeTarget = key.endsWith("-target")
        && sectionQuestions.some((question) => question.id === questionId && question.type === "quantitative");
      return (questionIds.has(questionId) && !isQuantitativeTarget) || key.startsWith("mosque-");
    }));
    const normalizedAnswers = { ...filteredAnswers };
    if (phase === 1) {
      sectionQuestions.filter((question) => questionIds.has(question.id)).forEach((question) => {
        const legacyAnswer = normalizedAnswers[question.id];
        if (!normalizedAnswers[`${question.id}-yn`] && (legacyAnswer === "Ya" || legacyAnswer === "Tidak")) {
          normalizedAnswers[`${question.id}-yn`] = legacyAnswer;
          if (question.type === "qualitative" || question.type === "qualitative_with_note" || question.type === "qualitative_range") {
            normalizedAnswers[question.id] = "";
          }
        }
      });
    }
    setAnswers(normalizedAnswers);
  }, [activeJuror, assessmentBlock, phase, questionConfig, ranch, rows, section, selectedRanch, selectedTopic, selectedTopicId]);
  const ranchRankings = useMemo(() => ranchRankingsFromSql(ranchPhaseScores, rows, 0), [ranchPhaseScores, rows]);
  const phaseOneRanchRankings = useMemo(() => ranchRankingsFromSql(ranchPhaseScores, rows, 1), [ranchPhaseScores, rows]);
  const phaseTwoRanchRankings = useMemo(() => ranchRankingsFromSql(ranchPhaseScores, rows, 2), [ranchPhaseScores, rows]);
  const completedPhaseTwoRanchRankings = phaseTwoRanchRankings;
  const rankingRows = rankingPhase === 1 ? phaseOneRanchRankings : completedPhaseTwoRanchRankings;
  const visibleRankingRows = rankingRows.filter((row) => row.ranch.toLowerCase().includes(query.toLowerCase()));
  const reportRankings = reportPhase === 1 ? phaseOneRanchRankings : phaseTwoRanchRankings;
  const selectedRanchRanking = reportRankings.find((ranking) => ranking.ranch === reportRanch) ?? reportRankings[0];
  const selectedPhaseOneRanking = phaseOneRanchRankings.find((ranking) => ranking.ranch === reportRanch);
  const selectedPhaseTwoRanking = phaseTwoRanchRankings.find((ranking) => ranking.ranch === reportRanch);

  async function exportRanchExcelReport() {
    const rancanganId = excelRanch || selectedRanchRanking?.ranch || ranches[0]?.name;
    if (!supabase || !rancanganId || !hasPhaseTwoRole) return;
    setIsExportingExcel(true);
    try {
      const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
      if (sessionError) throw new Error(sessionError.message);
      const accessToken = sessionData.session?.access_token;
      if (!accessToken) throw new Error("Sila log masuk semula untuk mengeksport laporan.");
      const response = await fetch("/api/reports/excel", {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ ranchName: rancanganId }),
      });
      if (!response.ok) {
        const result = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(result?.error ?? `Export failed (${response.status}).`);
      }
      const downloadUrl = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = downloadUrl;
      link.download = `penilaian-${rancanganId.replace(/[^a-z0-9_-]/gi, "-")}.xlsx`;
      link.click();
      URL.revokeObjectURL(downloadUrl);
    } catch (error) {
      announce(`Gagal menjana laporan Excel: ${error instanceof Error ? error.message : "Ralat tidak diketahui."}`);
    } finally {
      setIsExportingExcel(false);
    }
  }


  const completedCount = rows.filter((row) => row.phase2).length;
  const progress = rows.length ? Math.round((completedCount / rows.length) * 100) : 0;
  const regionalAverage = regionalScores.find((score) => score.phase === 1)?.average_score;
  const rankingBlockCount = regionalScores.find((score) => score.phase === rankingPhase)?.block_count ?? 0;

  function announce(message: string) {
    setNotice(message);
    window.setTimeout(() => setNotice(""), 3200);
  }

  async function saveJurorAssignments(assignments: { user_id: string; topic_id: string }[]) {
    if (role !== "developer") return;
    setIsSavingJurorAssignments(true);
    const { error } = await supabase!.rpc("save_juror_assignments", { p_assignments: assignments });
    setIsSavingJurorAssignments(false);
    if (error) {
      announce(`Could not save juror assignments: ${error.message}`);
      return;
    }
    setWorkspaceRefreshKey((current) => current + 1);
    announce("Tugasan juri mengikut Seksyen telah disimpan.");
  }

  async function signOut() {
    const { error } = await supabase!.auth.signOut();
    if (error) announce(`Sign out failed: ${error.message}`);
  }

  function goToAssessment(nextPhase: Phase) {
    setPhase(role === "rancangan" ? 1 : nextPhase);
    setScreen("assessment");
    setMenuOpen(false);
  }

  async function reopenCurrentSubmission() {
    if (!canReopenSubmissions(role) || !selectedTopic || !currentSubmission || reopenReason.trim().length < 10) return;
    setIsReopeningSubmission(true);
    const { error } = await supabase!.rpc("reopen_assessment_submission", {
      p_ranch_name: ranch,
      p_block_number: currentSubmission.block_number,
      p_phase: phase,
      p_assessor_slot: submissionSlot,
      p_topic_id: selectedTopic.id,
      p_reason: reopenReason.trim(),
    });
    setIsReopeningSubmission(false);
    if (error) {
      announce(`Could not reopen submission: ${error.message}`);
      return;
    }
    const reopenedSubmissions = submissions.map((item) => {
      const sharedFollowup = !selectedTopic.blockBased && item.ranch_name === ranch
        && item.topic_id === selectedTopic.id && (item.phase === phase || (phase === 1 && item.phase === 2));
      const blockFollowup = selectedTopic.blockBased && item.ranch_name === ranch
        && item.block_number === assessmentBlock && item.topic_id === selectedTopic.id
        && (item.phase === phase || (phase === 1 && item.phase === 2));
      return item.id === currentSubmission.id || sharedFollowup || blockFollowup
        ? { ...item, status: "reopened" as const }
        : item;
    });
    setSubmissions(reopenedSubmissions);
    setReopenReason("");
    setRows((current) => current.map((row) => row.ranch === ranch && (!selectedTopic.blockBased || row.block === assessmentBlock) ? {
      ...row,
      phase1: isPhaseComplete(row.ranch, row.block, 1, requiredTopicIds, reopenedSubmissions, jurorAssignments),
      phase2: isPhaseComplete(row.ranch, row.block, 2, requiredTopicIds, reopenedSubmissions, jurorAssignments),
    } : row));
    const [sectionScoreResult, phaseBlockScoreResult, blockTotalResult, ranchScoreResult, regionalScoreResult, questionScoreResult, auditResult] = await Promise.all([
      supabase!.from("assessment_section_scores").select("section_code, jury_1_score, jury_2_score, section_score").eq("ranch_name", ranch).eq("block_number", assessmentBlock),
      supabase!.from("assessment_phase_block_scores").select("phase, section_code, section_score, jury_1_score, jury_2_score").eq("ranch_name", ranch).eq("block_number", assessmentBlock),
      supabase!.from("assessment_phase_block_totals").select("phase, overall_score").eq("ranch_name", ranch).eq("block_number", assessmentBlock),
      supabase!.from("assessment_ranch_scores").select("phase, ranch_name, block_count, ladang_score, kampung_score, masjid_score, keceriaan_score, overall_score, phase2_block_count, ranking_position, section_scores"),
      supabase!.from("assessment_regional_scores").select("phase, average_score, block_count"),
      supabase!.from("assessment_question_scores").select("phase, ranch_name, block_number, question_code, assessor_slot, score_percent").eq("ranch_name", ranch).eq("block_number", assessmentBlock),
      supabase!.from("assessment_submission_events").select("id, submission_id, actor_id, event_type, reason, snapshot, created_at").order("created_at", { ascending: false }).limit(100),
    ]);
    const refreshError = sectionScoreResult.error ?? phaseBlockScoreResult.error ?? blockTotalResult.error
      ?? ranchScoreResult.error ?? regionalScoreResult.error ?? questionScoreResult.error ?? auditResult.error;
    if (refreshError) {
      announce(`Submission reopened, but SQL report data could not refresh: ${refreshError.message}`);
      return;
    }
    setRanchPhaseScores(ranchScoreResult.data as RanchPhaseScore[]);
    setRegionalScores(regionalScoreResult.data as RegionalScore[]);
    setQuestionScoreDetails((current) => [
      ...current.filter((score) => score.ranch_name !== ranch || score.block_number !== assessmentBlock),
      ...(questionScoreResult.data as QuestionScoreDetail[]),
    ]);
    setSubmissionEvents(auditResult.data as SubmissionEvent[]);
    setRows((current) => current.map((row) => {
      if (row.ranch !== ranch || (selectedTopic.blockBased && row.block !== assessmentBlock)) return row;
      const sections = { ...row.sections };
      const selfSectionScores = row.selfSectionScores ?? Object.fromEntries(SECTIONS.map((item) => [item, 0]));
      const phaseScores = { ...row.phaseScores };
      const juryScores = { ...row.juryScores };
      delete phaseScores[phase];
      if (phase === 1) delete phaseScores[2];
      sectionScoreResult.data?.forEach((score) => {
        if (!SECTIONS.includes(score.section_code as Section)) return;
        const scoreSection = score.section_code as Section;
        sections[scoreSection] = Number(score.section_score);
        juryScores[scoreSection] = [score.jury_1_score == null ? null : Number(score.jury_1_score), score.jury_2_score == null ? null : Number(score.jury_2_score)];
      });
      phaseBlockScoreResult.data?.forEach((score) => {
        if (!SECTIONS.includes(score.section_code as Section)) return;
        const scoreSection = score.section_code as Section;
        if (score.phase === 1) selfSectionScores[scoreSection] = Number(score.section_score ?? 0);
        else sections[scoreSection] = Number(score.section_score ?? 0);
      });
      blockTotalResult.data?.forEach((score) => { phaseScores[score.phase as Phase] = Number(score.overall_score); });
      return {
        ...row,
        phase1: isPhaseComplete(row.ranch, row.block, 1, requiredTopicIds, reopenedSubmissions, jurorAssignments),
        phase2: isPhaseComplete(row.ranch, row.block, 2, requiredTopicIds, reopenedSubmissions, jurorAssignments),
        sections,
        selfSectionScores,
        phaseScores,
        juryScores,
      };
    }));
    if (!selectedTopic.blockBased) setWorkspaceRefreshKey((current) => current + 1);
    if (isMosqueSection && selectedRanch?.mosqueName.trim()) {
      setWorkspaceRefreshKey((current) => current + 1);
    }
    announce("Topik dibuka semula. Sebab dan rekod terdahulu disimpan dalam audit.");
  }

  async function saveAssessment() {
    if (!selectedRanch) {
      announce("Muat naik data rancangan sebelum menghantar penilaian.");
      return;
    }
    if (phase === 1 && !canAssessPhaseOne(role)) {
      announce("Fasa 1 hanya boleh dihantar oleh wakil rancangan atau developer.");
      return;
    }
    if (phase === 2 && role !== "juri" && role !== "super_user" && role !== "developer") {
      announce("Log masuk sebagai panel juri untuk meneruskan Fasa 2.");
      return;
    }
    if (phase === 2 && !eligible) {
      announce("Sila minta wakil rancangan melengkapkan Fasa 1 terlebih dahulu.");
      return;
    }
    if (!/^[A-Z0-9]{1,3}$/.test(block)) {
      announce("Masukkan nombor blok alfanumerik, maksimum 3 aksara.");
      return;
    }
    if (phase === 1 && !profileName.trim()) {
      announce("Nama profil diperlukan untuk merekodkan penilaian.");
      return;
    }
    if (!selectedTopic) {
      announce(`Pilih Topik untuk bahagian ${section}.`);
      return;
    }
    if (phase === 2 && (role === "juri" || role === "super_user") && !assignedSlot) {
      announce("Akaun anda belum ditugaskan kepada Topik ini.");
      return;
    }
    if (locked) {
      announce("Topik ini telah dihantar dan dikunci. Minta admin membukanya semula untuk pembetulan.");
      return;
    }
    if (isSubmittingAssessment) return;
    const sectionQuestions = QUESTIONS[section];
    for (const question of sectionQuestions) {
      if (question.isLocked || (phase === 2 && question.isSurvey)) continue;
      if (question.type === "auto_calculated_financial") {
        const questionItems = financialItems.filter((item) => item.questionCode === question.id);
        const evaluation = evaluateFinancialQuestion(question.id, questionItems, answers, financialThresholds);
        if (!questionItems.length) {
          announce(`Soalan ${question.id} belum mempunyai item kewangan. Minta admin menetapkannya.`);
          return;
        }
        if (evaluation.invalidItemIds.length) {
          announce(`Masukkan jumlah RM yang sah bagi soalan ${question.id}.`);
          return;
        }
        if (evaluation.score === null) {
          announce(`Tiada julat skor kewangan sepadan dengan ${evaluation.utilizationPercentage}%. Minta admin menyemak julat.`);
          return;
        }
        continue;
      }
      if (question.type === "quantitative") {
        const rawValue = answers[question.id];
        if (typeof rawValue !== "string" || !/^[0-9]+$/.test(rawValue)) {
          announce(`Masukkan angka bulat 0 atau lebih untuk soalan ${question.id}.`);
          return;
        }
      } else if (question.type === "objective") {
        if (!objectiveOptionForValue(question, answers[question.id])) {
          announce(`Pilih satu jawapan objektif untuk soalan ${question.id}.`);
          return;
        }
      } else if (question.type === "dynamic_table" && phase === 1) {
        const table = parseDynamicTableAnswer(answers[question.id], question);
        if (!table.rows.some((row) => row.some((cell) => cell.trim()))) {
          announce(`Masukkan sekurang-kurangnya satu maklumat dalam jadual ${question.id}.`);
          return;
        }
      } else if ((question.type === "subjective" || question.type === "dynamic_table") && phase === 1 && !answers[question.id]?.trim()) {
        announce("Masukkan sekurang-kurangnya satu jawapan subjektif sebelum menyimpan.");
        return;
      } else if ((question.type === "subjective" || question.type === "dynamic_table") && phase === 2 && (answers[question.id] === undefined || answers[question.id].trim() === "" || !Number.isFinite(Number(answers[question.id])) || Number(answers[question.id]) < 0 || Number(answers[question.id]) > question.max)) {
        announce(`Masukkan markah manual antara 0 hingga ${question.max} bagi soalan ${question.id}.`);
        return;
      } else if (question.type === "subjective_single" && phase === 1 && (!answers[question.id]?.trim() || answers[question.id].length > 500)) {
        announce(`Masukkan satu jawapan (maksimum 500 aksara) untuk soalan ${question.id}.`);
        return;
      } else if ((question.type === "qualitative" || question.type === "qualitative_no_grade" || question.type === "qualitative_with_note" || question.type === "qualitative_note_only" || question.type === "qualitative_range") && phase === 1 && !answers[`${question.id}-yn`]) {
        announce("Jawab semua soalan kualitatif sebelum menyimpan.");
        return;
      } else if ((question.type === "qualitative" || question.type === "qualitative_no_grade" || question.type === "qualitative_with_note" || question.type === "qualitative_note_only" || question.type === "qualitative_range") && phase === 2 && !answers[`${question.id}-yn`]) {
        announce("Pilih Ya atau Tidak bagi semua soalan kualitatif.");
        return;
      } else if ((question.type === "qualitative" || question.type === "qualitative_with_note") && answers[`${question.id}-yn`] === "Ya" && !answers[question.id]) {
        announce("Pilih gred 1 hingga 5 bagi setiap jawapan Ya.");
        return;
      } else if (question.type === "qualitative_range" && answers[`${question.id}-yn`] === "Ya" && !scoreRangeForValue(question, answers[question.id])) {
        announce(`Masukkan jumlah yang termasuk dalam julat skala untuk soalan ${question.id}.`);
        return;
      }
    }
    if (!sectionQuestions.length) {
      announce(`Tiada soalan aktif dalam Topik ${selectedTopic.name}.`);
      return;
    }
    setIsSubmittingAssessment(true);
    const { data: submissionData, error } = await supabase!.rpc("submit_assessment", {
      p_ranch_name: ranch,
      p_block_number: assessmentBlock,
      p_phase: phase,
      p_assessor_slot: submissionSlot,
      p_topic_id: selectedTopic.id,
      p_answers: answers,
    });
    setIsSubmittingAssessment(false);
    if (error) {
      announce(`Could not save answers: ${error.message}`);
      return;
    }
    const savedSubmission = submissionData as { submission_id: string; revision: number };
    const nextSubmissions = [...submissions.filter((item) => !(item.ranch_name === ranch && item.block_number === assessmentBlock
      && item.phase === phase && item.assessor_slot === submissionSlot && item.topic_id === selectedTopic.id)), {
      id: savedSubmission.submission_id,
      user_id: user.id,
      ranch_name: ranch,
      block_number: assessmentBlock,
      phase,
      assessor_slot: submissionSlot,
      topic_id: selectedTopic.id,
      status: "submitted" as const,
      revision: savedSubmission.revision,
      configuration_version: configurationVersion,
    }];
    setSubmissions(nextSubmissions);
    const [serverSectionScoreResult, serverPhaseBlockScoreResult, serverBlockTotalResult, serverRanchScoreResult, serverRegionalScoreResult, serverQuestionScoreResult, serverSubmissionResult] = await Promise.all([
      supabase!.from("assessment_section_scores").select("section_code, jury_1_score, jury_2_score, section_score").eq("ranch_name", ranch).eq("block_number", assessmentBlock),
      supabase!.from("assessment_phase_block_scores").select("phase, section_code, section_score, jury_1_score, jury_2_score").eq("ranch_name", ranch).eq("block_number", assessmentBlock),
      supabase!.from("assessment_phase_block_totals").select("phase, overall_score").eq("ranch_name", ranch).eq("block_number", assessmentBlock),
      supabase!.from("assessment_ranch_scores").select("phase, ranch_name, block_count, ladang_score, kampung_score, masjid_score, keceriaan_score, overall_score, phase2_block_count, ranking_position, section_scores"),
      supabase!.from("assessment_regional_scores").select("phase, average_score, block_count"),
      supabase!.from("assessment_question_scores").select("phase, ranch_name, block_number, question_code, assessor_slot, score_percent").eq("ranch_name", ranch).eq("block_number", assessmentBlock),
      supabase!.from("assessment_submissions").select("id, user_id, ranch_name, block_number, phase, assessor_slot, topic_id, status, revision, configuration_version").eq("ranch_name", ranch),
    ]);
    const scoreRefreshError = serverSectionScoreResult.error ?? serverPhaseBlockScoreResult.error
      ?? serverBlockTotalResult.error ?? serverRanchScoreResult.error ?? serverRegionalScoreResult.error
      ?? serverQuestionScoreResult.error ?? serverSubmissionResult.error;
    if (scoreRefreshError) announce(`Answers saved, but SQL scores could not refresh: ${scoreRefreshError.message}`);
    else {
      setRanchPhaseScores(serverRanchScoreResult.data as RanchPhaseScore[]);
      setRegionalScores(serverRegionalScoreResult.data as RegionalScore[]);
      setQuestionScoreDetails((current) => [
        ...current.filter((score) => score.ranch_name !== ranch || score.block_number !== assessmentBlock),
        ...(serverQuestionScoreResult.data as QuestionScoreDetail[]),
      ]);
      setSubmissions([
        ...submissions.filter((submission) => submission.ranch_name !== ranch),
        ...(serverSubmissionResult.data as AssessmentSubmission[]),
      ]);
    }
    const id = makeRowId(ranch, assessmentBlock);
    const existing = rows.find((row) => row.id === id);
    const selfAnswers = phase === 1
      ? { ...existing?.selfAnswers, [section]: { ...existing?.selfAnswers?.[section], ...answers } }
      : existing?.selfAnswers;
    const selfTopics = Object.fromEntries(SECTIONS.map((item) => {
      const previous = existing?.selfTopics?.[item]
        ?? (existing?.selfSections?.includes(item) || existing?.phase1 ? topics[item].map((topic) => topic.id) : []);
      return [item, [...previous]];
    })) as Record<Section, string[]>;
    if (phase === 1 && !selfTopics[section].includes(selectedTopic.id)) {
      selfTopics[section].push(selectedTopic.id);
    }
    const selfSections = SECTIONS.filter((item) => ALL_QUESTIONS[item].length > 0 && ALL_QUESTIONS[item].every((question) => selfTopics[item].includes(question.topicId)));
    const nextJuryTopics = Object.fromEntries(SECTIONS.map((item) => {
      const previous = existing?.juryTopics?.[item] ?? [];
      return [item, previous.map((topicsForJuror) => [...topicsForJuror])];
    })) as Record<Section, string[][]>;
    let juryScores = existing?.juryScores;
    let juryAnswers = existing?.juryAnswers;
    let sectionScores = existing?.sections ?? Object.fromEntries(SECTIONS.map((item) => [item, 0]));
    let selfSectionScores = existing?.selfSectionScores ?? Object.fromEntries(SECTIONS.map((item) => [item, 0]));
    const phaseScores = { ...existing?.phaseScores };
    delete phaseScores[phase];
    let phase2Complete = existing?.phase2 ?? false;
    if (phase === 2) {
      const existingJurorAnswers = existing?.juryAnswers?.[section]?.[activeJuror - 1] ?? {};
      const mergedJurorAnswers = { ...existingJurorAnswers, ...answers };
      const sectionJurorAnswers = [...(existing?.juryAnswers?.[section] ?? [])];
      sectionJurorAnswers[activeJuror - 1] = mergedJurorAnswers;
      juryAnswers = { ...existing?.juryAnswers, [section]: sectionJurorAnswers };
      nextJuryTopics[section][activeJuror - 1] ??= [];
      if (!nextJuryTopics[section][activeJuror - 1].includes(selectedTopic.id)) {
        nextJuryTopics[section][activeJuror - 1].push(selectedTopic.id);
      }
      phase2Complete = isPhaseComplete(ranch, assessmentBlock, 2, requiredTopicIds, nextSubmissions, jurorAssignments);
    }
    serverSectionScoreResult.data?.forEach((score) => {
      if (!SECTIONS.includes(score.section_code as Section)) return;
      const scoreSection = score.section_code as Section;
      sectionScores = { ...sectionScores, [scoreSection]: Number(score.section_score) };
      juryScores = { ...juryScores, [scoreSection]: [score.jury_1_score == null ? null : Number(score.jury_1_score), score.jury_2_score == null ? null : Number(score.jury_2_score)] };
    });
    serverPhaseBlockScoreResult.data?.forEach((score) => {
      if (!SECTIONS.includes(score.section_code as Section)) return;
      const scoreSection = score.section_code as Section;
      if (score.phase === 1) selfSectionScores = { ...selfSectionScores, [scoreSection]: Number(score.section_score) };
      else sectionScores = { ...sectionScores, [scoreSection]: Number(score.section_score) };
    });
    serverBlockTotalResult.data?.forEach((score) => {
      phaseScores[score.phase as Phase] = Number(score.overall_score);
    });
    const phase1Complete = isPhaseComplete(ranch, assessmentBlock, 1, requiredTopicIds, nextSubmissions, jurorAssignments);
    const updated: RecordRow = existing
      ? { ...existing, recorderName: phase === 1 ? profileName : existing.recorderName, phase1: phase1Complete, phase2: phase2Complete, selfSections, selfTopics, selfAnswers, selfSectionScores, phaseScores, juryScores, juryTopics: phase === 2 ? nextJuryTopics : existing.juryTopics, juryAnswers, sections: sectionScores, updated: "Baru sahaja" }
      : { id, ranch, block: assessmentBlock, recorderName: phase === 1 ? profileName : undefined, phase1: phase1Complete, phase2: phase2Complete, selfSections, selfTopics, selfAnswers: phase === 1 ? { [section]: { ...answers } } : undefined, selfSectionScores, phaseScores, juryScores, juryTopics: phase === 2 ? nextJuryTopics : undefined, juryAnswers, sections: sectionScores, updated: "Baru sahaja" };
    setRows(existing ? rows.map((row) => row.id === id ? updated : row) : [updated, ...rows]);
    if (!selectedTopic.blockBased || selectedRanch?.mosqueName.trim()) {
      setWorkspaceRefreshKey((current) => current + 1);
    }
    announce(phase === 1
      ? updated.phase1 ? "Data Fasa 1 berjaya disimpan. Blok kini Telah Selesai untuk Fasa 1." : `Jawapan ${selectedTopic.name} disimpan. Lengkapkan Topik lain untuk membuka Fasa 2.`
      : updated.phase2 ? "Semua Topik telah disahkan." : `${selectedTopic.name} disimpan untuk Juri ${activeJuror}.`);
  }

  async function unlockQuestion(questionCode: string) {
    if (!supabase || !canUnlockQuestions(role)) return;
    const { error } = await supabase.rpc("unlock_question", { p_question_code: questionCode });
    if (error) {
      announce(`Tidak dapat membuka soalan ${questionCode}: ${error.message}`);
      return;
    }
    announce(`Soalan ${questionCode} telah dibuka.`);
    setWorkspaceRefreshKey((current) => current + 1);
  }

  function updateQuestion(targetSection: Section, id: string, changes: Partial<Question>) {
    setQuestionDraft((current) => ({
      ...current,
      [targetSection]: current[targetSection].map((question) => {
        if (question.id !== id) return question;
        const updated = { ...question, ...changes };
        if (changes.isSurvey !== undefined) {
          updated.max = changes.isSurvey ? 0 : question.isSurvey ? Math.max(question.max, 1) : question.max;
        }
        if (changes.objectiveOptions) {
          updated.max = Math.max(0, ...changes.objectiveOptions.map((option) => Number(option.score) || 0));
        }
        if (updated.isSurvey) updated.max = 0;
        if (changes.topicId && changes.topicId !== question.topicId) {
          updated.subtopicId = null;
          updated.additionalTopicId = null;
        }
        if (changes.subtopicId !== undefined && changes.subtopicId !== question.subtopicId) updated.additionalTopicId = null;
        const subtopic = updated.subtopicId
          ? subtopicDraft[targetSection].find((item) => item.id === updated.subtopicId && item.topicId === updated.topicId)
          : undefined;
        if (subtopic && updated.sortOrder <= subtopic.sortOrder) updated.sortOrder = subtopic.sortOrder + 1;
        return updated;
      }),
    }));
  }

  function renameTopic(targetSection: Section, id: string, name: string) {
    setTopicDraft((current) => ({
      ...current,
      [targetSection]: current[targetSection].map((topic) => topic.id === id ? { ...topic, name } : topic),
    }));
  }

  function changeTopicMarks(targetSection: Section, id: string, maxMarks: number | null) {
    setTopicDraft((current) => ({
      ...current,
      [targetSection]: current[targetSection].map((topic) => topic.id === id ? { ...topic, maxMarks } : topic),
    }));
  }

  function changeTopicBlockBased(targetSection: Section, id: string, blockBased: boolean) {
    setTopicDraft((current) => ({
      ...current,
      [targetSection]: current[targetSection].map((topic) => topic.id === id ? { ...topic, blockBased } : topic),
    }));
  }

  function renameSubtopic(targetSection: Section, id: string, name: string) {
    setSubtopicDraft((current) => ({
      ...current,
      [targetSection]: current[targetSection].map((subtopic) => subtopic.id === id ? { ...subtopic, name } : subtopic),
    }));
  }

  function renameAdditionalTopic(targetSection: Section, id: string, name: string) {
    setAdditionalTopicDraft((current) => ({
      ...current,
      [targetSection]: current[targetSection].map((additionalTopic) => additionalTopic.id === id ? { ...additionalTopic, name } : additionalTopic),
    }));
  }

  function addTopic(targetSection: Section) {
    setTopicDraft((current) => {
      const existing = current[targetSection];
      const suffix = existing.reduce((highest, topic) => Math.max(highest, Number(topic.id.split("-").at(-1)) || 0), 0) + 1;
      return { ...current, [targetSection]: [...existing, { id: `${targetSection.toLowerCase()}-${suffix}`, name: `Topik ${existing.length + 1}`, maxMarks: 0, blockBased: true }] };
    });
  }

  function addSubtopic(targetSection: Section, topicId: string, name: string) {
    const cleanName = name.trim();
    if (!cleanName) return;
    setSubtopicDraft((current) => {
      const existing = current[targetSection].filter((subtopic) => subtopic.topicId === topicId);
      const suffix = existing.reduce((highest, subtopic) => Math.max(highest, Number(subtopic.id.split("-").at(-1)) || 0), 0) + 1;
        const contentOrder = Math.max(0,
          ...questionDraft[targetSection].filter((question) => question.topicId === topicId && question.subtopicId === null).map((question) => question.displayOrder),
        ...current[targetSection].filter((subtopic) => subtopic.topicId === topicId).map((subtopic) => subtopic.sortOrder),
      ) + 1;
      return {
        ...current,
        [targetSection]: [...current[targetSection], { id: `${topicId}-subtopic-${suffix}`, topicId, name: cleanName, sortOrder: contentOrder }],
      };
    });
  }

  function addAdditionalTopic(targetSection: Section, subtopicId: string, name: string) {
    const cleanName = name.trim();
    if (!cleanName) return;
    setAdditionalTopicDraft((current) => {
      const existing = current[targetSection].filter((additionalTopic) => additionalTopic.subtopicId === subtopicId);
      const suffix = existing.reduce((highest, additionalTopic) => Math.max(highest, Number(additionalTopic.id.split("-").at(-1)) || 0), 0) + 1;
      const contentOrder = Math.max(0,
        ...questionDraft[targetSection].filter((question) => question.subtopicId === subtopicId && !question.additionalTopicId).map((question) => question.sortOrder),
        ...existing.map((additionalTopic) => additionalTopic.sortOrder),
      ) + 1;
      return {
        ...current,
        [targetSection]: [...current[targetSection], { id: `${subtopicId}-additional-${suffix}`, subtopicId, name: cleanName, sortOrder: contentOrder }],
      };
    });
  }

  function deleteAdditionalTopic(targetSection: Section, id: string) {
    setAdditionalTopicDraft((current) => ({
      ...current,
      [targetSection]: current[targetSection].filter((additionalTopic) => additionalTopic.id !== id),
    }));
    setQuestionDraft((current) => ({
      ...current,
      [targetSection]: current[targetSection].map((question) => question.additionalTopicId === id ? { ...question, additionalTopicId: null } : question),
    }));
  }

  function deleteSubtopic(targetSection: Section, id: string) {
    setSubtopicDraft((current) => ({
      ...current,
      [targetSection]: current[targetSection].filter((subtopic) => subtopic.id !== id),
    }));
    setQuestionDraft((current) => ({
      ...current,
      [targetSection]: current[targetSection].map((question) => question.subtopicId === id ? { ...question, subtopicId: null, additionalTopicId: null } : question),
    }));
    setAdditionalTopicDraft((current) => ({
      ...current,
      [targetSection]: current[targetSection].filter((additionalTopic) => additionalTopic.subtopicId !== id),
    }));
  }

  function moveTopicContent(targetSection: Section, topicId: string, kind: "question" | "subtopic", id: string, direction: -1 | 1) {
    const ordered = [
      ...questionDraft[targetSection].filter((question) => question.topicId === topicId && question.subtopicId === null).map((question) => ({ kind: "question" as const, id: question.id, order: question.displayOrder })),
      ...subtopicDraft[targetSection].filter((subtopic) => subtopic.topicId === topicId).map((subtopic) => ({ kind: "subtopic" as const, id: subtopic.id, order: subtopic.sortOrder })),
    ].sort((first, second) => first.order - second.order);
    const index = ordered.findIndex((item) => item.kind === kind && item.id === id);
    const nextIndex = index + direction;
    if (index < 0 || nextIndex < 0 || nextIndex >= ordered.length) return;
    [ordered[index], ordered[nextIndex]] = [ordered[nextIndex], ordered[index]];
    const nextOrder = new Map(ordered.map((item, position) => [`${item.kind}:${item.id}`, position + 1]));
    setQuestionDraft((current) => ({
      ...current,
      [targetSection]: current[targetSection].map((question) => question.topicId === topicId && question.subtopicId === null
        ? { ...question, displayOrder: nextOrder.get(`question:${question.id}`)! }
        : question),
    }));
    setSubtopicDraft((current) => ({
      ...current,
      [targetSection]: current[targetSection].map((subtopic) => subtopic.topicId === topicId
        ? { ...subtopic, sortOrder: nextOrder.get(`subtopic:${subtopic.id}`)! }
        : subtopic),
    }));
  }

  function moveSubtopicQuestion(targetSection: Section, subtopicId: string, questionId: string, direction: -1 | 1, additionalTopicId?: string | null) {
    const question = questionDraft[targetSection].find((item) => item.id === questionId);
    if (!question) return;
    const groupId = additionalTopicId ?? question.additionalTopicId ?? null;
    const ordered = questionDraft[targetSection]
      .filter((item) => item.subtopicId === subtopicId && (item.additionalTopicId ?? null) === groupId)
      .sort((first, second) => first.sortOrder - second.sortOrder);
    const index = ordered.findIndex((question) => question.id === questionId);
    const nextIndex = index + direction;
    if (index < 0 || nextIndex < 0 || nextIndex >= ordered.length) return;
    [ordered[index], ordered[nextIndex]] = [ordered[nextIndex], ordered[index]];
    const nextOrder = new Map(ordered.map((question, position) => [question.id, position + 1]));
    setQuestionDraft((current) => ({
      ...current,
      [targetSection]: current[targetSection].map((question) => question.subtopicId === subtopicId && (question.additionalTopicId ?? null) === groupId
        ? { ...question, sortOrder: nextOrder.get(question.id)! }
        : question),
    }));
  }

  function moveSubtopicContent(targetSection: Section, subtopicId: string, kind: "question" | "additionalTopic", id: string, direction: -1 | 1) {
    const ordered = [
      ...questionDraft[targetSection].filter((question) => question.subtopicId === subtopicId && !question.additionalTopicId).map((question) => ({ kind: "question" as const, id: question.id, order: question.sortOrder })),
      ...additionalTopicDraft[targetSection].filter((additionalTopic) => additionalTopic.subtopicId === subtopicId).map((additionalTopic) => ({ kind: "additionalTopic" as const, id: additionalTopic.id, order: additionalTopic.sortOrder })),
    ].sort((first, second) => first.order - second.order);
    const index = ordered.findIndex((item) => item.kind === kind && item.id === id);
    const nextIndex = index + direction;
    if (index < 0 || nextIndex < 0 || nextIndex >= ordered.length) return;
    [ordered[index], ordered[nextIndex]] = [ordered[nextIndex], ordered[index]];
    const nextOrder = new Map(ordered.map((item, position) => [`${item.kind}:${item.id}`, position + 1]));
    setQuestionDraft((current) => ({
      ...current,
      [targetSection]: current[targetSection].map((question) => question.subtopicId === subtopicId && !question.additionalTopicId
        ? { ...question, sortOrder: nextOrder.get(`question:${question.id}`)! }
        : question),
    }));
    setAdditionalTopicDraft((current) => ({
      ...current,
      [targetSection]: current[targetSection].map((additionalTopic) => additionalTopic.subtopicId === subtopicId
        ? { ...additionalTopic, sortOrder: nextOrder.get(`additionalTopic:${additionalTopic.id}`)! }
        : additionalTopic),
    }));
  }

  function createSectionPreset(name: string, iconCode: string): string | null {
    const displayName = name.trim();
    const slug = displayName.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    const code = `custom-${slug}`;
    if (!slug || sectionCatalog.some((item) => item.code === code || item.name.toLowerCase() === displayName.toLowerCase())) {
      announce("Masukkan nama seksyen baharu yang unik.");
      return null;
    }
    const topics = Array.from({ length: 4 }, (_, index) => ({ id: `${code}-${index + 1}`, name: `Topik ${index + 1}`, maxMarks: index === 0 ? 10 : 0, blockBased: true }));
    const questions: Question[] = [{ id: `${code}-q1`, text: `Penilaian ${displayName}`, type: "qualitative", max: 10, topicId: topics[0].id, subtopicId: null, sortOrder: 1, displayOrder: 1 }];
    setSectionCatalog((current) => [...current, { code, name: displayName, weight: 0, sort_order: current.length + 1, guidance_note: "", icon_code: iconCode }]);
    setWeights((current) => ({ ...current, [code]: 0 }));
    setTopicConfig((current) => ({ ...current, [code]: topics }));
    setTopicDraft((current) => ({ ...current, [code]: topics }));
    setSubtopicConfig((current) => ({ ...current, [code]: [] }));
    setSubtopicDraft((current) => ({ ...current, [code]: [] }));
    setAdditionalTopicConfig((current) => ({ ...current, [code]: [] }));
    setAdditionalTopicDraft((current) => ({ ...current, [code]: [] }));
    setQuestionConfig((current) => ({ ...current, [code]: questions }));
    setQuestionDraft((current) => ({ ...current, [code]: questions }));
    return code;
  }

  function deleteTopic(targetSection: Section, id: string) {
    if (topicDraft[targetSection].length <= 1) return;
    const nextTopics = topicDraft[targetSection].filter((topic) => topic.id !== id);
    const fallbackId = nextTopics[0].id;
    const removedSubtopicIds = new Set(subtopicDraft[targetSection].filter((subtopic) => subtopic.topicId === id).map((subtopic) => subtopic.id));
    setTopicDraft((current) => ({ ...current, [targetSection]: nextTopics }));
    setSubtopicDraft((current) => ({
      ...current,
      [targetSection]: current[targetSection].filter((subtopic) => subtopic.topicId !== id),
    }));
    setAdditionalTopicDraft((current) => {
      return {
        ...current,
        [targetSection]: current[targetSection].filter((additionalTopic) => !removedSubtopicIds.has(additionalTopic.subtopicId)),
      };
    });
    setQuestionDraft((current) => ({
      ...current,
      [targetSection]: current[targetSection].map((question) => question.topicId === id
        ? { ...question, topicId: fallbackId, subtopicId: null, additionalTopicId: null }
        : question),
    }));
  }

  function addQuestion(targetSection: Section, question: Omit<Question, "id" | "sortOrder" | "displayOrder">) {
    const prefixes: Record<string, string> = { Ladang: "L", Kampung: "K", Masjid: "M", Keceriaan: "C" };
    const prefix = prefixes[targetSection] ?? `${targetSection.toUpperCase()}-`;
    setQuestionDraft((current) => {
      const nextNumber = current[targetSection].reduce((highest, item) => {
        const number = item.id.startsWith(prefix) ? Number(item.id.slice(prefix.length)) : 0;
        return Number.isFinite(number) ? Math.max(highest, number) : highest;
      }, 0) + 1;
      const sortOrder = Math.max(0,
        ...current[targetSection].filter((item) => item.topicId === question.topicId).map((item) => item.sortOrder),
      ) + 1;
      const displayOrder = question.subtopicId ? 0 : Math.max(0,
        ...current[targetSection].filter((item) => item.topicId === question.topicId && item.subtopicId === null).map((item) => item.displayOrder),
        ...subtopicDraft[targetSection].filter((item) => item.topicId === question.topicId).map((item) => item.sortOrder),
      ) + 1;
      return { ...current, [targetSection]: [...current[targetSection], { ...question, sortOrder, displayOrder, id: `${prefix}${nextNumber}` }] };
    });
  }

  function deleteQuestion(targetSection: Section, id: string) {
    setQuestionDraft((current) => ({
      ...current,
      [targetSection]: current[targetSection].filter((question) => question.id !== id),
    }));
  }

  async function saveAllSettings() {
    const nextTopics = cloneTopics(topicDraft);
    const nextQuestions = cloneQuestions(questionDraft);
    if (SECTIONS.some((item) => nextTopics[item].some((topic) => topic.maxMarks != null && (!Number.isFinite(topic.maxMarks) || topic.maxMarks < 0 || topic.maxMarks > 1000)))) {
      announce("Markah Topik mesti antara 0 hingga 1000 (0 = tinjauan sahaja, kosong = jumlah markah soalan).");
      return;
    }
    // Section weightage is derived from Topic marks, never entered directly.
    const nextWeights = deriveSectionWeights(SECTIONS, nextTopics, nextQuestions);
    for (const targetSection of SECTIONS) {
      const currentTopics = nextTopics[targetSection];
      if (currentTopics.length < 1 || currentTopics.some((topic) => !topic.name.trim()) || new Set(currentTopics.map((topic) => topic.id)).size !== currentTopics.length) {
        announce(`Seksyen ${targetSection} memerlukan sekurang-kurangnya satu Topik dengan nama yang sah.`);
        return;
      }
      if (nextQuestions[targetSection].length === 0) {
        announce(`Seksyen ${targetSection} mesti mempunyai sekurang-kurangnya satu soalan.`);
        return;
      }
      const currentSubtopics = subtopicDraft[targetSection];
      if (currentSubtopics.some((subtopic) => !subtopic.name.trim())
        || new Set(currentSubtopics.map((subtopic) => subtopic.id)).size !== currentSubtopics.length) {
        announce(`Setiap Sub-topik dalam seksyen ${targetSection} mesti mempunyai nama yang sah.`);
        return;
      }
      const currentAdditionalTopics = additionalTopicDraft[targetSection];
      if (currentAdditionalTopics.some((additionalTopic) => !additionalTopic.name.trim()
        || !currentSubtopics.some((subtopic) => subtopic.id === additionalTopic.subtopicId))
        || new Set(currentAdditionalTopics.map((additionalTopic) => additionalTopic.id)).size !== currentAdditionalTopics.length) {
        announce(`Setiap Additional Topic dalam seksyen ${targetSection} mesti mempunyai nama yang sah dan berada di bawah Sub-topic.`);
        return;
      }
      for (const question of nextQuestions[targetSection]) {
        question.text = typeof question.text === "string" ? question.text.trim() : "";
        question.notePrompt = typeof question.notePrompt === "string" ? question.notePrompt.trim() : "";
        question.tableInstruction = typeof question.tableInstruction === "string" ? question.tableInstruction.trim() : "";
        question.tableColumns = Array.isArray(question.tableColumns)
          ? question.tableColumns.map((column) => typeof column === "string" ? column.trim() : "")
          : [];
        if (question.type === "objective") {
          const options = Array.isArray(question.objectiveOptions) ? question.objectiveOptions : [];
          question.max = Math.max(0, ...options.map((option) => Number.isFinite(option?.score) ? option.score : 0));
        }
        if (question.type === "quantitative") {
          question.isSurvey = true;
          question.max = 0;
          question.total = undefined;
          question.notePrompt = "";
          question.scoringParentCode = undefined;
          question.scoringDirection = undefined;
          question.percentageThresholds = [];
        }
        if (question.isSurvey) question.max = 0;
        const configurationError = validateQuestionConfiguration(question);
        if (configurationError) {
          announce(`Soalan ${question.id}: ${configurationError}`);
            return;
        }
        if (question.scoringParentCode) {
          const parent = nextQuestions[targetSection].find((item) => item.id === question.scoringParentCode);
          if (question.type !== "quantitative" || !parent || parent.id === question.id
            || parent.type !== "quantitative" || parent.topicId !== question.topicId || parent.scoringParentCode || parent.isLocked) {
            announce(`Pilih soalan kuantitatif induk yang berbeza, tidak berantai, dan berada dalam Topik yang sama untuk soalan ${question.id}.`);
            return;
          }
          const thresholds = question.percentageThresholds ?? [];
          const orderedThresholds = thresholds.slice().sort((first, second) => first.min - second.min);
          if (!["higher-is-better", "lower-is-better"].includes(question.scoringDirection ?? "")
            || thresholds.some((threshold) => !Number.isFinite(threshold.min) || threshold.min < 0 || threshold.min > 100
              || (threshold.max !== null && (!Number.isFinite(threshold.max) || threshold.max < threshold.min || threshold.max > 100))
              || !Number.isFinite(threshold.score) || threshold.score < 0 || threshold.score > 100)
            || orderedThresholds.some((threshold, index) => index > 0
              && (orderedThresholds[index - 1].max === null || threshold.min < orderedThresholds[index - 1].max!))) {
            announce(`Tetapkan arah pemarkahan dan julat peratusan yang sah tanpa pertindihan untuk soalan ${question.id}.`);
            return;
          }
        } else {
          question.scoringDirection = undefined;
          question.percentageThresholds = [];
        }
        if (!currentTopics.some((topic) => topic.id === question.topicId)) {
          announce(`Pilih Topik yang sah untuk soalan ${question.id}.`);
          return;
        }
        if (question.subtopicId && !currentSubtopics.some((subtopic) => subtopic.id === question.subtopicId && subtopic.topicId === question.topicId)) {
          announce(`Pilih Sub-topik di bawah Topik yang sama untuk soalan ${question.id}.`);
          return;
        }
        if (question.additionalTopicId && !currentAdditionalTopics.some((additionalTopic) => additionalTopic.id === question.additionalTopicId && additionalTopic.subtopicId === question.subtopicId)) {
          announce(`Pilih Additional Topic di bawah Sub-topic yang sama untuk soalan ${question.id}.`);
          return;
        }
      }
      nextQuestions[targetSection] = groupQuestionsByTopic(nextQuestions[targetSection], currentTopics, currentSubtopics, currentAdditionalTopics);
    }

    setIsSavingSettings(true);
    const sectionRows = SECTIONS.map((targetSection, index) => ({
      code: targetSection,
      name: sectionNames[targetSection] ?? targetSection,
      weight: nextWeights[targetSection],
      guidance_note: sectionGuidanceDraft[targetSection]?.trim() ?? "",
      icon_code: sectionCatalog.find((item) => item.code === targetSection)?.icon_code ?? "",
      sort_order: index + 1,
      active: true,
    }));
    const topicRows = SECTIONS.flatMap((targetSection) => nextTopics[targetSection].map((topic, index) => ({
      id: topic.id,
      section_code: targetSection,
      name: topic.name.trim(),
      max_marks: topic.maxMarks ?? null,
      block_based: topic.blockBased,
      sort_order: index + 1,
      active: true,
    })));
    const nextTopicIds = new Set(topicRows.map((topic) => topic.id));
    const removedTopicIds = Object.values(topicConfig).flat().map((topic) => topic.id).filter((id) => !nextTopicIds.has(id));
    const subtopicRows = SECTIONS.flatMap((targetSection) => subtopicDraft[targetSection].map((subtopic) => ({
      id: subtopic.id,
      topic_id: subtopic.topicId,
      name: subtopic.name.trim(),
      sort_order: subtopic.sortOrder,
      active: true,
    })));
    const additionalTopicRows = SECTIONS.flatMap((targetSection) => additionalTopicDraft[targetSection].map((additionalTopic) => ({
      id: additionalTopic.id,
      subtopic_id: additionalTopic.subtopicId,
      name: additionalTopic.name.trim(),
      sort_order: additionalTopic.sortOrder,
      active: true,
    })));
    const questionRows = SECTIONS.flatMap((targetSection) => nextQuestions[targetSection].map((question, index) => ({
      code: question.id,
      section: targetSection,
      topic_id: question.topicId,
      subtopic_id: question.subtopicId,
      additional_topic_id: question.additionalTopicId ?? null,
      topic_name: nextTopics[targetSection].find((topic) => topic.id === question.topicId)!.name,
      prompt: question.text,
      question_type: question.type,
      max_score: question.isSurvey || question.type === "quantitative" ? 0 : question.max,
      is_survey: question.isSurvey || question.type === "quantitative",
      is_locked: question.isLocked ?? false,
      total_count: null,
      note_prompt: question.type === "quantitative" ? "" : question.notePrompt ?? "",
      score_ranges: question.scoreRanges ?? [],
      scoring_parent_code: question.type === "quantitative" ? null : question.scoringParentCode || null,
      scoring_direction: question.type === "quantitative" ? null : question.scoringParentCode ? question.scoringDirection ?? "higher-is-better" : null,
      percentage_thresholds: question.type === "quantitative" ? [] : question.scoringParentCode ? question.percentageThresholds ?? [] : [],
      objective_options: question.objectiveOptions ?? [],
      table_instruction: question.tableInstruction ?? "",
      table_columns: question.tableColumns ?? ["Maklumat"],
      table_rows: question.tableRows ?? 2,
      sort_order: question.sortOrder ?? index + 1,
      display_order: question.displayOrder,
      active: true,
    })));
    const nextCodes = new Set(questionRows.map((question) => question.code));
    const removedCodes = Object.values(questionConfig).flat().map((question) => question.id).filter((code) => !nextCodes.has(code));
    const nextAdditionalTopicIds = new Set(additionalTopicRows.map((additionalTopic) => additionalTopic.id));
    const removedAdditionalTopicIds = Object.values(additionalTopicConfig).flat().map((additionalTopic) => additionalTopic.id).filter((id) => !nextAdditionalTopicIds.has(id));
    const nextSubtopicIds = new Set(subtopicRows.map((subtopic) => subtopic.id));
    const removedSubtopicIds = Object.values(subtopicConfig).flat().map((subtopic) => subtopic.id).filter((id) => !nextSubtopicIds.has(id));
    try {
      const { data, error } = await supabase!.rpc("save_assessment_configuration", {
        p_sections: sectionRows,
        p_topics: topicRows,
        p_subtopics: subtopicRows,
        p_additional_topics: additionalTopicRows,
        p_questions: questionRows,
        p_expected_version: configurationVersion,
        p_removed_topic_ids: removedTopicIds,
        p_removed_subtopic_ids: removedSubtopicIds,
        p_removed_additional_topic_ids: removedAdditionalTopicIds,
        p_removed_question_codes: removedCodes,
      });
      if (error) throw new Error(error.message);
      setConfigurationVersion(Number(data));
    } catch (error) {
      setIsSavingSettings(false);
      announce(`Tidak dapat menyimpan konfigurasi (tiada perubahan digunakan): ${error instanceof Error ? error.message : "ralat tidak diketahui"}`);
      return;
    }
    setWeights(nextWeights);
    setSectionCatalog((current) => current.map((item) => ({ ...item, name: sectionNames[item.code] ?? item.name, weight: nextWeights[item.code], guidance_note: sectionGuidanceDraft[item.code]?.trim() ?? "" })));
    setTopicConfig(nextTopics);
    setTopicDraft(cloneTopics(nextTopics));
    setSubtopicConfig(cloneSubtopics(subtopicDraft));
    setSubtopicDraft(cloneSubtopics(subtopicDraft));
    setAdditionalTopicConfig(cloneAdditionalTopics(additionalTopicDraft));
    setAdditionalTopicDraft(cloneAdditionalTopics(additionalTopicDraft));
    setQuestionConfig(nextQuestions);
    setQuestionDraft(cloneQuestions(nextQuestions));
    setIsSavingSettings(false);
    announce("Semua perubahan konfigurasi berjaya disimpan.");
  }

  async function deleteAllSections() {
    if (!supabase || !canManage || !SECTIONS.length || isDeletingAllSections) return;
    const confirmed = window.confirm(
      "Padam semua seksyen secara kekal? Semua Topik, Sub-topik, Additional Topic, soalan, item kewangan soalan, jawapan, tugasan juri, penghantaran dan sejarah audit berkaitan akan dipadam. Data rancangan dan profil pengguna dikekalkan.",
    );
    if (!confirmed) return;

    setIsDeletingAllSections(true);
    try {
      const { error } = await supabase.rpc("delete_all_sections");
      if (error) {
        announce(`Could not delete sections: ${error.message}`);
        return;
      }
      setSection("Ladang");
      setSelectedTopicId("");
      setWorkspaceRefreshKey((current) => current + 1);
      announce("Semua seksyen dan data penilaian berkaitan berjaya dipadam.");
    } catch (error) {
      announce(`Could not delete sections: ${error instanceof Error ? error.message : "Unknown error"}`);
    } finally {
      setIsDeletingAllSections(false);
    }
  }

  const navItems: { id: Screen; label: string; icon: typeof LayoutDashboard }[] = [
    { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
    { id: "assessment", label: "Penilaian", icon: ClipboardCheck },
    { id: "ranking", label: "Ranking", icon: Trophy },
    { id: "reports", label: "Laporan", icon: FileText },
    { id: "print-questions", label: "Cetak Soalan", icon: Printer },
    { id: "settings", label: "Konfigurasi", icon: Settings },
  ];

  return (
    <main className={`app-shell ${role === "rancangan" ? "public-role" : ""}`} data-screen={screen} data-phase={phase}>
      <a className="skip-link" href="#main-content">Langkau ke kandungan utama</a>
      <aside className={`sidebar ${menuOpen ? "sidebar-open" : ""}`}>
        <div className="brand-lockup">
          <div className="brand-mark"><Image src="/felda-logo.svg" width={40} height={40} alt="Logo FELDA" priority /></div>
          <div><span className="brand-name">AKRF</span><span className="brand-sub">WILAYAH KUANTAN</span></div>
          <button className="icon-button sidebar-close" aria-label="Tutup menu" onClick={() => setMenuOpen(false)}><X size={18} /></button>
        </div>
        <div className="workspace-tag"><span className="live-dot" /> TAHUN 2026</div>
        <div className="nav-caption">RUANG KERJA</div>
        <nav className="main-nav" aria-label="Navigasi utama">
          {navItems.filter(({ id }) => role === "rancangan" ? id === "assessment" || id === "print-questions" : id !== "settings" || canManage).map(({ id, label, icon: Icon }) => (
            <button key={id} className={`nav-item ${screen === id ? "active" : ""}`} aria-current={screen === id ? "page" : undefined} onClick={() => { setScreen(id); setMenuOpen(false); }}>
              <Icon size={17} strokeWidth={1.9} /><span>{label}</span>{id === "assessment" && <span className="nav-count">{rows.length}</span>}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="help-card"><div className="help-icon"><CircleHelp size={16} /></div><div><strong>Perlukan bantuan?</strong><span>Rujuk panduan penilaian</span></div><ChevronRight size={15} /></div>
          <div className="profile-row"><div className="avatar">{role === "developer" ? "AD" : role === "super_user" ? "SU" : role === "juri" ? "JU" : "RA"}</div><div className="profile-copy"><strong>{profileName}</strong><span>{role === "developer" ? "Developer" : role === "super_user" ? "Super user" : role === "juri" ? "Jury panel" : "Rancangan"}</span></div><button className="icon-button profile-action" title="Sign out" aria-label="Sign out" onClick={signOut}><LogOut size={15} /></button></div>
        </div>
      </aside>

      <section className="main-area">
        <header className="topbar">
          <div className="topbar-left"><Image className="topbar-logo" src="/felda-logo.svg" width={40} height={40} alt="Logo FELDA" priority /><button className="icon-button mobile-menu" aria-label="Buka menu" onClick={() => setMenuOpen(true)}><Menu size={20} /></button><div className="breadcrumb"><span>AKRF</span><ChevronRight size={13} /><strong>{navItems.find((item) => item.id === screen)?.label}</strong></div></div>
          <div className="topbar-right"><div className="season-chip"><span className="season-dot" /> Penilaian aktif</div><button className="icon-button notification-button" aria-label="Notifikasi"><Bell size={18} /><i /></button><div className="top-divider" /><button className="top-user" onClick={signOut} title="Sign out"><span className="avatar avatar-small">{role === "developer" ? "AD" : role === "super_user" ? "SU" : role === "juri" ? "JU" : "RA"}</span><span>{profileName}</span><LogOut size={14} /></button></div>
        </header>

        <div className="content-wrap" id="main-content" tabIndex={-1} key={screen}>
          {screen === "dashboard" && <>
            <div className="page-heading"><div><div className="eyebrow"><span className="eyebrow-line" /> PUSAT PEMANTAUAN</div><h1>{greeting}, {profileName}<span className="heading-period">.</span></h1><p>Pemantauan penilaian AKRF Wilayah Kuantan bagi tahun 2026.</p></div><button className="button button-primary" onClick={() => goToAssessment(1)}><ClipboardCheck size={16} /> Mula penilaian <ArrowRight size={15} /></button></div>
            <section className="season-banner"><div className="banner-orbit orbit-one" /><div className="banner-orbit orbit-two" /><div className="banner-copy"><div className="banner-kicker"><CalendarDays size={14} /> TAHUN PENILAIAN 2026 <span className="banner-status">SEDANG BERJALAN</span></div><h2>Setiap blok, satu gambaran<br />kemajuan yang lebih jelas.</h2><p>Penilaian lapangan berakhir pada 30 November 2026.</p><button className="banner-link" onClick={() => goToAssessment(2)}>Teruskan penilaian lapangan <ArrowRight size={15} /></button></div><div className="banner-stat"><span>KEMAJUAN PENILAIAN</span><strong>{progress}<small>%</small></strong><div className="progress-track"><i style={{ width: `${progress}%` }} /></div><div className="banner-stat-foot"><span>{completedCount} daripada {rows.length} blok</span><span>Fasa 2</span></div></div><div className="banner-number">AKRF<span>·</span>26</div></section>

            <div className="section-heading"><div><h2>Gambaran keseluruhan</h2><p>Status penilaian merentas rancangan dan blok.</p></div><button className="text-button" onClick={() => setScreen("reports")}>Lihat laporan <ArrowRight size={14} /></button></div>
            <div className="metric-grid">
              <MetricCard label="JUMLAH BLOK" value={String(rows.length).padStart(2, "0")} detail="Dalam senarai penilaian" accent="green" icon={<Blocks size={18} />} />
              <MetricCard label="FASA 1 SELESAI" value={`${rows.filter((row) => row.phase1).length}`} detail="Penilaian kendiri diterima" accent="amber" icon={<BookOpenCheck size={18} />} />
              <MetricCard label="FASA 2 SELESAI" value={`${completedCount}`} detail="Penilaian lapangan disahkan" accent="blue" icon={<ShieldCheck size={18} />} />
              <MetricCard label="PURATA WILAYAH" value={formatPercent(regionalAverage)} detail="Purata Markah AKRF" accent="rose" icon={<Activity size={18} />} />
            </div>

            <div className="dashboard-grid">
              <section className="panel recent-panel"><div className="panel-heading"><div><h3>Aktiviti penilaian</h3><p>Kemaskini terkini mengikut blok</p></div><button className="icon-button subtle-button" aria-label="Tapis aktiviti"><Filter size={16} /></button></div><div className="activity-list">
                {rows.slice(0, 4).map((row, index) => <div className="activity-row" key={row.id}><div className={`activity-icon activity-${index % 3}`}>{row.phase2 ? <Check size={16} /> : row.phase1 ? <Clock3 size={16} /> : <FileText size={15} />}</div><div className="activity-main"><strong>{row.ranch} <span>· Blok {row.block}</span></strong><span>{row.phase2 ? "Penilaian lapangan disahkan" : row.phase1 ? "Menunggu penilaian lapangan" : "Fasa 1 belum dilengkapkan"}</span></div><time>{row.updated}</time></div>)}
              </div><button className="panel-footer-link" onClick={() => setScreen("reports")}>Lihat semua aktiviti <ArrowRight size={14} /></button></section>
              <section className="panel leaderboard-panel"><div className="panel-heading"><div><h3>Kedudukan semasa</h3><p>Purata skor SQL berwajaran mengikut rancangan</p></div><button className="text-button small-link" onClick={() => setScreen("reports")}>Laporan <ArrowRight size={13} /></button></div><div className="mini-rank-list">{ranchRankings.slice(0, 3).map((ranking) => <div className="mini-rank-row" key={ranking.ranch}><div className={`rank-medal medal-${ranking.rank}`}>{String(ranking.rank).padStart(2, "0")}</div><div className="rank-name"><strong>{ranking.ranch}</strong><span>{ranking.blockCount} blok · {ranking.provisional ? "skor awal Fasa 1" : "Fasa 2 lengkap"}</span></div><div className="rank-score"><strong>{formatPercent(ranking.totalScore)}</strong><span>purata</span></div><ArrowUpRight className="rank-arrow" size={15} /></div>)}{!ranchRankings.length && <div className="empty-state">Belum ada submission Fasa 1 untuk diranking.</div>}</div><div className="leaderboard-note"><span className="live-dot" /> Skor awal Fasa 1 diganti dengan skor juri selepas Fasa 2 lengkap</div></section>
            </div>
            <footer className="content-footer"><span>© 2026 AKRF FELDA Wilayah Kuantan</span><span><span className="footer-status" /> Sistem beroperasi normal</span></footer>
          </>}

          {screen === "assessment" && SECTIONS.length === 0 && <section className="panel empty-state">
            Tiada seksyen penilaian yang tersedia. Sila hubungi pentadbir untuk menyediakan konfigurasi penilaian.
          </section>}
          {screen === "assessment" && SECTIONS.length > 0 && <>
            <div className="page-heading assessment-heading"><div><div className="eyebrow"><span className="eyebrow-line" /> BORANG PENILAIAN</div><h1>Penilaian<span className="heading-period">.</span></h1><p>Lengkapkan penilaian kendiri atau sahkan markah lapangan bagi setiap blok.</p></div><div className="heading-meta"><span className="meta-icon"><CalendarDays size={15} /></span><div><span>SESI PENILAIAN</span><strong>2026</strong></div></div></div>
            <div className="phase-switch"><button className={phase === 1 ? "selected" : ""} onClick={() => setPhase(1)}><span className="phase-number">01</span><span><strong>Penilaian kendiri</strong><small>Wakil rancangan · Fasa 1</small></span>{phase === 1 && <CheckCircle2 size={17} />}</button>{role !== "rancangan" && <><div className="phase-connector" /><button className={phase === 2 ? "selected" : ""} onClick={() => setPhase(2)}><span className="phase-number">02</span><span><strong>Penilaian lapangan</strong><small>Panel juri · Fasa 2</small></span>{phase === 2 && <CheckCircle2 size={17} />}</button></>}</div>
            <div className="assessment-layout"><section className="panel form-panel"><div className="form-panel-heading"><div><span className="form-step">{phase === 1 ? "LANGKAH 1 DARI 2" : "PENILAIAN JURI"}</span><h2>{phase === 1 ? "Maklumat & penilaian kendiri" : "Pengesahan penilaian lapangan"}</h2></div><span className={`status-pill ${phase === 1 || eligible ? "status-ready" : "status-wait"}`}><i />{phase === 1 ? "Terbuka kepada awam" : eligible ? "Fasa 1 lengkap" : "Menunggu Fasa 1"}</span></div>
                {phase === 2 && hasPhaseTwoRole && <div className="jury-switch-row"><div><span className="form-step">PANEL PENILAI</span><small>{canManage ? "Pilih akaun juri untuk menyemak atau membuka semula penilaian." : `Topik tugasan: ${selectedTopic?.name ?? "—"}.`}</small></div>{role !== "developer" ? <strong>{profileName}</strong> : <select aria-label="Pilih akaun juri" value={activeJuror} disabled={!adminSlotOptions.length} onChange={(event) => setActiveJuror(Number(event.target.value))}>{!adminSlotOptions.length && <option value={1}>Tiada juri ditugaskan</option>}{adminSlotOptions.map(({ slot, label }) => <option value={slot} key={slot}>{label}</option>)}</select>}</div>}
                <div className="form-fields" style={selectedTopic?.blockBased === false ? { gridTemplateColumns: "1fr" } : undefined}>
                  <label className="field-label">Nama rancangan<select value={ranch} onChange={(event) => setRanch(event.target.value)}><option value="">{RANCHES.length ? "Pilih rancangan" : "Muat naik data rancangan dahulu"}</option>{RANCHES.map((item) => <option key={item.name} value={item.name}>{item.name}</option>)}</select><ChevronDown className="select-chevron" size={15} /></label>
                  {selectedTopic?.blockBased !== false && <label className="field-label">Nombor blok
                    {phase === 1
                      ? <input value={block} maxLength={3} onChange={(event) => setBlock(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))} placeholder="cth. 01" />
                      : <select value={block} onChange={(event) => setBlock(event.target.value)} disabled={!availablePhaseTwoBlocks.length}>
                        {!availablePhaseTwoBlocks.length && <option value="">Tiada blok Fasa 1</option>}
                        {availablePhaseTwoBlocks.map((row) => <option key={row.id} value={row.block}>{row.block}</option>)}
                      </select>}
                    {phase === 1 && <span className="field-hint">Maksimum 3 aksara</span>}
                  </label>}
                </div>
                {selectedTopic?.blockBased === false && <p className="shared-topic-hint">Topik ini dinilai sekali dan dikongsi merentas semua blok dalam rancangan.</p>}
                <div className="readonly-grid">{isMosqueSection && <div><span>NAMA MASJID</span><strong>{selectedRanch?.mosqueName || selectedRow?.selfAnswers?.[section]?.["mosque-name"] || answers["mosque-name"] || "—"}</strong></div>}<div><span>NAMA PENGURUS</span><strong>{selectedRanch?.manager || "—"}</strong></div><div><span>DICATAT OLEH</span><strong>{profileName}</strong></div></div>
                {isMosqueSection && <div className="readonly-grid mosque-fields" style={{ gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }}><NameField id="mosque-chairman" label="PENGERUSI MASJID" value={phase === 1 ? answers["mosque-chairman"] ?? "" : selectedRow?.selfAnswers?.[section]?.["mosque-chairman"] ?? ""} onChange={(value) => setAnswers({ ...answers, "mosque-chairman": value })} readOnly={phase === 2} /><NameField id="mosque-imam" label="IMAM" value={phase === 1 ? answers["mosque-imam"] ?? "" : selectedRow?.selfAnswers?.[section]?.["mosque-imam"] ?? ""} onChange={(value) => setAnswers({ ...answers, "mosque-imam": value })} readOnly={phase === 2} /></div>}
                <div className="field-separator" /><div className="question-head"><div><span className="form-step">BAHAGIAN PENILAIAN</span><h3>Maklumat {(sectionNames[section] ?? section).toLowerCase()}</h3></div><span className="question-count">{QUESTIONS[section].length} soalan</span></div>
                <div className="section-tabs">{SECTIONS.map((item) => { const Icon = sectionIcon(item); return <button key={item} className={section === item ? "chosen" : ""} onClick={() => { setSection(item); setAnswers({}); }}><Icon size={15} />{sectionNames[item] ?? item}</button>; })}</div>
                <label className="field-label assessment-topic-select">Topik
                  <select aria-label="Pilih Topik soalan" value={selectedTopic?.id ?? ""} onChange={(event) => setSelectedTopicId(event.target.value)} disabled={!availableTopics.length}>
                    {!availableTopics.length && <option value="">Tiada Topik ditugaskan</option>}
                    {availableTopics.map((topic) => <option value={topic.id} key={topic.id}>{topic.name}</option>)}
                  </select>
                </label>
                {phase === 2 && (role === "juri" || role === "super_user") && !availableTopics.length && <div className="alert-box alert-info"><ShieldCheck size={18} /><div><strong>Tiada tugasan Fasa 2</strong><span>Akaun ini masih boleh melihat dashboard dan laporan, tetapi tidak boleh menghantar penilaian Fasa 2.</span></div></div>}
                {phase === 2 && !hasPhaseTwoRole && <div className="alert-box alert-info"><ShieldCheck size={18} /><div><strong>Akses panel juri diperlukan</strong><span>Log masuk menggunakan akaun panel juri untuk mengisi Fasa 2.</span></div></div>}
                {phase === 2 && (role === "juri" || role === "super_user") && availableTopics.length > 0 && !eligible && <div className="alert-box alert-warning"><Clock3 size={18} /><div><strong>Fasa 2 belum dibuka</strong><span>Sila minta wakil rancangan melengkapkan Fasa 1 terlebih dahulu.</span></div></div>}
                {locked && <div className="alert-box alert-info"><ShieldCheck size={18} /><div><strong>Topik telah dihantar</strong><span>Penghantaran dikunci untuk mengelakkan perubahan tanpa kebenaran. Minta Admin membuka semula jika perlu pembetulan.</span></div></div>}
                {canReopenSubmissions(role) && locked && <div className="submission-reopen-control"><label className="field-label">Sebab buka semula (minimum 10 aksara)<input value={reopenReason} onChange={(event) => setReopenReason(event.target.value)} maxLength={500} /></label><button className="button button-outline" type="button" disabled={reopenReason.trim().length < 10 || isReopeningSubmission} onClick={reopenCurrentSubmission}>{isReopeningSubmission ? "Membuka..." : "Buka untuk pembetulan"}</button></div>}
                <div className="question-list">{QUESTIONS[section].map((question, index) => {
                  const baselineAnswer = selectedRow?.selfAnswers?.[section]?.[question.id] ?? "";
                  const previousQuestion = QUESTIONS[section][index - 1];
                  const subtopicHeading = question.subtopicId && previousQuestion?.subtopicId !== question.subtopicId
                    ? subtopicConfig[section].find((subtopic) => subtopic.id === question.subtopicId)?.name
                    : undefined;
                  const additionalTopicHeading = question.additionalTopicId && previousQuestion?.additionalTopicId !== question.additionalTopicId
                    ? additionalTopicConfig[section].find((additionalTopic) => additionalTopic.id === question.additionalTopicId)?.name
                    : undefined;
                  return <Fragment key={question.id}>
                    {subtopicHeading && <div className="assessment-subtopic-heading">{subtopicHeading}</div>}
                    {additionalTopicHeading && <div className="assessment-additional-topic-heading">{additionalTopicHeading}</div>}
                    <div className="question-row answer-below-question">
                    <div className="question-index">{String(index + 1).padStart(2, "0")}</div>
                    <div className="question-copy"><strong>{question.text}</strong>{question.isLocked && <span className="question-lock-status">Dikunci</span>}{question.isLocked && canUnlockQuestions(role) && <button className="button button-outline question-unlock-button" type="button" onClick={() => void unlockQuestion(question.id)}>Buka kunci soalan</button>}</div>
                    <div className="question-input"><fieldset className="question-input-fieldset" disabled={locked || !!question.isLocked || (phase === 1 && !canAssessPhaseOne(role))}>
                      <QuestionFieldDispatcher question={question} phase={phase} baselineAnswer={baselineAnswer} answers={answers}
                        financialItems={financialItems} financialThresholds={financialThresholds}
                        disabled={locked || !!question.isLocked}
                        onAnswerChange={(key, value) => setAnswers((current) => ({ ...current, [key]: value }))}
                        onAnswerPatch={(changes) => setAnswers((current) => ({ ...current, ...changes }))} />
                    </fieldset></div>
                    </div>
                  </Fragment>;
                })}</div>
                <div className="form-actions"><span><ShieldCheck size={14} />{locked ? `Dihantar · Versi ${currentSubmission?.revision ?? 1}` : phase === 1 && !canAssessPhaseOne(role) ? "Bacaan sahaja · Fasa 1" : "Data dihantar sekali mengikut Topik"}</span><button className="button button-primary" onClick={saveAssessment} disabled={!selectedRanch || locked || isSubmittingAssessment || (phase === 1 && !canAssessPhaseOne(role)) || (phase === 2 && (role === "juri" || role === "super_user") && !assignedSlot)}><Check size={16} />{locked ? "Telah dihantar" : isSubmittingAssessment ? "Menghantar..." : phase === 1 ? "Hantar penilaian Topik" : "Hantar markah Topik"}</button></div>
              </section><aside className="assessment-aside"><section className="panel block-summary"><div className="aside-kicker"><MapPin size={14} /> {selectedTopic?.blockBased === false ? "RINGKASAN RANCANGAN" : "RINGKASAN BLOK"}</div><h3>{ranch}{selectedTopic?.blockBased !== false && <span>Blok {block || "—"}</span>}</h3><div className="summary-divider"/><div className="summary-line"><span>Status Fasa 1</span><strong className={eligible ? "text-green" : "text-amber"}><i className="tiny-dot" />{eligible ? "Telah Selesai" : "Belum mula"}</strong></div><div className="summary-line"><span>Status Fasa 2</span><strong>{selectedRow?.phase2 ? "Disahkan" : "Belum dinilai"}</strong></div><div className="summary-line"><span>Bahagian aktif</span><strong>{sectionNames[section] ?? section}</strong></div><button className="summary-view" onClick={() => setScreen("reports")}>Lihat ringkasan blok <ArrowRight size={14} /></button></section><section className="tip-card"><div className="tip-symbol"><CircleHelp size={17} /></div><strong>{phase === 1 ? "Panduan penilaian kendiri" : "Panduan pemarkahan"}</strong><p>{phase === 1 ? "Isi data baseline berdasarkan rekod semasa rancangan. Data ini menjadi rujukan juri di lapangan." : "Jawapan Tidak menerima 0 markah. Jawapan Ya memerlukan gred 1 hingga 5 untuk pengiraan automatik."}</p>{sectionGuidanceNote.trim() && <div className="tip-custom-note"><span>NOTA TAMBAHAN</span><p>{sectionGuidanceNote}</p></div>}<div className="tip-bottom"><span>{phase === 1 ? "FASA 1" : "FASA 2"}</span><ArrowRight size={14} /></div></section></aside></div>
          </>}

          {screen === "ranking" && <>
            <div className="page-heading"><div><div className="eyebrow"><span className="eyebrow-line" /> KEDUDUKAN WILAYAH</div><h1>Ranking<span className="heading-period">.</span></h1><p>{rankingPhase === 1 ? "Kedudukan keseluruhan berdasarkan penilaian Fasa 1 bagi semua blok lengkap." : "Kedudukan terperinci berdasarkan markah juri Fasa 2 bagi blok yang telah dinilai."}</p></div><button className="button button-outline" onClick={() => window.print()}><Printer size={16} /> Cetak ranking</button></div>
            <div className="report-phase-switch ranking-phase-switch" role="group" aria-label="Peringkat penilaian ranking"><button type="button" aria-pressed={rankingPhase === 1} className={rankingPhase === 1 ? "selected" : ""} onClick={() => setRankingPhase(1)}>Keseluruhan · Fasa 1</button><button type="button" aria-pressed={rankingPhase === 2} className={rankingPhase === 2 ? "selected" : ""} onClick={() => setRankingPhase(2)}>Terperinci · Fasa 2</button></div>
            <div className="ranking-intro"><div><Trophy size={18} /><span>{rankingPhase === 1 ? "KEDUDUKAN KESELURUHAN FASA 1" : "KEDUDUKAN TERPERINCI FASA 2"}</span></div><strong>{rankingRows.length}<small> rancangan</small></strong><p>Peratus ialah purata skor semua blok lengkap bagi setiap rancangan, supaya ranking kekal dalam julat 0–100% walaupun bilangan blok berbeza.</p></div>
            <section className="panel table-panel">
              <div className="table-toolbar"><div><h3>{rankingPhase === 1 ? "Kedudukan keseluruhan" : "Kedudukan penilaian juri"}</h3><span>Skor dalam peratus, disusun mengikut purata wajaran SQL</span></div><div className="table-tools"><label className="search-box"><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Cari rancangan" /></label></div></div>
              <div className="table-scroll"><table><thead><tr><th>KEDUDUKAN</th><th>RANCANGAN</th><th>BLOK DINILAI</th>{SECTIONS.map((item) => <th key={item}>{(sectionNames[item] ?? item).toUpperCase()} %</th>)}<th>PURATA %</th><th>STATUS</th></tr></thead><tbody>
                {visibleRankingRows.map((row) => <tr key={row.ranch}><td><span className={`table-rank rank-${row.rank}`}>{String(row.rank).padStart(2, "0")}</span></td><td><strong>{row.ranch}</strong></td><td>{row.blockCount}</td>{SECTIONS.map((item) => <td key={item}><span className="table-score">{formatPercent(row.sections[item])}</span></td>)}<td><span className="total-score">{formatPercent(row.totalScore)}</span></td><td><span className="status-pill status-ready"><i />{`Fasa ${rankingPhase} · ${row.blockCount} blok`}</span></td></tr>)}
                {!visibleRankingRows.length && <tr><td colSpan={SECTIONS.length + 5} className="empty-state">{rankingRows.length ? "Tiada rancangan sepadan dengan carian." : rankingPhase === 1 ? "Belum ada rancangan dengan blok Fasa 1 yang lengkap." : "Belum ada rancangan dengan blok Fasa 2 yang lengkap."}</td></tr>}
              </tbody></table></div>
              <div className="table-bottom"><span>{rankingRows.length} rancangan · {rankingBlockCount} blok lengkap dalam Fasa {rankingPhase}</span><span>Kedudukan dan skor dipaparkan daripada SQL <i className="footer-status" /></span></div>
            </section>
            <div className="weight-note"><ShieldCheck size={17} /><span><strong>Pemberat semasa:</strong> {SECTIONS.map((item) => `${sectionNames[item] ?? item} ${weights[item]}%`).join(" · ")}</span><button className="text-button" onClick={() => setScreen("settings")}>Urus pemberat <ArrowRight size={13} /></button></div>
          </>}

          {screen === "reports" && <>
            <div className="page-heading"><div><div className="eyebrow"><span className="eyebrow-line" /> RINGKASAN & PELAPORAN</div><h1>Laporan Rancangan<span className="heading-period">.</span></h1><p>{reportPhase === 1 ? "Ringkasan jawapan kendiri dan pencatat bagi setiap blok." : "Pecahan skor kategori, skor kedua-dua juri dan jawapan setiap soalan."}</p></div><button className="button button-primary" onClick={() => window.print()}><Printer size={16} /> Cetak / PDF</button></div>
            <div className="report-phase-switch" role="group" aria-label="Jenis laporan"><button type="button" aria-pressed={reportPhase === 1} className={reportPhase === 1 ? "selected" : ""} onClick={() => setReportPhase(1)}>Laporan Fasa 1</button><button type="button" aria-pressed={reportPhase === 2} className={reportPhase === 2 ? "selected" : ""} onClick={() => setReportPhase(2)}>Laporan Fasa 2 · Terperinci</button></div>
            {hasPhaseTwoRole && <section className="excel-export-panel">
              <div className="excel-export-heading"><div><h3>Eksport laporan Excel</h3><span>Laporan Fasa 1 dan Fasa 2 menggunakan templat rasmi AKRF.</span></div><button className="button button-primary" type="button" onClick={exportRanchExcelReport} disabled={isExportingExcel || !ranches.length}><FileText size={16} />{isExportingExcel ? "Menjana..." : "Muat turun .xlsx"}</button></div>
              <div className="excel-export-options"><label className="field-label">Nama rancangan<select value={excelRanch || selectedRanchRanking?.ranch || ranches[0]?.name || ""} onChange={(event) => setExcelRanch(event.target.value)}>{ranches.map((item) => <option key={item.name} value={item.name}>{item.name}</option>)}</select></label></div>
            </section>}
            <label className="report-ranch-picker"><span>Nama rancangan</span><select value={selectedRanchRanking?.ranch ?? ""} onChange={(event) => setReportRanch(event.target.value)}><option value="" disabled>Pilih rancangan untuk laporan</option>{reportRankings.map((ranking) => <option key={ranking.ranch} value={ranking.ranch}>{ranking.ranch}</option>)}</select></label>
            {selectedRanchRanking ? <>
              <div className="report-current-phase">
              <div className="report-print-heading"><span>AKRF · FELDA WILAYAH KUANTAN · 2026 · LAPORAN FASA {reportPhase}</span><h2>{selectedRanchRanking.ranch}</h2><p>Kedudukan Fasa {reportPhase}: <strong>#{selectedRanchRanking.rank}</strong></p></div>
              <div className="report-summary-grid"><div className="report-summary"><span>KEDUDUKAN RANCANGAN</span><strong>#{selectedRanchRanking.rank}</strong><small>Daripada {reportRankings.length} rancangan dalam Laporan Fasa {reportPhase}</small></div><div className="report-summary"><span>BLOK LENGKAP FASA {reportPhase}</span><strong>{selectedRanchRanking.blockCount}</strong><small>Blok yang membentuk purata rancangan SQL</small></div><div className="report-summary"><span>PURATA MARKAH RANCANGAN</span><strong>{formatPercent(selectedRanchRanking.totalScore)}</strong><small>Skor purata SQL yang sama seperti ranking</small></div><div className="report-summary"><span>BLOK FASA 2 LENGKAP</span><strong>{selectedRanchRanking.phase2Blocks}</strong><small>{reportPhase === 1 ? `Daripada ${selectedRanchRanking.blockCount} blok Fasa 1` : "Termasuk dalam laporan terperinci"}</small></div></div>
              {reportPhase === 1
                ? <PhaseOneReport sectionCodes={SECTIONS} sectionNames={sectionNames} blocks={selectedRanchRanking.blocks} sections={selectedRanchRanking.sections} totalScore={selectedRanchRanking.totalScore} blockCount={selectedRanchRanking.blockCount} />
                : <PhaseTwoReport sectionCodes={SECTIONS} sectionNames={sectionNames} blocks={selectedRanchRanking.blocks} blockCount={selectedRanchRanking.blockCount} questionConfig={questionConfig} topicConfig={topicConfig} subtopicConfig={subtopicConfig} additionalTopicConfig={additionalTopicConfig} questionScoreDetails={questionScoreDetails} jurorAssignments={jurorAssignments} jurors={jurors} />}
              <div className="signature-strip"><div><span>DISEDIAKAN OLEH</span><strong>{profileName}</strong><i /></div><div><span>DISAHKAN OLEH</span><strong>Panel Penilai</strong><i /></div><div><span>TARIKH LAPORAN</span><strong>{new Date().toLocaleDateString("ms-MY")}</strong><i /></div></div>
              </div>
              <div className="report-print-phases">
                {([1, 2] as const).map((printPhase) => {
                  const printRanking = printPhase === 1 ? selectedPhaseOneRanking : selectedPhaseTwoRanking;
                  if (!printRanking) return null;
                  return <section className="report-print-phase" key={printPhase}>
                    <div className="report-print-heading"><span>AKRF · FELDA WILAYAH KUANTAN · 2026 · LAPORAN FASA {printPhase}</span><h2>{printRanking.ranch}</h2><p>Kedudukan Fasa {printPhase}: <strong>#{printRanking.rank}</strong></p></div>
                    {printPhase === 1
                      ? <PhaseOneReport sectionCodes={SECTIONS} sectionNames={sectionNames} blocks={printRanking.blocks} sections={printRanking.sections} totalScore={printRanking.totalScore} blockCount={printRanking.blockCount} />
                      : <PhaseTwoReport sectionCodes={SECTIONS} sectionNames={sectionNames} blocks={printRanking.blocks} blockCount={printRanking.blockCount} questionConfig={questionConfig} topicConfig={topicConfig} subtopicConfig={subtopicConfig} additionalTopicConfig={additionalTopicConfig} questionScoreDetails={questionScoreDetails} jurorAssignments={jurorAssignments} jurors={jurors} />}
                    <div className="signature-strip"><div><span>DISEDIAKAN OLEH</span><strong>{profileName}</strong><i /></div><div><span>DISAHKAN OLEH</span><strong>Panel Penilai</strong><i /></div><div><span>TARIKH LAPORAN</span><strong>{new Date().toLocaleDateString("ms-MY")}</strong><i /></div></div>
                  </section>;
                })}
              </div>
            </> : <section className="panel empty-state">{reportPhase === 1 ? "Tiada laporan Fasa 1 untuk rancangan ini." : "Tiada jawapan Fasa 2 untuk rancangan ini."}</section>}
          </>}

          {screen === "settings" && <><div className="page-heading"><div><div className="eyebrow"><span className="eyebrow-line" /> TETAPAN SISTEM</div><h1>Konfigurasi<span className="heading-period">.</span></h1><p>Urus pemberat seksyen dan maklumat asas penilaian.</p></div><span className="admin-badge"><ShieldCheck size={15} /> DEV / ADMIN</span></div><div className="settings-layout"><section className="panel settings-panel"><div className="panel-heading"><div><h3>Pemberat seksyen</h3><p>Jumlah pemberat perlu bersamaan 100%. Perubahan dikira terus dalam ranking.</p></div><span className="weight-total"><strong>{SECTIONS.reduce((sum, item) => sum + weights[item], 0)}</strong> / 100%</span></div><div className="weight-list">{SECTIONS.map((item, index) => { const Icon = sectionIcon(item); return <div className="weight-row" key={item}><span className={`weight-icon weight-${index}`}><Icon size={17} /></span><div className="weight-label"><strong>{sectionNames[item] ?? item}</strong><span>{QUESTIONS[item].length} soalan aktif</span></div><input aria-label={`Pemberat ${sectionNames[item] ?? item}`} type="number" min="0" max="100" value={weights[item]} readOnly title="Dikira daripada markah Topik" /><span className="percent-sign">%</span></div>; })}</div><div className="settings-footnote"><CheckCircle2 size={15} /> Jumlah pemberat dilaraskan secara automatik kepada 100%.</div></section><section className="panel settings-panel master-panel"><div className="panel-heading"><div><h3>Data rancangan</h3><p>Master data untuk borang penilaian.</p></div><span className="muted-count">{RANCHES.length} rancangan</span></div><div className="master-list">{RANCHES.map((item) => <div className="master-row" key={item.name}><div className="master-icon"><MapPin size={16} /></div><div><strong>{item.name}</strong><span>Pengurus: {item.manager}</span></div><ChevronRight size={15} /></div>)}</div><div className="settings-footnote"><ShieldCheck size={15} /> Data master dalam mod demo. Sambungkan Supabase untuk pengurusan sebenar.</div></section></div><section className="panel scoring-info"><div className="scoring-info-icon"><Activity size={19} /></div><div><strong>Kaedah pengiraan markah</strong><p>Kualitatif: (Gred ÷ 5) × markah maksimum. Kuantitatif: (angka disahkan ÷ jumlah keseluruhan) × markah maksimum. Markah akhir ialah jumlah markah seksyen selepas pemberat.</p></div><button className="text-button" onClick={() => setScreen("ranking")}>Lihat ranking <ArrowRight size={13} /></button></section></>}
          {screen === "settings" && <Tabs defaultValue="weightage" className="configuration-workspace-tabs">
            <TabsList className="configuration-workspace-tabs-list" data-role-management={canManage ? "true" : undefined} aria-label="Bahagian konfigurasi">
              <TabsTrigger className="configuration-workspace-tabs-trigger" value="weightage">Pemberat Seksyen &amp; Soalan</TabsTrigger>
              <TabsTrigger className="configuration-workspace-tabs-trigger" value="questions">Set Konfigurasi Soalan</TabsTrigger>
              <TabsTrigger className="configuration-workspace-tabs-trigger" value="upload">Upload / Download</TabsTrigger>
              {canManage && <TabsTrigger className="configuration-workspace-tabs-trigger" value="roles">Pengurusan Peranan</TabsTrigger>}
            </TabsList>
            <TabsContent className="configuration-workspace-tabs-content" value="weightage">
              <SectionWeightageOverview
                sectionCodes={SECTIONS}
                sectionNames={sectionNames}
                sectionIcons={Object.fromEntries(sectionCatalog.map((item) => [item.code, item.icon_code]))}
                topicDraft={topicDraft}
                questionDraft={questionDraft}
                getSectionIcon={getSectionIcon}
              />
            </TabsContent>
            <TabsContent className="configuration-workspace-tabs-content" value="questions">
            <SettingsManager
            sectionCodes={SECTIONS}
            sectionNames={sectionNames}
            sectionGuidanceDraft={sectionGuidanceDraft}
            topicDraft={topicDraft}
            subtopicDraft={subtopicDraft}
            additionalTopicDraft={additionalTopicDraft}
            questionDraft={questionDraft}
            sectionIcons={Object.fromEntries(sectionCatalog.map((item) => [item.code, item.icon_code]))}
            isSaving={isSavingSettings || isDeletingAllSections}
            isDeletingAllSections={isDeletingAllSections}
            onDeleteAllSections={deleteAllSections}
            onSectionGuidanceChange={(item, value) => setSectionGuidanceDraft((current) => ({ ...current, [item]: value }))}
            onTopicRename={renameTopic}
            onTopicMarksChange={changeTopicMarks}
            onTopicBlockBasedChange={changeTopicBlockBased}
            onAddTopic={addTopic}
            onDeleteTopic={deleteTopic}
            onSubtopicRename={renameSubtopic}
            onAddSubtopic={addSubtopic}
            onDeleteSubtopic={deleteSubtopic}
            onAdditionalTopicRename={renameAdditionalTopic}
            onAddAdditionalTopic={addAdditionalTopic}
            onDeleteAdditionalTopic={deleteAdditionalTopic}
            onMoveTopicContent={moveTopicContent}
            onMoveSubtopicQuestion={moveSubtopicQuestion}
            onMoveSubtopicContent={moveSubtopicContent}
            onQuestionChange={updateQuestion}
            onAddQuestion={addQuestion}
            onDeleteQuestion={deleteQuestion}
            onCreateSection={createSectionPreset}
            onSave={saveAllSettings}
            renderFinancialEditor={(questionCode) => <FinancialItemsEditor questionCode={questionCode} expectedVersion={configurationVersion} persisted={Object.values(questionConfig).flat().some((question) => question.id === questionCode && question.type === "auto_calculated_financial")} items={financialItems} onNotice={announce} onChanged={() => setWorkspaceRefreshKey((current) => current + 1)} />}
          />
          {screen === "settings" && canManage && <JurorAssignmentManager
            topics={topicConfig}
            sectionNames={sectionNames}
            assignments={jurorAssignments}
            jurors={jurors}
            isSaving={isSavingJurorAssignments}
            onSave={saveJurorAssignments}
          />}
          {screen === "settings" && canManage && <FinancialConfigManager
            thresholds={financialThresholds}
            expectedVersion={configurationVersion}
            onNotice={announce}
            onChanged={() => setWorkspaceRefreshKey((current) => current + 1)}
          />}
          {screen === "settings" && canManage && <section className="panel question-section-panel submission-audit-panel">
            <div className="question-section-heading"><div><span className="form-step"><ShieldCheck size={14} /> JEJAK AUDIT</span><h2>Sejarah penghantaran</h2><p>Sehingga 100 peristiwa terkini, termasuk sebab pembukaan semula dan snapshot jawapan.</p></div></div>
            <div className="table-scroll"><table className="question-config-table"><thead><tr><th>Masa</th><th>Rancangan / blok</th><th>Fasa / juri</th><th>Peristiwa</th><th>Pelaku</th><th>Rekod</th></tr></thead><tbody>
              {submissionEvents.map((event) => {
                const eventSubmission = submissions.find((submission) => submission.id === event.submission_id);
                const jurorName = jurors.find((juror) => juror.id === eventSubmission?.user_id)?.full_name;
                return <tr key={event.id}><td>{new Date(event.created_at).toLocaleString("ms-MY")}</td><td>{eventSubmission ? `${eventSubmission.ranch_name} · ${eventSubmission.block_number}` : "—"}</td><td>{eventSubmission ? `Fasa ${eventSubmission.phase} · ${jurorName || "Juri"}` : "—"}</td><td>{event.event_type === "reopened" ? `Dibuka semula: ${event.reason}` : event.reason || "Dihantar"}</td><td>{event.actor_id.slice(0, 8)}</td><td><details><summary>Lihat snapshot</summary><pre className="audit-snapshot">{JSON.stringify(event.snapshot, null, 2)}</pre></details></td></tr>;
              })}
              {!submissionEvents.length && <tr><td colSpan={6} className="question-empty-state">Belum ada rekod audit.</td></tr>}
            </tbody></table></div>
          </section>}
            </TabsContent>
            <TabsContent className="configuration-workspace-tabs-content" value="upload">
              {canManage && <QuestionConfigManager
                sections={sectionCatalog.map((item) => ({ code: item.code, name: item.name }))}
                onNotice={announce}
                onImported={() => setWorkspaceRefreshKey((current) => current + 1)}
              />}
            </TabsContent>
            {canManage && <TabsContent className="configuration-workspace-tabs-content" value="roles">
              <RoleManagement />
            </TabsContent>}
          </Tabs>}
          {screen === "print-questions" && <PrintQuestions sections={SECTIONS} sectionNames={sectionNames} questionConfig={questionConfig} topicConfig={topicConfig} subtopicConfig={subtopicConfig} additionalTopicConfig={additionalTopicConfig} financialItems={financialItems} />}
        </div>
      </section>
      {notice && <div className="toast-message"><CheckCircle2 size={17} />{notice}<button className="icon-button" aria-label="Tutup notis" onClick={() => setNotice("")}><X size={15} /></button></div>}
    </main>
  );
}

type SettingsManagerProps = {
  sectionCodes: Section[];
  sectionNames: Record<Section, string>;
  sectionGuidanceDraft: Record<Section, string>;
  topicDraft: Record<Section, Topic[]>;
  subtopicDraft: Record<Section, Subtopic[]>;
  additionalTopicDraft: Record<Section, AdditionalTopic[]>;
  questionDraft: Record<Section, Question[]>;
  sectionIcons: Record<Section, string>;
  isSaving: boolean;
  isDeletingAllSections: boolean;
  onDeleteAllSections: () => void;
  onSectionGuidanceChange: (section: Section, value: string) => void;
  onTopicRename: (section: Section, id: string, name: string) => void;
  onTopicMarksChange: (section: Section, id: string, maxMarks: number | null) => void;
  onTopicBlockBasedChange: (section: Section, id: string, blockBased: boolean) => void;
  onAddTopic: (section: Section) => void;
  onDeleteTopic: (section: Section, id: string) => void;
  onSubtopicRename: (section: Section, id: string, name: string) => void;
  onAddSubtopic: (section: Section, topicId: string, name: string) => void;
  onDeleteSubtopic: (section: Section, id: string) => void;
  onAdditionalTopicRename: (section: Section, id: string, name: string) => void;
  onAddAdditionalTopic: (section: Section, subtopicId: string, name: string) => void;
  onDeleteAdditionalTopic: (section: Section, id: string) => void;
  onMoveTopicContent: (section: Section, topicId: string, kind: "question" | "subtopic", id: string, direction: -1 | 1) => void;
  onMoveSubtopicQuestion: (section: Section, subtopicId: string, questionId: string, direction: -1 | 1, additionalTopicId?: string | null) => void;
  onMoveSubtopicContent: (section: Section, subtopicId: string, kind: "question" | "additionalTopic", id: string, direction: -1 | 1) => void;
  onQuestionChange: (section: Section, id: string, changes: Partial<Question>) => void;
  onAddQuestion: (section: Section, question: Omit<Question, "id" | "sortOrder" | "displayOrder">) => void;
  onDeleteQuestion: (section: Section, id: string) => void;
  onCreateSection: (name: string, iconCode: string) => string | null;
  onSave: () => void;
  renderFinancialEditor: (questionCode: string) => React.ReactNode;
};

function SettingsManager({ sectionCodes, sectionNames, sectionGuidanceDraft, topicDraft, subtopicDraft, additionalTopicDraft, questionDraft, sectionIcons, isSaving, isDeletingAllSections, onDeleteAllSections, onSectionGuidanceChange, onTopicRename, onTopicMarksChange, onTopicBlockBasedChange, onAddTopic, onDeleteTopic, onSubtopicRename, onAddSubtopic, onDeleteSubtopic, onAdditionalTopicRename, onAddAdditionalTopic, onDeleteAdditionalTopic, onMoveTopicContent, onMoveSubtopicQuestion, onMoveSubtopicContent, onQuestionChange, onAddQuestion, onDeleteQuestion, onCreateSection, onSave, renderFinancialEditor }: SettingsManagerProps) {
  const SECTIONS = sectionCodes;
  const [activeSection, setActiveSection] = useState<Section>("Ladang");
  const [showNewSection, setShowNewSection] = useState(false);
  const [newSectionName, setNewSectionName] = useState("");
  const [newSectionIconCode, setNewSectionIconCode] = useState("activity");
  const [showNewQuestion, setShowNewQuestion] = useState(false);
  const [newText, setNewText] = useState("");
  const [newType, setNewType] = useState<Question["type"]>("qualitative");
  const [newNotePrompt, setNewNotePrompt] = useState("");
  const [newTableInstruction, setNewTableInstruction] = useState("");
  const [newTableColumns, setNewTableColumns] = useState<string[]>(["Maklumat"]);
  const [newTableRows, setNewTableRows] = useState(2);
  const [newScoreRanges, setNewScoreRanges] = useState<QuestionScoreRange[]>(() => DEFAULT_MEDIA_SOCIAL_SCORE_RANGES.map((range) => ({ ...range })));
  const [newObjectiveOptions, setNewObjectiveOptions] = useState<ObjectiveOption[]>([
    { id: "option-1", label: "Pilihan 1", score: 1 },
    { id: "option-2", label: "Pilihan 2", score: 1 },
  ]);
  const [newQuestionError, setNewQuestionError] = useState("");
  const [newMax, setNewMax] = useState("10");
  const [newIsSurvey, setNewIsSurvey] = useState(false);
  const [newTopicId, setNewTopicId] = useState(DEFAULT_TOPICS.Ladang[0].id);
  const [newSubtopicId, setNewSubtopicId] = useState("");
  const [newAdditionalTopicId, setNewAdditionalTopicId] = useState("");
  const derivedWeights = deriveSectionWeights(SECTIONS, topicDraft, questionDraft);
  const sectionMarks = (code: Section) => topicDraft[code].reduce((sum, topic) => {
    const questions = questionDraft[code].filter((question) => question.topicId === topic.id);
    const hasScoredQuestions = questions.some((question) =>
      !question.isSurvey && question.type !== "subjective_single" && question.type !== "quantitative");
    const calculatedMarks = questions.reduce((total, question) =>
      total + (question.isSurvey || question.type === "subjective_single" || question.type === "quantitative" ? 0 : Number(question.max) || 0), 0);
    return sum + (hasScoredQuestions ? topic.maxMarks ?? calculatedMarks : 0);
  }, 0);
  const draftWeightTotal = SECTIONS.reduce((sum, item) => sum + derivedWeights[item], 0);
  const activeQuestions = questionDraft[activeSection] ?? [];
  const activeIcon = getSectionIcon(activeSection, sectionIcons[activeSection]);
  const ActiveIcon = activeIcon;

  function submitSectionPreset(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const createdCode = onCreateSection(newSectionName, newSectionIconCode);
    if (!createdCode) return;
    setActiveSection(createdCode);
    setNewTopicId(`${createdCode}-1`);
    setNewSectionName("");
    setNewSectionIconCode("activity");
    setShowNewSection(false);
  }

  function submitQuestion(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const question = {
      text: newText.trim(),
      type: newType,
      max: newType === "quantitative" || newIsSurvey ? 0 : newType === "subjective_single" ? 1 : newType === "objective" ? Math.max(...newObjectiveOptions.map((option) => option.score)) : Number(newMax),
      isSurvey: newType === "quantitative" || newIsSurvey,
      isLocked: false,
      topicId: newTopicId,
      subtopicId: newSubtopicId || null,
      additionalTopicId: newAdditionalTopicId || null,
      total: undefined,
      scoringParentCode: undefined,
      scoringDirection: undefined,
      percentageThresholds: [],
      notePrompt: usesNoteField(newType) ? newNotePrompt.trim() : "",
      scoreRanges: newType === "qualitative_range" ? newScoreRanges : [],
      objectiveOptions: newType === "objective" ? newObjectiveOptions : [],
      tableInstruction: newType === "dynamic_table" ? newTableInstruction.trim() : "",
      tableColumns: newType === "dynamic_table" ? newTableColumns.map((column) => column.trim()) : [],
      tableRows: newType === "dynamic_table" ? newTableRows : 2,
    };
    const problem = validateQuestionConfiguration(question);
    if (problem) {
      setNewQuestionError(problem);
      return;
    }
    onAddQuestion(activeSection, question);
    setNewText("");
    setNewType("qualitative");
    setNewIsSurvey(false);
    setNewNotePrompt("");
    setNewTableInstruction("");
    setNewTableColumns(["Maklumat"]);
    setNewTableRows(2);
    setNewScoreRanges(DEFAULT_MEDIA_SOCIAL_SCORE_RANGES.map((range) => ({ ...range })));
    setNewObjectiveOptions([{ id: "option-1", label: "Pilihan 1", score: 1 }, { id: "option-2", label: "Pilihan 2", score: 1 }]);
    setNewQuestionError("");
    setNewMax("10");
    setNewSubtopicId("");
    setNewAdditionalTopicId("");
    setShowNewQuestion(false);
  }

  function requestAddQuestion(topicId: string, subtopicId: string | null, additionalTopicId: string | null = null) {
    setNewTopicId(topicId);
    setNewSubtopicId(subtopicId ?? "");
    setNewAdditionalTopicId(additionalTopicId ?? "");
    setShowNewQuestion(true);
  }

  return <div className="question-config-page">
    <header className="question-config-header">
      <div><span className="eyebrow"><span className="eyebrow-line" /> KONFIGURASI PENILAIAN</span><h1>Set Konfigurasi Soalan</h1><p>Urus tetapan soalan, topik, jenis penilaian, dan pemarkahan mengikut seksyen.</p></div>
      <span className="admin-badge"><ShieldCheck size={15} /> DEV / ADMIN</span><button className="question-add-button" type="button" onClick={() => setShowNewSection((visible) => !visible)}><Plus size={15} /> Jana seksyen preset</button>
      {SECTIONS.length > 0 && <button className="button button-outline" type="button" disabled={isSaving} onClick={onDeleteAllSections}>{isDeletingAllSections ? <><LoaderCircle className="question-spinner" size={15} /> Memadam...</> : <><Trash2 size={15} /> Padam semua seksyen</>}</button>}
    </header>
    {showNewSection && <form className="new-section-preset-form" onSubmit={submitSectionPreset}>
      <label>Nama seksyen<input required value={newSectionName} onChange={(event) => setNewSectionName(event.target.value)} placeholder="Contoh: Keselamatan" /></label>
      <div className="section-icon-picker" role="group" aria-label="Pilih ikon seksyen">
        <span className="section-icon-picker-label">Pilih ikon</span>
        <div className="section-icon-options">{SECTION_ICON_OPTIONS.map(({ code, label, icon: Icon }) => <button key={code} type="button" className={`section-icon-option ${newSectionIconCode === code ? "selected" : ""}`} aria-label={label} aria-pressed={newSectionIconCode === code} title={label} onClick={() => setNewSectionIconCode(code)}><Icon size={17} /><span>{label}</span></button>)}</div>
      </div>
      <span>Menjana empat Topik dan satu soalan permulaan.</span><button className="question-add-button" type="submit"><Plus size={15} /> Jana seksyen</button>
    </form>}

    {SECTIONS.length === 0 ? <section className="panel empty-state">
      <h2>Tiada seksyen penilaian</h2>
      <p>Jana seksyen preset untuk membina semula konfigurasi penilaian. Data rancangan dan profil pengguna masih dikekalkan.</p>
    </section> : <>
    <Tabs value={activeSection} onValueChange={(value) => { const nextSection = value as Section; setActiveSection(nextSection); setNewTopicId(topicDraft[nextSection][0]?.id ?? ""); setNewSubtopicId(""); setNewAdditionalTopicId(""); }} className="question-tabs">
      <TabsList aria-label="Seksyen penilaian" className="question-tabs-list">
        {SECTIONS.map((item) => { const Icon = getSectionIcon(item, sectionIcons[item]); const itemMax = sectionMarks(item); return <TabsTrigger className="question-tabs-trigger" key={item} value={item}><span className="question-tab-top"><Icon size={16} /><strong>{sectionNames[item] ?? item}</strong></span><span className="question-tab-meta">{questionDraft[item].length} soalan · {itemMax} markah</span></TabsTrigger>; })}
      </TabsList>
      {SECTIONS.map((item) => <TabsContent className="question-tabs-content" key={item} value={item}>
        <section className="question-section-panel">
          <div className="question-section-heading"><div><span className={`section-code section-code-${item.toLowerCase()}`}><ActiveIcon size={15} /> {sectionNames[item] ?? item}</span><h2>Soalan {sectionNames[item] ?? item}</h2><p>{questionDraft[item].length} soalan aktif · {sectionMarks(item)} markah maksimum</p></div><button className="question-add-button" type="button" onClick={() => setShowNewQuestion((visible) => !visible)}><Plus size={16} /> Tambah Soalan Baharu</button></div>
          <section className="topic-customizer" aria-label={`Topics in ${sectionNames[item] ?? item}`}>
            <div className="topic-customizer-heading"><div><h3>Topics · {sectionNames[item] ?? item}</h3><p>Each Topic can contain direct questions, Sub-topics, or both. Topic marks remain the scoring unit.</p></div><button className="question-add-button topic-add-button" type="button" onClick={() => onAddTopic(item)}><Plus size={14} /> Add Topic</button></div>
            <div className="topic-customizer-grid">{topicDraft[item].map((topic, index) => <TopicContentEditor
              key={topic.id}
              section={item}
              topic={topic}
              index={index}
              canDeleteTopic={topicDraft[item].length > 1}
              questions={questionDraft[item].filter((question) => question.topicId === topic.id)}
              subtopics={subtopicDraft[item].filter((subtopic) => subtopic.topicId === topic.id)}
              additionalTopics={additionalTopicDraft[item]}
              onTopicRename={onTopicRename}
              onTopicMarksChange={onTopicMarksChange}
              onTopicBlockBasedChange={onTopicBlockBasedChange}
              onDeleteTopic={onDeleteTopic}
              onSubtopicRename={onSubtopicRename}
              onAddSubtopic={onAddSubtopic}
              onDeleteSubtopic={onDeleteSubtopic}
              onAdditionalTopicRename={onAdditionalTopicRename}
              onAddAdditionalTopic={onAddAdditionalTopic}
              onDeleteAdditionalTopic={onDeleteAdditionalTopic}
              onRequestAddQuestion={requestAddQuestion}
              onMoveTopicContent={onMoveTopicContent}
              onMoveSubtopicQuestion={onMoveSubtopicQuestion}
              onMoveSubtopicContent={onMoveSubtopicContent}
            />)}</div>
          </section>
          <label className="section-guidance-editor">Nota tambahan · Panduan Penilaian<textarea rows={3} value={sectionGuidanceDraft[item] ?? ""} onChange={(event) => onSectionGuidanceChange(item, event.target.value)} placeholder="Nota panduan tambahan untuk seksyen ini" /></label>
          {showNewQuestion && activeSection === item && <form className="new-question-form" onSubmit={submitQuestion}>
            <label>Teks soalan<textarea required rows={2} value={newText} onChange={(event) => setNewText(event.target.value)} placeholder="Masukkan teks soalan" /></label>
            <label>Jenis soalan<select value={newType} onChange={(event) => { const type = event.target.value as Question["type"]; setNewType(type); setNewIsSurvey((current) => type === "quantitative" ? true : newType === "quantitative" ? false : current); if (type === "qualitative_range") setNewScoreRanges((current) => current.length ? current : DEFAULT_MEDIA_SOCIAL_SCORE_RANGES.map((range) => ({ ...range }))); }}><option value="qualitative">Kualitatif (Grading 1 - 5)</option><option value="qualitative_no_grade">Kualitatif (Tanpa gred)</option><option value="qualitative_with_note">Kualitatif (Gred &amp; Nota)</option><option value="qualitative_note_only">Kualitatif (Nota sahaja)</option><option value="qualitative_range">Skala kualitatif berasaskan julat</option><option value="objective">Objektif (pilihan tunggal, markah mengikut jawapan)</option><option value="dynamic_table">Jadual dinamik</option><option value="quantitative">Kuantitatif (Rekod sahaja)</option><option value="subjective">Subjektif (Pelbagai jawapan · Markah manual)</option><option value="subjective_single">Subjektif (Jawapan tunggal · Tiada markah)</option><option value="auto_calculated_financial">Kewangan (Dikira automatik)</option></select></label>
            {newType === "objective" && <ObjectiveOptionsEditor options={newObjectiveOptions} onChange={(options) => { setNewObjectiveOptions(options); setNewQuestionError(""); }} />}
            {usesNoteField(newType) && <label>Label sub-soalan / nota<input required value={newNotePrompt} onChange={(event) => setNewNotePrompt(event.target.value)} placeholder="Contoh: Nyatakan kuantiti" /></label>}
            {newType === "dynamic_table" && <><label>Arahan jadual<textarea rows={2} value={newTableInstruction} onChange={(event) => setNewTableInstruction(event.target.value)} placeholder="Arahan untuk mengisi jadual" /></label><TableStructureFields columns={newTableColumns} rows={newTableRows} onChange={(columns, rows) => { setNewTableColumns(columns); setNewTableRows(rows); }} /></>}
            {newType === "qualitative_range" && <div className="new-question-ranges"><span>Julat, tahap dan skala (selepas Ya)</span>{newScoreRanges.map((range, index) => <div className="question-range-row" key={index}><label>Minimum<input required type="number" value={range.min} onChange={(event) => setNewScoreRanges((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, min: Number(event.target.value) } : item))} /></label><label>Maksimum<input type="number" value={range.max ?? ""} placeholder="Tiada had" onChange={(event) => setNewScoreRanges((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, max: event.target.value === "" ? null : Number(event.target.value) } : item))} /></label><label>Skala<input required type="number" min="1" max="5" step="1" value={range.score} onChange={(event) => setNewScoreRanges((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, score: Number(event.target.value) } : item))} /></label><label>Perkara<input required value={range.label} onChange={(event) => setNewScoreRanges((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, label: event.target.value } : item))} /></label>{newScoreRanges.length > 1 && <button className="question-delete-button" type="button" aria-label="Padam julat" onClick={() => setNewScoreRanges((current) => current.filter((_, itemIndex) => itemIndex !== index))}><Trash2 size={14} /></button>}</div>)}<button className="question-add-button topic-add-button" type="button" disabled={newScoreRanges.at(-1)?.max == null} onClick={() => setNewScoreRanges((current) => appendQuestionScoreRange(current))}><Plus size={14} /> Tambah julat</button></div>}
            <label>Topic<select required value={newTopicId} onChange={(event) => { setNewTopicId(event.target.value); setNewSubtopicId(""); setNewAdditionalTopicId(""); }}>{topicDraft[activeSection].map((topic) => <option value={topic.id} key={topic.id}>{topic.name}</option>)}</select></label>
            <label>Sub-topic (optional)<select value={newSubtopicId} onChange={(event) => { setNewSubtopicId(event.target.value); setNewAdditionalTopicId(""); }}>
              <option value="">Direct question under Topic</option>
              {subtopicDraft[activeSection].filter((subtopic) => subtopic.topicId === newTopicId).map((subtopic) => <option value={subtopic.id} key={subtopic.id}>{subtopic.name}</option>)}
            </select></label>
            {newSubtopicId && <label>Additional Topic (optional)<select value={newAdditionalTopicId} onChange={(event) => setNewAdditionalTopicId(event.target.value)}>
              <option value="">Direct question under Sub-topic</option>
              {additionalTopicDraft[activeSection].filter((additionalTopic) => additionalTopic.subtopicId === newSubtopicId).map((additionalTopic) => <option value={additionalTopic.id} key={additionalTopic.id}>{additionalTopic.name}</option>)}
            </select></label>}
            {newType === "quantitative"
              ? <p className="question-no-score">Angka direkod untuk rujukan sahaja dan tidak menyumbang kepada markah.</p>
              : <label className="question-flag"><input type="checkbox" checked={newIsSurvey} onChange={(event) => setNewIsSurvey(event.target.checked)} /> Soalan tinjauan (markah maksimum ditetapkan kepada 0)</label>}
            {newType !== "subjective_single" && newType !== "quantitative" && <label>Markah maksimum<input required type="number" min={newIsSurvey ? "0" : "1"} max="100000" value={newIsSurvey ? 0 : newType === "objective" ? Math.max(0, ...newObjectiveOptions.map((option) => option.score)) : newMax} readOnly={newIsSurvey || newType === "objective"} onChange={(event) => setNewMax(event.target.value)} /></label>}
            {newQuestionError && <span className="objective-options-error" role="alert">{newQuestionError}</span>}
            <div className="new-question-actions"><button className="question-add-button" type="submit"><Plus size={15} /> Tambah ke seksyen</button><button className="question-cancel-button" type="button" onClick={() => setShowNewQuestion(false)}>Batal</button></div>
          </form>}

          <div className="question-table-wrap"><table className="question-config-table"><thead><tr><th>Kod soalan</th><th>Teks soalan</th><th>Topic</th><th>Sub-topic</th><th>Additional Topic</th><th>Jenis soalan</th><th aria-label="Tindakan" /></tr></thead><tbody>
            {questionDraft[item].map((question) => <Fragment key={question.id}><tr>
              <td><span className={`question-code question-code-${item.toLowerCase()}`}>{question.id}</span></td>
              <td><textarea aria-label={`Teks soalan ${question.id}`} rows={2} value={question.text} onChange={(event) => onQuestionChange(item, question.id, { text: event.target.value })} />{question.type === "quantitative" ? <span className="question-no-score">Rujukan sahaja · 0 markah</span> : <label className="question-flag"><input type="checkbox" checked={question.isSurvey ?? false} onChange={(event) => onQuestionChange(item, question.id, { isSurvey: event.target.checked })} /> Tinjauan (0 markah)</label>}<label className="question-flag"><input type="checkbox" checked={question.isLocked ?? false} onChange={(event) => onQuestionChange(item, question.id, { isLocked: event.target.checked })} /> Dikunci</label></td>
              <td><select aria-label={`Topik ${question.id}`} value={question.topicId} onChange={(event) => onQuestionChange(item, question.id, { topicId: event.target.value })}>{topicDraft[item].map((topic) => <option key={topic.id} value={topic.id}>{topic.name}</option>)}</select></td>
              <td><select aria-label={`Sub-topic ${question.id}`} value={question.subtopicId ?? ""} onChange={(event) => onQuestionChange(item, question.id, { subtopicId: event.target.value || null })}>
                <option value="">Direct question</option>
                {subtopicDraft[item].filter((subtopic) => subtopic.topicId === question.topicId).map((subtopic) => <option key={subtopic.id} value={subtopic.id}>{subtopic.name}</option>)}
              </select></td>
              <td><select aria-label={`Additional Topic ${question.id}`} value={question.additionalTopicId ?? ""} disabled={!question.subtopicId} onChange={(event) => onQuestionChange(item, question.id, { additionalTopicId: event.target.value || null })}>
                <option value="">Direct question</option>
                {additionalTopicDraft[item].filter((additionalTopic) => additionalTopic.subtopicId === question.subtopicId).map((additionalTopic) => <option key={additionalTopic.id} value={additionalTopic.id}>{additionalTopic.name}</option>)}
              </select></td>
              <td>
                <select aria-label={`Jenis soalan ${question.id}`} value={question.type} onChange={(event) => {
                  const type = event.target.value as Question["type"];
                  onQuestionChange(item, question.id, {
                    type,
                    isSurvey: type === "quantitative" ? true : question.type === "quantitative" ? false : question.isSurvey,
                    max: type === "quantitative" ? 0 : question.type === "quantitative" ? type === "subjective_single" ? 1 : 10 : question.max,
                    scoringParentCode: undefined,
                    scoringDirection: undefined,
                    percentageThresholds: [],
                    total: undefined,
                    objectiveOptions: type === "objective"
                      ? question.objectiveOptions?.length ? question.objectiveOptions : [{ id: `${question.id}-option-1`, label: "Pilihan 1", score: 1 }, { id: `${question.id}-option-2`, label: "Pilihan 2", score: 1 }]
                      : question.objectiveOptions,
                    notePrompt: type === "quantitative" ? "" : usesNoteField(type) ? question.notePrompt?.trim() || "Nota tambahan" : question.notePrompt,
                    scoreRanges: type === "qualitative_range" ? question.scoreRanges?.length ? question.scoreRanges : DEFAULT_MEDIA_SOCIAL_SCORE_RANGES.map((range) => ({ ...range })) : question.scoreRanges,
                    tableInstruction: question.tableInstruction ?? "",
                    tableColumns: type === "dynamic_table" ? question.tableColumns?.length ? question.tableColumns : ["Maklumat"] : question.tableColumns,
                    tableRows: question.tableRows ?? 2,
                  });
                }}>
                  <option value="qualitative">Kualitatif (Grading 1 - 5)</option><option value="qualitative_no_grade">Kualitatif (Tanpa gred)</option><option value="qualitative_with_note">Kualitatif (Gred &amp; Nota)</option><option value="qualitative_note_only">Kualitatif (Nota sahaja)</option><option value="qualitative_range">Skala kualitatif berasaskan julat</option><option value="objective">Objektif (pilihan tunggal, markah mengikut jawapan)</option><option value="dynamic_table">Jadual dinamik</option><option value="quantitative">Kuantitatif (Rekod sahaja)</option><option value="subjective">Subjektif (Pelbagai jawapan · Markah manual)</option><option value="subjective_single">Subjektif (Jawapan tunggal · Tiada markah)</option><option value="auto_calculated_financial">Kewangan (Dikira automatik)</option>
                </select>
                {question.type === "auto_calculated_financial" && renderFinancialEditor(question.id)}
              </td>
              <td><button className="question-delete-button" type="button" aria-label={`Padam soalan ${question.id}`} title={`Padam soalan ${question.id}`} onClick={() => onDeleteQuestion(item, question.id)}><Trash2 size={16} /></button></td>
            </tr>
            <tr className="question-details-row"><td colSpan={7}><div className={`question-details-fields ${usesNoteField(question.type) ? "has-note-prompt" : ""}`}>
              {usesNoteField(question.type) && <label className="question-note-prompt">Nota tambahan<input required aria-label={`Nota tambahan ${question.id}`} value={question.notePrompt ?? ""} onChange={(event) => onQuestionChange(item, question.id, { notePrompt: event.target.value })} /></label>}
              <label className="question-maximum-field">Markah maksimum{question.type === "quantitative" ? <span className="question-no-score">0 markah · rujukan sahaja</span> : question.isSurvey ? <span className="question-no-score">0 markah · tinjauan</span> : question.type === "subjective_single" ? <span className="question-no-score">Tiada markah</span> : <span className="maximum-input-wrap"><input aria-label={`Markah maksimum ${question.id}`} type="number" min="1" max="100000" step="0.01" value={question.max} readOnly={question.type === "objective"} onChange={(event) => onQuestionChange(item, question.id, { max: Number(event.target.value) })} /><span>markah</span></span>}</label>
            </div></td></tr>
            {question.type === "objective" && <tr className="question-objective-editor-row"><td colSpan={7}><ObjectiveOptionsEditor options={question.objectiveOptions ?? []} onChange={(objectiveOptions) => onQuestionChange(item, question.id, { objectiveOptions })} /></td></tr>}
            {question.type === "qualitative_range" && <tr className="question-range-editor-row"><td colSpan={7}><div className="question-range-editor">{(question.scoreRanges ?? []).map((range, index) => <div className="question-range-row" key={index}><label>Min<input type="number" value={range.min} onChange={(event) => onQuestionChange(item, question.id, { scoreRanges: (question.scoreRanges ?? []).map((current, itemIndex) => itemIndex === index ? { ...current, min: Number(event.target.value) } : current) })} /></label><label>Max<input type="number" value={range.max ?? ""} placeholder="Tiada had" onChange={(event) => onQuestionChange(item, question.id, { scoreRanges: (question.scoreRanges ?? []).map((current, itemIndex) => itemIndex === index ? { ...current, max: event.target.value === "" ? null : Number(event.target.value) } : current) })} /></label><label>Skala<input type="number" min="1" max="5" step="1" value={range.score} onChange={(event) => onQuestionChange(item, question.id, { scoreRanges: (question.scoreRanges ?? []).map((current, itemIndex) => itemIndex === index ? { ...current, score: Number(event.target.value) } : current) })} /></label><label>Perkara<input value={range.label} onChange={(event) => onQuestionChange(item, question.id, { scoreRanges: (question.scoreRanges ?? []).map((current, itemIndex) => itemIndex === index ? { ...current, label: event.target.value } : current) })} /></label>{(question.scoreRanges?.length ?? 0) > 1 && <button className="question-delete-button" type="button" aria-label={`Padam julat ${index + 1} ${question.id}`} onClick={() => onQuestionChange(item, question.id, { scoreRanges: (question.scoreRanges ?? []).filter((_, itemIndex) => itemIndex !== index) })}><Trash2 size={14} /></button>}</div>)}<button className="question-add-button topic-add-button" type="button" disabled={question.scoreRanges?.at(-1)?.max == null} onClick={() => onQuestionChange(item, question.id, { scoreRanges: appendQuestionScoreRange(question.scoreRanges ?? []) })}><Plus size={14} /> Tambah julat</button></div></td></tr>}
            {question.type === "dynamic_table" && <tr className="question-chained-editor-row"><td colSpan={7}><div className="question-table-settings"><label>Arahan jadual<textarea rows={2} value={question.tableInstruction ?? ""} onChange={(event) => onQuestionChange(item, question.id, { tableInstruction: event.target.value })} /></label><TableStructureFields columns={question.tableColumns?.length ? question.tableColumns : ["Maklumat"]} rows={question.tableRows ?? 2} onChange={(columns, rows) => onQuestionChange(item, question.id, { tableColumns: columns, tableRows: rows })} /></div></td></tr>}
            </Fragment>)}
            {questionDraft[item].length === 0 && <tr><td colSpan={7} className="question-empty-state">Tiada soalan dalam seksyen ini. Tambah soalan baharu untuk meneruskan.</td></tr>}
          </tbody></table></div>

          <footer className="question-section-footer"><span>Jumlah Soalan: <strong>{activeQuestions.length}</strong><i />Jumlah Markah Maksimum Seksyen: <strong>{sectionMarks(item)} Markah</strong></span></footer>
        </section>
      </TabsContent>)}
    </Tabs>
    <footer className="question-config-footer"><span className={Math.abs(draftWeightTotal - 100) < 0.001 ? "save-status-valid" : "save-status-invalid"}><i />{Math.abs(draftWeightTotal - 100) < 0.001 ? "Pemberat seksyen berjumlah 100%" : `Jumlah pemberat sekarang ${draftWeightTotal.toFixed(2)}%`}</span><button className="question-save-button" type="button" onClick={onSave} disabled={isSaving || Math.abs(draftWeightTotal - 100) >= 0.001}>{isSaving ? <><LoaderCircle className="question-spinner" size={17} /> Menyimpan...</> : <><Save size={17} /> Simpan Semua Perubahan</>}</button></footer>
    </>}
  </div>;
}

function MetricCard({ label, value, detail, accent, icon }: { label: string; value: string; detail: string; accent: string; icon: React.ReactNode }) {
  return <article className="metric-card"><div className="metric-top"><span>{label}</span><i className={`metric-icon metric-${accent}`}>{icon}</i></div><strong className="metric-value">{value}</strong><div className="metric-detail"><span>{detail}</span><ArrowUpRight size={14} /></div></article>;
}

function NameField({ id, label, value, onChange, readOnly = false }: { id: string; label: string; value: string; onChange: (value: string) => void; readOnly?: boolean }) {
  return <label className="field-label" htmlFor={id}>{label}<input id={id} value={value} placeholder="NAMA PENUH" readOnly={readOnly} onChange={(event) => onChange(event.target.value.toUpperCase())} /></label>;
}

function PhaseOneReport({ sectionCodes, sectionNames, blocks, sections, totalScore, blockCount }: { sectionCodes: Section[]; sectionNames: Record<Section, string>; blocks: RecordRow[]; sections: Record<Section, number>; totalScore: number; blockCount: number }) {
  return <section className="panel table-panel report-table ranch-report-table phase-one-report">
    <div className="table-toolbar"><div><h3>Ringkasan penilaian kendiri</h3><span>Markah seksyen dan jumlah dipaparkan sebagai peratus daripada SQL</span></div></div>
    <div className="table-scroll"><table><thead><tr><th>BLOK</th><th>DICATAT OLEH</th>{sectionCodes.map((section) => <th key={section}>{(sectionNames[section] ?? section).toUpperCase()} %</th>)}<th>JUMLAH WAJARAN %</th><th>STATUS</th></tr></thead>
      <tbody>{blocks.slice().sort((first, second) => first.block.localeCompare(second.block)).map((row) => {
        const rowSections = row.selfSectionScores ?? row.sections;
        return <tr key={row.id}><td><strong>{row.block}</strong></td><td>{row.recorderName || "—"}</td>{sectionCodes.map((section) => <td key={section}>{formatPercent(rowSections[section])}</td>)}<td><span className="total-score">{formatPercent(row.phaseScores?.[1])}</span></td><td><span className="report-state state-done">Telah Dihantar</span></td></tr>;
      })}</tbody>
      <tfoot><tr><th colSpan={2}>PURATA RANCANGAN · SQL</th>{sectionCodes.map((section) => <th key={section}>{formatPercent(sections[section])}</th>)}<th>{formatPercent(totalScore)}</th><th>{blockCount} blok</th></tr></tfoot>
    </table></div>
  </section>;
}

function PhaseTwoReport({ sectionCodes, sectionNames, blocks, blockCount, questionConfig, topicConfig, subtopicConfig, additionalTopicConfig, questionScoreDetails, jurorAssignments, jurors }: { sectionCodes: Section[]; sectionNames: Record<Section, string>; blocks: RecordRow[]; blockCount: number; questionConfig: Record<Section, Question[]>; topicConfig: Record<Section, Topic[]>; subtopicConfig: Record<Section, Subtopic[]>; additionalTopicConfig: Record<Section, AdditionalTopic[]>; questionScoreDetails: QuestionScoreDetail[]; jurorAssignments: JurorAssignment[]; jurors: JurorAccount[] }) {
  const SECTIONS = sectionCodes;
  const questionScoresByKey = new Map<string, number[]>();
  questionScoreDetails.forEach((score) => {
    if (score.phase !== 2 || score.score_percent == null) return;
    const key = `${score.ranch_name}/${score.block_number}/${score.question_code}`;
    questionScoresByKey.set(key, [...(questionScoresByKey.get(key) ?? []), score.score_percent]);
  });
  const averageQuestionScore = (ranchName: string, blockNumber: string, questionId: string) => {
    const scores = questionScoresByKey.get(`${ranchName}/${blockNumber}/${questionId}`);
    return scores?.length ? scores.reduce((sum, score) => sum + score, 0) / scores.length : null;
  };

  return <div className="phase-two-report">
    {blocks.slice().sort((first, second) => first.block.localeCompare(second.block)).map((row) => <section className="phase-two-block" key={row.id}>
      <header><div><span>RINGKASAN BLOK</span><h3>Blok {row.block}</h3></div><span className={`report-state ${row.phase2 ? "state-done" : "state-pending"}`}>{row.phase2 ? "Telah Selesai" : "Dalam Penilaian"}</span></header>
      <section className="panel table-panel report-table ranch-report-table"><div className="table-toolbar"><div><h4>Purata skor juri mengikut kategori</h4><span>Purata markah semua juri yang telah menghantar penilaian</span></div></div><div className="table-scroll"><table><thead><tr><th>KATEGORI</th><th>PURATA SKOR JURI %</th></tr></thead><tbody>{SECTIONS.map((section) => <tr key={section}><td><strong>{sectionNames[section] ?? section}</strong></td><td><span className="total-score">{formatPercent(row.sections[section])}</span></td></tr>)}</tbody><tfoot><tr><th>JUMLAH WAJARAN %</th><th>{formatPercent(row.phaseScores?.[2])}</th></tr></tfoot></table></div></section>
      {SECTIONS.map((section) => <details className="phase-two-detail" key={section}>
        <summary><div><h4>{sectionNames[section] ?? section}</h4><span>{questionConfig[section].length} soalan</span></div><div><span>{formatPercent(row.sections[section])}</span><ChevronDown size={16} aria-hidden="true" /></div></summary>
        <div className="table-scroll"><table><thead><tr><th>KOD</th><th>TOPIC</th><th>SUB-TOPIC</th><th>ADDITIONAL TOPIC</th><th>SOALAN</th><th>BASELINE FASA 1</th><th>JAWAPAN JURI</th><th>PURATA SKOR JURI %</th></tr></thead><tbody>{questionConfig[section].map((question) => {
          const baseline = row.selfAnswers?.[section] ?? {};
          const jurorResponses = jurorAssignments.filter((assignment) => assignment.topic_id === question.topicId).map((assignment) => ({
            name: jurors.find((juror) => juror.id === assignment.user_id)?.full_name || assignment.user_id,
            answer: juryAnswerLabel(question, row.juryAnswers?.[section]?.[assignment.assessor_slot - 1] ?? null, baseline),
          })).filter((response) => response.answer !== "—");
          const topic = topicConfig[section].find((item) => item.id === question.topicId);
          const subtopic = subtopicConfig[section].find((item) => item.id === question.subtopicId);
          const additionalTopic = additionalTopicConfig[section].find((item) => item.id === question.additionalTopicId);
          return <tr key={question.id}><td>{question.id}</td><td>{topic?.name ?? "—"}</td><td>{subtopic?.name ?? "—"}</td><td>{additionalTopic?.name ?? "—"}</td><td>{question.text}</td><td>{selfAnswerLabel(question, baseline)}</td><td>{jurorResponses.map((response) => <div key={response.name}><strong>{response.name}</strong>: {response.answer}</div>)}</td><td>{formatPercent(averageQuestionScore(row.ranch, row.block, question.id))}</td></tr>;
        })}</tbody></table></div>
      </details>)}
    </section>)}
    {!blocks.length && <section className="panel empty-state">Belum ada jawapan Fasa 2 untuk rancangan ini.</section>}
    {!!blocks.length && <div className="table-bottom">{blockCount} blok lengkap Fasa 2 mengikut kiraan SQL.</div>}
  </div>;
}
type TopicContentEditorProps = {
  section: Section;
  topic: Topic;
  index: number;
  canDeleteTopic: boolean;
  questions: Question[];
  subtopics: Subtopic[];
  additionalTopics: AdditionalTopic[];
  onTopicRename: (section: Section, id: string, name: string) => void;
  onTopicMarksChange: (section: Section, id: string, maxMarks: number | null) => void;
  onTopicBlockBasedChange: (section: Section, id: string, blockBased: boolean) => void;
  onDeleteTopic: (section: Section, id: string) => void;
  onSubtopicRename: (section: Section, id: string, name: string) => void;
  onAddSubtopic: (section: Section, topicId: string, name: string) => void;
  onDeleteSubtopic: (section: Section, id: string) => void;
  onAdditionalTopicRename: (section: Section, id: string, name: string) => void;
  onAddAdditionalTopic: (section: Section, subtopicId: string, name: string) => void;
  onDeleteAdditionalTopic: (section: Section, id: string) => void;
  onRequestAddQuestion: (topicId: string, subtopicId: string | null, additionalTopicId?: string | null) => void;
  onMoveTopicContent: (section: Section, topicId: string, kind: "question" | "subtopic", id: string, direction: -1 | 1) => void;
  onMoveSubtopicQuestion: (section: Section, subtopicId: string, questionId: string, direction: -1 | 1, additionalTopicId?: string | null) => void;
  onMoveSubtopicContent: (section: Section, subtopicId: string, kind: "question" | "additionalTopic", id: string, direction: -1 | 1) => void;
};

function TopicContentEditor({
  section, topic, index, canDeleteTopic, questions, subtopics, additionalTopics, onTopicRename, onTopicMarksChange, onTopicBlockBasedChange,
  onDeleteTopic, onSubtopicRename, onAddSubtopic, onDeleteSubtopic, onAdditionalTopicRename, onAddAdditionalTopic, onDeleteAdditionalTopic, onRequestAddQuestion,
  onMoveTopicContent, onMoveSubtopicQuestion, onMoveSubtopicContent,
}: TopicContentEditorProps) {
  const [addingSubtopic, setAddingSubtopic] = useState(false);
  const [subtopicName, setSubtopicName] = useState("");
  const [addingAdditionalTopic, setAddingAdditionalTopic] = useState<string | null>(null);
  const [additionalTopicName, setAdditionalTopicName] = useState("");
  const directQuestions = questions.filter((question) => question.subtopicId === null);
  const content = [
    ...directQuestions.map((question) => ({ kind: "question" as const, id: question.id, order: question.displayOrder, question })),
    ...subtopics.map((subtopic) => ({ kind: "subtopic" as const, id: subtopic.id, order: subtopic.sortOrder, subtopic })),
  ].sort((first, second) => first.order - second.order);

  function createSubtopic(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!subtopicName.trim()) return;
    onAddSubtopic(section, topic.id, subtopicName);
    setSubtopicName("");
    setAddingSubtopic(false);
  }

  function createAdditionalTopic(event: React.FormEvent<HTMLFormElement>, subtopicId: string) {
    event.preventDefault();
    if (!additionalTopicName.trim()) return;
    onAddAdditionalTopic(section, subtopicId, additionalTopicName);
    setAdditionalTopicName("");
    setAddingAdditionalTopic(null);
  }

  return <article className="topic-config-card" aria-label={`Topic ${topic.name}`}>
    <div className="topic-config-heading">
      <span className="topic-index">{String(index + 1).padStart(2, "0")}</span>
      <label>Topic name<input aria-label={`Topic name ${index + 1}`} value={topic.name} onChange={(event) => onTopicRename(section, topic.id, event.target.value)} /></label>
      <span className="topic-question-count">{questions.length} questions</span>
      <label className="topic-marks">Topic marks<input aria-label={`Topic marks ${topic.name}`} type="number" min="0" max="1000" step="0.01" placeholder={String(questions.reduce((sum, question) => sum + (question.type === "subjective_single" || question.type === "quantitative" ? 0 : Number(question.max) || 0), 0))} value={topic.maxMarks ?? ""} onChange={(event) => onTopicMarksChange(section, topic.id, event.target.value === "" ? null : Number(event.target.value))} /></label>
      {canDeleteTopic && <button className="question-delete-button" type="button" aria-label={`Archive Topic ${topic.name}`} onClick={() => onDeleteTopic(section, topic.id)}><Trash2 size={15} /></button>}
    </div>
    <label className="section-block-setting"><input type="checkbox" checked={topic.blockBased} onChange={(event) => onTopicBlockBasedChange(section, topic.id, event.target.checked)} /><span><strong>Topik ini dinilai mengikut blok</strong><small>{topic.blockBased ? "Penilaian dan markah disimpan berasingan bagi setiap blok." : "Dinilai sekali dan dikongsi merentas semua blok dalam rancangan."}</small></span></label>
    <div className="topic-content-list">
      {content.map((item, position) => item.kind === "question"
        ? <div className="topic-content-row direct-question" key={`question:${item.id}`}>
          <span><strong>{item.question.id}</strong> · {item.question.text}</span>
          <div className="topic-order-actions"><button type="button" disabled={position === 0} onClick={() => onMoveTopicContent(section, topic.id, "question", item.id, -1)}>Up</button><button type="button" disabled={position === content.length - 1} onClick={() => onMoveTopicContent(section, topic.id, "question", item.id, 1)}>Down</button></div>
        </div>
        : <section className="topic-content-row subtopic-content" key={`subtopic:${item.id}`}>
          <header><label>Sub-topic<input aria-label={`Sub-topic name ${item.subtopic.name}`} value={item.subtopic.name} onChange={(event) => onSubtopicRename(section, item.id, event.target.value)} /></label>
            <div className="topic-order-actions"><button type="button" disabled={position === 0} onClick={() => onMoveTopicContent(section, topic.id, "subtopic", item.id, -1)}>Up</button><button type="button" disabled={position === content.length - 1} onClick={() => onMoveTopicContent(section, topic.id, "subtopic", item.id, 1)}>Down</button><button type="button" onClick={() => onDeleteSubtopic(section, item.id)}>Remove</button></div>
          </header>
          {(() => {
            const subtopicQuestions = questions.filter((question) => question.subtopicId === item.id);
            const subtopicContent = [
              ...subtopicQuestions.filter((question) => !question.additionalTopicId).map((question) => ({ kind: "question" as const, id: question.id, order: question.sortOrder, question })),
              ...additionalTopics.filter((additionalTopic) => additionalTopic.subtopicId === item.id).map((additionalTopic) => ({ kind: "additionalTopic" as const, id: additionalTopic.id, order: additionalTopic.sortOrder, additionalTopic })),
            ].sort((first, second) => first.order - second.order);
            return <div className="subtopic-question-list">
              {subtopicContent.map((contentItem, contentIndex) => contentItem.kind === "question"
                ? <div key={`question:${contentItem.id}`}>
                  <span><strong>{contentItem.question.id}</strong> · {contentItem.question.text}</span>
                  <div className="topic-order-actions"><button type="button" disabled={contentIndex === 0} onClick={() => onMoveSubtopicContent(section, item.id, "question", contentItem.id, -1)}>Up</button><button type="button" disabled={contentIndex === subtopicContent.length - 1} onClick={() => onMoveSubtopicContent(section, item.id, "question", contentItem.id, 1)}>Down</button></div>
                </div>
                : <section className="additional-topic-content" key={`additional:${contentItem.id}`}>
                  <header><label>Additional Topic<input aria-label={`Additional Topic name ${contentItem.additionalTopic.name}`} value={contentItem.additionalTopic.name} onChange={(event) => onAdditionalTopicRename(section, contentItem.id, event.target.value)} /></label>
                    <div className="topic-order-actions"><button type="button" disabled={contentIndex === 0} onClick={() => onMoveSubtopicContent(section, item.id, "additionalTopic", contentItem.id, -1)}>Up</button><button type="button" disabled={contentIndex === subtopicContent.length - 1} onClick={() => onMoveSubtopicContent(section, item.id, "additionalTopic", contentItem.id, 1)}>Down</button><button type="button" onClick={() => onDeleteAdditionalTopic(section, contentItem.id)}>Remove</button></div>
                  </header>
                  {subtopicQuestions.filter((question) => question.additionalTopicId === contentItem.id).sort((first, second) => first.sortOrder - second.sortOrder).map((question, questionIndex, items) => <div key={question.id}>
                    <span><strong>{question.id}</strong> · {question.text}</span>
                    <div className="topic-order-actions"><button type="button" disabled={questionIndex === 0} onClick={() => onMoveSubtopicQuestion(section, item.id, question.id, -1, contentItem.id)}>Up</button><button type="button" disabled={questionIndex === items.length - 1} onClick={() => onMoveSubtopicQuestion(section, item.id, question.id, 1, contentItem.id)}>Down</button></div>
                  </div>)}
                  {!subtopicQuestions.some((question) => question.additionalTopicId === contentItem.id) && <span className="question-empty-state">No questions in this Additional Topic yet.</span>}
                  <button className="question-add-button topic-add-button" type="button" onClick={() => onRequestAddQuestion(topic.id, item.id, contentItem.id)}><Plus size={14} /> Add Question</button>
                </section>)}
              {!subtopicContent.length && <span className="question-empty-state">No questions or Additional Topics yet.</span>}
            </div>;
          })()}
          <div className="subtopic-content-actions">
            <button className="question-add-button topic-add-button" type="button" onClick={() => onRequestAddQuestion(topic.id, item.id)}><Plus size={14} /> Add Question to Sub-topic</button>
            <button className="question-add-button topic-add-button" type="button" onClick={() => setAddingAdditionalTopic((current) => current === item.id ? null : item.id)}><Plus size={14} /> Add Additional Topic</button>
          </div>
          {addingAdditionalTopic === item.id && <form className="subtopic-add-form" onSubmit={(event) => createAdditionalTopic(event, item.id)}>
            <label>Additional Topic name<input required maxLength={200} value={additionalTopicName} onChange={(event) => setAdditionalTopicName(event.target.value)} /></label>
            <button className="question-add-button" type="submit"><Plus size={14} /> Add Additional Topic</button>
          </form>}
        </section>)}
      {!content.length && <p className="question-empty-state">No questions or Sub-topics yet.</p>}
    </div>
    <div className="topic-content-actions">
      <button className="question-add-button" type="button" onClick={() => onRequestAddQuestion(topic.id, null)}><Plus size={14} /> Add Question</button>
      <button className="question-add-button topic-add-button" type="button" onClick={() => setAddingSubtopic((current) => !current)}><Plus size={14} /> Add Sub-topic</button>
    </div>
    {addingSubtopic && <form className="subtopic-add-form" onSubmit={createSubtopic}>
      <label>Sub-topic name<input required maxLength={200} value={subtopicName} onChange={(event) => setSubtopicName(event.target.value)} /></label>
      <button className="question-add-button" type="submit"><Plus size={14} /> Add Sub-topic</button>
    </form>}
  </article>;
}

function TableStructureFields({ columns, rows, onChange }: { columns: string[]; rows: number; onChange: (columns: string[], rows: number) => void }) {
  return <div className="question-table-structure">
    <label>Bilangan baris (ditetapkan admin, pengguna tidak boleh ubah)<input required type="number" min="1" max="50" step="1" value={rows} onChange={(event) => onChange(columns, Number(event.target.value))} /></label>
    {columns.map((column, index) => <div className="question-range-row" key={index}><label>Tajuk lajur {index + 2}<input required aria-label={`Tajuk lajur ${index + 2}`} value={column} onChange={(event) => onChange(columns.map((item, itemIndex) => itemIndex === index ? event.target.value : item), rows)} /></label>{columns.length > 1 && <button className="question-delete-button" type="button" aria-label={`Padam lajur ${index + 2}`} onClick={() => onChange(columns.filter((_, itemIndex) => itemIndex !== index), rows)}><Trash2 size={14} /></button>}</div>)}
    <button className="question-add-button topic-add-button" type="button" disabled={columns.length >= 10} onClick={() => onChange([...columns, `Lajur ${columns.length + 2}`], rows)}><Plus size={14} /> Tambah lajur</button>
  </div>;
}