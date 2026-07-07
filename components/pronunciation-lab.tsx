"use client";

import { useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  Cloud,
  Cpu,
  FileAudio,
  GitCompareArrows,
  Heart,
  Loader2,
  RotateCcw,
  ShieldCheck,
  UploadCloud
} from "lucide-react";
import type {
  AnalysisProviderId,
  AnalyzeError,
  PronunciationAnalysis
} from "@/types/analysis";
import { ResultView } from "@/components/result-view";
import {
  buildLocalWhisperAnalysis,
  scoreLocalTranscriptCandidate,
  selectBestLocalTranscript,
  type LocalTranscriptCandidate,
  type WhisperTimestampChunk
} from "@/lib/local-analysis";
import {
  ANALYSIS_PROVIDERS,
  type LocalWhisperModel,
  type LocalWhisperRuntime,
  LOCAL_WHISPER_BASE_MODEL,
  LOCAL_WHISPER_COMPARE_MODELS,
  LOCAL_WHISPER_FALLBACK_RUNTIME,
  LOCAL_WHISPER_FAST_RUNTIME,
  LOCAL_WHISPER_TINY_MODEL
} from "@/lib/providers";
import { MAX_DURATION_SECONDS, MAX_FILE_BYTES, MIN_DURATION_SECONDS } from "@/lib/upload-constraints";

const ACCEPTED_AUDIO = "audio/mpeg,audio/mp4,audio/wav,audio/webm,audio/ogg,audio/aac,.mp3,.m4a,.wav,.webm,.ogg,.aac";
type ProviderChoice = Extract<AnalysisProviderId, "gemini-cloud" | "local-whisper" | "local-ensemble">;
type LocalTranscriber = (audioUrl: string, options: Record<string, unknown>) => Promise<{ text: string; chunks?: WhisperTimestampChunk[] }>;
type LocalTranscriptionOutput = {
  text: string;
  chunks?: WhisperTimestampChunk[];
  runtimeLabel: string;
  model: LocalWhisperModel;
  comparisonSummary?: string;
};

const PROVIDER_OPTIONS: Array<{
  id: ProviderChoice;
  icon: React.ReactNode;
}> = [
  {
    id: "gemini-cloud",
    icon: <Cloud aria-hidden="true" size={18} />
  },
  {
    id: "local-whisper",
    icon: <Cpu aria-hidden="true" size={18} />
  },
  {
    id: "local-ensemble",
    icon: <GitCompareArrows aria-hidden="true" size={18} />
  }
];

const LOCAL_COMPARE_THRESHOLD = 82;
const localPipelineCache = new Map<string, Promise<LocalTranscriber>>();

type LocalFileState = {
  file: File;
  duration: number | null;
  objectUrl: string;
};

