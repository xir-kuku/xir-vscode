import fs from "fs";

const source = fs.readFileSync("src/languageData.ts", "utf8");
const entries = new Map();
const itemPattern = /^\s*item\(("(?:\\.|[^"\\])*"),\s*("(?:\\.|[^"\\])*"),\s*("(?:\\.|[^"\\])*")\s*,/gm;
let itemMatch;
while ((itemMatch = itemPattern.exec(source))) {
  entries.set(JSON.parse(itemMatch[1]), {
    detail: JSON.parse(itemMatch[2]),
    documentation: JSON.parse(itemMatch[3]),
  });
}
const requiredLabels = [
  "import",
  "include",
  "fn",
  "break",
  "continue",
  "defer",
  "struct",
  "emit.u8",
  "emit.bytes",
  "db",
  "rb",
  "store.u32",
  "load.u32",
  "region.begin",
  "region.file_align",
  "x86.use64",
  "riscv.use64",
  "pe_begin64",
  "pe_finalize_section64",
  "pe_import_emit64",
  "coff_begin64",
  "elfexe_begin64",
  "elfso_begin64",
  "OpMemoryModel",
];
const missing = requiredLabels.filter((label) => !entries.has(label));
if (missing.length > 0) throw new Error(`language data is missing entries: ${missing.join(", ")}`);

const expectedInstructionDetails = new Map([
  ["mov", "x86 instruction"],
  ["addi", "RISC-V instruction"],
  ["add", "x86 / RISC-V instruction"],
  ["and", "x86 / RISC-V instruction"],
  ["or", "x86 / RISC-V instruction"],
  ["sub", "x86 / RISC-V instruction"],
  ["xor", "x86 / RISC-V instruction"],
]);
for (const [label, expectedDetail] of expectedInstructionDetails) {
  const actualDetail = entries.get(label)?.detail;
  if (actualDetail !== expectedDetail) {
    throw new Error(`language data entry ${label} has detail ${JSON.stringify(actualDetail)}; expected ${JSON.stringify(expectedDetail)}`);
  }
}

const operandFields = ["aq", "bimm12hi", "imm12", "rs1", "zimm5"];
const leakedOperandFields = operandFields.filter((label) => entries.has(label));
if (leakedOperandFields.length > 0) {
  throw new Error(`language data contains RISC-V operand fields as instructions: ${leakedOperandFields.join(", ")}`);
}
for (const banned of [["include", "_once"].join(""), ["end", " macro"].join(""), ["rv", "_raw"].join(""), ["was", "m_"].join(""), ["end", " struc"].join(""), ["Z", "ASMG"].join("")]) {
  if (source.includes(banned)) throw new Error(`language data contains stale token: ${banned}`);
}
console.log(`language data ok (${requiredLabels.length} sentinel entries)`);
