# BMO GenAI Developer — VS Code Extension

AI-assisted development for VS Code: test generation, documentation, code review,
UML/sequence/flow diagrams, feature-code generation, dependency & platform
upgrades, and SAST (SonarQube / GitHub Code Scanning) remediation. This is a
feature-for-feature port of the **DevAI IntelliJ plugin** (`com.bmo.devai.intellij`).

## Dual-mode execution

Mirrors the IntelliJ plugin's SDK/Chat/Auto model:

- **SDK mode** — shells out to the **GitHub Copilot CLI** (`copilot -p … --model …`). It prefers the standalone `copilot` binary and falls back to the `gh copilot` extension form.
- **Chat mode** — uses the VS Code **Language Model API** (`vscode.lm`) to drive GitHub Copilot's chat models (the VS Code equivalent of IntelliJ's Copilot Chat integration).
- **Auto** — tries SDK first and falls back to Chat.

Set the mode in Settings → *BMO GenAI Developer* → `devai.modePreference`, via the
status-bar item, or the **Toggle Chat Mode** command. Default is **Chat Only**.

## Requirements

- VS Code 1.90+
- For **SDK mode**: the GitHub Copilot CLI — install with `npm install -g @github/copilot`, then run `copilot` once to sign in (or set a `GH_TOKEN`/`GITHUB_TOKEN` with Copilot access). Alternatively the GitHub CLI (`gh`) with `gh extension install github/gh-copilot` + `gh auth login`. If `copilot` isn't on VS Code's `PATH`, set `devai.copilotCliPath` to its full path.
- For **Chat mode**: the GitHub Copilot Chat extension, signed in.

## Features (commands)

All commands are under the **BMO GenAI** category and appear in the editor/explorer
context menus, the command palette, and the sidebar home panel.

| Command | Description | Shortcut |
|---|---|---|
| Generate Unit Tests | Tests for the selection / enclosing symbol | `Ctrl+Alt+T` |
| Generate Tests for Folder | Batch test generation | |
| Create Inline Documentation | Doc comments for the symbol | `Ctrl+Alt+D` |
| Generate README / File / Folder Documentation | Markdown docs | |
| Update Documentation | Update docs from code changes | |
| Generate Business Logic + Requirements | Business summary | |
| Generate User Stories | Jira-ready stories | |
| Generate Test Scenarios and Cases | From requirements | |
| Generate Shakedown Test Suite | Postman v2.1 from OpenAPI | |
| Review Code / Review Changed Files | AI code review + findings | `Ctrl+Alt+R` |
| Detect API Drift | OpenAPI contract drift | |
| Generate Class / Sequence / Flow Diagram | Mermaid diagrams | |
| Render Diagram / Update Diagram | `.mmd` → SVG/Draw.io | |
| Generate / Update / Scaffold Feature Code | From requirements | |
| Analyze / Execute Dependency Migration | Dependency upgrades | |
| Automate Platform and Framework Upgrades | Upgrade scan | |
| Fix SAST Findings | SonarQube / GitHub Code Scanning | |
| Fetch Jira Ticket | Fetch a ticket by key | |
| Open Copilot Chat / Toggle Chat Mode | | `Ctrl+Alt+C` / `Ctrl+Alt+M` |

## Views

- **BMO GenAI Developer** (activity bar) — home panel + Platform Upgrades.
- **Review Results** and **SAST Findings** (panel) — findings trees + diagnostics.

## Configuration

All settings live under the `devai.*` namespace (mode, model, timeouts, RAG,
analytics, SonarQube, GitHub Code Scanning, Sonatype, Jira, SSO). See
Settings → *BMO GenAI Developer*.

## Build

```
npm install
npm run build      # bundle with esbuild → dist/extension.js
npm run compile    # type-check only
npm run package    # produce the .vsix (requires @vscode/vsce)
```

Press **F5** in VS Code to launch an Extension Development Host.

---
**Maintained by:** BMO GenAI Developer Team
