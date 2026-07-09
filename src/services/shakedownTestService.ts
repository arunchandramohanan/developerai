import * as path from "path";
import { OperationType, newRequest } from "../models";
import { executeForContent } from "../core/copilotService";
import { ModeManager } from "../core/modeManager";
import { DevAIException } from "../util/exception";
import { parseJsonLenient } from "../util/json";
import { readFileContent, resolveAvailableMarkdownPath } from "../util/response";

/**
 * Port of com.bmo.devai.intellij.services.impl.ShakedownTestServiceImpl.
 *
 * The shakedown-test-generation.md SDK template instructs the agent to read
 * the spec file itself via its `view` tool and (per the prompt text) "save"
 * the generated Postman collection — but the CLI is invoked with
 * --available-tools=view,grep,glob (read-only, see core/sdkExecutor.ts), so
 * no tool can actually write it to disk. The Java implementation only ever
 * persists the raw LLM response as a `*-shakedown-response.md` log, despite
 * its success notification claiming the `*-collection.json` was also
 * created. This port keeps that same faithful behavior but additionally
 * attempts to parse a Postman collection JSON blob out of the response and,
 * when found, really does write it to `*-collection.json` — see
 * generateShakedownSuite()'s deviation note below.
 */

export interface ShakedownResult {
  responseContent: string;
  responseMarkdownPath: string;
  collectionPath: string | null;
  collectionJson: unknown | null;
}

/** Port of ShakedownTestServiceImpl.validateJsonSpec. */
function validateJsonSpec(content: string): boolean {
  try {
    const root = JSON.parse(content) as unknown;
    if (typeof root !== "object" || root === null || Array.isArray(root)) return false;
    const obj = root as Record<string, unknown>;
    const hasRootKey = "openapi" in obj || "swagger" in obj;
    const hasPaths = "paths" in obj;
    return hasRootKey && hasPaths;
  } catch {
    return false;
  }
}

/** Port of ShakedownTestServiceImpl.validateYamlSpec. */
function validateYamlSpec(content: string): boolean {
  let hasRootKey = false;
  let hasPaths = false;
  for (const line of content.split("\n")) {
    if (line.startsWith("openapi:") || line.startsWith("swagger:")) hasRootKey = true;
    if (line.startsWith("paths:")) hasPaths = true;
    if (hasRootKey && hasPaths) return true;
  }
  return hasRootKey && hasPaths;
}

/** Port of ShakedownTestServiceImpl.validateOpenApiSpec. */
export function validateOpenApiSpec(content: string, extension: string): boolean {
  return extension.toLowerCase() === "json" ? validateJsonSpec(content) : validateYamlSpec(content);
}

/**
 * Port of ShakedownTestServiceImpl.generate. Requires SDK mode (the template
 * depends on agentic file-reading tools that Chat mode does not provide),
 * mirroring the Java action's explicit CopilotSdkExecutor.checkAvailability()
 * gate — done here via the documented ModeManager.checkSdkAvailability().
 */
export async function generateShakedownSuite(specFilePath: string): Promise<ShakedownResult> {
  const sdkStatus = await ModeManager.getInstance().checkSdkAvailability();
  if (!sdkStatus.available) {
    throw new DevAIException(
      `SDK mode is required for this action. ${sdkStatus.errorMessage ?? "Unknown SDK availability error."}`
    );
  }

  const specContent = readFileContent(specFilePath);
  if (!specContent || specContent.trim().length === 0) {
    throw new DevAIException("The selected API spec file is empty or could not be read.");
  }

  const extension = path.extname(specFilePath).replace(/^\./, "");
  if (!validateOpenApiSpec(specContent, extension)) {
    throw new DevAIException(
      "The selected file does not appear to be a valid OpenAPI/Swagger specification. " +
        "Expected root-level 'openapi' or 'swagger' key and a 'paths' key."
    );
  }

  const targetName = path.basename(specFilePath, path.extname(specFilePath));
  const outputDir = path.dirname(specFilePath);
  const normalizedOutputDir = outputDir.replace(/\\/g, "/");

  // Prompt is the spec *file path* (not its content) — the SDK template
  // instructs the agent to read it via the `view` tool, exactly like the Java
  // AIRequest built in ShakedownTestServiceImpl.generate().
  const request = newRequest(OperationType.GENERATE_SHAKEDOWN_TESTS, null, specFilePath, {
    targetName,
    fileName: targetName,
    outputDir: normalizedOutputDir,
  });

  const content = await executeForContent(request);
  if (!content || content.trim().length === 0) {
    throw new DevAIException("Empty response from LLM");
  }

  const responseMarkdownPath = resolveAvailableMarkdownPath(outputDir, `${targetName}-shakedown-response`);

  // Deviation from the Java plugin: best-effort extraction of an embedded
  // Postman collection JSON so "Accept" actually produces a real
  // *-collection.json the user can import, instead of only the raw-response
  // markdown log (which is all the Java implementation ever wrote despite
  // its notification text claiming otherwise).
  const collectionJson = parseJsonLenient<Record<string, unknown>>(content);
  const looksLikeCollection =
    collectionJson !== null && typeof collectionJson === "object" && "info" in collectionJson;
  const collectionPath = looksLikeCollection ? path.join(outputDir, `${targetName}-collection.json`) : null;

  return {
    responseContent: content,
    responseMarkdownPath,
    collectionPath,
    collectionJson: looksLikeCollection ? collectionJson : null,
  };
}
