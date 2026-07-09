You are an expert software architect. Generate a **sequence diagram** in **Mermaid** syntax for the code at the specified scope.
 
**Scope:** `{{filePath}}`
 
Use @workspace to read the source files at the specified scope. Analyze the runtime interactions, method call chains, and control flow.
 
{{#if hasRagExamples}}
## Relevant Standards and Examples from Project Memory
 
Follow these enterprise diagramming conventions:
 
{{ragExamples}}
{{/if}}
 
## Steps
 
1. Read the source files at `{{filePath}}`
2. Identify the main actors, services, repositories, and external systems
3. Trace the key method call chains and their responses
4. Map conditional branches (alt/else), loops, and optional blocks
5. Generate valid Mermaid `sequenceDiagram` syntax
6. Write the output file to `docs/diagrams/`
 
## Mermaid Syntax Rules (MUST follow exactly)
 
- Start with `sequenceDiagram` on the first line
- Declare participants: `participant A as DisplayName`
- **Arrow operators (use ONLY these):**
  - `->>` synchronous call (solid line, filled arrow)
  - `-->>` synchronous response (dotted line, filled arrow)
  - `--)` async message (solid line, open arrow)
  - `--)`  async response (dotted line, open arrow)
- Activation: `activate ServiceA` / `deactivate ServiceA`
- **NEVER deactivate inside alt/else branches** — Mermaid processes all branches linearly, so a `deactivate` in the `alt` block means the `else` block sees the participant as already inactive. Always place `deactivate` AFTER the `end` of the alt block.
- Alt blocks: `alt condition` ... `else other` ... `end`
- Loops: `loop description` ... `end`
- Optional: `opt description` ... `end`
- Notes: `Note over A,B: text` or `Note right of A: text`
- **Do NOT use `+--` anywhere — it is invalid Mermaid syntax**
- Keep participant names simple (no spaces, no special chars). Use `as` for display names.
- Do NOT use generic syntax with `<>` in messages — write them plain or use `~`
 
## Formatting Rules
 
- Declare ALL participants at the top before any interactions
- Use `participant ID as Display Name` for each actor
- Keep participant IDs simple alphanumeric — no spaces
- **Display names should be short** — use abbreviated class names without package prefixes (e.g. `CoverageService` not `CoverageBoostServiceImpl`)
- Keep message labels concise — method name and key params only, no full signatures (e.g. `execute(request)` not `execute(AIRequest request, Map metadata)`)
- One message per line
- **Close every `alt`/`loop`/`opt` block with `end`**
- Use `else` on its own line within `alt` blocks
 
## Reference Example
 
```
sequenceDiagram
    participant User as User
    participant Controller as ReviewController
    participant Service as CodeReviewService
    participant Executor as CopilotExecutor
    participant API as Copilot API
 
    User ->> Controller: reviewCode(file)
    activate Controller
 
    Controller ->> Service: reviewFile(virtualFile)
    activate Service
 
    Service ->> Service: buildPrompt(sourceCode)
    Service ->> Executor: execute(prompt)
    activate Executor
 
    Executor ->> API: POST /chat/completions
    API -->> Executor: response JSON
 
    deactivate Executor
    Executor -->> Service: raw result
 
    alt success
        Service ->> Service: parseResult(raw)
        Service -->> Controller: ReviewResult
    else failure
        Service -->> Controller: throw ReviewException
    end
 
    deactivate Service
 
    Controller ->> User: display results
    deactivate Controller
```
 
## Output
 
Write ONLY the raw Mermaid diagram text to `docs/diagrams/`. Create the `docs/diagrams/` directory if it does not exist.
No markdown fencing (no ```mermaid), no explanations, no extra commentary — just valid Mermaid syntax.
 
**IMPORTANT — Scope Metadata:** The FIRST two lines of the output MUST be Mermaid comments recording the source scope and diagram type. These are used by the "Update Diagram" feature. Example:
```
%% scope: src/main/java/com/bmo/services/UserService.java
%% type: sequence-diagram
sequenceDiagram
    ...
```
These `%%` comment lines are NOT rendered in diagrams — they are metadata only. Do NOT include file paths anywhere else in the diagram.
 