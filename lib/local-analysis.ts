import type { PronunciationAnalysis, PronunciationMistake } from "@/types/analysis";
import { buildAnalysisFromFeedback } from "@/lib/analysis-result";
import {
  ANALYSIS_PROVIDERS,
  type LocalWhisperModel,
  LOCAL_WHISPER_FALLBACK_RUNTIME,
  LOCAL_WHISPER_MODEL
} from "@/lib/providers";
import {
  buildPronunciationFeatures,
  clampScore,
  extractWords,
  fallbackMistakes,
  scoreLabel
} from "@/lib/scoring";

export type WhisperTimestampChunk = {
  text: string;
  timestamp?: [number, number];
};

export type LocalTranscriptCandidate = {
  model: LocalWhisperModel;
  transcript: string;
  runtimeLabel: string;
  chunks?: WhisperTimestampChunk[];
};

export type LocalTranscriptSelection = LocalTranscriptCandidate & {
  qualityScore: number;
  comparisonSummary?: string;
};

export function buildLocalWhisperAnalysis(input: {
  transcript: string;
  durationSeconds: number;
  fileName: string;
  chunks?: WhisperTimestampChunk[];
  runtimeLabel?: string;
  modelId?: string;
  providerId?: "local-whisper" | "local-ensemble";
  comparisonSummary?: string;
}): PronunciationAnalysis {
  const transcript = input.transcript.trim();
  if (!transcript) {
    throw new Error("The local model could not transcribe this audio. Try a clearer English sample.");
  }

  const features = buildPronunciationFeatures({
    transcript,
    durationSeconds: input.durationSeconds,
    logprobs: null
  });
  const rhythm = analyzeWordTiming(input.chunks ?? []);
  const score = clampScore(features.heuristicScore - rhythm.longPauseCount * 2);

  return buildAnalysisFromFeedback({
    transcript,
    durationSeconds: input.durationSeconds,
    fileName: input.fileName,
    features,
    score,
    feedback: {
      rubricScore: score,
      scoreLabel: scoreLabel(score),
      summary: buildLocalSummary(features, rhythm, input.comparisonSummary),
      mistakes: buildLocalMistakes(features, rhythm),
      practicePlan: buildLocalPracticePlan(features, rhythm)
    },
    models: {
      transcription: `${input.modelId ?? LOCAL_WHISPER_MODEL} (${input.runtimeLabel ?? LOCAL_WHISPER_FALLBACK_RUNTIME.label})`,
      analysis: "local transcript heuristic"
    },
    provider: ANALYSIS_PROVIDERS[input.providerId ?? "local-whisper"],
    complianceNote: "Local mode runs transcription and scoring in the browser. Audio is not uploaded to the app server."
  });
}

export function selectBestLocalTranscript(input: {
  candidates: LocalTranscriptCandidate[];
  durationSeconds: number;
}): LocalTranscriptSelection {
  const candidates = input.candidates.filter((candidate) => candidate.transcript.trim().length > 0);
  if (candidates.length === 0) {
    throw new Error("No local model produced a usable transcript.");
  }

  const scored = candidates.map((candidate) => ({
    ...candidate,
      qualityScore: scoreLocalTranscript({
      transcript: candidate.transcript,
      durationSeconds: input.durationSeconds,
      qualityBias: candidate.model.qualityBias,
      peerTranscripts: candidates
        .filter((peer) => peer.model.id !== candidate.model.id)
        .map((peer) => peer.transcript)
    })
  }));
  scored.sort((a, b) => b.qualityScore - a.qualityScore);
  const winner = scored[0];
  const compared = scored.map((candidate) => candidate.model.label).join(" vs ");

  return {
    ...winner,
    comparisonSummary: `Compared ${compared}; selected ${winner.model.label} using transcript completeness, cleanliness, pace, and model agreement heuristics.`
  };
}

export function scoreLocalTranscriptCandidate(input: {
  candidate: LocalTranscriptCandidate;
  durationSeconds: number;
  peerTranscripts?: string[];
}) {
  return scoreLocalTranscript({
    transcript: input.candidate.transcript,
    durationSeconds: input.durationSeconds,
    qualityBias: input.candidate.model.qualityBias,
    peerTranscripts: input.peerTranscripts ?? []
  });
}

function analyzeWordTiming(chunks: WhisperTimestampChunk[]) {
  const wordChunks = chunks.filter((chunk) => {
    const timestamp = chunk.timestamp;
    return timestamp && Number.isFinite(timestamp[0]) && Number.isFinite(timestamp[1]);
  });

  let longPauseCount = 0;
  let previousEnd: number | null = null;

  for (const chunk of wordChunks) {
    const [start, end] = chunk.timestamp as [number, number];
    if (previousEnd !== null && start - previousEnd > 1.1) {
      longPauseCount += 1;
    }
    previousEnd = Math.max(previousEnd ?? 0, end);
  }

  return {
    longPauseCount,
    timestampedWordCount: wordChunks.length
  };
}

