import { parseBuffer } from "music-metadata";
import { MAX_DURATION_SECONDS, MAX_FILE_BYTES, MIN_DURATION_SECONDS } from "@/lib/upload-constraints";

const ALLOWED_MIME_PREFIXES = ["audio/"];
const ALLOWED_EXTENSIONS = [".mp3", ".m4a", ".mp4", ".mpeg", ".wav", ".webm", ".ogg", ".aac"];

export type AudioValidation = {
  ok: true;
  durationSeconds: number;
} | {
  ok: false;
  message: string;
};

export function isAllowedAudioType(fileName: string, mimeType: string) {
  const lowerName = fileName.toLowerCase();
  const hasAudioMime = ALLOWED_MIME_PREFIXES.some((prefix) => mimeType.startsWith(prefix));
  const hasAllowedExtension = ALLOWED_EXTENSIONS.some((extension) => lowerName.endsWith(extension));
  return hasAudioMime || hasAllowedExtension;
}

export async function readDurationSeconds(buffer: Buffer, mimeType: string) {
  const metadata = await parseBuffer(buffer, { mimeType, size: buffer.byteLength });
  return metadata.format.duration ?? null;
}

export function validateAudioUpload(input: {
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  durationSeconds: number | null;
}): AudioValidation {
  if (!isAllowedAudioType(input.fileName, input.mimeType)) {
    return {
      ok: false,
      message: "Upload an audio file in MP3, M4A, WAV, WebM, OGG, or AAC format."
    };
  }

  if (input.sizeBytes > MAX_FILE_BYTES) {
    return {
      ok: false,
      message: `The hosted demo accepts audio up to 4 MB. Use MP3, M4A, or WebM for a ${MIN_DURATION_SECONDS}-${MAX_DURATION_SECONDS} second sample.`
    };
  }

  if (input.durationSeconds === null || Number.isNaN(input.durationSeconds)) {
    return {
      ok: false,
      message: "Could not read the audio duration. Try exporting the clip as MP3, M4A, or WebM."
    };
  }

  if (input.durationSeconds < MIN_DURATION_SECONDS || input.durationSeconds > MAX_DURATION_SECONDS) {
    return {
      ok: false,
      message: `Audio must be between ${MIN_DURATION_SECONDS} and ${MAX_DURATION_SECONDS} seconds.`
    };
  }

  return {
    ok: true,
    durationSeconds: input.durationSeconds
  };
}
