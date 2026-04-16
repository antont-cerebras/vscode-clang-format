- project formatting
  - whole project
  - only changed files
- .clang-format-ignore: https://clang.llvm.org/docs/ClangFormat.html#clang-format-ignore
- format unsaved buffer (? --assume-filename=<string>)
- .clang-format creation with style picker
      clang-format -style=llvm -dump-config > .clang-format
   Possible values:

        LLVM A style complying with the LLVM coding standards

        Google A style complying with Google’s C++ style guide

        Chromium A style complying with Chromium’s style guide

        Mozilla A style complying with Mozilla’s style guide

        WebKit A style complying with WebKit’s style guide

        Microsoft A style complying with Microsoft’s style guide

        GNU A style complying with the GNU coding standards

        InheritParentConfig Not a real style, but allows to use the .clang-format file from the parent directory (or its parent if there is none). If there is no parent file found it falls back to the fallback style, and applies the changes to that. With this option you can overwrite some parts of your main style for your subdirectories. This is also possible through the command line, e.g.: --style={BasedOnStyle: InheritParentConfig, ColumnLimit: 20}

        InheritParentConfig=<directory-path> Same as the above except that the inheritance is redirected to <directory-path>. This is only supported in configuration files.

- --dump-config
- --fail-on-incomplete-format
- --sort-includes                - If set, overrides the include sorting behavior
                                   determined by the SortIncludes style flag

