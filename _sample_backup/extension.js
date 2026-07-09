const vscode = require("vscode");

const COLLECTION_NAME = "pythonReview";

/**
 * Each rule inspects a single logical line and returns review comments.
 * A rule receives:
 *   line      - the raw text of the line
 *   lineNo    - zero-based line index
 *   context   - { maxLineLength }
 * and returns an array of { startCol, endCol, message, severity }.
 */
const rules = [
  function lineTooLong(line, lineNo, ctx) {
    if (line.length > ctx.maxLineLength) {
      return [
        {
          startCol: ctx.maxLineLength,
          endCol: line.length,
          message: `Line exceeds ${ctx.maxLineLength} characters (${line.length}). Consider breaking it up.`,
          severity: vscode.DiagnosticSeverity.Information,
        },
      ];
    }
    return [];
  },

  function trailingWhitespace(line) {
    const m = line.match(/\s+$/);
    if (m && line.trim().length > 0) {
      return [
        {
          startCol: line.length - m[0].length,
          endCol: line.length,
          message: "Trailing whitespace.",
          severity: vscode.DiagnosticSeverity.Hint,
        },
      ];
    }
    return [];
  },

  function bareExcept(line) {
    const idx = line.search(/(^|\s)except\s*:/);
    if (idx !== -1) {
      const col = line.indexOf("except");
      return [
        {
          startCol: col,
          endCol: col + "except".length,
          message:
            "Bare 'except:' catches everything (including KeyboardInterrupt/SystemExit). Catch a specific exception, e.g. 'except Exception:'.",
          severity: vscode.DiagnosticSeverity.Warning,
        },
      ];
    }
    return [];
  },

  function mutableDefaultArg(line) {
    // def f(x=[]) / def f(x={}) — mutable default arguments are a classic bug.
    const defMatch = line.match(/^\s*def\s+\w+\s*\(([^)]*)\)/);
    if (!defMatch) return [];
    const params = defMatch[1];
    const out = [];
    const re = /=\s*(\[\s*\]|\{\s*\}|set\(\s*\)|dict\(\s*\)|list\(\s*\))/g;
    let m;
    while ((m = re.exec(params)) !== null) {
      const col = line.indexOf(params) + m.index;
      out.push({
        startCol: col,
        endCol: col + m[0].length,
        message:
          "Mutable default argument. It is shared across calls; use 'None' and create the value inside the function.",
        severity: vscode.DiagnosticSeverity.Warning,
      });
    }
    return out;
  },

  function compareToNone(line) {
    const out = [];
    const re = /(==|!=)\s*None|None\s*(==|!=)/g;
    let m;
    while ((m = re.exec(line)) !== null) {
      out.push({
        startCol: m.index,
        endCol: m.index + m[0].length,
        message: "Compare to None with 'is' / 'is not', not '==' / '!='.",
        severity: vscode.DiagnosticSeverity.Warning,
      });
    }
    return out;
  },

  function compareToBool(line) {
    const out = [];
    const re = /==\s*(True|False)|(True|False)\s*==/g;
    let m;
    while ((m = re.exec(line)) !== null) {
      out.push({
        startCol: m.index,
        endCol: m.index + m[0].length,
        message:
          "Avoid '== True' / '== False'. Test truthiness directly (e.g. 'if x:' or 'if not x:').",
        severity: vscode.DiagnosticSeverity.Information,
      });
    }
    return out;
  },

  function typeEquality(line) {
    const idx = line.search(/type\([^)]*\)\s*==/);
    if (idx !== -1) {
      return [
        {
          startCol: idx,
          endCol: line.length,
          message: "Use isinstance(...) instead of comparing type(...) with '=='.",
          severity: vscode.DiagnosticSeverity.Information,
        },
      ];
    }
    return [];
  },

  function wildcardImport(line) {
    const m = line.match(/^\s*from\s+[\w.]+\s+import\s+\*/);
    if (m) {
      return [
        {
          startCol: 0,
          endCol: line.length,
          message:
            "Wildcard import pollutes the namespace and hides names. Import only what you use.",
          severity: vscode.DiagnosticSeverity.Warning,
        },
      ];
    }
    return [];
  },

  function printStatement(line) {
    // Skip comments.
    const stripped = line.replace(/#.*$/, "");
    const m = stripped.match(/(^|\s)print\s*\(/);
    if (m) {
      const col = stripped.indexOf("print");
      return [
        {
          startCol: col,
          endCol: col + "print".length,
          message:
            "Leftover 'print(...)'? Prefer the logging module for diagnostics in production code.",
          severity: vscode.DiagnosticSeverity.Hint,
        },
      ];
    }
    return [];
  },

  function todoComment(line) {
    const m = line.match(/#\s*(TODO|FIXME|XXX|HACK)\b/i);
    if (m) {
      const col = line.indexOf(m[0]);
      return [
        {
          startCol: col,
          endCol: line.length,
          message: `Unresolved '${m[1].toUpperCase()}' comment.`,
          severity: vscode.DiagnosticSeverity.Hint,
        },
      ];
    }
    return [];
  },

  function tabIndentation(line) {
    if (/^\t+/.test(line)) {
      return [
        {
          startCol: 0,
          endCol: line.match(/^\t+/)[0].length,
          message: "Tab used for indentation. PEP 8 recommends 4 spaces.",
          severity: vscode.DiagnosticSeverity.Information,
        },
      ];
    }
    return [];
  },
];

/**
 * Whole-file rules that need more than one line of context.
 */
function fileLevelReview(text, lines) {
  const diagnostics = [];

  // Warn when a public top-level function/class has no docstring.
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const def = line.match(/^(def|class)\s+([A-Za-z_]\w*)/);
    if (!def) continue;
    const name = def[2];
    if (name.startsWith("_")) continue; // non-public, skip
    // Find the next non-blank line after the (possibly multi-line) signature.
    let j = i;
    while (j < lines.length && !/:\s*(#.*)?$/.test(lines[j])) j++;
    let k = j + 1;
    while (k < lines.length && lines[k].trim() === "") k++;
    if (k < lines.length) {
      const body = lines[k].trim();
      const hasDocstring = body.startsWith('"""') || body.startsWith("'''") ||
        body.startsWith('r"""') || body.startsWith("r'''");
      if (!hasDocstring) {
        const col = line.indexOf(name);
        diagnostics.push(
          makeDiag(
            i,
            col,
            col + name.length,
            `Public ${def[1]} '${name}' has no docstring.`,
            vscode.DiagnosticSeverity.Hint
          )
        );
      }
    }
  }

  return diagnostics;
}

function makeDiag(lineNo, startCol, endCol, message, severity) {
  const range = new vscode.Range(lineNo, startCol, lineNo, endCol);
  const d = new vscode.Diagnostic(range, message, severity);
  d.source = "python-review";
  return d;
}

/** Track whether we are inside a triple-quoted string to avoid false positives. */
function computeStringMask(lines) {
  const inString = new Array(lines.length).fill(false);
  let open = null; // '"""' or "'''"
  for (let i = 0; i < lines.length; i++) {
    if (open) {
      inString[i] = true;
      if (lines[i].includes(open)) open = null;
      continue;
    }
    const triple = lines[i].match(/("""|''')/);
    if (triple) {
      const q = triple[1];
      // Count occurrences on this line; odd count means the string stays open.
      const count = lines[i].split(q).length - 1;
      if (count % 2 !== 0) open = q;
    }
  }
  return inString;
}

function reviewDocument(document, collection) {
  if (document.languageId !== "python") return;

  const config = vscode.workspace.getConfiguration("pythonReview");
  const ctx = { maxLineLength: config.get("maxLineLength", 100) };

  const text = document.getText();
  const lines = text.split(/\r?\n/);
  const inString = computeStringMask(lines);
  const diagnostics = [];

  for (let lineNo = 0; lineNo < lines.length; lineNo++) {
    if (inString[lineNo]) continue; // don't lint inside docstrings/multiline strings
    const line = lines[lineNo];
    for (const rule of rules) {
      const results = rule(line, lineNo, ctx) || [];
      for (const r of results) {
        diagnostics.push(
          makeDiag(lineNo, r.startCol, r.endCol, r.message, r.severity)
        );
      }
    }
  }

  diagnostics.push(...fileLevelReview(text, lines));

  collection.set(document.uri, diagnostics);
  return diagnostics.length;
}

function activate(context) {
  const collection = vscode.languages.createDiagnosticCollection(COLLECTION_NAME);
  context.subscriptions.push(collection);

  const shouldRunOnSave = () =>
    vscode.workspace.getConfiguration("pythonReview").get("runOnSave", true);

  // Review the file already open on activation.
  if (vscode.window.activeTextEditor) {
    reviewDocument(vscode.window.activeTextEditor.document, collection);
  }

  context.subscriptions.push(
    vscode.commands.registerCommand("pythonReview.reviewFile", () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || editor.document.languageId !== "python") {
        vscode.window.showInformationMessage(
          "Python Review: open a Python file first."
        );
        return;
      }
      const count = reviewDocument(editor.document, collection);
      vscode.window.showInformationMessage(
        `Python Review: ${count} comment${count === 1 ? "" : "s"} added.`
      );
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("pythonReview.clear", () => {
      collection.clear();
      vscode.window.showInformationMessage("Python Review: comments cleared.");
    })
  );

  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument((doc) => {
      if (shouldRunOnSave()) reviewDocument(doc, collection);
    })
  );

  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument((doc) => {
      if (shouldRunOnSave()) reviewDocument(doc, collection);
    })
  );

  context.subscriptions.push(
    vscode.workspace.onDidCloseTextDocument((doc) => {
      collection.delete(doc.uri);
    })
  );
}

function deactivate() {}

module.exports = { activate, deactivate, reviewDocument, computeStringMask };
