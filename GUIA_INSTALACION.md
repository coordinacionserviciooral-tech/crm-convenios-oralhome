# CRM Oralhome

## Usar el sistema

Entra con tu correo y contraseña. Consulta puede leer y exportar. Comercial puede crear y editar convenios y seguimientos. Administrador puede gestionar perfiles, archivar, restaurar, revisar auditoría y obtener respaldos completos. Crea usuarios desde Supabase Authentication; aparecen desactivados con rol Consulta hasta que un administrador los habilita.

Los campos históricos, las tarifas por año y los seguimientos se conservan. Puedes añadir años de tarifa y marcar seguimientos completados. Los seguimientos sin fecha quedan registrados pero no generan alertas. La fecha de gestión vacía se guarda como `null`.

El filtro Estado permite ver activos, archivados o todos. El CSV exporta exactamente los convenios filtrados y contiene tarifas y seguimientos completos. El respaldo JSON del administrador incluye todos los convenios, incluso archivados. Un registro archivado puede restaurarse.

Si aparece que otro usuario modificó el convenio, cierra el formulario, actualiza la lista y vuelve a abrirlo. Un error de guardado conserva el formulario para que puedas corregirlo o reintentar.

## Ejecutar en el computador

Requiere Node.js 24 o 22.13 o superior.

```powershell
npm ci
Copy-Item .env.example .env.local
# Completar la clave publicable en .env.local
npm run dev
```

`npm run check` revisa el código, prueba validaciones, fechas, reintentos y permisos PostgreSQL, y genera la publicación en `dist`. Las pruebas SQL usan una base aislada en memoria; no alteran datos de producción.

## Supabase

1. Respalda Aliados, profiles, audit_logs y alert_log.
2. Ejecuta `supabase/schema.sql` en SQL Editor. La migración es transaccional y se puede repetir. No elimina registros ni cambia roles existentes. Sustituye las políticas anteriores de estas tablas por las nuevas reglas.
3. Si es una instalación nueva, crea el administrador en Authentication y activa su perfil desde SQL Editor con su UUID real. No copies una contraseña a los archivos del proyecto.
4. En Authentication → URL Configuration, registra la URL de producción y el mismo origen con `/?recovery=1` en Redirect URLs. Mantén los enlaces existentes que todavía se usen. La pantalla Mi cuenta permite cambiar la contraseña; el enlace de recuperación muestra el formulario para restablecerla.

## Alertas automáticas

La función se llama `power-automate-alerts`, conservando el nombre instalado en el proyecto. Su código actualizado usa EmailJS, que es el proveedor existente. Opcionalmente puede usar Resend cuando se configuren RESEND_API_KEY y ALERT_FROM_EMAIL.

Configura en Edge Functions Secrets:

- CRON_SECRET: secreto de la programación existente.
- EMAILJS_SERVICE_ID, EMAILJS_TEMPLATE_ID, EMAILJS_PUBLIC_KEY: configuración de EmailJS existente.
- EMAILJS_PRIVATE_KEY: clave privada para las peticiones desde servidor, cuando la cuenta lo requiera.
- ALERT_TO_EMAIL: opcional; el destino predeterminado es el coordinador de servicio de Oralhome.

SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY son secretos internos disponibles en la función. Nunca se añaden a Vercel ni al navegador. EmailJS debe permitir el uso del servicio desde servidor con la autenticación de la cuenta.

Publica con `supabase functions deploy power-automate-alerts --no-verify-jwt` desde esta carpeta, o pega una versión empaquetada en el editor de funciones del Dashboard. El acceso se verifica dentro de la función mediante x-cron-secret; no acepta peticiones sin ese secreto. La opción `verify_jwt = false` de config.toml permite las llamadas del programador que no utilizan una sesión de usuario.

Guarda en Supabase Vault dos secretos: `oralhome_project_url` con la URL del proyecto y `oralhome_cron_secret` con el mismo CRON_SECRET. Después ejecuta `supabase/cron.sql`. Las ejecuciones son 08:00 y 15:00 de Colombia; los pendientes y fallos se revisan a los 15 minutos de cada hora. Antes de instalar, comprueba que no haya otra programación que envíe los mismos avisos con un nombre diferente.

Reglas conservadas de ambas versiones:

- Renovación: avisos a 2 y 1 meses, el primer día del mes de aviso; también 8, 3 y 1 días calendario antes del primer día del mes de renovación. El dato original solo contiene el mes, por eso no se presupone un día real de vencimiento.
- Fecha de gestión: 8, 3 y 1 días calendario antes de la fecha registrada.
- Seguimientos pendientes: 8 días de lunes a viernes antes, sin un calendario de festivos configurado.
- Cada horario tiene su propio aviso; reejecutar el mismo horario no vuelve a enviar las alertas confirmadas.
- Convenios archivados y seguimientos completados quedan excluidos.
- Un fallo confirmado queda disponible para reintento. Un envío EmailJS sin confirmación queda como `uncertain`; verifica el historial del proveedor antes de reintentar para evitar duplicados.
- Resend utiliza una clave de idempotencia; los reintentos automáticos se limitan a 23 horas. Los intentos agotados y los registros vencidos requieren revisión.

Puedes comprobar el servicio sin enviar correos usando POST con los encabezados x-cron-secret y x-run-slot y el cuerpo `{"dry_run":true}`. Las respuestas muestran proveedor, convenios comprobados y alertas previstas, sin guardar envíos ni modificar registros.

## Vercel y SharePoint

Define VITE_SUPABASE_URL y VITE_SUPABASE_PUBLISHABLE_KEY en Production, Preview y Development. Solo la clave publicable llega al navegador. Root Directory debe apuntar a la carpeta de esta aplicación, o quedar vacío si el repositorio contiene la aplicación en su raíz. Vercel utiliza npm ci, npm run build y dist.

En SharePoint agrega un vínculo a la URL HTTPS del CRM. La autenticación del CRM sigue siendo obligatoria. No se incrusta la aplicación en un iframe.

## Mantenimiento

Descarga respaldos periódicos desde la cuenta del administrador y conserva los archivos en un lugar privado. Los ZIP, documentos con credenciales y CSV de origen nunca se suben al repositorio público. Revisa Alertas para identificar fallos, agotamiento de intentos o envíos sin confirmación.

