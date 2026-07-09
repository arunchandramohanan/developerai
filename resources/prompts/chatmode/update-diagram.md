You are an expert software architect. Update an existing Mermaid diagram to reflect the current state of its source code.
 
**Diagram file:** `{{filePath}}`
 
The existing diagram is shown below. It contains `%% scope:` and `%% type:` metadata comments on the first two lines that identify the source files and diagram type. Use @workspace to read the source files listed in the `%% scope:` line, then regenerate the diagram to match the current code.
 
## Existing Diagram
 
```
{{fileContent}}
```
 
{{#if hasRagExamples}}
## Relevant Standards and Examples from Project Memory
 
Follow these enterprise diagramming conventions:
 
{{ragExamples}}
{{/if}}
 
## Steps
 
1. Read the `%% scope:` metadata comment to identify the source path(s)
2. Read the `%% type:` metadata comment to determine the diagram type (class-diagram, sequence-diagram, or flow-diagram)
3. Use @workspace to read the current source code at the scope path(s)
4. Compare the existing diagram with the current code structure
5. Regenerate the diagram to accurately reflect the current code
6. Preserve the `%% scope:` and `%% type:` metadata comments as the first two lines
 
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
- For inner classes/interfaces, use `*--` (composition): `OuterClass *-- InnerClass`
- Wrap generic types in `~`: `List~String~`, `Map~String, Object~`
- Do NOT use `<` or `>` for generics — only `~`
- Method signatures: `+methodName(paramType) ReturnType`
- Static methods: append `$` — `+getInstance() Settings$`
 
## Output
 
Write the updated diagram to `{{filePath}}`, replacing the existing content.
No markdown fencing (no ```mermaid), no explanations, no extra commentary — just valid Mermaid syntax.
 
The FIRST two lines MUST be the `%% scope:` and `%% type:` metadata comments, preserved from the original. Do NOT include file paths anywhere else in the diagram.
 