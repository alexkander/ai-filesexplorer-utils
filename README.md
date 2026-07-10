# ai-filesexplorer-utils

Utilidades web para organizar archivos: conteo de archivos por directorio,
registro de checksums de contenido, sincronización de carpetas, entre otras.

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
./scripts/dev.sh
# equivalente a: docker compose up --build -d

./scripts/dev-down.sh
# equivalente a: docker compose down
```

El servicio corre con `network_mode: host`, por lo que queda disponible
directamente en `http://localhost:3000` del host. El código fuente se monta como
volumen para hot-reload; `node_modules` y `.next` quedan en volúmenes anónimos
dentro del contenedor para no chocar con los del host.

Este mismo `docker-compose.yml` es el que usa `.devcontainer/devcontainer.json`
(extensión Dev Containers de VS Code), así que ambas vías de desarrollo en
contenedor comparten exactamente la misma imagen y configuración — no hay nada
duplicado entre una y otra.

## Producción con Docker

```bash
./scripts/prod.sh
# equivalente a: docker compose -f docker-compose.prod.yml up --build -d

./scripts/prod-down.sh
# equivalente a: docker compose -f docker-compose.prod.yml down
```

Usa el stage `runner` del `Dockerfile` (build multi-stage), que corre el output
`standalone` de Next.js: una imagen mínima sin pnpm ni el código fuente
completo, solo el servidor compilado. Queda expuesto en `http://localhost:3000`
mapeando el puerto (sin `network_mode: host`, sin bind mounts).

## Variables de entorno

Actualmente el proyecto no requiere ninguna variable de entorno para funcionar.

Si se agregan en el futuro, seguir la convención de Next.js:

- `.env.local` para valores locales (no se versiona, agregar a `.gitignore`)
- Prefijo `NEXT_PUBLIC_` solo para variables que deban quedar expuestas al
  cliente/navegador
