// Strings of the keyboard shortcuts, free windows and frequent people (kept apart from i18n.ts).

export const ruShortcuts = {
    // system-wide key combinations
    hotkeysTitle: 'Горячие клавиши',
    hotkeysHint: 'Работают из любой программы. Нажмите на поле, затем сочетание клавиш.',
    hotkeyJoin: 'Подключиться к текущей встрече',
    hotkeyJoinHint:
        'Встреча со ссылкой, которая идёт или начнётся в ближайшие 10 минут. Если таких несколько, откроется виджет — выберите в нём.',
    hotkeyOpen: 'Открыть или скрыть виджет',
    hotkeyCreate: 'Новая встреча',
    hotkeyOff: 'Выключено',
    hotkeyRecording: 'Нажмите сочетание…',
    hotkeyInvalid:
        'Нужны две клавиши из Ctrl, Alt и Shift (одна из них Ctrl или Alt) и буква, цифра или F1–F24',
    hotkeyDuplicate: 'Это сочетание уже назначено другому действию',
    hotkeyBusy: 'Занято другой программой — выберите другое сочетание',
    hotkeyClear: 'Выключить',
    hotkeyReset: 'По умолчанию',
    hotkeysUnsaved: 'Новые сочетания заработают после «Сохранить»',
    // free time on the day view
    freeTimeSetting: 'Свободные окна и встречи подряд',
    freeTimeSettingHint:
        'Промежутки от 30 минут в рабочих часах видны на таймлайне; длинная серия встреч без перерыва (от 3 часов) отмечается предупреждением',
    freeNext: (range: string, dur: string) => `Свободно ${range} · ${dur}`,
    freeNextOn: (range: string, dur: string) => `Свободное окно ${range} · ${dur}`,
    freeNoneLeft: 'До конца рабочего дня свободных окон нет',
    freeBlock: 'Свободно',
    freeCreate: 'Создать встречу в это время',
    longStretch: (dur: string, range: string) => `${dur} встреч без перерыва: ${range}`,
    // frequent people and places
    frequentPeople: 'Часто',
    frequentAdd: (name: string) => `Добавить: ${name}`,
    frequentPlace: (place: string) => `Место: ${place}`,
    frequentHint:
        'Окно «Создать встречу» предлагает людей и места, с которыми вы чаще встречаетесь: по календарю и по встречам, созданным в виджете. Хранится только на этом компьютере, в зашифрованном виде.',
    frequentForget: 'Забыть частых участников',
    frequentForgotten: (n: number) => `Забыто записей: ${n}`,
    frequentNone: 'Запомненных участников и мест нет',
    // updates
};

export const enShortcuts: typeof ruShortcuts = {
    hotkeysTitle: 'Keyboard shortcuts',
    hotkeysHint: 'They work from any program. Click a field, then press the combination.',
    hotkeyJoin: 'Join the current meeting',
    hotkeyJoinHint:
        'A meeting with a link that is on or starts within 10 minutes. When there are several, the widget opens so you can choose.',
    hotkeyOpen: 'Show or hide the widget',
    hotkeyCreate: 'New meeting',
    hotkeyOff: 'Off',
    hotkeyRecording: 'Press a combination…',
    hotkeyInvalid:
        'Use two of Ctrl, Alt and Shift (one of them Ctrl or Alt) and a letter, a digit or F1–F24',
    hotkeyDuplicate: 'This combination is already used by another action',
    hotkeyBusy: 'Taken by another program — choose another combination',
    hotkeyClear: 'Turn off',
    hotkeyReset: 'Default',
    hotkeysUnsaved: 'New combinations start working after “Save”',
    freeTimeSetting: 'Free windows and back-to-back meetings',
    freeTimeSettingHint:
        'Gaps of 30 minutes or more within working hours show on the timeline; a run of meetings with no break (3 hours or more) gets a warning',
    freeNext: (range, dur) => `Free ${range} · ${dur}`,
    freeNextOn: (range, dur) => `Free window ${range} · ${dur}`,
    freeNoneLeft: 'No free windows left today',
    freeBlock: 'Free',
    freeCreate: 'Create a meeting at this time',
    longStretch: (dur, range) => `${dur} of meetings with no break: ${range}`,
    frequentPeople: 'Frequent',
    frequentAdd: (name) => `Add: ${name}`,
    frequentPlace: (place) => `Place: ${place}`,
    frequentHint:
        'The “Create meeting” window offers the people and places you meet most: from your calendar and from meetings created in the widget. Kept on this computer only, encrypted.',
    frequentForget: 'Forget frequent people',
    frequentForgotten: (n) => `Entries forgotten: ${n}`,
    frequentNone: 'Nothing remembered yet',
};
