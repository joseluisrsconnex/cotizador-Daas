# Novotechno · Cotizador DaaS

Cotizador de dispositivos y servicios con escenarios, versiones, exportaciones PDF/Excel, propuesta Word y administración de usuarios y parámetros. Esta entrega prepara su operación fuera de Replit: **no cambia fórmulas, precios ni permisos**, ni transfiere cuentas o datos automáticamente.

## Arquitectura y requisitos

- `artifacts/cotizador-daas`: React 19, Vite 7, TypeScript; SPA en `/`. PDF y Excel se generan en el navegador.
- `artifacts/api-server`: Express 5, Clerk Express, Drizzle; API en `/api`, propuesta Word generada en memoria desde `server/templates/propuesta-daas.docx`. El build copia esta plantilla al servidor compilado.
- PostgreSQL: usuarios locales, roles, bloqueos, auditoría, cotizaciones, versiones, snapshots y parámetros. No usa disco local ni App Storage para persistir archivos de usuarios. Respaldar PostgreSQL y conservar la plantilla Word y `client/public`.
- Clerk: identidad y sesiones; los permisos efectivos se consultan en PostgreSQL, no en claims de roles de Clerk.
- `shared`: cálculo y catálogo; `lib/db`: esquema; `lib/api-spec`, `lib/api-zod`, `lib/api-client-react`: contrato OpenAPI y clientes generados. `artifacts/mockup-sandbox` es auxiliar de diseño, no forma parte del servicio externo.

Versiones de referencia: **Node 24.22.1, pnpm 10.26.1, PostgreSQL 16**. Node/pnpm se fijan en `package.json`; Docker usa Debian/glibc y `linux/amd64`. El lockfile actual excluye binarios nativos de otras arquitecturas: **no usar Alpine, ARM o instalación nativa macOS/Windows** sin revisar esos overrides y regenerar el lockfile en un cambio separado. En Apple Silicon usar la plataforma amd64 de Compose (requiere emulación).

## Variables

Copiar `.env.example` a `.env`, sustituir los ejemplos y protegerlo con permisos de lectura limitados. No subirlo a Git. Los scripts **no cargan automáticamente** el `.env` raíz; para una terminal POSIX:

```sh
cp .env.example .env
# Editar .env fuera de este documento; no pegar claves en tickets o logs.
set -a
. ./.env
set +a
corepack enable
corepack prepare pnpm@10.26.1 --activate
pnpm install --frozen-lockfile
```

Usar valores compatibles con sintaxis de shell y poner entre comillas valores con espacios o caracteres especiales. En un servicio de producción, inyectar las variables con su gestor de secretos en lugar de cargar un archivo. Nunca ejecutar `env`, imprimir la conexión o compartir la salida interpolada de `docker compose config`.

