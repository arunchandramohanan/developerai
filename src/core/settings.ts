import * as vscode from "vscode";
import { ModePreference } from "../models";

/**
 * Typed accessor over the `devai.*` configuration namespace, mirroring
 * com.bmo.devai.intellij.settings.DevAISettings.
 */
export class DevAISettings {
  private static _instance: DevAISettings | undefined;

  static getInstance(): DevAISettings {
    if (!DevAISettings._instance) DevAISettings._instance = new DevAISettings();
    return DevAISettings._instance;
  }

  private cfg(): vscode.WorkspaceConfiguration {
    return vscode.workspace.getConfiguration("devai");
  }

  private getString(key: string, def = ""): string {
    const v = this.cfg().get<string>(key);
    return (v ?? def).toString();
  }
  private getBool(key: string, def: boolean): boolean {
    const v = this.cfg().get<boolean>(key);
    return v === undefined ? def : v;
  }
  private getNumber(key: string, def: number): number {
    const v = this.cfg().get<number>(key);
    return v === undefined ? def : v;
  }

  async update(key: string, value: unknown): Promise<void> {
    await this.cfg().update(key, value, vscode.ConfigurationTarget.Global);
  }

  // Mode
  getModePreference(): ModePreference {
    const v = this.getString("modePreference", ModePreference.CHAT_ONLY);
    return (Object.values(ModePreference) as string[]).includes(v)
      ? (v as ModePreference)
      : ModePreference.CHAT_ONLY;
  }
  async setModePreference(p: ModePreference): Promise<void> { await this.update("modePreference", p); }

  // CLI
  getGhCliPath(): string { return this.getString("ghCliPath"); }
  /** Path to the standalone GitHub Copilot CLI (`copilot`). Blank = auto-detect. */
  getCopilotCliPath(): string { return this.getString("copilotCliPath"); }
  getTimeoutSeconds(): number { return Math.max(10, Math.min(300, this.getNumber("timeoutSeconds", 60))); }

  // Model
  getCopilotModel(): string { return this.getString("copilotModel", "GPT-4o"); }

  // Chat mode
  isChatModeEnabled(): boolean { return this.getBool("chatModeEnabled", true); }
  async setChatModeEnabled(v: boolean): Promise<void> { await this.update("chatModeEnabled", v); }
  getChatModeModel(): string { return this.getString("chatModeModel", "GPT-4o"); }
  isChatModeAgentEnabled(): boolean { return this.getBool("chatModeAgentEnabled", true); }

  // Team
  getTeam(): string { return this.getString("team"); }
  isTeamConfigured(): boolean { return this.getTeam().trim().length > 0; }

  // UI
  isShowModeNotifications(): boolean { return this.getBool("showModeNotifications", true); }
  isShowProgressIndicator(): boolean { return this.getBool("showProgressIndicator", true); }
  isAutoExpandCodeBlocks(): boolean { return this.getBool("autoExpandCodeBlocks", true); }
  getMaxContextMessages(): number { return Math.max(1, Math.min(50, this.getNumber("maxContextMessages", 10))); }
  isSaveSessionHistory(): boolean { return this.getBool("saveSessionHistory", true); }

  // Test generation
  getDefaultTestFramework(): string { return this.getString("defaultTestFramework", "JUNIT5"); }
  isGenerateMockitoImports(): boolean { return this.getBool("generateMockitoImports", true); }

  // Documentation
  getDefaultDocFormat(): string { return this.getString("defaultDocFormat", "JAVADOC"); }
  isIncludeParamDocs(): boolean { return this.getBool("includeParamDocs", true); }
  isIncludeReturnDocs(): boolean { return this.getBool("includeReturnDocs", true); }
  isIncludeThrowsDocs(): boolean { return this.getBool("includeThrowsDocs", true); }

  // Code review
  isEnableAutoReview(): boolean { return this.getBool("enableAutoReview", false); }
  getMinSeverityToShow(): string { return this.getString("minSeverityToShow", "LOW"); }

  // Analytics
  getAnalyticsApiUrl(): string { return this.getString("analyticsApiUrl"); }
  getAnalyticsApiKey(): string { return this.getString("analyticsApiKey"); }

  // RAG
  isRagEnabled(): boolean { return this.getBool("rag.enabled", true); }
  getRagServerUrl(): string { return this.getString("rag.serverUrl"); }
  getRagApiKey(): string { return this.getString("rag.apiKey"); }
  getRagTopK(): number { return Math.max(1, Math.min(10, this.getNumber("rag.topK", 3))); }
  getRagTimeoutMs(): number { return Math.max(1000, Math.min(30000, this.getNumber("rag.timeoutMs", 10000))); }

  // SAST
  getSastSource(): string { const s = this.getString("sast.source", "SONARQUBE").trim().toUpperCase(); return s || "SONARQUBE"; }
  getSonarQubeUrl(): string { return this.getString("sonarQube.url"); }
  getSonarQubeUsername(): string { return this.getString("sonarQube.username"); }
  getSonarQubePassword(): string { return this.getString("sonarQube.password"); }
  getSonarQubeProjectKey(): string { return this.getString("sonarQube.projectKey"); }

  getGithubBaseUrl(): string { const v = this.getString("github.baseUrl"); return v || "https://api.github.com"; }
  getGithubToken(): string { return this.getString("github.token"); }
  getGithubOwner(): string { return this.getString("github.owner"); }
  getGithubRepo(): string { return this.getString("github.repo"); }
  getGithubRef(): string { return this.getString("github.ref"); }
  getGithubPathStripPrefix(): string { return this.getString("github.pathStripPrefix"); }
  getGithubPathAddPrefix(): string { return this.getString("github.pathAddPrefix"); }

  // Sonatype
  getSonatypeServerUrl(): string { return this.getString("sonatype.serverUrl"); }
  getSonatypeUsername(): string { return this.getString("sonatype.username"); }
  getSonatypePassword(): string { return this.getString("sonatype.password"); }

  // Jira
  getJiraBaseUrl(): string { return this.getString("jira.baseUrl"); }
  getJiraEmail(): string { return this.getString("jira.email"); }
  getJiraApiToken(): string { return this.getString("jira.apiToken"); }
  getJiraProjectKey(): string { return this.getString("jira.projectKey"); }

  // SSO
  getSsoAuthorizeUrl(): string { return this.getString("sso.authorizeUrl"); }
  getSsoTokenUrl(): string { return this.getString("sso.tokenUrl"); }
  getSsoClientId(): string { return this.getString("sso.clientId"); }
  getSsoScopes(): string { const v = this.getString("sso.scopes"); return v || "openid profile email offline_access"; }
}

export function settings(): DevAISettings {
  return DevAISettings.getInstance();
}
