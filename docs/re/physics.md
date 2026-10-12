# Ingeniería inversa: física de la bola

Notas propias sobre el funcionamiento del ejecutable original (Peggle Nights, build
de Steam). Las direcciones son del **ejecutable interno**
(`game/PeggleNights.inner.exe`, base `0x400000`, extraído con
`tools/extract-inner-exe.ts`) tal como las nombra Ghidra (`FUN_xxxxxxxx`).

> Este documento describe algoritmos con palabras propias y fórmulas. No contiene
> código del juego.

## Entorno numérico

- Compilado con **Visual Studio 2005** y matemática **x87**.
- La CRT arranca con la FPU en 53 bits (`__setdefaultprecision`).
- DirectDraw se inicializa con `SetCooperativeLevel(hwnd, DDSCL_NORMAL)` (en
  `FUN_004fe040`), **sin `DDSCL_FPUPRESERVE`**. Al crear el device de Direct3D 7, la
  FPU queda en **precisión simple (24 bits)**.
  - El juego no cambia la precisión en ningún otro lugar.
  - ⇒ Con aceleración 3D, cada operación se redondea a float32. Se emula con
    `Math.fround` después de **cada** operación (el rango del exponente sigue siendo
    extendido, pero eso solo importa con overflow o denormales).
  - Sin aceleración 3D (modo software), la FPU queda en 53 bits. Ese modo no se
    emula.
- `sqrt` es la de la CRT (en double), con el resultado convertido a float
  (`FUN_0044b060`).

## Unidades y paso de tiempo

- La posición está en píxeles, en **coordenadas de nivel**.
- La velocidad está en **píxeles por tick**. La integración es
  `pos += vel * t_restante` (ver más abajo), sin `dt` variable.
- Frecuencia de tick: SexyApp corre la lógica a tasa fija. **Pendiente de
  confirmar** (se esperan 100 Hz).

## Offsets del objeto bola

| Offset | Campo |
|---|---|
| `+0x14..+0x20` | AABB (minX, minY, maxX, maxY) para la broadphase |
| `+0xec, +0xf0` | posición x, y |
| `+0xf4, +0xf8` | posición del tick anterior |
| `+0xfc, +0x100` | velocidad x, y |
| `+0x13c` | radio |
| `+0x140` | bola "inactiva" (no se integra) |
| `+0x141` | hubo intento de colisión este tick |
| `+0x165` | atraviesa pegs (p. ej. fireball): sin respuesta física contra pegs |
| `+0x170..` | normal del último contacto (`[0x5c],[0x5d]` como índices de int) |
| `+0x178` | velocidad de impacto del último contacto |
| `+0x1a4` | modo de rebote extra: 1 ⇒ `b=(b+1)/2`, 2 ⇒ `b=(b+3)/4` |
| `+0xe4` | contador para detectar bola atascada |

## Offsets del objeto físico base (PhysObj)

Salen del serializador `FUN_0049ee90`, que coincide 1:1 con el orden de bits del
formato `.dat`:

| Offset | Campo | Bit de flags |
|---|---|---|
| `+0x24` | collision | 5 |
| `+0x25` | visible | 6 |
| `+0x26` | canMove | 7 |
| `+0x27` | background | 14 |
| `+0x28` | foreground | 22 |
| `+0x29` | foreground2 | 25 |
| `+0x2a` | baseObject | 15 |
| `+0x2b` | ballStopReset | 20 |
| `+0x2c` | drawSort | 24 |
| `+0x2d` | drawFloat | 28 |
| `+0x30` | **desconocido** | 29 (solo flag, sin datos) |
| `+0x31` | shadow | 30 (versión ≥ 0x50) |
| `+0x34` | **bouncy** | 1 |
| `+0x38` | **rolly** | 0 |
| `+0x3c` | **maxBounceVelocity** | 23 |
| `+0x40` | solidColor | 8 |
| `+0x44` | outlineColor (por defecto `0xffffff`) | 9 |
| `+0x48` | movement link | 3 |
| `+0x4c` | unk4 | 4 |
| `+0xd0` | peg info | 2 |
| `+0x10` | tipo de objeto (1, 2, 3 = bola, 4, 5 = círculo) | — |

## Actualización por tick de la bola — `FUN_00493950`

En este orden:

1. Detección de bola atascada: cada 10 ticks guarda la posición en un historial
   de hasta 6 entradas. Si la distancia² a alguna entrada es ≥ 4, reinicia el
   contador. Si es ≥ 0.04 (y no se marcó todavía), resta 5 al contador.
