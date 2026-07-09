# DevAI VS Code port — Core API reference (for feature implementation)

Reference IntelliJ source: `/home/ubuntu/devai/src/main/java/com/bmo/devai/intellij/`
Target: `/home/ubuntu/plugin2/src/` (TypeScript, CommonJS, strict mode).
Resources copied verbatim to `resources/prompts`, `resources/input-filter`, `resources/icons`.

## Ground rules for feature code
- Do NOT edit: `package.json`, `esbuild.js`, `tsconfig.json`, anything in `src/core/`, `src/models.ts`,
  `src/util/*`, `src/rag/*`. These are the stable core.
- Each feature cluster owns exactly one `src/features/<cluster>.ts` exporting `registerXxx(context)`.
  Overwrite the placeholder. Keep the exported function name and signature.
- Put feature services in `src/services/`, feature-specific models in `src/models/<domain>.ts`,
  views in `src/views/`, preview webviews in `src/views/` or `src/ui/`.
- Register every command your cluster owns via `vscode.commands.registerCommand("devai.<id>", handler)`
  and push to `context.subscriptions`. All command ids already exist in package.json.
- Must pass `npx tsc -p ./ --noEmit`.

## Core API (import paths relative to src/)

### models.ts
`OperationType` (enum), `operationDisplayName/ShortName/RagEligible(op)`.
`ExecutionMode`, `ModePreference`, `ResponseStatus`, `RequestStatus`, `ElementType`.
`CodeSelection { text, filePath, languageName, startOffset, endOffset, elementType }`, `lineCount(sel)`.
`AIRequest`, `newRequest(op, codeSelection|null, prompt, context={})`, `AIResponse`, `isSuccess(r)`.
`cryptoRandomId()`.

### core/copilotService.ts
`CopilotService.getInstance().execute(request): Promise<AIResponse>`
`executeForContent(request): Promise<string>`  ← throws DevAIException on failure; returns raw content.
This is the main entry: build an AIRequest with `newRequest(op, selection, prompt, ctx)` then call it.
SDK vs Chat routing + RAG enrichment (SDK) happen inside automatically.

### core/promptTemplateService.ts
`PromptTemplateService.loadAndRender(name, vars)`, `.buildFullPrompt(sys, user, vars)`, `.render`, `.loadTemplate`.
Templates live in resources/prompts (pass just the file name, e.g. "code-review-user.md").
`{{var}}` substitution + `{{#var}}...{{/var}}` conditionals; user values pass through the input filter.

### core/promptBuilder.ts
`buildTestGenerationPrompt(sel, framework|null, fullFileContent?)`, `buildDocumentationPrompt`,
`buildCodeReviewPrompt`, `buildApplyFixPrompt`, `buildChatPrompt`, `buildTestFixPrompt`,
`collectExistingDocs(basePath, changedFilePaths?)`.
(Diff/review/fix prompt builders that need DiffSummary/CodeIssue: implement in the review feature.)

### core/settings.ts
`settings()` → DevAISettings with getters mirroring the Java (getCopilotModel, getDefaultTestFramework,
getSonarQubeUrl, getJiraBaseUrl, getGithubToken, getSastSource, isRagEnabled, getTeam, isTeamConfigured, …).

### core/modeManager.ts
`ModeManager.getInstance()` → getModePreference/setModePreference, getExecutionContext(), refreshAvailability(),
checkSdkAvailability/checkChatAvailability, addModeChangeListener.

### util/notify.ts
`notifyInfo/notifyWarning/notifyError(msg)`, `showInfo/showWarning/showError(title, content)`,
`showInfoWithActions(title, content, ...actions): Promise<string|undefined>`.

### util/response.ts
`stripCodeFences(s)`, `extractFirstCodeBlock(content)`, `readFileContent(path)`,
`resolveAvailableMarkdownPath(dir, base)`.

### util/files.ts
`readTextFile/writeTextFile/fileExists`, `openFile(path)`, `writeAndOpen(path, content)`,
`baseName/stripExtension/extensionOf`.

### util/codeSelection.ts
`getActiveSelection(): Promise<CodeSelection|null>`, `getSelection(editor)`, `fileSelection(doc)`,
`displayNameForLanguage(languageId)`.

### util/exec.ts  → `runProcess(cmd, args, {cwd,timeoutMs,onStart}): Promise<{exitCode,stdout,stderr,timedOut}>`
### util/http.ts → `httpRequest`, `getJson`, `postJson`, `basicAuthHeader(user,pass)`
### util/json.ts → `extractJson(text)`, `parseJsonLenient<T>(text)`
### util/exception.ts → `DevAIException`, `ErrorCode`
### core/context.ts → `resourcePath(...segs)`, `extensionPath()`, `workspaceRoot()`, `log`, `logError`

## Typical feature flow (matches the Java service pattern)
1. Resolve input: `const sel = await getActiveSelection()` (or a picked file/folder via the command arg URI).
2. Build prompt via promptBuilder or PromptTemplateService.
3. `const content = await executeForContent(newRequest(OperationType.X, sel, prompt, ctx))`
   wrapped in `vscode.window.withProgress({location: Notification, cancellable: true}, ...)`.
4. Parse/clean the response (stripCodeFences / extractFirstCodeBlock / parseJsonLenient).
5. Present: preview webview / diff editor / write output file with writeAndOpen / populate a tree view.
6. Errors → notifyError. Respect `settings().isTeamConfigured()` gating like the Java UseCasePreflightValidator
   only if the Java action does (most just run).

## Command ownership by cluster (all ids already declared in package.json)
- testing.ts: generateTests, generateTestsForFolder, generateTestScenariosAndCases, generateShakedownTests
- documentation.ts: generateDocumentation, generateReadme, generateFileDocumentation,
  generateFolderDocumentation, updateDocsOnChanges, getBusinessLogicSummary, generateUserStories
- review.ts: reviewCode, reviewChanges, detectApiDrift, refreshReviewResults, clearReviewResults
  (+ TreeDataProvider for view id `devai.reviewResultsView`)
- diagrams.ts: generateUMLDiagram, generateSequenceDiagram, generateFlowDiagram, renderMermaidDiagram, updateDiagram
- delivery.ts: generateFeatureCode, updateFeatureCode, generateFeatureScaffold, analyzeDependency,
  executeDependencyMigration, upgradePlatform (+ TreeDataProvider for `devai.platformUpgradesView`)
- security.ts: fixSastFindings, fetchJiraTicket, refreshSastResults (+ TreeDataProvider for `devai.sastResultsView`)
- chatmode.ts: openCopilotChat, toggleChatMode, openSettings
  (+ WebviewViewProvider for `devai.mainView`, + status bar item showing SDK/Chat mode)

Explorer-context commands receive a `vscode.Uri` as the first handler arg (the right-clicked file/folder).
Editor commands should use the active editor / getActiveSelection().
