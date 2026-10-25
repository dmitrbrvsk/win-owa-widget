// "Frequent" chips of the "Create meeting" form: the people and places met most, one click each.
// The list comes from this computer only (see FrequentApi); nothing is asked of the server.
import { useEffect, useState } from 'react';

import { emailKey } from '../shared/email';
import { type FrequentSuggestions } from '../shared/frequent';
import { type Dict } from '../shared/i18n';
import { type PersonSuggestion } from '../shared/types';

import { api } from './api';
import { Icon } from './icons';

const MAX_PEOPLE_CHIPS = 6;
const MAX_PLACE_CHIPS = 4;

const NONE: FrequentSuggestions = { people: [], places: [] };

/** Asked again whenever the privacy mode is switched off: while it is on, the window holds no names or places. */
export function useFrequent(privacy: boolean): FrequentSuggestions {
    const [frequent, setFrequent] = useState<FrequentSuggestions>(NONE);
    // Dropped as soon as the privacy mode is on, not only hidden.
    if (privacy && frequent !== NONE) setFrequent(NONE);
    useEffect(() => {
        if (privacy) return;
        let alive = true;
        api.getFrequent()
            .then((f) => {
                if (alive) setFrequent(f);
            })
            .catch(() => {});
        return () => {
            alive = false;
        };
    }, [privacy]);
    return privacy ? NONE : frequent;
}

export function PeopleChips({
    people,
    taken,
    t,
    onAdd,
}: {
    people: PersonSuggestion[];
    taken: ReadonlySet<string>;
    t: Dict;
    onAdd: (p: PersonSuggestion) => void;
}) {
    const shown = people.filter((p) => !taken.has(emailKey(p.email))).slice(0, MAX_PEOPLE_CHIPS);
    if (!shown.length) return null;
    return (
        <div className='form-row tight'>
            <span className='form-label hint'>{t.frequentLabel}</span>
            <div className='quick-chips'>
                {shown.map((p) => (
                    <button
                        key={p.email}
                        type='button'
                        className='quick-chip nowrap'
                        title={`${t.frequentAdd(p.name)} <${p.email}>`}
                        aria-label={t.frequentAdd(p.name)}
                        onClick={() => onAdd(p)}
                    >
                        <Icon name='plus' size={12} />
                        {p.name}
                    </button>
                ))}
            </div>
        </div>
    );
}

export function PlaceChips({
    places,
    location,
    t,
    onPick,
}: {
    places: string[];
    location: string;
    t: Dict;
    onPick: (place: string) => void;
}) {
    if (location.trim() || !places.length) return null;
    return (
        <div className='form-row tight'>
            <span className='form-label hint'>{t.frequentLabel}</span>
            <div className='quick-chips'>
                {places.slice(0, MAX_PLACE_CHIPS).map((p) => (
                    <button
                        key={p}
                        type='button'
                        className='quick-chip nowrap'
                        title={t.frequentPlace(p)}
                        aria-label={t.frequentPlace(p)}
                        onClick={() => onPick(p)}
                    >
                        <Icon name='pin' size={12} />
                        {p}
                    </button>
                ))}
            </div>
        </div>
    );
}
