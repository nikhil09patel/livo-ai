import type { AnalysisProviderId, AnalysisProviderMetadata } from "@/types/analysis";

export const GEMINI_MODEL = "gemini-2.5-flash";
export const GEMINI_MODEL_FALLBACKS = ["gemini-2.5-flash-lite"] as const;

export type LocalWhisperModel = {
  id: string;
  label: string;
  qualityBias: number;
};

export const LOCAL_WHISPER_TINY_MODEL = {
  id: "Xenova/whisper-tiny.en",
  label: "Whisper tiny.en",
  qualityBias: 0
} satisfies LocalWhisperModel;

export const LOCAL_WHISPER_BASE_MODEL = {
  id: "Xenova/whisper-base.en",
  label: "Whisper base.en",
  qualityBias: 4
} satisfies LocalWhisperModel;

export const LOCAL_WHISPER_MODEL = LOCAL_WHISPER_TINY_MODEL.id;
export const LOCAL_WHISPER_COMPARE_MODELS = [
  LOCAL_WHISPER_TINY_MODEL,
  LOCAL_WHISPER_BASE_MODEL
] as const;

export type LocalWhisperRuntime = {
  device: "webgpu" | "wasm";
  dtype: "fp16" | "fp32";
  label: string;
};

export const LOCAL_WHISPER_FAST_RUNTIME = {
  device: "webgpu",
  dtype: "fp16",
  label: "webgpu/fp16"
} satisfies LocalWhisperRuntime;

export const LOCAL_WHISPER_FALLBACK_RUNTIME = {
  device: "wasm",
  dtype: "fp32",
  label: "wasm/fp32"
} satisfies LocalWhisperRuntime;

export const ANALYSIS_PROVIDERS = {
  "gemini-cloud": {
    id: "gemini-cloud",
    label: "Quality cloud",
    cost: "Limited free tier",
    quality: "Best feedback quality in this app",
    performance: "Usually fastest after upload; depends on Gemini quota",
    privacy: "Sends audio to Google Gemini API"
  },
  "local-whisper": {
    id: "local-whisper",
    label: "Free local",
    cost: "Completely free",
    quality: "Good English transcription, weaker pronunciation evidence",
    performance: "Tries faster WebGPU first; falls back to slower local CPU",
    privacy: "Runs in the browser; no app server upload"
  },
  "local-ensemble": {
    id: "local-ensemble",
    label: "Smart compare",
    cost: "Completely free",
    quality: "Uses a second local model only when it can improve a weak transcript",
    performance: "Adaptive latency: tiny.en first, base.en only when needed",
    privacy: "Runs in the browser; no app server upload"
  },
  openai: {
    id: "openai",
    label: "OpenAI",
    cost: "Paid API",
    quality: "Strong transcription confidence signals",
    performance: "Fast cloud processing with configured OpenAI billing",
    privacy: "Sends audio to OpenAI API"
  }
} satisfies Record<AnalysisProviderId, AnalysisProviderMetadata>;
