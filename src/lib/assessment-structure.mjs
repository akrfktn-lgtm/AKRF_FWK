export function orderedTopicContent(topics = [], subtopics = [], questions = [], additionalTopics = []) {
  return topics.flatMap((topic) => {
    const directQuestions = questions
      .filter((question) => question.topicId === topic.id && !question.subtopicId)
      .map((question) => ({ kind: "question", order: question.displayOrder ?? question.sortOrder ?? 0, question }));
    const topicSubtopics = subtopics
      .filter((subtopic) => subtopic.topicId === topic.id)
      .map((subtopic) => {
        const subtopicQuestions = questions.filter((question) => question.topicId === topic.id && question.subtopicId === subtopic.id);
        const directSubtopicQuestions = subtopicQuestions
          .filter((question) => !question.additionalTopicId)
          .map((question) => ({ kind: "question", order: question.sortOrder ?? 0, question }));
        const subtopicAdditionalTopics = additionalTopics
          .filter((additionalTopic) => additionalTopic.subtopicId === subtopic.id)
          .map((additionalTopic) => ({
            kind: "additionalTopic",
            order: additionalTopic.sortOrder ?? 0,
            additionalTopic,
            questions: subtopicQuestions
              .filter((question) => question.additionalTopicId === additionalTopic.id)
              .sort((first, second) => (first.sortOrder ?? 0) - (second.sortOrder ?? 0)),
          }));
        return {
          kind: "subtopic",
          order: subtopic.sortOrder ?? 0,
          subtopic,
          content: [...directSubtopicQuestions, ...subtopicAdditionalTopics]
            .sort((first, second) => first.order - second.order),
        };
      });
    return [...directQuestions, ...topicSubtopics]
      .sort((first, second) => first.order - second.order)
      .flatMap((item) => item.kind === "question" ? [{ kind: "question", question: item.question }] : [item]);
  });
}
