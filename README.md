# Tu Casa Nórdica — correo transaccional

Automatización mínima para enviar la cola de emails transaccionales de Tu Casa Nórdica mediante GitHub Actions y el SMTP de Nominalia.

## Seguridad

- No contiene contraseñas ni tokens.
- `SMTP_PASSWORD` y `MAILER_API_KEY` se guardan como GitHub Actions Secrets.
- Los errores se limpian antes de notificarlos a la aplicación.
- La cola se consulta por HTTPS y los mensajes se marcan como enviados o fallidos.

El workflow se ejecuta automáticamente cada cinco minutos y también puede lanzarse manualmente.
