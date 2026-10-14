# Change Log

## 0.2.3

- Added `encodingRules.maxFileSize` setting (default 50 MB). Files larger than this are skipped instead of being reopened.
- Added a warning when a file matching a rule is skipped for being too large, with a **Don't Show Again** button.
- Added `encodingRules.showLargeFileWarning` setting to turn that warning on or off.

## 0.2.2

- Added support for untrusted workspaces.

## 0.2.0

- Added commands to create encoding rules for the current file or folder.
- Added **Show Matching Rule** to see which rule applies to the current file.
- Improved encoding picker with filtering and custom encoding support.
- Added rule replacement and precedence handling for overlapping rules.
- Improved automatic rule updates when Settings change.
- Improved file reopening, startup behavior, focus preservation, and error handling.

**Requirements:** VS Code 1.100 or newer.

## 0.1.1

- Added support for older VS Code versions (1.90+).
- No configuration changes required.

## 0.1.0

- Initial release.