import * as vscode from "vscode";

import {
    addRule,
    findMatchingRules,
    MatchingRule
} from "./rules";

/*
 * The file that the user explicitly changed.
 *
 * extension.ts consumes this after the configuration
 * change event arrives.
 */
let requestedFocusUri:
    vscode.Uri | undefined;

export function requestFocusUri(
    uri: vscode.Uri
) {

    requestedFocusUri =
        uri;
}

export function consumeRequestedFocusUri():
    vscode.Uri | undefined {

    const uri =
        requestedFocusUri;

    requestedFocusUri =
        undefined;

    return uri;
}

/*
 * Documents currently being explicitly reopened by this extension.
 *
 * This prevents onDidOpenTextDocument and configuration-change
 * processing from trying to reopen the same document again.
 */
export const reopeningDocuments =
    new Set<string>();

export function registerCommands(
    context: vscode.ExtensionContext
) {

    context.subscriptions.push(

        vscode.commands.registerCommand(
            "encodingRules.createFileRule",
            () => createRule(false)
        ),

        vscode.commands.registerCommand(
            "encodingRules.createFolderRule",
            () => createRule(true)
        ),

        vscode.commands.registerCommand(
            "encodingRules.showMatchingRule",
            showMatchingRule
        )

    );
}

/* -------------------------------------------------------------------------- */
/* Create rule                                                                */
/* -------------------------------------------------------------------------- */

async function createRule(
    folder: boolean
) {

    const editor =
        vscode.window.activeTextEditor;

    if (!editor) {

        vscode.window.showInformationMessage(
            "No file is currently open."
        );

        return;
    }

    const document =
        editor.document;

    if (
        document.uri.scheme !== "file"
    ) {

        vscode.window.showInformationMessage(
            "This command only works with files on disk."
        );

        return;
    }

    const pattern =
        folder
            ? createFolderPattern(
                document.uri.fsPath
            )
            : document.uri.fsPath
                .replace(/\\/g, "/");

    const encoding =
        await chooseEncoding(
            document
        );

    if (!encoding) {
        return;
    }

    const existing =
        findExistingExactRule(
            pattern
        );

    let replaceExisting =
        false;

    if (
        existing &&
        existing.encoding.toLowerCase() !==
            encoding.toLowerCase()
    ) {

        const choice =
            await vscode.window.showWarningMessage(
                `A rule already exists for this pattern using ${existing.encoding}.`,
                "Replace",
                "Cancel"
            );

        if (
            choice !== "Replace"
        ) {

            return;
        }

        replaceExisting =
            true;
    }

    /*
     * Remember which file the user explicitly operated on.
     *
     * This must happen BEFORE the configuration update so that
     * extension.ts knows which file should regain focus.
     */
    requestFocusUri(
        document.uri
    );

    const result =
        await addRule(
            encoding,
            pattern,
            replaceExisting
        );

    if (!result) {

        /*
         * The configuration was not changed.
         * There is therefore no configuration event to handle.
         */
        consumeRequestedFocusUri();

        vscode.window.showInformationMessage(
            "This encoding rule already exists."
        );

        return;
    }

    /*
     * Reopen the explicitly changed file immediately.
     *
     * The configuration-change listener may also run because
     * addRule() changed the settings.
     *
     * That is safe because reopenWithEncoding() registers the
     * URI in reopeningDocuments before doing anything else.
     *
     * Therefore the configuration listener will not reopen this
     * same file concurrently.
     */
    try {

        await reopenWithEncoding(
            document,
            encoding,
            true
        );

    } catch (error) {

        console.error(
            "[Encoding Rules] Runtime reopen failed:",
            error
        );

        vscode.window.showErrorMessage(
            `Could not apply the encoding rule to "${document.fileName}".`
        );

        return;
    }

    const message =
        result.status === "replaced"
            ? `Rule updated: ${result.previousEncoding} → ${encoding}`
            : `Rule added: ${encoding}`;

    vscode.window.showInformationMessage(
        message
    );
}

