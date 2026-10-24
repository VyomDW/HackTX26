export const env = {
  port: Number(process.env.PORT ?? 8787),
  clientOrigin: process.env.CLIENT_ORIGIN ?? "http://localhost:5173",
  museApiKey: process.env.MUSE_API_KEY ?? "",
  museBaseUrl: process.env.MUSE_BASE_URL ?? "",
  serpApiKey: process.env.SERPAPI_KEY ?? "",
};
