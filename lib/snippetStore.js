// Snippet folders loaded from snippets.json, which users edit by hand in v1.

/**
 * @typedef {object} Snippet
 * @property {string} id
 * @property {string} title
 * @property {string} content
 * @property {boolean} enabled
 */

/**
 * @typedef {object} SnippetFolder
 * @property {string} id
 * @property {string} title
 * @property {boolean} enabled
 * @property {Snippet[]} snippets
 */

export const EXAMPLE_SNIPPETS = {
    folders: [
        {
            title: 'Examples',
            enabled: true,
            snippets: [
                {title: 'Greeting', content: 'Hello!', enabled: true},
                {title: 'Signature', content: 'Best regards,\nYour Name', enabled: true},
            ],
        },
    ],
};

export class SnippetParseError extends Error {}

/**
 * Validate and normalise snippets.json. Missing "enabled" fields default to true and
 * missing titles fall back to the content, so a minimal file stays easy to write.
 *
 * @param {unknown} json
 * @returns {SnippetFolder[]}
 */
export function parseSnippets(json) {
    if (!Array.isArray(json?.folders))
        throw new SnippetParseError('Expected an object with a "folders" array');

    return json.folders.map((folder, folderIndex) => {
        const where = `folders[${folderIndex}]`;
        if (typeof folder?.title !== 'string')
            throw new SnippetParseError(`${where}.title must be a string`);
        if (folder.snippets !== undefined && !Array.isArray(folder.snippets))
            throw new SnippetParseError(`${where}.snippets must be an array`);

        const snippets = (folder.snippets ?? []).map((snippet, snippetIndex) => {
            const snippetWhere = `${where}.snippets[${snippetIndex}]`;
            if (typeof snippet?.content !== 'string')
                throw new SnippetParseError(`${snippetWhere}.content must be a string`);
            if (snippet.title !== undefined && typeof snippet.title !== 'string')
                throw new SnippetParseError(`${snippetWhere}.title must be a string`);
            return {
                id: `${folderIndex}/${snippetIndex}`,
                title: snippet.title ?? snippet.content,
                content: snippet.content,
                enabled: snippet.enabled !== false,
            };
        });

        return {
            id: `${folderIndex}`,
            title: folder.title,
            enabled: folder.enabled !== false,
            snippets,
        };
    });
}
