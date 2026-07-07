import OpenAI, { toFile } from "openai";
import type { PronunciationAnalysis } from "@/types/analysis";
import { buildAnalysisFromFeedback, type FeedbackResponse } from "@/lib/analysis-result";
import { ANALYSIS_PROVIDERS } from "@/lib/providers";
import { pronunciationFeedbackSchema } from "@/lib/schema";
import { buildPronunciationFeatures } from "@/lib/scoring";

const TRANSCRIBE_MODEL = process.env.OPENAI_TRANSCRIBE_MODEL ?? "gpt-4o-mini-transcribe";
const ANALYSIS_MODEL = process.env.OPENAI_ANALYSIS_MODEL ?? "gpt-5.4-mini";

function getOpenAIClient() {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is not configured.");
  }
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

export async function analyzePronunciation(input: {
  buffer: Buffer;
  fileName: string;
  mimeType: string;
  durationSeconds: number;
}): Promise<PronunciationAnalysis> {
  const openai = getOpenAIClient();
  const uploadedFile = await toFile(input.buffer, input.fileName || "speech.webm", {
    type: input.mimeType || "audio/webm"
  });

  const transcription = await openai.audio.transcriptions.create({
    file: uploadedFile,
    model: TRANSCRIBE_MODEL,
    response_format: "json",
    language: "en",
    prompt: "English speech from a learner. Preserve natural words and hesitations. Do not translate.",
    include: ["logprobs"]
  } as never);

  const transcript = typeof transcription.text === "string" ? transcription.text.trim() : "";
  if (!transcript) {
    throw new Error("The audio could not be transcribed. Try a clearer English speech sample.");
  }

  const logprobs = (transcription as { logprobs?: unknown }).logprobs;
  const features = buildPronunciationFeatures({
    transcript,
    durationSeconds: input.durationSeconds,
    logprobs
  });

  const feedback = await requestStructuredFeedback(openai, {
    transcript,
    durationSeconds: input.durationSeconds,
    features
  });

  return buildAnalysisFromFeedback({
    transcript,
    durationSeconds: input.durationSeconds,
    fileName: input.fileName,
    features,
    feedback,
    models: {
      transcription: TRANSCRIBE_MODEL,
      analysis: ANALYSIS_MODEL
    },
    provider: ANALYSIS_PROVIDERS.openai,
    complianceNote: "Audio is processed in memory for this request and is not stored by the app."
  });
}

async function requestStructuredFeedback(
  openai: OpenAI,
  input: {
    transcript: string;
    durationSeconds: number;
    features: ReturnType<typeof buildPronunciationFeatures>;
  }
): Promise<FeedbackResponse> {
  const response = await openai.responses.create({
    model: ANALYSIS_MODEL,
    store: false,
    reasoning: {
      effort: "low"
    },
    input: [
      {
        role: "system",
        content: [
          "You are a pronunciation coach for English learners.",
          "Use the transcript and speech-to-text confidence signals to produce useful feedback.",
          "Do not claim access to phoneme-level acoustics. If evidence is weak, say the issue is likely rather than certain.",
          "Return 2 to 6 highlighted words or short segments. Prefer exact transcript text so the UI can highlight it.",
          "Keep suggestions concrete and short."
        ].join(" ")
      },
      {
        role: "user",
        content: JSON.stringify({
          transcript: input.transcript,
          durationSeconds: input.durationSeconds,
          wordCount: input.features.wordCount,
          wordsPerMinute: Number(input.features.wordsPerMinute.toFixed(1)),
          heuristicScore: input.features.heuristicScore,
          averageConfidence: input.features.averageConfidence === null
            ? null
            : Number(input.features.averageConfidence.toFixed(3)),
          lowConfidenceRatio: input.features.lowConfidenceRatio === null
            ? null
            : Number(input.features.lowConfidenceRatio.toFixed(3)),
          lowConfidenceTokens: input.features.lowConfidenceTokens.map((token) => ({
            token: token.token,
            confidence: Number(token.confidence.toFixed(3))
          })),
          hesitationCount: input.features.hesitationCount
        })
      }
    ],
    text: {
      format: {
        type: "json_schema",
        name: "pronunciation_feedback",
        strict: true,
        schema: pronunciationFeedbackSchema
      }
    }
  } as never);

  const outputText = (response as { output_text?: string }).output_text;
  if (!outputText) {
    throw new Error("The analysis model returned an empty response.");
  }

  return JSON.parse(outputText) as FeedbackResponse;
}
