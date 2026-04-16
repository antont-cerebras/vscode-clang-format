# Clang-Format for VS Code

[![License: MIT](https://img.shields.io/badge/license-MIT-orange.svg)](https://github.com/antont-cerebras/vscode-clang-format/blob/master/LICENSE)

[`clang-format`](https://clang.llvm.org/docs/ClangFormat.html) is a CLI tool to format source code files for C, C++, JavaScript, and many other languages. This extension aims to provide a VS Code-based UI to access to `clang-format`'s functionality. Install it from [GitHub Releases](#installing-or-updating-the-extension-from-github).

## Prerequisites

- **Visual Studio Code 1.96** or later
- The **`clang-format` binary** installed on your system — this extension does not install it. See [Installing Clang-Format](#installing-clang-format) for instructions, and [Specifying the location of clang-format](#specifying-the-location-of-clang-format) if it is not on your `PATH`.

## Basic usage

The formatting style can be configured with a `.clang-format` file in the current folder or any parent folder. See [ClangFormatStyleOptions](https://clang.llvm.org/docs/ClangFormatStyleOptions.html) for available options.

Files can be formatted on demand by right-clicking in the document and selecting **Format Document**, or by using the keyboard shortcut (usually Ctrl+Shift+F on Windows, Ctrl+Shift+I on Linux, and Shift+Option+F on macOS). This works for both saved files and unsaved buffers.

To format only part of a file, select the text and choose **Format Selection** from the right-click menu, or use Ctrl+K Ctrl+F (Cmd+K Cmd+F on macOS).

To set this extension as the default formatter, add per-language settings to your `settings.json`:
```json
{
    "[cpp]": {
        "editor.defaultFormatter": "Cerebras.clang-format"
    }
}
```

`editor.defaultFormatter` — designates this extension as the formatter for the language. Required when multiple extensions with formatting capabilities are active (e.g. alongside clangd).

The [clangd](https://github.com/clangd/vscode-clangd) LSP extension and this extension can be used together — clangd provides code navigation, completion, and diagnostics, while this extension handles formatting. This is useful because clangd uses its own bundled [LibFormat](https://clang.llvm.org/docs/LibFormat.html) library and *does not* allow overriding the `clang-format` binary, whereas this extension lets you specify the exact binary for your project.

## Configuring

To enable automatic formatting, add per-language settings to your `settings.json`:

```json
{
    "[cpp]": {
        "editor.defaultFormatter": "Cerebras.clang-format",
        "editor.formatOnSave": true,
        "editor.formatOnPaste": true,
        "editor.formatOnType": true
    }
}
```

- `editor.formatOnSave` — format the file automatically on every save.
- `editor.formatOnPaste` — format pasted code automatically.
- `editor.formatOnType` — format the current line after pressing Enter.

### Specifying the location of clang-format

This extension searches for `clang-format` on your `PATH`. To use a specific binary, set `clang-format.executable` in your `settings.json`:

```json
{
    "clang-format.executable": "/absolute/path/to/clang-format"
}
```

### Placeholders

The following placeholders are supported across all settings that accept paths or commands (`clang-format.executable`, `clang-format.style`, `clang-format.language.<lang>.style`, `clang-format.formatProjectCommand`, `clang-format.formatChangedCommand`, `clang-format.commands`):

- `${workspaceRoot}` / `${workspaceFolder}` — absolute path of the current VS Code workspace.
- `${cwd}` — current working directory of VS Code.
- `${env.VAR}` — value of environment variable `VAR`, e.g. `${env.HOME}`.
- `${file}` — absolute path of the file in the active editor.
- `${clang-format.executable}` — the clang-format binary path configured in `clang-format.executable`. Useful in command strings to avoid repeating the binary path.
- `${toolchainPointerFile}` — contents of the file set in `clang-format.toolchainPointerFile` (only in `clang-format.executable`). See [Toolchain pointer file](#toolchain-pointer-file).

The `clang-format.assumeFilename` setting supports a separate set of file-path placeholders: `${file}`, `${fileNoExtension}`, `${fileBasename}`, `${fileBasenameNoExtension}`, and `${fileExtname}`, with the same meaning as [VS Code's predefined variables](https://code.visualstudio.com/docs/editor/variables-reference). For example, `${fileNoExtension}.cpp` will format `/home/src/foo.h` with `-assume-filename /home/src/foo.cpp`.

Some examples for `clang-format.executable`:

- `${workspaceRoot}/node_modules/.bin/clang-format` — use the version installed locally via `npm install clang-format`.
- `${env.HOME}/tools/clang38/clang-format` — use a specific version under your home directory.

### Toolchain pointer file

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

### Create .clang-format File

Run **Clang-Format: Create .clang-format File...** to generate a new `.clang-format` config. A style picker lets you choose from LLVM, Google, Chromium, Mozilla, WebKit, Microsoft, GNU, or InheritParentConfig. The command runs `clang-format -style=<style> -dump-config` and shows a save dialog with `.clang-format` pre-filled in the current file's directory.

### Preview Formatting

Run **Clang-Format: Preview Formatting** to format the current file without modifying it and open a diff view showing the changes.

### Ignore Formatting for Selection

Select code and run **Clang-Format: Ignore Formatting for Selection** to wrap it with `// clang-format off` and `// clang-format on` comments, preventing clang-format from touching that region. Set `clang-format.ignoreFormattingCommentStyle` to `"block"` to use `/* clang-format off */` style instead.

To undo this, place the cursor inside an ignored region and run **Clang-Format: Remove Formatting Ignore** — it deletes the enclosing `off`/`on` comment pair (both `//` and `/* */` styles are recognized). To strip all ignore comments from the file at once, use **Clang-Format: Remove All Formatting Ignores**.

### Ignore Formatting for Current File

Run **Clang-Format: Ignore Formatting for Current File** to exclude the entire file from formatting. By default, it inserts a `// clang-format off` comment at the top of the file. Set `clang-format.ignoreFileMethod` to `"clang-format-ignore"` to instead add the file to `.clang-format-ignore` (the extension searches upward from the file's directory, matching clang-format's own lookup; if no `.clang-format-ignore` exists, it creates one in the workspace root).

### Format Project / Format Changed Files / Run Command...

Set `clang-format.formatProjectCommand` and/or `clang-format.formatChangedCommand` to enable the dedicated **Clang-Format: Format Project** and **Clang-Format: Format Changed Files** commands:

```json
{
    "clang-format.formatProjectCommand": "make clang-format",
    "clang-format.formatChangedCommand": "make clang-format-changed"
}
```

For additional project-specific commands, define them in `clang-format.commands` and run them via **Clang-Format: Run Command...**, which shows a Quick Pick:

```json
{
    "clang-format.commands": [
        {
            "name": "Check formatting",
            "command": "${clang-format.executable} --dry-run --Werror ${file}"
        },
        {
            "name": "Dump clang-format config",
            "command": "${clang-format.executable} --dump-config"
        }
    ]
}
```

All commands run from the first workspace folder and stream output to the **Clang-Format** Output panel.

**Clang-Format: Repeat Last Command** re-runs whichever command was executed most recently (across all three sources above), persisted across sessions.

## Logging

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

## Installing or Updating the Extension from GitHub

The extension is published as a `.vsix` file on [GitHub Releases](https://github.com/antont-cerebras/vscode-clang-format/releases). You can download it manually (or with `wget`/`curl`) and install via **Extensions: Install from VSIX...** in the Command Palette.

Alternatively, the shell function below automates downloading and installing it. Add it to your `.bashrc` or `.zshrc`:

```bash
# Download and install the clang-format VS Code extension.
# Usage: clang-format-ext-update [--no-remove-stale-versions] [vX.Y.Z | X.Y.Z | <url-to-.vsix>]
#   No argument: fetches the latest release from GitHub.
# Since .vscode is symlinked across all worktrees, one install updates everywhere.
# Requires: code (available in VS Code integrated terminal), curl, jq
clang-format-ext-update() {
  local repo="antont-cerebras/vscode-clang-format"
  local remove_stale=1 force_reinstall=0 arg=""
  for a in "$@"; do
    case "$a" in
      --no-remove-stale-versions) remove_stale=0 ;;
      --force-reinstall) force_reinstall=1 ;;
      --help)
        echo "Usage: clang-format-ext-update [OPTIONS] [vX.Y.Z | X.Y.Z | <url-to-.vsix>]"
        echo ""
        echo "Install the Cerebras clang-format VS Code extension from GitHub releases."
        echo "With no version argument, installs the latest release."
        echo "After a successful install, removes any other installed clang-format versions."
        echo ""
        echo "Options:"
        echo "  --force-reinstall           Skip confirmation prompts"
        echo "  --no-remove-stale-versions  Keep older installed versions after install"
        echo "  --help                      Show this help"
        return 0 ;;
      *) arg="$a" ;;
    esac
  done
  local info vsix_url vsix_name tag

  # Prerequisite checks
  local missing=()
  for cmd in curl jq; do
    command -v "$cmd" &>/dev/null || missing+=("$cmd")
  done
  if [[ ${#missing[@]} -gt 0 ]]; then
    echo "error: missing required tools: ${missing[*]}" >&2; return 1
  fi
  if ! command -v code &>/dev/null; then
    echo "error: 'code' not found — run this from the VS Code integrated terminal" >&2; return 1
  fi
  # Refresh the IPC socket path — existing tmux panes keep the stale path from the
  # previous VS Code session; point to the most recently created live socket instead.
  local fresh_sock
  fresh_sock=$(ls -t /run/user/$UID/vscode-ipc-*.sock 2>/dev/null | head -1)
  [[ -n "$fresh_sock" ]] && export VSCODE_IPC_HOOK_CLI="$fresh_sock"
  if [[ "$TERM_PROGRAM" != "vscode" ]]; then
    echo -e "\e[33mwarning: not running inside VS Code terminal — 'code --install-extension' may fail\e[0m"
  elif [[ -z "$fresh_sock" ]]; then
    echo "error: no VS Code IPC socket found — is VS Code connected to this host?" >&2; return 1
  fi

  if [[ "$arg" == https://* || "$arg" == http://* ]]; then
    vsix_url="$arg"
    vsix_name="${vsix_url##*/}"
    tag="(from URL)"
  else
    local api
    if [[ -n "$arg" ]]; then
      api="https://api.github.com/repos/$repo/releases/tags/v${arg#v}"
    else
      api="https://api.github.com/repos/$repo/releases/latest"
    fi
    echo "Fetching release info..."
    info=$(curl -fsSL "$api") || { echo "error: failed to fetch release info" >&2; return 1; }
    if printf '%s' "$info" | jq -e '.message' &>/dev/null; then
      echo "error: $(printf '%s' "$info" | jq -r '.message')" >&2; return 1
    fi
    vsix_url=$(printf '%s' "$info" | jq -r '.assets[] | select(.name | endswith(".vsix")) | .browser_download_url')
    vsix_name=$(printf '%s' "$info" | jq -r '.assets[] | select(.name | endswith(".vsix")) | .name')
    tag=$(printf '%s' "$info" | jq -r '.tag_name')
    if [[ -z "$vsix_url" ]]; then
      echo "error: no .vsix asset found in release ($tag)" >&2; return 1
    fi
  fi

  echo "Release: $tag ($vsix_name)"
  local new_ver="${tag#v}"
  # For URL installs, try to extract the version from the filename (e.g. clang-format-2.0.10.vsix)
  [[ "$tag" == "(from URL)" ]] && new_ver=$(grep -oP '\d+\.\d+\.\d+' <<< "$vsix_name" | head -1)
  if [[ -n "$new_ver" ]]; then
    local cur_ver
    cur_ver=$(ls -d ~/.vscode-server/extensions/*clang*format*-* 2>/dev/null \
      | grep -oP '\d+\.\d+\.\d+$' | sort -V | tail -1)
    if [[ -n "$cur_ver" ]]; then
      local reply prompt
      if [[ "$cur_ver" == "$new_ver" ]]; then
        prompt="Version $new_ver is already installed. Overwrite? [y/N] "
      elif [[ "$(printf '%s\n' "$cur_ver" "$new_ver" | sort -V | tail -1)" == "$cur_ver" ]]; then
        prompt="Downgrade from $cur_ver to $new_ver? [y/N] "
      fi
      if [[ -n "$prompt" ]]; then
        if [[ $force_reinstall -eq 1 ]]; then
          echo "$prompt(--force-reinstall) y"
        else
          read -r -p "$prompt" reply
          [[ "${reply,,}" == "y" ]] || { echo "Skipping."; return 0; }
        fi
      fi
    fi
  fi

  local tmpdir tmp
  tmpdir=$(mktemp -d) || return 1
  tmp="$tmpdir/$vsix_name"
  echo "Downloading..."
  curl -fsSL -o "$tmp" "$vsix_url" || { rm -rf "$tmpdir"; return 1; }
  echo "Installing..."
  code --install-extension "$tmp" --force
  local rc=$?
  rm -rf "$tmpdir"
  if [[ $rc -eq 0 ]]; then
    if [[ $remove_stale -eq 1 ]]; then
      local stale
      while IFS= read -r stale; do
        [[ "$stale" == *"-$new_ver" ]] && continue
        rm -rf "$stale" && echo "Removed stale: ${stale##*/}"
      done < <(ls -d ~/.vscode-server/extensions/*clang*format*-* 2>/dev/null)
    fi
    # VS Code does not expose a CLI command to trigger reload programmatically.
    echo -e "\e[33m⚠  Reload the VS Code window to activate the new version.\e[0m"
    echo -e "   Command Palette (Ctrl/Cmd+Shift+P) → Developer: Reload Window"
  fi
  return $rc
}
```

## Credits

This project is maintained by [Cerebras](https://cerebras.ai). It is a fork of [a5ehren/vscode-clang-format](https://github.com/a5ehren/vscode-clang-format), which in turn is a rewrite of the original [xaverh/vscode-clang-format](https://github.com/xaverh/vscode-clang-format) extension, updated with modern VSIX and TypeScript best practices.

