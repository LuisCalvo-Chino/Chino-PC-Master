# Rifa multi-proyecto — Instrucciones de implementación

Sistema para gestionar varias rifas a la vez desde **WebApps → Rifa**, con un link administrador único por proyecto (`#r/<hash>`).

## Arquitectura

| Pieza | Rol |
|-------|-----|
| Spreadsheet principal | Una hoja `Proyectos` (registro) + una hoja por rifa (`00`–`99`) |
| Apps Script (1 Web App) | Backend: CRUD de proyectos, números, config y banner |
| GitHub Pages | Hub `#rifa` (permiso `rifa`) + admin público `#r/<hash>` |

Código del backend listo para copiar: [`assets/gas-rifa-Código.js.txt`](../assets/gas-rifa-Código.js.txt).

## 1. Crear el Spreadsheet

1. En Google Drive, crea una hoja de cálculo nueva (puede estar vacía).
2. Copia el **ID** de la URL: `https://docs.google.com/spreadsheets/d/ESTE_ES_EL_ID/edit`
3. No hace falta crear la hoja `Proyectos` a mano: el script la crea al primer uso.

## 2. Desplegar Apps Script

1. Ve a [script.google.com](https://script.google.com) con la cuenta que tendrá el Spreadsheet.
2. **Nuevo proyecto** → borra el código por defecto.
3. Abre en el sitio el archivo `assets/gas-rifa-Código.js.txt`, copia **todo** y pégalo en `Código.js`.
4. Engranaje **Configuración del proyecto** → **Propiedades del script**:

| Propiedad | Valor |
|-----------|--------|
| `SPREADSHEET_ID` | ID del Spreadsheet del paso 1 |
| `MASTER_ADMIN_PIN` | Llave maestra que tú eliges (la misma del hub web) |

5. **Implementar** → **Nueva implementación** → tipo **Aplicación web**:
   - Ejecutar como: **Yo**
   - Quién tiene acceso: **Cualquiera**
6. Copia la URL que termina en `/exec`.

### Actualizar a la versión 2 (archivado automático)

1. Abre el proyecto de Apps Script existente y reemplaza **todo** `Código.js` con el contenido nuevo de `assets/gas-rifa-Código.js.txt`.
2. **Implementar → Administrar implementaciones →** lápiz (Editar) **→ Versión: «Nueva versión» → Implementar.** Así la URL `/exec` sigue siendo la misma y no hay que tocar `index.html`.
3. En el editor, elige la función `instalarArchivadoAutomatico` y pulsa **Ejecutar** una sola vez (acepta los permisos). Crea un activador diario (2 a.m.) que marca `activo = FALSE` en las rifas vencidas.
4. La columna `fecha_archivo` se agrega sola al final de la hoja `Proyectos` la primera vez que se lista o crea una rifa. Las rifas existentes quedan **sin fecha** (no se archivan solas) hasta que les pongas una desde el hub.

Aunque no instales el activador, una rifa vencida deja de abrir al instante: el script revisa la fecha en cada acceso. El activador solo mantiene la hoja al día.

## 3. Conectar el sitio

En [`index.html`](../index.html), dentro del bloque `<script>` de configuración:

```html
window.CPM_RIFA_GAS_URL = "https://script.google.com/macros/s/XXXX/exec";
```

Opcional (uploads de logo/iconos del banner):

```html
window.CPM_IMGBB_API_KEY = "TU_CLAVE_IMGBB";
```

Si no defines ImgBB, el front usa la clave por defecto del proyecto (igual que Ángeles).

Publica/despliega el sitio (GitHub Pages) para que los cambios de HTML/JS/CSS estén en línea.

## 4. Permisos de usuario

El hub `#rifa` exige sesión en Chino PC Master con **permiso Rifa** (`permisos.rifa`), configurable desde Admin de usuarios.

El link `#r/<hash>` es **público**: no requiere login del sitio; el hash es el secreto de acceso.

## 5. Uso del hub

1. Entra a **WebApps → Rifa**.
2. Escribe la **Llave Maestra** (= `MASTER_ADMIN_PIN`) y pulsa **Guardar**.
3. Pestaña **Lista → Activas**: proyectos vigentes, fecha en que se archivan (ícono de calendario para cambiarla), abrir/copiar el link, **archivar ahora** o eliminar.
4. Pestaña **Lista → Archivadas** (versión 2): rifas vencidas o archivadas a mano. **Reactivar** pide una nueva fecha de archivado o «sin fecha»; **Eliminar** borra la fila y la hoja de números.
5. **+ Nuevo**: crea la rifa (valida modalidad/fecha), elige el **archivado automático** (1 día, 1 semana o 1 mes después del sorteo, una fecha propia o sin fecha), genera la hoja `00`–`99` y el link `#r/…`, con botón para enviarlo por WhatsApp.
6. **Guía**: resumen de despliegue dentro de la app.

### Validación de fechas

| Modalidad | Fecha permitida |
|-----------|-----------------|
| Chances | Martes o viernes (sorteo 7:30 p.m.) |
| Lotería Nacional | Domingo (sorteo 7:30 p.m.) |
| RNG del App | Cualquier día |

## 6. Link de quien organiza (`#r/<hash>`)

Mini app pensada para el teléfono (barra de secciones abajo; pestañas arriba en computadora). El instructivo público para quien organiza está en la página **Rifas Digitales** (`#rifas-digitales`).

- **Asistente de primera vez** — nombre, premios, precio y sorteo, SINPE y WhatsApp, estilo de la imagen y pasos para el acceso directo. Aparece mientras `banner_json.setup.done` no sea `true` o falten datos (premio «Por definir», sin precio o sin SINPE); en ese caso no se puede saltar. La fecha del sorteo debe ser de hoy en adelante y a más tardar la `fecha_archivo`.
- **Rifa nueva desde el hub** — el hub solo pide la hoja y el archivado: «una semana después del sorteo» o «sin fecha». La primera opción guarda la fecha marcadora `2099-12-31`; cuando el cliente elige el sorteo, la fecha real (sorteo + 7 días) la pone el Apps Script al guardar el asistente (versión con ese cambio) o, si no, el hub al cargar la lista. Cambiar el sorteo desde el hub mueve el archivado si seguía siendo sorteo + 7. Como el Apps Script exige premio, modalidad y fecha para crearla, se envían valores de relleno (`premio_1: "Por definir"`, modalidad `RNG`, fecha de hoy, sin precio ni SINPE) que el cliente reemplaza en el asistente.
- **Sorteo fijo** — modalidad y fecha solo se eligen en el asistente de primer uso; Ajustes y el asistente reabierto los muestran sin poder cambiarlos. Desde el hub, el botón del lápiz en la columna «Sorteo» los cambia (`super_update_project`). El Apps Script (desde esta versión) también ignora modalidad y fecha en `update_config` cuando la rifa ya no tiene el premio de relleno.
- **Resumen** — vendidos de 100, libres/apartados/pagados, recaudado y por cobrar (precio × números).
- **Números** — cuadrícula con colores (libre, apartado, pagado) y nombre del comprador; búsqueda y filtros; selección de varios números y hoja «Anotar comprador» (autocompleta compradores existentes).
- **Compradores** — números agrupados por persona, lo que debe, «Marcar pagado», recordatorio o confirmación de pago por WhatsApp; «Ver todos los números en cuadrícula» (tabla editable y CSV), destacado.
- **Compartir** — botones rápidos al inicio y al final (compartir imagen y mensaje, descargar imagen, enviar solo texto por WhatsApp, copiar mensaje); imagen 1080×1920 dibujada en canvas con seis estilos de un toque y el editor «Personalizar colores, letras y logotipo» (vista previa en vivo, una letra para todo o una por texto, logotipo que se sube al elegirlo); mensaje armado solo (saludo, despedida y qué incluir; números libres y vendidos sin marcar por defecto). La imagen se muestra en una ventana y cada acción (compartir, guardar en Fotos, descargar, copiar) es un toque nuevo, como exige el iPhone.
- **Ajustes** — datos de la rifa (incluido el nombre visible; el sorteo se muestra fijo), acceso directo, copiar el enlace privado y volver a abrir el asistente.
- **Sorteo** — solo si modalidad = RNG; animación ~7 s y exclusión de ganadores previos.

**Acceso directo:** la página cambia su manifest por uno propio de la rifa (`start_url` = el link `#r/…`, nombre de la rifa) para que el ícono abra directo esa rifa. En Android Chrome se ofrece el botón de instalación nativo cuando el navegador lo permite; si no, y en iPhone, se muestran los pasos según el teléfono.

**Datos extra en `banner_json`:** además del diseño se guardan `theme` (estilo elegido), `setup` (asistente terminado) y `mensaje` (saludo, despedida y opciones). No requieren cambios en el Apps Script.

## 7. Modelo de datos

### Hoja `Proyectos`

Columnas: `project_id`, `sheet_name`, `nombre_display`, `hash_admin`, `created_at`, `cantidad_premios`, `premio_1`–`premio_3`, `modalidad`, `fecha_sorteo`, `whatsapp`, `sinpe`, `precio`, `banner_json`, `activo`, `fecha_archivo` (v2, `YYYY-MM-DD` o vacío).

Una rifa está **vigente** si `activo` es verdadero y hoy no es posterior a `fecha_archivo`.

### Hoja por rifa (`sheet_name`)

| numero | estado | nombre | telefono | contacto |
|--------|--------|--------|----------|----------|
| 00–99 | Disponible / Reservado / Pagado | … | … | … |

## 8. Acciones API (POST JSON)

Auth hub: `masterPin`. Auth admin: `hash`.

- `super_list_projects` (v2: `include_inactive: true` devuelve también las archivadas, con `vencida` y `archive_supported`), `super_create_project` (v2: `fecha_archivo`), `super_get_project`, `super_update_project` (v2: `fecha_archivo`), `super_delete_project` (`hard: false` archiva, `hard: true` elimina)
- `super_reactivate_project` (v2): `project_id`, `fecha_archivo` (`""` = sin fecha)
- `resolve_by_hash` / `get_project_data`
- `update_numbers`, `update_config`, `update_banner`
- `ping`

Respuesta exitosa: `{ "status": "SUCCESS", "data": { … } }`.

## 9. Checklist de prueba

- [ ] `CPM_RIFA_GAS_URL` responde a `ping`
- [ ] Hub lista proyectos con la llave correcta y rechaza llave incorrecta
- [ ] Crear rifa Chances con fecha martes/viernes OK; domingo falla
- [ ] Link `#r/…` abre Cuadrícula sin login
- [ ] Reservar/pagar números y ver reflejo en Lista y Sheet
- [ ] Descargar CSV y JPG del banner
- [ ] Modalidad RNG muestra pestaña Sorteo y sortea sin repetir ganadores
- [ ] Rifa nueva abre el asistente; al terminarlo no vuelve a aparecer
- [ ] Compartir genera la imagen y el mensaje con los números libres actuales
- [ ] (v2) Crear con archivado y ver la fecha en Activas; rifa vencida no abre su link y aparece en Archivadas
- [ ] (v2) Reactivar con fecha nueva y sin fecha; eliminar una archivada

## Archivos tocados en el sitio

- `rifa.html`, `assets/rifa.js`, `assets/rifa-api.js`
- `rifas-digitales.html` (instructivo público) e `imagenes/rifas/` (capturas con datos de demostración)
- `assets/gas-rifa-Código.js.txt`
- `assets/app.js` (rutas `#r/` y carga de scripts)
- `index.html` (`CPM_RIFA_GAS_URL`)
- `style.css` (hub + admin)
- `docs/rifa-implementacion.md` (este documento)
