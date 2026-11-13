# Comprobaciones de la entrega externa

## Entorno comprobado

- Node **24.22.1**, pnpm **10.26.1**.
- Servidor PostgreSQL **16.10** (no solo versión del cliente).
- Linux x64/glibc. Dockerfile: Node Debian; Compose: PostgreSQL 16 y plataforma amd64.

## Resultados

| Comprobación | Resultado |
|---|---|
| `pnpm install --frozen-lockfile` | Correcto; lockfile sin cambios. |
| `PORT=3000 BASE_PATH=/ pnpm build` | Correcto; tipos y build general, incluido sandbox. |
| `VITE_CLERK_PROXY_ENABLED=false PORT=3000 BASE_PATH=/ pnpm build:app` | Correcto; build explícito del modo externo. |
| Tipos/build backend tras sanear los contactos de la plantilla | Correctos. |
| Suites compartidas | 3 archivos, **32 tests** correctos. |
| Suite frontend | **23 tests** correctos. |
| Suite backend final | 20 archivos, **159 tests** correctos, ejecutados serialmente en esquema aislado. |
| Total | **214 tests**, sin fallos ni omisiones. |
| `pnpm verify:deployment` | Correcto sobre una base nueva temporal creada y eliminada por el propio comando. |
| Migraciones y seed repetidos | Correctos; una edición de parámetros existentes conservó tanto configuración como fecha de actualización. |
| Arranque compilado con `NODE_ENV=production`, Clerk directo y frontend estático | Correcto; salud 200, rutas SPA 200 y API protegida sin sesión 401. |
| Rutas SPA/API/assets | Tests de rutas profundas, API existente, 404 JSON para API inexistente, asset inexistente 404 y error explícito por build ausente. |
| Detección de error de esquema | Tests positivos y negativos; no se acepta únicamente código de salida cero de Drizzle. |
| Plantilla Word | Comparada con el original: solo se sustituyeron dos correos fijos y el destino de hipervínculo correspondiente por etiquetas; todos los demás componentes XML y recursos internos conservados byte a byte. Exportaciones e integraciones Word correctas. |
| Docker/Compose | YAML parseado y estructura validada; comprobados build args públicos, salud PostgreSQL, dependencia de disponibilidad, persistencia, variables y arranque. **Sin ejecutar Docker**. |
| Exclusiones | Comprobadas reglas Git para `.env`, variantes, dependencias, builds, adjuntos, agente y configuración local; `.env.example` permanece permitido. |
| Modo Replit | Workflows frontend/API reiniciados; salud de API correcta y pantalla de acceso visible, sin error de arranque. |
| Revisión de valores incrustados | Fuentes/configuración versionadas, textos de workspace pertinentes y XML de documentos Office revisados sin mostrar valores sensibles ni abrir archivos de secretos. |

## Hallazgos y acciones

- Correo real retirado de `.replit`; primer administrador configurado con `INITIAL_ADMIN_EMAIL`.
- Dos correos de contacto retirados del interior de `server/templates/propuesta-daas.docx`; ahora requieren `PROPOSAL_TEMPLATE_EMAIL_1` y `PROPOSAL_TEMPLATE_EMAIL_2`.
- Para preservar los contactos durante esta preparación se guardó una configuración local ignorada y excluida de entrega. **Antes de iniciar otra instalación o integrar la plantilla saneada en un entorno distinto, configurar ambas variables**; no copiar archivos locales indiscriminadamente.
- No se encontraron claves privadas/tokens incrustados en los archivos revisados. El contacto público del lockfile de una dependencia se conserva como metadato de tercero.
- Existen archivos `.agents` previamente versionados: el nuevo ignore no los retira del índice ni del historial. No se reescribió Git ni se borraron archivos ajenos al alcance.
- La app no aplica una restricción de dominios de email. El README distingue correo verificado, restricciones de alta de Clerk y una posible política de acceso backend futura.

## Límites y advertencias

- No se ejecutaron contenedores, ni se probó `docker compose build/up` en este entorno. La validación estática no verifica descarga de imágenes, networking, volúmenes o comportamiento de Docker.
- No se crearon cuentas externas, no se cambió DNS, no se publicó y no se transfirieron identidades o datos. La prueba de arranque usa la configuración disponible de desarrollo para validar el modo directo, no una cuenta Clerk externa real.
- No se probó un login completo con un nuevo dominio/proveedor de Clerk. Las suites de roles y API siguen pasando; la asociación de usuarios existentes necesita un ensayo separado y aprobado.
- No se inspeccionó exhaustivamente el historial Git ni se hizo OCR de imágenes. Si se detecta una credencial expuesta después, rotarla en su proveedor.
- El build informa advertencias no bloqueantes de sourcemap de un componente UI y chunks grandes; termina correctamente. La instalación informa scripts de dependencias no aprobados; no se relajó la política de ejecución para esta entrega.
- Salud HTTP confirma que el proceso responde, no vigilancia permanente de dependencias. La operación externa debe incluir backups, monitoreo y pruebas de restauración.
