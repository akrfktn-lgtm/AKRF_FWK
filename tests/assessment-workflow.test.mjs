import test from "node:test";
import assert from "node:assert/strict";
import { isPhaseComplete, isSubmissionLocked } from "../src/lib/assessment-workflow.mjs";

const phaseOneSubmissions = [
  { ranch_name: "Jengka 24", block_number: "01", phase: 1, assessor_slot: 1, topic_id: "ladang-1", status: "submitted" },
  { ranch_name: "Jengka 24", block_number: "01", phase: 1, assessor_slot: 1, topic_id: "ladang-2", status: "reopened" },
];

test("phase one completes only when every topic is submitted", () => {
  assert.equal(isPhaseComplete("Jengka 24", "01", 1, ["ladang-1"], phaseOneSubmissions, []), true);
  assert.equal(isPhaseComplete("Jengka 24", "01", 1, ["ladang-1", "ladang-2"], phaseOneSubmissions, []), false);
});

test("phase two completes only after every assigned juror submits", () => {
  const assignments = [
    { topic_id: "ladang-1", assessor_slot: 1 },
    { topic_id: "ladang-1", assessor_slot: 2 },
    { topic_id: "ladang-1", assessor_slot: 3 },
  ];
  const oneSubmission = [{ ranch_name: "Jengka 24", block_number: "01", phase: 2, assessor_slot: 1, topic_id: "ladang-1", status: "submitted" }];
  assert.equal(isPhaseComplete("Jengka 24", "01", 2, ["ladang-1"], oneSubmission, assignments), false);
  const twoSubmissions = [...oneSubmission, { ...oneSubmission[0], assessor_slot: 2 }];
  assert.equal(isPhaseComplete("Jengka 24", "01", 2, ["ladang-1"], twoSubmissions, assignments), false);
  assert.equal(isPhaseComplete("Jengka 24", "01", 2, ["ladang-1"], [...twoSubmissions, { ...oneSubmission[0], assessor_slot: 3 }], assignments), true);
});

test("unassigned topics do not block phase two, but at least one topic must be assigned", () => {
  const assignments = [{ topic_id: "ladang-1", assessor_slot: 1 }];
  const submissions = [{ ranch_name: "Jengka 24", block_number: "01", phase: 2, assessor_slot: 1, topic_id: "ladang-1", status: "submitted" }];
  assert.equal(isPhaseComplete("Jengka 24", "01", 2, ["ladang-1", "ladang-2"], submissions, assignments), true);
  assert.equal(isPhaseComplete("Jengka 24", "01", 2, ["ladang-1", "ladang-2"], [], []), false);
  assert.equal(isPhaseComplete("Jengka 24", "01", 2, ["ladang-1", "ladang-2"], submissions, []), false);
});

test("reopened submissions are not locked and cannot complete a phase", () => {
  const reopened = [{ ranch_name: "Jengka 24", block_number: "01", phase: 1, assessor_slot: 1, topic_id: "ladang-1", status: "reopened" }];
  assert.equal(isSubmissionLocked("Jengka 24", "01", 1, 1, "ladang-1", reopened), false);
  assert.equal(isPhaseComplete("Jengka 24", "01", 1, ["ladang-1"], reopened, []), false);
});
