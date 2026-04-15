import * as vscode from "vscode";
import * as cp from "child_process";
import * as path from "path";
import { MODES } from "./clangMode";
import { ALIAS } from "./shared/languageConfig";
import { statSync, readFileSync } from "fs";

interface ClangFormatConfig {
  executable: string;
  style: string;
  fallbackStyle: string;
  assumeFilename: string;
}

interface EditInfo {
  length: number;
  offset: number;
  text: string;
}

function timestamp(): string {
  return new Date().toTimeString().slice(0, 8); // HH:MM:SS
}

// Cache binary paths for performance
const binPathCache: Record<string, string | undefined> = {};
export const outputChannel = vscode.window.createOutputChannel(
  "Clang-Format",
  "diff",
);
let diagnosticCollection: vscode.DiagnosticCollection;

function getPlatformString() {
  switch (process.platform) {
    case "win32":
      return "windows";
    case "linux":
      return "linux";
    case "darwin":
      return "osx";
  }

  return "unknown";
}

function whichSync(name: string): string {
  const pathDirs = (process.env.PATH ?? "")
    .split(path.delimiter)
    .filter(Boolean);
  const extensions =
    process.platform === "win32"
      ? (process.env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD")
          .split(";")
          .filter(Boolean)
      : [""];
  for (const dir of pathDirs) {
    for (const ext of extensions) {
      const candidate = path.join(dir, name + ext);
      try {
        if (statSync(candidate).isFile()) {
          return candidate;
        }
      } catch {
        // not in this dir
      }
    }
  }
  throw new Error(`not found: ${name}`);
}

/**
 * Get the path to a binary by searching PATH and caching the result
 * @param binname The name of the binary to find
 * @returns The full path to the binary
 */
function getBinPath(binname: string): string {
  // Return cached path if it exists
  if (binPathCache[binname]) {
    try {
      // Verify the cached binary still exists
      if (statSync(binPathCache[binname]).isFile()) {
        return binPathCache[binname];
      }
    } catch {
      // Cache is invalid, remove it
      binPathCache[binname] = undefined;
    }
  }

  // If an absolute path is given, verify it directly without PATH search
  if (path.isAbsolute(binname)) {
    try {
      if (statSync(binname).isFile()) {
        binPathCache[binname] = binname;
        return binname;
      }
    } catch {
      // fall through to throw below
    }
    outputChannel.appendLine(`Could not find binary '${binname}'`);
    throw new Error(`clang-format binary not found: "${binname}"`);
  }

  try {
    // Try to find the binary using which
    const binPath = whichSync(binname);

    // Validate the path and handle spaces properly
    if (binPath?.trim()) {
      // Normalize the path to handle platform-specific separators
      const normalizedPath = path.normalize(binPath.trim());

      // Verify the path exists and is accessible
      try {
        const stats = statSync(normalizedPath);
        if (stats.isFile()) {
          binPathCache[binname] = normalizedPath;
          return normalizedPath;
        }
      } catch (statError: unknown) {
        // Path exists but stat failed, log warning but continue
        const statErrorMessage =
          statError instanceof Error ? statError.message : String(statError);
        outputChannel.appendLine(
          `Warning: Could not stat binary at ${normalizedPath}: ${statErrorMessage}`,
        );
        binPathCache[binname] = normalizedPath;
        return normalizedPath;
      }
    }

    // If we get here, something went wrong with the path
    throw new Error(`Invalid binary path returned by which: ${binPath}`);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    outputChannel.appendLine(
      `Could not find binary '${binname}' in PATH: ${errorMessage}`,
    );
    throw new Error(`clang-format binary not found: "${binname}"`);
  }
}

export class ClangDocumentFormattingEditProvider
  implements
    vscode.DocumentFormattingEditProvider,
    vscode.DocumentRangeFormattingEditProvider
{
  private readonly defaultConfigure: ClangFormatConfig = {
    executable: "clang-format",
    style: "file",
    fallbackStyle: "none",
    assumeFilename: "",
  };

  public provideDocumentFormattingEdits(
    document: vscode.TextDocument,
    options: vscode.FormattingOptions,
    token: vscode.CancellationToken,
  ): Promise<vscode.TextEdit[]> {
    const fullRange = new vscode.Range(
      document.positionAt(0),
      document.positionAt(document.getText().length),
    );
    return this.doFormatDocument(document, fullRange, options, token);
  }

  public provideDocumentRangeFormattingEdits(
    document: vscode.TextDocument,
    range: vscode.Range,
    options: vscode.FormattingOptions,
    token: vscode.CancellationToken,
  ): Promise<vscode.TextEdit[]> {
    return this.doFormatDocument(document, range, options, token);
  }

  private getEdits(
    document: vscode.TextDocument,
    xml: string,
    codeContent: string,
  ): Promise<vscode.TextEdit[]> {
    return new Promise<vscode.TextEdit[]>((resolve, reject) => {
      const textEncoder = new TextEncoder();
      const getUtf8Length = (str: string, start: number, len: number): number =>
        textEncoder.encode(str.substring(start, start + len)).length;

      const byteToOffset = (editInfo: EditInfo): EditInfo => {
        const content = codeContent;
        let bytePos = 0;
        let charPos = 0;
        while (bytePos < editInfo.offset && charPos < content.length) {
          bytePos += getUtf8Length(content, charPos, 1);
          charPos++;
        }
        editInfo.offset = charPos;
        const byteEnd = bytePos + editInfo.length;
        let charEnd = charPos;
        while (bytePos < byteEnd && charEnd < content.length) {
          bytePos += getUtf8Length(content, charEnd, 1);
          charEnd++;
        }
        editInfo.length = charEnd - charPos;
        return editInfo;
      };

      // Single-pass XML entity decoder (avoids double-decoding &amp;lt; etc.)
      // Also handles numeric character references (e.g. &#10; for newline).
      const decodeEntities = (s: string): string =>
        s.replace(/&(?:amp|lt|gt|apos|quot|#x[\da-fA-F]+|#\d+);/g, (m) => {
          switch (m) {
            case "&amp;":
              return "&";
            case "&lt;":
              return "<";
            case "&gt;":
              return ">";
            case "&apos;":
              return "'";
            case "&quot;":
              return '"';
            default:
              if (m.startsWith("&#x")) {
                return String.fromCodePoint(parseInt(m.slice(3, -1), 16));
              }
              return String.fromCodePoint(parseInt(m.slice(2, -1), 10));
          }
        });

      try {
        const edits: vscode.TextEdit[] = [];
        // clang-format output format: <replacement offset='N' length='N'>text</replacement>
        const pattern =
          /<replacement\s+offset=['"](\d+)['"]\s+length=['"](\d+)['"]>([\s\S]*?)<\/replacement>/g;
        let match: RegExpExecArray | null;
        while ((match = pattern.exec(xml)) !== null) {
          const editInfo = byteToOffset({
            offset: parseInt(match[1], 10),
            length: parseInt(match[2], 10),
            text: decodeEntities(match[3]),
          });
          const start = document.positionAt(editInfo.offset);
          const end = document.positionAt(editInfo.offset + editInfo.length);
          edits.push(
            new vscode.TextEdit(new vscode.Range(start, end), editInfo.text),
          );
        }
        resolve(edits);
      } catch (error: unknown) {
        const errorMessage =
          error instanceof Error ? error.message : "unknown error";
        outputChannel.appendLine(`XML parsing error: ${errorMessage}`);
        reject(error instanceof Error ? error : new Error(errorMessage));
      }
    });
  }

  /// Get execute name in clang-format.executable, if not found, use default value
  /// If configure has changed, it will get the new value
  public getExecutablePath(document?: vscode.TextDocument) {
    const platform = getPlatformString();
    const config = vscode.workspace.getConfiguration(
      "clang-format",
      document?.uri,
    );

    const platformExecPath = config.get<string>("executable." + platform);
    const defaultExecPath = config.get<string>("executable");
    const execPath = platformExecPath ?? defaultExecPath;

    if (!execPath) {
      return this.defaultConfigure.executable;
    }

    const workspaceFolder = this.getWorkspaceFolder(document) ?? "";

    // Resolve ${toolchainPointerFile} if used
    let toolchainPrefix = "";
    if (execPath.includes("${toolchainPointerFile}")) {
      const pointerFile = config
        .get<string>("toolchainPointerFile", "")
        ?.replace(/\${workspaceRoot}/g, workspaceFolder)
        .replace(/\${workspaceFolder}/g, workspaceFolder)
        .trim();

      if (!pointerFile) {
        const msg =
          "${toolchainPointerFile} is used in clang-format.executable but clang-format.toolchainPointerFile is not set.";
        outputChannel.appendLine(`Error: ${msg}`);
        vscode.window.showErrorMessage(msg);
      } else {
        try {
          toolchainPrefix = readFileSync(pointerFile, "utf8").trim();
        } catch (err) {
          const msg = `Cannot read toolchain pointer file "${pointerFile}": ${err instanceof Error ? err.message : String(err)}`;
          outputChannel.appendLine(`Error: ${msg}`);
          vscode.window.showErrorMessage(msg);
        }
      }
    }

    // replace placeholders, if present
    return execPath
      .replace(/\${toolchainPointerFile}/g, toolchainPrefix)
      .replace(/\${workspaceRoot}/g, workspaceFolder)
      .replace(/\${workspaceFolder}/g, workspaceFolder)
      .replace(/\${cwd}/g, process.cwd())
      .replace(/\${env\.([^}]+)}/g, (sub: string, envName: string) => {
        if (!/^[a-z_]\w*$/i.test(envName)) {
          outputChannel.appendLine(
            `Warning: Invalid environment variable name: ${envName}`,
          );
          return "";
        }
        return process.env[envName] ?? "";
      });
  }

  private getLanguage(document: vscode.TextDocument): string {
    const langId = document.languageId;
    return (ALIAS as Record<string, string>)[langId] || langId;
  }

  private getStyle(document: vscode.TextDocument) {
    const language = this.getLanguage(document);
    const config = vscode.workspace.getConfiguration(
      "clang-format",
      document.uri,
    );

    // Get language-specific style with document URI
    const languageStyleKey = `language.${language}.style`;

    let ret = config.get<string>(languageStyleKey) ?? "";

    ret = ret
      .replace(/\${workspaceRoot}/g, this.getWorkspaceFolder(document) ?? "")
      .replace(/\${workspaceFolder}/g, this.getWorkspaceFolder(document) ?? "")
      .replace(/\${cwd}/g, process.cwd())
      .replace(/\${env\.([^}]+)}/g, (sub: string, envName: string) => {
        if (!/^[a-z_]\w*$/i.test(envName)) {
          outputChannel.appendLine(
            `Warning: Invalid environment variable name: ${envName}`,
          );
          return "";
        }
        return process.env[envName] ?? "";
      });

    if (ret.trim()) {
      return ret;
    }

    // Fallback to global style
    ret = config.get<string>("style") ?? "";
    ret = ret
      .replace(/\${workspaceRoot}/g, this.getWorkspaceFolder(document) ?? "")
      .replace(/\${workspaceFolder}/g, this.getWorkspaceFolder(document) ?? "")
      .replace(/\${cwd}/g, process.cwd())
      .replace(/\${env\.([^}]+)}/g, (sub: string, envName: string) => {
        if (!/^[a-z_]\w*$/i.test(envName)) {
          outputChannel.appendLine(
            `Warning: Invalid environment variable name: ${envName}`,
          );
          return "";
        }
        return process.env[envName] ?? "";
      });

    const finalStyle = ret.trim() ? ret : this.defaultConfigure.style;
    return finalStyle;
  }

  private getFallbackStyle(document: vscode.TextDocument) {
    // Get language-specific fallback style with document URI
    const config = vscode.workspace.getConfiguration(
      "clang-format",
      document.uri,
    );
    let strConf = config.get<string>(
      `language.${this.getLanguage(document)}.fallbackStyle`,
    );
    if (strConf?.trim()) {
      return strConf;
    }

    // Try global fallback style
    strConf = config.get<string>("fallbackStyle");
    if (strConf?.trim()) {
      return strConf;
    }

    // If no fallback style is configured, use default
    return this.defaultConfigure.fallbackStyle;
  }

  private getAssumedFilename(document: vscode.TextDocument) {
    const config = vscode.workspace.getConfiguration(
      "clang-format",
      document.uri,
    );
    const assumedFilename = config.get<string>("assumeFilename") ?? "";
    if (assumedFilename === "") {
      return document.fileName;
    }
    const parsedPath = path.parse(document.fileName);
    const fileNoExtension = path.join(parsedPath.dir, parsedPath.name);
    return assumedFilename
      .replace(/\${file}/g, document.fileName)
      .replace(/\${fileNoExtension}/g, fileNoExtension)
      .replace(/\${fileBasename}/g, parsedPath.base)
      .replace(/\${fileBasenameNoExtension}/g, parsedPath.name)
      .replace(/\${fileExtname}/g, parsedPath.ext);
  }

  private getWorkspaceFolder(
    document?: vscode.TextDocument,
  ): string | undefined {
    if (document) {
      const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
      if (workspaceFolder) {
        return workspaceFolder.uri.fsPath;
      }
    }

    // Fallback to first workspace folder if no document is provided
    if (
      vscode.workspace.workspaceFolders &&
      vscode.workspace.workspaceFolders.length > 0
    ) {
      return vscode.workspace.workspaceFolders[0].uri.fsPath;
    }

    return undefined;
  }

  private getFormatArgs(
    document: vscode.TextDocument,
    range: vscode.Range | undefined,
  ): string[] {
    // Validate and sanitize style parameters
    let style = this.getStyle(document);
    let fallbackStyle = this.getFallbackStyle(document);
    const assumedFilename = this.getAssumedFilename(document);

    // Validate style parameter - only allow known values or file paths
    const validStyles = [
      "llvm",
      "google",
      "chromium",
      "mozilla",
      "webkit",
      "microsoft",
      "gnu",
      "file",
    ];
    const normalizedStyle = style.toLowerCase();
    if (
      !validStyles.includes(normalizedStyle) &&
      !normalizedStyle.startsWith("file:") &&
      !normalizedStyle.startsWith("{") &&
      !normalizedStyle.endsWith("}")
    ) {
      outputChannel.appendLine(
        `Warning: Invalid style value "${style}", falling back to "file"`,
      );
      style = "file";
    }

    // Validate fallback style - only allow known values
    const validFallbackStyles = ["none", ...validStyles];
    if (!validFallbackStyles.includes(fallbackStyle.toLowerCase())) {
      outputChannel.appendLine(
        `Warning: Invalid fallback style "${fallbackStyle}", falling back to "none"`,
      );
      fallbackStyle = "none";
    }

    const baseArgs = [
      "-output-replacements-xml",
      `-style=${style}`,
      `-fallback-style=${fallbackStyle}`,
      `-assume-filename=${assumedFilename}`,
    ];

    if (!range) {
      return baseArgs;
    }

    const fullRange = new vscode.Range(
      document.positionAt(0),
      document.positionAt(document.getText().length),
    );

    if (range.isEqual(fullRange)) {
      return baseArgs;
    }

    const offset = document.offsetAt(range.start);
    const length = document.offsetAt(range.end) - offset;

    // fix character length to byte length
    const byteLength = Buffer.byteLength(
      document.getText().substring(offset, offset + length),
      "utf8",
    );
    // fix character offset to byte offset
    const byteOffset = Buffer.byteLength(
      document.getText().substring(0, offset),
      "utf8",
    );

    return [
      ...baseArgs,
      `-offset=${String(byteOffset)}`,
      `-length=${String(byteLength)}`,
    ];
  }

  private doFormatDocument(
    document: vscode.TextDocument,
    range: vscode.Range,
    options: vscode.FormattingOptions | null,
    token: vscode.CancellationToken,
  ): Promise<vscode.TextEdit[]> {
    return new Promise<vscode.TextEdit[]>((resolve, reject) => {
      let formatCommandBinPath: string | undefined;
      let child: cp.ChildProcess | undefined;
      const timeoutId = setTimeout(() => {
        cleanup();
        const timeoutError = new Error(
          "Format operation timed out after 10 seconds",
        );
        outputChannel.appendLine(
          `Formatting timed out after 10s for file: ${document.fileName}`,
        );
        reject(timeoutError);
      }, 10000);

      const cleanup = () => {
        if (timeoutId) {
          clearTimeout(timeoutId);
        }
        if (child) {
          child.kill();
        }
      };

      try {
        formatCommandBinPath = getBinPath(this.getExecutablePath(document));
        const codeContent = document.getText();
        const formatArgs = this.getFormatArgs(document, range);
        if (!formatArgs) {
          cleanup();
          throw new Error("Failed to get format arguments");
        }

        let workingPath = this.getWorkspaceFolder(document);
        if (!document.isUntitled && workingPath) {
          workingPath = path.dirname(document.fileName);
        }

        // On Windows, we need shell:true due to Node.js security changes
        // On other platforms, we keep shell:false for better security
        const useShell = process.platform === "win32";

        // Start the formatting process
        child = cp.spawn(formatCommandBinPath, formatArgs, {
          cwd: workingPath,
          windowsHide: true,
          shell: useShell,
          stdio: ["pipe", "pipe", "pipe"],
        });

        let stdout = "";
        let stderr = "";

        child.stdout?.on("data", (data: Buffer) => {
          stdout += data.toString();
        });

        child.stderr?.on("data", (data: Buffer) => {
          stderr += data.toString();
        });

        child.on("error", (err: Error) => {
          cleanup();
          outputChannel.appendLine(
            `Error spawning clang-format: ${err.message}`,
          );
          reject(err);
        });

        child.on("exit", (code: number | null) => {
          cleanup();

          if (code !== 0) {
            outputChannel.appendLine(
              `clang-format exited with code ${String(code)}`,
            );
            outputChannel.appendLine(`stderr: ${stderr}`);
            reject(
              new Error(
                `clang-format exited with code ${String(code)}: ${stderr}`,
              ),
            );
            return;
          }

          if (!stdout) {
            outputChannel.appendLine(
              `[${timestamp()}] Formatting ${document.fileName}: no changes`,
            );
            resolve([]);
            return;
          }

          this.getEdits(document, stdout, codeContent)
            .then((edits) => {
              outputChannel.appendLine(
                `[${timestamp()}] Formatting ${document.fileName}: success (${edits.length} edit(s))`,
              );
              const verbose = vscode.workspace
                .getConfiguration("clang-format", document.uri)
                .get<boolean>("verboseLog", false);
              if (verbose) {
                const MAX_DIFF_LINES = 20;
                edits.forEach((edit, i) => {
                  const { start, end } = edit.range;
                  const loc = `${start.line + 1}:${start.character + 1}–${end.line + 1}:${end.character + 1}`;

                  // Collect old lines (full lines spanning the replaced range)
                  const oldLines: string[] = [];
                  for (let ln = start.line; ln <= end.line; ln++) {
                    oldLines.push(document.lineAt(ln).text);
                  }

                  // Reconstruct new lines by splicing newText into the line context
                  const prefix = document.lineAt(start.line).text.slice(
                    0,
                    start.character,
                  );
                  const suffix = document.lineAt(end.line).text.slice(
                    end.character,
                  );
                  const newLines = (prefix + edit.newText + suffix).split("\n");

                  const total = oldLines.length + newLines.length;
                  const truncated = total > MAX_DIFF_LINES;
                  const half = Math.floor(MAX_DIFF_LINES / 2);
                  const oldSlice = truncated ? oldLines.slice(0, half) : oldLines;
                  const newSlice = truncated ? newLines.slice(0, half) : newLines;

                  const diffLines = [
                    ...oldSlice.map((l) => `- ${l}`),
                    ...newSlice.map((l) => `+ ${l}`),
                  ];
                  if (truncated) {
                    diffLines.push(
                      `  … (${oldLines.length} → ${newLines.length} lines)`,
                    );
                  }

                  outputChannel.appendLine(
                    `  edit ${i + 1} (${loc}):\n${diffLines.join("\n")}`,
                  );
                });
              }
              resolve(edits);
            })
            .catch((error: Error) => {
              outputChannel.appendLine(`Error getting edits: ${error.message}`);
              reject(error);
            });
        });

        // Write the code content to stdin
        if (child.stdin) {
          child.stdin.write(codeContent);
          child.stdin.end();
        }

        // Handle cancellation
        token.onCancellationRequested(() => {
          cleanup();
          outputChannel.appendLine(
            `Formatting cancelled for file: ${document.fileName}`,
          );
          reject(new Error("Format cancelled"));
        });
      } catch (err: unknown) {
        cleanup();
        const errorMessage =
          err instanceof Error ? err.message : "unknown error";
        outputChannel.appendLine(`Error during formatting: ${errorMessage}`);
        if (
          err instanceof Error &&
          err.message.startsWith("clang-format binary not found:")
        ) {
          const execPath = this.getExecutablePath(document);
          const isDefault = execPath === "clang-format";
          const notice = isDefault
            ? `clang-format not found in PATH. Install clang-format or configure the "clang-format.executable" setting.`
            : `clang-format executable not found: "${execPath}". Check the "clang-format.executable" setting.`;
          vscode.window.showErrorMessage(notice);
        }
        reject(
          new Error(`Error during formatting: ${errorMessage}`, { cause: err }),
        );
      }
    });
  }

  public formatDocument(
    document: vscode.TextDocument,
  ): Promise<vscode.TextEdit[]> {
    const fullRange = new vscode.Range(
      document.positionAt(0),
      document.positionAt(document.getText().length),
    );
    const token = new vscode.CancellationTokenSource().token;
    return this.doFormatDocument(document, fullRange, null, token);
  }
}

