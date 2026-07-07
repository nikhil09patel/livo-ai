export const pronunciationFeedbackSchema = {
  type: "object",
  additionalProperties: false,
  required: ["rubricScore", "scoreLabel", "summary", "mistakes", "practicePlan"],
  properties: {
    rubricScore: {
      type: "number",
      minimum: 0,
      maximum: 100,
      description: "Pronunciation usefulness score before deterministic confidence blending."
    },
    scoreLabel: {
      type: "string",
      enum: ["Needs work", "Developing", "Clear", "Strong", "Excellent"]
    },
    summary: {
      type: "string",
      description: "Two concise learner-facing sentences."
    },
    mistakes: {
      type: "array",
      minItems: 2,
      maxItems: 6,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["text", "category", "severity", "reason", "suggestion"],
        properties: {
          text: {
            type: "string",
            description: "Exact word or short transcript segment to highlight."
          },
          category: {
            type: "string",
            enum: ["mispronounced_word", "unclear_segment", "pace", "stress", "fluency", "other"]
          },
          severity: {
            type: "string",
            enum: ["low", "medium", "high"]
          },
          reason: {
            type: "string"
          },
          suggestion: {
            type: "string"
          }
        }
      }
    },
    practicePlan: {
      type: "array",
      minItems: 3,
      maxItems: 5,
      items: {
        type: "string"
      }
    }
  }
} as const;
