import { settings } from "../core/settings";
import { httpRequest } from "../util/http";
import { log } from "../core/context";

/** Port of com.bmo.devai.intellij.rag.models.RagMemoryEntry. */
export interface RagMemoryEntry {
  id?: number;
  content: string;
  metadata?: Record<string, unknown>;
  score?: number;
}

/**
 * Port of RagService / RagServiceImpl — HTTP client for the DevAI RAG API.
 * Semantic search over stored code memories, injected into prompts.
 */
export class RagService {
  private static _instance: RagService | undefined;
  static getInstance(): RagService {
    if (!RagService._instance) RagService._instance = new RagService();
    return RagService._instance;
  }

  isEnabled(): boolean {
    const s = settings();
    return s.isRagEnabled() && s.getRagServerUrl().trim().length > 0;
  }

  async isAvailable(): Promise<boolean> {
    if (!this.isEnabled()) return false;
    try {
      const url = this.baseUrl() + "/api/rag?limit=1&offset=0";
      const res = await httpRequest(url, { headers: this.headers(), timeoutMs: settings().getRagTimeoutMs() });
      return res.ok;
    } catch {
      return false;
    }
  }

  private baseUrl(): string {
    return settings().getRagServerUrl().replace(/\/$/, "");
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = { Accept: "application/json" };
    const key = settings().getRagApiKey();
    if (key) h["Authorization"] = `Bearer ${key}`;
    return h;
  }

  async search(query: string, topK: number): Promise<RagMemoryEntry[]> {
    if (!this.isEnabled()) return [];
    try {
      const url = `${this.baseUrl()}/api/rag/search?q=${encodeURIComponent(query)}&topK=${topK}`;
      const res = await httpRequest(url, { headers: this.headers(), timeoutMs: settings().getRagTimeoutMs() });
      if (!res.ok) return [];
      const parsed = JSON.parse(res.body);
      const arr: unknown[] = Array.isArray(parsed) ? parsed : (parsed?.results ?? parsed?.data ?? []);
      return arr
        .map((r) => this.toEntry(r))
        .filter((e): e is RagMemoryEntry => e !== null);
    } catch (e) {
      log("RAG search failed (non-blocking): " + (e instanceof Error ? e.message : String(e)));
      return [];
    }
  }

  private toEntry(r: unknown): RagMemoryEntry | null {
    if (!r || typeof r !== "object") return null;
    const o = r as Record<string, unknown>;
    const content = (o.content ?? o.text ?? o.memory ?? "") as string;
    if (!content) return null;
    return {
      id: typeof o.id === "number" ? o.id : undefined,
      content,
      metadata: (o.metadata as Record<string, unknown>) ?? undefined,
      score: typeof o.score === "number" ? o.score : undefined,
    };
  }

  formatExamplesForPrompt(examples: RagMemoryEntry[], maxChars: number): string {
    if (examples.length === 0) return "";
    let out = "\n## Relevant Examples & Standards (from RAG)\n";
    for (let i = 0; i < examples.length; i++) {
      const block = `\n### Example ${i + 1}\n\`\`\`\n${examples[i].content}\n\`\`\`\n`;
      if (out.length + block.length > maxChars) break;
      out += block;
    }
    return out.trim();
  }

  extractCodeSummary(sourceCode: string): string {
    if (!sourceCode) return "";
    const ids = new Set<string>();
    const re = /\b(?:class|interface|enum|struct|def|function|func|public|private|protected)\s+([A-Za-z_][A-Za-z0-9_]*)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(sourceCode)) !== null && ids.size < 20) {
      ids.add(m[1]);
    }
    return Array.from(ids).join(" ");
  }
}
