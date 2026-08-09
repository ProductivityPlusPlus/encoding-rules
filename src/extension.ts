import * as vscode from "vscode";

import {
    EncodingRules,
    findMatchingEncoding,
    findMatchingEncodingInRules,
    getRules
} from "./rules";

import {
    consumeRequestedFocusUri,
    isReopeningDocument,
    registerCommands,
    reopenWithEncoding,
    reopeningDocuments
} from "./commands";

import { minimatch } from "minimatch";

/*
 * Prevent duplicate queued operations for the same URI.
 */
const queuedFiles =
    new Set<string>();

/*
 * All encoding operations are serialized.
 *
 * This is important because VS Code's editor/workbench operations
 * are asynchronous and multiple close/open operations at once can
 * cause focus and tab races.
 */
let encodingQueue:
    Promise<void> =
    Promise.resolve();

/*
 * Previous configuration snapshot.
 */
let previousRules:
    EncodingRules = {};

/*
 * File that had focus when VS Code started.
 */
let startupFocusUri:
    vscode.Uri | undefined;

let startupFocusColumn:
    vscode.ViewColumn | undefined;

/* -------------------------------------------------------------------------- */
/* Activate                                                                   */
/* -------------------------------------------------------------------------- */

export function activate(
    context: vscode.ExtensionContext
) {

    console.log(
        "[Encoding Rules] activated"
    );

    registerCommands(
        context
    );

    /*
     * Snapshot the initial rules BEFORE any processing.
     */
    previousRules =
        cloneRules(
            getRules()
        );

    /*
     * Remember the initially focused file.
     */
    const initialEditor =
        vscode.window.activeTextEditor;

    if (initialEditor) {

        startupFocusUri =
            initialEditor.document.uri;

        startupFocusColumn =
            initialEditor.viewColumn;

        console.log(
            `[Encoding Rules] Initial focus: ${initialEditor.document.fileName}`
        );

        console.log(
            `[Encoding Rules] Initial column: ${startupFocusColumn}`
        );
    }

    /*
     * Documents opened after activation.
     */
    const openListener =
        vscode.workspace.onDidOpenTextDocument(
            document => {

                handleDocumentOpened(
                    document
                );
            }
        );

    context.subscriptions.push(
        openListener
    );

    /*
     * Configuration changes.
     *
     * We do NOT scan every open document and compare effective
     * encodings.
     *
     * Instead we identify which rule PATTERNS actually changed
     * and process only open documents affected by those patterns.
     */
    const configurationListener =
        vscode.workspace.onDidChangeConfiguration(
            async event => {

                if (
                    !event.affectsConfiguration(
                        "encodingRules.rules"
                    )
                ) {

                    return;
                }

                await processConfigurationChange();
            }
        );

    context.subscriptions.push(
        configurationListener
    );

    /*
     * Apply rules to documents already restored by VS Code.
     */
    for (
        const document
        of Array.from(
            vscode.workspace.textDocuments
        )
    ) {

        handleDocumentOpened(
            document
        );
    }

    /*
     * Startup processing must finish before restoring
     * the file that originally had focus.
     */
    encodingQueue =
        encodingQueue.then(
            async () => {

                await restoreStartupFocus();

            }
        );
}

/* -------------------------------------------------------------------------- */
/* Open document                                                              */
/* -------------------------------------------------------------------------- */

function handleDocumentOpened(
    document: vscode.TextDocument
) {

    if (
        document.uri.scheme !== "file"
    ) {

        return;
    }

    if (
        isReopeningDocument(
            document
        )
    ) {

        console.log(
            `[Encoding Rules] Ignoring ${document.fileName}; extension is reopening it.`
        );

        return;
    }

    const key =
        document.uri.toString();

    if (
        reopeningDocuments.has(key)
    ) {

        return;
    }

    const encoding =
        findMatchingEncoding(
            document.uri.fsPath
        );

    if (!encoding) {

        return;
    }

    const actual =
        getDocumentEncoding(
            document
        );

    if (
        actual &&
        actual.toLowerCase() ===
            encoding.toLowerCase()
    ) {

        return;
    }

    queueReopen(
        document.uri,
        encoding,
        false
    );
}