/* -------------------------------------------------------------------------- */
/* Encoding picker                                                            */
/* -------------------------------------------------------------------------- */

async function chooseEncoding(
    document: vscode.TextDocument
): Promise<string | undefined> {

    const encodings =
        getSupportedEncodings();

    type EncodingQuickPickItem =
        vscode.QuickPickItem & {
            encoding?: string;
            isCustom?: boolean;
        };

    const quickPick =
        vscode.window.createQuickPick<
            EncodingQuickPickItem
        >();

    quickPick.title =
        "Choose Encoding";

    quickPick.placeholder =
        "Search for an encoding...";

    quickPick.matchOnDescription =
        true;

    function updateItems() {

        const query =
            quickPick.value
                .trim()
                .toLowerCase();

        const matchingEncodings =
            encodings.filter(
                encoding =>
                    !query ||
                    encoding
                        .toLowerCase()
                        .includes(query)
            );

        const items:
            EncodingQuickPickItem[] =
            matchingEncodings.map(
                encoding => ({

                    label:
                        encoding,

                    encoding

                })
            );

        if (
            query &&
            !encodings.some(
                encoding =>
                    encoding.toLowerCase() ===
                    query
            )
        ) {

            items.push({

                label:
                    `$(edit) Use "${quickPick.value.trim()}"`,

                description:
                    "Enter custom encoding",

                encoding:
                    quickPick.value.trim(),

                isCustom:
                    true

            });

        } else {

            items.push({

                label:
                    "$(edit) Enter custom encoding...",

                description:
                    "Use an encoding not shown above",

                isCustom:
                    true

            });
        }

        quickPick.items =
            items;
    }

    updateItems();

    quickPick.onDidChangeValue(
        () => {

            updateItems();

        }
    );

    return new Promise<string | undefined>(
        resolve => {

            let resolved =
                false;

            const finish =
                (
                    value: string | undefined
                ) => {

                    if (
                        resolved
                    ) {

                        return;
                    }

                    resolved =
                        true;

                    quickPick.hide();

                    resolve(
                        value
                    );
                };

            quickPick.onDidAccept(
                async () => {

                    const selected =
                        quickPick.selectedItems[0];

                    if (!selected) {

                        finish(
                            undefined
                        );

                        return;
                    }

                    if (
                        selected.encoding
                    ) {

                        finish(
                            selected.encoding
                        );

                        return;
                    }

                    quickPick.hide();

                    const custom =
                        await vscode.window.showInputBox({

                            title:
                                "Enter Custom Encoding",

                            prompt:
                                "Enter the encoding identifier used by VS Code",

                            value:
                                quickPick.value.trim(),

                            placeHolder:
                                "e.g. windows1257",

                            validateInput:
                                value => {

                                    if (
                                        !value.trim()
                                    ) {

                                        return "Encoding cannot be empty.";
                                    }

                                    return undefined;
                                }

                        });

                    finish(
                        custom?.trim()
                    );
                }
            );

            quickPick.onDidHide(
                () => {

                    if (
                        !resolved
                    ) {

                        resolved =
                            true;

                        resolve(
                            undefined
                        );
                    }

                    quickPick.dispose();
                }
            );

            quickPick.show();

        }
    );
}

/* -------------------------------------------------------------------------- */
/* Supported encodings                                                        */
/* -------------------------------------------------------------------------- */

function getSupportedEncodings(): string[] {

    return [

        "utf8",
        "utf8bom",

        "utf16le",
        "utf16be",

        "windows1250",
        "windows1251",
        "windows1252",
        "windows1253",
        "windows1254",
        "windows1255",
        "windows1256",
        "windows1257",
        "windows1258",

        "iso88591",
        "iso88592",
        "iso88593",
        "iso88594",
        "iso88595",
        "iso88596",
        "iso88597",
        "iso88599",

        "koi8r",
        "koi8u",

        "gbk",
        "gb18030",

        "shiftjis",
        "eucjp",
        "euckr",

        "big5"

    ];
}

