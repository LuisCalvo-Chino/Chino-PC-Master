# Bingo Digital (Beta 1) — Instrucciones de implementación

Sistema para que cada cliente administre su propio bingo desde un link, con cartones propios (hasta 10 000), ventas en línea y presenciales por sectores, y juego en vivo para jugadores presenciales y virtuales.

## Arquitectura

| Pieza | Rol |
|-------|-----|
| GitHub Pages | Las páginas: hub `#bingo` (solo admin) y links por rol. Dibuja cartones, template y PDF en el navegador. |
| Apps Script (1 Web App) | Backend: registro de bingos, ventas, sectores, juego, correo. Código: [`assets/gas-bingo-Código.js.txt`](../assets/gas-bingo-Código.js.txt) |
| Spreadsheet de registro | Hoja `Bingos`: una fila por bingo (links, semilla, IDs de su Spreadsheet y carpeta). |
| Un Spreadsheet por bingo | Hojas `config`, `cartones`, `entradas`, `sectores`, `precios`, `rondas`. Lo crea el script. |
| Una carpeta de Drive por bingo | `comprobantes/` (privada) y `diseño/` (el arte del cartón, visible con el link). |
| Spreadsheet «Bingo en vivo» | Público de solo lectura; contiene **solo** las bolas cantadas de cada bingo. Los jugadores lo leen directo de Google. |

Los cartones **no se guardan como imagen**: cada uno se calcula de la semilla del bingo y su serie (`assets/bingo-core.js`). En `cartones` solo hay una fila por cartón vendido.

## 1. Crear el Spreadsheet de registro

1. En Google Drive crea una hoja de cálculo vacía (por ejemplo «Bingo Digital — Registro»).
2. Copia su **ID** de la URL: `https://docs.google.com/spreadsheets/d/ESTE_ES_EL_ID/edit`.
3. Opcional: crea una carpeta «Bingos» y copia su ID (`drive.google.com/drive/folders/ESTE_ID`). Ahí se crean las carpetas de cada bingo.

## 2. Desplegar Apps Script

