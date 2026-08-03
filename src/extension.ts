import * as vscode from "vscode";
import { minimatch } from "minimatch";
import { getRulesHtml } from "./config-webview";

type EncodingRules = Record<string, string[]>;

const processedFiles = new Set<string>();

let encodingQueue = Promise.resolve();

export function activate(context: vscode.ExtensionContext) {

    console.log("[Encoding Rules] activated");

    const openListener =
        vscode.workspace.onDidOpenTextDocument(document => {

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

                        console.log(
                            `[Encoding Rules] ${document.uri.fsPath} -> ${encoding}`
                        );

                        await reopenWithEncoding(
                            document,
                            encoding
                        );

                    } catch (error) {

                        console.error(
                            "[Encoding Rules] failed:",
                            error
                        );

                    } finally {

                        processedFiles.delete(key);

                    }

                });

        });

    // package.json
    //   {
    //     "command": "encodingRules.editRules",
    //     "title": "Encoding Rules: Edit Rules"
    //   }

    // const editRulesCommand =
    //     vscode.commands.registerCommand(
    //         "encodingRules.editRules",
    //         () => {
    //             showRulesEditor();
    //         }
    //     );

    context.subscriptions.push(
        openListener,
        // editRulesCommand
    );
}

export function deactivate() {
}

function findMatchingEncoding(
    filePath: string
): string | undefined {

    const config =
        vscode.workspace.getConfiguration(
            "encodingRules"
        );

    const rules =
        config.get<EncodingRules>(
            "rules",
            {}
        );

    const normalized =
        filePath.replace(/\\/g, "/");

    for (const [encoding, patterns] of Object.entries(rules)) {

        for (const pattern of patterns) {

            if (
                minimatch(
                    normalized,
                    pattern,
                    {
                        nocase: true
                    }
                )
            ) {
                return encoding;
            }

        }

    }

    return undefined;
}

async function reopenWithEncoding(
    document: vscode.TextDocument,
    target: string
): Promise<void> {

    const filesConfig =
        vscode.workspace.getConfiguration(
            "files"
        );

    const previous =
        filesConfig.inspect<string>(
            "encoding"
        )?.globalValue;

    await filesConfig.update(
        "encoding",
        target,
        vscode.ConfigurationTarget.Global
    );

    try {

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

function showRulesEditor() {

    const panel =
        vscode.window.createWebviewPanel(
            "encodingRulesEditor",
            "Encoding Rules",
            vscode.ViewColumn.One,
            {
                enableScripts: true
            }
        );


    const config =
        vscode.workspace.getConfiguration(
            "encodingRules"
        );


    const rules =
        config.get<Record<string,string[]>>(
            "rules",
            {}
        );


    panel.webview.html =
        getRulesHtml(rules);


    panel.webview.onDidReceiveMessage(
        async message => {

            if (message.command === "save") {

                await config.update(
                    "rules",
                    message.rules,
                    vscode.ConfigurationTarget.Workspace
                );


                vscode.window.showInformationMessage(
                    "Encoding Rules saved"
                );

                panel.dispose();
            }

        }
    );
}
