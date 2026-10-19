import test from "node:test";
import assert from "node:assert/strict";
import { orderedTopicContent } from "../src/lib/assessment-structure.mjs";

test("orders direct questions, sub-topics, and optional Additional Topics", () => {
  const content = orderedTopicContent(
    [{ id: "topic-1" }],
    [{ id: "subtopic-1", topicId: "topic-1", name: "Sub-topic", sortOrder: 2 }],
    [
      { id: "q1", topicId: "topic-1", subtopicId: null, sortOrder: 1, displayOrder: 1 },
      { id: "q2", topicId: "topic-1", subtopicId: "subtopic-1", additionalTopicId: null, sortOrder: 1 },
      { id: "q3", topicId: "topic-1", subtopicId: "subtopic-1", additionalTopicId: "additional-1", sortOrder: 1 },
    ],
    [{ id: "additional-1", subtopicId: "subtopic-1", name: "Additional Topic", sortOrder: 2 }],
  );

  assert.deepEqual(content.map((item) => item.kind), ["question", "subtopic"]);
  assert.equal(content[0].question.id, "q1");
  assert.deepEqual(content[1].content.map((item) => item.kind), ["question", "additionalTopic"]);
  assert.equal(content[1].content[0].question.id, "q2");
  assert.equal(content[1].content[1].additionalTopic.name, "Additional Topic");
  assert.equal(content[1].content[1].questions[0].id, "q3");
});

test("keeps sub-topic questions when no Additional Topic is defined", () => {
  const content = orderedTopicContent(
    [{ id: "topic-1" }],
    [{ id: "subtopic-1", topicId: "topic-1", name: "Sub-topic", sortOrder: 1 }],
    [{ id: "q1", topicId: "topic-1", subtopicId: "subtopic-1", sortOrder: 1 }],
  );

  assert.equal(content[0].content[0].kind, "question");
  assert.equal(content[0].content[0].question.id, "q1");
});
