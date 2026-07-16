import assert from "assert";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const { TextDocument } = require("vscode-languageserver-textdocument");
const { analyzeDocument, includeAtPosition, includeSearchRoots, literalIncludes, resolveIncludePath } = require("../out/analyzer.js");

const extensionRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bundledIncludeRoot = path.join(extensionRoot, "resources", "include");
const documentPath = path.join(os.tmpdir(), "xirasm-vscode", "include-probe.asm");
const context = { workspaceRoots: [bundledIncludeRoot] };
const source = [
  "import(\"format/pe.inc\");",
  "include(\"format/coff.inc\");",
  "import(\"format/elfexe.inc\");",
  "import(\"format/elfso.inc\");",
  "import(\"os/win32/imports/kernel32.inc\");",
  "import(\"os/win32/defs/foundation.inc\");",
  "import(\"os/win32/comdefs/system_com.inc\");",
  "",
].join("\n");
const document = TextDocument.create(pathToFileURL(documentPath).toString(), "xirasm", 1, source);
const includes = literalIncludes(document, context);
assert.strictEqual(includes.length, 7);
assert.strictEqual(includes[0].path, "format/pe.inc");
assert.strictEqual(includes[1].path, "format/coff.inc");
assert.strictEqual(includes[2].path, "format/elfexe.inc");
assert.strictEqual(includes[3].path, "format/elfso.inc");
assert.strictEqual(includes[4].path, "os/win32/imports/kernel32.inc");
assert.strictEqual(includes[5].path, "os/win32/defs/foundation.inc");
assert.strictEqual(includes[6].path, "os/win32/comdefs/system_com.inc");
for (const entry of includes) assert.ok(entry.resolvedPath, `${entry.path} resolves`);
assert.strictEqual(path.resolve(resolveIncludePath("format/pe.inc", documentPath, context)), path.join(bundledIncludeRoot, "format", "pe.inc"));
assert.strictEqual(path.resolve(resolveIncludePath("format/coff.inc", bundledIncludeRoot, { workspaceRoots: [bundledIncludeRoot] })), path.join(bundledIncludeRoot, "format", "coff.inc"));
const roots = includeSearchRoots(documentPath, context).map((root) => path.resolve(root));
assert.ok(roots.includes(bundledIncludeRoot));
const quotedImport = includeAtPosition(document, { line: 0, character: source.indexOf("pe.inc") }, context);
assert.strictEqual(quotedImport?.path, "format/pe.inc");

const kernel32Path = resolveIncludePath("os/win32/imports/kernel32.inc", documentPath, context);
assert.ok(kernel32Path, "bundled KERNEL32 catalog resolves");
const kernel32Document = TextDocument.create(
  pathToFileURL(kernel32Path).toString(),
  "xirasm",
  1,
  fs.readFileSync(kernel32Path, "utf8"),
);
const kernel32Symbols = new Set(analyzeDocument(kernel32Document, context).symbols.map((symbol) => symbol.name));
assert.ok(kernel32Symbols.has("win32_import_kernel32_add_mut"));
assert.ok(kernel32Symbols.has("win32_import_kernel32_GetCurrentProcessId"));

const foundationPath = resolveIncludePath("os/win32/defs/foundation.inc", documentPath, context);
assert.ok(foundationPath, "bundled Foundation definitions resolve");
const foundationDocument = TextDocument.create(
  pathToFileURL(foundationPath).toString(),
  "xirasm",
  1,
  fs.readFileSync(foundationPath, "utf8"),
);
const foundationSymbols = new Set(analyzeDocument(foundationDocument, context).symbols.map((symbol) => symbol.name));
assert.ok(foundationSymbols.has("win32_Foundation_POINT64"));
assert.ok(foundationSymbols.has("win32_Foundation_MAX_PATH"));