| Variable | Fase | Uso / ejemplo ficticio |
|---|---|---|
| `DATABASE_URL` | Ejecución, migraciones, tests | Obligatoria. PostgreSQL estándar, por ejemplo `postgresql://cotizador:change-me-local-only@localhost:5432/cotizador`. Codificar caracteres reservados de usuario/contraseña en URL. En servicio administrado configurar TLS y CA según su proveedor; no desactivar la validación TLS. |
| `PORT` | Ejecución / Vite build y dev | Puerto del servidor. `3000` para API y producción, `5173` para Vite local. Replit lo inyecta por servicio. |
| `NODE_ENV` | Ejecución / build | `production` en producción, `development` para desarrollar. Cambia logs y disponibilidad del proxy administrado. |
| `LOG_LEVEL` | Ejecución | Opcional, `info` por defecto. Evitar logs detallados con datos personales. |
| `INITIAL_ADMIN_EMAIL` | Ejecución | Correo del primer administrador, ejemplo `admin@example.com`; no crea una cuenta Clerk ni envía invitaciones. |
| `PROPOSAL_TEMPLATE_EMAIL_1` | Ejecución | Primer correo de contacto de la propuesta Word: `contact@example.com`. Obligatorio para generar propuestas. |
| `PROPOSAL_TEMPLATE_EMAIL_2` | Ejecución | Segundo correo de contacto de la propuesta Word: `sales@example.com`. Obligatorio para generar propuestas. |
| `CLERK_SECRET_KEY` | Ejecución | Obligatoria, clave secreta del entorno Clerk elegido. **Nunca** en build args ni `VITE_*`. |
| `CLERK_PUBLISHABLE_KEY` | Ejecución | Clave pública del mismo entorno Clerk. |
| `CLERK_PROXY_ENABLED` | Ejecución | `false` fuera de Replit: usa la clave explícita y desactiva `/api/__clerk`. Ausente conserva el comportamiento administrado existente. |
| `CLERK_AUTHORIZED_PARTIES` | Ejecución | Orígenes exactos separados por coma, sin rutas: `https://cotizador.example.com`; local `http://localhost:3000,http://localhost:5173`. Limita el origen autorizado del token en Clerk. Configurar siempre fuera de Replit. |
| `TRUST_PROXY` | Ejecución | Opcional; vacío = Express no confía en proxies. `1` solo con exactamente un ingress controlado; admite lista de IP/subredes de Express. No usar `true` globalmente. |
| `STATIC_DIR` | Ejecución | Activa frontend compilado en Express. Con `pnpm start`: `../cotizador-daas/dist/public`. Se resuelve desde el directorio de trabajo **del servidor** (`artifacts/api-server` al usar pnpm). Ausente conserva los servicios separados de Replit. |
| `VITE_CLERK_PUBLISHABLE_KEY` | **Build** / Vite dev | Clave pública, debe coincidir con `CLERK_PUBLISHABLE_KEY`. Se incorpora al JS público. |
| `VITE_CLERK_PROXY_ENABLED` | **Build** / Vite dev | `false` fuera de Replit; evita inferir claves por hostname. Ausente conserva Replit. |
| `VITE_CLERK_PROXY_URL` | **Build** / Vite dev | Vacía en Clerk directo. Solo para un proxy Clerk configurado explícitamente; no confundir con un proxy HTTP de desarrollo. |
| `BASE_PATH` | **Build** / Vite dev | `/` en esta entrega. No se admite montar la entrega externa bajo un subdirectorio sin adaptar también API y servidor SPA. |
| `LOCAL_API_PROXY` | Vite dev | `http://127.0.0.1:3000` para desarrollo independiente con dos procesos. Dejar sin definir en Replit; no se usa en producción. |
| `POSTGRES_DB` | Compose | Nombre de base inicial: `cotizador`. |
| `POSTGRES_USER` | Compose | Usuario inicial local: `cotizador`. |
| `POSTGRES_PASSWORD` | Compose | Contraseña ficticia de ejemplo: `change-me-local-only`. Sustituir antes de usar. Para Compose elegir caracteres URL seguros o adaptar `DATABASE_URL` para codificarlos. |

No hay `ALLOWED_EMAIL_DOMAINS`, `SESSION_SECRET` ni variables de almacenamiento necesarias en el runtime actual. `SESSION_SECRET` disponible en algunos entornos no es usado por esta app. Las variables automáticas Vite `BASE_URL`, `DEV` y `PROD` derivan de su build. `REPL_ID` activa herramientas visuales de desarrollo de Replit; no se necesita externamente.

**Cambiar una variable `VITE_*` exige reconstruir el frontend o la imagen**; reiniciar el contenedor no basta. Las claves ficticias de `.env.example` no permiten autenticarse. No utilizar claves de desarrollo en producción.

## Base de datos: migración y seed

Antes de tocar una base existente, detener escritores, crear respaldo completo con `pg_dump` y verificar que se puede restaurar en una base separada. Mantener la versión anterior del código para recuperar el servicio tras restauración. Ejecutar **un único proceso de migración**, no cada réplica al mismo tiempo.

Con `DATABASE_URL` ya exportada:

```sh
pnpm db:migrate
pnpm db:seed
```

