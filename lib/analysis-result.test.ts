import { describe, expect, it } from "vitest";
import { buildAnalysisFromFeedback, type FeedbackResponse } from "@/lib/analysis-result";
import { ANALYSIS_PROVIDERS } from "@/lib/providers";
import { buildPronunciationFeatures } from "@/lib/scoring";

describe("analysis result builder", () => {
  it("falls back when model feedback omits array fields", () => {
    const transcript = "I am practicing English pronunciation with steady pacing.";
    const features = buildPronunciationFeatures({
      transcript,
      durationSeconds: 33,
      logprobs: null
    });

    const result = buildAnalysisFromFeedback({
      transcript,
      durationSeconds: 33,
      fileName: "sample.wav",
      features,
      feedback: {
        rubricScore: 78,
        scoreLabel: "Clear",
        summary: "Clear speech with a steady pace."
      } as unknown as FeedbackResponse,
      models: {
        transcription: "gemini-2.5-flash",
        analysis: "gemini-2.5-flash"
      },
      provider: ANALYSIS_PROVIDERS["gemini-cloud"],
      complianceNote: "Test note."
    });

    expect(result.mistakes.length).toBeGreaterThanOrEqual(2);
    expect(result.practicePlan.length).toBeGreaterThanOrEqual(3);
    expect(result.summary).toBe("Clear speech with a steady pace.");
  });
});
