/** Work limits for generic OWA envelopes; not a bound on V8's initial object-key enumeration. */
interface WalkOptions {
    depth?: number;
    arrayEntries?: number;
    skip?: ReadonlySet<string>;
}

const MAX_NODES = 5000;
const MAX_PROPERTIES = 200;

/**
 * Visits at most 5000 values, stopping the actual array/property loops when exhausted. A callback
 * returning false stops the whole search. Unknown envelope names remain supported. Unlike entries
 * followed by slice, this never reads/allocates a pair for every property of a wide object. V8 still
 * enumerates keys first; json.ts bounds network structures before JSON.parse. Direct callers retain
 * that linear key-enumeration cost, while value reads and recursive traversal remain bounded here.
 */
export function walkJson(
    input: unknown,
    visit: (value: Record<string, unknown>) => boolean | void,
    options: WalkOptions = {},
): void {
    let remaining = MAX_NODES;
    let stopped = false;
    const seen = new WeakSet<object>();
    const walk = (value: unknown, depth: number): void => {
        if (stopped || remaining <= 0) return;
        remaining -= 1;
        if (depth > (options.depth ?? 40) || !value || typeof value !== 'object' || seen.has(value))
            return;
        seen.add(value);
        if (Array.isArray(value)) {
            const count = Math.min(value.length, options.arrayEntries ?? MAX_NODES);
            for (let i = 0; i < count && remaining > 0 && !stopped; i++) walk(value[i], depth + 1);
            return;
        }
        const record = value as Record<string, unknown>;
        if (visit(record) === false) {
            stopped = true;
            return;
        }
        let count = 0;
        // Keys alone are materialized (also done internally by V8's for-in); values/pairs are not.
        for (const key of Object.keys(record)) {
            if (count >= MAX_PROPERTIES || remaining <= 0 || stopped) break;
            count += 1;
            if (!options.skip?.has(key)) walk(record[key], depth + 1);
        }
    };
    walk(input, 0);
}