Orden real de `db:migrate`:
1. Detecta base nueva o existente. En una existente ejecuta el renombrado transaccional de Cotización ID **antes** de introspección Drizzle. Aborta ante esquema parcial o conflictos históricos.
2. `pnpm --filter @workspace/db run push` compara y aplica el esquema actual. En una base nueva crea tablas, enums, relaciones, índices y checks. El wrapper exige una confirmación positiva del resultado y se detiene si Drizzle solicita interacción (incluso si devuelve código cero). Si ocurre, tras respaldo y revisión ejecutar `pnpm --filter @workspace/api-server deploy:prepare`, luego `pnpm --filter @workspace/db push` en terminal interactiva, revisar la propuesta y volver a `pnpm db:migrate`. **No aceptar pérdidas de datos ni usar `push-force`**. Es sincronización Drizzle, no una colección de migraciones SQL versionadas. Automatizar únicamente los cambios de esquema ya revisados en una copia.
3. Aplica migraciones idempotentes de versiones y escenarios históricos.

`db:seed` utiliza la configuración inicial ya incluida en `shared/pricing.ts` y las migraciones existentes de configuración. Inserta `default` únicamente si falta; no resetea parámetros administrativos existentes. Completa/normaliza los campos de evoluciones previas y registra auditoría según las reglas existentes; no recalcula snapshots ni importes de cotizaciones. Es seguro repetir ambos comandos sin cambios de esquema. El servidor también ejecuta las migraciones de datos idempotentes al arrancar, pero **no crea el esquema**.

El renombrado no inventa IDs ante duplicados o inconsistencias: informa los registros y bloquea la operación. El repositorio conserva una corrección puntual previamente autorizada de tres IDs vacíos históricos, no una regla general de asignación. No editar IDs históricos automáticamente. Revisar conflictos por un canal privado.

## Desarrollo independiente

Se necesita PostgreSQL disponible y Clerk de desarrollo propio. Tras migrar y cargar precios, en dos terminales con las variables exportadas:

```sh
# Terminal 1: no servir el build SPA antiguo mientras se desarrolla.
STATIC_DIR= NODE_ENV=development PORT=3000 pnpm --filter @workspace/api-server dev

# Terminal 2: proxy opcional explícito solo fuera de Replit.
NODE_ENV=development PORT=5173 BASE_PATH=/ LOCAL_API_PROXY=http://127.0.0.1:3000 \
  pnpm --filter @workspace/cotizador-daas dev
```

Abrir `http://localhost:5173`. La API permanece en `/api` y el navegador usa el mismo origen gracias al proxy de desarrollo. En Replit usar los workflows existentes, sin `LOCAL_API_PROXY` ni `STATIC_DIR`; los puertos y el encaminamiento los administra la plataforma.

## Build y producción sin Docker

```sh
# Desde la raíz y con el entorno exportado:
PORT=3000 BASE_PATH=/ pnpm build:app
# Si aún no se hizo, sobre la base destino respaldada:
pnpm db:migrate
pnpm db:seed
NODE_ENV=production PORT=3000 STATIC_DIR=../cotizador-daas/dist/public pnpm start
```

Abrir `http://localhost:3000` para prueba local. Un solo proceso sirve la SPA, sus assets, rutas profundas (`/sign-in`, `/sign-up`, `/cotizador`, `/cotizaciones`, etc.) y `/api`. Rutas API inexistentes devuelven 404 JSON, no HTML de la SPA; los assets inexistentes tampoco reciben HTML. `/api/healthz` confirma proceso disponible, **no prueba conectividad continua a PostgreSQL ni Clerk**.

En producción poner Nginx, Caddy o el balanceador de su infraestructura delante del puerto privado de la app, con HTTPS y certificado válido para `cotizador.example.com`. Preservar `Host` y sobreescribir `X-Forwarded-Host`, `X-Forwarded-Proto` y `X-Forwarded-For` con valores confiables; rechazar hosts ajenos en el ingress. No permitir acceso directo desde Internet al proceso saltándose ese ingress. La protección de mismo origen existente usa el host reenviado; `TRUST_PROXY` por sí solo **no sanea** esos encabezados. Configurar en el ingress límites de petición y timeouts apropiados. No se necesita CORS entre dominios: frontend y API deben usar el mismo origen.

## Docker Compose (aplicación + PostgreSQL)

Requiere Docker con Compose v2 en el equipo destino. **No se han ejecutado contenedores dentro de Replit**.

