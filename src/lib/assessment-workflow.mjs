/**
 * @param {string} ranch
 * @param {string} block
 * @param {1 | 2} phase
 * @param {string[]} topicIds
 * @param {Array<{ ranch_name: string, block_number: string, phase: number, assessor_slot: number, topic_id: string, status: string }>} submissions
 * @param {Array<{ topic_id: string, assessor_slot: number }>} assignments
 */
export function isPhaseComplete(ranch, block, phase, topicIds, submissions, assignments) {
  if (!topicIds.length) return false;
  const requiredTopics = topicIds.filter((topicId) => phase === 1
    || assignments.some((assignment) => assignment.topic_id === topicId));
  if (!requiredTopics.length) return false;
  return requiredTopics.every((topicId) => {
    const slots = phase === 1
      ? [1]
      : assignments.filter((assignment) => assignment.topic_id === topicId).map((assignment) => assignment.assessor_slot);
    return slots.every((slot) => submissions.some((submission) => submission.ranch_name === ranch
      && submission.block_number === block && submission.phase === phase && submission.assessor_slot === slot
      && submission.topic_id === topicId && submission.status === "submitted"));
  });
}

/**
 * @param {string} ranch
 * @param {string} block
 * @param {1 | 2} phase
 * @param {number} slot
 * @param {string} topicId
 * @param {Array<{ ranch_name: string, block_number: string, phase: number, assessor_slot: number, topic_id: string, status: string }>} submissions
 */
export function isSubmissionLocked(ranch, block, phase, slot, topicId, submissions) {
  return submissions.some((submission) => submission.ranch_name === ranch
    && submission.block_number === block && submission.phase === phase && submission.assessor_slot === slot
    && submission.topic_id === topicId && submission.status === "submitted");
}
