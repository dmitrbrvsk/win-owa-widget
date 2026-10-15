const MAX_DEPTH = 48;
const MAX_PROPERTIES = 1024;
const MAX_ARRAY_ITEMS = 6000;
const MAX_STRUCTURE = 200_000;

interface Frame {
    kind: string;
    count: number;
}

function countEntry(frame: Frame | undefined, char: string): void {
    if (frame?.kind === '{' && char === ':') {
        frame.count += 1;
        if (frame.count > MAX_PROPERTIES) throw new Error('OWA JSON structure exceeds limit');
    } else if (frame?.kind === '[' && char === ',') {
        frame.count += 1;
        if (frame.count >= MAX_ARRAY_ITEMS) throw new Error('OWA JSON structure exceeds limit');
    }
}

/**
 * Bound structure before JSON.parse allocates objects/arrays. The HTTP layer also caps bytes.
 * This is a resource preflight, not a grammar parser: JSON.parse still validates the document.
 * Counting punctuation outside strings avoids materializing a hostile object's entire key list.
 */
function checkStructure(text: string): void {
    const stack: Frame[] = [];
    let quoted = false;
    let structure = 0;
    for (let i = 0; i < text.length; i++) {
        const char = text[i];
        if (quoted) {
            if (char === '\\') i += 1;
            else if (char === '"') quoted = false;
            continue;
        }
        if (char === '"') {
            quoted = true;
            continue;
        }
        switch (char) {
            case '{':
            case '[':
                stack.push({ kind: char, count: 0 });
                structure += 1;
                if (stack.length > MAX_DEPTH) throw new Error('OWA JSON structure exceeds limit');
                break;
            case '}':
            case ']':
                stack.pop();
                break;
            case ':':
            case ',':
                structure += 1;
                countEntry(stack.at(-1), char);
                break;
            default:
                break;
        }
        if (structure > MAX_STRUCTURE) throw new Error('OWA JSON structure exceeds limit');
    }
}

/** Parse server JSON only after checking its resource budget. */
export function parseOwaJson(text: string): unknown {
    checkStructure(text);
    return JSON.parse(text);
}
