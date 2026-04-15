# Clang-Format for VS Code

[![License: MIT](https://img.shields.io/badge/license-MIT-orange.svg)](https://github.com/antont-cerebras/vscode-clang-format/blob/master/LICENSE)

[Clang-Format](http://clang.llvm.org/docs/ClangFormat.html) is a tool to format C, C++, JavaScript, and many other languages. It can be configured with a `.clang-format` file in the working folder or any parent folder. See [ClangFormatStyleOptions](http://clang.llvm.org/docs/ClangFormatStyleOptions.html) for available options.

This project is maintained by [Cerebras](https://cerebras.ai). It is a fork of [a5ehren/vscode-clang-format](https://github.com/a5ehren/vscode-clang-format), which in turn is a rewrite of the original [xaverh/vscode-clang-format](https://github.com/xaverh/vscode-clang-format) extension, updated with modern VSIX and TypeScript best practices.

## Prerequisites

- **Visual Studio Code 1.96** or later
- The **`clang-format` binary** installed on your system — this extension does not install it. See [Installing Clang-Format](#installing-clang-format) for instructions, and [Specifying the location of clang-format](#specifying-the-location-of-clang-format) if it is not on your `PATH`.

## Usage

This extension invokes the `clang-format` binary to format source files directly within VS Code.

The [clangd](https://github.com/clangd/vscode-clangd) LSP extension and this extension can be used together — clangd provides code navigation, completion, and diagnostics, while this extension handles formatting. This is useful because clangd uses its own bundled libFormat library and does not allow overriding the `clang-format` binary, whereas this extension lets you specify the exact binary for your project.

To avoid conflicts when both extensions are active, designate this extension as the default formatter for the languages you care about in your `settings.json`:

```json
{
    "[c]":   { "editor.defaultFormatter": "Cerebras.clang-format" },
    "[cpp]": { "editor.defaultFormatter": "Cerebras.clang-format" }
}
```

Files can be formatted on demand by right-clicking in the document and selecting **Format Document**, or by using the keyboard shortcut (usually Ctrl+Shift+F on Windows, Ctrl+Shift+I on Linux, and Shift+Option+F on macOS).

To automatically format on save, add the following to your `settings.json`:

```json
{
    "editor.formatOnSave": true
}
```

## Specifying the location of clang-format

This extension searches for `clang-format` on your `PATH`. To use a specific binary, set `clang-format.executable` in your `settings.json`:

```json
{
    "clang-format.executable": "/absolute/path/to/clang-format"
}
```

The following placeholders are supported in `clang-format.executable`:

- `${workspaceRoot}` — absolute path of the current VS Code workspace root.
- `${workspaceFolder}` — absolute path of the current VS Code workspace. For files outside any workspace, expands to the first available workspace root.
- `${cwd}` — current working directory of VS Code.
- `${env.VAR}` — value of the environment variable `VAR`, e.g. `${env.HOME}`.
- `${toolchainPointerFile}` — contents of the file specified in `clang-format.toolchainPointerFile`. See [Toolchain pointer file](#toolchain-pointer-file) below.

Some examples:

- `${workspaceRoot}/node_modules/.bin/clang-format` — use the version installed locally via `npm install clang-format`.
- `${env.HOME}/tools/clang38/clang-format` — use a specific version under your home directory.

The `clang-format.assumeFilename` setting also supports placeholders: `${file}`, `${fileNoExtension}`, `${fileBasename}`, `${fileBasenameNoExtension}`, and `${fileExtname}`, with the same meaning as [VS Code's predefined variables](https://code.visualstudio.com/docs/editor/variables-reference). For example, `${fileNoExtension}.cpp` will format `/home/src/foo.h` with `-assume-filename /home/src/foo.cpp`.

The workspace and environment placeholders (`${workspaceRoot}`, `${workspaceFolder}`, `${cwd}`, `${env.VAR}`) are also supported in `clang-format.style` and `clang-format.language.<language>.style`.

## Toolchain pointer file

In environments where the toolchain version is tracked via a tag file in the repository, the `${toolchainPointerFile}` placeholder lets you derive the clang-format path from that file automatically.

Set `clang-format.toolchainPointerFile` to the path of the tag file and use `${toolchainPointerFile}` in `clang-format.executable`:

```json
{
    "clang-format.toolchainPointerFile": "${workspaceFolder}/.llvm-version",
    "clang-format.executable": "${toolchainPointerFile}/bin/clang-format"
}
```

The extension reads the tag file at format time, trims whitespace, and substitutes its contents into the executable path. If the file cannot be read, a visible error is shown in VS Code.

## Commands

### Open .clang-format for Current File

Run **Clang-Format: Open .clang-format for Current File** from the command palette to open the `.clang-format` config that applies to the file in the active editor. The extension searches upward from the file's directory, matching the same lookup order clang-format uses. If no config file is found, a notification is shown including the directory that was searched from.

`.clang-format` and `_clang-format` files are automatically associated with the YAML language, so they open with proper syntax highlighting.

## Verbose logging

Set `clang-format.verboseLog` to `true` to log each individual edit as a colored diff in the **Clang-Format** Output panel:

```json
{
    "clang-format.verboseLog": true
}
```

Each edit shows the affected source lines before (`-`) and after (`+`), colored using the diff syntax highlighting of your current theme. Large edits are truncated with a line count summary.

## Installing Clang-Format

On **Linux**, install `clang-format` from your distro's package manager.

On **macOS**, use [Homebrew](https://brew.sh/): `brew install clang-format`.

On **Windows**, install LLVM using the [installer](https://llvm.org/) or via [winget](https://learn.microsoft.com/en-us/windows/package-manager/winget/):

```
winget install -e --id LLVM.LLVM
```

LLVM includes the `clang-format` binary. With the default install path, set:

```json
{
    "clang-format.executable": "C:\\Program Files\\LLVM\\bin\\clang-format.exe"
}
```
