# RSI Upgrade Helper (web)

Web **no oficial y de solo lectura** para consultar tu hangar de Star Citizen y calcular la cadena de upgrades (CCU) más barata. Sin relación con Cloud Imperium Games ni Roberts Space Industries.

## Cómo funciona

Una web no puede leer tu cuenta de RSI por su cuenta: el navegador lo impide por seguridad. Por eso se usa un **marcador** (bookmarklet):

1. En la web, pestaña **Conectar**, arrastras el botón «🚀 RSI Helper» a tu barra de marcadores.
2. Entras en robertsspaceindustries.com con tu sesión y pulsas el marcador.
3. El marcador carga `collector.js` **dentro de la página de RSI**, lee tu hangar, buy-back, crédito y los precios de upgrades **con tu propia sesión**, y se los pasa a esta web con `postMessage`.
4. La web guarda los datos solo en `localStorage` de tu navegador. **No hay servidor.**

Si el navegador bloquea la ventana, el panel de RSI ofrece descargar un archivo `.json` que se sube en la web.

## Seguridad y privacidad

- El código solo **lee**: no compra, aplica, canjea ni regala nada.
- No ve ni pide tu contraseña. Usa la sesión que ya tienes abierta en RSI, igual que cuando navegas.
- Los datos solo se envían al origen exacto de la web (`postMessage` con `targetOrigin`) y la web solo acepta mensajes de `https://robertsspaceindustries.com`.
- Un marcador ejecuta código en la página de RSI: **instálalo solo desde una web de confianza**. Si alguien publica una copia, es esa copia la que decide qué código se ejecuta.

## Pestañas

Resumen · Calculadora (ruta más barata, presupuesto dinero/crédito, reservas, objetivos) · Naves · Upgrades · Canjear · Buy-back · Historial · Precios · Exportar a CSV para Excel.

La lógica está en `lib/` (JavaScript puro, con tests en `tests/`).

## Probar en local

```bash
npm test      # 36 tests
npm start     # http://localhost:8080
```

## Publicar en GitHub Pages

1. Crea un repositorio público (por ejemplo `rsi-upgrade-helper`) y sube el contenido de esta carpeta.
2. En el repositorio: **Settings → Pages → Build and deployment → Deploy from a branch → `main` / `(root)`**.
3. Tras un minuto la web estará en `https://TU-USUARIO.github.io/rsi-upgrade-helper/`.

El marcador se genera solo con la dirección desde la que cargas la web, así que no hay nada que configurar.
El archivo `.nojekyll` evita que GitHub procese la carpeta como un sitio Jekyll.

## Mantenimiento

RSI puede cambiar su web o su API interna sin avisar. Si algo deja de leerse, el fallo estará en `collector.js` (los selectores del HTML del hangar y las consultas GraphQL de upgrades).
