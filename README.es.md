# Reel Studio

[English](README.md) · [Русский](README.ru.md) · **Español** · [Deutsch](README.de.md) · [简体中文](README.zh-CN.md)

**De la idea a una versión revisada de tu video corto, dentro de Codex o BB.**

Reel Studio es un proyecto de código abierto de Alex Yarosh. Reúne ideas, materiales, plantillas de animación editables y versiones de video. Cada aprobación corresponde a un video, texto y destino concretos.

## Qué puedes crear

- Usa tus materiales o adapta [Kinetic Promo](examples/kinetic-promo/README.md) y [Portfolio Showreel](examples/portfolio-showreel/README.md).
- Edita composiciones en HTML, GSAP y Three.js y renderiza localmente con HyperFrames y FFmpeg.
- Revisa los videos y sus versiones antes de aprobarlos.
- Exporta video y texto o prepara la publicación mediante navegador para YouTube, TikTok o Instagram, según el entorno instalado.

El renderizador no requiere HeyGen. Puedes aportar imágenes o usar una herramienta disponible por separado; no incluye generación automática de imágenes ni créditos de API.

## Tus herramientas y cuentas

La producción utiliza el CLI oficial de Codex o Claude Code, con tu cuenta y suscripción, en el equipo de Studio. El panel funciona en Codex o BB. Claude Code ejecuta tareas, no aloja el panel.

Puedes conectar Azure Speech para narrar guiones completos, DataForSEO para investigar búsquedas de YouTube y Telegram para enviar explícitamente un video seleccionado. Azure y DataForSEO se facturan por separado.

YouTube OAuth comprueba tu canal mediante tu cliente OAuth de escritorio de Google. Hay funciones auxiliares de carga por API, pero aún no un flujo completo en el panel. La publicación mediante navegador requiere un entorno compatible y una sesión autenticada. Comprueba el resultado en la plataforma.

## Primeros pasos

Versión actual: **[0.4.1 beta](https://github.com/offflinerpsy/reel-studio/releases/tag/v0.4.1)**. Necesitas Node.js 22+, npm, FFmpeg y `ffprobe`; los ejemplos también requieren Python 3. La interfaz y la documentación técnica están en inglés.

Consulta la [instalación (English)](docs/getting-started.md), la [compatibilidad (English)](docs/hosts.md) y las [cuentas y costos (English)](docs/provider-setup.md). Empieza con una biblioteca de prueba independiente. La instalación pública no migra automáticamente los datos ni la configuración de una instalación privada existente.

## Participa a tu manera

Puedes crear un fork, informar de un problema o proponer un pull request. Consulta [cómo contribuir (English)](CONTRIBUTING.md) y la [guía de pruebas (English)](docs/testing.md). El código del autor usa la [licencia MIT](LICENSE); los componentes externos conservan sus condiciones. El repositorio no incluye videos personales terminados.

Si Reel Studio te resulta útil, puedes darle una [estrella en GitHub](https://github.com/offflinerpsy/reel-studio).
