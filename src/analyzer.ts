import * as fs from "fs";
import * as path from "path";
import {
  Diagnostic,
  DiagnosticSeverity,
  DocumentSymbol,
  Position,
  Range,
  SymbolKind,
} from "vscode-languageserver/node";
import { TextDocument } from "vscode-languageserver-textdocument";

export type AnalysisContext = {
  workspaceRoots: string[];
};

export type IncludeReference = {
  path: string;
  resolvedPath?: string;
  range: Range;
};

const symbolRules: Array<{ kind: SymbolKind; regex: RegExp }> = [
  { kind: SymbolKind.Function, regex: /^\s*fn\s+([A-Za-z_.$@][A-Za-z0-9_.$@?]*)/ },
  { kind: SymbolKind.Function, regex: /^\s*macro\s+([A-Za-z_.$@][A-Za-z0-9_.$@?]*)/ },
  { kind: SymbolKind.Struct, regex: /^\s*(?:packed\s+)?struct\s+([A-Za-z_.$@][A-Za-z0-9_.$@?]*)/ },
  { kind: SymbolKind.Struct, regex: /^\s*(?:packed\s+)?union\s+([A-Za-z_.$@][A-Za-z0-9_.$@?]*)/ },
  { kind: SymbolKind.Variable, regex: /^\s*(?:const|let)\s+([A-Za-z_.$@][A-Za-z0-9_.$@?]*)/ },
  { kind: SymbolKind.String, regex: /^\s*([A-Za-z_.$@][A-Za-z0-9_.$@?]*):/ },
];

/// Collect document symbols and report unresolved `import` targets.
///
/// The diagnostics here cover native XIRASM source only: whether an imported
/// file exists. Everything a Meta/DSL construct means is the assembler's to
/// judge, and it reports those errors with exact locations, so this pass does
/// not attempt to model block structure, scopes, or symbol collisions. Guessing
/// at them produced warnings on correct sources: a register list or an aggregate
/// literal carries the same braces a block does, and a name may legitimately
/// repeat in a sibling branch or as a struct field.
export function analyzeDocument(document: TextDocument, context: AnalysisContext): { diagnostics: Diagnostic[]; symbols: DocumentSymbol[] } {
  const text = document.getText();
  const lines = text.split(/\r?\n/);
  const diagnostics: Diagnostic[] = [];
  const symbols: DocumentSymbol[] = [];
  const documentPath = uriToPath(document.uri);

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const rawLine = lines[lineIndex];
    const trimmed = stripAssemblerComment(rawLine).trim();
    if (trimmed.length === 0) continue;

    collectSymbol(rawLine, lineIndex, symbols);
    checkInclude(trimmed, lineIndex, documentPath, context, diagnostics);
  }

  return { diagnostics, symbols };
}

export function wordAt(text: string, position: Position): string {
  const lines = text.split(/\r?\n/);
  const line = lines[position.line] ?? "";
  const index = Math.min(position.character, line.length);
  const chars = /[A-Za-z0-9_.$@!?]/;
  let start = index;
  while (start > 0 && chars.test(line[start - 1] ?? "")) start -= 1;
  let end = index;
  while (end < line.length && chars.test(line[end] ?? "")) end += 1;
  return line.slice(start, end);
}

export function literalIncludes(document: TextDocument, context: AnalysisContext): IncludeReference[] {
  const text = document.getText();
  const lines = text.split(/\r?\n/);
  const documentPath = uriToPath(document.uri);
  const result: IncludeReference[] = [];

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex];
    const include = parseInclude(line);
    if (!include) continue;
    result.push({
      path: include.path,
      resolvedPath: resolveIncludePath(include.path, documentPath, context),
      range: Range.create(lineIndex, include.start, lineIndex, include.end),
    });
  }

  return result;
}

export function includeAtPosition(document: TextDocument, position: Position, context: AnalysisContext): IncludeReference | undefined {
  return literalIncludes(document, context).find((entry) =>
    entry.range.start.line === position.line &&
    entry.range.start.character <= position.character &&
    position.character <= entry.range.end.character,
  );
}

