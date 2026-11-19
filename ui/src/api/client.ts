/**
 * Sheep Native API Client
 * Binds to Rust server (http://127.0.0.1:7850) or current host
 */

export interface ModelInfo {
  model_name: string;
  loader: string;
}

export interface ModelListResponse {
  model_names: string[];
}

export interface ChatMessagePayload {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface GenerationConfig {
  temperature?: number;
  top_p?: number;
  min_p?: number;
  top_k?: number;
  repetition_penalty?: number;
  presence_penalty?: number;
  frequency_penalty?: number;
  max_tokens?: number;
  stream?: boolean;
}

class ApiService {
  private getBaseUrl(): string {
    if (typeof window !== 'undefined' && window.location.origin.startsWith('http')) {
      return '';
    }
    return 'http://127.0.0.1:7850';
  }

  private getHeaders(): Record<string, string> {
    const token = localStorage.getItem('sheep_session_token');
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    return headers;
  }

  // Model Operations
  async listModels(): Promise<string[]> {
    const res = await fetch(`${this.getBaseUrl()}/v1/internal/model/list`, {
      headers: this.getHeaders(),
    });
    if (!res.ok) throw new Error('Failed to fetch available models');
    const data: ModelListResponse = await res.json();
    return data.model_names || [];
  }

  async getModelInfo(): Promise<ModelInfo | null> {
    const res = await fetch(`${this.getBaseUrl()}/v1/internal/model/info`, {
      headers: this.getHeaders(),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.model_name ? data : null;
  }

  async loadModel(modelName: string, loaderArgs?: Record<string, unknown>): Promise<void> {
    const res = await fetch(`${this.getBaseUrl()}/v1/internal/model/load`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({
        model_name: modelName,
        args: loaderArgs || {},
      }),
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Failed to load model ${modelName}: ${err}`);
    }
  }

  async unloadModel(): Promise<void> {
    const res = await fetch(`${this.getBaseUrl()}/v1/internal/model/unload`, {
      method: 'POST',
      headers: this.getHeaders(),
    });
    if (!res.ok) {
      throw new Error('Failed to unload model');
    }
  }

  // Text Generation & Streaming
  async streamChat(
    messages: ChatMessagePayload[],
    config: GenerationConfig,
    onToken: (token: string) => void,
    onComplete: () => void,
    onError: (err: Error) => void,
    signal?: AbortSignal
  ): Promise<void> {
    try {
      const res = await fetch(`${this.getBaseUrl()}/v1/chat/completions`, {
        method: 'POST',
        headers: this.getHeaders(),
        signal,
        body: JSON.stringify({
          messages,
          stream: true,
          temperature: config.temperature ?? 0.7,
          top_p: config.top_p ?? 0.9,
          max_tokens: config.max_tokens ?? 2048,
          repetition_penalty: config.repetition_penalty ?? 1.15,
        }),
      });

      if (!res.ok) {
        throw new Error(`Generation error HTTP ${res.status}: ${await res.text()}`);
      }

      const reader = res.body?.getReader();
      if (!reader) throw new Error('ReadableStream not supported by response');

      const decoder = new TextDecoder('utf-8');
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith('data:')) continue;
          const payload = trimmed.replace(/^data:\s*/, '');
          if (payload === '[DONE]') {
            onComplete();
            return;
          }

          try {
            const parsed = JSON.parse(payload);
            const delta = parsed.choices?.[0]?.delta?.content;
            if (delta) {
              onToken(delta);
            }
          } catch {
            // Ignore incomplete chunk
          }
        }
      }

      onComplete();
    } catch (err: unknown) {
      if ((err as Error).name === 'AbortError') {
        onComplete();
      } else {
        onError(err as Error);
      }
    }
  }

  async stopGeneration(): Promise<void> {
    try {
      await fetch(`${this.getBaseUrl()}/v1/internal/stop-generation`, {
        method: 'POST',
        headers: this.getHeaders(),
      });
    } catch {
      // Ignore network cancellation errors on stop
    }
  }
}

export const api = new ApiService();
