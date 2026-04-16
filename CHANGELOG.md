# Change Log
All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](http://keepachangelog.com/) and this project adheres to [Semantic Versioning](http://semver.org/).

## [2.1.0] - 2026-04-15
### Added
- Command **Clang-Format: Create .clang-format File...** to generate a new `.clang-format` config file from a chosen base style (LLVM, Google, Chromium, Mozilla, WebKit, Microsoft, GNU, InheritParentConfig) via `clang-format -dump-config`
- `${toolchainPointerFile}` placeholder for `clang-format.executable`: reads the file set in `clang-format.toolchainPointerFile` and substitutes its content into the executable path
- Log clang-format version (or "not found" with searched paths) in the Output panel on extension startup
- `clang-format.verboseLog` setting: when enabled, logs each edit as a colored diff (red/green) in the Output panel
- Log which `.clang-format` config file is used on each format operation, or explicitly note when none is found
- Command **Clang-Format: Open .clang-format for Current File** to jump to the config file that applies to the active editor
- `.clang-format` and `_clang-format` files are now associated with the YAML language for proper syntax highlighting
- `clang-format.formatProjectCommand` and `clang-format.formatChangedCommand` settings: shell commands invoked by the new **Clang-Format: Format Project** and **Clang-Format: Format Changed Files** commands. Output is streamed to the Clang-Format Output panel.
- `clang-format.commands` setting: user-defined list of named shell commands, accessible via **Clang-Format: Run Command...** (Quick Pick) and repeatable with **Clang-Format: Repeat Last Command**. Last command is persisted across sessions.
- `${clang-format.executable}` placeholder: resolves to the binary configured in `clang-format.executable`. Supported in command strings and style settings.
- `${file}` placeholder: resolves to the absolute path of the file in the active editor. Supported across all settings that accept paths or commands.

## [2.0.10] - 2026-04-15
### Changed
- Remove all external NPM runtime dependencies (`sax`, `which`) and replace with Node.js built-in equivalents, eliminating supply-chain attack surface
- Transfer to Cerebras; update publisher and repository URL
### Fixed
- Show a visible VS Code error notification when the clang-format binary is not found, instead of logging silently to the Output panel

## [2.0.9] - 2025-12-29
### Fixed
- Refresh depends and devdepends

## [2.0.8] - 2025-10-25
### Fixed
- Refresh depends and devdepends

## [2.0.6] - 2025-08-27
### Fixed
- feat: allow for custom style files (by [JeremyStarTM](https://github.com/JeremyStarTM))
- Refresh depends and devdepends

## [2.0.5] - 2025-08-20
### Fixed
- Make sure to normalize path to clang-format to fix problems with spaces and whatnot. Fixes issue #50.
- Refresh depends and devdepends

## [2.0.4] - 2025-07-21
### Fixed
- Minor modernization (by [nopeless](https://github.com/nopeless))
- Refresh depends and devdepends

## [2.0.3] - 2025-04-21
### Fixed
- Update README
- Refresh dev packages and add some devtools to help future dev

## [2.0.2] - 2025-04-05
### Fixed
- Added robustness to fallback parsing and sending
- Updated devtools for linting
- 2.0.1 is skipped because I am a dummy and didn't bump rev in the project before publishing.

## [2.0.0] - 2025-04-03
### Fixed
- Rebuilt extension with modern best practices
- Add tablegen
- Add Metal
- Support placeholders in style options
- Use shell:true parameter to conform with an upstream security fix

## [1.9.0] - 2019-01-22
### Fixed
- Fixed buffer overflow error while formatting huge files (by [VPeruS](https://github.com/VPeruS))
### Added
- add support for CUDA language (by [xandox](https://github.com/xandox))

## [1.8.0] - 2018-11-29
### Fixed
- Upgrade dependencies due to security vulnerabilities
- Upgrade to TypeScript ^3.1.6

## [1.6.2] - 2018-05-08
### Fixed
- Upgrade dependencies due to security vulnerability in hoek

## [1.6.1] - 2017-11-11
### Fixed
- Correct default keybindins in README.md

## [1.6.0] - 2017-10-06
### Added
- Support for glsl (by [cadenasgmbh](https://github.com/cadenasgmbh/))

## [1.5.0] - 2017-05-25
### Added
- Support for proto3 (by [OWenT](https://github.com/owt5008137))

## [1.4.0] - 2017-04-20
### Added
- Output console shows syntax errors in `.clang-format` files
- Extension works on Apex now

## [1.3.0] - 2017-04-20
### Added
- ```-assume-filename=``` option configurable as ```clang-format.assumeFilename``` in user/workspace settings

## [1.2.1] - 2017-03-04
### Added
- Extension works on Objective-C++ now (by [mjbvz](https://github.com/mjbvz))

## [1.1.1]
### Fixed
- Handling of clang-format binaries on Windows without .exe file-endings (by [Rizadh Nizam](https://github.com/rizadh))

## [1.0.0]
### Added
- ```clang-format.executable``` setting to choose clang-format binary (by [iainmcgin](https://github.com/iainmcgin))

## [0.11.2]
### Changed
- remove changelog from readme
- change Marketplace category to "Formatter"

## [0.11.0]
### Removed
- this extension no longer provides its own formatOnSave feature since Visual Studio Code ^1.6.0 provides this out of the box. In order to still use *format on save* you have to put ```"editor.formatOnSave": true``` in your ```settings.json```

## [0.10.3]
### Fixed
- fix info message for when executable is not found (by [prideout](https://github.com/prideout))

## [0.10.2]
### Added
- Marketplace appearance

## [0.10.1]
### Fixed
- minor fixes

## [0.10.0]
- enabling of individual languages with ```clang-format.language.javascript.enable```, etc.*—requires reloading Visual Studio Code*

## [0.9.0]
- add protobuf support (work with https://marketplace.visualstudio.com/items?itemName=peterj.proto)
- add javascript/typescript support
- allow different style & fallback style option for different languages
- format on save is available now (just like https://github.com/Microsoft/vscode-go/blob/master/src/goMain.ts)

## [0.6.1]
- clean up dependencies #9

## [0.6.0]
- fixed multibyte character handling #7 (by [OWenT](https://github.com/owt5008137))
- fixed "clang-format is ignoring the -style setting because of invalid value" #6 (by [OWenT](https://github.com/owt5008137))
- LLVM style is now the default fallback style (fixes #1)
- changed dependency to VS Code 1.0.0 or higher

## [0.5.0]
- Included [OWenT](https://github.com/owt5008137)'s changes:
  - add setting of clang-format executable
  - add style setting
  - add fallback style setting

## [0.1.2]
- Included [ioachim](https://github.com/ioachim/)'s changes:
  > it doesn't require saving the file, works by doing partial edits (instead of replacing the whole buffer), and enables range formatting.
