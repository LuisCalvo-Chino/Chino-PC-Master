/**
 * Bitácora «Parches y Noticias».
 *
 * La página solo aporta el esqueleto; el contenido vive en assets/parches.json para que publicar
 * un parche nuevo sea agregar un objeto al inicio de ese arreglo, sin tocar HTML ni este archivo.
 */
(function () {
    "use strict";

    const TIPOS = {
        nuevo: { etiqueta: "Nuevo", clase: "is-nuevo" },
        mejorado: { etiqueta: "Mejorado", clase: "is-mejorado" },
        corregido: { etiqueta: "Corregido", clase: "is-corregido" },
        nota: { etiqueta: "Nota", clase: "is-nota" }
    };

    const ORDEN_TIPOS = ["nuevo", "mejorado", "corregido", "nota"];

    function esc(s) {
        return String(s == null ? "" : s)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;");
    }

    const MESES = [
        "enero",
        "febrero",
        "marzo",
        "abril",
        "mayo",
        "junio",
        "julio",
        "agosto",
        "septiembre",
        "octubre",
        "noviembre",
        "diciembre"
    ];

    /** Fecha del JSON (ISO con zona de Costa Rica) → «9 de septiembre de 2026». */
    function fechaLarga(iso) {
        const p = partesFecha(iso);
        if (!p) return "";
        return `${p.d} de ${MESES[p.mo - 1]} de ${p.y}`;
    }

    /** Hora local del parche tal como se publicó, en formato de 24 h. */
    function horaCorta(iso) {
        const p = partesFecha(iso);
        if (!p) return "";
        return `${String(p.hh).padStart(2, "0")}:${String(p.mm).padStart(2, "0")}`;
    }

    /**
     * Se leen los componentes del texto ISO en vez de usar Date: así la fecha y la hora que ve
     * el visitante son las de publicación (Costa Rica), no las de su propio huso horario.
     */
    function partesFecha(iso) {
        const m = String(iso || "")
            .trim()
            .match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/);
        if (!m) return null;
        return {
            y: Number(m[1]),
            mo: Number(m[2]),
            d: Number(m[3]),
            hh: Number(m[4] || 0),
            mm: Number(m[5] || 0)
        };
    }

    function fechaOrden(iso) {
        const p = partesFecha(iso);
        if (!p) return 0;
        return Date.UTC(p.y, p.mo - 1, p.d, p.hh, p.mm);
    }

    function agrupaCambios(cambios) {
        const lista = Array.isArray(cambios) ? cambios : [];
        const grupos = new Map();
        lista.forEach((c) => {
            const tipo = TIPOS[String(c.tipo || "").toLowerCase()] ? String(c.tipo).toLowerCase() : "nota";
            if (!grupos.has(tipo)) grupos.set(tipo, []);
            grupos.get(tipo).push(String(c.texto || ""));
        });
        return ORDEN_TIPOS.filter((t) => grupos.has(t)).map((t) => ({ tipo: t, textos: grupos.get(t) }));
    }

    function htmlCambios(cambios) {
        return agrupaCambios(cambios)
            .map((g) => {
                const meta = TIPOS[g.tipo];
                const items = g.textos.map((t) => `<li>${esc(t)}</li>`).join("");
                return `<div class="patch-change patch-change--${esc(g.tipo)}">
                        <p class="patch-change__label tech-font ${meta.clase}">${esc(meta.etiqueta)}</p>
                        <ul class="patch-change__list">${items}</ul>
                    </div>`;
            })
            .join("");
    }

    function htmlParche(parche, producto, destacado) {
        const nombreProducto = producto ? producto.nombre : "Sitio web";
        const idProducto = producto ? producto.id : "sitio";
        const fecha = fechaLarga(parche.fecha);
        const hora = horaCorta(parche.fecha);
        return `<article class="patch-card${destacado ? " patch-card--featured" : ""}" data-producto="${esc(idProducto)}">
                ${destacado ? '<p class="patch-card__flag tech-font">Último parche</p>' : ""}
                <header class="patch-card__head">
                    <span class="patch-tag patch-tag--${esc(idProducto)}">${esc(nombreProducto)}</span>
                    <time class="patch-card__date tech-font" datetime="${esc(parche.fecha)}">
                        ${esc(fecha)}<span class="patch-card__hour"> · ${esc(hora)}</span>
                    </time>
                </header>
                <h3 class="patch-card__title">${esc(parche.titulo || "")}</h3>
                ${parche.resumen ? `<p class="patch-card__lead">${esc(parche.resumen)}</p>` : ""}
                <div class="patch-card__changes">${htmlCambios(parche.cambios)}</div>
            </article>`;
    }

    function render(data, filtro) {
        const productos = new Map((data.productos || []).map((p) => [p.id, p]));
        const parches = (data.parches || [])
            .slice()
            .sort((a, b) => fechaOrden(b.fecha) - fechaOrden(a.fecha));

        const feed = document.getElementById("patch-feed");
        const count = document.getElementById("patch-count");
        if (!feed) return;

        const visibles = filtro === "todos" ? parches : parches.filter((p) => p.producto === filtro);

        if (!visibles.length) {
            feed.innerHTML = '<p class="patch-empty">Todavía no hay parches publicados para esta aplicación.</p>';
        } else {
            feed.innerHTML = visibles
                .map((p, i) => htmlParche(p, productos.get(p.producto), i === 0))
                .join("");
        }

        if (count) {
            const n = visibles.length;
            const nombre = filtro === "todos" ? "en total" : `de ${productos.get(filtro)?.nombre || ""}`;
            count.textContent = n === 1 ? `1 parche ${nombre}.` : `${n} parches ${nombre}.`;
        }
    }

    function renderFiltros(data, onChange) {
        const cont = document.getElementById("patch-filters");
        if (!cont) return;
        const parches = data.parches || [];
        const productos = (data.productos || []).filter((p) =>
            parches.some((x) => x.producto === p.id)
        );
        const chips = [{ id: "todos", nombre: "Todas" }].concat(productos);
        cont.innerHTML = chips
            .map((c) => {
                const n =
                    c.id === "todos"
                        ? parches.length
                        : parches.filter((p) => p.producto === c.id).length;
                return `<button type="button" class="patch-chip${c.id === "todos" ? " is-active" : ""}" data-filtro="${esc(
                    c.id
                )}" aria-pressed="${c.id === "todos"}">${esc(c.nombre)} <span class="patch-chip__n">${n}</span></button>`;
            })
            .join("");
        cont.addEventListener("click", (ev) => {
            const btn = ev.target.closest("[data-filtro]");
            if (!btn) return;
            cont.querySelectorAll(".patch-chip").forEach((b) => {
                const activo = b === btn;
                b.classList.toggle("is-active", activo);
                b.setAttribute("aria-pressed", String(activo));
            });
            onChange(btn.getAttribute("data-filtro"));
        });
    }

    function renderStats(data) {
        const el = document.getElementById("patch-stats");
        if (!el) return;
        const parches = data.parches || [];
        const apps = new Set(parches.map((p) => p.producto)).size;
        const ultima = parches
            .slice()
            .sort((a, b) => fechaOrden(b.fecha) - fechaOrden(a.fecha))[0];
        const desde = parches
            .slice()
            .sort((a, b) => fechaOrden(a.fecha) - fechaOrden(b.fecha))[0];
        el.innerHTML = [
            `<li><strong>${parches.length}</strong> parches publicados</li>`,
            `<li><strong>${apps}</strong> áreas con historial</li>`,
            ultima ? `<li>Último: <strong>${esc(fechaLarga(ultima.fecha))}</strong></li>` : "",
            desde ? `<li>Desde <strong>${esc(fechaLarga(desde.fecha))}</strong></li>` : ""
        ]
            .filter(Boolean)
            .join("");
    }

    window.initParchesApp = async function initParchesApp(ctx) {
        const showMessage = (ctx && ctx.showMessage) || function () {};
        const feed = document.getElementById("patch-feed");
        try {
            const v = (typeof window !== "undefined" && window.CPM_ASSET_V) || "1";
            const res = await fetch(`assets/parches.json?v=${encodeURIComponent(v)}`, {
                cache: "no-store"
            });
            if (!res.ok) throw new Error("No se pudo leer la bitácora.");
            const data = await res.json();
            renderStats(data);
            renderFiltros(data, (filtro) => render(data, filtro));
            render(data, "todos");
        } catch (e) {
            if (feed) {
                feed.innerHTML =
                    '<p class="patch-empty">No se pudo cargar la bitácora de parches. Recarga la página para intentarlo de nuevo.</p>';
            }
            showMessage("No se pudo cargar la bitácora de parches.", "error");
        }
    };
})();
