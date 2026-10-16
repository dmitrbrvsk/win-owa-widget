import { type RefObject, useEffect, useMemo } from 'react';

import {
    availabilityFromEvents,
    type AvailabilityGrid,
    buildGrid,
    type GridOptions,
} from '../shared/availability';
import { type AvailabilityResult, type CalendarEvent } from '../shared/types';

interface GridInput extends GridOptions {
    result: AvailabilityResult | null;
    events: readonly CalendarEvent[];
    windowStart: number;
    windowEnd: number;
    now: Date;
}

export function useAvailabilityGrid({
    result,
    events,
    windowStart,
    windowEnd,
    now,
    workdayStartHour,
    workdayEndHour,
    showWeekends,
}: GridInput): { grid: AvailabilityGrid; today: number } {
    // Coverage changes at local midnight, not on every clock tick. Resolve the zone on each
    // render too: changing the system zone can affect the week even at the same UTC offset.
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const { timeZone } = Intl.DateTimeFormat().resolvedOptions();
    const localDay = useMemo(() => ({ today, timeZone }), [today, timeZone]);
    const grid = useMemo(() => {
        const me =
            result?.self ??
            availabilityFromEvents(events, windowStart, windowEnd, new Date(localDay.today), 'me');
        const others = (result?.people ?? []).filter((p) => p.email !== result?.self?.email);
        return buildGrid(windowStart, windowEnd, [{ ...me, self: true }, ...others], {
            workdayStartHour,
            workdayEndHour,
            showWeekends,
        });
    }, [
        result,
        events,
        windowStart,
        windowEnd,
        workdayStartHour,
        workdayEndHour,
        showWeekends,
        localDay,
    ]);
    return { grid, today };
}

export function useAvailabilityGridScroll(
    scroller: RefObject<{ scrollLeft: number } | null>,
    grid: AvailabilityGrid,
    today: number,
    cellWidth: number,
): void {
    const { days } = grid;
    const geometry = days.map((d) => `${d.date}:${d.first}:${d.count}`).join('|');
    const day = days.find((d) => d.date === today);
    const initialLeft = day ? Math.max(0, day.first * cellWidth - cellWidth * 2) : 0;

    // Reposition for a new week, local day or column layout. Refreshed people/status data
    // recreates days too, so array identity must not replace a user's manual position.
    useEffect(() => {
        const el = scroller.current;
        // eslint-disable-next-line react-hooks/immutability -- The ref points to a mutable DOM scroller, not component data.
        if (el) el.scrollLeft = initialLeft;
    }, [scroller, grid.windowStart, grid.windowEnd, today, geometry, initialLeft, cellWidth]);
}
