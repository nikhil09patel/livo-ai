import { describe, expect, it } from "vitest";
import {
  buildPronunciationFeatures,
  extractWords,
  normalizeLogprobs,
  scorePace
} from "@/lib/scoring";

describe("pronunciation scoring helpers", () => {
  it("extracts words without punctuation", () => {
    expect(extractWords("Hello, I'm testing clear speech.")).toEqual([
      "Hello",
      "I'm",
      "testing",
      "clear",
      "speech"
    ]);
  });

  it("normalizes logprobs into confidence values", () => {
    const signals = normalizeLogprobs([
      { token: "clear", logprob: -0.1 },
      { token: "unclear", logprob: -2.5 }
    ]);

    expect(signals).toHaveLength(2);
    expect(signals[0].confidence).toBeGreaterThan(signals[1].confidence);
  });

  it("rewards conversational pace more than extreme pace", () => {
    expect(scorePace(135)).toBeGreaterThan(scorePace(60));
    expect(scorePace(135)).toBeGreaterThan(scorePace(230));
  });

  it("builds a bounded score and issue signals", () => {
    const features = buildPronunciationFeatures({
      transcript: "Um I am practicing pronunciation with clear steady speech.",
      durationSeconds: 32,
      logprobs: [
        { token: "practicing", logprob: -0.2 },
        { token: "pronunciation", logprob: -1.8 },
        { token: "clear", logprob: -0.1 }
      ]
    });

    expect(features.heuristicScore).toBeGreaterThanOrEqual(0);
    expect(features.heuristicScore).toBeLessThanOrEqual(100);
    expect(features.lowConfidenceTokens[0]?.token).toBe("pronunciation");
  });
});
