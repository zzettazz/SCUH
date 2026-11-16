# RSI Upgrade Helper (web)

Fan site **no oficial y de solo lectura** para Star Citizen: calcula la cadena de upgrades (CCU) más barata, compara naves y visualiza tu hangar. Sin afiliación con Cloud Imperium Games ni Roberts Space Industries.

## Qué incluye

| Sección | Qué hace |
|---|---|
| **Inicio** | Resumen de tu cuenta, avisos (Warbonds nuevos, objetivos que bajan de precio, upgrades repetidos…) y exportar a CSV |
| **Calculadora** | Ruta de upgrades más barata, presupuesto dinero/crédito, reservas de CCUs y naves, y objetivos vigilados |
| **Objetivos** | Hasta 6 naves objetivo a la vez; reparte tus CCUs para que no se pisen |
| **Naves** | Buscador y fichas de todas las naves (rol, tripulación, carga, medidas), comparador de hasta 3 y «cómo llegar desde tus naves» |
| **Mi flota** | Tu flota por tamaño, rol o fabricante; enlace e imagen para compartirla sin datos privados |
| **Hangar · Upgrades · Canjear · Buy-back** | Tu cuenta ordenada, con qué conviene canjear por crédito |
| **Historial** | Hangar log completo con gráficos de evolución y buscador |
| **Precios** | Upgrades posibles desde una nave |

Los importes pueden verse en **euros aproximados** (tipo de cambio automático o el que escribas).

## Cómo consigue tus datos

Una web no puede leer tu cuenta de RSI por su cuenta (el navegador lo impide por seguridad). Se usa un **marcador** (bookmarklet):

1. En la web, **Conectar**: arrastras «🚀 RSI Helper» a tu barra de marcadores.
2. Entras en robertsspaceindustries.com y pulsas el marcador.
3. `collector.js` se ejecuta **dentro de la página de RSI**, lee hangar, buy-back, crédito, precios de upgrades y fichas de naves **con tu sesión**, y los pasa a la web con `postMessage`.
4. La web los guarda solo en el `localStorage` de tu navegador. **No hay servidor.**

Si el navegador bloquea la ventana, el panel ofrece descargar un `.json` que se sube en **Conectar**.

## Seguridad y privacidad

- Solo **lee**: no compra, aplica, canjea ni regala nada. No ve tu contraseña.
- Los datos solo se envían al origen exacto de la web y la web solo acepta mensajes de `https://robertsspaceindustries.com`.
- El enlace de «compartir flota» solo lleva nombre, rol, tamaño, tripulación y carga de cada nave.
- Un marcador ejecuta código en la página de RSI: instálalo solo desde una web de confianza.
- Todo texto que viene de RSI o de enlaces se inserta como texto, nunca como HTML.

## Assets del Fan Kit

El diseño es propio. Los assets oficiales (fondo y logo) son **opcionales**: si los pones en `assets/fankit/` se usan solos. Instrucciones y condiciones en [`assets/fankit/README.md`](assets/fankit/README.md). Hay que descargarlos con tu cuenta aceptando el acuerdo del Fan Kit.

## Probar en local

```bash
npm test      # 45 tests
npm start     # http://localhost:8080
```

## Publicar en GitHub Pages

Settings → Pages → Deploy from a branch → `main` / `(root)`. El marcador se adapta solo a la dirección de la web.
El archivo `.nojekyll` evita que GitHub procese la carpeta como Jekyll.

## Estructura

- `index.html`, `styles.css`, `app.js`: página, estilos y lógica principal.
- `views/`: Naves, Objetivos, Mi flota y Evolución.
- `ui.js`: componentes de interfaz y gráficos SVG sin librerías.
- `collector.js`: lo que se ejecuta en RSI.
- `lib/`: lógica pura (cuenta, cadenas, canje, historial, fichas, flota, euros…) con tests en `tests/`.

## Mantenimiento

RSI puede cambiar su web o su API interna sin avisar. Si algo deja de leerse, el fallo estará en `collector.js` (selectores del hangar y consultas GraphQL de upgrades).
