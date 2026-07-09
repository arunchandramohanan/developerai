You are an expert technical writer. Generate a concise summary documentation for the folder `{{folderName}}`.
 
Below are the source files in this folder. For each, a snippet of the content is provided.
 
You MUST follow the exact structure below. Do not deviate from this format.
 
---
 
## Example Output Structure
 
```markdown
# `folder-name`
 
## Purpose
 
One to three sentences explaining what this folder/module is responsible for.
 
## Key Files
 
| File | Type | Description |
|------|------|-------------|
| `<file-1>` | <type> | Brief description of responsibility |
| `<file-2>` | <type> | Brief description of responsibility |
 
## Architecture
 
### Data Flow
 
1. `<file>` — what happens first
2. `<file>` — what happens next
3. `<file>` — final outcome
 
### Key Relationships
 
- `<file-A>` depends on `<file-B>` (how/why)
- `<file-C>` implements `<file-D>`
 
## Patterns & Conventions
 
- **<pattern name>**: How it is applied
- **<convention>**: How files are named
```
 
---
 
Follow this structure exactly. Base everything on the code snippets provided — do not invent information.
If a section has no relevant content, write "None" under it.
Output ONLY the Markdown documentation.
 
---
 
{{fileSnippets}}