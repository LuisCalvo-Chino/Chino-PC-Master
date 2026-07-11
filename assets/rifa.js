/**
 * Sistema de Rifa multi-proyecto — hub (#rifa) + link admin (#r/<hash>)
 */
(function () {
    const MASTER_PIN_KEY = "cpm_rifa_master_pin";
    const DEFAULT_ICON = {
        whatsapp: "imagenes/WhatsApp Icon.png",
        sinpe: "imagenes/SINPE Icon.png",
        tomado: "imagenes/Tomado.png"
    };

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

    function defaultBanner() {
        return {
            bg: { color1: "#EEEEEE", color2: "#EEEEEE", gradient: false, orient: "to bottom" },
            font: "Inter, sans-serif",
            head: { mode: "text", title: "", logoUrl: "" },
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

    function mergeBanner(raw) {
        const d = defaultBanner();
        if (!raw || typeof raw !== "object") return d;
        return {
            bg: Object.assign({}, d.bg, raw.bg || {}),
            font: raw.font || d.font,
            head: Object.assign({}, d.head, raw.head || {}),
            textColors: Object.assign({}, d.textColors, raw.textColors || {}),
            numberColors: Object.assign({}, d.numberColors, raw.numberColors || {}),
            icons: {
                whatsapp: Object.assign({}, d.icons.whatsapp, (raw.icons && raw.icons.whatsapp) || {}),
                sinpe: Object.assign({}, d.icons.sinpe, (raw.icons && raw.icons.sinpe) || {}),
                tomado: Object.assign({}, d.icons.tomado, (raw.icons && raw.icons.tomado) || {})
            }
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

    function syncPremioFields(selectId, attr) {
        const n = Number($(selectId)?.value) || 1;
        document.querySelectorAll(`[${attr}]`).forEach((el) => {
            const idx = Number(el.getAttribute(attr));
            el.hidden = idx > n;
        });
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
            const res = await api.post({ action: "super_list_projects", masterPin: pin });
            const rows = res.data?.projects || res.projects || [];
            if (!rows.length) {
                tbody.innerHTML =
                    '<tr><td colspan="7" class="rifa-muted">Aún no hay proyectos. Usa + Nuevo.</td></tr>';
                return;
            }
            tbody.innerHTML = "";
            rows.forEach((p) => {
                const tr = document.createElement("tr");
                const premios = [p.premio_1, p.premio_2, p.premio_3]
                    .filter(Boolean)
                    .slice(0, p.cantidad_premios || 1)
                    .join(" · ");
                const link = adminLink(p.hash_admin);
                tr.innerHTML = `
                    <td><strong>${escapeHtml(p.sheet_name)}</strong><br/><span class="rifa-muted">${escapeHtml(p.nombre_display || "")}</span></td>
                    <td>${escapeHtml(premios)}</td>
                    <td>${escapeHtml(p.modalidad)}</td>
                    <td>${escapeHtml(p.fecha_sorteo)}</td>
                    <td>${escapeHtml(p.precio)}</td>
                    <td>
                        <div class="rifa-link-actions">
                            <a class="rifa-icon-btn rifa-icon-btn--primary" href="${escapeAttr(link)}" target="_blank" rel="noopener noreferrer" data-external="1" title="Abrir admin en otra pestaña" aria-label="Abrir admin">${ICON_OPEN}</a>
                            <button type="button" class="rifa-icon-btn" data-copy-link="${escapeAttr(link)}" title="Copiar link" aria-label="Copiar link">${ICON_COPY}</button>
                        </div>
                    </td>
                    <td>
                        <div class="rifa-link-actions">
                            <button type="button" class="rifa-icon-btn rifa-icon-btn--warn" data-archive-id="${escapeAttr(p.project_id)}" title="Desactivar (archivar)" aria-label="Desactivar">${ICON_ARCHIVE}</button>
                            <button type="button" class="rifa-icon-btn rifa-icon-btn--danger" data-del-id="${escapeAttr(p.project_id)}" title="Eliminar permanentemente" aria-label="Eliminar">${ICON_TRASH}</button>
                        </div>
                    </td>
                `;
                tbody.appendChild(tr);
            });
        } catch (e) {
            tbody.innerHTML = `<tr><td colspan="7" class="rifa-error">${escapeHtml(e.message || String(e))}</td></tr>`;
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

    function initHub() {
        $("rifa-hub").hidden = false;
        $("rifa-admin").hidden = true;
        document.body.classList.remove("cpm-rifa-standalone");
        const pinEl = $("rifa-master-pin");
        if (pinEl) pinEl.value = getMasterPin();

        document.querySelectorAll("[data-hub-view]").forEach((btn) => {
            btn.addEventListener("click", () => {
                const v = btn.getAttribute("data-hub-view");
                if (v) showHubPane(v);
            });
        });

        $("rifa-master-pin-save")?.addEventListener("click", () => {
            const v = pinEl?.value || "";
            setMasterPin(v);
            showMessage("Llave maestra guardada en este navegador.", "success");
            void loadProjectsTable();
        });

        $("rifa-new-premios-n")?.addEventListener("change", () =>
            syncPremioFields("rifa-new-premios-n", "data-premio-field")
        );
        const syncNewFecha = () => {
            const hint = $("rifa-new-fecha-hint");
            if (hint) hint.textContent = fechaHint($("rifa-new-modalidad")?.value);
        };
        $("rifa-new-modalidad")?.addEventListener("change", syncNewFecha);
        syncNewFecha();
        syncPremioFields("rifa-new-premios-n", "data-premio-field");
        wirePrecioInput($("rifa-new-precio"));

        $("rifa-new-form")?.addEventListener("submit", async (ev) => {
            ev.preventDefault();
            const pin = getMasterPin() || pinEl?.value || "";
            if (!pin) {
                showMessage("Guarda la Llave Maestra antes de crear.", "error");
                return;
            }
            const modalidad = $("rifa-new-modalidad").value;
            const fecha = $("rifa-new-fecha").value;
            const err = validateFechaModalidad(modalidad, fecha);
            if (err) {
                showMessage(err, "error");
                return;
            }
            const cantidad = Number($("rifa-new-premios-n").value) || 1;
            const payload = {
                action: "super_create_project",
                masterPin: pin,
                sheet_name: $("rifa-new-sheet").value.trim(),
                nombre_display: $("rifa-new-display").value.trim(),
                cantidad_premios: cantidad,
                premio_1: $("rifa-new-premio1").value.trim(),
                premio_2: cantidad >= 2 ? $("rifa-new-premio2").value.trim() : "",
                premio_3: cantidad >= 3 ? $("rifa-new-premio3").value.trim() : "",
                modalidad,
                fecha_sorteo: fecha,
                sinpe: $("rifa-new-sinpe").value.trim(),
                whatsapp: $("rifa-new-whatsapp").value.trim(),
                precio: formatColonPrice($("rifa-new-precio").value.trim())
            };
            const submit = $("rifa-new-submit");
            if (submit) submit.disabled = true;
            try {
                const res = await api.post(payload, { timeoutMs: 45000 });
                const hash = res.data?.hash_admin || res.data?.project?.hash_admin;
                const link = adminLink(hash);
                const box = $("rifa-new-result");
                if (box) {
                    box.hidden = false;
                    box.innerHTML = `Proyecto creado. Link administrador:<br/><code class="rifa-admin-link-text">${escapeHtml(link)}</code>
                        <div class="rifa-link-actions rifa-mt">
                            <a class="rifa-icon-btn rifa-icon-btn--primary" href="${escapeAttr(link)}" target="_blank" rel="noopener noreferrer" data-external="1" title="Abrir admin" aria-label="Abrir admin">${ICON_OPEN}</a>
                            <button type="button" class="rifa-icon-btn" data-copy-link="${escapeAttr(link)}" title="Copiar link" aria-label="Copiar link">${ICON_COPY}</button>
                        </div>`;
                }
                showMessage("Rifa creada correctamente.", "success");
                $("rifa-new-form").reset();
                syncPremioFields("rifa-new-premios-n", "data-premio-field");
                syncNewFecha();
            } catch (e) {
                showMessage(e.message || String(e), "error");
            } finally {
                if (submit) submit.disabled = false;
            }
        });

        $("rifa-projects-tbody")?.addEventListener("click", async (ev) => {
            const copyBtn = ev.target.closest("[data-copy-link]");
            if (copyBtn) {
                ev.preventDefault();
                await copyText(copyBtn.getAttribute("data-copy-link"));
                return;
            }
            const archiveBtn = ev.target.closest("[data-archive-id]");
            if (archiveBtn) {
                const id = archiveBtn.getAttribute("data-archive-id");
                if (
                    !confirm(
                        "¿Desactivar esta rifa?\nSe marcará como inactiva (activo = FALSE). La hoja de números se conserva y podrás eliminarla después."
                    )
                ) {
                    return;
                }
                const pin = getMasterPin() || pinEl?.value || "";
                try {
                    await api.post({
                        action: "super_delete_project",
                        masterPin: pin,
                        project_id: id,
                        hard: false
                    });
                    showMessage("Rifa desactivada.", "success");
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
                const pin = getMasterPin() || pinEl?.value || "";
                try {
                    await api.post({
                        action: "super_delete_project",
                        masterPin: pin,
                        project_id: id,
                        hard: true
                    });
                    showMessage("Rifa eliminada.", "success");
                    void loadProjectsTable();
                } catch (e) {
                    showMessage(e.message || String(e), "error");
                }
            }
        });

        $("rifa-new-result")?.addEventListener("click", async (ev) => {
            const copyBtn = ev.target.closest("[data-copy-link]");
            if (!copyBtn) return;
            ev.preventDefault();
            await copyText(copyBtn.getAttribute("data-copy-link"));
        });

        showHubPane("lista");
        finalizeSplash(true);
    }

    /* ========== ADMIN ========== */
    function showAdTab(name) {
        document.querySelectorAll(".rifa-tab").forEach((t) => {
            t.classList.toggle("is-active", t.getAttribute("data-adtab") === name);
        });
        document.querySelectorAll(".rifa-adpanel").forEach((p) => {
            const match = p.getAttribute("data-adpanel") === name;
            p.hidden = !match;
            p.classList.toggle("is-active", match);
        });
        if (name === "banner") refreshBannerPreview();
        if (name === "lista") renderLista();
    }

    function renderGrid() {
        const grid = $("rifa-numbers-grid");
        if (!grid) return;
        grid.innerHTML = "";
        for (let i = 0; i < 100; i++) {
            const n = String(i).padStart(2, "0");
            const info = datos[n] || { estado: "Disponible" };
            const btn = document.createElement("button");
            btn.type = "button";
            btn.className = "number-btn rifa-num-btn";
            btn.dataset.num = n;
            btn.textContent = n;
            btn.classList.add("estado-" + String(info.estado || "Disponible").toLowerCase());
            if (seleccion.has(n)) btn.classList.add("selected");
            if (info.nombre) btn.title = info.nombre;
            btn.addEventListener("click", () => toggleSelect(n));
            grid.appendChild(btn);
        }
        updateStatsUI();
        syncSelectPanel();
    }

    function toggleSelect(n) {
        if (seleccion.has(n)) seleccion.delete(n);
        else seleccion.add(n);
        renderGrid();
    }

    function syncSelectPanel() {
        const panel = $("rifa-select-panel");
        if (!panel) return;
        const count = seleccion.size;
        panel.hidden = count === 0;
        const c = $("rifa-sel-count");
        if (c) c.textContent = String(count);
        if (count === 1) {
            const n = [...seleccion][0];
            const info = datos[n];
            if (info) {
                $("rifa-sel-nombre").value = info.nombre || "";
                $("rifa-sel-tel").value = info.telefono || "";
                $("rifa-sel-contacto").value = info.contacto || "";
                $("rifa-sel-estado").value =
                    info.estado === "Disponible" ? "Reservado" : info.estado || "Reservado";
            }
        }
    }

    async function guardarSeleccion() {
        const estado = $("rifa-sel-estado").value;
        const nombre = $("rifa-sel-nombre").value.trim();
        const telefono = $("rifa-sel-tel").value.trim();
        const contacto = $("rifa-sel-contacto").value.trim();
        if ((estado === "Reservado" || estado === "Pagado") && !nombre) {
            showMessage("El nombre es obligatorio.", "error");
            return;
        }
        const listaCambios = [...seleccion].map((num) => ({
            num,
            estado,
            nombre: estado === "Disponible" ? "" : nombre,
            telefono: estado === "Disponible" ? "" : telefono,
            contacto: estado === "Disponible" ? "" : contacto
        }));
        try {
            const res = await api.post({
                action: "update_numbers",
                hash: adminHash,
                listaCambios
            });
            datos = numerosFromApi(res.data?.numeros);
            seleccion.clear();
            renderGrid();
            renderLista();
            showMessage("Números actualizados.", "success");
        } catch (e) {
            showMessage(e.message || String(e), "error");
        }
    }

    function renderLista() {
        const tbody = $("rifa-lista-tbody");
        if (!tbody) return;
        tbody.innerHTML = "";
        for (let i = 0; i < 100; i++) {
            const n = String(i).padStart(2, "0");
            const info = datos[n] || { estado: "Disponible", nombre: "", telefono: "", contacto: "" };
            const tr = document.createElement("tr");
            tr.dataset.num = n;
            if (seleccion.has(n)) tr.classList.add("is-selected");
            tr.innerHTML = `
                <td><input type="checkbox" class="rifa-lista-check" data-num="${n}" ${seleccion.has(n) ? "checked" : ""} /></td>
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

    function fillConfigForm() {
        if (!project) return;
        $("cfg-premios-n").value = String(project.cantidad_premios || 1);
        $("cfg-premio1").value = project.premio_1 || "";
        $("cfg-premio2").value = project.premio_2 || "";
        $("cfg-premio3").value = project.premio_3 || "";
        $("cfg-modalidad").value = project.modalidad || "Chances";
        $("cfg-fecha").value = (project.fecha_sorteo || "").slice(0, 10);
        $("cfg-whatsapp").value = project.whatsapp || "";
        $("cfg-sinpe").value = project.sinpe || "";
        $("cfg-precio").value = formatColonPrice(project.precio || "");
        syncPremioFields("cfg-premios-n", "data-cfg-premio");
        const hint = $("cfg-fecha-hint");
        if (hint) hint.textContent = fechaHint($("cfg-modalidad").value);
        const rngTab = $("rifa-tab-rng");
        if (rngTab) rngTab.hidden = project.modalidad !== "RNG";
        wirePrecioInput($("cfg-precio"));
    }

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
        $("bn-font").value = b.font;
        $("bn-head-mode").value = b.head.mode || "text";
        $("bn-title").value = b.head.title || project?.nombre_display || project?.sheet_name || "";
        $("bn-logo-url").value = b.head.logoUrl || "";
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
        // Si la fuente guardada no está en el select, añadirla temporalmente
        const fontSel = $("bn-font");
        if (fontSel && b.font) {
            const exists = Array.from(fontSel.options).some((o) => o.value === b.font);
            if (!exists) {
                const opt = document.createElement("option");
                opt.value = b.font;
                opt.textContent = b.font.split(",")[0].replace(/['"]/g, "");
                fontSel.appendChild(opt);
            }
            fontSel.value = b.font;
        }
        syncHeadMode();
        syncIconUploadPanels();
    }

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
    }

    function readBannerFromForm() {
        return {
            bg: {
                color1: $("bn-bg1").value,
                color2: $("bn-bg2").value,
                gradient: $("bn-grad").checked,
                orient: $("bn-orient").value
            },
            font: $("bn-font").value,
            head: {
                mode: $("bn-head-mode").value,
                title: $("bn-title").value,
                logoUrl: $("bn-logo-url").value
            },
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

    function buildBannerHtml(b, forCapture) {
        const bg = b.bg.gradient
            ? `linear-gradient(${b.bg.orient}, ${b.bg.color1}, ${b.bg.color2})`
            : b.bg.color1;
        const n = project?.cantidad_premios || 1;
        const premios = [];
        if (n >= 1 && project?.premio_1) {
            premios.push({ label: premioLabel(1), t: project.premio_1, c: b.textColors.premio1 });
        }
        if (n >= 2 && project?.premio_2) {
            premios.push({ label: premioLabel(2), t: project.premio_2, c: b.textColors.premio2 });
        }
        if (n >= 3 && project?.premio_3) {
            premios.push({ label: premioLabel(3), t: project.premio_3, c: b.textColors.premio3 });
        }

        const titleColor = b.textColors.titulo || "#FFFFFF";
        let headHtml = "";
        if (b.head.mode === "logo" && b.head.logoUrl) {
            headHtml = `<img src="${escapeAttr(b.head.logoUrl)}" alt="" style="max-width:420px;max-height:160px;object-fit:contain;" crossorigin="anonymous" />`;
        } else {
            const title = b.head.title || project?.nombre_display || project?.sheet_name || "Rifa";
            headHtml = `<div style="font-size:56px;font-weight:700;color:${escapeAttr(titleColor)};text-align:center;line-height:1.15;word-break:break-word;">${escapeHtml(title)}</div>`;
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
                ? `<img src="${escapeAttr(b.icons.whatsapp.url || DEFAULT_ICON.whatsapp)}" style="width:48px;height:48px;object-fit:contain;" crossorigin="anonymous" />`
                : "";
        const sinpeIcon =
            b.icons.sinpe.enabled
                ? `<img src="${escapeAttr(b.icons.sinpe.url || DEFAULT_ICON.sinpe)}" style="width:48px;height:48px;object-fit:contain;" crossorigin="anonymous" />`
                : "";

        const premiosHtml = premios
            .map(
                (p, i) =>
                    `<div style="color:${p.c};font-size:${i === 0 ? 36 : 30}px;margin:4px 0;text-align:center;font-weight:700;line-height:1.2;">${escapeHtml(p.label)}: ${escapeHtml(p.t)}</div>`
            )
            .join("");

        const precioTxt = `Precio: ${formatColonPrice(project?.precio || "")}`;
        const fechaLarga = formatFechaLargaEs(project?.fecha_sorteo || "");
        const modFecha = `${project?.modalidad || ""}${fechaLarga ? ": " + fechaLarga : ""}`;

        // Cuadrícula fija 10×10 dentro del ancho útil (1080 - padding)
        const bannerInner = `<div data-rifa-banner-root="1" style="width:1080px;height:1920px;background:${bg};font-family:${escapeAttr(b.font)};display:flex;flex-direction:column;align-items:stretch;padding:40px 40px 48px;box-sizing:border-box;color:#fff;overflow:hidden;">
            <div style="flex:0 0 auto;display:flex;justify-content:center;margin-bottom:16px;">${headHtml}</div>
            <div style="flex:0 0 auto;margin-bottom:12px;">${premiosHtml}</div>
            <div style="flex:0 0 auto;width:100%;max-width:1000px;margin:12px auto 20px;display:grid;grid-template-columns:repeat(10,minmax(0,1fr));grid-template-rows:repeat(10,minmax(0,1fr));gap:6px;aspect-ratio:1/1;align-self:center;">${cells}</div>
            <div style="flex:1 1 auto;"></div>
            <div style="flex:0 0 auto;text-align:center;">
                <div style="color:${b.textColors.costo};font-size:40px;font-weight:700;margin:8px 0;">${escapeHtml(precioTxt)}</div>
                <div style="color:${b.textColors.modalidadFecha};font-size:26px;margin:8px 0;line-height:1.25;">${escapeHtml(modFecha)}</div>
                <div style="display:flex;align-items:center;justify-content:center;gap:12px;margin-top:12px;color:${b.textColors.whatsapp};font-size:30px;">${waIcon}<span>${escapeHtml(project?.whatsapp || "")}</span></div>
                <div style="display:flex;align-items:center;justify-content:center;gap:12px;margin-top:8px;color:${b.textColors.sinpe};font-size:30px;">${sinpeIcon}<span>${escapeHtml(project?.sinpe || "")}</span></div>
            </div>
        </div>`;

        if (forCapture) return bannerInner;

        const scale = 0.35;
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
        stage.innerHTML = buildBannerHtml(b, false);
        stage.style.width = "auto";
        stage.style.height = "auto";
        stage.style.overflow = "visible";
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

    function loadHtml2Canvas() {
        return new Promise((resolve, reject) => {
            if (window.html2canvas) {
                resolve(window.html2canvas);
                return;
            }
            const s = document.createElement("script");
            s.src = "https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js";
            s.onload = () => resolve(window.html2canvas);
            s.onerror = () => reject(new Error("No se pudo cargar html2canvas."));
            document.head.appendChild(s);
        });
    }

    async function descargarBannerJpg() {
        const root = $("rifa-capture-root");
        if (!root) return;
        const b = readBannerFromForm();
        root.innerHTML = buildBannerHtml(b, true);
        root.style.cssText =
            "position:fixed;left:-10000px;top:0;width:1080px;height:1920px;overflow:visible;z-index:-1;pointer-events:none;";
        const target =
            root.querySelector("[data-rifa-banner-root]") || root.firstElementChild;
        if (!target) return;
        try {
            const html2canvas = await loadHtml2Canvas();
            const canvas = await html2canvas(target, {
                width: 1080,
                height: 1920,
                windowWidth: 1080,
                windowHeight: 1920,
                scale: 1,
                useCORS: true,
                allowTaint: true,
                backgroundColor: null,
                logging: false
            });
            const dataUrl = canvas.toDataURL("image/jpeg", 0.92);
            const a = document.createElement("a");
            a.href = dataUrl;
            a.download = `Rifa_${project?.sheet_name || "banner"}.jpg`;
            a.click();
            showMessage("Banner JPG descargado.", "success");
        } catch (e) {
            showMessage(e.message || String(e), "error");
        } finally {
            root.innerHTML = "";
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
        const labels = { 1: "1.er lugar", 2: "2.º lugar", 3: "3.er lugar" };
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

    function wireAdminEvents() {
        document.querySelectorAll(".rifa-tab").forEach((tab) => {
            tab.addEventListener("click", () => showAdTab(tab.getAttribute("data-adtab")));
        });

        $("rifa-sel-guardar")?.addEventListener("click", () => void guardarSeleccion());
        $("rifa-sel-cancelar")?.addEventListener("click", () => {
            seleccion.clear();
            renderGrid();
        });
        $("rifa-select-toggle")?.addEventListener("click", () => {
            const body = $("rifa-select-body");
            if (!body) return;
            const open = body.hidden;
            body.hidden = !open;
            $("rifa-select-toggle").setAttribute("aria-expanded", String(open));
        });

        document.querySelectorAll(".rifa-btn-banner-dl").forEach((btn) => {
            btn.addEventListener("click", () => void descargarBannerJpg());
        });

        $("rifa-csv-dl")?.addEventListener("click", descargarCsv);
        $("rifa-lista-guardar")?.addEventListener("click", () => void guardarListaCompleta());

        $("rifa-lista-tbody")?.addEventListener("change", (ev) => {
            const check = ev.target.closest(".rifa-lista-check");
            if (check) {
                const n = check.getAttribute("data-num");
                if (check.checked) seleccion.add(n);
                else seleccion.delete(n);
                syncSelectPanel();
            }
        });

        $("cfg-premios-n")?.addEventListener("change", () =>
            syncPremioFields("cfg-premios-n", "data-cfg-premio")
        );
        $("cfg-modalidad")?.addEventListener("change", () => {
            const hint = $("cfg-fecha-hint");
            if (hint) hint.textContent = fechaHint($("cfg-modalidad").value);
        });

        $("rifa-config-form")?.addEventListener("submit", async (ev) => {
            ev.preventDefault();
            const modalidad = $("cfg-modalidad").value;
            const fecha = $("cfg-fecha").value;
            const err = validateFechaModalidad(modalidad, fecha);
            if (err) {
                showMessage(err, "error");
                return;
            }
            const cantidad = Number($("cfg-premios-n").value) || 1;
            try {
                const res = await api.post({
                    action: "update_config",
                    hash: adminHash,
                    config: {
                        cantidad_premios: cantidad,
                        premio_1: $("cfg-premio1").value.trim(),
                        premio_2: cantidad >= 2 ? $("cfg-premio2").value.trim() : "",
                        premio_3: cantidad >= 3 ? $("cfg-premio3").value.trim() : "",
                        modalidad,
                        fecha_sorteo: fecha,
                        whatsapp: $("cfg-whatsapp").value.trim(),
                        sinpe: $("cfg-sinpe").value.trim(),
                        precio: formatColonPrice($("cfg-precio").value.trim())
                    }
                });
                project = res.data?.project || project;
                fillConfigForm();
                showMessage("Configuración guardada.", "success");
            } catch (e) {
                showMessage(e.message || String(e), "error");
            }
        });

        $("bn-head-mode")?.addEventListener("change", () => {
            syncHeadMode();
            refreshBannerPreview();
        });
        ["bn-i-wa", "bn-i-sinpe", "bn-i-tomado"].forEach((id) => {
            $(id)?.addEventListener("change", () => {
                syncIconUploadPanels();
                refreshBannerPreview();
            });
        });
        $("rifa-banner-form")?.addEventListener("input", () => refreshBannerPreview());
        $("rifa-banner-form")?.addEventListener("change", () => refreshBannerPreview());
        wirePrecioInput($("cfg-precio"));
        syncIconUploadPanels();

        $("bn-logo-upload")?.addEventListener("click", async () => {
            const file = $("bn-logo-file")?.files?.[0];
            if (!file) {
                showMessage("Selecciona una imagen primero.", "error");
                return;
            }
            try {
                const url = await uploadImageToImgBB(file);
                $("bn-logo-url").value = url;
                refreshBannerPreview();
                showMessage("Logo subido.", "success");
            } catch (e) {
                showMessage(e.message || String(e), "error");
            }
        });

        document.querySelectorAll("[data-icon-upload]").forEach((btn) => {
            btn.addEventListener("click", async () => {
                const kind = btn.getAttribute("data-icon-upload");
                const fileEl = $(
                    kind === "whatsapp"
                        ? "bn-i-wa-file"
                        : kind === "sinpe"
                          ? "bn-i-sinpe-file"
                          : "bn-i-tomado-file"
                );
                const urlEl = $(
                    kind === "whatsapp"
                        ? "bn-i-wa-url"
                        : kind === "sinpe"
                          ? "bn-i-sinpe-url"
                          : "bn-i-tomado-url"
                );
                const file = fileEl?.files?.[0];
                if (!file) {
                    showMessage("Selecciona una imagen.", "error");
                    return;
                }
                try {
                    const url = await uploadImageToImgBB(file);
                    if (urlEl) urlEl.value = url;
                    refreshBannerPreview();
                    showMessage("Icono subido.", "success");
                } catch (e) {
                    showMessage(e.message || String(e), "error");
                }
            });
        });

        $("rifa-banner-save")?.addEventListener("click", async () => {
            const banner = readBannerFromForm();
            try {
                const res = await api.post({
                    action: "update_banner",
                    hash: adminHash,
                    banner
                });
                project = res.data?.project || project;
                if (project) project.banner = banner;
                showMessage("Diseño de banner guardado.", "success");
            } catch (e) {
                showMessage(e.message || String(e), "error");
            }
        });

        $("rifa-banner-reset")?.addEventListener("click", () => {
            if (
                !confirm(
                    "¿Restablecer el banner a colores y estilos neutrales por defecto?\nNo se guarda hasta que pulses «Guardar diseño»."
                )
            ) {
                return;
            }
            resetBannerToDefaults();
        });

        $("rifa-preview-toggle")?.addEventListener("click", () => {
            $("rifa-banner-preview-box")?.classList.toggle("is-open");
        });

        $("rifa-rng-btn")?.addEventListener("click", () => void runRng());

        $("rifa-public-home-link")?.addEventListener("click", (ev) => {
            ev.preventDefault();
            document.body.classList.remove("cpm-rifa-standalone");
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
            const title = $("rifa-admin-title");
            if (title) title.textContent = project?.nombre_display || project?.sheet_name || "Rifa";
            fillConfigForm();
            fillBannerForm();
            wireAdminEvents();
            renderGrid();
            renderLista();
            showAdTab("cuadricula");
            finalizeSplash(true);
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
