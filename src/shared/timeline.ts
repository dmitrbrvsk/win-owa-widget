// Side-by-side layout of overlapping meetings on a day timeline.
import type { CalendarEvent } from './types';

export interface TimelineBlock {
  event: CalendarEvent;
  /** Minutes from local midnight, clipped to [0, 1440]. */
  startMin: number;
  endMin: number;
  lane: number;
  lanes: number;
}

export interface Workday {
  startHour: number;
  endHour: number;
}

/**
 * Hours the timeline draws: the working day, widened to whole hours so that every meeting of the
 * day (and the "now" line, when the day is today) stays in view.
 */
export function visibleRange(blocks: TimelineBlock[], workday: Workday, nowMin?: number): { startMin: number; endMin: number } {
  let startMin = Math.max(0, Math.min(23, workday.startHour)) * 60;
  let endMin = Math.max(startMin + 60, Math.min(24, workday.endHour) * 60);
  for (const b of blocks) {
    startMin = Math.min(startMin, Math.floor(b.startMin / 60) * 60);
    endMin = Math.max(endMin, Math.ceil(Math.max(b.endMin, b.startMin + 1) / 60) * 60);
  }
  if (nowMin !== undefined) {
    startMin = Math.min(startMin, Math.floor(nowMin / 60) * 60);
    endMin = Math.max(endMin, Math.min(1440, Math.ceil((nowMin + 1) / 60) * 60));
  }
  return { startMin, endMin: Math.min(1440, endMin) };
}

export function layoutDay(events: CalendarEvent[], day: Date): TimelineBlock[] {
  const dayStart = new Date(day.getFullYear(), day.getMonth(), day.getDate()).getTime();
  const dayEnd = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1).getTime();
  // Total minutes of this calendar day (23 or 25 on DST switch days).
  const dayMinutes = (dayEnd - dayStart) / 60_000;

  const items = events
    .filter((e) => !e.isAllDay)
    .map((event) => {
      const s = Math.max(Date.parse(event.start), dayStart);
      const e = Math.min(Date.parse(event.end), dayEnd);
      return { event, startMin: (s - dayStart) / 60_000, endMin: Math.min(dayMinutes, (e - dayStart) / 60_000) };
    })
    .filter((x) => x.endMin > x.startMin || (x.endMin === x.startMin && x.startMin < dayMinutes))
    .sort((a, b) => a.startMin - b.startMin || b.endMin - a.endMin || a.event.title.localeCompare(b.event.title));

  const out: TimelineBlock[] = [];
  let cluster: Array<(typeof items)[number] & { lane: number }> = [];
  let clusterEnd = -1;
  let laneEnds: number[] = [];

  const flush = () => {
    const lanes = laneEnds.length || 1;
    for (const c of cluster) out.push({ event: c.event, startMin: c.startMin, endMin: c.endMin, lane: c.lane, lanes });
    cluster = [];
    laneEnds = [];
    clusterEnd = -1;
  };

  for (const item of items) {
    // A zero-length meeting still occupies a sliver so it does not collide invisibly.
    const end = Math.max(item.endMin, item.startMin + 1);
    if (cluster.length && item.startMin >= clusterEnd) flush();
    let lane = laneEnds.findIndex((le) => le <= item.startMin);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(end);
    } else {
      laneEnds[lane] = end;
    }
    cluster.push({ ...item, lane });
    clusterEnd = Math.max(clusterEnd, end);
  }
  if (cluster.length) flush();
  return out;
}
