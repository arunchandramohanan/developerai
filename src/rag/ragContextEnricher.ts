import { AIRequest, OperationType, operationRagEligible, operationShortName } from "../models";
import { RagService } from "./ragService";
import { log } from "../core/context";

/**
 * Port of com.bmo.devai.intellij.rag.RagContextEnricher.
 * The single entry point that injects RAG examples into SDK prompts.
 */
const MAX_PROMPT_CHARS = 1500;

export async function enrich(
  operationType: OperationType,
  fileName: string,
  sourceCode: string,
  language: string
): Promise<string | null> {
  if (!operationRagEligible(operationType)) {
    log(`RAG skipped — operation '${operationShortName(operationType)}' is not RAG-eligible`);
    return null;
  }
  return doEnrich(operationShortName(operationType), fileName, sourceCode, language);
}

async function doEnrich(taskType: string, fileName: string, sourceCode: string, language: string): Promise<string | null> {
  const rag = RagService.getInstance();
  if (!rag.isEnabled()) return null;
  try {
    const codeSummary = rag.extractCodeSummary(sourceCode);
    const query = `${taskType} ${language} ${fileName} ${codeSummary}`;
    const results = await rag.search(query, 3);
    if (results.length === 0) return null;
    const formatted = rag.formatExamplesForPrompt(results, MAX_PROMPT_CHARS);
    return formatted.trim().length === 0 ? null : formatted;
  } catch (e) {
    log("RAG enrichment failed, continuing without RAG: " + (e instanceof Error ? e.message : String(e)));
    return null;
  }
}

/**
 * Central RAG hook for the SDK executor: returns the request with RAG examples
 * appended to the prompt, or the original request unchanged.
 */
export async function enrichWithRag(request: AIRequest): Promise<AIRequest> {
  const selection = request.codeSelection;
  const fileName = selection?.filePath ?? "";
  const sourceCode = selection?.text ?? "";
  const language = selection?.languageName ?? "";
  const ragExamples = await enrich(request.operationType, fileName, sourceCode, language);
  if (!ragExamples || ragExamples.trim().length === 0) return request;
  return { ...request, prompt: request.prompt + "\n" + ragExamples };
}

export async function isRagAvailable(): Promise<boolean> {
  const rag = RagService.getInstance();
  if (!rag.isEnabled()) return false;
  return rag.isAvailable();
}
