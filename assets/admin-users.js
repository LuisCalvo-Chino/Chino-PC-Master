(function () {
    function normalizeBoolean(value) {
        if (typeof value === "boolean") return value;
        if (typeof value === "number") return value === 1;
        const t = String(value ?? "").trim().toLowerCase();
        return t === "true" || t === "1" || t === "yes" || t === "si";
    }

    function formatDateView(value) {
        if (!value) return "";
        const d = new Date(value);
        if (Number.isNaN(d.getTime())) return String(value);
        const dd = String(d.getDate()).padStart(2, "0");
        const mm = String(d.getMonth() + 1).padStart(2, "0");
        const yyyy = String(d.getFullYear());
        const hh = String(d.getHours()).padStart(2, "0");
        const mi = String(d.getMinutes()).padStart(2, "0");
        const ss = String(d.getSeconds()).padStart(2, "0");
        return `${dd}/${mm}/${yyyy} ${hh}:${mi}:${ss}`;
    }

    function getDateFilterKey(value) {
        if (!value) return "";
        const d = new Date(value);
        if (Number.isNaN(d.getTime())) return "";
        const dd = String(d.getDate()).padStart(2, "0");
        const mm = String(d.getMonth() + 1).padStart(2, "0");
        const yyyy = String(d.getFullYear());
        return `${yyyy}-${mm}-${dd}`;
    }

    function defaultEstadoOptions(current) {
        return ["Activa", "Inactiva", "Bloqueada", "Suspendida"];
    }

    function normalizeEstado(value) {
        const t = String(value || "").trim().toLowerCase();
        if (t === "activo" || t === "activa") return "Activa";
        if (t === "inactiva") return "Inactiva";
        if (t === "bloqueada") return "Bloqueada";
        if (t === "suspendida") return "Suspendida";
        return "Activa";
    }

    function createCellInput(type, value, disabled) {
        const input = document.createElement("input");
        input.type = type;
        input.className = "admin-users-input";
        input.value = value || "";
        input.disabled = Boolean(disabled);
        return input;
    }

    window.initAdminUsersApp = function initAdminUsersApp({ showMessage, getSession, callBackend }) {
        const root = document.getElementById("admin");
        if (!root || root.dataset.adminUsersBound === "true") return Promise.resolve();
        root.dataset.adminUsersBound = "true";

        const tbody = document.getElementById("admin-users-tbody");
        const loader = document.getElementById("admin-users-loader");
        const btnReload = document.getElementById("admin-users-btn-reload");
        const filterId = document.getElementById("admin-filter-id");
        const filterUsername = document.getElementById("admin-filter-username");
        const filterEmail = document.getElementById("admin-filter-email");
        const filterFecha = document.getElementById("admin-filter-fecha");

        let users = [];
        const reloadTextDefault = btnReload ? btnReload.textContent : "";

        function setLoading(loading) {
            if (loader) {
                loader.hidden = !loading;
                loader.style.display = loading ? "inline-flex" : "none";
            }
            if (btnReload) {
                btnReload.disabled = loading;
                btnReload.textContent = loading ? "Cargando usuarios..." : reloadTextDefault || "Recargar";
            }
        }

        function getFilters() {
            return {
                id: String(filterId?.value || "").trim().toLowerCase(),
                username: String(filterUsername?.value || "").trim().toLowerCase(),
                email: String(filterEmail?.value || "").trim().toLowerCase(),
                fecha: String(filterFecha?.value || "").trim()
            };
        }

        function applyFilters() {
            const f = getFilters();
            return users.filter((u) => {
                if (f.id && !String(u.id).toLowerCase().includes(f.id)) return false;
                if (f.username && !String(u.username).toLowerCase().includes(f.username)) return false;
                if (f.email && !String(u.email).toLowerCase().includes(f.email)) return false;
                if (f.fecha && String(u.fechaRegistroKey || "") !== f.fecha) return false;
                return true;
            });
        }

        function renderEmpty(text) {
            if (!tbody) return;
            tbody.innerHTML = "";
            const tr = document.createElement("tr");
            const td = document.createElement("td");
            td.colSpan = 10;
            td.className = "admin-users-empty";
            td.textContent = text;
            tr.appendChild(td);
            tbody.appendChild(tr);
        }

        async function saveRow(userId, rowEl) {
            const session = typeof getSession === "function" ? getSession() : null;
            const emailInput = rowEl.querySelector('[data-field="email"]');
            const passwordInput = rowEl.querySelector('[data-field="password"]');
            const esAdminInput = rowEl.querySelector('[data-field="esAdmin"]');
            const permisoRifaInput = rowEl.querySelector('[data-field="permisoRifa"]');
            const permisoCertInput = rowEl.querySelector('[data-field="permisoCert"]');
            const estadoInput = rowEl.querySelector('[data-field="estado"]');
            const saveBtn = rowEl.querySelector(".admin-users-btn-save");

            const email = String(emailInput?.value || "").trim();
            if (!email) {
                showMessage?.("El email no puede quedar vacío.", "error");
                return;
            }

            saveBtn.disabled = true;
            showMessage?.("Guardando cambios...", "info", 0);
            try {
                const result = await callBackend({
                    action: "admin_update_user",
                    session,
                    datos: {
                        id: userId,
                        email,
                        password: String(passwordInput?.value || ""),
                        esAdmin: Boolean(esAdminInput?.checked),
                        permisoRifa: Boolean(permisoRifaInput?.checked),
                        permisoCert: Boolean(permisoCertInput?.checked),
                        estado: String(estadoInput?.value || "Activa")
                    }
                });
                if (passwordInput) passwordInput.value = "";
                const msg = result?.data?.message || result?.message || "Usuario actualizado.";
                showMessage?.(msg, "success", 2800);
            } catch (error) {
                showMessage?.(error.message || "No se pudo guardar el usuario.", "error");
            } finally {
                saveBtn.disabled = false;
            }
        }

        function renderRows() {
            if (!tbody) return;
            const list = applyFilters();
            if (list.length === 0) {
                renderEmpty("No hay usuarios que cumplan los filtros.");
                return;
            }

            tbody.innerHTML = "";
            list.forEach((u) => {
                const tr = document.createElement("tr");

                const idInput = createCellInput("text", String(u.id ?? ""), true);
                idInput.classList.add("admin-users-input--readonly");
                const fechaInput = createCellInput("text", u.fechaRegistroFmt || "", true);
                fechaInput.classList.add("admin-users-input--readonly");
                const usernameInput = createCellInput("text", u.username || "", true);
                usernameInput.classList.add("admin-users-input--readonly");
                const emailInput = createCellInput("email", u.email || "", false);
                emailInput.setAttribute("data-field", "email");
                // Las contraseñas se guardan cifradas: aquí solo se escribe una nueva.
                const passInput = createCellInput("password", "", false);
                passInput.setAttribute("data-field", "password");
                passInput.placeholder = "Sin cambios";
                passInput.autocomplete = "new-password";

                const passWrap = document.createElement("div");
                passWrap.className = "admin-users-pass-wrap";
                const eyeBtn = document.createElement("button");
                eyeBtn.type = "button";
                eyeBtn.className = "admin-users-eye";
                eyeBtn.setAttribute("aria-label", "Mostrar u ocultar contraseña");
                eyeBtn.textContent = "👁";
                eyeBtn.addEventListener("click", () => {
                    passInput.type = passInput.type === "password" ? "text" : "password";
                });
                passWrap.appendChild(passInput);
                passWrap.appendChild(eyeBtn);

                const esAdmin = document.createElement("input");
                esAdmin.type = "checkbox";
                esAdmin.checked = normalizeBoolean(u.esAdmin);
                esAdmin.setAttribute("data-field", "esAdmin");
                esAdmin.className = "admin-users-check";

                const permisoRifa = document.createElement("input");
                permisoRifa.type = "checkbox";
                permisoRifa.checked = normalizeBoolean(u.permisoRifa);
                permisoRifa.setAttribute("data-field", "permisoRifa");
                permisoRifa.className = "admin-users-check";

                const permisoCert = document.createElement("input");
                permisoCert.type = "checkbox";
                permisoCert.checked = normalizeBoolean(u.permisoCert);
                permisoCert.setAttribute("data-field", "permisoCert");
                permisoCert.className = "admin-users-check";

                const estado = document.createElement("select");
                estado.setAttribute("data-field", "estado");
                estado.className = "admin-users-select";
                defaultEstadoOptions(u.estado).forEach((opt) => {
                    const op = document.createElement("option");
                    op.value = opt;
                    op.textContent = opt;
                    if (opt === u.estado) op.selected = true;
                    estado.appendChild(op);
                });

                const saveBtn = document.createElement("button");
                saveBtn.type = "button";
                saveBtn.className = "btn admin-users-btn-save";
                saveBtn.textContent = "Guardar";
                saveBtn.addEventListener("click", () => saveRow(u.id, tr));

                const cells = [
                    idInput,
                    fechaInput,
                    usernameInput,
                    emailInput,
                    passWrap,
                    esAdmin,
                    permisoRifa,
                    permisoCert,
                    estado,
                    saveBtn
                ];
                cells.forEach((item) => {
                    const td = document.createElement("td");
                    td.appendChild(item);
                    tr.appendChild(td);
                });
                tbody.appendChild(tr);
            });
        }

        async function loadUsers() {
            const session = typeof getSession === "function" ? getSession() : null;
            setLoading(true);
            try {
                const result = await callBackend({
                    action: "admin_list_users",
                    session
                });
                const rawList = result?.data?.users || [];
                users = rawList.map((u) => ({
                    id: u.id,
                    fechaRegistroRaw: u.fechaRegistroISO || u.fechaRegistro || "",
                    fechaRegistroFmt: u.fechaRegistroFmt || formatDateView(u.fechaRegistroISO || u.fechaRegistro),
                    fechaRegistroKey: u.fechaRegistroKey || getDateFilterKey(u.fechaRegistroISO || u.fechaRegistro),
                    username: String(u.username || ""),
                    email: String(u.email || ""),
                    esAdmin: normalizeBoolean(u.esAdmin),
                    permisoRifa: normalizeBoolean(u.permisoRifa),
                    permisoCert: normalizeBoolean(u.permisoCert),
                    estado: normalizeEstado(u.estado || "Activa")
                }));
                renderRows();
                showMessage?.(`Usuarios cargados: ${users.length}`, "success", 2200);
            } catch (error) {
                renderEmpty("No fue posible cargar usuarios.");
                showMessage?.(error.message || "Error al cargar usuarios.", "error");
            } finally {
                setLoading(false);
            }
        }

        [filterId, filterUsername, filterEmail, filterFecha].forEach((el) => {
            if (!el) return;
            el.addEventListener("input", renderRows);
        });
        btnReload?.addEventListener("click", loadUsers);

        return loadUsers();
    };
})();
