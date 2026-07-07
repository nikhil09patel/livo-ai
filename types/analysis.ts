export type MistakeCategory =
  | "mispronounced_word"
  | "unclear_segment"
  | "pace"
  | "stress"
  | "fluency"
  | "other";

export type MistakeSeverity = "low" | "medium" | "high";

export type PronunciationMistake = {
  text: string;
  category: MistakeCategory;
  severity: MistakeSeverity;
  reason: string;
  suggestion: string;
};

export type ScoreBreakdown = {
  pronunciationConfidence: number;
  clarity: number;
  fluency: number;
  pace: number;
};

export type AnalysisProviderId = "gemini-cloud" | "local-whisper" | "local-ensemble" | "openai";

export type AnalysisProviderMetadata = {
  id: AnalysisProviderId;
  label: string;
  cost: string;
  quality: string;
  performance: string;
  privacy: string;
};

export type PronunciationAnalysis = {
  transcript: string;
  score: number;
  scoreLabel: string;
  summary: string;
  mistakes: PronunciationMistake[];
  practicePlan: string[];
  breakdown: ScoreBreakdown;
  metadata: {
    durationSeconds: number;
    wordCount: number;
    wordsPerMinute: number;
    fileName: string;
    processedAt: string;
    models: {
      transcription: string;
      analysis: string;
    };
    provider: AnalysisProviderMetadata;
  };
  complianceNote: string;
};

export type AnalyzeError = {
  error: string;
  detail?: string;
};
