# CLAUDE.md — RentFlow Agent

Guía para sesiones de Claude Code (especialmente **sesiones web/remotas
iniciadas desde el teléfono**). Contexto: MVP en uso real (no crítico), con
backend en Supabase (prod) y app móvil Expo distribuida vía EAS.

## Setup de la sesión

El hook `.claude/hooks/session-start.sh` corre automáticamente en sesiones
web y deja todo listo:

1. `pnpm install` (workspace completo)
2. `pnpm db:generate` (cliente Prisma — no necesita DB)
3. Instala `eas-cli` global (para OTA updates)

No repitas estos pasos manualmente; si el hook corrió, ya están hechos.

## Comandos que funcionan

| Comando | Estado |
|---|---|
| `pnpm typecheck` | ✅ Verifica todo el monorepo. **Úsalo antes de cada commit.** |
| `pnpm build` | ✅ |
| `pnpm db:generate` | ✅ No requiere base de datos |
| `pnpm lint` | ❌ Roto (config ESLint legacy + eslint sin instalar en api/mobile). No intentes arreglarlo de pasada. |
| `pnpm test` | ❌ No hay tests escritos; jest sale con error "No tests found". |

El loop de desarrollo real es: **editar → `pnpm typecheck` → commit → push**.

## ⚠️ Regla de oro: el repo puede estar detrás de la PC del dueño

El dueño desarrolla también en su PC local y **puede tener trabajo sin
pushear**. Este contenedor solo ve lo que está en GitHub. Consecuencias:

- Antes de un `eas update`, **confirmar con el usuario** que el repo
  contiene la última versión (que la PC ya pusheó su trabajo). Publicar
  desde un repo desactualizado manda un bundle viejo a usuarios reales.
- Si un archivo "falta" o una feature "no existe", puede estar solo en su
  PC — preguntar antes de re-implementarla.

## OTA updates (EAS Update) desde la sesión

La app móvil (`apps/mobile`, Expo SDK 54) tiene EAS Update configurado
(canales `preview` y `production`).

```bash
# requiere EXPO_TOKEN en el entorno
pnpm --filter @rentflow/mobile update:preview -m "mensaje"
pnpm --filter @rentflow/mobile update:prod -m "mensaje"
```

Checklist antes de `update:prod`:
1. ¿El usuario confirmó que el repo está al día respecto a su PC?
2. ¿`pnpm typecheck` pasa?
3. ¿El cambio es solo JS/assets? Cambios nativos (plugins nuevos,
   permisos, upgrade de Expo) **no** salen por OTA — requieren `eas build`.
4. Mostrar al usuario el diff/log de lo que se va a publicar y esperar su OK.

## Secretos y producción

- Los secretos (`EXPO_TOKEN`, `DATABASE_URL` de Supabase, `AI_API_KEY`,
  `WHATSAPP_*`) se inyectan como variables del entorno remoto, configuradas
  en la consola de Claude Code on the web (*Environment → Variables*).
  Aplican a sesiones **nuevas**.
- Si el usuario pega un secreto en el chat, úsalo solo en memoria/env de la
  sesión. **Nunca** escribirlo en archivos del repo ni en commits.
- `DATABASE_URL` apunta a **prod real**. Para diagnósticos preferir
  consultas de solo lectura; escrituras solo con instrucción explícita.

## Estructura

- `apps/api` — NestJS (backend)
- `apps/web` — Next.js (panel)
- `apps/mobile` — Expo / React Native (app de agentes)
- `packages/database` — Prisma (schema + cliente)
- `packages/shared`, `packages/ui`, `packages/config` — código compartido

pnpm workspaces + turbo. Node ≥20, pnpm ≥9.
