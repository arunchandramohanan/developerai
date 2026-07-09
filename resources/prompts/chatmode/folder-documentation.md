You are an expert technical writer. Generate a comprehensive summary documentation for the folder described below and write it to a Markdown file.
 
{{#if hasRagExamples}}
## Relevant Standards and Examples from Project Memory
 
Follow these enterprise documentation conventions:
 
{{ragExamples}}
{{/if}}
 
**Folder:** `{{folderPath}}`
**Workspace:** `{{workspaceRoot}}`
 
Use @workspace to explore the contents of the folder `{{folderPath}}`. Read the source files in that folder to understand what each file does.
 
You MUST follow the exact structure below. Do not deviate from this format.
 
---
 
## Example Output Structure
 
```markdown
# `folder-name`
 
## Purpose
 
One to three sentences explaining what this folder/module is responsible for and where it fits in the project architecture.
 
## Key Files
 
| File | Type | Description |
|------|------|-------------|
| `<file-1>` | <type> | Brief description of responsibility |
| `<file-2>` | <type> | Brief description of responsibility |
| `<file-3>` | <type> | Brief description of responsibility |
 
## Architecture
 
### Data Flow
 
1. `<file>` — what happens first
2. `<file>` — what happens next
3. `<file>` — what happens after
4. Final outcome or return
 
### Key Relationships
 
- `<file-A>` implements/extends `<file-B>`
- `<file-C>` depends on `<file-D>` (how/why)
 
## Patterns & Conventions
 
- **<pattern name>**: Brief explanation of how it is applied
- **<convention>**: How files/classes are named and why
- **<error handling>**: How errors are managed across the module
```
 
---
 
Follow this structure exactly. Read the actual source files before writing — do not guess or invent information.
If a section has no relevant content, write "None" under it.
 
Write the documentation to a file named `<folder-name>-summary.md` inside the `{{folderPath}}` folder. Output ONLY the Markdown documentation content into that file.