1. [script.google.com](https://script.google.com) → **Nuevo proyecto** → borra el código por defecto.
2. Copia **todo** `assets/gas-bingo-Código.js.txt` en `Código.js`.
3. **Configuración del proyecto → Propiedades del script**:

| Propiedad | Valor |
|-----------|-------|
| `SPREADSHEET_ID` | ID del registro (paso 1) |
| `MASTER_ADMIN_PIN` | Llave maestra que eliges para el hub |
| `ROOT_FOLDER_ID` | (Opcional) carpeta «Bingos» |

4. En el editor elige la función **`instalarBingo`** y pulsa **Ejecutar** una vez. Acepta los permisos (Sheets, Drive, correo). Crea el Spreadsheet público «Bingo en vivo» y guarda `VIVO_SPREADSHEET_ID`.
5. **Implementar → Nueva implementación → Aplicación web**: Ejecutar como **Yo** · Acceso **Cualquiera**. Copia la URL `/exec`.
6. Para actualizar el código después: **Administrar implementaciones → Editar → Versión: Nueva versión**. La URL no cambia.

## 3. Conectar el sitio

En `index.html`:

```html
window.CPM_BINGO_GAS_URL = "https://script.google.com/macros/s/XXXX/exec";
```

Publica el sitio. En **WebApps → Bingo** (solo cuentas admin) escribe la llave maestra y pulsa **Guardar**.

## 4. Links

| Link | Quién | Qué hace |
|------|-------|----------|
| `#bingo` | Tú (admin) | Crear, archivar, reactivar y quitar bingos; copiar los links |
| `#b/<código>` | Organizador | Resumen, Ventas, Cartones, Sectores, Juego, Ajustes |
| `#bk/<código>` | Cantador | Solo el juego |
| `#bv/<pub>.<código>` | Encargado de sector | Registrar ventas de su bloque, enviar links, imprimir su bloque |
| `#bc/<pub>` | Público | Comprar con comprobante |
| `#bj/<pub>.<token>` | Jugador | Sus cartones con la bola en vivo |
| `#bt/<pub>-<serie>-<código>` | Quien escanea el QR | Un cartón suelto en vivo; el código impide inventar series |

## 5. Uso

1. **Hub → + Nuevo bingo**: nombre, fecha, precio por cartón y (opcional) el correo Google del cliente, al que se le comparte la carpeta del bingo. Envía el link de organizador por WhatsApp.
2. **Ajustes** (primera vez): fecha, hora, lugar, SINPE, precios de 1 a 20 cartones (de 21 en adelante se usa el precio por cartón) y los mensajes de WhatsApp y correo.
3. **Cartones**: descargar el template (PNG, PNG transparente o PDF de 10 × 14 cm), subir el arte (1200 × 1680 px), ver la vista previa, ampliar el lote, imprimir PDF por rango (1, 2, 4 o 6 por hoja carta, máximo 100 cartones por archivo) y buscar un cartón.
4. **Sectores**: bloques de series por sector con su link. Los rangos no se cruzan; las compras en línea usan las series fuera de ellos.
5. **Ventas**: Pendientes → Aprobar (asigna los siguientes libres o las series que elijas) → Por enviar (WhatsApp, correo, copiar link) → Historial. «Devolver a pendientes» libera los cartones.
6. **Juego**: crear rondas (figura + premio), Empezar, Sacar bola (azar) o anotar la bola del bombo físico, Deshacer, Verificar una serie, Registrar ganador, Terminar ronda.

### Figuras

Línea (cualquiera), línea horizontal, vertical, diagonal, 4 esquinas, X, L, T, marco y cartón lleno. El centro libre cuenta como marcado.

### Template del cartón (px, 1200 × 1680)

| Zona | x | y | ancho × alto |
|------|---|---|--------------|
| Título (arte libre) | 60 | 50 | 1080 × 330 |
| Letras B I N G O | 125 | 395 | 950 × 110 |
| Casillas 5 × 5 (190 px c/u, blancas) | 125 | 515 | 950 × 950 |
| Serie | 125 | 1515 | 360 × 110 |
| QR | 530 | 1495 | 140 × 140 |
| Código | 715 | 1515 | 360 × 110 |

## 6. Bola en vivo

Al cantar, el script escribe el estado en `CacheService` y en la hoja pública «Bingo en vivo». El link del jugador lee esa hoja directo de Google (consulta `gviz`) cada 5 s durante la ronda y cada 10 s fuera de ella; se pausa con la pestaña oculta. Si la lectura directa falla 3 veces, cambia a la acción `estado` del Apps Script.

**Por medir en la Beta:** el retraso real de la lectura directa (la caché de Google puede sumar segundos) y cuántos jugadores aguanta la alternativa por Apps Script (~30 ejecuciones a la vez por cuenta).

## 7. Acciones API (POST JSON)

- Hub (`masterPin`): `super_list`, `super_create`, `super_update`, `super_delete`
- Público: `get_compra`, `submit_compra`, `get_player`, `get_card`, `estado`, `get_arte`
- Organizador (`hash`): `resolve_admin`, `update_config`, `upload_arte`, `delete_arte`, `save_precios`, `save_sectores`, `list_entradas`, `get_comprobante`, `approve_entrada`, `reject_entrada`, `return_entrada`, `complete_entrada`, `reopen_entrada`, `mark_sent`, `send_email`, `vender_presencial`, `ampliar_lote`, `list_cartones`
- Sector (`hash`): `sector_resolve`, `sector_vender`, `sector_mark_sent`
- Juego (`hash` del organizador o del cantador): `game_get`, `game_save_ronda`, `game_delete_ronda`, `game_abrir`, `game_cantar`, `game_deshacer`, `game_ganador`, `game_cerrar`, `game_buscar`

Respuesta: `{ "status": "SUCCESS", "data": { … } }` o `{ "status": "ERROR", "message": "…" }`.

## 8. Checklist de prueba

- [ ] `ping` responde y `instalarBingo` creó «Bingo en vivo»
- [ ] Crear bingo desde el hub: aparecen su Spreadsheet y su carpeta en Drive
- [ ] Ajustes guardan precios y SINPE; el aviso de primera vez desaparece
- [ ] Template descarga; un arte de 1200 × 1680 se sube y se ve en la vista previa y en el link del jugador
- [ ] Compra pública con comprobante → Pendientes → Aprobar → link del jugador abre sus cartones
- [ ] Correo de prueba llega con el link
- [ ] Sector: vender series de su bloque; series fuera del bloque se rechazan
- [ ] PDF de 4 por hoja con QR; el QR abre el cartón suelto
- [ ] Ronda: sacar bolas, el jugador ve la última bola en menos de ~10 s, verificar y registrar ganador
- [ ] Medir el retraso de la lectura directa con 2–3 teléfonos
