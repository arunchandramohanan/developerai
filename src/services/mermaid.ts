import { httpRequest } from "../util/http";
import { DevAIException, ErrorCode } from "../util/exception";

/**
 * Port of com.bmo.devai.intellij.util.MermaidRendererUtil.
 * Renders Mermaid diagram text into SVG or Draw.io XML via the Kroki API.
 * No local tooling (Node.js, mermaid-cli) required — just an HTTP POST.
 */
// TODO: CAN'T BE AN OPEN ENDPOINT LIKE THIS STORED PROPERLY (carried over from the Java source)
const KROKI_URL = "https://kroki.io/mermaid/svg";
const TIMEOUT_MS = 30_000;

/** Raised when Kroki rendering (or the native Draw.io conversion's fallback path) fails. */
export class MermaidRenderException extends DevAIException {
  constructor(message: string) {
    super(message, ErrorCode.GENERATION_FAILED);
    this.name = "MermaidRenderException";
  }
}

/**
 * Converts Mermaid text to an SVG string via the Kroki rendering API.
 * @throws MermaidRenderException if the API call fails
 */
export async function mermaidToSvg(mermaidText: string): Promise<string> {
  try {
    const response = await httpRequest(KROKI_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: mermaidText,
      timeoutMs: TIMEOUT_MS,
    });
    if (response.ok) {
      return response.body;
    }
    throw new MermaidRenderException(`Kroki API returned HTTP ${response.status}: ${response.body}`);
  } catch (e) {
    if (e instanceof MermaidRenderException) throw e;
    const msg = e instanceof Error ? e.message : String(e);
    throw new MermaidRenderException("Failed to render Mermaid via Kroki: " + msg);
  }
}

/**
 * Converts Mermaid text to a Draw.io XML file with editable native shapes.
 * For class diagrams and flowcharts, produces individual mxCell elements that
 * can be moved, resized, and edited in Draw.io. For unsupported diagram types
 * falls back to an SVG image embed.
 * @throws MermaidRenderException if rendering fails
 */
export async function mermaidToDrawIoXml(mermaidText: string): Promise<string> {
  // Try native conversion first — produces editable shapes
  try {
    const nativeXml = convertMermaidToDrawIo(mermaidText);
    if (nativeXml != null) return nativeXml;
  } catch {
    // fall through to SVG embed
  }

  // Fallback: render to SVG and embed as a static image
  const svg = await mermaidToSvg(mermaidText);
  const svgBase64 = Buffer.from(svg, "utf8").toString("base64");

  return `<mxfile host="app.diagrams.net" agent="DevAI">
<diagram name="Diagram" id="devai-generated">
<mxGraphModel dx="1000" dy="600" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="1100" pageHeight="850">
<root>
<mxCell id="0"/>
<mxCell id="1" parent="0"/>
<mxCell id="2" value="" style="shape=image;verticalLabelPosition=bottom;labelBackgroundColor=default;verticalAlign=top;aspect=fixed;imageAspect=0;image=data:image/svg+xml,${svgBase64};" vertex="1" parent="1">
<mxGeometry x="10" y="10" width="1080" height="830" as="geometry"/>
</mxCell>
</root>
</mxGraphModel>
</diagram>
</mxfile>
`;
}

// =====================================================================
// Port of com.bmo.devai.intellij.util.MermaidToDrawIoConverter.
// Converts Mermaid diagram text into native Draw.io XML with individually
// editable shapes and connections. Supports classDiagram, flowchart, and
// sequenceDiagram.
// =====================================================================

// ─── Class-diagram layout ──────────────────────────────────────
const CLASS_WIDTH = 260;
const GRID_COLS = 3;
const X_START = 60;
const Y_START = 60;
const X_GAP = 360; // wide gap so arrows don't cross boxes
const Y_GAP = 100;
const LINE_H = 18;
const HEADER_H = 30;
const STEREO_H = 20;
const HR_H = 8;
const PAD = 10;
const CLASS_MIN_H = 60;

// ─── Flowchart layout ──────────────────────────────────────────
const FLOW_MIN_W = 140;
const FLOW_MAX_W = 280;
const FLOW_H = 44;
const FLOW_DIA_MIN_W = 120;
const FLOW_DIA_H = 70;
const FLOW_CHAR_W = 8; // approx px per character
const FLOW_NODE_PAD = 36; // horizontal padding inside node
const FLOW_H_GAP = 60; // horizontal gap between nodes in same layer
const FLOW_V_GAP = 80; // vertical gap between layers

// ─── Sequence-diagram layout ───────────────────────────────────
const SEQ_ACTOR_MIN_W = 100;
const SEQ_ACTOR_H = 36;
const SEQ_CHAR_W = 8; // approx px per character for width sizing
const SEQ_ACTOR_PAD = 30; // padding added to text width
const SEQ_COL_GAP = 40; // gap between actor right edge and next actor left edge
const SEQ_Y_START = 40;
const SEQ_MSG_GAP = 45; // vertical space per message row

