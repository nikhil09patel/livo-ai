import { describe, expect, it } from "vitest";
import { buildLocalWhisperAnalysis, selectBestLocalTranscript } from "@/lib/local-analysis";
import { LOCAL_WHISPER_BASE_MODEL, LOCAL_WHISPER_TINY_MODEL } from "@/lib/providers";

describe("local Whisper analysis", () => {
  it("builds a complete no-api-key report from a transcript and timestamps", () => {
    const analysis = buildLocalWhisperAnalysis({
      transcript: "Um I am practicing clear English pronunciation with steady pacing.",
      durationSeconds: 34,
      fileName: "sample.webm",
      chunks: [
        { text: "Um", timestamp: [0, 0.4] },
        { text: "I", timestamp: [1.7, 1.9] },
        { text: "am", timestamp: [2.0, 2.2] },
        { text: "practicing", timestamp: [3.7, 4.3] }
      ]
    });

    expect(analysis.metadata.provider.id).toBe("local-whisper");
    expect(analysis.metadata.models.analysis).toBe("local transcript heuristic");
    expect(analysis.mistakes.length).toBeGreaterThanOrEqual(2);
    expect(analysis.score).toBeGreaterThanOrEqual(0);
    expect(analysis.score).toBeLessThanOrEqual(100);
  });

  it("selects the stronger local transcript candidate", () => {
    const selected = selectBestLocalTranscript({
      durationSeconds: 34,
      candidates: [
        {
          model: LOCAL_WHISPER_TINY_MODEL,
          transcript: "um um testing testing",
          runtimeLabel: "wasm/fp32"
        },
        {
          model: LOCAL_WHISPER_BASE_MODEL,
          transcript: "I am testing clear English pronunciation with steady pacing.",
          runtimeLabel: "webgpu/fp16"
        }
      ]
    });

    expect(selected.model.id).toBe(LOCAL_WHISPER_BASE_MODEL.id);
    expect(selected.comparisonSummary).toContain("selected Whisper base.en");
  });
});
