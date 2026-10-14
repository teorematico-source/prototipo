# Backend de Miller AI

El servidor (`server.js`) sirve la aplicación y recibe sus solicitudes de chat. La clave de OpenRouter se lee de la variable de entorno `OPENROUTER_API_KEY`; no se guarda en el HTML, JavaScript del navegador ni en el repositorio.

Al desplegarlo, configura `OPENROUTER_API_KEY` como **secreto/variable de entorno privada** en el proveedor de hosting. Configura también `MILLER_ACCESS_PASSWORD` como secreto: la app pedirá esa contraseña y el servidor emitirá una cookie de sesión HTTP-only, válida durante 12 horas. No uses una contraseña que ya utilices en otros servicios. Si falta esta variable, el chat permanece bloqueado.

El servidor limita el chat a 20 solicitudes por minuto y 100 por día por dirección IP, además de limitar a 10 intentos de acceso por minuto. Estos contadores y sesiones viven en memoria y se reinician al reiniciar el servidor. El servidor requiere Node.js 18 o posterior y debe estar desplegado junto con `index.html`, `styles.css` y `script.js`. La preview estática del editor no ejecuta este backend; el chat funcionará cuando la aplicación se sirva desde el servidor desplegado.

El endpoint limita el tamaño y frecuencia de solicitudes y restringe los modelos admitidos. Antes de publicar el servicio ampliamente, añade autenticación de usuarios y límites de uso/costo en tu hosting: una API pública sin autenticación podría ser utilizada por terceros a través de tu cuenta.