/* -------------------------------------------------------------------------- */
/* Configuration change                                                       */
/* -------------------------------------------------------------------------- */

/*
 * Process ONLY files affected by rules that actually changed.
 *
 * Example:
 *
 *   old:
 *     windows1257 -> C:/Temp/file.txt
 *
 *   new:
 *     windows1250 -> C:/Temp/file.txt
 *
 * Only file.txt is processed.
 *
 * A folder rule such as:
 *
 *     windows1257 -> C:/Temp/**
 *
 * can affect multiple open files, so all matching open files
 * are processed.
 */
async function processConfigurationChange() {

    const currentRules =
        cloneRules(
            getRules()
        );

    const oldRules =
        previousRules;

    /*
     * Update the snapshot immediately.
     */
    previousRules =
        cloneRules(
            currentRules
        );

    console.log(
        "[Encoding Rules] Configuration changed."
    );

    /*
     * This is the file the user explicitly changed through
     * our command, if any.
     *
     * The command itself already reopens this file, so we
     * exclude it from configuration processing.
     */
    const requestedFocusUri =
        consumeRequestedFocusUri();

    /*
     * Find exactly which rule patterns changed.
     */
    const changedPatterns =
        getChangedPatterns(
            oldRules,
            currentRules
        );

    if (
        changedPatterns.length === 0
    ) {

        console.log(
            "[Encoding Rules] No rule patterns changed."
        );

        return;
    }

    console.log(
        `[Encoding Rules] Changed rule patterns: ${changedPatterns.length}`
    );

    for (
        const changed
        of changedPatterns
    ) {

        console.log(
            `[Encoding Rules] Changed rule: ${changed.oldEncoding ?? "(none)"} / ${changed.newEncoding ?? "(none)"} / ${changed.pattern}`
        );
    }

    /*
     * Snapshot the currently open FILE documents.
     */
    const documents =
        Array.from(
            vscode.workspace.textDocuments
        ).filter(
            document =>
                document.uri.scheme === "file"
        );

    /*
     * Determine which open files are affected by at least
     * one changed rule.
     */
    const affectedUris =
        new Map<
            string,
            vscode.Uri
        >();

    for (
        const document
        of documents
    ) {

        const key =
            document.uri.toString();

        /*
         * The explicitly changed file is already being handled
         * by createRule().
         */
        if (
            requestedFocusUri &&
            key ===
                requestedFocusUri.toString()
        ) {

            console.log(
                `[Encoding Rules] Skipping explicitly changed file: ${document.fileName}`
            );

            continue;
        }

        const affected =
            changedPatterns.some(
                changed =>
                    minimatch(
                        normalizePath(
                            document.uri.fsPath
                        ),
                        normalizePath(
                            changed.pattern
                        ),
                        {
                            nocase: true
                        }
                    )
            );

        if (
            !affected
        ) {

            continue;
        }

        affectedUris.set(
            key,
            document.uri
        );
    }

    if (
        affectedUris.size === 0
    ) {

        console.log(
            "[Encoding Rules] No other open files are affected."
        );

        return;
    }

    console.log(
        `[Encoding Rules] Affected open files: ${affectedUris.size}`
    );

    /*
     * Queue each affected URI.
     *
     * IMPORTANT:
     *
     * We pass the URI rather than retaining the old TextDocument
     * object. Before processing we find the current live document.
     *
     * This prevents stale/closed TextDocument objects from causing
     * files to remain closed.
     */
    for (
        const uri
        of affectedUris.values()
    ) {

        const newEncoding =
            findMatchingEncodingInRules(
                uri.fsPath,
                currentRules
            );

        /*
         * If the changed rule was removed and no rule now applies,
         * there is no encoding to force.
         */
        if (
            !newEncoding
        ) {

            console.log(
                `[Encoding Rules] ${uri.fsPath} has no matching rule after change.`
            );

            continue;
        }

        queueReopen(
            uri,
            newEncoding,
            false
        );
    }

    /*
     * The explicitly changed file is already reopened by
     * commands.ts.
     *
     * We do NOT perform another focus operation here.
     *
     * This is important: doing so is one of the main causes
     * of focus jumping between files.
     */
}

