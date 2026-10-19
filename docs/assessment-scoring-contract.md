# Assessment scoring contract

This document describes the scoring behavior shared by `src/lib/scoring.mjs` and the
PostgreSQL assessment views/functions in `supabase/app-schema.sql`. The database is
authoritative for saved assessment scores and rankings; the JavaScript module is the
reference implementation for previews and unit tests.

## Score units and aggregation

- A question's `max` / `max_score` is its maximum mark unless it is a survey,
  `subjective_single`, or quantitative reference question, which contributes zero
  marks and weight.
- A topic's scoring maximum is its configured `maxMarks` when it contains at least
  one scored question. Otherwise it is the sum of the scored question maxima.
- A topic with a zero maximum contributes zero earned marks and zero maximum marks.
- Earned question marks are summed, then scaled proportionally if the topic maximum
  differs from the sum of its question maxima. Earned topic marks cannot exceed the
  topic maximum.
- A section is the sum of its topics. Its percentage is `earned / maximum * 100`;
  an empty or zero-maximum section has a percentage of zero.
- Section weightage is each section's scoring maximum divided by the total scoring
  maximum across sections. If there is no scoring maximum, every section weight is
  zero. The editor displays derived section percentages rounded to two decimal
  places; scoring uses the unrounded ratios.
- Overall percentage is the sum of each section percentage multiplied by its
  derived section weight. Weights are not separately configured or persisted.

## Question scoring

- **Qualitative (graded):** `Ya` earns `selected grade / 5 * max`; other answers earn
  zero. **Qualitative without grade / note only:** `Ya` earns `max`, otherwise zero.
- **Qualitative range:** only `Ya` is scored; the first configured inclusive range
  containing the numeric answer supplies a score from 1 to 5, scaled by `max / 5`.
- **Objective:** the selected option's configured score is awarded.
- **Quantitative:** a non-negative whole-number answer is recorded for reference
  only. It has no total/denominator, earns no marks, and does not affect topic or
  section weights. Phase two displays the phase-one value read-only.
- **Subjective / dynamic table:** phase one records the response but does not score
  it. Phase two uses manual marks, clamped to 0 through the question maximum.
- **Financial:** the shared financial evaluator determines the 1–5 score; the
  configured question maximum scales that score.
- **Survey / single-answer subjective:** response is retained where applicable but
  contributes no score or weight.

## Phase and multi-assessor rules

- Phase one scores use the submitted ranch response.
- Phase two scores are calculated for each assigned assessor slot and normalized
  against that slot's maximum. The section's jury score combines available
  assessors according to the database aggregation rules; incomplete slots do not
  create a score.
- Shared (non-block-based) topics and shared mosque submissions retain their
  existing submission and synchronization rules; this contract changes only score
  calculation.

## Change and rollout rules

1. Update this contract and `src/lib/scoring.mjs` together.
2. Add or update unit tests for both edge cases and boundary values.
3. Keep the PostgreSQL helper, score-refresh function, submission validation, and
   score views semantically aligned with the JavaScript implementation.
4. Apply numbered SQL migrations in order. The quantitative reference-only
   migration clears legacy totals and chained settings, updates submission
   validation, and refreshes phase-two scores.
5. Compare representative phase-one, phase-two, quantitative reference-only,
   zero-mark, and multi-assessor records before deploying the UI that depends on
   a new scoring contract.
