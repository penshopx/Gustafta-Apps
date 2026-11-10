import OpenAI from "openai";
import { DAILY_CHAT_MODELS, type DailyChatProvider } from "@shared/daily-chat-models";

type Message = OpenAI.Chat.Completions.ChatCompletionMessageParam;
type Options = { temperature?: number; maxTokens?: number; jsonMode?: boolean; timeoutMs?: number; signal?: AbortSignal; requiredModel?: string };
type ClientConfig = { apiKey: string; baseURL: string; timeout: number; maxRetries: 0; organization: null; project: null };
type Dependencies = {
  keyForProvider: (provider: DailyChatProvider) => string | undefined;
  createClient: (config: ClientConfig) => Pick<OpenAI, "chat">;
};
const endpoints: Record<DailyChatProvider, string> = {
  openai: "https://api.openai.com/v1",
  deepseek: "https://api.deepseek.com/v1",
  nvidia: "https://integrate.api.nvidia.com/v1",
  gemini: "https://generativelanguage.googleapis.com/v1beta/openai/",
};
export const SELECTED_DAILY_CHAT_KEY_NAMES = {
  openai: "OPENAI_API_KEY", deepseek: "DEEPSEEK_API_KEY", nvidia: "NVIDIA_API_KEY", gemini: "GEMINI_API_KEY",
} as const;
export class SelectedDailyChatError extends Error {
  readonly statusCode = 503;
  constructor() {
    super("Model chat pilihan tidak tersedia atau gagal merespons. Tidak ada perpindahan provider otomatis.");
    this.name = "SelectedDailyChatError";
  }
}
const unavailable = () => new SelectedDailyChatError();

/** One explicit provider, fixed endpoint/model, no SDK retries, no alternate credentials or providers. */
export function createSelectedDailyChat(dependencies: Dependencies = {
  keyForProvider: provider => process.env[SELECTED_DAILY_CHAT_KEY_NAMES[provider]],
  createClient: config => new OpenAI(config),
}) {
  function prepare(id: string, messages: Message[], options: Options) {
    const model = DAILY_CHAT_MODELS.find(item => item.id === id);
    if (!model || options.signal?.aborted) throw unavailable();
    if (options.requiredModel && options.requiredModel !== id && options.requiredModel !== model.model) throw unavailable();
    if ((model.provider === "deepseek" || model.provider === "nvidia") &&
        messages.some(message => typeof message.content !== "string")) throw unavailable();
    const key = dependencies.keyForProvider(model.provider);
    if (!key) throw unavailable();
    const timeout = Math.min(45_000, Math.max(1, options.timeoutMs ?? 45_000));
    const controller = new AbortController();
    const abort = () => controller.abort();
    options.signal?.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(abort, timeout);
    const dispose = () => {
      clearTimeout(timer); controller.abort();
      options.signal?.removeEventListener("abort", abort);
    };
    try {
      const client = dependencies.createClient({
        apiKey: key, baseURL: endpoints[model.provider], maxRetries: 0, timeout, organization: null, project: null,
      });
      const params = {
        model: model.model, messages,
        temperature: Math.min(2, Math.max(0, options.temperature ?? 0.7)),
        max_tokens: Math.min(4096, Math.max(100, options.maxTokens ?? 1024)),
        ...(options.jsonMode ? { response_format: { type: "json_object" as const } } : {}),
      };
      return { client, params, signal: controller.signal, dispose };
    } catch { dispose(); throw unavailable(); }
  }

  async function complete(id: string, messages: Message[], options: Options = {}): Promise<string> {
    let request: ReturnType<typeof prepare> | undefined;
    try {
      request = prepare(id, messages, options);
      const result = await request.client.chat.completions.create(request.params, { signal: request.signal });
      const choice = result.choices[0];
      if (request.signal.aborted || !choice?.message.content?.trim() ||
          (choice.finish_reason !== "stop" && choice.finish_reason !== "length")) throw unavailable();
      return choice.message.content;
    } catch { throw unavailable(); }
    finally { request?.dispose(); }
  }

  async function* stream(id: string, messages: Message[], options: Options = {}): AsyncGenerator<{ content: string }> {
    let request: ReturnType<typeof prepare> | undefined;
    try {
      request = prepare(id, messages, options);
      const result = await request.client.chat.completions.create({ ...request.params, stream: true }, { signal: request.signal });
      let hasText = false, terminal = false;
      for await (const chunk of result) {
        if (request.signal.aborted) throw unavailable();
        const choice = chunk.choices[0];
        if (choice?.finish_reason) {
          if (choice.finish_reason !== "stop" && choice.finish_reason !== "length") throw unavailable();
          terminal = true;
        }
        const content = choice?.delta.content;
        if (content) { if (content.trim()) hasText = true; yield { content }; }
      }
      if (request.signal.aborted || !hasText || !terminal) throw unavailable();
    } catch { throw unavailable(); }
    finally { request?.dispose(); }
  }
  return { complete, stream };
}
const runtime = createSelectedDailyChat();
export const completeSelectedDailyChat = runtime.complete;
export const streamSelectedDailyChat = runtime.stream;
