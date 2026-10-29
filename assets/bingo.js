/**
 * Bingo Digital — hub (#bingo) y links por rol:
 *   #b/<hash>   organizador (todo su bingo)
 *   #bk/<hash>  cantador (solo el juego)
 *   #bv/<hash>  vendedor o encargado de sector
 *   #bc/<pub>   compra pública
 *   #bj/<token> jugador (todos los cartones de una compra)
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

    const colones = (n) => "₡" + Math.round(Number(n) || 0).toLocaleString("es-CR");

    function baseUrl() {
        return `${window.location.origin}${window.location.pathname}`;
    }

    const links = {
        organizador: (h) => `${baseUrl()}#b/${h}`,
        cantador: (h) => `${baseUrl()}#bk/${h}`,
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

    async function llamar(payload, opts) {
        const res = await window.CPMBingoApi.post(payload, opts);
        return res.data || {};
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
        app.replaceChildren(el("div", { class: "bn-empty bn-empty--error" }, el("h2", { text: "No se pudo abrir" }), el("p", { text: texto })));
    }

    function cargando(texto) {
        app.replaceChildren(el("div", { class: "bn-loading" }, el("div", { class: "bn-spinner" }), el("p", { text: texto || "Cargando…" })));
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
            subtitulo: [cfg.fecha, cfg.hora, cfg.lugar].filter(Boolean).join(" · ")
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
                    const firma = JSON.stringify([v.r, v.e, v.b, v.g, (v.h || []).length]);
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
                    ultimo = JSON.stringify([inicial.r, inicial.e, inicial.b, inicial.g, (inicial.h || []).length]);
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

    async function generarPdf({ seed, pub, cfg, desde, hasta, porHoja, arteDataUrl, progreso }) {
        await Promise.all([cargarScript(LIB_JSPDF), cargarScript(LIB_QR)]);
        await fuentesListas();
        const arte = await cargarImagen(arteDataUrl);
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
                qrTexto: links.carton(pub, seed, s)
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
                const arte = await obtenerArte();
                for (let ini = a; ini <= z; ini += 100) {
                    const fin = Math.min(z, ini + 99);
                    const blob = await generarPdf({
                        seed, pub, cfg, desde: ini, hasta: fin, porHoja: Number(porHoja.value), arteDataUrl: arte,
                        progreso: (n, total) => { estado.textContent = `Cartones ${ini}–${fin}: ${n} de ${total}…`; }
                    });
                    descargarBlob(blob, `cartones-${C.serieTexto(ini)}-${C.serieTexto(fin)}.pdf`);
                }
                estado.textContent = `Listo: cartones ${a}–${z}.`;
            }, "Generando…")
        );
        return el("div", { class: "bn-form-grid" }, campo("Desde la serie", desde), campo("Hasta la serie", hasta), campo("Cartones por hoja carta", porHoja), el("div", { class: "bn-field bn-field--end" }, btn), estado);
    }

    /* ================= Vista de cartones del jugador ================= */

    function vistaJugador({ cfg, series, nombre, vivoInicial, token }) {
        const seed = cfg.seed;
        const claveMarcas = `bn_marcas_${token || cfg.public_id}`;
        let manual = false;
        let marcasManuales = {};
        try {
            const g = JSON.parse(localStorage.getItem(claveMarcas) || "{}");
            manual = Boolean(g.manual);
            marcasManuales = g.marcas || {};
        } catch (e) {
            /* sin almacenamiento */
        }
        let vivo = vivoInicial || { e: "Espera", b: [] };
        let arte = null;
        const t = tituloCarton(cfg);
        const letras = cfg.letras_sistema !== false;

        const ultima = el("div", { class: "bn-live-last" });
        const previas = el("div", { class: "bn-live-prev" });
        const info = el("div", { class: "bn-live-info" });
        const reloj = el("small", { class: "bn-live-clock" });
        const barra = el("section", { class: "bn-live", "aria-live": "polite" }, ultima, el("div", { class: "bn-live-mid" }, info, previas, reloj));

        const toggle = el("button", { class: "bn-btn bn-btn--ghost", onclick: () => { manual = !manual; guardar(); pintarTodo(); } });
        const cards = el("div", { class: "bn-player-cards" });
        const ganadores = el("section", { class: "bn-card bn-winners", hidden: true });

        function guardar() {
            try {
                localStorage.setItem(claveMarcas, JSON.stringify({ manual, marcas: marcasManuales }));
            } catch (e) {
                /* sin almacenamiento */
            }
        }

        function marcasDe(serie) {
            const grid = C.carton(seed, serie);
            if (!manual) return C.marcadas(grid, vivo.b || []);
            const set = new Set(marcasManuales[`${vivo.r || 0}:${serie}`] || []);
            return grid.map((row) => row.map((n) => n === 0 || set.has(n)));
        }

        const lienzos = series.map((serie) => {
            const cv = el("canvas", { class: "bn-canvas", width: C.GEOMETRIA.W, height: C.GEOMETRIA.H, "aria-label": `Cartón serie ${serie}` });
            const faltan = el("span", { class: "bn-chip" });
            const descargar = el("button", { class: "bn-btn bn-btn--ghost bn-btn--sm", text: "Descargar imagen" });
            descargar.addEventListener("click", () =>
                conBoton(descargar, async () => {
                    await cargarScript(LIB_QR);
                    const r = cfg.arte_url ? await llamar({ action: "get_arte", pub: cfg.public_id }) : { dataUrl: "" };
                    const img = await cargarImagen(r.dataUrl);
                    const tmp = document.createElement("canvas");
                    C.dibujarCarton(tmp, { seed, serie, arte: img, titulo: t.titulo, subtitulo: t.subtitulo, letras, qrTexto: links.carton(cfg.public_id, seed, serie) });
                    descargarBlob(await canvasABlob(tmp, "image/jpeg", 0.92), `carton-${C.serieTexto(serie)}.jpg`);
                }, "Preparando…")
            );
            cv.addEventListener("click", (ev) => {
                if (!manual) return;
                const rect = cv.getBoundingClientRect();
                const pos = C.casillaEn(((ev.clientX - rect.left) / rect.width) * C.GEOMETRIA.W, ((ev.clientY - rect.top) / rect.height) * C.GEOMETRIA.H);
                if (!pos) return;
                const n = C.carton(seed, serie)[pos[0]][pos[1]];
                if (!n) return;
                const k = `${vivo.r || 0}:${serie}`;
                const set = new Set(marcasManuales[k] || []);
                if (set.has(n)) set.delete(n);
                else set.add(n);
                marcasManuales[k] = [...set];
                guardar();
                pintar(serie);
            });
            const wrap = el("figure", { class: "bn-player-card" }, cv, el("figcaption", {}, el("span", { text: `Serie ${C.serieTexto(serie)}` }), faltan, descargar));
            cards.appendChild(wrap);
            return { serie, cv, faltan };
        });

        function pintar(serie) {
            const l = lienzos.find((x) => x.serie === serie);
            if (!l) return;
            C.dibujarCarton(l.cv, { seed, serie, arte, titulo: t.titulo, subtitulo: t.subtitulo, letras, marcas: marcasDe(serie) });
            if (vivo.e === "En juego" && vivo.f) {
                const f = C.faltan(C.carton(seed, serie), vivo.b || [], vivo.f);
                l.faltan.textContent = f === 0 ? "¡Completaste la figura!" : `Te faltan ${f}`;
                l.faltan.className = `bn-chip${f === 0 ? " bn-chip--win" : f === 1 ? " bn-chip--hot" : ""}`;
                l.faltan.hidden = false;
            } else {
                l.faltan.hidden = true;
            }
        }

        function pintarTodo() {
            toggle.textContent = manual ? "Marcado: tocando la casilla" : "Marcado: automático";
            lienzos.forEach((l) => pintar(l.serie));
        }

        function pintarBarra() {
            const bolas = vivo.b || [];
            ultima.replaceChildren(bolas.length ? bolaEl(bolas[bolas.length - 1], true) : el("span", { class: "bn-ball bn-ball--big bn-ball--empty" }, el("b", { text: "–" })));
            previas.replaceChildren(...bolas.slice(-6, -1).reverse().map((n) => bolaEl(n)));
            const fig = vivo.f && C.FIGURAS[vivo.f] ? C.FIGURAS[vivo.f].nombre : "";
            info.replaceChildren(
                vivo.e === "En juego"
                    ? el("div", {}, el("span", { class: "bn-dot bn-dot--live" }), el("b", { text: ` ${vivo.n || "Ronda"}` }), el("span", { text: ` · ${fig}${vivo.p ? " · Premio: " + vivo.p : ""}` }), el("small", { text: ` · ${bolas.length} bolas` }))
                    : el("div", {}, el("span", { class: "bn-dot" }), el("span", { text: vivo.ultima ? ` Terminó ${vivo.ultima.n}. Espera la siguiente ronda.` : " El juego todavía no empieza." }))
            );
            const hist = vivo.h || [];
            ganadores.hidden = !hist.length && !(vivo.g || []).length;
            ganadores.replaceChildren(
                el("h3", { text: "Ganadores" }),
                el("ul", { class: "bn-list" },
                    (vivo.g || []).map((g) => el("li", {}, el("b", { text: `${vivo.n}: ` }), `Serie ${C.serieTexto(g.s)} · ${g.n || ""}`)),
                    hist.slice().reverse().map((r) => el("li", {}, el("b", { text: `${r.n}${r.p ? " (" + r.p + ")" : ""}: ` }), r.g.length ? r.g.map((g) => `Serie ${C.serieTexto(g.s)} · ${g.n || ""}`).join(" — ") : "sin ganador registrado"))
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

        app.replaceChildren(
            el("div", { class: "bn-player" },
                el("header", { class: "bn-player-head" },
                    el("div", {}, el("h1", { class: "bn-title", text: cfg.nombre || "Bingo" }), el("p", { class: "bn-sub", text: [cfg.fecha, cfg.hora, cfg.lugar].filter(Boolean).join(" · ") })),
                    nombre ? el("p", { class: "bn-hello", text: `Hola, ${nombre}. Tienes ${series.length} ${series.length === 1 ? "cartón" : "cartones"}.` }) : null
                ),
                barra,
                el("div", { class: "bn-player-tools" }, toggle, el("small", { class: "bn-note", text: "Cada número cantado se marca con una X roja." })),
                cards,
                ganadores
            )
        );

        (async () => {
            await fuentesListas();
            arte = await cargarImagen(cfg.arte_url);
            vivoCtrl.iniciar(vivo);
        })();
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
                lista.replaceChildren(el("p", { class: "bn-empty", text: "Escribe la llave maestra para ver los bingos." }));
                return;
            }
            lista.replaceChildren(el("p", { class: "bn-note", text: "Cargando bingos…" }));
            try {
                const d = await llamar({ action: "super_list", masterPin: pinInput.value.trim() });
                bingos = d.bingos || [];
                pintar();
            } catch (e) {
                lista.replaceChildren(el("p", { class: "bn-empty bn-empty--error", text: e.message }));
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
                lista.replaceChildren(el("p", { class: "bn-empty", text: verArchivados ? "No hay bingos archivados." : "Todavía no hay bingos activos. Crea el primero con «+ Nuevo bingo»." }));
                return;
            }
            lista.replaceChildren(
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
                                el("td", { text: b.created_at }),
                                el("td", { text: b.fecha_archivo || "Sin fecha" }),
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
                campo("Precio por cartón (₡)", precio, "Llena la tabla de 1 a 20 cartones; el cliente la ajusta."),
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

        app.replaceChildren(
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
            sub.textContent = [cfg.fecha, cfg.hora, cfg.lugar].filter(Boolean).join(" · ") || (rol === "cantador" ? "Link del cantador" : "Organizador");
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
            cuerpo.replaceChildren();
            vistas[tab](cuerpo);
            window.scrollTo(0, 0);
        }

        TABS.forEach(([k, label, icon]) => nav.appendChild(el("button", { dataset: { tab: k }, onclick: () => ir(k) }, el("span", { class: "bn-nav-icon", "aria-hidden": "true", text: icon }), el("span", { text: label }))));

        async function recargar() {
            S.data = await llamar({ action: "resolve_admin", hash });
            pintarCabecera();
        }

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
            const textoCompra = `¡Ya puedes comprar tus cartones para ${cfg.nombre}! ${cfg.fecha ? "Fecha: " + cfg.fecha + ". " : ""}Compra aquí: ${compraLink}`;
            agregar(root, 
                faltaConfigurar() ? el("div", { class: "bn-banner" }, el("p", { text: "Completa los datos del bingo (fecha, precio y SINPE) para empezar a vender." }), el("button", { class: "bn-btn bn-btn--primary", onclick: () => ir("ajustes"), text: "Completar datos" })) : null,
                el("div", { class: "bn-tiles" },
                    tile(r.cartones_vendidos.toLocaleString("es-CR"), "cartones vendidos", `de ${r.cartones_habilitados.toLocaleString("es-CR")} habilitados · máximo 10 000`),
                    tile(colones(r.recaudado), "recaudado", "compras aprobadas y completadas"),
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
                        el("div", {}, el("b", { text: "Vendedores por sector" }), el("small", { class: "bn-note bn-block", text: "Cada sector tiene su propio link en la pestaña Sectores." })),
                        el("div", { class: "bn-btnrow" }, el("button", { class: "bn-btn bn-btn--sm", onclick: () => ir("sectores"), text: "Ver sectores" }))
                    ),
                    b.folder_url && b.compartido_con ? el("div", { class: "bn-linkrow" },
                        el("div", {}, el("b", { text: "Carpeta en Google Drive" }), el("small", { class: "bn-note bn-block", text: `Compartida con ${b.compartido_con}.` })),
                        el("div", { class: "bn-btnrow" }, el("a", { class: "bn-btn bn-btn--sm", href: b.folder_url, target: "_blank", rel: "noopener", text: "Abrir" }))
                    ) : null
                ),
                (S.data.sectores || []).length ? el("section", { class: "bn-card" },
                    el("h2", { text: "Vendidos por sector" }),
                    el("ul", { class: "bn-bars" },
                        [{ sector_id: 0, nombre: "General (compras en línea)", desde: 0, hasta: 0 }, ...S.data.sectores].map((s) => {
                            const n = r.por_sector[s.sector_id] || 0;
                            const total = s.desde && s.hasta ? s.hasta - s.desde + 1 : 0;
                            return el("li", {}, el("span", { text: s.nombre }), el("b", { text: total ? `${n} / ${total}` : String(n) }),
                                total ? el("i", { style: `--p:${Math.min(100, (n / total) * 100)}%` }) : null);
                        })
                    )
                ) : null
            );
        }

        /* ---------- Ventas ---------- */
        async function vistaVentas(root) {
            const lista = el("div", { class: "bn-entries" });
            const buscador = input("bn-ventas-buscar", "", { type: "search", placeholder: "Buscar por nombre, teléfono o serie" });
            const subtabs = el("div", { class: "bn-tabs" });
            const ESTADOS = [["Pendiente", "Pendientes"], ["Aprobada", "Por enviar"], ["Completada", "Historial"], ["Rechazada", "Rechazadas"]];

            function pintarTabs() {
                subtabs.replaceChildren(...ESTADOS.map(([k, label]) => {
                    const n = (S.entradas || []).filter((e) => e.estado === k).length;
                    return el("button", { class: `bn-tab${S.ventasTab === k ? " is-active" : ""}`, onclick: () => { S.ventasTab = k; pintarTabs(); pintar(); } }, label, el("span", { class: "bn-count", text: n }));
                }));
            }

            async function cargar() {
                lista.replaceChildren(el("p", { class: "bn-note", text: "Cargando compras…" }));
                try {
                    S.entradas = (await llamar({ action: "list_entradas", hash })).entradas || [];
                    pintarTabs();
                    pintar();
                } catch (e) {
                    lista.replaceChildren(el("p", { class: "bn-empty bn-empty--error", text: e.message }));
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
                    lista.replaceChildren(el("p", { class: "bn-empty", text: q ? "Ninguna compra coincide con la búsqueda." : "No hay compras en esta lista." }));
                    return;
                }
                lista.replaceChildren(...items.map(tarjeta));
            }

            function tarjeta(e) {
                const sector = (S.data.sectores || []).find((s) => s.sector_id === e.sector_id);
                const cfg = S.data.config;
                const linkJ = e.token ? links.jugador(e.token) : "";
                const vars = { nombre: e.nombre.split(" ")[0], bingo: cfg.nombre, fecha: cfg.fecha, cantidad: e.cantidad, monto: colones(e.monto), cartones: e.cartones.split(",").join(", "), link: linkJ };
                const acciones = el("div", { class: "bn-btnrow" });
                if (e.estado === "Pendiente") {
                    if (e.tiene_comprobante) {
                        const ver = el("button", { class: "bn-btn bn-btn--sm", text: "Ver comprobante" });
                        ver.addEventListener("click", () => conBoton(ver, async () => {
                            const r = await llamar({ action: "get_comprobante", hash, entrada_id: e.entrada_id }, { timeoutMs: 60000 });
                            modal(`Comprobante de ${e.nombre}`, /pdf/.test(r.tipo)
                                ? el("p", {}, "Es un PDF. ", el("button", { class: "bn-btn bn-btn--sm", onclick: () => fetch(r.dataUrl).then((x) => x.blob()).then((bl) => descargarBlob(bl, `comprobante-${e.entrada_id}.pdf`)), text: "Descargar" }))
                                : el("img", { class: "bn-proof", src: r.dataUrl, alt: "Comprobante de pago" }));
                        }, "Abriendo…"));
                        acciones.append(ver);
                    }
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
                        el("div", {}, el("b", { text: e.nombre }), el("small", { class: "bn-note bn-block", text: `#${e.entrada_id} · ${e.fecha} · ${e.modalidad}` })),
                        el("div", { class: "bn-entry-amount" }, el("b", { text: colones(e.monto) }), el("small", { text: `${e.cantidad} ${e.cantidad === 1 ? "cartón" : "cartones"}` }))
                    ),
                    el("dl", { class: "bn-dl" },
                        e.telefono ? [el("dt", { text: "WhatsApp" }), el("dd", { text: e.telefono })] : null,
                        e.correo ? [el("dt", { text: "Correo" }), el("dd", { text: e.correo })] : null,
                        e.vendedor || sector ? [el("dt", { text: "Vendedor" }), el("dd", { text: [e.vendedor, sector ? sector.nombre : ""].filter(Boolean).join(" · ") })] : null,
                        e.metodo ? [el("dt", { text: "Pago" }), el("dd", { text: e.metodo })] : null,
                        e.cartones ? [el("dt", { text: "Cartones" }), el("dd", { class: "bn-mono", text: e.cartones.split(",").join(", ") })] : null,
                        e.nota ? [el("dt", { text: "Nota" }), el("dd", { text: e.nota })] : null
                    ),
                    acciones
                );
            }

            const presencial = el("button", { class: "bn-btn bn-btn--primary", text: "+ Venta presencial" });
            presencial.addEventListener("click", () => formularioVenta({
                titulo: "Venta presencial",
                sectores: S.data.sectores || [],
                precio: (n) => precioLocal(S.data.precios, S.data.config.precio_unitario, n),
                enviar: (datos) => llamar({ action: "vender_presencial", hash, ...datos }),
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
            const preview = el("canvas", { class: "bn-canvas bn-canvas--preview", width: C.GEOMETRIA.W, height: C.GEOMETRIA.H });
            let arteCache = null;

            async function obtenerArte() {
                if (!S.data.arte_url) return "";
                if (arteCache) return arteCache;
                arteCache = (await llamar({ action: "get_arte", pub }, { timeoutMs: 60000 })).dataUrl || "";
                return arteCache;
            }

            async function pintarPreview(arteImg) {
                await fuentesListas();
                await cargarScript(LIB_QR).catch(() => {});
                const img = arteImg !== undefined ? arteImg : await cargarImagen(S.data.arte_url);
                const t = tituloCarton(cfg);
                const grid = C.carton(seed, 1);
                const ejemplo = [grid[0][0], grid[1][1], grid[3][3], grid[4][4], grid[0][4]];
                C.dibujarCarton(preview, { seed, serie: 1, arte: img, titulo: t.titulo, subtitulo: t.subtitulo, letras: cfg.letras_sistema !== "false", marcas: C.marcadas(grid, ejemplo), qrTexto: links.carton(pub, seed, 1) });
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
                    arteCache = null;
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
                arteCache = null;
                pintarPreview(null);
            }));

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
                const grid = C.carton(seed, s);
                const v = await llamar({ action: "list_cartones", hash });
                const venta = (v.vendidos || []).find((x) => x.serie === s);
                const cv = el("canvas", { class: "bn-canvas bn-canvas--mini" });
                const t = tituloCarton(cfg);
                C.dibujarCarton(cv, { seed, serie: s, arte: await cargarImagen(S.data.arte_url), titulo: t.titulo, subtitulo: t.subtitulo, letras: cfg.letras_sistema !== "false", qrTexto: links.carton(pub, seed, s) });
                resultado.replaceChildren(cv, el("div", { class: "bn-stack" },
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
                        S.data.arte_url ? el("div", { class: "bn-btnrow" }, quitarArte) : null
                    ),
                    el("div", { class: "bn-design-preview" }, preview, el("small", { class: "bn-note", text: "Vista previa: serie 00001 con 5 números marcados." }))
                ),
                el("section", { class: "bn-card" },
                    el("h2", { text: "Imprimir cartones" }),
                    el("p", { class: "bn-note", text: "El PDF se arma en este navegador; no se sube nada. Cada cartón lleva su QR al link en línea." }),
                    panelImprimir({ seed, pub, cfg: { ...cfg, letras_sistema: cfg.letras_sistema !== "false" }, min: 1, max: 10000, obtenerArte })
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
            let filas = (S.data.sectores || []).map((s) => ({ ...s }));
            const tabla = el("div", { class: "bn-sectors" });
            const cfg = S.data.config;

            function pintar() {
                if (!filas.length) {
                    tabla.replaceChildren(el("p", { class: "bn-empty", text: "Sin sectores. Agrega uno para darle a un grupo de vendedores su bloque de cartones y su link." }));
                    return;
                }
                tabla.replaceChildren(...filas.map((s, i) => {
                    const upd = (k) => (ev) => { s[k] = ev.target.type === "checkbox" ? ev.target.checked : ev.target.value; };
                    const vendidos = S.data.resumen.por_sector[s.sector_id] || 0;
                    const link = s.hash ? links.sector(s.hash) : "";
                    const texto = `Hola ${s.encargado || ""}, este es tu link de ventas para ${cfg.nombre} (sector ${s.nombre}, cartones ${s.desde}–${s.hasta}): ${link}`;
                    return el("article", { class: "bn-sector" },
                        el("div", { class: "bn-form-grid" },
                            campo("Sector", el("input", { class: "bn-input", value: s.nombre || "", oninput: upd("nombre") })),
                            campo("Encargado", el("input", { class: "bn-input", value: s.encargado || "", oninput: upd("encargado") })),
                            campo("WhatsApp", el("input", { class: "bn-input", value: s.telefono || "", oninput: upd("telefono") })),
                            campo("Desde la serie", el("input", { class: "bn-input", type: "number", min: 1, max: 10000, value: s.desde || "", oninput: upd("desde") })),
                            campo("Hasta la serie", el("input", { class: "bn-input", type: "number", min: 1, max: 10000, value: s.hasta || "", oninput: upd("hasta") })),
                            el("label", { class: "bn-check" }, (() => { const c = el("input", { type: "checkbox", onchange: upd("activo") }); c.checked = s.activo !== false; return c; })(), el("span", { text: "Link activo" }))
                        ),
                        el("div", { class: "bn-btnrow" },
                            s.sector_id ? el("span", { class: "bn-chip", text: `${vendidos} vendidos` }) : el("span", { class: "bn-chip", text: "Nuevo: guarda para crear su link" }),
                            link ? el("button", { class: "bn-btn bn-btn--sm", onclick: () => copiar(link, "Link del sector copiado."), text: "Copiar link" }) : null,
                            link && s.telefono ? el("a", { class: "bn-btn bn-btn--sm", href: waUrl(s.telefono, texto), target: "_blank", rel: "noopener", text: "Enviar por WhatsApp" }) : null,
                            !vendidos ? el("button", { class: "bn-btn bn-btn--sm bn-btn--danger", onclick: () => { filas.splice(i, 1); pintar(); }, text: "Quitar" }) : null
                        )
                    );
                }));
            }

            const agregar = el("button", { class: "bn-btn", text: "+ Agregar sector" });
            agregar.addEventListener("click", () => {
                const max = filas.reduce((m, s) => Math.max(m, Number(s.hasta) || 0), 0);
                filas.push({ sector_id: 0, nombre: `Sector ${filas.length + 1}`, encargado: "", telefono: "", desde: max + 1, hasta: max + 100, activo: true });
                pintar();
            });
            const guardar = el("button", { class: "bn-btn bn-btn--primary", text: "Guardar sectores" });
            guardar.addEventListener("click", () => conBoton(guardar, async () => {
                const d = await llamar({ action: "save_sectores", hash, sectores: filas });
                S.data.sectores = d.sectores;
                filas = d.sectores.map((s) => ({ ...s }));
                await recargar();
                pintar();
                showMessage("Sectores guardados.", "success");
            }, "Guardando…"));
            agregar(root, 
                el("section", { class: "bn-card" },
                    el("h2", { text: "Sectores y vendedores" }),
                    el("p", { class: "bn-note", text: "Cada sector recibe un bloque de series (para imprimir y vender en persona) y un link donde su encargado anota las ventas. Los rangos no pueden cruzarse; las compras en línea usan los cartones fuera de estos rangos." })
                ),
                tabla,
                el("div", { class: "bn-toolbar" }, agregar, guardar)
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
                cont.replaceChildren(el("p", { class: "bn-empty bn-empty--error", text: e.message }));
                return;
            }
            const seed = J.seed;
            let enCurso = false;

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

            function editorRonda(ronda) {
                const nombre = input("bn-ronda-nombre", ronda ? ronda.nombre : `Ronda ${J.rondas.length + 1}`);
                const figura = select("bn-ronda-figura", Object.entries(C.FIGURAS).map(([k, f]) => [k, f.nombre]), ronda ? ronda.figura : "linea");
                const premio = input("bn-ronda-premio", ronda ? ronda.premio : "", { placeholder: "₡50 000 o una pantalla de 50\"" });
                const muestra = el("div", { class: "bn-pattern" });
                const pintarMuestra = () => {
                    const alt = C.FIGURAS[figura.value].alternativas[0];
                    const set = new Set(alt.map(([f, c]) => `${f},${c}`));
                    muestra.replaceChildren(...Array.from({ length: 25 }, (_, i) => el("i", { class: set.has(`${Math.floor(i / 5)},${i % 5}`) ? "on" : "" })));
                };
                figura.addEventListener("change", pintarMuestra);
                pintarMuestra();
                modal(ronda ? "Editar ronda" : "Nueva ronda", el("div", { class: "bn-form-grid" }, campo("Nombre", nombre), campo("Figura", figura, "La muestra enseña una de las formas válidas."), muestra, campo("Premio", premio)), (cerrar) => {
                    const ok = el("button", { class: "bn-btn bn-btn--primary", text: "Guardar" });
                    ok.addEventListener("click", async () => {
                        const r = await accion(ok, { action: "game_save_ronda", ronda: { ronda_id: ronda ? ronda.ronda_id : 0, nombre: nombre.value, figura: figura.value, premio: premio.value } });
                        if (r) { cerrar(); pintar(); }
                    });
                    return [el("button", { class: "bn-btn", onclick: cerrar, text: "Cancelar" }), ok];
                });
            }

            function pintar() {
                const activa = rondaActiva();
                cont.replaceChildren(activa ? vistaRonda(activa) : vistaRondas());
            }

            function vistaRondas() {
                const pendientes = J.rondas.filter((r) => r.estado === "Pendiente");
                const terminadas = J.rondas.filter((r) => r.estado === "Terminada");
                return el("div", { class: "bn-stack" },
                    el("section", { class: "bn-card" },
                        el("div", { class: "bn-card-head" }, el("h2", { text: "Rondas" }), el("button", { class: "bn-btn bn-btn--primary", onclick: () => editorRonda(null), text: "+ Nueva ronda" })),
                        pendientes.length ? el("ul", { class: "bn-rounds" }, pendientes.map((r) => {
                            const abrir = el("button", { class: "bn-btn bn-btn--sm bn-btn--primary", text: "Empezar" });
                            abrir.addEventListener("click", async () => { if (await accion(abrir, { action: "game_abrir", ronda_id: r.ronda_id }, "Abriendo…")) pintar(); });
                            const borrar = el("button", { class: "bn-btn bn-btn--sm bn-btn--danger", text: "Borrar" });
                            borrar.addEventListener("click", async () => { if (await accion(borrar, { action: "game_delete_ronda", ronda_id: r.ronda_id })) pintar(); });
                            return el("li", {}, el("div", {}, el("b", { text: r.nombre }), el("small", { class: "bn-note bn-block", text: `${C.FIGURAS[r.figura].nombre}${r.premio ? " · " + r.premio : ""}` })),
                                el("div", { class: "bn-btnrow" }, el("button", { class: "bn-btn bn-btn--sm", onclick: () => editorRonda(r), text: "Editar" }), borrar, abrir));
                        })) : el("p", { class: "bn-empty", text: "Crea las rondas del bingo: cada una con su figura y su premio." })
                    ),
                    terminadas.length ? el("section", { class: "bn-card" },
                        el("h2", { text: "Rondas terminadas" }),
                        el("ul", { class: "bn-rounds" }, terminadas.map((r) => el("li", {},
                            el("div", {}, el("b", { text: r.nombre }), el("small", { class: "bn-note bn-block", text: `${C.FIGURAS[r.figura].nombre} · ${r.bolas.length} bolas${r.premio ? " · " + r.premio : ""}` })),
                            el("div", { class: "bn-note", text: r.ganadores.length ? r.ganadores.map((g) => `Serie ${C.serieTexto(g.serie)} ${g.nombre || ""}`).join(" · ") : "Sin ganador" })
                        )))
                    ) : null
                );
            }

            function vistaRonda(r) {
                const cantadas = new Set(r.bolas);
                const ultimaBola = r.bolas[r.bolas.length - 1];
                const manual = input("bn-bola-manual", "", { type: "number", min: 1, max: 75, placeholder: "1–75", inputmode: "numeric" });
                const sacar = el("button", { class: "bn-btn bn-btn--primary bn-btn--xl", text: "Sacar bola" });
                const cantarManual = el("button", { class: "bn-btn", text: "Cantar" });
                const deshacer = el("button", { class: "bn-btn bn-btn--sm", text: "Deshacer la última" });
                const cerrar = el("button", { class: "bn-btn bn-btn--danger", text: "Terminar ronda" });

                async function cantar(bola, btn) {
                    const res = await accion(btn, { action: "game_cantar", bola }, "Cantando…");
                    if (res) pintar();
                }
                sacar.addEventListener("click", () => {
                    const libres = [];
                    for (let n = 1; n <= 75; n++) if (!cantadas.has(n)) libres.push(n);
                    if (!libres.length) return showMessage("Ya salieron las 75 bolas.", "info");
                    const a = new Uint32Array(1);
                    crypto.getRandomValues(a);
                    cantar(libres[a[0] % libres.length], sacar);
                });
                cantarManual.addEventListener("click", () => {
                    const n = Number(manual.value);
                    if (!(n >= 1 && n <= 75)) return showMessage("Escribe una bola de 1 a 75.", "error");
                    cantar(n, cantarManual);
                });
                manual.addEventListener("keydown", (e) => { if (e.key === "Enter") cantarManual.click(); });
                deshacer.addEventListener("click", async () => { if (await accion(deshacer, { action: "game_deshacer" })) pintar(); });
                cerrar.addEventListener("click", async () => {
                    if (await confirmar("Terminar ronda", r.ganadores.length ? `Se cierra «${r.nombre}» con ${r.ganadores.length} ganador(es).` : `«${r.nombre}» no tiene ganador registrado. ¿Terminarla así?`, "Terminar")) {
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

                /* Verificar */
                const serieIn = input("bn-verif-serie", "", { type: "number", min: 1, max: 10000, placeholder: "Serie del cartón" });
                const verificar = el("button", { class: "bn-btn bn-btn--primary", text: "Verificar" });
                const verifRes = el("div", { class: "bn-verify" });
                async function hacerVerificacion() {
                    const s = Number(serieIn.value);
                    if (!(s >= 1 && s <= 10000)) return showMessage("Escribe una serie de 1 a 10 000.", "error");
                    const grid = C.carton(seed, s);
                    const ganadoras = C.casillasGanadoras(grid, r.bolas, r.figura);
                    const f = C.faltan(grid, r.bolas, r.figura);
                    const info = await conBoton(verificar, () => llamar({ hash, action: "game_buscar", serie: s }), "Buscando…");
                    const cv = el("canvas", { class: "bn-canvas bn-canvas--mini" });
                    await fuentesListas();
                    C.dibujarCarton(cv, { seed, serie: s, arte: null, titulo: J.config.nombre, letras: true, marcas: C.marcadas(grid, r.bolas), resaltar: ganadoras });
                    const registrar = el("button", { class: "bn-btn bn-btn--primary", text: "Registrar ganador" });
                    registrar.addEventListener("click", async () => {
                        if (await accion(registrar, { action: "game_ganador", serie: s })) { showMessage(`Ganador registrado: serie ${s}.`, "success"); pintar(); }
                    });
                    verifRes.replaceChildren(cv, el("div", { class: "bn-stack" },
                        el("p", { class: `bn-verdict ${ganadoras ? "ok" : "no"}`, text: ganadoras ? "¡Cumple la figura!" : `No cumple: le faltan ${f}.` }),
                        el("p", { text: info ? (info.vendido ? `Vendido a ${info.comprador}.` : "Atención: este cartón no aparece como vendido.") : "" }),
                        ganadoras ? registrar : null
                    ));
                }
                verificar.addEventListener("click", hacerVerificacion);
                serieIn.addEventListener("keydown", (e) => { if (e.key === "Enter") hacerVerificacion(); });

                return el("div", { class: "bn-stack" },
                    el("section", { class: "bn-card bn-caller" },
                        el("div", { class: "bn-caller-head" },
                            el("div", {}, el("p", { class: "bn-eyebrow" }, el("span", { class: "bn-dot bn-dot--live" }), " En juego"), el("h2", { text: r.nombre }), el("p", { class: "bn-note", text: `${C.FIGURAS[r.figura].nombre}${r.premio ? " · Premio: " + r.premio : ""} · ${r.bolas.length} de 75 bolas` })),
                            el("div", { class: "bn-pattern bn-pattern--sm" }, (() => { const set = new Set(C.FIGURAS[r.figura].alternativas[0].map(([f, c]) => `${f},${c}`)); return Array.from({ length: 25 }, (_, i) => el("i", { class: set.has(`${Math.floor(i / 5)},${i % 5}`) ? "on" : "" })); })())
                        ),
                        el("div", { class: "bn-caller-main" },
                            el("div", { class: "bn-caller-last" }, ultimaBola ? bolaEl(ultimaBola, true) : el("span", { class: "bn-ball bn-ball--big bn-ball--empty" }, el("b", { text: "–" })), el("div", { class: "bn-live-prev" }, r.bolas.slice(-6, -1).reverse().map((n) => bolaEl(n)))),
                            el("div", { class: "bn-caller-actions" }, sacar, el("div", { class: "bn-toolbar" }, manual, cantarManual), deshacer)
                        ),
                        tablero
                    ),
                    el("section", { class: "bn-card" },
                        el("h2", { text: "Verificar un cartón" }),
                        el("div", { class: "bn-toolbar" }, serieIn, verificar),
                        verifRes,
                        r.ganadores.length ? el("div", {}, el("h3", { text: "Ganadores de esta ronda" }), el("ul", { class: "bn-list" }, r.ganadores.map((g) => el("li", { text: `Serie ${C.serieTexto(g.serie)} · ${g.nombre || "sin nombre"} · a las ${g.hora}, con ${g.bolas} bolas` })))) : null
                    ),
                    el("div", { class: "bn-toolbar bn-toolbar--end" }, cerrar)
                );
            }

            pintar();
        }

        /* ---------- Ajustes ---------- */
        function vistaAjustes(root) {
            const c = S.data.config;
            const f = {
                nombre: input("bn-cfg-nombre", c.nombre),
                fecha: input("bn-cfg-fecha", c.fecha, { type: "date" }),
                hora: input("bn-cfg-hora", c.hora, { type: "time" }),
                lugar: input("bn-cfg-lugar", c.lugar, { placeholder: "Salón comunal de …" }),
                modalidad: select("bn-cfg-modalidad", [["Mixta", "Presencial y virtual"], ["Presencial", "Solo presencial"], ["Virtual", "Solo virtual"]], c.modalidad),
                whatsapp: input("bn-cfg-wa", c.whatsapp, { type: "tel", placeholder: "8888 8888" }),
                sinpe_numero: input("bn-cfg-sinpe", c.sinpe_numero, { type: "tel" }),
                sinpe_nombre: input("bn-cfg-sinpe-nombre", c.sinpe_nombre),
                iban: input("bn-cfg-iban", c.iban, { placeholder: "CR00 0000 …" }),
                precio_unitario: input("bn-cfg-precio", c.precio_unitario, { type: "number", min: 0 }),
                lote: input("bn-cfg-lote", c.lote, { type: "number", min: 10, max: 1000 }),
                plantilla_whatsapp: el("textarea", { class: "bn-input", id: "bn-cfg-pwa", rows: 4, text: c.plantilla_whatsapp }),
                plantilla_email_asunto: input("bn-cfg-pasunto", c.plantilla_email_asunto),
                plantilla_email: el("textarea", { class: "bn-input", id: "bn-cfg-pemail", rows: 6, text: c.plantilla_email })
            };
            const precios = {};
            for (let n = 1; n <= 20; n++) {
                const p = (S.data.precios || []).find((x) => x.cantidad === n);
                precios[n] = el("input", { class: "bn-input bn-input--sm", type: "number", min: 0, value: p ? p.precio : "", "aria-label": `Precio de ${n} cartones` });
            }
            const llenar = el("button", { class: "bn-btn bn-btn--sm", text: "Llenar con el precio por cartón" });
            llenar.addEventListener("click", () => {
                const u = Number(f.precio_unitario.value) || 0;
                for (let n = 1; n <= 20; n++) precios[n].value = u ? u * n : "";
            });
            const guardar = el("button", { class: "bn-btn bn-btn--primary", text: "Guardar ajustes" });
            guardar.addEventListener("click", () => conBoton(guardar, async () => {
                const config = {};
                Object.keys(f).forEach((k) => { config[k] = f[k].value; });
                const completo = config.nombre && config.fecha && config.sinpe_numero && (Number(config.precio_unitario) > 0 || Object.values(precios).some((p) => Number(p.value) > 0));
                if (completo) config.setup_done = "true";
                const res = await llamar({ action: "update_config", hash, config });
                const lista = Object.entries(precios).filter(([, p]) => p.value !== "").map(([n, p]) => ({ cantidad: Number(n), precio: Number(p.value) }));
                const pr = await llamar({ action: "save_precios", hash, precios: lista });
                S.data.config = res.config;
                S.data.precios = pr.precios;
                pintarCabecera();
                showMessage(completo ? "Ajustes guardados." : "Guardado. Faltan datos: nombre, fecha, SINPE y precio.", completo ? "success" : "info", 6000);
            }, "Guardando…"));

            agregar(root, 
                faltaConfigurar() ? el("div", { class: "bn-banner" }, el("p", { text: "Primera vez: completa nombre, fecha, SINPE y precio. Con eso ya puedes compartir el link de compra." })) : null,
                el("section", { class: "bn-card" }, el("h2", { text: "Datos del bingo" }), el("div", { class: "bn-form-grid" },
                    campo("Nombre (sale en el cartón si no subes arte)", f.nombre), campo("Fecha", f.fecha), campo("Hora", f.hora), campo("Lugar", f.lugar), campo("Modalidad", f.modalidad), campo("WhatsApp del organizador", f.whatsapp))),
                el("section", { class: "bn-card" }, el("h2", { text: "Pagos" }), el("div", { class: "bn-form-grid" },
                    campo("SINPE Móvil", f.sinpe_numero), campo("A nombre de", f.sinpe_nombre), campo("IBAN (opcional)", f.iban))),
                el("section", { class: "bn-card" }, el("h2", { text: "Precios" }),
                    el("div", { class: "bn-form-grid" }, campo("Precio por cartón (₡)", f.precio_unitario, "Se usa de 21 cartones en adelante y donde la tabla esté vacía."), campo("Tamaño del lote", f.lote, "Cuántos cartones se habilitan cada vez.")),
                    el("div", { class: "bn-btnrow" }, llenar),
                    el("div", { class: "bn-price-grid" }, Object.entries(precios).map(([n, inp]) => el("label", {}, el("span", { text: `${n}` }), inp)))
                ),
                el("section", { class: "bn-card" }, el("h2", { text: "Mensajes" }),
                    el("p", { class: "bn-note", text: "Variables: {{nombre}} {{bingo}} {{fecha}} {{cantidad}} {{monto}} {{cartones}} {{link}}" }),
                    el("div", { class: "bn-form-grid bn-form-grid--1" }, campo("WhatsApp al comprador", f.plantilla_whatsapp), campo("Asunto del correo", f.plantilla_email_asunto), campo("Correo (HTML)", f.plantilla_email))),
                el("div", { class: "bn-toolbar bn-toolbar--end bn-sticky-save" }, guardar)
            );
        }

        app.replaceChildren(
            el("div", { class: `bn-panel${TABS.length === 1 ? " bn-panel--single" : ""}` },
                el("header", { class: "bn-panel-head" }, el("div", {}, el("p", { class: "bn-eyebrow", text: rol === "cantador" ? "Cantador" : "Bingo Digital · organizador" }), titulo, sub)),
                TABS.length > 1 ? nav : null,
                cuerpo
            )
        );
        pintarCabecera();
        ir(faltaConfigurar() && S.tab === "resumen" ? "resumen" : S.tab);
    }

    function precioLocal(tabla, unitario, n) {
        const fila = (tabla || []).find((x) => x.cantidad === n);
        if (fila) return fila.precio;
        return (Number(unitario) || 0) * n;
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

    /** Formulario de venta presencial (organizador y vendedor). */
    function formularioVenta({ titulo, sectores, rango, precio, enviar, alTerminar }) {
        const nombre = input("bn-v-nombre", "", { placeholder: "Nombre y apellido" });
        const tel = input("bn-v-tel", "", { type: "tel", placeholder: "8888 8888" });
        const series = input("bn-v-series", "", { placeholder: rango ? `Ej. ${rango[0]}, ${rango[0] + 1} o ${rango[0]}-${rango[0] + 4}` : "Ej. 120, 121 o 120-124" });
        const monto = input("bn-v-monto", "", { type: "number", min: 0 });
        const metodo = select("bn-v-metodo", [["Efectivo", "Efectivo"], ["SINPE", "SINPE Móvil"], ["Transferencia", "Transferencia"]], "Efectivo");
        const sector = sectores && sectores.length ? select("bn-v-sector", [["0", "Sin sector"], ...sectores.map((s) => [s.sector_id, `${s.nombre} (${s.desde}–${s.hasta})`])], "0") : null;
        const nota = el("small", { class: "bn-note" });
        series.addEventListener("input", () => {
            const n = contarSeries(series.value);
            nota.textContent = n ? `${n} ${n === 1 ? "cartón" : "cartones"} · precio sugerido ${colones(precio(n))}` : "";
            monto.placeholder = n ? String(precio(n)) : "";
        });
        modal(titulo, el("div", { class: "bn-form-grid" },
            campo("Comprador", nombre), campo("WhatsApp", tel), campo("Series entregadas", series, rango ? `Tu bloque: ${rango[0]}–${rango[1]}` : "Separa con comas; usa guion para rangos."), nota,
            campo("Monto cobrado (₡)", monto, "Vacío = precio de la tabla."), campo("Forma de pago", metodo), sector ? campo("Sector", sector) : null
        ), (cerrar) => {
            const ok = el("button", { class: "bn-btn bn-btn--primary", text: "Registrar venta" });
            ok.addEventListener("click", async () => {
                const r = await conBoton(ok, () => enviar({ nombre: nombre.value, telefono: tel.value, series: series.value, monto: monto.value, metodo: metodo.value, sector_id: sector ? sector.value : 0 }), "Guardando…");
                if (r && r.entrada) {
                    cerrar();
                    showMessage(`Venta registrada: cartones ${r.entrada.cartones}.`, "success");
                    alTerminar(r.entrada);
                }
            });
            return [el("button", { class: "bn-btn", onclick: cerrar, text: "Cancelar" }), ok];
        });
    }

    /* ================= Link de sector (#bv/) ================= */

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

        function pintar() {
            const total = s.hasta - s.desde + 1;
            const monto = D.entradas.reduce((a, e) => a + (e.estado === "Rechazada" ? 0 : e.monto), 0);
            tiles.replaceChildren(tile(`${D.vendidos.length} / ${total}`, "cartones vendidos", `bloque ${s.desde}–${s.hasta}`), tile(colones(monto), "vendido por el sector"));
            if (!D.entradas.length) {
                lista.replaceChildren(el("p", { class: "bn-empty", text: "Todavía no hay ventas. Registra la primera con «+ Registrar venta»." }));
                return;
            }
            lista.replaceChildren(...D.entradas.map((e) => {
                const linkJ = e.token ? links.jugador(e.token) : "";
                const vars = { nombre: e.nombre.split(" ")[0], bingo: cfg.nombre, fecha: cfg.fecha, cantidad: e.cantidad, monto: colones(e.monto), cartones: e.cartones.split(",").join(", "), link: linkJ };
                const wa = e.telefono && linkJ ? el("a", { class: `bn-btn bn-btn--sm${e.wa_enviado ? " is-done" : " bn-btn--primary"}`, href: waUrl(e.telefono, render(D.plantilla_whatsapp, vars)), target: "_blank", rel: "noopener", text: e.wa_enviado ? "WhatsApp ✓" : "Enviar por WhatsApp" }) : null;
                if (wa) wa.addEventListener("click", () => { if (!e.wa_enviado) llamar({ action: "sector_mark_sent", hash, entrada_id: e.entrada_id, canal: "wa" }).then(() => { e.wa_enviado = true; pintar(); }).catch(() => {}); });
                return el("article", { class: "bn-entry" },
                    el("header", {}, el("div", {}, el("b", { text: e.nombre }), el("small", { class: "bn-note bn-block", text: `${e.fecha} · ${e.estado}` })), el("div", { class: "bn-entry-amount" }, el("b", { text: colones(e.monto) }), el("small", { text: `${e.cantidad} ${e.cantidad === 1 ? "cartón" : "cartones"}` }))),
                    el("dl", { class: "bn-dl" }, e.cartones ? [el("dt", { text: "Cartones" }), el("dd", { class: "bn-mono", text: e.cartones.split(",").join(", ") })] : null),
                    el("div", { class: "bn-btnrow" }, linkJ ? el("button", { class: "bn-btn bn-btn--sm", onclick: () => copiar(linkJ, "Link copiado."), text: "Copiar link" }) : null, wa)
                );
            }));
        }

        const vender = el("button", { class: "bn-btn bn-btn--primary", text: "+ Registrar venta" });
        vender.addEventListener("click", () => formularioVenta({
            titulo: "Registrar venta", rango: [s.desde, s.hasta],
            precio: (n) => precioLocal(D.precios, D.precio_unitario, n),
            enviar: (datos) => llamar({ action: "sector_vender", hash, ...datos }),
            alTerminar: (entrada) => {
                D.entradas.unshift(entrada);
                entrada.cartones.split(",").forEach((x) => D.vendidos.push(Number(x)));
                pintar();
            }
        }));

        let arteCache = null;
        app.replaceChildren(
            el("div", { class: "bn-panel bn-panel--single" },
                el("header", { class: "bn-panel-head" }, el("div", {}, el("p", { class: "bn-eyebrow", text: `Sector ${s.nombre}${s.encargado ? " · " + s.encargado : ""}` }), el("h1", { class: "bn-title bn-title--panel", text: cfg.nombre }), el("p", { class: "bn-sub", text: [cfg.fecha, cfg.hora, cfg.lugar].filter(Boolean).join(" · ") }))),
                el("main", { class: "bn-panel-body" },
                    tiles,
                    el("div", { class: "bn-toolbar" }, vender),
                    el("section", { class: "bn-card" }, el("h2", { text: "Mis ventas" }), lista),
                    el("details", { class: "bn-card" }, el("summary", { text: "Imprimir los cartones de mi bloque" }),
                        panelImprimir({
                            seed: cfg.seed, pub: cfg.public_id, cfg, min: s.desde, max: s.hasta, sugerido: [s.desde, Math.min(s.hasta, s.desde + 99)],
                            obtenerArte: async () => {
                                if (!cfg.arte_url) return "";
                                if (!arteCache) arteCache = (await llamar({ action: "get_arte", pub: cfg.public_id }, { timeoutMs: 60000 })).dataUrl;
                                return arteCache;
                            }
                        }))
                )
            )
        );
        pintar();
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
        const correo = input("bn-c-correo", "", { type: "email", autocomplete: "email", placeholder: "Opcional" });
        const cantidad = input("bn-c-cantidad", "1", { type: "number", min: 1, max: 200, inputmode: "numeric" });
        const modalidad = cfg.modalidad === "Mixta" ? select("bn-c-modalidad", [["Virtual", "Juego en línea"], ["Presencial", "Llego al salón"]], "Virtual") : null;
        const sector = D.sectores.length ? select("bn-c-sector", [["0", "Nadie en especial"], ...D.sectores.map((x) => [x.sector_id, x.encargado ? `${x.encargado} (${x.nombre})` : x.nombre])], "0") : null;
        const vendedor = D.sectores.length ? null : input("bn-c-vendedor", "", { placeholder: "Opcional" });
        const metodo = select("bn-c-metodo", [["SINPE", "SINPE Móvil"], ...(D.iban ? [["Transferencia", "Transferencia"]] : [])], "SINPE");
        const comprobante = el("input", { type: "file", id: "bn-c-comp", class: "bn-file", accept: "image/*,application/pdf" });
        const total = el("strong", { class: "bn-total" });
        const precio = (n) => precioLocal(D.precios, D.precio_unitario, n);
        const actualizar = () => {
            const n = Math.max(1, Math.min(200, Math.floor(Number(cantidad.value) || 1)));
            total.textContent = colones(precio(n));
        };
        cantidad.addEventListener("input", actualizar);
        actualizar();

        const pago = el("div", { class: "bn-pay" },
            D.sinpe_numero ? el("div", {}, el("span", { class: "bn-label", text: "SINPE Móvil" }), el("b", { class: "bn-mono", text: D.sinpe_numero }), D.sinpe_nombre ? el("small", { text: D.sinpe_nombre }) : null, el("button", { class: "bn-btn bn-btn--sm", onclick: () => copiar(D.sinpe_numero.replace(/\s/g, ""), "Número copiado."), text: "Copiar" })) : null,
            D.iban ? el("div", {}, el("span", { class: "bn-label", text: "IBAN" }), el("b", { class: "bn-mono", text: D.iban }), el("button", { class: "bn-btn bn-btn--sm", onclick: () => copiar(D.iban.replace(/\s/g, ""), "IBAN copiado."), text: "Copiar" })) : null
        );

        const enviar = el("button", { class: "bn-btn bn-btn--primary bn-btn--xl", text: "Enviar compra" });
        enviar.addEventListener("click", () => conBoton(enviar, async () => {
            const f = comprobante.files && comprobante.files[0];
            if (!f) throw new Error("Adjunta la foto o PDF del comprobante de pago.");
            if (f.size > 12 * 1024 * 1024) throw new Error("El comprobante pesa más de 12 MB.");
            const dataUrl = await archivoADataUrl(f, 1600);
            const r = await llamar({
                action: "submit_compra", pub, nombre: nombre.value, telefono: tel.value, correo: correo.value, cantidad: cantidad.value,
                modalidad: modalidad ? modalidad.value : cfg.modalidad === "Presencial" ? "Presencial" : "Virtual",
                sector_id: sector ? sector.value : 0, vendedor: vendedor ? vendedor.value : "", metodo: metodo.value, comprobante: dataUrl
            }, { timeoutMs: 90000 });
            app.replaceChildren(el("div", { class: "bn-done" },
                el("div", { class: "bn-balls-row", "aria-hidden": "true" }, C.LETRAS.map((l, i) => bolaEl(i * 15 + 7))),
                el("h1", { class: "bn-title", text: "¡Recibimos tu compra!" }),
                el("p", { text: `Compra #${r.entrada_id}: ${r.cantidad} ${r.cantidad === 1 ? "cartón" : "cartones"} por ${colones(r.monto)}.` }),
                el("p", { text: "Cuando el organizador confirme tu pago, te llega por WhatsApp (o correo) el link con tus cartones para jugar en línea." }),
                cfg.whatsapp ? el("a", { class: "bn-btn", href: waUrl(cfg.whatsapp, `Hola, envié la compra #${r.entrada_id} para ${cfg.nombre}.`), target: "_blank", rel: "noopener", text: "Escribir al organizador" }) : null
            ));
        }, "Enviando…"));

        app.replaceChildren(
            el("div", { class: "bn-buy" },
                el("header", { class: "bn-buy-head" },
                    el("div", { class: "bn-balls-row", "aria-hidden": "true" }, C.LETRAS.map((l, i) => bolaEl([7, 22, 38, 51, 69][i]))),
                    el("h1", { class: "bn-title", text: cfg.nombre }),
                    el("p", { class: "bn-sub", text: [cfg.fecha, cfg.hora, cfg.lugar].filter(Boolean).join(" · ") })
                ),
                el("section", { class: "bn-card" }, el("h2", { text: "1. Tus datos" }), el("div", { class: "bn-form-grid" },
                    campo("Nombre", nombre), campo("WhatsApp", tel, "Aquí te enviamos el link de tus cartones."), campo("Correo", correo), modalidad ? campo("¿Cómo vas a jugar?", modalidad) : null,
                    sector ? campo("¿Quién te vendió?", sector) : campo("¿Quién te vendió?", vendedor))),
                el("section", { class: "bn-card" }, el("h2", { text: "2. Cartones" }), el("div", { class: "bn-buy-qty" }, campo("Cantidad", cantidad), el("div", {}, el("span", { class: "bn-label", text: "Total a pagar" }), total))),
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
            vistaJugador({ cfg: d.config, series: d.cartones, nombre: d.nombre, vivoInicial: d.vivo, token });
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
        if (ctx.mode === "sector") return initSector(ctx.hash);
        if (ctx.mode === "compra") return initCompra(ctx.hash);
        if (ctx.mode === "jugador") return initJugador(ctx.hash);
        if (ctx.mode === "carton") return initCartonSuelto(ctx.hash);
        return pantallaError("Link no reconocido.");
    };
})();