// ─── Regex patterns ────────────────────────────────────────────
const CLASS_BLOCK_START = /^\s*class\s+(\w+)\s*\{/;
const CLASS_STANDALONE = /^\s*class\s+(\w+)\s*$/;
const STEREO_PAT = /^<<(.+)>>$/;
const REL_PAT = /^\s*(\w+)\s+(--\|>|\.\.\|>|-->|--o|--\*|\.\.>)\s+(\w+)(?:\s*:\s*(.+))?$/;

/** Flowchart node patterns — ordered most-specific-first to avoid partial matches. */
const FLOW_NODE_PATS: string[] = [
  "(\\w+)\\(\\[(.+?)\\]\\)", // ([text]) stadium
  "(\\w+)\\(\\((.+?)\\)\\)", // ((text)) circle
  "(\\w+)\\[\\[(.+?)\\]\\]", // [[text]] subroutine
  "(\\w+)\\[/(.+?)/\\]", // [/text/] parallelogram
  "(\\w+)>(.+?)\\]", // >text]   flag
  "(\\w+)\\[(.+?)\\]", // [text]   rectangle
  "(\\w+)\\{\\{(.+?)\\}\\}", // {{text}} hexagon
  "(\\w+)\\{(.+?)\\}", // {text}   diamond
  "(\\w+)\\((.+?)\\)", // (text)   rounded
];
const FLOW_SHAPES = [
  "stadium",
  "circle",
  "subroutine",
  "parallelogram",
  "flag",
  "rect",
  "hexagon",
  "diamond",
  "rounded",
];
const FLOW_EDGE_PAT_SRC = "(\\w+)\\s+([-=.]{2,3}>?)(?:\\|([^|]*)\\|)?\\s+(\\w+)";

// ─── Sequence-diagram patterns ─────────────────────────────────
const SEQ_PARTICIPANT = /^\s*(?:participant|actor)\s+(\w+)(?:\s+as\s+(.+))?$/;
const SEQ_MSG = /^\s*(\w+)\s+(->>|-->>|-\)|--\))\s+(\w+)\s*:\s*(.+)$/;
const SEQ_ACTIVATE = /^\s*(activate|deactivate)\s+(\w+)\s*$/;
const SEQ_NOTE = /^\s*Note\s+(over|right of|left of)\s+([^:]+):\s*(.+)$/i;
const SEQ_BLOCK = /^\s*(alt|else|opt|loop|par|critical|break|rect)\s*(.*)$/;

// ═══════════════════════════════════════════════════════════════
//  Entry point
// ═══════════════════════════════════════════════════════════════

/**
 * Converts Mermaid text to native Draw.io XML with editable shapes.
 * @returns Draw.io XML string, or null if the diagram type is unsupported
 */
function convertMermaidToDrawIo(mermaidText: string): string | null {
  const lines = mermaidText
    .split(/\r\n|\r|\n/)
    .filter((l) => !l.trim().startsWith("%%"));

  const first = (lines.find((l) => l.trim().length > 0) ?? "").trim();

  if (first.startsWith("classDiagram")) return convertClassDiagram(lines);
  if (first.startsWith("flowchart") || first.startsWith("graph")) return convertFlowchart(lines, first);
  if (first.startsWith("sequenceDiagram")) return convertSequenceDiagram(lines);
  return null;
}

// ═══════════════════════════════════════════════════════════════
//  Class Diagram
// ═══════════════════════════════════════════════════════════════

interface ClassInfo {
  name: string;
  stereo: string | null;
  fields: string[];
  methods: string[];
}
interface Rel {
  from: string;
  to: string;
  type: string;
  label: string | null;
}