/* -------------------------------------------------------------------------- */
/* Existing exact rule                                                        */
/* -------------------------------------------------------------------------- */

function findExistingExactRule(
    pattern: string
): MatchingRule | undefined {

    const normalized =
        pattern.replace(
            /\\/g,
            "/"
        );

    const rules =
        vscode.workspace
            .getConfiguration(
                "encodingRules"
            )
            .get<Record<string, string[]>>(
                "rules",
                {}
            );

    for (
        const [encoding, patterns]
        of Object.entries(rules)
    ) {

        if (
            patterns.some(
                existingPattern =>
                    existingPattern
                        .replace(
                            /\\/g,
                            "/"
                        ) === normalized
            )
        ) {

            return {

                encoding,

                pattern:
                    normalized

            };
        }
    }

    return undefined;
}

/* -------------------------------------------------------------------------- */
/* Folder pattern                                                             */
/* -------------------------------------------------------------------------- */

function createFolderPattern(
    filePath: string
): string {

    const normalized =
        filePath.replace(
            /\\/g,
            "/"
        );

    const lastSlash =
        normalized.lastIndexOf("/");

    const folder =
        normalized.substring(
            0,
            lastSlash
        );

    return `${folder}/**`;
}

/* -------------------------------------------------------------------------- */
/* Reopen with encoding                                                       */
/* -------------------------------------------------------------------------- */

/*
 * Reopen an existing document using a specific encoding.
 *
 * IMPORTANT:
 *
 * Only editors belonging to this URI are touched.
 *
 * We never use closeActiveEditor unless we have first made the
 * target editor active in its own column.
 *
 * Settings editors and unrelated files are therefore left alone.
 */
