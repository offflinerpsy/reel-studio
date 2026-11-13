# Reel Studio

Reel Studio ist ein Open-Source-Arbeitsbereich zum Planen und Produzieren kurzer Videos von Alex Yarosh. Er vereint Entwürfe, wiederverwendbare Vorlagen, Videoversionen, Verbindungen sowie Freigabe- und Veröffentlichungsnachweise.

[English](README.md) · [Русский](README.ru.md) · [Español](README.es.md) · [简体中文](README.zh-CN.md)

Das Projekt ist **Beta-Software**. Prüfe Video, Rechte und Ziel vor der Veröffentlichung. Ein Eintrag im Studio belegt für sich genommen keine Veröffentlichung auf einer Plattform. Die Möglichkeiten hängen vom Host und der Integration ab; siehe [Host-Kompatibilität](docs/hosts.md) auf Englisch.

## Erste Schritte

Du benötigst Node.js 22 oder neuer und FFmpeg mit `ffprobe` im Suchpfad. Für eine tatsächliche Generierung sind außerdem eine Codex-Authentifizierung und die Zugangsdaten der gewählten Integrationen erforderlich. Zugangsdaten und persönliche Videos gehören nicht ins Repository.

```sh
git clone https://github.com/offflinerpsy/reel-studio.git
cd reel-studio
npm run setup
npm run build
npm test
npm run preview
```

Die lokale Vorschau verwendet isolierte Daten. Die englische [Anleitung](docs/getting-started.md) beschreibt die Befehle zum Paketieren und Synchronisieren.

Das gemeinsame React-Studio und die MCP App liegen in `packages/studio`; Codex bettet die App mit den Darstellungsstilen des Hosts ein. `packages/bb` enthält einen nativen BB-Adapter auf Basis von `@get-bb/plugin-sdk`. Build und Synchronisierung verwenden eine gemeinsame Quelle und erkennen Konflikte. Mehr dazu in der [Architektur](docs/architecture.md).

Videoversionen sind unveränderlich; Entwürfe und Vorlagen lassen sich bearbeiten. Eine externe Aktion muss durch das jeweilige Ziel bestätigt werden.

Hinweise zur Mitarbeit stehen in [CONTRIBUTING.md](CONTRIBUTING.md), zur Meldung von Sicherheitsproblemen in [SECURITY.md](SECURITY.md). Der Code des Autors steht unter der [MIT-Lizenz](LICENSE); für Komponenten Dritter gelten deren eigene Bedingungen. Persönliche fertige Videos sind nicht enthalten.