function convertClassDiagram(lines: string[]): string | null {
  const classes: ClassInfo[] = [];
  const rels: Rel[] = [];
  const names = new Set<string>();

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.length === 0 || line === "classDiagram" || line.startsWith("direction")) continue;

    // Class block: class Name { ... }
    const cm = CLASS_BLOCK_START.exec(line);
    if (cm) {
      const name = cm[1];
      let stereo: string | null = null;
      const fields: string[] = [];
      const methods: string[] = [];
      for (i++; i < lines.length; i++) {
        const ml = lines[i].trim();
        if (ml === "}") break;
        const sm = STEREO_PAT.exec(ml);
        if (sm) {
          stereo = sm[1];
        } else if (ml.length > 0) {
          (ml.includes("(") ? methods : fields).push(ml);
        }
      }
      classes.push({ name, stereo, fields, methods });
      names.add(name);
      continue;
    }

    // Standalone class declaration: class Name
    const scm = CLASS_STANDALONE.exec(line);
    if (scm && !names.has(scm[1])) {
      names.add(scm[1]);
      classes.push({ name: scm[1], stereo: null, fields: [], methods: [] });
      continue;
    }

    // Relationship: A --|> B : label
    const rm = REL_PAT.exec(line);
    if (rm) {
      rels.push({ from: rm[1], to: rm[3], type: rm[2], label: rm[4] != null ? rm[4].trim() : null });
    }
  }

  if (classes.length === 0) return null;

  // Add classes referenced only in relationships
  for (const r of rels) {
    if (!names.has(r.from)) {
      names.add(r.from);
      classes.push({ name: r.from, stereo: null, fields: [], methods: [] });
    }
    if (!names.has(r.to)) {
      names.add(r.to);
      classes.push({ name: r.to, stereo: null, fields: [], methods: [] });
    }
  }

  // Build mxCell XML
  let sb = "";
  sb += '        <mxCell id="0"/>\n';
  sb += '        <mxCell id="1" parent="0"/>\n';

  const idMap = new Map<string, number>();
  let id = 2;
  let col = 0;
  let rowY = Y_START;
  let maxH = 0;

  for (const c of classes) {
    idMap.set(c.name, id);
    const h = classHeight(c);
    const x = X_START + col * X_GAP;

    let style = "verticalAlign=top;align=left;overflow=fill;fontSize=12;fontFamily=Helvetica;html=1;whiteSpace=wrap;";
    if (c.stereo && c.stereo.toLowerCase() === "interface") style += "dashed=1;";

    sb += `        <mxCell id="${id}" value="${xmlEsc(classHtml(c))}" style="${style}" vertex="1" parent="1">\n`;
    sb += `          <mxGeometry x="${x}" y="${rowY}" width="${CLASS_WIDTH}" height="${h}" as="geometry"/>\n`;
    sb += "        </mxCell>\n";

    maxH = Math.max(maxH, h);
    col++;
    if (col >= GRID_COLS) {
      col = 0;
      rowY += maxH + Y_GAP;
      maxH = 0;
    }
    id++;
  }

  for (const r of rels) {
    const src = idMap.get(r.from);
    const tgt = idMap.get(r.to);
    if (src == null || tgt == null) continue;

    sb += `        <mxCell id="${id}" value="${r.label != null ? xmlEsc(r.label) : ""}" style="${relStyle(
      r.type
    )}" edge="1" parent="1" source="${src}" target="${tgt}">\n`;
    sb += '          <mxGeometry relative="1" as="geometry"/>\n';
    sb += "        </mxCell>\n";
    id++;
  }

  return wrapMxFile(sb);
}

function classHeight(c: ClassInfo): number {
  let h = HEADER_H;
  if (c.stereo != null) h += STEREO_H;
  h += HR_H; // separator after header
  if (c.fields.length > 0) h += c.fields.length * LINE_H;
  if (c.fields.length > 0 && c.methods.length > 0) h += HR_H;
  if (c.methods.length > 0) h += c.methods.length * LINE_H;
  return Math.max(h + PAD, CLASS_MIN_H);
}

function classHtml(c: ClassInfo): string {
  let h = "";
  h += `<p style="margin:0px;margin-top:4px;text-align:center;"><b>${htEsc(c.name)}</b></p>`;
  if (c.stereo != null) {
    h += `<p style="margin:0px;text-align:center;font-size:10px;"><i>&lt;&lt;${htEsc(c.stereo)}&gt;&gt;</i></p>`;
  }
  h += '<hr size="1"/>';

  if (c.fields.length > 0) {
    h += '<p style="margin:0px;margin-left:4px;font-size:11px;">';
    for (let i = 0; i < c.fields.length; i++) {
      if (i > 0) h += "<br/>";
      h += htEsc(generics(c.fields[i]));
    }
    h += "</p>";
  }
  if (c.fields.length > 0 && c.methods.length > 0) {
    h += '<hr size="1"/>';
  }
  if (c.methods.length > 0) {
    h += '<p style="margin:0px;margin-left:4px;font-size:11px;">';
    for (let i = 0; i < c.methods.length; i++) {
      if (i > 0) h += "<br/>";
      h += htEsc(generics(c.methods[i]));
    }
    h += "</p>";
  }
  return h;
}

function relStyle(op: string): string {
  const base = "edgeStyle=orthogonalEdgeStyle;rounded=1;jettySize=auto;orthogonalLoop=1;";
  switch (op) {
    case "--|>":
      return base + "endArrow=block;endFill=0;";
    case "..|>":
      return base + "endArrow=block;endFill=0;dashed=1;dashPattern=8 4;";
    case "-->":
      return base + "endArrow=open;endFill=1;";
    case "--o":
      return base + "endArrow=diamondThin;endFill=0;endSize=14;";
    case "--*":
      return base + "endArrow=diamondThin;endFill=1;endSize=14;";
    case "..>":
      return base + "endArrow=open;endFill=1;dashed=1;dashPattern=8 4;";
    default:
      return base + "endArrow=open;endFill=1;";
  }
}

