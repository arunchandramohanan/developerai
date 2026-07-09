/**
 * Feature-specific models for the documentation cluster, ported from
 * com.bmo.devai.intellij.models.generation (DocFormat, ParamDoc, ThrowsDoc,
 * DocumentationComment). GeneratedCode (a Java sealed interface) and
 * UpdateResult are not ported here — neither is used by any of the
 * documentation commands (UpdateResult belongs to the feature-delivery
 * "update feature code" flow, not doc updates, which just runs a CLI diff-fix
 * pass and never parses a structured result).
 */

/** Port of com.bmo.devai.intellij.models.generation.DocFormat. */
export enum DocFormat {
  JAVADOC = "JAVADOC",
  KDOC = "KDOC",
  PYTHON_DOCSTRING = "PYTHON_DOCSTRING",
  JSDOC = "JSDOC",
  XMLDOC = "XMLDOC",
}

interface DocFormatInfo {
  displayName: string;
  startDelimiter: string;
  endDelimiter: string;
  linePrefix: string;
  supportsAnnotations: boolean;
  paramTag: string;
  returnTag: string;
  throwsTag: string;
}

const DOC_FORMAT_META: Record<DocFormat, DocFormatInfo> = {
  [DocFormat.JAVADOC]: {
    displayName: "Javadoc",
    startDelimiter: "/**",
    endDelimiter: "*/",
    linePrefix: " * ",
    supportsAnnotations: true,
    paramTag: "@param",
    returnTag: "@return",
    throwsTag: "@throws",
  },
  [DocFormat.KDOC]: {
    displayName: "KDoc",
    startDelimiter: "/**",
    endDelimiter: "*/",
    linePrefix: " * ",
    supportsAnnotations: true,
    paramTag: "@param",
    returnTag: "@return",
    throwsTag: "@throws",
  },
  [DocFormat.PYTHON_DOCSTRING]: {
    displayName: "Python Docstring",
    startDelimiter: '"""',
    endDelimiter: '"""',
    linePrefix: "",
    supportsAnnotations: false,
    paramTag: ":param",
    returnTag: ":return:",
    throwsTag: ":raises",
  },
  [DocFormat.JSDOC]: {
    displayName: "JSDoc",
    startDelimiter: "/**",
    endDelimiter: "*/",
    linePrefix: " * ",
    supportsAnnotations: true,
    paramTag: "@param",
    returnTag: "@return",
    throwsTag: "@throws",
  },
  [DocFormat.XMLDOC]: {
    displayName: "XML Doc",
    startDelimiter: "///",
    endDelimiter: "",
    linePrefix: "/// ",
    supportsAnnotations: false,
    paramTag: '<param name="{name}">',
    returnTag: "<returns>",
    throwsTag: '<exception cref="{type}">',
  },
};

export function docFormatDisplayName(f: DocFormat): string { return DOC_FORMAT_META[f].displayName; }
export function docFormatStartDelimiter(f: DocFormat): string { return DOC_FORMAT_META[f].startDelimiter; }
export function docFormatEndDelimiter(f: DocFormat): string { return DOC_FORMAT_META[f].endDelimiter; }
export function docFormatLinePrefix(f: DocFormat): string { return DOC_FORMAT_META[f].linePrefix; }
export function docFormatSupportsAnnotations(f: DocFormat): boolean { return DOC_FORMAT_META[f].supportsAnnotations; }
export function docFormatParamTag(f: DocFormat): string { return DOC_FORMAT_META[f].paramTag; }
export function docFormatReturnTag(f: DocFormat): string { return DOC_FORMAT_META[f].returnTag; }
export function docFormatThrowsTag(f: DocFormat): string { return DOC_FORMAT_META[f].throwsTag; }

/** Port of DocFormat.fromLanguage(languageId). */
export function docFormatFromLanguage(languageId: string): DocFormat {
  switch ((languageId ?? "").trim().toLowerCase()) {
    case "java":
      return DocFormat.JAVADOC;
    case "kotlin":
      return DocFormat.KDOC;
    case "python":
      return DocFormat.PYTHON_DOCSTRING;
    case "javascript":
    case "typescript":
    case "ecmascript 6":
      return DocFormat.JSDOC;
    case "c#":
      return DocFormat.XMLDOC;
    default:
      return DocFormat.JAVADOC;
  }
}

/** Port of com.bmo.devai.intellij.models.generation.ParamDoc. */
export interface ParamDoc {
  name: string;
  type?: string | null;
  description: string;
  nullable: boolean;
  defaultValue?: string | null;
}

export function paramDocOf(name: string, description: string): ParamDoc {
  return { name, type: null, description, nullable: false, defaultValue: null };
}

/** Port of ParamDoc.format(DocFormat). */
export function formatParamDoc(p: ParamDoc, format: DocFormat): string {
  switch (format) {
    case DocFormat.JAVADOC:
    case DocFormat.KDOC:
    case DocFormat.JSDOC: {
      let s = `${docFormatParamTag(format)} ${p.name}`;
      if (p.type && (format === DocFormat.JSDOC || format === DocFormat.KDOC)) s += ` {${p.type}}`;
      s += ` ${p.description}`;
      return s;
    }
    case DocFormat.PYTHON_DOCSTRING: {
      let s = `${docFormatParamTag(format)} ${p.name}: ${p.description}`;
      if (p.type) s += ` (${p.type})`;
      return s;
    }
    case DocFormat.XMLDOC:
      return `<param name="${p.name}">${p.description}</param>`;
    default:
      return "";
  }
}

/** Port of com.bmo.devai.intellij.models.generation.ThrowsDoc. */
export interface ThrowsDoc {
  exceptionType: string;
  description: string;
  simpleType?: string | null;
}

export function throwsDocOf(exceptionType: string, description: string): ThrowsDoc {
  const lastDot = exceptionType.lastIndexOf(".");
  const simpleType = lastDot > 0 ? exceptionType.substring(lastDot + 1) : exceptionType;
  return { exceptionType, description, simpleType };
}

export function throwsDocDisplayType(t: ThrowsDoc): string { return t.simpleType ?? t.exceptionType; }

/** Port of ThrowsDoc.format(DocFormat). */
export function formatThrowsDoc(t: ThrowsDoc, format: DocFormat): string {
  const display = throwsDocDisplayType(t);
  switch (format) {
    case DocFormat.JAVADOC:
    case DocFormat.KDOC:
      return `@throws ${display} ${t.description}`;
    case DocFormat.JSDOC:
      return `@throws {${display}} ${t.description}`;
    case DocFormat.PYTHON_DOCSTRING:
      return `:raises ${display}: ${t.description}`;
    case DocFormat.XMLDOC:
      return `<exception cref="${t.exceptionType}">${t.description}</exception>`;
    default:
      return "";
  }
}

/** Port of com.bmo.devai.intellij.models.generation.DocumentationComment. */
export interface DocumentationComment {
  elementName: string;
  elementType: import("../models").ElementType;
  format: DocFormat;
  summary: string;
  paramDocs: ParamDoc[];
  returnDoc?: string | null;
  throwsDocs: ThrowsDoc[];
  seeAlso: string[];
  sinceVersion?: string | null;
  deprecatedReason?: string | null;
  /** The complete, cleaned AI-generated comment text (what gets inserted into the editor). */
  fullComment: string;
  targetFilePath: string;
  insertOffset: number;
  generatedAt: number;
}