2. Guarda la posición anterior.
3. **Gravedad: `vy += G`**, con `G` global (`DAT_006c77cc`):
   - `G = 0.05f` (`0x3D4CCCCD`). Se reinicia a 0.05 al empezar el nivel.
   - Los desafíos con `GravityMod` la multiplican (no se usan en el duelo).
4. **Velocidad máxima**: si `vx² + vy² > 225`, normaliza `v` y la multiplica por
   **15**.
5. Recalcula el AABB: `pos ± radio`, extendido en la dirección de la velocidad.

## Movimiento con colisión continua — `FUN_00493390`

- `t = 1.0` (fracción del tick que queda). Hasta **20 iteraciones** por tick.
- Para cada objeto candidato (filtrado antes por AABB en `FUN_00454af0`), calcula
  el tiempo de impacto según el tipo:
  - tipo 5 (círculo): `FUN_004a20b0`
  - tipo 4: `FUN_0049bc60`
  - tipo 3 (otra bola): `FUN_004928c0`
- Se queda con el impacto más temprano, mueve la bola al punto de contacto y
  aplica la respuesta (`FUN_00492f90`, o `FUN_00492cd0` contra otra bola).
- `t -= t_impacto`, y repite.
- Al final: `pos += t * vel`.

## Respuesta de colisión — `FUN_00492f90`

Entradas: normal `n` (unitaria), velocidad de la bola `v`, velocidad del objeto `u`
y una velocidad adicional `w` (posiblemente rotación o empuje del objeto).

1. `impacto = -(n · (v - u - w))`. Si `impacto < 0`, la bola se está alejando y no
   hay respuesta.
2. `b = obj.bouncy` (o **0.82** si vale 0) y `r = obj.rolly` (o **1.4** si vale 0).
   Se aplican los modos de `+0x1a4`.
3. Si `|n.x| > 0.99` (pared vertical): `impacto *= 5`.
4. Si `impacto <= r` ⇒ **rodar**: se quita la componente normal de `v`. `w` se
   reduce a su componente normal, y solo si es positiva.
   `v' = u + (v - (v·n) n) + w'`.
5. Si no ⇒ **rebotar**:
   - si `v·n < 0`: `v = b · (v - 2 (v·n) n)`
   - `e = (b + 1) · (u + w)`; si `e·n > 0`, se avisa al objeto (empuje)
   - `v = v + e`
   - si `maxBounceVelocity > 0` y `|v|² > max²`: `v = normalizar(v) · max`
6. Si el objeto tiene `ballStopReset`, se reinicia el contador de atascada.

`normalizar(v)` (`FUN_0044b0b0`): `len = (float)sqrt(x² + y²)`. Si `len != 0`:
`(x/len, y/len)`, con **dos divisiones**. Si no, `v` queda igual.

## Puntería — `FUN_004689d0`

- Ángulo base: `atan2` desde el cañón hasta el punto del clic, más una corrección
  proporcional a la distancia² (factor `1.3e-6`, con tope de 1).
- Después prueba **10 ángulos** (`base + k · 0.01`) simulando la parábola con
  `G` y la velocidad de lanzamiento (`cañón + 0x160`). Se queda con el que pasa
  más cerca del punto.
- En el online se manda **el ángulo final** (bits float32), así que esta parte no
  necesita ser idéntica entre clientes.

## Coordenadas y tablero

- Offset nivel → pantalla: **(75, 40)** (`tablero[0x1de], [0x1df]`, asignado en
  la inicialización). PeggleEdit usa (73, 43), que es incorrecto.
- `levels/_base.dat` es la base común de todos los tableros:
  - paredes (polígonos con id `wall`): borde interno izquierdo en x = 0.5,
    derecho en x = 649.5 y techo en y = 9.375. `bouncy 0.75`, `rolly 0.00001`
    (nunca ruedan);
  - balde de bola gratis (`freeball`): teletransporte de 130×20 más sus costados
    poligonales, con movimiento horizontal de período 600 ticks y amplitud 260
    alrededor de (326, 556);
  - baldes y bumpers de Extreme Fever (`fever`), aletas (`flipper`) y bumpers de
    pirámide (`bumperhole`): solo se activan con sus poderes.

## Fábrica de objetos (`FUN_00428380`)

| Tipo en archivo | Clase interna | Tamaño |
|---|---|---|
| 2 Rod | segmento (tipo interno 4) | 0x114 |
| 3 Polygon | polígono de segmentos (tipo interno 5) | 0x148 |
| 4, 5 Circle | círculo (tipo interno 3); la bola es la misma clase (tipo interno 2) | 0x1ac |
| 6 Brick | ladrillo | 0x51c |
| 7 | cañón | 0x1e0 |
| 8 Teleport | teletransporte | 0x118 |
| 9 Emitter | emisor de partículas | 0x9a0 |

