# Encoding Rules

**Fix garbled text in VS Code: set encoding rules once per folder or path pattern**

Seeing `�` or `Ã©` in your files? VS Code can't always detect legacy encodings (Windows-1252, Windows-1257, Shift-JIS, GBK…), so text ends up garbled.

Encoding Rules lets you assign an encoding to a file, folder or glob pattern. Set it once, and the file opens correctly every time, with no more **File → Reopen with Encoding**.

Ideal for legacy codebases, imported files, and repositories that mix UTF-8 with older encodings.

<p align="center">
  <img src="./assets/demo.gif" width="700" alt="Encoding Rules Demo">
</p>

## Quick Start

1. Open a file that shows garbled text.
2. Open the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`) and run **Encoding Rules: Create Rule for Current Folder** (or **...for Current File**).
3. Pick the encoding. From now on, matching files open with it.

## Why not just use VS Code's auto-detection?

VS Code can guess encodings (`files.autoGuessEncoding`), but it's a statistical guess: it can pick the wrong encoding, and the list of encodings you can prioritize with `files.candidateGuessEncodings` doesn't include every encoding.

Encoding Rules takes a different approach: **you decide once, and it's applied every time**, for any encoding VS Code can open.

## Features

- Applies your chosen encoding automatically whenever a matching file is opened.
- Matches by file path using glob patterns: a single file, a folder, or a whole tree.
- Keeps a legacy folder in, say, Windows-1257 while the rest of your repo stays UTF-8.
- Resolves overlapping rules predictably: the most specific rule wins.
- Stores rules in regular VS Code settings, so they can live in your user settings or be committed with a project in `.vscode/settings.json`.

## Commands

Encoding Rules provides the following commands through the VS Code Command Palette.

| Command | Description |
|---|---|
| **Encoding Rules: Create Rule for Current File** | Creates an encoding rule for the currently active file. Choose an encoding from the list or enter a custom encoding. If a matching rule already exists, you can replace it. |
| **Encoding Rules: Create Rule for Current Folder** | Creates an encoding rule for the folder containing the currently active file. The rule applies to files matching that folder path. |
| **Encoding Rules: Show Matching Rule** | Shows the encoding rule currently matching the active file, including the encoding and matching path pattern. |

Open the **Command Palette** with `Ctrl+Shift+P` (`Cmd+Shift+P` on macOS) and search for **Encoding Rules**.

## Configuration

Add encoding rules in your VS Code settings:

```json
{
  "encodingRules.rules": {
    "windows1257": [
      "**/legacy/**"
    ],
    "shiftjis": [
      "**/jp-import/**"
    ]
  }
}
```

The setting is an object where:

| Part | Description |
| --- | --- |
| **Key** | The encoding to use when opening matching files (e.g. `windows1257`, `utf8`, `shiftjis`) |
| **Value** | An array of glob patterns. Files whose path matches any of them are opened with that encoding |

In the example above, files in `legacy` open as Windows-1257, and files in `jp-import` open as Shift-JIS.

### Rule priority

If more than one rule matches a file, the **most specific rule wins**: the matching pattern with the most characters takes priority, regardless of the order in your settings.

For example, if you also had a rule for `**/*.txt`, the file `legacy/notes.txt` would still open as Windows-1257, because `**/legacy/**` is the longer pattern. To make a rule win over another, make its pattern more specific.

Pattern matching is case-insensitive, and Windows-style backslashes in paths are handled automatically. Not sure which rule applies to a file? Run **Encoding Rules: Show Matching Rule**.

## Supported Encodings

Supported encodings depend on VS Code's built-in encoding support. Use VS Code's encoding IDs (for example `windows1252`, not `windows-1252`). The **Create Rule** commands let you pick from a list, so you don't have to memorize them.

Common examples:

| Encoding ID | Typically used for |
|---|---|
| `utf8`, `utf8bom` | Unicode text (with or without BOM) |
| `windows1252` | Western European languages |
| `windows1250` | Central European languages |
| `windows1251` | Cyrillic (Russian, Ukrainian, Bulgarian…) |
| `windows1257` | Baltic languages (Latvian, Lithuanian, Estonian) |
| `shiftjis` | Japanese |
| `gbk`, `gb18030` | Simplified Chinese |
| `cp950`, `big5hkscs` | Traditional Chinese |
| `euckr` | Korean |

## Glob Patterns

Rules use glob patterns to match files.

| Pattern | Matches |
|---|---|
| `**/*.txt` | All `.txt` files |
| `**/legacy/**` | All files inside folders named `legacy` |
| `src/**/*.c` | C files inside `src` and its subfolders |

## Known Limitations

- Encoding detection is not performed. Rules are based on file paths.
- Incorrect rules may cause files to be opened with the wrong encoding.
- Some VS Code internal documents may not have normal file paths.
- The extension does not modify file contents; it only controls how files are opened.

## Support

If Encoding Rules saves you time, consider supporting development:

<a href="https://www.buymeacoffee.com/productivityplusplus">
  <img src="https://cdn.buymeacoffee.com/buttons/v2/default-yellow.png"
       alt="Buy Me a Coffee"
       width="109"
       height="30">
</a>

<a href="https://github.com/sponsors/ProductivityPlusPlus">
  <img src="https://img.shields.io/badge/Sponsor-GitHub%20Sponsors-ea4aaa?logo=github" alt="GitHub Sponsors">
</a>

## License

MIT License