/* -------------------------------------------------------------------------- */
/* Changed rules                                                              */
/* -------------------------------------------------------------------------- */

type ChangedPattern = {
    pattern: string;
    oldEncoding?: string;
    newEncoding?: string;
};

/*
 * Compare the rule maps at the PATTERN level.
 *
 * A pattern is considered changed when:
 *
 *   - it was added
 *   - it was removed
 *   - its encoding changed
 */
function getChangedPatterns(
    oldRules: EncodingRules,
    newRules: EncodingRules
): ChangedPattern[] {

    const oldByPattern =
        flattenRules(
            oldRules
        );

    const newByPattern =
        flattenRules(
            newRules
        );

    const allPatterns =
        new Set<string>();

    for (
        const pattern
        of oldByPattern.keys()
    ) {

        allPatterns.add(
            pattern
        );
    }

    for (
        const pattern
        of newByPattern.keys()
    ) {

        allPatterns.add(
            pattern
        );
    }

    const changed:
        ChangedPattern[] = [];

    for (
        const pattern
        of allPatterns
    ) {

        const oldEncoding =
            oldByPattern.get(
                pattern
            );

        const newEncoding =
            newByPattern.get(
                pattern
            );

        if (
            oldEncoding?.toLowerCase() ===
            newEncoding?.toLowerCase()
        ) {

            continue;
        }

        changed.push({

            pattern,

            oldEncoding,

            newEncoding

        });
    }

    return changed;
}

/*
 * Convert:
 *
 *   {
 *       windows1257: [
 *           "C:/Temp/**"
 *       ]
 *   }
 *
 * into:
 *
 *   Map("C:/Temp/**" -> "windows1257")
 */
function flattenRules(
    rules: EncodingRules
): Map<string, string> {

    const result =
        new Map<string, string>();

    for (
        const [encoding, patterns]
        of Object.entries(rules)
    ) {

        for (
            const pattern
            of patterns
        ) {

            result.set(
                normalizePath(
                    pattern
                ),
                encoding
            );
        }
    }

    return result;
}

/* -------------------------------------------------------------------------- */
/* Queue reopen                                                               */
/* -------------------------------------------------------------------------- */

/*
 * Queue a URI rather than a TextDocument.
 *
 * This is deliberately important.
 *
 * TextDocument objects can become closed while another editor
 * operation is running. The URI remains stable and we can find
 * the current document when the operation actually starts.
 */
