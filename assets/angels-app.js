/**
 * SPA Ángeles: Super Admin (#angels-dashboard), Organizador (#a/<hash>), Participante (#u/<hash>).
 * Requiere angels-api.js (window.CPMAngelsApi) y CPM_ANGELS_MASTER_GAS_URL para el Maestro.
 */
(function () {
    const MASTER_PIN_KEY = "cpm_angels_master_pin";
    const EMISOR_SCRIPT_ASSET = "assets/gas-angels-emisor-Código.js.txt?v=1";
    /** Evita doble envío si hubiera varios listeners en «Guardar» edición. */
    let angelsEditSaveLocked = false;
    let angelsEditSetupLocked = false;

    function sheetRefStorageKey(projectId) {
        return `cpm_angels_sheet_ref_${String(projectId || "").trim()}`;
    }

    /** Convierte fecha desde Sheet/API a YYYY-MM-DD para input type date. */
    function normalizeDateInputValue(raw) {
        let s = String(raw || "").trim();
        if (!s) return "";
        if (s.indexOf("T") !== -1) s = s.split("T")[0];
        if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
        const d0 = new Date(s);
        if (!isNaN(d0.getTime())) return d0.toISOString().slice(0, 10);
        return "";
    }
    const SAFE_FONTS = [
        "Arial",
        "Georgia",
        "Tahoma",
        "Verdana",
        "Courier New",
        "Times New Roman",
        "Helvetica",
        "Trebuchet MS",
        "Lucida Sans Unicode",
        "Inter",
        "Segoe UI",
        "Comic Sans MS",
        "Impact"
    ];

    const FOOTER_MESSAGE_DEFAULT =
        '<p style="margin:0 0 6px 0;">Tu Ángel Secreto — este mensaje es anónimo.</p><p style="margin:0;font-size:11px;opacity:0.9;">Chino PC Master · Ángeles</p>';

    function esc(s) {
        return String(s || "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;");
    }

    function escAttr(s) {
        return String(s || "")
            .replace(/&/g, "&amp;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;");
    }

    function defaultDesign() {
        return {
            subject: "Mensaje de tu Ángel Secreto",
            bg: { solid: "#0b1020", gradient: false, color2: "#2a1f4a", orient: "linear-diag" },
            header: {
                imageUrl: "",
                heightPx: 120,
                barColor: "#1e3a5f",
                bg: { solid: "#1e3a5f", gradient: false, color2: "#0d47a1", orient: "linear-diag" }
            },
            sections: {
                contentBg: "#121a2e",
                footerBg: "#0e1628",
                content: { solid: "#121a2e", gradient: false, color2: "#1a237e", orient: "linear-diag" },
                footer: {
                    solid: "#0e1628",
                    gradient: false,
                    color2: "#102040",
                    orient: "linear-diag",
                    message: FOOTER_MESSAGE_DEFAULT,
                    messageFont: { family: "Arial", size: 12 }
                }
            },
            fonts: {
                greeting: { family: "Georgia", size: 18, color: "#e8eaf6" },
                body: { family: "Arial", size: 15, color: "#eceff1" },
                signature: { family: "Georgia", size: 14, color: "#b39ddb" },
                footer: { family: "Arial", size: 12, color: "#cfd8dc" },
                link: { color: "#80deea", visited: "#b39ddb" }
            }
        };
    }

    /** Compatibilidad con JSON antiguo (solo contentBg / barColor / sin footer.message). */
    function normalizeDesign(d) {
        const o = Object.assign(defaultDesign(), d || {});
        const H = o.header || {};
        if (!H.bg || typeof H.bg !== "object") {
            H.bg = {
                solid: H.barColor || "#1e3a5f",
                gradient: false,
                color2: H.barColor || "#1e3a5f",
                orient: "linear-diag"
            };
        }
        o.header = H;
        const sec = o.sections || {};
        if (!sec.content || typeof sec.content !== "object") {
            sec.content = {
                solid: sec.contentBg || "#121a2e",
                gradient: false,
                color2: sec.contentBg || "#121a2e",
                orient: "linear-diag"
            };
        }
        if (!sec.footer || typeof sec.footer !== "object") {
            sec.footer = defaultDesign().sections.footer;
        }
        if (!sec.footer.message) sec.footer.message = FOOTER_MESSAGE_DEFAULT;
        if (!sec.footer.messageFont || typeof sec.footer.messageFont !== "object") {
            const lf = o.fonts && o.fonts.footer ? o.fonts.footer : { family: "Arial", size: 12, color: "#cfd8dc" };
            sec.footer.messageFont = { family: lf.family || "Arial", size: Number(lf.size) || 12, color: lf.color || "#cfd8dc" };
        }
        o.sections = sec;
        o.fonts.footer = sec.footer.messageFont;
        if (!o.fonts.greeting.color) o.fonts.greeting.color = "#e8eaf6";
        if (!o.fonts.body.color) o.fonts.body.color = "#eceff1";
        if (!o.fonts.signature.color) o.fonts.signature.color = "#b39ddb";
        if (!o.fonts.link) o.fonts.link = { color: "#80deea", visited: "#b39ddb" };
        if (o.bg && o.bg.orient === "linear") o.bg.orient = "linear-diag";
        return o;
    }

    function sectionBgCss(sec, legacySolid) {
        const solid = String(sec && sec.solid != null ? sec.solid : legacySolid || "#0b1020");
        if (!sec || !sec.gradient) return solid;
        const c2 = String(sec.color2 || solid);
        const raw0 = String(sec.orient || "linear-diag").toLowerCase();
        const raw = raw0 === "linear" ? "linear-diag" : raw0;
        if (raw === "radial") return `radial-gradient(circle at 30% 20%, ${solid}, ${c2})`;
        if (raw === "linear-down" || raw === "todown") return `linear-gradient(to bottom, ${solid}, ${c2})`;
        if (raw === "linear-right" || raw === "toright") return `linear-gradient(to right, ${solid}, ${c2})`;
        return `linear-gradient(135deg, ${solid}, ${c2})`;
    }

    /** Extrae el file id de URLs típicas de Google Drive. */
    function driveFileIdFromUrl(url) {
        const u = String(url || "").trim();
        let m = u.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
        if (m) return m[1];
        m = u.match(/[?&]id=([a-zA-Z0-9_-]+)/);
        if (m && u.indexOf("drive.google.com") !== -1) return m[1];
        m = u.match(/\/open\?id=([a-zA-Z0-9_-]+)/);
        if (m) return m[1];
        return "";
    }

    /**
     * URL utilizable en <img src> / vista previa.
     * El endpoint thumbnail de Drive devuelve JPEG en más casos y evita bloqueos de iframe/CORS.
     */
    function driveToViewUrl(url) {
        const u = String(url || "").trim();
        const id = driveFileIdFromUrl(u);
        if (id) return `https://drive.google.com/thumbnail?id=${id}&sz=w2000`;
        return u;
    }

    /** Atributo src/href: no usar esc() de texto (rompe & de query); solo comillas y & para HTML. */
    function escUrlAttr(url) {
        return String(url || "")
            .replace(/&/g, "&amp;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;");
    }

    /** Estilos inline recomendados para <img> en cuerpo HTML de correo (Gmail). */
    const USER_EDITOR_IMG_STYLE = "display:block; max-width:100%; height:auto; margin: 5px 0;";

    /**
     * Sube una imagen a ImgBB y devuelve el enlace directo (data.url), apto para src en correos HTML.
     * Configura window.CPM_IMGBB_API_KEY en index.html; si no existe, usa la clave por defecto del proyecto.
     */
    async function uploadImageToImgBB(file) {
        const rawKey =
            typeof window !== "undefined" && window.CPM_IMGBB_API_KEY != null
                ? String(window.CPM_IMGBB_API_KEY).trim()
                : "";
        const key = rawKey || "b0c1f3375bcac127ec096aa006f93b52";
        if (!file || !/^image\//i.test(String(file.type || ""))) {
            throw new Error("Selecciona un archivo de imagen válido (PNG, JPG, GIF, WebP…).");
        }
        const maxBytes = 32 * 1024 * 1024;
        if (file.size > maxBytes) {
            throw new Error("La imagen supera el límite de 32 MB permitido por ImgBB.");
        }
        const formData = new FormData();
        formData.append("image", file);
        formData.append("key", key);
        let res;
        try {
            res = await fetch("https://api.imgbb.com/1/upload", {
                method: "POST",
                body: formData
            });
        } catch (netErr) {
            throw new Error(
                "No se pudo conectar con ImgBB. Comprueba tu conexión e inténtalo de nuevo."
            );
        }
        let json = {};
        try {
            json = await res.json();
        } catch (parseErr) {
            throw new Error("Respuesta inválida del servidor ImgBB.");
        }
        if (!json.success || !json.data || !json.data.url) {
            const apiMsg =
                json.error && json.error.message ? String(json.error.message) : "";
            throw new Error(apiMsg || "ImgBB no pudo procesar la imagen. Revisa el formato o el tamaño.");
        }
        const url = String(json.data.url || "").trim();
        if (!url) throw new Error("ImgBB no devolvió un enlace directo (data.url).");
        return url;
    }

    function insertUserEditorImageHtml(editorEl, imageUrl) {
        const raw = String(imageUrl || "").trim();
        if (!editorEl || !raw) return;
        const src = escUrlAttr(driveToViewUrl(raw));
        const html = `<img src="${src}" alt="" style="${USER_EDITOR_IMG_STYLE}" />`;
        editorEl.focus();
        document.execCommand("insertHTML", false, html);
    }

    function syncAdmHeaderPreviewImg() {
        const raw = String(document.getElementById("adm-h-image-url")?.value || "").trim();
        const wrap = document.getElementById("adm-h-upload-preview-wrap");
        const img = document.getElementById("adm-h-upload-preview-img");
        if (!wrap || !img) return;
        if (!raw) {
            wrap.hidden = true;
            img.removeAttribute("src");
            return;
        }
        const viewUrl = driveToViewUrl(raw);
        img.referrerPolicy = "no-referrer";
        img.src = viewUrl;
        const hh = Math.max(50, Math.min(400, Number(document.getElementById("adm-h-height")?.value) || 120));
        img.style.maxHeight = hh + "px";
        img.style.width = "auto";
        img.style.height = "auto";
        img.style.objectFit = "contain";
        img.removeAttribute("width");
        img.removeAttribute("height");
        wrap.hidden = false;
    }

    function buildEmailDocument(design, bodyHtml) {
        const d = normalizeDesign(design || {});
        const bgCss = sectionBgCss(d.bg, d.bg && d.bg.solid);
        const hh = Math.max(50, Math.min(400, Number(d.header?.heightPx) || 120));
        const headerUrl = d.header?.imageUrl ? escUrlAttr(driveToViewUrl(d.header.imageUrl)) : "";
        const hBgCss = sectionBgCss(d.header && d.header.bg, d.header && d.header.barColor);
        const cBgCss = sectionBgCss(d.sections && d.sections.content, d.sections && d.sections.contentBg);
        const fBgCss = sectionBgCss(d.sections && d.sections.footer, d.sections && d.sections.footerBg);
        const fg = d.fonts?.greeting || { family: "Georgia", size: 18, color: "#e8eaf6" };
        const fb = d.fonts?.body || { family: "Arial", size: 15, color: "#eceff1" };
        const fs = d.fonts?.signature || { family: "Georgia", size: 14, color: "#b39ddb" };
        const footerSec = (d.sections && d.sections.footer) || {};
        const fmf = footerSec.messageFont || d.fonts?.footer || { family: "Arial", size: 12, color: "#cfd8dc" };
        const greetLine = String(d.greetingUserLine != null ? d.greetingUserLine : "").trim();
        const greetStyle = `margin:0 0 12px 0;font-family:${esc(fg.family)},sans-serif;font-size:${Number(fg.size) || 18}px;color:${esc(fg.color || "#e8eaf6")};`;
        const greeting = greetLine
            ? `<p style="${greetStyle}">${esc(greetLine).replace(/\n/g, "<br/>")}</p>`
            : `<p style="${greetStyle}">Hola <strong>Angelado</strong>,</p>`;
        const sig =
            '<p style="margin:16px 0 0 0;font-family:' +
            esc(fs.family) +
            ",sans-serif;font-size:" +
            (Number(fs.size) || 14) +
            'px;color:' +
            esc(fs.color || "#b39ddb") +
            ';font-style:italic;">— Tu Ángel Secreto</p>';
        const inner =
            greeting +
            `<div style="font-family:${esc(fb.family)},sans-serif;font-size:${Number(fb.size) || 15}px;line-height:1.55;color:${esc(fb.color || "#eceff1")};">${bodyHtml || ""}</div>` +
            sig;
        const footerRaw = String(footerSec.message || "").trim();
        const footerMsg = footerRaw
            ? /<[a-z][\s\S]*>/i.test(footerRaw)
                ? footerRaw
                : "<p style=\"margin:0;\">" + esc(footerRaw).replace(/\n/g, "<br/>") + "</p>"
            : FOOTER_MESSAGE_DEFAULT;
        const footerInner =
            '<div style="font-family:' +
            esc(fmf.family || "Arial") +
            ",sans-serif;font-size:" +
            (Number(fmf.size) || 12) +
            'px;color:' +
            esc(fmf.color || "#cfd8dc") +
            ';text-align:center;line-height:1.45;">' +
            footerMsg +
            "</div>";
        const linkColor = esc(d.fonts?.link?.color || "#80deea");
        const linkVisited = esc(d.fonts?.link?.visited || "#b39ddb");

        /* Estructura de tabla 100% height para asegurar que el fondo de página cubra todo el viewport en clientes de correo */
        const headerCellOpen =
            '<tr><td style="padding:0;margin:0;background:' +
            hBgCss +
            ';text-align:center;line-height:0;font-size:0;">';
        const headerBlock = headerUrl
            ? `<img src="${headerUrl}" alt="" height="${hh}" style="display:block;margin:0 auto;max-width:100%;height:${hh}px;width:auto;object-fit:contain;" />`
            : `<div style="display:block;height:${hh}px;width:100%;font-size:1px;line-height:normal;">&nbsp;</div>`;
        return (
            '<!DOCTYPE html><html><head><meta charset="utf-8"><style>html,body{margin:0;padding:0;height:100%;} a{color:' + linkColor + ';} a:visited{color:' + linkVisited + ';}</style></head><body style="margin:0;padding:0;">' +
            '<table role="presentation" width="100%" height="100%" cellspacing="0" cellpadding="0" border="0" style="background:' +
            bgCss +
            ';min-height:100vh;">' +
            '<tr><td align="center" valign="middle" style="padding:20px;">' +
            '<table role="presentation" width="100%" style="max-width:640px;margin:0;border-radius:12px;overflow:hidden;border:1px solid rgba(255,255,255,0.08);" cellspacing="0" cellpadding="0" border="0">' +
            headerCellOpen +
            headerBlock +
            '</td></tr><tr><td style="padding:20px;background:' +
            cBgCss +
            ';">' +
            inner +
            '</td></tr><tr><td style="padding:12px 20px;background:' +
            fBgCss +
            ';">' +
            footerInner +
            "</td></tr></table>" +
            "</td></tr></table></body></html>"
        );
    }

    /** PIN Maestro: localStorage en este navegador (todos los proyectos). Migra valor antiguo de sessionStorage. */
    function getMasterPin() {
        try {
            const cur = localStorage.getItem(MASTER_PIN_KEY);
            if (cur != null && String(cur).trim() !== "") return String(cur).trim();
        } catch (e) {}
        try {
            const legacy = sessionStorage.getItem(MASTER_PIN_KEY);
            if (legacy != null && String(legacy).trim() !== "") {
                const t = String(legacy).trim();
                try {
                    localStorage.setItem(MASTER_PIN_KEY, t);
                } catch (e2) {}
                try {
                    sessionStorage.removeItem(MASTER_PIN_KEY);
                } catch (e3) {}
                return t;
            }
        } catch (e) {}
        return "";
    }

    function setMasterPin(v) {
        const t = String(v || "").trim();
        try {
            if (t) localStorage.setItem(MASTER_PIN_KEY, t);
            else localStorage.removeItem(MASTER_PIN_KEY);
        } catch (e) {
            try {
                if (t) sessionStorage.setItem(MASTER_PIN_KEY, t);
                else sessionStorage.removeItem(MASTER_PIN_KEY);
            } catch (e2) {}
            return;
        }
        try {
            sessionStorage.removeItem(MASTER_PIN_KEY);
        } catch (e) {}
    }

    function resolveCacheKey(hash, mode) {
        return `cpm_angels_resolve_${mode}_${hash}`;
    }

    function readResolveCache(hash, mode) {
        try {
            const raw = sessionStorage.getItem(resolveCacheKey(hash, mode));
            if (!raw) return null;
            return JSON.parse(raw);
        } catch (e) {
            return null;
        }
    }

    function writeResolveCache(hash, mode, data) {
        sessionStorage.setItem(resolveCacheKey(hash, mode), JSON.stringify(data));
    }

    function downloadHtml(filename, htmlContent) {
        const blob = new Blob([htmlContent], { type: "text/html;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    function adminUnlockKey(hash) {
        return `angels_admin_unlock_${hash}`;
    }

    function isAdminUnlocked(hash) {
        return sessionStorage.getItem(adminUnlockKey(hash)) === "1";
    }

    function setAdminUnlocked(hash) {
        sessionStorage.setItem(adminUnlockKey(hash), "1");
    }

    function fillFontSelects() {
        const opts = SAFE_FONTS.map((f) => `<option value="${esc(f)}">${esc(f)}</option>`).join("");
        ["adm-font-g", "adm-font-b", "adm-font-s", "adm-footer-msg-font"].forEach((id) => {
            const el = document.getElementById(id);
            if (el) el.innerHTML = opts;
        });
    }

    function updateAdminGradientRows() {
        [
            ["adm-bg-grad", "row-grad-bg"],
            ["adm-h-grad", "row-grad-h"],
            ["adm-c-grad", "row-grad-c"],
            ["adm-f-grad", "row-grad-f"]
        ].forEach(([chkId, rowId]) => {
            const row = document.getElementById(rowId);
            const chk = document.getElementById(chkId);
            if (row) row.hidden = !chk?.checked;
        });
    }

    function designFromAdminForm() {
        const d = normalizeDesign(defaultDesign());
        d.subject = String(document.getElementById("adm-subject")?.value || d.subject);
        d.bg.solid = document.getElementById("adm-bg1")?.value || d.bg.solid;
        d.bg.gradient = Boolean(document.getElementById("adm-bg-grad")?.checked);
        d.bg.color2 = document.getElementById("adm-bg2")?.value || d.bg.color2;
        d.bg.orient = document.getElementById("adm-bg-orient")?.value || d.bg.orient;
        d.header.barColor = document.getElementById("adm-h-bg")?.value || d.header.barColor;
        if (!d.header.bg) d.header.bg = { solid: d.header.barColor, gradient: false, color2: d.header.barColor, orient: "linear-diag" };
        d.header.bg.solid = document.getElementById("adm-h-bg")?.value || d.header.bg.solid;
        d.header.bg.gradient = Boolean(document.getElementById("adm-h-grad")?.checked);
        d.header.bg.color2 = document.getElementById("adm-h-bg2")?.value || d.header.bg.color2;
        d.header.bg.orient = document.getElementById("adm-h-orient")?.value || d.header.bg.orient;
        d.header.heightPx = Math.max(
            50,
            Math.min(400, Number(document.getElementById("adm-h-height")?.value) || 120)
        );
        d.header.imageUrl = String(document.getElementById("adm-h-image-url")?.value || "").trim();
        if (!d.sections.content) d.sections.content = defaultDesign().sections.content;
        d.sections.content.solid = document.getElementById("adm-c-bg")?.value || d.sections.content.solid;
        d.sections.content.gradient = Boolean(document.getElementById("adm-c-grad")?.checked);
        d.sections.content.color2 = document.getElementById("adm-c-bg2")?.value || d.sections.content.color2;
        d.sections.content.orient = document.getElementById("adm-c-orient")?.value || d.sections.content.orient;
        d.sections.contentBg = d.sections.content.solid;
        if (!d.sections.footer) d.sections.footer = defaultDesign().sections.footer;
        d.sections.footer.solid = document.getElementById("adm-f-bg")?.value || d.sections.footer.solid;
        d.sections.footer.gradient = Boolean(document.getElementById("adm-f-grad")?.checked);
        d.sections.footer.color2 = document.getElementById("adm-f-bg2")?.value || d.sections.footer.color2;
        d.sections.footer.orient = document.getElementById("adm-f-orient")?.value || d.sections.footer.orient;
        d.sections.footerBg = d.sections.footer.solid;
        d.sections.footer.message = String(document.getElementById("adm-footer-msg")?.value || d.sections.footer.message);
        d.sections.footer.messageFont = {
            family: document.getElementById("adm-footer-msg-font")?.value || "Arial",
            size: Math.max(
                8,
                Math.min(40, Number(document.getElementById("adm-footer-msg-size")?.value) || 12)
            ),
            color: document.getElementById("adm-color-f")?.value || "#cfd8dc"
        };
        d.fonts.greeting = {
            family: document.getElementById("adm-font-g")?.value || "Georgia",
            size: Math.max(8, Math.min(40, Number(document.getElementById("adm-size-g")?.value) || 18)),
            color: document.getElementById("adm-color-g")?.value || "#e8eaf6"
        };
        d.fonts.body = {
            family: document.getElementById("adm-font-b")?.value || "Arial",
            size: Math.max(8, Math.min(40, Number(document.getElementById("adm-size-b")?.value) || 15)),
            color: document.getElementById("adm-color-b")?.value || "#eceff1"
        };
        d.fonts.signature = {
            family: document.getElementById("adm-font-s")?.value || "Georgia",
            size: Math.max(8, Math.min(40, Number(document.getElementById("adm-size-s")?.value) || 14)),
            color: document.getElementById("adm-color-s")?.value || "#b39ddb"
        };
        d.fonts.link = {
            color: document.getElementById("adm-color-link")?.value || "#80deea",
            visited: document.getElementById("adm-color-link-v")?.value || "#b39ddb"
        };
        d.fonts.footer = d.sections.footer.messageFont;
        return d;
    }

    function applyDesignToForm(design) {
        const d = normalizeDesign(design || {});
        const mapOrient = (v) => (v === "linear" || !v ? "linear-diag" : v);
        const set = (id, val, prop) => {
            const el = document.getElementById(id);
            if (!el) return;
            if (prop === "checked") el.checked = Boolean(val);
            else el.value = val != null ? val : "";
        };
        set("adm-subject", d.subject);
        set("adm-bg1", d.bg.solid);
        set("adm-bg-grad", d.bg.gradient, "checked");
        set("adm-bg2", d.bg.color2);
        set("adm-bg-orient", mapOrient(d.bg.orient));
        const hb = d.header.bg || {};
        set("adm-h-bg", hb.solid || d.header.barColor);
        set("adm-h-grad", hb.gradient, "checked");
        set("adm-h-bg2", hb.color2);
        set("adm-h-orient", mapOrient(hb.orient));
        set("adm-h-height", d.header.heightPx);
        const lbl = document.getElementById("adm-h-height-lbl");
        if (lbl) lbl.textContent = String(d.header.heightPx);
        const hi = document.getElementById("adm-h-image-url");
        if (hi) hi.value = String(d.header.imageUrl || "").trim();
        syncAdmHeaderPreviewImg();
        const c = d.sections.content || {};
        set("adm-c-bg", c.solid || d.sections.contentBg);
        set("adm-c-grad", c.gradient, "checked");
        set("adm-c-bg2", c.color2);
        set("adm-c-orient", mapOrient(c.orient));
        const f = d.sections.footer || {};
        set("adm-f-bg", f.solid || d.sections.footerBg);
        set("adm-f-grad", f.gradient, "checked");
        set("adm-f-bg2", f.color2);
        set("adm-f-orient", mapOrient(f.orient));
        const ta = document.getElementById("adm-footer-msg");
        if (ta) ta.value = String(f.message || "");
        const mf = f.messageFont || d.fonts.footer || { family: "Arial", size: 12, color: "#cfd8dc" };
        set("adm-footer-msg-font", mf.family);
        set("adm-footer-msg-size", mf.size);
        set("adm-color-f", mf.color || "#cfd8dc");
        set("adm-font-g", d.fonts.greeting.family);
        set("adm-size-g", d.fonts.greeting.size);
        set("adm-color-g", d.fonts.greeting.color || "#e8eaf6");
        set("adm-font-b", d.fonts.body.family);
        set("adm-size-b", d.fonts.body.size);
        set("adm-color-b", d.fonts.body.color || "#eceff1");
        set("adm-font-s", d.fonts.signature.family);
        set("adm-size-s", d.fonts.signature.size);
        set("adm-color-s", d.fonts.signature.color || "#b39ddb");
        const lnk = d.fonts.link || { color: "#80deea", visited: "#b39ddb" };
        set("adm-color-link", lnk.color || "#80deea");
        set("adm-color-link-v", lnk.visited || "#b39ddb");
        updateAdminGradientRows();
    }

    function wirePreviewIframe(iframe, design, bodyHtml) {
        if (!iframe) return;
        const doc = buildEmailDocument(design, bodyHtml);
        iframe.srcdoc = doc;
    }

    /** Spinner solo sobre el panel (no body.cpm-app-loading: evita opacity 0.02 en #main-content y bloqueo de pestañas). */
    async function withLocalPanelLoading(panelEl, fn) {
        if (typeof fn !== "function") return;
        if (!panelEl) {
            await fn();
            return;
        }
        panelEl.classList.add("angels-panel--data-loading");
        try {
            await fn();
        } finally {
            panelEl.classList.remove("angels-panel--data-loading");
        }
    }

    function initAngelsApp(ctx) {
        const api = window.CPMAngelsApi;
        if (!api) {
            console.error("CPMAngelsApi no disponible");
            return Promise.resolve();
        }
        const showMessage = ctx.showMessage || (() => {});
        const page = ctx.page;
        const angels = ctx.angels;
        const navigateHome = typeof ctx.navigateHome === "function" ? ctx.navigateHome : null;
        const label = document.getElementById("angels-route-label");
        const superEl = document.getElementById("angels-super");
        const adminWrap = document.getElementById("angels-admin-wrap");
        const userWrap = document.getElementById("angels-user-wrap");
        const publicBar = document.getElementById("angels-public-bar");
        const heroBlock = document.getElementById("angels-hero-block");
        const publicMode = document.getElementById("angels-public-bar-mode");
        const angelsRoot = document.getElementById("angels-root");

        superEl.hidden = true;
        adminWrap.hidden = true;
        userWrap.hidden = true;
        if (publicBar) publicBar.hidden = true;
        if (heroBlock) heroBlock.hidden = false;
        if (angelsRoot) angelsRoot.classList.toggle("angels-root--dash", page === "angels-dashboard");

        if (page === "angels-dashboard") {
            if (label) label.textContent = "Proyectos Ángeles Secretos — panel Maestro";
            superEl.hidden = false;
            return initSuperDashboard(api, showMessage);
        }

        if (page === "angels" && angels?.mode === "u" && angels?.hash) {
            if (label) label.textContent = "Participante — solo necesitas el enlace";
            if (publicBar) publicBar.hidden = false;
            if (publicMode) publicMode.textContent = "Participante";
            if (heroBlock) heroBlock.hidden = true;
            userWrap.hidden = false;
            wirePublicHomeLink(navigateHome);
            return initUserFlow(api, showMessage, angels.hash, "u");
        }

        if (page === "angels" && angels?.mode === "a" && angels?.hash) {
            if (label) label.textContent = "Organizador — enlace + contraseña del proyecto";
            if (publicBar) publicBar.hidden = false;
            if (publicMode) publicMode.textContent = "Organizador";
            if (heroBlock) heroBlock.hidden = true;
            adminWrap.hidden = false;
            wirePublicHomeLink(navigateHome);
            return initAdminFlow(api, showMessage, angels.hash);
        }

        if (label) label.textContent = "Ruta no reconocida";
        return Promise.resolve();
    }

    function wirePublicHomeLink(navigateHome) {
        const link = document.getElementById("angels-public-home-link");
        if (!link) return;
        link.addEventListener("click", (e) => {
            e.preventDefault();
            if (navigateHome) navigateHome();
            else {
                window.location.hash = "";
                window.location.reload();
            }
        });
    }

    function buildIndexSnippet() {
        const cur = typeof window !== "undefined" ? String(window.CPM_ANGELS_MASTER_GAS_URL || "").trim() : "";
        const sample =
            cur || "https://script.google.com/macros/s/TU_DEPLOYMENT_ID/exec";
        return `<script>\n    window.CPM_ANGELS_MASTER_GAS_URL = "${sample}";\n</script>`;
    }

    async function copyTextToClipboard(text, showMessage, okMsg) {
        const t = String(text || "");
        try {
            await navigator.clipboard.writeText(t);
            showMessage(okMsg || "Copiado al portapapeles.", "success");
        } catch (e) {
            showMessage("No se pudo copiar automáticamente. Selecciona el texto manualmente.", "error");
        }
    }

    /** GET al /exec del Maestro: comprueba que el despliegue incluye las acciones del repo. */
    function warnIfStaleMasterDeploy(showMessage) {
        const base = typeof window !== "undefined" ? String(window.CPM_ANGELS_MASTER_GAS_URL || "").trim() : "";
        if (!base) return;
        const u = base + (base.indexOf("?") >= 0 ? "&" : "?") + "_cpm_ts=" + Date.now();
        fetch(u, { method: "GET", mode: "cors", cache: "no-store" })
            .then((r) => r.text())
            .then((t) => {
                let j;
                try {
                    j = JSON.parse(String(t || "").trim());
                } catch (e) {
                    return;
                }
                const actions = j.data && j.data.actionsSupported;
                if (!Array.isArray(actions)) {
                    showMessage(
                        "El Maestro de la URL en index.html no devuelve actionsSupported (despliegue antiguo o URL que no es el Maestro). Abre esa URL /exec en el navegador: si no ves la lista de acciones, haz clasp push y una nueva implementación Web.",
                        "error"
                    );
                    return;
                }
                const need = ["super_list_projects", "super_delete_project"];
                const miss = need.filter((a) => actions.indexOf(a) === -1);
                if (miss.length) {
                    showMessage(
                        "El Web App del Maestro no declara estas acciones: " +
                            miss.join(", ") +
                            ". Publica de nuevo el Maestro o corrige CPM_ANGELS_MASTER_GAS_URL.",
                        "error"
                    );
                }
            })
            .catch(() => {});
    }

    function initSuperDashboard(api, showMessage) {
        const superRoot = document.getElementById("angels-super");
        if (!superRoot) return Promise.resolve();
        if (superRoot.dataset.cpmSuperInit === "1") {
            const pinEl = document.getElementById("angels-master-pin");
            if (pinEl && getMasterPin()) pinEl.value = getMasterPin();
            document.querySelectorAll(".hub-nav-btn[data-hub-view]").forEach((b) => b.classList.remove("is-active"));
            document.querySelectorAll(".angels-hub-pane").forEach((pane) => {
                pane.hidden = pane.getAttribute("data-hub-pane") !== "projects";
            });
            return loadProjectsTable(api, showMessage);
        }

        fillFontSelects();
        let lastEmisorSetup = null;
        let lastCreated = null;
        let wizardStep = 1;
        let cachedEmisorScript = null;

        const guideIndexPre = document.getElementById("angels-guide-index-pre");
        const pinInput = document.getElementById("angels-master-pin");
        const stepLabel = document.getElementById("angels-wizard-step-label");
        const track = document.getElementById("angels-wizard-track");
        const btnNext = document.getElementById("angels-wizard-next");
        const btnBack = document.getElementById("angels-wizard-back");
        const btnFinish = document.getElementById("angels-wizard-finish");
        const emisorStatus = document.getElementById("angels-emisor-script-status");
        const wizardEmisorStatus = document.getElementById("angels-wizard-emisor-copy-status");

        const stepTitles = [
            "Código Maestro",
            "Emisor (código y Web App)",
            "Datos del evento",
            "Crear en hoja",
            "Emisor y enlaces"
        ];

        if (guideIndexPre) guideIndexPre.textContent = buildIndexSnippet();
        if (pinInput && getMasterPin()) pinInput.value = getMasterPin();

        async function copyEmisorFullScript(statusEl) {
            const status = statusEl || emisorStatus;
            if (status) status.textContent = "Cargando…";
            try {
                if (!cachedEmisorScript) {
                    const res = await fetch(EMISOR_SCRIPT_ASSET, { cache: "no-cache" });
                    if (!res.ok) throw new Error("No se pudo cargar el archivo del script.");
                    cachedEmisorScript = await res.text();
                }
                await copyTextToClipboard(
                    cachedEmisorScript,
                    showMessage,
                    "Código del Emisor copiado. Pégalo en Apps Script como Código.js."
                );
                if (status) status.textContent = "Listo.";
            } catch (e) {
                if (status) status.textContent = "";
                showMessage(e.message || "Error al cargar el script", "error");
            }
        }

        function showHubPane(view, opts) {
            const withDataLoader = Boolean(opts && opts.withDataLoader);
            document.querySelectorAll(".hub-nav-btn[data-hub-view]").forEach((btn) => {
                btn.classList.toggle("is-active", btn.getAttribute("data-hub-view") === view);
            });
            document.querySelectorAll(".angels-hub-pane").forEach((pane) => {
                const id = pane.getAttribute("data-hub-pane");
                pane.hidden = id !== view;
            });
            if (view === "guide" && guideIndexPre) guideIndexPre.textContent = buildIndexSnippet();
            if (view === "projects") {
                const hubProj = document.querySelector('[data-hub-pane="projects"]');
                if (withDataLoader) {
                    return withLocalPanelLoading(hubProj, () => loadProjectsTable(api, showMessage));
                }
                return loadProjectsTable(api, showMessage);
            }
            return Promise.resolve();
        }

        function renderTrack() {
            if (!track) return;
            track.innerHTML = stepTitles
                .map((title, i) => {
                    const n = i + 1;
                    let cls = "";
                    if (n === wizardStep) cls = "is-current";
                    else if (n < wizardStep) cls = "is-done";
                    return `<li class="${cls}">${n}. ${title}</li>`;
                })
                .join("");
        }

        function showWizardPanel(n) {
            document.querySelectorAll(".angels-wizard-panel[data-wizard-step]").forEach((el) => {
                const sn = Number(el.getAttribute("data-wizard-step"));
                el.hidden = sn !== n;
            });
            if (stepLabel) {
                stepLabel.textContent = `Paso ${n} de ${stepTitles.length}: ${stepTitles[n - 1]}`;
            }
            renderTrack();
            if (btnNext) {
                btnNext.hidden = n >= 4;
                btnNext.textContent = n < 3 ? "Siguiente" : n === 3 ? "Ir a crear proyecto" : "Siguiente";
            }
            if (btnBack) btnBack.hidden = n === 1 || n === 5;
            if (btnFinish) btnFinish.hidden = n !== 5;
        }

        function openWizardFromHub(step) {
            showHubPane("wizard");
            wizardStep = step || 1;
            if (guideIndexPre) guideIndexPre.textContent = buildIndexSnippet();
            showWizardPanel(wizardStep);
        }

        function resetWizardArtifacts() {
            lastCreated = null;
            lastEmisorSetup = null;
            const pre = document.getElementById("angels-create-result");
            if (pre) {
                pre.hidden = true;
                pre.textContent = "";
            }
            [
                "angels-run-emisor-setup",
                "angels-copy-create-json",
                "angels-copy-secret-only",
                "angels-copy-user-link",
                "angels-copy-admin-link"
            ].forEach((id) => {
                const el = document.getElementById(id);
                if (el) el.setAttribute("hidden", "hidden");
            });
        }

        function closeWizardToMenu() {
            wizardStep = 1;
            resetWizardArtifacts();
            showWizardPanel(1);
            void showHubPane("projects", { withDataLoader: true });
        }

        document.querySelectorAll(".hub-nav-btn[data-hub-view]").forEach((btn) => {
            btn.addEventListener("click", () => {
                const v = btn.getAttribute("data-hub-view");
                if (v === "wizard") openWizardFromHub(1);
                else void showHubPane(v, { withDataLoader: true });
            });
        });

        document.getElementById("angels-wizard-to-menu")?.addEventListener("click", () => closeWizardToMenu());

        document.getElementById("angels-master-pin-save")?.addEventListener("click", () => {
            setMasterPin(pinInput?.value || "");
            showMessage("Código Maestro guardado en este navegador (se usa en todos los proyectos).", "success");
        });

        btnNext?.addEventListener("click", () => {
            if (wizardStep === 1) {
                const pin = (getMasterPin() || pinInput?.value || "").trim();
                if (!pin) {
                    showMessage(
                        "Escribe el Código Maestro en la barra superior y pulsa «Guardar código maestro», o introdúcelo y continúa (se guardará al avanzar).",
                        "error"
                    );
                    return;
                }
                if (pinInput?.value && pin) setMasterPin(pin);
            }
            if (wizardStep === 2) {
                const url = (document.getElementById("angels-new-sender-url")?.value || "").trim();
                if (!url || url.indexOf("/exec") === -1) {
                    showMessage(
                        "Completa la URL del Emisor (debe ser la de la implementación Web y terminar en /exec). Sigue las instrucciones del paso 2 si aún no la tienes.",
                        "error"
                    );
                    return;
                }
            }
            if (wizardStep === 3) {
                const name = (document.getElementById("angels-new-name")?.value || "").trim();
                const fecha = (document.getElementById("angels-new-start")?.value || "").trim();
                const admin = document.getElementById("angels-new-admin-pass")?.value || "";
                if (!name || !fecha || !admin) {
                    showMessage("Completa nombre del proyecto, fecha de inicio y contraseña del organizador.", "error");
                    return;
                }
                wizardStep = 4;
                showWizardPanel(4);
                return;
            }
            if (wizardStep < 4) {
                wizardStep += 1;
                showWizardPanel(wizardStep);
            }
        });
        btnBack?.addEventListener("click", () => {
            if (wizardStep > 1) {
                wizardStep -= 1;
                showWizardPanel(wizardStep);
            }
        });
        btnFinish?.addEventListener("click", () => closeWizardToMenu());

        document.getElementById("angels-copy-emisor-script")?.addEventListener("click", () => copyEmisorFullScript(emisorStatus));

        document.getElementById("angels-wizard-copy-emisor-full")?.addEventListener("click", () =>
            copyEmisorFullScript(wizardEmisorStatus)
        );

        document.getElementById("angels-create-project")?.addEventListener("click", async () => {
            const masterPin = getMasterPin() || pinInput?.value || "";
            if (!masterPin) {
                showMessage("Indica el Código Maestro en la barra superior (y «Guardar código maestro») o escríbelo en el campo antes de crear.", "error");
                return;
            }
            const projectName = (document.getElementById("angels-new-name")?.value || "").trim();
            const fechaInicio = (document.getElementById("angels-new-start")?.value || "").trim();
            const senderExec = (document.getElementById("angels-new-sender-url")?.value || "").trim();
            const adminPlain = document.getElementById("angels-new-admin-pass")?.value || "";
            if (!projectName || !fechaInicio || !senderExec || !adminPlain) {
                showMessage("Faltan datos: vuelve al paso 2 (URL /exec) o al 3 (nombre, fecha, contraseña organizador).", "error");
                return;
            }
            if (senderExec.indexOf("/exec") === -1) {
                showMessage("La URL del Emisor debe ser la de la Web App y terminar en /exec.", "error");
                return;
            }
            const payload = {
                action: "super_create_project",
                masterPin,
                project_name: projectName,
                fecha_inicio: fechaInicio,
                sender_exec_url: senderExec,
                sender_account_email: document.getElementById("angels-new-sender-email")?.value || "",
                admin_password_plain: adminPlain
            };
            try {
                const res = await api.postMaster(payload);
                const data = res.data || res;
                lastCreated = { data, payload };
                const pre = document.getElementById("angels-create-result");
                if (pre) {
                    pre.hidden = false;
                    pre.textContent = JSON.stringify(data, null, 2);
                }
                lastEmisorSetup = {
                    senderUrl: payload.sender_exec_url,
                    body: data.emisor_setup || null
                };
                const btnSetup = document.getElementById("angels-run-emisor-setup");
                if (btnSetup) btnSetup.hidden = !lastEmisorSetup.body;
                document.getElementById("angels-copy-create-json")?.removeAttribute("hidden");
                document.getElementById("angels-copy-secret-only")?.removeAttribute("hidden");
                document.getElementById("angels-copy-user-link")?.removeAttribute("hidden");
                document.getElementById("angels-copy-admin-link")?.removeAttribute("hidden");
                showMessage("Proyecto creado. Completa el paso 5 (Emisor y enlaces).", "success");
                wizardStep = 5;
                showWizardPanel(5);
                {
                    const hubProj = document.querySelector('[data-hub-pane="projects"]');
                    void withLocalPanelLoading(hubProj, () => loadProjectsTable(api, showMessage));
                }
            } catch (e) {
                showMessage(e.message || "Error", "error");
            }
        });

        document.getElementById("angels-run-emisor-setup")?.addEventListener("click", async () => {
            if (!lastEmisorSetup || !lastEmisorSetup.body || !lastEmisorSetup.senderUrl) {
                showMessage("No hay datos de setup recientes.", "error");
                return;
            }
            try {
                await api.postSender(lastEmisorSetup.senderUrl, lastEmisorSetup.body.projectSecret, lastEmisorSetup.body);
                showMessage("Emisor configurado (hojas + hash admin).", "success");
            } catch (e) {
                showMessage(
                    e.message ||
                        "Falló setup. ¿PROJECT_SECRET ya está en el Emisor y coincide con el secret del proyecto?",
                    "error"
                );
            }
        });

        document.getElementById("angels-copy-create-json")?.addEventListener("click", () => {
            if (!lastCreated?.data) return;
            copyTextToClipboard(JSON.stringify(lastCreated.data, null, 2), showMessage, "JSON copiado.");
        });
        document.getElementById("angels-copy-secret-only")?.addEventListener("click", () => {
            if (!lastCreated?.data?.secret) return;
            copyTextToClipboard(String(lastCreated.data.secret), showMessage, "Secret copiado.");
        });
        document.getElementById("angels-copy-user-link")?.addEventListener("click", () => {
            if (!lastCreated?.data?.hash_user) return;
            const base =
                typeof window !== "undefined" ? String(window.location.origin + window.location.pathname) : "";
            copyTextToClipboard(`${base}#u/${lastCreated.data.hash_user}`, showMessage, "Enlace participantes copiado.");
        });
        document.getElementById("angels-copy-admin-link")?.addEventListener("click", () => {
            if (!lastCreated?.data?.hash_admin) return;
            const base =
                typeof window !== "undefined" ? String(window.location.origin + window.location.pathname) : "";
            copyTextToClipboard(`${base}#a/${lastCreated.data.hash_admin}`, showMessage, "Enlace organizador copiado.");
        });

        document.getElementById("angels-reload-projects")?.addEventListener("click", () => {
            const hubProj = document.querySelector('[data-hub-pane="projects"]');
            void withLocalPanelLoading(hubProj, () => loadProjectsTable(api, showMessage));
        });

        const editModal = document.getElementById("angels-edit-modal");
        const editRunSetup = document.getElementById("angels-edit-run-setup");
        const editRunSetupHint = document.getElementById("angels-edit-run-setup-hint");

        function closeEditModal() {
            if (editModal) editModal.hidden = true;
            if (editRunSetup) editRunSetup.hidden = true;
            if (editRunSetupHint) editRunSetupHint.hidden = true;
        }

        async function openProjectEditModal(projectId) {
            const masterPin = getMasterPin() || document.getElementById("angels-master-pin")?.value || "";
            if (!masterPin) {
                showMessage("Necesitas el Código Maestro guardado en la barra superior (o escríbelo en el campo y guarda).", "error");
                return;
            }
            try {
                const res = await api.postMaster({
                    action: "super_get_project",
                    masterPin,
                    project_id: projectId
                });
                const d = res.data || res;
                const pidEl = document.getElementById("angels-edit-project-id");
                const pidStr = String(d.project_id || projectId);
                if (pidEl) pidEl.value = pidStr;
                const dispId = document.getElementById("angels-edit-display-id");
                if (dispId) dispId.textContent = pidStr;
                const huEl = document.getElementById("angels-edit-hash-u");
                const haEl = document.getElementById("angels-edit-hash-a");
                if (huEl) huEl.textContent = String(d.hash_user || "—");
                if (haEl) haEl.textContent = String(d.hash_admin || "—");
                const setv = (id, v) => {
                    const el = document.getElementById(id);
                    if (el) el.value = v || "";
                };
                setv("angels-edit-name", d.project_name);
                setv("angels-edit-start", normalizeDateInputValue(d.fecha_inicio));
                setv("angels-edit-sender-url", d.sender_exec_url);
                setv("angels-edit-sender-email", d.sender_account_email);
                setv("angels-edit-admin-pass", "");
                try {
                    const ref = localStorage.getItem(sheetRefStorageKey(pidStr)) || "";
                    setv("angels-edit-sheet-ref", ref);
                } catch (e) {
                    setv("angels-edit-sheet-ref", "");
                }
                if (editRunSetup) editRunSetup.hidden = true;
                if (editRunSetupHint) editRunSetupHint.hidden = true;
                if (editModal) editModal.hidden = false;
            } catch (e) {
                showMessage(e.message || "No se pudo cargar el proyecto", "error");
            }
        }

        function bindEditModalControl(id, event, fn) {
            const el = document.getElementById(id);
            if (!el || el.dataset.cpmBound === "1") return;
            el.dataset.cpmBound = "1";
            el.addEventListener(event, fn);
        }

        bindEditModalControl("angels-edit-cancel", "click", closeEditModal);
        bindEditModalControl("angels-edit-modal-backdrop", "click", closeEditModal);

        bindEditModalControl("angels-edit-copy-id", "click", () => {
            const t = document.getElementById("angels-edit-display-id")?.textContent || "";
            if (t) copyTextToClipboard(t.trim(), showMessage, "ID copiado.");
        });
        bindEditModalControl("angels-edit-copy-hu", "click", () => {
            const t = document.getElementById("angels-edit-hash-u")?.textContent || "";
            if (t && t !== "—") copyTextToClipboard(t.trim(), showMessage, "Hash participante copiado.");
        });
        bindEditModalControl("angels-edit-copy-ha", "click", () => {
            const t = document.getElementById("angels-edit-hash-a")?.textContent || "";
            if (t && t !== "—") copyTextToClipboard(t.trim(), showMessage, "Hash admin copiado.");
        });

        bindEditModalControl("angels-edit-save", "click", async () => {
            if (angelsEditSaveLocked) return;
            const masterPin = getMasterPin() || document.getElementById("angels-master-pin")?.value || "";
            const pid = document.getElementById("angels-edit-project-id")?.value || "";
            if (!masterPin || !pid) return;
            const name = (document.getElementById("angels-edit-name")?.value || "").trim();
            const fechaRaw = document.getElementById("angels-edit-start")?.value || "";
            const fecha = normalizeDateInputValue(fechaRaw);
            const senderExec = (document.getElementById("angels-edit-sender-url")?.value || "").trim();
            const senderEmail = (document.getElementById("angels-edit-sender-email")?.value || "").trim();
            const adminPlain = document.getElementById("angels-edit-admin-pass")?.value || "";
            if (!name) {
                showMessage("Indica el nombre del proyecto.", "error");
                return;
            }
            if (!fecha) {
                showMessage("Indica una fecha de inicio válida (calendario).", "error");
                return;
            }
            if (!senderExec || senderExec.indexOf("/exec") === -1) {
                showMessage("La URL del Emisor debe contener /exec.", "error");
                return;
            }
            const payload = {
                action: "super_update_project",
                masterPin,
                project_id: pid,
                project_name: name,
                fecha_inicio: fecha,
                sender_exec_url: senderExec,
                sender_account_email: senderEmail,
                admin_password_plain: adminPlain
            };
            angelsEditSaveLocked = true;
            try {
                const res = await api.postMaster(payload);
                const d = res.data || res;
                const em = d.emisor_setup;
                try {
                    const ref = (document.getElementById("angels-edit-sheet-ref")?.value || "").trim();
                    if (ref) localStorage.setItem(sheetRefStorageKey(pid), ref);
                    else localStorage.removeItem(sheetRefStorageKey(pid));
                } catch (e) {}
                if (em && payload.sender_exec_url) {
                    lastEmisorSetup = { senderUrl: String(payload.sender_exec_url).trim(), body: em };
                    if (editRunSetup) editRunSetup.hidden = false;
                    if (editRunSetupHint) editRunSetupHint.hidden = false;
                    showMessage(
                        "Proyecto actualizado. Si cambiaste fecha u organizador, pulsa «Ejecutar setup en Emisor».",
                        "success"
                    );
                } else {
                    closeEditModal();
                    showMessage("Proyecto actualizado.", "success");
                }
                {
                    const hubProj = document.querySelector('[data-hub-pane="projects"]');
                    await withLocalPanelLoading(hubProj, () => loadProjectsTable(api, showMessage));
                }
            } catch (e) {
                showMessage(e.message || "No se pudo guardar", "error");
            } finally {
                angelsEditSaveLocked = false;
            }
        });

        bindEditModalControl("angels-edit-run-setup", "click", async () => {
            if (angelsEditSetupLocked) return;
            if (!lastEmisorSetup?.body || !lastEmisorSetup.senderUrl) return;
            angelsEditSetupLocked = true;
            try {
                await api.postSender(lastEmisorSetup.senderUrl, lastEmisorSetup.body.projectSecret, lastEmisorSetup.body);
                showMessage("Emisor sincronizado (setup_project).", "success");
                closeEditModal();
            } catch (e) {
                showMessage(e.message || "Falló setup en el Emisor.", "error");
            } finally {
                angelsEditSetupLocked = false;
            }
        });

        document.getElementById("angels-projects-table")?.addEventListener("click", (ev) => {
            const t = ev.target;
            if (!(t instanceof HTMLElement)) return;
            const copyAngel = t.closest("[data-copy-angel-link]");
            if (copyAngel) {
                ev.preventDefault();
                const raw = copyAngel.getAttribute("data-copy-angel-link");
                if (raw) copyTextToClipboard(raw, showMessage, "Enlace copiado.");
                return;
            }
            const openUrlBtn = t.closest("[data-open-url]");
            if (openUrlBtn) {
                ev.preventDefault();
                const raw = openUrlBtn.getAttribute("data-open-url");
                if (raw) window.open(raw, "_blank", "noopener");
                return;
            }
            const editBtn = t.closest("[data-proj-edit]");
            const delBtn = t.closest("[data-proj-delete]");
            if (editBtn) {
                const id = editBtn.getAttribute("data-proj-edit");
                if (id) openProjectEditModal(id);
                return;
            }
            if (delBtn) {
                const id = delBtn.getAttribute("data-proj-delete");
                if (!id) return;
                if (
                    !window.confirm(
                        "¿Eliminar este proyecto del Maestro? La fila se borrará y la carpeta de Drive irá a la papelera."
                    )
                ) {
                    return;
                }
                const masterPin = getMasterPin() || document.getElementById("angels-master-pin")?.value || "";
                if (!masterPin) {
                    showMessage("Necesitas el Código Maestro (barra superior).", "error");
                    return;
                }
                (async () => {
                    try {
                        await api.postMaster(
                            { action: "super_delete_project", masterPin, project_id: id },
                            { timeoutMs: 120000 }
                        );
                        showMessage("Proyecto eliminado.", "success");
                        const hubProj = document.querySelector('[data-hub-pane="projects"]');
                        await withLocalPanelLoading(hubProj, () => loadProjectsTable(api, showMessage));
                    } catch (e) {
                        showMessage(e.message || "No se pudo eliminar", "error");
                    }
                })();
            }
        });

        superRoot.dataset.cpmSuperInit = "1";
        warnIfStaleMasterDeploy(showMessage);
        return showHubPane("projects", { withDataLoader: false });
    }

    async function loadProjectsTable(api, showMessage) {
        const masterPin = getMasterPin() || document.getElementById("angels-master-pin")?.value || "";
        if (!masterPin) {
            showMessage("Guarda el Código Maestro en la barra superior para listar proyectos.", "info");
            return;
        }
        try {
            const res = await api.postMaster({ action: "super_list_projects", masterPin });
            const rows = res.data?.projects || res.projects || [];
            const html = rows
                .map((p) => {
                    const base =
                        typeof window !== "undefined" ? String(window.location.origin + window.location.pathname) : "";
                    const hu = encodeURIComponent(String(p.hash_user || ""));
                    const ha = encodeURIComponent(String(p.hash_admin || ""));
                    const u = `${base}#u/${hu}`;
                    const a = `${base}#a/${ha}`;
                    const uEsc = escAttr(u);
                    const aEsc = escAttr(a);
                    const pid = escAttr(p.project_id);
                    const linksCell = `<div class="angels-link-box" role="group" aria-label="Enlaces del proyecto">
  <div class="angels-link-pair">
    <button type="button" class="angels-link-main-btn" data-open-url="${uEsc}">Usuario</button>
    <button type="button" class="angels-link-copy-mini" data-copy-angel-link="${uEsc}" title="Copiar enlace participante" aria-label="Copiar enlace participante">📋</button>
  </div>
  <div class="angels-link-pair">
    <button type="button" class="angels-link-main-btn" data-open-url="${aEsc}">Admin</button>
    <button type="button" class="angels-link-copy-mini" data-copy-angel-link="${aEsc}" title="Copiar enlace organizador" aria-label="Copiar enlace organizador">📋</button>
  </div>
</div>`;
                    return `<tr><td>${esc(p.project_id)}</td><td>${esc(p.project_name)}</td><td class="angels-links-cell">${linksCell}</td><td class="angels-table-actions"><button type="button" class="angels-btn angels-btn--sm" data-proj-edit="${pid}">Editar</button> <button type="button" class="angels-btn angels-btn--sm angels-btn--danger" data-proj-delete="${pid}">Borrar</button></td></tr>`;
                })
                .join("");
            const tb = document.querySelector("#angels-projects-table tbody");
            if (tb) tb.innerHTML = html;
        } catch (e) {
            showMessage(e.message || "No se pudieron listar proyectos", "error");
        }
    }

    async function resolveProject(api, hash, role) {
        const cached = readResolveCache(hash, role);
        if (cached && cached.sender_exec_url && cached.secret) return cached;
        const res = await api.postMaster({
            action: "resolve_by_hash",
            hash,
            role
        });
        const data = res.data || res;
        if (!data.sender_exec_url || !data.secret) {
            throw new Error("Resolución incompleta: falta emisor o secret.");
        }
        writeResolveCache(hash, role, data);
        return data;
    }

    function initUserFlow(api, showMessage, hash, role) {
        let resolved = null;
        let design = defaultDesign();
        let angelesList = [];
        let designLoadedAt = 0;
        const DESIGN_CACHE_TTL_MS = 3 * 60 * 1000;

        function weekKeyToDisplayLabel(wk) {
            const m = String(wk || "").match(/^W(\d+)$/i);
            return m ? `Semana ${Number(m[1])}` : "";
        }

        function formatReplySummaryTitle(it) {
            const base = it.title || "Respuesta";
            if (it.week) {
                const weekLabel = weekKeyToDisplayLabel(it.week);
                if (weekLabel) return `${weekLabel} - ${base}`;
            }
            return base;
        }

        function syncUserSaveButtonState() {
            const sel = document.getElementById("usr-angel-select");
            const btn = document.getElementById("usr-save-msg");
            if (!btn || !sel) return;
            btn.disabled = !resolved || sel.value === "";
        }

        function applyAngelesListToSelect(list) {
            const sel = document.getElementById("usr-angel-select");
            const lbl = document.getElementById("usr-angelado-lbl");
            if (!sel) return;
            const rows = Array.isArray(list) ? list : [];
            const placeholder =
                '<option value="" disabled selected>Selecciona un Ángel</option>';
            sel.innerHTML =
                placeholder +
                rows
                    .map(
                        (r, i) =>
                            `<option value="${i}" data-email="${esc(r.email_angelado)}">${esc(r.nombre_angel)}</option>`
                    )
                    .join("");
            const upd = () => {
                const ix = Number(sel.value);
                const row = Number.isFinite(ix) && ix >= 0 ? rows[ix] : null;
                if (lbl) lbl.textContent = row ? row.nombre_angelado : "—";
                syncUserSaveButtonState();
            };
            sel.onchange = upd;
            upd();
        }

        function updateUserHeadOffset() {
            const head = document.getElementById("angels-user-head");
            if (head) {
                document.documentElement.style.setProperty(
                    "--angels-user-head-bottom",
                    `${head.getBoundingClientRect().bottom}px`
                );
            }
            const fab = document.getElementById("usr-preview-fab");
            const mq = window.matchMedia("(max-width: 900px)");
            if (fab && fab.classList.contains("is-visible") && mq.matches) {
                document.documentElement.style.setProperty(
                    "--angels-user-fab-bottom",
                    `${fab.getBoundingClientRect().bottom}px`
                );
            } else {
                document.documentElement.style.removeProperty("--angels-user-fab-bottom");
            }
        }

        function syncUserPreviewFabVisibility() {
            const fab = document.getElementById("usr-preview-fab");
            if (!fab) return;
            const writeActive = document
                .querySelector('[data-upanel="write"]')
                ?.classList.contains("is-active");
            const mq = window.matchMedia("(max-width: 900px)");
            fab.classList.toggle("is-visible", Boolean(writeActive && mq.matches));
        }

        function userPreviewIsMobile() {
            return window.matchMedia("(max-width: 900px)").matches;
        }

        let userPreviewScrollLockY = 0;

        function setUserPreviewBackgroundScrollLocked(lock) {
            const html = document.documentElement;
            const body = document.body;
            if (lock) {
                if (!userPreviewIsMobile()) return;
                if (body.classList.contains("cpm-angels-user-preview-scroll-lock")) return;
                userPreviewScrollLockY = window.scrollY || window.pageYOffset || 0;
                body.classList.add("cpm-angels-user-preview-scroll-lock");
                html.classList.add("cpm-angels-user-preview-scroll-lock");
                body.style.top = `-${userPreviewScrollLockY}px`;
                body.style.position = "fixed";
                body.style.left = "0";
                body.style.right = "0";
                body.style.width = "100%";
            } else {
                if (!body.classList.contains("cpm-angels-user-preview-scroll-lock")) return;
                body.classList.remove("cpm-angels-user-preview-scroll-lock");
                html.classList.remove("cpm-angels-user-preview-scroll-lock");
                body.style.removeProperty("top");
                body.style.removeProperty("position");
                body.style.removeProperty("left");
                body.style.removeProperty("right");
                body.style.removeProperty("width");
                const y = userPreviewScrollLockY;
                userPreviewScrollLockY = 0;
                window.scrollTo(0, y);
            }
        }

        function setUserPreviewPanelOpen(open) {
            const box = document.getElementById("usr-preview-box");
            const col = document.querySelector('[data-upanel="write"] .angels-preview-col');
            const fab = document.getElementById("usr-preview-fab");
            const mobile = userPreviewIsMobile();
            if (!mobile) {
                col?.classList.remove("angels-preview-col--floating-open");
                if (fab) fab.setAttribute("aria-expanded", "false");
                setUserPreviewBackgroundScrollLocked(false);
                return;
            }
            box?.classList.toggle("is-open", open);
            col?.classList.toggle("angels-preview-col--floating-open", open);
            fab?.setAttribute("aria-expanded", open ? "true" : "false");
            setUserPreviewBackgroundScrollLocked(open);
            if (open) {
                requestAnimationFrame(() => {
                    requestAnimationFrame(() => {
                        updateUserHeadOffset();
                        if (typeof updateUserPreview === "function") updateUserPreview();
                    });
                });
            } else {
                updateUserHeadOffset();
            }
        }

        function toggleUserPreviewPanel() {
            if (!userPreviewIsMobile()) return;
            const box = document.getElementById("usr-preview-box");
            const next = !box?.classList.contains("is-open");
            setUserPreviewPanelOpen(next);
        }

        async function refreshUserDesignFromServer(opts) {
            if (!resolved) return;
            const force = Boolean(opts && opts.force);
            if (
                !force &&
                designLoadedAt &&
                Date.now() - designLoadedAt < DESIGN_CACHE_TTL_MS
            ) {
                updateUserPreview();
                return;
            }
            try {
                const cfg = await api.postSender(resolved.sender_exec_url, resolved.secret, {
                    action: "get_config"
                });
                design = normalizeDesign((cfg.data && cfg.data.design) || cfg.design || {});
                designLoadedAt = Date.now();
                updateUserPreview();
            } catch (e) {
                /* silencioso */
            }
        }

        async function refreshUserAngels() {
            if (!resolved) return;
            const res = await api.postSender(resolved.sender_exec_url, resolved.secret, {
                action: "user_list_angeles"
            });
            angelesList = res.data?.angeles || res.angeles || [];
            applyAngelesListToSelect(angelesList);
        }

        async function loadUserSessionInitial() {
            if (!resolved) return false;
            try {
                const boot = await api.postSender(resolved.sender_exec_url, resolved.secret, {
                    action: "user_bootstrap"
                });
                const data = boot.data || boot;
                if (data.design) {
                    design = normalizeDesign(data.design);
                    designLoadedAt = Date.now();
                }
                if (data.angeles) {
                    angelesList = data.angeles;
                    applyAngelesListToSelect(angelesList);
                }
                updateUserPreview();
                syncUserSaveButtonState();
                return true;
            } catch (e) {
                return false;
            }
        }

        async function loadUserSessionFallback() {
            if (!resolved) return;
            const [cfg, angelsRes] = await Promise.all([
                api.postSender(resolved.sender_exec_url, resolved.secret, {
                    action: "get_config"
                }),
                api.postSender(resolved.sender_exec_url, resolved.secret, {
                    action: "user_list_angeles"
                })
            ]);
            design = normalizeDesign((cfg.data && cfg.data.design) || cfg.design || {});
            designLoadedAt = Date.now();
            angelesList = angelsRes.data?.angeles || angelsRes.angeles || [];
            applyAngelesListToSelect(angelesList);
            updateUserPreview();
            syncUserSaveButtonState();
        }

        async function refreshUserStatus() {
            if (!resolved) return;
            const selWeek = document.getElementById("usr-status-week");
            const reqWeek = selWeek ? selWeek.value : "";
            const res = await api.postSender(resolved.sender_exec_url, resolved.secret, {
                action: "user_week_status",
                week: reqWeek
            });
            const rows = res.data?.rows || res.rows || [];
            const currentWeek = res.data?.current_week || res.current_week || "W0";
            const reqWk = res.data?.requested_week || res.requested_week || currentWeek;
            
            if (selWeek && selWeek.options.length === 0) {
                const maxW = parseInt(currentWeek.replace("W", "")) || 0;
                let opts = "";
                for (let i = maxW; i >= 0; i--) {
                    const w = "W" + i;
                    opts += `<option value="${w}">${w}${i === maxW ? " (Actual)" : ""}</option>`;
                }
                selWeek.innerHTML = opts;
                selWeek.value = reqWk;
                selWeek.onchange = () => withLocalPanelLoading(document.querySelector('[data-upanel="status"]'), refreshUserStatus);
            }

            const tb = document.querySelector("#usr-status-table tbody");
            if (tb) {
                tb.innerHTML = rows
                    .map((r) => {
                        let stHtml = "";
                        const stUpper = String(r.status || "").toUpperCase();
                        if (stUpper === "SENT" || stUpper === "ENVIADO") stHtml = "✅ Enviado";
                        else if (stUpper === "PENDING" || stUpper === "LISTO")
                            stHtml = "📧 Envío pendiente";
                        else if (stUpper === "ERROR") stHtml = "❌ Error";
                        else stHtml = "⚠️ Por redactar";
                        return `<tr><td>${esc(r.angel)}</td><td>${stHtml}</td></tr>`;
                    })
                    .join("");
            }
        }

        async function refreshReplies() {
            if (!resolved) return;
            const res = await api.postSender(resolved.sender_exec_url, resolved.secret, {
                action: "fetch_inbox_replies"
            });
            const items = res.data?.items || res.items || [];
            const acc = document.getElementById("usr-replies-acc");
            if (!acc) return;
            acc.innerHTML = items
                .map(
                    (it) =>
                        `<details class="angels-acc-item"><summary>${esc(
                            formatReplySummaryTitle(it)
                        )}</summary><div class="angels-acc-body">${it.html || esc(it.text || "")}</div></details>`
                )
                .join("") || "<p>Sin respuestas esta semana.</p>";
        }

        async function refreshBuddies() {
            if (!resolved) return;
            const res = await api.postSender(resolved.sender_exec_url, resolved.secret, {
                action: "user_list_buddies"
            });
            const list = res.data?.pairs || res.pairs || [];
            const ul = document.getElementById("usr-buddies-list");
            if (ul) {
                ul.innerHTML = list.map((p) => `<li>${esc(p.a)} ↔ ${esc(p.b)}</li>`).join("") || "<li>—</li>";
            }
        }

        document.querySelectorAll("[data-utab]").forEach((btn) => {
            btn.addEventListener("click", () => {
                document.querySelectorAll("[data-utab]").forEach((b) => b.classList.remove("is-active"));
                btn.classList.add("is-active");
                const id = btn.getAttribute("data-utab");
                document.querySelectorAll("[data-upanel]").forEach((p) => {
                    p.classList.toggle("is-active", p.getAttribute("data-upanel") === id);
                });
                const fullPanel = document.querySelector(`[data-upanel="${id}"]`);
                const editorCol = document.querySelector('[data-upanel="write"] .angels-editor-col');
                const panel =
                    id === "write" && editorCol ? editorCol : fullPanel;
                syncUserPreviewFabVisibility();
                if (id !== "write") {
                    setUserPreviewPanelOpen(false);
                } else {
                    updateUserHeadOffset();
                }
                void (async () => {
                    try {
                        if (id === "write") await withLocalPanelLoading(panel, () => refreshUserDesignFromServer());
                        else if (id === "replies") await withLocalPanelLoading(panel, () => refreshReplies());
                        else if (id === "buddies") await withLocalPanelLoading(panel, () => refreshBuddies());
                        else if (id === "status") await withLocalPanelLoading(panel, () => refreshUserStatus());
                    } catch (e) {
                        /* errores ya vía showMessage en cada refresh */
                    }
                })();
            });
        });

        window.addEventListener(
            "resize",
            () => {
                syncUserPreviewFabVisibility();
                if (!userPreviewIsMobile()) {
                    document
                        .querySelector('[data-upanel="write"] .angels-preview-col')
                        ?.classList.remove("angels-preview-col--floating-open");
                    document.getElementById("usr-preview-box")?.classList.remove("is-open");
                    document.getElementById("usr-preview-fab")?.setAttribute("aria-expanded", "false");
                    setUserPreviewBackgroundScrollLocked(false);
                } else if (document.getElementById("usr-preview-box")?.classList.contains("is-open")) {
                    updateUserHeadOffset();
                }
            },
            { passive: true }
        );

        window.addEventListener(
            "scroll",
            () => {
                if (
                    userPreviewIsMobile() &&
                    document.getElementById("usr-preview-box")?.classList.contains("is-open")
                ) {
                    updateUserHeadOffset();
                }
            },
            { passive: true, capture: true }
        );

        document.addEventListener("visibilitychange", () => {
            if (document.visibilityState !== "visible" || !resolved) return;
            const writeOpen = document.querySelector('[data-upanel="write"]')?.classList.contains("is-active");
            if (writeOpen) refreshUserDesignFromServer({ force: true });
        });

        const ed = document.getElementById("usr-editor");
        const greetKey = `cpm_angels_user_greeting_${String(hash || "").trim()}`;
        const greetEl = document.getElementById("usr-greeting");
        if (greetEl) {
            let gv = "";
            try {
                gv = localStorage.getItem(greetKey) || "";
            } catch (e) {}
            greetEl.value = gv;
            greetEl.addEventListener("input", () => {
                try {
                    localStorage.setItem(greetKey, greetEl.value);
                } catch (e2) {}
                updateUserPreview();
            });
        }

        let savedSelection = null;
        function saveSelection() {
            const sel = window.getSelection();
            if (sel.getRangeAt && sel.rangeCount) {
                savedSelection = sel.getRangeAt(0);
            }
        }
        function restoreSelection() {
            if (savedSelection) {
                const sel = window.getSelection();
                sel.removeAllRanges();
                sel.addRange(savedSelection);
            }
        }

        document.querySelectorAll(".angels-rt-toolbar [data-cmd]").forEach((b) => {
            b.addEventListener("click", () => {
                const cmd = b.getAttribute("data-cmd");
                document.execCommand(cmd, false, null);
                ed?.focus();
            });
        });

        const dlgLink = document.getElementById("usr-link-dialog");

        document.getElementById("usr-link-btn")?.addEventListener("click", () => {
            saveSelection();
            dlgLink.hidden = false;
            const textInput = document.getElementById("usr-link-text");
            const selText = window.getSelection().toString();
            textInput.value = selText || "";
            document.getElementById("usr-link-url").value = "";
            textInput.focus();
        });

        document.getElementById("usr-link-cancel")?.addEventListener("click", () => {
            dlgLink.hidden = true;
            restoreSelection();
        });

        document.getElementById("usr-link-insert")?.addEventListener("click", () => {
            const text = document.getElementById("usr-link-text")?.value || "";
            const url = document.getElementById("usr-link-url")?.value || "";
            dlgLink.hidden = true;
            if (!url) return;
            restoreSelection();
            ed?.focus();
            if (text && text !== window.getSelection().toString()) {
                document.execCommand("insertHTML", false, `<a href="${escAttr(url)}" target="_blank" rel="noopener">${esc(text)}</a>`);
            } else {
                document.execCommand("createLink", false, url);
            }
            updateUserPreview();
        });

        const usrImgBtn = document.getElementById("usr-img-btn");
        const usrImgFileInput = document.getElementById("usr-img-file");
        const usrImgBtnDefaultHtml = usrImgBtn ? usrImgBtn.innerHTML : "🖼";
        const usrImgBtnDefaultTitle = "Subir imagen (ImgBB)";

        usrImgBtn?.addEventListener("click", () => {
            dlgLink.hidden = true;
            saveSelection();
            usrImgFileInput?.click();
        });

        usrImgFileInput?.addEventListener("change", async () => {
            const file = usrImgFileInput.files && usrImgFileInput.files[0];
            usrImgFileInput.value = "";
            if (!file || !ed) return;
            if (usrImgBtn) {
                usrImgBtn.disabled = true;
                usrImgBtn.innerHTML = "⏳";
                usrImgBtn.title = "Subiendo…";
                usrImgBtn.setAttribute("aria-busy", "true");
            }
            try {
                const directUrl = await uploadImageToImgBB(file);
                restoreSelection();
                insertUserEditorImageHtml(ed, directUrl);
                updateUserPreview();
                showMessage("Imagen insertada correctamente.", "success");
            } catch (err) {
                showMessage(err.message || "No se pudo subir la imagen.", "error");
            } finally {
                if (usrImgBtn) {
                    usrImgBtn.disabled = false;
                    usrImgBtn.innerHTML = usrImgBtnDefaultHtml;
                    usrImgBtn.title = usrImgBtnDefaultTitle;
                    usrImgBtn.removeAttribute("aria-busy");
                }
            }
        });

        function userDesignForPreview() {
            const g = document.getElementById("usr-greeting");
            const line = g ? String(g.value || "").trim() : "";
            if (!line) return design;
            return Object.assign({}, design, { greetingUserLine: line });
        }

        function updateUserPreview() {
            wirePreviewIframe(
                document.getElementById("usr-preview-frame"),
                userDesignForPreview(),
                ed?.innerHTML || "<p>(vacío)</p>"
            );
        }
        ed?.addEventListener("input", updateUserPreview);
        document.getElementById("usr-preview-fab")?.addEventListener("click", toggleUserPreviewPanel);
        syncUserPreviewFabVisibility();
        updateUserHeadOffset();

        document.getElementById("usr-download-html")?.addEventListener("click", () => {
            const ed = document.getElementById("usr-editor");
            const html = buildEmailDocument(userDesignForPreview(), ed?.innerHTML || "");
            downloadHtml("email-preview-user.html", html);
        });

        document.getElementById("usr-save-msg")?.addEventListener("click", async () => {
            if (!resolved) {
                showMessage("Espera la carga del proyecto.", "error");
                return;
            }
            const sel = document.getElementById("usr-angel-select");
            if (!sel || sel.value === "") {
                showMessage("Selecciona un Ángel antes de enviar.", "error");
                return;
            }
            if (greetEl && !String(greetEl.value || "").trim()) {
                if (
                    !window.confirm(
                        "No escribiste un saludo personalizado. Se enviará con el saludo por defecto «Hola Angelado». ¿Continuar?"
                    )
                ) {
                    return;
                }
            }
            await refreshUserDesignFromServer({ force: true });
            const ix = Number(sel.value);
            let list = angelesList;
            if (!list.length) {
                const resList = await api.postSender(resolved.sender_exec_url, resolved.secret, {
                    action: "user_list_angeles"
                });
                list = resList.data?.angeles || resList.angeles || [];
                angelesList = list;
            }
            const row = list[ix];
            if (!row) {
                showMessage("Selecciona un Ángel antes de enviar.", "error");
                return;
            }
            const html = buildEmailDocument(userDesignForPreview(), ed?.innerHTML || "");
            try {
                await api.postSender(resolved.sender_exec_url, resolved.secret, {
                    action: "user_save_message",
                    nombre_angel: row.nombre_angel,
                    nombre_angelado: row.nombre_angelado,
                    email_angelado: row.email_angelado,
                    html_mensaje: html
                });
                showMessage("Mensaje guardado en pendientes.", "success");
                ed.innerHTML = "";
                updateUserPreview();
                refreshUserStatus();
            } catch (e) {
                showMessage(e.message || "Error al guardar", "error", 10000);
            }
        });

        updateUserPreview();

        return (async () => {
            try {
                resolved = await resolveProject(api, hash, role);
                syncUserSaveButtonState();
                const bootOk = await loadUserSessionInitial();
                if (!bootOk) {
                    await loadUserSessionFallback();
                }
                updateUserPreview();
            } catch (e) {
                showMessage(e.message || "No se pudo cargar el proyecto", "error");
            }
        })();
    }

    function initAdminFlow(api, showMessage, hash) {
        fillFontSelects();
        let resolved = null;
        const gate = document.getElementById("angels-admin-gate");
        const gateErr = document.getElementById("angels-admin-gate-err");
        const app = document.getElementById("angels-admin-app");

        async function loadAdminDesign() {
            if (!resolved) return;
            const cfg = await api.postSender(resolved.sender_exec_url, resolved.secret, { action: "get_config" });
            const design = normalizeDesign((cfg.data && cfg.data.design) || cfg.design || {});
            applyDesignToForm(design);
            wirePreviewIframe(
                document.getElementById("adm-preview-frame"),
                designFromAdminForm(),
                "<p>Vista previa de prueba — texto fijo de transformación establecido.</p>"
            );
        }

        document.getElementById("angels-admin-pass-submit")?.addEventListener("click", async () => {
            gateErr.hidden = true;
            const pass = document.getElementById("angels-admin-pass-input")?.value || "";
            if (!resolved) {
                try {
                    resolved = await resolveProject(api, hash, "a");
                } catch (e) {
                    gateErr.textContent = e.message || "Error";
                    gateErr.hidden = false;
                    return;
                }
            }
            try {
                await api.postSender(resolved.sender_exec_url, resolved.secret, {
                    action: "admin_login",
                    password: pass
                });
                setAdminUnlocked(hash);
                gate.hidden = true;
                app.hidden = false;
                await withLocalPanelLoading(app, () => loadAdminDesign());
                showMessage("Acceso concedido.", "success");
            } catch (e) {
                gateErr.textContent = e.message || "Contraseña incorrecta";
                gateErr.hidden = false;
            }
        });

        const admHH = document.getElementById("adm-h-height");
        const syncHLbl = (e) => {
            const lbl = document.getElementById("adm-h-height-lbl");
            if (lbl) lbl.textContent = String(e.target?.value ?? admHH?.value ?? "");
            syncAdmHeaderPreviewImg();
        };
        admHH?.addEventListener("input", syncHLbl);
        admHH?.addEventListener("change", syncHLbl);

        ["adm-bg-grad", "adm-h-grad", "adm-c-grad", "adm-f-grad"].forEach((id) => {
            document.getElementById(id)?.addEventListener("change", updateAdminGradientRows);
        });

        (function wireHeaderDropzone() {
            const drop = document.getElementById("adm-h-drop");
            const fileInput = document.getElementById("adm-h-file");
            if (!drop || !fileInput) return;
            ["dragenter", "dragover", "dragleave", "drop"].forEach((ev) => {
                drop.addEventListener(ev, (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                });
            });
            drop.addEventListener("dragover", () => drop.classList.add("angels-dropzone--active"));
            drop.addEventListener("dragleave", () => drop.classList.remove("angels-dropzone--active"));
            drop.addEventListener("drop", (e) => {
                drop.classList.remove("angels-dropzone--active");
                const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
                if (f && String(f.type).indexOf("image/") === 0) {
                    const dt = new DataTransfer();
                    dt.items.add(f);
                    fileInput.files = dt.files;
                    fileInput.dispatchEvent(new Event("change", { bubbles: true }));
                }
            });
        })();

        function refreshAdminPreview() {
            wirePreviewIframe(
                document.getElementById("adm-preview-frame"),
                designFromAdminForm(),
                "<p>Vista previa de prueba — texto fijo de transformación establecido.</p>"
            );
        }
        document.querySelectorAll("#angels-admin-app input, #angels-admin-app select, #angels-admin-app textarea").forEach((el) => {
            el.addEventListener("change", refreshAdminPreview);
            el.addEventListener("input", refreshAdminPreview);
        });

        document.getElementById("adm-preview-toggle")?.addEventListener("click", () => {
            document.getElementById("adm-preview-box")?.classList.toggle("is-open");
        });

        document.getElementById("adm-download-html")?.addEventListener("click", () => {
            const html = buildEmailDocument(
                designFromAdminForm(),
                "<p>Vista previa de prueba — texto fijo de transformación establecido.</p>"
            );
            downloadHtml("email-preview-admin.html", html);
        });

        document.getElementById("adm-save-design")?.addEventListener("click", async () => {
            if (!resolved) return;
            try {
                await api.postSender(resolved.sender_exec_url, resolved.secret, {
                    action: "save_design",
                    design: designFromAdminForm()
                });
                showMessage("Diseño guardado.", "success");
                await withLocalPanelLoading(app, () => loadAdminDesign());
            } catch (e) {
                showMessage(e.message || "Error", "error");
            }
        });

        document.getElementById("adm-h-upload")?.addEventListener("click", async () => {
            const file = document.getElementById("adm-h-file")?.files?.[0];
            if (!file || !resolved) {
                showMessage("Selecciona imagen.", "error");
                return;
            }
            const reader = new FileReader();
            reader.onload = async () => {
                const dataUrl = String(reader.result || "");
                const base64 = dataUrl.split(",")[1] || "";
                try {
                    const up = await api.postMaster({
                        action: "upload_header_image",
                        project_id: resolved.project_id,
                        projectSecret: resolved.secret,
                        mime_type: file.type || "image/png",
                        image_base64: base64
                    });
                    const url = (up.data && up.data.public_url) || up.public_url;
                    if (url) {
                        const d = designFromAdminForm();
                        d.header.imageUrl = url;
                        applyDesignToForm(d);
                        refreshAdminPreview();
                        showMessage("Imagen subida.", "success");
                    }
                } catch (e) {
                    showMessage(e.message || "Error al subir", "error");
                }
            };
            reader.readAsDataURL(file);
        });

        document.getElementById("adm-add-angel-row")?.addEventListener("click", () => {
            const tb = document.querySelector("#adm-angeles-table tbody");
            if (!tb) return;
            const tr = document.createElement("tr");
            tr.innerHTML =
                '<td><input class="angels-input" data-f="angel" /></td>' +
                '<td><input class="angels-input" data-f="angelado" /></td>' +
                '<td><input class="angels-input" data-f="email" type="email" /></td>' +
                '<td><button type="button" class="angels-btn angels-btn--sm adm-del-row">✕</button></td>';
            tb.appendChild(tr);
            tr.querySelector(".adm-del-row")?.addEventListener("click", () => tr.remove());
        });

        async function loadAngelesTable() {
            if (!resolved) return;
            const res = await api.postSender(resolved.sender_exec_url, resolved.secret, { action: "get_angeles" });
            const rows = res.data?.angeles || res.angeles || [];
            const tb = document.querySelector("#adm-angeles-table tbody");
            if (!tb) return;
            tb.innerHTML = "";
            rows.forEach((r) => {
                const tr = document.createElement("tr");
                tr.innerHTML = `<td><input class="angels-input" data-f="angel" value="${esc(r.nombre_angel)}" /></td>
          <td><input class="angels-input" data-f="angelado" value="${esc(r.nombre_angelado)}" /></td>
          <td><input class="angels-input" data-f="email" type="email" value="${esc(r.email_angelado)}" /></td>
          <td><button type="button" class="angels-btn angels-btn--sm adm-del-row">✕</button></td>`;
                tr.querySelector(".adm-del-row")?.addEventListener("click", () => tr.remove());
                tb.appendChild(tr);
            });

            try {
                const sch = await api.postSender(resolved.sender_exec_url, resolved.secret, { action: "get_sender_info" });
                const d = sch.data || sch;
                const hint = document.getElementById("adm-sender-hint");
                if (hint) {
                    const tz = String(d.timezone || "");
                    const wk = String(d.computed_week || "");
                    const nowLocal = String(d.now_local || "");
                    const trig = Boolean(d.trigger_installed);
                    const sleep = d.queue_sleep_ms != null ? String(d.queue_sleep_ms) : "—";
                    hint.innerHTML = `Semanas jueves→miércoles (W1 desde fecha de inicio). Envío automático: activador semanal los <strong>miércoles</strong> en Apps Script. Zona: ${tz || "—"} · Semana actual: ${wk || "—"} · Reloj: ${nowLocal || "—"} · Trigger: ${trig ? "instalado" : "no instalado"} · Pausa cola: ${sleep} ms`;
                }
            } catch (e) {
                const hint = document.getElementById("adm-sender-hint");
                if (hint) {
                    hint.textContent =
                        "No se pudo cargar el estado del Emisor. Semanas jueves→miércoles; configura el activador semanal (miércoles) en el proyecto Apps Script.";
                }
            }
        }

        document.querySelectorAll("[data-adtab]").forEach((btn) => {
            btn.addEventListener("click", async () => {
                document.querySelectorAll("[data-adtab]").forEach((b) => b.classList.remove("is-active"));
                btn.classList.add("is-active");
                const id = btn.getAttribute("data-adtab");
                document.querySelectorAll("[data-adpanel]").forEach((p) => {
                    p.classList.toggle("is-active", p.getAttribute("data-adpanel") === id);
                });
                const adPanel = document.querySelector(`[data-adpanel="${id}"]`);
                if (id === "angeles" && resolved) await withLocalPanelLoading(adPanel, () => loadAngelesTable());
                if (id === "maint" && resolved) await withLocalPanelLoading(adPanel, () => loadPendientes());
            });
        });

        document.getElementById("adm-save-angeles")?.addEventListener("click", async () => {
            if (!resolved) return;
            const rows = [];
            document.querySelectorAll("#adm-angeles-table tbody tr").forEach((tr) => {
                const ins = tr.querySelectorAll("[data-f]");
                const obj = {};
                ins.forEach((inp) => {
                    obj[inp.getAttribute("data-f")] = inp.value;
                });
                if (obj.angel || obj.email) rows.push(obj);
            });
            await api.postSender(resolved.sender_exec_url, resolved.secret, {
                action: "save_angeles",
                rows
            });
            showMessage("Tabla guardada.", "success");
        });

        document.getElementById("adm-run-queue-now")?.addEventListener("click", async () => {
            if (!resolved) return;
            const pass = window.prompt("Contraseña admin (ejecución de emergencia):") || "";
            if (!pass.trim()) return;
            await withLocalPanelLoading(document.querySelector('[data-adpanel="maint"]'), async () => {
                const res = await api.postSender(resolved.sender_exec_url, resolved.secret, { action: "admin_run_queue_now", password: pass });
                const d = res.data || res;
                showMessage(`Cola ejecutada. Enviados: ${d.sent || 0}. Errores: ${d.errors || 0}.`, "success", 9000);
                await loadPendientes();
            });
        });

        let allPendRows = [];

        function renderPendientesTable() {
            const tb = document.querySelector("#adm-pend-table tbody");
            if (!tb) return;
            const wFilter = (document.getElementById("adm-filter-week")?.value || "").toLowerCase();
            const aFilter = (document.getElementById("adm-filter-angel")?.value || "").toLowerCase();
            const anFilter = (document.getElementById("adm-filter-angelado")?.value || "").toLowerCase();

            const filtered = allPendRows.filter(r => {
                if (wFilter && String(r.week).toLowerCase() !== wFilter) return false;
                if (aFilter && String(r.angel).toLowerCase().indexOf(aFilter) === -1) return false;
                if (anFilter && String(r.angelado).toLowerCase().indexOf(anFilter) === -1) return false;
                return true;
            });

            tb.innerHTML = filtered
                .map((r) => {
                    const st = String(r.status || "");
                    const btnDel = `<button type="button" class="angels-btn angels-btn--sm angels-btn--danger adm-delete-row" data-row="${r.row_index}">Eliminar</button>`;
                    return `<tr><td>${esc(r.week)}</td><td>${esc(r.angel)}</td><td>${esc(r.angelado)}</td><td>${esc(st)}</td><td><div style="display:flex;gap:8px;">${btnDel}</div></td></tr>`;
                })
                .join("");
        }

        async function loadPendientes() {
            if (!resolved) return;
            const res = await api.postSender(resolved.sender_exec_url, resolved.secret, {
                action: "list_pendientes"
            });
            allPendRows = res.data?.rows || res.rows || [];
            
            const selW = document.getElementById("adm-filter-week");
            if (selW && selW.options.length <= 1) {
                const weeks = [...new Set(allPendRows.map(r => r.week))].sort((a, b) => {
                    const na = parseInt(a.replace("W", "")) || 0;
                    const nb = parseInt(b.replace("W", "")) || 0;
                    return nb - na;
                });
                selW.innerHTML = '<option value="">Todas</option>' + weeks.map(w => `<option value="${w}">${w}</option>`).join("");
            }
            
            renderPendientesTable();
        }

        ["adm-filter-week", "adm-filter-angel", "adm-filter-angelado"].forEach(id => {
            const el = document.getElementById(id);
            if (el) {
                el.addEventListener("input", renderPendientesTable);
                el.addEventListener("change", renderPendientesTable);
            }
        });

        document.getElementById("adm-reload-pend")?.addEventListener("click", () => withLocalPanelLoading(document.querySelector('[data-adpanel="maint"]'), loadPendientes));
        
        document.querySelector("#adm-pend-table")?.addEventListener("click", async (e) => {
            if (!resolved) return;
            
            const btnDel = e.target.closest(".adm-delete-row");
            if (btnDel) {
                if (!window.confirm("¿Seguro que deseas eliminar este mensaje? Esta acción no se puede deshacer.")) return;
                const rowIx = btnDel.getAttribute("data-row");
                await withLocalPanelLoading(document.querySelector('[data-adpanel="maint"]'), async () => {
                    await api.postSender(resolved.sender_exec_url, resolved.secret, { 
                        action: "admin_delete_pending",
                        row_index: rowIx
                    });
                    showMessage("Mensaje eliminado.", "success");
                    await loadPendientes();
                });
            }
        });

        return (async () => {
            try {
                resolved = await resolveProject(api, hash, "a");
                if (isAdminUnlocked(hash)) {
                    gate.hidden = true;
                    app.hidden = false;
                    await loadAdminDesign();
                }
            } catch (e) {
                showMessage(e.message || "No se pudo resolver el enlace", "error");
            }
        })();
    }

    window.initAngelsApp = initAngelsApp;
})();
