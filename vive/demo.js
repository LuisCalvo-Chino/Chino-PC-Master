/**
 * Operaciones VIVE · modo demostración
 *
 * Corre el MISMO apps-script/Codigo.gs dentro del navegador, sobre un
 * "Google Sheets" de mentira guardado en localStorage. Sirve para ver el app
 * funcionando sin instalar nada, y para probar cambios del backend antes de
 * pegarlos en Apps Script.
 */
(function () {
    "use strict";

    const LLAVE = "opvive-demo-libro-v2";
    let libro = cargar();

    function cargar() {
        try {
            const raw = localStorage.getItem(LLAVE);
            if (raw) return JSON.parse(raw);
        } catch (e) { /* nada */ }
        return { hojas: [] };
    }
    function guardar() {
        try { localStorage.setItem(LLAVE, JSON.stringify(libro)); } catch (e) { /* modo privado: queda en memoria */ }
    }

    // ---------------- Hoja y rango ----------------

    function Rango(hoja, fila, col, nf, nc) {
        this.h = hoja; this.f = fila; this.c = col; this.nf = nf; this.nc = nc;
    }
    Rango.prototype.getValues = function () {
        const out = [];
        for (let i = 0; i < this.nf; i++) {
            const fila = this.h.datos[this.f - 1 + i] || [];
            const r = [];
            for (let j = 0; j < this.nc; j++) {
                const v = fila[this.c - 1 + j];
                r.push(v == null ? "" : v);
            }
            out.push(r);
        }
        return out;
    };
    Rango.prototype.setValues = function (vals) {
        for (let i = 0; i < vals.length; i++) {
            const idx = this.f - 1 + i;
            while (this.h.datos.length <= idx) this.h.datos.push([]);
            for (let j = 0; j < vals[i].length; j++) {
                let v = vals[i][j];
                if (v instanceof Date) v = v.toISOString();
                this.h.datos[idx][this.c - 1 + j] = v;
            }
        }
        guardar();
        return this;
    };
    Rango.prototype.setValue = function (v) { return this.setValues([[v]]); };
    ["setFontWeight", "setBackground", "setFontColor", "setFontSize", "setVerticalAlignment", "setWrap", "setDataValidation"]
        .forEach((m) => { Rango.prototype[m] = function () { return this; }; });

    function Hoja(obj) { this.o = obj; }
    Object.defineProperty(Hoja.prototype, "datos", { get() { return this.o.datos; } });
    Hoja.prototype.getName = function () { return this.o.nombre; };
    Hoja.prototype.setName = function (n) { this.o.nombre = n; guardar(); return this; };
    Hoja.prototype.getLastRow = function () {
        for (let i = this.o.datos.length - 1; i >= 0; i--) {
            if ((this.o.datos[i] || []).some((v) => v !== "" && v != null)) return i + 1;
        }
        return 0;
    };
    Hoja.prototype.getLastColumn = function () {
        return this.o.datos.reduce((m, f) => Math.max(m, (f || []).length), 0);
    };
    Hoja.prototype.getDataRange = function () {
        return new Rango(this, 1, 1, Math.max(1, this.getLastRow()), Math.max(1, this.getLastColumn()));
    };
    Hoja.prototype.getRange = function (f, c, nf, nc) { return new Rango(this, f, c, nf || 1, nc || 1); };
    Hoja.prototype.appendRow = function (fila) {
        this.getRange(this.getLastRow() + 1, 1, 1, fila.length).setValues([fila]);
        return this;
    };
    Hoja.prototype.clear = function () { this.o.datos = []; guardar(); return this; };
    ["setFrozenRows", "setColumnWidth", "setRowHeight", "hideSheet"].forEach((m) => { Hoja.prototype[m] = function () { return this; }; });

    const Libro = {
        getSheetByName(n) {
            const o = libro.hojas.filter((h) => h.nombre === n)[0];
            return o ? new Hoja(o) : null;
        },
        insertSheet(n) {
            const o = { nombre: n, datos: [] };
            libro.hojas.push(o);
            guardar();
            return new Hoja(o);
        },
        getName() { return "VIVE · Operaciones (demostración)"; },
        getUrl() { return "#"; },
        getSpreadsheetTimeZone() { return "America/Costa_Rica"; }
    };

    // ---------------- Servicios de Apps Script ----------------

    window.SpreadsheetApp = {
        getActive() { return Libro; },
        openById() { return Libro; },
        flush() {},
        getUi() { throw new Error("Sin interfaz en la demostración"); }
    };
    window.LockService = { getScriptLock() { return { tryLock() { return true; }, releaseLock() {} }; } };
    window.Utilities = {
        getUuid() {
            if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
            return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
                const r = (Math.random() * 16) | 0;
                return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
            });
        }
    };
    window.ContentService = {
        MimeType: { JSON: "application/json" },
        createTextOutput(s) { return { setMimeType() { return this; }, getContent() { return s; } }; }
    };
    window.Logger = { log() {} };
    const cache = {};
    window.CacheService = {
        getScriptCache() {
            return {
                get(k) { const v = cache[k]; return v && v.hasta > Date.now() ? v.valor : null; },
                put(k, valor, seg) { cache[k] = { valor: String(valor), hasta: Date.now() + (seg || 600) * 1000 }; }
            };
        }
    };

    function post(payload) {
        const salida = window.doPost({ parameter: {}, postData: { contents: JSON.stringify(payload) } });
        return JSON.parse(salida.getContent());
    }

    function claveAdmin() {
        const h = Libro.getSheetByName("CONFIG");
        if (!h) return "";
        const fila = h.datos.filter((f) => f && /clave/i.test(String(f[0])))[0];
        return fila ? String(fila[1]) : "";
    }

    /** Un Avanzado de ejemplo con gente ficticia, para que la demo no arranque vacía. */
    function sembrar() {
        post({ action: "ping" });
        const clave = claveAdmin();
        const r = post({ action: "admin_eventos", clave });
        if (r.eventos && r.eventos.length) return;
        post({ action: "admin_crear_evento", clave, tipo: "avanzado", nombre: "Avanzado 40", fechas: "Nov 11 – 15" });
        const id = "avanzado-40";
        const gente = [
            ["Ana Rojas", [{ id: "contratos" }, { id: "angeles" }]],
            ["Carlos Mora", [{ id: "contratos" }, { id: "estiramientos", rol: "Camerino (Hombre)" }]],
            ["María Fernanda Solís", [{ id: "estiramientos", rol: "Camerino (Mujer)" }, { id: "graduacion" }]],
            ["José Pablo Vargas", [{ id: "armado" }, { id: "angeles" }]],
            ["Daniela Castro", [{ id: "angeles" }, { id: "upgrade" }]],
            ["Luis Alfaro", [{ id: "estiramientos", rol: "Luces" }]],
            ["Sofía Jiménez", [{ id: "estiramientos", rol: "Puertas" }, { id: "graduacion" }]],
            ["Gabriel Méndez", [{ id: "armado" }, { id: "contratos" }, { id: "angeles" }]]
        ];
        gente.forEach(([nombre, sel]) => post({ action: "inscribir", id, nombre, selecciones: sel }));

        post({ action: "admin_crear_evento", clave, tipo: "introductorio", nombre: "Intro 39", fechas: "Dic 9 – 13" });
        [
            ["Andrea Quesada", ["linea-eleccion", "graduacion"]],
            ["Esteban Rojas", ["montaje", "linea-eleccion"]],
            ["Valeria Chaves", ["linea-eleccion", "upgrade"]],
            ["Mauricio Solano", ["linea-eleccion", "graduacion"]],
            ["Paola Jiménez", ["montaje"]]
        ].forEach(([nombre, ids]) => post({ action: "inscribir", id: "intro-39", nombre, selecciones: ids.map((x) => ({ id: x })) }));
    }

    const listo = fetch("apps-script/Codigo.gs?v=" + (window.OPVIVE_ASSET_V || "1"), { cache: "no-cache" })
        .then((r) => {
            if (!r.ok) throw new Error("No se pudo leer el backend de la demostración.");
            return r.text();
        })
        .then((codigo) => {
            const s = document.createElement("script");
            s.textContent = codigo + "\n//# sourceURL=opvive-Codigo.gs";
            document.head.appendChild(s);
            if (typeof window.doPost !== "function") throw new Error("El backend de la demostración no cargó.");
            sembrar();
        });

    window.OPVIVE_DEMO = {
        listo,
        post,
        clave: claveAdmin,
        reiniciar() {
            libro = { hojas: [] };
            guardar();
            sembrar();
        }
    };
})();
