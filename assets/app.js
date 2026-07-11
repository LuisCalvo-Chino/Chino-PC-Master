document.addEventListener("DOMContentLoaded", () => {
    const BACKEND_WEB_APP_URL =
        "https://script.google.com/macros/s/AKfycbylYwlJaLInQ7dtEdhC40IOTGD8G3GqTL0yN343s5I5MOLSeTTdQAgN44A7ktEUPK3oHw/exec";
    const AUTH_STORAGE_KEY = "cpm_session";
    /** Debe coincidir con window.CPM_ASSET_V en index.html (cache-bust de HTML/JS parciales). */
    const ASSET_V = String(
        (typeof window !== "undefined" && window.CPM_ASSET_V) || "29"
    );
    const PUBLIC_PAGES = new Set([
        "home",
        "soluciones",
        "trayectoria",
        "contacto",
        "webapps",
        "canje",
        "angels"
    ]);
    const PERMISSION_PAGES = {
        rifa: "rifa"
    };

    // Evitar flash del header del sitio en links públicos #r/<hash> y #u/|#a/
    (function applyStandaloneChromeEarly() {
        const raw = String(window.location.hash || "").replace(/^#/, "").trim();
        if (/^r\/.+$/.test(raw)) {
            document.body.classList.add("cpm-rifa-standalone");
        } else if (/^(u|a)\/.+$/i.test(raw)) {
            document.body.classList.add("cpm-angels-standalone", "cpm-angels-route");
        }
    })();

    const homeLink = document.getElementById("home-link");
    const dropdownBtn = document.getElementById("webapps-menu-btn");
    const dropdownMenu = document.getElementById("webapps-dropdown-menu");
    const webappsNavItem = document.getElementById("webapps-nav-item");
    const hamburgerMenu = document.getElementById("hamburger-menu");
    const sidebarHomeLink = document.getElementById("sidebar-home-link");
    const mobileSidebar = document.getElementById("mobile-sidebar");
    const navOverlay = document.getElementById("nav-overlay");
    const mobileSidebarClose = document.getElementById("mobile-sidebar-close");
    const mobileWebappsBlock = document.getElementById("mobile-webapps-block");
    const mainContent = document.getElementById("main-content");
    const mainEl = document.querySelector("main");
    const appLoaderEl = document.getElementById("cpm-app-loader");

    function setAppLoaderBusy(busy) {
        if (appLoaderEl) appLoaderEl.setAttribute("aria-busy", busy ? "true" : "false");
        if (mainEl) mainEl.setAttribute("aria-busy", busy ? "true" : "false");
    }

    function finishAppLoadingTransition() {
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                document.body.classList.remove("cpm-app-loading");
                setAppLoaderBusy(false);
            });
        });
    }

    /**
     * Overlay mientras hay peticiones al backend desde pestañas u hub (p. ej. Ángeles),
     * sin mezclar con el ciclo de navegación SPA (loadPage).
     */
    let cpmTabDataLoadingDepth = 0;

    function cpmEnterTabDataLoading() {
        cpmTabDataLoadingDepth += 1;
        if (cpmTabDataLoadingDepth === 1) {
            document.body.classList.add("cpm-app-loading");
            setAppLoaderBusy(true);
        }
    }

    function cpmLeaveTabDataLoading() {
        cpmTabDataLoadingDepth = Math.max(0, cpmTabDataLoadingDepth - 1);
        if (cpmTabDataLoadingDepth === 0) {
            finishAppLoadingTransition();
        }
    }

    window.cpmWithTabBackendLoading = async function cpmWithTabBackendLoading(run) {
        cpmEnterTabDataLoading();
        try {
            return await run();
        } finally {
            cpmLeaveTabDataLoading();
        }
    };

    /** Evita quitar el overlay si otra navegación empezó antes de terminar la anterior. */
    let cpmNavigationGeneration = 0;
    const authMessage = document.getElementById("auth-message");
    const authModal = document.getElementById("auth-modal");
    const authBackdrop = document.getElementById("auth-backdrop");
    const authModalClose = document.getElementById("auth-modal-close");
    const loginTab = document.getElementById("tab-login");
    const registerTab = document.getElementById("tab-register");
    const authTabs = document.querySelector(".auth-modal-tabs");
    const loginForm = document.getElementById("login-form");
    const registerForm = document.getElementById("register-form");
    const btnLoginOpen = document.getElementById("btn-login-open");
    const btnRegisterOpen = document.getElementById("btn-register-open");
    const btnLogout = document.getElementById("btn-logout");
    const authGreeting = document.getElementById("auth-greeting");
    const menuRifa = dropdownMenu.querySelector('[data-page="rifa"]');
    const menuCertificados = dropdownMenu.querySelector('[data-page="certificados"]');
    const menuAdmin = dropdownMenu.querySelector('[data-page="admin"]');
    const mobileMenuRifa = mobileSidebar?.querySelector('[data-page="rifa"]');
    const mobileMenuCertificados = mobileSidebar?.querySelector('[data-page="certificados"]');
    const mobileMenuAdmin = mobileSidebar?.querySelector('[data-page="admin"]');
    let currentPage = "home";

    let messageTimerId = null;
    function showMessage(text, kind = "info", durationMs = 4200) {
        if (!authMessage) return;
        authMessage.textContent = text;
        authMessage.className = `auth-message show ${kind}`;
        if (messageTimerId) {
            window.clearTimeout(messageTimerId);
            messageTimerId = null;
        }
        if (durationMs > 0) {
            messageTimerId = window.setTimeout(() => {
                authMessage.classList.remove("show");
                messageTimerId = null;
            }, durationMs);
        }
    }

    function normalizeBoolean(value) {
        if (typeof value === "boolean") return value;
        if (typeof value === "string") {
            const v = value.trim().toLowerCase();
            return v === "true" || v === "1" || v === "yes";
        }
        if (typeof value === "number") return value === 1;
        return false;
    }

    function normalizeSession(rawData) {
        const source = rawData?.usuario || rawData?.user || rawData?.data || rawData || {};
        const permisosRaw = source.permisos || rawData?.permisos || {};
        const permisos = {
            rifa: normalizeBoolean(permisosRaw.rifa),
            certificados: normalizeBoolean(permisosRaw.certificados)
        };
        const role = String(source.role || rawData?.role || "").trim().toLowerCase();

        return {
            username: String(source.username || source.userName || source.usuario || "").trim(),
            email: String(source.email || source.correo || "").trim(),
            permisos,
            role,
            isAdmin: normalizeBoolean(source.isAdmin ?? rawData?.isAdmin)
        };
    }

    function isAdminSession(session) {
        if (!session) return false;
        if (session.isAdmin) return true;
        return session.role === "admin";
    }

    function getSession() {
        const raw = sessionStorage.getItem(AUTH_STORAGE_KEY);
        if (!raw) return null;
        try {
            const parsed = JSON.parse(raw);
            return normalizeSession(parsed);
        } catch (error) {
            console.error("Sesion invalida en sessionStorage:", error);
            sessionStorage.removeItem(AUTH_STORAGE_KEY);
            return null;
        }
    }

    function setSession(sessionData) {
        const safe = normalizeSession(sessionData);
        sessionStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(safe));
        return safe;
    }

    function clearSession() {
        sessionStorage.removeItem(AUTH_STORAGE_KEY);
    }

    function isPublicRifaAdminAccess(routeCtx) {
        // Hub (#rifa) siempre requiere permiso; no usar el hash de la URL como atajo
        if (routeCtx?.rifa?.mode === "hub") return false;
        if (routeCtx?.rifa?.mode === "admin") {
            return Boolean(String(routeCtx.rifa.hash || "").trim()) || /^r\/.+$/.test(
                String(window.location.hash || "").replace(/^#/, "").trim()
            );
        }
        // Sin ctx (carga inicial): solo público si la URL es #r/<hash>
        const raw = String(window.location.hash || "").replace(/^#/, "").trim();
        return /^r\/.+$/.test(raw);
    }

    function canAccessPage(page, session, routeCtx) {
        if (PUBLIC_PAGES.has(page)) return true;
        // Link administrador de rifa (#r/<hash>): público, sin login ni contraseña
        if (page === "rifa" && isPublicRifaAdminAccess(routeCtx)) {
            return true;
        }
        if (page === "angels-dashboard") {
            return Boolean(session && isAdminSession(session));
        }
        if (page === "admin" || page === "certificados") {
            return Boolean(session && isAdminSession(session));
        }
        const requiredPermission = PERMISSION_PAGES[page];
        if (!requiredPermission) return true;
        return Boolean(session && session.permisos && session.permisos[requiredPermission] === true);
    }

    function applyProtectedLinksState() {
        const session = getSession();
        const protectedLinks = document.querySelectorAll(".protected-link");
        protectedLinks.forEach((link) => {
            const permission = link.getAttribute("data-requires-permission");
            const requiresAdmin = link.getAttribute("data-requires-admin") === "true";
            let enabled = true;
            if (requiresAdmin) {
                enabled = isAdminSession(session);
            } else if (permission) {
                enabled = Boolean(session && session.permisos?.[permission]);
            }
            link.classList.toggle("protected-disabled", !enabled);
            link.setAttribute("aria-disabled", String(!enabled));
            if (!enabled) {
                link.title = requiresAdmin
                    ? "Solo administradores pueden acceder"
                    : "Necesitas iniciar sesion con permisos para acceder";
            } else {
                link.removeAttribute("title");
            }
        });
    }

    function updateNavigationBySession() {
        const session = getSession();
        const canRifa = Boolean(session && session.permisos?.rifa);
        const canAdmin = isAdminSession(session);
        const hasAnyWebAppAccess = canRifa || canAdmin;

        if (webappsNavItem) {
            webappsNavItem.hidden = !hasAnyWebAppAccess;
        }
        menuRifa.hidden = !canRifa;
        menuCertificados.hidden = !canAdmin;
        menuAdmin.hidden = !canAdmin;
        const menuAngelsDash = dropdownMenu?.querySelector('[data-page="angels-dashboard"]');
        if (menuAngelsDash) menuAngelsDash.hidden = !canAdmin;
        dropdownBtn.disabled = false;
        dropdownBtn.setAttribute("aria-disabled", "false");
        dropdownBtn.classList.remove("is-disabled");
        if (!hasAnyWebAppAccess) {
            dropdownMenu.classList.remove("show");
            dropdownBtn.setAttribute("aria-expanded", "false");
        }

        if (mobileWebappsBlock) {
            mobileWebappsBlock.hidden = !hasAnyWebAppAccess;
        }
        if (mobileMenuRifa) mobileMenuRifa.hidden = !canRifa;
        if (mobileMenuCertificados) mobileMenuCertificados.hidden = !canAdmin;
        if (mobileMenuAdmin) mobileMenuAdmin.hidden = !canAdmin;
        const mobileMenuAngels = mobileSidebar?.querySelector('[data-page="angels-dashboard"]');
        if (mobileMenuAngels) mobileMenuAngels.hidden = !canAdmin;

        btnLoginOpen.hidden = Boolean(session);
        btnRegisterOpen.hidden = Boolean(session);
        btnLogout.hidden = !session;

        if (session) {
            const usernameOrEmail = session.username || session.email || "Usuario";
            authGreeting.hidden = false;
            authGreeting.textContent = usernameOrEmail;
            authGreeting.title = usernameOrEmail;
        } else {
            authGreeting.hidden = true;
            authGreeting.textContent = "";
            authGreeting.removeAttribute("title");
        }

        applyProtectedLinksState();
    }

    function switchAuthTab(tabName) {
        const isLogin = tabName === "login";
        loginTab.classList.toggle("active", isLogin);
        registerTab.classList.toggle("active", !isLogin);
        loginTab.setAttribute("aria-selected", String(isLogin));
        registerTab.setAttribute("aria-selected", String(!isLogin));
        loginForm.hidden = !isLogin;
        registerForm.hidden = isLogin;
        document.getElementById("auth-modal-title").textContent = isLogin
            ? "Iniciar Sesion"
            : "Crear Cuenta";
    }

    function openAuthModal(tab = "login") {
        closeMobileNav();
        authModal.hidden = false;
        switchAuthTab(tab);
        if (authTabs) authTabs.hidden = true;
    }

    function closeAuthModal() {
        authModal.hidden = true;
    }

    function closeMobileNav() {
        document.body.classList.remove("nav-active");
        if (hamburgerMenu) {
            hamburgerMenu.setAttribute("aria-expanded", "false");
        }
        if (mobileSidebar) {
            mobileSidebar.setAttribute("aria-hidden", "true");
        }
        if (navOverlay) {
            navOverlay.setAttribute("aria-hidden", "true");
        }
    }

    function openMobileNav() {
        document.body.classList.add("nav-active");
        if (hamburgerMenu) {
            hamburgerMenu.setAttribute("aria-expanded", "true");
        }
        if (mobileSidebar) {
            mobileSidebar.setAttribute("aria-hidden", "false");
        }
        if (navOverlay) {
            navOverlay.setAttribute("aria-hidden", "false");
        }
    }

    function toggleMobileNav() {
        if (document.body.classList.contains("nav-active")) {
            closeMobileNav();
        } else {
            openMobileNav();
        }
    }

    function isEmailValid(email) {
        return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
    }

    async function callBackend(payload) {
        const controller = new AbortController();
        const timeoutId = window.setTimeout(() => controller.abort(), 20000);
        const rawPayload = JSON.stringify(payload);

        async function parseResponse(response) {
            const rawText = await response.text();
            let result;
            try {
                result = JSON.parse(rawText);
            } catch (error) {
                throw new Error("Respuesta no JSON desde Apps Script.");
            }

            if (!response.ok) {
                throw new Error(result?.message || `Error HTTP ${response.status}`);
            }
            if (result?.status !== "SUCCESS") {
                throw new Error(result?.message || "Operacion no completada.");
            }
            return result;
        }

        try {
            // Intento 1: JSON explícito.
            const response = await fetch(BACKEND_WEB_APP_URL, {
                method: "POST",
                mode: "cors",
                redirect: "follow",
                headers: {
                    "Content-Type": "application/json"
                },
                body: rawPayload,
                signal: controller.signal
            });
            return await parseResponse(response);
        } catch (error) {
            if (error?.name === "AbortError") {
                throw new Error("Tiempo de espera agotado con el backend.");
            }
            if (error instanceof TypeError) {
                try {
                    // Fallback para Apps Script: solicitud simple (text/plain) evita preflight CORS.
                    const fallbackResponse = await fetch(BACKEND_WEB_APP_URL, {
                        method: "POST",
                        mode: "cors",
                        redirect: "follow",
                        headers: {
                            "Content-Type": "text/plain;charset=utf-8"
                        },
                        body: rawPayload,
                        signal: controller.signal
                    });
                    return await parseResponse(fallbackResponse);
                } catch (fallbackError) {
                    if (fallbackError?.name === "AbortError") {
                        throw new Error("Tiempo de espera agotado con el backend.");
                    }
                    if (fallbackError instanceof TypeError) {
                        throw new Error("Fallo de red: no se pudo conectar al servidor.");
                    }
                    throw fallbackError;
                }
            }
            throw error;
        } finally {
            window.clearTimeout(timeoutId);
        }
    }

    async function submitRegistro(formData) {
        const username = String(formData.get("username") || "").trim();
        const email = String(formData.get("email") || "").trim();
        const emailConfirm = String(formData.get("emailConfirm") || "").trim();
        const password = String(formData.get("password") || "");
        const passwordConfirm = String(formData.get("passwordConfirm") || "");

        if (!username || !email || !emailConfirm || !password || !passwordConfirm) {
            throw new Error("Todos los campos de registro son obligatorios.");
        }
        if (!isEmailValid(email)) {
            throw new Error("Formato de email invalido.");
        }
        if (email.toLowerCase() !== emailConfirm.toLowerCase()) {
            throw new Error("Los correos no coinciden.");
        }
        if (password !== passwordConfirm) {
            throw new Error("Las contrasenas no coinciden.");
        }

        return callBackend({
            action: "registro",
            datos: {
                user: username,
                email,
                pass: password
            }
        });
    }

    async function submitLogin(formData) {
        const identificador = String(formData.get("identificador") || "").trim();
        const password = String(formData.get("password") || "");
        if (!identificador || !password) {
            throw new Error("Debes ingresar identificador y contrasena.");
        }
        return callBackend({
            action: "login",
            user: identificador,
            pass: password
        });
    }

    async function submitContacto(formData) {
        const nombre = String(formData.get("nombre") || "").trim();
        const email = String(formData.get("email") || "").trim();
        const asunto = String(formData.get("asunto") || "").trim();
        const mensaje = String(formData.get("mensaje") || "").trim();

        if (!nombre || !email || !asunto || !mensaje) {
            throw new Error("Completa todos los campos del formulario de contacto.");
        }
        if (!isEmailValid(email)) {
            throw new Error("Ingresa un email valido para contacto.");
        }

        return callBackend({
            action: "contacto",
            datos: {
                nombre,
                email,
                asunto,
                mensaje
            }
        });
    }

    function setupRealtimeRegisterValidation() {
        const registerEmail = document.getElementById("register-email");
        const registerEmailConfirm = document.getElementById("register-email-confirm");
        const registerPassword = document.getElementById("register-password");
        const registerPasswordConfirm = document.getElementById("register-password-confirm");

        if (!registerEmail || !registerEmailConfirm || !registerPassword || !registerPasswordConfirm) {
            return;
        }

        const validate = () => {
            const email = registerEmail.value.trim();
            const emailConfirm = registerEmailConfirm.value.trim();
            const password = registerPassword.value;
            const passwordConfirm = registerPasswordConfirm.value;

            if (emailConfirm && email.toLowerCase() !== emailConfirm.toLowerCase()) {
                registerEmailConfirm.setCustomValidity("Los correos no coinciden.");
            } else {
                registerEmailConfirm.setCustomValidity("");
            }

            if (passwordConfirm && password !== passwordConfirm) {
                registerPasswordConfirm.setCustomValidity("Las contrasenas no coinciden.");
            } else {
                registerPasswordConfirm.setCustomValidity("");
            }
        };

        [registerEmail, registerEmailConfirm, registerPassword, registerPasswordConfirm].forEach((input) => {
            input.addEventListener("input", validate);
        });
    }

    function checkAccess(page, routeCtx) {
        const pageName = resolvePage(page);
        const session = getSession();
        if (canAccessPage(pageName, session, routeCtx || null)) return true;
        routeDenied(pageName);
        return false;
    }

    function protectRoutes(page, routeCtx) {
        return checkAccess(page, routeCtx);
    }

    function routeDenied(page) {
        const session = getSession();
        if (!session) {
            showMessage("Debes iniciar sesion para acceder a esta seccion.", "error");
            openAuthModal("login");
        } else {
            showMessage("Tu usuario no tiene permisos para esta seccion.", "error");
        }
        navigateTo("home", { replaceHistory: true, skipGuard: true });
        return false;
    }

    function resolvePage(rawPage) {
        const clean = String(rawPage || "").replace(/^#/, "").trim().toLowerCase();
        return clean || "home";
    }

    /**
     * Rutas Ángeles: #u/<hash20> y #a/<hash20> (hash case-sensitive).
     * Super admin: #angels-dashboard
     * Rifa: #rifa (hub) y #r/<hash> (admin público)
     */
    function parseRouteFromHash(rawHash) {
        const raw = String(rawHash || "").replace(/^#/, "").trim();
        const userMatch = raw.match(/^u\/(.+)$/i);
        if (userMatch) {
            return { page: "angels", angels: { mode: "u", hash: userMatch[1] }, rifa: null };
        }
        const adminMatch = raw.match(/^a\/(.+)$/i);
        if (adminMatch) {
            return { page: "angels", angels: { mode: "a", hash: adminMatch[1] }, rifa: null };
        }
        const rifaAdminMatch = raw.match(/^r\/(.+)$/);
        if (rifaAdminMatch) {
            let hash = rifaAdminMatch[1];
            try {
                hash = decodeURIComponent(hash);
            } catch (e) {
                /* keep raw */
            }
            return {
                page: "rifa",
                angels: null,
                rifa: { mode: "admin", hash }
            };
        }
        const clean = raw.toLowerCase();
        if (clean === "angels-dashboard") {
            return { page: "angels-dashboard", angels: null, rifa: null };
        }
        if (clean === "rifa") {
            return { page: "rifa", angels: null, rifa: { mode: "hub" } };
        }
        return { page: clean || "home", angels: null, rifa: null };
    }

    function htmlFileForPage(page) {
        if (page === "angels" || page === "angels-dashboard") return "angels";
        return page;
    }

    function hashStringForRoute(page, angels, rifa) {
        if (page === "angels-dashboard") return "#angels-dashboard";
        if (page === "angels" && angels?.mode && angels?.hash) {
            const prefix = angels.mode === "a" ? "a" : "u";
            return `#${prefix}/${angels.hash}`;
        }
        if (page === "rifa" && rifa?.mode === "admin" && rifa?.hash) {
            return `#r/${rifa.hash}`;
        }
        if (page === "home") return "#";
        return `#${page}`;
    }

    function scrollToTarget(targetId) {
        if (!targetId) {
            window.scrollTo(0, 0);
            return;
        }
        const el = document.getElementById(String(targetId));
        if (!el) {
            window.scrollTo(0, 0);
            return;
        }
        window.requestAnimationFrame(() => {
            el.scrollIntoView({ behavior: "smooth", block: "start" });
        });
    }

    async function loadPage(page, options = {}) {
        const pageName = resolvePage(page);
        const session = getSession();
        const routeCtx = { rifa: options.rifa || null, angels: options.angels || null };
        if (!options.skipGuard && !canAccessPage(pageName, session, routeCtx)) {
            finishAppLoadingTransition();
            return routeDenied(pageName);
        }

        const navGen = ++cpmNavigationGeneration;
        cpmTabDataLoadingDepth = 0;
        document.body.classList.add("cpm-app-loading");
        setAppLoaderBusy(true);
        let pageReady = null;
        try {
            const htmlName = htmlFileForPage(pageName);
            const response = await fetch(`${htmlName}.html?v=${encodeURIComponent(ASSET_V)}`, {
                cache: "no-store"
            });
            if (!response.ok) throw new Error("Pagina no encontrada");
            const content = await response.text();
            mainContent.innerHTML = content;
            currentPage = pageName;
            
            if (pageName === "rifa") {
                const rifaCtx = options.rifa || { mode: "hub" };
                if (rifaCtx.mode === "admin") {
                    document.body.classList.add("cpm-rifa-standalone");
                } else {
                    document.body.classList.remove("cpm-rifa-standalone");
                }
                await handleRifaAnimation(rifaCtx);
            } else if (pageName === "certificados") {
                await loadCertificadosScript();
                if (typeof window.initCertificadosAdminApp === "function") {
                    pageReady = window.initCertificadosAdminApp({ showMessage, getSession });
                }
                const mainLogo = document.querySelector(".main-logo");
                if (mainLogo) mainLogo.classList.remove("logo-animate-up");
            } else if (pageName === "admin") {
                await loadAdminUsersScript();
                if (typeof window.initAdminUsersApp === "function") {
                    pageReady = window.initAdminUsersApp({ showMessage, getSession, callBackend });
                }
                const mainLogo = document.querySelector(".main-logo");
                if (mainLogo) mainLogo.classList.remove("logo-animate-up");
            } else if (pageName === "canje") {
                await loadCertificadosScript();
                if (typeof window.initCanjePublicoApp === "function") {
                    pageReady = window.initCanjePublicoApp({ showMessage });
                }
                const mainLogo = document.querySelector(".main-logo");
                if (mainLogo) mainLogo.classList.remove("logo-animate-up");
            } else if (pageName === "angels" || pageName === "angels-dashboard") {
                document.body.classList.add("cpm-angels-route");
                const ang = options.angels;
                if (pageName === "angels" && ang && (ang.mode === "u" || ang.mode === "a")) {
                    document.body.classList.add("cpm-angels-standalone");
                } else {
                    document.body.classList.remove("cpm-angels-standalone");
                }
                await loadAngelsScript();
                if (typeof window.initAngelsApp === "function") {
                    pageReady = window.initAngelsApp({
                        showMessage,
                        getSession,
                        isAdminSession,
                        page: pageName,
                        angels: options.angels || null,
                        navigateHome: () => navigateTo("home", { replaceHistory: true })
                    });
                }
            } else {
                const mainLogo = document.querySelector(".main-logo");
                if (mainLogo) mainLogo.classList.remove("logo-animate-up");
            }

            if (pageReady != null && typeof pageReady.then === "function") {
                await pageReady;
            }

            if (pageName !== "angels" && pageName !== "angels-dashboard") {
                document.body.classList.remove("cpm-angels-route", "cpm-angels-standalone");
            }
            if (pageName !== "rifa") {
                document.body.classList.remove("cpm-rifa-standalone");
            }

            setupContactFormOnCurrentPage();
            applyProtectedLinksState();
            scrollToTarget(options.scrollTarget);
            return true;
        } catch (error) {
            mainContent.innerHTML = "<p>Error al cargar la pagina.</p>";
            console.error(error);
            return false;
        } finally {
            if (navGen === cpmNavigationGeneration) {
                finishAppLoadingTransition();
            }
        }
    }

    async function navigateTo(page, options = {}) {
        const pageName = resolvePage(page);
        const angels = options.angels != null ? options.angels : null;
        const rifa =
            options.rifa != null
                ? options.rifa
                : pageName === "rifa"
                  ? { mode: "hub" }
                  : null;
        if (!options.skipGuard && !protectRoutes(pageName, { rifa, angels })) {
            finishAppLoadingTransition();
            return;
        }
        const ok = await loadPage(pageName, { ...options, angels, rifa });
        if (!ok) return;
        const state = { page: pageName, angels, rifa };
        const url = hashStringForRoute(pageName, angels, rifa);
        if (options.replaceHistory) {
            window.history.replaceState(state, "", url);
        } else if (!options.fromPopState) {
            window.history.pushState(state, "", url);
        }
    }

    function extractPageFromLink(link) {
        if (!link) return null;
        const explicit = link.getAttribute("data-page");
        const href = link.getAttribute("href");
        if (href && href !== "#" && !href.startsWith("http") && href.startsWith("#")) {
            const route = parseRouteFromHash(href.slice(1));
            if (route.page === "angels" || route.page === "angels-dashboard") {
                return {
                    page: route.page,
                    scrollTarget: String(link.getAttribute("data-scroll-target") || "").trim() || "",
                    angels: route.angels,
                    rifa: null
                };
            }
            if (route.page === "rifa" && route.rifa) {
                return {
                    page: "rifa",
                    scrollTarget: String(link.getAttribute("data-scroll-target") || "").trim() || "",
                    angels: null,
                    rifa: route.rifa
                };
            }
        }
        let page = null;
        if (explicit) page = resolvePage(explicit);
        else if (href && href !== "#" && !href.startsWith("http") && href.startsWith("#")) {
            page = parseRouteFromHash(href.slice(1)).page;
        }
        if (!page) return null;
        return {
            page,
            scrollTarget: String(link.getAttribute("data-scroll-target") || "").trim() || "",
            angels: null,
            rifa: page === "rifa" ? { mode: "hub" } : null
        };
    }

    function setupContactFormOnCurrentPage() {
        const contactForm = document.getElementById("contact-form");
        if (!contactForm || contactForm.dataset.bound === "true") return;

        contactForm.dataset.bound = "true";
        contactForm.addEventListener("submit", async (event) => {
            event.preventDefault();
            const submitBtn = contactForm.querySelector("button[type='submit']");
            submitBtn.disabled = true;
            submitBtn.textContent = "Enviando...";
            showMessage("Cargando...", "info", 0);
            try {
                const fd = new FormData(contactForm);
                await submitContacto(fd);
                contactForm.reset();
                showMessage("Mensaje enviado correctamente. Gracias por contactarnos.", "success");
            } catch (error) {
                showMessage(error.message || "No se pudo enviar el mensaje.", "error");
            } finally {
                submitBtn.disabled = false;
                submitBtn.textContent = "Enviar Mensaje";
            }
        });
    }

    // Rifa: la entrada visual la controla rifa.js (splash + transición 1.5s al terminar la carga).
    async function handleRifaAnimation(rifaCtx) {
        await loadRifaScript(rifaCtx || { mode: "hub" });
    }

    function liberarRifaSplashConError(textoPlano) {
        const app = document.querySelector("#rifa-app");
        if (app) {
            app.classList.remove("rifa-booting");
            app.classList.add("rifa-ready", "rifa-init-error");
        }
        const splash = document.getElementById("rifa-splash");
        if (splash) {
            splash.setAttribute("aria-busy", "false");
            splash.replaceChildren();
            const p = document.createElement("p");
            p.className = "rifa-splash-error-text";
            p.textContent = textoPlano;
            splash.appendChild(p);
        }
    }

    function loadCertificadosScript() {
        return new Promise((resolve) => {
            if (typeof window.initCertificadosAdminApp === "function") {
                resolve();
                return;
            }
            let el = document.getElementById("certificados-script");
            if (!el) {
                el = document.createElement("script");
                el.id = "certificados-script";
                el.src = "assets/certificados.js?v=10";
                el.onerror = () => {
                    console.error("Error cargando certificados.js");
                    resolve();
                };
                document.body.appendChild(el);
            }
            let ticks = 0;
            const timer = window.setInterval(() => {
                if (typeof window.initCertificadosAdminApp === "function" || ticks++ > 120) {
                    window.clearInterval(timer);
                    resolve();
                }
            }, 50);
        });
    }

    function loadAngelsScript() {
        return new Promise((resolve) => {
            if (typeof window.initAngelsApp === "function") {
                resolve();
                return;
            }
            function appendScript(id, src, onload) {
                const existing = document.getElementById(id);
                if (existing) {
                    if (typeof onload === "function") onload();
                    return;
                }
                const s = document.createElement("script");
                s.id = id;
                s.src = src;
                s.onload = () => {
                    if (typeof onload === "function") onload();
                };
                s.onerror = () => {
                    console.error("Error cargando", src);
                    resolve();
                };
                document.body.appendChild(s);
            }
            appendScript("angels-api-script", "assets/angels-api.js?v=2", () => {
                appendScript("angels-app-script", "assets/angels-app.js?v=37", resolve);
            });
            let ticks = 0;
            const timer = window.setInterval(() => {
                if (typeof window.initAngelsApp === "function" || ticks++ > 200) {
                    window.clearInterval(timer);
                    resolve();
                }
            }, 50);
        });
    }

    function loadAdminUsersScript() {
        return new Promise((resolve) => {
            if (typeof window.initAdminUsersApp === "function") {
                resolve();
                return;
            }
            let el = document.getElementById("admin-users-script");
            if (!el) {
                el = document.createElement("script");
                el.id = "admin-users-script";
                el.src = "assets/admin-users.js?v=4";
                el.onerror = () => {
                    console.error("Error cargando admin-users.js");
                    resolve();
                };
                document.body.appendChild(el);
            }
            let ticks = 0;
            const timer = window.setInterval(() => {
                if (typeof window.initAdminUsersApp === "function" || ticks++ > 120) {
                    window.clearInterval(timer);
                    resolve();
                }
            }, 50);
        });
    }

    // Cargar API + app de rifa dinámicamente
    function loadRifaScript(rifaCtx) {
        const ctx = rifaCtx || { mode: "hub" };
        const RIFA_API_SRC = `assets/rifa-api.js?v=${ASSET_V}`;
        const RIFA_APP_SRC = `assets/rifa.js?v=${ASSET_V}`;
        return new Promise((resolve) => {
            function runInit() {
                (async () => {
                    if (typeof window.initRifaApp === "function") {
                        try {
                            await window.initRifaApp({
                                showMessage,
                                getSession,
                                rifa: ctx,
                                navigateHome: () => navigateTo("home", { replaceHistory: true })
                            });
                        } catch (e) {
                            console.error(e);
                            liberarRifaSplashConError(
                                e?.message || "Error al inicializar la rifa. Revisa la consola (F12)."
                            );
                        }
                    } else {
                        console.error("initRifaApp no esta definida en rifa.js");
                        liberarRifaSplashConError(
                            "No se pudo inicializar la rifa (initRifaApp). Revisa la consola (F12)."
                        );
                    }
                    resolve();
                })();
            }

            function appendScript(id, src, onload) {
                const existing = document.getElementById(id);
                if (existing) {
                    if (existing.getAttribute("src") === src) {
                        if (typeof onload === "function") onload();
                        return;
                    }
                    existing.remove();
                }
                const s = document.createElement("script");
                s.id = id;
                s.src = src;
                s.onload = () => {
                    if (typeof onload === "function") onload();
                };
                s.onerror = () => {
                    console.error("Error cargando", src);
                    liberarRifaSplashConError(
                        "No se pudo cargar " + src + ". Revisa la ruta del sitio y la consola (F12)."
                    );
                    resolve();
                };
                document.body.appendChild(s);
            }

            function scriptSrcOk(id, src) {
                const el = document.getElementById(id);
                return Boolean(el && el.getAttribute("src") === src);
            }

            const scriptsFresh =
                scriptSrcOk("rifa-api-script", RIFA_API_SRC) &&
                scriptSrcOk("rifa-script", RIFA_APP_SRC) &&
                typeof window.initRifaApp === "function" &&
                Boolean(window.CPMRifaApi);

            if (scriptsFresh) {
                runInit();
                return;
            }

            // Forzar recarga si la versión ?v= cambió (evita HTML/JS viejo en Pages)
            ["rifa-api-script", "rifa-script"].forEach((id) => {
                const el = document.getElementById(id);
                if (el) el.remove();
            });
            window.initRifaApp = undefined;

            appendScript("rifa-api-script", RIFA_API_SRC, () => {
                appendScript("rifa-script", RIFA_APP_SRC, runInit);
            });
        });
    }

    dropdownBtn.addEventListener("click", (event) => {
        event.preventDefault();
        if (webappsNavItem && webappsNavItem.hidden) {
            showMessage("Inicia sesion para habilitar WebApps.", "error");
            openAuthModal("login");
                return;
            }
        dropdownMenu.classList.toggle("show");
        dropdownBtn.setAttribute("aria-expanded", String(dropdownMenu.classList.contains("show")));
    });

    document.addEventListener("click", (event) => {
        if (!event.target.closest(".dropdown")) {
            dropdownMenu.classList.remove("show");
            dropdownBtn.setAttribute("aria-expanded", "false");
        }
    });

    if (hamburgerMenu) {
        hamburgerMenu.addEventListener("click", () => toggleMobileNav());
    }
    if (sidebarHomeLink) {
        sidebarHomeLink.addEventListener("click", (event) => {
            event.preventDefault();
            closeMobileNav();
            navigateTo("home");
        });
    }
    if (mobileSidebarClose) {
        mobileSidebarClose.addEventListener("click", () => closeMobileNav());
    }
    if (navOverlay) {
        navOverlay.addEventListener("click", () => closeMobileNav());
    }
    window.addEventListener("keydown", (event) => {
        if (event.key === "Escape" && document.body.classList.contains("nav-active")) {
            closeMobileNav();
            hamburgerMenu?.focus();
        }
    });

    window.matchMedia("(min-width: 769px)").addEventListener("change", (event) => {
        if (event.matches) closeMobileNav();
    });

    homeLink.addEventListener("click", (event) => {
        event.preventDefault();
        closeMobileNav();
        navigateTo("home");
    });

    document.addEventListener("click", (event) => {
        const link = event.target.closest("a");
        if (!link) return;
        // No interceptar enlaces que deben abrirse en otra pestaña (p. ej. admin Rifa)
        if (link.target === "_blank" || link.getAttribute("data-external") === "1") return;
        const navTarget = extractPageFromLink(link);
        if (!navTarget) return;
        event.preventDefault();
        dropdownMenu.classList.remove("show");
        dropdownBtn.setAttribute("aria-expanded", "false");
        if (link.closest("#mobile-sidebar")) {
            closeMobileNav();
        }
        navigateTo(navTarget.page, {
            scrollTarget: navTarget.scrollTarget,
            angels: navTarget.angels || null,
            rifa: navTarget.rifa || null
        });
    });

    btnLoginOpen.addEventListener("click", () => openAuthModal("login"));
    btnRegisterOpen.addEventListener("click", () => openAuthModal("register"));
    btnLogout.addEventListener("click", () => {
        clearSession();
        updateNavigationBySession();
        showMessage("Sesion cerrada correctamente.", "success");
        const isPublicRifaAdmin =
            currentPage === "rifa" &&
            String(window.location.hash || "").match(/^#r\//);
        if (!PUBLIC_PAGES.has(currentPage) && !isPublicRifaAdmin) {
            navigateTo("home");
        } else {
            applyProtectedLinksState();
        }
    });

    loginTab.addEventListener("click", () => switchAuthTab("login"));
    registerTab.addEventListener("click", () => switchAuthTab("register"));
    authModalClose.addEventListener("click", closeAuthModal);
    authBackdrop.addEventListener("click", closeAuthModal);

    loginForm.addEventListener("submit", async (event) => {
        event.preventDefault();
        const submitBtn = loginForm.querySelector("button[type='submit']");
        submitBtn.disabled = true;
        submitBtn.textContent = "Validando...";
        showMessage("Cargando...", "info", 0);
        try {
            const result = await submitLogin(new FormData(loginForm));
            const session = setSession(result?.data || result);
            updateNavigationBySession();
            closeAuthModal();
            loginForm.reset();
            showMessage(`Bienvenido, ${session.username || session.email || "Usuario"}.`, "success");
        } catch (error) {
            showMessage(error.message || "No se pudo iniciar sesion.", "error");
        } finally {
            submitBtn.disabled = false;
            submitBtn.textContent = "Iniciar Sesion";
        }
    });

    registerForm.addEventListener("submit", async (event) => {
        event.preventDefault();
        const submitBtn = registerForm.querySelector("button[type='submit']");
        submitBtn.disabled = true;
        submitBtn.textContent = "Registrando...";
        showMessage("Cargando...", "info", 0);
        try {
            await submitRegistro(new FormData(registerForm));
            registerForm.reset();
            switchAuthTab("login");
            showMessage("Registro exitoso. Ahora puedes iniciar sesion.", "success");
        } catch (error) {
            showMessage(error.message || "No se pudo completar el registro.", "error");
        } finally {
            submitBtn.disabled = false;
            submitBtn.textContent = "Crear Cuenta";
        }
    });

    window.addEventListener("popstate", (event) => {
        const st = event.state;
        const raw = window.location.hash.slice(1) || "";
        const route =
            st && st.page
                ? { page: st.page, angels: st.angels || null, rifa: st.rifa || null }
                : parseRouteFromHash(raw);
        if (!protectRoutes(route.page, route)) {
            finishAppLoadingTransition();
            return;
        }
        void navigateTo(route.page, {
            fromPopState: true,
            angels: route.angels,
            rifa: route.rifa
        });
    });

    setupRealtimeRegisterValidation();
    updateNavigationBySession();
    const initialRoute = parseRouteFromHash(window.location.hash.slice(1) || "home");
    (async function bootApp() {
        try {
            if (protectRoutes(initialRoute.page, initialRoute)) {
                await navigateTo(initialRoute.page, {
                    replaceHistory: true,
                    angels: initialRoute.angels,
                    rifa: initialRoute.rifa
                });
            } else {
                finishAppLoadingTransition();
            }
        } catch (e) {
            console.error(e);
            finishAppLoadingTransition();
        }
    })();
});