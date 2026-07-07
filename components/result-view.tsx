"use client";

import { Activity, BadgeCheck, ListChecks, MessageSquareText, Timer } from "lucide-react";
import type { PronunciationAnalysis, PronunciationMistake } from "@/types/analysis";

export function ResultView({
  result,
  isLoading,
  loadingMessage = "Transcribing, scoring, and preparing feedback."
}: {
  result: PronunciationAnalysis | null;
  isLoading: boolean;
  loadingMessage?: string;
}) {
  if (isLoading) {
    return (
      <section className="result-panel" aria-live="polite">
        <div className="empty-state active">
          <Activity aria-hidden="true" size={32} />
          <h2>Analyzing speech</h2>
          <p>{loadingMessage}</p>
        </div>
      </section>
    );
  }

  if (!result) {
    return (
      <section className="result-panel" aria-live="polite">
        <div className="empty-state">
          <MessageSquareText aria-hidden="true" size={32} />
          <h2>Report</h2>
          <p>Score, highlighted mistakes, and practice steps appear here.</p>
        </div>
      </section>
    );
  }

  return (
    <section className="result-panel" aria-live="polite">
      <div className="score-row">
        <div className="score-ring" style={{ "--score": result.score } as React.CSSProperties}>
          <strong>{result.score}</strong>
          <span>/100</span>
        </div>
        <div>
          <p className="eyebrow">Pronunciation score</p>
          <h2>{result.scoreLabel}</h2>
          <p className="summary">{result.summary}</p>
        </div>
      </div>

      <div className="metric-strip">
        <Metric icon={<Timer aria-hidden="true" size={17} />} label="Duration" value={`${result.metadata.durationSeconds}s`} />
        <Metric icon={<Activity aria-hidden="true" size={17} />} label="Pace" value={`${result.metadata.wordsPerMinute} wpm`} />
        <Metric icon={<BadgeCheck aria-hidden="true" size={17} />} label="Words" value={`${result.metadata.wordCount}`} />
      </div>

      <div className="provider-summary">
        <div>
          <span>Mode</span>
          <strong>{result.metadata.provider.label}</strong>
        </div>
        <div>
          <span>Cost</span>
          <strong>{result.metadata.provider.cost}</strong>
        </div>
        <div>
          <span>Model</span>
          <strong>{result.metadata.models.transcription}</strong>
        </div>
        <p>{result.metadata.provider.performance}</p>
      </div>

      <div className="breakdown">
        <BreakdownBar label="Pronunciation" value={result.breakdown.pronunciationConfidence} />
        <BreakdownBar label="Clarity" value={result.breakdown.clarity} />
        <BreakdownBar label="Fluency" value={result.breakdown.fluency} />
        <BreakdownBar label="Pace" value={result.breakdown.pace} />
      </div>

      <section className="transcript-block">
        <div className="section-title">
          <MessageSquareText aria-hidden="true" size={18} />
          <h3>Transcript</h3>
        </div>
        <p>{highlightTranscript(result.transcript, result.mistakes)}</p>
      </section>

      <section className="mistake-list">
        <div className="section-title">
          <ListChecks aria-hidden="true" size={18} />
          <h3>Highlighted mistakes</h3>
        </div>
        <div className="mistake-grid">
          {result.mistakes.map((mistake, index) => (
            <article className="mistake-card" key={`${mistake.text}-${index}`}>
              <div className="mistake-meta">
                <span>{mistake.category.replaceAll("_", " ")}</span>
                <strong data-severity={mistake.severity}>{mistake.severity}</strong>
              </div>
              <h4>{mistake.text}</h4>
              <p>{mistake.reason}</p>
              <small>{mistake.suggestion}</small>
            </article>
          ))}
        </div>
      </section>

      <section className="practice-block">
        <div className="section-title">
          <BadgeCheck aria-hidden="true" size={18} />
          <h3>Practice plan</h3>
        </div>
        <ol>
          {result.practicePlan.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ol>
      </section>

      <p className="privacy-note">{result.complianceNote}</p>
    </section>
  );
}

function Metric({
  icon,
  label,
  value
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="metric">
      {icon}
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function BreakdownBar({ label, value }: { label: string; value: number }) {
  return (
    <div className="bar-row">
      <span>{label}</span>
      <div className="bar-track">
        <div className="bar-fill" style={{ width: `${value}%` }} />
      </div>
      <strong>{value}</strong>
    </div>
  );
}

function highlightTranscript(transcript: string, mistakes: PronunciationMistake[]) {
  const targets = mistakes
    .map((mistake) => mistake.text)
    .filter((text) => text.length > 2 && !["overall pace", "fillers"].includes(text.toLowerCase()))
    .sort((a, b) => b.length - a.length);

  if (targets.length === 0) {
    return transcript;
  }

  const escaped = targets.map(escapeRegExp);
  const matcher = new RegExp(`(${escaped.join("|")})`, "gi");
  const parts = transcript.split(matcher);

  return parts.map((part, index) => {
    const isMatch = targets.some((target) => target.toLowerCase() === part.toLowerCase());
    return isMatch ? <mark key={`${part}-${index}`}>{part}</mark> : part;
  });
}

function escapeRegExp(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
