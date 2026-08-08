import * as vscode from "vscode";

import {
    addRule,
    findMatchingRules,
    MatchingRule,
    AddRuleResult
} from "./rules";


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


    /*
     * For a folder rule we use the directory
     * containing the current file.
     */

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


    let replaceExisting = false;


    if (
        existing &&
        existing.encoding !== encoding
    ) {

        const choice =
            await vscode.window.showWarningMessage(
                `A rule already exists for this pattern using ${existing.encoding}.`,
                "Replace",
                "Cancel"
            );


        if (choice !== "Replace") {
            return;
        }


        replaceExisting = true;
    }


    const result =
        await addRule(
            encoding,
            pattern,
            replaceExisting
        );


    if (!result) {

        vscode.window.showInformationMessage(
            "This encoding rule already exists."
        );

        return;
    }


    /*
     * Immediately apply the newly created
     * rule to the current file.
     */

    try {

        await reopenWithEncoding(
            document,
            encoding
        );

    } catch {

        const action =
            await vscode.window.showWarningMessage(
                `The rule was saved, but "${document.fileName}" could not be reopened using "${encoding}". ` +
                `The encoding may not be supported by VS Code.`,
                "Open Settings"
            );

        if (action === "Open Settings") {

            await vscode.commands.executeCommand(
                "workbench.action.openSettings",
                "@id:encodingRules.rules"
            );
        }
    }


    let message: string;


    if (
        result.status === "replaced"
    ) {

        message =
            `Rule updated: ${result.previousEncoding} → ${encoding}`;

    } else {

        message =
            `Rule added: ${encoding}`;
    }


    const action =
        await vscode.window.showInformationMessage(
            message,
            "Open Settings"
        );


    if (
        action === "Open Settings"
    ) {

        await openRulesSettings();

    }
}


/* -------------------------------------------------------------------------- */
/* Encoding picker                                                            */
/* -------------------------------------------------------------------------- */

async function chooseEncoding(
    document: vscode.TextDocument
): Promise<string | undefined> {

    const currentEncoding =
        getCurrentEncoding(document);

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
        currentEncoding
            ? `Current: ${currentEncoding}`
            : "Search for an encoding...";

    quickPick.matchOnDescription = true;


    function updateItems() {

        const query =
            quickPick.value.trim().toLowerCase();


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
                        encoding === currentEncoding
                            ? `$(check) ${encoding}`
                            : encoding,

                    description:
                        encoding === currentEncoding
                            ? "Current encoding"
                            : undefined,

                    encoding

                })
            );


        /*
         * Offer a custom encoding.
         */

        if (
            query &&
            !encodings.some(
                encoding =>
                    encoding.toLowerCase() === query
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

            let resolved = false;


            const finish = (
                value: string | undefined
            ) => {

                if (resolved) {
                    return;
                }

                resolved = true;

                quickPick.hide();

                resolve(value);
            };


            quickPick.onDidAccept(
                async () => {

                    const selected =
                        quickPick.selectedItems[0];


                    if (!selected) {

                        finish(undefined);

                        return;
                    }


                    /*
                     * Predefined encoding.
                     */

                    if (
                        selected.encoding &&
                        !selected.isCustom
                    ) {

                        finish(
                            selected.encoding
                        );

                        return;
                    }


                    /*
                     * Custom encoding that was
                     * typed directly.
                     */

                    if (
                        selected.isCustom &&
                        selected.encoding
                    ) {

                        finish(
                            selected.encoding
                        );

                        return;
                    }


                    /*
                     * User selected the generic
                     * "Enter custom encoding..."
                     * option.
                     */

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

                    if (!resolved) {

                        resolved = true;

                        resolve(undefined);
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

    /*
     * VS Code does not currently expose a simple
     * public API that returns the complete list of
     * supported file encodings.
     *
     * Keep the commonly useful encodings here.
     */

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
/* Current encoding                                                           */
/* -------------------------------------------------------------------------- */

function getCurrentEncoding(
    document: vscode.TextDocument
): string | undefined {

    /*
     * VS Code does not expose the encoding of a
     * TextDocument directly.
     *
     * The encoding setting is therefore used as
     * the best available indication.
     */

    return vscode.workspace
        .getConfiguration("files")
        .get<string>("encoding");
}


/* -------------------------------------------------------------------------- */
/* Existing exact rule                                                       */
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
                pattern: normalized
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

export async function reopenWithEncoding(
    document: vscode.TextDocument,
    target: string
): Promise<void> {

    const filesConfig =
        vscode.workspace.getConfiguration("files");

    const previous =
        filesConfig.inspect<string>(
            "encoding"
        )?.globalValue;

    try {

        await filesConfig.update(
            "encoding",
            target,
            vscode.ConfigurationTarget.Global
        );

        await vscode.window.showTextDocument(
            document,
            {
                preview: false
            }
        );

        await vscode.commands.executeCommand(
            "workbench.action.files.revert"
        );

    } finally {

        await filesConfig.update(
            "encoding",
            previous,
            vscode.ConfigurationTarget.Global
        );
    }
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

        const action =
            await vscode.window.showInformationMessage(
                "No encoding rule matches this file.",
                "Open Settings"
            );


        if (
            action === "Open Settings"
        ) {

            await openRulesSettings();

        }

        return;
    }


    const effective =
        matches[0];


    const items =
        matches.map(
            (
                match,
                index
            ) => createMatchingRuleItem(
                match,
                index === 0
            )
        );


    /*
     * Add a non-rule informational item
     * showing the current file.
     */

    items.unshift({
        label: "Current File",
        description: filePath,
        detail: `Effective encoding: ${effective.encoding}`,
        kind: vscode.QuickPickItemKind.Separator
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


    quickPick.buttons = [
        {
            iconPath:
                new vscode.ThemeIcon(
                    "settings-gear"
                ),

            tooltip:
                "Open Encoding Rules settings"
        }
    ];


    quickPick.onDidTriggerButton(
        async () => {

            quickPick.hide();

            await openRulesSettings();

        }
    );


    quickPick.onDidAccept(
        async () => {

            quickPick.hide();

            await openRulesSettings();
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
/* Settings                                                                   */
/* -------------------------------------------------------------------------- */

async function openRulesSettings() {

    await vscode.commands.executeCommand(
        "workbench.action.openSettings",
        "@id:encodingRules.rules"
    );
}