# Reel Studio

Reel Studio es un espacio de trabajo de código abierto para planificar y producir vídeos cortos, creado por Alex Yarosh. Reúne borradores, plantillas reutilizables, versiones de vídeo, conexiones y registros de aprobación y publicación.

[English](README.md) · [Русский](README.ru.md) · [Deutsch](README.de.md) · [简体中文](README.zh-CN.md)

El proyecto está en fase **beta**. Revisa el vídeo, los permisos y el destino antes de publicar. Un registro en el estudio no demuestra que la plataforma haya publicado el vídeo. Las capacidades varían según el entorno y la integración; consulta la [compatibilidad](docs/hosts.md), en inglés.

## Primeros pasos

Necesitas Node.js 22 o posterior y FFmpeg con `ffprobe` disponible en la ruta de ejecución. La generación real también requiere autenticación de Codex y las credenciales de las integraciones elegidas. No guardes credenciales ni vídeos personales en el repositorio.

```sh
git clone https://github.com/offflinerpsy/reel-studio.git
cd reel-studio
npm run setup
npm run build
npm test
npm run preview
```

La vista previa local utiliza datos aislados. La [guía de inicio](docs/getting-started.md), en inglés, explica los comandos de empaquetado y sincronización.

El estudio React compartido y la MCP App están en `packages/studio`; Codex integra la aplicación con los estilos del entorno. `packages/bb` contiene un adaptador nativo de BB creado con `@get-bb/plugin-sdk`. La compilación y la sincronización parten de una sola fuente y detectan cambios en conflicto. Consulta la [arquitectura](docs/architecture.md).

Las versiones de vídeo son inmutables; los borradores y las plantillas se pueden editar. Una acción externa necesita confirmación del propio destino.

Consulta [CONTRIBUTING.md](CONTRIBUTING.md) y [SECURITY.md](SECURITY.md). El código del autor se distribuye bajo la [licencia MIT](LICENSE); los componentes de terceros conservan sus propias condiciones. El repositorio no incluye vídeos personales terminados.