/// Record a declaration so the outline and symbol search can find it.
///
/// This reads one line at a time and never reports anything: a spelling that
/// looks like a declaration is not evidence of an error, and the assembler
/// diagnoses real ones.
function collectSymbol(line: string, lineIndex: number, symbols: DocumentSymbol[]): void {
  for (const ruleDef of symbolRules) {
    const match = ruleDef.regex.exec(line);
    if (!match?.[1]) continue;
    const name = match[1];
    const start = line.indexOf(name);
    const range = Range.create(lineIndex, Math.max(0, start), lineIndex, Math.max(0, start) + name.length);
    symbols.push({
      name,
      kind: ruleDef.kind,
      range: lineRange(lineIndex, line.length),
      selectionRange: range,
    });
    return;
  }
}

function checkInclude(
  trimmed: string,
  lineIndex: number,
  documentPath: string | undefined,
  context: AnalysisContext,
  diagnostics: Diagnostic[],
): void {
  const include = parseInclude(trimmed);
  if (!include) return;
  const includePath = include.path;
  if (includePath.includes("$") || includePath.includes("#")) return;

  if (resolveIncludePath(includePath, documentPath, context)) return;
  diagnostics.push({
    severity: DiagnosticSeverity.Hint,
    range: lineRange(lineIndex, trimmed.length),
    message: `Import target '${includePath}' was not found relative to this file, project include/, or bundled include resources.`,
    source: "xirasm-lsp",
  });
}

export function resolveIncludePath(includePath: string, documentPath: string | undefined, context: AnalysisContext): string | undefined {
  if (includePath.includes("$") || includePath.includes("#")) return undefined;

  const candidates: string[] = [];
  for (const root of includeSearchRoots(documentPath, context)) {
    candidates.push(path.resolve(root, includePath));
  }

  return uniqueExistingPath(candidates);
}

export function includeSearchRoots(documentPath: string | undefined, context: AnalysisContext): string[] {
  const roots: string[] = [];
  if (documentPath) {
    roots.push(path.dirname(documentPath));
    for (const root of ancestorDirectories(path.dirname(documentPath))) {
      roots.push(root);
      roots.push(path.resolve(root, "include"));
    }
  }
  for (const root of context.workspaceRoots) {
    roots.push(root);
    roots.push(path.resolve(root, "include"));
  }
  return uniquePaths(roots);
}

function parseInclude(line: string): { path: string; start: number; end: number } | undefined {
  const source = stripAssemblerComment(line);
  const match = /^\s*(?:import|include)\s*\(\s*"([^"]+)"\s*\)/i.exec(source);
  const includePath = match?.[1];
  if (!includePath) return undefined;
  const start = source.indexOf(includePath);
  return {
    path: includePath,
    start: Math.max(0, start),
    end: Math.max(0, start) + includePath.length,
  };
}

function ancestorDirectories(start: string): string[] {
  const result: string[] = [];
  let cursor = path.resolve(start);
  while (true) {
    result.push(cursor);
    const parent = path.dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
  return result;
}

function uniqueExistingPath(candidates: string[]): string | undefined {
  const seen = new Set<string>();
  for (const candidate of candidates) {
    const normalized = path.resolve(candidate);
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    if (fs.existsSync(normalized)) return normalized;
  }
  return undefined;
}

function uniquePaths(paths: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const candidate of paths) {
    const normalized = path.resolve(candidate);
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

function stripAssemblerComment(line: string): string {
  let quote = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (quote) {
      if (ch === "\"" && line[i + 1] === "\"") {
        i += 1;
      } else if (ch === "\"") {
        quote = false;
      }
      continue;
    }
    if (ch === "\"") {
      quote = true;
      continue;
    }
    if (ch === ";") return line.slice(0, i);
    if (ch === "/" && line[i + 1] === "/") return line.slice(0, i);
  }
  return line;
}

function uriToPath(uri: string): string | undefined {
  if (!uri.startsWith("file://")) return undefined;
  try {
    const url = new URL(uri);
    return decodeURIComponent(url.pathname).replace(/^\/([A-Za-z]:)/, "$1");
  } catch {
    return undefined;
  }
}

function lineRange(line: number, lineLength: number): Range {
  return Range.create(line, 0, line, Math.max(1, lineLength));
}