```sh
cp .env.example .env
# Sustituir claves Clerk, correo inicial, orígenes y contraseña.
# En local la app estará en http://localhost:3000; PORT cambia el puerto del host.
docker compose build app
docker compose up -d db
# Compose espera al healthcheck PostgreSQL antes del comando de app.
docker compose run --rm app pnpm db:migrate
docker compose run --rm app pnpm db:seed
docker compose up -d app
docker compose ps
curl --fail http://localhost:3000/api/healthz
```

Compose usa el hostname interno `db` para PostgreSQL (no `localhost` del contenedor); no publica el puerto PostgreSQL. El puerto de aplicación se liga a loopback para un ingress en el mismo host. Para un balanceador remoto configurar la red privada deliberadamente, no publicar la base. El volumen `postgres_data` persiste los datos; `docker compose down` lo conserva, **`down -v` los destruye**. Cambiar `POSTGRES_PASSWORD` en `.env` no cambia la contraseña de un volumen ya inicializado: hacerlo mediante administración PostgreSQL y actualizar la conexión.

Las migraciones no van en el comando de arranque del contenedor: deben ejecutarse una vez antes de iniciar/actualizar réplicas. Si una actualización de esquema solicita confirmación, realizarla de manera interactiva tras revisar el respaldo; no ignorar errores. El runtime incluye herramientas y fuentes de workspace para estos comandos; es intencional, no una imagen mínima. Solo las claves públicas llegan como build args; la clave secreta se inyecta en ejecución.

Para actualizar: respaldar, construir la nueva imagen con los mismos valores públicos, detener escritores, ejecutar migración y seed revisados, iniciar app y comprobar salud/login/roles. Para volver atrás, restaurar respaldo en una base separada y volver a la imagen previa: no suponer reversión automática del esquema.

## Clerk propio, dominio y cuentas existentes

El modo actual es **Clerk administrado por Replit**. Esta entrega no crea un tenant externo ni modifica las claves del entorno actual.

Para la cuenta **propia** de Clerk del equipo receptor:
1. Crear/seleccionar una aplicación y el entorno apropiado. Development y Production son almacenes de usuarios separados; también lo es otra aplicación Clerk. Copiar su pareja de claves pública/secreta a las variables indicadas. Las dos claves públicas, backend y build, deben pertenecer al mismo entorno que la secreta.
2. En producción configurar el dominio de aplicación, por ejemplo `https://cotizador.example.com`, y el dominio Frontend API de Clerk siguiendo los DNS y verificaciones que su instancia indique. Configurar los orígenes permitidos de esa instancia y `CLERK_AUTHORIZED_PARTIES` con el origen exacto; no comodines ni dominios `.replit.dev` en la entrega productiva.
3. Configurar las URLs de acceso `/sign-in` y registro `/sign-up` del dominio propio. La app usa `/cotizador` como redirección fallback tras acceso/registro. Autorizar las URLs de retorno del dominio nuevo y, para desarrollo, `http://localhost:5173` y/o `http://localhost:3000` según el modo probado. Las rutas OAuth callback específicas deben ser las **indicadas por Clerk**, no inventar `/api/callback`: registrarlas en cada proveedor.
4. Activar y probar los proveedores deseados en **su propia instancia Clerk**, con credenciales OAuth de su organización si corresponden, consentimientos, dominios y callbacks aprobados por Google/Microsoft/etc. La configuración de proveedores de Replit no se transfiere automáticamente. Mantener verificación del correo principal.
5. Usar `CLERK_PROXY_ENABLED=false`, `VITE_CLERK_PROXY_ENABLED=false` y `VITE_CLERK_PROXY_URL` vacío; reconstruir frontend. Clerk se conecta directamente a su Frontend API/DNS. No hace falta reemplazar el proxy administrado por otro proxy para este modo.

Específico de Replit: `clerkProxyMiddleware.ts` reenvía `/api/__clerk` a `frontend-api.clerk.dev`, añade encabezados Clerk y ajusta respuestas para su ingress; está activo solo en producción con clave secreta. El frontend y backend también derivan la clave pública del hostname en el modo administrado. Las dos opciones `*_PROXY_ENABLED=false` desactivan **ambos** comportamientos; por defecto no cambia Replit. Si se decide usar otro proxy, debe ser uno soportado/configurado por **su instancia externa**, con verificación de Clerk, DNS y URL coherentes en frontend/backend; no basta cambiar el target del proxy Replit.

