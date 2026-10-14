import * as vscode from "vscode";
import { minimatch } from "minimatch";

export type EncodingRules =
    Record<string, string[]>;

export type MatchingRule = {
    encoding: string;
    pattern: string;
};

export type AddRuleResult =
    | {
        status: "added";
    }
    | {
        status: "replaced";
        previousEncoding: string;
    };


/* -------------------------------------------------------------------------- */
/* Get rules                                                                  */
/* -------------------------------------------------------------------------- */

export function getRules(): EncodingRules {

    const config =
        vscode.workspace.getConfiguration(
            "encodingRules"
        );

    return config.get<EncodingRules>(
        "rules",
        {}
    );
}


/* -------------------------------------------------------------------------- */
/* Get maximum file size                                                      */
/* -------------------------------------------------------------------------- */

export function getMaxFileSize(): number {

    const config =
        vscode.workspace.getConfiguration(
            "encodingRules"
        );

    return config.get<number>(
        "maxFileSize",
        52428800
    );
}

export async function exceedsMaxFileSize(
    uri: vscode.Uri
): Promise<boolean> {

    try {

        const stat =
            await vscode.workspace.fs.stat(uri);

        return stat.size > getMaxFileSize();

    } catch {

        /*
         * If the size can't be determined, don't block the rule.
         */
        return false;
    }
}


/* -------------------------------------------------------------------------- */
/* Find matching rules                                                        */
/* -------------------------------------------------------------------------- */

export function findMatchingRules(
    filePath: string
): MatchingRule[] {

    return findMatchingRulesInRules(
        filePath,
        getRules()
    );
}


/* -------------------------------------------------------------------------- */
/* Find matching rules in supplied rule set                                   */
/* -------------------------------------------------------------------------- */

export function findMatchingRulesInRules(
    filePath: string,
    rules: EncodingRules
): MatchingRule[] {

    const normalizedFilePath =
        filePath.replace(
            /\\/g,
            "/"
        );

    const matches:
        MatchingRule[] = [];

    for (
        const [encoding, patterns]
        of Object.entries(rules)
    ) {

        for (
            const pattern
            of patterns
        ) {

            const normalizedPattern =
                pattern.replace(
                    /\\/g,
                    "/"
                );

            if (
                minimatch(
                    normalizedFilePath,
                    normalizedPattern,
                    {
                        nocase: true
                    }
                )
            ) {

                matches.push({
                    encoding,
                    pattern:
                        normalizedPattern
                });
            }
        }
    }

    /*
     * More specific patterns win.
     *
     * Example:
     *
     * C:/Temp/Folder/**
     *
     * beats:
     *
     * C:/Temp/**
     */
    matches.sort(
        (a, b) =>
            b.pattern.length -
            a.pattern.length
    );

    return matches;
}


/* -------------------------------------------------------------------------- */
/* Find matching rule                                                         */
/* -------------------------------------------------------------------------- */

export function findMatchingRule(
    filePath: string
): MatchingRule | undefined {

    return findMatchingRules(
        filePath
    )[0];
}


/* -------------------------------------------------------------------------- */
/* Find matching encoding                                                     */
/* -------------------------------------------------------------------------- */

export function findMatchingEncoding(
    filePath: string
): string | undefined {

    return findMatchingRule(
        filePath
    )?.encoding;
}


/* -------------------------------------------------------------------------- */
/* Find matching encoding in supplied rule set                                */
/* -------------------------------------------------------------------------- */

export function findMatchingEncodingInRules(
    filePath: string,
    rules: EncodingRules
): string | undefined {

    return findMatchingRulesInRules(
        filePath,
        rules
    )[0]?.encoding;
}


/* -------------------------------------------------------------------------- */
/* Add rule                                                                   */
/* -------------------------------------------------------------------------- */

export async function addRule(
    encoding: string,
    pattern: string,
    replaceExisting = false
): Promise<AddRuleResult | false> {

    /*
     * Clone the configuration object before modifying it.
     */
    const rules:
        EncodingRules =
        JSON.parse(
            JSON.stringify(
                getRules()
            )
        );

    let existingEncoding:
        string | undefined;

    /*
     * Find an exact existing pattern.
     */
    for (
        const [currentEncoding, patterns]
        of Object.entries(rules)
    ) {

        if (
            patterns.some(
                existingPattern =>
                    existingPattern
                        .replace(
                            /\\/g,
                            "/"
                        ) ===
                    pattern.replace(
                        /\\/g,
                        "/"
                    )
            )
        ) {

            existingEncoding =
                currentEncoding;

            break;
        }
    }

    /*
     * Same pattern and same encoding.
     */
    if (
        existingEncoding ===
        encoding
    ) {

        return false;
    }

    /*
     * Same pattern under another encoding.
     */
    if (
        existingEncoding &&
        !replaceExisting
    ) {

        return false;
    }

    /*
     * Remove the old occurrence.
     */
    if (
        existingEncoding
    ) {

        rules[
            existingEncoding
        ] =
            rules[
                existingEncoding
            ].filter(
                existingPattern =>
                    existingPattern
                        .replace(
                            /\\/g,
                            "/"
                        ) !==
                    pattern.replace(
                        /\\/g,
                        "/"
                    )
            );

        if (
            rules[
                existingEncoding
            ].length === 0
        ) {

            delete rules[
                existingEncoding
            ];
        }
    }

    /*
     * Add the new rule.
     */
    if (
        !rules[encoding]
    ) {

        rules[encoding] = [];
    }

    rules[encoding].push(
        pattern
    );

    await vscode.workspace
        .getConfiguration(
            "encodingRules"
        )
        .update(
            "rules",
            rules,
            vscode.ConfigurationTarget.Global
        );

    if (
        existingEncoding
    ) {

        return {
            status:
                "replaced",

            previousEncoding:
                existingEncoding
        };
    }

    return {
        status:
            "added"
    };
}