# Bingo Digital (Beta 3) — Instrucciones de implementación

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
6. Para actualizar el código después: pega el archivo completo de nuevo, guarda y ve a **Administrar implementaciones → Editar → Versión: Nueva versión**. La URL no cambia. Los bingos que ya existen reciben solos las columnas nuevas de sus hojas la primera vez que se abren.

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
| `#bp/<código>` | Pantalla para proyectar | Se abre desde el juego («⧉ Abrir pantalla»): bolas cantadas y la rifa en vivo, en otra ventana del mismo equipo |
| `#bv/<pub>.<código>` | Encargado de sector (uno por encargado) o link general del sector | Registrar ventas con comprador, correo y comprobante; enviar links; imprimir su bloque |
| `#bc/<pub>` | Público | Comprar con comprobante |
| `#bj/<pub>.<token>` | Jugador | Todos sus cartones con la bola en vivo: las compras con el mismo correo comparten link |
| `#bt/<pub>-<serie>-<código>` | Quien escanea el QR | Un cartón suelto en vivo; el código impide inventar series |

## 5. Uso

1. **Hub → + Nuevo bingo**: nombre, fecha, precio por cartón y (opcional) el correo Google del cliente, al que se le comparte la carpeta del bingo. Envía el link de organizador por WhatsApp.
2. **Ajustes** (primera vez): fecha y hora (se muestran como «15 de nov de 2026 a las 19:00»), lugar, SINPE, **combos de precios**, marcado del jugador y los mensajes.
   - **Combos**: cantidad de cartones + precio. El total de cualquier cantidad es la combinación de combos más barata que suma exactamente esa cantidad (combos 1 = ₡3 000 y 10 = ₡19 000 → 21 cartones = ₡41 000). El combo de 1 cartón es obligatorio. Si comprar un cartón más cuesta lo mismo o menos, el panel avisa que los precios no están escalonados y pide confirmar. No hay límite de 20: hasta 1000 cartones por compra.
   - **Juego y BINGO → Marcado y ganadores**: «BINGO manual» (por defecto: el jugador marca tocando la casilla; el cantador no ve qué cartones ganaron, solo «¡Ya hay alguien con este premio!», y revisa cada cartón que cante BINGO) o «BINGO automático» (se marcan solos y el jugador puede cambiar a manual; el cantador ve de inmediato los cartones ganadores).
   - **Juego y BINGO → Bolas**: «Bolas de la app» (solo «Sacar bola», sin escribir números) o «Tómbola física» (solo se escribe el número que salió).
   - **Dígitos de la serie**: 3, 4 o 5 (001 / 0001 / 00001). Una serie más larga nunca se recorta.
   - **Mensajes**: WhatsApp con formato y emojis, con vista previa de chat. Correo con editor visual (o HTML) y vista previa de bandeja de entrada; los emojis del correo se avisan y se quitan al guardar.
3. **Cartones**: template (PNG, PNG transparente o PDF de 10 × 14 cm), arte (1200 × 1680 px), **centro del cartón** (espacio libre o número; con espacio libre, imagen PNG de exactamente 190 × 190 px), vista previa, lote, PDF por rango y buscar un cartón.
4. **Sectores**: bloque de series por sector y **varios encargados**, cada uno con su link. El resumen desglosa cartones, monto y ventas por sector y por encargado. En la compra pública, el comprador elige al encargado que le vendió.
5. **Ventas**: Pendientes → Aprobar → Por enviar (WhatsApp, correo, copiar link) → Historial. El correo es obligatorio y une las compras de una persona en un solo link. Los vendedores registran ventas con comprador, correo, series impresas o cartones asignados, pago y comprobante (obligatorio en SINPE y transferencia).
6. **Juego**: rondas de tres tipos:
   - **Figuras y premios**: varios premios por ronda, cada uno con su figura (incluye verticales B/I/N/G/O, horizontales por fila, diagonales y figura personalizada). El panel muestra qué cartones vendidos ya completaron cada premio.
   - **El cartón más salado**: ranking en vivo de los cartones vendidos con más espacios en blanco.
   - **Eliminación**: cada bola elimina los cartones que la tienen; el panel cuenta los que siguen en pie y avisa cuando queda uno (o si una bola saca a todos).
   Las rondas se ordenan con ↑ ↓; un ganador mal registrado se puede quitar.
   - **Verificar**: dice si el cartón cumple cada premio y con qué bola lo completó («la última cantada» o «hace N bolas»).
   - **Rifa**: los cartones que cantaron BINGO se agregan a la rifa desde la verificación (en automático aparecen solos). Con 2 o más, «Rifar entre N cartones» elige uno al azar y se registra con el dato «rifa entre …». La lista se guarda en el equipo del cantador.
   - **Pantalla**: «⧉ Abrir pantalla» abre otra ventana con solo las bolas cantadas; al rifar, muestra la rifa y la serie ganadora. Debe abrirse en el mismo navegador y equipo del cantador.

