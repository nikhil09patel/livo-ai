import type { PronunciationAnalysis } from "@/types/analysis";
import { buildAnalysisFromFeedback, type FeedbackResponse } from "@/lib/analysis-result";
import { ANALYSIS_PROVIDERS, GEMINI_MODEL, GEMINI_MODEL_FALLBACKS } from "@/lib/providers";
import { buildPronunciationFeatures } from "@/lib/scoring";
import { pronunciationFeedbackSchema } from "@/lib/schema";

type GeminiFile = {
  name: string;
  uri: string;
  mime_type?: string;
  mimeType?: string;
};

const GEMINI_API_BASE = "https://generativelanguage.googleapis.com";
const GEMINI_INTERACTIONS_URL = `${GEMINI_API_BASE}/v1beta/interactions`;

const geminiResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["transcript", ...pronunciationFeedbackSchema.required],
  properties: {
    transcript: {
      type: "string",
      description: "Clean English transcript of the learner's speech."
    },
    ...pronunciationFeedbackSchema.properties
  }
} as const;

export async function analyzeWithGemini(input: {
  buffer: Buffer;
  fileName: string;
  mimeType: string;
  durationSeconds: number;
}): Promise<PronunciationAnalysis> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not configured.");
  }

  const models = getGeminiModelCandidates();
  const uploadedFile = await uploadGeminiFile({
    apiKey,
    buffer: input.buffer,
    fileName: input.fileName,
    mimeType: input.mimeType
  });

  try {
    const { model, outputText } = await requestGeminiWithFallback({
      apiKey,
      models,
      uploadedFile,
      mimeType: input.mimeType,
      durationSeconds: input.durationSeconds
    });

    const feedback = parseGeminiFeedback(outputText);
    const transcript = feedback.transcript.trim();
    if (!transcript) {
      throw new Error("Gemini could not transcribe this audio. Try a clearer English sample.");
    }

    const features = buildPronunciationFeatures({
      transcript,
      durationSeconds: input.durationSeconds,
      logprobs: null
    });

    return buildAnalysisFromFeedback({
      transcript,
      durationSeconds: input.durationSeconds,
      fileName: input.fileName,
      features,
      feedback,
      models: {
        transcription: model,
        analysis: model
      },
      provider: ANALYSIS_PROVIDERS["gemini-cloud"],
      complianceNote: "Quality cloud mode sends audio to the Gemini API for analysis, then the app deletes the temporary Gemini file request-side when possible."
    });
  } finally {
    await deleteGeminiFile(apiKey, uploadedFile.name);
  }
}

async function requestGeminiWithFallback(input: {
  apiKey: string;
  models: string[];
  uploadedFile: GeminiFile;
  mimeType: string;
  durationSeconds: number;
}) {
  const errors: string[] = [];

  for (const model of input.models) {
    const response = await fetch(GEMINI_INTERACTIONS_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": input.apiKey
      },
      body: JSON.stringify(buildGeminiRequestBody({
        model,
        uploadedFile: input.uploadedFile,
        mimeType: input.mimeType,
        durationSeconds: input.durationSeconds
      }))
    });

    if (!response.ok) {
      const error = await buildGeminiError(`Gemini analysis failed on ${model}`, response);
      errors.push(error);
      if (isRetryableGeminiError(error, response.status)) {
        continue;
      }
      throw new Error(error);
    }

    const payload = await response.json() as unknown;
    const outputText = extractOutputText(payload);
    if (!outputText) {
      errors.push(`Gemini returned an empty analysis response on ${model}.`);
      continue;
    }

    return { model, outputText };
  }

  throw new Error(errors.join(" | ") || "Gemini analysis failed for all configured models.");
}

function buildGeminiRequestBody(input: {
  model: string;
  uploadedFile: GeminiFile;
  mimeType: string;
  durationSeconds: number;
}) {
  return {
    model: input.model,
    system_instruction: [
      "You are a practical English pronunciation coach.",
      "Analyze the learner's audio and return only valid JSON matching the schema.",
      "Transcribe the speech accurately before scoring it.",
      "Do not claim phoneme-level certainty. If evidence is weak, say likely.",
      "Return concise feedback that a learner can practice immediately."
    ].join(" "),
    input: [
      {
        type: "text",
        text: [
          "Assess this single-speaker English learner sample.",
          `Duration: ${input.durationSeconds.toFixed(1)} seconds.`,
          "Return a transcript, 0-100 rubric score, score label, two-sentence summary, 2-6 highlighted words or short segments, and 3-5 practice steps.",
          "Mistake text should be exact transcript text where possible."
        ].join(" ")
      },
      {
        type: "audio",
        uri: input.uploadedFile.uri,
        mime_type: input.uploadedFile.mime_type ?? input.uploadedFile.mimeType ?? input.mimeType
      }
    ],
    response_format: {
      type: "text",
      mime_type: "application/json",
      schema: geminiResponseSchema
    },
    generation_config: {
      temperature: 0.2,
      thinking_level: "low"
    }
  };
}

