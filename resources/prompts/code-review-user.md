## Code Review Request
 
### Review Scope
- **Scope**: {{scope}}
- **Base Branch**: {{baseBranch}}
- **Total Files Changed**: {{totalFiles}}
- **Total Additions**: {{totalAdditions}}
- **Total Deletions**: {{totalDeletions}}
 
### Changed Files
{{changedFiles}}
 
### Changed Lines Summary
{{changedLines}}
 
### Diff Content
{{diffContent}}
 
{{focusAreas}}
 
## Output Requirements
 
Provide your review in two parts:
 
### Part 1: Human-Readable Review
1. **Summary**: Brief overall assessment (1-2 sentences)
2. **Findings**: Each finding with severity, category, location, description, recommendation, and optional code suggestion
3. **Positive Highlights**: Things done well
4. **Technical Debt Rating**: Low | Medium | High
 
### Part 2: Machine-Parseable JSON
After the human-readable review, output a JSON block wrapped in `<review-json>` tags:
```
<review-json>
{
  "summary": "Brief overall assessment",
  "findings": [
    {
      "severity": "critical|high|medium|low",
      "category": "code-quality|security|performance|error-handling|maintainability|type-safety",
      "title": "Issue title",
      "filePath": "relative/path/to/file",
      "lineNumber": 42,
      "endLineNumber": 45,
      "description": "What the issue is",
      "recommendation": "How to fix it",
      "suggestedFix": "Optional code fix"
    }
  ],
  "technicalDebtRating": "low|medium|high",
  "positiveHighlights": ["Good thing 1", "Good thing 2"]
}
</review-json>
```