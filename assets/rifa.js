/**
 * Sistema de Rifa multi-proyecto — hub (#rifa) + rifa de quien la organiza (#r/<hash>)
 *
 * El link #r/<hash> es una mini app pensada para el teléfono: asistente de primera vez,
 * números, compradores, compartir (imagen + mensaje) y ajustes. El estilo elegido, el
 * asistente y el mensaje se guardan dentro de banner_json, así no hace falta tocar el
 * Apps Script para guardarlos.
 */
(function () {
    const MASTER_PIN_KEY = "cpm_rifa_master_pin";
    const DEFAULT_ICON = {
        whatsapp: "imagenes/WhatsApp Icon.png",
        sinpe: "imagenes/SINPE Icon.png",
        tomado: "imagenes/Tomado.png"
    };

    const BANNER_FONT_OPTIONS = [
        { value: "Inter, sans-serif", label: "Inter" },
        { value: "Montserrat, sans-serif", label: "Montserrat" },
        { value: "Poppins, sans-serif", label: "Poppins" },
        { value: "Roboto, sans-serif", label: "Roboto" },
        { value: "'Open Sans', sans-serif", label: "Open Sans" },
        { value: "Lato, sans-serif", label: "Lato" },
        { value: "Nunito, sans-serif", label: "Nunito" },
        { value: "Raleway, sans-serif", label: "Raleway" },
        { value: "'Source Sans 3', sans-serif", label: "Source Sans 3" },
        { value: "Orbitron, sans-serif", label: "Orbitron" },
        { value: "'Roboto Mono', monospace", label: "Roboto Mono" },
        { value: "'Playfair Display', serif", label: "Playfair Display" },
        { value: "Merriweather, serif", label: "Merriweather" },
        { value: "Georgia, serif", label: "Georgia" }
    ];

    const TYPO_KEYS = [
        "titulo",
        "premio1",
        "premio2",
        "premio3",
        "precio",
        "modalidadFecha",
        "whatsapp",
        "sinpe"
    ];

    // Título y manifest del sitio: la rifa los cambia para su acceso directo y se restauran al salir
    const SITIO_TITULO = document.title;
    const SITIO_MANIFEST = document.querySelector('link[rel="manifest"]')?.getAttribute("href") || "site.webmanifest";

    function restaurarSitio() {
        document.title = SITIO_TITULO;
        const link = document.querySelector('link[rel="manifest"]');
        if (link) link.setAttribute("href", SITIO_MANIFEST);
    }

    let showMessage = (msg) => console.log(msg);
    let navigateHome = () => {
        window.location.hash = "";
        window.location.reload();
    };
    let api = null;
    let mode = "hub";
    let adminHash = "";
    let project = null;
    /** @type {Record<string,{estado:string,nombre:string,telefono:string,contacto:string}>} */
    let datos = {};
    let seleccion = new Set();
    let rngWinners = [];
    let rngBusy = false;
    let bannerBusy = false;

    function $(id) {
        return document.getElementById(id);
    }

    function getMasterPin() {
        try {
            return String(localStorage.getItem(MASTER_PIN_KEY) || "").trim();
        } catch (e) {
            return "";
        }
    }

    function setMasterPin(v) {
        try {
            localStorage.setItem(MASTER_PIN_KEY, String(v || "").trim());
        } catch (e) {
            /* ignore */
        }
    }

    function defaultTypography(baseFont) {
        const f = baseFont || "Inter, sans-serif";
        return {
            titulo: { size: 56, font: f },
            premio1: { size: 36, font: f },
            premio2: { size: 30, font: f },
            premio3: { size: 30, font: f },
            precio: { size: 40, font: f },
            modalidadFecha: { size: 26, font: f },
            whatsapp: { size: 30, font: f },
            sinpe: { size: 30, font: f }
        };
    }

    function defaultBanner() {
        const font = "Inter, sans-serif";
        return {
            bg: { color1: "#EEEEEE", color2: "#EEEEEE", gradient: false, orient: "to bottom" },
            font,
            head: { mode: "text", title: "", logoUrl: "" },
            typography: defaultTypography(font),
            textColors: {
                titulo: "#222222",
                premio1: "#222222",
                premio2: "#444444",
                premio3: "#444444",
                costo: "#222222",
                modalidadFecha: "#444444",
                whatsapp: "#222222",
                sinpe: "#222222"
            },
            numberColors: {
                disponibleText: "#222222",
                disponibleBg: "#FFFFFF",
                tomadoText: "#777777",
                tomadoBg: "#DDDDDD"
            },
            icons: {
                whatsapp: { enabled: true, url: "" },
                sinpe: { enabled: true, url: "" },
                tomado: { enabled: false, url: "" }
            }
        };
    }

    function clampBannerPx(n, fallback) {
        const v = Number(n);
        if (!Number.isFinite(v)) return fallback;
        return Math.min(400, Math.max(8, Math.round(v)));
    }

    function mergeTypography(rawTypo, legacyFont, defaults) {
        const baseFont = legacyFont || defaults.titulo.font;
        const out = defaultTypography(baseFont);
        TYPO_KEYS.forEach((key) => {
            const src = rawTypo && typeof rawTypo === "object" ? rawTypo[key] : null;
            if (!src || typeof src !== "object") {
                out[key] = {
                    size: defaults[key].size,
                    font: baseFont
                };
                return;
            }
            out[key] = {
                size: clampBannerPx(src.size, defaults[key].size),
                font: String(src.font || baseFont || defaults[key].font)
            };
        });
        return out;
    }

    function mergeBanner(raw) {
        const d = defaultBanner();
        if (!raw || typeof raw !== "object") return d;
        const font = raw.font || d.font;
        return {
            bg: Object.assign({}, d.bg, raw.bg || {}),
            font,
            head: Object.assign({}, d.head, raw.head || {}),
            typography: mergeTypography(raw.typography, font, d.typography),
            textColors: Object.assign({}, d.textColors, raw.textColors || {}),
            numberColors: Object.assign({}, d.numberColors, raw.numberColors || {}),
            icons: {
                whatsapp: Object.assign({}, d.icons.whatsapp, (raw.icons && raw.icons.whatsapp) || {}),
                sinpe: Object.assign({}, d.icons.sinpe, (raw.icons && raw.icons.sinpe) || {}),
                tomado: Object.assign({}, d.icons.tomado, (raw.icons && raw.icons.tomado) || {})
            }
        };
    }

    function ensureFontSelectOptions(sel, currentValue) {
        if (!sel) return;
        const value = String(currentValue || "Inter, sans-serif");
        if (!sel.options.length) {
            BANNER_FONT_OPTIONS.forEach((opt) => {
                const o = document.createElement("option");
                o.value = opt.value;
                o.textContent = opt.label;
                sel.appendChild(o);
            });
        }
        const exists = Array.from(sel.options).some((o) => o.value === value);
        if (!exists && value) {
            const o = document.createElement("option");
            o.value = value;
            o.textContent = value.split(",")[0].replace(/['"]/g, "");
            sel.appendChild(o);
        }
        sel.value = value;
    }

    function typoOf(b, key) {
        const t = b?.typography?.[key];
        const d = defaultTypography(b?.font)[key];
        return {
            size: clampBannerPx(t?.size, d.size),
            font: String(t?.font || b?.font || d.font)
        };
    }

    function validateFechaModalidad(modalidad, fechaIso) {
        const mod = String(modalidad || "").trim();
        const f = String(fechaIso || "").trim().slice(0, 10);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(f)) return "Fecha inválida (usa el selector de fecha).";
        const [y, m, d] = f.split("-").map(Number);
        const dt = new Date(y, m - 1, d);
        if (Number.isNaN(dt.getTime())) return "Fecha inválida.";
        const day = dt.getDay();
        if (mod === "Chances" && day !== 2 && day !== 5) {
            return "Chances solo permite martes o viernes (sorteo 7:30 p.m.).";
        }
        if (mod === "Loteria Nacional" && day !== 0) {
            return "Lotería Nacional solo permite domingos (sorteo 7:30 p.m.).";
        }
        return "";
    }

    function fechaHint(modalidad) {
        if (modalidad === "Chances") return "Debe ser martes o viernes · 7:30 p.m.";
        if (modalidad === "Loteria Nacional") return "Debe ser domingo · 7:30 p.m.";
        return "Cualquier fecha (sorteo con RNG en la app).";
    }

    function formatColonPrice(value) {
        let s = String(value == null ? "" : value).trim();
        s = s.replace(/^[₡\s]+/g, "").replace(/₡/g, "").trim();
        if (!s) return "₡";
        return "₡" + s;
    }

    function wirePrecioInput(el) {
        if (!el || el.dataset.colonWired === "1") return;
        el.dataset.colonWired = "1";
        const sync = () => {
            const start = el.selectionStart;
            const before = el.value;
            el.value = formatColonPrice(el.value);
            if (document.activeElement === el && typeof start === "number") {
                const delta = el.value.length - before.length;
                const pos = Math.max(1, start + delta);
                try {
                    el.setSelectionRange(pos, pos);
                } catch (e) {
                    /* ignore */
                }
            }
        };
        el.addEventListener("input", sync);
        el.addEventListener("blur", () => {
            el.value = formatColonPrice(el.value);
            if (el.value === "₡") el.value = "";
        });
        if (el.value) el.value = formatColonPrice(el.value);
    }

    function adminLink(hash) {
        const h = String(hash || "").trim();
        try {
            const u = new URL(window.location.href);
            u.hash = "";
            // Entrada SPA: si estamos en una ruta .html distinta, preferir index.html en la misma carpeta
            let path = u.pathname || "/";
            if (/\.html$/i.test(path) && !/index\.html$/i.test(path)) {
                path = path.replace(/[^/]+$/, "index.html");
            }
            u.pathname = path;
            return `${u.origin}${u.pathname}${u.search}#r/${h}`;
        } catch (e) {
            const base = String(window.location.href || "").split("#")[0];
            return `${base}#r/${h}`;
        }
    }

    const ICON_OPEN =
        '<svg class="rifa-ico" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M14 3h7v7h-2V6.41l-9.29 9.3-1.42-1.42 9.3-9.29H14V3zM5 5h6v2H7v10h10v-4h2v6H5V5z"/></svg>';
    const ICON_COPY =
        '<svg class="rifa-ico" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/></svg>';
    const ICON_ARCHIVE =
        '<svg class="rifa-ico" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M20.54 5.23 19.15 3.55A1.99 1.99 0 0 0 17.56 3H6.44c-.62 0-1.2.29-1.59.76L3.46 5.23C3.17 5.57 3 6.01 3 6.5V19a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6.5c0-.49-.17-.93-.46-1.27zM12 17.5 6.5 12H10v-2h4v2h3.5L12 17.5zM5.12 5l.81-1h12l.94 1H5.12z"/></svg>';
    const ICON_CALENDAR =
        '<svg class="rifa-ico" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M7 2h2v2h6V2h2v2h3a1 1 0 0 1 1 1v15a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h3V2zm12 8H5v9h14v-9zM5 6v2h14V6H5z"/></svg>';
    const ICON_EDIT =
        '<svg class="rifa-ico" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>';
    const ICON_TRASH =
        '<svg class="rifa-ico" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M6 19a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>';

    async function copyText(text) {
        try {
            await navigator.clipboard.writeText(text);
            showMessage("Link copiado.", "success");
        } catch (e) {
            window.prompt("Copia este link:", text);
        }
    }

    function numerosFromApi(list) {
        const map = {};
        (list || []).forEach((row) => {
            const n = String(row.numero != null ? row.numero : "").padStart(2, "0").slice(-2);
            map[n] = {
                estado: row.estado || "Disponible",
                nombre: row.nombre || "",
                telefono: row.telefono || "",
                contacto: row.contacto || ""
            };
        });
        for (let i = 0; i < 100; i++) {
            const n = String(i).padStart(2, "0");
            if (!map[n]) map[n] = { estado: "Disponible", nombre: "", telefono: "", contacto: "" };
        }
        return map;
    }

    function countStats() {
        let disponible = 0;
        let reservado = 0;
        let pagado = 0;
        Object.keys(datos).forEach((k) => {
            const e = datos[k].estado;
            if (e === "Reservado") reservado++;
            else if (e === "Pagado") pagado++;
            else disponible++;
        });
        return { disponible, reservado, pagado };
    }

    function updateStatsUI() {
        const s = countStats();
        document.querySelectorAll("[data-stat]").forEach((el) => {
            const key = el.getAttribute("data-stat");
            if (key && s[key] != null) el.textContent = String(s[key]);
        });
    }

    function finalizeSplash(ok) {
        const app = $("rifa-app");
        const splash = $("rifa-splash");
        if (!app) return;
        app.classList.remove("rifa-booting");
        app.classList.add("rifa-ready");
        if (!ok) app.classList.add("rifa-init-error");
        if (splash) splash.setAttribute("aria-busy", "false");
        window.setTimeout(() => {
            app.classList.add("rifa-splash-done");
        }, 1500);
    }

    /* ========== HUB ========== */
    let hubProjects = [];
    let hubArchiveSupported = false;
    let hubListView = "activas";

    function showHubPane(view) {
        document.querySelectorAll(".hub-nav-btn[data-hub-view]").forEach((b) => {
            b.classList.toggle("is-active", b.getAttribute("data-hub-view") === view);
        });
        document.querySelectorAll(".rifa-hub-pane").forEach((p) => {
            const match = p.getAttribute("data-hub-pane") === view;
            p.hidden = !match;
        });
        if (view === "lista") void loadProjectsTable();
    }

    function showHubList(view) {
        hubListView = view === "archivadas" ? "archivadas" : "activas";
        document.querySelectorAll("[data-hub-list]").forEach((b) => {
            const on = b.getAttribute("data-hub-list") === hubListView;
            b.classList.toggle("is-active", on);
            b.setAttribute("aria-selected", String(on));
        });
        document.querySelectorAll("[data-hub-list-pane]").forEach((p) => {
            p.hidden = p.getAttribute("data-hub-list-pane") !== hubListView;
        });
        const warn = $("rifa-hub-archive-warning");
        if (warn) warn.hidden = !(hubListView === "archivadas" && !hubArchiveSupported && hubProjects.length);
    }

    function syncPremioFields(selectId, attr) {
        const n = Number($(selectId)?.value) || 1;
        document.querySelectorAll(`[${attr}]`).forEach((el) => {
            const idx = Number(el.getAttribute(attr));
            el.hidden = idx > n;
        });
    }

    function hoyIso() {
        const d = new Date();
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    }

    function sumarDias(iso, dias) {
        const f = String(iso || "").slice(0, 10);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(f)) return "";
        const [y, m, d] = f.split("-").map(Number);
        const dt = new Date(y, m - 1, d + Number(dias || 0));
        return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
    }

    /**
     * Al crear la rifa solo se elige la hoja y el archivado; lo demás lo llena el cliente en el
     * asistente. El Apps Script exige premio, modalidad y fecha válidos para crearla, así que se
     * guardan estos valores de relleno y se reconocen como «falta configurar».
     */
    const PREMIO_PENDIENTE = "Por definir";

    function configIncompleta(p) {
        if (!p) return false;
        const premio = String(p.premio_1 || "").trim();
        return (
            !premio ||
            premio === PREMIO_PENDIENTE ||
            !String(p.precio || "").replace(/\D/g, "") ||
            String(p.sinpe || "").replace(/\D/g, "").length < 8
        );
    }

    /**
     * «Una semana después del sorteo»: al crear la rifa todavía no hay sorteo, así que se guarda
     * esta fecha marcadora (el Apps Script la acepta y nunca vence). Cuando el cliente elige el
     * sorteo, se reemplaza por sorteo + 7 días: lo hace el hub al cargar la lista y, desde la
     * versión con ese cambio, también el Apps Script al guardar el asistente.
     */
    const ARCHIVO_SEMANA = "2099-12-31";
    const DIAS_ARCHIVO = 7;

    function archivoPendiente(p) {
        return String(p?.fecha_archivo || "").slice(0, 10) === ARCHIVO_SEMANA;
    }

    /** Fecha real de archivado para un sorteo: una semana después, nunca antes de hoy. */
    function archivoDeSorteo(fechaSorteo) {
        const f = sumarDias(fechaSorteo, DIAS_ARCHIVO);
        return f && f >= hoyIso() ? f : hoyIso();
    }

    /** Fecha de archivado elegida en «Nueva rifa»: "" = sin fecha. */
    function fechaArchivoNueva() {
        return ($("rifa-new-archivo-modo")?.value || "semana") === "none" ? "" : ARCHIVO_SEMANA;
    }

    function syncNuevaArchivo() {
        const hint = $("rifa-new-archivo-hint");
        if (!hint) return;
        hint.textContent =
            ($("rifa-new-archivo-modo")?.value || "semana") === "none"
                ? "Quedará activa hasta que la archives a mano."
                : "Se archiva al terminar el día, una semana después del sorteo que elija el cliente.";
    }

    /** Texto corto de cuándo se archiva, para la lista del hub. */
    function archivoCorto(p) {
        if (archivoPendiente(p)) return "1 semana después del sorteo";
        return p.fecha_archivo || "";
    }

    function sorteoCorto(p) {
        if (configIncompleta(p)) return "—";
        const mod = p.modalidad === "RNG" ? "App" : p.modalidad === "Loteria Nacional" ? "Lotería" : p.modalidad || "";
        return `${mod}${p.fecha_sorteo ? " · " + p.fecha_sorteo : ""}`;
    }

    function premiosCorto(p) {
        if (configIncompleta(p)) return "Esperando que el cliente la configure";
        return [p.premio_1, p.premio_2, p.premio_3]
            .filter(Boolean)
            .slice(0, p.cantidad_premios || 1)
            .join(" · ");
    }

    function renderHubTables() {
        const tbody = $("rifa-projects-tbody");
        const tArch = $("rifa-archived-tbody");
        const activas = hubProjects.filter((p) => p.activo && !p.vencida);
        const archivadas = hubProjects.filter((p) => !p.activo || p.vencida);
        const cA = $("rifa-count-activas");
        const cR = $("rifa-count-archivadas");
        if (cA) cA.textContent = String(activas.length);
        if (cR) cR.textContent = hubArchiveSupported ? String(archivadas.length) : "";

        if (tbody) {
            if (!activas.length) {
                tbody.innerHTML = '<tr><td colspan="7" class="rifa-muted">Aún no hay rifas activas. Usa + Nuevo.</td></tr>';
            } else {
                tbody.innerHTML = "";
                activas.forEach((p) => {
                    const tr = document.createElement("tr");
                    const link = adminLink(p.hash_admin);
                    const vig = p.fecha_archivo
                        ? `<span class="rifa-vig">${escapeHtml(archivoCorto(p))}</span>`
                        : '<span class="rifa-muted">Sin fecha</span>';
                    tr.innerHTML = `
                        <td><strong>${escapeHtml(p.sheet_name)}</strong><br/><span class="rifa-muted">${escapeHtml(p.nombre_display || "")}</span></td>
                        <td>${escapeHtml(premiosCorto(p))}</td>
                        <td>
                            <div class="rifa-link-actions">
                                <span>${escapeHtml(sorteoCorto(p))}</span>
                                ${configIncompleta(p) ? "" : `<button type="button" class="rifa-icon-btn" data-sorteo-id="${escapeAttr(p.project_id)}" title="Cambiar el sorteo (el cliente no puede)" aria-label="Cambiar el sorteo">${ICON_EDIT}</button>`}
                            </div>
                        </td>
                        <td>${escapeHtml(p.precio)}</td>
                        <td>
                            <div class="rifa-link-actions">
                                ${vig}
                                ${hubArchiveSupported ? `<button type="button" class="rifa-icon-btn" data-vigencia-id="${escapeAttr(p.project_id)}" title="Cambiar fecha de archivado" aria-label="Cambiar fecha de archivado">${ICON_CALENDAR}</button>` : ""}
                            </div>
                        </td>
                        <td>
                            <div class="rifa-link-actions">
                                <a class="rifa-icon-btn rifa-icon-btn--primary" href="${escapeAttr(link)}" target="_blank" rel="noopener noreferrer" data-external="1" title="Abrir la rifa en otra pestaña" aria-label="Abrir rifa">${ICON_OPEN}</a>
                                <button type="button" class="rifa-icon-btn" data-copy-link="${escapeAttr(link)}" title="Copiar link" aria-label="Copiar link">${ICON_COPY}</button>
                            </div>
                        </td>
                        <td>
                            <div class="rifa-link-actions">
                                <button type="button" class="rifa-icon-btn rifa-icon-btn--warn" data-archive-id="${escapeAttr(p.project_id)}" title="Archivar ahora" aria-label="Archivar">${ICON_ARCHIVE}</button>
                                <button type="button" class="rifa-icon-btn rifa-icon-btn--danger" data-del-id="${escapeAttr(p.project_id)}" title="Eliminar permanentemente" aria-label="Eliminar">${ICON_TRASH}</button>
                            </div>
                        </td>`;
                    tbody.appendChild(tr);
                });
            }
        }

        if (tArch) {
            if (!hubArchiveSupported) {
                tArch.innerHTML = '<tr><td colspan="5" class="rifa-muted">Disponible con la versión 2 del Apps Script.</td></tr>';
            } else if (!archivadas.length) {
                tArch.innerHTML = '<tr><td colspan="5" class="rifa-muted">No hay rifas archivadas.</td></tr>';
            } else {
                tArch.innerHTML = "";
                archivadas.forEach((p) => {
                    const tr = document.createElement("tr");
                    const motivo = p.fecha_archivo
                        ? `Venció el ${escapeHtml(p.fecha_archivo)}`
                        : "Archivada a mano";
                    tr.innerHTML = `
                        <td><strong>${escapeHtml(p.sheet_name)}</strong><br/><span class="rifa-muted">${escapeHtml(p.nombre_display || "")}</span></td>
                        <td>${escapeHtml(premiosCorto(p))}</td>
                        <td>${escapeHtml(sorteoCorto(p))}</td>
                        <td>${motivo}</td>
                        <td>
                            <div class="rifa-link-actions">
                                <button type="button" class="rifa-btn rifa-btn--sm rifa-btn--primary" data-reactivate-id="${escapeAttr(p.project_id)}">Reactivar</button>
                                <button type="button" class="rifa-icon-btn rifa-icon-btn--danger" data-del-id="${escapeAttr(p.project_id)}" title="Eliminar permanentemente" aria-label="Eliminar">${ICON_TRASH}</button>
                            </div>
                        </td>`;
                    tArch.appendChild(tr);
                });
            }
        }
        showHubList(hubListView);
    }

    async function loadProjectsTable() {
        const tbody = $("rifa-projects-tbody");
        if (!tbody) return;
        const pin = getMasterPin() || $("rifa-master-pin")?.value || "";
        if (!pin) {
            tbody.innerHTML =
                '<tr><td colspan="7" class="rifa-muted">Guarda la Llave Maestra para listar proyectos.</td></tr>';
            return;
        }
        tbody.innerHTML = '<tr><td colspan="7" class="rifa-muted">Cargando…</td></tr>';
        try {
            const res = await api.post({ action: "super_list_projects", masterPin: pin, include_inactive: true });
            hubProjects = res.data?.projects || res.projects || [];
            // La versión 1 del Apps Script ignora include_inactive y no informa archive_supported
            hubArchiveSupported = !!res.data?.archive_supported;
            renderHubTables();
            void fijarArchivosPendientes(pin);
        } catch (e) {
            tbody.innerHTML = `<tr><td colspan="7" class="rifa-error">${escapeHtml(e.message || String(e))}</td></tr>`;
        }
    }

    /**
     * Rifas creadas con «una semana después del sorteo» cuyo cliente ya eligió el sorteo:
     * se cambia la fecha marcadora por la real. Con el Apps Script nuevo ya llega puesta.
     */
    async function fijarArchivosPendientes(pin) {
        const listas = hubProjects.filter((p) => p.activo && archivoPendiente(p) && !configIncompleta(p) && p.fecha_sorteo);
        if (!listas.length) return;
        let cambios = 0;
        for (const p of listas) {
            const fecha = archivoDeSorteo(p.fecha_sorteo);
            try {
                await api.post({ action: "super_update_project", masterPin: pin, project_id: p.project_id, fecha_archivo: fecha });
                p.fecha_archivo = fecha;
                cambios++;
            } catch (e) {
                /* se reintenta la próxima vez que se cargue la lista */
            }
        }
        if (cambios) {
            renderHubTables();
            showMessage(
                cambios === 1
                    ? "Se fijó la fecha de archivado de 1 rifa: una semana después de su sorteo."
                    : `Se fijó la fecha de archivado de ${cambios} rifas: una semana después de su sorteo.`,
                "success"
            );
        }
    }

    function escapeHtml(s) {
        return String(s || "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;");
    }

    function escapeAttr(s) {
        return escapeHtml(s).replace(/'/g, "&#39;");
    }

    /** Diálogo «Vigencia»: devuelve la fecha elegida ("" = sin fecha) o null si se cancela. */
    function pedirVigencia(project, titulo) {
        const dlg = $("rifa-vigencia-dialog");
        if (!dlg || typeof dlg.showModal !== "function") {
            const v = window.prompt(
                `${titulo}\nFecha de archivado (AAAA-MM-DD) o vacío para sin fecha:`,
                project.fecha_archivo || ""
            );
            return Promise.resolve(v == null ? null : v.trim());
        }
        $("rifa-vigencia-title").textContent = titulo;
        $("rifa-vigencia-desc").textContent = `${project.nombre_display || project.sheet_name} · sorteo ${project.fecha_sorteo || "—"}`;
        const fecha = $("rifa-vig-fecha");
        const sugerida =
            project.fecha_archivo && project.fecha_archivo >= hoyIso() && !archivoPendiente(project)
                ? project.fecha_archivo
                : sumarDias(project.fecha_sorteo >= hoyIso() ? project.fecha_sorteo : hoyIso(), DIAS_ARCHIVO);
        fecha.value = sugerida;
        fecha.min = hoyIso();
        const radios = dlg.querySelectorAll('input[name="rifa-vig-modo"]');
        radios.forEach((r) => (r.checked = r.value === (project.fecha_archivo || titulo.startsWith("Reactivar") ? "fecha" : "none")));
        return new Promise((resolve) => {
            dlg.addEventListener(
                "close",
                () => {
                    if (dlg.returnValue !== "ok") return resolve(null);
                    const modo = dlg.querySelector('input[name="rifa-vig-modo"]:checked')?.value || "fecha";
                    resolve(modo === "none" ? "" : String(fecha.value || "").slice(0, 10));
                },
                { once: true }
            );
            dlg.returnValue = "";
            dlg.showModal();
        });
    }

    /** Solo desde el hub se cambia el sorteo de una rifa ya configurada. Devuelve null si se cancela. */
    function pedirSorteo(p) {
        const dlg = $("rifa-sorteo-dialog");
        if (!dlg || typeof dlg.showModal !== "function") {
            showMessage("Este navegador no permite abrir el cuadro para cambiar el sorteo.", "error");
            return Promise.resolve(null);
        }
        const mod = $("rifa-sorteo-modalidad");
        const fecha = $("rifa-sorteo-fecha");
        const hint = $("rifa-sorteo-hint");
        // Si se archiva una semana después del sorteo, el archivado se mueve junto con el sorteo
        const sigue = archivoPendiente(p) || (p.fecha_archivo && p.fecha_archivo === sumarDias(p.fecha_sorteo, DIAS_ARCHIVO));
        const archivoTxt = sigue
            ? " · se archiva una semana después del sorteo"
            : p.fecha_archivo
              ? ` · se archiva el ${p.fecha_archivo}`
              : "";
        $("rifa-sorteo-desc").textContent = `${p.nombre_display || p.sheet_name}${archivoTxt}`;
        mod.value = p.modalidad || "Chances";
        fecha.value = (p.fecha_sorteo || "").slice(0, 10);
        fecha.max = sigue ? "" : p.fecha_archivo || "";
        const sync = () => {
            const err = fecha.value ? validateFechaModalidad(mod.value, fecha.value) : "";
            const tarde =
                !sigue && p.fecha_archivo && fecha.value > p.fecha_archivo
                    ? "Queda después de la fecha de archivado: cambia también el archivado."
                    : "";
            hint.textContent = err || tarde || fechaHint(mod.value);
        };
        mod.onchange = sync;
        fecha.onchange = sync;
        sync();
        return new Promise((resolve) => {
            const form = $("rifa-sorteo-form");
            const onSubmit = (ev) => {
                if (ev.submitter?.value !== "ok") return;
                const err = validateFechaModalidad(mod.value, fecha.value);
                if (err) {
                    ev.preventDefault();
                    hint.textContent = err;
                }
            };
            form.addEventListener("submit", onSubmit);
            dlg.addEventListener(
                "close",
                () => {
                    form.removeEventListener("submit", onSubmit);
                    resolve(
                        dlg.returnValue === "ok"
                            ? { modalidad: mod.value, fecha: fecha.value, fechaArchivo: sigue ? archivoDeSorteo(fecha.value) : undefined }
                            : null
                    );
                },
                { once: true }
            );
            dlg.returnValue = "";
            dlg.showModal();
        });
    }

    function initHub() {
        restaurarSitio();
        $("rifa-hub").hidden = false;
        $("rifa-admin").hidden = true;
        document.body.classList.remove("cpm-rifa-standalone");
        const pinEl = $("rifa-master-pin");
        if (pinEl) pinEl.value = getMasterPin();
        const pinActual = () => getMasterPin() || pinEl?.value || "";

        document.querySelectorAll("[data-hub-view]").forEach((btn) => {
            btn.addEventListener("click", () => {
                const v = btn.getAttribute("data-hub-view");
                if (v) showHubPane(v);
            });
        });
        document.querySelectorAll("[data-hub-list]").forEach((btn) => {
            btn.addEventListener("click", () => showHubList(btn.getAttribute("data-hub-list")));
        });

        $("rifa-master-pin-save")?.addEventListener("click", () => {
            const v = pinEl?.value || "";
            setMasterPin(v);
            showMessage("Llave maestra guardada en este navegador.", "success");
            void loadProjectsTable();
        });

        $("rifa-new-archivo-modo")?.addEventListener("change", syncNuevaArchivo);
        syncNuevaArchivo();

        $("rifa-new-form")?.addEventListener("submit", async (ev) => {
            ev.preventDefault();
            const pin = pinActual();
            if (!pin) {
                showMessage("Guarda la Llave Maestra antes de crear.", "error");
                return;
            }
            const sheet = $("rifa-new-sheet").value.trim();
            if (!/^[A-Za-z0-9_-]{2,20}$/.test(sheet)) {
                showMessage("Nombre de hoja inválido. Usa 2–20 caracteres: letras, números, _ o - (sin espacios).", "error");
                return;
            }
            const fechaArchivo = fechaArchivoNueva();
            // Valores de relleno que el Apps Script acepta; el cliente los reemplaza en el asistente.
            const payload = {
                action: "super_create_project",
                masterPin: pin,
                sheet_name: sheet,
                nombre_display: sheet,
                cantidad_premios: 1,
                premio_1: PREMIO_PENDIENTE,
                premio_2: "",
                premio_3: "",
                modalidad: "RNG",
                fecha_sorteo: hoyIso(),
                fecha_archivo: fechaArchivo,
                sinpe: "",
                whatsapp: "",
                precio: ""
            };
            const submit = $("rifa-new-submit");
            if (submit) submit.disabled = true;
            try {
                const res = await api.post(payload, { timeoutMs: 45000 });
                const hash = res.data?.hash_admin || res.data?.project?.hash_admin;
                const link = adminLink(hash);
                const envio = `¡Hola! Aquí está el enlace de su rifa:\n${link}\n\nLa primera vez que lo abra, un asistente le guía paso a paso para poner los premios, el precio, la fecha del sorteo y sus datos de pago. Guárdelo bien: es la llave de su rifa, no lo comparta con los compradores.`;
                const archivoTxt = fechaArchivo ? "Se archiva una semana después del sorteo." : "Sin fecha de archivado.";
                const box = $("rifa-new-result");
                if (box) {
                    box.hidden = false;
                    box.innerHTML = `Proyecto creado. ${escapeHtml(archivoTxt)}<br/>Link para quien organiza:<br/><code class="rifa-admin-link-text">${escapeHtml(link)}</code>
                        <div class="rifa-link-actions rifa-mt">
                            <a class="rifa-icon-btn rifa-icon-btn--primary" href="${escapeAttr(link)}" target="_blank" rel="noopener noreferrer" data-external="1" title="Abrir la rifa" aria-label="Abrir la rifa">${ICON_OPEN}</a>
                            <button type="button" class="rifa-icon-btn" data-copy-link="${escapeAttr(link)}" title="Copiar link" aria-label="Copiar link">${ICON_COPY}</button>
                            <a class="rifa-btn rifa-btn--sm rifa-btn--primary" href="https://wa.me/?text=${encodeURIComponent(envio)}" target="_blank" rel="noopener noreferrer" data-external="1">Enviar por WhatsApp</a>
                        </div>`;
                }
                showMessage("Rifa creada correctamente.", "success");
                $("rifa-new-form").reset();
                syncNuevaArchivo();
            } catch (e) {
                showMessage(e.message || String(e), "error");
            } finally {
                if (submit) submit.disabled = false;
            }
        });

        const onTableClick = async (ev) => {
            const copyBtn = ev.target.closest("[data-copy-link]");
            if (copyBtn) {
                ev.preventDefault();
                await copyText(copyBtn.getAttribute("data-copy-link"));
                return;
            }
            const findP = (id) => hubProjects.find((p) => p.project_id === id) || { project_id: id };

            const sorteoBtn = ev.target.closest("[data-sorteo-id]");
            if (sorteoBtn) {
                const p = findP(sorteoBtn.getAttribute("data-sorteo-id"));
                const r = await pedirSorteo(p);
                if (!r) return;
                try {
                    await api.post({
                        action: "super_update_project",
                        masterPin: pinActual(),
                        project_id: p.project_id,
                        modalidad: r.modalidad,
                        fecha_sorteo: r.fecha,
                        ...(r.fechaArchivo ? { fecha_archivo: r.fechaArchivo } : {})
                    });
                    showMessage(
                        r.fechaArchivo ? `Sorteo actualizado. Se archivará al terminar el ${r.fechaArchivo}.` : "Sorteo actualizado.",
                        "success"
                    );
                    void loadProjectsTable();
                } catch (e) {
                    showMessage(e.message || String(e), "error");
                }
                return;
            }

            const vigBtn = ev.target.closest("[data-vigencia-id]");
            if (vigBtn) {
                const p = findP(vigBtn.getAttribute("data-vigencia-id"));
                const fecha = await pedirVigencia(p, "Cambiar fecha de archivado");
                if (fecha == null) return;
                try {
                    await api.post({
                        action: "super_update_project",
                        masterPin: pinActual(),
                        project_id: p.project_id,
                        fecha_archivo: fecha
                    });
                    showMessage(fecha ? `Se archivará al terminar el ${fecha}.` : "La rifa quedó sin fecha de archivado.", "success");
                    void loadProjectsTable();
                } catch (e) {
                    showMessage(e.message || String(e), "error");
                }
                return;
            }

            const reBtn = ev.target.closest("[data-reactivate-id]");
            if (reBtn) {
                const p = findP(reBtn.getAttribute("data-reactivate-id"));
                const fecha = await pedirVigencia(p, "Reactivar rifa");
                if (fecha == null) return;
                try {
                    await api.post({
                        action: "super_reactivate_project",
                        masterPin: pinActual(),
                        project_id: p.project_id,
                        fecha_archivo: fecha
                    });
                    showMessage("Rifa reactivada: su link vuelve a funcionar.", "success");
                    showHubList("activas");
                    void loadProjectsTable();
                } catch (e) {
                    showMessage(e.message || String(e), "error");
                }
                return;
            }

            const archiveBtn = ev.target.closest("[data-archive-id]");
            if (archiveBtn) {
                const id = archiveBtn.getAttribute("data-archive-id");
                if (
                    !confirm(
                        "¿Archivar esta rifa ahora?\nSu link deja de funcionar. Los números se conservan y la podrás reactivar o eliminar desde «Archivadas»."
                    )
                ) {
                    return;
                }
                try {
                    await api.post({
                        action: "super_delete_project",
                        masterPin: pinActual(),
                        project_id: id,
                        hard: false
                    });
                    showMessage("Rifa archivada.", "success");
                    void loadProjectsTable();
                } catch (e) {
                    showMessage(e.message || String(e), "error");
                }
                return;
            }
            const delBtn = ev.target.closest("[data-del-id]");
            if (delBtn) {
                const id = delBtn.getAttribute("data-del-id");
                if (
                    !confirm(
                        "¿Eliminar esta rifa de forma permanente?\nSe borrará la fila en Proyectos y la hoja de números. Esta acción no se puede deshacer."
                    )
                ) {
                    return;
                }
                try {
                    await api.post({
                        action: "super_delete_project",
                        masterPin: pinActual(),
                        project_id: id,
                        hard: true
                    });
                    showMessage("Rifa eliminada.", "success");
                    void loadProjectsTable();
                } catch (e) {
                    showMessage(e.message || String(e), "error");
                }
            }
        };
        $("rifa-projects-tbody")?.addEventListener("click", onTableClick);
        $("rifa-archived-tbody")?.addEventListener("click", onTableClick);

        $("rifa-new-result")?.addEventListener("click", async (ev) => {
            const copyBtn = ev.target.closest("[data-copy-link]");
            if (!copyBtn) return;
            ev.preventDefault();
            await copyText(copyBtn.getAttribute("data-copy-link"));
        });

        showHubPane("lista");
        finalizeSplash(true);
    }


    /* ---------- Tabla completa, CSV ---------- */
    function renderLista() {
        const tbody = $("rifa-lista-tbody");
        if (!tbody) return;
        tbody.innerHTML = "";
        for (let i = 0; i < 100; i++) {
            const n = String(i).padStart(2, "0");
            const info = datos[n] || { estado: "Disponible", nombre: "", telefono: "", contacto: "" };
            const tr = document.createElement("tr");
            tr.dataset.num = n;
            tr.innerHTML = `
                <td>${n}</td>
                <td>
                    <select class="rifa-input rifa-lista-estado" data-num="${n}">
                        <option value="Disponible" ${info.estado === "Disponible" ? "selected" : ""}>Disponible</option>
                        <option value="Reservado" ${info.estado === "Reservado" ? "selected" : ""}>Reservado</option>
                        <option value="Pagado" ${info.estado === "Pagado" ? "selected" : ""}>Pagado</option>
                    </select>
                </td>
                <td><input type="text" class="rifa-input rifa-lista-nombre" data-num="${n}" value="${escapeAttr(info.nombre)}" /></td>
                <td><input type="text" class="rifa-input rifa-lista-tel" data-num="${n}" value="${escapeAttr(info.telefono)}" /></td>
                <td><input type="text" class="rifa-input rifa-lista-contacto" data-num="${n}" value="${escapeAttr(info.contacto)}" /></td>
            `;
            tbody.appendChild(tr);
        }
        const saveBtn = $("rifa-lista-guardar");
        if (saveBtn) saveBtn.disabled = false;
    }

    async function guardarListaCompleta() {
        const listaCambios = [];
        for (let i = 0; i < 100; i++) {
            const n = String(i).padStart(2, "0");
            const estado = document.querySelector(`.rifa-lista-estado[data-num="${n}"]`)?.value || "Disponible";
            const nombre = document.querySelector(`.rifa-lista-nombre[data-num="${n}"]`)?.value.trim() || "";
            const telefono = document.querySelector(`.rifa-lista-tel[data-num="${n}"]`)?.value.trim() || "";
            const contacto = document.querySelector(`.rifa-lista-contacto[data-num="${n}"]`)?.value.trim() || "";
            listaCambios.push({ num: n, estado, nombre, telefono, contacto });
        }
        try {
            const res = await api.post({
                action: "update_numbers",
                hash: adminHash,
                listaCambios
            });
            datos = numerosFromApi(res.data?.numeros);
            renderGrid();
            renderLista();
            showMessage("Lista guardada.", "success");
        } catch (e) {
            showMessage(e.message || String(e), "error");
        }
    }

    function descargarCsv() {
        const lines = ["numero,estado,nombre,telefono,contacto"];
        for (let i = 0; i < 100; i++) {
            const n = String(i).padStart(2, "0");
            const info = datos[n] || {};
            const cells = [n, info.estado || "", info.nombre || "", info.telefono || "", info.contacto || ""].map(
                (c) => `"${String(c).replace(/"/g, '""')}"`
            );
            lines.push(cells.join(","));
        }
        const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = `rifa_${project?.sheet_name || "export"}.csv`;
        a.click();
        URL.revokeObjectURL(a.href);
    }

    /* ---------- Imagen de la rifa (afiche 1080×1920) ---------- */
    function syncIconUploadPanels() {
        const pairs = [
            ["bn-i-wa", "whatsapp"],
            ["bn-i-sinpe", "sinpe"],
            ["bn-i-tomado", "tomado"]
        ];
        pairs.forEach(([checkId, panel]) => {
            const on = Boolean($(checkId)?.checked);
            document.querySelectorAll(`[data-icon-panel="${panel}"]`).forEach((el) => {
                el.hidden = !on;
            });
        });
    }

    function fillBannerForm(bannerOverride) {
        const b = mergeBanner(bannerOverride !== undefined ? bannerOverride : project?.banner);
        $("bn-bg1").value = b.bg.color1;
        $("bn-bg2").value = b.bg.color2;
        $("bn-grad").checked = !!b.bg.gradient;
        $("bn-orient").value = b.bg.orient || "to bottom";
        $("bn-head-mode").value = b.head.mode || "text";
        $("bn-title").value = b.head.title || project?.nombre_display || project?.sheet_name || "";
        $("bn-logo-url").value = b.head.logoUrl || "";

        const ty = b.typography;
        $("bn-sz-titulo").value = ty.titulo.size;
        $("bn-sz-p1").value = ty.premio1.size;
        $("bn-sz-p2").value = ty.premio2.size;
        $("bn-sz-p3").value = ty.premio3.size;
        $("bn-sz-precio").value = ty.precio.size;
        $("bn-sz-mod").value = ty.modalidadFecha.size;
        $("bn-sz-wa").value = ty.whatsapp.size;
        $("bn-sz-sinpe").value = ty.sinpe.size;
        ensureFontSelectOptions($("bn-f-titulo"), ty.titulo.font);
        ensureFontSelectOptions($("bn-f-p1"), ty.premio1.font);
        ensureFontSelectOptions($("bn-f-p2"), ty.premio2.font);
        ensureFontSelectOptions($("bn-f-p3"), ty.premio3.font);
        ensureFontSelectOptions($("bn-f-precio"), ty.precio.font);
        ensureFontSelectOptions($("bn-f-mod"), ty.modalidadFecha.font);
        ensureFontSelectOptions($("bn-f-wa"), ty.whatsapp.font);
        ensureFontSelectOptions($("bn-f-sinpe"), ty.sinpe.font);

        $("bn-c-titulo").value = b.textColors.titulo || "#222222";
        $("bn-c-p1").value = b.textColors.premio1;
        $("bn-c-p2").value = b.textColors.premio2;
        $("bn-c-p3").value = b.textColors.premio3;
        $("bn-c-costo").value = b.textColors.costo;
        $("bn-c-mod").value = b.textColors.modalidadFecha;
        $("bn-c-wa").value = b.textColors.whatsapp;
        $("bn-c-sinpe").value = b.textColors.sinpe;
        $("bn-n-dt").value = b.numberColors.disponibleText;
        $("bn-n-db").value = b.numberColors.disponibleBg;
        $("bn-n-tt").value = b.numberColors.tomadoText;
        $("bn-n-tb").value = b.numberColors.tomadoBg;
        $("bn-i-wa").checked = !!b.icons.whatsapp.enabled;
        $("bn-i-sinpe").checked = !!b.icons.sinpe.enabled;
        $("bn-i-tomado").checked = !!b.icons.tomado.enabled;
        $("bn-i-wa-url").value = b.icons.whatsapp.url || "";
        $("bn-i-sinpe-url").value = b.icons.sinpe.url || "";
        $("bn-i-tomado-url").value = b.icons.tomado.url || "";
        // Una sola letra para todo, salvo que el diseño guardado ya use letras distintas
        const fuentes = new Set(TYPO_FONT_IDS.map((id) => $(id)?.value));
        ensureFontSelectOptions($("bn-font-all"), ty.titulo.font);
        $("bn-font-each").checked = fuentes.size > 1;
        syncHeadMode();
        syncIconUploadPanels();
        syncCustomUi();
    }

    const TYPO_FONT_IDS = ["bn-f-titulo", "bn-f-p1", "bn-f-p2", "bn-f-p3", "bn-f-precio", "bn-f-mod", "bn-f-wa", "bn-f-sinpe"];

    /** Estado visual de «Personalizar»: botones elegidos, campos que aplican y valores en px. */
    function syncCustomUi() {
        const grad = !!$("bn-grad")?.checked;
        document.querySelectorAll("[data-bg-modo]").forEach((b) => {
            const on = (b.getAttribute("data-bg-modo") === "degradado") === grad;
            b.classList.toggle("is-active", on);
            b.setAttribute("aria-checked", String(on));
        });
        document.querySelectorAll("[data-solo-degradado]").forEach((el) => (el.hidden = !grad));
        const bg1 = $("bn-bg1-label");
        if (bg1) bg1.textContent = grad ? "Primer color" : "Color del fondo";

        document.querySelectorAll("[data-sz-out]").forEach((o) => {
            o.textContent = `${$(o.getAttribute("data-sz-out"))?.value || ""}`;
        });
        $("bn-sizes")?.classList.toggle("is-font-each", !!$("bn-font-each")?.checked);

        const n = project?.cantidad_premios || 1;
        document.querySelectorAll("[data-bn-premio]").forEach((el) => {
            el.hidden = Number(el.getAttribute("data-bn-premio")) > n;
        });

        const url = $("bn-logo-url")?.value || "";
        const thumb = $("bn-logo-thumb");
        if (thumb) {
            thumb.innerHTML = url ? `<img src="${escapeAttr(url)}" alt="Logotipo" />` : "<span>Sin logotipo</span>";
        }
        const clear = $("bn-logo-clear");
        if (clear) clear.hidden = !url;
        const pick = $("bn-logo-pick-label");
        if (pick) pick.textContent = url ? "Cambiar imagen" : "Elegir imagen";

        document.querySelectorAll("[data-icon-reset]").forEach((b) => {
            const kind = b.getAttribute("data-icon-reset");
            b.hidden = !$(ICON_URL_IDS[kind])?.value;
        });
    }

    const ICON_URL_IDS = { whatsapp: "bn-i-wa-url", sinpe: "bn-i-sinpe-url", tomado: "bn-i-tomado-url" };

    function resetBannerToDefaults() {
        const base = defaultBanner();
        base.head.title = project?.nombre_display || project?.sheet_name || "";
        base.head.mode = "text";
        base.head.logoUrl = "";
        fillBannerForm(base);
        refreshBannerPreview();
        showMessage("Estilos del banner restablecidos a valores neutrales por defecto.", "success");
    }

    function syncHeadMode() {
        const modeH = $("bn-head-mode")?.value;
        const tw = $("bn-head-text-wrap");
        const lw = $("bn-head-logo-wrap");
        if (tw) tw.hidden = modeH !== "text";
        if (lw) lw.hidden = modeH !== "logo";
        document.querySelectorAll("[data-head-modo]").forEach((b) => {
            const on = b.getAttribute("data-head-modo") === modeH;
            b.classList.toggle("is-active", on);
            b.setAttribute("aria-checked", String(on));
        });

        const tituloCell = document.querySelector('.rf-size[data-typo="titulo"]');
        const label = $("bn-typo-titulo-label");
        const fontSel = $("bn-f-titulo");
        const isLogo = modeH === "logo";
        if (tituloCell) tituloCell.classList.toggle("is-logo-mode", isLogo);
        if (label) label.textContent = isLogo ? "Alto del logotipo" : "Encabezado";
        if (fontSel) fontSel.hidden = isLogo;
        // El color del encabezado no aplica a un logotipo
        const colorTitulo = $("bn-c-titulo-wrap");
        if (colorTitulo) colorTitulo.hidden = isLogo;
    }

    function setHeadMode(modeH) {
        const sizeEl = $("bn-sz-titulo");
        // Al pasar a logo, si el tamaño sigue siendo el de texto por defecto, usar altura típica de logo
        if (modeH === "logo" && sizeEl && Number(sizeEl.value) === 56) {
            sizeEl.value = "160";
        } else if (modeH === "text" && sizeEl && Number(sizeEl.value) === 160) {
            sizeEl.value = "56";
        }
        $("bn-head-mode").value = modeH;
        syncHeadMode();
        syncCustomUi();
        refreshBannerPreview();
    }

    function readTypographyFromForm() {
        const defaults = defaultTypography();
        return {
            titulo: {
                size: clampBannerPx($("bn-sz-titulo")?.value, defaults.titulo.size),
                font: $("bn-f-titulo")?.value || defaults.titulo.font
            },
            premio1: {
                size: clampBannerPx($("bn-sz-p1")?.value, defaults.premio1.size),
                font: $("bn-f-p1")?.value || defaults.premio1.font
            },
            premio2: {
                size: clampBannerPx($("bn-sz-p2")?.value, defaults.premio2.size),
                font: $("bn-f-p2")?.value || defaults.premio2.font
            },
            premio3: {
                size: clampBannerPx($("bn-sz-p3")?.value, defaults.premio3.size),
                font: $("bn-f-p3")?.value || defaults.premio3.font
            },
            precio: {
                size: clampBannerPx($("bn-sz-precio")?.value, defaults.precio.size),
                font: $("bn-f-precio")?.value || defaults.precio.font
            },
            modalidadFecha: {
                size: clampBannerPx($("bn-sz-mod")?.value, defaults.modalidadFecha.size),
                font: $("bn-f-mod")?.value || defaults.modalidadFecha.font
            },
            whatsapp: {
                size: clampBannerPx($("bn-sz-wa")?.value, defaults.whatsapp.size),
                font: $("bn-f-wa")?.value || defaults.whatsapp.font
            },
            sinpe: {
                size: clampBannerPx($("bn-sz-sinpe")?.value, defaults.sinpe.size),
                font: $("bn-f-sinpe")?.value || defaults.sinpe.font
            }
        };
    }

    function readBannerFromForm() {
        const typography = readTypographyFromForm();
        return {
            bg: {
                color1: $("bn-bg1").value,
                color2: $("bn-bg2").value,
                gradient: $("bn-grad").checked,
                orient: $("bn-orient").value
            },
            // Compatibilidad con diseños antiguos: fuente global = título
            font: typography.titulo.font,
            head: {
                mode: $("bn-head-mode").value,
                title: $("bn-title").value,
                logoUrl: $("bn-logo-url").value
            },
            typography,
            textColors: {
                titulo: $("bn-c-titulo")?.value || "#FFFFFF",
                premio1: $("bn-c-p1").value,
                premio2: $("bn-c-p2").value,
                premio3: $("bn-c-p3").value,
                costo: $("bn-c-costo").value,
                modalidadFecha: $("bn-c-mod").value,
                whatsapp: $("bn-c-wa").value,
                sinpe: $("bn-c-sinpe").value
            },
            numberColors: {
                disponibleText: $("bn-n-dt").value,
                disponibleBg: $("bn-n-db").value,
                tomadoText: $("bn-n-tt").value,
                tomadoBg: $("bn-n-tb").value
            },
            icons: {
                whatsapp: { enabled: $("bn-i-wa").checked, url: $("bn-i-wa-url").value },
                sinpe: { enabled: $("bn-i-sinpe").checked, url: $("bn-i-sinpe-url").value },
                tomado: { enabled: $("bn-i-tomado").checked, url: $("bn-i-tomado-url").value }
            }
        };
    }

    function formatFechaLargaEs(iso) {
        const f = String(iso || "").trim().slice(0, 10);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(f)) return f;
        const [y, m, d] = f.split("-").map(Number);
        const dt = new Date(y, m - 1, d);
        if (Number.isNaN(dt.getTime())) return f;
        const dias = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
        const meses = [
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
        return `${dias[dt.getDay()]} ${d} de ${meses[m - 1]} de ${y}`;
    }

    function premioLabel(i) {
        if (i === 1) return "1er Premio";
        if (i === 2) return "2do Premio";
        return "3er Premio";
    }

    function buildBannerHtml(b, forCapture, previewScale) {
        const bg = b.bg.gradient
            ? `linear-gradient(${b.bg.orient}, ${b.bg.color1}, ${b.bg.color2})`
            : b.bg.color1;
        const n = project?.cantidad_premios || 1;
        const tTitulo = typoOf(b, "titulo");
        const tP1 = typoOf(b, "premio1");
        const tP2 = typoOf(b, "premio2");
        const tP3 = typoOf(b, "premio3");
        const tPrecio = typoOf(b, "precio");
        const tMod = typoOf(b, "modalidadFecha");
        const tWa = typoOf(b, "whatsapp");
        const tSinpe = typoOf(b, "sinpe");

        const premios = [];
        if (n >= 1 && project?.premio_1) {
            premios.push({ label: premioLabel(1), t: project.premio_1, c: b.textColors.premio1, typo: tP1 });
        }
        if (n >= 2 && project?.premio_2) {
            premios.push({ label: premioLabel(2), t: project.premio_2, c: b.textColors.premio2, typo: tP2 });
        }
        if (n >= 3 && project?.premio_3) {
            premios.push({ label: premioLabel(3), t: project.premio_3, c: b.textColors.premio3, typo: tP3 });
        }

        const titleColor = b.textColors.titulo || "#FFFFFF";
        let headHtml = "";
        if (b.head.mode === "logo" && b.head.logoUrl) {
            const logoH = tTitulo.size;
            headHtml = `<img src="${escapeAttr(b.head.logoUrl)}" alt="" style="max-width:420px;height:${logoH}px;width:auto;object-fit:contain;" crossorigin="anonymous" />`;
        } else {
            const title = b.head.title || project?.nombre_display || project?.sheet_name || "Rifa";
            headHtml = `<div style="font-family:${escapeAttr(tTitulo.font)};font-size:${tTitulo.size}px;font-weight:700;color:${escapeAttr(titleColor)};text-align:center;line-height:1.15;word-break:break-word;">${escapeHtml(title)}</div>`;
        }

        let cells = "";
        for (let i = 0; i < 100; i++) {
            const num = String(i).padStart(2, "0");
            const info = datos[num] || { estado: "Disponible" };
            const taken = info.estado === "Reservado" || info.estado === "Pagado";
            const bgc = taken ? b.numberColors.tomadoBg : b.numberColors.disponibleBg;
            const tc = taken ? b.numberColors.tomadoText : b.numberColors.disponibleText;
            let inner = num;
            if (taken) {
                if (b.icons.tomado.enabled) {
                    const src = b.icons.tomado.url || DEFAULT_ICON.tomado;
                    inner = `<img src="${escapeAttr(src)}" alt="" style="width:70%;height:70%;object-fit:contain;" crossorigin="anonymous" />`;
                } else {
                    inner = "ø";
                }
            }
            cells += `<div style="width:100%;aspect-ratio:1;display:flex;align-items:center;justify-content:center;background:${bgc};color:${tc};font-size:26px;font-weight:700;border-radius:6px;box-sizing:border-box;">${inner}</div>`;
        }

        const waIcon =
            b.icons.whatsapp.enabled
                ? `<img src="${escapeAttr(b.icons.whatsapp.url || DEFAULT_ICON.whatsapp)}" style="width:${tWa.size}px;height:${tWa.size}px;object-fit:contain;flex-shrink:0;" crossorigin="anonymous" />`
                : "";
        const sinpeIcon =
            b.icons.sinpe.enabled
                ? `<img src="${escapeAttr(b.icons.sinpe.url || DEFAULT_ICON.sinpe)}" style="width:${tSinpe.size}px;height:${tSinpe.size}px;object-fit:contain;flex-shrink:0;" crossorigin="anonymous" />`
                : "";

        const premiosHtml = premios
            .map(
                (p) =>
                    `<div style="font-family:${escapeAttr(p.typo.font)};color:${p.c};font-size:${p.typo.size}px;margin:4px 0;text-align:center;font-weight:700;line-height:1.2;">${escapeHtml(p.label)}: ${escapeHtml(p.t)}</div>`
            )
            .join("");

        const precioTxt = `Precio: ${formatColonPrice(project?.precio || "")}`;
        const fechaLarga = formatFechaLargaEs(project?.fecha_sorteo || "");
        const modFecha = `${project?.modalidad || ""}${fechaLarga ? ": " + fechaLarga : ""}`;
        const baseFont = tTitulo.font || b.font || "Inter, sans-serif";

        // Cuadrícula fija 10×10 dentro del ancho útil (1080 - padding)
        const bannerInner = `<div data-rifa-banner-root="1" style="width:1080px;height:1920px;background:${bg};font-family:${escapeAttr(baseFont)};display:flex;flex-direction:column;align-items:stretch;justify-content:center;padding:40px 40px 48px;box-sizing:border-box;color:#fff;overflow:hidden;">
            <div style="flex:0 0 auto;display:flex;justify-content:center;margin-bottom:16px;">${headHtml}</div>
            <div style="flex:0 0 auto;margin-bottom:12px;">${premiosHtml}</div>
            <div style="flex:0 0 auto;width:100%;max-width:1000px;margin:12px auto 20px;display:grid;grid-template-columns:repeat(10,minmax(0,1fr));grid-template-rows:repeat(10,minmax(0,1fr));gap:6px;aspect-ratio:1/1;align-self:center;">${cells}</div>
            <div style="flex:0 0 28px;"></div>
            <div style="flex:0 0 auto;text-align:center;">
                <div style="font-family:${escapeAttr(tPrecio.font)};color:${b.textColors.costo};font-size:${tPrecio.size}px;font-weight:700;margin:8px 0;">${escapeHtml(precioTxt)}</div>
                <div style="font-family:${escapeAttr(tMod.font)};color:${b.textColors.modalidadFecha};font-size:${tMod.size}px;margin:8px 0;line-height:1.25;">${escapeHtml(modFecha)}</div>
                <div style="font-family:${escapeAttr(tWa.font)};display:flex;align-items:center;justify-content:center;gap:12px;margin-top:12px;color:${b.textColors.whatsapp};font-size:${tWa.size}px;">${waIcon}<span>${escapeHtml(project?.whatsapp || "")}</span></div>
                <div style="font-family:${escapeAttr(tSinpe.font)};display:flex;align-items:center;justify-content:center;gap:12px;margin-top:8px;color:${b.textColors.sinpe};font-size:${tSinpe.size}px;">${sinpeIcon}<span>${escapeHtml(project?.sinpe || "")}</span></div>
            </div>
        </div>`;

        if (forCapture) return bannerInner;

        const scale = previewScale || 0.35;
        const w = Math.round(1080 * scale);
        const h = Math.round(1920 * scale);
        return `<div style="width:${w}px;height:${h}px;overflow:hidden;position:relative;flex-shrink:0;">
            <div style="position:absolute;top:0;left:0;transform:scale(${scale});transform-origin:top left;">${bannerInner}</div>
        </div>`;
    }

    function refreshBannerPreview() {
        const stage = $("rifa-banner-stage");
        if (!stage) return;
        const b = readBannerFromForm();
        const ancho = stage.parentElement?.clientWidth || 0;
        // En el teléfono la vista previa no debe empujar el mensaje fuera de la pantalla
        const altoMax = window.innerWidth <= 768 ? 400 : 640;
        const scale = ancho ? Math.max(0.15, Math.min(0.32, (ancho - 2) / 1080, altoMax / 1920)) : 0.3;
        stage.innerHTML = buildBannerHtml(b, false, scale);
        stage.style.width = "auto";
        stage.style.height = "auto";
        stage.style.overflow = "visible";
        // Copia pequeña que acompaña mientras se baja por «Personalizar»
        const mini = $("bn-mini-preview");
        if (mini && $("rf-banner-advanced")?.open) mini.innerHTML = buildBannerHtml(b, false, 0.1);
    }

    async function uploadImageToImgBB(file) {
        const key =
            (typeof window !== "undefined" && window.CPM_IMGBB_API_KEY) ||
            "b0c1f3375bcac127ec096aa006f93b52";
        const fd = new FormData();
        fd.append("image", file);
        const res = await fetch(`https://api.imgbb.com/1/upload?key=${encodeURIComponent(key)}`, {
            method: "POST",
            body: fd
        });
        const json = await res.json();
        if (!json?.success || !json?.data?.url) {
            throw new Error(json?.error?.message || "No se pudo subir la imagen a ImgBB.");
        }
        return json.data.url;
    }

    /** En móvil el <a download> con data: URL no guarda nada: se usa overlay + Web Share. */
    function isMobileLike() {
        if (typeof navigator === "undefined") return false;
        const ua = navigator.userAgent || "";
        const iPadOS = /Macintosh/i.test(ua) && (navigator.maxTouchPoints || 0) > 1;
        return /Android|iPhone|iPad|iPod|Mobile|Silk/i.test(ua) || iPadOS;
    }

    function canvasToBlob(canvas, type, quality) {
        return new Promise((resolve, reject) => {
            if (typeof canvas.toBlob === "function") {
                canvas.toBlob(
                    (blob) =>
                        blob ? resolve(blob) : reject(new Error("No se pudo generar la imagen.")),
                    type,
                    quality
                );
                return;
            }
            try {
                const bin = atob(canvas.toDataURL(type, quality).split(",")[1]);
                const arr = new Uint8Array(bin.length);
                for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
                resolve(new Blob([arr], { type }));
            } catch (e) {
                reject(e);
            }
        });
    }

    function downloadBlob(blob, filename) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        a.rel = "noopener";
        a.style.display = "none";
        document.body.appendChild(a);
        a.click();
        setTimeout(() => {
            a.remove();
            URL.revokeObjectURL(url);
        }, 30000);
    }

    function closeBannerResult() {
        const prev = $("rifa-banner-result");
        if (!prev) return;
        const url = prev.getAttribute("data-object-url");
        if (url) URL.revokeObjectURL(url);
        prev.remove();
    }

    /** El portapapeles solo acepta PNG: se convierte la imagen ya mostrada. */
    function imagenAPng(img) {
        return new Promise((resolve, reject) => {
            const pintar = () => {
                try {
                    const c = document.createElement("canvas");
                    c.width = img.naturalWidth || 1080;
                    c.height = img.naturalHeight || 1920;
                    c.getContext("2d").drawImage(img, 0, 0);
                    canvasToBlob(c, "image/png")
                        .then(resolve, reject)
                        .finally(() => (c.width = c.height = 0));
                } catch (e) {
                    reject(e);
                }
            };
            if (img.complete && img.naturalWidth) pintar();
            else {
                img.addEventListener("load", pintar, { once: true });
                img.addEventListener("error", () => reject(new Error("No se pudo leer la imagen.")), { once: true });
            }
        });
    }

    /**
     * Ventana con la imagen ya creada. Cada botón es un toque nuevo: el iPhone solo
     * abre el menú de compartir justo después de un toque, nunca al terminar una espera.
     * Con `text` se ofrece además compartir o copiar el mensaje.
     */
    function openBannerResult(blob, filename, text) {
        closeBannerResult();
        const url = URL.createObjectURL(blob);
        const p = plataforma();
        const conMensaje = !!(text && text.trim());
        let file = null;
        try {
            file = new File([blob], filename, { type: blob.type || "image/jpeg" });
        } catch (e) {
            file = null;
        }
        let canShareFile = false;
        try {
            canShareFile = !!(file && navigator.share && navigator.canShare && navigator.canShare({ files: [file] }));
        } catch (e) {
            canShareFile = false;
        }
        const canCopyImg = !!(window.ClipboardItem && navigator.clipboard && navigator.clipboard.write);
        // En el iPhone «Descargar» deja el archivo en la app Archivos (y desde el acceso directo no funciona):
        // el menú de compartir tiene «Guardar imagen», que la manda a Fotos.
        const guardarPorMenu = p.iOS && canShareFile;
        const movil = isMobileLike();

        let hint;
        if (conMensaje && canShareFile) {
            hint = "Toque <strong>Compartir imagen y mensaje</strong> y elija WhatsApp u otra app. El mensaje queda copiado: si la app solo toma la imagen, péguelo en el chat.";
        } else if (conMensaje) {
            hint = "Guarde la imagen y copie el mensaje. Luego adjunte la imagen en el chat y pegue el mensaje.";
        } else if (guardarPorMenu) {
            hint = "Toque <strong>Guardar en Fotos</strong> y, en el menú que se abre, elija <strong>«Guardar imagen»</strong>.";
        } else {
            hint = "Imagen lista para guardar o compartir.";
        }
        if (movil) hint += " También puede mantener presionada la imagen para guardarla.";

        const botones = [];
        if (canShareFile) {
            botones.push(
                conMensaje
                    ? '<button type="button" class="rifa-btn rifa-btn--primary" data-act="share-both">Compartir imagen y mensaje</button>'
                    : '<button type="button" class="rifa-btn rifa-btn--primary" data-act="share">Compartir imagen</button>'
            );
        }
        botones.push(
            `<button type="button" class="rifa-btn${!canShareFile ? " rifa-btn--primary" : ""}" data-act="save">${
                guardarPorMenu ? "Guardar en Fotos" : "Descargar imagen"
            }</button>`
        );
        if (canCopyImg) botones.push('<button type="button" class="rifa-btn" data-act="copy-img">Copiar imagen</button>');
        if (conMensaje) botones.push('<button type="button" class="rifa-btn" data-act="copy-text">Copiar mensaje</button>');
        botones.push('<button type="button" class="rifa-btn" data-act="close">Cerrar</button>');

        const ov = document.createElement("div");
        ov.id = "rifa-banner-result";
        ov.className = "rifa-banner-result";
        ov.setAttribute("data-object-url", url);
        ov.innerHTML = `
            <div class="rifa-banner-result__box" role="dialog" aria-modal="true" aria-label="Imagen de la rifa">
                <p class="rifa-banner-result__hint">${hint}</p>
                <div class="rifa-banner-result__imgwrap">
                    <img class="rifa-banner-result__img" alt="Imagen de la rifa" src="${escapeAttr(url)}" />
                </div>
                <div class="rifa-banner-result__actions">${botones.join("")}</div>
            </div>`;
        const img = ov.querySelector("img");

        const compartir = async (data) => {
            try {
                await navigator.share(data);
                return true;
            } catch (e) {
                if (e?.name === "AbortError") return false;
                showMessage(
                    movil
                        ? "No se pudo abrir el menú de compartir. Mantenga presionada la imagen para guardarla."
                        : "No se pudo abrir el menú de compartir. Use «Descargar imagen».",
                    "error"
                );
                return false;
            }
        };

        ov.addEventListener("click", async (ev) => {
            const btn = ev.target.closest("[data-act]");
            if (!btn) {
                if (ev.target === ov) closeBannerResult();
                return;
            }
            const act = btn.getAttribute("data-act");
            if (act === "close") {
                closeBannerResult();
            } else if (act === "save") {
                if (guardarPorMenu) {
                    // Solo el archivo: si va con texto, el iPhone esconde «Guardar imagen».
                    await compartir({ files: [file] });
                } else {
                    downloadBlob(blob, filename);
                    showMessage("Imagen descargada.", "success");
                }
            } else if (act === "share") {
                await compartir({ files: [file], title: tituloRifa() });
            } else if (act === "share-both") {
                // Se copia sin esperar: el menú de compartir tiene que abrirse en este mismo toque.
                try {
                    navigator.clipboard?.writeText(text).catch(() => {});
                } catch (e) {
                    /* sin portapapeles: el botón «Copiar mensaje» sigue disponible */
                }
                const ok = await compartir({ files: [file], text, title: tituloRifa() });
                if (ok) showMessage("Listo. Si el mensaje no aparece junto a la imagen, péguelo en el chat: ya está copiado.", "success");
            } else if (act === "copy-img") {
                try {
                    // Se pasa la promesa (no el archivo ya hecho) para que Safari acepte la copia en este toque.
                    await navigator.clipboard.write([new ClipboardItem({ "image/png": imagenAPng(img) })]);
                    showMessage("Imagen copiada. Péguela en el chat (por ejemplo en WhatsApp Web).", "success");
                } catch (e) {
                    showMessage("No se pudo copiar la imagen. Use «Descargar imagen».", "error");
                }
            } else if (act === "copy-text") {
                await copiarTexto(text, "Mensaje copiado. Péguelo en el chat o grupo.");
            }
        });

        document.body.appendChild(ov);
    }

    function nombreArchivoImagen() {
        const base = String(project?.nombre_display || project?.sheet_name || "rifa")
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .replace(/[^A-Za-z0-9]+/g, "_")
            .replace(/^_+|_+$/g, "");
        return `Rifa_${base || "numeros"}.jpg`;
    }

    /** Carga una imagen para el canvas; si falla o tarda, se omite en vez de trabar todo. */
    function cargarImagen(src) {
        return new Promise((resolve) => {
            if (!src) {
                resolve(null);
                return;
            }
            const img = new Image();
            img.crossOrigin = "anonymous";
            let listo = false;
            const fin = (ok) => {
                if (listo) return;
                listo = true;
                clearTimeout(t);
                resolve(ok && img.naturalWidth ? img : null);
            };
            const t = setTimeout(() => fin(false), 8000);
            img.onload = () => fin(true);
            img.onerror = () => fin(false);
            img.src = src;
        });
    }

    /** Espera las fuentes del afiche, con tope: sin ellas se dibuja con la de respaldo. */
    function cargarFuentes(specs) {
        if (!document.fonts || typeof document.fonts.load !== "function") return Promise.resolve();
        const todas = Promise.all(specs.map((s) => document.fonts.load(s).catch(() => null)));
        return Promise.race([todas, new Promise((r) => setTimeout(r, 4000))]);
    }

    /** Parte el texto en líneas que caben en `ancho` (como word-break: break-word). */
    function partirLineas(ctx, texto, ancho) {
        const out = [];
        String(texto || "")
            .split("\n")
            .forEach((par) => {
                let linea = "";
                par.split(/\s+/)
                    .filter(Boolean)
                    .forEach((pal) => {
                        const prueba = linea ? linea + " " + pal : pal;
                        if (!linea || ctx.measureText(prueba).width <= ancho) {
                            linea = prueba;
                        } else {
                            out.push(linea);
                            linea = pal;
                        }
                        // Palabra más ancha que el espacio: se corta por letras
                        while (linea.length > 1 && ctx.measureText(linea).width > ancho) {
                            let i = linea.length - 1;
                            while (i > 1 && ctx.measureText(linea.slice(0, i)).width > ancho) i--;
                            out.push(linea.slice(0, i));
                            linea = linea.slice(i);
                        }
                    });
                out.push(linea);
            });
        return out;
    }

    /** Equivalente a object-fit: contain dentro de la caja (x, y, w, h). */
    function dibujarContenida(ctx, img, x, y, w, h) {
        const r = Math.min(w / img.naturalWidth, h / img.naturalHeight);
        const dw = img.naturalWidth * r;
        const dh = img.naturalHeight * r;
        ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
    }

    function rectRedondeado(ctx, x, y, w, h, r) {
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.arcTo(x + w, y, x + w, y + h, r);
        ctx.arcTo(x + w, y + h, x, y + h, r);
        ctx.arcTo(x, y + h, x, y, r);
        ctx.arcTo(x, y, x + w, y, r);
        ctx.closePath();
    }

    /** Degradado con la misma dirección que el CSS (to bottom, to right o grados). */
    function fondoBanner(ctx, b, W, H) {
        if (!b.bg.gradient) return b.bg.color1;
        const o = String(b.bg.orient || "to bottom").trim();
        let deg = 180;
        if (o === "to right") deg = 90;
        else if (o === "to left") deg = 270;
        else if (o === "to top") deg = 0;
        else if (/^-?\d+(\.\d+)?deg$/.test(o)) deg = parseFloat(o);
        const a = (deg * Math.PI) / 180;
        const dx = Math.sin(a);
        const dy = -Math.cos(a);
        const half = (Math.abs(W * dx) + Math.abs(H * dy)) / 2;
        const cx = W / 2;
        const cy = H / 2;
        const g = ctx.createLinearGradient(cx - dx * half, cy - dy * half, cx + dx * half, cy + dy * half);
        g.addColorStop(0, b.bg.color1);
        g.addColorStop(1, b.bg.color2);
        return g;
    }

    /**
     * Dibuja el afiche 1080×1920 directo en un canvas, con el mismo diseño que la vista previa.
     * Antes se fotografiaba el HTML con html2canvas, pero en el iPhone esa copia a veces se
     * quedaba esperando para siempre y el botón no volvía a responder hasta cerrar la pestaña.
     */
    async function dibujarBanner(b) {
        const W = 1080;
        const H = 1920;
        const INNER = 1000;
        const n = project?.cantidad_premios || 1;
        const tTitulo = typoOf(b, "titulo");
        const tPrecio = typoOf(b, "precio");
        const tMod = typoOf(b, "modalidadFecha");
        const tWa = typoOf(b, "whatsapp");
        const tSinpe = typoOf(b, "sinpe");
        const baseFont = tTitulo.font || b.font || "Inter, sans-serif";

        const premios = [];
        [1, 2, 3].forEach((i) => {
            const t = project?.[`premio_${i}`];
            if (n >= i && t) {
                premios.push({ txt: `${premioLabel(i)}: ${t}`, c: b.textColors[`premio${i}`], typo: typoOf(b, `premio${i}`) });
            }
        });

        const usaLogo = b.head.mode === "logo" && b.head.logoUrl;
        const [logo, icoWa, icoSinpe, icoTomado] = await Promise.all([
            usaLogo ? cargarImagen(b.head.logoUrl) : null,
            b.icons.whatsapp.enabled ? cargarImagen(b.icons.whatsapp.url || DEFAULT_ICON.whatsapp) : null,
            b.icons.sinpe.enabled ? cargarImagen(b.icons.sinpe.url || DEFAULT_ICON.sinpe) : null,
            b.icons.tomado.enabled ? cargarImagen(b.icons.tomado.url || DEFAULT_ICON.tomado) : null,
            cargarFuentes([
                `700 ${tTitulo.size}px ${tTitulo.font}`,
                `700 26px ${baseFont}`,
                `700 ${tPrecio.size}px ${tPrecio.font}`,
                `400 ${tMod.size}px ${tMod.font}`,
                `400 ${tWa.size}px ${tWa.font}`,
                `400 ${tSinpe.size}px ${tSinpe.font}`,
                ...premios.map((p) => `700 ${p.typo.size}px ${p.typo.font}`)
            ])
        ]);

        const canvas = document.createElement("canvas");
        canvas.width = W;
        canvas.height = H;
        const ctx = canvas.getContext("2d");
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        const fuente = (peso, t) => `${peso} ${t.size}px ${t.font}`;

        // Cada bloque mide su alto primero; luego todo se centra en vertical como el flex del HTML.
        const bloques = [];
        const texto = (txt, t, peso, color, lh, mt, mb) => {
            ctx.font = fuente(peso, t);
            const lineas = partirLineas(ctx, txt, INNER);
            const alto = lineas.length * t.size * lh;
            bloques.push({
                h: mt + alto + mb,
                draw(y) {
                    ctx.font = fuente(peso, t);
                    ctx.fillStyle = color;
                    lineas.forEach((l, i) => ctx.fillText(l, W / 2, y + mt + (i + 0.5) * t.size * lh));
                }
            });
        };
        const fila = (txt, t, ico, color, mt) => {
            const alto = Math.max(ico ? t.size : 0, t.size * 1.2);
            bloques.push({
                h: mt + alto,
                draw(y) {
                    ctx.font = fuente(400, t);
                    ctx.fillStyle = color;
                    const tw = ctx.measureText(txt).width;
                    const total = (ico ? t.size + 12 : 0) + tw;
                    let x = (W - total) / 2;
                    const cy = y + mt + alto / 2;
                    if (ico) {
                        dibujarContenida(ctx, ico, x, cy - t.size / 2, t.size, t.size);
                        x += t.size + 12;
                    }
                    ctx.textAlign = "left";
                    ctx.fillText(txt, x, cy);
                    ctx.textAlign = "center";
                }
            });
        };

        // Encabezado: logotipo o título
        if (usaLogo) {
            const h = tTitulo.size;
            bloques.push({
                h: h + 16,
                draw(y) {
                    if (!logo) return;
                    const w = Math.min(420, (logo.naturalWidth / logo.naturalHeight) * h);
                    dibujarContenida(ctx, logo, (W - w) / 2, y, w, h);
                }
            });
        } else {
            const title = b.head.title || project?.nombre_display || project?.sheet_name || "Rifa";
            texto(title, tTitulo, 700, b.textColors.titulo || "#FFFFFF", 1.15, 0, 16);
        }

        // Premios (separados 4 px, con 12 px antes de la cuadrícula)
        premios.forEach((p, i) =>
            texto(p.txt, p.typo, 700, p.c, 1.2, 4, i === premios.length - 1 ? 4 + 12 : 0)
        );
        if (!premios.length) bloques.push({ h: 12, draw() {} });

        // Cuadrícula 10×10
        const GAP = 6;
        const celda = (INNER - GAP * 9) / 10;
        bloques.push({
            h: 12 + INNER + 20,
            draw(y) {
                const x0 = (W - INNER) / 2;
                const y0 = y + 12;
                ctx.font = `700 26px ${baseFont}`;
                for (let i = 0; i < 100; i++) {
                    const num = String(i).padStart(2, "0");
                    const info = datos[num] || { estado: "Disponible" };
                    const taken = info.estado === "Reservado" || info.estado === "Pagado";
                    const x = x0 + (i % 10) * (celda + GAP);
                    const yy = y0 + Math.floor(i / 10) * (celda + GAP);
                    ctx.fillStyle = taken ? b.numberColors.tomadoBg : b.numberColors.disponibleBg;
                    rectRedondeado(ctx, x, yy, celda, celda, 6);
                    ctx.fill();
                    if (taken && b.icons.tomado.enabled) {
                        if (icoTomado) dibujarContenida(ctx, icoTomado, x + celda * 0.15, yy + celda * 0.15, celda * 0.7, celda * 0.7);
                        continue;
                    }
                    ctx.fillStyle = taken ? b.numberColors.tomadoText : b.numberColors.disponibleText;
                    ctx.fillText(taken ? "ø" : num, x + celda / 2, yy + celda / 2);
                }
            }
        });
        bloques.push({ h: 28, draw() {} });

        // Precio, modalidad y fecha, WhatsApp y SINPE
        const fechaLarga = formatFechaLargaEs(project?.fecha_sorteo || "");
        texto(`Precio: ${formatColonPrice(project?.precio || "")}`, tPrecio, 700, b.textColors.costo, 1.2, 8, 0);
        texto(`${project?.modalidad || ""}${fechaLarga ? ": " + fechaLarga : ""}`, tMod, 400, b.textColors.modalidadFecha, 1.25, 8, 0);
        fila(project?.whatsapp || "", tWa, icoWa, b.textColors.whatsapp, 12);
        fila(project?.sinpe || "", tSinpe, icoSinpe, b.textColors.sinpe, 8);

        ctx.fillStyle = fondoBanner(ctx, b, W, H);
        ctx.fillRect(0, 0, W, H);
        const total = bloques.reduce((s, x) => s + x.h, 0);
        let y = 40 + (H - 40 - 48 - total) / 2;
        bloques.forEach((x) => {
            x.draw(y);
            y += x.h;
        });
        return canvas;
    }

    /** Dibuja el afiche a 1080×1920 y lo devuelve como JPG. */
    async function generarBannerBlob() {
        if (bannerBusy) throw new Error("La imagen ya se está generando.");
        bannerBusy = true;
        const buttons = Array.from(document.querySelectorAll('[data-share-act="both"], [data-share-act="download"]'));
        buttons.forEach((btn) => (btn.disabled = true));
        showMessage("Creando la imagen…", "info");
        let canvas = null;
        try {
            canvas = await dibujarBanner(readBannerFromForm());
            return await canvasToBlob(canvas, "image/jpeg", 0.92);
        } finally {
            // El iPhone limita la memoria total de los canvas: se libera en cuanto hay JPG.
            if (canvas) canvas.width = canvas.height = 0;
            buttons.forEach((btn) => (btn.disabled = false));
            bannerBusy = false;
        }
    }

    async function descargarBannerJpg() {
        if (bannerBusy) return;
        try {
            const blob = await generarBannerBlob();
            const filename = nombreArchivoImagen();
            if (isMobileLike()) {
                openBannerResult(blob, filename);
            } else {
                downloadBlob(blob, filename);
                showMessage("Imagen descargada.", "success");
            }
        } catch (e) {
            showMessage(e.message || String(e), "error");
        }
    }

    async function runRng() {
        if (rngBusy) return;
        const nPremios = project?.cantidad_premios || 1;
        if (rngWinners.length >= nPremios) {
            showMessage("Ya se sortearon todos los premios.", "info");
            return;
        }
        const excluded = new Set(rngWinners.map((w) => w.num));
        const pool = [];
        for (let i = 0; i < 100; i++) {
            const n = String(i).padStart(2, "0");
            if (!excluded.has(n)) pool.push(n);
        }
        if (!pool.length) {
            showMessage("No quedan números para sortear.", "error");
            return;
        }
        rngBusy = true;
        const btn = $("rifa-rng-btn");
        if (btn) btn.disabled = true;
        const display = $("rifa-rng-display");
        const winner = pool[Math.floor(Math.random() * pool.length)];
        const sequence = [];
        const shuffled = [...pool].sort(() => Math.random() - 0.5);
        while (sequence.length < 80) {
            sequence.push(...shuffled);
        }
        sequence[sequence.length - 1] = winner;

        const duration = 7000;
        const start = performance.now();
        await new Promise((resolve) => {
            function frame(now) {
                const t = Math.min(1, (now - start) / duration);
                const eased = 1 - Math.pow(1 - t, 3);
                const idx = Math.min(sequence.length - 1, Math.floor(eased * (sequence.length - 1)));
                if (display) display.textContent = sequence[idx];
                if (t < 1) requestAnimationFrame(frame);
                else {
                    if (display) display.textContent = winner;
                    resolve();
                }
            }
            requestAnimationFrame(frame);
        });

        const place = rngWinners.length + 1;
        const labels = { 1: "1.er lugar", 2: "2.do lugar", 3: "3.er lugar" };
        const info = datos[winner] || {};
        rngWinners.push({ num: winner, place, nombre: info.nombre || "" });
        const ul = $("rifa-rng-winners");
        if (ul) {
            const li = document.createElement("li");
            li.textContent = `${labels[place] || place}: ${winner}${info.nombre ? " — " + info.nombre : ""}`;
            ul.appendChild(li);
        }
        rngBusy = false;
        if (btn) btn.disabled = false;
    }

    /* ========== RIFA DE QUIEN LA ORGANIZA (#r/<hash>) ========== */

    /** Estilos listos para la imagen: un toque y queda armonizada. */
    const THEMES = [
        { id: "claro", nombre: "Claro", bg: ["#F7F7F7", "#E4E4E4", "to bottom"], text: "#1F1F1F", sub: "#4A4A4A", disp: ["#1F1F1F", "#FFFFFF"], tom: ["#9A9A9A", "#D2D2D2"] },
        { id: "noche", nombre: "Noche", bg: ["#0B1D3A", "#16161A", "to bottom"], text: "#FFFFFF", sub: "#A9C7FF", disp: ["#0B1D3A", "#FFFFFF"], tom: ["#5A6B85", "#1E2B44"] },
        { id: "navidad", nombre: "Navidad", bg: ["#B3121D", "#0F5132", "to bottom"], text: "#FFFFFF", sub: "#FFE9A8", disp: ["#B3121D", "#FFFFFF"], tom: ["#7FA58D", "#0B3D26"] },
        { id: "fiesta", nombre: "Fiesta", bg: ["#7B2FF7", "#F107A3", "135deg"], text: "#FFFFFF", sub: "#FFE3F6", disp: ["#7B2FF7", "#FFFFFF"], tom: ["#E9B8F0", "#8E2A9E"] },
        { id: "oceano", nombre: "Océano", bg: ["#00B4DB", "#005F86", "to bottom"], text: "#FFFFFF", sub: "#E0F7FF", disp: ["#005F86", "#FFFFFF"], tom: ["#8CCBE0", "#00506F"] },
        { id: "dorado", nombre: "Dorado", bg: ["#141414", "#3A2F12", "to bottom"], text: "#F5D77A", sub: "#E8E0C8", disp: ["#141414", "#F5D77A"], tom: ["#6E6346", "#2B2616"] }
    ];

    const MSG_DEFAULTS = {
        saludo: "¡Hola! Les comparto mi rifa 🎉",
        despedida: "¡Gracias por apoyar! 🙏",
        incluir: { premios: true, precio: true, sorteo: true, libres: false, vendidos: false, pago: true, contacto: true }
    };

    /** Lo que guardamos dentro de banner_json además del diseño: estilo, asistente y mensaje. */
    let bannerExtras = {};
    let filtroNumeros = "todos";
    let filtroCompradores = "todos";
    let sheetEstado = "Reservado";
    let msgTocado = false;
    let wzStep = 0;
    let wzPremios = 1;
    let wzTheme = "claro";
    let wzObligatorio = false;
    let adminWired = false;

    function extrasDe(raw) {
        const r = raw && typeof raw === "object" ? raw : {};
        return {
            theme: typeof r.theme === "string" ? r.theme : "",
            setup: r.setup && typeof r.setup === "object" ? r.setup : null,
            mensaje: r.mensaje && typeof r.mensaje === "object" ? r.mensaje : null
        };
    }

    /** Guarda el diseño sin perder estilo/asistente/mensaje. */
    async function guardarBanner(banner, extrasNuevos) {
        bannerExtras = Object.assign({}, bannerExtras, extrasNuevos || {});
        const completo = Object.assign({}, banner, bannerExtras);
        const res = await api.post({ action: "update_banner", hash: adminHash, banner: completo });
        project = res.data?.project || project;
        if (project) project.banner = completo;
        return completo;
    }

    function aplicarTema(base, themeId) {
        const t = THEMES.find((x) => x.id === themeId) || THEMES[0];
        const b = mergeBanner(base);
        b.bg = { color1: t.bg[0], color2: t.bg[1], gradient: t.bg[0] !== t.bg[1], orient: t.bg[2] };
        b.textColors = {
            titulo: t.text,
            premio1: t.text,
            premio2: t.sub,
            premio3: t.sub,
            costo: t.text,
            modalidadFecha: t.sub,
            whatsapp: t.text,
            sinpe: t.text
        };
        b.numberColors = { disponibleText: t.disp[0], disponibleBg: t.disp[1], tomadoText: t.tom[0], tomadoBg: t.tom[1] };
        return b;
    }

    function themeSwatches(containerId, current, onPick) {
        const box = $(containerId);
        if (!box) return;
        box.innerHTML = THEMES.map((t) => {
            const bg = t.bg[0] === t.bg[1] ? t.bg[0] : `linear-gradient(${t.bg[2]}, ${t.bg[0]}, ${t.bg[1]})`;
            return `<button type="button" class="rf-theme${t.id === current ? " is-active" : ""}" data-theme="${t.id}" role="radio" aria-checked="${t.id === current}">
                <span class="rf-theme__swatch" style="background:${bg}"><span style="background:${t.disp[1]};color:${t.disp[0]}">07</span><span style="background:${t.tom[1]};color:${t.tom[0]}">ø</span></span>
                <span class="rf-theme__name">${escapeHtml(t.nombre)}</span>
            </button>`;
        }).join("");
        box.onclick = (ev) => {
            const btn = ev.target.closest("[data-theme]");
            if (!btn) return;
            box.querySelectorAll("[data-theme]").forEach((b) => {
                const on = b === btn;
                b.classList.toggle("is-active", on);
                b.setAttribute("aria-checked", String(on));
            });
            onPick(btn.getAttribute("data-theme"));
        };
    }

    /* ---------- Datos derivados ---------- */
    function precioNumero() {
        const d = String(project?.precio || "").replace(/[^\d]/g, "");
        return d ? Number(d) : 0;
    }

    function colones(n) {
        return "₡" + String(Math.round(n || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
    }

    function claveNombre(s) {
        return String(s || "").trim().toLowerCase().replace(/\s+/g, " ");
    }

    function compradores() {
        const map = new Map();
        for (let i = 0; i < 100; i++) {
            const n = String(i).padStart(2, "0");
            const info = datos[n];
            if (!info || info.estado === "Disponible" || !info.nombre) continue;
            const k = claveNombre(info.nombre);
            if (!map.has(k)) map.set(k, { nombre: info.nombre.trim(), telefono: "", contacto: "", nums: [] });
            const g = map.get(k);
            if (!g.telefono && info.telefono) g.telefono = info.telefono;
            if (!g.contacto && info.contacto) g.contacto = info.contacto;
            g.nums.push({ n, estado: info.estado });
        }
        return [...map.values()].map((g) => {
            const apartados = g.nums.filter((x) => x.estado === "Reservado").map((x) => x.n);
            const pagados = g.nums.filter((x) => x.estado === "Pagado").map((x) => x.n);
            return Object.assign(g, { apartados, pagados, debe: apartados.length * precioNumero() });
        });
    }

    function numerosLibres() {
        const out = [];
        for (let i = 0; i < 100; i++) {
            const n = String(i).padStart(2, "0");
            if ((datos[n]?.estado || "Disponible") === "Disponible") out.push(n);
        }
        return out;
    }

    function numerosVendidos() {
        const out = [];
        for (let i = 0; i < 100; i++) {
            const n = String(i).padStart(2, "0");
            if ((datos[n]?.estado || "Disponible") !== "Disponible") out.push(n);
        }
        return out;
    }

    function listaNumerosTexto(nums) {
        if (nums.length <= 3) return nums.join(", ").replace(/, ([^,]*)$/, " y $1");
        return nums.join(", ");
    }

    /** Números agrupados por decena, para que el mensaje se lea fácil en WhatsApp. */
    function numerosEnFilas(nums) {
        const filas = [];
        for (let d = 0; d < 10; d++) {
            const fila = nums.filter((n) => n.charAt(0) === String(d));
            if (fila.length) filas.push(fila.join("  "));
        }
        return filas.join("\n");
    }

    function telefonoWa(tel) {
        let d = String(tel || "").replace(/[^\d]/g, "");
        if (!d) return "";
        if (d.length === 8) d = "506" + d;
        return d.length >= 10 ? d : "";
    }

    function tituloRifa() {
        return project?.nombre_display || project?.sheet_name || "Rifa";
    }

    function textoSorteo() {
        const f = formatFechaLargaEs(project?.fecha_sorteo || "");
        if (!f) return "";
        const fl = f.charAt(0).toLowerCase() + f.slice(1);
        if (project?.modalidad === "Chances") return `Juega con los Chances del ${fl}, 7:30 p.m.`;
        if (project?.modalidad === "Loteria Nacional") return `Juega con la Lotería Nacional del ${fl}, 7:30 p.m.`;
        return `Sorteo el ${fl}`;
    }

    /* ---------- Resumen ---------- */
    function renderSummary() {
        const s = countStats();
        updateStatsUI();
        const sold = s.reservado + s.pagado;
        const soldEl = $("rf-sold");
        if (soldEl) soldEl.textContent = String(sold);
        const p = $("rf-progress-paid");
        const r = $("rf-progress-res");
        if (p) p.style.width = `${s.pagado}%`;
        if (r) r.style.width = `${s.reservado}%`;
        const precio = precioNumero();
        const money = $("rf-money");
        if (money) money.hidden = !precio;
        if (precio) {
            $("rf-money-paid").textContent = colones(s.pagado * precio);
            $("rf-money-due").textContent = colones(s.reservado * precio);
        }
    }

    /* ---------- Pestañas ---------- */
    function showAdTab(name) {
        document.querySelectorAll(".rf-tab").forEach((t) => {
            const on = t.getAttribute("data-adtab") === name;
            t.classList.toggle("is-active", on);
            if (on) t.setAttribute("aria-current", "page");
            else t.removeAttribute("aria-current");
        });
        document.querySelectorAll(".rifa-adpanel").forEach((p) => {
            const match = p.getAttribute("data-adpanel") === name;
            p.hidden = !match;
            p.classList.toggle("is-active", match);
        });
        if (name !== "numeros") limpiarSeleccion();
        if (name === "compartir") {
            refreshBannerPreview();
            renderMensaje();
        }
        if (name === "compradores") renderCompradores();
        window.scrollTo({ top: 0, behavior: "smooth" });
    }

    /* ---------- Números ---------- */
    function coincideFiltro(n, info) {
        const e = info.estado || "Disponible";
        if (filtroNumeros === "libres" && e !== "Disponible") return false;
        if (filtroNumeros === "apartados" && e !== "Reservado") return false;
        if (filtroNumeros === "pagados" && e !== "Pagado") return false;
        const q = claveNombre($("rf-search")?.value);
        if (q && !n.includes(q) && !claveNombre(info.nombre).includes(q)) return false;
        return true;
    }

    function renderGrid() {
        const grid = $("rifa-numbers-grid");
        if (!grid) return;
        const frag = document.createDocumentFragment();
        for (let i = 0; i < 100; i++) {
            const n = String(i).padStart(2, "0");
            const info = datos[n] || { estado: "Disponible", nombre: "" };
            const estado = info.estado || "Disponible";
            const btn = document.createElement("button");
            btn.type = "button";
            btn.className = "rf-num estado-" + estado.toLowerCase();
            btn.dataset.num = n;
            if (seleccion.has(n)) btn.classList.add("is-selected");
            if (!coincideFiltro(n, info)) btn.classList.add("is-dim");
            const quien = info.nombre ? info.nombre.trim().split(/\s+/)[0] : "";
            btn.innerHTML = `<span class="rf-num__n">${n}</span>${quien ? `<span class="rf-num__who">${escapeHtml(quien)}</span>` : ""}`;
            const estadoTxt = estado === "Pagado" ? "pagado" : estado === "Reservado" ? "apartado" : "libre";
            btn.setAttribute("aria-label", `${n}, ${estadoTxt}${info.nombre ? " por " + info.nombre : ""}`);
            btn.setAttribute("aria-pressed", String(seleccion.has(n)));
            frag.appendChild(btn);
        }
        grid.replaceChildren(frag);
        renderSummary();
        syncSelbar();
    }

    function toggleSelect(n) {
        if (seleccion.has(n)) seleccion.delete(n);
        else seleccion.add(n);
        renderGrid();
    }

    function limpiarSeleccion() {
        if (!seleccion.size) return;
        seleccion.clear();
        renderGrid();
        renderLista();
    }

    function syncSelbar() {
        const bar = $("rf-selbar");
        if (!bar) return;
        const nums = [...seleccion].sort();
        bar.hidden = nums.length === 0;
        document.body.classList.toggle("rf-has-selbar", nums.length > 0);
        if (!nums.length) return;
        $("rf-selbar-count").textContent = nums.length === 1 ? "1 número" : `${nums.length} números`;
        $("rf-selbar-nums").textContent = nums.length <= 8 ? nums.join(" · ") : nums.slice(0, 8).join(" · ") + " …";
        const todosLibres = nums.every((n) => (datos[n]?.estado || "Disponible") === "Disponible");
        $("rf-selbar-go").textContent = todosLibres ? "Anotar comprador" : "Ver / cambiar";
    }

    /* ---------- Hoja «Anotar comprador» ---------- */
    function setSheetEstado(e) {
        sheetEstado = e;
        document.querySelectorAll(".rf-estado__opt").forEach((b) => {
            const on = b.getAttribute("data-estado") === e;
            b.classList.toggle("is-active", on);
            b.setAttribute("aria-checked", String(on));
        });
        const fields = $("rf-sheet-fields");
        if (fields) fields.hidden = e === "Disponible";
        const save = $("rifa-sel-guardar");
        if (save) {
            save.textContent = e === "Disponible" ? "Liberar" : "Guardar";
            save.classList.toggle("rifa-btn--danger", e === "Disponible");
        }
    }

    function openModal(id) {
        const m = $(id);
        if (!m) return;
        m.hidden = false;
        document.body.classList.add("rf-modal-open");
        const first = m.querySelector("input:not([type=hidden]):not([hidden]), button");
        if (first && window.matchMedia("(min-width: 769px)").matches) first.focus();
    }

    function closeModal(id) {
        const m = $(id);
        if (!m) return;
        m.hidden = true;
        if (!document.querySelector(".rf-modal:not([hidden]), .rf-wizard:not([hidden])")) {
            document.body.classList.remove("rf-modal-open");
        }
    }

    function abrirHoja() {
        const nums = [...seleccion].sort();
        if (!nums.length) return;
        $("rf-sheet-title").textContent =
            nums.length === 1 ? `Número ${nums[0]}` : `Números ${listaNumerosTexto(nums)}`;
        const tomados = nums.filter((n) => (datos[n]?.estado || "Disponible") !== "Disponible");
        const cur = $("rf-sheet-current");
        if (cur) {
            cur.hidden = !tomados.length;
            cur.innerHTML = tomados
                .map((n) => {
                    const d = datos[n];
                    const e = d.estado === "Pagado" ? "pagado" : "apartado";
                    return `<div><span class="rf-dot rf-dot--${e}"></span><strong>${n}</strong> — ${escapeHtml(d.nombre)} <small>(${e})</small></div>`;
                })
                .join("");
        }
        // Prellenar si todos los tomados son de la misma persona
        const nombres = new Set(tomados.map((n) => claveNombre(datos[n].nombre)));
        const ref = tomados.length && nombres.size === 1 ? datos[tomados[0]] : null;
        $("rifa-sel-nombre").value = ref ? ref.nombre : "";
        $("rifa-sel-tel").value = ref ? ref.telefono : "";
        $("rifa-sel-contacto").value = ref ? ref.contacto : "";
        const estados = new Set(tomados.map((n) => datos[n].estado));
        setSheetEstado(tomados.length === nums.length && estados.size === 1 ? [...estados][0] : "Reservado");
        // Autocompletar con compradores existentes
        const dl = $("rf-buyers-datalist");
        if (dl) dl.innerHTML = compradores().map((g) => `<option value="${escapeAttr(g.nombre)}"></option>`).join("");
        openModal("rf-sheet");
    }

    async function guardarSeleccion() {
        const estado = sheetEstado;
        const nombre = $("rifa-sel-nombre").value.trim();
        const telefono = $("rifa-sel-tel").value.trim();
        const contacto = $("rifa-sel-contacto").value.trim();
        const nums = [...seleccion].sort();
        if (!nums.length) return;
        if (estado !== "Disponible" && !nombre) {
            showMessage("Escriba el nombre de quien compra.", "error");
            $("rifa-sel-nombre").focus();
            return;
        }
        if (estado === "Disponible") {
            const tomados = nums.filter((n) => (datos[n]?.estado || "Disponible") !== "Disponible");
            if (tomados.length && !confirm(`¿Liberar ${listaNumerosTexto(tomados)}? Se borra el comprador de ${tomados.length === 1 ? "ese número" : "esos números"}.`)) {
                return;
            }
        }
        const listaCambios = nums.map((num) => ({
            num,
            estado,
            nombre: estado === "Disponible" ? "" : nombre,
            telefono: estado === "Disponible" ? "" : telefono,
            contacto: estado === "Disponible" ? "" : contacto
        }));
        const uno = nums.length === 1;
        const estadoTxt = { Pagado: ["pagado", "pagados"], Reservado: ["apartado", "apartados"], Disponible: ["libre", "libres"] }[estado];
        const okMsg = uno
            ? `El número ${nums[0]} quedó ${estadoTxt[0]}.`
            : `Los números ${listaNumerosTexto(nums)} quedaron ${estadoTxt[1]}.`;
        await enviarCambios(listaCambios, "rifa-sel-guardar", okMsg);
        closeModal("rf-sheet");
        seleccion.clear();
        renderGrid();
    }

    async function enviarCambios(listaCambios, btnId, mensajeOk) {
        const btn = btnId ? $(btnId) : null;
        if (btn) btn.disabled = true;
        try {
            const res = await api.post({ action: "update_numbers", hash: adminHash, listaCambios });
            datos = numerosFromApi(res.data?.numeros);
            renderGrid();
            renderLista();
            renderCompradores();
            if (!$("rf-share-preview")?.closest("[hidden]")) {
                refreshBannerPreview();
                renderMensaje();
            }
            showMessage(typeof mensajeOk === "function" ? mensajeOk() : mensajeOk || "Guardado.", "success");
        } catch (e) {
            showMessage(e.message || String(e), "error");
            throw e;
        } finally {
            if (btn) btn.disabled = false;
        }
    }

    /* ---------- Compradores ---------- */
    function renderCompradores() {
        const box = $("rf-buyers-list");
        if (!box) return;
        const q = claveNombre($("rf-buyer-search")?.value);
        let lista = compradores();
        if (filtroCompradores === "deben") lista = lista.filter((g) => g.apartados.length);
        if (filtroCompradores === "pagaron") lista = lista.filter((g) => !g.apartados.length);
        if (q) lista = lista.filter((g) => claveNombre(g.nombre).includes(q) || g.nums.some((x) => x.n.includes(q)));
        lista.sort((a, b) => b.apartados.length - a.apartados.length || a.nombre.localeCompare(b.nombre, "es"));

        if (!lista.length) {
            const vacio = compradores().length
                ? "Nadie coincide con ese filtro."
                : "Todavía no hay compradores. Vaya a «Números», toque un número y anote a quien lo compra.";
            box.innerHTML = `<p class="rf-empty">${vacio}</p>`;
            return;
        }
        const precio = precioNumero();
        box.innerHTML = lista
            .map((g) => {
                const chips = g.nums
                    .map((x) => `<span class="rf-chipnum estado-${x.estado.toLowerCase()}">${x.n}</span>`)
                    .join("");
                const debe = g.apartados.length;
                const estadoTxt = debe
                    ? `<span class="rf-buyer__due">Debe ${precio ? colones(g.debe) + " · " : ""}${debe} ${debe === 1 ? "número" : "números"}</span>`
                    : '<span class="rf-buyer__ok">✓ Pagó todo</span>';
                const wa = telefonoWa(g.telefono);
                const key = escapeAttr(claveNombre(g.nombre));
                return `<article class="rf-buyer${debe ? " is-due" : ""}">
                    <div class="rf-buyer__head">
                        <div>
                            <h3>${escapeHtml(g.nombre)}</h3>
                            <p>${g.telefono ? escapeHtml(g.telefono) : "Sin teléfono"}${g.contacto ? " · " + escapeHtml(g.contacto) : ""}</p>
                        </div>
                        ${estadoTxt}
                    </div>
                    <div class="rf-buyer__nums">${chips}</div>
                    <div class="rf-buyer__actions">
                        ${debe ? `<button type="button" class="rifa-btn rifa-btn--sm rifa-btn--primary" data-buyer-pay="${key}">Marcar pagado</button>` : ""}
                        ${wa ? `<button type="button" class="rifa-btn rifa-btn--sm" data-buyer-wa="${key}">${debe ? "Recordar pago" : "Confirmar pago"} por WhatsApp</button>` : ""}
                        <button type="button" class="rifa-btn rifa-btn--sm" data-buyer-edit="${key}">Editar</button>
                    </div>
                </article>`;
            })
            .join("");
    }

    function compradorPorClave(k) {
        return compradores().find((g) => claveNombre(g.nombre) === k);
    }

    function mensajeComprador(g) {
        const nombre = g.nombre.split(/\s+/)[0];
        if (g.apartados.length) {
            const nums = listaNumerosTexto(g.apartados);
            const plural = g.apartados.length > 1;
            const total = precioNumero() ? ` Total: ${colones(g.debe)}.` : "";
            const sinpe = project?.sinpe ? ` Puede pagar por SINPE Móvil al ${project.sinpe}.` : "";
            return `¡Hola ${nombre}! Le recuerdo que tiene ${plural ? "apartados los números" : "apartado el número"} ${nums} de la rifa «${tituloRifa()}».${total}${sinpe} ¡Muchas gracias!`;
        }
        const nums = listaNumerosTexto(g.pagados);
        const sorteo = textoSorteo();
        return `¡Hola ${nombre}! Confirmo su pago de ${g.pagados.length > 1 ? "los números" : "el número"} ${nums} de la rifa «${tituloRifa()}».${sorteo ? " " + sorteo + "." : ""} ¡Mucha suerte! 🍀`;
    }

    /* ---------- Compartir: mensaje ---------- */
    function opcionesMensaje() {
        const incluir = {};
        document.querySelectorAll("[data-msg]").forEach((c) => {
            incluir[c.getAttribute("data-msg")] = c.checked;
        });
        return {
            saludo: $("rf-msg-saludo")?.value.trim() || "",
            despedida: $("rf-msg-despedida")?.value.trim() || "",
            incluir
        };
    }

    function construirMensaje(o) {
        const L = [];
        const inc = o.incluir;
        if (o.saludo) L.push(o.saludo, "");
        L.push(`🎟️ *${tituloRifa()}*`);
        if (inc.premios) {
            const premios = [project?.premio_1, project?.premio_2, project?.premio_3].slice(0, project?.cantidad_premios || 1);
            const medallas = ["🥇", "🥈", "🥉"];
            premios.forEach((p, i) => {
                if (p) L.push(`${medallas[i]} ${premios.length > 1 ? premioLabel(i + 1) + ": " : "Premio: "}${p}`);
            });
        }
        if (inc.precio && project?.precio) L.push(`💵 Cada número: ${formatColonPrice(project.precio)}`);
        if (inc.sorteo && textoSorteo()) L.push(`📅 ${textoSorteo()}`);
        if (inc.libres) {
            const libres = numerosLibres();
            L.push("");
            if (libres.length) {
                L.push(`✅ *Números disponibles (${libres.length}):*`);
                L.push(numerosEnFilas(libres));
            } else {
                L.push("🎉 *¡Todos los números están vendidos!*");
            }
        }
        if (inc.vendidos) {
            const v = numerosVendidos();
            if (v.length) {
                L.push("");
                L.push(`❌ *Ya vendidos (${v.length}):*`);
                L.push(numerosEnFilas(v));
            }
        }
        const pie = [];
        if (inc.pago && project?.sinpe) pie.push(`📲 Pago por SINPE Móvil: ${project.sinpe}`);
        if (inc.contacto && project?.whatsapp) pie.push(`💬 Aparte su número por WhatsApp: ${project.whatsapp}`);
        if (pie.length) L.push("", ...pie);
        if (o.despedida) L.push("", o.despedida);
        return L.join("\n").replace(/\n{3,}/g, "\n\n").trim();
    }

    function renderMensaje(forzar) {
        const ta = $("rf-msg-text");
        if (!ta) return;
        if (msgTocado && !forzar) return;
        ta.value = construirMensaje(opcionesMensaje());
        msgTocado = false;
    }

    function cargarOpcionesMensaje() {
        const m = Object.assign({}, MSG_DEFAULTS, bannerExtras.mensaje || {});
        const incluir = Object.assign({}, MSG_DEFAULTS.incluir, m.incluir || {});
        $("rf-msg-saludo").value = m.saludo != null ? m.saludo : MSG_DEFAULTS.saludo;
        $("rf-msg-despedida").value = m.despedida != null ? m.despedida : MSG_DEFAULTS.despedida;
        document.querySelectorAll("[data-msg]").forEach((c) => {
            c.checked = !!incluir[c.getAttribute("data-msg")];
        });
    }

    async function copiarTexto(text, okMsg) {
        try {
            await navigator.clipboard.writeText(text);
            if (okMsg) showMessage(okMsg, "success");
            return true;
        } catch (e) {
            window.prompt("Copie el mensaje:", text);
            return false;
        }
    }

    async function compartirImagenYMensaje() {
        if (bannerBusy) return;
        const text = $("rf-msg-text")?.value || "";
        try {
            // Crear la imagen toma unos segundos y el iPhone ya no deja compartir al terminar:
            // se muestra lista y el siguiente toque es el que comparte.
            const blob = await generarBannerBlob();
            showMessage("Imagen lista.", "success");
            openBannerResult(blob, nombreArchivoImagen(), text);
        } catch (e) {
            showMessage(e.message || String(e), "error");
        }
    }

    /* ---------- Acceso directo (iPhone / Android) ---------- */
    function plataforma() {
        const ua = navigator.userAgent || "";
        const iOS = /iPhone|iPad|iPod/i.test(ua) || (/Macintosh/i.test(ua) && (navigator.maxTouchPoints || 0) > 1);
        const android = /Android/i.test(ua);
        const inApp = /FBAN|FBAV|Instagram|WhatsApp|Line\/|; wv\)/i.test(ua);
        const safari = iOS && /Safari/i.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS|GSA\//i.test(ua) && !inApp;
        const standalone =
            (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) || navigator.standalone === true;
        return { iOS, android, inApp, safari, standalone };
    }

    const ICO_SHARE_IOS =
        '<svg class="rf-ico-inline" viewBox="0 0 24 24" aria-label="Compartir"><path d="M12 3v12M8 7l4-4 4 4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M6 11H5v9h14v-9h-1" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
    const ICO_MENU_ANDROID =
        '<svg class="rf-ico-inline" viewBox="0 0 24 24" aria-label="Menú"><circle cx="12" cy="5" r="2" fill="currentColor"/><circle cx="12" cy="12" r="2" fill="currentColor"/><circle cx="12" cy="19" r="2" fill="currentColor"/></svg>';

    function instruccionesInstalar() {
        const p = plataforma();
        const nombre = escapeHtml(tituloRifa());
        if (p.standalone) {
            return `<p class="rf-install-ok">✓ Ya está usando el acceso directo de «${nombre}». Ábralo desde su pantalla de inicio cada vez que lo requiera.</p>`;
        }
        const prompt = window.__cpmInstallPrompt;
        if (prompt && !p.iOS) {
            return `<p>Su teléfono permite instalarla con un toque:</p>
                <button type="button" class="rifa-btn rifa-btn--primary rf-install-native" data-install-native>Agregar «${nombre}» a mi pantalla de inicio</button>`;
        }
        if (p.iOS) {
            const aviso = !p.safari
                ? `<p class="rf-install-warn">Primero abra este enlace en <strong>Safari</strong>: en el iPhone solo Safari puede crear el acceso directo. Si lo abrió desde WhatsApp, toque el enlace, elija «Abrir en Safari», o copie el enlace y péguelo en Safari.</p>
                   <button type="button" class="rifa-btn" data-install-copy>Copiar el enlace</button>`
                : "";
            return `${aviso}<ol class="rf-install-list">
                    <li>En Safari, toque el botón <strong>Compartir</strong> ${ICO_SHARE_IOS} (el cuadro con una flecha hacia arriba). Si no lo ve, toque primero el menú <strong>«⋯»</strong> de la barra de abajo.</li>
                    <li>Deslice hacia abajo y toque <strong>«Agregar a inicio»</strong>.</li>
                    <li>Toque <strong>«Agregar»</strong>. Aparecerá el ícono «${nombre}» en su pantalla.</li>
                </ol>`;
        }
        if (p.android) {
            const aviso = p.inApp
                ? `<p class="rf-install-warn">Si abrió el enlace desde WhatsApp, Facebook o Instagram, toque ${ICO_MENU_ANDROID} y elija <strong>«Abrir en Chrome»</strong> antes de seguir.</p>`
                : "";
            return `${aviso}<ol class="rf-install-list">
                    <li>En Chrome, toque el menú ${ICO_MENU_ANDROID} (arriba a la derecha).</li>
                    <li>Toque <strong>«Agregar a la pantalla principal»</strong> o <strong>«Instalar app»</strong>.</li>
                    <li>Confirme con <strong>«Agregar»</strong>. Aparecerá el ícono «${nombre}» en su pantalla.</li>
                </ol>`;
        }
        return `<p>En la computadora, guarde esta página en <strong>favoritos</strong> (Ctrl + D, o ⌘ + D en Mac) para volver rápido.</p>
            <p>Para el teléfono, envíese el enlace a usted mismo, ábralo allí y siga este mismo botón.</p>
            <button type="button" class="rifa-btn" data-install-copy>Copiar el enlace</button>`;
    }

    function pintarInstalar(boxId) {
        const box = $(boxId);
        if (box) box.innerHTML = instruccionesInstalar();
    }

    async function onInstalarClick(ev) {
        if (ev.target.closest("[data-install-copy]")) {
            await copiarTexto(window.location.href, "Enlace copiado.");
            return;
        }
        if (ev.target.closest("[data-install-native]")) {
            const prompt = window.__cpmInstallPrompt;
            if (!prompt) return;
            prompt.prompt();
            try {
                const r = await prompt.userChoice;
                if (r?.outcome === "accepted") showMessage("¡Listo! Ya tiene la rifa en su pantalla de inicio.", "success");
            } catch (e) {
                /* ignore */
            }
            window.__cpmInstallPrompt = null;
        }
    }

    /**
     * El acceso directo debe abrir ESTA rifa, no la portada del sitio:
     * manifest propio con start_url = enlace de la rifa y nombre de la rifa.
     */
    function prepararAccesoDirecto() {
        const nombre = tituloRifa();
        const base = new URL("./", window.location.href).href;
        const manifest = {
            name: `Rifa · ${nombre}`,
            short_name: nombre.length > 14 ? nombre.slice(0, 14).trim() : nombre,
            description: "Administración de la rifa: números, compradores y compartir.",
            lang: "es",
            start_url: window.location.href,
            scope: base,
            display: "standalone",
            background_color: "#212121",
            theme_color: "#212121",
            icons: [
                { src: base + "imagenes/branding/icon-192.png", sizes: "192x192", type: "image/png" },
                { src: base + "imagenes/branding/icon-512.png", sizes: "512x512", type: "image/png" },
                { src: base + "imagenes/branding/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" }
            ]
        };
        let link = document.querySelector('link[rel="manifest"]');
        if (!link) {
            link = document.createElement("link");
            link.rel = "manifest";
            document.head.appendChild(link);
        }
        link.href = "data:application/manifest+json;charset=utf-8," + encodeURIComponent(JSON.stringify(manifest));
        const meta = (name, content) => {
            let m = document.querySelector(`meta[name="${name}"]`);
            if (!m) {
                m = document.createElement("meta");
                m.name = name;
                document.head.appendChild(m);
            }
            m.content = content;
        };
        meta("apple-mobile-web-app-capable", "yes");
        meta("mobile-web-app-capable", "yes");
        meta("apple-mobile-web-app-title", nombre.slice(0, 20));
        meta("apple-mobile-web-app-status-bar-style", "black-translucent");
        document.title = `Rifa · ${nombre}`;
    }

    /* ---------- Ajustes ---------- */
    function fillConfigForm() {
        if (!project) return;
        $("cfg-nombre").value = tituloRifa();
        $("cfg-premios-n").value = String(project.cantidad_premios || 1);
        $("cfg-premio1").value = project.premio_1 || "";
        $("cfg-premio2").value = project.premio_2 || "";
        $("cfg-premio3").value = project.premio_3 || "";
        // El sorteo solo se elige en el asistente de primer uso; aquí se muestra sin poder cambiarlo.
        const sorteo = $("cfg-sorteo-txt");
        if (sorteo) sorteo.textContent = configIncompleta(project) ? "Se elige al configurar la rifa." : textoSorteo() || "—";
        $("cfg-whatsapp").value = project.whatsapp || "";
        $("cfg-sinpe").value = project.sinpe || "";
        $("cfg-precio").value = formatColonPrice(project.precio || "");
        syncPremioFields("cfg-premios-n", "data-cfg-premio");
        const rngTab = $("rifa-tab-rng");
        if (rngTab) rngTab.hidden = project.modalidad !== "RNG";
        wirePrecioInput($("cfg-precio"));
        const note = $("rf-archive-note");
        if (note) {
            note.hidden = !project.fecha_archivo;
            if (archivoPendiente(project)) {
                note.textContent = "Este enlace funciona hasta una semana después del sorteo. Después la rifa se archiva.";
            } else if (project.fecha_archivo) {
                note.textContent = `Este enlace funciona hasta el ${formatFechaLargaEs(project.fecha_archivo).toLowerCase()}. Después la rifa se archiva.`;
            }
        }
        const title = $("rifa-admin-title");
        if (title) title.textContent = tituloRifa();
    }

    async function guardarConfig(cfg, btn) {
        if (btn) btn.disabled = true;
        try {
            const res = await api.post({ action: "update_config", hash: adminHash, config: cfg });
            project = Object.assign({}, project, res.data?.project || cfg);
            fillConfigForm();
            prepararAccesoDirecto();
            refreshBannerPreview();
            renderMensaje(true);
            renderSummary();
            return true;
        } finally {
            if (btn) btn.disabled = false;
        }
    }

    /* ---------- Asistente de primera vez ---------- */
    const WZ_LAST = 6;

    function wzSyncPremios() {
        document.querySelectorAll("#wz-premios-n [data-n]").forEach((b) => {
            const on = Number(b.getAttribute("data-n")) === wzPremios;
            b.classList.toggle("is-active", on);
            b.setAttribute("aria-checked", String(on));
        });
        document.querySelectorAll("[data-wz-premio]").forEach((el) => {
            el.hidden = Number(el.getAttribute("data-wz-premio")) > wzPremios;
        });
    }

    function wzModalidad() {
        return document.querySelector('input[name="wz-modalidad"]:checked')?.value || "";
    }

    /** Mismas reglas de fecha que tenía el creador del hub, más la fecha en que se archiva la rifa. */
    function wzErrorFecha(f) {
        const mod = wzModalidad();
        if (!mod) return "Elija con qué juega el sorteo.";
        if (!f) return "Elija la fecha del sorteo.";
        const err = validateFechaModalidad(mod, f);
        if (err) return err;
        if (f < hoyIso()) return "La fecha del sorteo ya pasó. Elija una fecha de hoy en adelante.";
        const archivo = archivoPendiente(project) ? "" : project?.fecha_archivo || "";
        if (archivo && f > archivo) {
            return `La fecha del sorteo debe ser a más tardar el ${formatFechaLargaEs(archivo).toLowerCase()}, porque ese día se archiva la rifa.`;
        }
        return "";
    }

    function wzSyncFecha() {
        const hint = $("wz-fecha-hint");
        if (!hint) return;
        const f = $("wz-fecha").value;
        const err = f && wzModalidad() ? wzErrorFecha(f) : "";
        hint.textContent = err || (wzModalidad() ? fechaHint(wzModalidad()) : "Primero elija con qué juega el sorteo.");
        hint.classList.toggle("is-error", !!err);
        const nota = $("wz-archivo-note");
        if (nota) {
            const archivo = project?.fecha_archivo || "";
            nota.hidden = !archivo;
            if (archivoPendiente(project)) {
                nota.textContent = "📅 Su enlace funciona hasta una semana después del sorteo. Después la rifa se archiva.";
            } else if (archivo) {
                nota.textContent = `📅 Su rifa está activa hasta el ${formatFechaLargaEs(archivo).toLowerCase()}. El sorteo debe ser ese día o antes.`;
            }
        }
    }

    /** Lo escrito en el asistente, con la forma que espera update_config. */
    function wzCfg() {
        const cfg = {
            nombre_display: $("wz-nombre").value.trim(),
            cantidad_premios: wzPremios,
            premio_1: $("wz-premio1").value.trim(),
            premio_2: wzPremios >= 2 ? $("wz-premio2").value.trim() : "",
            premio_3: wzPremios >= 3 ? $("wz-premio3").value.trim() : "",
            precio: formatColonPrice($("wz-precio").value.trim()),
            sinpe: $("wz-sinpe").value.trim(),
            whatsapp: $("wz-whatsapp").value.trim()
        };
        // El sorteo solo se manda en la configuración de primer uso; después queda fijo.
        if (wzObligatorio) {
            cfg.modalidad = wzModalidad();
            cfg.fecha_sorteo = $("wz-fecha").value;
        }
        return cfg;
    }

    function wzPreview() {
        const box = $("wz-preview");
        if (!box) return;
        const cfg = wzCfg();
        const b = aplicarTema(project?.banner, wzTheme);
        b.head.title = cfg.nombre_display || tituloRifa();
        // La vista previa usa los datos recién escritos, aunque todavía no se hayan guardado
        const guardado = project;
        project = Object.assign({}, project, cfg);
        try {
            box.innerHTML = buildBannerHtml(b, false, 0.2);
        } finally {
            project = guardado;
        }
    }

    function wzFill() {
        // Rifa recién creada desde el hub: lo guardado son valores de relleno, se empieza en blanco.
        const nueva = String(project?.premio_1 || "").trim() === PREMIO_PENDIENTE;
        $("wz-nombre").value = project?.nombre_display && project.nombre_display !== project.sheet_name ? project.nombre_display : "";
        wzPremios = Math.min(3, Math.max(1, Number(project?.cantidad_premios) || 1));
        $("wz-premio1").value = project?.premio_1 && project.premio_1 !== "Premio" && !nueva ? project.premio_1 : "";
        $("wz-premio2").value = project?.premio_2 || "";
        $("wz-premio3").value = project?.premio_3 || "";
        $("wz-precio").value = String(project?.precio || "").replace(/\D/g, "") ? formatColonPrice(project.precio) : "";
        const mod = nueva ? "" : project?.modalidad || "";
        document.querySelectorAll('input[name="wz-modalidad"]').forEach((r) => (r.checked = r.value === mod));
        $("wz-fecha").value = nueva ? "" : (project?.fecha_sorteo || "").slice(0, 10);
        $("wz-fecha").min = hoyIso();
        $("wz-fecha").max = project?.fecha_archivo && !archivoPendiente(project) ? project.fecha_archivo : "";
        $("wz-sorteo-edit").hidden = !wzObligatorio;
        $("wz-sorteo-warn").hidden = !wzObligatorio;
        $("wz-sorteo-locked").hidden = wzObligatorio;
        $("wz-sorteo-txt").textContent = textoSorteo() || "—";
        $("wz-sinpe").value = project?.sinpe || "";
        $("wz-whatsapp").value = project?.whatsapp || "";
        wzTheme = bannerExtras.theme || "claro";
        wirePrecioInput($("wz-precio"));
        wzSyncPremios();
        wzSyncFecha();
        themeSwatches("wz-themes", wzTheme, (id) => {
            wzTheme = id;
            wzPreview();
        });
    }

    function wzShow(step) {
        wzStep = Math.max(0, Math.min(WZ_LAST, step));
        document.querySelectorAll(".rf-wz-pane").forEach((p) => {
            p.hidden = Number(p.getAttribute("data-wz")) !== wzStep;
        });
        $("rf-wz-bar").style.width = `${Math.round((wzStep / WZ_LAST) * 100)}%`;
        $("rf-wz-step").textContent = wzStep === 0 ? "Bienvenida" : wzStep === WZ_LAST ? "¡Listo!" : `Paso ${wzStep} de ${WZ_LAST - 1}`;
        $("rf-wz-back").hidden = wzStep === 0 || wzStep === WZ_LAST;
        // Mientras falten datos de la rifa el asistente no se puede saltar
        $("rf-wz-skip").hidden = wzStep !== 0 || wzObligatorio;
        $("rf-wz-next").textContent = wzStep === 0 ? "Empezar" : wzStep === WZ_LAST - 1 ? "Guardar y terminar" : wzStep === WZ_LAST ? "Ir a mis números" : "Siguiente";
        $("rf-wz-error").textContent = "";
        if (wzStep === 5) wzPreview();
        if (wzStep === WZ_LAST) pintarInstalar("wz-install");
        const pane = document.querySelector(`.rf-wz-pane[data-wz="${wzStep}"]`);
        const input = pane?.querySelector("input:not([type=radio])");
        if (input && window.matchMedia("(min-width: 769px)").matches) input.focus();
        $("rf-wizard")?.querySelector(".rf-wizard__box")?.scrollTo?.(0, 0);
    }

    function wzValidar(step) {
        const v = (id) => $(id)?.value.trim() || "";
        if (step === 1 && v("wz-nombre").length < 2) return "Escriba el nombre de la rifa.";
        if (step === 2) {
            if (!v("wz-premio1")) return "Escriba el primer premio.";
            if (wzPremios >= 2 && !v("wz-premio2")) return "Escriba el segundo premio o elija menos premios.";
            if (wzPremios >= 3 && !v("wz-premio3")) return "Escriba el tercer premio o elija menos premios.";
        }
        if (step === 3) {
            if (!v("wz-precio").replace(/[^\d]/g, "")) return "Escriba el precio de cada número.";
            const err = wzObligatorio ? wzErrorFecha(v("wz-fecha")) : "";
            if (err) return err;
        }
        if (step === 4 && v("wz-sinpe").replace(/[^\d]/g, "").length < 8) return "Escriba el número de SINPE Móvil (8 dígitos).";
        return "";
    }

    async function wzGuardar() {
        const cfg = wzCfg();
        await guardarConfig(cfg, $("rf-wz-next"));
        const b = aplicarTema(project?.banner, wzTheme);
        b.head = Object.assign({}, b.head, { mode: "text", title: cfg.nombre_display });
        await guardarBanner(b, { theme: wzTheme, setup: { done: true, at: new Date().toISOString() } });
        fillBannerForm();
        themeSwatches("rf-themes", wzTheme, onThemeShare);
        refreshBannerPreview();
    }

    async function wzSiguiente() {
        if (wzStep === WZ_LAST) {
            cerrarAsistente();
            return;
        }
        const err = wzValidar(wzStep);
        if (err) {
            $("rf-wz-error").textContent = err;
            return;
        }
        if (wzStep === WZ_LAST - 1) {
            $("rf-wz-next").textContent = "Guardando…";
            try {
                await wzGuardar();
            } catch (e) {
                $("rf-wz-error").textContent = e.message || String(e);
                $("rf-wz-next").textContent = "Guardar y terminar";
                return;
            }
        }
        wzShow(wzStep + 1);
    }

    function abrirAsistente() {
        wzObligatorio = configIncompleta(project);
        wzFill();
        $("rf-wizard").hidden = false;
        document.body.classList.add("rf-modal-open");
        wzShow(0);
    }

    function cerrarAsistente() {
        $("rf-wizard").hidden = true;
        if (!document.querySelector(".rf-modal:not([hidden])")) document.body.classList.remove("rf-modal-open");
        showAdTab("numeros");
    }

    async function saltarAsistente() {
        cerrarAsistente();
        if (bannerExtras.setup?.done) return;
        try {
            await guardarBanner(mergeBanner(project?.banner), { setup: { done: true, at: new Date().toISOString(), saltado: true } });
        } catch (e) {
            /* si no se pudo guardar, el asistente vuelve a ofrecerse la próxima vez */
        }
    }

    /* ---------- Estilo desde «Compartir» ---------- */
    let themeSaveTimer = 0;
    function onThemeShare(id) {
        const b = aplicarTema(readBannerFromForm(), id);
        fillBannerForm(b);
        refreshBannerPreview();
        bannerExtras.theme = id;
        clearTimeout(themeSaveTimer);
        themeSaveTimer = setTimeout(async () => {
            try {
                await guardarBanner(readBannerFromForm(), { theme: id });
                showMessage("Estilo guardado.", "success");
            } catch (e) {
                showMessage(e.message || String(e), "error");
            }
        }, 600);
    }

    function wireAdminEvents() {
        if (adminWired) return;
        adminWired = true;

        document.querySelectorAll(".rf-tab").forEach((tab) => {
            tab.addEventListener("click", () => showAdTab(tab.getAttribute("data-adtab")));
        });

        // Números
        $("rifa-numbers-grid")?.addEventListener("click", (ev) => {
            const b = ev.target.closest("[data-num]");
            if (b) toggleSelect(b.dataset.num);
        });
        $("rf-search")?.addEventListener("input", renderGrid);
        document.querySelectorAll("[data-filter]").forEach((chip) => {
            chip.addEventListener("click", () => {
                filtroNumeros = chip.getAttribute("data-filter");
                document.querySelectorAll("[data-filter]").forEach((c) => c.classList.toggle("is-active", c === chip));
                renderGrid();
            });
        });
        $("rf-selbar-clear")?.addEventListener("click", limpiarSeleccion);
        $("rf-selbar-go")?.addEventListener("click", abrirHoja);

        // Hoja y modales
        document.querySelectorAll(".rf-estado__opt").forEach((b) => {
            b.addEventListener("click", () => setSheetEstado(b.getAttribute("data-estado")));
        });
        $("rifa-sel-guardar")?.addEventListener("click", () => void guardarSeleccion().catch(() => {}));
        $("rifa-sel-nombre")?.addEventListener("change", () => {
            const g = compradorPorClave(claveNombre($("rifa-sel-nombre").value));
            if (g) {
                if (!$("rifa-sel-tel").value) $("rifa-sel-tel").value = g.telefono;
                if (!$("rifa-sel-contacto").value) $("rifa-sel-contacto").value = g.contacto;
            }
        });
        document.querySelectorAll(".rf-modal").forEach((m) => {
            m.addEventListener("click", (ev) => {
                if (ev.target === m || ev.target.closest("[data-close]")) closeModal(m.id);
            });
        });
        document.addEventListener("keydown", (ev) => {
            if (ev.key !== "Escape") return;
            const open = document.querySelector(".rf-modal:not([hidden])");
            if (open) closeModal(open.id);
        });

        // Compradores
        $("rf-buyer-search")?.addEventListener("input", renderCompradores);
        document.querySelectorAll("[data-bfilter]").forEach((chip) => {
            chip.addEventListener("click", () => {
                filtroCompradores = chip.getAttribute("data-bfilter");
                document.querySelectorAll("[data-bfilter]").forEach((c) => c.classList.toggle("is-active", c === chip));
                renderCompradores();
            });
        });
        $("rf-buyers-list")?.addEventListener("click", async (ev) => {
            const pay = ev.target.closest("[data-buyer-pay]");
            const wa = ev.target.closest("[data-buyer-wa]");
            const edit = ev.target.closest("[data-buyer-edit]");
            const key = (pay || wa || edit)?.getAttribute(pay ? "data-buyer-pay" : wa ? "data-buyer-wa" : "data-buyer-edit");
            const g = key ? compradorPorClave(key) : null;
            if (!g) return;
            if (pay) {
                const cambios = g.apartados.map((n) => ({
                    num: n,
                    estado: "Pagado",
                    nombre: datos[n].nombre,
                    telefono: datos[n].telefono,
                    contacto: datos[n].contacto
                }));
                pay.disabled = true;
                await enviarCambios(cambios, null, `${g.nombre}: ${listaNumerosTexto(g.apartados)} ${g.apartados.length > 1 ? "quedaron pagados" : "quedó pagado"}.`).catch(() => {});
            } else if (wa) {
                window.open(`https://wa.me/${telefonoWa(g.telefono)}?text=${encodeURIComponent(mensajeComprador(g))}`, "_blank", "noopener");
            } else if (edit) {
                seleccion = new Set(g.nums.map((x) => x.n));
                showAdTab("numeros");
                seleccion = new Set(g.nums.map((x) => x.n));
                renderGrid();
                abrirHoja();
            }
        });
        $("rifa-csv-dl")?.addEventListener("click", descargarCsv);
        $("rifa-lista-guardar")?.addEventListener("click", () => void guardarListaCompleta());

        // Compartir
        // Los mismos cuatro botones van al inicio y al final de «Compartir»
        document.querySelectorAll("[data-share-act]").forEach((btn) => {
            btn.addEventListener("click", () => {
                const act = btn.getAttribute("data-share-act");
                if (act === "both") void compartirImagenYMensaje();
                else if (act === "download") void descargarBannerJpg();
                else if (act === "copy") void copiarTexto($("rf-msg-text").value, "Mensaje copiado. Péguelo en el chat o grupo.");
                else if (act === "wa") window.open(`https://wa.me/?text=${encodeURIComponent($("rf-msg-text").value)}`, "_blank", "noopener");
            });
        });
        ["rf-msg-saludo", "rf-msg-despedida"].forEach((id) => $(id)?.addEventListener("input", () => renderMensaje(true)));
        document.querySelectorAll("[data-msg]").forEach((c) => c.addEventListener("change", () => renderMensaje(true)));
        $("rf-msg-text")?.addEventListener("input", () => {
            msgTocado = true;
        });
        $("rf-msg-save")?.addEventListener("click", async () => {
            const o = opcionesMensaje();
            try {
                await guardarBanner(readBannerFromForm(), { mensaje: o });
                showMessage("Guardado: la próxima vez el mensaje empieza así.", "success");
            } catch (e) {
                showMessage(e.message || String(e), "error");
            }
        });

        // Personalizar la imagen
        document.querySelectorAll("[data-bg-modo]").forEach((btn) => {
            btn.addEventListener("click", () => {
                $("bn-grad").checked = btn.getAttribute("data-bg-modo") === "degradado";
                syncCustomUi();
                refreshBannerPreview();
            });
        });
        document.querySelectorAll("[data-head-modo]").forEach((btn) => {
            btn.addEventListener("click", () => setHeadMode(btn.getAttribute("data-head-modo")));
        });
        $("bn-font-all")?.addEventListener("change", () => {
            const v = $("bn-font-all").value;
            TYPO_FONT_IDS.forEach((id) => ensureFontSelectOptions($(id), v));
            refreshBannerPreview();
        });
        $("bn-font-each")?.addEventListener("change", () => {
            // Al volver a «una sola letra», todos los textos toman la elegida arriba
            if (!$("bn-font-each").checked) {
                const v = $("bn-font-all").value;
                TYPO_FONT_IDS.forEach((id) => ensureFontSelectOptions($(id), v));
            }
            syncCustomUi();
            refreshBannerPreview();
        });
        ["bn-i-wa", "bn-i-sinpe", "bn-i-tomado"].forEach((id) => {
            $(id)?.addEventListener("change", () => {
                syncIconUploadPanels();
                refreshBannerPreview();
            });
        });
        $("rifa-banner-form")?.addEventListener("input", () => {
            syncCustomUi();
            refreshBannerPreview();
        });
        $("rifa-banner-form")?.addEventListener("change", () => refreshBannerPreview());
        syncIconUploadPanels();

        // Al elegir el archivo se sube solo: no hay un segundo botón «Subir»
        $("bn-logo-file")?.addEventListener("change", async () => {
            const input = $("bn-logo-file");
            const file = input?.files?.[0];
            if (!file) return;
            const status = $("bn-logo-status");
            const textoInicial = status?.textContent || "";
            if (status) status.textContent = "Subiendo el logotipo…";
            try {
                $("bn-logo-url").value = await uploadImageToImgBB(file);
                syncCustomUi();
                refreshBannerPreview();
                showMessage("Logotipo listo. Toque «Guardar diseño» para conservarlo.", "success");
            } catch (e) {
                showMessage(e.message || String(e), "error");
            } finally {
                if (status) status.textContent = textoInicial;
                input.value = "";
            }
        });
        $("bn-logo-clear")?.addEventListener("click", () => {
            $("bn-logo-url").value = "";
            syncCustomUi();
            refreshBannerPreview();
        });

        document.querySelectorAll("[data-icon-file]").forEach((input) => {
            input.addEventListener("change", async () => {
                const kind = input.getAttribute("data-icon-file");
                const file = input.files?.[0];
                if (!file) return;
                showMessage("Subiendo el ícono…", "info");
                try {
                    $(ICON_URL_IDS[kind]).value = await uploadImageToImgBB(file);
                    syncCustomUi();
                    refreshBannerPreview();
                    showMessage("Ícono listo. Toque «Guardar diseño» para conservarlo.", "success");
                } catch (e) {
                    showMessage(e.message || String(e), "error");
                } finally {
                    input.value = "";
                }
            });
        });
        document.querySelectorAll("[data-icon-reset]").forEach((btn) => {
            btn.addEventListener("click", () => {
                $(ICON_URL_IDS[btn.getAttribute("data-icon-reset")]).value = "";
                syncCustomUi();
                refreshBannerPreview();
            });
        });
        $("rf-banner-advanced")?.addEventListener("toggle", () => refreshBannerPreview());

        $("rifa-banner-save")?.addEventListener("click", async () => {
            try {
                await guardarBanner(readBannerFromForm());
                showMessage("Diseño de la imagen guardado.", "success");
            } catch (e) {
                showMessage(e.message || String(e), "error");
            }
        });

        $("rifa-banner-reset")?.addEventListener("click", () => {
            if (!confirm("¿Volver al diseño básico?\nNo se guarda hasta que toque «Guardar diseño».")) return;
            resetBannerToDefaults();
        });

        // Ajustes
        $("cfg-premios-n")?.addEventListener("change", () => syncPremioFields("cfg-premios-n", "data-cfg-premio"));
        $("rifa-config-form")?.addEventListener("submit", async (ev) => {
            ev.preventDefault();
            if (!$("cfg-nombre").value.trim()) {
                showMessage("La rifa requiere un nombre.", "error");
                return;
            }
            const cantidad = Number($("cfg-premios-n").value) || 1;
            try {
                await guardarConfig(
                    {
                        nombre_display: $("cfg-nombre").value.trim(),
                        cantidad_premios: cantidad,
                        premio_1: $("cfg-premio1").value.trim(),
                        premio_2: cantidad >= 2 ? $("cfg-premio2").value.trim() : "",
                        premio_3: cantidad >= 3 ? $("cfg-premio3").value.trim() : "",
                        whatsapp: $("cfg-whatsapp").value.trim(),
                        sinpe: $("cfg-sinpe").value.trim(),
                        precio: formatColonPrice($("cfg-precio").value.trim())
                    },
                    ev.submitter
                );
                showMessage("Datos de la rifa guardados.", "success");
            } catch (e) {
                showMessage(e.message || String(e), "error");
            }
        });
        $("rf-install-open")?.addEventListener("click", () => {
            pintarInstalar("rf-install-body");
            openModal("rf-install");
        });
        $("rf-install-body")?.addEventListener("click", (ev) => void onInstalarClick(ev));
        $("wz-install")?.addEventListener("click", (ev) => void onInstalarClick(ev));
        $("rf-link-copy")?.addEventListener("click", () => void copiarTexto(window.location.href, "Enlace copiado. Guárdelo en un lugar seguro."));
        $("rf-wizard-open")?.addEventListener("click", abrirAsistente);

        // Asistente
        $("rf-wz-next")?.addEventListener("click", () => void wzSiguiente());
        $("rf-wz-back")?.addEventListener("click", () => wzShow(wzStep - 1));
        $("rf-wz-skip")?.addEventListener("click", () => void saltarAsistente());
        document.querySelectorAll("#wz-premios-n [data-n]").forEach((b) => {
            b.addEventListener("click", () => {
                wzPremios = Number(b.getAttribute("data-n")) || 1;
                wzSyncPremios();
            });
        });
        document.querySelectorAll('input[name="wz-modalidad"]').forEach((r) => r.addEventListener("change", wzSyncFecha));
        $("wz-fecha")?.addEventListener("change", wzSyncFecha);
        $("wz-nombre")?.addEventListener("input", () => {
            if (wzStep === 5) wzPreview();
        });
        $("rf-wizard")?.addEventListener("keydown", (ev) => {
            if (ev.key === "Enter" && ev.target.matches("input:not([type=radio])")) {
                ev.preventDefault();
                void wzSiguiente();
            }
        });

        // Sorteo
        $("rifa-rng-btn")?.addEventListener("click", () => void runRng());

        // Al instalarse como app, el aviso del navegador ya no hace falta
        window.addEventListener("beforeinstallprompt", (e) => {
            e.preventDefault();
            window.__cpmInstallPrompt = e;
        });

        $("rifa-public-home-link")?.addEventListener("click", (ev) => {
            ev.preventDefault();
            document.body.classList.remove("cpm-rifa-standalone");
            restaurarSitio();
            navigateHome();
        });
    }

    async function initAdmin(hash) {
        $("rifa-hub").hidden = true;
        $("rifa-admin").hidden = false;
        document.body.classList.add("cpm-rifa-standalone");
        adminHash = decodeURIComponent(String(hash || "").trim());
        try {
            const res = await api.post({ action: "resolve_by_hash", hash: adminHash });
            project = res.data?.project;
            datos = numerosFromApi(res.data?.numeros);
            bannerExtras = extrasDe(project?.banner);
            prepararAccesoDirecto();
            fillConfigForm();
            fillBannerForm();
            wireAdminEvents();
            themeSwatches("rf-themes", bannerExtras.theme || "", onThemeShare);
            cargarOpcionesMensaje();
            renderGrid();
            renderLista();
            showAdTab("numeros");
            finalizeSplash(true);
            if (!bannerExtras.setup?.done || configIncompleta(project)) abrirAsistente();
        } catch (e) {
            finalizeSplash(false);
            const splash = $("rifa-splash");
            if (splash) {
                splash.replaceChildren();
                const p = document.createElement("p");
                p.className = "rifa-splash-error-text";
                p.textContent = e.message || String(e);
                splash.appendChild(p);
            }
            throw e;
        }
    }

    window.initRifaApp = async function initRifaApp(ctx) {
        if (typeof ctx?.showMessage === "function") showMessage = ctx.showMessage;
        if (typeof ctx?.navigateHome === "function") navigateHome = ctx.navigateHome;
        api = window.CPMRifaApi;
        if (!api || typeof api.post !== "function") {
            throw new Error("CPMRifaApi no está cargado.");
        }
        const rifa = ctx?.rifa || { mode: "hub" };
        mode = rifa.mode === "admin" ? "admin" : "hub";
        if (mode === "admin") {
            await initAdmin(rifa.hash);
        } else {
            initHub();
        }
    };
})();
