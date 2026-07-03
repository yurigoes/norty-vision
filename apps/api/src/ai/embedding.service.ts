import { Injectable, Logger } from "@nestjs/common";

/**
 * Geração de embeddings para o RAG semântico (Fase 2b).
 *
 * Provider-agnóstico via endpoint OpenAI-compatible (`POST /v1/embeddings`):
 *   - Ollama local (recomendado, dado fica na VPS): EMBEDDINGS_URL=http://ollama:11434
 *     EMBEDDINGS_MODEL=bge-m3
 *   - ou qualquer API compatível (OpenAI/Cloudflare): setar URL + API key.
 *
 * SEGURO: se EMBEDDINGS_URL não estiver configurado, `enabled()` é false e
 * `embed()` retorna null — o sistema cai no full-text, sem quebrar nada.
 * Dimensão fixada em 1024 (bge-m3); vetores de outra dimensão são descartados.
 */
@Injectable()
export class EmbeddingService {
  private readonly logger = new Logger("Embeddings");
  private readonly url = (process.env.EMBEDDINGS_URL ?? "").replace(/\/+$/, "");
  private readonly model = process.env.EMBEDDINGS_MODEL ?? "bge-m3";
  private readonly apiKey = process.env.EMBEDDINGS_API_KEY ?? "";
  readonly dim = Number(process.env.EMBEDDINGS_DIM ?? 1024);

  enabled(): boolean {
    return !!this.url;
  }

  /** Gera o embedding de um texto. null se desligado ou em qualquer falha. */
  async embed(text: string): Promise<number[] | null> {
    if (!this.enabled() || !text?.trim()) return null;
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 10000);
      const res = await fetch(`${this.url}/v1/embeddings`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}) },
        body: JSON.stringify({ model: this.model, input: text.slice(0, 4000) }),
        signal: ctrl.signal,
      });
      clearTimeout(t);
      if (!res.ok) { this.logger.warn(`embed HTTP ${res.status}`); return null; }
      const data = (await res.json()) as any;
      const vec: number[] | undefined = data?.data?.[0]?.embedding ?? data?.embedding ?? data?.embeddings?.[0];
      if (!Array.isArray(vec) || vec.length !== this.dim) {
        if (Array.isArray(vec)) this.logger.warn(`embed dim ${vec.length} != ${this.dim} (modelo incompatível)`);
        return null;
      }
      return vec;
    } catch (e: any) {
      this.logger.warn(`embed falhou: ${e?.message ?? e}`);
      return null;
    }
  }

  /** Formata o vetor pro literal do pgvector: [v1,v2,...]. */
  toLiteral(vec: number[]): string {
    return `[${vec.join(",")}]`;
  }
}