export function PronunciationLab() {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [fileState, setFileState] = useState<LocalFileState | null>(null);
  const [consent, setConsent] = useState(false);
  const [provider, setProvider] = useState<ProviderChoice>("local-whisper");
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState("Transcribing, scoring, and preparing feedback.");
  const [result, setResult] = useState<PronunciationAnalysis | null>(null);
  const [error, setError] = useState<string | null>(null);

  const localValidation = useMemo(() => validateLocalFile(fileState), [fileState]);
  const canAnalyze = Boolean(fileState && fileState.duration !== null && !localValidation && consent && !isAnalyzing);

  function reset() {
    if (fileState?.objectUrl) {
      URL.revokeObjectURL(fileState.objectUrl);
    }
    setFileState(null);
    setConsent(false);
    setResult(null);
    setError(null);
    setLoadingMessage("Transcribing, scoring, and preparing feedback.");
    if (inputRef.current) {
      inputRef.current.value = "";
    }
  }

  async function onFileSelected(file: File | undefined) {
    if (!file) {
      return;
    }

    if (fileState?.objectUrl) {
      URL.revokeObjectURL(fileState.objectUrl);
    }

    setResult(null);
    setError(null);
    const objectUrl = URL.createObjectURL(file);
    setFileState({ file, duration: null, objectUrl });

    const audio = document.createElement("audio");
    audio.preload = "metadata";
    audio.src = objectUrl;
    audio.onloadedmetadata = () => {
      setFileState((current) => current && current.objectUrl === objectUrl
        ? { ...current, duration: audio.duration }
        : current);
    };
    audio.onerror = () => {
      setError("Could not read this audio file in the browser.");
    };
  }

  async function analyze() {
    if (!fileState || fileState.duration === null || localValidation || !consent) {
      return;
    }

    setIsAnalyzing(true);
    setError(null);
    setResult(null);

    try {
      if (provider === "local-whisper" || provider === "local-ensemble") {
        setLoadingMessage("Loading local Whisper model. Trying the faster browser runtime first.");
        const output = provider === "local-ensemble"
          ? await transcribeWithAdaptiveLocalCompare(fileState.objectUrl, fileState.duration, setLoadingMessage)
          : await transcribeWithLocalWhisper(fileState.objectUrl, setLoadingMessage, LOCAL_WHISPER_TINY_MODEL);
        const analysis = buildLocalWhisperAnalysis({
          transcript: output.text,
          durationSeconds: fileState.duration,
          fileName: fileState.file.name,
          chunks: output.chunks,
          runtimeLabel: output.runtimeLabel,
          modelId: output.model.id,
          providerId: provider,
          comparisonSummary: output.comparisonSummary
        });
        setResult(analysis);
        return;
      }

      setLoadingMessage("Uploading to Gemini free tier and preparing structured feedback.");
      const formData = new FormData();
      formData.append("audio", fileState.file);
      formData.append("consent", "true");
      formData.append("provider", provider);

      const response = await fetch("/api/analyze", {
        method: "POST",
        body: formData
      });
      const payload = await response.json() as PronunciationAnalysis | AnalyzeError;

      if (!response.ok) {
        const problem = payload as AnalyzeError;
        throw new Error(problem.detail || problem.error || "Analysis failed.");
      }

      setResult(payload as PronunciationAnalysis);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Analysis failed.");
    } finally {
      setIsAnalyzing(false);
      setLoadingMessage("Transcribing, scoring, and preparing feedback.");
    }
  }

  return (
    <main className="app-shell">
      <section className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">Livo AI assessment</p>
            <h1>Pronunciation Agent</h1>
          </div>
        </header>

        <div className="tool-grid">
          <section className="input-panel" aria-label="Audio upload">
            <div className="panel-heading">
              <FileAudio aria-hidden="true" size={22} />
              <div>
                <h2>Audio sample</h2>
                <p>English speech, {MIN_DURATION_SECONDS}-{MAX_DURATION_SECONDS} seconds, up to 4 MB.</p>
              </div>
            </div>

            <div className="provider-control" role="radiogroup" aria-label="Analysis mode">
              {PROVIDER_OPTIONS.map((option) => {
                const metadata = ANALYSIS_PROVIDERS[option.id];
                const selected = provider === option.id;

                return (
                  <button
                    className="provider-option"
                    data-selected={selected}
                    key={option.id}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => {
                      setProvider(option.id);
                      setResult(null);
                      setError(null);
                    }}
                  >
                    <span className="provider-title">
                      {option.icon}
                      <strong>{metadata.label}</strong>
                      <small>{metadata.cost}</small>
                    </span>
                    <span>{metadata.quality}</span>
                    <small>{metadata.performance}</small>
                  </button>
                );
              })}
            </div>

            <button
              className="dropzone"
              type="button"
              onClick={() => inputRef.current?.click()}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                void onFileSelected(event.dataTransfer.files[0]);
              }}
            >
              <UploadCloud aria-hidden="true" size={28} />
              <span>{fileState ? fileState.file.name : "Choose audio"}</span>
              <small>MP3, M4A, WebM, WAV, OGG, AAC</small>
            </button>

            <input
              ref={inputRef}
              className="sr-only"
              type="file"
              accept={ACCEPTED_AUDIO}
              onChange={(event) => void onFileSelected(event.target.files?.[0])}
            />

            {fileState && (
              <div className="file-summary">
                <div>
                  <span>Duration</span>
                  <strong>{fileState.duration === null ? "Reading..." : `${fileState.duration.toFixed(1)}s`}</strong>
                </div>
                <div>
                  <span>Size</span>
                  <strong>{formatBytes(fileState.file.size)}</strong>
                </div>
              </div>
            )}

            {fileState && (
              <audio className="audio-preview" src={fileState.objectUrl} controls />
            )}

            {localValidation && (
              <p className="inline-alert">
                <AlertCircle aria-hidden="true" size={16} />
                {localValidation}
              </p>
            )}

            <label className="consent-row">
              <input
                type="checkbox"
                checked={consent}
                onChange={(event) => setConsent(event.target.checked)}
              />
              <span>
                I consent to temporary audio processing for this pronunciation report.
              </span>
            </label>

            <div className="actions">
              <button
                className="primary-action"
                type="button"
                disabled={!canAnalyze}
                onClick={() => void analyze()}
              >
                {isAnalyzing ? <Loader2 className="spin" aria-hidden="true" size={18} /> : <ShieldCheck aria-hidden="true" size={18} />}
                Analyze
              </button>
              <button className="icon-action" type="button" onClick={reset} aria-label="Reset">
                <RotateCcw aria-hidden="true" size={18} />
              </button>
            </div>

            {error && (
              <p className="error-box">
                <AlertCircle aria-hidden="true" size={17} />
                {error}
              </p>
            )}
          </section>

          <ResultView result={result} isLoading={isAnalyzing} loadingMessage={loadingMessage} />
        </div>

        <footer className="credit-footer">
          <span>Made by Nikhil</span>
          <Heart aria-hidden="true" size={16} fill="currentColor" />
        </footer>
      </section>
    </main>
  );
}

