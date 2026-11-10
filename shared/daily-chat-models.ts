/** Explicit opt-in IDs: old stored model IDs retain their existing routing behavior. */
export const DAILY_CHAT_MODEL_IDS = [
  "chat:openai:gpt-4o-mini",
  "chat:deepseek:deepseek-chat",
  "chat:nvidia:nemotron-super-49b",
  "chat:gemini:gemini-2.5-flash",
] as const;
export type DailyChatModelId = typeof DAILY_CHAT_MODEL_IDS[number];
export type DailyChatProvider = "openai" | "deepseek" | "nvidia" | "gemini";
export const DAILY_CHAT_MODELS: readonly {
  id: DailyChatModelId; provider: DailyChatProvider; label: string; model: string;
}[] = [
  { id: DAILY_CHAT_MODEL_IDS[0], provider: "openai", label: "OpenAI · GPT-4o Mini", model: "gpt-4o-mini" },
  { id: DAILY_CHAT_MODEL_IDS[1], provider: "deepseek", label: "DeepSeek · Chat", model: "deepseek-chat" },
  { id: DAILY_CHAT_MODEL_IDS[2], provider: "nvidia", label: "NVIDIA · Nemotron Super 49B", model: "nvidia/llama-3.3-nemotron-super-49b-v1" },
  { id: DAILY_CHAT_MODEL_IDS[3], provider: "gemini", label: "Google · Gemini 2.5 Flash", model: "gemini-2.5-flash" },
];
/** Unknown reserved IDs must also enter the strict path and fail closed, never the legacy fallback. */
export const usesSelectedDailyChat = (value: unknown): boolean => typeof value === "string" && value.startsWith("chat:");
