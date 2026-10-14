**TODO: главное изменение и его польза для пользователя.**

## Что изменилось

- **TODO: новая возможность или исправление.** Что стало доступно или как изменилось поведение.

### Важно

TODO: ограничения, совместимость или действия при обновлении. Удалите раздел, если он не нужен.

<details>
<summary>Установка и проверка файлов</summary>

## Установка

- **OWA-Widget-Setup-<версия>.exe** — установщик для Windows 10/11 x64; на ARM64 работает в эмуляции. Права администратора не нужны.
- **OWA-Widget-Setup-<версия>-arm64.exe** — отдельный установщик для Windows ARM64.
- **OWA-Widget-<версия>-portable-x64.zip** — распакуйте и запустите `OWA Widget.exe` без установки.

## Как проверить файлы

Установщик пока не подписан Authenticode, поэтому Windows SmartScreen может показать предупреждение. Перед запуском сверьте контрольную сумму с `SHA256SUMS.txt` из этого релиза:

```powershell
Get-FileHash .\OWA-Widget-Setup-<версия>.exe -Algorithm SHA256
gh attestation verify .\OWA-Widget-Setup-<версия>.exe --repo dmitrbrvsk/win-owa-widget
```

</details>

[Руководство](https://github.com/dmitrbrvsk/win-owa-widget/blob/master/docs/GUIDE.md) · [Безопасность версии](https://github.com/dmitrbrvsk/win-owa-widget/blob/v<версия>/SECURITY.md) · [Исходники](https://github.com/dmitrbrvsk/win-owa-widget/tree/v<версия>)
