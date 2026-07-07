import { describe, expect, it } from "vitest";
import { validateAudioUpload } from "@/lib/audio";
import { MAX_DURATION_SECONDS, MIN_DURATION_SECONDS } from "@/lib/upload-constraints";

describe("audio upload validation", () => {
  it("accepts a short audio sample under the hosted size limit", () => {
    expect(validateAudioUpload({
      fileName: "harvard.wav",
      mimeType: "audio/wav",
      sizeBytes: Math.round(3.1 * 1024 * 1024),
      durationSeconds: 18.4
    })).toEqual({
      ok: true,
      durationSeconds: 18.4
    });
  });

  it("still rejects clips that are too short to score", () => {
    expect(validateAudioUpload({
      fileName: "tiny.wav",
      mimeType: "audio/wav",
      sizeBytes: 256 * 1024,
      durationSeconds: MIN_DURATION_SECONDS - 0.1
    })).toEqual({
      ok: false,
      message: `Audio must be between ${MIN_DURATION_SECONDS} and ${MAX_DURATION_SECONDS} seconds.`
    });
  });
});
