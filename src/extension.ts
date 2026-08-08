import * as vscode from "vscode";
import { findMatchingEncoding } from "./rules";
import { registerCommands, reopenWithEncoding } from "./commands";


const processedFiles =
    new Set<string>();


let encodingQueue =
    Promise.resolve();


export function activate(context: vscode.ExtensionContext) {

    console.log("[Encoding Rules] activated");

    registerCommands(context);

    const openListener =
        vscode.workspace.onDidOpenTextDocument(
            document => {
                handleDocument(document);
            }
        );

    context.subscriptions.push(
        openListener
    );


    // Handle documents that were already opened
    // before the extension finished activating.
    for (const document of vscode.workspace.textDocuments) {
        handleDocument(document);
    }
}


function handleDocument(
    document: vscode.TextDocument
) {

    if (document.uri.scheme !== "file") {
        return;
    }

    const encoding =
        findMatchingEncoding(
            document.uri.fsPath
        );

    if (!encoding) {
        return;
    }

    const key =
        document.uri.toString();

    if (processedFiles.has(key)) {
        return;
    }

    processedFiles.add(key);

    encodingQueue =
        encodingQueue.then(async () => {

            try {

                await reopenWithEncoding(
                    document,
                    encoding
                );

            } catch {

                const action =
                    await vscode.window.showWarningMessage(
                        `Could not apply encoding "${encoding}" to "${document.fileName}". ` +
                        `The encoding may not be supported by VS Code.`,
                        "Open Settings"
                    );

                if (action === "Open Settings") {

                    await vscode.commands.executeCommand(
                        "workbench.action.openSettings",
                        "@id:encodingRules.rules"
                    );
                }

            } finally {

                processedFiles.delete(key);

            }

        });
}


export function deactivate() {}