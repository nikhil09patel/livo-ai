# Livo Pronunciation Agent

End-to-end AI pronunciation assessment app for the Livo AI SWE assessment.

The app lets a user upload a 30-45 second English audio clip, validates the clip in the browser and server, transcribes it, scores pronunciation, highlights likely mistakes, and returns practice steps. It now supports a quality cloud path and a fully free local path.

## Stack

- Next.js App Router with a single `/api/analyze` server route
- Gemini API with Structured Outputs for the higher-quality limited-free-tier cloud mode
- Transformers.js Whisper in the browser for the completely free local mode
- Optional OpenAI Audio/Responses helper remains available behind the server route
- `music-metadata` for server-side duration checks
- No app database or object storage in the MVP

## Local Setup

```bash
pnpm install
cp .env.example .env.local
```

For the completely free local modes, no API key is required. `Free local` uses `Xenova/whisper-tiny.en` for the lowest latency. `Smart compare` runs `tiny.en` first, scores transcript quality locally, and only runs `Xenova/whisper-base.en` when the fast transcript looks weak enough to justify the extra latency. The first run downloads model files into the browser cache.

For the quality cloud mode, create a Gemini API key in Google AI Studio and set `GEMINI_API_KEY` in `.env.local`.
The default cloud model is `gemini-2.5-flash`, with `gemini-2.5-flash-lite` as an automatic fallback for temporary demand or quota errors.

```bash
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000).

## Validation

```bash
pnpm test
pnpm build
```

## Deploy With Vercel

The repo is ready for Vercel. The API route exports `maxDuration = 60` for the AI processing call.

```bash
npm i -g vercel
vercel login
vercel link
vercel env add GEMINI_API_KEY production
vercel deploy --prod
```

If using GitHub integration, push the repo to GitHub first, import the repository in Vercel, and add `GEMINI_API_KEY` in Project Settings -> Environment Variables.

## Push To GitHub

Create an empty GitHub repository, then run:

```bash
git remote add origin git@github.com:<your-user>/<your-repo>.git
git add .
git commit -m "Build pronunciation assessment agent"
git push -u origin main
```

## Notes

- Hosted uploads are limited to 4 MB because Vercel Functions have a 4.5 MB request/response body limit. A production version should upload larger files directly to object storage and pass a short-lived URL to the backend.
- Local mode stores no user audio and does not upload audio to the app server.
- Quality cloud mode holds audio in memory for the request, uploads it to Gemini Files API for analysis, and attempts to delete the temporary Gemini file after the response.
- `GEMINI_MODEL`, `GEMINI_MODEL_FALLBACKS`, `OPENAI_TRANSCRIBE_MODEL`, and `OPENAI_ANALYSIS_MODEL` can be changed without code edits.
