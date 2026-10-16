import { type TimelineBlock } from './timeline';

// Presentation bounds only: every loaded record remains available through the page controls.
export const MEETINGS_PER_PAGE = 50;
export const TIMELINE_GRID_LIMIT = 100;
export const TIMELINE_LANE_LIMIT = 8;

export function usesMeetingPages(blocks: TimelineBlock[]): boolean {
    return (
        blocks.length > TIMELINE_GRID_LIMIT ||
        blocks.some((block) => block.lanes > TIMELINE_LANE_LIMIT)
    );
}

export function meetingPage<T>(items: T[], requestedPage: number) {
    const total = items.length;
    const pages = Math.max(1, Math.ceil(total / MEETINGS_PER_PAGE));
    const page = Math.max(0, Math.min(pages - 1, Math.trunc(requestedPage) || 0));
    const offset = page * MEETINGS_PER_PAGE;
    return {
        items: items.slice(offset, offset + MEETINGS_PER_PAGE),
        total,
        page,
        pages,
        start: total ? offset + 1 : 0,
        end: Math.min(total, offset + MEETINGS_PER_PAGE),
    };
}

export function meetingPageForId(items: Array<{ id: string }>, id?: string | null): number {
    const index = id ? items.findIndex((item) => item.id === id) : -1;
    return index < 0 ? 0 : Math.floor(index / MEETINGS_PER_PAGE);
}
