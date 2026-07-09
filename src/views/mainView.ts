import * as vscode from "vscode";
import { ExecutionMode } from "../models";
import { currentExecutionMode } from "../chatmode/integrator";
import { ModeManager } from "../core/modeManager";
import { modePreferenceDisplayName } from "../chatmode/constants";
import { log } from "../core/context";

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
 * Port of DevAIMainPanel + DevAIToolWindowFactory: presents every DevAI action
 * as a clickable button grouped by category, shows the current execution mode,
 * and offers a mode toggle. Clicks post a message that runs the matching
 * `devai.*` command.
 */
export class MainViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "devai.mainView";

  private view: vscode.WebviewView | undefined;

  constructor(private readonly extensionUri: vscode.Uri) {}

  private static readonly SECTIONS: SectionSpec[] = [
    {
      title: "Code Review",
      icon: "🔍",
      actions: [
        { command: "devai.reviewCode", label: "Review Code", description: "Review the current file or selection" },
        { command: "devai.reviewChanges", label: "Review Changed Files", description: "Review uncommitted / branch changes" },
        { command: "devai.detectApiDrift", label: "Detect API Drift", description: "Compare an OpenAPI spec against code changes" },
      ],
    },
    {
      title: "Test Generation",
      icon: "🧪",
      actions: [
        { command: "devai.generateTests", label: "Generate Unit Tests", description: "Create tests for the selected code" },
        { command: "devai.generateTestsForFolder", label: "Generate Tests for Folder", description: "Create tests for a folder" },
        { command: "devai.generateTestScenariosAndCases", label: "Generate Scenarios & Cases", description: "Scenarios, test cases and sample data" },
        { command: "devai.generateShakedownTests", label: "Generate Shakedown Tests", description: "Postman shakedown collection from an OpenAPI spec" },
      ],
    },
    {
      title: "Documentation",
      icon: "📝",
      actions: [
        { command: "devai.generateDocumentation", label: "Create Inline Documentation", description: "Generate inline doc comments" },
        { command: "devai.generateReadme", label: "Generate README", description: "Generate a project README.md" },
        { command: "devai.generateFileDocumentation", label: "Generate File Documentation", description: "Technical .md docs for a source file" },
        { command: "devai.generateFolderDocumentation", label: "Generate Folder Documentation", description: "Summary .md docs for a folder" },
        { command: "devai.updateDocsOnChanges", label: "Update Documentation", description: "Update docs based on code changes" },
        { command: "devai.getBusinessLogicSummary", label: "Business Logic Summary", description: "Business logic + requirements summary" },
        { command: "devai.generateUserStories", label: "Generate User Stories", description: "Jira-ready user stories from requirements" },
      ],
    },
    {
      title: "Diagrams",
      icon: "📊",
      actions: [
        { command: "devai.generateUMLDiagram", label: "Generate Class Diagram", description: "Class diagram from source" },
        { command: "devai.generateSequenceDiagram", label: "Generate Sequence Diagram", description: "Sequence diagram from source" },
        { command: "devai.generateFlowDiagram", label: "Generate Flow Diagram", description: "Flow diagram from source" },
        { command: "devai.renderMermaidDiagram", label: "Render Diagram", description: "Render a .mmd file" },
        { command: "devai.updateDiagram", label: "Update Diagram", description: "Update a diagram from current source" },
      ],
    },
    {
      title: "Feature Code",
      icon: "🧩",
      actions: [
        { command: "devai.generateFeatureCode", label: "Generate Feature Code", description: "Generate feature code from requirements" },
        { command: "devai.updateFeatureCode", label: "Update Feature Code", description: "Update existing code from requirements" },
        { command: "devai.generateFeatureScaffold", label: "Generate Feature Scaffold", description: "Scaffold a feature from a requirements doc" },
      ],
    },
    {
      title: "Dependency & Platform Upgrades",
      icon: "⬆️",
      actions: [
        { command: "devai.analyzeDependency", label: "Analyze Dependency Migration", description: "Analyze dependencies for updates & risks" },
        { command: "devai.executeDependencyMigration", label: "Execute Dependency Migration", description: "Apply migration changes from a report" },
        { command: "devai.upgradePlatform", label: "Automate Platform Upgrades", description: "Scan and recommend platform/framework upgrades" },
      ],
    },
    {
      title: "Security (SAST)",
      icon: "🛡️",
      actions: [
        { command: "devai.fixSastFindings", label: "Fix SAST Findings", description: "Fetch SAST findings and generate fixes" },
        { command: "devai.fetchJiraTicket", label: "Fetch Jira Ticket", description: "Load a Jira ticket for context" },
      ],
    },
    {
      title: "AI Assistant",
      icon: "💬",
      actions: [
        { command: "devai.openCopilotChat", label: "Open Copilot Chat", description: "Open the GitHub Copilot Chat panel" },
        { command: "devai.toggleChatMode", label: "Toggle Chat Mode", description: "Switch between SDK and Chat execution" },
        { command: "devai.openSettings", label: "Open Settings", description: "Open BMO GenAI Developer settings" },
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
        } else if (message.type === "ready") {
          this.postMode();
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
  .toggle-btn {
    border: 1px solid var(--vscode-button-border, transparent);
    background: var(--vscode-button-secondaryBackground, var(--vscode-button-background));
    color: var(--vscode-button-secondaryForeground, var(--vscode-button-foreground));
    border-radius: 4px; padding: 3px 10px; cursor: pointer; font-size: 0.85em;
  }
  .toggle-btn:hover { background: var(--vscode-button-secondaryHoverBackground, var(--vscode-button-hoverBackground)); }
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
</style>
<header>
  <div class="title">🤖 BMO GenAI Developer</div>
  <div class="mode-row">
    <span class="mode-badge"><span class="mode-dot"></span>Mode: <strong id="mode-value">…</strong></span>
    <button class="toggle-btn" id="toggle-mode">Toggle Mode</button>
  </div>
</header>
<main>${sectionsHtml}</main>
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
  window.addEventListener('message', (event) => {
    const msg = event.data;
    if (msg && msg.type === 'mode') {
      document.getElementById('mode-value').textContent = msg.mode;
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
