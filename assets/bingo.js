/**
 * Bingo Digital — hub (#bingo) y links por rol:
 *   #b/<hash>   organizador (todo su bingo)
 *   #bk/<hash>  cantador (solo el juego)
 *   #bp/<hash>  pantalla para proyectar (bolas cantadas y rifa), abierta desde el juego
 *   #bv/<hash>  vendedor o encargado de sector
 *   #bc/<pub>   compra pública
 *   #bj/<token> jugador (todos sus cartones: las compras con el mismo correo comparten link)
 *   #bt/<pub>-<serie>-<código>  un cartón suelto (el QR impreso)
 * Requiere bingo-core.js y bingo-api.js.
 */
(function () {
    const C = window.BingoCore;
    const LIB_JSPDF = "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js";
    const LIB_QR = "https://cdnjs.cloudflare.com/ajax/libs/qrcode-generator/1.4.4/qrcode.min.js";
    const MASTER_KEY = "cpm_bingo_master";

    let app = null;
    let showMessage = (t) => console.log(t);
    let vivoActual = null;
    let generacion = 0;

    /* ================= Utilidades ================= */

    function el(tag, attrs, ...kids) {
        const n = document.createElement(tag);
        if (attrs) {
            Object.entries(attrs).forEach(([k, v]) => {
                if (v === null || v === undefined || v === false) return;
                if (k === "class") n.className = v;
                else if (k === "text") n.textContent = v;
                else if (k === "html") n.innerHTML = v;
                else if (k.startsWith("on") && typeof v === "function") n.addEventListener(k.slice(2), v);
                else if (k === "dataset") Object.assign(n.dataset, v);
                else if (v === true) n.setAttribute(k, "");
                else n.setAttribute(k, v);
            });
        }
        kids.flat(Infinity).forEach((k) => {
            if (k === null || k === undefined || k === false) return;
            n.appendChild(typeof k === "string" || typeof k === "number" ? document.createTextNode(String(k)) : k);
        });
        return n;
    }

    /** append() que ignora null/false (las secciones opcionales se pasan como null). */
    function agregar(nodo, ...kids) {
        kids.flat(Infinity).forEach((k) => {
            if (k !== null && k !== undefined && k !== false) nodo.append(k);
        });
    }

    /** replaceChildren() que ignora null/false, igual que agregar(). */
    function poner(nodo, ...kids) {
        nodo.replaceChildren();
        agregar(nodo, ...kids);
    }

    const colones = (n) => "₡" + Math.round(Number(n) || 0).toLocaleString("es-CR");

    function baseUrl() {
        return `${window.location.origin}${window.location.pathname}`;
    }

    const links = {
        organizador: (h) => `${baseUrl()}#b/${h}`,
        cantador: (h) => `${baseUrl()}#bk/${h}`,
        pantalla: (h) => `${baseUrl()}#bp/${h}`,
        sector: (h) => `${baseUrl()}#bv/${h}`,
        compra: (p) => `${baseUrl()}#bc/${p}`,
        jugador: (t) => `${baseUrl()}#bj/${t}`,
        carton: (p, seed, s) => `${baseUrl()}#bt/${p}-${s}-${C.codigo(seed, s)}`
    };

    function waUrl(telefono, texto) {
        let t = String(telefono || "").replace(/[^\d]/g, "");
        if (t.length === 8) t = "506" + t;
        return `https://wa.me/${t}?text=${encodeURIComponent(texto)}`;
    }

    async function copiar(texto, aviso) {
        try {
            await navigator.clipboard.writeText(texto);
            showMessage(aviso || "Copiado.", "success");
        } catch (e) {
            modal("Copia este texto", el("textarea", { class: "bn-input bn-copy-area", rows: 4, readonly: true, text: texto }));
        }
    }

    function render(tpl, vars) {
        return String(tpl || "").replace(/\{\{(\w+)\}\}/g, (_, k) => (vars[k] === undefined ? "" : String(vars[k])));
    }

    /* ---------- Fechas: «15 de nov de 2026 a las 19:00» ---------- */
    const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

    function fechaLarga(fecha, hora) {
        const m = String(fecha || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
        const h = String(hora || "").match(/^(\d{1,2}):(\d{2})/);
        let t = m ? `${Number(m[3])} de ${MESES[Number(m[2]) - 1]} de ${m[1]}` : String(fecha || "");
        if (h) t += `${t ? " a las " : ""}${h[1].padStart(2, "0")}:${h[2]}`;
        return t;
    }

    /** «2026-11-15 19:05:22» → «15 de nov de 2026 a las 19:05». */
    function fechaHoraTexto(texto) {
        const m = String(texto || "").match(/^(\d{4}-\d{2}-\d{2})(?:[ T](\d{1,2}:\d{2}))?/);
        return m ? fechaLarga(m[1], m[2]) : String(texto || "");
    }

    /** Línea de fecha, hora y lugar del bingo. */
    function cuando(cfg) {
        return [fechaLarga(cfg.fecha, cfg.hora), cfg.lugar].filter(Boolean).join(" · ");
    }

    const centroNumero = (cfg) => cfg.centro_numero === true || cfg.centro === "numero";

    /* ---------- Combos de precios ---------- */

    /**
     * Total de N cartones: la combinación de combos más barata que suma exactamente N.
     * Devuelve { total, partes: [{ cantidad, precio, veces }] } o null si N no se puede armar.
     * Igual que precioCombos_() del Apps Script.
     */
    function cotizar(combos, unitario, n) {
        n = Math.floor(Number(n) || 0);
        if (n <= 0) return { total: 0, partes: [] };
        let lista = (combos || []).filter((c) => c.cantidad > 0 && c.precio >= 0);
        if (!lista.some((c) => c.cantidad === 1) && Number(unitario) > 0) lista = [...lista, { cantidad: 1, precio: Number(unitario) }];
        if (!lista.length) return null;
        const mejor = [0];
        const paso = [null];
        for (let i = 1; i <= n; i++) {
            let m = Infinity;
            let elegido = null;
            lista.forEach((c) => {
                if (c.cantidad <= i && mejor[i - c.cantidad] + c.precio < m) {
                    m = mejor[i - c.cantidad] + c.precio;
                    elegido = c;
                }
            });
            mejor.push(m);
            paso.push(elegido);
        }
        if (!isFinite(mejor[n])) return null;
        const cuenta = new Map();
        for (let i = n; i > 0; i -= paso[i].cantidad) cuenta.set(paso[i], (cuenta.get(paso[i]) || 0) + 1);
        const partes = [...cuenta.entries()].map(([c, veces]) => ({ cantidad: c.cantidad, precio: c.precio, veces })).sort((a, z) => z.cantidad - a.cantidad);
        return { total: mejor[n], partes };
    }

    function precioLocal(combos, unitario, n) {
        const c = cotizar(combos, unitario, n);
        return c ? c.total : 0;
    }

    /** «2 × combo de 10 + 1 cartón» */
    function desgloseTexto(c) {
        if (!c || !c.partes.length) return "";
        return c.partes.map((p) => (p.cantidad === 1 ? `${p.veces} ${p.veces === 1 ? "cartón suelto" : "cartones sueltos"}` : `${p.veces} × combo de ${p.cantidad}`)).join(" + ");
    }

    /** Cantidades donde comprar uno más no cuesta más (el escalonado se rompe). */
    function fallasEscalonado(combos, unitario) {
        const max = Math.min(1000, Math.max(60, ...combos.map((c) => c.cantidad * 3)));
        const fallas = [];
        let previo = 0;
        for (let n = 1; n <= max; n++) {
            const c = cotizar(combos, unitario, n);
            if (!c) return [{ n, sinPrecio: true }];
            if (n > 1 && c.total <= previo) fallas.push({ n, total: c.total, anterior: previo });
            previo = c.total;
        }
        return fallas;
    }

    /* ---------- Emojis (bien en WhatsApp, mal en muchos correos) ---------- */
    const RE_EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{1F1E6}-\u{1F1FF}\u{FE0F}\u{200D}\u{20E3}]/gu;
    const tieneEmojis = (t) => new RegExp(RE_EMOJI.source, "u").test(String(t || ""));
    const sinEmojis = (t) => String(t || "").replace(RE_EMOJI, "");

    /** Variables de los mensajes para una compra. */
    function varsMensaje(cfg, e, link) {
        return {
            nombre: String(e.nombre || "").split(" ")[0], bingo: cfg.nombre, fecha: fechaLarga(cfg.fecha, cfg.hora), lugar: cfg.lugar || "",
            cantidad: e.cantidad, monto: colones(e.monto), cartones: String(e.cartones || "").split(",").filter(Boolean).map((x) => C.serieTexto(x)).join(", "), link
        };
    }

    async function llamar(payload, opts) {
        const res = await window.CPMBingoApi.post(payload, opts);
        const d = res.data || {};
        /* Los dígitos de la serie vienen en la configuración del bingo (Ajustes). */
        const cfg = d.config || (d.juego && d.juego.config);
        if (cfg && cfg.digitos) C.setDigitos(cfg.digitos);
        return d;
    }

    /** Ejecuta una acción con el botón deshabilitado y mensaje de error legible. */
    async function conBoton(btn, fn, textoOcupado) {
        const original = btn ? btn.textContent : "";
        if (btn) {
            btn.disabled = true;
            if (textoOcupado) btn.textContent = textoOcupado;
        }
        try {
            return await fn();
        } catch (e) {
            showMessage(e.message || "No se pudo completar.", "error", 6000);
            return undefined;
        } finally {
            if (btn) {
                btn.disabled = false;
                if (textoOcupado) btn.textContent = original;
            }
        }
    }

    function cargarScript(src) {
        return new Promise((resolve, reject) => {
            if (document.querySelector(`script[data-bn-src="${src}"]`)) return resolve();
            const s = document.createElement("script");
            s.src = src;
            s.dataset.bnSrc = src;
            s.onload = () => resolve();
            s.onerror = () => reject(new Error("No se pudo cargar una librería. Revisa tu conexión."));
            document.head.appendChild(s);
        });
    }

    async function fuentesListas() {
        try {
            await document.fonts.load("700 92px Montserrat");
        } catch (e) {
            /* se usa la letra de respaldo */
        }
    }

    function cargarImagen(src) {
        return new Promise((resolve) => {
            if (!src) return resolve(null);
            const img = new Image();
            img.onload = () => resolve(img);
            img.onerror = () => resolve(null);
            img.src = src;
        });
    }

    function modal(titulo, contenido, acciones) {
        const cerrar = () => fondo.remove();
        const fondo = el(
            "div",
            { class: "bn-modal-bg", onclick: (e) => e.target === fondo && cerrar() },
            el(
                "div",
                { class: "bn-modal", role: "dialog", "aria-modal": "true", "aria-label": titulo },
                el("div", { class: "bn-modal-head" }, el("h3", { text: titulo }), el("button", { class: "bn-icon-btn", "aria-label": "Cerrar", onclick: cerrar, text: "×" })),
                el("div", { class: "bn-modal-body" }, contenido),
                acciones ? el("div", { class: "bn-modal-actions" }, acciones(cerrar)) : null
            )
        );
        document.body.appendChild(fondo);
        return cerrar;
    }

    function confirmar(titulo, texto, textoBoton, peligro) {
        return new Promise((resolve) => {
            modal(titulo, el("p", { text: texto }), (cerrar) => [
                el("button", { class: "bn-btn", onclick: () => { cerrar(); resolve(false); }, text: "Cancelar" }),
                el("button", { class: `bn-btn ${peligro ? "bn-btn--danger" : "bn-btn--primary"}`, onclick: () => { cerrar(); resolve(true); }, text: textoBoton })
            ]);
        });
    }

    /** Opciones grandes (radio) con título y explicación; el contenedor expone .value como un select. */
    function opcionesGrandes(nombre, opciones, valor) {
        const caja = el("div", { class: "bn-choices", role: "radiogroup" });
        opciones.forEach(([v, titulo, texto]) => {
            const r = el("input", { type: "radio", name: nombre, value: v });
            r.checked = v === valor;
            caja.append(el("label", { class: "bn-choice" }, r, el("span", {}, el("b", { text: titulo }), el("small", { class: "bn-note bn-block", text: texto }))));
        });
        Object.defineProperty(caja, "value", { get: () => { const x = caja.querySelector("input:checked"); return x ? x.value : valor; } });
        return caja;
    }

    const horaCorta = (d) => `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;

    function campo(etiqueta, input, nota) {
        return el("label", { class: "bn-field" }, el("span", { class: "bn-label", text: etiqueta }), input, nota ? el("small", { class: "bn-note", text: nota }) : null);
    }

    function input(id, valor, attrs) {
        return el("input", { class: "bn-input", id, value: valor === undefined || valor === null ? "" : String(valor), ...(attrs || {}) });
    }

    function select(id, opciones, valor) {
        const s = el("select", { class: "bn-input", id });
        opciones.forEach(([v, t]) => {
            const o = el("option", { value: v, text: t });
            if (String(v) === String(valor)) o.selected = true;
            s.appendChild(o);
        });
        return s;
    }

    function tile(valor, etiqueta, extra) {
        return el("div", { class: "bn-tile" }, el("strong", { text: valor }), el("span", { text: etiqueta }), extra ? el("small", { text: extra }) : null);
    }

    function pantallaError(texto) {
        poner(app, el("div", { class: "bn-empty bn-empty--error" }, el("h2", { text: "No se pudo abrir" }), el("p", { text: texto })));
    }

    function cargando(texto) {
        poner(app, el("div", { class: "bn-loading" }, el("div", { class: "bn-spinner" }), el("p", { text: texto || "Cargando…" })));
    }

    /** Comprime una imagen a JPEG (lado mayor ≤ max). PDF se envía tal cual. */
    function archivoADataUrl(file, max) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onerror = () => reject(new Error("No se pudo leer el archivo."));
            reader.onload = async () => {
                const dataUrl = String(reader.result);
                if (!/^image\//.test(file.type) || /gif/.test(file.type)) return resolve(dataUrl);
                const img = await cargarImagen(dataUrl);
                if (!img) return resolve(dataUrl);
                const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
                const cv = document.createElement("canvas");
                cv.width = Math.round(img.naturalWidth * k);
                cv.height = Math.round(img.naturalHeight * k);
                cv.getContext("2d").drawImage(img, 0, 0, cv.width, cv.height);
                resolve(cv.toDataURL("image/jpeg", 0.85));
            };
            reader.readAsDataURL(file);
        });
    }

    function descargarBlob(blob, nombre) {
        const url = URL.createObjectURL(blob);
        const a = el("a", { href: url, download: nombre });
        document.body.appendChild(a);
        a.click();
        a.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 4000);
    }

    function canvasABlob(cv, tipo, calidad) {
        return new Promise((resolve) => cv.toBlob(resolve, tipo || "image/png", calidad));
    }

    function tituloCarton(cfg) {
        return {
            titulo: cfg.nombre || "BINGO",
            subtitulo: cuando(cfg)
        };
    }

    /* ================= Estado en vivo ================= */

    /** Lee la hoja pública «vivo» directo de Google (JSONP de gviz). */
    function leerGviz(vivoId, pub) {
        return new Promise((resolve, reject) => {
            if (!/^[\w-]+$/.test(vivoId) || !/^\w+$/.test(pub)) return reject(new Error("id"));
            const cb = `__bnVivo${Date.now()}${Math.floor(Math.random() * 1e6)}`;
            const s = document.createElement("script");
            const tq = encodeURIComponent(`select B where A = '${pub}'`);
            const timer = window.setTimeout(() => fin(new Error("tiempo")), 8000);
            function fin(err, val) {
                window.clearTimeout(timer);
                delete window[cb];
                s.remove();
                if (err) reject(err);
                else resolve(val);
            }
            window[cb] = (resp) => {
                try {
                    const v = resp.table.rows[0].c[0].v;
                    fin(null, JSON.parse(v));
                } catch (e) {
                    fin(new Error("vacío"));
                }
            };
            s.onerror = () => fin(new Error("red"));
            s.src = `https://docs.google.com/spreadsheets/d/${vivoId}/gviz/tq?tqx=responseHandler:${cb}&sheet=vivo&headers=1&tq=${tq}&_=${Date.now()}`;
            document.head.appendChild(s);
        });
    }

    function firmaVivo(v) {
        return JSON.stringify([v.r, v.e, v.b, premiosVivo(v).map((p) => (p.g || []).length), (v.h || []).length, v.q, v.tp]);
    }

    /** Consulta el estado cada 5 s mientras hay ronda en juego (10 s si no); se pausa con la pestaña oculta. */
    function crearVivo(pub, vivoId, alCambiar) {
        let fallosGviz = vivoId ? 0 : 99;
        let ultimo = null;
        let timer = null;
        let detenido = false;
        let actualizado = 0;

        async function leer() {
            if (fallosGviz < 3) {
                try {
                    const v = await leerGviz(vivoId, pub);
                    fallosGviz = 0;
                    return v;
                } catch (e) {
                    fallosGviz += 1;
                }
            }
            return llamar({ action: "estado", pub }, { timeoutMs: 15000 });
        }

        async function ciclo() {
            if (detenido) return;
            if (!document.hidden) {
                try {
                    const v = await leer();
                    actualizado = Date.now();
                    const firma = firmaVivo(v);
                    if (firma !== ultimo) {
                        ultimo = firma;
                        alCambiar(v);
                    }
                } catch (e) {
                    /* se reintenta en el siguiente ciclo */
                }
            }
            const enJuego = ultimo && JSON.parse(ultimo)[1] === "En juego";
            timer = window.setTimeout(ciclo, enJuego ? 5000 : 10000);
        }

        const alVolver = () => {
            if (!document.hidden && !detenido) {
                window.clearTimeout(timer);
                ciclo();
            }
        };
        document.addEventListener("visibilitychange", alVolver);
        return {
            iniciar(inicial) {
                if (inicial) {
                    ultimo = firmaVivo(inicial);
                    actualizado = Date.now();
                    alCambiar(inicial);
                }
                timer = window.setTimeout(ciclo, 3000);
            },
            detener() {
                detenido = true;
                window.clearTimeout(timer);
                document.removeEventListener("visibilitychange", alVolver);
            },
            segundos: () => (actualizado ? Math.round((Date.now() - actualizado) / 1000) : null)
        };
    }

    function bolaTexto(n) {
        return `${C.letraDe(n)}-${n}`;
    }

    function bolaEl(n, grande) {
        const letra = C.letraDe(n);
        return el("span", { class: `bn-ball bn-ball--${letra.toLowerCase()}${grande ? " bn-ball--big" : ""}` }, el("small", { text: letra }), el("b", { text: n }));
    }

    /* ================= PDF de cartones ================= */

    /** get_arte con caché: { dataUrl (arte), centroDataUrl (imagen del espacio libre) }, sin problemas de CORS. */
    function cargadorArte(pub) {
        let cache = null;
        const fn = async () => {
            if (!cache) cache = await llamar({ action: "get_arte", pub }, { timeoutMs: 60000 });
            return cache;
        };
        fn.limpiar = () => { cache = null; };
        return fn;
    }

    async function generarPdf({ seed, pub, cfg, desde, hasta, porHoja, imagenes, progreso }) {
        await Promise.all([cargarScript(LIB_JSPDF), cargarScript(LIB_QR)]);
        await fuentesListas();
        const arte = await cargarImagen(imagenes && imagenes.dataUrl);
        const conCentro = centroNumero(cfg);
        const centroImg = conCentro ? null : await cargarImagen(imagenes && imagenes.centroDataUrl);
        const { jsPDF } = window.jspdf;
        const d = C.disposicion(porHoja);
        const pdf = new jsPDF({ orientation: d.orient, unit: "mm", format: "letter", compress: true });
        const cv = document.createElement("canvas");
        const escala = porHoja >= 4 ? 0.62 : 0.85;
        const chico = document.createElement("canvas");
        chico.width = Math.round(C.GEOMETRIA.W * escala);
        chico.height = Math.round(C.GEOMETRIA.H * escala);
        const t = tituloCarton(cfg);
        let i = 0;
        for (let s = desde; s <= hasta; s++, i++) {
            if (i > 0 && i % d.posiciones.length === 0) pdf.addPage("letter", d.orient);
            C.dibujarCarton(cv, {
                seed, serie: s, arte, titulo: t.titulo, subtitulo: t.subtitulo, letras: cfg.letras_sistema !== false && cfg.letras_sistema !== "false",
                centroNumero: conCentro, centroImg, qrTexto: links.carton(pub, seed, s)
            });
            chico.getContext("2d").drawImage(cv, 0, 0, chico.width, chico.height);
            const p = d.posiciones[i % d.posiciones.length];
            pdf.addImage(chico.toDataURL("image/jpeg", 0.88), "JPEG", p.x, p.y, p.w, p.h, undefined, "FAST");
            if (progreso && i % 5 === 0) {
                progreso(i + 1, hasta - desde + 1);
                await new Promise((r) => window.setTimeout(r, 0));
            }
        }
        return pdf.output("blob");
    }

    function panelImprimir({ seed, pub, cfg, min, max, obtenerArte, sugerido }) {
        const desde = input("bn-pdf-desde", sugerido ? sugerido[0] : min, { type: "number", min, max });
        const hasta = input("bn-pdf-hasta", sugerido ? sugerido[1] : Math.min(max, min + 99), { type: "number", min, max });
        const porHoja = select("bn-pdf-hoja", [["1", "1 por hoja"], ["2", "2 por hoja"], ["4", "4 por hoja"], ["6", "6 por hoja"]], "4");
        const estado = el("p", { class: "bn-note", text: "Hasta 100 cartones por archivo; un rango mayor se descarga en varios PDF." });
        const btn = el("button", { class: "bn-btn bn-btn--primary", text: "Descargar PDF" });
        btn.addEventListener("click", () =>
            conBoton(btn, async () => {
                const a = Math.max(min, Number(desde.value) || min);
                const z = Math.min(max, Number(hasta.value) || a);
                if (z < a) throw new Error("El rango no es válido.");
                const imagenes = await obtenerArte();
                for (let ini = a; ini <= z; ini += 100) {
                    const fin = Math.min(z, ini + 99);
                    const blob = await generarPdf({
                        seed, pub, cfg, desde: ini, hasta: fin, porHoja: Number(porHoja.value), imagenes,
                        progreso: (n, total) => { estado.textContent = `Cartones ${ini}–${fin}: ${n} de ${total}…`; }
                    });
                    descargarBlob(blob, `cartones-${C.serieTexto(ini)}-${C.serieTexto(fin)}.pdf`);
                }
                estado.textContent = `Listo: cartones ${a}–${z}.`;
            }, "Generando…")
        );
        return el("div", { class: "bn-form-grid" }, campo("Desde la serie", desde), campo("Hasta la serie", hasta), campo("Cartones por hoja carta", porHoja), el("div", { class: "bn-field bn-field--end" }, btn), estado);
    }

    /* ================= Rondas: textos compartidos ================= */

    const TIPOS_RONDA = {
        figuras: "Figuras y premios",
        salado: "El cartón más salado",
        eliminacion: "Eliminación"
    };

    /** Premios de consolación de un premio: «₡5 000; canasta» (la coma de «₡5,000» no separa). */
    const consuelosDe = (p) => String((p && p.consuelo) || "").split(/\s*[;,\n]\s*(?!\d{3}\b)/).map((s) => s.trim()).filter(Boolean);
    /** Un ganador de consolación se registra con un dato que empieza por «Consolación». */
    const esConsuelo = (dato) => /^consolación/i.test(String(dato || ""));

    /** Premios del estado en vivo; acepta también el formato de la versión anterior (una figura). */
    function premiosVivo(v) {
        if (Array.isArray(v.ps)) return v.ps;
        if (v.f || v.p || v.g) return [{ i: 1, f: v.f || "linea", p: v.p || "", g: v.g || [] }];
        return [];
    }

    function premioTexto(p) {
        return `${C.nombreFigura(p.f, p.c)}${p.p ? ` (${p.p})` : ""}`;
    }

    /** Muestra 5×5 de una figura; editable = casillas que se tocan (figura personalizada). */
    function patronEl(figura, celdas, opciones) {
        const o = opciones || {};
        const alt = (C.alternativasDe(figura, celdas)[0]) || [];
        const set = new Set(alt.map(([f, c]) => `${f},${c}`));
        const caja = el("div", { class: `bn-pattern${o.chico ? " bn-pattern--sm" : ""}${o.editable ? " bn-pattern--edit" : ""}` });
        for (let i = 0; i < 25; i++) {
            const k = `${Math.floor(i / 5)},${i % 5}`;
            if (o.editable) {
                const b = el("button", { type: "button", class: set.has(k) ? "on" : "", "aria-label": `Fila ${Math.floor(i / 5) + 1}, columna ${C.LETRAS[i % 5]}`, "aria-pressed": set.has(k) ? "true" : "false" });
                b.addEventListener("click", () => {
                    if (set.has(k)) set.delete(k);
                    else set.add(k);
                    b.className = set.has(k) ? "on" : "";
                    b.setAttribute("aria-pressed", set.has(k) ? "true" : "false");
                    o.alCambiar([...set].join(";"));
                });
                caja.appendChild(b);
            } else {
                caja.appendChild(el("i", { class: set.has(k) ? "on" : "" }));
            }
        }
        return caja;
    }

    /* ================= Vista de cartones del jugador ================= */

    function vistaJugador({ cfg, series, nombre, vivoInicial, token, compras }) {
        const seed = cfg.seed;
        const auto = cfg.marcado_auto === true;
        const conCentro = centroNumero(cfg);
        const claveMarcas = `bn_marcas_${token || cfg.public_id}`;
        let manual = !auto;
        let marcasManuales = {};
        try {
            const g = JSON.parse(localStorage.getItem(claveMarcas) || "{}");
            if (auto && g.manual !== undefined) manual = Boolean(g.manual);
            marcasManuales = g.marcas || {};
        } catch (e) {
            /* sin almacenamiento */
        }
        let vivo = vivoInicial || { e: "Espera", b: [] };
        let arte = null;
        let centroImg = null;
        const t = tituloCarton(cfg);
        const letras = cfg.letras_sistema !== false;
        const gridDe = (serie) => C.carton(seed, serie, conCentro);
        const imagenes = cargadorArte(cfg.public_id);

        const ultima = el("div", { class: "bn-live-last" });
        const previas = el("div", { class: "bn-live-prev" });
        const info = el("div", { class: "bn-live-info" });
        const premiosBar = el("div", { class: "bn-live-prizes" });
        const reloj = el("small", { class: "bn-live-clock" });
        const barra = el("section", { class: "bn-live", "aria-live": "polite" }, ultima, el("div", { class: "bn-live-mid" }, info, premiosBar, previas, reloj));

        /* El organizador decide si existe el marcado automático; si no, solo se marca tocando la casilla. */
        const toggle = auto ? el("button", { class: "bn-btn bn-btn--ghost", onclick: () => { manual = !manual; guardar(); pintarTodo(); } }) : null;
        const cards = el("div", { class: "bn-player-cards" });
        const ganadores = el("section", { class: "bn-card bn-winners", hidden: true });

        function guardar() {
            try {
                /* La preferencia solo se recuerda si el jugador pudo elegir (marcado automático habilitado). */
                localStorage.setItem(claveMarcas, JSON.stringify({ manual: auto ? manual : undefined, marcas: marcasManuales }));
            } catch (e) {
                /* sin almacenamiento */
            }
        }

        function marcasDe(serie) {
            const grid = gridDe(serie);
            if (!manual) return C.marcadas(grid, vivo.b || []);
            const set = new Set(marcasManuales[`${vivo.r || 0}:${serie}`] || []);
            return grid.map((row) => row.map((n) => n === 0 || set.has(n)));
        }

        /** Aviso bajo cada cartón (solo con marcado automático: con marcado manual lo lleva el jugador). */
        function estadoCarton(serie) {
            if (manual || vivo.e !== "En juego") return null;
            const grid = gridDe(serie);
            const bolas = vivo.b || [];
            if (vivo.tp === "salado") {
                const n = C.blancos(grid, bolas);
                return { texto: `${n} ${n === 1 ? "espacio" : "espacios"} en blanco`, clase: "" };
            }
            if (vivo.tp === "eliminacion") {
                const x = C.eliminadoPor(grid, bolas);
                return x ? { texto: `Eliminado con la ${bolaTexto(x)}`, clase: "bn-chip--out", sello: "FUERA" } : { texto: "¡Sigues en juego!", clase: "bn-chip--win" };
            }
            const ps = premiosVivo(vivo);
            const pendientes = ps.filter((p) => !(p.g || []).length);
            let mejor = null;
            (pendientes.length ? pendientes : ps).forEach((p) => {
                const f = C.faltan(grid, bolas, p.f, p.c);
                if (!mejor || f < mejor.f) mejor = { f, p };
            });
            if (!mejor) return null;
            const nombreF = C.nombreFigura(mejor.p.f, mejor.p.c);
            if (mejor.f === 0) return { texto: `¡Completaste ${nombreF}! Canta BINGO`, clase: "bn-chip--win" };
            return { texto: `Te faltan ${mejor.f} · ${nombreF}`, clase: mejor.f === 1 ? "bn-chip--hot" : "" };
        }

        const lienzos = series.map((serie) => {
            const cv = el("canvas", { class: "bn-canvas", width: C.GEOMETRIA.W, height: C.GEOMETRIA.H, "aria-label": `Cartón serie ${serie}` });
            const chip = el("span", { class: "bn-chip" });
            const descargar = el("button", { class: "bn-btn bn-btn--ghost bn-btn--sm", text: "Descargar imagen" });
            descargar.addEventListener("click", () =>
                conBoton(descargar, async () => {
                    await cargarScript(LIB_QR);
                    const r = cfg.arte_url || cfg.centro_url ? await imagenes() : {};
                    const img = await cargarImagen(r.dataUrl);
                    const cen = conCentro ? null : await cargarImagen(r.centroDataUrl);
                    const tmp = document.createElement("canvas");
                    C.dibujarCarton(tmp, { seed, serie, arte: img, titulo: t.titulo, subtitulo: t.subtitulo, letras, centroNumero: conCentro, centroImg: cen, qrTexto: links.carton(cfg.public_id, seed, serie) });
                    descargarBlob(await canvasABlob(tmp, "image/jpeg", 0.92), `carton-${C.serieTexto(serie)}.jpg`);
                }, "Preparando…")
            );
            cv.addEventListener("click", (ev) => {
                if (!manual) return;
                const rect = cv.getBoundingClientRect();
                const pos = C.casillaEn(((ev.clientX - rect.left) / rect.width) * C.GEOMETRIA.W, ((ev.clientY - rect.top) / rect.height) * C.GEOMETRIA.H);
                if (!pos) return;
                const n = gridDe(serie)[pos[0]][pos[1]];
                if (!n) return;
                const k = `${vivo.r || 0}:${serie}`;
                const set = new Set(marcasManuales[k] || []);
                if (set.has(n)) set.delete(n);
                else set.add(n);
                marcasManuales[k] = [...set];
                guardar();
                pintar(serie);
            });
            const wrap = el("figure", { class: "bn-player-card" }, cv, el("figcaption", {}, el("span", { text: `Serie ${C.serieTexto(serie)}` }), chip, descargar));
            cards.appendChild(wrap);
            return { serie, cv, chip };
        });

        function pintar(serie) {
            const l = lienzos.find((x) => x.serie === serie);
            if (!l) return;
            const est = estadoCarton(serie);
            C.dibujarCarton(l.cv, { seed, serie, arte, titulo: t.titulo, subtitulo: t.subtitulo, letras, centroNumero: conCentro, centroImg, marcas: marcasDe(serie), sello: est && est.sello });
            l.chip.hidden = !est;
            if (est) {
                l.chip.textContent = est.texto;
                l.chip.className = `bn-chip${est.clase ? " " + est.clase : ""}`;
            }
        }

        function pintarTodo() {
            if (toggle) toggle.textContent = manual ? "Marcado: tocando la casilla" : "Marcado: automático";
            lienzos.forEach((l) => pintar(l.serie));
        }

        function lineaGanadores(nombreRonda, tp, ps) {
            return ps.map((p) => el("li", {},
                el("b", { text: `${nombreRonda} · ${tp && tp !== "figuras" ? TIPOS_RONDA[tp] : C.nombreFigura(p.f, p.c)}${p.p ? " (" + p.p + ")" : ""}: ` }),
                (p.g || []).length ? p.g.map((g) => `Serie ${C.serieTexto(g.s)}${g.n ? " · " + g.n : ""}${esConsuelo(g.d) ? " (consolación)" : ""}`).join(" — ") : "sin ganador registrado"));
        }

        function pintarBarra() {
            const bolas = vivo.b || [];
            poner(ultima, bolas.length ? bolaEl(bolas[bolas.length - 1], true) : el("span", { class: "bn-ball bn-ball--big bn-ball--empty" }, el("b", { text: "–" })));
            poner(previas, ...bolas.slice(-6, -1).reverse().map((n) => bolaEl(n)));
            const ps = premiosVivo(vivo);
            if (vivo.e === "En juego") {
                const extra = vivo.tp === "eliminacion" && vivo.q !== undefined ? ` · quedan ${vivo.q} ${vivo.q === 1 ? "cartón" : "cartones"}` : "";
                poner(info, el("div", {}, el("span", { class: "bn-dot bn-dot--live" }), el("b", { text: ` ${vivo.n || "Ronda"}` }),
                    el("span", { text: ` · ${vivo.tp && vivo.tp !== "figuras" ? TIPOS_RONDA[vivo.tp] : "en juego"}${extra}` }), el("small", { text: ` · ${bolas.length} bolas` })));
                poner(premiosBar, ...ps.map((p) => el("span", { class: `bn-prize${(p.g || []).length ? " is-won" : ""}` },
                    vivo.tp && vivo.tp !== "figuras" ? (p.p ? `Premio: ${p.p}` : TIPOS_RONDA[vivo.tp]) : premioTexto(p),
                    (p.g || []).length ? ` ✓ serie ${p.g.map((g) => C.serieTexto(g.s)).join(", ")}` : "")));
                premiosBar.hidden = !ps.length;
            } else {
                poner(info, el("div", {}, el("span", { class: "bn-dot" }), el("span", { text: vivo.ultima ? ` Terminó ${vivo.ultima.n}. Espera la siguiente ronda.` : " El juego todavía no empieza." })));
                poner(premiosBar, );
                premiosBar.hidden = true;
            }
            const hist = vivo.h || [];
            const actuales = vivo.e === "En juego" ? ps.filter((p) => (p.g || []).length) : [];
            ganadores.hidden = !hist.length && !actuales.length;
            poner(ganadores, 
                el("h3", { text: "Ganadores" }),
                el("ul", { class: "bn-list" },
                    actuales.length ? lineaGanadores(vivo.n, vivo.tp, actuales) : null,
                    hist.slice().reverse().map((r) => lineaGanadores(r.n, r.tp, premiosVivo(r)))
                )
            );
        }

        const vivoCtrl = crearVivo(cfg.public_id, cfg.vivo_id, (v) => {
            vivo = v;
            pintarBarra();
            pintarTodo();
        });
        vivoActual = vivoCtrl;
        const relojTimer = window.setInterval(() => {
            if (!document.body.contains(reloj)) return window.clearInterval(relojTimer);
            const s = vivoCtrl.segundos();
            reloj.textContent = s === null ? "" : `Actualizado hace ${s} s`;
        }, 1000);

        const saludo = nombre
            ? `Hola, ${nombre}. Tienes ${series.length} ${series.length === 1 ? "cartón" : "cartones"}${compras > 1 ? ` de ${compras} compras` : ""}.`
            : "";
        poner(app, 
            el("div", { class: "bn-player" },
                el("header", { class: "bn-player-head" },
                    el("div", {}, el("h1", { class: "bn-title", text: cfg.nombre || "Bingo" }), el("p", { class: "bn-sub", text: cuando(cfg) })),
                    saludo ? el("p", { class: "bn-hello", text: saludo }) : null
                ),
                barra,
                el("div", { class: "bn-player-tools" }, toggle,
                    el("small", { class: "bn-note", text: auto ? "Cada número cantado se marca solo con una X roja. Si prefieres marcar tú, cambia a «tocando la casilla»." : "Toca cada número que se cante para marcarlo con una X roja." })),
                cards,
                ganadores
            )
        );

        (async () => {
            await fuentesListas();
            [arte, centroImg] = await Promise.all([cargarImagen(cfg.arte_url), conCentro ? null : cargarImagen(cfg.centro_url)]);
            vivoCtrl.iniciar(vivo);
        })();
    }

    /* ================= Editores de mensajes con vista previa ================= */

    const escaparHtml = (t) => String(t || "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));

    /** Formato de WhatsApp (*negrita*, _cursiva_, ~tachado~, ```mono```) → HTML seguro para la vista previa. */
    function whatsappHtml(texto) {
        let h = escaparHtml(texto);
        h = h.replace(/```([\s\S]+?)```/g, "<code>$1</code>")
            .replace(/(^|[\s(])\*(\S(?:[^*\n]*\S)?)\*(?=$|[\s.,!?:;)])/g, "$1<b>$2</b>")
            .replace(/(^|[\s(])_(\S(?:[^_\n]*\S)?)_(?=$|[\s.,!?:;)])/g, "$1<i>$2</i>")
            .replace(/(^|[\s(])~(\S(?:[^~\n]*\S)?)~(?=$|[\s.,!?:;)])/g, "$1<s>$2</s>")
            .replace(/(https?:\/\/[^\s<]+)/g, '<a href="#" tabindex="-1">$1</a>')
            .replace(/\n/g, "<br>");
        return h;
    }

    function chipsVariables(variables, insertar) {
        return el("div", { class: "bn-var-chips" },
            el("span", { class: "bn-label", text: "Insertar:" }),
            variables.map(([k, t]) => {
                const b = el("button", { type: "button", class: "bn-var", title: `{{${k}}}`, text: t });
                b.addEventListener("mousedown", (e) => e.preventDefault());
                b.addEventListener("click", () => insertar(`{{${k}}}`));
                return b;
            })
        );
    }

    function horaAhora() {
        const d = new Date();
        return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
    }

    /** WhatsApp: texto con formato y emojis; vista previa como burbuja de chat. */
    function editorWhatsApp(texto, ejemplo, variables, contacto) {
        const area = el("textarea", { class: "bn-input bn-wa-input", rows: 7, "aria-label": "Mensaje de WhatsApp" });
        area.value = texto || "";
        const burbuja = el("div", { class: "bn-wa-bubble" });
        const insertar = (t) => {
            area.focus();
            area.setRangeText(t, area.selectionStart, area.selectionEnd, "end");
            pintar();
        };
        const envolver = (marca) => {
            const a = area.selectionStart;
            const z = area.selectionEnd;
            const sel = area.value.slice(a, z) || "texto";
            area.focus();
            area.setRangeText(`${marca}${sel}${marca}`, a, z, "select");
            pintar();
        };
        function pintar() {
            burbuja.innerHTML = `${whatsappHtml(render(area.value, ejemplo))}<span class="bn-wa-meta">${horaAhora()} <span class="bn-wa-checks">✓✓</span></span>`;
        }
        area.addEventListener("input", pintar);
        pintar();
        const boton = (txt, titulo, fn) => {
            const b = el("button", { type: "button", class: "bn-tool", title: titulo, "aria-label": titulo, html: txt });
            b.addEventListener("mousedown", (e) => e.preventDefault());
            b.addEventListener("click", fn);
            return b;
        };
        const EMOJIS = ["🎉", "🎱", "🍀", "✅", "📅", "📍", "🔗", "🙌", "💵", "🏆", "⭐", "👇", "😊", "🙏"];
        const barra = el("div", { class: "bn-toolbar-edit" },
            boton("<b>N</b>", "Negrita (*texto*)", () => envolver("*")),
            boton("<i>C</i>", "Cursiva (_texto_)", () => envolver("_")),
            boton("<s>T</s>", "Tachado (~texto~)", () => envolver("~")),
            el("span", { class: "bn-tool-sep" }),
            EMOJIS.map((e) => boton(e, `Insertar ${e}`, () => insertar(e)))
        );
        const vista = el("div", { class: "bn-wa-phone", "aria-label": "Vista previa en WhatsApp" },
            el("div", { class: "bn-wa-top" }, el("span", { class: "bn-wa-avatar", text: (contacto || "B").charAt(0).toUpperCase() }), el("div", {}, el("b", { text: "María" }), el("small", { text: "en línea" }))),
            el("div", { class: "bn-wa-chat" }, el("div", { class: "bn-wa-day", text: "HOY" }), burbuja),
            el("div", { class: "bn-wa-bottom" }, el("span", { text: "Mensaje" }))
        );
        return {
            el: el("div", { class: "bn-msg-editor" },
                el("div", { class: "bn-stack" }, barra, area, chipsVariables(variables, insertar), el("small", { class: "bn-note", text: "La vista previa usa datos de ejemplo." })),
                vista
            ),
            valor: () => area.value
        };
    }

    /** Correo: editor visual (o HTML) y vista previa como bandeja de entrada. Los emojis se avisan y se quitan. */
    function editorCorreo(asunto, cuerpo, ejemplo, variables, remitente) {
        const asuntoIn = input("bn-mail-asunto", asunto || "", { placeholder: "Asunto del correo" });
        const visual = el("div", { class: "bn-rich", contenteditable: "true", role: "textbox", "aria-multiline": "true", "aria-label": "Cuerpo del correo" });
        visual.innerHTML = cuerpo || "";
        const codigo = el("textarea", { class: "bn-input bn-mono bn-rich-code", rows: 10, hidden: true, "aria-label": "HTML del correo" });
        let modoHtml = false;
        const aviso = el("div", { class: "bn-combo-alert", hidden: true });
        const asuntoVista = el("h4", { class: "bn-mail-subject" });
        const marco = el("iframe", { class: "bn-mail-frame", title: "Vista previa del correo", sandbox: "" });

        const html = () => (modoHtml ? codigo.value : visual.innerHTML);
        function pintar() {
            const a = render(asuntoIn.value, ejemplo);
            asuntoVista.textContent = a || "(sin asunto)";
            marco.srcdoc = `<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0;padding:4px 2px;font:14px/1.55 Arial,Helvetica,sans-serif;color:#202124;background:#fff}a{color:#1a73e8}p{margin:0 0 12px}img{max-width:100%}</style></head><body>${render(html(), ejemplo)}</body></html>`;
            const conEmojis = tieneEmojis(asuntoIn.value) || tieneEmojis(html());
            aviso.hidden = !conEmojis;
            if (conEmojis) {
                const quitar = el("button", { type: "button", class: "bn-btn bn-btn--sm", text: "Quitar emojis ahora" });
                quitar.addEventListener("click", limpiar);
                poner(aviso, el("p", { text: "Este correo tiene emojis. Muchos lectores de correo los muestran como cuadros o signos raros; al guardar se quitan." }), quitar);
            }
        }
        function limpiar() {
            asuntoIn.value = sinEmojis(asuntoIn.value);
            if (modoHtml) codigo.value = sinEmojis(codigo.value);
            else visual.innerHTML = sinEmojis(visual.innerHTML);
            pintar();
        }
        let espera = 0;
        const pronto = () => { window.clearTimeout(espera); espera = window.setTimeout(pintar, 250); };
        [asuntoIn, codigo].forEach((x) => x.addEventListener("input", pronto));
        visual.addEventListener("input", pronto);
        /* Pegar como texto: evita traer estilos de otras páginas que se ven mal en el correo. */
        visual.addEventListener("paste", (e) => {
            e.preventDefault();
            const t = (e.clipboardData || window.clipboardData).getData("text/plain");
            document.execCommand("insertText", false, t);
        });

        const cmd = (c, v) => { visual.focus(); document.execCommand(c, false, v); pronto(); };
        const insertar = (t) => {
            if (modoHtml) {
                codigo.focus();
                codigo.setRangeText(t, codigo.selectionStart, codigo.selectionEnd, "end");
            } else {
                visual.focus();
                document.execCommand("insertText", false, t);
            }
            pronto();
        };
        const boton = (txt, titulo, fn) => {
            const b = el("button", { type: "button", class: "bn-tool", title: titulo, "aria-label": titulo, html: txt });
            b.addEventListener("mousedown", (e) => e.preventDefault());
            b.addEventListener("click", fn);
            return b;
        };
        const BOTON_LINK = '<p><a href="{{link}}" style="display:inline-block;padding:12px 22px;background:#0097a7;color:#ffffff;text-decoration:none;border-radius:8px;font-weight:bold">Ver mis cartones</a></p>';
        const alternar = el("button", { type: "button", class: "bn-btn bn-btn--sm bn-btn--ghost", text: "Editar HTML" });
        alternar.addEventListener("click", () => {
            modoHtml = !modoHtml;
            if (modoHtml) codigo.value = visual.innerHTML;
            else visual.innerHTML = codigo.value;
            codigo.hidden = !modoHtml;
            visual.hidden = modoHtml;
            herramientas.hidden = modoHtml;
            alternar.textContent = modoHtml ? "Editor visual" : "Editar HTML";
            pintar();
        });
        const herramientas = el("div", { class: "bn-toolbar-edit" },
            boton("<b>N</b>", "Negrita", () => cmd("bold")),
            boton("<i>C</i>", "Cursiva", () => cmd("italic")),
            boton("<u>S</u>", "Subrayado", () => cmd("underline")),
            boton("T", "Título", () => cmd("formatBlock", "<h3>")),
            boton("¶", "Párrafo normal", () => cmd("formatBlock", "<p>")),
            boton("•", "Lista", () => cmd("insertUnorderedList")),
            boton("Botón", "Botón con el link de los cartones", () => { visual.focus(); document.execCommand("insertHTML", false, BOTON_LINK); pronto(); })
        );
        pintar();
        const ahora = horaAhora();
        return {
            el: el("div", { class: "bn-msg-editor bn-msg-editor--mail" },
                el("div", { class: "bn-stack" },
                    campo("Asunto", asuntoIn),
                    el("div", { class: "bn-card-head" }, herramientas, alternar),
                    visual, codigo,
                    chipsVariables(variables, insertar),
                    aviso
                ),
                el("div", { class: "bn-mail", "aria-label": "Vista previa del correo" },
                    el("div", { class: "bn-mail-bar" }, el("span", { class: "bn-mail-dot" }), el("span", { class: "bn-mail-dot" }), el("span", { class: "bn-mail-dot" }), el("small", { text: "Bandeja de entrada" })),
                    asuntoVista,
                    el("div", { class: "bn-mail-from" },
                        el("span", { class: "bn-mail-avatar", text: (remitente || "B").charAt(0).toUpperCase() }),
                        el("div", {}, el("b", { text: remitente }), el("small", { text: "para mí" })),
                        el("small", { class: "bn-mail-time", text: ahora })
                    ),
                    marco
                )
            ),
            valor: () => ({ asunto: asuntoIn.value, cuerpo: html() }),
            limpiar
        };
    }

    /* ================= Hub (#bingo) ================= */

    async function initHub() {
        let pin = "";
        try {
            pin = localStorage.getItem(MASTER_KEY) || "";
        } catch (e) {
            /* sin almacenamiento */
        }
        const pinInput = input("bn-master", pin, { type: "password", placeholder: "MASTER_ADMIN_PIN del Apps Script", autocomplete: "off" });
        const lista = el("div", { class: "bn-hub-list" });
        let verArchivados = false;
        let bingos = [];

        async function cargar() {
            if (!pinInput.value.trim()) {
                poner(lista, el("p", { class: "bn-empty", text: "Escribe la llave maestra para ver los bingos." }));
                return;
            }
            poner(lista, el("p", { class: "bn-note", text: "Cargando bingos…" }));
            try {
                const d = await llamar({ action: "super_list", masterPin: pinInput.value.trim() });
                bingos = d.bingos || [];
                pintar();
            } catch (e) {
                poner(lista, el("p", { class: "bn-empty bn-empty--error", text: e.message }));
            }
        }

        function accion(datos, btn) {
            return conBoton(btn, async () => {
                await llamar({ masterPin: pinInput.value.trim(), ...datos });
                await cargar();
            });
        }

        function pintar() {
            const visibles = bingos.filter((b) => (verArchivados ? !b.activo || b.vencido : b.activo && !b.vencido));
            if (!visibles.length) {
                poner(lista, el("p", { class: "bn-empty", text: verArchivados ? "No hay bingos archivados." : "Todavía no hay bingos activos. Crea el primero con «+ Nuevo bingo»." }));
                return;
            }
            poner(lista, 
                el("div", { class: "bn-table-wrap" },
                    el("table", { class: "bn-table" },
                        el("thead", {}, el("tr", {}, ["#", "Bingo", "Creado", "Se archiva", "Links", "Acciones"].map((h) => el("th", { text: h })))),
                        el("tbody", {}, visibles.map((b) => {
                            const archivar = el("button", { class: "bn-btn bn-btn--sm", text: b.activo && !b.vencido ? "Archivar" : "Reactivar" });
                            archivar.addEventListener("click", () => accion({ action: "super_update", bingo_id: b.bingo_id, activo: !(b.activo && !b.vencido), fecha_archivo: b.vencido ? "" : undefined }, archivar));
                            const borrar = el("button", { class: "bn-btn bn-btn--sm bn-btn--danger", text: "Quitar" });
                            borrar.addEventListener("click", async () => {
                                if (await confirmar("Quitar bingo", `«${b.nombre}» deja de abrir y sale de esta lista. Su Spreadsheet y su carpeta quedan en tu Drive como respaldo.`, "Quitar", true)) {
                                    accion({ action: "super_delete", bingo_id: b.bingo_id }, borrar);
                                }
                            });
                            return el("tr", {},
                                el("td", { text: b.bingo_id }),
                                el("td", {}, el("b", { text: b.nombre }), b.compartido_con ? el("small", { class: "bn-note bn-block", text: `Compartido con ${b.compartido_con}` }) : null),
                                el("td", { text: fechaHoraTexto(b.created_at) }),
                                el("td", { text: b.fecha_archivo ? fechaLarga(b.fecha_archivo) : "Sin fecha" }),
                                el("td", {}, el("div", { class: "bn-links-cell" },
                                    el("a", { class: "bn-btn bn-btn--sm bn-btn--primary", href: links.organizador(b.hash_admin), target: "_blank", rel: "noopener", text: "Abrir" }),
                                    el("button", { class: "bn-btn bn-btn--sm", onclick: () => copiar(links.organizador(b.hash_admin), "Link del organizador copiado."), text: "Organizador" }),
                                    el("button", { class: "bn-btn bn-btn--sm", onclick: () => copiar(links.compra(b.public_id), "Link de compra copiado."), text: "Compra" }),
                                    el("button", { class: "bn-btn bn-btn--sm", onclick: () => copiar(links.cantador(b.hash_cantador), "Link del cantador copiado."), text: "Cantador" }),
                                    b.folder_url ? el("a", { class: "bn-btn bn-btn--sm", href: b.folder_url, target: "_blank", rel: "noopener", text: "Drive" }) : null
                                )),
                                el("td", {}, el("div", { class: "bn-links-cell" }, archivar, borrar))
                            );
                        }))
                    )
                )
            );
        }

        function nuevo() {
            const nombre = input("bn-new-nombre", "", { placeholder: "Bingo Pro Fondos 2026" });
            const fecha = input("bn-new-fecha", "", { type: "date" });
            const precio = input("bn-new-precio", "", { type: "number", min: 0, placeholder: "1000" });
            const correo = input("bn-new-correo", "", { type: "email", placeholder: "cliente@gmail.com" });
            const archivo = select("bn-new-archivo", [["", "Sin fecha"], ["7", "Una semana después del bingo"], ["30", "Un mes después del bingo"]], "7");
            modal("Nuevo bingo", el("div", { class: "bn-form-grid" },
                campo("Nombre del bingo", nombre),
                campo("Fecha del bingo", fecha, "El cliente la puede cambiar en su asistente."),
                campo("Precio de 1 cartón (₡)", precio, "Crea el combo de 1 cartón; el cliente agrega sus combos en Ajustes."),
                campo("Correo Google del cliente (opcional)", correo, "Le comparte la carpeta del bingo en Drive para ver comprobantes."),
                campo("Archivar automáticamente", archivo)
            ), (cerrar) => {
                const crear = el("button", { class: "bn-btn bn-btn--primary", text: "Crear bingo" });
                crear.addEventListener("click", () => conBoton(crear, async () => {
                    let fechaArchivo = "";
                    if (archivo.value && fecha.value) {
                        const d = new Date(`${fecha.value}T12:00:00`);
                        d.setDate(d.getDate() + Number(archivo.value));
                        fechaArchivo = d.toISOString().slice(0, 10);
                    }
                    const r = await llamar({
                        action: "super_create", masterPin: pinInput.value.trim(), nombre: nombre.value, fecha: fecha.value,
                        precio: precio.value, compartir_con: correo.value, fecha_archivo: fechaArchivo, sitio_url: baseUrl()
                    }, { timeoutMs: 90000 });
                    cerrar();
                    await cargar();
                    mostrarCreado(r.bingo);
                }, "Creando…"));
                return [el("button", { class: "bn-btn", onclick: cerrar, text: "Cancelar" }), crear];
            });
        }

        function mostrarCreado(b) {
            const link = links.organizador(b.hash_admin);
            const texto = `Hola, este es el link para administrar tu bingo «${b.nombre}»: ${link}\nGuárdalo bien: con este link se administran las ventas, los cartones y el juego.`;
            modal("Bingo creado", el("div", { class: "bn-stack" },
                el("p", { text: "Se crearon su Spreadsheet y su carpeta en Drive. Envíale al cliente su link de organizador:" }),
                el("code", { class: "bn-code", text: link })
            ), (cerrar) => [
                el("button", { class: "bn-btn", onclick: () => copiar(link, "Link copiado."), text: "Copiar link" }),
                el("a", { class: "bn-btn bn-btn--primary", href: `https://wa.me/?text=${encodeURIComponent(texto)}`, target: "_blank", rel: "noopener", text: "Enviar por WhatsApp" }),
                el("button", { class: "bn-btn", onclick: cerrar, text: "Listo" })
            ]);
        }

        const guardarPin = el("button", { class: "bn-btn bn-btn--primary", text: "Guardar" });
        guardarPin.addEventListener("click", () => {
            try {
                localStorage.setItem(MASTER_KEY, pinInput.value.trim());
            } catch (e) {
                /* sin almacenamiento */
            }
            cargar();
        });
        const tabAct = el("button", { class: "bn-tab is-active", text: "Activos" });
        const tabArch = el("button", { class: "bn-tab", text: "Archivados" });
        [tabAct, tabArch].forEach((t, i) => t.addEventListener("click", () => {
            verArchivados = i === 1;
            tabAct.classList.toggle("is-active", !verArchivados);
            tabArch.classList.toggle("is-active", verArchivados);
            pintar();
        }));

        poner(app, 
            el("div", { class: "bn-hub" },
                el("header", { class: "bn-hub-head" },
                    el("div", {}, el("p", { class: "bn-eyebrow", text: "WebApps" }), el("h1", { class: "bn-title", text: "Bingo Digital" }), el("p", { class: "bn-sub", text: "Crea un bingo por cliente y envíale su link de organizador." })),
                    el("button", { class: "bn-btn bn-btn--primary", onclick: nuevo, text: "+ Nuevo bingo" })
                ),
                el("div", { class: "bn-card bn-master" }, campo("Llave maestra", pinInput, "Se guarda en este navegador."), guardarPin),
                el("div", { class: "bn-tabs" }, tabAct, tabArch),
                lista
            )
        );
        await cargar();
    }

    /* ================= Pantalla para proyectar (#bp/<hash>) ================= */

    /** Duración de cada paso de la rifa: el cantador y la pantalla usan la misma para terminar a la vez. */
    const msRifa = (i, pasos) => 70 + Math.pow(i / pasos, 3) * 380;

    /** Un canal por link: la pantalla abierta en otra ventana del mismo equipo recibe las bolas y la rifa. */
    const canalesPantalla = {};
    function canalPantalla(hash) {
        if (canalesPantalla[hash]) return canalesPantalla[hash];
        let canal = null;
        try {
            canal = new BroadcastChannel(`bn_pantalla_${hash}`);
        } catch (e) {
            canal = null;
        }
        const api = {
            estado: null,
            emitir(m) {
                if (m.t === "estado") api.estado = m;
                try {
                    if (canal) canal.postMessage(m);
                } catch (e) {
                    /* la pantalla es opcional */
                }
            }
        };
        if (canal) canal.onmessage = (ev) => { if (ev.data && ev.data.t === "hola" && api.estado) canal.postMessage(api.estado); };
        canalesPantalla[hash] = api;
        return api;
    }

    function estadoDeRonda(nombreBingo, r) {
        return r
            ? { t: "estado", bingo: nombreBingo, ronda: r.nombre, tipo: TIPOS_RONDA[r.tipo] || "", bolas: r.bolas.slice() }
            : { t: "estado", bingo: nombreBingo, ronda: "", tipo: "", bolas: [] };
    }

    async function initPantalla(hash) {
        cargando("Abriendo la pantalla…");
        let g;
        try {
            g = await llamar({ action: "game_get", hash });
        } catch (e) {
            return pantallaError(e.message);
        }
        document.title = `${g.config.nombre || "Bingo"} · pantalla`;
        const activa = (g.rondas || []).find((r) => r.estado === "En juego") || null;
        let estado = estadoDeRonda(g.config.nombre, activa);
        let rifa = null;
        let girando = 0;

        const raiz = el("div", { class: "bn-screen" });
        const capa = el("div", { class: "bn-screen-rifa", hidden: true });
        const completa = el("button", { class: "bn-btn bn-btn--sm bn-screen-fs", text: "Pantalla completa" });
        completa.addEventListener("click", () => {
            const d = document.documentElement;
            if (document.fullscreenElement) document.exitFullscreen();
            else if (d.requestFullscreen) d.requestFullscreen().catch(() => {});
        });
        document.addEventListener("fullscreenchange", () => { completa.hidden = !!document.fullscreenElement; });

        function pintar() {
            const bolas = estado.bolas || [];
            const cantadas = new Set(bolas);
            const ultima = bolas[bolas.length - 1];
            poner(raiz,
                el("header", { class: "bn-screen-head" },
                    el("b", { text: estado.bingo || "Bingo" }),
                    el("span", { text: estado.ronda ? `${estado.ronda}${estado.tipo ? " · " + estado.tipo : ""}` : "Esperando la próxima ronda" }),
                    el("span", { class: "bn-screen-count", text: `${bolas.length} de 75` })),
                el("div", { class: "bn-screen-main" },
                    el("div", { class: "bn-screen-last" },
                        ultima ? bolaEl(ultima, true) : el("span", { class: "bn-ball bn-ball--big bn-ball--empty" }, el("b", { text: "–" })),
                        el("div", { class: "bn-screen-prev" }, bolas.slice(-7, -1).reverse().map((n) => bolaEl(n)))),
                    el("div", { class: "bn-board bn-screen-board" }, C.LETRAS.map((letra, c) =>
                        el("div", { class: "bn-board-row" }, el("b", { class: `bn-board-letter bn-ball--${letra.toLowerCase()}`, text: letra }),
                            Array.from({ length: 15 }, (_, i) => {
                                const n = c * 15 + i + 1;
                                return el("span", { class: `${cantadas.has(n) ? "on" : ""}${n === ultima ? " last" : ""}`, text: n });
                            }))))),
                capa, completa);
        }

        function mostrarRifa(m) {
            const vuelta = ++girando;
            rifa = m;
            const chips = m.lista.map((s) => el("span", { class: "bn-rifa-chip", text: s }));
            const final = el("div", { class: "bn-screen-win", hidden: true });
            poner(capa, el("p", { class: "bn-eyebrow", text: "Rifa" }), el("h2", { text: m.titulo }), el("div", { class: "bn-rifa-chips" }, chips), final);
            capa.hidden = false;
            let i = 0;
            const paso = () => {
                if (vuelta !== girando) return;
                chips.forEach((c, k) => c.classList.toggle("is-on", k === i % chips.length));
                if (i >= m.pasos) {
                    chips[m.elegido].classList.add("is-win");
                    poner(final, el("small", { text: "Gana la serie" }), el("b", { text: m.lista[m.elegido] }));
                    final.hidden = false;
                    return;
                }
                i++;
                setTimeout(paso, msRifa(i, m.pasos));
            };
            paso();
        }

        function cerrarRifa() {
            girando++;
            rifa = null;
            capa.hidden = true;
        }

        let canal = null;
        try {
            canal = new BroadcastChannel(`bn_pantalla_${hash}`);
        } catch (e) {
            canal = null;
        }
        if (canal) {
            canal.onmessage = (ev) => {
                const m = ev.data || {};
                if (m.t === "estado") {
                    const nueva = (m.bolas || []).length !== (estado.bolas || []).length || m.ronda !== estado.ronda;
                    estado = m;
                    if (rifa && nueva) cerrarRifa();
                    pintar();
                    if (rifa) capa.hidden = false;
                } else if (m.t === "rifa") {
                    mostrarRifa(m);
                } else if (m.t === "rifa_cerrar") {
                    cerrarRifa();
                }
            };
            canal.postMessage({ t: "hola" });
        }
        document.body.classList.add("bn-screen-body");
        poner(app, raiz);
        pintar();
        if (!canal) showMessage("Este navegador no puede conectar la pantalla con el link del cantador.", "error", 8000);
    }

    /* ================= Panel del organizador / cantador ================= */

    async function initPanel(hash, rol) {
        cargando(rol === "cantador" ? "Abriendo el juego…" : "Abriendo tu bingo…");
        const S = { hash, rol, data: null, entradas: null, tab: "resumen", ventasTab: "Pendiente" };
        try {
            if (rol === "organizador") {
                S.data = await llamar({ action: "resolve_admin", hash });
            } else {
                const g = await llamar({ action: "game_get", hash });
                S.data = { bingo: { nombre: g.config.nombre, public_id: g.config.public_id }, seed: g.seed, config: g.config, juego: g };
            }
        } catch (e) {
            return pantallaError(e.message);
        }
        try {
            const t = localStorage.getItem(`bn_tab_${hash}`);
            if (t && rol === "organizador") S.tab = t;
        } catch (e) {
            /* sin almacenamiento */
        }

        const TABS = rol === "organizador"
            ? [["resumen", "Resumen", "▦"], ["ventas", "Ventas", "₡"], ["cartones", "Cartones", "▤"], ["sectores", "Sectores", "◎"], ["juego", "Juego", "●"], ["ajustes", "Ajustes", "⚙"]]
            : [["juego", "Juego", "●"]];
        if (rol !== "organizador") S.tab = "juego";

        const cuerpo = el("main", { class: "bn-panel-body" });
        const nav = el("nav", { class: "bn-panel-nav", "aria-label": "Secciones" });
        const titulo = el("h1", { class: "bn-title bn-title--panel" });
        const sub = el("p", { class: "bn-sub" });

        function pintarCabecera() {
            const cfg = S.data.config;
            titulo.textContent = cfg.nombre || S.data.bingo.nombre;
            sub.textContent = cuando(cfg) || (rol === "cantador" ? "Link del cantador" : "Organizador");
        }

        function ir(tab) {
            S.tab = tab;
            try {
                if (rol === "organizador") localStorage.setItem(`bn_tab_${hash}`, tab);
            } catch (e) {
                /* sin almacenamiento */
            }
            nav.querySelectorAll("button").forEach((b) => b.classList.toggle("is-active", b.dataset.tab === tab));
            if (vivoActual && tab !== "juego") {
                vivoActual.detener();
                vivoActual = null;
            }
            const vistas = { resumen: vistaResumen, ventas: vistaVentas, cartones: vistaCartones, sectores: vistaSectores, juego: vistaJuego, ajustes: vistaAjustes };
            poner(cuerpo, );
            try {
                const p = vistas[tab](cuerpo);
                if (p && typeof p.catch === "function") p.catch((e) => fallaVista(e));
            } catch (e) {
                fallaVista(e);
            }
            window.scrollTo(0, 0);
        }

        /** Un error en una pestaña no tumba el panel: se muestra ahí y las demás siguen funcionando. */
        function fallaVista(e) {
            console.error(e);
            poner(cuerpo, el("section", { class: "bn-card" },
                el("h2", { text: "Esta sección no se pudo mostrar" }),
                el("p", { class: "bn-note", text: (e && e.message) || String(e) }),
                el("p", { class: "bn-note", text: "Tus datos no se tocaron. Usa las otras pestañas y reporta este mensaje." })
            ));
        }

        TABS.forEach(([k, label, icon]) => nav.appendChild(el("button", { dataset: { tab: k }, onclick: () => ir(k) }, el("span", { class: "bn-nav-icon", "aria-hidden": "true", text: icon }), el("span", { text: label }))));

        async function recargar() {
            S.data = await llamar({ action: "resolve_admin", hash });
            S.cargado = new Date();
            pintarCabecera();
        }
        S.cargado = new Date();

        function faltaConfigurar() {
            const c = S.data.config;
            return rol === "organizador" && (c.setup_done !== "true" || !c.fecha || !(Number(c.precio_unitario) > 0 || (S.data.precios || []).length) || !c.sinpe_numero);
        }

        /* ---------- Resumen ---------- */
        function vistaResumen(root) {
            const r = S.data.resumen;
            const b = S.data.bingo;
            const cfg = S.data.config;
            const compraLink = links.compra(b.public_id);
            const fechaTxt = fechaLarga(cfg.fecha, cfg.hora);
            const textoCompra = `¡Ya puedes comprar tus cartones para ${cfg.nombre}! ${fechaTxt ? "Fecha: " + fechaTxt + ". " : ""}Compra aquí: ${compraLink}`;
            const porEnc = r.por_encargado || {};
            const montoSector = r.monto_sector || {};

            /* Tablero por sector y encargado: cartones del bloque, monto y el desglose de cada encargado. */
            const sectores = [{ sector_id: 0, nombre: "General (compras en línea y panel)", desde: 0, hasta: 0, encargados: [] }, ...(S.data.sectores || [])];
            const tablero = el("div", { class: "bn-dash" }, sectores.map((s) => {
                const n = r.por_sector[s.sector_id] || 0;
                const total = s.desde && s.hasta ? s.hasta - s.desde + 1 : 0;
                const filasEnc = (s.encargados || []).map((x) => ({ nombre: x.nombre, d: porEnc[`${s.sector_id}:${x.id}`] }));
                const sinEnc = porEnc[`${s.sector_id}:0`];
                if (sinEnc && filasEnc.length) filasEnc.push({ nombre: "Link general del sector", d: sinEnc });
                return el("article", { class: "bn-dash-row" },
                    el("header", {},
                        el("b", { text: s.nombre }),
                        el("span", { class: "bn-dash-num", text: `${total ? `${n} / ${total}` : n} ${n === 1 && !total ? "cartón" : "cartones"} · ${colones(montoSector[s.sector_id] || 0)}` })
                    ),
                    total ? el("i", { class: "bn-meter", style: `--p:${Math.min(100, (n / total) * 100)}%` }) : null,
                    filasEnc.length ? el("ul", { class: "bn-dash-sub" }, filasEnc.map((f) => el("li", {},
                        el("span", { text: f.nombre }),
                        el("span", { class: "bn-dash-num", text: f.d ? `${f.d.cartones} ${f.d.cartones === 1 ? "cartón" : "cartones"} · ${colones(f.d.monto)} · ${f.d.compras} ${f.d.compras === 1 ? "venta" : "ventas"}` : "sin ventas" })
                    ))) : null
                );
            }));

            const refrescar = el("button", { class: "bn-btn bn-btn--sm", text: "↻ Actualizar" });
            refrescar.addEventListener("click", () => conBoton(refrescar, async () => {
                await recargar();
                ir("resumen");
                showMessage("Resumen actualizado.", "success");
            }, "Actualizando…"));
            agregar(root,
                el("div", { class: "bn-toolbar bn-toolbar--end bn-refresh" },
                    el("small", { class: "bn-note", text: `Datos de las ${horaCorta(S.cargado)}` }), refrescar),
                faltaConfigurar() ? el("div", { class: "bn-banner" }, el("p", { text: "Completa los datos del bingo (fecha, combos de precio y SINPE) para empezar a vender." }), el("button", { class: "bn-btn bn-btn--primary", onclick: () => ir("ajustes"), text: "Completar datos" })) : null,
                el("div", { class: "bn-tiles" },
                    tile(r.cartones_vendidos.toLocaleString("es-CR"), "cartones vendidos", `de ${r.cartones_habilitados.toLocaleString("es-CR")} habilitados · máximo 10 000`),
                    tile(colones(r.recaudado), "recaudado", "compras aprobadas y completadas"),
                    tile(String(r.compradores || 0), "compradores", "cada correo cuenta como un jugador"),
                    tile(String(r.compras.Pendiente || 0), "compras por aprobar", colones(r.por_aprobar)),
                    tile(String(r.compras.Aprobada || 0), "por enviar", "aprobadas sin completar")
                ),
                el("section", { class: "bn-card" },
                    el("h2", { text: "Links para compartir" }),
                    el("div", { class: "bn-linkrow" },
                        el("div", {}, el("b", { text: "Compra de cartones" }), el("small", { class: "bn-note bn-block", text: "Para tus compradores: eligen cantidad y suben su comprobante." })),
                        el("div", { class: "bn-btnrow" },
                            el("button", { class: "bn-btn bn-btn--sm", onclick: () => copiar(compraLink, "Link de compra copiado."), text: "Copiar" }),
                            el("a", { class: "bn-btn bn-btn--sm bn-btn--primary", href: `https://wa.me/?text=${encodeURIComponent(textoCompra)}`, target: "_blank", rel: "noopener", text: "WhatsApp" }),
                            el("a", { class: "bn-btn bn-btn--sm", href: compraLink, target: "_blank", rel: "noopener", text: "Abrir" })
                        )
                    ),
                    el("div", { class: "bn-linkrow" },
                        el("div", {}, el("b", { text: "Cantador" }), el("small", { class: "bn-note bn-block", text: "Solo abre el juego: cantar, verificar y registrar ganadores." })),
                        el("div", { class: "bn-btnrow" }, el("button", { class: "bn-btn bn-btn--sm", onclick: () => copiar(links.cantador(b.hash_cantador), "Link del cantador copiado."), text: "Copiar" }))
                    ),
                    el("div", { class: "bn-linkrow" },
                        el("div", {}, el("b", { text: "Vendedores por sector" }), el("small", { class: "bn-note bn-block", text: "Cada encargado tiene su propio link en la pestaña Sectores." })),
                        el("div", { class: "bn-btnrow" }, el("button", { class: "bn-btn bn-btn--sm", onclick: () => ir("sectores"), text: "Ver sectores" }))
                    ),
                    b.folder_url && b.compartido_con ? el("div", { class: "bn-linkrow" },
                        el("div", {}, el("b", { text: "Carpeta en Google Drive" }), el("small", { class: "bn-note bn-block", text: `Compartida con ${b.compartido_con}.` })),
                        el("div", { class: "bn-btnrow" }, el("a", { class: "bn-btn bn-btn--sm", href: b.folder_url, target: "_blank", rel: "noopener", text: "Abrir" }))
                    ) : null
                ),
                el("section", { class: "bn-card" },
                    el("h2", { text: "Ventas por sector y encargado" }),
                    el("p", { class: "bn-note", text: "Cuenta las ventas aprobadas y completadas. La barra muestra cuánto del bloque de cada sector ya se vendió." }),
                    tablero
                )
            );
        }

        /* ---------- Ventas ---------- */
        async function vistaVentas(root) {
            const lista = el("div", { class: "bn-entries" });
            const buscador = input("bn-ventas-buscar", "", { type: "search", placeholder: "Buscar por nombre, teléfono o serie" });
            const subtabs = el("div", { class: "bn-tabs" });
            const ESTADOS = [["Pendiente", "Pendientes"], ["Aprobada", "Por enviar"], ["Completada", "Historial"], ["Rechazada", "Rechazadas"]];

            function pintarTabs() {
                poner(subtabs, ...ESTADOS.map(([k, label]) => {
                    const n = (S.entradas || []).filter((e) => e.estado === k).length;
                    return el("button", { class: `bn-tab${S.ventasTab === k ? " is-active" : ""}`, onclick: () => { S.ventasTab = k; pintarTabs(); pintar(); } }, label, el("span", { class: "bn-count", text: n }));
                }));
            }

            async function cargar() {
                poner(lista, el("p", { class: "bn-note", text: "Cargando compras…" }));
                try {
                    S.entradas = (await llamar({ action: "list_entradas", hash })).entradas || [];
                    pintarTabs();
                    pintar();
                } catch (e) {
                    poner(lista, el("p", { class: "bn-empty bn-empty--error", text: e.message }));
                }
            }

            function reemplazar(nueva) {
                const i = S.entradas.findIndex((x) => x.entrada_id === nueva.entrada_id);
                if (i >= 0) S.entradas[i] = { ...S.entradas[i], ...nueva };
                pintarTabs();
                pintar();
            }

            async function act(btn, payload, ocupado) {
                const r = await conBoton(btn, () => llamar({ hash, ...payload }), ocupado);
                if (r && r.entrada) reemplazar(r.entrada);
                return r;
            }

            function pintar() {
                const q = buscador.value.trim().toLowerCase();
                const items = (S.entradas || []).filter((e) => e.estado === S.ventasTab).filter((e) => {
                    if (!q) return true;
                    return [e.nombre, e.telefono, e.correo, e.vendedor, e.cartones].join(" ").toLowerCase().includes(q) || e.cartones.split(",").includes(q.replace(/^0+/, ""));
                });
                if (!items.length) {
                    poner(lista, el("p", { class: "bn-empty", text: q ? "Ninguna compra coincide con la búsqueda." : "No hay compras en esta lista." }));
                    return;
                }
                poner(lista, ...items.map(tarjeta));
            }

            function tarjeta(e) {
                const sector = (S.data.sectores || []).find((s) => s.sector_id === e.sector_id);
                const cfg = S.data.config;
                const linkJ = e.token ? links.jugador(e.token) : "";
                const vars = varsMensaje(cfg, e, linkJ);
                const acciones = el("div", { class: "bn-btnrow" });
                const clave = String(e.correo || "").trim().toLowerCase();
                const mismas = clave ? (S.entradas || []).filter((x) => x.entrada_id !== e.entrada_id && String(x.correo || "").trim().toLowerCase() === clave) : [];
                if (e.tiene_comprobante) {
                    const ver = el("button", { class: "bn-btn bn-btn--sm", text: "Ver comprobante" });
                    ver.addEventListener("click", () => conBoton(ver, async () => verComprobante(await llamar({ action: "get_comprobante", hash, entrada_id: e.entrada_id }, { timeoutMs: 60000 }), e), "Abriendo…"));
                    acciones.append(ver);
                }
                if (e.estado === "Pendiente") {
                    const aprobar = el("button", { class: "bn-btn bn-btn--sm bn-btn--primary", text: "Aprobar" });
                    aprobar.addEventListener("click", () => act(aprobar, { action: "approve_entrada", entrada_id: e.entrada_id }, "Asignando…").then((r) => r && showMessage(`Aprobada: cartones ${r.entrada.cartones}.`, "success")));
                    const elegir = el("button", { class: "bn-btn bn-btn--sm", text: "Aprobar con series" });
                    elegir.addEventListener("click", () => {
                        const series = input("bn-aprobar-series", "", { placeholder: `${e.cantidad} series, ej. 15, 16, 40-42` });
                        modal("Elegir cartones", campo(`Series para ${e.nombre} (${e.cantidad})`, series, "Separa con comas; usa guion para rangos."), (cerrar) => {
                            const ok = el("button", { class: "bn-btn bn-btn--primary", text: "Aprobar" });
                            ok.addEventListener("click", async () => {
                                const r = await act(ok, { action: "approve_entrada", entrada_id: e.entrada_id, series: series.value }, "Asignando…");
                                if (r) cerrar();
                            });
                            return [el("button", { class: "bn-btn", onclick: cerrar, text: "Cancelar" }), ok];
                        });
                    });
                    const rechazar = el("button", { class: "bn-btn bn-btn--sm bn-btn--danger", text: "Rechazar" });
                    rechazar.addEventListener("click", () => {
                        const nota = input("bn-rechazo-nota", "", { placeholder: "Ej. el monto no coincide" });
                        modal("Rechazar compra", campo("Motivo (queda como nota)", nota), (cerrar) => {
                            const ok = el("button", { class: "bn-btn bn-btn--danger", text: "Rechazar" });
                            ok.addEventListener("click", async () => {
                                if (await act(ok, { action: "reject_entrada", entrada_id: e.entrada_id, nota: nota.value })) cerrar();
                            });
                            return [el("button", { class: "bn-btn", onclick: cerrar, text: "Cancelar" }), ok];
                        });
                    });
                    acciones.append(aprobar, elegir, rechazar);
                }
                if (e.estado === "Aprobada" || e.estado === "Completada") {
                    acciones.append(
                        el("button", { class: "bn-btn bn-btn--sm", onclick: () => copiar(linkJ, "Link de los cartones copiado."), text: "Copiar link" }),
                        el("a", { class: "bn-btn bn-btn--sm", href: linkJ, target: "_blank", rel: "noopener", text: "Ver cartones" })
                    );
                }
                if (e.estado === "Aprobada") {
                    const wa = el("a", { class: `bn-btn bn-btn--sm${e.wa_enviado ? " is-done" : " bn-btn--primary"}`, href: waUrl(e.telefono, render(cfg.plantilla_whatsapp, vars)), target: "_blank", rel: "noopener", text: e.wa_enviado ? "WhatsApp ✓" : "WhatsApp" });
                    wa.addEventListener("click", () => { if (!e.wa_enviado) act(null, { action: "mark_sent", entrada_id: e.entrada_id, canal: "wa" }); });
                    acciones.append(wa);
                    if (e.correo) {
                        const mail = el("button", { class: `bn-btn bn-btn--sm${e.email_enviado ? " is-done" : ""}`, text: e.email_enviado ? "Correo ✓" : "Enviar correo" });
                        mail.addEventListener("click", () => act(mail, { action: "send_email", entrada_id: e.entrada_id }, "Enviando…").then((r) => r && showMessage("Correo enviado.", "success")));
                        acciones.append(mail);
                    }
                    const listo = el("button", { class: "bn-btn bn-btn--sm", text: "Pasar a historial" });
                    listo.addEventListener("click", () => act(listo, { action: "complete_entrada", entrada_id: e.entrada_id }));
                    const devolver = el("button", { class: "bn-btn bn-btn--sm bn-btn--danger", text: "Devolver a pendientes" });
                    devolver.addEventListener("click", async () => {
                        if (await confirmar("Devolver a pendientes", `Se liberan los cartones ${e.cartones} y el link de ${e.nombre} deja de mostrarlos.`, "Devolver", true)) {
                            act(devolver, { action: "return_entrada", entrada_id: e.entrada_id });
                        }
                    });
                    acciones.append(listo, devolver);
                }
                if (e.estado === "Completada") {
                    const reabrir = el("button", { class: "bn-btn bn-btn--sm", text: "Volver a por enviar" });
                    reabrir.addEventListener("click", () => act(reabrir, { action: "reopen_entrada", entrada_id: e.entrada_id }));
                    acciones.append(reabrir);
                }
                if (e.estado === "Rechazada") {
                    const volver = el("button", { class: "bn-btn bn-btn--sm", text: "Volver a pendientes" });
                    volver.addEventListener("click", () => act(volver, { action: "return_entrada", entrada_id: e.entrada_id }));
                    acciones.append(volver);
                }
                return el("article", { class: "bn-entry" },
                    el("header", {},
                        el("div", {}, el("b", { text: e.nombre }), el("small", { class: "bn-note bn-block", text: `#${e.entrada_id} · ${fechaHoraTexto(e.fecha)} · ${e.modalidad}` })),
                        el("div", { class: "bn-entry-amount" }, el("b", { text: colones(e.monto) }), el("small", { text: `${e.cantidad} ${e.cantidad === 1 ? "cartón" : "cartones"}` }))
                    ),
                    el("dl", { class: "bn-dl" },
                        e.telefono ? [el("dt", { text: "WhatsApp" }), el("dd", { text: e.telefono })] : null,
                        e.correo ? [el("dt", { text: "Correo" }), el("dd", { text: e.correo })] : null,
                        e.vendedor || sector ? [el("dt", { text: "Vendedor" }), el("dd", { text: [e.vendedor, sector ? sector.nombre : ""].filter(Boolean).join(" · ") })] : null,
                        e.metodo ? [el("dt", { text: "Pago" }), el("dd", { text: e.metodo })] : null,
                        e.cartones ? [el("dt", { text: "Cartones" }), el("dd", { class: "bn-mono", text: e.cartones.split(",").map((x) => C.serieTexto(x)).join(", ") })] : null,
                        mismas.length ? [el("dt", { text: "Mismo jugador" }), el("dd", { text: `También compró en ${mismas.map((x) => "#" + x.entrada_id).join(", ")}: todos sus cartones están en un solo link.` })] : null,
                        e.nota ? [el("dt", { text: "Nota" }), el("dd", { text: e.nota })] : null
                    ),
                    acciones
                );
            }

            const presencial = el("button", { class: "bn-btn bn-btn--primary", text: "+ Venta presencial" });
            presencial.addEventListener("click", () => modalVenta("Venta presencial", {
                sectores: S.data.sectores || [],
                cotizar: (n) => cotizar(S.data.precios, S.data.config.precio_unitario, n),
                enviar: (datos) => llamar({ action: "vender_presencial", hash, ...datos }, { timeoutMs: 90000 }),
                alTerminar: (entrada) => { S.entradas.unshift(entrada); S.ventasTab = "Aprobada"; pintarTabs(); pintar(); }
            }));
            const recargarBtn = el("button", { class: "bn-btn", onclick: cargar, text: "Recargar" });
            buscador.addEventListener("input", pintar);
            agregar(root, el("div", { class: "bn-toolbar" }, buscador, recargarBtn, presencial), subtabs, lista);
            await cargar();
        }

        /* ---------- Cartones ---------- */
        function vistaCartones(root) {
            const cfg = S.data.config;
            const seed = S.data.seed;
            const pub = S.data.bingo.public_id;
            const r = S.data.resumen;
            const LADO = C.GEOMETRIA.casillas.celda;
            const preview = el("canvas", { class: "bn-canvas bn-canvas--preview", width: C.GEOMETRIA.W, height: C.GEOMETRIA.H });
            const imagenes = cargadorArte(pub);
            const centroUrl = () => (cfg.centro !== "numero" && cfg.centro_file_id ? `https://lh3.googleusercontent.com/d/${cfg.centro_file_id}` : "");
            let arteActual;
            let centroActual;

            /** Vuelve a dibujar la serie 00001; un argumento undefined usa lo que está guardado. */
            async function pintarPreview(arteImg, centroImg) {
                if (arteImg !== undefined) arteActual = arteImg;
                if (centroImg !== undefined) centroActual = centroImg;
                await fuentesListas();
                await cargarScript(LIB_QR).catch(() => {});
                if (arteActual === undefined) arteActual = await cargarImagen(S.data.arte_url);
                if (centroActual === undefined) centroActual = await cargarImagen(centroUrl());
                const conCentro = centroNumero(cfg);
                const t = tituloCarton(cfg);
                const grid = C.carton(seed, 1, conCentro);
                const ejemplo = [grid[0][0], grid[1][1], grid[3][3], grid[4][4], grid[0][4]];
                C.dibujarCarton(preview, {
                    seed, serie: 1, arte: arteActual, titulo: t.titulo, subtitulo: t.subtitulo, letras: cfg.letras_sistema !== "false",
                    centroNumero: conCentro, centroImg: conCentro ? null : centroActual, marcas: C.marcadas(grid, ejemplo), qrTexto: links.carton(pub, seed, 1)
                });
            }

            async function descargarTemplate(transparente, pdf) {
                const cv = document.createElement("canvas");
                C.dibujarTemplate(cv, { transparente });
                if (pdf) {
                    await cargarScript(LIB_JSPDF);
                    const doc = new window.jspdf.jsPDF({ orientation: "portrait", unit: "mm", format: [100, 140] });
                    doc.addImage(cv.toDataURL("image/png"), "PNG", 0, 0, 100, 140);
                    descargarBlob(doc.output("blob"), "template-carton-bingo-10x14cm.pdf");
                    return;
                }
                descargarBlob(await canvasABlob(cv), transparente ? "template-carton-bingo-transparente.png" : "template-carton-bingo.png");
            }

            /* Arte completo del cartón */
            const archivo = el("input", { type: "file", accept: "image/png,image/jpeg,image/webp", id: "bn-arte-file", class: "bn-file" });
            const estadoArte = el("p", { class: "bn-note" });
            archivo.addEventListener("change", async () => {
                const f = archivo.files && archivo.files[0];
                if (!f) return;
                const url = await new Promise((res) => { const rd = new FileReader(); rd.onload = () => res(String(rd.result)); rd.readAsDataURL(f); });
                const img = await cargarImagen(url);
                if (!img) return showMessage("No se pudo leer la imagen.", "error");
                const ratio = img.naturalWidth / img.naturalHeight;
                const esperado = C.GEOMETRIA.W / C.GEOMETRIA.H;
                if (Math.abs(ratio - esperado) > 0.01) {
                    estadoArte.textContent = `La imagen mide ${img.naturalWidth} × ${img.naturalHeight} px. Debe tener la proporción del template (1200 × 1680 px, 10 × 14 cm).`;
                    archivo.value = "";
                    return;
                }
                const cv = document.createElement("canvas");
                cv.width = C.GEOMETRIA.W;
                cv.height = C.GEOMETRIA.H;
                cv.getContext("2d").drawImage(img, 0, 0, cv.width, cv.height);
                const normal = await cargarImagen(cv.toDataURL("image/jpeg", 0.9));
                await pintarPreview(normal);
                estadoArte.textContent = "Así se verá con números reales. Si te gusta, súbelo.";
                const subir = el("button", { class: "bn-btn bn-btn--primary", text: "Usar este arte" });
                subir.addEventListener("click", () => conBoton(subir, async () => {
                    const d = await llamar({ action: "upload_arte", hash, archivo: cv.toDataURL("image/jpeg", 0.9) }, { timeoutMs: 90000 });
                    S.data.arte_url = d.arte_url;
                    S.data.config.arte_file_id = d.arte_file_id;
                    imagenes.limpiar();
                    estadoArte.textContent = "Arte guardado en la carpeta del bingo.";
                    subir.remove();
                    showMessage("Arte del cartón guardado.", "success");
                }, "Subiendo…"));
                estadoArte.after(subir);
            });

            const letrasChk = el("input", { type: "checkbox", id: "bn-letras" });
            letrasChk.checked = cfg.letras_sistema !== "false";
            letrasChk.addEventListener("change", async () => {
                const v = letrasChk.checked ? "true" : "false";
                const res = await conBoton(null, () => llamar({ action: "update_config", hash, config: { letras_sistema: v } }));
                if (res) {
                    S.data.config = res.config;
                    Object.assign(cfg, res.config);
                    pintarPreview();
                }
            });

            const quitarArte = el("button", { class: "bn-btn bn-btn--sm bn-btn--danger", text: "Quitar arte" });
            quitarArte.addEventListener("click", () => conBoton(quitarArte, async () => {
                await llamar({ action: "delete_arte", hash });
                S.data.arte_url = "";
                S.data.config.arte_file_id = "";
                imagenes.limpiar();
                pintarPreview(null);
            }));

            /* Centro del cartón: espacio libre (con imagen opcional) o número */
            const centroSel = select("bn-centro", [["libre", "Espacio libre al centro"], ["numero", "Número en el centro (25 números por cartón)"]], cfg.centro === "numero" ? "numero" : "libre");
            const centroArchivo = el("input", { type: "file", accept: "image/png", id: "bn-centro-file", class: "bn-file" });
            const centroEstado = el("p", { class: "bn-note" });
            const centroAcciones = el("div", { class: "bn-btnrow" });
            const centroBox = el("div", { class: "bn-stack bn-centro-box" });

            function pintarCentroAcciones() {
                const quitar = el("button", { class: "bn-btn bn-btn--sm bn-btn--danger", text: "Quitar imagen del centro" });
                quitar.addEventListener("click", () => conBoton(quitar, async () => {
                    const res = await llamar({ action: "delete_centro", hash });
                    S.data.config = res.config;
                    Object.assign(cfg, res.config);
                    imagenes.limpiar();
                    centroEstado.textContent = "Sin imagen: el centro dice LIBRE.";
                    pintarCentroAcciones();
                    pintarPreview(undefined, null);
                }));
                poner(centroAcciones, 
                    el("button", { class: "bn-btn bn-btn--sm", onclick: descargarGuiaCentro, text: `Plantilla del centro (PNG ${LADO} × ${LADO})` }),
                    cfg.centro_file_id ? quitar : null
                );
            }

            /** PNG transparente del tamaño exacto, con la zona segura marcada, para diseñar encima. */
            async function descargarGuiaCentro() {
                const cv = document.createElement("canvas");
                cv.width = LADO;
                cv.height = LADO;
                const ctx = cv.getContext("2d");
                ctx.strokeStyle = "#d23a3a";
                ctx.lineWidth = 2;
                ctx.setLineDash([6, 5]);
                ctx.strokeRect(12, 12, LADO - 24, LADO - 24);
                ctx.fillStyle = "#d23a3a";
                ctx.font = "700 15px Arial";
                ctx.textAlign = "center";
                ctx.fillText(`${LADO} × ${LADO} px`, LADO / 2, LADO / 2 - 6);
                ctx.font = "400 12px Arial";
                ctx.fillText("zona segura dentro", LADO / 2, LADO / 2 + 14);
                ctx.fillText("de la línea", LADO / 2, LADO / 2 + 30);
                descargarBlob(await canvasABlob(cv), `plantilla-centro-${LADO}x${LADO}.png`);
            }

            centroArchivo.addEventListener("change", async () => {
                const f = centroArchivo.files && centroArchivo.files[0];
                if (!f) return;
                const url = await new Promise((res) => { const rd = new FileReader(); rd.onload = () => res(String(rd.result)); rd.readAsDataURL(f); });
                const img = await cargarImagen(url);
                centroArchivo.value = "";
                if (!img) return showMessage("No se pudo leer la imagen.", "error");
                if (f.type !== "image/png" || !/^data:image\/png;/.test(url)) {
                    centroEstado.textContent = "La imagen del centro debe ser PNG.";
                    return;
                }
                if (img.naturalWidth !== LADO || img.naturalHeight !== LADO) {
                    centroEstado.textContent = `Tu imagen mide ${img.naturalWidth} × ${img.naturalHeight} px. Debe medir exactamente ${LADO} × ${LADO} px: ajústala y vuelve a subirla.`;
                    return;
                }
                await pintarPreview(undefined, img);
                centroEstado.textContent = "Así se ve en el centro del cartón. Si te gusta, súbela.";
                const subir = el("button", { class: "bn-btn bn-btn--primary bn-btn--sm", text: "Usar esta imagen" });
                subir.addEventListener("click", () => conBoton(subir, async () => {
                    const d = await llamar({ action: "upload_centro", hash, archivo: url }, { timeoutMs: 60000 });
                    S.data.config.centro_file_id = d.centro_file_id;
                    cfg.centro_file_id = d.centro_file_id;
                    imagenes.limpiar();
                    centroEstado.textContent = "Imagen del centro guardada.";
                    subir.remove();
                    pintarCentroAcciones();
                    showMessage("Imagen del centro guardada.", "success");
                }, "Subiendo…"));
                centroAcciones.prepend(subir);
            });

            centroBox.append(
                el("div", { class: "bn-howto" },
                    el("b", { text: "Imagen para el espacio libre (opcional)" }),
                    el("ul", {},
                        el("li", {}, "Formato ", el("b", { text: "PNG" }), " de ", el("b", { text: `exactamente ${LADO} × ${LADO} px` }), ". Si mide otra cosa no se acepta, para que nunca salga estirada ni cortada."),
                        el("li", { text: `Llena toda la casilla del centro (unos 1,6 × 1,6 cm impresa). El sistema dibuja encima el borde de la casilla: deja unos 12 px libres en cada orilla para que no tape nada.` }),
                        el("li", { text: "Con fondo transparente se ve el blanco de la casilla; con fondo de color, ese color llena la casilla." }),
                        el("li", { text: "El espacio libre cuenta como marcado para todos: nunca lleva X roja." }),
                        el("li", { text: "Sin imagen, el centro dice LIBRE." })
                    )
                ),
                campo("Subir imagen del centro", centroArchivo),
                centroEstado,
                centroAcciones
            );
            centroBox.hidden = centroSel.value === "numero";
            centroEstado.textContent = cfg.centro_file_id ? "Hay una imagen guardada para el centro." : "";
            pintarCentroAcciones();

            centroSel.addEventListener("change", async () => {
                const v = centroSel.value;
                const res = await conBoton(null, () => llamar({ action: "update_config", hash, config: { centro: v } }));
                if (!res) {
                    centroSel.value = cfg.centro === "numero" ? "numero" : "libre";
                    return;
                }
                S.data.config = res.config;
                Object.assign(cfg, res.config);
                centroBox.hidden = v === "numero";
                imagenes.limpiar();
                pintarPreview(undefined, v === "numero" ? null : undefined);
                showMessage(v === "numero" ? "Los cartones llevan número en el centro." : "Los cartones llevan espacio libre al centro.", "success");
            });

            const ampliar = el("button", { class: "bn-btn", text: `Habilitar ${cfg.lote || 100} cartones` });
            const habil = el("strong", { text: r.cartones_habilitados.toLocaleString("es-CR") });
            ampliar.addEventListener("click", () => conBoton(ampliar, async () => {
                const d = await llamar({ action: "ampliar_lote", hash });
                S.data.resumen.cartones_habilitados = d.cartones_habilitados;
                habil.textContent = d.cartones_habilitados.toLocaleString("es-CR");
            }));

            const buscar = input("bn-buscar-serie", "", { type: "number", min: 1, max: 10000, placeholder: "Serie" });
            const resultado = el("div", { class: "bn-search-result" });
            const btnBuscar = el("button", { class: "bn-btn", text: "Ver cartón" });
            btnBuscar.addEventListener("click", () => conBoton(btnBuscar, async () => {
                const s = Number(buscar.value);
                const conCentro = centroNumero(cfg);
                const grid = C.carton(seed, s, conCentro);
                const v = await llamar({ action: "list_cartones", hash });
                const venta = (v.vendidos || []).find((x) => x.serie === s);
                const cv = el("canvas", { class: "bn-canvas bn-canvas--mini" });
                const t = tituloCarton(cfg);
                C.dibujarCarton(cv, {
                    seed, serie: s, arte: await cargarImagen(S.data.arte_url), titulo: t.titulo, subtitulo: t.subtitulo, letras: cfg.letras_sistema !== "false",
                    centroNumero: conCentro, centroImg: conCentro ? null : await cargarImagen(centroUrl()), qrTexto: links.carton(pub, seed, s)
                });
                poner(resultado, cv, el("div", { class: "bn-stack" },
                    el("p", {}, el("b", { text: `Serie ${C.serieTexto(s)} · código ${C.codigo(seed, s)}` })),
                    el("p", { text: venta ? `Vendido a ${venta.comprador}` : s > S.data.resumen.cartones_habilitados ? "Libre (fuera del lote habilitado)" : "Libre" }),
                    el("p", { class: "bn-mono bn-note", text: grid.map((row) => row.map((n) => (n ? String(n).padStart(2, " ") : "★")).join("  ")).join("\n") }),
                    el("button", { class: "bn-btn bn-btn--sm", onclick: () => copiar(links.carton(pub, seed, s), "Link del cartón copiado."), text: "Copiar link del cartón" })
                ));
            }, "Buscando…"));

            agregar(root,
                el("section", { class: "bn-card" },
                    el("h2", { text: "Lote de cartones" }),
                    el("p", {}, "Habilitados: ", habil, ` · vendidos: ${r.cartones_vendidos.toLocaleString("es-CR")} · máximo 10 000. Las compras en línea amplían el lote solas cuando se acaban los libres.`),
                    el("div", { class: "bn-btnrow" }, ampliar)
                ),
                el("section", { class: "bn-card bn-design" },
                    el("div", { class: "bn-design-text" },
                        el("h2", { text: "Diseño del cartón" }),
                        el("ol", { class: "bn-steps" },
                            el("li", {}, "Descarga el template. Marca dónde van el título, la palabra BINGO, las 25 casillas, la serie, el QR y el código."),
                            el("li", {}, "Diseña tu arte encima con la herramienta que quieras (Canva, Photoshop…). Deja libre el espacio de las casillas: el sistema las pinta de blanco."),
                            el("li", {}, "Exporta en 1200 × 1680 px (10 × 14 cm) y súbelo aquí.")
                        ),
                        el("div", { class: "bn-btnrow" },
                            el("button", { class: "bn-btn", onclick: () => descargarTemplate(false), text: "Template PNG" }),
                            el("button", { class: "bn-btn", onclick: () => descargarTemplate(true), text: "PNG transparente" }),
                            el("button", { class: "bn-btn", onclick: () => descargarTemplate(false, true), text: "Template PDF" })
                        ),
                        campo("Subir arte del cartón", archivo, "PNG, JPG o WEBP en la proporción del template."),
                        estadoArte,
                        el("label", { class: "bn-check" }, letrasChk, el("span", { text: "Dibujar las letras B I N G O del sistema (desmárcalo si tu arte ya las trae)" })),
                        S.data.arte_url ? el("div", { class: "bn-btnrow" }, quitarArte) : null,
                        el("hr", { class: "bn-sep" }),
                        el("h3", { text: "Centro del cartón" }),
                        campo("¿Qué va en la casilla del centro?", centroSel, "Con número en el centro, la N lleva 5 números y ninguna casilla está marcada de entrada. Cámbialo antes de imprimir o vender."),
                        centroBox
                    ),
                    el("div", { class: "bn-design-preview" }, preview, el("small", { class: "bn-note", text: `Vista previa: serie ${C.serieTexto(1)} con 5 números marcados.` }))
                ),
                el("section", { class: "bn-card" },
                    el("h2", { text: "Imprimir cartones" }),
                    el("p", { class: "bn-note", text: "El PDF se arma en este navegador; no se sube nada. Cada cartón lleva su QR al link en línea." }),
                    panelImprimir({ seed, pub, cfg, min: 1, max: 10000, obtenerArte: imagenes })
                ),
                el("section", { class: "bn-card" },
                    el("h2", { text: "Buscar un cartón" }),
                    el("div", { class: "bn-toolbar" }, buscar, btnBuscar),
                    resultado
                )
            );
            pintarPreview();
        }

        /* ---------- Sectores ---------- */
        function vistaSectores(root) {
            const copiarFilas = (lista) => lista.map((s) => {
                const encargados = (s.encargados || []).map((x) => ({ ...x }));
                /* Sectores de la versión anterior: su encargado único pasa a la lista (recibe link propio al guardar). */
                if (!encargados.length && s.encargado) encargados.push({ id: 0, nombre: s.encargado, telefono: s.telefono || "", activo: true });
                return { ...s, encargados };
            });
            let filas = copiarFilas(S.data.sectores || []);
            const tabla = el("div", { class: "bn-sectors" });
            const cfg = S.data.config;
            const porEnc = S.data.resumen.por_encargado || {};

            function filaEncargado(s, x, j) {
                const upd = (k) => (ev) => { x[k] = ev.target.type === "checkbox" ? ev.target.checked : ev.target.value; };
                const link = x.hash ? links.sector(x.hash) : "";
                const d = porEnc[`${s.sector_id}:${x.id}`];
                const texto = `Hola ${x.nombre || ""}, este es tu link para registrar las ventas de ${cfg.nombre} (sector ${s.nombre}${s.desde && s.hasta ? `, cartones ${s.desde}–${s.hasta}` : ""}): ${link}`;
                const activo = el("input", { type: "checkbox", onchange: upd("activo") });
                activo.checked = x.activo !== false;
                return el("div", { class: "bn-enc" },
                    el("div", { class: "bn-enc-fields" },
                        campo("Encargado", el("input", { class: "bn-input", value: x.nombre || "", placeholder: "Nombre", oninput: upd("nombre") })),
                        campo("WhatsApp", el("input", { class: "bn-input", type: "tel", value: x.telefono || "", placeholder: "8888 8888", oninput: upd("telefono") })),
                        el("label", { class: "bn-check" }, activo, el("span", { text: "Link activo" }))
                    ),
                    el("div", { class: "bn-btnrow" },
                        x.id ? el("span", { class: "bn-chip", text: d ? `${d.cartones} ${d.cartones === 1 ? "cartón" : "cartones"} · ${colones(d.monto)}` : "sin ventas" }) : el("span", { class: "bn-chip", text: "Nuevo: guarda para crear su link" }),
                        link ? el("button", { class: "bn-btn bn-btn--sm", onclick: () => copiar(link, "Link del encargado copiado."), text: "Copiar link" }) : null,
                        link && x.telefono ? el("a", { class: "bn-btn bn-btn--sm", href: waUrl(x.telefono, texto), target: "_blank", rel: "noopener", text: "Enviar por WhatsApp" }) : null,
                        !d ? el("button", { class: "bn-btn bn-btn--sm bn-btn--danger", onclick: () => { s.encargados.splice(j, 1); pintar(); }, text: "Quitar" }) : null
                    )
                );
            }

            function pintar() {
                if (!filas.length) {
                    poner(tabla, el("p", { class: "bn-empty", text: "Sin sectores. Agrega uno para darle a un grupo de vendedores su bloque de cartones y un link para cada encargado." }));
                    return;
                }
                poner(tabla, ...filas.map((s, i) => {
                    const upd = (k) => (ev) => { s[k] = ev.target.type === "checkbox" ? ev.target.checked : ev.target.value; };
                    const vendidos = S.data.resumen.por_sector[s.sector_id] || 0;
                    const linkGeneral = s.hash ? links.sector(s.hash) : "";
                    const activo = el("input", { type: "checkbox", onchange: upd("activo") });
                    activo.checked = s.activo !== false;
                    const addEnc = el("button", { class: "bn-btn bn-btn--sm", text: "+ Agregar encargado" });
                    addEnc.addEventListener("click", () => { s.encargados.push({ id: 0, nombre: "", telefono: "", activo: true }); pintar(); });
                    return el("article", { class: "bn-sector" },
                        el("div", { class: "bn-form-grid" },
                            campo("Sector", el("input", { class: "bn-input", value: s.nombre || "", oninput: upd("nombre") })),
                            campo("Desde la serie", el("input", { class: "bn-input", type: "number", min: 1, max: 10000, value: s.desde || "", oninput: upd("desde") })),
                            campo("Hasta la serie", el("input", { class: "bn-input", type: "number", min: 1, max: 10000, value: s.hasta || "", oninput: upd("hasta") })),
                            el("label", { class: "bn-check" }, activo, el("span", { text: "Sector activo (apaga todos sus links)" }))
                        ),
                        el("div", { class: "bn-enc-list" },
                            el("div", { class: "bn-card-head" }, el("h3", { text: `Encargados (${s.encargados.length})` }), addEnc),
                            s.encargados.length ? s.encargados.map((x, j) => filaEncargado(s, x, j)) : el("p", { class: "bn-note", text: "Sin encargados: las ventas del sector se anotan con el link general." })
                        ),
                        el("div", { class: "bn-btnrow" },
                            s.sector_id ? el("span", { class: "bn-chip", text: `${vendidos} vendidos en el sector` }) : el("span", { class: "bn-chip", text: "Nuevo: guarda para crear sus links" }),
                            linkGeneral ? el("button", { class: "bn-btn bn-btn--sm", onclick: () => copiar(linkGeneral, "Link general del sector copiado."), text: "Copiar link general" }) : null,
                            !vendidos ? el("button", { class: "bn-btn bn-btn--sm bn-btn--danger", onclick: () => { filas.splice(i, 1); pintar(); }, text: "Quitar sector" }) : null
                        )
                    );
                }));
            }

            const btnAgregar = el("button", { class: "bn-btn", text: "+ Agregar sector" });
            btnAgregar.addEventListener("click", () => {
                const max = filas.reduce((m, s) => Math.max(m, Number(s.hasta) || 0), 0);
                filas.push({ sector_id: 0, nombre: `Sector ${filas.length + 1}`, desde: max + 1, hasta: max + 100, activo: true, encargados: [{ id: 0, nombre: "", telefono: "", activo: true }] });
                pintar();
            });
            const guardar = el("button", { class: "bn-btn bn-btn--primary", text: "Guardar sectores" });
            guardar.addEventListener("click", () => conBoton(guardar, async () => {
                const d = await llamar({ action: "save_sectores", hash, sectores: filas });
                S.data.sectores = d.sectores;
                await recargar();
                filas = copiarFilas(S.data.sectores);
                pintar();
                showMessage("Sectores guardados.", "success");
            }, "Guardando…"));
            agregar(root,
                el("section", { class: "bn-card" },
                    el("h2", { text: "Sectores y encargados" }),
                    el("p", { class: "bn-note", text: "Cada sector recibe un bloque de series (para imprimir y vender en persona). Cada encargado tiene su propio link donde anota las ventas con su comprobante; el resumen muestra cuánto vendió cada uno. Los rangos no pueden cruzarse; las compras en línea usan los cartones fuera de estos rangos." })
                ),
                tabla,
                el("div", { class: "bn-toolbar bn-sticky-save" }, btnAgregar, guardar)
            );
            pintar();
        }

        /* ---------- Juego ---------- */
        async function vistaJuego(root) {
            const cont = el("div", { class: "bn-game" });
            agregar(root, cont);
            let J;
            try {
                J = await llamar({ action: "game_get", hash });
            } catch (e) {
                poner(cont, el("p", { class: "bn-empty bn-empty--error", text: e.message }));
                return;
            }
            const seed = J.seed;
            const gridDe = (s) => C.carton(seed, s, centroNumero(J.config));
            let enCurso = false;
            const pantalla = canalPantalla(hash);
            const estadoPantalla = (r) => estadoDeRonda(J.config.nombre, r);
            /** Abre la pantalla para proyectar en otra ventana: solo las bolas cantadas y, al rifar, la rifa. */
            const botonPantalla = () => el("button", {
                class: "bn-btn bn-btn--sm", title: "Abre una ventana para proyectar las bolas cantadas y la rifa",
                onclick: () => {
                    const w = window.open(links.pantalla(hash), `bn_pantalla_${J.config.public_id || "bingo"}`, "popup,width=1280,height=760");
                    if (!w) showMessage("El navegador bloqueó la ventana. Permite las ventanas emergentes de este sitio.", "error", 8000);
                },
                text: "⧉ Abrir pantalla"
            });

            function rondaActiva() {
                return J.rondas.find((r) => r.estado === "En juego") || null;
            }

            async function accion(btn, payload, ocupado) {
                if (enCurso) return null;
                enCurso = true;
                try {
                    const r = await conBoton(btn, () => llamar({ hash, ...payload }), ocupado);
                    if (r && r.ronda) {
                        const i = J.rondas.findIndex((x) => x.ronda_id === r.ronda.ronda_id);
                        if (i >= 0) J.rondas[i] = r.ronda;
                    }
                    if (r && r.rondas) J.rondas = r.rondas;
                    if (r && r.vivo) J.vivo = r.vivo;
                    return r;
                } finally {
                    enCurso = false;
                }
            }

            /** Cartones vendidos que siguen en pie en una eliminación con estas bolas. */
            const enPie = (bolas) => (J.vendidos || []).filter((s) => !C.eliminadoPor(gridDe(s), bolas));

            function resumenRonda(r) {
                if (r.tipo !== "figuras") {
                    const p = r.premios[0] || {};
                    return `${TIPOS_RONDA[r.tipo]}${p.premio ? " · " + p.premio : ""}${textoConsuelos(p)}`;
                }
                return r.premios.map((p) => `${C.nombreFigura(p.figura, p.celdas)}${p.premio ? " (" + p.premio + ")" : ""}${textoConsuelos(p)}`).join(" · ");
            }
            function textoConsuelos(p) {
                const n = consuelosDe(p).length;
                return n ? ` + ${n} de consolación` : "";
            }

            function editorRonda(ronda) {
                const nombre = input("bn-ronda-nombre", ronda ? ronda.nombre : `Ronda ${J.rondas.length + 1}`);
                const tipo = select("bn-ronda-tipo", Object.entries(TIPOS_RONDA), ronda ? ronda.tipo : "figuras");
                let premios = ronda && ronda.tipo === "figuras"
                    ? ronda.premios.map((p) => ({ id: p.id, figura: p.figura, celdas: p.celdas, premio: p.premio, consuelo: p.consuelo || "" }))
                    : [{ id: 0, figura: "linea", celdas: "", premio: "", consuelo: "" }];
                const premioUnico = input("bn-ronda-premio", ronda && ronda.tipo !== "figuras" ? (ronda.premios[0] || {}).premio : "", { placeholder: "₡50 000 o una canasta" });
                const consueloUnico = input("bn-ronda-consuelo", ronda && ronda.tipo !== "figuras" ? (ronda.premios[0] || {}).consuelo || "" : "", { placeholder: "Opcional: ₡5 000; una canasta" });
                const notaConsuelo = "Opcional. Separa con punto y coma. Tras la rifa del premio, se retira al ganador y se rifan estos entre los demás.";
                const listaPremios = el("div", { class: "bn-prize-list" });
                const explicacion = el("p", { class: "bn-note" });
                const cajaFiguras = el("div", { class: "bn-stack" });
                const cajaUnico = el("div", { class: "bn-stack" }, campo("Premio", premioUnico), campo("Premios de consolación", consueloUnico, notaConsuelo));

                function pintarPremios() {
                    poner(listaPremios, ...premios.map((p, i) => {
                        const fig = select(`bn-premio-fig-${i}`, C.ORDEN_FIGURAS.map((k) => [k, C.FIGURAS[k].nombre]), p.figura);
                        const premio = el("input", { class: "bn-input", value: p.premio || "", placeholder: "Premio de esta figura", oninput: (ev) => { p.premio = ev.target.value; } });
                        const consuelo = el("input", { class: "bn-input", value: p.consuelo || "", placeholder: "Opcional: ₡5 000; una canasta", oninput: (ev) => { p.consuelo = ev.target.value; } });
                        const muestra = el("div", {});
                        const pintarMuestra = () => poner(muestra, 
                            patronEl(p.figura, p.celdas, { editable: p.figura === "custom", alCambiar: (c) => { p.celdas = c; } }),
                            p.figura === "custom" ? el("small", { class: "bn-note", text: "Toca las casillas que forman la figura." }) : null
                        );
                        fig.addEventListener("change", () => { p.figura = fig.value; pintarMuestra(); });
                        pintarMuestra();
                        return el("div", { class: "bn-prize-row" },
                            el("span", { class: "bn-prize-num", text: String(i + 1) }),
                            el("div", { class: "bn-stack" }, campo("Figura", fig), campo("Premio", premio), campo("Premios de consolación", consuelo, notaConsuelo)),
                            muestra,
                            premios.length > 1 ? el("button", { class: "bn-btn bn-btn--sm bn-btn--danger", onclick: () => { premios.splice(i, 1); pintarPremios(); }, text: "Quitar" }) : null
                        );
                    }));
                }
                const addPremio = el("button", { class: "bn-btn bn-btn--sm", text: "+ Agregar premio" });
                addPremio.addEventListener("click", () => { premios.push({ id: 0, figura: "lleno", celdas: "", premio: "", consuelo: "" }); pintarPremios(); });
                cajaFiguras.append(
                    el("p", { class: "bn-note", text: "Todos los premios se juegan con las mismas bolas. Pon primero las figuras fáciles y al final el cartón lleno." }),
                    listaPremios, el("div", { class: "bn-btnrow" }, addPremio)
                );

                function pintarTipo() {
                    const t = tipo.value;
                    cajaFiguras.hidden = t !== "figuras";
                    cajaUnico.hidden = t === "figuras";
                    explicacion.textContent = t === "salado"
                        ? "Se cantan bolas y gana el cartón vendido con más espacios en blanco (números que no han salido). El sistema muestra el ranking en vivo; tú decides cuándo parar."
                        : t === "eliminacion"
                            ? "Cada bola elimina los cartones que tienen ese número. Gana el último cartón en pie. El sistema cuenta en vivo cuántos quedan."
                            : "";
                    explicacion.hidden = t === "figuras";
                }
                tipo.addEventListener("change", pintarTipo);
                pintarPremios();
                pintarTipo();

                modal(ronda ? "Editar ronda" : "Nueva ronda", el("div", { class: "bn-stack" },
                    el("div", { class: "bn-form-grid" }, campo("Nombre", nombre), campo("Tipo de ronda", tipo)),
                    explicacion, cajaFiguras, cajaUnico
                ), (cerrar) => {
                    const ok = el("button", { class: "bn-btn bn-btn--primary", text: "Guardar" });
                    ok.addEventListener("click", async () => {
                        if (tipo.value === "figuras" && premios.some((p) => p.figura === "custom" && !p.celdas)) {
                            return showMessage("Marca las casillas de la figura personalizada.", "error");
                        }
                        const lista = tipo.value === "figuras" ? premios : [{ id: 1, premio: premioUnico.value, consuelo: consueloUnico.value }];
                        const r = await accion(ok, { action: "game_save_ronda", ronda: { ronda_id: ronda ? ronda.ronda_id : 0, nombre: nombre.value, tipo: tipo.value, premios: lista } });
                        if (r) { cerrar(); pintar(); }
                    });
                    return [el("button", { class: "bn-btn", onclick: cerrar, text: "Cancelar" }), ok];
                });
            }

            function pintar() {
                const activa = rondaActiva();
                poner(cont, activa ? vistaRonda(activa) : vistaRondas());
            }

            function vistaRondas() {
                pantalla.emitir(estadoPantalla(null));
                const pendientes = J.rondas.filter((r) => r.estado === "Pendiente");
                const terminadas = J.rondas.filter((r) => r.estado === "Terminada");
                return el("div", { class: "bn-stack" },
                    el("section", { class: "bn-card" },
                        el("div", { class: "bn-card-head" }, el("h2", { text: "Rondas" }), el("div", { class: "bn-btnrow" }, botonPantalla(), el("button", { class: "bn-btn bn-btn--primary", onclick: () => editorRonda(null), text: "+ Nueva ronda" }))),
                        pendientes.length ? el("ul", { class: "bn-rounds" }, pendientes.map((r, i) => {
                            const abrir = el("button", { class: "bn-btn bn-btn--sm bn-btn--primary", text: "Empezar" });
                            abrir.addEventListener("click", async () => {
                                if (enCurso) return;
                                try {
                                    J.vendidos = (await llamar({ action: "game_get", hash })).vendidos || J.vendidos;
                                } catch (e) {
                                    /* se usa la lista que ya había */
                                }
                                const extra = r.tipo === "eliminacion" ? { quedan: (J.vendidos || []).length } : {};
                                if (await accion(abrir, { action: "game_abrir", ronda_id: r.ronda_id, ...extra }, "Abriendo…")) pintar();
                            });
                            const borrar = el("button", { class: "bn-btn bn-btn--sm bn-btn--danger", text: "Borrar" });
                            borrar.addEventListener("click", async () => {
                                if (await confirmar("Borrar ronda", `¿Borrar «${r.nombre}»?`, "Borrar", true) && await accion(borrar, { action: "game_delete_ronda", ronda_id: r.ronda_id })) pintar();
                            });
                            const mover = (dir, texto, etiqueta) => {
                                const b = el("button", { class: "bn-btn bn-btn--sm bn-btn--ghost", "aria-label": etiqueta, text: texto });
                                b.addEventListener("click", async () => { if (await accion(b, { action: "game_mover_ronda", ronda_id: r.ronda_id, dir })) pintar(); });
                                return b;
                            };
                            return el("li", {},
                                el("div", { class: "bn-round-info" }, el("b", { text: r.nombre }), el("span", { class: "bn-chip", text: TIPOS_RONDA[r.tipo] }), el("small", { class: "bn-note bn-block", text: resumenRonda(r) })),
                                el("div", { class: "bn-btnrow" },
                                    i > 0 ? mover(-1, "↑", "Subir ronda") : null,
                                    i < pendientes.length - 1 ? mover(1, "↓", "Bajar ronda") : null,
                                    el("button", { class: "bn-btn bn-btn--sm", onclick: () => editorRonda(r), text: "Editar" }), borrar, abrir));
                        })) : el("p", { class: "bn-empty", text: "Crea las rondas del bingo. Cada ronda puede tener varios premios (por ejemplo vertical de la B, 4 esquinas y cartón lleno). Para cerrar, agrega «El cartón más salado» o una «Eliminación»." })
                    ),
                    terminadas.length ? el("section", { class: "bn-card" },
                        el("h2", { text: "Rondas terminadas" }),
                        el("ul", { class: "bn-rounds" }, terminadas.map((r) => el("li", {},
                            el("div", { class: "bn-round-info" }, el("b", { text: r.nombre }), el("small", { class: "bn-note bn-block", text: `${TIPOS_RONDA[r.tipo]} · ${r.bolas.length} bolas` })),
                            el("ul", { class: "bn-list bn-note" }, r.premios.map((p) => el("li", {},
                                `${r.tipo === "figuras" ? C.nombreFigura(p.figura, p.celdas) : TIPOS_RONDA[r.tipo]}${p.premio ? " (" + p.premio + ")" : ""}: `,
                                p.ganadores.length ? p.ganadores.map((g) => `serie ${C.serieTexto(g.serie)} ${g.nombre || ""}${esConsuelo(g.dato) ? " (consolación)" : ""}`).join(" · ") : "sin ganador")))
                        )))
                    ) : null
                );
            }

            function vistaRonda(r) {
                const cantadas = new Set(r.bolas);
                const ultimaBola = r.bolas[r.bolas.length - 1];
                /* Ajustes → «Juego y BINGO»: con marcado automático el cantador ve los ganadores; si no, solo un aviso. */
                const auto = J.config.marcado_auto === true;
                const tombola = J.config.sorteo === "tombola";
                const elim = r.tipo === "eliminacion";
                const deshacer = el("button", { class: "bn-btn bn-btn--sm", text: "Deshacer la última" });
                const cerrar = el("button", { class: "bn-btn bn-btn--danger", text: "Terminar ronda" });
                const nombrePremio = (p) => `${r.tipo === "figuras" ? C.nombreFigura(p.figura, p.celdas) : TIPOS_RONDA[r.tipo]}${p.premio ? " (" + p.premio + ")" : ""}`;

                async function cantar(bola, btn) {
                    const extra = elim ? { quedan: enPie([...r.bolas, bola]).length } : {};
                    const res = await accion(btn, { action: "game_cantar", bola, ...extra }, "Cantando…");
                    if (res) pintar();
                }

                /* Con tómbola solo se escribe el número que salió; con la app solo se usa su sorteo. */
                let controles;
                if (tombola) {
                    const bolaIn = input("bn-bola-manual", "", { type: "number", min: 1, max: 75, placeholder: "Bola 1–75", inputmode: "numeric", "aria-label": "Número que salió de la tómbola" });
                    const cantarBtn = el("button", { class: "bn-btn bn-btn--primary", text: "Cantar" });
                    cantarBtn.addEventListener("click", () => {
                        const n = Number(bolaIn.value);
                        if (!(n >= 1 && n <= 75 && Number.isInteger(n))) return showMessage("Escribe la bola que salió, de 1 a 75.", "error");
                        if (cantadas.has(n)) return showMessage(`La ${bolaTexto(n)} ya salió en esta ronda.`, "error");
                        cantar(n, cantarBtn);
                    });
                    bolaIn.addEventListener("keydown", (e) => { if (e.key === "Enter") cantarBtn.click(); });
                    controles = [el("small", { class: "bn-note", text: "Tómbola: escribe el número que salió." }), el("div", { class: "bn-toolbar" }, bolaIn, cantarBtn)];
                    setTimeout(() => bolaIn.focus(), 50);
                } else {
                    const sacar = el("button", { class: "bn-btn bn-btn--primary bn-btn--xl", text: "Sacar bola" });
                    sacar.addEventListener("click", () => {
                        const libres = [];
                        for (let n = 1; n <= 75; n++) if (!cantadas.has(n)) libres.push(n);
                        if (!libres.length) return showMessage("Ya salieron las 75 bolas.", "info");
                        const a = new Uint32Array(1);
                        crypto.getRandomValues(a);
                        cantar(libres[a[0] % libres.length], sacar);
                    });
                    controles = [sacar, el("small", { class: "bn-note", text: "La app elige cada bola al azar." })];
                }
                deshacer.addEventListener("click", async () => {
                    const extra = elim ? { quedan: enPie(r.bolas.slice(0, -1)).length } : {};
                    if (await accion(deshacer, { action: "game_deshacer", ...extra })) pintar();
                });
                cerrar.addEventListener("click", async () => {
                    const sinGanador = r.premios.filter((p) => !p.ganadores.length).length;
                    const texto = sinGanador ? `«${r.nombre}» tiene ${sinGanador} ${sinGanador === 1 ? "premio" : "premios"} sin ganador registrado. ¿Terminarla así?` : `Se cierra «${r.nombre}» con todos sus premios entregados.`;
                    if (await confirmar("Terminar ronda", texto, "Terminar")) {
                        if (await accion(cerrar, { action: "game_cerrar" }, "Cerrando…")) pintar();
                    }
                });

                const tablero = el("div", { class: "bn-board" }, C.LETRAS.map((letra, c) =>
                    el("div", { class: "bn-board-row" }, el("b", { class: `bn-board-letter bn-ball--${letra.toLowerCase()}`, text: letra }),
                        Array.from({ length: 15 }, (_, i) => {
                            const n = c * 15 + i + 1;
                            return el("span", { class: `${cantadas.has(n) ? "on" : ""}${n === ultimaBola ? " last" : ""}`, text: n });
                        }))
                ));

                function botonGanador(p, serie, dato, texto) {
                    const b = el("button", { class: "bn-btn bn-btn--sm bn-btn--primary", text: texto || "Registrar ganador" });
                    if (p.ganadores.some((g) => g.serie === serie)) {
                        b.disabled = true;
                        b.textContent = "Ya registrado";
                        return b;
                    }
                    b.addEventListener("click", async () => {
                        if (await accion(b, { action: "game_ganador", serie, premio_id: p.id, dato })) {
                            showMessage(`Ganador registrado: serie ${C.serieTexto(serie)}.`, "success");
                            pintar();
                        }
                    });
                    return b;
                }

                /* ----- Rifa: los cartones que cantaron BINGO se guardan en este dispositivo hasta registrar al ganador ----- */
                const claveRifa = `bn_rifa_${hash}_${r.ronda_id}`;
                let rifa = {};
                try {
                    rifa = JSON.parse(localStorage.getItem(claveRifa) || "{}") || {};
                } catch (e) {
                    rifa = {};
                }
                const guardarRifa = () => {
                    try {
                        localStorage.setItem(claveRifa, JSON.stringify(rifa));
                    } catch (e) {
                        /* sin almacenamiento: la lista dura mientras la página siga abierta */
                    }
                };
                const enRifa = (p) => (rifa[p.id] || []).filter((s) => !p.ganadores.some((g) => g.serie === s));
                function alternarRifa(p, serie) {
                    const lista = rifa[p.id] || [];
                    rifa[p.id] = lista.includes(serie) ? lista.filter((s) => s !== serie) : [...lista, serie];
                    guardarRifa();
                    pintarApoyo();
                }
                function botonRifa(p, serie) {
                    const b = el("button", { class: "bn-btn bn-btn--sm" });
                    const ver = () => {
                        const esta = enRifa(p).includes(serie);
                        b.textContent = esta ? "✓ En la rifa (quitar)" : "Cantó BINGO: a la rifa";
                        b.classList.toggle("bn-btn--ghost", esta);
                    };
                    b.addEventListener("click", () => { alternarRifa(p, serie); ver(); });
                    ver();
                    return b;
                }

                /** Cuántos premios de consolación de este premio ya tienen ganador. */
                const consuelosDados = (p) => p.ganadores.filter((g) => esConsuelo(g.dato)).length;
                function textoGanadores(p) {
                    const c = consuelosDados(p);
                    const n = p.ganadores.length - c;
                    return [n ? `✓ ${n} ${n === 1 ? "ganador" : "ganadores"}` : "", c ? `${c} de consolación` : ""].filter(Boolean).join(" + ");
                }

                /**
                 * Rifa de un premio. Tras registrar al ganador, la serie se retira y la rifa sigue con los demás
                 * para los premios de consolación (los de la ronda o los que el cantador decida en el momento).
                 */
                function abrirRifa(p, series) {
                    let lista = [...new Set(series)].sort((a, z) => a - z).filter((s) => !p.ganadores.some((g) => g.serie === s));
                    /* Los participantes quedan guardados: si se cierra la ventana, la consolación se puede rifar después. */
                    rifa[p.id] = [...new Set([...(rifa[p.id] || []), ...lista])];
                    guardarRifa();
                    const nombres = consuelosDe(p);
                    let principal = !p.ganadores.some((g) => !esConsuelo(g.dato));
                    let dados = consuelosDados(p);
                    let chips = [];
                    const etapa = el("p", { class: "bn-eyebrow" });
                    const nota = el("p", { class: "bn-note" });
                    const caja = el("div", { class: "bn-rifa-chips" });
                    const resultado = el("div", { class: "bn-stack bn-rifa-res", "aria-live": "polite" });
                    const girar = el("button", { class: "bn-btn bn-btn--primary", text: "Rifar" });
                    const nombreTurno = () => (principal ? "" : nombres[dados] || "");
                    const tituloTurno = () => (principal ? nombrePremio(p) : `Consolación${nombreTurno() ? " (" + nombreTurno() + ")" : ""} · ${nombrePremio(p)}`);

                    function preparar() {
                        chips = lista.map((s) => el("span", { class: "bn-rifa-chip", text: C.serieTexto(s) }));
                        poner(caja, ...chips);
                        poner(resultado);
                        etapa.textContent = principal ? "Premio de la ronda" : `Premio de consolación ${dados + 1}${nombres.length > dados ? " de " + nombres.length : ""}${nombreTurno() ? ": " + nombreTurno() : ""}`;
                        nota.textContent = `Participan ${lista.length} ${lista.length === 1 ? "cartón" : "cartones"}. La app elige uno al azar; el resultado no se puede repetir.`;
                        girar.hidden = false;
                        girar.disabled = false;
                    }

                    async function registrar(reg, s) {
                        const entre = `rifa entre ${lista.map((x) => C.serieTexto(x)).join(", ")}`;
                        const dato = principal ? entre : `Consolación${nombreTurno() ? ": " + nombreTurno() : ""} · ${entre}`;
                        if (!(await accion(reg, { action: "game_ganador", serie: s, premio_id: p.id, dato }))) return;
                        showMessage(`${principal ? "Ganador" : "Consolación"} registrado: serie ${C.serieTexto(s)}.`, "success");
                        if (principal) principal = false;
                        else dados++;
                        lista = lista.filter((x) => x !== s);
                        pintar();
                        const quedan = Math.max(0, nombres.length - dados);
                        const hecho = el("p", { class: "bn-verdict ok", text: `Registrada la serie ${C.serieTexto(s)}` });
                        if (!lista.length) return poner(resultado, hecho, el("p", { class: "bn-note", text: "Ya no quedan cartones en la rifa." }));
                        const seguir = el("button", { class: `bn-btn${quedan ? " bn-btn--primary" : ""}`, onclick: preparar,
                            text: quedan ? `Rifar la consolación${nombres[dados] ? " «" + nombres[dados] + "»" : ""}` : "Rifar otro premio de consolación" });
                        poner(resultado, hecho,
                            el("p", { class: "bn-note", text: quedan
                                ? `Se retira la serie ${C.serieTexto(s)}. ${quedan === 1 ? "Queda 1 premio" : `Quedan ${quedan} premios`} de consolación para los otros ${lista.length} ${lista.length === 1 ? "cartón" : "cartones"}.`
                                : `Se retira la serie ${C.serieTexto(s)}. Si hay otro premio de consolación, rifa entre los ${lista.length} que quedan.` }),
                            el("div", { class: "bn-btnrow" }, seguir));
                    }

                    girar.addEventListener("click", () => {
                        girar.disabled = true;
                        const a = new Uint32Array(1);
                        crypto.getRandomValues(a);
                        const elegido = a[0] % lista.length;
                        const pasos = lista.length * 3 + elegido;
                        pantalla.emitir({ t: "rifa", titulo: tituloTurno(), lista: lista.map((x) => C.serieTexto(x)), elegido, pasos });
                        let i = 0;
                        const terminar = () => {
                            const s = lista[elegido];
                            chips[elegido].classList.add("is-win");
                            const reg = el("button", { class: "bn-btn bn-btn--primary", text: `Registrar la serie ${C.serieTexto(s)}` });
                            reg.addEventListener("click", () => registrar(reg, s));
                            poner(resultado, el("p", { class: "bn-verdict ok", text: `${principal ? "Gana" : "Consolación para"} la serie ${C.serieTexto(s)}` }), el("div", { class: "bn-btnrow" }, reg));
                            girar.hidden = true;
                        };
                        const paso = () => {
                            chips.forEach((c, k) => c.classList.toggle("is-on", k === i % lista.length));
                            if (i >= pasos) return terminar();
                            i++;
                            setTimeout(paso, msRifa(i, pasos));
                        };
                        paso();
                    });

                    preparar();
                    modal(`Rifa · ${nombrePremio(p)}`, el("div", { class: "bn-stack" }, etapa, nota, caja, resultado), (cerrarM) =>
                        [el("button", { class: "bn-btn", onclick: () => { pantalla.emitir({ t: "rifa_cerrar" }); cerrarM(); }, text: "Cerrar" }), girar]);
                }

                /** Premios ya entregados con cartones de su rifa que siguen esperando un premio de consolación. */
                function bloqueConsuelo() {
                    const lista = r.premios.filter((p) => p.ganadores.length && enRifa(p).length && !(consuelosDe(p).length && consuelosDados(p) >= consuelosDe(p).length));
                    if (!lista.length) return null;
                    return el("section", { class: "bn-card" },
                        el("h2", { text: "Premios de consolación" }),
                        lista.map((p) => {
                            const quedan = consuelosDe(p).slice(consuelosDados(p));
                            const sobran = enRifa(p);
                            return el("div", { class: "bn-stack bn-prize-alert" },
                                el("b", { text: nombrePremio(p) }),
                                el("p", { class: "bn-note", text: quedan.length ? `Por rifar: ${quedan.join(", ")}.` : "Si hay un premio de consolación, rifa entre los cartones que no ganaron." }),
                                el("div", { class: "bn-rifa" },
                                    el("div", { class: "bn-rifa-chips" }, sobran.map((s) => el("span", { class: "bn-rifa-chip", text: C.serieTexto(s) }))),
                                    el("button", { class: "bn-btn bn-btn--primary", onclick: () => abrirRifa(p, sobran), text: `Rifar consolación entre ${sobran.length}` }),
                                    el("button", { class: "bn-btn bn-btn--ghost", onclick: () => { rifa[p.id] = []; guardarRifa(); pintarApoyo(); }, text: "No hay consolación" })));
                        }));
                }

                /** Cartones de la rifa de un premio, con su botón para rifar (o registrar si es uno solo). */
                function bloqueRifa(p, extras, quitables) {
                    if (p.ganadores.length) return null;
                    const propias = enRifa(p);
                    const todas = [...new Set([...(extras || []), ...propias])].sort((a, z) => a - z);
                    if (!todas.length) return null;
                    return el("div", { class: "bn-rifa" },
                        el("div", { class: "bn-rifa-chips" }, todas.map((s) => el("span", { class: "bn-rifa-chip" },
                            C.serieTexto(s),
                            quitables && propias.includes(s) ? el("button", { class: "bn-rifa-x", "aria-label": `Quitar la serie ${C.serieTexto(s)} de la rifa`, onclick: () => alternarRifa(p, s), text: "×" }) : null))),
                        todas.length > 1
                            ? el("button", { class: "bn-btn bn-btn--primary", onclick: () => abrirRifa(p, todas), text: `Rifar entre ${todas.length} cartones` })
                            : botonGanador(p, todas[0], "", `Registrar la serie ${C.serieTexto(todas[0])}`)
                    );
                }

                /** Bola con la que el cartón completó la figura (posición 1…n), o 0 si todavía no la completa. */
                function completoCon(grid, p) {
                    for (let k = 1; k <= r.bolas.length; k++) if (C.faltan(grid, r.bolas.slice(0, k), p.figura, p.celdas) === 0) return k;
                    return 0;
                }
                function cuandoCompleto(k) {
                    const atras = r.bolas.length - k;
                    return atras === 0
                        ? `Completó con la ${bolaTexto(r.bolas[k - 1])}, la última cantada.`
                        : `Completó con la ${bolaTexto(r.bolas[k - 1])}, hace ${atras} ${atras === 1 ? "bola" : "bolas"}.`;
                }

                /* Verificar un cartón contra todos los premios de la ronda */
                const serieIn = input("bn-verif-serie", "", { type: "number", min: 1, max: 10000, placeholder: "Serie del cartón" });
                const verificar = el("button", { class: "bn-btn bn-btn--primary", text: "Verificar" });
                const verifRes = el("div", { class: "bn-verify" });
                async function hacerVerificacion() {
                    const s = Number(serieIn.value);
                    if (!(s >= 1 && s <= 10000)) return showMessage("Escribe una serie de 1 a 10 000.", "error");
                    const grid = gridDe(s);
                    const info = await conBoton(verificar, () => llamar({ hash, action: "game_buscar", serie: s }), "Buscando…");
                    let resaltar = null;
                    let sello = "";
                    let detalle;
                    if (r.tipo === "salado") {
                        const n = C.blancos(grid, r.bolas);
                        detalle = [el("p", { class: "bn-verdict", text: `${n} ${n === 1 ? "espacio" : "espacios"} en blanco` }), el("div", { class: "bn-btnrow" }, botonRifa(r.premios[0], s), botonGanador(r.premios[0], s, `${n} en blanco`))];
                    } else if (elim) {
                        const x = C.eliminadoPor(grid, r.bolas);
                        sello = x ? "FUERA" : "";
                        const empate = x && x === ultimaBola && !enPie(r.bolas).length;
                        detalle = [
                            el("p", { class: `bn-verdict ${x ? "no" : "ok"}`, text: x ? `Eliminado con la ${bolaTexto(x)}${x === ultimaBola ? ", la última cantada" : ""}.` : "Sigue en pie." }),
                            !x || empate ? el("div", { class: "bn-btnrow" }, botonRifa(r.premios[0], s), botonGanador(r.premios[0], s, x ? "empate" : "último en pie")) : null
                        ];
                    } else {
                        detalle = el("ul", { class: "bn-checks" }, r.premios.map((p) => {
                            const gana = C.casillasGanadoras(grid, r.bolas, p.figura, p.celdas);
                            if (gana && !resaltar) resaltar = gana;
                            const f = C.faltan(grid, r.bolas, p.figura, p.celdas);
                            const k = gana ? completoCon(grid, p) : 0;
                            return el("li", { class: gana ? "ok" : "" },
                                el("div", {},
                                    el("span", { text: `${gana ? "✓ Cumple" : `Le faltan ${f}`} · ${nombrePremio(p)}` }),
                                    k ? el("small", { class: `bn-note bn-block${k === r.bolas.length ? " bn-ok-text" : ""}`, text: cuandoCompleto(k) }) : null),
                                gana && !p.ganadores.length ? el("div", { class: "bn-btnrow" }, botonRifa(p, s), botonGanador(p, s)) : gana ? botonGanador(p, s) : null);
                        }));
                    }
                    const cv = el("canvas", { class: "bn-canvas bn-canvas--mini" });
                    await fuentesListas();
                    C.dibujarCarton(cv, { seed, serie: s, arte: null, titulo: J.config.nombre, letras: true, centroNumero: centroNumero(J.config), marcas: C.marcadas(grid, r.bolas), resaltar, sello });
                    poner(verifRes, cv, el("div", { class: "bn-stack" },
                        detalle,
                        el("p", { text: info ? (info.vendido ? `Vendido a ${info.comprador}.` : "Atención: este cartón no aparece como vendido.") : "" })
                    ));
                }
                verificar.addEventListener("click", hacerVerificacion);
                serieIn.addEventListener("keydown", (e) => { if (e.key === "Enter") hacerVerificacion(); });

                /* Apoyo en vivo. Automático: quién completó y la rifa. Manual: solo un aviso, sin decir qué cartón. */
                const vendidos = J.vendidos || [];
                const apoyoCaja = el("div", { class: "bn-stack" });
                const notaManual = "Verifica cada cartón que cante BINGO y agrégalo a la rifa. Si cantan varios, rifa entre ellos.";
                function pintarApoyo() {
                    let apoyo;
                    if (r.tipo === "salado") {
                        const todos = vendidos.map((s) => ({ s, n: C.blancos(gridDe(s), r.bolas) })).sort((a, z) => z.n - a.n || a.s - z.s);
                        const tope = todos.length ? todos[0].n : 0;
                        const empatados = todos.filter((x) => x.n === tope).map((x) => x.s);
                        const p = r.premios[0];
                        apoyo = auto
                            ? el("section", { class: "bn-card" },
                                el("h2", { text: "Ranking: espacios en blanco" }),
                                todos.length ? el("ol", { class: "bn-rank" }, todos.slice(0, 10).map((x) => el("li", {},
                                    el("span", { text: `Serie ${C.serieTexto(x.s)}` }), el("b", { text: `${x.n} en blanco` }), botonGanador(p, x.s, `${x.n} en blanco`, "Ganador")))) : el("p", { class: "bn-note", text: "Todavía no hay cartones vendidos." }),
                                !p.ganadores.length && empatados.length > 1 ? el("div", { class: "bn-banner" }, el("p", { text: `${empatados.length} cartones empatan con ${tope} en blanco.` }), bloqueRifa(p, empatados.slice(0, 50), true)) : bloqueRifa(p, [], true),
                                el("p", { class: "bn-note", text: "Solo cuenta los cartones vendidos." })
                            )
                            : el("section", { class: "bn-card" },
                                el("h2", { text: "El cartón más salado" }),
                                el("p", { text: todos.length ? `El tope ahora: ${tope} ${tope === 1 ? "espacio" : "espacios"} en blanco (${empatados.length} ${empatados.length === 1 ? "cartón" : "cartones"}).` : "Todavía no hay cartones vendidos." }),
                                p.ganadores.length ? null : bloqueRifa(p, [], true),
                                el("p", { class: "bn-note", text: "Cuando pares, pide que se reporten los cartones con ese número de espacios en blanco y verifícalos." })
                            );
                    } else if (elim) {
                        const vivos = enPie(r.bolas);
                        const ultimosFuera = ultimaBola && !vivos.length ? enPie(r.bolas.slice(0, -1)) : [];
                        const p = r.premios[0];
                        apoyo = el("section", { class: "bn-card" },
                            el("h2", { text: "Cartones en pie" }),
                            el("p", { class: "bn-big-num", text: `${vivos.length} de ${vendidos.length}` }),
                            auto
                                ? [
                                    vivos.length === 1 ? el("div", { class: "bn-banner bn-banner--ok" }, el("p", { text: `¡Queda un cartón: serie ${C.serieTexto(vivos[0])}!` }), botonGanador(p, vivos[0], "último en pie")) : null,
                                    vivos.length > 1 && vivos.length <= 30 ? el("p", { class: "bn-mono bn-note", text: vivos.map((s) => C.serieTexto(s)).join("  ") }) : null,
                                    ultimosFuera.length ? el("div", { class: "bn-banner" },
                                        el("p", { text: `La ${bolaTexto(ultimaBola)} sacó a los ${ultimosFuera.length} que quedaban. Deshaz la bola y saca otra, o rifa entre ellos.` }),
                                        bloqueRifa(p, ultimosFuera.slice(0, 50), true)) : bloqueRifa(p, [], true)
                                ]
                                : [
                                    vivos.length === 1 ? el("div", { class: "bn-banner bn-banner--ok" }, el("p", { text: "Queda un cartón en pie. Espera a que lo reporten y verifícalo." })) : null,
                                    ultimosFuera.length ? el("div", { class: "bn-banner" }, el("p", { text: `La ${bolaTexto(ultimaBola)} sacó a los ${ultimosFuera.length} que quedaban. Deshaz la bola y saca otra, o verifica esos cartones y rifa entre ellos.` })) : null,
                                    p.ganadores.length ? null : bloqueRifa(p, [], true)
                                ]
                        );
                    } else {
                        const pendientes = r.premios.filter((p) => !p.ganadores.length);
                        const completos = pendientes.map((p) => ({ p, series: vendidos.filter((s) => C.faltan(gridDe(s), r.bolas, p.figura, p.celdas) === 0) }));
                        if (auto) {
                            const conAlgo = completos.filter((x) => x.series.length || enRifa(x.p).length);
                            apoyo = conAlgo.length ? el("section", { class: "bn-card bn-card--alert" },
                                el("h2", { text: "Cartones que ya tienen BINGO" }),
                                conAlgo.map((x) => el("div", { class: "bn-stack bn-prize-alert" },
                                    el("b", { text: nombrePremio(x.p) }),
                                    x.series.length === 1 && !enRifa(x.p).length
                                        ? el("div", { class: "bn-btnrow" }, botonGanador(x.p, x.series[0], "", `Registrar la serie ${C.serieTexto(x.series[0])}`))
                                        : bloqueRifa(x.p, x.series.slice(0, 50), true),
                                    x.series.length > 50 ? el("small", { class: "bn-note", text: `${x.series.length} cartones en total; la rifa toma los primeros 50.` }) : null
                                )),
                                el("p", { class: "bn-note", text: "Con varios cartones en el mismo premio, rifa entre ellos para definir quién gana." })
                            ) : null;
                        } else {
                            apoyo = pendientes.length ? el("section", { class: `bn-card${completos.some((x) => x.series.length) ? " bn-card--alert" : ""}` },
                                el("h2", { text: "Premios de la ronda" }),
                                completos.map((x) => el("div", { class: "bn-stack bn-prize-alert" },
                                    el("b", { text: nombrePremio(x.p) }),
                                    el("p", { class: x.series.length ? "bn-ok-text" : "bn-note", text: x.series.length ? "¡Ya hay alguien con este premio!" : "Todavía nadie lo completa." }),
                                    bloqueRifa(x.p, [], true)
                                )),
                                el("p", { class: "bn-note", text: notaManual })
                            ) : null;
                        }
                    }
                    poner(apoyoCaja, apoyo, bloqueConsuelo());
                }
                pintarApoyo();
                pantalla.emitir(estadoPantalla(r));

                const ganadoresRonda = r.premios.filter((p) => p.ganadores.length);
                return el("div", { class: "bn-stack" },
                    el("section", { class: "bn-card bn-caller" },
                        el("div", { class: "bn-caller-head" },
                            el("div", {},
                                el("p", { class: "bn-eyebrow" }, el("span", { class: "bn-dot bn-dot--live" }), ` En juego · ${TIPOS_RONDA[r.tipo]}`),
                                el("h2", { text: r.nombre }),
                                el("p", { class: "bn-note", text: `${r.bolas.length} de 75 bolas${elim ? ` · en pie: ${enPie(r.bolas).length}` : ""}` })
                            ),
                            el("div", { class: "bn-btnrow" },
                                botonPantalla(),
                                el("span", { class: "bn-chip", text: tombola ? "Tómbola" : "Bolas de la app" }),
                                el("span", { class: "bn-chip", text: auto ? "Ganadores a la vista" : "Ganadores ocultos" }))
                        ),
                        el("div", { class: "bn-prizes" }, r.premios.map((p) => el("div", { class: `bn-prize-card${p.ganadores.length ? " is-won" : ""}` },
                            r.tipo === "figuras" ? patronEl(p.figura, p.celdas, { chico: true }) : null,
                            el("div", {}, el("b", { text: r.tipo === "figuras" ? C.nombreFigura(p.figura, p.celdas) : TIPOS_RONDA[r.tipo] }), el("small", { class: "bn-note bn-block", text: [p.premio, textoGanadores(p)].filter(Boolean).join(" · ") }))
                        ))),
                        el("div", { class: "bn-caller-main" },
                            el("div", { class: "bn-caller-last" }, ultimaBola ? bolaEl(ultimaBola, true) : el("span", { class: "bn-ball bn-ball--big bn-ball--empty" }, el("b", { text: "–" })), el("div", { class: "bn-live-prev" }, r.bolas.slice(-6, -1).reverse().map((n) => bolaEl(n)))),
                            el("div", { class: "bn-caller-actions" }, controles, r.bolas.length ? deshacer : null)
                        ),
                        tablero
                    ),
                    el("section", { class: "bn-card" },
                        el("h2", { text: "Verificar un cartón" }),
                        el("p", { class: "bn-note", text: "Escribe la serie del cartón que cantó BINGO. Verás si cumple y con qué bola lo completó." }),
                        el("div", { class: "bn-toolbar" }, serieIn, verificar),
                        verifRes,
                        ganadoresRonda.length ? el("div", { class: "bn-stack" }, el("h3", { text: "Ganadores de esta ronda" }), el("ul", { class: "bn-list" }, ganadoresRonda.map((p) => p.ganadores.map((g) => {
                            const quitar = el("button", { class: "bn-btn bn-btn--sm bn-btn--ghost", text: "Quitar" });
                            quitar.addEventListener("click", async () => {
                                if (await confirmar("Quitar ganador", `¿Quitar la serie ${C.serieTexto(g.serie)} de los ganadores?`, "Quitar", true) && await accion(quitar, { action: "game_quitar_ganador", premio_id: p.id, serie: g.serie })) pintar();
                            });
                            return el("li", {}, `${r.tipo === "figuras" ? C.nombreFigura(p.figura, p.celdas) : TIPOS_RONDA[r.tipo]}: serie ${C.serieTexto(g.serie)} · ${g.nombre || "sin nombre"} · ${g.hora}, con ${g.bolas} bolas${g.dato ? " · " + g.dato : ""} `, quitar);
                        })))) : null
                    ),
                    apoyoCaja,
                    el("div", { class: "bn-toolbar bn-toolbar--end" }, cerrar)
                );
            }

            pintar();
        }

        /* ---------- Ajustes ---------- */
        function vistaAjustes(root) {
            const c = S.data.config;
            const fechaVista = el("small", { class: "bn-note" });
            const f = {
                nombre: input("bn-cfg-nombre", c.nombre),
                fecha: input("bn-cfg-fecha", c.fecha, { type: "date" }),
                hora: input("bn-cfg-hora", /^\d{1,2}:\d{2}/.test(c.hora || "") ? c.hora : "", { type: "time" }),
                lugar: input("bn-cfg-lugar", c.lugar, { placeholder: "Salón comunal de …" }),
                modalidad: select("bn-cfg-modalidad", [["Mixta", "Presencial y virtual"], ["Presencial", "Solo presencial"], ["Virtual", "Solo virtual"]], c.modalidad),
                whatsapp: input("bn-cfg-wa", c.whatsapp, { type: "tel", placeholder: "8888 8888" }),
                sinpe_numero: input("bn-cfg-sinpe", c.sinpe_numero, { type: "tel" }),
                sinpe_nombre: input("bn-cfg-sinpe-nombre", c.sinpe_nombre),
                iban: input("bn-cfg-iban", c.iban, { placeholder: "CR00 0000 …" }),
                lote: input("bn-cfg-lote", c.lote, { type: "number", min: 10, max: 1000 }),
                marcado: opcionesGrandes("bn-cfg-marcado", [
                    ["manual", "BINGO manual", "El jugador marca cada número tocando la casilla. El cantador no ve qué cartones ganaron: solo un aviso de que ya hay alguien con el premio. Revisa cada cartón que cante BINGO y rifa si son varios."],
                    ["auto", "BINGO automático", "Los números cantados se marcan solos en el cartón del jugador (puede cambiar a marcar tocando). El cantador ve de inmediato qué cartones ganaron, listos para rifar si son varios."]
                ], c.marcado === "auto" ? "auto" : "manual"),
                sorteo: opcionesGrandes("bn-cfg-sorteo", [
                    ["app", "Bolas de la app", "El cantador toca «Sacar bola» y la app elige cada número al azar. No se pueden escribir números."],
                    ["tombola", "Tómbola física", "Las bolas salen de la tómbola y el cantador escribe cada número. La app no saca bolas."]
                ], c.sorteo === "tombola" ? "tombola" : "app"),
                digitos: select("bn-cfg-digitos", [["3", "3 dígitos (001)"], ["4", "4 dígitos (0001)"], ["5", "5 dígitos (00001)"]], ["3", "4"].includes(String(c.digitos)) ? String(c.digitos) : "5")
            };
            const avisoDigitos = el("small", { class: "bn-note" });
            const verDigitos = () => {
                const d = Number(f.digitos.value);
                const tope = Math.pow(10, d) - 1;
                const hab = Number(c.cartones_habilitados) || 0;
                avisoDigitos.textContent = `Así se ve: serie ${String(7).padStart(d, "0")}.${hab > tope ? ` Ojo: hay ${hab.toLocaleString("es-CR")} cartones habilitados; desde el ${(tope + 1).toLocaleString("es-CR")} se muestran con ${String(hab).length} dígitos.` : ""}`;
            };
            f.digitos.addEventListener("change", verDigitos);
            verDigitos();
            const verFecha = () => { fechaVista.textContent = f.fecha.value ? `Se muestra así: ${fechaLarga(f.fecha.value, f.hora.value)}` : ""; };
            f.fecha.addEventListener("input", verFecha);
            f.hora.addEventListener("input", verFecha);
            verFecha();

            /* ----- Combos de precios ----- */
            let combos = (S.data.precios || []).map((p) => ({ cantidad: p.cantidad, precio: p.precio }));
            if (!combos.length && Number(c.precio_unitario) > 0) combos = [{ cantidad: 1, precio: Number(c.precio_unitario) }];
            if (!combos.length) combos = [{ cantidad: 1, precio: "" }];
            const filasCombos = el("div", { class: "bn-combos" });
            const tablaAuto = el("div", { class: "bn-price-auto" });
            const avisoCombos = el("div", { class: "bn-combo-alert", hidden: true });
            const calcN = input("bn-calc-n", "21", { type: "number", min: 1, max: 1000, inputmode: "numeric" });
            const calcRes = el("p", { class: "bn-calc-res" });

            const combosValidos = () => combos
                .map((x) => ({ cantidad: Math.floor(Number(x.cantidad)), precio: Number(x.precio) }))
                .filter((x) => x.cantidad >= 1 && x.precio > 0 && String(x.precio) !== "NaN");

            function revisarCombos() {
                const lista = combosValidos();
                const tieneUno = lista.some((x) => x.cantidad === 1);
                const repetidos = lista.filter((x, i) => lista.findIndex((y) => y.cantidad === x.cantidad) !== i);
                let fallas = [];
                const avisos = [];
                if (!tieneUno) avisos.push("Agrega el combo de 1 cartón: con él se arma cualquier cantidad.");
                if (repetidos.length) avisos.push(`Hay dos combos de ${repetidos[0].cantidad} cartones. Deja uno.`);
                if (tieneUno && !repetidos.length) {
                    fallas = fallasEscalonado(lista, 0);
                    if (fallas.length) {
                        avisos.push("Los precios no están escalonados: comprar un cartón más no cuesta más en estos casos.");
                    }
                }
                avisoCombos.hidden = !avisos.length;
                poner(avisoCombos, 
                    ...avisos.map((t) => el("p", { text: t })),
                    fallas.length ? el("ul", {}, fallas.slice(0, 6).map((x) => el("li", { text: `${x.n - 1} ${x.n - 1 === 1 ? "cartón cuesta" : "cartones cuestan"} ${colones(x.anterior)} y ${x.n} cartones ${x.total === x.anterior ? "cuestan lo mismo" : `cuestan ${colones(x.total)}`}.` }))) : null,
                    fallas.length > 6 ? el("small", { text: `y ${fallas.length - 6} casos más.` }) : null
                );
                const malos = new Set(fallas.map((x) => x.n));
                const max = Math.max(20, ...lista.map((x) => x.cantidad + 5));
                poner(tablaAuto, ...(tieneUno ? Array.from({ length: Math.min(60, max) }, (_, i) => {
                    const n = i + 1;
                    const q = cotizar(lista, 0, n);
                    return el("div", { class: `bn-price-cell${malos.has(n) ? " is-bad" : ""}${lista.some((x) => x.cantidad === n) ? " is-combo" : ""}`, title: desgloseTexto(q) },
                        el("span", { text: `${n}` }), el("b", { text: q ? colones(q.total) : "—" }));
                }) : [el("p", { class: "bn-note", text: "La tabla aparece cuando exista el combo de 1 cartón." })]));
                const q = tieneUno ? cotizar(lista, 0, calcN.value) : null;
                poner(calcRes, q && q.total ? el("b", { text: colones(q.total) }) : "", q && q.total ? el("span", { text: ` = ${desgloseTexto(q)}` }) : "");
                return { fallas, avisos };
            }
            calcN.addEventListener("input", revisarCombos);

            function pintarCombos() {
                combos.sort((a, z) => (Number(a.cantidad) || 9999) - (Number(z.cantidad) || 9999));
                poner(filasCombos, ...combos.map((x, i) => {
                    const cant = el("input", { class: "bn-input bn-input--sm", type: "number", min: 1, max: 1000, value: x.cantidad, "aria-label": "Cartones del combo" });
                    const precio = el("input", { class: "bn-input bn-input--sm", type: "number", min: 0, value: x.precio, "aria-label": "Precio del combo" });
                    const porCarton = el("small", { class: "bn-note" });
                    const ver = () => {
                        const n = Number(x.cantidad);
                        const p = Number(x.precio);
                        porCarton.textContent = n > 0 && p > 0 ? `${colones(p / n)} por cartón` : "";
                    };
                    cant.addEventListener("input", () => { x.cantidad = cant.value; ver(); revisarCombos(); });
                    cant.addEventListener("change", pintarCombos);
                    precio.addEventListener("input", () => { x.precio = precio.value; ver(); revisarCombos(); });
                    ver();
                    return el("div", { class: "bn-combo-row" },
                        el("label", {}, el("span", { class: "bn-label", text: "Cartones" }), cant),
                        el("label", {}, el("span", { class: "bn-label", text: "Precio (₡)" }), precio),
                        porCarton,
                        combos.length > 1 ? el("button", { class: "bn-btn bn-btn--sm bn-btn--danger", "aria-label": "Quitar combo", onclick: () => { combos.splice(i, 1); pintarCombos(); }, text: "Quitar" }) : el("span", {})
                    );
                }));
                revisarCombos();
            }
            const addCombo = el("button", { class: "bn-btn bn-btn--sm", text: "+ Agregar combo" });
            addCombo.addEventListener("click", () => {
                const max = combos.reduce((m, x) => Math.max(m, Number(x.cantidad) || 0), 0);
                combos.push({ cantidad: max ? max + (max < 5 ? 1 : 5) : 1, precio: "" });
                pintarCombos();
            });
            /* Bingos anteriores traen la tabla 1–20: deja solo los combos que cambian el precio. */
            const simplificar = el("button", { class: "bn-btn bn-btn--sm bn-btn--ghost", text: "Quitar combos que no cambian el precio" });
            simplificar.addEventListener("click", () => {
                let lista = combosValidos();
                const antes = lista.length;
                lista.slice().sort((a, z) => z.cantidad - a.cantidad).forEach((x) => {
                    if (x.cantidad === 1) return;
                    const otros = lista.filter((y) => y !== x);
                    const q = cotizar(otros, 0, x.cantidad);
                    if (q && q.total <= x.precio) lista = otros;
                });
                combos = lista;
                pintarCombos();
                showMessage(antes === lista.length ? "Todos los combos cambian el precio." : `Se quitaron ${antes - lista.length} combos sin efecto. Guarda para confirmar.`, "info", 6000);
            });
            pintarCombos();

            /* ----- Mensajes: correo con vista tipo bandeja de entrada y WhatsApp con vista de chat ----- */
            const ejemplo = {
                nombre: "María", bingo: c.nombre || "Bingo", fecha: fechaLarga(c.fecha, c.hora) || "15 de nov de 2026 a las 19:00", lugar: c.lugar || "Salón comunal",
                cantidad: 3, monto: colones(precioLocal(S.data.precios, c.precio_unitario, 3)), cartones: [12, 13, 14].map((x) => C.serieTexto(x)).join(", "),
                link: `${baseUrl()}#bj/${S.data.bingo.public_id}.ejemplo`
            };
            const VARIABLES = [["nombre", "Nombre"], ["bingo", "Bingo"], ["fecha", "Fecha y hora"], ["lugar", "Lugar"], ["cantidad", "Cantidad"], ["monto", "Monto"], ["cartones", "Series"], ["link", "Link de cartones"]];
            const correo = editorCorreo(c.plantilla_email_asunto, c.plantilla_email, ejemplo, VARIABLES, c.nombre || "Bingo");
            const whatsapp = editorWhatsApp(c.plantilla_whatsapp, ejemplo, VARIABLES, c.nombre || "Bingo");

            const guardar = el("button", { class: "bn-btn bn-btn--primary", text: "Guardar ajustes" });
            guardar.addEventListener("click", () => conBoton(guardar, async () => {
                const rev = revisarCombos();
                const lista = combosValidos();
                if (!lista.some((x) => x.cantidad === 1)) throw new Error("Agrega el combo de 1 cartón antes de guardar.");
                if (rev.avisos.length && !rev.fallas.length) throw new Error(rev.avisos[0]);
                if (rev.fallas.length && !(await confirmar("Precios sin escalonado", `En ${rev.fallas.length} ${rev.fallas.length === 1 ? "cantidad" : "cantidades"} comprar un cartón más no cuesta más (por ejemplo ${rev.fallas[0].n - 1} y ${rev.fallas[0].n} cartones). ¿Guardar así de todos modos?`, "Guardar así"))) return;
                const mail = correo.valor();
                const config = {
                    ...Object.fromEntries(Object.entries(f).map(([k, x]) => [k, x.value])),
                    plantilla_whatsapp: whatsapp.valor(),
                    plantilla_email_asunto: sinEmojis(mail.asunto),
                    plantilla_email: sinEmojis(mail.cuerpo)
                };
                const completo = config.nombre && config.fecha && config.sinpe_numero && lista.some((x) => x.cantidad === 1);
                if (completo) config.setup_done = "true";
                const res = await llamar({ action: "update_config", hash, config });
                const pr = await llamar({ action: "save_precios", hash, precios: lista });
                S.data.config = pr.config || res.config;
                S.data.precios = pr.precios;
                pintarCabecera();
                if (tieneEmojis(mail.asunto) || tieneEmojis(mail.cuerpo)) correo.limpiar();
                showMessage(completo ? "Ajustes guardados." : "Guardado. Faltan datos: nombre, fecha, SINPE y el combo de 1 cartón.", completo ? "success" : "info", 6000);
            }, "Guardando…"));

            agregar(root,
                faltaConfigurar() ? el("div", { class: "bn-banner" }, el("p", { text: "Primera vez: completa nombre, fecha, SINPE y el combo de 1 cartón. Con eso ya puedes compartir el link de compra." })) : null,
                el("section", { class: "bn-card" }, el("h2", { text: "Datos del bingo" }), el("div", { class: "bn-form-grid" },
                    campo("Nombre (sale en el cartón si no subes arte)", f.nombre), campo("Fecha", f.fecha), campo("Hora", f.hora), campo("Lugar", f.lugar), campo("Modalidad", f.modalidad), campo("WhatsApp del organizador", f.whatsapp), fechaVista)),
                el("section", { class: "bn-card" },
                    el("h2", { text: "Juego y BINGO" }),
                    el("p", { class: "bn-note", text: "Define cómo marcan los jugadores, qué ve el cantador y de dónde salen las bolas." }),
                    el("div", { class: "bn-stack" },
                        el("div", {}, el("span", { class: "bn-label", text: "Marcado y ganadores" }), f.marcado),
                        el("div", {}, el("span", { class: "bn-label", text: "Bolas" }), f.sorteo),
                        el("div", { class: "bn-form-grid" }, campo("Dígitos de la serie", f.digitos), avisoDigitos))),
                el("section", { class: "bn-card" }, el("h2", { text: "Pagos" }), el("div", { class: "bn-form-grid" },
                    campo("SINPE Móvil", f.sinpe_numero), campo("A nombre de", f.sinpe_nombre), campo("IBAN (opcional)", f.iban))),
                el("section", { class: "bn-card" },
                    el("h2", { text: "Precios por combos" }),
                    el("p", { class: "bn-note", text: "Cada combo es una cantidad de cartones con su precio. El sistema arma solo el total de cualquier cantidad con la combinación más barata (ejemplo: con combos de 1 y de 10, 21 cartones = 2 combos de 10 + 1 cartón). Así no hay límite de cartones por compra." }),
                    filasCombos,
                    el("div", { class: "bn-btnrow" }, addCombo, combos.length > 4 ? simplificar : null),
                    avisoCombos,
                    el("div", { class: "bn-calc" }, campo("Calcular el total de", calcN), calcRes),
                    el("details", { class: "bn-details" }, el("summary", { text: "Ver la tabla automática" }), el("p", { class: "bn-note", text: "Las cantidades en rojo cuestan lo mismo o menos que la anterior. Pasa el cursor para ver cómo se arma cada total." }), tablaAuto),
                    campo("Tamaño del lote", f.lote, "Cuántos cartones se habilitan cada vez.")
                ),
                el("section", { class: "bn-card" },
                    el("h2", { text: "Mensaje de WhatsApp" }),
                    el("p", { class: "bn-note", text: "Se abre listo para enviar al comprador. Puedes usar emojis y *negrita*." }),
                    whatsapp.el
                ),
                el("section", { class: "bn-card" },
                    el("h2", { text: "Correo" }),
                    el("p", { class: "bn-note", text: "Se envía desde tu cuenta de Google al aprobar una compra con correo. Evita emojis: muchos lectores de correo los muestran como cuadros, por eso se quitan al guardar." }),
                    correo.el
                ),
                el("div", { class: "bn-toolbar bn-toolbar--end bn-sticky-save" }, guardar)
            );
        }

        poner(app, 
            el("div", { class: `bn-panel${TABS.length === 1 ? " bn-panel--single" : ""}` },
                el("header", { class: "bn-panel-head" }, el("div", {}, el("p", { class: "bn-eyebrow", text: rol === "cantador" ? "Cantador" : "Bingo Digital · organizador" }), titulo, sub)),
                TABS.length > 1 ? nav : null,
                cuerpo
            )
        );
        pintarCabecera();
        ir(faltaConfigurar() && S.tab === "resumen" ? "resumen" : S.tab);
    }

    function contarSeries(texto) {
        const vistos = new Set();
        String(texto || "").split(/[,\s;]+/).forEach((p) => {
            const m = p.match(/^(\d+)-(\d+)$/);
            if (m) {
                const a = Math.min(+m[1], +m[2]);
                const z = Math.max(+m[1], +m[2]);
                for (let i = a; i <= z && i - a <= 2000; i++) vistos.add(i);
            } else if (/^\d+$/.test(p)) vistos.add(+p);
        });
        return vistos.size;
    }

    const correoValido = (t) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(t || "").trim());

    /**
     * Formulario de venta de un vendedor (organizador o encargado de sector).
     * Se llena como una compra: comprador, correo, cartones (series impresas o asignados por el sistema),
     * pago y comprobante. Devuelve { el, limpiar }.
     * sectores: lista para elegir sector y encargado (solo el organizador). bloque: [desde, hasta] del sector.
     */
    function formularioVenta({ sectores, bloque, cotizar: cot, enviar, alTerminar, botonTexto }) {
        const nombre = input(null, "", { placeholder: "Nombre y apellido", autocomplete: "off" });
        const correo = input(null, "", { type: "email", placeholder: "correo@gmail.com", autocomplete: "off" });
        const tel = input(null, "", { type: "tel", placeholder: "8888 8888", autocomplete: "off" });
        const modalidad = select(null, [["Presencial", "Juega en el salón"], ["Virtual", "Juega en línea"]], "Presencial");
        const entrega = select(null, [
            ["series", "Impresos: anoto las series"],
            ["asignar", bloque && bloque[0] ? "Asignar de mi bloque" : "Asignar cartones libres"]
        ], "series");
        const series = input(null, "", { placeholder: bloque && bloque[0] ? `Ej. ${bloque[0]}, ${bloque[0] + 1} o ${bloque[0]}-${bloque[0] + 4}` : "Ej. 120, 121 o 120-124" });
        const cantidad = input(null, "1", { type: "number", min: 1, max: 1000, inputmode: "numeric" });
        const monto = input(null, "", { type: "number", min: 0 });
        const metodo = select(null, [["Efectivo", "Efectivo"], ["SINPE", "SINPE Móvil"], ["Transferencia", "Transferencia"]], "Efectivo");
        const comprobante = el("input", { type: "file", class: "bn-file", accept: "image/*,application/pdf" });
        const notaComp = el("small", { class: "bn-note" });
        const resumen = el("p", { class: "bn-sale-sum" });
        const sector = sectores && sectores.length ? select(null, [["0", "Sin sector"], ...sectores.map((s) => [s.sector_id, `${s.nombre}${s.desde && s.hasta ? ` (${s.desde}–${s.hasta})` : ""}`])], "0") : null;
        const encargado = sector ? select(null, [["0", "—"]], "0") : null;
        const campoSeries = campo("Series entregadas", series, bloque && bloque[0] ? `Tu bloque: ${bloque[0]}–${bloque[1]}. Separa con comas; usa guion para rangos.` : "Separa con comas; usa guion para rangos.");
        const campoCantidad = campo("Cantidad de cartones", cantidad);
        const campoEnc = encargado ? campo("Encargado que vendió", encargado) : null;

        function pintarEncargados() {
            if (!sector) return;
            const s = sectores.find((x) => String(x.sector_id) === sector.value);
            const lista = s ? s.encargados || [] : [];
            poner(encargado, ...[["0", lista.length ? "Sin encargado" : "—"], ...lista.map((x) => [x.id, x.nombre])].map(([v, t]) => el("option", { value: v, text: t })));
            campoEnc.hidden = !lista.length;
        }

        function actualizar() {
            const n = entrega.value === "series" ? contarSeries(series.value) : Math.max(0, Math.floor(Number(cantidad.value) || 0));
            const q = n ? cot(n) : null;
            campoSeries.hidden = entrega.value !== "series";
            campoCantidad.hidden = entrega.value === "series";
            poner(resumen, n && q ? el("span", {}, el("b", { text: `${n} ${n === 1 ? "cartón" : "cartones"} · ${colones(q.total)}` }), q.partes.length > 1 || (q.partes[0] && q.partes[0].cantidad > 1) ? ` (${desgloseTexto(q)})` : "") : "");
            monto.placeholder = q ? String(q.total) : "";
            notaComp.textContent = metodo.value === "Efectivo" ? "Opcional en efectivo (por ejemplo una foto del recibo)." : `Obligatorio para ${metodo.value === "SINPE" ? "SINPE Móvil" : "transferencia"}.`;
        }
        [series, cantidad].forEach((x) => x.addEventListener("input", actualizar));
        [entrega, metodo].forEach((x) => x.addEventListener("change", actualizar));
        if (sector) {
            sector.addEventListener("change", pintarEncargados);
            pintarEncargados();
        }
        actualizar();

        const ok = el("button", { class: "bn-btn bn-btn--primary", text: botonTexto || "Registrar venta" });
        ok.addEventListener("click", async () => {
            const r = await conBoton(ok, async () => {
                if (!nombre.value.trim()) throw new Error("Escribe el nombre del comprador.");
                if (!correoValido(correo.value)) throw new Error("Escribe el correo del comprador: con él se juntan todos sus cartones en un solo link.");
                const file = comprobante.files && comprobante.files[0];
                if (metodo.value !== "Efectivo" && !file) throw new Error("Adjunta el comprobante del pago.");
                if (file && file.size > 12 * 1024 * 1024) throw new Error("El comprobante pesa más de 12 MB.");
                const datos = {
                    nombre: nombre.value, correo: correo.value.trim(), telefono: tel.value, modalidad: modalidad.value,
                    series: entrega.value === "series" ? series.value : "", cantidad: entrega.value === "series" ? "" : cantidad.value,
                    monto: monto.value, metodo: metodo.value, comprobante: file ? await archivoADataUrl(file, 1600) : "",
                    sector_id: sector ? sector.value : 0, encargado_id: encargado ? encargado.value : 0
                };
                return enviar(datos);
            }, "Guardando…");
            if (r && r.entrada) {
                showMessage(`Venta registrada: cartones ${r.entrada.cartones.split(",").map((x) => C.serieTexto(x)).join(", ")}.`, "success", 6000);
                alTerminar(r.entrada);
            }
        });

        function limpiar() {
            [nombre, correo, tel, series, monto].forEach((x) => { x.value = ""; });
            cantidad.value = "1";
            comprobante.value = "";
            actualizar();
        }

        return {
            el: el("div", { class: "bn-stack bn-sale-form" },
                el("div", { class: "bn-form-grid" },
                    campo("Comprador", nombre), campo("Correo", correo, "Identifica al jugador: todas sus compras quedan en un solo link."), campo("WhatsApp", tel), campo("¿Cómo va a jugar?", modalidad)),
                el("div", { class: "bn-form-grid" }, campo("Cartones", entrega), campoSeries, campoCantidad),
                resumen,
                el("div", { class: "bn-form-grid" },
                    campo("Monto cobrado (₡)", monto, "Vacío = precio de los combos."), campo("Forma de pago", metodo),
                    el("label", { class: "bn-field" }, el("span", { class: "bn-label", text: "Comprobante (foto o PDF)" }), comprobante, notaComp),
                    sector ? campo("Sector", sector) : null, campoEnc),
                ok
            ),
            boton: ok,
            limpiar
        };
    }

    /** El formulario de venta dentro de una ventana (panel del organizador). */
    function modalVenta(titulo, opciones) {
        let cerrarModal = null;
        const form = formularioVenta({
            ...opciones,
            alTerminar: (entrada) => {
                if (cerrarModal) cerrarModal();
                opciones.alTerminar(entrada);
            }
        });
        form.boton.remove();
        cerrarModal = modal(titulo, form.el, (cerrar) => [el("button", { class: "bn-btn", onclick: cerrar, text: "Cancelar" }), form.boton]);
    }

    /* ================= Link de sector o de encargado (#bv/) ================= */

    async function initSector(hash) {
        cargando("Abriendo tu sector…");
        let D;
        try {
            D = await llamar({ action: "sector_resolve", hash });
        } catch (e) {
            return pantallaError(e.message);
        }
        const s = D.sector;
        const cfg = D.config;
        const lista = el("div", { class: "bn-entries" });
        const tiles = el("div", { class: "bn-tiles" });
        const conBloque = Boolean(s.desde && s.hasta);

        function pintar() {
            const propias = D.entradas.filter((e) => e.estado !== "Rechazada");
            const monto = propias.reduce((a, e) => a + e.monto, 0);
            const cartones = propias.reduce((a, e) => a + e.cantidad, 0);
            poner(tiles, 
                tile(String(cartones), D.encargado ? "cartones que vendiste" : "cartones vendidos", `${propias.length} ${propias.length === 1 ? "venta" : "ventas"}`),
                tile(colones(monto), D.encargado ? "tus ventas" : "vendido por el sector"),
                conBloque ? tile(`${D.vendidos.length} / ${s.hasta - s.desde + 1}`, "bloque del sector", `series ${s.desde}–${s.hasta}`) : null,
                D.encargado ? tile(colones(D.sector_monto || 0), "total del sector", "todos los encargados") : null
            );
            if (!D.entradas.length) {
                poner(lista, el("p", { class: "bn-empty", text: "Todavía no hay ventas. Registra la primera con el formulario de arriba." }));
                return;
            }
            poner(lista, ...D.entradas.map((e) => {
                const linkJ = e.token ? links.jugador(e.token) : "";
                const vars = varsMensaje(cfg, e, linkJ);
                const wa = e.telefono && linkJ ? el("a", { class: `bn-btn bn-btn--sm${e.wa_enviado ? " is-done" : " bn-btn--primary"}`, href: waUrl(e.telefono, render(D.plantilla_whatsapp, vars)), target: "_blank", rel: "noopener", text: e.wa_enviado ? "WhatsApp ✓" : "Enviar por WhatsApp" }) : null;
                if (wa) wa.addEventListener("click", () => { if (!e.wa_enviado) llamar({ action: "sector_mark_sent", hash, entrada_id: e.entrada_id, canal: "wa" }).then(() => { e.wa_enviado = true; pintar(); }).catch(() => {}); });
                const ver = e.tiene_comprobante ? el("button", { class: "bn-btn bn-btn--sm", text: "Ver comprobante" }) : null;
                if (ver) ver.addEventListener("click", () => conBoton(ver, async () => verComprobante(await llamar({ action: "sector_comprobante", hash, entrada_id: e.entrada_id }, { timeoutMs: 60000 }), e), "Abriendo…"));
                return el("article", { class: "bn-entry" },
                    el("header", {}, el("div", {}, el("b", { text: e.nombre }), el("small", { class: "bn-note bn-block", text: `${fechaHoraTexto(e.fecha)} · ${e.estado}${!D.encargado && e.vendedor ? " · " + e.vendedor : ""}` })), el("div", { class: "bn-entry-amount" }, el("b", { text: colones(e.monto) }), el("small", { text: `${e.cantidad} ${e.cantidad === 1 ? "cartón" : "cartones"} · ${e.metodo}` }))),
                    el("dl", { class: "bn-dl" },
                        e.correo ? [el("dt", { text: "Correo" }), el("dd", { text: e.correo })] : null,
                        e.cartones ? [el("dt", { text: "Cartones" }), el("dd", { class: "bn-mono", text: e.cartones.split(",").map((x) => C.serieTexto(x)).join(", ") })] : null),
                    el("div", { class: "bn-btnrow" }, linkJ ? el("button", { class: "bn-btn bn-btn--sm", onclick: () => copiar(linkJ, "Link copiado."), text: "Copiar link" }) : null, wa, ver)
                );
            }));
        }

        const form = formularioVenta({
            bloque: conBloque ? [s.desde, s.hasta] : null,
            cotizar: (n) => cotizar(D.precios, D.precio_unitario, n),
            enviar: (datos) => llamar({ action: "sector_vender", hash, ...datos }, { timeoutMs: 90000 }),
            alTerminar: (entrada) => {
                D.entradas.unshift(entrada);
                entrada.cartones.split(",").forEach((x) => D.vendidos.push(Number(x)));
                D.sector_monto = (D.sector_monto || 0) + entrada.monto;
                form.limpiar();
                pintar();
            }
        });

        const imagenes = cargadorArte(cfg.public_id);
        poner(app, 
            el("div", { class: "bn-panel bn-panel--single" },
                el("header", { class: "bn-panel-head" }, el("div", {},
                    el("p", { class: "bn-eyebrow", text: `Sector ${s.nombre}${s.encargado ? " · " + s.encargado : ""}` }),
                    el("h1", { class: "bn-title bn-title--panel", text: cfg.nombre }),
                    el("p", { class: "bn-sub", text: cuando(cfg) }))),
                el("main", { class: "bn-panel-body" },
                    tiles,
                    el("section", { class: "bn-card" },
                        el("h2", { text: "Registrar una venta" }),
                        D.sinpe_numero ? el("p", { class: "bn-note" }, "SINPE del bingo: ", el("b", { class: "bn-mono", text: D.sinpe_numero }), D.sinpe_nombre ? ` · ${D.sinpe_nombre}` : "") : null,
                        form.el
                    ),
                    el("section", { class: "bn-card" }, el("h2", { text: D.encargado ? "Mis ventas" : "Ventas del sector" }), lista),
                    conBloque ? el("details", { class: "bn-card" }, el("summary", { text: "Imprimir los cartones de mi bloque" }),
                        panelImprimir({ seed: cfg.seed, pub: cfg.public_id, cfg, min: s.desde, max: s.hasta, sugerido: [s.desde, Math.min(s.hasta, s.desde + 99)], obtenerArte: imagenes })) : null
                )
            )
        );
        pintar();
    }

    function verComprobante(r, e) {
        modal(`Comprobante de ${e.nombre}`, /pdf/.test(r.tipo)
            ? el("p", {}, "Es un PDF. ", el("button", { class: "bn-btn bn-btn--sm", onclick: () => fetch(r.dataUrl).then((x) => x.blob()).then((bl) => descargarBlob(bl, `comprobante-${e.entrada_id}.pdf`)), text: "Descargar" }))
            : el("img", { class: "bn-proof", src: r.dataUrl, alt: "Comprobante de pago" }));
    }

    /* ================= Compra pública (#bc/) ================= */

    async function initCompra(pub) {
        cargando("Abriendo la compra de cartones…");
        let D;
        try {
            D = await llamar({ action: "get_compra", pub });
        } catch (e) {
            return pantallaError(e.message);
        }
        const cfg = D.config;
        const nombre = input("bn-c-nombre", "", { autocomplete: "name", placeholder: "Nombre y apellido" });
        const tel = input("bn-c-tel", "", { type: "tel", autocomplete: "tel", placeholder: "8888 8888" });
        const correo = input("bn-c-correo", "", { type: "email", autocomplete: "email", placeholder: "tucorreo@gmail.com" });
        const cantidad = input("bn-c-cantidad", "1", { type: "number", min: 1, max: 1000, inputmode: "numeric" });
        const modalidad = cfg.modalidad === "Mixta" ? select("bn-c-modalidad", [["Virtual", "Juego en línea"], ["Presencial", "Llego al salón"]], "Virtual") : null;
        /* Un encargado por opción («sector:encargado»), para que la venta cuente para quien vendió. */
        const opcionesVendedor = D.sectores.flatMap((x) => ((x.encargados || []).length
            ? x.encargados.map((e) => [`${x.sector_id}:${e.id}`, `${e.nombre} (${x.nombre})`])
            : [[`${x.sector_id}:0`, x.encargado ? `${x.encargado} (${x.nombre})` : x.nombre]]));
        const sector = D.sectores.length ? select("bn-c-sector", [["0:0", "Nadie en especial"], ...opcionesVendedor], "0:0") : null;
        const vendedor = D.sectores.length ? null : input("bn-c-vendedor", "", { placeholder: "Opcional" });
        const metodo = select("bn-c-metodo", [["SINPE", "SINPE Móvil"], ...(D.iban ? [["Transferencia", "Transferencia"]] : [])], "SINPE");
        const comprobante = el("input", { type: "file", id: "bn-c-comp", class: "bn-file", accept: "image/*,application/pdf" });
        const total = el("strong", { class: "bn-total" });
        const desglose = el("small", { class: "bn-note bn-block" });
        const combos = (D.precios || []).filter((x) => x.cantidad > 1);
        const actualizar = () => {
            const n = Math.max(1, Math.min(1000, Math.floor(Number(cantidad.value) || 1)));
            const q = cotizar(D.precios, D.precio_unitario, n);
            total.textContent = colones(q ? q.total : 0);
            desglose.textContent = q && (q.partes.length > 1 || (q.partes[0] && q.partes[0].cantidad > 1)) ? desgloseTexto(q) : "";
        };
        cantidad.addEventListener("input", actualizar);
        actualizar();

        const pago = el("div", { class: "bn-pay" },
            D.sinpe_numero ? el("div", {}, el("span", { class: "bn-label", text: "SINPE Móvil" }), el("b", { class: "bn-mono", text: D.sinpe_numero }), D.sinpe_nombre ? el("small", { text: D.sinpe_nombre }) : null, el("button", { class: "bn-btn bn-btn--sm", onclick: () => copiar(D.sinpe_numero.replace(/\s/g, ""), "Número copiado."), text: "Copiar" })) : null,
            D.iban ? el("div", {}, el("span", { class: "bn-label", text: "IBAN" }), el("b", { class: "bn-mono", text: D.iban }), el("button", { class: "bn-btn bn-btn--sm", onclick: () => copiar(D.iban.replace(/\s/g, ""), "IBAN copiado."), text: "Copiar" })) : null
        );

        const enviar = el("button", { class: "bn-btn bn-btn--primary bn-btn--xl", text: "Enviar compra" });
        enviar.addEventListener("click", () => conBoton(enviar, async () => {
            if (!correoValido(correo.value)) throw new Error("Escribe tu correo: con él se juntan todos tus cartones en un solo link.");
            const f = comprobante.files && comprobante.files[0];
            if (!f) throw new Error("Adjunta la foto o PDF del comprobante de pago.");
            if (f.size > 12 * 1024 * 1024) throw new Error("El comprobante pesa más de 12 MB.");
            const dataUrl = await archivoADataUrl(f, 1600);
            const r = await llamar({
                action: "submit_compra", pub, nombre: nombre.value, telefono: tel.value, correo: correo.value.trim(), cantidad: cantidad.value,
                modalidad: modalidad ? modalidad.value : cfg.modalidad === "Presencial" ? "Presencial" : "Virtual",
                sector_id: sector ? sector.value.split(":")[0] : 0, encargado_id: sector ? sector.value.split(":")[1] : 0,
                vendedor: vendedor ? vendedor.value : "", metodo: metodo.value, comprobante: dataUrl
            }, { timeoutMs: 90000 });
            poner(app, el("div", { class: "bn-done" },
                el("div", { class: "bn-balls-row", "aria-hidden": "true" }, C.LETRAS.map((l, i) => bolaEl(i * 15 + 7))),
                el("h1", { class: "bn-title", text: "¡Recibimos tu compra!" }),
                el("p", { text: `Compra #${r.entrada_id}: ${r.cantidad} ${r.cantidad === 1 ? "cartón" : "cartones"} por ${colones(r.monto)}.` }),
                el("p", { text: "Cuando el organizador confirme tu pago, te llega por WhatsApp o correo el link con tus cartones para jugar en línea. Si ya habías comprado con este correo, los cartones nuevos se suman a tu mismo link." }),
                cfg.whatsapp ? el("a", { class: "bn-btn", href: waUrl(cfg.whatsapp, `Hola, envié la compra #${r.entrada_id} para ${cfg.nombre}.`), target: "_blank", rel: "noopener", text: "Escribir al organizador" }) : null
            ));
        }, "Enviando…"));

        poner(app, 
            el("div", { class: "bn-buy" },
                el("header", { class: "bn-buy-head" },
                    el("div", { class: "bn-balls-row", "aria-hidden": "true" }, C.LETRAS.map((l, i) => bolaEl([7, 22, 38, 51, 69][i]))),
                    el("h1", { class: "bn-title", text: cfg.nombre }),
                    el("p", { class: "bn-sub", text: cuando(cfg) })
                ),
                el("section", { class: "bn-card" }, el("h2", { text: "1. Tus datos" }), el("div", { class: "bn-form-grid" },
                    campo("Nombre", nombre), campo("WhatsApp", tel, "Aquí te enviamos el link de tus cartones."),
                    campo("Correo", correo, "Es tu identificación: todas tus compras quedan en un solo link."), modalidad ? campo("¿Cómo vas a jugar?", modalidad) : null,
                    sector ? campo("¿Quién te vendió?", sector) : campo("¿Quién te vendió?", vendedor))),
                el("section", { class: "bn-card" }, el("h2", { text: "2. Cartones" }),
                    combos.length ? el("div", { class: "bn-combo-chips" }, combos.map((x) => el("span", { class: "bn-chip", text: `${x.cantidad} por ${colones(x.precio)}` }))) : null,
                    el("div", { class: "bn-buy-qty" }, campo("Cantidad", cantidad), el("div", {}, el("span", { class: "bn-label", text: "Total a pagar" }), total, desglose))),
                el("section", { class: "bn-card" }, el("h2", { text: "3. Pago" }), pago, el("div", { class: "bn-form-grid" }, campo("Forma de pago", metodo), campo("Comprobante (foto o PDF)", comprobante))),
                enviar
            )
        );
    }

    /* ================= Jugador (#bj/) y cartón suelto (#bt/) ================= */

    async function initJugador(token) {
        cargando("Cargando tus cartones…");
        try {
            const d = await llamar({ action: "get_player", token });
            if (!d.cartones.length) return pantallaError("Esta compra todavía no tiene cartones asignados.");
            vistaJugador({ cfg: d.config, series: d.cartones, nombre: d.nombre, vivoInicial: d.vivo, token, compras: d.compras });
        } catch (e) {
            pantallaError(e.message);
        }
    }

    async function initCartonSuelto(ref) {
        cargando("Cargando el cartón…");
        const m = String(ref || "").match(/^(\w+)-(\d+)-(\w{4})$/);
        if (!m) return pantallaError("El link del cartón está incompleto.");
        try {
            const d = await llamar({ action: "get_card", pub: m[1] });
            const serie = Number(m[2]);
            if (C.codigo(d.config.seed, serie) !== m[3].toUpperCase()) return pantallaError("El código del cartón no coincide. Revisa el QR o el link.");
            vistaJugador({ cfg: d.config, series: [serie], nombre: "", vivoInicial: d.vivo, token: `${m[1]}-${serie}` });
        } catch (e) {
            pantallaError(e.message);
        }
    }

    /* ================= Entrada ================= */

    window.initBingoApp = async function initBingoApp(opts) {
        showMessage = (opts && opts.showMessage) || showMessage;
        app = document.getElementById("bingo-app");
        if (!app) return;
        if (vivoActual) {
            vivoActual.detener();
            vivoActual = null;
        }
        const gen = ++generacion;
        const ctx = (opts && opts.bingo) || { mode: "hub" };
        document.body.classList.toggle("cpm-bingo-standalone", ctx.mode !== "hub");
        if (!window.CPMBingoApi || !window.CPMBingoApi.gasUrl()) {
            return pantallaError("Falta configurar el Web App del Bingo (window.CPM_BINGO_GAS_URL en index.html).");
        }
        if (gen !== generacion) return;
        if (ctx.mode === "hub") return initHub();
        if (ctx.mode === "admin") return initPanel(ctx.hash, "organizador");
        if (ctx.mode === "cantador") return initPanel(ctx.hash, "cantador");
        if (ctx.mode === "pantalla") return initPantalla(ctx.hash);
        if (ctx.mode === "sector") return initSector(ctx.hash);
        if (ctx.mode === "compra") return initCompra(ctx.hash);
        if (ctx.mode === "jugador") return initJugador(ctx.hash);
        if (ctx.mode === "carton") return initCartonSuelto(ctx.hash);
        return pantallaError("Link no reconocido.");
    };
})();
