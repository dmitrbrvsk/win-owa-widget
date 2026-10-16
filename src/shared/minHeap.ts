/** Small binary min-heap; insertion and removal visit at most log2(size) entries. */
export class MinHeap<T> {
    private readonly items: T[] = [];

    constructor(private readonly compare: (a: T, b: T) => number) {}

    peek(): T | undefined {
        return this.items[0];
    }

    clear(): void {
        this.items.length = 0;
    }

    push(value: T): void {
        let index = this.items.length;
        this.items.push(value);
        while (index > 0) {
            const parent = Math.floor((index - 1) / 2);
            if (this.compare(this.items[parent], value) <= 0) break;
            this.items[index] = this.items[parent];
            index = parent;
        }
        this.items[index] = value;
    }

    pop(): T | undefined {
        const first = this.items[0];
        const last = this.items.pop();
        if (!this.items.length || last === undefined) return first;
        let index = 0;
        while (index * 2 + 1 < this.items.length) {
            let child = index * 2 + 1;
            const right = child + 1;
            if (right < this.items.length && this.compare(this.items[right], this.items[child]) < 0)
                child = right;
            if (this.compare(last, this.items[child]) <= 0) break;
            this.items[index] = this.items[child];
            index = child;
        }
        this.items[index] = last;
        return first;
    }
}