### Conservación y asociación de identidades

`app_users.id` contiene el ID Clerk y está referenciado por propietarios, autores históricos, bloqueos y auditoría. Cambiar claves no migra usuarios. Una cuenta nueva, aunque tenga el mismo correo, tiene otro ID: **no hereda datos ni permisos y esta app no asocia por email automáticamente**.

Antes de mover datos, inventariar por canal privado los IDs Clerk y sus usuarios locales; confirmar con Clerk si la transferencia elegida preserva esos IDs. Si no los preserva, preparar una migración explícita y aprobada de correspondencias viejo→nuevo, verificando el correo, referencias y conflictos en una copia respaldada. Preservar roles/bloqueos, autores y snapshots; no borrar usuarios ni hacer un UPDATE aislado de una PK con referencias. Desplegar el cambio solo después de pruebas de acceso a las cotizaciones anteriores. La migración real de identidades/datos está fuera de esta entrega.

### Primer administrador y roles

En el primer acceso protegido con correo principal verificado, `INITIAL_ADMIN_EMAIL` permite crear/promover al primer admin **solo si todavía no existe ningún admin**. La comparación no distingue mayúsculas. Un usuario bloqueado no se promueve. Los demás usuarios nuevos reciben `comercial`. No es una lista de admins permanente: cambiar la variable no revoca ni eleva roles si ya existe un admin. Puede retirarse tras comprobar el acceso inicial. No hay correo real fijado en `.replit`.

| Rol | Permisos |
|---|---|
| `comercial` | Cotizar y operar sus propias cotizaciones/versiones y documentos; sin P&G ni administración. |
| `gerente_comercial` | Acceso a todas las cotizaciones y P&G por escenario; sin Parámetros, Usuarios ni restauración de eliminadas. |
| `admin` | Acceso global, P&G, parámetros, usuarios/roles/bloqueos/reasignación y restauración. |

Las comprobaciones de permisos y bloqueo se aplican en backend; nadie puede bloquearse o cambiar su propio rol, ni dejar al sistema sin último admin activo. Bloquear conserva las cotizaciones. Reasignar propietario no cambia autores ni importes históricos.

**Restricción de dominio de correo:** no hay una allowlist de dominios implementada en el backend ni evidencia en el repositorio de una restricción de registro activa en Clerk. Correo verificado **no significa** correo corporativo. Para restringir el alta, el equipo debe configurar la allowlist/restricciones de registro del dominio exacto en **su instancia Clerk**, comprobar también usuarios previamente creados y probar correo permitido y denegado con cada proveedor. Para restringir además el acceso de usuarios existentes, hace falta una política backend explícita en un cambio separado; no se presenta aquí como ya activa. `INITIAL_ADMIN_EMAIL` no restringe el registro.

## Pruebas y comprobaciones

```sh
pnpm typecheck
PORT=3000 BASE_PATH=/ pnpm build:app
pnpm test
```

`pnpm test` ejecuta las suites de cálculo/exportación, validación del frontend y la suite backend completa. La suite backend usa `test:isolated`: crea un esquema temporal vacío a partir del esquema `public`, ejecuta Vitest con `--fileParallelism=false` y lo elimina al terminar. No copia filas de negocio. Requiere una base de **pruebas**, previamente preparada con `db:migrate` y `db:seed`, y permisos CREATE SCHEMA; no apuntar las pruebas a producción. El comando directo `pnpm --filter @workspace/api-server test` usa la base configurada sin aislamiento adicional: no emplearlo sobre datos reales. Las integraciones se serializan porque comparten tablas y bloqueos de migración.

El build general del repositorio (`PORT=3000 BASE_PATH=/ pnpm build`) incluye además el sandbox auxiliar. `build:app` produce solo los dos servicios necesarios tras verificar tipos del workspace completo. El contrato API no ha cambiado; si se modifica en el futuro, regenerar con `pnpm --filter @workspace/api-spec codegen`.

