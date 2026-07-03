import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

export type Intent =
  | "confirm"
  | "reschedule"
  | "cancel"
  | "question"
  | "opt_out"
  | "unknown";

export interface ClassifyResult {
  intent: Intent;
  score: number;          // 0..1 confianca da melhor intencao
  classifiedBy: "exact" | "keywords" | "llm" | "manual";
  candidates: Array<{ intent: Intent; score: number }>;
}

const THRESHOLD_AUTO = 0.7;      // acima disso, classifica auto
const THRESHOLD_AMBIGUOUS = 0.3; // abaixo de THRESHOLD_AUTO mas acima disso, joga em unresolved

@Injectable()
export class NluService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Classifica uma mensagem usando intent_keywords hierarquico:
   *  global (org=NULL, store=NULL)
   *  org (store=NULL)
   *  store
   *
   * Regras de mais especificas vencem em caso de empate.
   */
  async classify(opts: {
    organizationId?: string | null;
    storeId?: string | null;
    text: string;
  }): Promise<ClassifyResult> {
    const text = this.normalize(opts.text);

    const keywords = await this.prisma.runWithContext(
      { isPlatformAdmin: true },
      (tx) =>
        tx.intentKeyword.findMany({
          where: {
            isActive: true,
            OR: [
              { organizationId: null, storeId: null },
              ...(opts.organizationId
                ? [{ organizationId: opts.organizationId, storeId: null }]
                : []),
              ...(opts.organizationId && opts.storeId
                ? [{ organizationId: opts.organizationId, storeId: opts.storeId }]
                : []),
            ],
          },
        }),
    );

    // soma scores por intent
    const scoresByIntent: Record<string, number> = {};

    for (const kw of keywords) {
      const k = this.normalize(kw.keyword);
      let hit = false;
      switch (kw.matchType) {
        case "exact":
          hit = text === k;
          break;
        case "starts_with":
          hit = text.startsWith(k);
          break;
        case "regex":
          try {
            hit = new RegExp(kw.keyword, "i").test(opts.text);
          } catch {
            hit = false;
          }
          break;
        case "contains":
        default:
          hit = text.includes(k);
      }
      if (hit) {
        scoresByIntent[kw.intent] = (scoresByIntent[kw.intent] ?? 0) + kw.weight;
      }
    }

    // normaliza scores pro range 0..1 (cap em 1)
    const candidates = Object.entries(scoresByIntent)
      .map(([intent, score]) => ({ intent: intent as Intent, score: Math.min(1, score) }))
      .sort((a, b) => b.score - a.score);

    const top = candidates[0];
    if (!top) {
      return {
        intent: "unknown",
        score: 0,
        classifiedBy: "keywords",
        candidates: [],
      };
    }

    return {
      intent: top.score >= THRESHOLD_AUTO ? top.intent : "unknown",
      score: top.score,
      classifiedBy: "keywords",
      candidates: candidates.slice(0, 3),
    };
  }

  /** Determina se a resposta merece ir pra fila de revisao manual. */
  isAmbiguous(result: ClassifyResult): boolean {
    const top = result.candidates[0];
    return (
      result.intent === "unknown" &&
      top !== undefined &&
      top.score >= THRESHOLD_AMBIGUOUS
    );
  }

  private normalize(s: string): string {
    return s
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }
}