export async function reopenWithEncoding(
    document: vscode.TextDocument,
    target: string,
    forceFocus = false
): Promise<void> {

    const uri =
        document.uri;

    const key =
        uri.toString();

    console.log(
        "[Encoding Rules] ----------------------------------------"
    );

    console.log(
        `[Encoding Rules] Reopening: ${document.fileName}`
    );

    console.log(
        `[Encoding Rules] Target encoding: ${target}`
    );

    if (
        document.isDirty
    ) {

        throw new Error(
            `Document is dirty: ${document.fileName}`
        );
    }

    /*
     * Mark the URI BEFORE any editor operation.
     *
     * This is critical because closing the editor can generate
     * events that would otherwise cause extension.ts to start
     * another reopen operation.
     */
    reopeningDocuments.add(
        key
    );

    try {

        const matchingEditors =
            getVisibleEditorsForUri(
                uri
            );

        const originalColumn =
            matchingEditors.length > 0
                ? matchingEditors[0].viewColumn
                : vscode.ViewColumn.Active;

        const wasActive =
            forceFocus ||
            vscode.window.activeTextEditor?.document.uri.toString() ===
                key;

        console.log(
            `[Encoding Rules] Matching editors: ${matchingEditors.length}`
        );

        console.log(
            `[Encoding Rules] Original column: ${originalColumn}`
        );

        console.log(
            `[Encoding Rules] Will restore focus: ${wasActive}`
        );

        /*
         * Close ONLY the target editors.
         */
        for (
            const editor
            of matchingEditors
        ) {

            const currentEditor =
                vscode.window.visibleTextEditors.find(
                    candidate =>
                        candidate.document.uri.toString() ===
                            key &&
                        candidate.viewColumn ===
                            editor.viewColumn
                );

            if (
                !currentEditor
            ) {

                continue;
            }

            try {

                await vscode.window.showTextDocument(
                    currentEditor.document,
                    {
                        viewColumn:
                            currentEditor.viewColumn,
                        preserveFocus:
                            false,
                        preview:
                            false
                    }
                );

                await delay(
                    30
                );

                const active =
                    vscode.window.activeTextEditor;

                if (
                    !active ||
                    active.document.uri.toString() !==
                        key
                ) {

                    console.log(
                        "[Encoding Rules] Target editor was not active; not closing."
                    );

                    continue;
                }

                await vscode.commands.executeCommand(
                    "workbench.action.closeActiveEditor"
                );

                await delay(
                    50
                );

            } catch (error) {

                console.error(
                    "[Encoding Rules] Failed to close target editor:",
                    error
                );
            }
        }

        await waitForVisibleEditorsClosed(
            uri,
            3000
        );

        console.log(
            "[Encoding Rules] Target editors closed."
        );

        /*
         * Open the document with the requested encoding.
         */
        const reopened =
            await vscode.workspace.openTextDocument(
                uri,
                {
                    encoding:
                        target
                }
            );

        const actualEncoding =
            getDocumentEncoding(
                reopened
            );

        console.log(
            `[Encoding Rules] openTextDocument returned encoding: ${actualEncoding}`
        );

        if (
            actualEncoding &&
            actualEncoding.toLowerCase() !==
                target.toLowerCase()
        ) {

            throw new Error(
                `VS Code reopened "${uri.fsPath}" using "${actualEncoding}" instead of "${target}".`
            );
        }

        /*
         * Put the document back in its original editor column.
         *
         * If forceFocus/wasActive is true, this also makes it active.
         */
        await vscode.window.showTextDocument(
            reopened,
            {
                viewColumn:
                    originalColumn,
                preview:
                    false,
                preserveFocus:
                    !wasActive
            }
        );

        /*
         * Explicitly verify focus when this file was supposed
         * to remain focused.
         */
        if (
            wasActive
        ) {

            await delay(
                50
            );

            const active =
                vscode.window.activeTextEditor;

            if (
                !active ||
                active.document.uri.toString() !==
                    key
            ) {

                const restoredEditor =
                    vscode.window.visibleTextEditors.find(
                        editor =>
                            editor.document.uri.toString() ===
                            key
                    );

                if (
                    restoredEditor
                ) {

                    await vscode.window.showTextDocument(
                        restoredEditor.document,
                        {
                            viewColumn:
                                restoredEditor.viewColumn,
                            preview:
                                false,
                            preserveFocus:
                                false
                        }
                    );
                }
            }
        }

        console.log(
            `[Encoding Rules] Reopened document successfully: ${reopened.fileName}`
        );

        console.log(
            `[Encoding Rules] Verified encoding: ${actualEncoding}`
        );

        console.log(
            "[Encoding Rules] ----------------------------------------"
        );

    } catch (error) {

        console.error(
            "[Encoding Rules] REOPEN FAILED:",
            error
        );

        throw error;

    } finally {

        reopeningDocuments.delete(
            key
        );
    }
}

/* -------------------------------------------------------------------------- */
/* Visible editors                                                            */
/* -------------------------------------------------------------------------- */

function getVisibleEditorsForUri(
    uri: vscode.Uri
): vscode.TextEditor[] {

    const key =
        uri.toString();

    return vscode.window.visibleTextEditors.filter(
        editor =>
            editor.document.uri.toString() ===
            key
    );
}

/* -------------------------------------------------------------------------- */
/* Wait for visible editors to close                                           */
/* -------------------------------------------------------------------------- */

