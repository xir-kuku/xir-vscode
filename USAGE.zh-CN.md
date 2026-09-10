# XIRASM VS Code 扩展使用指南

## 功能

扩展为 `.xir`、`.asm` 和 `.inc` 文件提供：

- XIRASM、Meta/DSL 与 ISA 文本语法高亮；
- API、类型、寄存器和格式 helper 补全与悬停信息；
- 标签、函数、`import` 和 `include` 跳转；
- bundled `format/`、`io/` include 路径补全；
- 保存时调用真实 `xirasm` 可执行文件生成诊断。

## 环境要求

- Node.js 20 或更高版本；
- npm；
- VS Code 1.90 或更高版本；
- 可选：`xirasm` 可执行文件，用于保存时的编译器诊断。

## 从源码编译

首次获取仓库后安装锁定依赖：

```powershell
npm ci
```

类型检查、bundle 并验证语言数据和 include 解析：

```powershell
npm run compile
```

生成文件位于 `out/`。普通编译只使用当前扩展仓库中已跟踪的语言数据
和 `resources/include`，不要求本机存在 XIRASM 主仓库。

## 生成 VSIX 安装包

```powershell
npm run package
```

成功后，仓库根目录会生成类似下面的文件：

```text
xirasm-vscode-0.2.8.vsix
```

## 安装与升级

在 VS Code 中安装：

1. 打开 Extensions 视图。
2. 点击右上角菜单。
3. 选择 **Install from VSIX...**。
4. 选择生成的 `.vsix` 文件。

也可以使用命令行：

```powershell
code --install-extension .\xirasm-vscode-0.2.8.vsix
```

升级本地版本时重新运行同一命令；需要强制覆盖时添加
`--force`。安装或升级后，按 VS Code 提示重新加载窗口。

卸载扩展：

```powershell
code --uninstall-extension xirasm.xirasm-vscode
```

## 配置编译器诊断

扩展默认在工作区中查找 `zig-out/bin/xirasm` 或
`zig-out/bin/xirasm.exe`，找不到时再从 `PATH` 查找 `xirasm`。

也可以在工作区的 `.vscode/settings.json` 中显式配置：

```json
{
  "xirasm.diagnostics.assembler.enabled": true,
  "xirasm.diagnostics.assembler.executablePath": "",
  "xirasm.diagnostics.assembler.timeoutMs": 5000
}
```

- `enabled`：是否在保存时运行编译器诊断；
- `executablePath`：`xirasm` 路径；空字符串表示自动查找；
- `timeoutMs`：单次诊断超时时间，单位为毫秒。

项目需要稳定的工具链版本时，建议在工作区设置中填写项目自带的
`xirasm` 相对路径，不要把个人机器的绝对路径提交到共享配置。

## 常见问题

### 保存文件时没有诊断

确认 `xirasm.diagnostics.assembler.enabled` 为 `true`，并检查
`executablePath`、工作区 `zig-out/bin/` 或 `PATH` 中是否存在可执行文件。

### `import` 或 `include` 无法跳转

扩展依次搜索当前文件目录、祖先目录及其 `include/`、工作区及其
`include/`，最后搜索扩展自带的 `resources/include`。项目私有 helper
应放在项目的 `include/` 下。

0.2.19 不再把 ARM DSL 库打入扩展。ARM、可选 OS SDK 和标准库由汇编器
发行包或项目提供；请确保源码导入路径可以解析。函数和宏使用通用的源码
分析能力，不需要注册到原生指令表。格式辅助库仍保留在扩展中。

### 补全与当前编译器不一致

扩展仓库中的语言数据对应其发布时的 XIRASM 版本。请升级到与编译器
版本一致的扩展版本。
