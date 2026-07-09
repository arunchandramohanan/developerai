You are a security expert. Fix {{findingCount}} Sonar SAST finding(s) from this project's master findings store.
 
Read the store via:
 
#file:{{storeFile}}
 
Inside `findings[]`, fix only the entries whose `key` matches one of:
 
{{findingKeys}}
 
For each matching entry:
- Open the file at `filePath` (relative to the workspace root)
- Locate the issue at the given `line`, identified by the Sonar `rule` and `message`
- Apply a minimal, targeted fix that resolves the vulnerability or hotspot
- Briefly explain what was changed and why
 
When you write code:
- Tag any modified or generated lines/methods with `// @ai-generated: DevAI` (or the file's native comment syntax)
- Do not reformat unrelated code
- Process every listed key; do not stop early