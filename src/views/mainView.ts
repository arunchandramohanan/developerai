import * as vscode from "vscode";
import { ExecutionMode } from "../models";
import { currentExecutionMode } from "../chatmode/integrator";
import { ModeManager } from "../core/modeManager";
import { modePreferenceDisplayName } from "../chatmode/constants";
import { log } from "../core/context";
import {
  CoverageReport,
  CoverageService,
  coverageLinePercent,
  coverageTotalBranches,
  coverageTotalLines,
  testResultsAllPassed,
  testResultsTotal,
} from "../services/coverageService";

interface ActionSpec {
  command: string;
  label: string;
  description: string;
}

interface SectionSpec {
  title: string;
  icon: string;
  actions: ActionSpec[];
}

/**
 * The main sidebar home panel (view id `devai.mainView`).
 * Port of DevAIMainPanel + DevAIToolWindowFactory: presents the same category
 * tree as the IntelliJ tool window (same sections, same order, same entries),
 * shows the current execution mode, and renders the CODE COVERAGE panel below
 * the tree. Clicks post a message that runs the matching `devai.*` command.
 */
export class MainViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "devai.mainView";

  private view: vscode.WebviewView | undefined;

  constructor(private readonly extensionUri: vscode.Uri) {}

  /** Mirrors DevAIMainPanel.buildTreeStructure() category order and entries. */
  private static readonly SECTIONS: SectionSpec[] = [
    {
      title: "Code Review",
      icon: "🔍",
      actions: [
        { command: "devai.reviewFeatureBranch", label: "Review Feature Branch Changes", description: "Review all changes on this branch vs main" },
        { command: "devai.reviewUncommitted", label: "Review Uncommitted Changes", description: "Review all uncommitted changes" },
        { command: "devai.reviewStaged", label: "Review Staged Changes", description: "Review only staged changes" },
        { command: "devai.reviewCurrentFile", label: "Review Current File", description: "Review changes in the current file" },
        { command: "devai.detectApiDrift", label: "Detect API Drift", description: "Analyze the git diff of a selected OpenAPI/Swagger file against current code changes" },
      ],
    },
    {
      title: "Shakedown Testing",
      icon: "🚦",
      actions: [
        { command: "devai.generateShakedownTests", label: "Generate Shakedown Tests", description: "Generate a Postman shakedown test collection from an OpenAPI/Swagger spec" },
      ],
    },
    {
      title: "Update Your Code",
      icon: "🛠️",
      actions: [
        { command: "devai.generateTests", label: "Generate Unit Tests", description: "Create tests for selected code" },
        { command: "devai.generateTestsForFolder", label: "Generate Tests for Folder", description: "Create tests for all classes in a folder" },
        { command: "devai.analyzeDependency", label: "Analyze Dependency Migration", description: "Analyze project dependencies for updates, vulnerabilities, and breaking changes" },
        { command: "devai.executeDependencyMigration", label: "Execute Dependency Migration", description: "Generate migration code changes from a dependency analysis report" },
      ],
    },
    {
      title: "Create Diagrams",
      icon: "📊",
      actions: [
        { command: "devai.generateUMLDiagram", label: "Generate Class Diagram", description: "Generate a class diagram from source code" },
        { command: "devai.generateSequenceDiagram", label: "Generate Sequence Diagram", description: "Generate a sequence diagram from source code" },
        { command: "devai.generateFlowDiagram", label: "Generate Flow Diagram", description: "Generate a flow diagram from source code" },
        { command: "devai.renderMermaidDiagram", label: "Render Diagram", description: "Render a .mmd file to SVG or Draw.io" },
        { command: "devai.updateDiagram", label: "Update Diagram", description: "Update an existing .mmd diagram from current source" },
      ],
    },
    {
      title: "Documentation",
      icon: "📝",
      actions: [
        { command: "devai.generateDocumentation", label: "Create Inline Documentation", description: "Generate inline doc comments for a code element" },
        { command: "devai.generateReadme", label: "Generate README", description: "Generate a project README.md" },
        { command: "devai.generateFileDocumentation", label: "Generate File Documentation", description: "Generate technical .md docs for a source file" },
        { command: "devai.generateFolderDocumentation", label: "Generate Folder Documentation", description: "Generate summary .md docs for a folder" },
        { command: "devai.getBusinessLogicSummary", label: "Get Business Logic Summary", description: "Generate business summary markdown for a selected file or folder" },
        { command: "devai.generateTestScenariosAndCases", label: "Generate Scenarios and Test Cases", description: "Generate test scenarios, test cases, and sample data from requirements" },
        { command: "devai.updateDocsOnChanges", label: "Update Documentation", description: "Update existing documentation based on code changes" },
      ],
    },
    {
      title: "Security",
      icon: "🛡️",
      actions: [
        { command: "devai.fixSastFindings", label: "Fix SAST Findings", description: "Fetch SAST findings and send fix prompts to Copilot Chat" },
      ],
    },
    {
      title: "Design",
      icon: "✏️",
      actions: [
        { command: "devai.generateUserStories", label: "Generate User Stories", description: "Generate Jira-ready user stories from a requirements document" },
      ],
    },
    {
      title: "Feature Scaffolding",
      icon: "🧩",
      actions: [
        { command: "devai.generateFeatureScaffold", label: "Generate Feature Scaffold", description: "Generate a feature scaffold from a requirements document" },
        { command: "devai.updateFeatureCode", label: "Update Feature Code", description: "Update existing code from a requirements document" },
      ],
    },
    {
      title: "AI Assistant",
      icon: "💬",
      actions: [
        { command: "devai.openCopilotChat", label: "Open Copilot Chat", description: "Open the GitHub Copilot Chat panel" },
        { command: "devai.toggleChatMode", label: "Toggle Chat Mode", description: "Toggle between SDK and Chat execution mode" },
      ],
    },
    {
      title: "Settings",
      icon: "⚙️",
      actions: [
        { command: "devai.openSettings", label: "BMO GenAI Settings", description: "Open BMO GenAI Developer preferences" },
      ],
    },
  ];

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.extensionUri],
    };
    webviewView.webview.html = this.getHtml(webviewView.webview);

    webviewView.webview.onDidReceiveMessage(async (message: { type: string; command?: string }) => {
      try {
        if (message.type === "command" && message.command) {
          await vscode.commands.executeCommand(message.command);
        } else if (message.type === "toggleMode") {
          await vscode.commands.executeCommand("devai.toggleChatMode");
        } else if (message.type === "runCoverage") {
          await this.runCoverage();
        } else if (message.type === "ready") {
          this.postMode();
          this.postCachedCoverage();
        }
      } catch (e) {
        log("Main view command failed: " + (e instanceof Error ? e.message : String(e)));
      }
    });

    // Push the initial mode once the view is up.
    this.postMode();
  }

  /** Pushes the current execution mode to the webview so its badge stays in sync. */
  postMode(): void {
    if (!this.view) return;
    const mode = currentExecutionMode();
    const preference = ModeManager.getInstance().getModePreference();
    void this.view.webview.postMessage({
      type: "mode",
      mode: mode === ExecutionMode.CHAT ? "Chat" : "SDK",
      preference: modePreferenceDisplayName(preference),
    });
  }

  // ---- Coverage panel (port of DevAIMainPanel coverage panel) -------------

  /** Port of DevAIMainPanel.loadCachedCoverage. */
  private postCachedCoverage(): void {
    const report = CoverageService.getInstance().getLastReport();
    if (report) this.postCoverage(report);
  }

  /** Port of DevAIMainPanel.runCoverage. */
  private async runCoverage(): Promise<void> {
    const svc = CoverageService.getInstance();
    if (svc.isRunning()) return;
    void this.view?.webview.postMessage({ type: "coverageRunning" });
    try {
      const report = await svc.runCoverage();
      this.postCoverage(report);
    } catch (e) {
      void this.view?.webview.postMessage({
        type: "coverageError",
        message: e instanceof Error ? e.message : String(e),
      });
    }
  }

  /** Port of DevAIMainPanel.updateCoverageUI. */
  private postCoverage(report: CoverageReport): void {
    if (!this.view) return;
    const tr = report.testResults;
    let testsText = "Estimated from file analysis";
    let testsState: "info" | "pass" | "fail" = "info";
    if (testResultsTotal(tr) > 0) {
      if (testResultsAllPassed(tr)) {
        testsText = `${tr.passed} / ${testResultsTotal(tr)} tests passed`;
        testsState = "pass";
      } else {
        testsText = `${tr.passed} passed, ${tr.failed} failed, ${tr.errors} errors, ${tr.skipped} skipped`;
        testsState = "fail";
      }
    }
    void this.view.webview.postMessage({
      type: "coverage",
      percent: Math.round(coverageLinePercent(report)),
      lines: `Lines: ${report.lineCovered}/${coverageTotalLines(report)}    Branches: ${report.branchCovered}/${coverageTotalBranches(report)}`,
      testsText,
      testsState,
    });
  }

  private getHtml(webview: vscode.Webview): string {
    const nonce = getNonce();
    const csp = `default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';`;

    const sectionsHtml = MainViewProvider.SECTIONS.map((section) => {
      const buttons = section.actions
        .map(
          (a) =>
            `<button class="action" data-command="${escapeHtml(a.command)}" title="${escapeHtml(a.description)}">
               <span class="action-label">${escapeHtml(a.label)}</span>
               <span class="action-desc">${escapeHtml(a.description)}</span>
             </button>`
        )
        .join("");
      return `<section class="group">
                <h2 class="group-title"><span class="group-icon">${section.icon}</span>${escapeHtml(section.title)}</h2>
                <div class="actions">${buttons}</div>
              </section>`;
    }).join("");

    return `<!-- content injected into the extension's webview skeleton -->
<meta http-equiv="Content-Security-Policy" content="${csp}">
<style nonce="${nonce}">
  :root { color-scheme: light dark; }
  body {
    font-family: var(--vscode-font-family);
    font-size: var(--vscode-font-size);
    color: var(--vscode-foreground);
    background: var(--vscode-sideBar-background);
    padding: 0 8px 16px;
    margin: 0;
  }
  header {
    position: sticky; top: 0; z-index: 1;
    background: var(--vscode-sideBar-background);
    padding: 10px 2px 8px;
    border-bottom: 1px solid var(--vscode-panel-border);
  }
  .title { font-weight: 600; font-size: 1.05em; display: flex; align-items: center; gap: 6px; }
  .mode-row {
    display: flex; align-items: center; justify-content: space-between;
    margin-top: 8px; gap: 8px;
  }
  .mode-badge {
    display: inline-flex; align-items: center; gap: 6px;
    padding: 2px 8px; border-radius: 10px;
    background: var(--vscode-badge-background);
    color: var(--vscode-badge-foreground);
    font-size: 0.85em;
  }
  .mode-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--vscode-charts-green, #3fb950); }
  .toggle-btn, .coverage-btn {
    border: 1px solid var(--vscode-button-border, transparent);
    background: var(--vscode-button-secondaryBackground, var(--vscode-button-background));
    color: var(--vscode-button-secondaryForeground, var(--vscode-button-foreground));
    border-radius: 4px; padding: 3px 10px; cursor: pointer; font-size: 0.85em;
  }
  .toggle-btn:hover, .coverage-btn:hover { background: var(--vscode-button-secondaryHoverBackground, var(--vscode-button-hoverBackground)); }
  .coverage-btn:disabled { opacity: 0.55; cursor: default; }
  .group { margin-top: 14px; }
  .group-title {
    font-size: 0.72em; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase;
    color: var(--vscode-descriptionForeground); margin: 0 0 6px; display: flex; align-items: center; gap: 6px;
  }
  .group-icon { font-size: 1.15em; }
  .actions { display: flex; flex-direction: column; gap: 4px; }
  .action {
    display: flex; flex-direction: column; align-items: flex-start; text-align: left;
    width: 100%; box-sizing: border-box; gap: 1px;
    padding: 6px 8px; border-radius: 4px; cursor: pointer;
    background: transparent; border: 1px solid transparent; color: var(--vscode-foreground);
  }
  .action:hover { background: var(--vscode-list-hoverBackground); border-color: var(--vscode-panel-border); }
  .action:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: -1px; }
  .action-label { font-size: 0.92em; font-weight: 500; }
  .action-desc { font-size: 0.78em; color: var(--vscode-descriptionForeground); }
  /* Coverage panel (mirrors the IntelliJ CODE COVERAGE panel below the tree) */
  .coverage {
    margin-top: 16px; padding: 8px 10px 10px;
    border-top: 1px solid var(--vscode-panel-border);
  }
  .coverage-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px; }
  .coverage-track {
    height: 14px; border-radius: 7px; overflow: hidden;
    background: var(--vscode-progressBar-background, var(--vscode-input-background));
    position: relative;
  }
  .coverage-fill {
    height: 100%; width: 0%; border-radius: 7px;
    background: #4b87dc; transition: width 0.3s ease;
  }
  .coverage-fill.indeterminate { width: 100%; opacity: 0.4; }
  .coverage-pct {
    position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
    font-size: 0.72em; font-weight: 600;
  }
  .coverage-lines { margin-top: 4px; font-size: 0.78em; color: var(--vscode-descriptionForeground); }
  .coverage-tests { margin-top: 2px; font-size: 0.78em; font-weight: 600; color: var(--vscode-descriptionForeground); }
  .coverage-tests.pass { color: var(--vscode-charts-green, #4caf50); }
  .coverage-tests.fail { color: var(--vscode-charts-red, #f44336); }
  .coverage-lines.error { color: var(--vscode-charts-red, #f44336); }
</style>
<header>
  <div class="title">🤖 BMO GenAI Developer</div>
  <div class="mode-row">
    <span class="mode-badge"><span class="mode-dot"></span>Mode: <strong id="mode-value">…</strong></span>
    <button class="toggle-btn" id="toggle-mode">Toggle Mode</button>
  </div>
</header>
<main>${sectionsHtml}</main>
<section class="coverage">
  <div class="coverage-head">
    <h2 class="group-title" style="margin:0">Code Coverage</h2>
    <button class="coverage-btn" id="coverage-run" title="Estimate test coverage">Run</button>
  </div>
  <div class="coverage-track">
    <div class="coverage-fill" id="coverage-fill"></div>
    <div class="coverage-pct" id="coverage-pct">— %</div>
  </div>
  <div class="coverage-lines" id="coverage-lines">Click Run to estimate coverage</div>
  <div class="coverage-tests" id="coverage-tests"></div>
</section>
<script nonce="${nonce}">
  const vscode = acquireVsCodeApi();
  document.querySelectorAll('.action').forEach((btn) => {
    btn.addEventListener('click', () => {
      vscode.postMessage({ type: 'command', command: btn.getAttribute('data-command') });
    });
  });
  document.getElementById('toggle-mode').addEventListener('click', () => {
    vscode.postMessage({ type: 'toggleMode' });
  });
  const coverageRun = document.getElementById('coverage-run');
  const coverageFill = document.getElementById('coverage-fill');
  const coveragePct = document.getElementById('coverage-pct');
  const coverageLines = document.getElementById('coverage-lines');
  const coverageTests = document.getElementById('coverage-tests');
  coverageRun.addEventListener('click', () => {
    vscode.postMessage({ type: 'runCoverage' });
  });
  window.addEventListener('message', (event) => {
    const msg = event.data;
    if (!msg) return;
    if (msg.type === 'mode') {
      document.getElementById('mode-value').textContent = msg.mode;
    } else if (msg.type === 'coverageRunning') {
      coverageRun.disabled = true;
      coverageFill.classList.add('indeterminate');
      coveragePct.textContent = 'scanning…';
      coverageLines.textContent = 'Scanning project…';
      coverageLines.classList.remove('error');
      coverageTests.textContent = '';
    } else if (msg.type === 'coverage') {
      coverageRun.disabled = false;
      coverageFill.classList.remove('indeterminate');
      coverageFill.style.width = msg.percent + '%';
      coveragePct.textContent = msg.percent + '%';
      coverageLines.textContent = msg.lines;
      coverageLines.classList.remove('error');
      coverageTests.textContent = msg.testsText;
      coverageTests.className = 'coverage-tests ' + (msg.testsState === 'pass' ? 'pass' : msg.testsState === 'fail' ? 'fail' : '');
    } else if (msg.type === 'coverageError') {
      coverageRun.disabled = false;
      coverageFill.classList.remove('indeterminate');
      coverageFill.style.width = '0%';
      coveragePct.textContent = '— %';
      coverageLines.textContent = 'Failed: ' + msg.message;
      coverageLines.classList.add('error');
      coverageTests.textContent = '';
    }
  });
  vscode.postMessage({ type: 'ready' });
</script>`;
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function getNonce(): string {
  let text = "";
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  for (let i = 0; i < 32; i++) text += chars.charAt(Math.floor(Math.random() * chars.length));
  return text;
}