// ═══════════════════════════════════════════════════════════════
//  Flowchart
// ═══════════════════════════════════════════════════════════════

interface FlowNode {
  id: string;
  label: string;
  shape: string;
}
interface FlowEdge {
  from: string;
  to: string;
  label: string | null;
  op: string;
}

function convertFlowchart(lines: string[], firstLine: string): string | null {
  const leftToRight = firstLine.includes("LR") || firstLine.includes("RL");

  const nodes = new Map<string, FlowNode>();
  const edges: FlowEdge[] = [];

  for (const raw of lines) {
    const line = raw.trim();
    if (
      line.length === 0 ||
      line.startsWith("flowchart") ||
      line.startsWith("graph") ||
      line.startsWith("%%") ||
      line.startsWith("style ") ||
      line.startsWith("linkStyle") ||
      line.startsWith("classDef") ||
      line.startsWith("click") ||
      line.startsWith("subgraph") ||
      line === "end" ||
      line.startsWith("direction")
    ) {
      continue;
    }
    extractFlowNodes(line, nodes);
    extractFlowEdges(line, edges);
  }

  if (nodes.size === 0) return null;

  // Ensure all edge-referenced nodes exist
  for (const e of edges) {
    if (!nodes.has(e.from)) nodes.set(e.from, { id: e.from, label: e.from, shape: "rect" });
    if (!nodes.has(e.to)) nodes.set(e.to, { id: e.to, label: e.to, shape: "rect" });
  }

  const positions = layoutFlowNodes(nodes, edges, leftToRight);

  // Build mxCell XML
  let sb = "";
  sb += '        <mxCell id="0"/>\n';
  sb += '        <mxCell id="1" parent="0"/>\n';

  const idMap = new Map<string, number>();
  let id = 2;
  let maxX = 0;
  let maxY = 0;

  for (const n of nodes.values()) {
    idMap.set(n.id, id);
    const pos = positions.get(n.id) ?? [0, 0];
    const [w, h] = flowNodeSize(n);

    sb += `        <mxCell id="${id}" value="${xmlEsc(n.label)}" style="${flowNodeStyle(
      n.shape
    )}" vertex="1" parent="1">\n`;
    sb += `          <mxGeometry x="${pos[0]}" y="${pos[1]}" width="${w}" height="${h}" as="geometry"/>\n`;
    sb += "        </mxCell>\n";
    maxX = Math.max(maxX, pos[0] + w);
    maxY = Math.max(maxY, pos[1] + h);
    id++;
  }

  for (const e of edges) {
    const src = idMap.get(e.from);
    const tgt = idMap.get(e.to);
    if (src == null || tgt == null) continue;

    sb += `        <mxCell id="${id}" value="${e.label != null ? xmlEsc(e.label) : ""}" style="${flowEdgeStyle(
      e.op
    )}" edge="1" parent="1" source="${src}" target="${tgt}">\n`;
    sb += '          <mxGeometry relative="1" as="geometry"/>\n';
    sb += "        </mxCell>\n";
    id++;
  }

  const canvasW = Math.max(maxX + 100, 1200);
  const canvasH = Math.max(maxY + 100, 800);
  return wrapMxFile(sb, canvasW, canvasH);
}

/** Computes node width and height dynamically based on label length and shape. */
function flowNodeSize(n: FlowNode): [number, number] {
  const textW = n.label.length * FLOW_CHAR_W + FLOW_NODE_PAD;
  if (n.shape === "diamond") {
    const w = Math.max(textW + 40, FLOW_DIA_MIN_W);
    return [w, FLOW_DIA_H];
  }
  const w = Math.max(Math.min(textW, FLOW_MAX_W), FLOW_MIN_W);
  return [w, FLOW_H];
}

/** Extracts flow nodes from a line using multiple patterns, adding to the nodes map. */
function extractFlowNodes(line: string, nodes: Map<string, FlowNode>): void {
  for (let p = 0; p < FLOW_NODE_PATS.length; p++) {
    const re = new RegExp(FLOW_NODE_PATS[p], "g");
    for (const m of line.matchAll(re)) {
      if (!nodes.has(m[1])) {
        nodes.set(m[1], { id: m[1], label: m[2].trim(), shape: FLOW_SHAPES[p] });
      }
    }
  }
}