function buildLocalSummary(
  features: ReturnType<typeof buildPronunciationFeatures>,
  rhythm: ReturnType<typeof analyzeWordTiming>,
  comparisonSummary?: string
) {
  const first = `Local Whisper transcribed ${features.wordCount} words at ${features.wordsPerMinute.toFixed(1)} words per minute.`;
  const evidence = rhythm.timestampedWordCount > 0
    ? "This free mode uses transcript, timing, pace, and hesitation signals, but not acoustic confidence."
    : "This free mode uses transcript, pace, and hesitation signals, but not acoustic confidence.";

  return [first, comparisonSummary, evidence].filter(Boolean).join(" ");
}

function scoreLocalTranscript(input: {
  transcript: string;
  durationSeconds: number;
  qualityBias: number;
  peerTranscripts: string[];
}) {
  const words = extractWords(input.transcript.toLowerCase());
  const features = buildPronunciationFeatures({
    transcript: input.transcript,
    durationSeconds: input.durationSeconds,
    logprobs: null
  });
  const uniqueRatio = words.length > 0 ? new Set(words).size / words.length : 0;
  const adjacentRepeats = words.filter((word, index) => index > 0 && word === words[index - 1]).length;
  const strangeTokens = (input.transcript.match(/<\||\|>|\[[^\]]+\]|♪|�/g) ?? []).length;
  const lengthScore = words.length < 6 ? words.length * 10 : words.length < 18 ? 72 : 92;
  const cleanScore = clampScore(uniqueRatio * 100 - adjacentRepeats * 8 - strangeTokens * 18);
  const agreementScore = input.peerTranscripts.length > 0
    ? Math.max(...input.peerTranscripts.map((peer) => wordOverlap(words, extractWords(peer.toLowerCase())))) * 100
    : 75;

  return clampScore(
    features.breakdown.pace * 0.22 +
    lengthScore * 0.28 +
    cleanScore * 0.3 +
    agreementScore * 0.16 +
    input.qualityBias
  );
}

function wordOverlap(left: string[], right: string[]) {
  if (left.length === 0 || right.length === 0) {
    return 0;
  }

  const leftSet = new Set(left);
  const rightSet = new Set(right);
  const intersection = [...leftSet].filter((word) => rightSet.has(word)).length;
  const union = new Set([...leftSet, ...rightSet]).size;
  return union === 0 ? 0 : intersection / union;
}

function buildLocalMistakes(
  features: ReturnType<typeof buildPronunciationFeatures>,
  rhythm: ReturnType<typeof analyzeWordTiming>
): PronunciationMistake[] {
  const issues = fallbackMistakes(features);

  if (rhythm.longPauseCount >= 2) {
    issues.push({
      text: "long pauses",
      category: "fluency",
      severity: rhythm.longPauseCount >= 4 ? "medium" : "low",
      reason: "The word timestamps show repeated pauses longer than a natural phrase break.",
      suggestion: "Practice the same sample in shorter phrases, then connect the phrases with silent half-second pauses."
    });
  }

  if (issues.length < 2) {
    issues.push({
      text: "transcript match",
      category: "other",
      severity: "low",
      reason: "Local mode does not expose word-level confidence, so misheard words must be checked against the transcript.",
      suggestion: "Replay the audio while reading the transcript and mark any word the model heard incorrectly."
    });
  }

  if (issues.length < 2) {
    issues.push({
      text: "word endings",
      category: "unclear_segment",
      severity: "low",
      reason: "The transcript and pace look usable, but this mode cannot verify subtle consonant or vowel accuracy.",
      suggestion: "Repeat the sample once slowly, then once naturally while finishing final consonants."
    });
  }

  return issues.slice(0, 6);
}

function buildLocalPracticePlan(
  features: ReturnType<typeof buildPronunciationFeatures>,
  rhythm: ReturnType<typeof analyzeWordTiming>
) {
  const plan = [
    "Replay the audio and compare it with the transcript to find any misheard words.",
    "Repeat the hardest sentence slowly once, then at normal speed twice.",
    "Record again and try to keep the pace between 105 and 170 words per minute."
  ];

  if (features.hesitationCount > 0) {
    plan.push("Replace filler sounds with a short silent pause before the next phrase.");
  }

  if (rhythm.longPauseCount >= 2) {
    plan.push("Practice linking phrases so pauses stay under one second unless ending a sentence.");
  }

  return plan.slice(0, 5);
}
