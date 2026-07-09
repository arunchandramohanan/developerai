Analyze the following OpenAPI/Swagger git diff, and compilation errors to detect API drift.  
You MUST follow the exact structure below. Do not deviate from this format.
 
The selected OpenAPI/Swagger file identifies the intended API contract, and its git diff shows what contract changes were made, if any.  
Your task is to determine whether the changed code appears aligned with the selected API-spec git diff, identify any likely contract drift, and explain the impact on application logic.
 
{{#if hasRagExamples}}
## Relevant Standards and Examples from Project Memory
 
Apply these project-specific API conventions, fix patterns, and prior drift examples while analyzing the spec and changed code:
 
{{ragExamples}}
{{/if}}
 
---
 
## Example Output Structure
 
### 1. Summary
- High-level description of detected API changes if any (e.g., "3 breaking changes across 2 endpoints")
- Brief explanation of potential impact on dependent code
 
---
 
### 2. Scope
- API spec source: `{{changedFiles}}`
- Drift source: `Selected OpenAPI/Swagger file git diff`
 
---
 
### 3. Detected API Changes
For each relevant mismatch between the selected API-spec git diff and the changed code:
 
- **API Element**
    - `METHOD PATH` or `SchemaName.field`
- **Change Type**
    - Added / removed endpoint
    - Field added / removed
    - Required/optional change (e.g., nullable → required)
    - Type change
- **Breaking Level**
    - `<Low | Medium | High>`
- **Explanation**
    - Why this change may break or alter dependent application logic
 
If no breaking or behavior-impacting drift is found, explicitly state:
- **No API drift detected**
 
---
 
### 4. Application Impact Guidance
For each breaking or impactful change:
 
- **What Must Change**
    - Method usage
    - DTO construction or validation
    - Required fields now needing values
- **What Does Not Change**
    - Explicitly note unaffected logic where applicable
 
---
 
### 5. Optional Auto-Fix Generation (If Requested)
Do NOT generate any code changes automatically. Instead, ask the user if they would like you to implement fixes for the detected drift.
Wait for the user to explicitly confirm before producing any code.
If the user confirms:
- Provide minimal, targeted code changes that align application logic
  with the updated API contract.
- Do not introduce speculative or non–spec-driven changes.
 
---
 
Follow this structure exactly. Adapt content strictly to the input below.
 
### Rules
- Use the selected OpenAPI/Swagger file path and its git diff as the contract reference.
- Use the spec git diff to determine whether the code changes align with the spec.
- Use any existing compilation errors as indicators of potential API drift.
- Detect and report drift even if code would still compile.
- Be concise and implementation-focused.
- If information is missing, state **"Not available in input"**.
- Do not suggest business logic changes unless required by the spec.
 
---
 
## Inputs
 
- **OpenAPI/Swagger Git Diff**
 
{{diffContent}}
 
 