/** Extracts flow edges from a line, normalizing it first to handle chained edges, and adds to the edges list. */
function extractFlowEdges(line: string, edges: FlowEdge[]): void {
  // Normalize: strip bracket declarations so chained edges parse correctly
  let norm = line;
  for (const src of FLOW_NODE_PATS) {
    norm = norm.replace(new RegExp(src, "g"), "$1");
  }

  // group 4 (the target) is always the trailing token of the whole match, so its
  // start offset is `match.index + match[0].length - match[4].length` — this mirrors
  // Java's `matcher.find(start)` resuming the search from `m.start(4)` to allow chaining
  // (A --> B --> C matches A->B first, then resumes from B to match B->C).
  const re = new RegExp(FLOW_EDGE_PAT_SRC, "g");
  let start = 0;
  while (start <= norm.length) {
    re.lastIndex = start;
    const m = re.exec(norm);
    if (!m) break;
    edges.push({ from: m[1], to: m[4], label: m[3] != null ? m[3].trim() : null, op: m[2] });
    start = m.index + m[0].length - m[4].length;
  }
}

/** BFS-based layered layout with center-alignment and dynamic node widths. */
function layoutFlowNodes(
  nodes: Map<string, FlowNode>,
  edges: FlowEdge[],
  leftToRight: boolean
): Map<string, [number, number]> {
  // Build adjacency and find roots (no incoming edges)
  const hasIncoming = new Set<string>();
  const adj = new Map<string, string[]>();
  for (const nid of nodes.keys()) adj.set(nid, []);
  for (const e of edges) {
    if (!adj.has(e.from)) adj.set(e.from, []);
    adj.get(e.from)!.push(e.to);
    hasIncoming.add(e.to);
  }

  const roots: string[] = [];
  for (const nid of nodes.keys()) {
    if (!hasIncoming.has(nid)) roots.push(nid);
  }
  if (roots.length === 0 && nodes.size > 0) {
    roots.push(nodes.keys().next().value as string);
  }

  // BFS to assign layers
  const layerMap = new Map<string, number>();
  const queue: string[] = [...roots];
  for (const r of roots) layerMap.set(r, 0);

  while (queue.length > 0) {
    const cur = queue.shift()!;
    const curLayer = layerMap.get(cur)!;
    for (const next of adj.get(cur) ?? []) {
      if (!layerMap.has(next)) {
        layerMap.set(next, curLayer + 1);
        queue.push(next);
      }
    }
  }

  // Orphan nodes get their own layers
  let maxLayer = 0;
  for (const v of layerMap.values()) maxLayer = Math.max(maxLayer, v);
  for (const nid of nodes.keys()) {
    if (!layerMap.has(nid)) {
      maxLayer++;
      layerMap.set(nid, maxLayer);
    }
  }

  // Group nodes by layer
  const layers = new Map<number, string[]>();
  for (const [nid, layer] of layerMap) {
    if (!layers.has(layer)) layers.set(layer, []);
    layers.get(layer)!.push(nid);
  }
  const sortedLayerKeys = [...layers.keys()].sort((a, b) => a - b);

  // Pre-compute each node's width so we can position them without overlap
  const nodeWidths = new Map<string, number>();
  for (const n of nodes.values()) {
    nodeWidths.set(n.id, flowNodeSize(n)[0]);
  }

  // Compute total width of each layer (sum of node widths + gaps)
  const layerTotalWidth = new Map<number, number>();
  for (const layerIdx of sortedLayerKeys) {
    const layerNodes = layers.get(layerIdx)!;
    let total = 0;
    for (const nid of layerNodes) total += nodeWidths.get(nid) ?? FLOW_MIN_W;
    total += (layerNodes.length - 1) * FLOW_H_GAP;
    layerTotalWidth.set(layerIdx, total);
  }

  // Find the widest layer's total width for center-alignment
  let globalMaxWidth = 400;
  for (const w of layerTotalWidth.values()) globalMaxWidth = Math.max(globalMaxWidth, w);

  // Assign coordinates: nodes positioned by accumulated widths, centered
  const positions = new Map<string, [number, number]>();
  for (const layerIdx of sortedLayerKeys) {
    const layerNodes = layers.get(layerIdx)!;
    const layerW = layerTotalWidth.get(layerIdx)!;
    const offset = Math.floor((globalMaxWidth - layerW) / 2);

    let cursor = X_START + offset;
    for (const nid of layerNodes) {
      const nw = nodeWidths.get(nid) ?? FLOW_MIN_W;
      let x: number, y: number;
      if (leftToRight) {
        x = X_START + layerIdx * (FLOW_MAX_W + FLOW_H_GAP);
        y = cursor;
      } else {
        x = cursor;
        y = Y_START + layerIdx * (FLOW_DIA_H + FLOW_V_GAP);
      }
      positions.set(nid, [x, y]);
      cursor += nw + FLOW_H_GAP;
    }
  }
  return positions;
}

