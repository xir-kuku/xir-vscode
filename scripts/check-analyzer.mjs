// Guard the analyzer against the false positives that used to litter valid
// sources: `Unclosed block`, `Unexpected }` and `Symbol ... also appears
// earlier` fired on register lists, aggregate literals and sibling branches.
//
// The analyzer now reports only unresolved `import` targets; everything a
// Meta/DSL construct means belongs to the assembler, which reports real errors
// with exact locations.
//
//   node scripts/check-analyzer.mjs [--extension <dir>] [--xirasm <dir>]

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import Module from "node:module";

const here = dirname(fileURLToPath(import.meta.url));
const extension = resolve(here, "..");
const require = createRequire(import.meta.url);

function argument(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? resolve(process.argv[index + 1]) : fallback;
}

const xirasm = argument("--xirasm", resolve(extension, "..", "xirasm"));

// The analyzer imports two vscode packages; stub them so it loads in plain node.
const stub = {
  DiagnosticSeverity: { Error: 1, Warning: 2, Information: 3, Hint: 4 },
  SymbolKind: {
    File: 1, Module: 2, Namespace: 3, Package: 4, Class: 5, Method: 6,
    Property: 7, Field: 8, Constructor: 9, Enum: 10, Interface: 11,
    Function: 12, Variable: 13, Constant: 14, String: 15, Number: 16,
    Boolean: 17, Array: 18, Object: 19, Key: 20, Null: 21,
    EnumMember: 22, Struct: 23, Event: 24, Operator: 25, TypeParameter: 26,
  },
  Position: { create: (line, character) => ({ line, character }) },
  Range: {
    create: (sl, sc, el, ec) => ({
      start: { line: sl, character: sc },
      end: { line: el, character: ec },
    }),
  },
};

const loader = Module._load;
Module._load = function (request) {
  if (request === "vscode-languageserver" || request === "vscode-languageserver/node") return stub;
  return loader.apply(this, arguments);
};

const bundle = join(extension, "out", "analyzer.js");
if (!existsSync(bundle)) {
  console.error(`missing ${bundle}; run \`npm run compile\` first`);
  process.exit(2);
}
const analyzer = require(bundle);

function collectSources(root, found = []) {
  let entries;
  try {
    entries = readdirSync(root);
  } catch {
    return found;
  }
  for (const name of entries) {
    const full = join(root, name);
    const info = statSync(full);
    if (info.isDirectory()) {
      collectSources(full, found);
    } else if (name.endsWith(".asm") || name.endsWith(".xir")) {
      found.push(full);
    }
  }
  return found;
}

// Every checked-in source must analyze clean, and each case below is one the old
// heuristics got wrong.
const cases = [
  {
    why: "a vector register list carries braces that are not a block",
    source: ["tests", "tutorial", "language", "a64-macro-dsl.xir"],
  },
  {
    why: "an aggregate literal carries the same braces a block does",
    source: ["tests", "tutorial", "language", "en-struct-2.xir"],
  },
  {
    why: "a struct literal spreads over several lines",
    source: ["tests", "tutorial", "language", "en-packed-5.xir"],
  },
  {
    why: "a name is declared again in a sibling branch",
    source: ["tests", "tutorial", "language", "alternative-shapes.xir"],
  },
  {
    why: "a file opens with a comment",
    source: ["tests", "format", "android_gl_demo", "gl-demo-so.asm"],
  },
];

let failed = 0;

for (const testCase of cases) {
  const path = join(xirasm, ...testCase.source);
  if (!existsSync(path)) {
    console.log(`SKIP ${testCase.source.join("/")}: not present`);
    continue;
  }
  const text = readFileSync(path, "utf8");
  const uri = "file:///" + path.replace(/\\/g, "/");
  const document = { uri, getText: () => text };
  const { diagnostics, symbols } = analyzer.analyzeDocument(document, {
    workspaceRoots: [xirasm],
  });
  if (diagnostics.length > 0) {
    failed += 1;
    console.log(`FAIL ${testCase.source.join("/")}: ${testCase.why}`);
    for (const d of diagnostics) {
      console.log(`       L${d.range.start.line + 1}: ${d.message}`);
    }
  } else {
    console.log(`PASS ${testCase.source.join("/")} (${symbols.length} symbols, 0 diagnostics)`);
  }
}

// A missing import must still be reported, otherwise the pass reports nothing
// ever and these cases would pass for the wrong reason.
const missing = join(xirasm, "tests", "format", "android_gl_demo", "gl-demo-so.asm");
if (existsSync(missing)) {
  const text = readFileSync(missing, "utf8") + '\nimport("format/definitely-absent.inc")\n';
  const uri = "file:///" + missing.replace(/\\/g, "/");
  const { diagnostics } = analyzer.analyzeDocument({ uri, getText: () => text }, {
    workspaceRoots: [xirasm],
  });
  const reported = diagnostics.some((d) => d.message.includes("definitely-absent.inc"));
  if (reported) {
    console.log("PASS a missing import is still reported");
  } else {
    failed += 1;
    console.log("FAIL a missing import produced no diagnostic");
  }
}

const sources = collectSources(join(xirasm, "tests"));
let noisy = 0;
for (const path of sources) {
  const text = readFileSync(path, "utf8");
  const uri = "file:///" + path.replace(/\\/g, "/");
  const { diagnostics } = analyzer.analyzeDocument({ uri, getText: () => text }, {
    workspaceRoots: [xirasm],
  });
  if (diagnostics.length === 0) continue;
  // A source that imports something absent is a real finding, not noise.
  const allMissingImports = diagnostics.every((d) => d.message.startsWith("Import target '"));
  if (allMissingImports) continue;
  noisy += 1;
  failed += 1;
  console.log(`\nFAIL ${path}`);
  for (const d of diagnostics) console.log(`       L${d.range.start.line + 1}: ${d.message}`);
}
console.log(`\nscanned ${sources.length} checked-in source(s): ${noisy} reported an unexpected diagnostic`);

if (failed > 0) {
  console.error(`\nanalyzer check failed: ${failed} problem(s)`);
  process.exit(1);
}
console.log("analyzer check passed");
