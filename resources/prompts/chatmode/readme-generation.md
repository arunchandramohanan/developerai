You are an expert technical writer. Generate a comprehensive README.md for this project.
 
{{#if hasRagExamples}}
## Relevant Standards and Examples from Project Memory
 
Follow these enterprise documentation conventions:
 
{{ragExamples}}
{{/if}}
 
Project name: **{{projectName}}**
Workspace root: `{{workspaceRoot}}`
 
{{#if hasFile}}
Here is the main project file for context:
 
**File:** `{{fileName}}`
```{{language}}
{{fileContent}}
```
{{/if}}
 
You MUST follow the exact structure below. Do not deviate from this format.
 
---
 
## Example Output Structure
 
```markdown
# Project Name — Short Tagline
 
> One to two sentence description of what this project does and who it is for.
 
## Features
 
| Feature | Description | Shortcut |
|---------|-------------|----------|
| <feature-1> | What it does | `<shortcut>` or — |
| <feature-2> | What it does | `<shortcut>` or — |
 
## Prerequisites
 
- Requirement 1 (e.g., JDK 17+)
- Requirement 2 (e.g., Gradle 8.x)
- Requirement 3 (e.g., GitHub CLI)
 
## Installation
 
### From Source
 
1. Clone the repository
2. Build command
3. Install/run command
 
### From Release
 
1. Download from releases page
2. Installation steps
 
## Usage
 
### Key Features
 
Step-by-step walkthrough of the primary workflow.
 
 
## Configuration
 
| Setting | Description | Default |
|---------|-------------|---------|
| `<setting.key>` | What it controls | `<default>` |
 
## Development
 
### Build
 
Command to build the project.
 
### Test
 
Command to run tests.
 
### Project Structure
 
Brief annotated tree of the key directories.
 
## Contributing
 
- Branching strategy
- Code style rules
- PR process
 
## License 
```
 
---
 
Follow this structure exactly. Use @workspace to explore the project and base everything on the actual codebase — do not guess.
Adapt section content to the real project. If a section is not applicable, write "N/A" under it.
 
Write the output to `README.md` in the workspace root. Output ONLY the README content in Markdown.