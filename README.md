# ai-filesexplorer-utils

Utilidades web para organizar archivos: conteo de archivos por directorio, registro de checksums de contenido, sincronización de carpetas, entre otras.

## Requisitos

- Node.js 22+
- [pnpm](https://pnpm.io/) 11+ (o Docker, ver abajo)

## Desarrollo local

```bash
pnpm install
pnpm dev
```

La app queda disponible en [http://localhost:3000](http://localhost:3000).

Otros scripts disponibles:

```bash
pnpm build   # build de producción
pnpm start   # levanta el build de producción
```

## Desarrollo con Docker

```bash
docker compose up --build
```

El servicio corre con `network_mode: host`, por lo que queda disponible directamente en `http://localhost:3000` del host. El código fuente se monta como volumen para hot-reload; `node_modules` y `.next` quedan en volúmenes anónimos dentro del contenedor para no chocar con los del host.

## Variables de entorno

Actualmente el proyecto no requiere ninguna variable de entorno para funcionar.

Si se agregan en el futuro, seguir la convención de Next.js:

- `.env.local` para valores locales (no se versiona, agregar a `.gitignore`)
- Prefijo `NEXT_PUBLIC_` solo para variables que deban quedar expuestas al cliente/navegador
