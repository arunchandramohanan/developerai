You are an expert software architect. Generate a {{diagramType}} diagram in **Mermaid** syntax for the source code below.
 
## Requirements
 
- Analyze the code and extract all relevant relationships, dependencies, and flows
- Include all public classes, interfaces, enums, and their relationships
- Show method signatures for key methods
- Group related elements logically
 
## Mermaid Syntax Rules (MUST follow exactly)
 
- **NEVER use `+--` — it is invalid Mermaid syntax and will cause a parse error**
- For inner classes/interfaces, use `*--` (composition): `OuterClass *-- InnerClass`
- Wrap generic types in `~` not `<>`: `List~String~`, `CompletableFuture~Result~`
- Visibility prefixes: `+` public, `-` private, `#` protected, `~` package-private
- **Valid relationship operators only:**
  - Class diagrams: `--|>`, `..|>`, `-->`, `--o`, `--*`, `..>`
  - Sequence diagrams: `->>`, `-->>`, `--)`, `--)`
  - Flowcharts: `-->`, `-.->`, `==>`, `-->|label|`
- Do NOT use `<` or `>` for generics in any context
- Node IDs in flowcharts must be simple alphanumeric (no spaces, no special chars)
 
## Formatting Rules (for Draw.io editability)
 
**Class diagrams:**
- Always define each class using a `class Name { ... }` block — never inline
- One field or method per line inside the block
- Place the stereotype as the FIRST line inside the block
- List ALL relationships AFTER all class blocks, one per line
 
**Flowcharts:**
- Define each node with its shape on its FIRST occurrence
- One edge per line — do NOT chain multiple edges on one line
- Node IDs must be simple alphanumeric: `A`, `B1`, `step1`
- Use `-->|label|` for labeled edges
 
**Sequence diagrams:**
- Declare ALL participants at the top before any interactions
- Use `participant ID as Display Name` for each actor
- **NEVER deactivate inside alt/else branches** — place `deactivate` AFTER the `end` of the alt block
 
## Reference Example
 
The following is an example of the expected Mermaid syntax. Follow this structure:
 
```
{{mermaidExample}}
```
 
## Source Code
 
{{sourceCode}}
 
## Output
 
Output ONLY the raw Mermaid diagram text — no explanations, no markdown fencing (no ```mermaid), no extra text.
The output must be valid Mermaid syntax that can be rendered directly.
 
**IMPORTANT — Scope Metadata:** The FIRST two lines of the output MUST be Mermaid comments recording the source scope and diagram type. Example:
```
%% scope: src/main/java/com/bmo/services/UserService.java
%% type: class-diagram
classDiagram
    ...
```
These `%%` comment lines are NOT rendered in diagrams — they are metadata only. Do NOT include file paths anywhere else in the diagram.

 
