import assert from "assert";
import os from "os";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const { TextDocument } = require("vscode-languageserver-textdocument");
const { includeAtPosition, includeSearchRoots, literalIncludes, resolveIncludePath } = require("../out/analyzer.js");

const extensionRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bundledIncludeRoot = path.join(extensionRoot, "resources", "include");
const documentPath = path.join(os.tmpdir(), "xirasm-vscode", "include-probe.asm");
const context = { workspaceRoots: [bundledIncludeRoot] };
const source = [
  "import(\"format/pe.inc\");",
  "include(\"format/coff.inc\");",
  "import(\"format/elfexe.inc\");",
  "import(\"format/elfso.inc\");",
  "",
].join("\n");
const document = TextDocument.create(pathToFileURL(documentPath).toString(), "xirasm", 1, source);
const includes = literalIncludes(document, context);
assert.strictEqual(includes.length, 4);
assert.strictEqual(includes[0].path, "format/pe.inc");
assert.strictEqual(includes[1].path, "format/coff.inc");
assert.strictEqual(includes[2].path, "format/elfexe.inc");
assert.strictEqual(includes[3].path, "format/elfso.inc");
for (const entry of includes) assert.ok(entry.resolvedPath, `${entry.path} resolves`);
assert.strictEqual(path.resolve(resolveIncludePath("format/pe.inc", documentPath, context)), path.join(bundledIncludeRoot, "format", "pe.inc"));
assert.strictEqual(path.resolve(resolveIncludePath("format/coff.inc", bundledIncludeRoot, { workspaceRoots: [bundledIncludeRoot] })), path.join(bundledIncludeRoot, "format", "coff.inc"));
const roots = includeSearchRoots(documentPath, context).map((root) => path.resolve(root));
assert.ok(roots.includes(bundledIncludeRoot));
const quotedImport = includeAtPosition(document, { line: 0, character: source.indexOf("pe.inc") }, context);
assert.strictEqual(quotedImport?.path, "format/pe.inc");
assert.strictEqual(resolveIncludePath("os/win32/imports/kernel32.inc", documentPath, context), undefined);
