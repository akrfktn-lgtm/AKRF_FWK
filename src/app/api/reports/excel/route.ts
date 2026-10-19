import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import ExcelJS from "exceljs";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

type QuestionRow = {
  code: string;
  section: string;
  topic_name: string;
  prompt: string;
  question_type: string;
  max_score: number;
  is_survey: boolean;
  objective_options: { id: string; label: string; score: number }[] | null;
  score_ranges: { min: number; max: number | null; score: number }[] | null;
  scoring_parent_code: string | null;
  scoring_direction: "higher-is-better" | "lower-is-better" | null;
  percentage_thresholds: { min: number; max: number | null; score: number }[] | null;
};

type AnswerRow = {
  ranch_name: string;
  block_number: string;
  phase: number;
  assessor_slot: number;
  question_code: string;
  response: Record<string, string> | null;
  recorder_name: string;
};

type SubmissionBlock = { block_number: string; phase: number };

function scoreFor(question: QuestionRow, answer: Record<string, string> | null, phase: 1 | 2) {
  if (question.is_survey || question.question_type === "subjective_single" || !answer) return 0;
  const response = answer[question.code] ?? "";
  if (question.question_type === "objective") {
    return question.objective_options?.find((option) => option.id === response)?.score ?? 0;
  }
  if (question.question_type === "subjective" || question.question_type === "dynamic_table") {
    return phase === 2 ? Math.min(Number(question.max_score), Math.max(0, Number(response) || 0)) : 0;
  }
  if (question.question_type === "quantitative") {
    return 0;
  }
  if (question.question_type === "qualitative_no_grade" || question.question_type === "qualitative_note_only") {
    return answer[`${question.code}-yn`] === "Ya" ? Number(question.max_score) : 0;
  }
  if (answer[`${question.code}-yn`] !== "Ya") return 0;
  const grade = Number(response);
  if (question.question_type === "qualitative_range") {
    const range = question.score_ranges?.find((item) => Number(response) >= item.min && (item.max == null || Number(response) <= item.max));
    return range ? Number(range.score) / 5 * Number(question.max_score) : 0;
  }
  return Number.isFinite(grade) ? grade / 5 * Number(question.max_score) : 0;
}

function copyCellStyle(source: ExcelJS.Worksheet, target: ExcelJS.Worksheet, row: number, columns: number) {
  for (let column = 1; column <= columns; column += 1) {
    target.getCell(row, column).style = structuredClone(source.getCell(7, column).style);
  }
}

