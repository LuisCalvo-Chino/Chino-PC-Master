/**
 * Operaciones VIVE · app web
 *
 * Rutas (todo vive después del #):
 *   #op_vive/<evento>                 → lista pública del evento + botón flotante para anotarse
 *   #op_vive/admin                    → link de Admin (conexión, eventos, código de Apps Script)
 *   #op_vive/admin/<clave>/s/<id>     → link de Admin compartible (guarda la clave y se limpia de la barra)
 *   …/s/<id>                          → conexión dentro del enlace (si conexion.js está vacío)
 *   #op_vive/demo/…                   → lo mismo, pero contra una copia del backend que corre en este navegador
 */
(function () {
    "use strict";

    const LS = {
        conexion: "opvive-conexion",
        clave: "opvive-clave",
        mios: "opvive-mios",
        nombre: "opvive-nombre",
        contacto: "opvive-contacto"
    };
    const REFRESCO_MS = 45000;
    const LOGO = "../imagenes/vive/logo-vive.png";
    const CARA = "../imagenes/vive/icon-192.png";
    const ESTADOS = { ABIERTO: "Abierto", CERRADO: "Cerrado", ARCHIVADO: "Archivado" };
    const TIPOS_UI = [
        { id: "avanzado", nombre: "Operaciones Avanzado", ejemplo: "Avanzado 40", detalle: "Armado, Contratos, Ángeles de Cuna, Estiramientos con roles, Upgrade y Graduación." },
        { id: "introductorio", nombre: "Operaciones Introductorio", ejemplo: "Introductorio 52", detalle: "Armado, Registro, Ángeles, Upgrade y Graduación." },
        { id: "otro", nombre: "Otro evento", ejemplo: "Reunión de equipo", detalle: "Una lista general para armar a tu gusto." }
    ];

    const app = document.getElementById("app");
    let ruta = leerRuta();
    let temporizador = null;

    // ======================================================================
    //  UTILIDADES
    // ======================================================================

    function esc(v) {
        return String(v == null ? "" : v)
            .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
    }

    function clave(t) {
        return String(t == null ? "" : t).normalize("NFD").replace(/[̀-ͯ]/g, "")
            .toLowerCase().trim().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
    }

    function lsGet(k, porDefecto) {
        try {
            const v = localStorage.getItem(k);
            return v == null ? porDefecto : JSON.parse(v);
        } catch (e) { return porDefecto; }
    }
    function lsSet(k, v) {
        try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* modo privado */ }
    }
    function lsDel(k) {
        try { localStorage.removeItem(k); } catch (e) { /* nada */ }
    }

    let toastTimer = null;
    function toast(msg, tipo) {
        const el = document.getElementById("opv-toast");
        if (!el) return;
        el.textContent = msg;
        el.className = "opv-toast show" + (tipo ? " " + tipo : "");
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => { el.className = "opv-toast"; }, 3200);
    }

    async function copiar(texto, aviso) {
        try {
            await navigator.clipboard.writeText(texto);
        } catch (e) {
            const t = document.createElement("textarea");
            t.value = texto;
            t.style.position = "fixed";
            t.style.opacity = "0";
            document.body.appendChild(t);
            t.select();
            try { document.execCommand("copy"); } catch (e2) { /* nada */ }
            t.remove();
        }
        toast(aviso || "Copiado", "ok");
    }

    function fechaCorta(iso) {
        const d = new Date(iso);
        if (isNaN(d)) return String(iso || "");
        return d.toLocaleString("es-CR", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
    }

    const ICON = {
        reloj: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
        pin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/></svg>',
        ropa: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3 4 5.5 2.5 10l3.5 1.5V21h12v-9.5l3.5-1.5L20 5.5 16 3a4 4 0 0 1-8 0z"/></svg>',
        mas: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
        copiar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>',
        check: '<svg viewBox="0 0 80 80"><circle cx="40" cy="40" r="38" fill="#00c0cf"/><path d="M24 41l11 11 21-23" fill="none" stroke="#fff" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/></svg>'
    };

    // ======================================================================
    //  RUTA Y CONEXIÓN
    // ======================================================================

    function leerRuta() {
        const raw = String(location.hash || "").replace(/^#\/?/, "");
        let partes = raw.split("/").filter(Boolean).map((p) => {
            try { return decodeURIComponent(p); } catch (e) { return p; }
        });
        if (partes[0] !== "op_vive") return { modo: "inicio", demo: false, dep: null };
        partes.shift();
        let demo = false;
        if (partes[0] === "demo") { demo = true; partes.shift(); }
        let dep = null;
        const si = partes.indexOf("s");
        if (si >= 0) { dep = partes[si + 1] || null; partes = partes.slice(0, si); }
        if (partes[0] === "admin") return { modo: "admin", clave: partes[1] || "", dep, demo };
        if (partes[0]) return { modo: "evento", id: partes[0], dep, demo };
        return { modo: "inicio", dep, demo };
    }

    /** De cualquier forma del enlace /exec saca el identificador de la implementación. */
    function depDesdeUrl(url) {
        const m = String(url || "").match(/script\.google\.com\/(?:a\/macros\/([^/]+)|macros)\/s\/([A-Za-z0-9_-]{20,})/);
        if (!m) return null;
        return m[1] ? m[1] + "~" + m[2] : m[2];
    }
    function urlDesdeDep(dep) {
        if (!dep) return "";
        if (dep.indexOf("~") > 0) {
            const [dom, id] = dep.split("~");
            return "https://script.google.com/a/macros/" + dom + "/s/" + id + "/exec";
        }
        return "https://script.google.com/macros/s/" + dep + "/exec";
    }
    function urlFija() {
        return String(window.OPVIVE_GAS_URL || "").trim();
    }
    function urlConexion() {
        if (ruta.demo) return "demo";
        if (ruta.dep) return urlDesdeDep(ruta.dep);
        if (urlFija()) return urlFija();
        return String(lsGet(LS.conexion, "") || "");
    }
    function base() {
        return location.origin + location.pathname.replace(/index\.html$/, "");
    }

    // ======================================================================
    //  API
    // ======================================================================

    let demoListo = null;
    function cargarDemo() {
        if (!demoListo) {
            demoListo = new Promise((resolve, reject) => {
                const s = document.createElement("script");
                s.src = "demo.js?v=" + (window.OPVIVE_ASSET_V || "1");
                s.onload = () => window.OPVIVE_DEMO.listo.then(resolve, reject);
                s.onerror = () => reject(new Error("No se pudo cargar la demostración."));
                document.head.appendChild(s);
            });
        }
        return demoListo;
    }

    async function api(payload, url) {
        url = url || urlConexion();
        let res;
        if (url === "demo") {
            await cargarDemo();
            await new Promise((r) => setTimeout(r, 250));
            res = window.OPVIVE_DEMO.post(payload);
        } else {
            if (!url) {
                const e = new Error("Este enlace no trae la conexión con el Google Sheets.");
                e.codigo = "sin_conexion";
                throw e;
            }
            res = await postGas(url, payload);
        }
        if (!res || res.ok === false) {
            const e = new Error((res && res.mensaje) || "No se pudo completar.");
            e.codigo = res && res.codigo;
            throw e;
        }
        return res;
    }

    async function postGas(url, payload) {
        const cuerpo = JSON.stringify(payload);
        const intentos = [
            { headers: { "Content-Type": "text/plain;charset=utf-8" }, body: cuerpo },
            { headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" }, body: new URLSearchParams({ payload: cuerpo }).toString() }
        ];
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 40000);
        let ultimo = null;
        try {
            for (const i of intentos) {
                try {
                    const r = await fetch(url, {
                        method: "POST", mode: "cors", redirect: "follow", credentials: "omit", cache: "no-store",
                        headers: i.headers, body: i.body, signal: ctrl.signal
                    });
                    const txt = (await r.text()).trim();
                    if (!txt) throw new Error("El servidor respondió vacío.");
                    if (txt.charAt(0) === "<") {
                        throw new Error("El /exec respondió una página en lugar de datos. Revisa que la implementación sea «Aplicación web» con acceso «Cualquier usuario».");
                    }
                    return JSON.parse(txt);
                } catch (err) {
                    if (err && err.name === "AbortError") throw new Error("El servidor tardó demasiado. Intenta de nuevo.");
                    if (!(err instanceof TypeError)) throw err;
                    ultimo = err;
                }
            }
        } finally {
            clearTimeout(t);
        }
        throw new Error("No hay conexión con el Google Sheets (red o permisos)." + (ultimo && ultimo.message ? " " + ultimo.message : ""));
    }

    // ======================================================================
    //  VENTANAS FLOTANTES
    // ======================================================================

    const pila = [];
    function abrirModal(opc) {
        const el = document.createElement("div");
        el.className = "opv-modal";
        el.setAttribute("role", "dialog");
        el.setAttribute("aria-modal", "true");
        el.innerHTML =
            '<div class="opv-modal__bg"></div>' +
            '<div class="opv-modal__box' + (opc.ancho ? " opv-modal__box--wide" : "") + '">' +
            '<div class="opv-modal__head"><img src="' + CARA + '" alt=""><h2></h2>' +
            '<button type="button" class="opv-modal__x" aria-label="Cerrar">×</button></div>' +
            '<div class="opv-modal__body"></div><div class="opv-modal__foot"></div></div>';
        el.querySelector("h2").textContent = opc.titulo || "";
        document.body.appendChild(el);
        document.body.classList.add("opv-lock");
        const m = {
            el,
            body: el.querySelector(".opv-modal__body"),
            foot: el.querySelector(".opv-modal__foot"),
            titulo(t) { el.querySelector("h2").textContent = t; },
            cerrar() {
                const i = pila.indexOf(m);
                if (i >= 0) pila.splice(i, 1);
                el.remove();
                if (!pila.length) document.body.classList.remove("opv-lock");
                if (opc.alCerrar) opc.alCerrar();
            }
        };
        el.querySelector(".opv-modal__x").onclick = () => m.cerrar();
        el.querySelector(".opv-modal__bg").onclick = () => { if (!opc.fijo) m.cerrar(); };
        pila.push(m);
        return m;
    }
    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && pila.length) pila[pila.length - 1].cerrar();
    });

    function confirmar(texto, opc) {
        opc = opc || {};
        return new Promise((resolve) => {
            let r = false;
            const m = abrirModal({ titulo: opc.titulo || "¿Seguimos?", alCerrar: () => resolve(r) });
            m.body.innerHTML = "<p style=\"margin:0;font-size:1.05rem\">" + esc(texto) + "</p>";
            m.foot.innerHTML =
                '<button type="button" class="opv-btn opv-btn--ghost" data-no>Cancelar</button>' +
                '<button type="button" class="opv-btn ' + (opc.peligro ? "opv-btn--primary" : "opv-btn--cyan") + '" data-si>' + esc(opc.ok || "Sí") + "</button>";
            m.foot.querySelector("[data-no]").onclick = () => m.cerrar();
            m.foot.querySelector("[data-si]").onclick = () => { r = true; m.cerrar(); };
        });
    }

    function barraSuperior(extra) {
        return (ruta.demo
            ? '<div class="opv-demo-bar">Modo demostración: los datos viven solo en este navegador. <a href="#" data-reset-demo>Reiniciar demo</a></div>'
            : "") +
            '<header class="opv-top"><div class="opv-top__in">' +
            '<img class="opv-top__logo" src="' + LOGO + '" alt="VIVE">' +
            '<span class="opv-top__app">Operaciones</span><span class="opv-top__sp"></span>' + (extra || "") +
            "</div></header>";
    }

    function enlazarDemo() {
        const a = app.querySelector("[data-reset-demo]");
        if (!a) return;
        a.onclick = async (e) => {
            e.preventDefault();
            if (!(await confirmar("Se borran los datos de prueba y se vuelve a cargar el ejemplo.", { ok: "Reiniciar" }))) return;
            await cargarDemo();
            window.OPVIVE_DEMO.reiniciar();
            lsDel(LS.mios);
            location.reload();
        };
    }

    function pantallaMensaje(titulo, texto, extraHtml) {
        app.innerHTML = barraSuperior() +
            '<main class="opv-main"><div class="opv-msg"><img src="' + LOGO + '" alt="VIVE">' +
            "<h1>" + esc(titulo) + "</h1><p>" + esc(texto) + "</p>" + (extraHtml || "") + "</div></main>";
        enlazarDemo();
    }

    // ======================================================================
    //  INICIO (#op_vive sin evento)
    // ======================================================================

    function vistaInicio() {
        document.title = "Operaciones VIVE";
        pantallaMensaje(
            "Operaciones VIVE",
            "Abre el enlace del evento que te compartió coordinación para ver las listas y anotarte.",
            '<p style="margin-top:22px"><a class="opv-btn opv-btn--ghost opv-btn--sm" href="#op_vive/' +
            (ruta.demo ? "demo/" : "") + 'admin">Soy de coordinación</a></p>'
        );
    }

    // ======================================================================
    //  VISTA PÚBLICA DEL EVENTO
    // ======================================================================

    const pub = { datos: null, enviando: false };

    function llaveMios() {
        return (ruta.demo ? "demo|" : (ruta.dep || "fijo") + "|") + clave(ruta.id);
    }
    function misInscripciones() {
        const todo = lsGet(LS.mios, {});
        return Array.isArray(todo[llaveMios()]) ? todo[llaveMios()] : [];
    }
    function guardarMias(lista) {
        const todo = lsGet(LS.mios, {});
        todo[llaveMios()] = lista;
        lsSet(LS.mios, todo);
    }

    async function vistaEvento() {
        clearInterval(temporizador);
        try {
            pub.datos = await api({ action: "evento", id: ruta.id });
        } catch (e) {
            if (e.codigo === "archivado") return pantallaMensaje("Evento terminado", e.message);
            if (e.codigo === "no_existe") return pantallaMensaje("No encontramos este evento", "Revisa que el enlace esté completo o pide uno nuevo a coordinación.");
            if (e.codigo === "sin_conexion") return pantallaMensaje("Enlace incompleto", "A este enlace le falta la conexión. Pide a coordinación el enlace completo del evento.");
            return pantallaMensaje("No se pudo cargar", e.message,
                '<p style="margin-top:18px"><button class="opv-btn opv-btn--cyan" onclick="location.reload()">Intentar de nuevo</button></p>');
        }
        pintarEvento();
        temporizador = setInterval(refrescarEvento, REFRESCO_MS);
    }

    async function refrescarEvento() {
        if (pub.enviando || document.hidden || ruta.modo !== "evento") return;
        try {
            pub.datos = await api({ action: "evento", id: ruta.id });
            pintarEvento(true);
        } catch (e) { /* se reintenta en el siguiente ciclo */ }
    }
    document.addEventListener("visibilitychange", () => { if (!document.hidden && ruta.modo === "evento") refrescarEvento(); });

    function pintarEvento(conservarScroll) {
        const d = pub.datos;
        const ev = d.evento;
        document.title = ev.nombre + " · Operaciones VIVE";
        const y = window.scrollY;
        const mias = misInscripciones();
        const pct = d.totales.cupos ? Math.min(100, Math.round((d.totales.tomados / d.totales.cupos) * 100)) : 0;

        let html = barraSuperior('<span class="opv-top__pill"><span class="opv-dot opv-dot--ok"></span>En vivo</span>');
        html += '<main class="opv-main">';
        html += '<section class="opv-hero">';
        html += '<span class="opv-chip' + (ev.tipo === "avanzado" ? " opv-chip--red" : "") + '">' + esc(ev.tipoNombre) + "</span>";
        html += "<h1>" + esc(ev.nombre) + "</h1>";
        if (ev.fechas) html += '<p class="opv-hero__fechas">' + esc(ev.fechas) + "</p>";
        if (ev.presentacion) html += '<p class="opv-hero__intro">' + esc(ev.presentacion) + "</p>";
        if (d.totales.cupos) {
            html += '<div class="opv-progress"><div class="opv-progress__bar"><span style="width:' + pct + '%"></span></div>' +
                '<div class="opv-progress__txt">' + d.totales.tomados + " de " + d.totales.cupos + " lugares tomados</div></div>";
        }
        html += "</section>";

        if (ev.notas && ev.notas.length) {
            html += '<div class="opv-notas"><ul>' + ev.notas.map((n) => "<li>" + esc(n) + "</li>").join("") + "</ul></div>";
        }
        if (!d.abierto) html += '<div class="opv-cerrado">' + esc(d.mensajeCerrado) + "</div>";

        if (d.secciones.length > 1) {
            html += '<nav class="opv-nav" aria-label="Secciones">' + d.secciones.map((s) =>
                '<a href="#" data-ir="' + esc(s.id) + '">' + esc(s.titulo) + "<b>" + s.tomados + (s.cupos ? "/" + s.cupos : "") + "</b></a>"
            ).join("") + "</nav>";
        }

        html += '<div class="opv-secciones">' + d.secciones.map((s) => tarjetaSeccion(s, mias, d)).join("") + "</div>";
        html += '<p class="opv-pie">La lista se actualiza sola. Última actualización: ' + esc(fechaCorta(d.actualizado)) +
            ' · <a href="#" data-refrescar>Actualizar ahora</a></p>';
        html += "</main>";

        html += '<button type="button" class="opv-fab' + (d.abierto ? "" : " opv-fab--off") + '" data-anotarme>' +
            '<span style="display:grid;place-items:center;width:30px;height:30px;border-radius:50%;background:#fff">' +
            '<img src="' + CARA + '" alt="" style="width:22px;height:22px"></span>' +
            (d.abierto ? "Anotarme" : "Cerrado") + "</button>";

        app.innerHTML = html;
        enlazarDemo();
        if (conservarScroll) window.scrollTo(0, y);

        app.querySelectorAll("[data-ir]").forEach((a) => {
            a.onclick = (e) => {
                e.preventDefault();
                const t = document.getElementById("sec-" + a.getAttribute("data-ir"));
                if (t) t.scrollIntoView({ behavior: "smooth", block: "start" });
            };
        });
        app.querySelector("[data-refrescar]").onclick = (e) => { e.preventDefault(); refrescarEvento(); toast("Lista actualizada"); };
        app.querySelector("[data-anotarme]").onclick = () => {
            if (!pub.datos.abierto) return toast(pub.datos.mensajeCerrado, "error");
            abrirFormulario();
        };
        app.querySelectorAll("[data-quitar]").forEach((b) => {
            b.onclick = () => quitarme(b.getAttribute("data-quitar"));
        });
    }

    function esMio(mias, seccionId, nombre, rol) {
        return mias.filter((m) =>
            clave(m.seccion) === clave(seccionId) && clave(m.nombre) === clave(nombre) &&
            (rol == null || clave(m.rol) === clave(rol))
        )[0] || null;
    }

    function tarjetaSeccion(s, mias, d) {
        const puedeQuitar = d.permitirQuitarse && d.abierto;
        let h = '<article class="opv-sec" id="sec-' + esc(s.id) + '">';
        h += '<div class="opv-sec__head"><h2>' + esc(s.titulo) + "</h2>";
        h += '<div class="opv-sec__count' + (s.lleno ? " opv-sec__count--lleno" : "") + '">' +
            (s.cupos ? s.tomados + "/" + s.cupos : s.tomados) +
            "<small>" + (s.lleno ? "Lleno" : s.cupos ? "anotados" : "anotados · sin límite") + "</small></div>";
        const meta = [];
        if (s.cuando) meta.push("<li>" + ICON.reloj + "<span>" + esc(s.cuando) + "</span></li>");
        if (s.donde) meta.push("<li>" + ICON.pin + "<span>" + esc(s.donde) + "</span></li>");
        if (s.vestimenta) meta.push("<li>" + ICON.ropa + "<span>" + esc(s.vestimenta) + "</span></li>");
        h += meta.length ? '<ul class="opv-sec__meta">' + meta.join("") + "</ul>" : "<div></div>";
        h += "</div><div class=\"opv-sec__body\">";
        if (s.aviso) h += '<p class="opv-aviso">' + esc(s.aviso) + "</p>";
        if (s.instrucciones) h += '<p class="opv-instr">' + esc(s.instrucciones) + "</p>";

        if (s.tipo === "ROLES") {
            if (!s.roles.length) {
                h += '<p class="opv-hint">Coordinación todavía no definió los roles de esta sección.</p>';
            } else {
                h += '<ul class="opv-roles">' + s.roles.map((r) => {
                    const mio = r.ocupantes.map((n) => esMio(mias, s.id, n, r.rol)).filter(Boolean)[0];
                    const libre = !r.ocupantes.length;
                    return '<li class="opv-rol' + (libre ? " opv-rol--libre" : "") + (mio ? " opv-rol--mio" : "") + '">' +
                        '<span class="opv-rol__nombre">' + esc(r.rol) + (r.nota ? "<small>" + esc(r.nota) + "</small>" : "") + "</span>" +
                        '<span class="opv-rol__gente">' + (libre ? "Disponible" : esc(r.ocupantes.join(", "))) +
                        (r.cupos > 1 && r.disponibles > 0 && !libre ? ' <span class="opv-hint">(' + r.disponibles + " libre" + (r.disponibles > 1 ? "s" : "") + ")</span>" : "") +
                        (mio && puedeQuitar ? ' <button type="button" class="opv-mini-btn" data-quitar="' + esc(mio.comprobante) + '">Quitarme</button>' : "") +
                        "</span></li>";
                }).join("") + "</ul>";
            }
        } else {
            const nombres = s.apuntados;
            const libres = s.cupos ? Math.max(0, s.cupos - nombres.length) : 0;
            const verLibres = Math.min(libres, nombres.length ? 3 : 6);
            if (!nombres.length && !s.cupos) {
                h += '<p class="opv-hint">Todavía no hay nadie anotado. ¡Sé la primera persona!</p>';
            } else {
                h += '<ol class="opv-slots">';
                nombres.forEach((n, i) => {
                    const mio = esMio(mias, s.id, n);
                    h += '<li class="opv-slot' + (mio ? " opv-slot--mio" : "") + '"><span class="opv-slot__n">' + (i + 1) +
                        '</span><span class="opv-slot__name">' + esc(n) + "</span>" +
                        (mio && puedeQuitar ? '<button type="button" class="opv-mini-btn" data-quitar="' + esc(mio.comprobante) + '">Quitarme</button>' : "") +
                        "</li>";
                });
                for (let i = 0; i < verLibres; i++) {
                    h += '<li class="opv-slot opv-slot--libre"><span class="opv-slot__n">' + (nombres.length + i + 1) +
                        '</span><span class="opv-slot__name">Disponible</span></li>';
                }
                h += "</ol>";
                if (libres > verLibres) {
                    h += '<p class="opv-slots__mas">+ ' + (libres - verLibres) + " lugar" + (libres - verLibres > 1 ? "es" : "") + " libre" + (libres - verLibres > 1 ? "s" : "") + "</p>";
                }
            }
        }
        h += "</div></article>";
        return h;
    }

    async function quitarme(comprobante) {
        const mias = misInscripciones();
        const m = mias.filter((x) => x.comprobante === comprobante)[0];
        if (!m) return;
        const donde = m.titulo + (m.rol ? " · " + m.rol : "");
        if (!(await confirmar("Vas a salir de «" + donde + "». Tu lugar queda libre para otra persona.", { titulo: "Quitarme de la lista", ok: "Quitarme", peligro: true }))) return;
        pub.enviando = true;
        try {
            const r = await api({ action: "quitarme", id: ruta.id, comprobantes: [comprobante] });
            guardarMias(mias.filter((x) => x.comprobante !== comprobante));
            pub.datos = r.datos;
            pintarEvento(true);
            toast(r.mensaje, "ok");
        } catch (e) {
            toast(e.message, "error");
        } finally {
            pub.enviando = false;
        }
    }

    // ---------- formulario flotante de inscripción ----------

    function abrirFormulario() {
        const f = {
            nombre: lsGet(LS.nombre, "") || "",
            contacto: lsGet(LS.contacto, "") || "",
            sel: {},
            error: ""
        };
        const m = abrirModal({ titulo: "Anótate · " + pub.datos.evento.nombre, fijo: true });

        function estadoSeccion(s) {
            const d = pub.datos;
            const yo = clave(f.nombre);
            const gente = s.tipo === "ROLES" ? s.roles.reduce((a, r) => a.concat(r.ocupantes), []) : s.apuntados;
            if (yo.split("_").length >= 2 && gente.some((n) => clave(n) === yo)) return { off: true, txt: "Ya estás en esta lista" };
            if (s.tipo === "ROLES") {
                if (!s.roles.length) return { off: true, txt: "Sin roles definidos" };
                if (!s.roles.some((r) => r.disponibles > 0)) return { off: true, txt: "Todos los roles están tomados" };
            } else if (s.lleno) {
                return { off: true, txt: "Lleno" };
            }
            if (s.grupo) {
                const choque = d.secciones.filter((o) => o.id !== s.id && o.grupo === s.grupo && (
                    f.sel[o.id] ||
                    (yo.split("_").length >= 2 && (o.tipo === "ROLES" ? o.roles.reduce((a, r) => a.concat(r.ocupantes), []) : o.apuntados).some((n) => clave(n) === yo))
                ))[0];
                if (choque) return { off: true, txt: "Ocurre al mismo tiempo que «" + choque.titulo + "»" };
            }
            if (s.tipo === "ROLES") {
                const libres = s.roles.filter((r) => r.disponibles > 0).length;
                return { off: false, txt: libres + " rol" + (libres > 1 ? "es" : "") + " disponible" + (libres > 1 ? "s" : "") };
            }
            if (s.cupos) return { off: false, txt: s.disponibles + " lugar" + (s.disponibles > 1 ? "es" : "") + " disponible" + (s.disponibles > 1 ? "s" : "") };
            return { off: false, txt: "Sin límite de cupos" };
        }

        function pintarOpciones() {
            const cont = m.body.querySelector("[data-opciones]");
            if (!cont) return;
            // Si algo seleccionado quedó bloqueado (por ejemplo, por el nombre), se suelta.
            pub.datos.secciones.forEach((s) => { if (f.sel[s.id] && estadoSeccion(s).off) delete f.sel[s.id]; });
            cont.innerHTML = pub.datos.secciones.map((s) => {
                const est = estadoSeccion(s);
                const on = !!f.sel[s.id];
                let h = '<label class="opv-opcion' + (on ? " opv-opcion--on" : "") + (est.off && !on ? " opv-opcion--off" : "") + '">' +
                    '<input type="checkbox" data-sec="' + esc(s.id) + '"' + (on ? " checked" : "") + (est.off && !on ? " disabled" : "") + ">" +
                    '<span class="opv-opcion__t">' + esc(s.titulo) + "</span>" +
                    (s.cuando ? '<span class="opv-opcion__m">' + esc(s.cuando) + "</span>" : "") +
                    '<span class="opv-opcion__estado">' + esc(est.txt) + "</span>";
                if (on && s.tipo === "ROLES") {
                    h += '<span class="opv-rolpick" role="group" aria-label="Elige tu rol">' + s.roles.map((r) =>
                        '<button type="button" data-rol-sec="' + esc(s.id) + '" data-rol="' + esc(r.rol) + '" aria-pressed="' + (f.sel[s.id].rol === r.rol) + '"' +
                        (r.disponibles <= 0 ? " disabled" : "") + ">" + esc(r.rol) + "</button>"
                    ).join("") + "</span>";
                }
                return h + "</label>";
            }).join("");

            cont.querySelectorAll("[data-sec]").forEach((c) => {
                c.onchange = () => {
                    const id = c.getAttribute("data-sec");
                    if (c.checked) f.sel[id] = { rol: "" }; else delete f.sel[id];
                    pintarOpciones();
                };
            });
            cont.querySelectorAll("[data-rol]").forEach((b) => {
                b.onclick = (e) => {
                    e.preventDefault();
                    f.sel[b.getAttribute("data-rol-sec")].rol = b.getAttribute("data-rol");
                    pintarOpciones();
                };
            });
            const n = Object.keys(f.sel).length;
            const btn = m.foot.querySelector("[data-enviar]");
            if (btn) btn.textContent = n > 1 ? "Confirmar " + n + " lugares" : "Confirmar";
        }

        function pintarFormulario() {
            const d = pub.datos;
            m.body.innerHTML =
                (f.error ? '<p class="opv-error" role="alert">' + esc(f.error) + "</p>" : "") +
                '<label class="opv-field"><span>Nombre y apellido</span>' +
                '<input class="opv-input" data-nombre autocomplete="name" maxlength="60" placeholder="Ej.: Ana María Rojas" value="' + esc(f.nombre) + '">' +
                "<small>Así aparecerás en la lista.</small></label>" +
                (d.pedirContacto
                    ? '<label class="opv-field"><span>' + esc(d.etiquetaContacto) + '</span><input class="opv-input" data-contacto autocomplete="tel" maxlength="60" value="' + esc(f.contacto) + '"><small>Solo lo ve coordinación.</small></label>'
                    : "") +
                '<div class="opv-label" style="margin:4px 0 8px">¿Dónde quieres apoyar?</div>' +
                '<div class="opv-opciones" data-opciones></div>';
            m.foot.innerHTML =
                '<button type="button" class="opv-btn opv-btn--ghost" data-cancelar>Cancelar</button>' +
                '<button type="button" class="opv-btn opv-btn--primary" data-enviar>Confirmar</button>';
            const inNombre = m.body.querySelector("[data-nombre]");
            let t = null;
            inNombre.oninput = () => {
                f.nombre = inNombre.value;
                clearTimeout(t);
                t = setTimeout(pintarOpciones, 350);
            };
            const inContacto = m.body.querySelector("[data-contacto]");
            if (inContacto) inContacto.oninput = () => { f.contacto = inContacto.value; };
            m.foot.querySelector("[data-cancelar]").onclick = () => m.cerrar();
            m.foot.querySelector("[data-enviar]").onclick = enviar;
            pintarOpciones();
            if (!f.nombre) setTimeout(() => inNombre.focus(), 60);
        }

        async function enviar() {
            const nombre = f.nombre.replace(/\s+/g, " ").trim();
            const ids = Object.keys(f.sel);
            f.error = "";
            if (nombre.length < 5 || nombre.split(" ").length < 2) f.error = "Escribe tu nombre y tu apellido para identificarte en la lista.";
            else if (!ids.length) f.error = "Marca al menos un lugar donde quieres apoyar.";
            else {
                const sinRol = pub.datos.secciones.filter((s) => f.sel[s.id] && s.tipo === "ROLES" && !f.sel[s.id].rol)[0];
                if (sinRol) f.error = "Elige tu rol en «" + sinRol.titulo + "».";
            }
            if (f.error) { pintarFormulario(); m.body.scrollTop = 0; return; }

            const btn = m.foot.querySelector("[data-enviar]");
            btn.disabled = true;
            btn.textContent = "Guardando…";
            pub.enviando = true;
            try {
                const r = await api({
                    action: "inscribir", id: ruta.id, nombre, contacto: f.contacto,
                    selecciones: ids.map((id) => ({ id, rol: f.sel[id].rol || "" }))
                });
                lsSet(LS.nombre, nombre);
                if (f.contacto) lsSet(LS.contacto, f.contacto);
                guardarMias(misInscripciones().concat(r.comprobantes || []));
                pub.datos = r.datos;
                pintarEvento(true);
                exito(r);
            } catch (e) {
                f.error = e.message;
                f.sel = {};
                try { pub.datos = await api({ action: "evento", id: ruta.id }); pintarEvento(true); } catch (e2) { /* nada */ }
                pintarFormulario();
                m.body.scrollTop = 0;
            } finally {
                pub.enviando = false;
            }
        }

        function exito(r) {
            m.titulo("¡Listo!");
            m.body.innerHTML = '<div class="opv-ok-box"><div class="opv-ok-box__icon">' + ICON.check + "</div>" +
                "<h3>" + esc(r.mensaje) + "</h3><p class=\"opv-hint\">Te esperamos. Esto es lo que te toca:</p>" +
                '<div class="opv-resumen">' + r.resumen.map((s) =>
                    "<div><b>" + esc(s.titulo) + (s.rol ? " · " + esc(s.rol) : "") + "</b>" +
                    (s.cuando ? "<span>🕓 " + esc(s.cuando) + "</span>" : "") +
                    (s.donde ? "<span>📍 " + esc(s.donde) + "</span>" : "") +
                    (s.vestimenta ? "<span>👕 " + esc(s.vestimenta) + "</span>" : "") + "</div>"
                ).join("") + "</div></div>";
            m.foot.innerHTML = '<button type="button" class="opv-btn opv-btn--cyan opv-btn--block" data-ok>Ver la lista</button>';
            m.foot.querySelector("[data-ok]").onclick = () => m.cerrar();
        }

        pintarFormulario();
    }

    // ======================================================================
    //  ADMIN
    // ======================================================================

    const adm = { url: "", clave: "", datos: null, verArchivados: false, codigo: {} };

    async function vistaAdmin() {
        clearInterval(temporizador);
        document.title = "Admin · Operaciones VIVE";

        // Link de Admin con la clave adentro: se guarda y se limpia de la barra de direcciones.
        if (ruta.clave || ruta.dep) {
            if (ruta.dep) lsSet(LS.conexion, urlDesdeDep(ruta.dep));
            if (ruta.clave) lsSet(LS.clave, ruta.clave);
            history.replaceState(null, "", "#op_vive/" + (ruta.demo ? "demo/" : "") + "admin");
            ruta = leerRuta();
        }

        if (ruta.demo) {
            await cargarDemo();
            adm.url = "demo";
            adm.clave = window.OPVIVE_DEMO.clave();
        } else {
            adm.url = String(lsGet(LS.conexion, "") || urlFija() || "");
            adm.clave = String(lsGet(LS.clave, "") || "");
        }

        if (!adm.url || !adm.clave) return pintarConexion();
        app.innerHTML = barraSuperior() + '<main class="opv-main"><div class="opv-boot" style="min-height:50vh"><div class="opv-spinner"></div></div></main>';
        try {
            adm.datos = await api({ action: "admin_entrar", clave: adm.clave }, adm.url);
            pintarAdmin();
        } catch (e) {
            pintarConexion(e.message);
        }
    }

    function pintarConexion(error) {
        app.innerHTML = barraSuperior() +
            '<main class="opv-main">' +
            '<div class="opv-admin-title"><div><h1>Link de Admin</h1><p>Conecta Operaciones VIVE con el Google Sheets de la compañía.</p></div>' +
            '<a class="opv-btn opv-btn--ghost opv-btn--sm" href="#op_vive/demo/admin">Ver la demostración</a></div>' +
            (error ? '<p class="opv-error" role="alert">' + esc(error) + "</p>" : "") +
            '<section class="opv-card"><h2>Conectar</h2><p>Pega el enlace <b>/exec</b> de la implementación y la clave que aparece en la hoja <b>CONFIG</b>.</p>' +
            '<label class="opv-field"><span>Enlace /exec de Apps Script</span><input class="opv-input" data-url placeholder="https://script.google.com/macros/s/…/exec" value="' + esc(adm.url) + '"></label>' +
            '<label class="opv-field"><span>Clave de administración</span><input class="opv-input" data-clave placeholder="VIVE-XXXX-XXXX" autocomplete="off" value="' + esc(adm.clave) + '"></label>' +
            '<button type="button" class="opv-btn opv-btn--primary" data-conectar>Conectar</button></section>' +
            '<section class="opv-card"><h2>¿Primera vez? Instala el backend</h2>' +
            '<ol class="opv-steps">' +
            "<li>Crea (o abre) el <b>Google Sheets</b> donde vivirán los eventos de VIVE.</li>" +
            "<li>En el menú: <b>Extensiones ▸ Apps Script</b>.</li>" +
            "<li>Borra lo que haya en <b>Código.gs</b> y pega el código de abajo (botón <b>Copiar</b>).</li>" +
            "<li>En <b>Configuración del proyecto</b> (engranaje) marca <i>Mostrar el archivo de manifiesto appsscript.json</i> y reemplázalo por el segundo archivo.</li>" +
            "<li>Arriba elige la función <b>prepararHojas</b> y presiona <b>▶ Ejecutar</b>. Acepta los permisos. Se crean las hojas <b>CONFIG</b> y <b>EVENTOS</b>, y la clave queda en CONFIG.</li>" +
            "<li><b>Implementar ▸ Nueva implementación ▸ Aplicación web</b>. Ejecutar como: <b>Yo</b>. Quién tiene acceso: <b>Cualquier usuario</b>.</li>" +
            "<li>Copia el enlace que termina en <b>/exec</b>, pégalo arriba junto con la clave y presiona <b>Conectar</b>.</li>" +
            "</ol>" + visorCodigo() + "</section></main>";
        enlazarDemo();
        enlazarVisorCodigo();
        app.querySelector("[data-conectar]").onclick = async () => {
            const url = app.querySelector("[data-url]").value.trim();
            const cl = app.querySelector("[data-clave]").value.trim();
            if (!depDesdeUrl(url)) return toast("Ese enlace no parece un /exec de Apps Script.", "error");
            if (!cl) return toast("Falta la clave de administración.", "error");
            const btn = app.querySelector("[data-conectar]");
            btn.disabled = true;
            btn.textContent = "Conectando…";
            try {
                const limpio = urlDesdeDep(depDesdeUrl(url));
                adm.datos = await api({ action: "admin_entrar", clave: cl }, limpio);
                adm.url = limpio;
                adm.clave = cl;
                lsSet(LS.conexion, limpio);
                lsSet(LS.clave, cl);
                pintarAdmin();
                toast("Conectado con " + adm.datos.spreadsheet.nombre, "ok");
            } catch (e) {
                btn.disabled = false;
                btn.textContent = "Conectar";
                toast(e.message, "error");
            }
        };
    }

    // ---------- código de Apps Script para copiar ----------

    function visorCodigo() {
        return '<div data-visor><div class="opv-tabs" role="tablist">' +
            '<button type="button" role="tab" aria-selected="true" data-archivo="Codigo.gs">Código.gs</button>' +
            '<button type="button" role="tab" aria-selected="false" data-archivo="appsscript.json">appsscript.json</button>' +
            '<span class="opv-top__sp"></span>' +
            '<button type="button" class="opv-btn opv-btn--cyan opv-btn--sm" data-copiar-codigo>' + ICON.copiar + "Copiar</button></div>" +
            '<pre class="opv-code" data-codigo>Cargando…</pre></div>';
    }

    async function leerArchivo(nombre) {
        if (!adm.codigo[nombre]) {
            const r = await fetch("apps-script/" + nombre + "?v=" + (window.OPVIVE_ASSET_V || "1"), { cache: "no-cache" });
            if (!r.ok) throw new Error("No se pudo leer " + nombre);
            adm.codigo[nombre] = await r.text();
        }
        return adm.codigo[nombre];
    }

    function enlazarVisorCodigo() {
        const v = app.querySelector("[data-visor]");
        if (!v) return;
        let actual = "Codigo.gs";
        async function mostrar(nombre) {
            actual = nombre;
            v.querySelectorAll("[data-archivo]").forEach((b) => b.setAttribute("aria-selected", String(b.getAttribute("data-archivo") === nombre)));
            const pre = v.querySelector("[data-codigo]");
            try { pre.textContent = await leerArchivo(nombre); } catch (e) { pre.textContent = e.message; }
        }
        v.querySelectorAll("[data-archivo]").forEach((b) => { b.onclick = () => mostrar(b.getAttribute("data-archivo")); });
        v.querySelector("[data-copiar-codigo]").onclick = async () => {
            copiar(await leerArchivo(actual), (actual === "Codigo.gs" ? "Código.gs" : actual) + " copiado. Pégalo en Apps Script.");
        };
        mostrar(actual);
    }

    // ---------- tablero ----------

    function enlaceEvento(id) {
        const fija = urlFija();
        const dep = depDesdeUrl(adm.url);
        const necesitaDep = !ruta.demo && dep && (!fija || depDesdeUrl(fija) !== dep);
        return base() + "#op_vive/" + (ruta.demo ? "demo/" : "") + encodeURIComponent(id) + (necesitaDep ? "/s/" + dep : "");
    }
    function enlaceAdmin() {
        if (ruta.demo) return base() + "#op_vive/demo/admin";
        return base() + "#op_vive/admin/" + encodeURIComponent(adm.clave) + "/s/" + depDesdeUrl(adm.url);
    }

    function pintarAdmin() {
        const d = adm.datos;
        const visibles = d.eventos.filter((e) => adm.verArchivados || e.estado !== "ARCHIVADO");
        const archivados = d.eventos.filter((e) => e.estado === "ARCHIVADO").length;

        let h = barraSuperior('<span class="opv-top__pill"><span class="opv-dot opv-dot--ok"></span>' + esc(d.spreadsheet.nombre) + "</span>");
        h += '<main class="opv-main">';
        h += '<div class="opv-admin-title"><div><h1>Eventos</h1><p>' + esc(d.organizacion) + " · cada evento guarda sus inscripciones en su propia hoja.</p></div>" +
            '<button type="button" class="opv-btn opv-btn--primary" data-nuevo>' + ICON.mas + "Nuevo evento</button></div>";

        if (!visibles.length) {
            h += '<section class="opv-card opv-card--cyan"><h2>Todavía no hay eventos</h2><p>Crea el primero: elige <b>Operaciones Avanzado</b> o <b>Operaciones Introductorio</b> y ya nace con sus secciones listas para editar.</p>' +
                '<button type="button" class="opv-btn opv-btn--primary" data-nuevo>' + ICON.mas + "Crear el primer evento</button></section>";
        }

        h += '<div class="opv-eventos">' + visibles.map((ev) => {
            const link = enlaceEvento(ev.id);
            const estadoChip = ev.estado === "ABIERTO" ? "opv-chip--green" : ev.estado === "CERRADO" ? "opv-chip--amber" : "opv-chip--gray";
            return '<article class="opv-ev opv-ev--' + esc(ev.tipo) + (ev.estado === "ARCHIVADO" ? " opv-ev--archivado" : "") + '">' +
                '<div class="opv-ev__head"><div class="opv-ev__info">' +
                '<span class="opv-chip' + (ev.tipo === "avanzado" ? " opv-chip--red" : "") + '">' + esc(ev.tipoNombre) + "</span> " +
                '<span class="opv-chip ' + estadoChip + '">' + esc(ESTADOS[ev.estado] || ev.estado) + "</span>" +
                "<h3>" + esc(ev.nombre) + "</h3>" + (ev.fechas ? "<p>" + esc(ev.fechas) + "</p>" : "") +
                '<p class="opv-hint">Hoja: ' + esc(ev.hoja) + "</p></div>" +
                '<div class="opv-ev__stats"><b>' + ev.personas + "</b><small>persona" + (ev.personas === 1 ? "" : "s") + "<br>" + ev.inscripciones + " lugar" + (ev.inscripciones === 1 ? "" : "es") + "</small></div></div>" +
                '<div class="opv-ev__link"><div class="opv-link-box"><code>' + esc(link) + "</code>" +
                '<button type="button" class="opv-btn opv-btn--cyan opv-btn--sm" data-copiar="' + esc(link) + '">' + ICON.copiar + "Copiar</button></div></div>" +
                '<div class="opv-ev__actions">' +
                '<a class="opv-btn opv-btn--ghost opv-btn--sm" href="' + esc(link) + '" target="_blank" rel="noopener">Abrir</a>' +
                '<a class="opv-btn opv-btn--ghost opv-btn--sm" target="_blank" rel="noopener" href="https://wa.me/?text=' +
                encodeURIComponent("📋 " + ev.nombre + (ev.fechas ? " · " + ev.fechas : "") + "\nMira las listas y anótate donde quieras apoyar:\n" + link) + '">WhatsApp</a>' +
                '<button type="button" class="opv-btn opv-btn--ghost opv-btn--sm" data-editar="' + esc(ev.id) + '">Editar secciones</button>' +
                '<button type="button" class="opv-btn opv-btn--ghost opv-btn--sm" data-inscritos="' + esc(ev.id) + '">Inscritos</button>' +
                '<button type="button" class="opv-btn opv-btn--ghost opv-btn--sm" data-vista="' + esc(ev.id) + '">Vista en Sheets</button>' +
                '<select class="opv-select opv-select--sm" style="width:auto" data-estado="' + esc(ev.id) + '" aria-label="Estado del evento">' +
                Object.keys(ESTADOS).map((k) => '<option value="' + k + '"' + (k === ev.estado ? " selected" : "") + ">" + ESTADOS[k] + "</option>").join("") +
                "</select></div></article>";
        }).join("") + "</div>";

        if (archivados) {
            h += '<p style="text-align:center;margin:14px 0 22px"><button type="button" class="opv-btn opv-btn--ghost opv-btn--sm" data-archivados>' +
                (adm.verArchivados ? "Ocultar archivados" : "Mostrar " + archivados + " archivado" + (archivados > 1 ? "s" : "")) + "</button></p>";
        }

        h += '<section class="opv-card" style="margin-top:22px"><h2>Enlaces y conexión</h2>' +
            "<p>El link de Admin lleva la clave adentro: compártelo solo con coordinación.</p>" +
            '<div class="opv-label">Link de Admin</div><div class="opv-link-box"><code>' + esc(enlaceAdmin()) + "</code>" +
            '<button type="button" class="opv-btn opv-btn--cyan opv-btn--sm" data-copiar="' + esc(enlaceAdmin()) + '">' + ICON.copiar + "Copiar</button></div>" +
            '<div class="opv-row" style="margin-top:10px">' +
            (d.spreadsheet.url && d.spreadsheet.url !== "#" ? '<a class="opv-btn opv-btn--ghost opv-btn--sm" href="' + esc(d.spreadsheet.url) + '" target="_blank" rel="noopener">Abrir el Google Sheets</a>' : "") +
            '<button type="button" class="opv-btn opv-btn--ghost opv-btn--sm" data-salir>' + (ruta.demo ? "Salir de la demostración" : "Cambiar conexión") + "</button>" +
            '<span class="opv-hint">Backend versión ' + esc(d.version) + '<span data-version-aviso></span></span></div></section>';

        h += '<details class="opv-card"><summary style="cursor:pointer;font-weight:900;font-size:1.1rem">Código de Apps Script</summary>' +
            '<p style="margin:10px 0 12px;color:var(--ink-2)">Cuando haya una versión nueva: pega el código encima del anterior y en <b>Implementar ▸ Gestionar implementaciones</b> edita la implementación actual con <b>Versión: nueva</b>. Así el /exec y todos los enlaces siguen iguales.</p>' +
            visorCodigo() + "</details>";
        h += "</main>";

        app.innerHTML = h;
        enlazarDemo();

        app.querySelectorAll("[data-nuevo]").forEach((b) => { b.onclick = nuevoEvento; });
        app.querySelectorAll("[data-copiar]").forEach((b) => { b.onclick = () => copiar(b.getAttribute("data-copiar"), "Enlace copiado"); });
        app.querySelectorAll("[data-editar]").forEach((b) => { b.onclick = () => editarEvento(b.getAttribute("data-editar")); });
        app.querySelectorAll("[data-inscritos]").forEach((b) => { b.onclick = () => verInscritos(b.getAttribute("data-inscritos")); });
        app.querySelectorAll("[data-vista]").forEach((b) => {
            b.onclick = async () => {
                b.disabled = true;
                try { toast((await api({ action: "admin_vista", clave: adm.clave, id: b.getAttribute("data-vista") }, adm.url)).mensaje, "ok"); }
                catch (e) { toast(e.message, "error"); }
                b.disabled = false;
            };
        });
        app.querySelectorAll("[data-estado]").forEach((s) => {
            s.onchange = async () => {
                const id = s.getAttribute("data-estado");
                try {
                    adm.datos = await api({ action: "admin_guardar_evento", clave: adm.clave, id, evento: { estado: s.value } }, adm.url);
                    pintarAdmin();
                    toast("Estado: " + ESTADOS[s.value], "ok");
                } catch (e) { toast(e.message, "error"); pintarAdmin(); }
            };
        });
        const arch = app.querySelector("[data-archivados]");
        if (arch) arch.onclick = () => { adm.verArchivados = !adm.verArchivados; pintarAdmin(); };
        app.querySelector("[data-salir]").onclick = () => {
            if (ruta.demo) { location.hash = "#op_vive/admin"; return; }
            lsDel(LS.clave);
            adm.clave = "";
            pintarConexion();
        };
        enlazarVisorCodigo();
        leerArchivo("Codigo.gs").then((txt) => {
            const m = txt.match(/OPV_VERSION\s*=\s*'([^']+)'/);
            const aviso = app.querySelector("[data-version-aviso]");
            if (m && aviso && m[1] !== d.version) aviso.textContent = " · hay una versión nueva (" + m[1] + "): actualiza el código.";
        }).catch(() => {});
    }

    // ---------- crear evento ----------

    function nuevoEvento() {
        const f = { tipo: "avanzado", nombre: "", fechas: "", copiarDe: "" };
        const m = abrirModal({ titulo: "Nuevo evento" });
        function pintar() {
            const tipo = TIPOS_UI.filter((t) => t.id === f.tipo)[0];
            const mismos = adm.datos.eventos.filter((e) => e.tipo === f.tipo);
            m.body.innerHTML =
                '<div class="opv-label" style="margin-bottom:8px">Tipo de evento</div>' +
                '<div class="opv-opciones" style="margin-bottom:16px">' + TIPOS_UI.map((t) =>
                    '<label class="opv-opcion' + (t.id === f.tipo ? " opv-opcion--on" : "") + '"><input type="checkbox" data-tipo="' + t.id + '"' + (t.id === f.tipo ? " checked" : "") + ">" +
                    '<span class="opv-opcion__t">' + esc(t.nombre) + '</span><span class="opv-opcion__m">' + esc(t.detalle) + "</span></label>"
                ).join("") + "</div>" +
                '<label class="opv-field"><span>Nombre</span><input class="opv-input" data-n maxlength="90" placeholder="Ej.: ' + esc(tipo.ejemplo) + '" value="' + esc(f.nombre) + '">' +
                "<small>También será el nombre de su hoja y de su enlace.</small></label>" +
                '<label class="opv-field"><span>Fechas</span><input class="opv-input" data-f maxlength="120" placeholder="Ej.: Nov 11 – 15" value="' + esc(f.fechas) + '"></label>' +
                (mismos.length
                    ? '<label class="opv-field"><span>Secciones iniciales</span><select class="opv-select" data-c>' +
                    '<option value="">Plantilla de ' + esc(tipo.nombre) + "</option>" +
                    mismos.map((e) => '<option value="' + esc(e.id) + '"' + (f.copiarDe === e.id ? " selected" : "") + ">Copiar las de «" + esc(e.nombre) + "»</option>").join("") +
                    "</select><small>Copiar trae secciones, roles y textos; las inscripciones no se copian.</small></label>"
                    : "");
            m.body.querySelectorAll("[data-tipo]").forEach((c) => { c.onchange = () => { f.tipo = c.getAttribute("data-tipo"); f.copiarDe = ""; pintar(); }; });
            m.body.querySelector("[data-n]").oninput = (e) => { f.nombre = e.target.value; };
            m.body.querySelector("[data-f]").oninput = (e) => { f.fechas = e.target.value; };
            const c = m.body.querySelector("[data-c]");
            if (c) c.onchange = () => { f.copiarDe = c.value; };
        }
        m.foot.innerHTML = '<button type="button" class="opv-btn opv-btn--ghost" data-x>Cancelar</button><button type="button" class="opv-btn opv-btn--primary" data-ok>Crear evento</button>';
        m.foot.querySelector("[data-x]").onclick = () => m.cerrar();
        m.foot.querySelector("[data-ok]").onclick = async (e) => {
            const btn = e.currentTarget;
            if (f.nombre.trim().length < 3) return toast("Escribe el nombre del evento.", "error");
            btn.disabled = true;
            btn.textContent = "Creando…";
            try {
                adm.datos = await api({ action: "admin_crear_evento", clave: adm.clave, tipo: f.tipo, nombre: f.nombre, fechas: f.fechas, copiarDe: f.copiarDe }, adm.url);
                m.cerrar();
                pintarAdmin();
                toast(adm.datos.mensaje, "ok");
            } catch (err) {
                btn.disabled = false;
                btn.textContent = "Crear evento";
                toast(err.message, "error");
            }
        };
        pintar();
        setTimeout(() => { const n = m.body.querySelector("[data-n]"); if (n) n.focus(); }, 60);
    }

    // ---------- editar evento y secciones ----------

    function editarEvento(id) {
        const ev = adm.datos.eventos.filter((e) => e.id === id)[0];
        if (!ev) return;
        const ed = {
            nombre: ev.nombre,
            fechas: ev.fechas,
            estado: ev.estado,
            config: JSON.parse(JSON.stringify(ev.config))
        };
        ed.config.notasTxt = (ed.config.notas || []).join("\n");
        const abiertas = {};
        const m = abrirModal({ titulo: "Editar · " + ev.nombre, ancho: true, fijo: true });

        function fijar(ruta2, valor) {
            const p = ruta2.split(".");
            let o = ed;
            for (let i = 0; i < p.length - 1; i++) o = o[p[i]];
            o[p[p.length - 1]] = valor;
        }
        function campo(etq, ruta2, valor, opc) {
            opc = opc || {};
            const ctrl = opc.area
                ? '<textarea class="opv-textarea" data-k="' + ruta2 + '" placeholder="' + esc(opc.ph || "") + '">' + esc(valor) + "</textarea>"
                : '<input class="opv-input opv-input--sm" data-k="' + ruta2 + '"' + (opc.num ? ' type="number" min="0" inputmode="numeric" data-num' : "") +
                ' placeholder="' + esc(opc.ph || "") + '" value="' + esc(valor) + '">';
            return '<label class="opv-field"><span>' + esc(etq) + "</span>" + ctrl + (opc.hint ? "<small>" + esc(opc.hint) + "</small>" : "") + "</label>";
        }

        function pintar() {
            const c = ed.config;
            let h = '<div class="opv-grid2">' +
                campo("Nombre del evento", "nombre", ed.nombre) +
                campo("Fechas", "fechas", ed.fechas, { ph: "Nov 11 – 15" }) + "</div>" +
                campo("Presentación", "config.presentacion", c.presentacion, { area: true, ph: "Frase de bienvenida" }) +
                campo("Notas generales (una por línea)", "config.notasTxt", c.notasTxt, { area: true, hint: "Aparecen arriba, en rojo suave, para todo el evento." }) +
                campo("Mensaje cuando está cerrado", "config.mensajeCerrado", c.mensajeCerrado, { ph: "Las inscripciones de este evento están cerradas." }) +
                '<label class="opv-check"><input type="checkbox" data-k="config.permitirQuitarse"' + (c.permitirQuitarse ? " checked" : "") + "> Permitir que cada persona se quite desde su teléfono</label>" +
                '<label class="opv-check"><input type="checkbox" data-k="config.pedirContacto"' + (c.pedirContacto ? " checked" : "") + "> Pedir un dato de contacto (solo lo ve coordinación)</label>" +
                (c.pedirContacto ? campo("Nombre del campo de contacto", "config.etiquetaContacto", c.etiquetaContacto, { ph: "WhatsApp" }) : "") +
                '<h3 style="margin:22px 0 10px;font-weight:900">Secciones</h3>';

            c.secciones.forEach((s, i) => {
                const abierta = !!abiertas[i];
                h += '<div class="opv-ed-sec' + (s.activa === false ? " opv-ed-sec--off" : "") + '">' +
                    '<div class="opv-ed-sec__head">' +
                    '<button type="button" class="opv-icon-btn" data-abrir="' + i + '" aria-label="' + (abierta ? "Cerrar" : "Abrir") + '">' + (abierta ? "−" : "+") + "</button>" +
                    "<strong>" + esc(s.titulo || "Sin título") + '</strong><span class="opv-chip opv-chip--gray">' + (s.tipo === "ROLES" ? s.roles.length + " roles" : (s.cupos ? s.cupos + " cupos" : "sin límite")) + "</span>" +
                    '<button type="button" class="opv-icon-btn" data-subir="' + i + '"' + (i === 0 ? " disabled" : "") + ' aria-label="Subir">↑</button>' +
                    '<button type="button" class="opv-icon-btn" data-bajar="' + i + '"' + (i === c.secciones.length - 1 ? " disabled" : "") + ' aria-label="Bajar">↓</button>' +
                    '<button type="button" class="opv-icon-btn opv-icon-btn--danger" data-borrar="' + i + '" aria-label="Eliminar">×</button></div>';
                if (abierta) {
                    const p = "config.secciones." + i + ".";
                    h += '<div class="opv-ed-sec__body"><div class="opv-grid2">' +
                        campo("Título", p + "titulo", s.titulo) +
                        '<label class="opv-field"><span>Tipo</span><select class="opv-select opv-select--sm" data-k="' + p + 'tipo" data-repintar>' +
                        '<option value="LISTA"' + (s.tipo !== "ROLES" ? " selected" : "") + ">Lista de nombres</option>" +
                        '<option value="ROLES"' + (s.tipo === "ROLES" ? " selected" : "") + ">Roles fijos (un puesto por persona)</option></select></label>" +
                        (s.tipo !== "ROLES" ? campo("Cupos", p + "cupos", s.cupos, { num: true, hint: "0 = sin límite" }) : "") +
                        campo("Cuándo", p + "cuando", s.cuando, { ph: "Sábado 14 · 4:00 pm" }) +
                        campo("Dónde nos vemos", p + "donde", s.donde, { ph: "Salón principal" }) +
                        campo("Vestimenta", p + "vestimenta", s.vestimenta) +
                        campo("Aviso (amarillo)", p + "aviso", s.aviso, { ph: "Hora sujeta al avance del equipo" }) +
                        campo("Grupo de horario", p + "grupo", s.grupo, { ph: "sabado-tarde", hint: "Secciones con el mismo grupo no se pueden combinar." }) +
                        "</div>" +
                        campo("Instrucciones", p + "instrucciones", s.instrucciones, { area: true }) +
                        '<label class="opv-check"><input type="checkbox" data-k="' + p + 'activa"' + (s.activa !== false ? " checked" : "") + " data-repintar> Visible en la página</label>";
                    if (s.tipo === "ROLES") {
                        h += '<div class="opv-label" style="margin:6px 0">Roles</div><div class="opv-ed-roles">' +
                            s.roles.map((r, j) => {
                                const q = p + "roles." + j + ".";
                                return '<div class="opv-ed-rol">' +
                                    '<input class="opv-input opv-input--sm" data-k="' + q + 'rol" placeholder="Nombre del rol" value="' + esc(r.rol) + '">' +
                                    '<input class="opv-input opv-input--sm" data-k="' + q + 'cupos" data-num type="number" min="1" title="Personas" value="' + esc(r.cupos || 1) + '">' +
                                    '<input class="opv-input opv-input--sm opv-ed-rol__nota" data-k="' + q + 'nota" placeholder="Nota (opcional)" value="' + esc(r.nota) + '">' +
                                    '<button type="button" class="opv-icon-btn opv-icon-btn--danger" data-borrar-rol="' + i + "." + j + '" aria-label="Quitar rol">×</button></div>';
                            }).join("") + "</div>" +
                            '<button type="button" class="opv-btn opv-btn--ghost opv-btn--sm" data-agregar-rol="' + i + '">' + ICON.mas + "Agregar rol</button>";
                    }
                    h += "</div>";
                }
                h += "</div>";
            });
            h += '<button type="button" class="opv-btn opv-btn--ghost" data-agregar-sec>' + ICON.mas + "Agregar sección</button>";
            m.body.innerHTML = h;

            m.body.querySelectorAll("[data-k]").forEach((el) => {
                const k = el.getAttribute("data-k");
                const evento = el.tagName === "SELECT" || el.type === "checkbox" ? "change" : "input";
                el.addEventListener(evento, () => {
                    let v = el.type === "checkbox" ? el.checked : el.value;
                    if (el.hasAttribute("data-num")) v = Math.max(0, parseInt(v, 10) || 0);
                    fijar(k, v);
                    if (el.hasAttribute("data-repintar") || k === "config.pedirContacto") pintar();
                });
            });
            m.body.querySelectorAll("[data-abrir]").forEach((b) => { b.onclick = () => { const i = +b.getAttribute("data-abrir"); abiertas[i] = !abiertas[i]; pintar(); }; });
            m.body.querySelectorAll("[data-subir],[data-bajar]").forEach((b) => {
                b.onclick = () => {
                    const i = +(b.getAttribute("data-subir") || b.getAttribute("data-bajar"));
                    const j = b.hasAttribute("data-subir") ? i - 1 : i + 1;
                    const arr = ed.config.secciones;
                    [arr[i], arr[j]] = [arr[j], arr[i]];
                    [abiertas[i], abiertas[j]] = [abiertas[j], abiertas[i]];
                    pintar();
                };
            });
            m.body.querySelectorAll("[data-borrar]").forEach((b) => {
                b.onclick = async () => {
                    const i = +b.getAttribute("data-borrar");
                    if (!(await confirmar("¿Eliminar «" + (ed.config.secciones[i].titulo || "esta sección") + "»? Si tiene gente anotada, el servidor no lo permitirá: mejor desactívala.", { ok: "Eliminar", peligro: true }))) return;
                    ed.config.secciones.splice(i, 1);
                    Object.keys(abiertas).forEach((k) => delete abiertas[k]);
                    pintar();
                };
            });
            m.body.querySelectorAll("[data-agregar-rol]").forEach((b) => {
                b.onclick = () => { ed.config.secciones[+b.getAttribute("data-agregar-rol")].roles.push({ rol: "", cupos: 1, nota: "" }); pintar(); };
            });
            m.body.querySelectorAll("[data-borrar-rol]").forEach((b) => {
                b.onclick = () => { const [i, j] = b.getAttribute("data-borrar-rol").split(".").map(Number); ed.config.secciones[i].roles.splice(j, 1); pintar(); };
            });
            m.body.querySelector("[data-agregar-sec]").onclick = () => {
                ed.config.secciones.push({ id: "", activa: true, titulo: "Nueva sección", cuando: "", donde: "", vestimenta: "", instrucciones: "", aviso: "", tipo: "LISTA", cupos: 10, grupo: "", roles: [] });
                abiertas[ed.config.secciones.length - 1] = true;
                pintar();
                m.body.scrollTop = m.body.scrollHeight;
            };
        }

        m.foot.innerHTML = '<a class="opv-btn opv-btn--ghost" href="' + esc(enlaceEvento(id)) + '" target="_blank" rel="noopener">Ver página</a>' +
            '<span class="opv-top__sp"></span>' +
            '<button type="button" class="opv-btn opv-btn--ghost" data-x>Cancelar</button><button type="button" class="opv-btn opv-btn--primary" data-ok>Guardar cambios</button>';
        m.foot.querySelector("[data-x]").onclick = () => m.cerrar();
        m.foot.querySelector("[data-ok]").onclick = async (e) => {
            const btn = e.currentTarget;
            const config = Object.assign({}, ed.config, { notas: String(ed.config.notasTxt || "").split("\n") });
            delete config.notasTxt;
            btn.disabled = true;
            btn.textContent = "Guardando…";
            try {
                adm.datos = await api({ action: "admin_guardar_evento", clave: adm.clave, id, evento: { nombre: ed.nombre, fechas: ed.fechas, estado: ed.estado, config } }, adm.url);
                m.cerrar();
                pintarAdmin();
                toast("Cambios guardados", "ok");
            } catch (err) {
                btn.disabled = false;
                btn.textContent = "Guardar cambios";
                toast(err.message, "error");
            }
        };
        pintar();
    }

    // ---------- inscritos ----------

    async function verInscritos(id) {
        const m = abrirModal({ titulo: "Inscritos", ancho: true });
        m.body.innerHTML = '<div class="opv-boot" style="min-height:200px"><div class="opv-spinner"></div></div>';
        let datos = null;
        let filtro = "";
        let verCanceladas = false;

        async function cargar() {
            datos = await api({ action: "admin_inscritos", clave: adm.clave, id }, adm.url);
            m.titulo("Inscritos · " + datos.evento.nombre);
        }

        function textoWhatsApp() {
            const ev = datos.evento;
            const activos = datos.inscritos.filter((i) => i.estado !== "CANCELADA");
            let t = "*" + ev.nombre + "*" + (ev.fechas ? "\n" + ev.fechas : "") + "\n";
            ev.config.secciones.filter((s) => s.activa !== false).forEach((s) => {
                const gente = activos.filter((i) => clave(i.seccion) === clave(s.id));
                t += "\n*" + s.titulo + "*" + (s.cuando ? " · " + s.cuando : "") + "\n";
                if (s.tipo === "ROLES") {
                    s.roles.forEach((r) => {
                        const q = gente.filter((i) => clave(i.rol) === clave(r.rol)).map((i) => i.nombre);
                        t += "• " + r.rol + ": " + (q.join(", ") || "—") + "\n";
                    });
                } else {
                    gente.forEach((i, k) => { t += (k + 1) + ". " + i.nombre + "\n"; });
                    if (!gente.length) t += "—\n";
                }
            });
            return t + "\n" + enlaceEvento(id);
        }

        function pintar() {
            const ev = datos.evento;
            const secs = ev.config.secciones;
            const filas = datos.inscritos.filter((i) => (!filtro || clave(i.seccion) === clave(filtro)) && (verCanceladas || i.estado !== "CANCELADA"));
            const secSel = secs[0];
            m.body.innerHTML =
                '<div class="opv-card opv-card--cyan" style="padding:14px"><div class="opv-label" style="margin-bottom:8px">Anotar a alguien</div>' +
                '<div class="opv-grid2"><label class="opv-field"><span>Nombre y apellido</span><input class="opv-input opv-input--sm" data-an></label>' +
                '<label class="opv-field"><span>Sección</span><select class="opv-select opv-select--sm" data-as>' +
                secs.map((s) => '<option value="' + esc(s.id) + '">' + esc(s.titulo) + "</option>").join("") + "</select></label>" +
                '<label class="opv-field" data-ar-wrap' + (secSel && secSel.tipo === "ROLES" ? "" : " hidden") + '><span>Rol</span><select class="opv-select opv-select--sm" data-ar></select></label></div>' +
                '<button type="button" class="opv-btn opv-btn--cyan opv-btn--sm" data-anotar>' + ICON.mas + "Anotar</button>" +
                ' <span class="opv-hint">Funciona aunque el evento esté cerrado.</span></div>' +
                '<div class="opv-row" style="margin-bottom:10px">' +
                '<select class="opv-select opv-select--sm" style="width:auto" data-filtro><option value="">Todas las secciones</option>' +
                secs.map((s) => '<option value="' + esc(s.id) + '"' + (filtro === s.id ? " selected" : "") + ">" + esc(s.titulo) + "</option>").join("") + "</select>" +
                '<label class="opv-check" style="margin:0"><input type="checkbox" data-vc' + (verCanceladas ? " checked" : "") + "> Ver canceladas</label>" +
                '<span class="opv-top__sp"></span>' +
                '<button type="button" class="opv-btn opv-btn--ghost opv-btn--sm" data-wa>' + ICON.copiar + "Copiar lista para WhatsApp</button></div>" +
                (filas.length
                    ? '<div class="opv-table-wrap"><table class="opv-table"><thead><tr><th>Nombre</th><th>Sección</th><th>Rol</th>' +
                    (ev.config.pedirContacto ? "<th>" + esc(ev.config.etiquetaContacto) + "</th>" : "") + "<th>Fecha</th><th></th></tr></thead><tbody>" +
                    filas.map((i) => '<tr class="' + (i.estado === "CANCELADA" ? "opv-cancelada" : "") + '"><td><b>' + esc(i.nombre) + "</b></td><td>" + esc(i.seccionTitulo) + "</td><td>" + esc(i.rol || "—") + "</td>" +
                        (ev.config.pedirContacto ? "<td>" + esc(i.contacto || "—") + "</td>" : "") +
                        "<td>" + esc(fechaCorta(i.marca)) + "</td><td>" +
                        (i.estado === "CANCELADA"
                            ? '<button type="button" class="opv-btn opv-btn--ghost opv-btn--sm" data-reactivar="' + esc(i.comprobante) + '">Reactivar</button>'
                            : '<button type="button" class="opv-btn opv-btn--danger opv-btn--sm" data-cancelar="' + esc(i.comprobante) + '">Quitar</button>') +
                        "</td></tr>").join("") + "</tbody></table></div>"
                    : '<p class="opv-hint" style="text-align:center;padding:24px 0">No hay inscripciones aquí todavía.</p>');

            const selS = m.body.querySelector("[data-as]");
            const selR = m.body.querySelector("[data-ar]");
            const wrapR = m.body.querySelector("[data-ar-wrap]");
            function rolesDe() {
                const s = secs.filter((x) => x.id === selS.value)[0];
                wrapR.hidden = !(s && s.tipo === "ROLES");
                selR.innerHTML = s && s.tipo === "ROLES" ? s.roles.map((r) => '<option value="' + esc(r.rol) + '">' + esc(r.rol) + "</option>").join("") : "";
            }
            selS.onchange = rolesDe;
            rolesDe();
            m.body.querySelector("[data-anotar]").onclick = async (e) => {
                const btn = e.currentTarget;
                btn.disabled = true;
                try {
                    await api({ action: "admin_inscribir", clave: adm.clave, id, nombre: m.body.querySelector("[data-an]").value, selecciones: [{ id: selS.value, rol: selR.value || "" }] }, adm.url);
                    await cargar();
                    pintar();
                    toast("Anotado", "ok");
                } catch (err) { toast(err.message, "error"); btn.disabled = false; }
            };
            m.body.querySelector("[data-filtro]").onchange = (e) => { filtro = e.target.value; pintar(); };
            m.body.querySelector("[data-vc]").onchange = (e) => { verCanceladas = e.target.checked; pintar(); };
            m.body.querySelector("[data-wa]").onclick = () => copiar(textoWhatsApp(), "Lista copiada. Pégala en WhatsApp.");
            m.body.querySelectorAll("[data-cancelar],[data-reactivar]").forEach((b) => {
                b.onclick = async () => {
                    const reactivar = b.hasAttribute("data-reactivar");
                    const comp = b.getAttribute(reactivar ? "data-reactivar" : "data-cancelar");
                    if (!reactivar) {
                        const fila = datos.inscritos.filter((i) => i.comprobante === comp)[0];
                        if (!(await confirmar("¿Quitar a " + fila.nombre + " de «" + fila.seccionTitulo + "»? La fila queda en la hoja como CANCELADA.", { ok: "Quitar", peligro: true }))) return;
                    }
                    try {
                        datos = await api({ action: "admin_estado_inscripcion", clave: adm.clave, id, comprobante: comp, estado: reactivar ? "ACTIVA" : "CANCELADA" }, adm.url);
                        pintar();
                    } catch (err) { toast(err.message, "error"); }
                };
            });
        }

        m.foot.innerHTML = '<button type="button" class="opv-btn opv-btn--ghost" data-x>Cerrar</button>';
        m.foot.querySelector("[data-x]").onclick = () => m.cerrar();
        try {
            await cargar();
            pintar();
        } catch (e) {
            m.body.innerHTML = '<p class="opv-error">' + esc(e.message) + "</p>";
        }
        // Al cerrar, el tablero refleja los conteos nuevos.
        const cerrarOriginal = m.cerrar;
        m.cerrar = function () {
            cerrarOriginal();
            api({ action: "admin_eventos", clave: adm.clave }, adm.url).then((r) => { adm.datos = r; if (ruta.modo === "admin") pintarAdmin(); }).catch(() => {});
        };
        m.el.querySelector(".opv-modal__x").onclick = () => m.cerrar();
        m.el.querySelector(".opv-modal__bg").onclick = () => m.cerrar();
        m.foot.querySelector("[data-x]").onclick = () => m.cerrar();
    }

    // ======================================================================
    //  ARRANQUE
    // ======================================================================

    function iniciar() {
        ruta = leerRuta();
        while (pila.length) pila[pila.length - 1].cerrar();
        if (ruta.modo === "admin") return vistaAdmin();
        if (ruta.modo === "evento") return vistaEvento();
        return vistaInicio();
    }

    window.addEventListener("hashchange", iniciar);
    iniciar();
})();
