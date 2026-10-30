/**
 * Bitácora «Parches y Noticias».
 *
 * La página solo aporta el esqueleto; el contenido vive en assets/parches.json para que publicar
 * un parche nuevo sea agregar un objeto al inicio de ese arreglo, sin tocar HTML ni este archivo.
 *
 * Un parche por día: si ese día se tocaron varias áreas, «producto» es un arreglo y cada cambio
 * dice a cuál pertenece con su propio «producto». Así los filtros por aplicación siguen siendo fieles.
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

    const EMOJI_TIPOS = { nuevo: "🆕", mejorado: "✨", corregido: "🔧", nota: "📝" };

    const URL_PARCHES = "https://chinopcmaster.com/#parches";

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

    /** Áreas que toca un parche, en el orden en que se escribieron. */
    function productosDe(parche) {
        const raw = Array.isArray(parche.producto) ? parche.producto : [parche.producto];
        const ids = raw.map((x) => String(x || "").trim()).filter(Boolean);
        return ids.length ? ids : ["sitio"];
    }

    function productoDeCambio(cambio, parche) {
        return String((cambio && cambio.producto) || "").trim() || productosDe(parche)[0];
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

    function htmlTag(id, productos) {
        const prod = productos.get(id);
        return `<span class="patch-tag patch-tag--${esc(id)}">${esc(prod ? prod.nombre : "Sitio web")}</span>`;
    }

    /**
     * Cambios del parche: si toca una sola área van agrupados por tipo; si toca varias, primero
     * por área (con su etiqueta) y dentro de cada una por tipo. Con un filtro activo solo se
     * muestran los cambios de esa área.
     */
    function htmlCuerpo(parche, ids, productos) {
        const cambios = (Array.isArray(parche.cambios) ? parche.cambios : []).filter((c) =>
            ids.includes(productoDeCambio(c, parche))
        );
        if (ids.length < 2) return `<div class="patch-card__changes">${htmlCambios(cambios)}</div>`;
        return ids
            .map((id) => {
                const propios = cambios.filter((c) => productoDeCambio(c, parche) === id);
                if (!propios.length) return "";
                return `<div class="patch-area">
                        <p class="patch-area__head">${htmlTag(id, productos)}</p>
                        <div class="patch-card__changes">${htmlCambios(propios)}</div>
                    </div>`;
            })
            .join("");
    }

    /**
     * Texto del parche listo para pegar en WhatsApp (*negrita*, _cursiva_, viñetas «•»).
     * Siempre lleva el parche completo, sin importar el filtro activo.
     */
    function textoWhatsApp(parche, productos) {
        const ids = productosDe(parche);
        const cambios = Array.isArray(parche.cambios) ? parche.cambios : [];
        const nombre = (id) => (productos.get(id) ? productos.get(id).nombre : "Sitio web");
        const bloque = (lista) =>
            agrupaCambios(lista)
                .map(
                    (g) =>
                        `${EMOJI_TIPOS[g.tipo]} *${TIPOS[g.tipo].etiqueta}*\n` +
                        g.textos.map((t) => `• ${t}`).join("\n")
                )
                .join("\n\n");

        const partes = [
            `🛠️ *Parches y Noticias · Chino PC Master*`,
            `📅 ${fechaLarga(parche.fecha)} · ${horaCorta(parche.fecha)}`,
            `📌 ${ids.map(nombre).join(" · ")}`,
            "",
            `*${parche.titulo || ""}*`
        ];
        if (parche.resumen) partes.push(`_${parche.resumen}_`);
        partes.push("");

        if (ids.length < 2) {
            partes.push(bloque(cambios));
        } else {
            partes.push(
                ids
                    .map((id) => {
                        const propios = cambios.filter((c) => productoDeCambio(c, parche) === id);
                        return propios.length ? `▸ *${nombre(id).toUpperCase()}*\n\n${bloque(propios)}` : "";
                    })
                    .filter(Boolean)
                    .join("\n\n")
            );
        }
        partes.push("", `🔗 Bitácora completa: ${URL_PARCHES}`);
        return partes.join("\n");
    }

    async function copiarTexto(texto) {
        if (navigator.clipboard && window.isSecureContext) {
            await navigator.clipboard.writeText(texto);
            return;
        }
        const ta = document.createElement("textarea");
        ta.value = texto;
        ta.setAttribute("readonly", "");
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand("copy");
        ta.remove();
        if (!ok) throw new Error("copy");
    }

    function htmlParche(parche, productos, destacado, filtro, admin) {
        const todos = productosDe(parche);
        const ids = filtro && filtro !== "todos" ? todos.filter((id) => id === filtro) : todos;
        const fecha = fechaLarga(parche.fecha);
        const hora = horaCorta(parche.fecha);
        return `<article class="patch-card${destacado ? " patch-card--featured" : ""}" data-producto="${esc(todos.join(" "))}">
                ${destacado ? '<p class="patch-card__flag tech-font">Último parche</p>' : ""}
                <header class="patch-card__head">
                    ${todos.map((id) => htmlTag(id, productos)).join("")}
                    <time class="patch-card__date tech-font" datetime="${esc(parche.fecha)}">
                        ${esc(fecha)}<span class="patch-card__hour"> · ${esc(hora)}</span>
                    </time>
                    ${
                        admin
                            ? `<button type="button" class="patch-copy tech-font" data-copiar="${esc(parche.fecha)}" title="Copiar este parche como mensaje de WhatsApp">Copiar para WhatsApp</button>`
                            : ""
                    }
                </header>
                <h3 class="patch-card__title">${esc(parche.titulo || "")}</h3>
                ${parche.resumen ? `<p class="patch-card__lead">${esc(parche.resumen)}</p>` : ""}
                ${htmlCuerpo(parche, ids, productos)}
            </article>`;
    }

    function render(data, filtro, admin) {
        const productos = new Map((data.productos || []).map((p) => [p.id, p]));
        const parches = (data.parches || [])
            .slice()
            .sort((a, b) => fechaOrden(b.fecha) - fechaOrden(a.fecha));

        const feed = document.getElementById("patch-feed");
        const count = document.getElementById("patch-count");
        if (!feed) return;

        const visibles =
            filtro === "todos" ? parches : parches.filter((p) => productosDe(p).includes(filtro));

        if (!visibles.length) {
            feed.innerHTML = '<p class="patch-empty">Todavía no hay parches publicados para esta aplicación.</p>';
        } else {
            feed.innerHTML = visibles
                .map((p, i) => htmlParche(p, productos, i === 0, filtro, admin))
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
            parches.some((x) => productosDe(x).includes(p.id))
        );
        const chips = [{ id: "todos", nombre: "Todas" }].concat(productos);
        cont.innerHTML = chips
            .map((c) => {
                const n =
                    c.id === "todos"
                        ? parches.length
                        : parches.filter((p) => productosDe(p).includes(c.id)).length;
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
        const apps = new Set(parches.flatMap((p) => productosDe(p))).size;
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
        const esAdmin = () => Boolean(ctx && typeof ctx.isAdmin === "function" && ctx.isAdmin());
        const feed = document.getElementById("patch-feed");
        try {
            const v = (typeof window !== "undefined" && window.CPM_ASSET_V) || "1";
            const res = await fetch(`assets/parches.json?v=${encodeURIComponent(v)}`, {
                cache: "no-store"
            });
            if (!res.ok) throw new Error("No se pudo leer la bitácora.");
            const data = await res.json();
            const productos = new Map((data.productos || []).map((p) => [p.id, p]));
            let filtroActual = "todos";
            const pinta = () => render(data, filtroActual, esAdmin());
            renderStats(data);
            renderFiltros(data, (filtro) => {
                filtroActual = filtro;
                pinta();
            });
            pinta();

            // Solo admin: el botón copia el parche completo con formato de WhatsApp.
            if (feed && !feed.dataset.copiaLista) {
                feed.dataset.copiaLista = "1";
                feed.addEventListener("click", async (ev) => {
                    const btn = ev.target.closest("[data-copiar]");
                    if (!btn || !esAdmin()) return;
                    const parche = (data.parches || []).find((p) => p.fecha === btn.getAttribute("data-copiar"));
                    if (!parche) return;
                    try {
                        await copiarTexto(textoWhatsApp(parche, productos));
                        btn.textContent = "¡Copiado!";
                        btn.classList.add("is-done");
                        showMessage("Parche copiado. Ya puedes pegarlo en WhatsApp.", "success");
                    } catch (e) {
                        showMessage("No se pudo copiar el parche.", "error");
                    }
                    window.setTimeout(() => {
                        btn.textContent = "Copiar para WhatsApp";
                        btn.classList.remove("is-done");
                    }, 2000);
                });
            }

            // Al iniciar o cerrar sesión estando en la página, aparece o desaparece el botón.
            if (window.__cpmParchesSesion) {
                document.removeEventListener("cpm:session-change", window.__cpmParchesSesion);
            }
            window.__cpmParchesSesion = () => {
                if (document.getElementById("patch-feed") === feed) pinta();
            };
            document.addEventListener("cpm:session-change", window.__cpmParchesSesion);
        } catch (e) {
            if (feed) {
                feed.innerHTML =
                    '<p class="patch-empty">No se pudo cargar la bitácora de parches. Recarga la página para intentarlo de nuevo.</p>';
            }
            showMessage("No se pudo cargar la bitácora de parches.", "error");
        }
    };
})();