El radio por defecto de un círculo, y de la bola, es **6.0** (`DAT_006c6e0c`).

## Cañón

- Constructor `FUN_00497860`. Posición: `(400 − 75, 70 − 40) = (325, 30)` en
  coordenadas de nivel.
- Campos: `+0x150` ángulo actual (rad), `+0x154` ángulo objetivo, `+0x160`
  **velocidad de lanzamiento = 4.0**, `+0x164 = 30`, `+0x168 = 10`,
  `+0x16c = 60`, `+0x170 = 26`.
- El ángulo se acerca al objetivo como máximo **0.2 rad por tick** (`FUN_004988f0`).
- Rotación de un punto alrededor del pivote (`FUN_0061ee30`):
  `x' = cx + dx·cos a + dy·sin a`, `y' = cy + dy·cos a − dx·sin a`.
- El cañón es un **triángulo de colisión** rotado: `(cx+90, cy)`, `(cx+60, cy−10)`,
  `(cx+60, cy+10)`.
- La bola sale de `(cx + 26 + radio + 60, cy + 1)`, rotado según `a`.
- Velocidad inicial: **`(v·cos a, −v·sin a)`** (`FUN_004986d0`).
- Orden por tick: actualización de la bola (gravedad, tope) → movimiento con
  colisiones.

## Colisión contra segmentos (`FUN_0049bc60`)

Campos del segmento: extremos `x1 +0xec`, `x2 +0xf0`, `y1 +0xf4`, `y2 +0xf8`;
recta `n·p + c = 0` con `nx +0x104`, `ny +0x108`, `c +0x10c`; `+0x110` eje
dominante (0 = usar el rango en x, 1 = el rango en y); `+0x111` un solo lado.
Velocidad del segmento: `+0xfc, +0x100`.

1. `FUN_0049b7c0`: superposición en t = 0, con tolerancia `radio − 0.01`.
2. `FUN_0049b460`: barrido contra la recta, si `v·n ≤ 0.2`.
3. `FUN_0049b2a0`: barrido contra el extremo A, y contra B si se pide. Es una
   cuadrática con radio `r − 0.01`, que retrocede `0.01/|v|` en el tiempo.

El polígono (`FUN_004a20b0`) prueba todos sus segmentos y además detecta si la
bola quedó adentro (paridad de cruces) para empujarla hacia afuera. Si el
polígono rota (`+0x120` = ω, centro `+0x114/+0x118`), suma la velocidad
tangencial `w = ω × r`.

## Colisión contra círculos

- Impacto (`FUN_004928c0`): cuadrática con `R = r_bola − 0.01 + r_círculo`. Si ya
  hay superposición, `t = 0`. Se toma la raíz menor, y si es negativa la mayor.
- Respuesta (`FUN_00492cd0`):
  - `n = normalizar(centro_círculo − centro_bola)`;
  - `b = bouncy` (o **0.9**), `r = rolly` (o **1.0**), más los modos de `+0x1a4`;
  - `k = b · (n·(v_bola − v_círculo))`. Si `|k| > r`, `k = 2k`;
  - `k' = −((k / 999999995905.0) · 999999995904.0)` (dos constantes double
    distintas: cuantiza el resultado; reproducir tal cual);
  - `v_bola += k' · n`;
  - empuje fuera de la superposición: `Mover(−(R − |d|) · n)`.

## Precisión: patrón del compilador

El código guarda casi todos los intermedios en memoria como float (`FSTP float` y
luego `FLD`), pero algunas expresiones (`a·b + c·d`) quedan en registros. Con la
FPU en 24 bits, eso equivale a redondear a float32 después de **cada** operación.

- Operación float ⊕ float: `Math.fround(a ⊕ b)` es exacto (doble redondeo seguro,
  porque 53 ≥ 2·24 + 2).
- Operación float ⊕ **constante double** no representable en float: hace falta un
  redondeo único y correcto (multiplicación y división exactas con detección de
  empate).
- Para implementar, hay que seguir el **ensamblador** (`tools/ghidra/ExportAsm.java`),
  no solo el decompilado.

## Clases (RTTI)

Las vtables conservan los nombres de las clases (ver `tools/ghidra/ExportVtables.java`):
`Sexy::PhysObj`, `Ball` (bola y pegs redondos), `Line`, `Poly`, `Brick`, `Gun`,
`Hole`, `Mover`, `PegInfo`, `LogicMgr`, `AIMgr`/`AIBall`, `Board`, etc. El nombre
interno del proyecto era `ThunderballApp`.

Métodos virtuales comunes de PhysObj: `+0x44` SetPos, `+0x48` Move, `+0x4c` SetVel,
`+0x58` Update (tick), `+0x5c` UpdateF (interpolación para dibujar, sin efecto físico).

