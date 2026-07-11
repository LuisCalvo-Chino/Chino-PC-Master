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
3. Pestaña **Lista**: proyectos existentes, copiar link admin, eliminar (marca `activo=FALSE`).
4. **+ Nuevo**: crea la rifa (valida modalidad/fecha), genera hoja `00`–`99` y el link `#r/…`.
5. **Guía**: resumen de despliegue dentro de la app.

### Validación de fechas

| Modalidad | Fecha permitida |
|-----------|-----------------|
| Chances | Martes o viernes (sorteo 7:30 p.m.) |
| Lotería Nacional | Domingo (sorteo 7:30 p.m.) |
| RNG del App | Cualquier día |

## 6. Link administrador (`#r/<hash>`)

Pestañas:

- **Cuadrícula** — grid 10×10 (5 en móvil), selección múltiple, panel de edición, stats y descarga JPG del banner.
- **Lista** — misma data en tabla + CSV.
- **Config** — premios, modalidad, fecha, WhatsApp, SINPE, precio.
- **Banner** — editor 1080×1920 (9:16), preview, ImgBB, descarga **JPG**.
- **Rifa** — solo si modalidad = RNG; animación ~7 s y exclusión de ganadores previos.

## 7. Modelo de datos

### Hoja `Proyectos`

Columnas: `project_id`, `sheet_name`, `nombre_display`, `hash_admin`, `created_at`, `cantidad_premios`, `premio_1`–`premio_3`, `modalidad`, `fecha_sorteo`, `whatsapp`, `sinpe`, `precio`, `banner_json`, `activo`.

### Hoja por rifa (`sheet_name`)

| numero | estado | nombre | telefono | contacto |
|--------|--------|--------|----------|----------|
| 00–99 | Disponible / Reservado / Pagado | … | … | … |

## 8. Acciones API (POST JSON)

Auth hub: `masterPin`. Auth admin: `hash`.

- `super_list_projects`, `super_create_project`, `super_get_project`, `super_update_project`, `super_delete_project`
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
- [ ] Modalidad RNG muestra pestaña Rifa y sortea sin repetir ganadores

## Archivos tocados en el sitio

- `rifa.html`, `assets/rifa.js`, `assets/rifa-api.js`
- `assets/gas-rifa-Código.js.txt`
- `assets/app.js` (rutas `#r/` y carga de scripts)
- `index.html` (`CPM_RIFA_GAS_URL`)
- `style.css` (hub + admin)
- `docs/rifa-implementacion.md` (este documento)