/** Maps Mermaid flowchart node shapes to Draw.io styles, including font and padding settings. */
function flowNodeStyle(shape: string): string {
  const base = "fontSize=11;fontFamily=Helvetica;";
  switch (shape) {
    case "diamond":
      return "rhombus;whiteSpace=wrap;html=1;" + base;
    case "rounded":
      return "rounded=1;whiteSpace=wrap;html=1;" + base;
    case "circle":
      return "ellipse;whiteSpace=wrap;html=1;aspect=fixed;" + base;
    case "stadium":
      return "rounded=1;whiteSpace=wrap;html=1;arcSize=50;" + base;
    case "subroutine":
      return "shape=process;whiteSpace=wrap;html=1;" + base;
    case "parallelogram":
      return "shape=parallelogram;whiteSpace=wrap;html=1;" + base;
    case "hexagon":
      return "shape=hexagon;whiteSpace=wrap;html=1;" + base;
    default:
      return "whiteSpace=wrap;html=1;" + base; // rectangle
  }
}

/** Maps Mermaid flowchart edge styles to Draw.io styles, handling arrowheads, dashing, and thickness based on the operator. */
function flowEdgeStyle(op: string): string {
  const dashed = op.includes(".");
  const thick = op.includes("=");
  const arrow = op.endsWith(">");
  let s = "";
  s += "edgeStyle=orthogonalEdgeStyle;rounded=1;orthogonalLoop=1;jettySize=auto;";
  s += "jumpStyle=arc;jumpSize=12;"; // arc over crossing edges
  s += "labelBackgroundColor=#ffffff;fontSize=10;";
  s += arrow ? "endArrow=block;endFill=1;" : "endArrow=none;";
  if (dashed) s += "dashed=1;dashPattern=8 4;";
  if (thick) s += "strokeWidth=2;";
  return s;
}

// ═══════════════════════════════════════════════════════════════
//  Sequence Diagram
// ═══════════════════════════════════════════════════════════════

interface SeqActor {
  id: string;
  display: string;
}
interface SeqEvent {
  type: string;
  from: string | null;
  to: string | null;
  text: string | null;
  op: string | null;
}

function ensureActor(id: string, display: string, actors: SeqActor[], actorMap: Map<string, SeqActor>): void {
  if (!actorMap.has(id)) {
    const a: SeqActor = { id, display };
    actors.push(a);
    actorMap.set(id, a);
  }
}

