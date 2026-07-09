You are an expert software architect. Generate a **class diagram** in **Mermaid** syntax for the code at the specified scope.
 
**Scope:** `{{filePath}}`
 
Use @workspace to read the source files at the specified scope. Analyze the code structure and relationships.
 
{{#if hasRagExamples}}
## Relevant Standards and Examples from Project Memory
 
Follow these enterprise diagramming conventions:
 
{{ragExamples}}
{{/if}}
 
## Steps
 
1. Read the source files at `{{filePath}}`
2. Identify all classes, interfaces, enums, abstract classes, and records
3. Extract fields (with visibility and types) and key method signatures
4. Map relationships: inheritance, implementation, composition, aggregation, dependency
5. Generate valid Mermaid `classDiagram` syntax
6. Write the output file to `docs/diagrams/`
 
## Mermaid Syntax Rules (MUST follow exactly)
 
- Start with `classDiagram` on the first line
- Visibility prefixes: `+` public, `-` private, `#` protected, `~` package-private
- Stereotypes go inside the class block: `<<interface>>`, `<<abstract>>`, `<<enumeration>>`, `<<record>>`
- **Relationships (use ONLY these operators):**
  - `--|>` inheritance (extends)
  - `..|>` implementation (implements)
  - `-->` dependency (uses)
  - `--o` aggregation (has-a)
  - `--*` composition (owns / inner type)
  - `..>` dependency (dotted)
- **NEVER use `+--` — it is invalid Mermaid syntax and will cause a parse error**
- For inner classes/interfaces, use `*--` (composition): `OuterClass *-- InnerClass`
- Wrap generic types in `~`: `List~String~`, `Map~String, Object~`, `CompletableFuture~ReviewResult~`
- Do NOT use `<` or `>` for generics — only `~`
- Method signatures: `+methodName(paramType) ReturnType`
- Static methods: append `$` — `+getInstance() Settings$`
 
## Formatting Rules (for Draw.io editability)
 
- **Always** define each class using a `class Name { ... }` block — never inline class declarations
- One field or method per line inside the block
- Place the stereotype (`<<interface>>`, `<<enumeration>>`, etc.) as the FIRST line inside the block
- List ALL relationships AFTER all class blocks, one per line
- Keep class names simple — no spaces or special characters
- Members go **inside** the class block, not outside
 
## Reference Example
 
```
classDiagram
    class UserService {
        -UserRepository repository
        -Logger LOG
        +findById(Long) User
        +saveUser(User) void
        +deleteUser(Long) void
    }
 
    class UserRepository {
<<interface>>
        +findById(Long) Optional~User~
        +save(User) User
        +deleteById(Long) void
    }
 
    class User {
        -Long id
        -String name
        -String email
        +getId() Long
        +getName() String
    }
 
    class UserRole {
<<enumeration>>
        ADMIN
        USER
        GUEST
    }
 
    UserService ..|> Serializable : implements
    UserService --> UserRepository : uses
    UserService ..> User : creates/returns
    User --o UserRole : has
```
 
## Output
 
Write ONLY the raw Mermaid diagram text to `docs/diagrams/`. Create the `docs/diagrams/` directory if it does not exist.
No markdown fencing (no ```mermaid), no explanations, no extra commentary — just valid Mermaid syntax.
 
**IMPORTANT — Scope Metadata:** The FIRST two lines of the output MUST be Mermaid comments recording the source scope and diagram type. These are used by the "Update Diagram" feature. Example:
```
%% scope: src/main/java/com/bmo/services/UserService.java
%% type: class-diagram
classDiagram
    ...
```
These `%%` comment lines are NOT rendered in diagrams — they are metadata only. Do NOT include file paths anywhere else in the diagram.
 