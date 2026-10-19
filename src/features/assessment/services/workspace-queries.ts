import { fetchAllRows } from "../../../lib/paginated-query.mjs";

type AssessmentSupabaseClient = NonNullable<typeof import("../../../lib/supabase").supabase>;

async function loadSectionSettings(client: AssessmentSupabaseClient) {
  const result = await client.from("sections")
    .select("code, name, weight, sort_order, guidance_note, icon_code")
    .eq("active", true)
    .order("sort_order");
  return result;
}

export function loadFinancialSettings(client: AssessmentSupabaseClient) {
  return Promise.all([
    client.from("financial_line_items").select("id, question_code, label, kind").eq("active", true).order("sort_order").order("created_at"),
    client.from("financial_score_thresholds").select("id, min_percent, max_percent, score").order("min_percent"),
  ]);
}

export async function loadAssessmentWorkspace(client: AssessmentSupabaseClient, userId: string) {
  const configurationVersionBefore = await client.rpc("get_assessment_configuration_version");
  const results = await Promise.all([
    client.from("profiles").select("full_name, role").eq("id", userId).single(),
    client.from("ranches").select("name, manager_name, mosque_name").eq("active", true).order("name"),
    loadSectionSettings(client),
    client.from("topics").select("id, section_code, name, sort_order, max_marks, block_based").eq("active", true).order("sort_order"),
    client.from("subtopics").select("id, topic_id, name, sort_order").eq("active", true).order("sort_order"),
    client.from("additional_topics").select("id, subtopic_id, name, sort_order").eq("active", true).order("sort_order"),
    client.from("questions").select("code, section, topic_id, subtopic_id, additional_topic_id, topic_name, prompt, question_type, max_score, is_survey, is_locked, note_prompt, score_ranges, scoring_parent_code, scoring_direction, percentage_thresholds, objective_options, table_instruction, table_columns, table_rows, sort_order, display_order").eq("active", true).order("sort_order"),
    fetchAllRows((from: number, to: number) => client.from("answers")
      .select("user_id, question_code, ranch_name, block_number, phase, assessor_slot, recorder_name, response, submitted_at")
      .order("submitted_at").range(from, to)),
    fetchAllRows((from: number, to: number) => client.from("assessment_submissions")
      .select("id, user_id, ranch_name, block_number, phase, assessor_slot, topic_id, status, revision, configuration_version")
      .order("submitted_at").range(from, to)),
    client.from("juror_topic_assignments").select("user_id, topic_id, assessor_slot"),
    client.from("assessment_section_scores").select("ranch_name, block_number, section_code, jury_1_score, jury_2_score, section_score"),
    client.from("assessment_phase_block_scores").select("phase, ranch_name, block_number, section_code, section_score, jury_1_score, jury_2_score"),
    client.from("assessment_ranch_scores").select("phase, ranch_name, block_count, ladang_score, kampung_score, masjid_score, keceriaan_score, overall_score, phase2_block_count, ranking_position, section_scores"),
    client.from("assessment_phase_block_totals").select("phase, ranch_name, block_number, overall_score"),
    client.from("assessment_regional_scores").select("phase, average_score, block_count"),
    fetchAllRows((from: number, to: number) => client.from("assessment_question_scores")
      .select("phase, ranch_name, block_number, question_code, assessor_slot, score_percent")
      .order("ranch_name").order("block_number").order("question_code").range(from, to)),
    client.from("assessment_submission_events").select("id, submission_id, actor_id, event_type, reason, snapshot, created_at").order("created_at", { ascending: false }).limit(100),
    client.from("profiles").select("id, full_name").in("role", ["juri", "super_user"]).order("full_name"),
  ]);
  const configurationVersionAfter = await client.rpc("get_assessment_configuration_version");
  return [...results, configurationVersionBefore, configurationVersionAfter] as const;
}
