import { json, jsonParseLinter } from "@codemirror/lang-json";
import { python } from "@codemirror/lang-python";
import { javascript } from "@codemirror/lang-javascript";
import { html } from "@codemirror/lang-html";
import { css } from "@codemirror/lang-css";
import { yaml } from "@codemirror/lang-yaml";
import { StreamLanguage, type LanguageSupport } from "@codemirror/language";
import { linter, type LintSource } from "@codemirror/lint";
import { properties } from "@codemirror/legacy-modes/mode/properties";
import { shell } from "@codemirror/legacy-modes/mode/shell";
import { toml } from "@codemirror/legacy-modes/mode/toml";
import type { Extension } from "@codemirror/state";

export interface CodeLanguageConfig {
  id: string;
  label: string;
  extensions: Extension[];
}

export function codeLanguageForPath(filePath: string): CodeLanguageConfig {
  const basename = filePath.split(/[\\/]/).pop()?.toLowerCase() ?? "";
  const extension = basename.includes(".") ? basename.slice(basename.lastIndexOf(".") + 1) : "";

  if (basename === ".env" || basename.startsWith(".env.")) {
    return streamLanguage("dotenv", "dotenv", properties);
  }

  switch (extension) {
    case "py":
    case "pyi":
      return languageSupport("python", "Python", python());
    case "json":
    case "jsonc":
      return languageSupport("json", extension === "jsonc" ? "JSONC" : "JSON", json(), [linter(jsonParseLinter() as LintSource)]);
    case "js":
    case "jsx":
    case "mjs":
    case "cjs":
      return languageSupport("javascript", extension.toUpperCase(), javascript({ jsx: extension === "jsx" }));
    case "ts":
    case "tsx":
    case "mts":
    case "cts":
      return languageSupport("typescript", extension.toUpperCase(), javascript({ typescript: true, jsx: extension === "tsx" }));
    case "toml":
      return streamLanguage("toml", "TOML", toml);
    case "yaml":
    case "yml":
      return languageSupport("yaml", "YAML", yaml());
    case "html":
    case "htm":
      return languageSupport("html", "HTML", html());
    case "css":
      return languageSupport("css", "CSS", css());
    case "scss":
    case "sass":
    case "less":
      return languageSupport("css", extension.toUpperCase(), css());
    case "sh":
    case "bash":
    case "zsh":
      return streamLanguage("shell", extension.toUpperCase(), shell);
    default:
      return { id: "plain", label: extension ? extension.toUpperCase() : "Plain text", extensions: [] };
  }
}

function languageSupport(id: string, label: string, support: LanguageSupport, extraExtensions: Extension[] = []): CodeLanguageConfig {
  return {
    id,
    label,
    extensions: [support, ...extraExtensions],
  };
}

function streamLanguage(id: string, label: string, parser: Parameters<typeof StreamLanguage.define>[0]): CodeLanguageConfig {
  return {
    id,
    label,
    extensions: [StreamLanguage.define(parser)],
  };
}
