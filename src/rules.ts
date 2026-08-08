import * as vscode from "vscode";
import { minimatch } from "minimatch";

export type EncodingRules = Record<string, string[]>;

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

export function findMatchingRules(
    filePath: string
): MatchingRule[] {

    const normalizedFilePath =
        filePath.replace(/\\/g, "/");

    const rules =
        getRules();

    const matches: MatchingRule[] = [];

    for (
        const [encoding, patterns]
        of Object.entries(rules)
    ) {

        for (const pattern of patterns) {

            const normalizedPattern =
                pattern.replace(/\\/g, "/");

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
                    pattern: normalizedPattern
                });

            }
        }
    }

    /*
     * More specific patterns should win.
     *
     * This is currently based on pattern length.
     * Therefore:
     *
     *   C:/Legacy/modern/**
     *
     * wins over:
     *
     *   C:/Legacy/**
     */

    matches.sort(
        (a, b) =>
            b.pattern.length -
            a.pattern.length
    );

    return matches;
}

export function findMatchingRule(
    filePath: string
): MatchingRule | undefined {

    return findMatchingRules(
        filePath
    )[0];
}

export function findMatchingEncoding(
    filePath: string
): string | undefined {

    return findMatchingRule(
        filePath
    )?.encoding;
}

export async function addRule(
    encoding: string,
    pattern: string,
    replaceExisting = false
): Promise<AddRuleResult | false> {

    /*
     * Clone the configuration object before modifying it.
     *
     * This avoids VS Code configuration proxy issues such as:
     *
     * "'isExtensible' on proxy: trap result does not reflect
     * extensibility of proxy target"
     */

    const rules: EncodingRules =
        JSON.parse(
            JSON.stringify(
                getRules()
            )
        );

    let existingEncoding:
        string | undefined;


    /*
     * Check whether this exact pattern
     * already exists.
     */

    for (
        const [currentEncoding, patterns]
        of Object.entries(rules)
    ) {

        if (
            patterns.includes(pattern)
        ) {

            existingEncoding =
                currentEncoding;

            break;
        }
    }


    /*
     * The exact same rule already exists.
     */

    if (
        existingEncoding === encoding
    ) {

        return false;
    }


    /*
     * The pattern already exists under
     * another encoding.
     */

    if (
        existingEncoding &&
        !replaceExisting
    ) {

        return false;
    }


    /*
     * Remove the old occurrence when
     * replacing an existing rule.
     */

    if (existingEncoding) {

        rules[existingEncoding] =
            rules[existingEncoding]
                .filter(
                    existingPattern =>
                        existingPattern !== pattern
                );

        /*
         * Remove the encoding entirely
         * if it no longer has patterns.
         */

        if (
            rules[existingEncoding]
                .length === 0
        ) {

            delete rules[
                existingEncoding
            ];

        }
    }


    /*
     * Create the new encoding entry
     * if necessary.
     */

    if (!rules[encoding]) {

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


    if (existingEncoding) {

        return {
            status: "replaced",
            previousEncoding:
                existingEncoding
        };

    }


    return {
        status: "added"
    };
}