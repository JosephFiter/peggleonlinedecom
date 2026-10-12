# Peggle Duel Online

Remake web del **modo duelo de Peggle Nights**, para jugar online con salas.

- Cada jugador elige **su propia carpeta** de Peggle Nights. Los assets
  (niveles, gráficos, sonidos, música) se leen **en el navegador** y nunca se
  suben a ningún servidor. Este repositorio no contiene ni distribuye nada del
  juego original.
- La física se reimplementa **a partir del ejecutable original** (ingeniería
  inversa con Ghidra), con aritmética float32 y paso de tiempo fijo, para que
  los rebotes sean idénticos al juego.

## Estado

| Etapa | Estado |
|---|---|
| 1. Lector de `.pak` y assets (incl. JPEG 2000) en el navegador | ✅ |
| 2. Parser de niveles `.dat` (los 73 niveles validados byte a byte) y visor | ✅ (visor aproximado) |
| 3. Ingeniería inversa: física, colisiones, puntaje y reglas del duelo | ⏳ siguiente |
| 4. Simulación jugable local (bola, pegs, balde, fever, poderes) | — |
| 5. Online: servidor de salas, lobby, sincronización de tiros | — |
| 6. Sonido, música (`.mo3`), efectos, menús | — |

## Estructura

```
packages/formats   Parsers sin dependencias del DOM: .pak, niveles .dat,
                   resources.xml, stages.cfg (corren en Node y en el navegador)
apps/web           Cliente web (Vite + TypeScript)
tools/             Herramientas de desarrollo (validación, inspección, Ghidra)
```

## Desarrollo

Requiere Node.js 24 o superior.

```bash
npm install
npm run dev
```

Para no elegir la carpeta del juego en cada recarga, creá `apps/web/.env.local`
(está en `.gitignore`):

```
PEGGLE_DIR=F:/SteamLibrary/steamapps/common/Peggle Nights
```

En modo desarrollo aparece el botón **"Usar juego local (dev)"**.

Otros comandos:

```bash
npm run typecheck
node tools/validate-levels.ts "<carpeta de Peggle Nights>"   # parsea todos los niveles
node tools/inspect.ts "<carpeta de Peggle Nights>"           # info de recursos
```

## Créditos

El formato de los niveles se documentó tomando como referencia
[PeggleEdit](https://github.com/IntelOrca/PeggleEdit) de IntelOrca. No se copió código.
Peggle es una marca de PopCap Games / Electronic Arts. Este es un proyecto de
fans, sin afiliación.
