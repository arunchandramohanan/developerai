import * as fs from "fs";
import { resourcePath, logError } from "./context";
import { InputFilterService } from "./inputFilterService";

/**
 * Port of com.bmo.devai.intellij.util.PromptTemplateService.
 * Loads prompt templates from resources/prompts and renders them with
 * {{var}} substitution and {{#var}}...{{/var}} conditional blocks. User
 * values are passed through the InputFilterService before substitution.
 */
export class PromptTemplateService {
  private static cache = new Map<string, string>();

  static loadTemplate(templateName: string): string {
    const cached = PromptTemplateService.cache.get(templateName);
    if (cached !== undefined) return cached;
    try {
      const content = fs.readFileSync(resourcePath("prompts", templateName), "utf8");
      PromptTemplateService.cache.set(templateName, content);
      return content;
    } catch (e) {
      logError(`Template not found: ${templateName}`, e);
      PromptTemplateService.cache.set(templateName, "");
      return "";
    }
  }

  static render(template: string, variables: Record<string, string | null | undefined>): string {
    let result = template;
    const filter = InputFilterService.getInstance();

    // Conditional blocks: {{#key}}content{{/key}}
    for (const key of Object.keys(variables)) {
      const rawValue = variables[key];
      const value = rawValue != null ? filter.filterInputValue(rawValue, key) : rawValue;
      const openTag = `{{#${key}}}`;
      const closeTag = `{{/${key}}}`;
      while (result.includes(openTag)) {
        const start = result.indexOf(openTag);
        const end = result.indexOf(closeTag);
        if (end < 0) break;
        if (value != null && value.trim().length > 0) {
          const blockContent = result.substring(start + openTag.length, end);
          result = result.substring(0, start) + blockContent + result.substring(end + closeTag.length);
        } else {
          result = result.substring(0, start) + result.substring(end + closeTag.length);
        }
      }
    }

    // Simple {{key}} placeholders
    for (const key of Object.keys(variables)) {
      const rawValue = variables[key];
      const value = rawValue != null ? filter.filterInputValue(rawValue, key) : "";
      result = result.split(`{{${key}}}`).join(value ?? "");
    }

    return result;
  }

  static loadAndRender(templateName: string, variables: Record<string, string | null | undefined>): string {
    return PromptTemplateService.render(PromptTemplateService.loadTemplate(templateName), variables);
  }

  static buildFullPrompt(
    systemTemplate: string,
    userTemplate: string,
    variables: Record<string, string | null | undefined>
  ): string {
    const system = PromptTemplateService.loadTemplate(systemTemplate);
    const user = PromptTemplateService.render(PromptTemplateService.loadTemplate(userTemplate), variables);
    return system + "\n\n" + user;
  }

  static clearCache(): void {
    PromptTemplateService.cache.clear();
  }
}
