export const env = {
  port: Number(process.env.PORT ?? 8787),
  clientOrigin: process.env.CLIENT_ORIGIN ?? "http://localhost:5173",
  museApiKey: process.env.MUSE_API_KEY ?? "",
  museBaseUrl: process.env.MUSE_BASE_URL || "https://api.meta.ai/v1",
  museModel: process.env.MUSE_MODEL || "muse-spark-1.3",
  /** Path to a recorded NDJSON response to replay instead of calling Muse (tests, offline demo). */
  museFixture: process.env.MUSE_FIXTURE ?? "",
  // Separate so voice can run for real while Muse Spark is still on its mock.
  museVoiceApiKey: process.env.MUSE_VOICE_API_KEY || process.env.MUSE_API_KEY || "",
  museVoiceUrl: process.env.MUSE_VOICE_URL || "https://api.meta.ai/v1/asr/transcribe",
  serpApiKey: process.env.SERPAPI_KEY ?? "",
};
