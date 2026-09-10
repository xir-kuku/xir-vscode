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
  "import(\"os/android/imports/liblog.inc\");",
  "import(\"os/android/defs/native_activity.inc\");",
  "import(\"os/android/catalog.inc\");",
  "",
].join("\n");
const document = TextDocument.create(pathToFileURL(documentPath).toString(), "xirasm", 1, source);
const includes = literalIncludes(document, context);
assert.strictEqual(includes.length, 7);
assert.strictEqual(includes[0].path, "format/pe.inc");
assert.strictEqual(includes[1].path, "format/coff.inc");
assert.strictEqual(includes[2].path, "format/elfexe.inc");
assert.strictEqual(includes[3].path, "format/elfso.inc");
assert.strictEqual(includes[4].path, "os/android/imports/liblog.inc");
assert.strictEqual(includes[5].path, "os/android/defs/native_activity.inc");
assert.strictEqual(includes[6].path, "os/android/catalog.inc");
for (const entry of includes) assert.ok(entry.resolvedPath, `${entry.path} resolves`);
assert.strictEqual(path.resolve(resolveIncludePath("format/pe.inc", documentPath, context)), path.join(bundledIncludeRoot, "format", "pe.inc"));
assert.strictEqual(path.resolve(resolveIncludePath("format/coff.inc", bundledIncludeRoot, { workspaceRoots: [bundledIncludeRoot] })), path.join(bundledIncludeRoot, "format", "coff.inc"));
const roots = includeSearchRoots(documentPath, context).map((root) => path.resolve(root));
assert.ok(roots.includes(bundledIncludeRoot));
const quotedImport = includeAtPosition(document, { line: 0, character: source.indexOf("pe.inc") }, context);
assert.strictEqual(quotedImport?.path, "format/pe.inc");
assert.strictEqual(path.resolve(resolveIncludePath("os/android/defs/native_activity.inc", documentPath, context)),
  path.join(bundledIncludeRoot, "os", "android", "defs", "native_activity.inc"));
assert.ok(fs.existsSync(path.join(bundledIncludeRoot, "os", "android", "catalog", "symbols.toml")));
assert.strictEqual(resolveIncludePath("os/win32/imports/kernel32.inc", documentPath, context), undefined);
assert.strictEqual(resolveIncludePath("arm/a64-macros.inc", documentPath, context), undefined);
assert.ok(!fs.existsSync(path.join(bundledIncludeRoot, "arm")));
assert.ok(!fs.existsSync(path.join(bundledIncludeRoot, "os", "win32")));
const macroDocument = TextDocument.create(pathToFileURL(documentPath).toString(), "xirasm", 1, [
  "macro copy.twice(dst, src) {",
  "    fmov dst, src",
  "    fmov dst, src",
  "}",
  "copy.twice d0, d1",
].join("\n"));
const macroAnalysis = analyzeDocument(macroDocument, context);
assert.deepStrictEqual(macroAnalysis.diagnostics, []);
assert.ok(macroAnalysis.symbols.some((symbol) => symbol.name === "copy.twice"));

const project = fs.mkdtempSync(path.join(os.tmpdir(), "xirasm-dsl-import-"));
const projectInclude = path.join(project, "include");
const library = path.join(projectInclude, "local-dsl.inc");
fs.mkdirSync(projectInclude);
try {
  fs.writeFileSync(library, "macro emit.word(value) {\n    emit.u32(operand.eval(value))\n}\n");
  const projectContext = { workspaceRoots: [project, bundledIncludeRoot] };
  const consumer = TextDocument.create(pathToFileURL(path.join(project, "main.asm")).toString(), "xirasm", 1,
    'import("local-dsl.inc")\nemit.word 42\n');
  assert.strictEqual(resolveIncludePath("local-dsl.inc", path.join(project, "main.asm"), projectContext), library);
  assert.deepStrictEqual(analyzeDocument(consumer, projectContext).diagnostics, []);
  const imported = TextDocument.create(pathToFileURL(library).toString(), "xirasm", 1, fs.readFileSync(library, "utf8"));
  assert.ok(analyzeDocument(imported, projectContext).symbols.some((symbol) => symbol.name === "emit.word"));
} finally {
  fs.unlinkSync(library);
  fs.rmdirSync(projectInclude);
  fs.rmdirSync(project);
}
