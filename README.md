# Portal de Convenios - Comfenalco Antioquia

## Puesta en marcha
1. `npm install`
2. Copia `.env.example` como `.env` y completa las variables. `SUPABASE_SECRET_KEY` solo se usa en el servidor; no la incluyas en `public/` ni en GitHub.
3. Verifica en `public.profiles` que exista un perfil activo con rol `admin`.
4. Ejecuta `supabase/migrations/20260929190000_create_convenio_data.sql` en Supabase SQL Editor.
5. Ejecuta `supabase/migrations/20260929200000_add_agreement_number_counter.sql` para activar IDs consecutivos `CONV-YYYYMM-NNNN`.
6. Copia a `public/` los formatos .xlsx y el portafolio PDF que usa el portal.
7. Ejecuta `npm start` y abre http://localhost:3000 (no abras `index.html` con doble clic).

La autenticación OTP y la administración de perfiles consultan Supabase Auth y `public.profiles`. Para producción, configura las mismas variables necesarias en Vercel como Environment Variables; no subas `.env`.

Cualquier visitante puede iniciar un convenio. El registro solo se guarda si SMTP confirma el envío; los IDs se asignan desde el contador de Supabase. El envío exitoso a Jurídica guarda automáticamente la Etapa 2, y los avances manuales posteriores también se persisten en Supabase.

## Modo prueba / producción
- `MODO_PRUEBA=true`  -> Hoja de Ruta llega a `MAIL_PRUEBA`; Envío a Jurídica llega a `MAIL_PRUEBA_JURIDICA` (asunto con [PRUEBA]).
- `MODO_PRUEBA=false` -> Hoja de Ruta llega a `MAIL_DAYANA`; Envío a Jurídica al correo del formulario (o `MAIL_JURIDICA` si está vacío).

## Pruebas
`node test/camara.test.js`

`node test/expediente.test.js`

`node test/ticketCorreo.test.js`