# README

[![License: MIT](https://img.shields.io/badge/license-MIT-orange.svg)](https://github.com/antont-cerebras/vscode-clang-format/blob/master/LICENSE)

[Clang-Format](http://clang.llvm.org/docs/ClangFormat.html) is a tool to format many different coding languages. It can be configured with a config file named `.clang-format` within the working folder or a parent folder. Configuration see: http://clang.llvm.org/docs/ClangFormatStyleOptions.html

This project is maintained by [Cerebras](https://cerebras.ai). It is a fork of [a5ehren/vscode-clang-format](https://github.com/a5ehren/vscode-clang-format), which in turn is a rewrite of the original [xaverh/vscode-clang-format](https://github.com/xaverh/vscode-clang-format) extension, updated with modern VSIX and TypeScript best practices.

## Prerequisites

- **Visual Studio Code 1.96** or later
- The **`clang-format` binary** installed on your system — this extension does not install it. See [Installing Clang-Format](#installing-clang-format) for instructions, and [Specifying the location of clang-format](#specifying-the-location-of-clang-format) if it is not on your `PATH`.

## Usage

This extension allows clang-format to be used to format C/C++, Javascript etc.
source files directly from within Visual Studio Code.

The [clangd](https://github.com/clangd/vscode-clangd) LSP extension and this
extension can be used together — clangd provides code navigation, completion,
and diagnostics, while this extension handles formatting. This is useful because
clangd uses its own bundled libFormat library and does not allow overriding the
`clang-format` binary, whereas this extension lets you specify the exact binary
for your project.

To avoid conflicts when both extensions are active, designate this extension as
the default formatter for the languages you care about in your `settings.json`:

```json
{
    "[c]":   { "editor.defaultFormatter": "Cerebras.clang-format" },
    "[cpp]": { "editor.defaultFormatter": "Cerebras.clang-format" }
}
```

Files can be formatted on-demand by right clicking in the document and
selecting "Format Document", or by using the associated keyboard shortcut
(usually Ctrl+⇧+F on Windows, Ctrl+⇧+I on Linux, and ⇧+⌥+F on macOS).

To automatically format a file on save, add the following to your
vscode settings.json file:

```json
{
    "editor.formatOnSave": true
}
```

## Specifying the location of clang-format

This extension will attempt to find clang-format on your `PATH`.
Alternatively, the clang-format executable can be specified in your vscode
settings.json file:

```json
{
    "clang-format.executable": "/absolute/path/to/clang-format"
}
```

Placeholders can also be used in the `clang-format.executable` value.
The following placeholders are supported:

- `${workspaceRoot}` - replaced by the absolute path of the current vscode
  workspace root.
- `${workspaceFolder}` - replaced by the absolute path of the current vscode
  workspace. In case of outside-workspace files `${workspaceFolder}` expands
  to the absolute path of the first available workspace.
- `${cwd}` - replaced by the current working directory of vscode.
- `${env.VAR}` - replaced by the environment variable `$VAR`, e.g. `${env.HOME}`
  will be replaced by `$HOME`, your home directory.
- `${toolchainPointerFile}` - replaced by the contents of the file specified in
  `clang-format.toolchainPointerFile`. Useful when the clang-format path is
  determined by a version tag file checked in to the repository. See
  [Toolchain pointer file](#toolchain-pointer-file) below.

Some examples:

- `${workspaceRoot}/node_modules/.bin/clang-format` - specifies the version of
  clang that has been added to your workspace by `npm install clang-format`.
- `${env.HOME}/tools/clang38/clang-format` - use a specific clang format version
  under your home directory.

Placeholders are also supported in `clang-format.assumeFilename`. The supported
placeholders are `${file}`, `${fileNoExtension}`, `${fileBasename}`,
`${fileBasenameNoExtension}`, and `${fileExtname}`, with the same meaning as the
predefined variables in [other configuration files](https://code.visualstudio.com/docs/editor/variables-reference).

For example:
- `${fileNoExtension}.cpp` - `/home/src/foo.h` will be formatted with
  `-assume-filename /home/src/foo.cpp`.

The workspace/environment placeholders (`${workspaceRoot}`, `${workspaceFolder}`, `${cwd}`, `${env.VAR}`) are also supported in `clang-format.style` and `clang-format.language.<language name>.style`.

## Toolchain pointer file

In environments where the toolchain version is tracked via a tag file in the
repository, the `${toolchainPointerFile}` placeholder lets you derive the
clang-format path from that file automatically.

Set `clang-format.toolchainPointerFile` to the path of the tag file, and use
`${toolchainPointerFile}` in `clang-format.executable`:

```json
{
    "clang-format.toolchainPointerFile": "${workspaceFolder}/.llvm-version",
    "clang-format.executable": "${toolchainPointerFile}/bin/clang-format"
}
```

The extension reads the tag file at format time, trims whitespace, and
substitutes its contents into the executable path. If the file cannot be read,
a visible error is shown in VS Code.

## Verbose logging

Set `clang-format.verboseLog` to `true` to log each individual edit as a
colored diff in the **Clang-Format** Output panel:

```json
{
    "clang-format.verboseLog": true
}
```

Each edit shows the affected source lines before (`-`) and after (`+`), colored
using the diff syntax highlighting of your current theme. Large edits are
truncated with a line count summary.

## Installing Clang-Format

On Linux, install `clang-format` from your distro's package manager.

On MacOS, the simplest way is to use [Homebrew](https://brew.sh/) and run `brew install clang-format`.

On Windows, the simplest way is to install LLVM to the default path either using the [installer](https://llvm.org/) or by simply running `winget install -e --id LLVM.LLVM` using [winget](https://learn.microsoft.com/en-us/windows/package-manager/winget/). 

LLVM contains the clang-format binary, the resulting path for the `clang-format.executable` then becomes:
```json
{
    "clang-format.executable": "c:\\Program Files\\LLVM\\bin\\clang-format.exe"
}
```
