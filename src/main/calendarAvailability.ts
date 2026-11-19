import { availabilityFromEvents, SLOT_MINUTES } from '../shared/availability';
import { type AvailabilityRequest, type AvailabilityResult } from '../shared/types';

import { type CalendarService } from './calendarService';

export async function combinedAvailability(
    selected: CalendarService,
    services: CalendarService[],
    request: AvailabilityRequest,
): Promise<AvailabilityResult> {
    const revisions = services.map((service) => service.accountRevision);
    const responses = await Promise.allSettled(
        services.map((service) =>
            service.availability(service === selected ? request : { ...request, emails: [] }),
        ),
    );
    const selectedResponse = responses[services.indexOf(selected)];
    if (!selectedResponse) throw new Error('Аккаунт не настроен');
    if (selectedResponse.status === 'rejected') throw selectedResponse.reason;
    const { people, self } = selectedResponse.value;
    const start = Date.parse(request.start);
    const end = Date.parse(request.end);
    const slots = Math.ceil((end - start) / (SLOT_MINUTES * 60_000));
    const unknown = '4'.repeat(slots);
    const own = responses.map((response, index) => {
        const service = services[index];
        if (service.accountRevision !== revisions[index]) return unknown;
        if (response.status === 'rejected') return unknown;
        if (response.value.self) return response.value.self.digits;
        if (service.sync.phase !== 'ok' || !service.sync.lastSuccess) return unknown;
        return availabilityFromEvents(
            service.events,
            start,
            end,
            new Date(service.sync.lastSuccess),
            'me',
        ).digits;
    });
    return {
        start: request.start,
        end: request.end,
        slotMinutes: SLOT_MINUTES,
        self: { email: 'me', digits: mergeOwnBusy(own, slots) },
        people: people.filter((person) => person.email !== self?.email),
    };
}

export function mergeOwnBusy(accounts: readonly string[], slots: number): string {
    const priority = ['0', '1', '4', '2', '3'];
    return Array.from({ length: slots }, (_, slot) => {
        const rank = accounts.reduce(
            (max, digits) => {
                const next = priority.indexOf(digits[slot]);
                return Math.max(max, next === -1 ? 2 : next);
            },
            accounts.length ? 0 : 2,
        );
        return priority[rank];
    }).join('');
}
