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
        { id: "introductorio", nombre: "Operaciones Introductorio", ejemplo: "Intro 39", detalle: "Montaje de Salón, Línea de Elección y Camino de Luz, Upgrade y Graduación. Sin reglas: solo listas." },
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
        // Texto + ✕ para cerrarlo; siempre encima de las ventanas.
        const texto = document.createElement("span");
        texto.textContent = msg;
        const cerrar = document.createElement("button");
        cerrar.type = "button";
        cerrar.className = "opv-toast__close";
        cerrar.setAttribute("aria-label", "Cerrar aviso");
        cerrar.textContent = "×";
        cerrar.addEventListener("click", () => { clearTimeout(toastTimer); el.className = "opv-toast"; });
        el.replaceChildren(texto, cerrar);
        el.className = "opv-toast show" + (tipo ? " " + tipo : "");
        el.setAttribute("role", tipo === "error" ? "alert" : "status");
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => { el.className = "opv-toast"; }, tipo === "error" ? 6000 : 3200);
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
        if (partes[0] === "admin") {
            const sub = partes[1] || "";
            if (sub === "k") return { modo: "admin", vista: "eventos", clave: partes[2] || "", dep, demo };
            if (sub === "hojas" || sub === "codigo") return { modo: "admin", vista: sub, dep, demo };
            if (sub === "evento") return { modo: "admin", vista: "evento", id: partes[2] || "", dep, demo };
            // Links de Admin de la primera versión: #op_vive/admin/<clave>/s/<id>
            return { modo: "admin", vista: "eventos", clave: sub, dep, demo };
        }
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
        if (conservarScroll) window.scrollTo({ top: y, behavior: "instant" });

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
    //  Menú: Eventos · Spreadsheets · Código Apps Script
    //  Cada spreadsheet ligado guarda todos sus eventos; cada evento tiene su
    //  página de edición de posiciones y su enlace para la comunidad.
    // ======================================================================

    const LS_HOJAS = "opvive-hojas";
    const LS_ACTIVA = "opvive-hoja-activa";
    const adm = { hoja: null, datos: null, datosDe: "", verArchivados: false, filtroTipo: "", codigo: {}, ed: null, sucio: false };

    function hashAdmin(sub) {
        return "#op_vive/" + (ruta.demo ? "demo/" : "") + "admin" + (sub ? "/" + sub : "");
    }

    /** Spreadsheets ligados en este navegador: [{ id, nombre, url, clave }]. */
    function hojasGuardadas() {
        let lista = lsGet(LS_HOJAS, null);
        if (!Array.isArray(lista)) {
            // Conexión guardada por la primera versión del Admin.
            lista = [];
            const url = String(lsGet(LS.conexion, "") || "");
            const cl = String(lsGet(LS.clave, "") || "");
            if (url && cl) lista.push({ id: "h" + Date.now().toString(36), nombre: "VIVE", url, clave: cl });
            lsSet(LS_HOJAS, lista);
        }
        return lista;
    }
    function guardarHojas(lista) { lsSet(LS_HOJAS, lista); }
    function hojaActiva() {
        if (ruta.demo) return { id: "demo", nombre: "Spreadsheet de prueba", url: "demo", clave: window.OPVIVE_DEMO.clave() };
        // Solo cuenta un spreadsheet con su contraseña guardada (sesión abierta).
        const lista = hojasGuardadas().filter((h) => h.clave);
        const id = lsGet(LS_ACTIVA, "");
        return lista.filter((h) => h.id === id)[0] || lista[0] || null;
    }
    /** Cierra la sesión: olvida las contraseñas, conserva los /exec para volver a entrar. */
    function cerrarSesion() {
        guardarHojas(hojasGuardadas().map((h) => Object.assign({}, h, { clave: "" })));
        lsDel(LS.clave);
        adm.hoja = null;
        adm.datos = null;
        adm.datosDe = "";
        adm.ed = null;
        adm.sucio = false;
    }
    function activarHoja(h) {
        lsSet(LS_ACTIVA, h.id);
        lsSet(LS.conexion, h.url);
        adm.hoja = h;
        adm.datos = null;
        adm.datosDe = "";
    }

    /** Llamada al backend del spreadsheet activo, con su clave. */
    function A(payload) {
        return api(Object.assign({ clave: adm.hoja.clave }, payload), adm.hoja.url);
    }

    function enlaceEvento(id) {
        const fija = urlFija();
        const dep = depDesdeUrl(adm.hoja && adm.hoja.url);
        const necesitaDep = !ruta.demo && dep && (!fija || depDesdeUrl(fija) !== dep);
        return base() + "#op_vive/" + (ruta.demo ? "demo/" : "") + encodeURIComponent(id) + (necesitaDep ? "/s/" + dep : "");
    }
    /** Link de Admin: por defecto pide contraseña; con conClave entra directo. */
    function enlaceAdminDe(h, conClave) {
        if (ruta.demo) return base() + "#op_vive/demo/admin";
        const dep = depDesdeUrl(h.url);
        const fija = depDesdeUrl(urlFija()) === dep;
        if (conClave) return base() + "#op_vive/admin/k/" + encodeURIComponent(h.clave) + "/s/" + dep;
        return base() + "#op_vive/admin" + (fija ? "" : "/s/" + dep);
    }

    function shellAdmin(vista, contenido) {
        const tabs = [["eventos", "Eventos", ""], ["hojas", "Spreadsheets", "hojas"], ["codigo", "Código Apps Script", "codigo"]];
        const pill = adm.hoja
            ? '<span class="opv-top__pill"><span class="opv-dot' + (adm.datos && adm.datosDe === adm.hoja.id ? " opv-dot--ok" : "") + '"></span>' + esc(adm.hoja.nombre) + "</span>"
            : "";
        app.innerHTML = barraSuperior(pill) +
            '<nav class="opv-admnav" aria-label="Menú de administración"><div class="opv-admnav__in">' +
            tabs.map((t) => '<a href="' + hashAdmin(t[2]) + '"' +
                (vista === t[0] || (vista === "evento" && t[0] === "eventos") ? ' aria-current="page"' : "") + ">" + t[1] + "</a>").join("") +
            (ruta.demo ? "" : '<span class="opv-top__sp"></span><button type="button" class="opv-admnav__salir" data-cerrar-sesion>Cerrar sesión</button>') +
            "</div></nav>" +
            '<main class="opv-main">' + contenido + "</main>";
        enlazarDemo();
        const salir = app.querySelector("[data-cerrar-sesion]");
        if (salir) {
            salir.onclick = async () => {
                if (adm.sucio && !(await confirmar("Tienes cambios sin guardar en este evento. Si cierras sesión se pierden.", { ok: "Cerrar sesión", peligro: true }))) return;
                cerrarSesion();
                if (ruta.vista === "eventos") pintarCandado();
                else location.hash = hashAdmin("");
                toast("Sesión cerrada");
            };
        }
    }

    function campo(etq, k, valor, opc) {
        opc = opc || {};
        const ctrl = opc.area
            ? '<textarea class="opv-textarea" data-k="' + k + '" placeholder="' + esc(opc.ph || "") + '">' + esc(valor) + "</textarea>"
            : '<input class="opv-input opv-input--sm" data-k="' + k + '"' + (opc.num ? ' type="number" min="0" inputmode="numeric" data-num' : "") +
            ' placeholder="' + esc(opc.ph || "") + '" value="' + esc(valor == null ? "" : valor) + '">';
        return '<label class="opv-field"><span>' + esc(etq) + "</span>" + ctrl + (opc.hint ? "<small>" + esc(opc.hint) + "</small>" : "") + "</label>";
    }

    async function vistaAdmin() {
        clearInterval(temporizador);
        document.title = "Admin · Operaciones VIVE";
        if (ruta.demo) await cargarDemo();

        // Link de Admin compartible (#op_vive/admin/k/<clave>/s/<id>): liga el spreadsheet y limpia la barra.
        if (ruta.clave && ruta.dep && !ruta.demo) {
            const lista = hojasGuardadas();
            let h = lista.filter((x) => depDesdeUrl(x.url) === ruta.dep)[0];
            if (h) h.clave = ruta.clave;
            else {
                h = { id: "h" + Date.now().toString(36), nombre: "VIVE", url: urlDesdeDep(ruta.dep), clave: ruta.clave };
                lista.push(h);
            }
            guardarHojas(lista);
            activarHoja(h);
            history.replaceState(null, "", hashAdmin(""));
            ruta = leerRuta();
            hashPrevio = location.hash;
        }

        // Link de Admin sin contraseña (#op_vive/admin/s/<id>): recuerda a qué spreadsheet entrar y pide la contraseña.
        if (ruta.dep && !ruta.clave && !ruta.demo) {
            const lista = hojasGuardadas();
            if (!lista.some((x) => depDesdeUrl(x.url) === ruta.dep)) {
                lista.push({ id: "h" + Date.now().toString(36), nombre: "VIVE", url: urlDesdeDep(ruta.dep), clave: "" });
                guardarHojas(lista);
            }
            lsSet(LS.conexion, urlDesdeDep(ruta.dep));
            history.replaceState(null, "", hashAdmin(""));
            ruta = leerRuta();
            hashPrevio = location.hash;
        }

        adm.hoja = hojaActiva();
        if (adm.datosDe && (!adm.hoja || adm.datosDe !== adm.hoja.id)) { adm.datos = null; adm.datosDe = ""; }
        // Sin sesión abierta no se ve nada del Admin: primero la contraseña.
        if (!ruta.demo && !adm.hoja) return pintarCandado();
        if (ruta.vista === "hojas") return pintarHojas();
        if (ruta.vista === "codigo") return pintarCodigo();
        if (!adm.hoja) return pintarSinHoja();

        const vista = ruta.vista;
        const enCache = !!adm.datos;
        if (enCache) {
            if (vista === "evento") return pintarEditor(ruta.id);
            pintarEventos();
        } else {
            shellAdmin(vista, '<div class="opv-boot" style="min-height:40vh"><div class="opv-spinner"></div></div>');
        }
        try {
            const r = await A({ action: "admin_entrar" });
            if (ruta.modo !== "admin" || ruta.vista !== vista) return;
            adm.datos = r;
            adm.datosDe = adm.hoja.id;
        } catch (e) {
            if (ruta.modo !== "admin" || ruta.vista !== vista) return;
            if (e.codigo === "clave" && !ruta.demo) {
                cerrarSesion();
                return pintarCandado("La contraseña cambió en el Google Sheets. Escribe la nueva para continuar.");
            }
            if (!enCache) pintarSinHoja(e.message);
            else toast(e.message, "error");
            return;
        }
        if (vista === "evento") return pintarEditor(ruta.id);
        pintarEventos();
    }

    // ---------- contraseña ----------

    /** Los /exec conocidos en este navegador (o fijo en conexion.js) contra los que se prueba la contraseña. */
    function urlsCandidatas() {
        const vistas = {};
        const out = [];
        [urlFija(), String(lsGet(LS.conexion, "") || "")].concat(hojasGuardadas().map((h) => h.url)).forEach((u) => {
            const dep = depDesdeUrl(u);
            if (dep && !vistas[dep]) { vistas[dep] = true; out.push(urlDesdeDep(dep)); }
        });
        return out;
    }

    function pintarCandado(error, pedirExec) {
        document.title = "Acceso · Operaciones VIVE";
        const candidatas = urlsCandidatas();
        const conExec = pedirExec || !candidatas.length;
        app.innerHTML = barraSuperior() +
            '<main class="opv-main"><div class="opv-candado">' +
            '<img src="' + LOGO + '" alt="VIVE">' +
            '<span class="opv-chip">Operaciones · Admin</span>' +
            "<h1>Acceso de administración</h1>" +
            "<p>Escribe la contraseña para crear eventos, editar posiciones y ver inscritos.</p>" +
            (error ? '<p class="opv-error" role="alert">' + esc(error) + "</p>" : "") +
            '<form data-candado autocomplete="on">' +
            '<input type="text" name="username" value="Operaciones VIVE" autocomplete="username" hidden>' +
            (conExec
                ? '<label class="opv-field"><span>Enlace /exec del Google Sheets</span><input class="opv-input" data-exec placeholder="https://script.google.com/macros/s/…/exec"><small>Solo la primera vez en este dispositivo.</small></label>'
                : "") +
            '<label class="opv-field"><span>Contraseña</span><input class="opv-input" type="password" data-pass autocomplete="current-password" required></label>' +
            '<button type="submit" class="opv-btn opv-btn--primary opv-btn--block" data-entrar>Entrar</button></form>' +
            '<p class="opv-hint" style="margin-top:14px">La contraseña es la <b>Clave de administración</b> de la hoja CONFIG del Google Sheets.' +
            (conExec ? "" : ' <a href="#" data-otro-exec>¿Entrar a otro spreadsheet?</a>') + "</p>" +
            '<p style="margin-top:18px"><a class="opv-btn opv-btn--ghost opv-btn--sm" href="#op_vive/demo/admin">Ver la demostración</a></p>' +
            "</div></main>";
        enlazarDemo();
        const otro = app.querySelector("[data-otro-exec]");
        if (otro) otro.onclick = (e) => { e.preventDefault(); pintarCandado("", true); };
        const pass = app.querySelector("[data-pass]");
        setTimeout(() => (app.querySelector("[data-exec]") || pass).focus(), 50);

        app.querySelector("[data-candado]").onsubmit = async (e) => {
            e.preventDefault();
            const clave = pass.value.trim();
            const inExec = app.querySelector("[data-exec]");
            let urls = candidatas;
            if (inExec) {
                const dep = depDesdeUrl(inExec.value);
                if (!dep) return toast("Ese enlace no parece un /exec de Apps Script.", "error");
                urls = [urlDesdeDep(dep)];
            }
            if (!clave) return;
            const btn = app.querySelector("[data-entrar]");
            btn.disabled = true;
            btn.textContent = "Verificando…";
            let ultimo = null;
            for (const url of urls) {
                try {
                    const r = await api({ action: "admin_entrar", clave }, url);
                    const lista = hojasGuardadas();
                    let h = lista.filter((x) => depDesdeUrl(x.url) === depDesdeUrl(url))[0];
                    if (!h) { h = { id: "h" + Date.now().toString(36), nombre: "VIVE", url }; lista.push(h); }
                    if (!h.nombre || h.nombre === "VIVE") h.nombre = r.spreadsheet.nombre || "VIVE";
                    h.clave = clave;
                    guardarHojas(lista);
                    activarHoja(h);
                    adm.datos = r;
                    adm.datosDe = h.id;
                    toast("Sesión iniciada", "ok");
                    return vistaAdmin();
                } catch (err) {
                    ultimo = err;
                    if (err.codigo === "bloqueado") break;
                }
            }
            btn.disabled = false;
            btn.textContent = "Entrar";
            const msg = !ultimo ? "No se pudo verificar." : ultimo.codigo === "clave" ? "Contraseña incorrecta." : ultimo.message;
            const prev = app.querySelector(".opv-candado .opv-error");
            if (prev) prev.textContent = msg;
            else app.querySelector("[data-candado]").insertAdjacentHTML("beforebegin", '<p class="opv-error" role="alert">' + esc(msg) + "</p>");
            pass.select();
        };
    }

    function pintarSinHoja(error) {
        shellAdmin("eventos",
            '<div class="opv-admin-title"><div><h1>Eventos</h1><p>Aquí creas cada Introductorio y cada Avanzado, editas sus posiciones y copias su enlace.</p></div></div>' +
            '<section class="opv-card opv-card--cyan"><h2>' +
            (adm.hoja ? "No hay conexión con «" + esc(adm.hoja.nombre) + "»" : "Liga primero el spreadsheet de VIVE") + "</h2>" +
            "<p>" + (adm.hoja
                ? esc(error || "No se pudo leer el spreadsheet.")
                : "Los eventos y la configuración de cada uno se guardan en un Google Sheets. Lígalo una vez y desde aquí creas y editas todos los eventos.") + "</p>" +
            '<div class="opv-row">' +
            (adm.hoja ? '<button type="button" class="opv-btn opv-btn--cyan" data-reintentar>Reintentar</button>' : "") +
            '<a class="opv-btn opv-btn--primary" href="' + hashAdmin("hojas") + '">' + (adm.hoja ? "Revisar spreadsheets" : "Ligar un spreadsheet") + "</a>" +
            (ruta.demo ? "" : '<a class="opv-btn opv-btn--ghost" href="#op_vive/demo/admin">Ver la demostración</a>') +
            "</div></section>");
        const r = app.querySelector("[data-reintentar]");
        if (r) r.onclick = () => vistaAdmin();
    }

    // ---------- Spreadsheets ----------

    function pintarHojas() {
        const lista = ruta.demo ? [] : hojasGuardadas();
        let h = '<div class="opv-admin-title"><div><h1>Spreadsheets</h1>' +
            "<p>Cada spreadsheet guarda todos sus eventos y la configuración de cada uno. Aquí los ligas con Operaciones VIVE.</p></div></div>";

        if (ruta.demo) {
            h += '<section class="opv-card opv-card--cyan"><h2>Spreadsheet de prueba</h2>' +
                "<p>La demostración usa un spreadsheet ficticio que vive en este navegador. Para ligar el de VIVE, sal de la demostración.</p>" +
                '<a class="opv-btn opv-btn--primary" href="#op_vive/admin/hojas">Ir a los spreadsheets reales</a></section>';
            return shellAdmin("hojas", h);
        }

        if (lista.length) {
            h += '<div class="opv-eventos" style="margin-bottom:16px">' + lista.map((x) => {
                const activo = adm.hoja && adm.hoja.id === x.id;
                return '<article class="opv-ev"><div class="opv-ev__head"><div class="opv-ev__info">' +
                    (activo ? '<span class="opv-chip opv-chip--green">En uso</span>' : '<span class="opv-chip opv-chip--gray">Ligado</span>') +
                    "<h3>" + esc(x.nombre) + '</h3><p class="opv-hint" style="overflow-wrap:anywhere">' + esc(x.url) + "</p></div></div>" +
                    '<div class="opv-ev__actions">' +
                    (activo ? "" : '<button type="button" class="opv-btn opv-btn--cyan opv-btn--sm" data-usar="' + esc(x.id) + '">Usar este</button>') +
                    '<button type="button" class="opv-btn opv-btn--ghost opv-btn--sm" data-copiar="' + esc(enlaceAdminDe(x)) + '" title="Al abrirlo pide la contraseña">' + ICON.copiar + "Copiar link de Admin</button>" +
                    (x.clave ? '<button type="button" class="opv-btn opv-btn--ghost opv-btn--sm" data-copiar="' + esc(enlaceAdminDe(x, true)) + '" title="Entra directo, sin pedir contraseña">' + ICON.copiar + "Con contraseña incluida</button>" : "") +
                    '<button type="button" class="opv-btn opv-btn--ghost opv-btn--sm" data-editar-hoja="' + esc(x.id) + '">Editar</button>' +
                    '<button type="button" class="opv-btn opv-btn--danger opv-btn--sm" data-quitar-hoja="' + esc(x.id) + '">Desligar</button>' +
                    "</div></article>";
            }).join("") + "</div>";
        }

        h += '<section class="opv-card" data-form-hoja><h2 data-form-titulo>Ligar un spreadsheet</h2>' +
            "<p>Pega el enlace <b>/exec</b> de su implementación y la clave que aparece en su hoja <b>CONFIG</b>. ¿Todavía no tiene el código? Está en <a href=\"" + hashAdmin("codigo") + "\">Código Apps Script</a>.</p>" +
            '<input type="hidden" data-h-id>' +
            '<label class="opv-field"><span>Nombre para reconocerlo</span><input class="opv-input" data-h-nombre maxlength="60" placeholder="Ej.: VIVE Costa Rica"></label>' +
            '<label class="opv-field"><span>Enlace /exec de Apps Script</span><input class="opv-input" data-h-url placeholder="https://script.google.com/macros/s/…/exec"></label>' +
            '<label class="opv-field"><span>Clave de administración</span><input class="opv-input" data-h-clave placeholder="VIVE-XXXX-XXXX" autocomplete="off"></label>' +
            '<div class="opv-row"><button type="button" class="opv-btn opv-btn--primary" data-h-guardar>Probar y ligar</button>' +
            '<button type="button" class="opv-btn opv-btn--ghost" data-h-cancelar hidden>Cancelar</button></div></section>' +
            '<p class="opv-hint">Los spreadsheets ligados se recuerdan en este navegador. «Copiar link de Admin» da un enlace que pide la contraseña al abrirlo. «Con contraseña incluida» entra directo: compártelo solo con coordinación.</p>';
        shellAdmin("hojas", h);

        const f = {
            id: app.querySelector("[data-h-id]"), nombre: app.querySelector("[data-h-nombre]"),
            url: app.querySelector("[data-h-url]"), clave: app.querySelector("[data-h-clave]"),
            btn: app.querySelector("[data-h-guardar]"), cancelar: app.querySelector("[data-h-cancelar]"),
            titulo: app.querySelector("[data-form-titulo]")
        };
        app.querySelectorAll("[data-copiar]").forEach((b) => { b.onclick = () => copiar(b.getAttribute("data-copiar"), "Link de Admin copiado"); });
        app.querySelectorAll("[data-usar]").forEach((b) => {
            b.onclick = () => {
                activarHoja(lista.filter((x) => x.id === b.getAttribute("data-usar"))[0]);
                location.hash = hashAdmin("");
            };
        });
        app.querySelectorAll("[data-editar-hoja]").forEach((b) => {
            b.onclick = () => {
                const x = lista.filter((y) => y.id === b.getAttribute("data-editar-hoja"))[0];
                f.id.value = x.id; f.nombre.value = x.nombre; f.url.value = x.url; f.clave.value = x.clave;
                f.titulo.textContent = "Editar «" + x.nombre + "»";
                f.btn.textContent = "Probar y guardar";
                f.cancelar.hidden = false;
                app.querySelector("[data-form-hoja]").scrollIntoView({ behavior: "smooth" });
            };
        });
        f.cancelar.onclick = () => pintarHojas();
        app.querySelectorAll("[data-quitar-hoja]").forEach((b) => {
            b.onclick = async () => {
                const x = lista.filter((y) => y.id === b.getAttribute("data-quitar-hoja"))[0];
                if (!(await confirmar("Se deja de ver «" + x.nombre + "» en este navegador. El spreadsheet y sus eventos no se tocan; los enlaces de la comunidad siguen funcionando.", { ok: "Desligar", peligro: true }))) return;
                guardarHojas(lista.filter((y) => y.id !== x.id));
                if (lsGet(LS_ACTIVA, "") === x.id) lsDel(LS_ACTIVA);
                adm.datos = null;
                adm.datosDe = "";
                adm.hoja = hojaActiva();
                pintarHojas();
            };
        });
        f.btn.onclick = async () => {
            const url = f.url.value.trim();
            const cl = f.clave.value.trim();
            if (!depDesdeUrl(url)) return toast("Ese enlace no parece un /exec de Apps Script.", "error");
            if (!cl) return toast("Falta la clave de administración.", "error");
            const texto = f.btn.textContent;
            f.btn.disabled = true;
            f.btn.textContent = "Probando…";
            try {
                const limpio = urlDesdeDep(depDesdeUrl(url));
                const r = await api({ action: "admin_entrar", clave: cl }, limpio);
                const todas = hojasGuardadas();
                let x = todas.filter((y) => y.id === f.id.value)[0] || todas.filter((y) => depDesdeUrl(y.url) === depDesdeUrl(limpio))[0];
                if (!x) { x = { id: "h" + Date.now().toString(36) }; todas.push(x); }
                x.nombre = f.nombre.value.trim() || r.spreadsheet.nombre || "VIVE";
                x.url = limpio;
                x.clave = cl;
                guardarHojas(todas);
                activarHoja(x);
                adm.datos = r;
                adm.datosDe = x.id;
                toast("«" + x.nombre + "» ligado", "ok");
                location.hash = hashAdmin("");
            } catch (e) {
                f.btn.disabled = false;
                f.btn.textContent = texto;
                toast(e.message, "error");
            }
        };
    }

    // ---------- Código de Apps Script ----------

    function pintarCodigo() {
        shellAdmin("codigo",
            '<div class="opv-admin-title"><div><h1>Código Apps Script</h1><p>El backend que se pega en cada Google Sheets de Operaciones VIVE.</p></div></div>' +
            '<section class="opv-card"><h2>Instalar en un spreadsheet nuevo</h2><ol class="opv-steps">' +
            "<li>Crea (o abre) el <b>Google Sheets</b> donde vivirán los eventos.</li>" +
            "<li>En el menú: <b>Extensiones ▸ Apps Script</b>.</li>" +
            "<li>Borra lo que haya en <b>Código.gs</b> y pega el código de abajo (botón <b>Copiar</b>).</li>" +
            "<li>En <b>Configuración del proyecto</b> (engranaje) marca <i>Mostrar el archivo de manifiesto appsscript.json</i> y reemplázalo por el segundo archivo.</li>" +
            "<li>Arriba elige la función <b>prepararHojas</b> y presiona <b>▶ Ejecutar</b>. Acepta los permisos. Se crean las hojas <b>CONFIG</b> y <b>EVENTOS</b>, y la clave queda en CONFIG.</li>" +
            "<li><b>Implementar ▸ Nueva implementación ▸ Aplicación web</b>. Ejecutar como: <b>Yo</b>. Quién tiene acceso: <b>Cualquier usuario</b>.</li>" +
            '<li>Copia el enlace que termina en <b>/exec</b> y lígalo en <a href="' + hashAdmin("hojas") + '">Spreadsheets</a> junto con la clave.</li>' +
            "</ol>" + visorCodigo() +
            '<p class="opv-hint" style="margin-top:12px">Para actualizar uno que ya funciona: pega el código encima del anterior y en <b>Implementar ▸ Gestionar implementaciones</b> edita la implementación actual con <b>Versión: nueva</b>. Así el /exec y todos los enlaces siguen iguales.</p></section>');
        enlazarVisorCodigo();
    }

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

    // ---------- Eventos ----------

    function tipoDe(ev) {
        return ev.tipo === "avanzado" || ev.tipo === "introductorio" ? ev.tipo : "otro";
    }

    function pintarEventos() {
        const d = adm.datos;
        const lista = ruta.demo ? [] : hojasGuardadas();
        const noArch = d.eventos.filter((e) => e.estado !== "ARCHIVADO");
        const cuenta = (t) => noArch.filter((e) => !t || tipoDe(e) === t).length;
        const visibles = d.eventos.filter((e) => (adm.verArchivados || e.estado !== "ARCHIVADO") && (!adm.filtroTipo || tipoDe(e) === adm.filtroTipo));
        const archivados = d.eventos.filter((e) => e.estado === "ARCHIVADO").length;

        let h = '<div class="opv-admin-title"><div><h1>Eventos</h1><p>Cada Introductorio y cada Avanzado guarda su configuración e inscripciones en su propia hoja.</p></div>' +
            '<button type="button" class="opv-btn opv-btn--primary" data-nuevo>' + ICON.mas + "Nuevo evento</button></div>";

        if (lista.length > 1) {
            h += '<label class="opv-field" style="max-width:420px"><span>Spreadsheet</span><select class="opv-select opv-select--sm" data-cambiar-hoja>' +
                lista.map((x) => '<option value="' + esc(x.id) + '"' + (x.id === adm.hoja.id ? " selected" : "") + ">" + esc(x.nombre) + "</option>").join("") +
                "</select></label>";
        }

        h += '<div class="opv-tabs" role="tablist" aria-label="Filtrar por tipo">' +
            [["", "Todos"], ["avanzado", "Operaciones Avanzado"], ["introductorio", "Operaciones Introductorio"], ["otro", "Otros"]]
                .filter((t) => !t[0] || t[0] !== "otro" || cuenta("otro"))
                .map((t) => '<button type="button" role="tab" data-filtro-tipo="' + t[0] + '" aria-selected="' + (adm.filtroTipo === t[0]) + '">' + t[1] + " · " + cuenta(t[0]) + "</button>").join("") +
            "</div>";

        if (!visibles.length) {
            h += '<section class="opv-card opv-card--cyan"><h2>' + (d.eventos.length ? "No hay eventos de este tipo" : "Todavía no hay eventos") + "</h2>" +
                "<p>Crea uno: elige <b>Operaciones Avanzado</b> u <b>Operaciones Introductorio</b> y nace con sus posiciones listas para editar.</p>" +
                '<button type="button" class="opv-btn opv-btn--primary" data-nuevo>' + ICON.mas + "Nuevo evento</button></section>";
        }

        h += '<div class="opv-eventos">' + visibles.map((ev) => {
            const link = enlaceEvento(ev.id);
            const estadoChip = ev.estado === "ABIERTO" ? "opv-chip--green" : ev.estado === "CERRADO" ? "opv-chip--amber" : "opv-chip--gray";
            const pos = (ev.config.secciones || []).filter((s) => s.activa !== false);
            return '<article class="opv-ev opv-ev--' + esc(ev.tipo) + (ev.estado === "ARCHIVADO" ? " opv-ev--archivado" : "") + '">' +
                '<div class="opv-ev__head"><div class="opv-ev__info">' +
                '<span class="opv-chip' + (ev.tipo === "avanzado" ? " opv-chip--red" : "") + '">' + esc(ev.tipoNombre) + "</span> " +
                '<span class="opv-chip ' + estadoChip + '">' + esc(ESTADOS[ev.estado] || ev.estado) + "</span>" +
                "<h3>" + esc(ev.nombre) + "</h3>" + (ev.fechas ? "<p>" + esc(ev.fechas) + "</p>" : "") + "</div>" +
                '<div class="opv-ev__stats"><b>' + ev.personas + "</b><small>persona" + (ev.personas === 1 ? "" : "s") + "<br>" + ev.inscripciones + " lugar" + (ev.inscripciones === 1 ? "" : "es") + "</small></div></div>" +
                (pos.length ? '<ul class="opv-ev__pos">' + pos.map((s) => "<li><b>" + esc(s.titulo) + "</b>" + (s.cuando ? " · " + esc(s.cuando) : "") + "</li>").join("") + "</ul>" : "") +
                '<div class="opv-ev__link"><div class="opv-link-box"><code>' + esc(link) + "</code>" +
                '<button type="button" class="opv-btn opv-btn--cyan opv-btn--sm" data-copiar="' + esc(link) + '">' + ICON.copiar + "Copiar</button></div></div>" +
                '<div class="opv-ev__actions">' +
                '<a class="opv-btn opv-btn--primary opv-btn--sm" href="' + hashAdmin("evento/" + encodeURIComponent(ev.id)) + '">Editar posiciones y textos</a>' +
                '<button type="button" class="opv-btn opv-btn--ghost opv-btn--sm" data-inscritos="' + esc(ev.id) + '">Inscritos</button>' +
                '<a class="opv-btn opv-btn--ghost opv-btn--sm" href="' + esc(link) + '" target="_blank" rel="noopener">Abrir</a>' +
                '<a class="opv-btn opv-btn--ghost opv-btn--sm" target="_blank" rel="noopener" href="' + esc(enlaceWhatsApp(ev, link)) + '">WhatsApp</a>' +
                '<button type="button" class="opv-btn opv-btn--ghost opv-btn--sm" data-vista="' + esc(ev.id) + '">Vista en Sheets</button>' +
                '<select class="opv-select opv-select--sm" style="width:auto" data-estado="' + esc(ev.id) + '" aria-label="Estado del evento">' +
                Object.keys(ESTADOS).map((k) => '<option value="' + k + '"' + (k === ev.estado ? " selected" : "") + ">" + ESTADOS[k] + "</option>").join("") +
                "</select></div></article>";
        }).join("") + "</div>";

        if (archivados) {
            h += '<p style="text-align:center;margin:14px 0 22px"><button type="button" class="opv-btn opv-btn--ghost opv-btn--sm" data-archivados>' +
                (adm.verArchivados ? "Ocultar archivados" : "Mostrar " + archivados + " archivado" + (archivados > 1 ? "s" : "")) + "</button></p>";
        }

        h += '<p class="opv-hint" style="margin-top:22px">Spreadsheet: <b>' + esc(d.spreadsheet.nombre) + "</b>" +
            (d.spreadsheet.url && d.spreadsheet.url !== "#" ? ' · <a href="' + esc(d.spreadsheet.url) + '" target="_blank" rel="noopener">Abrir en Google Sheets</a>' : "") +
            " · Backend versión " + esc(d.version) + '<span data-version-aviso></span></p>';

        shellAdmin("eventos", h);

        app.querySelectorAll("[data-nuevo]").forEach((b) => { b.onclick = nuevoEvento; });
        app.querySelectorAll("[data-copiar]").forEach((b) => { b.onclick = () => copiar(b.getAttribute("data-copiar"), "Enlace copiado"); });
        app.querySelectorAll("[data-inscritos]").forEach((b) => { b.onclick = () => verInscritos(b.getAttribute("data-inscritos")); });
        app.querySelectorAll("[data-filtro-tipo]").forEach((b) => { b.onclick = () => { adm.filtroTipo = b.getAttribute("data-filtro-tipo"); pintarEventos(); }; });
        app.querySelectorAll("[data-vista]").forEach((b) => {
            b.onclick = async () => {
                b.disabled = true;
                try { toast((await A({ action: "admin_vista", id: b.getAttribute("data-vista") })).mensaje, "ok"); }
                catch (e) { toast(e.message, "error"); }
                b.disabled = false;
            };
        });
        app.querySelectorAll("[data-estado]").forEach((s) => {
            s.onchange = async () => {
                try {
                    adm.datos = await A({ action: "admin_guardar_evento", id: s.getAttribute("data-estado"), evento: { estado: s.value } });
                    pintarEventos();
                    toast("Estado: " + ESTADOS[s.value], "ok");
                } catch (e) { toast(e.message, "error"); pintarEventos(); }
            };
        });
        const cambiar = app.querySelector("[data-cambiar-hoja]");
        if (cambiar) cambiar.onchange = () => { activarHoja(lista.filter((x) => x.id === cambiar.value)[0]); vistaAdmin(); };
        const arch = app.querySelector("[data-archivados]");
        if (arch) arch.onclick = () => { adm.verArchivados = !adm.verArchivados; pintarEventos(); };
        leerArchivo("Codigo.gs").then((txt) => {
            const m = txt.match(/OPV_VERSION\s*=\s*'([^']+)'/);
            const aviso = app.querySelector("[data-version-aviso]");
            if (m && aviso && m[1] !== d.version) {
                aviso.innerHTML = ' · <a href="' + hashAdmin("codigo") + '">hay una versión nueva (' + esc(m[1]) + "): actualiza el código</a>";
            }
        }).catch(() => {});
    }

    function enlaceWhatsApp(ev, link) {
        return "https://wa.me/?text=" + encodeURIComponent("✅ " + ev.nombre + (ev.fechas ? " · " + ev.fechas : "") + "\nMira las listas y anótate donde quieras apoyar:\n" + link);
    }

    // ---------- crear evento ----------

    function nuevoEvento() {
        const f = { tipo: adm.filtroTipo === "introductorio" ? "introductorio" : "avanzado", nombre: "", fechas: "", copiarDe: "" };
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
                    ? '<label class="opv-field"><span>Posiciones iniciales</span><select class="opv-select" data-c>' +
                    '<option value="">Plantilla de ' + esc(tipo.nombre) + "</option>" +
                    mismos.map((e) => '<option value="' + esc(e.id) + '"' + (f.copiarDe === e.id ? " selected" : "") + ">Copiar las de «" + esc(e.nombre) + "»</option>").join("") +
                    "</select><small>Copiar trae posiciones, horarios, vestimenta y textos; las inscripciones no se copian.</small></label>"
                    : "");
            m.body.querySelectorAll("[data-tipo]").forEach((c) => { c.onchange = () => { f.tipo = c.getAttribute("data-tipo"); f.copiarDe = ""; pintar(); }; });
            m.body.querySelector("[data-n]").oninput = (e) => { f.nombre = e.target.value; };
            m.body.querySelector("[data-f]").oninput = (e) => { f.fechas = e.target.value; };
            const c = m.body.querySelector("[data-c]");
            if (c) c.onchange = () => { f.copiarDe = c.value; };
        }
        m.foot.innerHTML = '<button type="button" class="opv-btn opv-btn--ghost" data-x>Cancelar</button><button type="button" class="opv-btn opv-btn--primary" data-ok>Crear y editar posiciones</button>';
        m.foot.querySelector("[data-x]").onclick = () => m.cerrar();
        m.foot.querySelector("[data-ok]").onclick = async (e) => {
            const btn = e.currentTarget;
            if (f.nombre.trim().length < 3) return toast("Escribe el nombre del evento.", "error");
            btn.disabled = true;
            btn.textContent = "Creando…";
            try {
                adm.datos = await A({ action: "admin_crear_evento", tipo: f.tipo, nombre: f.nombre, fechas: f.fechas, copiarDe: f.copiarDe });
                adm.datosDe = adm.hoja.id;
                m.cerrar();
                toast(adm.datos.mensaje, "ok");
                location.hash = hashAdmin("evento/" + encodeURIComponent(adm.datos.creado));
            } catch (err) {
                btn.disabled = false;
                btn.textContent = "Crear y editar posiciones";
                toast(err.message, "error");
            }
        };
        pintar();
        setTimeout(() => { const n = m.body.querySelector("[data-n]"); if (n) n.focus(); }, 60);
    }

    // ---------- página de edición: datos del evento y posiciones ----------

    function pintarEditor(id) {
        const ev = adm.datos.eventos.filter((e) => clave(e.id) === clave(id))[0];
        if (!ev) {
            return shellAdmin("evento", '<div class="opv-msg"><h1>No encontramos ese evento</h1><p>Puede que se haya creado en otro spreadsheet.</p>' +
                '<p><a class="opv-btn opv-btn--ghost" href="' + hashAdmin("") + '">Volver a Eventos</a></p></div>');
        }
        if (!adm.ed || adm.ed.id !== ev.id) {
            adm.ed = { id: ev.id, nombre: ev.nombre, fechas: ev.fechas, estado: ev.estado, config: JSON.parse(JSON.stringify(ev.config)) };
            adm.ed.config.notasTxt = (adm.ed.config.notas || []).join("\n");
            adm.sucio = false;
        }
        const ed = adm.ed;
        const c = ed.config;
        const link = enlaceEvento(ev.id);
        document.title = "Editar " + ev.nombre + " · Operaciones VIVE";
        const y = window.scrollY;

        let h = '<p style="margin:0 0 6px"><a class="opv-back" href="' + hashAdmin("") + '">← Eventos</a></p>' +
            '<div class="opv-admin-title"><div>' +
            '<span class="opv-chip' + (ev.tipo === "avanzado" ? " opv-chip--red" : "") + '">' + esc(ev.tipoNombre) + "</span>" +
            '<h1 style="margin-top:6px">' + esc(ev.nombre) + "</h1><p>Hoja: " + esc(ev.hoja) + " · " + ev.personas + " persona" + (ev.personas === 1 ? "" : "s") + " anotada" + (ev.personas === 1 ? "" : "s") + "</p></div>" +
            '<label class="opv-field" style="margin:0"><span>Estado</span><select class="opv-select opv-select--sm" data-k="estado">' +
            Object.keys(ESTADOS).map((k) => '<option value="' + k + '"' + (k === ed.estado ? " selected" : "") + ">" + ESTADOS[k] + "</option>").join("") +
            "</select></label></div>";

        h += '<section class="opv-card"><h2>Enlace para la comunidad</h2><p>Compártelo para que cada persona vea las listas y se anote.</p>' +
            '<div class="opv-link-box"><code>' + esc(link) + '</code><button type="button" class="opv-btn opv-btn--cyan opv-btn--sm" data-copiar="' + esc(link) + '">' + ICON.copiar + "Copiar</button></div>" +
            '<div class="opv-row" style="margin-top:8px"><a class="opv-btn opv-btn--ghost opv-btn--sm" href="' + esc(link) + '" target="_blank" rel="noopener">Ver como la comunidad</a>' +
            '<a class="opv-btn opv-btn--ghost opv-btn--sm" target="_blank" rel="noopener" href="' + esc(enlaceWhatsApp(ev, link)) + '">Compartir por WhatsApp</a>' +
            '<button type="button" class="opv-btn opv-btn--ghost opv-btn--sm" data-inscritos="' + esc(ev.id) + '">Inscritos</button></div></section>';

        h += '<section class="opv-card"><h2>Datos del evento</h2><p>Lo primero que ve la comunidad al abrir el enlace.</p>' +
            '<div class="opv-grid2">' + campo("Nombre del evento", "nombre", ed.nombre) + campo("Fechas", "fechas", ed.fechas, { ph: "Nov 11 – 15" }) + "</div>" +
            campo("Presentación", "config.presentacion", c.presentacion, { area: true, ph: "Frase de bienvenida" }) +
            campo("Notas generales (una por línea)", "config.notasTxt", c.notasTxt, { area: true, hint: "Aparecen arriba, en rojo suave, para todo el evento." }) +
            campo("Mensaje cuando está cerrado", "config.mensajeCerrado", c.mensajeCerrado, { ph: "Las inscripciones de este evento están cerradas." }) +
            '<label class="opv-check"><input type="checkbox" data-k="config.permitirQuitarse"' + (c.permitirQuitarse ? " checked" : "") + "> Permitir que cada persona se quite desde su teléfono</label>" +
            '<label class="opv-check"><input type="checkbox" data-k="config.pedirContacto" data-repintar' + (c.pedirContacto ? " checked" : "") + "> Pedir un dato de contacto (solo lo ve coordinación)</label>" +
            (c.pedirContacto ? campo("Nombre del campo de contacto", "config.etiquetaContacto", c.etiquetaContacto, { ph: "WhatsApp" }) : "") +
            "</section>";

        h += '<div class="opv-admin-title" style="margin-top:26px"><div><h1 style="font-size:1.5rem">Posiciones</h1>' +
            "<p>Horarios, vestimenta y textos tal como los ve la comunidad. Ordénalas con las flechas.</p></div>" +
            '<button type="button" class="opv-btn opv-btn--ghost" data-agregar-sec>' + ICON.mas + "Agregar posición</button></div>";

        h += c.secciones.map((s, i) => posicionHtml(s, i, c.secciones.length)).join("");
        if (!c.secciones.length) h += '<p class="opv-hint">Este evento todavía no tiene posiciones.</p>';
        h += '<p style="text-align:center"><button type="button" class="opv-btn opv-btn--ghost" data-agregar-sec>' + ICON.mas + "Agregar posición</button></p>";

        h += '<div class="opv-savebar"><div class="opv-savebar__in"><span class="opv-savebar__txt" data-estado-cambios></span>' +
            '<button type="button" class="opv-btn opv-btn--ghost opv-btn--sm" data-descartar>Descartar</button>' +
            '<button type="button" class="opv-btn opv-btn--primary" data-guardar>Guardar cambios</button></div></div>';

        shellAdmin("evento", h);
        window.scrollTo({ top: y, behavior: "instant" });
        marcarCambios();

        app.querySelectorAll("[data-copiar]").forEach((b) => { b.onclick = () => copiar(b.getAttribute("data-copiar"), "Enlace copiado"); });
        app.querySelectorAll("[data-inscritos]").forEach((b) => { b.onclick = () => verInscritos(b.getAttribute("data-inscritos")); });

        app.querySelectorAll("[data-k]").forEach((el) => {
            const k = el.getAttribute("data-k");
            const evento = el.tagName === "SELECT" || el.type === "checkbox" ? "change" : "input";
            el.addEventListener(evento, () => {
                let v = el.type === "checkbox" ? el.checked : el.value;
                if (el.hasAttribute("data-num")) v = Math.max(0, parseInt(v, 10) || 0);
                const p = k.split(".");
                let o = ed;
                for (let i = 0; i < p.length - 1; i++) o = o[p[i]];
                o[p[p.length - 1]] = v;
                adm.sucio = true;
                if (el.hasAttribute("data-repintar")) pintarEditor(id);
                else marcarCambios();
            });
        });

        const cambiar = (fn) => { fn(); adm.sucio = true; pintarEditor(id); };
        app.querySelectorAll("[data-subir],[data-bajar]").forEach((b) => {
            b.onclick = () => cambiar(() => {
                const i = +(b.getAttribute("data-subir") || b.getAttribute("data-bajar"));
                const j = b.hasAttribute("data-subir") ? i - 1 : i + 1;
                const arr = c.secciones;
                [arr[i], arr[j]] = [arr[j], arr[i]];
            });
        });
        app.querySelectorAll("[data-borrar]").forEach((b) => {
            b.onclick = async () => {
                const i = +b.getAttribute("data-borrar");
                if (!(await confirmar("¿Eliminar «" + (c.secciones[i].titulo || "esta posición") + "»? Si ya tiene gente anotada no se podrá guardar: en ese caso desmarca «Visible en la página».", { ok: "Eliminar", peligro: true }))) return;
                cambiar(() => c.secciones.splice(i, 1));
            };
        });
        app.querySelectorAll("[data-agregar-rol]").forEach((b) => {
            b.onclick = () => cambiar(() => c.secciones[+b.getAttribute("data-agregar-rol")].roles.push({ rol: "", cupos: 1, nota: "" }));
        });
        app.querySelectorAll("[data-borrar-rol]").forEach((b) => {
            b.onclick = () => cambiar(() => { const [i, j] = b.getAttribute("data-borrar-rol").split(".").map(Number); c.secciones[i].roles.splice(j, 1); });
        });
        app.querySelectorAll("[data-agregar-sec]").forEach((b) => {
            b.onclick = () => {
                cambiar(() => c.secciones.push({ id: "", activa: true, titulo: "Nueva posición", cuando: "", donde: "", vestimenta: "", instrucciones: "", aviso: "", tipo: "LISTA", cupos: 10, grupo: "", roles: [] }));
                const ultimo = app.querySelectorAll(".opv-pos");
                if (ultimo.length) {
                    const t = ultimo[ultimo.length - 1];
                    t.scrollIntoView({ behavior: "smooth", block: "center" });
                    const inp = t.querySelector(".opv-pos__titulo");
                    if (inp) { inp.focus(); inp.select(); }
                }
            };
        });

        app.querySelector("[data-descartar]").onclick = async () => {
            if (!(await confirmar("Se pierden los cambios que no guardaste en este evento.", { ok: "Descartar", peligro: true }))) return;
            adm.ed = null;
            adm.sucio = false;
            pintarEditor(id);
        };
        app.querySelector("[data-guardar]").onclick = async (e) => {
            const btn = e.currentTarget;
            const config = Object.assign({}, c, { notas: String(c.notasTxt || "").split("\n") });
            delete config.notasTxt;
            btn.disabled = true;
            btn.textContent = "Guardando…";
            try {
                adm.datos = await A({ action: "admin_guardar_evento", id: ev.id, evento: { nombre: ed.nombre, fechas: ed.fechas, estado: ed.estado, config } });
                adm.ed = null;
                adm.sucio = false;
                pintarEditor(id);
                toast("Cambios guardados. La comunidad ya los ve en el enlace.", "ok");
            } catch (err) {
                btn.disabled = false;
                btn.textContent = "Guardar cambios";
                toast(err.message, "error");
            }
        };
    }

    function marcarCambios() {
        const t = app.querySelector("[data-estado-cambios]");
        if (!t) return;
        t.textContent = adm.sucio ? "Tienes cambios sin guardar" : "Todo está guardado";
        t.classList.toggle("opv-savebar__txt--sucio", adm.sucio);
        app.querySelector("[data-guardar]").disabled = !adm.sucio;
        app.querySelector("[data-descartar]").disabled = !adm.sucio;
    }

    function posicionHtml(s, i, total) {
        const p = "config.secciones." + i + ".";
        let h = '<section class="opv-pos' + (s.activa === false ? " opv-pos--off" : "") + (i % 2 ? " opv-pos--red" : "") + '">' +
            '<div class="opv-pos__head"><span class="opv-pos__n">' + (i + 1) + "</span>" +
            '<input class="opv-input opv-pos__titulo" data-k="' + p + 'titulo" value="' + esc(s.titulo) + '" placeholder="Nombre de la posición" aria-label="Nombre de la posición">' +
            '<button type="button" class="opv-icon-btn" data-subir="' + i + '"' + (i === 0 ? " disabled" : "") + ' aria-label="Subir">↑</button>' +
            '<button type="button" class="opv-icon-btn" data-bajar="' + i + '"' + (i === total - 1 ? " disabled" : "") + ' aria-label="Bajar">↓</button>' +
            '<button type="button" class="opv-icon-btn opv-icon-btn--danger" data-borrar="' + i + '" aria-label="Eliminar posición">×</button></div>' +
            '<div class="opv-pos__body"><div class="opv-grid2 opv-grid2--2">' +
            campo("Día y hora de entrada", p + "cuando", s.cuando, { ph: "Sábado 14 de nov · 4:00 pm" }) +
            campo("Vestimenta", p + "vestimenta", s.vestimenta, { ph: "Pantalón, camisa y zapatos negros" }) +
            campo("Punto de encuentro", p + "donde", s.donde, { ph: "Salón principal" }) +
            campo("Aviso (resaltado en amarillo)", p + "aviso", s.aviso, { ph: "Hora sujeta al avance del equipo" }) +
            "</div>" +
            campo("Instrucciones", p + "instrucciones", s.instrucciones, { area: true, ph: "Requisitos, qué traer, qué evitar…" }) +
            '<div class="opv-grid3">' +
            '<label class="opv-field"><span>Cómo se anota la gente</span><select class="opv-select opv-select--sm" data-k="' + p + 'tipo" data-repintar>' +
            '<option value="LISTA"' + (s.tipo !== "ROLES" ? " selected" : "") + ">Lista de nombres</option>" +
            '<option value="ROLES"' + (s.tipo === "ROLES" ? " selected" : "") + ">Roles fijos</option></select></label>" +
            (s.tipo !== "ROLES" ? campo("Cupos", p + "cupos", s.cupos, { num: true, hint: "0 = sin límite" }) : "") +
            campo("Grupo de horario", p + "grupo", s.grupo, { ph: "sabado-tarde", hint: "Mismo grupo = no se pueden combinar." }) +
            "</div>";
        if (s.tipo === "ROLES") {
            h += '<div class="opv-label" style="margin:2px 0 6px">Roles <span class="opv-hint">(nombre · personas · nota)</span></div><div class="opv-ed-roles">' +
                s.roles.map((r, j) => {
                    const q = p + "roles." + j + ".";
                    return '<div class="opv-ed-rol">' +
                        '<input class="opv-input opv-input--sm" data-k="' + q + 'rol" placeholder="Nombre del rol" value="' + esc(r.rol) + '">' +
                        '<input class="opv-input opv-input--sm" data-k="' + q + 'cupos" data-num type="number" min="1" title="Personas" value="' + esc(r.cupos || 1) + '">' +
                        '<input class="opv-input opv-input--sm opv-ed-rol__nota" data-k="' + q + 'nota" placeholder="Nota (opcional)" value="' + esc(r.nota) + '">' +
                        '<button type="button" class="opv-icon-btn opv-icon-btn--danger" data-borrar-rol="' + i + "." + j + '" aria-label="Quitar rol">×</button></div>';
                }).join("") + "</div>" +
                '<button type="button" class="opv-btn opv-btn--ghost opv-btn--sm" data-agregar-rol="' + i + '" style="margin-bottom:12px">' + ICON.mas + "Agregar rol</button>";
        }
        h += '<label class="opv-check" style="margin:0"><input type="checkbox" data-k="' + p + 'activa"' + (s.activa !== false ? " checked" : "") + " data-repintar> Visible en la página</label>" +
            "</div></section>";
        return h;
    }

    // ---------- inscritos ----------

    async function verInscritos(id) {
        const m = abrirModal({ titulo: "Inscritos", ancho: true });
        m.body.innerHTML = '<div class="opv-boot" style="min-height:200px"><div class="opv-spinner"></div></div>';
        let datos = null;
        let filtro = "";
        let verCanceladas = false;

        async function cargar() {
            datos = await A({ action: "admin_inscritos", id });
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
                '<label class="opv-field"><span>Posición</span><select class="opv-select opv-select--sm" data-as>' +
                secs.map((s) => '<option value="' + esc(s.id) + '">' + esc(s.titulo) + "</option>").join("") + "</select></label>" +
                '<label class="opv-field" data-ar-wrap' + (secSel && secSel.tipo === "ROLES" ? "" : " hidden") + '><span>Rol</span><select class="opv-select opv-select--sm" data-ar></select></label></div>' +
                '<button type="button" class="opv-btn opv-btn--cyan opv-btn--sm" data-anotar>' + ICON.mas + "Anotar</button>" +
                ' <span class="opv-hint">Funciona aunque el evento esté cerrado.</span></div>' +
                '<div class="opv-row" style="margin-bottom:10px">' +
                '<select class="opv-select opv-select--sm" style="width:auto" data-filtro><option value="">Todas las posiciones</option>' +
                secs.map((s) => '<option value="' + esc(s.id) + '"' + (filtro === s.id ? " selected" : "") + ">" + esc(s.titulo) + "</option>").join("") + "</select>" +
                '<label class="opv-check" style="margin:0"><input type="checkbox" data-vc' + (verCanceladas ? " checked" : "") + "> Ver canceladas</label>" +
                '<span class="opv-top__sp"></span>' +
                '<button type="button" class="opv-btn opv-btn--ghost opv-btn--sm" data-wa>' + ICON.copiar + "Copiar lista para WhatsApp</button></div>" +
                (filas.length
                    ? '<div class="opv-table-wrap"><table class="opv-table"><thead><tr><th>Nombre</th><th>Posición</th><th>Rol</th>' +
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
                    await A({ action: "admin_inscribir", id, nombre: m.body.querySelector("[data-an]").value, selecciones: [{ id: selS.value, rol: selR.value || "" }] });
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
                        datos = await A({ action: "admin_estado_inscripcion", id, comprobante: comp, estado: reactivar ? "ACTIVA" : "CANCELADA" });
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
            A({ action: "admin_eventos" }).then((r) => { adm.datos = r; if (ruta.modo === "admin" && ruta.vista === "eventos") pintarEventos(); }).catch(() => {});
        };
        m.el.querySelector(".opv-modal__x").onclick = () => m.cerrar();
        m.el.querySelector(".opv-modal__bg").onclick = () => m.cerrar();
        m.foot.querySelector("[data-x]").onclick = () => m.cerrar();
    }

    // ======================================================================
    //  ARRANQUE
    // ======================================================================

    let hashPrevio = location.hash;
    function iniciar() {
        const nueva = leerRuta();
        const saliendoDelEditor = ruta.modo === "admin" && ruta.vista === "evento" &&
            !(nueva.modo === "admin" && nueva.vista === "evento" && clave(nueva.id) === clave(ruta.id));
        if (saliendoDelEditor && adm.sucio) {
            if (!window.confirm("Tienes cambios sin guardar en este evento. ¿Salir sin guardar?")) {
                history.replaceState(null, "", hashPrevio);
                return;
            }
        }
        if (saliendoDelEditor) { adm.ed = null; adm.sucio = false; }
        hashPrevio = location.hash;
        ruta = nueva;
        while (pila.length) pila[pila.length - 1].cerrar();
        if (ruta.modo === "admin") return vistaAdmin();
        if (ruta.modo === "evento") return vistaEvento();
        return vistaInicio();
    }

    window.addEventListener("beforeunload", (e) => {
        if (adm.sucio) { e.preventDefault(); e.returnValue = ""; }
    });
    window.addEventListener("hashchange", iniciar);
    iniciar();
})();
