/**
 * Cliente HTTP para el Web App Rifa (multi-proyecto).
 * POST CORS-safe: text/plain JSON, luego form-urlencoded payload=.
 * Opcional: window.CPM_RIFA_GAS_URL
 */
(function () {
    function gasUrl() {
        return String((typeof window !== "undefined" && window.CPM_RIFA_GAS_URL) || "").trim();
    }

    function looksLikeHtmlResponse(text) {
        const t = String(text || "").trim();
        return t.startsWith("<!") || t.startsWith("<html") || t.startsWith("<HTML");
    }

    function buildAttempts(rawPayload) {
        return [
            { headers: { "Content-Type": "text/plain;charset=utf-8" }, body: rawPayload },
            {
                headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
                body: new URLSearchParams({ payload: rawPayload }).toString()
            }
        ];
    }

    async function parseGasJson(response) {
        const rawText = await response.text();
        const trimmed = rawText.trim();
        if (!trimmed) throw new Error("Respuesta vacía del servidor.");
        if (looksLikeHtmlResponse(trimmed)) {
            throw new Error(
                "El Web App respondió HTML en lugar de JSON. Revisa la implementación y el despliegue."
            );
        }
        let result;
        try {
            result = JSON.parse(trimmed);
        } catch (e) {
            throw new Error("Respuesta no JSON desde Apps Script.");
        }
        if (!response.ok) {
            throw new Error(result.message || result.msg || `Error HTTP ${response.status}`);
        }
        if (result.status && result.status !== "SUCCESS") {
            throw new Error(result.message || result.msg || "Operación no completada.");
        }
        if (result.ok === false) {
            throw new Error(result.message || result.msg || "Operación no completada.");
        }
        return result;
    }

    async function post(payload, opts) {
        const url = gasUrl();
        if (!url) {
            throw new Error(
                "Falta la URL del Web App Rifa. Define window.CPM_RIFA_GAS_URL en index.html."
            );
        }
        const timeoutMs = Math.min(Math.max(Number(opts && opts.timeoutMs) || 28000, 8000), 120000);
        const controller = new AbortController();
        const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);
        const rawPayload = JSON.stringify(payload);
        const attempts = buildAttempts(rawPayload);

        let lastNetworkErr = null;
        try {
            for (let i = 0; i < attempts.length; i++) {
                try {
                    const response = await fetch(url, {
                        method: "POST",
                        mode: "cors",
                        redirect: "follow",
                        credentials: "omit",
                        cache: "no-store",
                        headers: attempts[i].headers,
                        body: attempts[i].body,
                        signal: controller.signal
                    });
                    return await parseGasJson(response);
                } catch (err) {
                    if (err?.name === "AbortError") {
                        throw new Error("Tiempo de espera agotado.");
                    }
                    if (!(err instanceof TypeError)) throw err;
                    lastNetworkErr = err;
                }
            }
        } finally {
            window.clearTimeout(timeoutId);
        }
        if (lastNetworkErr instanceof TypeError) {
            throw new Error(
                "No se pudo conectar al Web App Rifa (red, bloqueo o CORS). Comprueba CPM_RIFA_GAS_URL y el despliegue «Cualquiera»."
            );
        }
        throw lastNetworkErr || new Error("No se pudo conectar.");
    }

    window.CPMRifaApi = {
        gasUrl,
        post
    };
})();
