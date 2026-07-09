/**
 * Diagram domain models, ported from com.bmo.devai.intellij.models.diagram.*.
 */

/** Type of UML diagram to generate. Port of models/diagram/DiagramType.java. */
export enum DiagramType {
  CLASS_DIAGRAM = "CLASS_DIAGRAM",
  SEQUENCE_DIAGRAM = "SEQUENCE_DIAGRAM",
  FLOW_DIAGRAM = "FLOW_DIAGRAM",
}

const DIAGRAM_TYPE_META: Record<DiagramType, { displayName: string; templateId: string }> = {
  [DiagramType.CLASS_DIAGRAM]: { displayName: "Class Diagram", templateId: "class-diagram" },
  [DiagramType.SEQUENCE_DIAGRAM]: { displayName: "Sequence Diagram", templateId: "sequence-diagram" },
  [DiagramType.FLOW_DIAGRAM]: { displayName: "Flow Diagram", templateId: "flow-diagram" },
};

export function diagramTypeDisplayName(t: DiagramType): string {
  return DIAGRAM_TYPE_META[t].displayName;
}
export function diagramTypeTemplateId(t: DiagramType): string {
  return DIAGRAM_TYPE_META[t].templateId;
}
/** Resolves a DiagramType from its templateId (e.g. the `%% type:` metadata value). */
export function diagramTypeFromTemplateId(templateId: string | null | undefined): DiagramType {
  if (!templateId) return DiagramType.CLASS_DIAGRAM;
  const trimmed = templateId.trim();
  for (const t of Object.values(DiagramType)) {
    if (DIAGRAM_TYPE_META[t].templateId === trimmed) return t;
  }
  return DiagramType.CLASS_DIAGRAM;
}

/** Output format for generated diagrams. Port of models/diagram/ExportFormat.java. */
export enum ExportFormat {
  MERMAID_MD = "MERMAID_MD",
  SVG = "SVG",
  DRAW_IO = "DRAW_IO",
}

const EXPORT_FORMAT_META: Record<ExportFormat, { displayName: string; fileExtension: string }> = {
  [ExportFormat.MERMAID_MD]: { displayName: "Mermaid (.mmd)", fileExtension: "mmd" },
  [ExportFormat.SVG]: { displayName: "SVG (.svg)", fileExtension: "svg" },
  [ExportFormat.DRAW_IO]: { displayName: "Draw.io (.drawio)", fileExtension: "drawio" },
};

export function exportFormatDisplayName(f: ExportFormat): string {
  return EXPORT_FORMAT_META[f].displayName;
}
export function exportFormatFileExtension(f: ExportFormat): string {
  return EXPORT_FORMAT_META[f].fileExtension;
}

/** Scope level for diagram generation. Port of DiagramContext.DiagramScope. */
export enum DiagramScope {
  FILE = "FILE",
  FOLDER = "FOLDER",
  MODULE = "MODULE",
  WORKSPACE = "WORKSPACE",
}

const DIAGRAM_SCOPE_DISPLAY: Record<DiagramScope, string> = {
  [DiagramScope.FILE]: "Current File",
  [DiagramScope.FOLDER]: "Folder",
  [DiagramScope.MODULE]: "Module",
  [DiagramScope.WORKSPACE]: "Workspace",
};

export function diagramScopeDisplayName(s: DiagramScope): string {
  return DIAGRAM_SCOPE_DISPLAY[s];
}

/**
 * Context for a UML diagram generation request. Port of models/diagram/DiagramContext.java.
 */
export interface DiagramContext {
  diagramType: DiagramType;
  exportFormat: ExportFormat;
  /** Absolute paths to source files or folders to analyze. */
  sourcePaths: string[];
  scope: DiagramScope;
  /** Display name for the scope (e.g. folder name, module name) used in output file naming. */
  scopeName: string;
}

export function newDiagramContext(
  diagramType: DiagramType,
  exportFormat: ExportFormat,
  sourcePaths: string[],
  scope: DiagramScope,
  scopeName: string
): DiagramContext {
  if (!sourcePaths || sourcePaths.length === 0) {
    throw new Error("Source paths cannot be null or empty");
  }
  if (!scopeName || scopeName.trim().length === 0) {
    throw new Error("Scope name cannot be null or blank");
  }
  return { diagramType, exportFormat, sourcePaths: [...sourcePaths], scope, scopeName };
}

/** Returns the output file name for the generated diagram (matches DiagramContext.getOutputFileName). */
export function diagramOutputFileName(ctx: DiagramContext): string {
  return `${ctx.scopeName}-${diagramTypeTemplateId(ctx.diagramType)}.${exportFormatFileExtension(ctx.exportFormat)}`;
}

/**
 * Result of a UML diagram generation operation. Port of models/diagram/DiagramResult.java.
 */
export interface DiagramResult {
  success: boolean;
  outputPath: string | null;
  content: string | null;
  format: ExportFormat;
  error: string | null;
}

export function diagramSuccess(outputPath: string, content: string, format: ExportFormat): DiagramResult {
  return { success: true, outputPath, content, format, error: null };
}

export function diagramError(error: string, format: ExportFormat): DiagramResult {
  return { success: false, outputPath: null, content: null, format, error };
}