function validateLocalFile(fileState: LocalFileState | null) {
  if (!fileState) {
    return null;
  }

  if (fileState.file.size > MAX_FILE_BYTES) {
    return "Use a compressed file under 4 MB for the hosted demo.";
  }

  if (fileState.duration === null) {
    return null;
  }

  if (fileState.duration < MIN_DURATION_SECONDS || fileState.duration > MAX_DURATION_SECONDS) {
    return `Audio must be ${MIN_DURATION_SECONDS}-${MAX_DURATION_SECONDS} seconds.`;
  }

  return null;
}

function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) {
    return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function transcribeWithLocalWhisper(
  audioUrl: string,
  setStatus: (message: string) => void,
  model: LocalWhisperModel
): Promise<LocalTranscriptionOutput> {
  const { env, pipeline } = await import("@huggingface/transformers");
  env.allowLocalModels = false;
  env.allowRemoteModels = true;
  env.useBrowserCache = true;

  const runtimes = "gpu" in navigator
    ? [LOCAL_WHISPER_FAST_RUNTIME, LOCAL_WHISPER_FALLBACK_RUNTIME]
    : [LOCAL_WHISPER_FALLBACK_RUNTIME];

  let lastError: unknown = null;

  for (const runtime of runtimes) {
    try {
      setStatus(`Loading ${model.label} with ${runtime.label}.`);
      const transcriber = await getLocalTranscriber({ model, runtime, setStatus, pipeline });

      setStatus(`Transcribing with ${model.label} (${runtime.label}).`);
      const output = await transcriber(audioUrl, {
        return_timestamps: false,
        chunk_length_s: 30,
        stride_length_s: 5
      });

      return {
        ...(output as { text: string; chunks?: WhisperTimestampChunk[] }),
        runtimeLabel: runtime.label,
        model
      };
    } catch (error) {
      lastError = error;
      if (runtime.device === LOCAL_WHISPER_FAST_RUNTIME.device) {
        setStatus("Fast local runtime failed. Falling back to reliable CPU mode.");
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Local Whisper transcription failed.");
}

async function transcribeWithAdaptiveLocalCompare(
  audioUrl: string,
  durationSeconds: number,
  setStatus: (message: string) => void
): Promise<LocalTranscriptionOutput> {
  const candidates: LocalTranscriptCandidate[] = [];
  const [fastModel, largerModel] = LOCAL_WHISPER_COMPARE_MODELS;

  setStatus("Running fastest local model first.");
  const fastOutput = await transcribeWithLocalWhisper(audioUrl, setStatus, fastModel);
  const fastCandidate: LocalTranscriptCandidate = {
    model: fastOutput.model,
    transcript: fastOutput.text,
    runtimeLabel: fastOutput.runtimeLabel,
    chunks: fastOutput.chunks
  };
  candidates.push(fastCandidate);

  const fastScore = scoreLocalTranscriptCandidate({
    candidate: fastCandidate,
    durationSeconds
  });

  if (fastScore >= LOCAL_COMPARE_THRESHOLD) {
    return {
      ...fastOutput,
      comparisonSummary: `${fastModel.label} scored ${fastScore}/100 locally, so the slower ${largerModel.label} pass was skipped to minimize latency.`
    };
  }

  setStatus(`${fastModel.label} scored ${fastScore}/100. Running ${largerModel.label} for a second opinion.`);
  const largerOutput = await transcribeWithLocalWhisper(audioUrl, setStatus, LOCAL_WHISPER_BASE_MODEL);
  candidates.push({
    model: largerOutput.model,
    transcript: largerOutput.text,
    runtimeLabel: largerOutput.runtimeLabel,
    chunks: largerOutput.chunks
  });

  const selected = selectBestLocalTranscript({
    candidates,
    durationSeconds
  });

  return {
    text: selected.transcript,
    chunks: selected.chunks,
    runtimeLabel: selected.runtimeLabel,
    model: selected.model,
    comparisonSummary: selected.comparisonSummary ?? "Compared local transcripts and selected the strongest candidate."
  };
}

function getLocalTranscriber(input: {
  model: LocalWhisperModel;
  runtime: LocalWhisperRuntime;
  setStatus: (message: string) => void;
  pipeline: (task: "automatic-speech-recognition", model: string, options: Record<string, unknown>) => Promise<LocalTranscriber>;
}) {
  const cacheKey = `${input.model.id}:${input.runtime.label}`;
  const cached = localPipelineCache.get(cacheKey);
  if (cached) {
    input.setStatus(`Using cached ${input.model.label} (${input.runtime.label}).`);
    return cached;
  }

  const promise = input.pipeline("automatic-speech-recognition", input.model.id, {
    device: input.runtime.device,
    dtype: input.runtime.dtype,
    progress_callback: (progress: unknown) => {
      const record = progress as { status?: unknown; file?: unknown; progress?: unknown };
      if (record.status === "download" && typeof record.progress === "number") {
        input.setStatus(`Downloading ${input.model.label} files ${Math.round(record.progress)}%.`);
      } else if (record.status === "ready") {
        input.setStatus(`${input.model.label} ready. Transcribing audio.`);
      }
    }
  }) as Promise<LocalTranscriber>;

  localPipelineCache.set(cacheKey, promise);
  return promise;
}