function getGeminiModelCandidates() {
  const primary = process.env.GEMINI_MODEL ?? GEMINI_MODEL;
  const configuredFallbacks = (process.env.GEMINI_MODEL_FALLBACKS ?? GEMINI_MODEL_FALLBACKS.join(","))
    .split(",")
    .map((model) => model.trim())
    .filter(Boolean);

  return [...new Set([primary, ...configuredFallbacks, GEMINI_MODEL, ...GEMINI_MODEL_FALLBACKS])];
}

function isRetryableGeminiError(message: string, status: number) {
  const normalized = message.toLowerCase();
  return status === 429 ||
    status === 500 ||
    status === 502 ||
    status === 503 ||
    normalized.includes("high demand") ||
    normalized.includes("temporarily unavailable") ||
    normalized.includes("resource exhausted") ||
    normalized.includes("overloaded");
}

async function uploadGeminiFile(input: {
  apiKey: string;
  buffer: Buffer;
  fileName: string;
  mimeType: string;
}): Promise<GeminiFile> {
  const start = await fetch(`${GEMINI_API_BASE}/upload/v1beta/files`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": input.apiKey,
      "X-Goog-Upload-Protocol": "resumable",
      "X-Goog-Upload-Command": "start",
      "X-Goog-Upload-Header-Content-Length": String(input.buffer.byteLength),
      "X-Goog-Upload-Header-Content-Type": input.mimeType
    },
    body: JSON.stringify({
      file: {
        display_name: input.fileName || "speech"
      }
    })
  });

  if (!start.ok) {
    throw new Error(await buildGeminiError("Gemini file upload start failed", start));
  }

  const uploadUrl = start.headers.get("x-goog-upload-url");
  if (!uploadUrl) {
    throw new Error("Gemini did not return an upload URL.");
  }

  const finalize = await fetch(uploadUrl, {
    method: "POST",
    headers: {
      "Content-Length": String(input.buffer.byteLength),
      "X-Goog-Upload-Offset": "0",
      "X-Goog-Upload-Command": "upload, finalize"
    },
    body: new Uint8Array(input.buffer)
  });

  if (!finalize.ok) {
    throw new Error(await buildGeminiError("Gemini file upload failed", finalize));
  }

  const fileInfo = await finalize.json() as { file?: GeminiFile };
  if (!fileInfo.file?.uri || !fileInfo.file.name) {
    throw new Error("Gemini file upload response did not include a usable file URI.");
  }

  return fileInfo.file;
}

async function deleteGeminiFile(apiKey: string, fileName: string) {
  if (!fileName) {
    return;
  }

  try {
    await fetch(`${GEMINI_API_BASE}/v1beta/${fileName}`, {
      method: "DELETE",
      headers: {
        "x-goog-api-key": apiKey
      }
    });
  } catch {
    // Gemini files expire automatically; deletion is a best-effort privacy cleanup.
  }
}

function extractOutputText(payload: unknown) {
  if (!payload || typeof payload !== "object") {
    return "";
  }

  const record = payload as {
    output_text?: unknown;
    outputText?: unknown;
    outputs?: unknown;
    steps?: unknown;
  };

  if (typeof record.output_text === "string") {
    return record.output_text;
  }

  if (typeof record.outputText === "string") {
    return record.outputText;
  }

  const outputText = collectText(record.outputs);
  if (outputText) {
    return outputText;
  }

  return collectText(record.steps);
}

function collectText(value: unknown): string {
  if (!Array.isArray(value)) {
    return "";
  }

  const text: string[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") {
      continue;
    }

    const record = item as { type?: unknown; text?: unknown; content?: unknown; delta?: unknown };
    if (typeof record.text === "string") {
      text.push(record.text);
    }

    if (Array.isArray(record.content)) {
      text.push(collectText(record.content));
    }

    if (record.delta && typeof record.delta === "object") {
      const delta = record.delta as { text?: unknown };
      if (typeof delta.text === "string") {
        text.push(delta.text);
      }
    }
  }

  return text.filter(Boolean).join("");
}

function parseGeminiFeedback(text: string): FeedbackResponse & { transcript: string } {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");

  try {
    return JSON.parse(trimmed) as FeedbackResponse & { transcript: string };
  } catch {
    const objectMatch = trimmed.match(/\{[\s\S]*\}/);
    if (!objectMatch) {
      throw new Error("Gemini returned analysis text that was not valid JSON.");
    }
    return JSON.parse(objectMatch[0]) as FeedbackResponse & { transcript: string };
  }
}

async function buildGeminiError(prefix: string, response: Response) {
  const text = await response.text();
  if (!text) {
    return `${prefix}: HTTP ${response.status}`;
  }

  try {
    const parsed = JSON.parse(text) as { error?: { message?: string } };
    return `${prefix}: ${parsed.error?.message ?? text}`;
  } catch {
    return `${prefix}: ${text}`;
  }
}
