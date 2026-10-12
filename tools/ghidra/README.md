# Ghidra: exportar el código decompilado

Este script exporta a texto la decompilación de **todas** las funciones de
`PeggleNights.exe`, junto con los strings y las constantes float. Así se puede
buscar en todo el binario con grep, por ejemplo la física, las colisiones o las
reglas del duelo.

La salida se deriva del binario del juego: **no se commitea**. Las carpetas
`ghidra-export/` y `ghidra-project/` ya están en `.gitignore`.

## Requisitos

1. **Java 21 (JDK)**. Por ejemplo Temurin 21 desde <https://adoptium.net>.
2. **Ghidra 11.x**, descomprimido en una carpeta, por ejemplo `C:\ghidra`.

## 1. Extraer el ejecutable real

En la versión de Steam, `PeggleNights.exe` es solo el **lanzador DRM de PopCap**. El
juego real va pegado al final del archivo (después de la marca
`!popcapdrmprotect!`), sin cifrar. Hay que analizar ese ejecutable interno, no el
lanzador:

```bash
node tools/extract-inner-exe.ts "F:/SteamLibrary/steamapps/common/Peggle Nights"
```

Genera `game/PeggleNights.inner.exe` (en `.gitignore`).

## 2. Exportar (headless, sin abrir la interfaz)

Desde la raíz del repo, en PowerShell. Si Java 21 no está en el PATH, definí antes
`$env:JAVA_HOME`; por ejemplo, Android Studio trae una JDK 21 en
`C:\Program Files\Android\Android Studio\jbr`.

```powershell
& "C:\ghidra\support\analyzeHeadless.bat" `
  "$PWD\ghidra-project" PeggleNights `
  -import "$PWD\game\PeggleNights.inner.exe" `
  -scriptPath "$PWD\tools\ghidra" `
  -postScript ExportDecompiled.java "$PWD\ghidra-export"
```

El análisis y la decompilación tardan varios minutos. Para volver a exportar
sobre un proyecto ya analizado, cambiá `-import <exe>` por `-process PeggleNights.exe -noanalysis`.

## Qué genera

| Archivo | Contenido |
|---|---|
| `ghidra-export/all.c` | Todas las funciones decompiladas, concatenadas |
| `ghidra-export/functions/*.c` | Una función por archivo (`<dirección>_<nombre>.c`) |
| `ghidra-export/strings.tsv` | Strings, con las funciones que los usan |
| `ghidra-export/floats.tsv` | Constantes float/double referenciadas (gravedad, rebote, etc.) |
