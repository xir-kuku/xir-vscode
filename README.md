# XIRASM VS Code Extension

[中文使用指南](USAGE.zh-CN.md)

This repository provides the standalone VS Code extension for
[XIRASM](https://github.com/XIRASM/XirAsm). It focuses on the modern
assembler surface: natural ISA text, compile-time Meta syntax, API-style
data/output helpers, and bundled DSL libraries.

## Features

- Language id `xirasm` for `.xir`, `.asm`, and `.inc` files.
- TextMate highlighting for labels, ISA lines, Meta functions, braces, aggregate literals, API calls, and `format/*.inc` helpers.
- Completion and hover data generated from the repository API matrix, current `include/format` files, and backend instruction data where available.
- Include/import path completion for `import("...")` and `include("...")`.
- Go-to-definition for labels, Meta functions, and resolved include/import files.
- Save-time diagnostics through a real `xirasm` executable when available.

## Include Resolution

The language server resolves source imports in the same user-facing order as the CLI model:

1. current source file directory;
2. ancestor project directories and their `include/` folders;
3. workspace roots and their `include/` folders;
4. extension-bundled `resources/include` synchronized from XIRASM releases.

Project-local helpers should live under `include/`. Start common format work
from the short facade imports:

```asm
import("format/pe64.inc");
import("format/elf64.inc");
import("format/coff64.inc");
```

The lower-level PE/COFF/ELF helper files are still available for advanced
recipes, but completion and snippets should guide new users to the facade
surface first.

Version 0.2.19 keeps ARM DSL libraries in the assembler distribution and project
include paths instead of bundling them in the extension. Functions and macros
from resolvable source imports use the language server's general source support;
they do not require entries in the native instruction catalog. Core format
helpers remain bundled. The optional OS SDK and standard library are also
provided by the assembler distribution.

## Diagnostics

On save, the extension tries to run `xirasm` for compiler-backed diagnostics. Auto-detection checks `zig-out/bin/xirasm(.exe)` under workspace roots, then falls back to `xirasm` on `PATH`.

Settings:

```json
{
  "xirasm.diagnostics.assembler.enabled": true,
  "xirasm.diagnostics.assembler.executablePath": "",
  "xirasm.diagnostics.assembler.timeoutMs": 5000
}
```

The extension writes diagnostic output to an OS temporary file and removes it after the assembler exits.

## Development

```powershell
npm install
npm run compile
npm run package
```

`npm run compile` is standalone: it checks the tracked language data,
type-checks the server/client, bundles the extension, and verifies bundled
include/import resolution.

Install a local package with:

```powershell
code --install-extension .\xirasm-vscode-0.2.8.vsix
```
