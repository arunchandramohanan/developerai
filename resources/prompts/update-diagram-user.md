Update the following Mermaid diagram to reflect the current state of the source code.
 
## Diagram Type
 
{{diagramType}}
 
## Existing Diagram
 
{{existingDiagram}}
 
## Current Source Code
 
{{sourceCode}}
 
## Instructions
 
1. Compare the existing diagram with the current source code
2. Add new classes, methods, fields, or relationships that were added to the code
3. Remove elements that no longer exist in the code
4. Update any changed signatures, types, or relationships
5. Preserve the overall layout style and structure of the existing diagram
 
## Mermaid Syntax Rules (MUST follow exactly)
 
- Visibility prefixes: `+` public, `-` private, `#` protected, `~` package-private
- Stereotypes inside class block: `<<interface>>`, `<<abstract>>`, `<<enumeration>>`, `<<record>>`
- **Relationships (use ONLY these operators):**
  - `--|>` inheritance (extends)
  - `..|>` implementation (implements)
  - `-->` dependency (uses)
  - `--o` aggregation (has-a)
  - `--*` composition (owns / inner type)
  - `..>` dependency (dotted)
- **NEVER use `+--` — it is invalid Mermaid syntax and will cause a parse error**
- Wrap generic types in `~`: `List~String~`, `Map~String, Object~`
- Do NOT use `<` or `>` for generics — only `~`
 
## Output
 
Output ONLY the raw Mermaid diagram text — no explanations, no markdown fencing (no ```mermaid), no extra text.
The output must be valid Mermaid syntax that can be rendered directly.
 
**IMPORTANT — Scope Metadata:** The FIRST two lines of the output MUST be the `%% scope:` and `%% type:` metadata comments, preserved from the existing diagram. Do NOT include file paths anywhere else in the diagram.