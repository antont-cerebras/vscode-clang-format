import * as vscode from "vscode";
import * as cp from "child_process";
import * as path from "path";
import { MODES } from "./clangMode";
import { ALIAS } from "./shared/languageConfig";
import { statSync, readFileSync, writeFileSync, mkdtempSync } from "fs";
import * as os from "os";

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

function findClangFormatConfig(startDir: string): string | null {
  let dir = startDir;
  while (true) {
    for (const name of [".clang-format", "_clang-format"]) {
      try {
        const candidate = path.join(dir, name);
        if (statSync(candidate).isFile()) {
          return candidate;
        }
      } catch {
        // file not found in this directory, continue walking up
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      return null;
    }
    dir = parent;
  }
}

// Cache binary paths for performance
const binPathCache: Record<string, string | undefined> = {};
export const outputChannel = vscode.window.createOutputChannel(
  "Clang-Format",
  "diff",
);
let diagnosticCollection: vscode.DiagnosticCollection;

function substituteVariables(
  str: string,
  workspaceFolder: string,
  executablePath?: string,
  filePath?: string,
): string {
  const filePathResolved = filePath ?? "";
  return str
    .replace(/\${clang-format\.executable}/g, executablePath ?? "")
    .replace(/\${workspaceRoot}/g, workspaceFolder)
    .replace(/\${workspaceFolder}/g, workspaceFolder)
    .replace(/\${cwd}/g, process.cwd())
    .replace(/\${file}/g, filePathResolved)
    .replace(/\${env\.([^}]+)}/g, (_sub: string, envName: string) => {
      if (!/^[a-z_]\w*$/i.test(envName)) {
        outputChannel.appendLine(
          `Warning: Invalid environment variable name: ${envName}`,
        );
        return "";
      }
      return process.env[envName] ?? "";
    });
}

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
      const pointerFile = substituteVariables(
        config.get<string>("toolchainPointerFile", "") ?? "",
        workspaceFolder,
        undefined,
        document?.fileName,
      ).trim();

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
    return substituteVariables(
      execPath.replace(/\${toolchainPointerFile}/g, toolchainPrefix),
      workspaceFolder,
      undefined,
      document?.fileName,
    );
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

    const workspaceFolder = this.getWorkspaceFolder(document) ?? "";
    const filePath = document.fileName;

    let ret = substituteVariables(
      config.get<string>(languageStyleKey) ?? "",
      workspaceFolder,
      undefined,
      filePath,
    );

    if (ret.trim()) {
      return ret;
    }

    // Fallback to global style
    ret = substituteVariables(
      config.get<string>("style") ?? "",
      workspaceFolder,
      undefined,
      filePath,
    );

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

  public getFormatArgs(
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
      "inheritparentconfig",
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
        const formatArgs = [
          "-output-replacements-xml",
          ...this.getFormatArgs(document, range),
        ];
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

          const docDir = path.dirname(document.fileName);
          const configFile = findClangFormatConfig(docDir);
          const configSuffix = configFile
            ? ` [${configFile}]`
            : " [no .clang-format found, using fallback style]";

          if (!stdout) {
            outputChannel.appendLine(
              `[${timestamp()}] Formatting ${document.fileName}: no changes${configSuffix}`,
            );
            resolve([]);
            return;
          }

          this.getEdits(document, stdout, codeContent)
            .then((edits) => {
              outputChannel.appendLine(
                `[${timestamp()}] Formatting ${document.fileName}: success (${edits.length} edit(s))${configSuffix}`,
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
                  const prefix = document
                    .lineAt(start.line)
                    .text.slice(0, start.character);
                  const suffix = document
                    .lineAt(end.line)
                    .text.slice(end.character);
                  const newLines = (prefix + edit.newText + suffix).split("\n");

                  const total = oldLines.length + newLines.length;
                  const truncated = total > MAX_DIFF_LINES;
                  const half = Math.floor(MAX_DIFF_LINES / 2);
                  const oldSlice = truncated
                    ? oldLines.slice(0, half)
                    : oldLines;
                  const newSlice = truncated
                    ? newLines.slice(0, half)
                    : newLines;

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

  // Associate .clang-format files with YAML language
  const setClangFormatLanguage = (doc: vscode.TextDocument) => {
    const basename = path.basename(doc.fileName);
    if (
      (basename === ".clang-format" || basename === "_clang-format") &&
      doc.languageId !== "yaml"
    ) {
      vscode.languages.setTextDocumentLanguage(doc, "yaml");
    }
  };
  vscode.workspace.textDocuments.forEach(setClangFormatLanguage);
  ctx.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument(setClangFormatLanguage),
  );

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

  function runShellCommand(name: string, command: string): void {
    const workspaceFolder =
      vscode.workspace.workspaceFolders?.[0].uri.fsPath ?? process.cwd();

    let executablePath = "";
    try {
      executablePath = getBinPath(formatter.getExecutablePath());
    } catch {
      // not found — leave empty, let the shell error naturally
    }

    const filePath = vscode.window.activeTextEditor?.document.fileName ?? "";

    const resolvedCommand = substituteVariables(
      command,
      workspaceFolder,
      executablePath,
      filePath,
    );

    ctx.globalState.update("lastCommand", { name, command });

    outputChannel.show(true);
    outputChannel.appendLine(`[${timestamp()}] Running: ${resolvedCommand}`);

    const proc = cp.spawn(resolvedCommand, [], {
      shell: true,
      cwd: workspaceFolder,
    });
    proc.stdout.on("data", (data: Buffer) =>
      outputChannel.append(data.toString()),
    );
    proc.stderr.on("data", (data: Buffer) =>
      outputChannel.append(data.toString()),
    );
    proc.on("exit", (code) => {
      outputChannel.appendLine(
        `[${timestamp()}] Finished with exit code ${code ?? "unknown"}`,
      );
      if (code !== 0) {
        vscode.window
          .showErrorMessage(
            `Clang-Format: "${name}" failed with exit code ${code ?? "unknown"}. See Output panel for details.`,
            "Show Output",
          )
          .then((action) => {
            if (action === "Show Output") {
              outputChannel.show(true);
            }
          });
      }
    });
  }

  for (const [id, settingKey, label] of [
    ["clang-format.formatProject", "formatProjectCommand", "Format Project"],
    [
      "clang-format.formatChanged",
      "formatChangedCommand",
      "Format Changed Files",
    ],
  ] as const) {
    ctx.subscriptions.push(
      vscode.commands.registerCommand(id, async () => {
        const config = vscode.workspace.getConfiguration("clang-format");
        const cmd = config.get<string>(settingKey, "").trim();
        if (!cmd) {
          const action = await vscode.window.showInformationMessage(
            `Set clang-format.${settingKey} in settings to use this command.`,
            "Open Settings",
          );
          if (action === "Open Settings") {
            vscode.commands.executeCommand(
              "workbench.action.openSettings",
              `clang-format.${settingKey}`,
            );
          }
          return;
        }
        runShellCommand(label, cmd);
      }),
    );
  }

  ctx.subscriptions.push(
    vscode.commands.registerCommand("clang-format.runCommand", async () => {
      const config = vscode.workspace.getConfiguration("clang-format");
      const commands = config.get<{ name: string; command: string }[]>(
        "commands",
        [],
      );
      if (commands.length === 0) {
        const action = await vscode.window.showInformationMessage(
          "No commands defined. Add entries to clang-format.commands in settings.",
          "Open Settings",
        );
        if (action === "Open Settings") {
          vscode.commands.executeCommand(
            "workbench.action.openSettings",
            "clang-format.commands",
          );
        }
        return;
      }
      const picked = await vscode.window.showQuickPick(
        commands.map((c) => ({ label: c.name, command: c.command })),
        { placeHolder: "Select a command to run" },
      );
      if (picked) {
        runShellCommand(picked.label, picked.command);
      }
    }),
  );

  ctx.subscriptions.push(
    vscode.commands.registerCommand("clang-format.runLastCommand", () => {
      const last = ctx.globalState.get<{ name: string; command: string }>(
        "lastCommand",
      );
      if (!last) {
        vscode.window.showInformationMessage("No command has been run yet.");
        return;
      }
      runShellCommand(last.name, last.command);
    }),
  );

  ctx.subscriptions.push(
    vscode.commands.registerCommand("clang-format.openConfig", async () => {
      const doc = vscode.window.activeTextEditor?.document;
      if (!doc) {
        vscode.window.showInformationMessage("No active editor.");
        return;
      }
      const startDir = path.dirname(doc.fileName);
      const configPath = findClangFormatConfig(startDir);
      if (!configPath) {
        vscode.window.showInformationMessage(
          `No .clang-format file found (searched from: ${startDir})`,
        );
        return;
      }
      const configDoc = await vscode.workspace.openTextDocument(configPath);
      await vscode.window.showTextDocument(configDoc);
    }),
  );

  ctx.subscriptions.push(
    vscode.commands.registerCommand("clang-format.createConfig", async () => {
      const styles = [
        { label: "LLVM", description: "LLVM coding standards" },
        { label: "Google", description: "Google's C++ style guide" },
        { label: "Chromium", description: "Chromium's style guide" },
        { label: "Mozilla", description: "Mozilla's style guide" },
        { label: "WebKit", description: "WebKit's style guide" },
        { label: "Microsoft", description: "Microsoft's style guide" },
        { label: "GNU", description: "GNU coding standards" },
        {
          label: "InheritParentConfig",
          description: "Inherit from .clang-format in parent directory",
        },
      ];

      const picked = await vscode.window.showQuickPick(styles, {
        placeHolder: "Select a base style for .clang-format",
      });
      if (!picked) {
        return;
      }

      let binPath: string;
      try {
        binPath = getBinPath(formatter.getExecutablePath());
      } catch {
        vscode.window.showErrorMessage(
          "clang-format binary not found. Check the clang-format.executable setting.",
        );
        return;
      }

      const result = cp.spawnSync(
        binPath,
        [`-style=${picked.label.toLowerCase()}`, "-dump-config"],
        { encoding: "utf8", timeout: 10000 },
      );

      if (result.status !== 0) {
        vscode.window.showErrorMessage(
          `clang-format failed: ${result.stderr || "unknown error"}`,
        );
        return;
      }

      const dir = vscode.window.activeTextEditor
        ? path.dirname(vscode.window.activeTextEditor.document.fileName)
        : vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      const defaultUri = vscode.Uri.file(
        dir ? path.join(dir, ".clang-format") : ".clang-format",
      );
      const saveUri = await vscode.window.showSaveDialog({ defaultUri });
      if (!saveUri) {
        return;
      }

      await vscode.workspace.fs.writeFile(saveUri, Buffer.from(result.stdout));
      const doc = await vscode.workspace.openTextDocument(saveUri);
      await vscode.window.showTextDocument(doc);
    }),
  );

  ctx.subscriptions.push(
    vscode.commands.registerCommand("clang-format.previewFormat", async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showInformationMessage("No active editor.");
        return;
      }
      const document = editor.document;

      let binPath: string;
      try {
        binPath = getBinPath(formatter.getExecutablePath(document));
      } catch {
        vscode.window.showErrorMessage(
          "clang-format binary not found. Check the clang-format.executable setting.",
        );
        return;
      }

      const formatArgs = formatter.getFormatArgs(document, undefined);
      const workingDir = document.isUntitled
        ? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
        : path.dirname(document.fileName);

      const result = cp.spawnSync(binPath, formatArgs, {
        input: document.getText(),
        encoding: "utf8",
        timeout: 10000,
        cwd: workingDir,
      });

      if (result.status !== 0) {
        vscode.window.showErrorMessage(
          `clang-format failed: ${result.stderr || "unknown error"}`,
        );
        return;
      }

      const tmpDir = mkdtempSync(path.join(os.tmpdir(), "clang-format-"));
      const tmpFile = path.join(tmpDir, path.basename(document.fileName));
      writeFileSync(tmpFile, result.stdout);
      const tmpUri = vscode.Uri.file(tmpFile);

      const title = `${path.basename(document.fileName)} (formatted)`;
      await vscode.commands.executeCommand(
        "vscode.diff",
        document.uri,
        tmpUri,
        title,
      );
    }),
  );

  ctx.subscriptions.push(
    vscode.commands.registerCommand(
      "clang-format.ignoreSelection",
      async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
          vscode.window.showInformationMessage("No active editor.");
          return;
        }
        const selection = editor.selection;
        if (selection.isEmpty) {
          vscode.window.showInformationMessage("Select code to ignore.");
          return;
        }

        const startLine = selection.start.line;
        const endLine = selection.end.line;
        const indent =
          /^\s*/.exec(editor.document.lineAt(startLine).text)?.[0] ?? "";
        const style = vscode.workspace
          .getConfiguration("clang-format", editor.document.uri)
          .get<string>("ignoreFormattingCommentStyle", "line");
        const [off, on] =
          style === "block"
            ? ["/* clang-format off */", "/* clang-format on */"]
            : ["// clang-format off", "// clang-format on"];

        await editor.edit((b) => {
          b.insert(new vscode.Position(endLine + 1, 0), `${indent}${on}\n`);
          b.insert(new vscode.Position(startLine, 0), `${indent}${off}\n`);
        });
      },
    ),
  );

  ctx.subscriptions.push(
    vscode.commands.registerCommand(
      "clang-format.removeIgnore",
      async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
          vscode.window.showInformationMessage("No active editor.");
          return;
        }

        const doc = editor.document;
        const cursorLine = editor.selection.active.line;
        const offPattern =
          /^\s*(?:\/\/|\/\*)\s*clang-format\s+off\s*(?:\*\/)?\s*$/;
        const onPattern =
          /^\s*(?:\/\/|\/\*)\s*clang-format\s+on\s*(?:\*\/)?\s*$/;

        // Search upward for clang-format off
        let offLine = -1;
        for (let i = cursorLine; i >= 0; i--) {
          if (offPattern.test(doc.lineAt(i).text)) {
            offLine = i;
            break;
          }
          // Hit a clang-format on before finding off — cursor is not in an ignored region
          if (onPattern.test(doc.lineAt(i).text)) {
            break;
          }
        }
        if (offLine === -1) {
          vscode.window.showInformationMessage(
            "Cursor is not inside a clang-format off/on region.",
          );
          return;
        }

        // Search downward for the matching clang-format on
        let onLine = -1;
        for (let i = cursorLine + 1; i < doc.lineCount; i++) {
          if (onPattern.test(doc.lineAt(i).text)) {
            onLine = i;
            break;
          }
          if (offPattern.test(doc.lineAt(i).text)) {
            break;
          }
        }

        await editor.edit((b) => {
          if (onLine !== -1) {
            b.delete(
              new vscode.Range(onLine, 0, onLine + 1, 0),
            );
          }
          b.delete(
            new vscode.Range(offLine, 0, offLine + 1, 0),
          );
        });
      },
    ),
  );

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