export function activate(ctx: vscode.ExtensionContext): void {
  // Initialize diagnostic collection
  diagnosticCollection =
    vscode.languages.createDiagnosticCollection("clang-format");
  ctx.subscriptions.push(diagnosticCollection);
  ctx.subscriptions.push(outputChannel);

  const formatter = new ClangDocumentFormattingEditProvider();

  // Log clang-format version on startup
  try {
    const binPath = getBinPath(formatter.getExecutablePath());
    const result = cp.spawnSync(binPath, ["--version"], { encoding: "utf8" });
    if (result.stdout) {
      outputChannel.appendLine(`[${timestamp()}] ${result.stdout.trim()}`);
    }
  } catch {
    const searchPath = (process.env.PATH ?? "")
      .split(path.delimiter)
      .join(", ");
    outputChannel.appendLine(
      `[${timestamp()}] clang-format not found (searched: ${searchPath})`,
    );
  }

  const availableLanguages = new Set<string>();

  for (const mode of MODES) {
    if (typeof mode.language === "string") {
      ctx.subscriptions.push(
        vscode.languages.registerDocumentRangeFormattingEditProvider(
          mode,
          formatter,
        ),
        vscode.languages.registerDocumentFormattingEditProvider(
          mode,
          formatter,
        ),
      );
      availableLanguages.add(mode.language);
    }
  }
}

export function deactivate(): void {
  if (diagnosticCollection) {
    diagnosticCollection.dispose();
  }
  if (outputChannel) {
    outputChannel.dispose();
  }
}
