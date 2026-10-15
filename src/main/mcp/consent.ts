import { type McpAccess } from '../../shared/mcp';

/** Native-only consent; no meeting text or renderer-supplied prose enters this dialog. */
export function mcpConsent(access: McpAccess, english: boolean): Electron.MessageBoxOptions {
    const scopes = english
        ? ['Meeting times and status. Titles remain hidden.', 'Meeting times, status and titles.']
        : [
              'Время и статус встреч. Названия остаются скрытыми.',
              'Время, статус и названия встреч.',
          ];
    const scope = scopes[access.allowTitles ? 1 : 0];
    return {
        type: 'warning',
        title: 'OWA Widget — MCP',
        message: english
            ? 'Allow local MCP clients to read your calendar?'
            : 'Разрешить локальным MCP-клиентам читать календарь?',
        detail: `${scope}\n\n${
            english
                ? 'Only meetings already loaded by the widget are available. No writing, attendees, bodies, notes or credentials. Privacy mode hides titles.\n\nA connected AI client may send this data to its provider. Check your company policy and connect only trusted clients. Turn MCP off in Settings to revoke access.'
                : 'Доступны только уже загруженные виджетом встречи. Без записи, участников, текстов, заметок и учетных данных. Режим приватности скрывает названия.\n\nПодключенный ИИ-клиент может передать эти данные своему провайдеру. Проверьте правила компании и подключайте только доверенные клиенты. Чтобы отозвать доступ, выключите MCP в настройках.'
        }`,
        buttons: english ? ['Cancel', 'Allow reading'] : ['Отмена', 'Разрешить чтение'],
        defaultId: 0,
        cancelId: 0,
        noLink: true,
    };
}
