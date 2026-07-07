import type { PronunciationMistake, ScoreBreakdown } from "@/types/analysis";

export type TokenSignal = {
  token: string;
  logprob: number;
  confidence: number;
};

export type PronunciationFeatures = {
  wordCount: number;
  wordsPerMinute: number;
  averageConfidence: number | null;
  lowConfidenceRatio: number | null;
  lowConfidenceTokens: TokenSignal[];
  hesitationCount: number;
  breakdown: ScoreBreakdown;
  heuristicScore: number;
};

const HESITATIONS = new Set(["um", "umm", "uh", "uhh", "er", "erm", "ah", "ahh"]);

export function clampScore(value: number) {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function scoreLabel(score: number) {
  if (score >= 90) return "Excellent";
  if (score >= 80) return "Strong";
  if (score >= 68) return "Clear";
  if (score >= 52) return "Developing";
  return "Needs work";
}

export function extractWords(text: string) {
  return text.match(/[A-Za-z]+(?:'[A-Za-z]+)?/g) ?? [];
}

export function normalizeLogprobs(raw: unknown): TokenSignal[] {
  if (!raw) {
    return [];
  }

  const list = Array.isArray(raw)
    ? raw
    : typeof raw === "object" && raw !== null && Array.isArray((raw as { content?: unknown }).content)
      ? (raw as { content: unknown[] }).content
      : [];

  return list
    .map((item) => {
      if (typeof item !== "object" || item === null) {
        return null;
      }

      const record = item as { token?: unknown; text?: unknown; logprob?: unknown };
      const tokenValue = typeof record.token === "string"
        ? record.token
        : typeof record.text === "string"
          ? record.text
          : "";
      const logprob = typeof record.logprob === "number" ? record.logprob : null;

      if (!tokenValue || logprob === null) {
        return null;
      }

      return {
        token: tokenValue,
        logprob,
        confidence: Math.max(0, Math.min(1, Math.exp(logprob)))
      };
    })
    .filter((item): item is TokenSignal => item !== null);
}

export function buildPronunciationFeatures(input: {
  transcript: string;
  durationSeconds: number;
  logprobs: unknown;
}): PronunciationFeatures {
  const words = extractWords(input.transcript);
  const wordCount = words.length;
  const wordsPerMinute = input.durationSeconds > 0 ? (wordCount / input.durationSeconds) * 60 : 0;
  const tokenSignals = normalizeLogprobs(input.logprobs);
  const confidenceTokens = tokenSignals.filter((token) => /[A-Za-z]/.test(token.token));
  const averageConfidence = confidenceTokens.length > 0
    ? confidenceTokens.reduce((sum, token) => sum + token.confidence, 0) / confidenceTokens.length
    : null;
  const lowConfidenceTokens = confidenceTokens
    .filter((token) => token.logprob < -1.05)
    .sort((a, b) => a.confidence - b.confidence)
    .slice(0, 12);
  const lowConfidenceRatio = confidenceTokens.length > 0
    ? lowConfidenceTokens.length / confidenceTokens.length
    : null;
  const hesitationCount = words.filter((word) => HESITATIONS.has(word.toLowerCase())).length;

  const confidenceScore = averageConfidence === null
    ? 74
    : clampScore(averageConfidence * 100 - (lowConfidenceRatio ?? 0) * 22);
  const paceScore = scorePace(wordsPerMinute);
  const fluencyScore = clampScore(100 - hesitationCount * 7 - Math.max(0, (lowConfidenceRatio ?? 0) * 35));
  const clarityScore = clampScore(confidenceScore - Math.max(0, hesitationCount - 1) * 3);
  const heuristicScore = clampScore(
    confidenceScore * 0.45 +
    clarityScore * 0.25 +
    fluencyScore * 0.2 +
    paceScore * 0.1
  );

  return {
    wordCount,
    wordsPerMinute,
    averageConfidence,
    lowConfidenceRatio,
    lowConfidenceTokens,
    hesitationCount,
    breakdown: {
      pronunciationConfidence: confidenceScore,
      clarity: clarityScore,
      fluency: fluencyScore,
      pace: paceScore
    },
    heuristicScore
  };
}

export function scorePace(wordsPerMinute: number) {
  if (!Number.isFinite(wordsPerMinute) || wordsPerMinute <= 0) {
    return 50;
  }

  if (wordsPerMinute >= 105 && wordsPerMinute <= 170) {
    return 96;
  }

  if (wordsPerMinute < 105) {
    return clampScore(96 - (105 - wordsPerMinute) * 0.9);
  }

  return clampScore(96 - (wordsPerMinute - 170) * 0.7);
}

export function fallbackMistakes(features: PronunciationFeatures): PronunciationMistake[] {
  const issues = features.lowConfidenceTokens.slice(0, 3).map((token): PronunciationMistake => ({
    text: token.token.trim(),
    category: "unclear_segment",
    severity: token.confidence < 0.2 ? "high" : token.confidence < 0.35 ? "medium" : "low",
    reason: "This word had low speech-to-text confidence, which can indicate unclear pronunciation or noisy audio.",
    suggestion: "Repeat it slowly, then again at normal speed while keeping the vowel sound steady."
  }));

  if (features.wordsPerMinute < 95) {
    issues.push({
      text: "overall pace",
      category: "pace",
      severity: "low",
      reason: "The speech rate is slower than typical conversational English.",
      suggestion: "Read the same passage again with shorter pauses between phrases."
    });
  } else if (features.wordsPerMinute > 185) {
    issues.push({
      text: "overall pace",
      category: "pace",
      severity: "medium",
      reason: "The speech rate is fast enough that word endings may be harder to hear.",
      suggestion: "Slow down slightly and finish the final consonants of key words."
    });
  }

  if (features.hesitationCount > 0) {
    issues.push({
      text: "fillers",
      category: "fluency",
      severity: features.hesitationCount > 2 ? "medium" : "low",
      reason: "The transcript contains audible hesitation markers.",
      suggestion: "Pause silently before the next phrase instead of using filler sounds."
    });
  }

  return issues.slice(0, 4);
}

export function blendScores(heuristicScore: number, rubricScore: number) {
  return clampScore(heuristicScore * 0.65 + rubricScore * 0.35);
}
