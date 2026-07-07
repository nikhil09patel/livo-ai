import { readDurationSeconds, validateAudioUpload } from "@/lib/audio";
import { analyzeWithGemini } from "@/lib/gemini";
import { analyzePronunciation } from "@/lib/openai";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const consent = formData.get("consent");
    const audio = formData.get("audio");
    const provider = formData.get("provider") || "gemini-cloud";

    if (consent !== "true") {
      return Response.json(
        { error: "Consent is required before processing audio." },
        { status: 400 }
      );
    }

    if (!(audio instanceof File)) {
      return Response.json(
        { error: "Upload an audio file." },
        { status: 400 }
      );
    }

    const buffer = Buffer.from(await audio.arrayBuffer());
    const durationSeconds = await readDurationSeconds(buffer, audio.type);
    const validation = validateAudioUpload({
      fileName: audio.name,
      mimeType: audio.type,
      sizeBytes: audio.size,
      durationSeconds
    });

    if (!validation.ok) {
      return Response.json(
        { error: validation.message },
        { status: 400 }
      );
    }

    const analysisInput = {
      buffer,
      fileName: audio.name,
      mimeType: audio.type,
      durationSeconds: validation.durationSeconds
    };

    const analysis = provider === "openai"
      ? await analyzePronunciation(analysisInput)
      : await analyzeWithGemini(analysisInput);

    return Response.json(analysis);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected analysis failure.";
    const configurationError = message.includes("OPENAI_API_KEY") || message.includes("GEMINI_API_KEY");
    const status = configurationError ? 500 : 502;

    return Response.json(
      {
        error: configurationError
          ? "The selected cloud provider API key is not configured on the server."
          : "Could not analyze the audio.",
        detail: message
      },
      { status }
    );
  }
}