export async function POST(request: Request) {
  const authorization = request.headers.get("authorization");
  const token = authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    ?? process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!token || !supabaseUrl || !supabaseKey) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  const client = createClient(supabaseUrl, supabaseKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data: authData, error: authError } = await client.auth.getUser(token);
  if (authError || !authData.user) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }
  const { data: profile, error: profileError } = await client
    .from("profiles")
    .select("role")
    .eq("id", authData.user.id)
    .single();
  if (profileError) {
    return NextResponse.json({ error: "Unable to verify report permissions." }, { status: 403 });
  }
  if (!["juri", "super_user", "developer"].includes(profile.role)) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  let ranchName: unknown;
  try {
    ({ ranchName } = await request.json());
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }
  if (typeof ranchName !== "string" || ranchName.trim().length === 0 || ranchName.length > 200) {
    return NextResponse.json({ error: "A valid ranch name is required." }, { status: 400 });
  }
  const validatedRanchName = ranchName.trim();

  const [questionResult, answerResult, submissionResult] = await Promise.all([
    client.from("questions")
      .select("code, section, topic_name, prompt, question_type, max_score, is_survey, objective_options, score_ranges, scoring_parent_code, scoring_direction, percentage_thresholds")
      .eq("active", true)
      .order("sort_order"),
    client.from("answers")
      .select("ranch_name, block_number, phase, assessor_slot, question_code, response, recorder_name")
      .eq("ranch_name", validatedRanchName)
      .in("phase", [1, 2])
      .order("block_number")
      .order("phase")
      .order("assessor_slot"),
    client.from("assessment_submissions")
      .select("block_number, phase")
      .eq("ranch_name", validatedRanchName)
      .eq("phase", 1)
      .eq("status", "submitted"),
  ]);
  const queryError = questionResult.error ?? answerResult.error ?? submissionResult.error;
  if (queryError) {
    return NextResponse.json({ error: `Unable to load report data: ${queryError.message}` }, { status: 500 });
  }

  const workbook = new ExcelJS.Workbook();
  const templatePath = path.join(process.cwd(), "public", "templates", "report_template.xlsx");
  try {
    await workbook.xlsx.readFile(templatePath);
  } catch (error) {
    return NextResponse.json({
      error: `Unable to load Excel template: ${error instanceof Error ? error.message : "Unknown error."}`,
    }, { status: 500 });
  }
  const templateSheet = workbook.worksheets[0];
  if (!templateSheet) {
    return NextResponse.json({ error: "The Excel template has no worksheets." }, { status: 500 });
  }

  const phaseOneSheet = workbook.addWorksheet("Penilaian Fasa 1");
  const phaseTwoSheet = workbook.addWorksheet("Penilaian Fasa 2");
  workbook.worksheets.forEach((sheet, index) => Object.assign(sheet, {
    orderNo: sheet === phaseOneSheet ? 1 : sheet === phaseTwoSheet ? 2 : index + 3,
  }));

  const questions = (questionResult.data ?? []) as QuestionRow[];
  const answers = (answerResult.data ?? []) as AnswerRow[];
  const submittedBlocks = new Set(((submissionResult.data ?? []) as SubmissionBlock[]).map((submission) => submission.block_number));
  const answerKey = (answer: AnswerRow) => `${answer.block_number}\u0000${answer.question_code}`;
  const phaseOneAnswers = new Map(answers.filter((answer) => answer.phase === 1).map((answer) => [answerKey(answer), answer]));
  const columns = ["Bil.", "Rancangan", "Blok", "Seksyen", "Topik", "Kod Soalan", "Soalan", "Jawapan", "Markah", "Markah Maksimum", "Penilai"];
  const widths = [7, 24, 10, 18, 26, 16, 56, 38, 12, 18, 14];

  function prepareSheet(sheet: ExcelJS.Worksheet, title: string) {
    sheet.properties = { ...templateSheet.properties };
    sheet.pageSetup = { ...templateSheet.pageSetup, orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 };
    sheet.views = [{ state: "frozen", ySplit: 4 }];
    widths.forEach((width, index) => { sheet.getColumn(index + 1).width = width; });
    sheet.mergeCells(1, 1, 1, columns.length);
    sheet.getCell(1, 1).value = title;
    sheet.getCell(1, 1).font = { name: "Arial", size: 16, bold: true, color: { argb: "FFFFFFFF" } };
    sheet.getCell(1, 1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF365E42" } };
    sheet.getRow(1).height = 28;
    sheet.getCell(2, 1).value = `RANCANGAN: ${validatedRanchName}`;
    sheet.getCell(2, 1).font = { name: "Arial", size: 11, bold: true };
    sheet.getRow(4).values = [undefined, ...columns];
    copyCellStyle(templateSheet, sheet, 4, columns.length);
    sheet.getRow(4).font = { name: "Arial", size: 10, bold: true, color: { argb: "FFFFFFFF" } };
    sheet.getRow(4).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF365E42" } };
    sheet.getRow(4).height = 32;
  }

  function appendData(sheet: ExcelJS.Worksheet, phase: 1 | 2) {
    let rowNumber = 5;
    let rowIndex = 1;
    for (const question of questions) {
      if (question.is_survey) {
        for (const blockNumber of submittedBlocks) {
            const baseline = phaseOneAnswers.get(`${blockNumber}\u0000${question.code}`);
            writeRow(sheet, rowNumber++, rowIndex++, validatedRanchName, blockNumber, question, baseline?.response ?? null, phase, 0);
        }
        continue;
      }
      const questionAnswers = answers.filter((answer) => answer.question_code === question.code
        && answer.ranch_name === validatedRanchName
        && (phase === 1 ? answer.phase === 1 : answer.phase === 2));
      for (const answer of questionAnswers) {
        writeRow(sheet, rowNumber++, rowIndex++, validatedRanchName, answer.block_number, question, answer.response, phase, answer.assessor_slot);
      }
    }
  }

  function writeRow(
    sheet: ExcelJS.Worksheet,
    rowNumber: number,
    index: number,
    name: string,
    blockNumber: string,
    question: QuestionRow,
    response: Record<string, string> | null,
    phase: 1 | 2,
    assessorSlot: number,
  ) {
    const row = sheet.getRow(rowNumber);
    const printableResponse = Object.entries(response ?? {})
      .filter(([key]) => key === question.code || key === `${question.code}-yn` || key === `${question.code}-note`)
      .map(([key, entry]) => `${key === `${question.code}-yn` ? "Ya/Tidak" : key === `${question.code}-note` ? "Nota" : "Jawapan"}: ${entry}`)
      .join("\n");
    const maxScore = question.is_survey || question.question_type === "subjective_single" || question.question_type === "quantitative" ? 0 : Number(question.max_score);
    row.values = [
      undefined, index, name, blockNumber, question.section, question.topic_name,
      question.code, question.prompt, printableResponse, question.is_survey ? 0 : scoreFor(question, response, phase),
      maxScore, phase === 2 && assessorSlot > 0 ? `Juri ${assessorSlot}` : "",
    ];
    copyCellStyle(templateSheet, sheet, rowNumber, columns.length);
    row.height = 32;
    row.getCell(7).alignment = { wrapText: true, vertical: "top" };
    row.getCell(8).alignment = { wrapText: true, vertical: "top" };
    row.getCell(9).alignment = { vertical: "top", horizontal: "right" };
    row.getCell(10).alignment = { vertical: "top", horizontal: "right" };
  }

  prepareSheet(phaseOneSheet, "PENILAIAN FASA 1");
  prepareSheet(phaseTwoSheet, "PENILAIAN FASA 2");
  appendData(phaseOneSheet, 1);
  appendData(phaseTwoSheet, 2);

  const buffer = await workbook.xlsx.writeBuffer();
  return new NextResponse(buffer, {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="penilaian-${encodeURIComponent(validatedRanchName)}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}
