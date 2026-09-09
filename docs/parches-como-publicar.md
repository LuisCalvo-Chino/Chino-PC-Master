# Cómo publicar un parche en «Parches y Noticias»

La bitácora vive en `assets/parches.json`. La página (`parches.html`) y el renderizador
(`assets/parches.js`) no se tocan para publicar: solo se agrega una entrada al JSON.

## Pasos

1. Abre `assets/parches.json`.
2. Agrega un objeto **al inicio** del arreglo `parches` (el más reciente va arriba; de todas
   formas la página reordena por fecha, así que un descuido no rompe nada).
3. Actualiza el campo `actualizado` de la cabecera con la misma fecha.
4. Sube el cambio. No hace falta tocar versiones de caché: el JSON se pide con `cache: "no-store"`.

## Plantilla de una entrada

```json
{
    "id": "2026-09-15-angeles-algo",
    "fecha": "2026-09-15T21:40:00-06:00",
    "producto": "angeles",
    "titulo": "Título corto, en lenguaje de usuario",
    "resumen": "Una o dos líneas: qué gana quien usa la herramienta.",
    "cambios": [
        { "tipo": "nuevo", "texto": "Función que antes no existía." },
        { "tipo": "mejorado", "texto": "Algo que ya existía y ahora funciona mejor." },
        { "tipo": "corregido", "texto": "Un fallo que dejó de ocurrir." },
        { "tipo": "nota", "texto": "Aclaración o contexto, sin viñeta de color." }
    ]
}
```

- **`id`**: cualquier texto único; la convención es `fecha-producto-tema`.
- **`fecha`**: ISO con la zona de Costa Rica (`-06:00`). La página muestra esa hora tal cual, sin
  convertirla al huso del visitante.
- **`producto`**: uno de los `id` de la lista `productos` (`angeles`, `rifa`, `certificados`,
  `admin`, `sitio`). Para una herramienta nueva, agrega primero su producto a esa lista; el color
  de la etiqueta se define en `style.css` con la clase `.patch-tag--<id>`.
- **`tipo`**: `nuevo`, `mejorado`, `corregido` o `nota`. Se agrupan y ordenan solos.

## Tono

Se escribe para quien usa la herramienta, no para quien la programa: nada de nombres de archivo,
funciones ni identificadores de commit. «Guardar la tabla dos veces ya no duplica correos», no
«se añadió un guard de concurrencia en el handler».

## Un parche = un commit

Cada commit que llega a `main` debería dejar su entrada en el JSON. Si un mismo commit toca dos
áreas (por ejemplo la app de Ángeles y el sitio), se escriben **dos entradas**, una por producto,
para que los filtros por aplicación sigan siendo fieles.
