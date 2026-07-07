import type { PronunciationAnalysis, PronunciationMistake } from "@/types/analysis";
import {
  blendScores,
  buildPronunciationFeatures,
  clampScore,
  fallbackMistakes,
  scoreLabel
} from "@/lib/scoring";

export type FeedbackResponse = {
  rubricScore: number;
  scoreLabel: string;
  summary: string;
  mistakes: PronunciationMistake[];
  practicePlan: string[];
};

export function buildAnalysisFromFeedback(input: {
  transcript: string;
  durationSeconds: number;
  fileName: string;
  features: ReturnType<typeof buildPronunciationFeatures>;
  feedback: FeedbackResponse;
  models: {
    transcription: string;
    analysis: string;
  };
  provider: PronunciationAnalysis["metadata"]["provider"];
  complianceNote: string;
  score?: number;
}): PronunciationAnalysis {
  const rubricScore = typeof input.feedback.rubricScore === "number"
    ? input.feedback.rubricScore
    : input.features.heuristicScore;
  const score = input.score ?? blendScores(
    input.features.heuristicScore,
    clampScore(rubricScore)
  );
  const summary = typeof input.feedback.summary === "string" && input.feedback.summary.trim()
    ? input.feedback.summary.trim()
    : buildFallbackSummary(input.transcript, input.features);
  const practicePlan = normalizePracticePlan(input.feedback.practicePlan, input.features);

  return {
    transcript: input.transcript,
    score,
    scoreLabel: input.feedback.scoreLabel || scoreLabel(score),
    summary,
    mistakes: normalizeMistakes(input.feedback.mistakes, input.features),
    practicePlan,
    breakdown: input.features.breakdown,
    metadata: {
      durationSeconds: Number(input.durationSeconds.toFixed(1)),
      wordCount: input.features.wordCount,
      wordsPerMinute: Number(input.features.wordsPerMinute.toFixed(1)),
      fileName: input.fileName,
      processedAt: new Date().toISOString(),
      models: input.models,
      provider: input.provider
    },
    complianceNote: input.complianceNote
  };
}

export function normalizeMistakes(
  mistakes: PronunciationMistake[] | unknown,
  features: ReturnType<typeof buildPronunciationFeatures>
) {
  const source = Array.isArray(mistakes) ? mistakes : [];
  const cleaned = source
    .filter((mistake): mistake is Partial<PronunciationMistake> => {
      return typeof mistake === "object" &&
        mistake !== null &&
        typeof (mistake as { text?: unknown }).text === "string" &&
        ((mistake as { text: string }).text.trim().length > 0);
    })
    .map((mistake) => ({
      text: mistake.text?.trim() ?? "",
      category: isMistakeCategory(mistake.category) ? mistake.category : "other",
      severity: isMistakeSeverity(mistake.severity) ? mistake.severity : "low",
      reason: typeof mistake.reason === "string" && mistake.reason.trim()
        ? mistake.reason.trim()
        : "The model flagged this as an area to review, but did not provide enough detail.",
      suggestion: typeof mistake.suggestion === "string" && mistake.suggestion.trim()
        ? mistake.suggestion.trim()
        : "Repeat this part slowly, then again at normal speed."
    }));

  if (cleaned.length >= 2) {
    return cleaned.slice(0, 6);
  }

  const fallbacks = fallbackMistakes(features);
  const combined = [...cleaned, ...fallbacks];

  if (combined.length < 2) {
    combined.push({
      text: "transcript review",
      category: "other",
      severity: "low",
      reason: "The model response did not include enough highlighted mistakes for a full report.",
      suggestion: "Replay the audio while reading the transcript and mark any word that sounds different from what was transcribed."
    });
  }

  if (combined.length < 2) {
    combined.push({
      text: "overall clarity",
      category: "unclear_segment",
      severity: "low",
      reason: "There was limited model evidence for specific word-level feedback.",
      suggestion: "Repeat the sample slowly once, then again at normal pace while finishing word endings."
    });
  }

  return combined.slice(0, 6);
}

function normalizePracticePlan(
  practicePlan: string[] | unknown,
  features: ReturnType<typeof buildPronunciationFeatures>
) {
  const plan = Array.isArray(practicePlan)
    ? practicePlan
      .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
      .map((item) => item.trim())
      .slice(0, 5)
    : [];

  const fallback = [
    "Replay the audio while reading the transcript and mark any words that were misheard.",
    "Repeat the hardest sentence slowly once, then at normal speed twice.",
    `Aim for a steady pace near conversational English; this sample was ${features.wordsPerMinute.toFixed(1)} words per minute.`
  ];

  return [...plan, ...fallback].slice(0, Math.max(3, Math.min(5, plan.length || 3)));
}

function buildFallbackSummary(
  transcript: string,
  features: ReturnType<typeof buildPronunciationFeatures>
) {
  const words = features.wordCount === 1 ? "word" : "words";
  return `The transcript contains ${features.wordCount} ${words} at ${features.wordsPerMinute.toFixed(1)} words per minute. The report uses transcript and timing signals because the model response was incomplete.`;
}

function isMistakeCategory(value: unknown): value is PronunciationMistake["category"] {
  return typeof value === "string" &&
    ["mispronounced_word", "unclear_segment", "pace", "stress", "fluency", "other"].includes(value);
}

function isMistakeSeverity(value: unknown): value is PronunciationMistake["severity"] {
  return typeof value === "string" && ["low", "medium", "high"].includes(value);
}