async function waitForVisibleEditorsClosed(
    uri: vscode.Uri,
    timeoutMs: number
): Promise<void> {

    const key =
        uri.toString();

    const isClosed =
        () =>
            !vscode.window.visibleTextEditors.some(
                editor =>
                    editor.document.uri.toString() ===
                    key
            );

    if (
        isClosed()
    ) {

        return;
    }

    await new Promise<void>(
        (resolve, reject) => {

            let finished =
                false;

            const finish =
                (
                    error?: Error
                ) => {

                    if (
                        finished
                    ) {

                        return;
                    }

                    finished =
                        true;

                    editorChangeDisposable.dispose();

                    clearTimeout(
                        timeout
                    );

                    if (
                        error
                    ) {

                        reject(
                            error
                        );

                    } else {

                        resolve();
                    }
                };

            const editorChangeDisposable =
                vscode.window.onDidChangeVisibleTextEditors(
                    () => {

                        if (
                            isClosed()
                        ) {

                            finish();
                        }
                    }
                );

            const timeout =
                setTimeout(
                    () => {

                        if (
                            isClosed()
                        ) {

                            finish();

                            return;
                        }

                        finish(
                            new Error(
                                `Timed out waiting for VS Code to close editor "${uri.fsPath}".`
                            )
                        );

                    },
                    timeoutMs
                );
        }
    );
}

/* -------------------------------------------------------------------------- */
/* Document encoding                                                          */
/* -------------------------------------------------------------------------- */

function getDocumentEncoding(
    document: vscode.TextDocument
): string | undefined {

    const candidate =
        document as vscode.TextDocument & {
            encoding?: string;
        };

    return candidate.encoding;
}

/* -------------------------------------------------------------------------- */
/* Show matching rules                                                        */
/* -------------------------------------------------------------------------- */

async function showMatchingRule() {

    const editor =
        vscode.window.activeTextEditor;

    if (!editor) {

        vscode.window.showInformationMessage(
            "No file is currently open."
        );

        return;
    }

    if (
        editor.document.uri.scheme !== "file"
    ) {

        vscode.window.showInformationMessage(
            "This command only works with files on disk."
        );

        return;
    }

    const filePath =
        editor.document.uri.fsPath;

    const matches =
        findMatchingRules(
            filePath
        );

    if (
        matches.length === 0
    ) {

        vscode.window.showInformationMessage(
            "No encoding rule matches this file."
        );

        return;
    }

    const effective =
        matches[0];

    const items =
        matches.map(
            (
                match,
                index
            ) =>
                createMatchingRuleItem(
                    match,
                    index === 0
                )
        );

    items.unshift({

        label:
            "Current File",

        description:
            filePath,

        detail:
            `Effective encoding: ${effective.encoding}`,

        kind:
            vscode.QuickPickItemKind.Separator

    });

    const quickPick =
        vscode.window.createQuickPick<
            vscode.QuickPickItem
        >();

    quickPick.title =
        "Encoding Rules — Matching Rules";

    quickPick.placeholder =
        `${matches.length} matching rule${matches.length === 1 ? "" : "s"}`;

    quickPick.items =
        items;

    quickPick.onDidAccept(
        () => {

            quickPick.hide();

        }
    );

    quickPick.onDidHide(
        () => {

            quickPick.dispose();

        }
    );

    quickPick.show();
}

/* -------------------------------------------------------------------------- */
/* Matching rule item                                                         */
/* -------------------------------------------------------------------------- */

function createMatchingRuleItem(
    match: MatchingRule,
    effective: boolean
): vscode.QuickPickItem {

    return {

        label:
            effective
                ? `$(check) ${match.encoding}`
                : `$(circle-outline) ${match.encoding}`,

        description:
            effective
                ? "Effective rule"
                : "Also matches",

        detail:
            match.pattern

    };
}

/* -------------------------------------------------------------------------- */
/* Reopening state                                                            */
/* -------------------------------------------------------------------------- */

export function isReopeningDocument(
    document: vscode.TextDocument
): boolean {

    return reopeningDocuments.has(
        document.uri.toString()
    );
}

/* -------------------------------------------------------------------------- */
/* Delay                                                                      */
/* -------------------------------------------------------------------------- */

function delay(
    milliseconds: number
): Promise<void> {

    return new Promise(
        resolve =>
            setTimeout(
                resolve,
                milliseconds
            )
    );
}
