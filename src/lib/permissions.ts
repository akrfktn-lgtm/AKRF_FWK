import type { ProfileRole } from "./supabase";

export function canAssessPhaseOne(role: ProfileRole) {
  return role === "rancangan" || role === "developer";
}

export function canAssessPhaseTwo(role: ProfileRole) {
  return role === "juri" || role === "super_user" || role === "developer";
}

export function canManageSystem(role: ProfileRole) {
  return role === "developer";
}

export function canUnlockQuestions(role: ProfileRole) {
  return role === "super_user" || role === "developer";
}

export function canReopenSubmissions(role: ProfileRole) {
  return role === "super_user" || role === "developer";
}

export function canExportReports(role: ProfileRole) {
  return canAssessPhaseTwo(role);
}

export function canEditQuestion(question: { is_locked: boolean; unlocked?: boolean }) {
  return !question.is_locked || question.unlocked === true;
}