function queueReopen(
    uri: vscode.Uri,
    encoding: string,
    forceFocus: boolean
) {

    const key =
        uri.toString();

    if (
        queuedFiles.has(key)
    ) {

        return;
    }

    if (
        reopeningDocuments.has(key)
    ) {

        return;
    }

    queuedFiles.add(
        key
    );

    console.log(
        `[Encoding Rules] Queuing ${uri.fsPath} -> ${encoding}, focus=${forceFocus}`
    );

    encodingQueue =
        encodingQueue.then(
            async () => {

                try {

                    /*
                     * Find the CURRENT document.
                     */
                    const document =
                        vscode.workspace.textDocuments.find(
                            candidate =>
                                candidate.uri.toString() ===
                                key
                        );

                    if (
                        !document
                    ) {

                        console.log(
                            `[Encoding Rules] ${uri.fsPath} is no longer open; skipping.`
                        );

                        return;
                    }

                    /*
                     * The document may already have been closed
                     * as part of another operation.
                     */
                    if (
                        document.isClosed
                    ) {

                        console.log(
                            `[Encoding Rules] ${uri.fsPath} document is closed; skipping.`
                        );

                        return;
                    }

                    /*
                     * Check the CURRENT effective rule again.
                     */
                    const currentEncoding =
                        findMatchingEncoding(
                            uri.fsPath
                        );

                    if (
                        !currentEncoding
                    ) {

                        console.log(
                            `[Encoding Rules] ${uri.fsPath} no longer has a matching rule; skipping.`
                        );

                        return;
                    }

                    /*
                     * If another event changed the rule while
                     * this URI was waiting in the queue, use the
                     * newest rule.
                     */
                    const actual =
                        getDocumentEncoding(
                            document
                        );

                    if (
                        actual &&
                        actual.toLowerCase() ===
                            currentEncoding.toLowerCase()
                    ) {

                        console.log(
                            `[Encoding Rules] ${uri.fsPath} already uses ${currentEncoding}.`
                        );

                        if (
                            forceFocus
                        ) {

                            await showDocumentFocused(
                                document
                            );
                        }

                        return;
                    }

                    await reopenWithEncoding(
                        document,
                        currentEncoding,
                        forceFocus
                    );

                } catch (error) {

                    console.error(
                        `[Encoding Rules] Failed to apply encoding to ${uri.fsPath}:`,
                        error
                    );

                    /*
                     * Do not repeatedly interrupt the user for
                     * documents that disappeared during processing.
                     */
                    console.error(
                        `[Encoding Rules] Reopen failed for ${uri.fsPath}.`
                    );

                } finally {

                    queuedFiles.delete(
                        key
                    );
                }
            }
        );
}

/* -------------------------------------------------------------------------- */
/* Startup focus                                                              */
/* -------------------------------------------------------------------------- */

async function restoreStartupFocus():
    Promise<void> {

    if (
        !startupFocusUri
    ) {

        return;
    }

    /*
     * Wait until the startup queue has propagated through
     * the workbench.
     */
    await delay(
        150
    );

    await restoreRequestedFocus(
        startupFocusUri,
        startupFocusColumn
    );
}

/* -------------------------------------------------------------------------- */
/* Requested focus                                                            */
/* -------------------------------------------------------------------------- */

async function restoreRequestedFocus(
    uri: vscode.Uri,
    column?: vscode.ViewColumn
): Promise<void> {

    const document =
        vscode.workspace.textDocuments.find(
            candidate =>
                candidate.uri.toString() ===
                uri.toString()
        );

    if (
        !document
    ) {

        console.log(
            `[Encoding Rules] Cannot restore focus; document is not open: ${uri.fsPath}`
        );

        return;
    }

    try {

        await showDocumentFocused(
            document,
            column
        );

    } catch (error) {

        console.error(
            "[Encoding Rules] Could not restore requested focus:",
            error
        );
    }
}

/* -------------------------------------------------------------------------- */
/* Focus helper                                                               */
/* -------------------------------------------------------------------------- */

async function showDocumentFocused(
    document: vscode.TextDocument,
    column?: vscode.ViewColumn
): Promise<void> {

    await vscode.window.showTextDocument(
        document,
        {
            viewColumn:
                column,
            preview:
                false,
            preserveFocus:
                false
        }
    );

    await delay(
        50
    );
}

/* -------------------------------------------------------------------------- */
/* Rules cloning                                                              */
/* -------------------------------------------------------------------------- */

function cloneRules(
    rules: EncodingRules
): EncodingRules {

    return JSON.parse(
        JSON.stringify(
            rules
        )
    );
}

/* -------------------------------------------------------------------------- */
/* Path normalization                                                         */
/* -------------------------------------------------------------------------- */

function normalizePath(
    value: string
): string {

    return value.replace(
        /\\/g,
        "/"
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

/* -------------------------------------------------------------------------- */
/* Deactivate                                                                 */
/* -------------------------------------------------------------------------- */

export function deactivate() {}
