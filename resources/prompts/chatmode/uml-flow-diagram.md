You are an expert software architect. Generate a **flow diagram** (flowchart) in **Mermaid** syntax for the code at the specified scope.
 
**Scope:** `{{filePath}}`
 
Use @workspace to read the source files at the specified scope. Analyze the control flow, decision points, and process steps.
 
{{#if hasRagExamples}}
## Relevant Standards and Examples from Project Memory
 
Follow these enterprise diagramming conventions:
 
{{ragExamples}}
{{/if}}
 
## Steps
 
1. Read the source files at `{{filePath}}`
2. Identify the entry point, major processing steps, and exit points
3. Map decision points (if/else, switch), loops, and error handling paths
4. Generate valid Mermaid `flowchart` syntax
5. Write the output file to `docs/diagrams/`
 
## Mermaid Syntax Rules (MUST follow exactly)
 
- Start with `flowchart TD` (top-down) or `flowchart LR` (left-right) on the first line
- **Node shapes:**
  - `A[Text]` — rectangle (process step)
  - `B{Text}` — diamond (decision)
  - `C([Text])` — stadium/rounded (start/end)
  - `D[(Text)]` — cylinder (database)
  - `E[[Text]]` — subroutine
  - `F((Text))` — circle
- **Arrow operators (use ONLY these):**
  - `-->` solid arrow
  - `-.->` dotted arrow
  - `==>` thick arrow
  - `-->|label|` arrow with label
- **NEVER use `+--` — it is invalid Mermaid syntax and will cause a parse error**
- Node IDs must be simple alphanumeric (A, B, C1, step1, etc.) — no spaces, no special chars
- Labels with special characters must be quoted: `A["Text with (parens)"]`
- Subgraphs: `subgraph Title` ... `end`
- Do NOT use `<>` in labels — they break Mermaid parsing. Use plain text or quotes.
 
## Formatting Rules (for Draw.io editability)
 
- **Define each node with its shape on its FIRST occurrence** — e.g. `A[Process Step]`, `B{Decision?}`, `C([Start])`
- Use **one edge per line** — do NOT chain multiple edges on one line
- Node IDs must be simple alphanumeric: `A`, `B1`, `step1` — no spaces, no hyphens
- Always define the node shape before referencing it in edges
- After a node is defined with its shape, subsequent edges can reference it by ID alone
- Use `-->|label|` for labeled edges, NOT `-- label -->`
 
## Reference Example
 
```
flowchart TD
    A([Start: User clicks Review]) --> B[Get active editor]
    B --> C{Editor available?}
 
    C -->|yes| D[Extract code selection]
    C -->|no| E[Show warning notification]
    E --> Z([End])
 
    D --> F{Chat Mode active?}
 
    F -->|yes| G[Compose chat prompt]
    G --> H[Open Copilot Chat]
    H --> Z
 
    F -->|no| I[Build SDK prompt]
    I --> J[Call Copilot CLI]
    J --> K{Response OK?}
 
    K -->|yes| L[Parse review result]
    L --> M[Show results panel]
    M --> Z
 
    K -->|no| N[Show error notification]
    N --> Z
```
 
## Output
 
Write ONLY the raw Mermaid diagram text to `docs/diagrams/`. Create the `docs/diagrams/` directory if it does not exist.
No markdown fencing (no ```mermaid), no explanations, no extra commentary — just valid Mermaid syntax.
 
**IMPORTANT — Scope Metadata:** The FIRST two lines of the output MUST be Mermaid comments recording the source scope and diagram type. These are used by the "Update Diagram" feature. Example:
```
%% scope: src/main/java/com/bmo/actions/ReviewAction.java
%% type: flow-diagram
flowchart TD
    ...
```
These `%%` comment lines are NOT rendered in diagrams — they are metadata only. Do NOT include file paths anywhere else in the diagram.