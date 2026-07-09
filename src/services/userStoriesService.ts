import * as fs from "fs";
import * as path from "path";
import { OperationType, newRequest } from "../models";
import { executeForContent } from "../core/copilotService";
import { DevAIException, ErrorCode } from "../util/exception";

/**
 * Business logic for devai.generateUserStories, ported from
 * com.bmo.devai.intellij.services.impl.UserStoriesGenerationServiceImpl,
 * util.DocumentReaderUtil, util.HtmlTextExtractor and util.UserStoryCsvParser.
 *
 * DEVIATION: the Java UserStoriesGenerationServiceImpl also offers to sync
 * generated epics/stories directly into Jira (JiraApiClient +
 * JiraSubmissionPreviewDialog). That client/dialog live outside this
 * cluster's ownership (Jira ticket integration is owned by the security
 * cluster per DEV_NOTES) and are not ported here. Instead, this service
 * exposes a CSV parser/writer so the caller can emit a companion
 * "*-user-stories.csv" file next to the markdown output — already
 * Jira-import-ready without requiring a live Jira connection.
 */

export const ACCEPTED_REQUIREMENTS_EXTENSIONS = new Set(["md", "txt", "doc", "docx", "pdf"]);

function extensionOfPath(filePath: string): string {
  const base = path.basename(filePath);
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.substring(dot + 1).toLowerCase() : "";
}

/** Port of DocumentReaderUtil.isAcceptedRequirementsFormat. */
export function isAcceptedRequirementsFormat(filePath: string): boolean {
  return ACCEPTED_REQUIREMENTS_EXTENSIONS.has(extensionOfPath(filePath));
}

/** Port of util.HtmlTextExtractor.extract. */
export function extractTextFromHtml(html: string): string {
  let text = html.replace(/<script[\s\S]*?<\/script>/gi, "");
  text = text.replace(/<style[\s\S]*?<\/style>/gi, "");
  text = text.replace(/<br\s*\/?>/gi, "\n");
  text = text.replace(/<\/(p|div|li|tr|h[1-6])>/gi, "\n");
  text = text.replace(/<\/td>/gi, "\t");
  text = text.replace(/<hr\s*\/?>/gi, "\n---\n");
  text = text.replace(/<li[^>]*>/gi, "\n• ");
  text = text.replace(/<[^>]+>/g, "");
  text = decodeHtmlEntities(text);
  text = text.replace(/[ \t]+/g, " ");
  text = text.replace(/(\s*\n){3,}/g, "\n\n");
  return text.trim();
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#39;/g, "'")
    .replace(/&mdash;/g, "—")
    .replace(/&ndash;/g, "–")
    .replace(/&hellip;/g, "…")
    .replace(/&ldquo;/g, "“")
    .replace(/&rdquo;/g, "”")
    .replace(/&lsquo;/g, "‘")
    .replace(/&rsquo;/g, "’");
}

function looksLikeHtml(text: string): boolean {
  return /<\s*(html|body|!doctype)/i.test(text.slice(0, 4000));
}

/**
 * Port of DocumentReaderUtil.readDocument. Native support for .md/.txt.
 * DEVIATION: the Java version parses binary .doc/.docx/.pdf via Apache
 * POI/PDFBox. This build cannot bundle those (no new npm/Java deps allowed
 * for this port), so binary Word/PDF documents raise a clear, actionable
 * error. The one binary-format case that IS handled losslessly and requires
 * no library is the Java version's documented fallback: Jira and similar
 * tools often export ".doc" files that are actually HTML — those are
 * detected by sniffing and run through the ported HtmlTextExtractor.
 */
export function readRequirementsDocument(filePath: string): string {
  const ext = extensionOfPath(filePath);
  if (ext === "md" || ext === "txt") {
    return fs.readFileSync(filePath, "utf8");
  }
  if (ext === "doc") {
    const raw = fs.readFileSync(filePath, "utf8");
    if (looksLikeHtml(raw)) return extractTextFromHtml(raw);
    throw new DevAIException(
      "Failed to parse .doc file: binary Word documents are not supported in this build (no bundled Word parser). " +
        "Convert to .md/.txt, or use an HTML export saved with a .doc extension.",
      ErrorCode.UNSUPPORTED_LANGUAGE
    );
  }
  if (ext === "docx" || ext === "pdf") {
    throw new DevAIException(
      `Unsupported format: .${ext}. This build supports .md, .txt, and HTML-exported .doc files ` +
        "(no bundled .docx/.pdf parser). Convert your requirements to a supported format.",
      ErrorCode.UNSUPPORTED_LANGUAGE
    );
  }
  throw new DevAIException(
    `Unsupported format: .${ext}. Supported formats: .md, .txt, .doc, .docx, .pdf`,
    ErrorCode.UNSUPPORTED_LANGUAGE
  );
}