## Tick del tablero (`FUN_0040de20`)

1. `Update()` de todos los objetos de la lista `+0x764`, en orden. Las bolas también
   están en esa lista (se agregan al final al disparar).
2. `Update()` del cañón.
3. Pasada de colisiones `FUN_004547c0`. Se arman pares (bola, objeto) por
   *sort-and-sweep* con AABB (comparación inclusiva) y, por cada bola con pares, se
   llama a `FUN_00493390`.
4. Las bolas sin intento de colisión (`+0x141 == 0`) hacen `Move(v)`.
5. Bola perdida si `y − r > 570`, `x − r > 660`, `x + r < −10` o `y + r < −10`
   (tablero de 650×560, `+0x780/+0x784`).
6. `FUN_00471620`: la lógica procesa los choques encolados por el callback
   `DAT_006cbdd4`.

Orden de la lista de objetos: entradas del nivel, luego `_base.dat` (`FUN_00408c50`).
Los candidatos de colisión se ordenan por puntero (orden de reserva de memoria); se
aproxima con el orden de la lista. Solo importa en empates exactos de tiempo de
impacto.

## Movimiento (`Sexy::Mover`)

- `PhysObj::Update` (`FUN_004a06b0`): si `canMove`, `tick++` y calcula. Si no, solo
  recalcula si tiene padre. Después `SetPos(nueva)` y `SetVel(nueva − anterior)`.
  El tick inicial es el campo `tickOffset` del nivel (bit 4 de los flags genéricos).
- Fase (`FUN_0049d310`): aritmética entera (truncamiento hacia cero) con
  `offset`, pausas (`pause1`/`pause2`, en ticks) en `phase1`/`phase2` (% del ciclo) y
  `postDelayPhase`. El resultado es `(v mod período) / período`.
- Posición (`FUN_0049d430`): 15 tipos (1 vaivén vertical, 2 horizontal, 3 círculo, 4/5
  infinito, 6/7 arcos, 8 rotación, 9 rotación de ida y vuelta, 11/12 wrap, 13 rotar en
  círculo, 14 círculo de ida y vuelta, 15 forma rara). Ángulo
  `a = (fase · float(2π)) · dir`. Los tipos 13/14 con `radius2 ≠ 0` calculan la
  orientación con `atan2` de la tangente. Al final se rota alrededor del ancla si
  `moveRotation ≠ 0`.
- Padre compartido: un sub-movimiento referencia otro `Mover` por id de objeto (ids
  en orden de lectura, desde 3). Antes de calcular, el hijo suma al ancla el
  desplazamiento del padre desde la última vez (`FUN_0049d240`).
- Implementación: `packages/sim/src/mover.ts`.

## Polígonos

- `FUN_004a15a0`: un segmento por cada par de puntos consecutivos (la lista viene
  cerrada). Un solo lado si `normalDir ≠ 0` (por defecto 1).
- La escala solo la usa el editor: los puntos del archivo ya vienen escalados.
- Normal del segmento (`FUN_0049afe0`): `normalizar(y1 − y2, x2 − x1)`.
- `SetPos` solo traslada pos/AABB y marca "sucio". Los segmentos se actualizan al
  usarlos (`FUN_004a2f30`).
- Con `Mover`: rotación = la del mover. `omega` = diferencia respecto del tick
  anterior, normalizada a [−π, π] (`FUN_004a35d0`).
- Cerrado y convexo se calculan en `FUN_004a1920`. La detección de "bola adentro" usa
  la distancia mínima (convexo) o la paridad de cruces (no convexo).

## Disparo (`Gun::Shoot`, `FUN_00498e70`)

- La bola se carga estática en el cañón (`FUN_00498da0`), en el punto de salida.
- Al disparar: `vx = cos(a)·4`, `vy = −4·sin(a)`. Si el ángulo cambió en los últimos
  10 ticks, usa un ángulo guardado (anti-temblor).
- Radio de la bola: 6.0.
- En el online se congela el cañón durante el tiro. El original le suma su velocidad
  angular a la colisión con el cañón; solo importa si la bola toca el cañón mientras
  rota.

## Pendiente

- [ ] Geometría exacta de los ladrillos (`Brick`, ~`FUN_00495810`). Hoy se usa el
      contorno aproximado.
- [ ] Captura en el balde de bola gratis y su lógica.
- [ ] Reglas: elección de pegs naranjas/verdes/violeta (RNG), puntaje, fever, poderes
      de los maestros, turnos del duelo.
- [ ] Rescate de bola atascada (`FUN_00472cb0`, usa `rand()`).
- [ ] Confirmar 100 Hz.
