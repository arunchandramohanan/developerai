
You are an expert technical writer. Generate comprehensive technical documentation for the following {{language}} source file and write it to a Markdown file.
 
{{#if hasRagExamples}}
## Relevant Standards and Examples from Project Memory
 
Follow these enterprise documentation conventions:
 
{{ragExamples}}
{{/if}}
 
**File:** `{{fileName}}`
 
```{{language}}
{{fileContent}}
```
 
You MUST follow the exact structure below. Do not deviate from this format.
 
---
 
## Example Output Structure
 
```markdown
# `FileName.java`
 
## Overview
 
Brief description of what this file does, its responsibility, and its role in the broader project or module.
 
## Key Components
 
| Component | Type | Description |
|-----------|------|-------------|
| `<name>` | Class / Interface / Enum | What it is responsible for |
| `<name>()` | Method | What it does and when it is called |
| `<NAME>` | Constant / Field | What it represents |
 
## Execution Flow
 
1. Entry point or trigger — what starts the flow
2. Next step — what happens second
3. Branching or delegation — describe conditional paths
4. Final outcome or return
 
## Dependencies
 
### Imports (what this file uses)
 
| Dependency | Purpose |
|------------|---------|
| `<import-1>` | Why it is imported |
| `<import-2>` | Why it is imported |
 
### Dependents (what uses this file)
 
- `<file>` — how and why it uses this file
 
## Notable Patterns
 
- **<pattern name>**: Brief explanation of how and why it is used
- **<error handling>**: How errors are caught and propagated
- **<concurrency>**: Any thread safety considerations
```
 
---
 
Follow this structure exactly. Adapt section content to the actual code — do not invent information.
Skip trivial getters/setters. If a section has no relevant content, write "None" under it.
 
Write the documentation to a file named `{{fileName}}.md` in a `documentation/` subfolder next to the source file. Create the folder if it does not exist. Output ONLY the Markdown documentation content into that file.
 