/** Port of UserStoriesGenerationServiceImpl.generateUserStories (the request/execute half). */
export async function generateUserStoriesContent(requirementsContent: string, targetName: string): Promise<string> {
  const request = newRequest(OperationType.GENERATE_USER_STORIES, null, requirementsContent, { targetName });
  return executeForContent(request);
}

// ---------------------------------------------------------------------------
// Port of util.UserStoryCsvParser
// ---------------------------------------------------------------------------

export interface UserStoryCsvRow {
  workItemId: string;
  parentId: string;
  summary: string;
  workType: string;
  description: string;
  priority: string;
}

const CSV_HEADER = "WorkItem ID,Parent ID,Summary,Work Type,Description,Priority";

export function extractCsvBodyFromResponse(aiResponse: string): string {
  const fenceStart = aiResponse.lastIndexOf("```csv");
  if (fenceStart < 0) return "";
  const csvStart = fenceStart + "```csv".length;
  const fenceEnd = aiResponse.indexOf("```", csvStart);
  if (fenceEnd < 0) return "";
  return aiResponse.substring(csvStart, fenceEnd).trim();
}

export function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === "," && !inQuotes) {
      cells.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  cells.push(current);
  return cells;
}

export function parseCsvBody(csvBody: string): UserStoryCsvRow[] {
  const normalized = csvBody.replace(/\r\n/g, "\n").replace(/```csv/g, "").replace(/```/g, "").trim();
  const lines = normalized.split("\n");
  if (lines.length <= 1) return [];

  let startIndex = 0;
  if (lines[0].trim().toLowerCase() === CSV_HEADER.toLowerCase()) startIndex = 1;

  const rows: UserStoryCsvRow[] = [];
  for (let i = startIndex; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.length === 0) continue;
    const cols = splitCsvLine(line);
    if (cols.length < 6) continue;
    rows.push({
      workItemId: cols[0].trim(),
      parentId: cols[1].trim(),
      summary: cols[2].trim(),
      workType: cols[3].trim(),
      description: cols[4].trim(),
      priority: cols[5].trim(),
    });
  }
  return rows;
}

export function parseUserStoriesFromResponse(aiResponse: string): UserStoryCsvRow[] {
  const body = extractCsvBodyFromResponse(aiResponse);
  if (body.length === 0) return [];
  return parseCsvBody(body);
}

function csvEscape(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** Serializes rows back to CSV text (mirrors the header format produced by the AI prompt). */
export function rowsToCsv(rows: UserStoryCsvRow[]): string {
  const lines = rows.map((r) =>
    [r.workItemId, r.parentId, r.summary, r.workType, r.description, r.priority].map(csvEscape).join(",")
  );
  return [CSV_HEADER, ...lines].join("\n") + "\n";
}

/** Analogue of ResponseUtil.resolveAvailableMarkdownPath but for a .csv companion file. */
export function resolveAvailableCsvPath(outputDir: string, baseOutputName: string): string {
  const basePath = path.join(outputDir, `${baseOutputName}.csv`);
  if (!fs.existsSync(basePath)) return basePath;
  let maxIndex = 0;
  try {
    const prefix = `${baseOutputName}(`;
    const suffix = ").csv";
    for (const name of fs.readdirSync(outputDir)) {
      if (name.startsWith(prefix) && name.endsWith(suffix)) {
        const n = parseInt(name.substring(prefix.length, name.length - suffix.length), 10);
        if (!isNaN(n) && n > maxIndex) maxIndex = n;
      }
    }
  } catch {
    return path.join(outputDir, `${baseOutputName}(1).csv`);
  }
  return path.join(outputDir, `${baseOutputName}(${maxIndex + 1}).csv`);
}
