import * as vscode from "vscode";
import { minimatch } from "minimatch";

interface EncodingRule {
    pattern: string;
    encoding: string;
}

const processedFiles = new Set<string>();

let encodingQueue = Promise.resolve();


export function activate(context: vscode.ExtensionContext) {

    console.log("[Encoding Rules] activated");


    const openListener =
        vscode.workspace.onDidOpenTextDocument(document => {

            if (document.uri.scheme !== "file") {
                return;
            }


            const rule =
                findMatchingRule(
                    document.uri.fsPath
                );


            if (!rule) {
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
                            `[Encoding Rules] ${document.uri.fsPath} -> ${rule.encoding}`
                        );


                        await reopenWithEncoding(
                            document,
                            rule.encoding
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


    // const showRuleCommand =
    //     vscode.commands.registerCommand(
    //         "encodingRules.showCurrentRule",
    //         () => {

    //             const editor =
    //                 vscode.window.activeTextEditor;


    //             if (!editor) {
    //                 return;
    //             }


    //             const rule =
    //                 findMatchingRule(
    //                     editor.document.uri.fsPath
    //                 );


    //             if (!rule) {

    //                 vscode.window.showInformationMessage(
    //                     "No encoding rule found"
    //                 );

    //                 return;
    //             }


    //             vscode.window.showInformationMessage(
    //                 `${rule.pattern} → ${rule.encoding}`
    //             );

    //         }
    //     );


    context.subscriptions.push(
        openListener,
        // showRuleCommand
    );
}


export function deactivate() {
}


function findMatchingRule(
    filePath: string
): EncodingRule | undefined {


    const config =
        vscode.workspace.getConfiguration(
            "encodingRules"
        );


    const rules =
        config.get<EncodingRule[]>(
            "rules",
            []
        );


    for (const rule of rules) {

        if (
            minimatch(
                filePath,
                rule.pattern,
                {
                    nocase: true
                }
            )
        ) {
            return rule;
        }

    }


    return undefined;
}


async function reopenWithEncoding(
    document: vscode.TextDocument,
    target: string
) {
    const filesConfig =
        vscode.workspace.getConfiguration("files");

    const previous =
        filesConfig.inspect<string>("encoding")
            ?.globalValue;

    await filesConfig.update(
        "encoding",
        target,
        vscode.ConfigurationTarget.Global
    );

    try {
        await vscode.window.showTextDocument(
            document,
            { preview: false }
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