### Figuras

Línea (cualquiera), línea horizontal, vertical, diagonal, 4 esquinas, X, L, T, marco, cartón lleno, vertical de cada letra, horizontal de cada fila, cada diagonal y figura personalizada. El centro libre cuenta como marcado; con número en el centro se marca solo si sale su bola.

### Template del cartón (px, 1200 × 1680)

| Zona | x | y | ancho × alto |
|------|---|---|--------------|
| Título (arte libre) | 60 | 50 | 1080 × 330 |
| Letras B I N G O | 125 | 395 | 950 × 110 |
| Casillas 5 × 5 (190 px c/u, blancas) | 125 | 515 | 950 × 950 |
| Centro (imagen opcional del espacio libre) | 505 | 895 | 190 × 190 |
| Serie | 125 | 1515 | 360 × 110 |
| QR | 530 | 1495 | 140 × 140 |
| Código | 715 | 1515 | 360 × 110 |

## 6. Bola en vivo

Al cantar, el script escribe el estado en `CacheService` y en la hoja pública «Bingo en vivo». El link del jugador lee esa hoja directo de Google (consulta `gviz`) cada 5 s durante la ronda y cada 10 s fuera de ella; se pausa con la pestaña oculta. Si la lectura directa falla 3 veces, cambia a la acción `estado` del Apps Script.

**Por medir en la Beta:** el retraso real de la lectura directa (la caché de Google puede sumar segundos) y cuántos jugadores aguanta la alternativa por Apps Script (~30 ejecuciones a la vez por cuenta).

## 7. Acciones API (POST JSON)

- Hub (`masterPin`): `super_list`, `super_create`, `super_update`, `super_delete`
- Público: `get_compra`, `submit_compra`, `get_player`, `get_card`, `estado`, `get_arte` (arte y centro)
- Organizador (`hash`): `resolve_admin`, `update_config`, `upload_arte`, `delete_arte`, `upload_centro`, `delete_centro`, `save_precios`, `save_sectores`, `list_entradas`, `get_comprobante`, `approve_entrada`, `reject_entrada`, `return_entrada`, `complete_entrada`, `reopen_entrada`, `mark_sent`, `send_email`, `vender_presencial`, `ampliar_lote`, `list_cartones`
- Sector o encargado (`hash`): `sector_resolve`, `sector_vender`, `sector_mark_sent`, `sector_comprobante`
- Juego (`hash` del organizador o del cantador): `game_get`, `game_save_ronda`, `game_delete_ronda`, `game_mover_ronda`, `game_abrir`, `game_cantar`, `game_deshacer`, `game_ganador`, `game_quitar_ganador`, `game_cerrar`, `game_buscar`

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
- [ ] Beta 2: combos (21 cartones con combos 1 y 10), aviso de escalonado, compra de 2 veces con el mismo correo → un solo link
- [ ] Beta 2: encargado registra venta con comprobante; el resumen la cuenta para ese encargado
- [ ] Beta 2: ronda con 3 premios, ronda «más salado» y eliminación; marcado manual y automático; centro con número y con imagen
- [ ] Beta 2: vista previa del correo y de WhatsApp; correo real recibido sin emojis
- [ ] Beta 3: BINGO manual (ganadores ocultos, verificar y rifar) y automático (ganadores a la vista); tómbola vs. bolas de la app; pantalla con rifa; series de 3 dígitos; «↻ Actualizar» en Resumen