function convertSequenceDiagram(lines: string[]): string | null {
  // Parse participants and messages
  const actors: SeqActor[] = [];
  const actorMap = new Map<string, SeqActor>();
  const events: SeqEvent[] = [];
  // Track block nesting depth for nested alt/loop frames
  let blockDepth = 0;

  for (const raw of lines) {
    const line = raw.trim();
    if (line.length === 0 || line === "sequenceDiagram") continue;

    // "end" closes a block
    if (line === "end") {
      if (blockDepth > 0) blockDepth--;
      events.push({ type: "blockEnd", from: null, to: null, text: null, op: null });
      continue;
    }

    // participant / actor
    const pm = SEQ_PARTICIPANT.exec(line);
    if (pm) {
      const id = pm[1];
      const display = pm[2] != null ? pm[2].trim() : id;
      ensureActor(id, display, actors, actorMap);
      continue;
    }

    // message: A ->> B : text
    const mm = SEQ_MSG.exec(line);
    if (mm) {
      const from = mm[1];
      const op = mm[2];
      const to = mm[3];
      const text = mm[4].trim();
      ensureActor(from, from, actors, actorMap);
      ensureActor(to, to, actors, actorMap);
      events.push({ type: "msg", from, to, text, op });
      continue;
    }

    // activate / deactivate
    const am = SEQ_ACTIVATE.exec(line);
    if (am) {
      ensureActor(am[2], am[2], actors, actorMap);
      events.push({ type: am[1], from: am[2], to: null, text: null, op: null });
      continue;
    }

    // Note
    const nm = SEQ_NOTE.exec(line);
    if (nm) {
      const target = nm[2].trim().split(/[,\s]/)[0].trim();
      ensureActor(target, target, actors, actorMap);
      events.push({ type: "note", from: target, to: null, text: nm[3].trim(), op: nm[1] });
      continue;
    }

    // Block headers (alt, loop, opt, etc.)
    const bm = SEQ_BLOCK.exec(line);
    if (bm) {
      blockDepth++;
      const label = bm[1] + (bm[2].length === 0 ? "" : " " + bm[2].trim());
      events.push({ type: "block", from: null, to: null, text: label, op: bm[1] });
      continue;
    }

    // "else" within alt blocks
    if (line.startsWith("else")) {
      const label = line.length > 4 ? line.substring(4).trim() : "";
      events.push({ type: "else", from: null, to: null, text: "else" + (label.length === 0 ? "" : " " + label), op: "else" });
    }
  }

  if (actors.length < 2) return null;

  // ── Compute dynamic actor widths ──
  const actorWidths: number[] = actors.map((a) => {
    const textW = a.display.length * SEQ_CHAR_W + SEQ_ACTOR_PAD;
    return Math.max(textW, SEQ_ACTOR_MIN_W);
  });

  // Compute actor X positions: each actor's center separated by enough space
  const actorXPositions: number[] = new Array(actors.length);
  actorXPositions[0] = X_START;
  for (let i = 1; i < actors.length; i++) {
    const prevRight = actorXPositions[i - 1] + actorWidths[i - 1];
    actorXPositions[i] = prevRight + SEQ_COL_GAP;
  }

  const actorX = new Map<string, number>();
  const actorW = new Map<string, number>();
  for (let i = 0; i < actors.length; i++) {
    actorX.set(actors[i].id, actorXPositions[i]);
    actorW.set(actors[i].id, actorWidths[i]);
  }

  // Count rows for lifeline height
  let rowCount = 0;
  for (const ev of events) {
    if (ev.type === "msg" || ev.type === "note" || ev.type === "block" || ev.type === "else") rowCount++;
  }

  const lifelineTop = SEQ_Y_START + SEQ_ACTOR_H + 15;
  const lifelineH = rowCount * SEQ_MSG_GAP + 60;
  const lifelineBottom = lifelineTop + lifelineH;

  const lastActorRight = actorXPositions[actors.length - 1] + actorWidths[actors.length - 1];
  const totalWidth = lastActorRight + X_START;

  let sb = "";
  sb += '        <mxCell id="0"/>\n';
  sb += '        <mxCell id="1" parent="0"/>\n';
  let id = 2;

  // ── Actor header boxes (lifeline shapes) ──
  for (const a of actors) {
    const x = actorX.get(a.id)!;
    const w = actorW.get(a.id)!;
    const fullH = lifelineBottom - SEQ_Y_START;
    sb += `        <mxCell id="${id}" value="${xmlEsc(a.display)}" style="shape=umlLifeline;perimeter=lifelinePerimeter;` +
      `whiteSpace=wrap;html=1;container=0;collapsible=0;recursiveResize=0;outlineConnect=0;` +
      `size=${SEQ_ACTOR_H};fontStyle=1;fontSize=12;" vertex="1" parent="1">\n`;
    sb += `          <mxGeometry x="${x}" y="${SEQ_Y_START}" width="${w}" height="${fullH}" as="geometry"/>\n`;
    sb += "        </mxCell>\n";
    id++;
  }

  // ── Messages, notes, blocks ──
  let currentY = lifelineTop;
  const activations = new Map<string, number>();

  for (const ev of events) {
    switch (ev.type) {
      case "msg": {
        const from = ev.from as string;
        const to = ev.to as string;
        const srcX = actorX.get(from)! + actorW.get(from)! / 2;
        const tgtX = actorX.get(to)! + actorW.get(to)! / 2;
        const selfCall = from === to;
        const dashed = ev.op != null && ev.op.startsWith("--");
        const openArrow = ev.op != null && ev.op.endsWith(")");

        let style = "html=1;verticalAlign=bottom;labelBackgroundColor=#ffffff;fontSize=11;";
        if (dashed) style += "dashed=1;dashPattern=8 4;";
        if (openArrow) {
          style += "endArrow=open;endFill=0;";
        } else {
          style += "endArrow=block;endFill=1;";
        }

        if (selfCall) {
          // Self-call: curved arrow looping back to same actor
          style += "edgeStyle=orthogonalEdgeStyle;curved=1;";
          const loopW = 40;
          sb += `        <mxCell id="${id}" value="${xmlEsc(ev.text ?? "")}" style="${style}" edge="1" parent="1">\n`;
          sb += `          <mxGeometry relative="1" as="geometry">\n` +
            `            <mxPoint x="${srcX}" y="${currentY}" as="sourcePoint"/>\n` +
            `            <mxPoint x="${srcX}" y="${currentY + 25}" as="targetPoint"/>\n` +
            `            <Array as="points">\n` +
            `              <mxPoint x="${srcX + loopW}" y="${currentY}"/>\n` +
            `              <mxPoint x="${srcX + loopW}" y="${currentY + 25}"/>\n` +
            `            </Array>\n` +
            `          </mxGeometry>\n`;
          sb += "        </mxCell>\n";
        } else {
          sb += `        <mxCell id="${id}" value="${xmlEsc(ev.text ?? "")}" style="${style}" edge="1" parent="1">\n`;
          sb += `          <mxGeometry relative="1" as="geometry">\n` +
            `            <mxPoint x="${srcX}" y="${currentY}" as="sourcePoint"/>\n` +
            `            <mxPoint x="${tgtX}" y="${currentY}" as="targetPoint"/>\n` +
            `          </mxGeometry>\n`;
          sb += "        </mxCell>\n";
        }
        id++;
        currentY += SEQ_MSG_GAP;
        break;
      }
      case "note": {
        const from = ev.from as string;
        const noteX = (actorX.get(from) ?? X_START) + (actorW.get(from) ?? SEQ_ACTOR_MIN_W) + 8;
        const text = ev.text ?? "";
        const noteW = Math.max(text.length * 7 + 20, 120);
        sb += `        <mxCell id="${id}" value="${xmlEsc(text)}" style="shape=note;whiteSpace=wrap;html=1;` +
          `size=14;fillColor=#FFF2CC;strokeColor=#D6B656;fontSize=10;" vertex="1" parent="1">\n`;
        sb += `          <mxGeometry x="${noteX}" y="${currentY - 8}" width="${noteW}" height="26" as="geometry"/>\n`;
        sb += "        </mxCell>\n";
        id++;
        currentY += SEQ_MSG_GAP;
        break;
      }
      case "block": {
        // Render the block label as a small tag at the top-left
        sb += `        <mxCell id="${id}" value="${xmlEsc(ev.text ?? "")}" style="shape=umlFrame;whiteSpace=wrap;html=1;` +
          `fillColor=none;strokeColor=#6666FF;fontStyle=1;fontSize=10;verticalAlign=top;` +
          `align=left;spacingLeft=6;spacingTop=2;width=60;height=16;pointerEvents=0;" ` +
          `vertex="1" parent="1">\n`;
        // Placeholder geometry — will be sized properly when blockEnd is reached
        // For now, add a thin frame; the blockEnd handler doesn't resize, so estimate
        sb += `          <mxGeometry x="${X_START - 15}" y="${currentY - 8}" width="${totalWidth - X_START}" height="10" as="geometry"/>\n`;
        sb += "        </mxCell>\n";
        id++;
        currentY += SEQ_MSG_GAP;
        break;
      }
      case "else": {
        // Dashed separator line across the frame
        sb += `        <mxCell id="${id}" value="${xmlEsc(ev.text ?? "")}" style="html=1;dashed=1;dashPattern=4 4;` +
          `strokeColor=#6666FF;fontSize=10;verticalAlign=bottom;labelBackgroundColor=#ffffff;" edge="1" parent="1">\n`;
        sb += `          <mxGeometry relative="1" as="geometry">\n` +
          `            <mxPoint x="${X_START - 10}" y="${currentY}" as="sourcePoint"/>\n` +
          `            <mxPoint x="${totalWidth - 10}" y="${currentY}" as="targetPoint"/>\n` +
          `          </mxGeometry>\n`;
        sb += "        </mxCell>\n";
        id++;
        currentY += SEQ_MSG_GAP;
        break;
      }
      case "blockEnd":
        // The umlFrame was already emitted, nothing more needed
        break;
      case "activate":
        activations.set(ev.from as string, currentY);
        break;
      case "deactivate": {
        const from = ev.from as string;
        const startY = activations.get(from);
        activations.delete(from);
        if (startY != null && actorX.has(from)) {
          const ax = actorX.get(from)! + actorW.get(from)! / 2 - 5;
          sb += `        <mxCell id="${id}" value="" style="fillColor=#E6E6E6;strokeColor=#999999;" ` +
            `vertex="1" parent="1">\n`;
          sb += `          <mxGeometry x="${ax}" y="${startY}" width="10" height="${currentY - startY}" as="geometry"/>\n`;
          sb += "        </mxCell>\n";
          id++;
        }
        break;
      }
    }
  }

  const canvasW = Math.max(totalWidth + 100, 1200);
  const canvasH = Math.max(lifelineBottom + 60, 800);
  return wrapMxFile(sb, canvasW, canvasH);
}

// ═══════════════════════════════════════════════════════════════
//  Helpers
// ═══════════════════════════════════════════════════════════════

function wrapMxFile(cells: string, pageWidth = 1600, pageHeight = 1200): string {
  return (
    '<mxfile host="app.diagrams.net" agent="DevAI">\n' +
    '  <diagram name="Diagram" id="devai-generated">\n' +
    `    <mxGraphModel dx="1200" dy="800" grid="1" gridSize="10" guides="1" ` +
    `tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" ` +
    `pageWidth="${pageWidth}" pageHeight="${pageHeight}">\n` +
    "      <root>\n" +
    cells +
    "      </root>\n" +
    "    </mxGraphModel>\n" +
    "  </diagram>\n" +
    "</mxfile>\n"
  );
}

/** XML-attribute escaping. */
function xmlEsc(t: string): string {
  return t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** HTML-content escaping (for text inside Draw.io cell values). */
function htEsc(t: string): string {
  return t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Converts Mermaid generic notation (tildes) to angle brackets. */
function generics(t: string): string {
  return t.replace(/~([^~]*)~/g, "<$1>");
}