Comprobación opcional reproducible del despliegue, después del build: `pnpm verify:deployment`. Requiere permiso `CREATEDB` en una instancia PostgreSQL de desarrollo/pruebas. Crea una base temporal nueva, migra y carga precios dos veces, verifica que se conserva una edición de parámetros, inicia el servidor compilado y comprueba rutas SPA, salud y rechazo 401 sin sesión. Elimina exclusivamente esa base temporal al finalizar. No usar contra producción; no comprueba un login real con Clerk externo.

## Dependencias Replit y revisión de datos incrustados

| En Replit | Equivalente externo |
|---|---|
| Workflows, puertos y proxy por artefacto | Scripts anteriores + Express para SPA/API; ingress HTTPS propio. |
| Base PostgreSQL y `DATABASE_URL` inyectada | PostgreSQL 16 del equipo, conexión explícita; no requiere API de Replit. |
| Clerk administrado y proxy Frontend API | Clerk propio en modo directo descrito arriba. |
| Secretos y `.replit` | Gestor de secretos/entorno del hosting; `INITIAL_ADMIN_EMAIL` siempre desde entorno. |
| Plugins Vite `@replit/*` | Solo herramientas auxiliares activadas con `REPL_ID`; no necesarias para servir producción. |
| `@replit/connectors-sdk` raíz | Dependencia heredada sin uso en el runtime del cotizador; no necesita conexión externa. |
| `.replit`, hooks y sandbox de diseño | Configuración de desarrollo conservada; no necesaria para iniciar el servicio externo. |

Se revisaron fuentes/configuración y archivos versionados sin abrir archivos de secretos. Hallazgos pertinentes:
- Se retiró un correo real de `.replit` y se sustituyó su uso por la variable ya leída en ejecución.
- Se localizaron dos correos fijos dentro de `server/templates/propuesta-daas.docx` (`word/document.xml` y un destino de hipervínculo en `word/_rels/document.xml.rels`). Solo esos textos/destinos se sustituyeron por etiquetas de contacto alimentadas por `PROPOSAL_TEMPLATE_EMAIL_1` y `PROPOSAL_TEMPLATE_EMAIL_2`; estructura, estilos, importes y reglas de propuesta se conservan. Los contactos actuales se conservaron localmente en `.proposal-contacts.local`, ignorado por Git y excluido de Docker/despliegue, no en archivos de la entrega. `pnpm start` carga opcionalmente ese archivo con Node; las variables ya inyectadas tienen prioridad. No contiene credenciales y no debe distribuirse. En una nueva instalación/Replit principal tras la entrega deben inyectarse ambas variables mediante la configuración del entorno; si faltan o no son correos válidos, la propuesta falla explícitamente. No se depende de ese archivo local en producción externa.
- El lockfile contiene un contacto público de metadatos de una dependencia, no una cuenta del proyecto; se conserva para no alterar el lockfile del proveedor.

No se detectaron claves privadas o tokens incrustados en los archivos de texto revisados, ni otros correos literales dentro del XML de documentos Office versionados tras sanear la plantilla. Esto **no es garantía sobre todo el historial Git ni los datos binarios**: imágenes y documentos deben revisarse también por el equipo antes de distribuirlos, pues pueden contener identidad corporativa/metadatos.

Si se descubre una clave expuesta, revocarla/rotarla en su proveedor y actualizar su gestor de secretos; no basta borrarla de un archivo. No se reescribió el historial ni se rotaron credenciales.

`.gitignore` y `.dockerignore` excluyen `.env` y variantes locales (conservando `.env.example`), dependencias, builds, adjuntos, cachés y archivos de agente/configuración privados. **Ignorar no deja de versionar archivos existentes**: hay archivos `.agents` ya versionados que siguen en el repositorio/historial. No se borraron como efecto colateral. Para una entrega limpia preparar un paquete con las exclusiones de `.dockerignore`, o revisar y retirar explícitamente esos archivos del índice en un cambio autorizado; no entregar indiscriminadamente un ZIP de toda la carpeta, que puede incluir secretos locales y adjuntos ignorados.

### Límites de verificación

Las comprobaciones realizadas en esta entrega se resumen en `docs/external-deployment-checks.md`. No se publica, cambia DNS, crea cuenta Clerk ni migra usuarios o datos externos. Los contenedores deben probarse en el host destino; la autenticación real con las nuevas claves y dominio requiere la instancia propia del equipo receptor.
